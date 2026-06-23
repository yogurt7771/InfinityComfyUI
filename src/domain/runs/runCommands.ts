import { createAssetLineageEdge, type AssetGraphAssetNode, type AssetGraphNode, type AssetLineageEdge } from '../assetGraph'
import type { FunctionOutputDef, Resource, ResourceRef, ResourceType, RunSnapshot } from '../types'
import { generatedResourceSourceForRun } from './runSnapshot'

export type RunCommandProject = {
  canvas: {
    nodes: AssetGraphNode[]
    edges: AssetLineageEdge[]
  }
  resources: Record<string, Resource>
  runs: Record<string, RunSnapshot>
}

export type PendingOutputAssetsResult = {
  project: RunCommandProject
  resources: Record<string, Resource>
  nodes: AssetGraphAssetNode[]
  edges: AssetLineageEdge[]
  outputRefs: Record<string, ResourceRef[]>
}

type CreatePendingOutputAssetsInput = {
  run: RunSnapshot
  outputs: FunctionOutputDef[]
  basePosition: { x: number; y: number }
  now: string
}

const resourceTypeName = (type: ResourceType) => {
  if (type === 'text') return 'Text'
  if (type === 'number') return 'Number'
  if (type === 'image') return 'Image'
  if (type === 'video') return 'Video'
  return 'Audio'
}

const safeIdPart = (value: string) => value.replace(/[^a-zA-Z0-9_]+/g, '_')

const outputResourceId = (runId: string, outputKey: string) => `resource_${safeIdPart(runId)}_${safeIdPart(outputKey)}`

const outputNodeId = (resourceId: string) => `node_${resourceId}`

const titleCase = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return trimmed
  return trimmed.slice(0, 1).toUpperCase() + trimmed.slice(1)
}

const outputResourceName = (run: RunSnapshot, output: FunctionOutputDef) =>
  `${run.functionName} ${output.label ? titleCase(output.label) : resourceTypeName(output.type)}`

const outputPosition = (basePosition: { x: number; y: number }, outputIndex: number) => ({
  x: basePosition.x + outputIndex * 280,
  y: basePosition.y,
})

export function pendingOutputResourceValue(type: ResourceType, resourceId: string): Resource['value'] {
  if (type === 'text') return ''
  if (type === 'number') return 0
  return {
    assetId: `pending_${resourceId}`,
    url: '',
    filename: resourceTypeName(type),
    mimeType: `${type}/*`,
    sizeBytes: 0,
  }
}

export function createPendingOutputAssetsForRun(
  project: RunCommandProject,
  input: CreatePendingOutputAssetsInput,
): PendingOutputAssetsResult {
  const pendingResources: Record<string, Resource> = {}
  const outputRefs: Record<string, ResourceRef[]> = {}
  const nodes: AssetGraphAssetNode[] = []

  input.outputs.forEach((output, outputIndex) => {
    const resourceId = outputResourceId(input.run.id, output.key)
    const name = outputResourceName(input.run, output)
    const resource: Resource = {
      id: resourceId,
      type: output.type,
      name,
      value: pendingOutputResourceValue(output.type, resourceId),
      source: generatedResourceSourceForRun({
        runId: input.run.id,
        outputKey: output.key,
      }),
      metadata: {
        workflowFunctionId: input.run.functionId,
        endpointId: input.run.endpointId,
        createdAt: input.now,
      },
    }

    pendingResources[resourceId] = resource
    outputRefs[output.key] = [{ resourceId, type: output.type }]
    nodes.push({
      id: outputNodeId(resourceId),
      type: 'asset',
      position: outputPosition(input.basePosition, outputIndex),
      data: {
        resourceId,
        title: name,
      },
    })
  })

  const edges = Object.entries(input.run.inputRefs).flatMap(([inputKey, ref]) => {
    if (!('resourceId' in ref)) return []
    return Object.values(outputRefs).flatMap((refs) =>
      refs.map((outputRef) =>
        createAssetLineageEdge({
          runId: input.run.id,
          inputKey,
          sourceResourceId: ref.resourceId,
          targetResourceId: outputRef.resourceId,
        }),
      ),
    )
  })

  const runWithOutputRefs: RunSnapshot = {
    ...input.run,
    outputRefs,
    updatedAt: input.now,
  }

  const nextProject: RunCommandProject = {
    ...project,
    canvas: {
      nodes: [...project.canvas.nodes, ...nodes],
      edges: [...project.canvas.edges, ...edges],
    },
    resources: {
      ...project.resources,
      ...pendingResources,
    },
    runs: {
      ...project.runs,
      [input.run.id]: runWithOutputRefs,
    },
  }

  return {
    project: nextProject,
    resources: pendingResources,
    nodes,
    edges,
    outputRefs,
  }
}
