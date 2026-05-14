import { MarkerType, type Edge } from '@xyflow/react'
import type { CanvasEdge, CanvasNode, ProjectState, ResourceRef } from './types'

const isResourceRef = (value: unknown): value is ResourceRef =>
  typeof value === 'object' &&
  value !== null &&
  'resourceId' in value &&
  typeof (value as { resourceId?: unknown }).resourceId === 'string'

const resultResourceIds = (node: CanvasNode) => {
  const resources = node.data.resources
  if (!Array.isArray(resources)) return []

  return resources
    .map((resource) =>
      typeof resource === 'object' && resource !== null && 'resourceId' in resource
        ? String((resource as { resourceId: unknown }).resourceId)
        : undefined,
    )
    .filter((resourceId): resourceId is string => Boolean(resourceId))
}

const resourceHandleId = (resourceId: string) => `resource:${resourceId}`
const resultHandleId = (resourceId: string) => `result:${resourceId}`
const inputHandleId = (inputKey: string) => `input:${inputKey}`
const outputHandleId = (outputKey: string) => `output:${outputKey}`
const edgeMarkerEnd = {
  type: MarkerType.ArrowClosed,
  width: 18,
  height: 18,
  color: '#48616b',
} as const

const edgeSourceHandle = (edge: CanvasEdge, nodes: CanvasNode[]) => {
  if (edge.source.handleId && edge.source.handleId !== 'out') return edge.source.handleId
  if (edge.source.resourceId) {
    const sourceNode = nodes.find((node) => node.id === edge.source.nodeId)
    return sourceNode?.type === 'result_group' ? resultHandleId(edge.source.resourceId) : resourceHandleId(edge.source.resourceId)
  }
  return edge.source.handleId
}

const resourceNodeByResourceId = (nodes: CanvasNode[]) => {
  const resourceNodes = new Map<string, { nodeId: string; handleId: string }>()

  for (const node of nodes) {
    if (node.type === 'resource' && typeof node.data.resourceId === 'string') {
      resourceNodes.set(node.data.resourceId, {
        nodeId: node.id,
        handleId: resourceHandleId(node.data.resourceId),
      })
    }
  }

  for (const node of nodes) {
    if (node.type !== 'result_group') continue
    for (const resourceId of resultResourceIds(node)) {
      if (!resourceNodes.has(resourceId)) {
        resourceNodes.set(resourceId, {
          nodeId: node.id,
          handleId: resultHandleId(resourceId),
        })
      }
    }
  }

  return resourceNodes
}

const functionOutputHandleForResult = (project: ProjectState, node: CanvasNode) => {
  const resources = resultResourceIds(node)
  const resourceOutputKey = resources
    .map((resourceId) => project.resources[resourceId]?.source.outputKey)
    .find((outputKey): outputKey is string => Boolean(outputKey))
  if (resourceOutputKey) return outputHandleId(resourceOutputKey)

  const functionId = typeof node.data.functionId === 'string' ? node.data.functionId : undefined
  const functionDef = functionId ? project.functions[functionId] : undefined
  const outputKey = functionDef?.outputs[0]?.key
  return outputKey ? outputHandleId(outputKey) : undefined
}

const sourceHandleForResult = (project: ProjectState, node: CanvasNode) => {
  const sourceNodeId = typeof node.data.sourceFunctionNodeId === 'string' ? node.data.sourceFunctionNodeId : undefined
  const sourceNode = sourceNodeId ? project.canvas.nodes.find((item) => item.id === sourceNodeId) : undefined
  if (sourceNode?.type === 'resource' || sourceNode?.type === 'result_group') {
    const taskId = typeof node.data.taskId === 'string' ? node.data.taskId : undefined
    const firstInputRef = taskId ? Object.values(project.tasks[taskId]?.inputRefs ?? {})[0] : undefined
    if (firstInputRef) {
      return sourceNode.type === 'result_group'
        ? resultHandleId(firstInputRef.resourceId)
        : resourceHandleId(firstInputRef.resourceId)
    }
  }

  return functionOutputHandleForResult(project, node)
}

export function buildCanvasFlowEdges(project: ProjectState): Edge[] {
  const resourceNodes = resourceNodeByResourceId(project.canvas.nodes)
  const explicitInputKeys = new Set(project.canvas.edges.map((edge) => `${edge.target.nodeId}:${edge.target.inputKey}`))

  const explicitEdges: Edge[] = project.canvas.edges.map((edge) => ({
    id: edge.id,
    source: edge.source.nodeId,
    sourceHandle: edgeSourceHandle(edge, project.canvas.nodes),
    target: edge.target.nodeId,
    targetHandle: inputHandleId(edge.target.inputKey),
    animated: true,
    label: edge.target.inputKey,
    type: 'default',
    className: 'input-edge',
    markerEnd: edgeMarkerEnd,
  }))

  const inferredInputEdges: Edge[] = project.canvas.nodes
    .filter((node) => node.type === 'function')
    .flatMap((node) => {
      const inputValues = node.data.inputValues
      if (!inputValues || typeof inputValues !== 'object' || Array.isArray(inputValues)) return []

      return Object.entries(inputValues as Record<string, unknown>).flatMap(([inputKey, value]) => {
        if (!isResourceRef(value)) return []
        if (explicitInputKeys.has(`${node.id}:${inputKey}`)) return []

        const source = resourceNodes.get(value.resourceId)
        if (!source) return []

        return [
          {
            id: `input:${source.nodeId}:${node.id}:${inputKey}`,
            source: source.nodeId,
            sourceHandle: source.handleId,
            target: node.id,
            targetHandle: inputHandleId(inputKey),
            animated: true,
            label: inputKey,
            type: 'default',
            className: 'input-edge',
            markerEnd: edgeMarkerEnd,
          },
        ]
      })
    })

  const resultEdges: Edge[] = project.canvas.nodes
    .filter((node) => node.type === 'result_group')
    .map((node) => ({
      id: `${String(node.data.sourceFunctionNodeId)}-${node.id}`,
      source: String(node.data.sourceFunctionNodeId),
      sourceHandle: sourceHandleForResult(project, node),
      target: node.id,
      targetHandle: 'result-input',
      animated: false,
      type: 'default',
      className: 'result-edge',
      markerEnd: edgeMarkerEnd,
    }))

  return [...explicitEdges, ...inferredInputEdges, ...resultEdges]
}
