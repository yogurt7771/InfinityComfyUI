import { Background, Controls, ReactFlow, ReactFlowProvider, useReactFlow, type NodeTypes } from '@xyflow/react'
import { useMemo, useState } from 'react'
import { createAssetLineageEdge, type AssetGraphNode, type AssetLineageEdge } from '../../domain/assetGraph'
import { buildAssetGraphProjection } from '../../domain/assetGraphProjection'
import type { CanvasNode, ProjectState, Resource, ResourceRef, ResourceType } from '../../domain/types'
import { useProjectStore } from '../../store/projectStore'
import { FunctionCommandModal } from '../functions/FunctionCommandModal'
import { AssetNodeView } from './AssetNodeView'
import { CanvasContextMenus } from './CanvasContextMenus'
import { CanvasPickMode } from './CanvasPickMode'
import { GroupNodeView } from './GroupNodeView'

export const assetCanvasNodeTypes: NodeTypes = {
  asset: AssetNodeView,
  group: GroupNodeView,
}

type AssetGraphSelectionNode = {
  type?: string
  data?: unknown
}

type ContextMenuState = {
  client: { x: number; y: number }
  flow: { x: number; y: number }
}

const isResourceRef = (value: unknown): value is ResourceRef =>
  typeof value === 'object' &&
  value !== null &&
  'resourceId' in value &&
  typeof (value as { resourceId?: unknown }).resourceId === 'string'

const numberFromData = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

const resourceIdFromNodeData = (data: unknown) =>
  data && typeof data === 'object' && 'resourceId' in data && typeof data.resourceId === 'string' ? data.resourceId : undefined

const legacyResourceNodeToAssetNode = (node: CanvasNode, project: ProjectState): AssetGraphNode | undefined => {
  const resourceId = typeof node.data.resourceId === 'string' ? node.data.resourceId : undefined
  if (!resourceId) return undefined
  const resource = project.resources[resourceId]
  return {
    id: node.id,
    type: 'asset',
    position: node.position,
    data: {
      resourceId,
      title: resource?.name,
    },
  }
}

const legacyGroupNodeToAssetGroupNode = (node: CanvasNode, visibleNodeIds: Set<string>): AssetGraphNode => {
  const childNodeIds = Array.isArray(node.data.childNodeIds)
    ? node.data.childNodeIds.map(String).filter((nodeId) => visibleNodeIds.has(nodeId))
    : []
  return {
    id: node.id,
    type: 'group',
    position: node.position,
    size: {
      width: numberFromData(node.data.width, 360),
      height: numberFromData(node.data.height, 220),
    },
    data: {
      title: typeof node.data.title === 'string' ? node.data.title : 'Group',
      childNodeIds,
      color: typeof node.data.color === 'string' ? node.data.color : undefined,
      collapsed: node.data.collapsed === true,
    },
  }
}

export function projectToAssetGraph(project: ProjectState): { nodes: AssetGraphNode[]; edges: AssetLineageEdge[] } {
  const assetNodes = project.canvas.nodes
    .filter((node) => node.type === 'resource')
    .map((node) => legacyResourceNodeToAssetNode(node, project))
    .filter((node): node is AssetGraphNode => Boolean(node))
  const visibleNodeIds = new Set(assetNodes.map((node) => node.id))
  const resourceIdsWithNodes = new Set(assetNodes.map((node) => (node.type === 'asset' ? node.data.resourceId : undefined)).filter(Boolean))
  const groupNodes = project.canvas.nodes
    .filter((node) => node.type === 'group')
    .map((node) => legacyGroupNodeToAssetGroupNode(node, visibleNodeIds))

  const edgeIds = new Set<string>()
  const edges = Object.values(project.tasks).flatMap((task) =>
    Object.entries(task.inputRefs ?? {}).flatMap(([inputKey, inputRef]) => {
      if (!isResourceRef(inputRef) || !resourceIdsWithNodes.has(inputRef.resourceId)) return []
      return Object.values(task.outputRefs ?? {})
        .flat()
        .filter(isResourceRef)
        .flatMap((outputRef) => {
          if (outputRef.resourceId === inputRef.resourceId || !resourceIdsWithNodes.has(outputRef.resourceId)) return []
          const runId = project.resources[outputRef.resourceId]?.source.runId ?? task.id
          const edge = createAssetLineageEdge({
            runId,
            inputKey,
            sourceResourceId: inputRef.resourceId,
            targetResourceId: outputRef.resourceId,
          })
          if (edgeIds.has(edge.id)) return []
          edgeIds.add(edge.id)
          return [edge]
        })
    }),
  )

  return {
    nodes: [...assetNodes, ...groupNodes],
    edges,
  }
}

export function selectedResourcesForAssetNodes(project: ProjectState, selectedNodes: AssetGraphSelectionNode[]) {
  const resourceIds = selectedNodes
    .filter((node) => node.type === 'asset')
    .map((node) => resourceIdFromNodeData(node.data))
    .filter((resourceId): resourceId is string => Boolean(resourceId))
  return resourceIds.map((resourceId) => project.resources[resourceId]).filter((resource): resource is ProjectState['resources'][string] => Boolean(resource))
}

function CanvasSurface() {
  const project = useProjectStore((state) => state.project)
  const runFunctionAtPosition = useProjectStore((state) => state.runFunctionAtPosition)
  const { screenToFlowPosition } = useReactFlow()
  const [contextMenuPosition, setContextMenuPosition] = useState<ContextMenuState>()
  const [commandFunctionId, setCommandFunctionId] = useState<string>()
  const [pickMode, setPickMode] = useState<{ inputKey: string; inputType?: ResourceType }>()
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([])
  const [pickedResource, setPickedResource] = useState<{
    pickId: string
    inputKey: string
    resource: Resource
  }>()
  const graph = useMemo(() => projectToAssetGraph(project), [project])
  const projection = useMemo(() => buildAssetGraphProjection(graph), [graph])
  const nodes = useMemo(
    () =>
      projection.nodes.map((node) =>
        node.type === 'asset' && 'resourceId' in node.data
          ? {
              ...node,
              data: {
                ...node.data,
                resource: project.resources[node.data.resourceId],
              },
            }
          : node,
      ),
    [project.resources, projection.nodes],
  )

  const commandFunction = commandFunctionId ? project.functions[commandFunctionId] : undefined
  const candidateResources = useMemo(
    () =>
      selectedResourceIds
        .map((resourceId) => project.resources[resourceId])
        .filter((resource): resource is Resource => Boolean(resource)),
    [project.resources, selectedResourceIds],
  )

  return (
    <section className="canvas-workspace asset-only-canvas-workspace" aria-label="Asset canvas workspace">
      <ReactFlow
        nodes={nodes}
        edges={projection.edges}
        nodeTypes={assetCanvasNodeTypes}
        fitView
        onPaneContextMenu={(event) => {
          event.preventDefault()
          setContextMenuPosition({
            client: { x: event.clientX, y: event.clientY },
            flow: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
          })
        }}
        onPaneClick={() => setContextMenuPosition(undefined)}
        onNodeClick={(_, node) => {
          if (!pickMode || node.type !== 'asset') return
          const resourceId = resourceIdFromNodeData(node.data)
          if (!resourceId) return
          const resource = project.resources[resourceId]
          if (!resource || (pickMode.inputType && resource.type !== pickMode.inputType)) return
          setPickedResource({
            pickId: `${pickMode.inputKey}:${resource.id}:${Date.now()}`,
            inputKey: pickMode.inputKey,
            resource,
          })
          setPickMode(undefined)
        }}
        onSelectionChange={({ nodes: selectedNodes }) => {
          setSelectedResourceIds(selectedResourcesForAssetNodes(project, selectedNodes as AssetGraphSelectionNode[]).map((resource) => resource.id))
        }}
      >
        <Background />
        <Controls />
      </ReactFlow>
      <CanvasContextMenus
        functions={Object.values(project.functions)}
        position={contextMenuPosition?.client}
        onRunFunction={(functionId) => {
          setContextMenuPosition(undefined)
          setCommandFunctionId(functionId)
        }}
      />
      <CanvasPickMode
        inputKey={pickMode?.inputKey}
        inputType={pickMode?.inputType}
        onCancel={() => setPickMode(undefined)}
      />
      {commandFunction ? (
        <FunctionCommandModal
          functionDef={commandFunction}
          candidateResources={candidateResources}
          pickedResource={pickedResource}
          onClose={() => setCommandFunctionId(undefined)}
          onPickSlot={(inputKey) => {
            const input = commandFunction.inputs.find((item) => item.key === inputKey)
            setPickMode({ inputKey, inputType: input?.type })
          }}
          onRun={(request) => {
            void runFunctionAtPosition(
              request.functionId,
              request.inputValues,
              contextMenuPosition?.flow ?? { x: 0, y: 0 },
              commandFunction.runtimeDefaults?.runCount ?? 1,
            )
            setCommandFunctionId(undefined)
            setPickMode(undefined)
          }}
        />
      ) : null}
    </section>
  )
}

export function CanvasWorkspace() {
  return (
    <ReactFlowProvider>
      <CanvasSurface />
    </ReactFlowProvider>
  )
}
