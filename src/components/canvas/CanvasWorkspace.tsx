import { Background, Controls, ReactFlow, ReactFlowProvider, useReactFlow, type NodeChange, type NodeTypes } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { createAssetLineageEdge, type AssetGraphNode, type AssetLineageEdge } from '../../domain/assetGraph'
import { buildAssetGraphProjection } from '../../domain/assetGraphProjection'
import { readFileAsAssetResource } from '../../domain/resourceFiles'
import { formatDurationMs, runDurationMs } from '../../domain/runTiming'
import type { CanvasNode, GenerationFunction, PrimitiveInputValue, ProjectState, Resource, ResourceRef, ResourceType } from '../../domain/types'
import { useProjectStore } from '../../store/projectStore'
import { FullResourcePreviewModal } from '../ResourcePreviewModal'
import { FunctionCommandModal } from '../functions/FunctionCommandModal'
import { AssetNodeView, type AssetNodeReference } from './AssetNodeView'
import { CanvasContextMenus } from './CanvasContextMenus'
import { CanvasMinimap } from './CanvasMinimap'
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
  mode: 'canvas' | 'asset'
  resourceIds?: string[]
}

type FunctionCommandState = {
  functionDef: GenerationFunction
  candidateResources: Resource[]
  initialInputValues?: Record<string, PrimitiveInputValue | ResourceRef>
  position: { x: number; y: number }
}

const isResourceRef = (value: unknown): value is ResourceRef =>
  typeof value === 'object' &&
  value !== null &&
  'resourceId' in value &&
    typeof (value as { resourceId?: unknown }).resourceId === 'string'

const isPrimitiveInputValue = (value: unknown): value is PrimitiveInputValue =>
  typeof value === 'string' || typeof value === 'number' || value === null

const numberFromData = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const droppedAssetVerticalGap = 190
const importFeedbackMessage = (count: number) =>
  `${count} ${count === 1 ? 'file' : 'files'} could not be imported`

const resourceIdFromNodeData = (data: unknown) =>
  data && typeof data === 'object' && 'resourceId' in data && typeof data.resourceId === 'string' ? data.resourceId : undefined

const isAssetLineageEdge = (value: unknown): value is AssetLineageEdge =>
  typeof value === 'object' &&
  value !== null &&
  'id' in value &&
  'runId' in value &&
  'inputKey' in value &&
  'sourceResourceId' in value &&
  'targetResourceId' in value &&
  typeof value.id === 'string' &&
  typeof value.runId === 'string' &&
  typeof value.inputKey === 'string' &&
  typeof value.sourceResourceId === 'string' &&
  typeof value.targetResourceId === 'string'

const liveRunStatuses = new Set(['created', 'waiting_endpoint', 'validating', 'compiling_workflow', 'uploading_assets', 'randomizing_seeds', 'pending', 'queued', 'running', 'fetching_outputs'])

const visibleRunStatuses = new Set([...liveRunStatuses, 'succeeded', 'failed', 'canceled'])

type AssetRunPresentation = {
  runStatus?: string
  runDurationLabel?: string
  runError?: string
  sourceFunctionName?: string
  isLive: boolean
}

const sourceTaskForResource = (project: ProjectState, resource: Resource | undefined) => {
  if (resource?.source.kind !== 'function_output') return undefined
  const directTaskId = resource.source.taskId ?? resource.source.runId
  const directTask = directTaskId ? project.tasks[directTaskId] : undefined
  if (directTask) return directTask

  const run = resource.source.runId ? project.runs?.[resource.source.runId] : undefined
  return run?.taskIds.map((taskId) => project.tasks[taskId]).find(Boolean)
}

const sourceRunForResource = (project: ProjectState, resource: Resource | undefined) => {
  if (resource?.source.kind !== 'function_output' || !resource.source.runId) return undefined
  return project.runs?.[resource.source.runId]
}

export const assetRunPresentation = (
  project: ProjectState,
  resource: Resource | undefined,
  liveEndAt: string,
): AssetRunPresentation => {
  if (resource?.source.kind !== 'function_output') return { isLive: false }

  const task = sourceTaskForResource(project, resource)
  const run = sourceRunForResource(project, resource)
  const runStatus = task?.status ?? run?.status
  const functionId = task?.functionId ?? run?.functionId ?? resource.metadata?.workflowFunctionId
  const sourceFunctionName = run?.functionName ?? (functionId ? project.functions[functionId]?.name : undefined)
  const timingSource = task
    ? {
        startedAt: task.startedAt ?? task.createdAt,
        updatedAt: task.updatedAt,
        completedAt: task.completedAt,
      }
    : run
      ? {
          startedAt: run.createdAt,
          updatedAt: run.updatedAt,
          completedAt: run.completedAt,
        }
      : undefined
  const isLive = Boolean(runStatus && liveRunStatuses.has(runStatus))
  const runDurationLabel = formatDurationMs(runDurationMs(timingSource, isLive ? liveEndAt : undefined))
  const runError = task?.error?.message ?? run?.error?.message

  return {
    runStatus: runStatus && visibleRunStatuses.has(runStatus) ? runStatus : undefined,
    runDurationLabel,
    runError,
    sourceFunctionName,
    isLive,
  }
}

const canvasNodeSize = (node: CanvasNode) => {
  const size = node.size
  if (size && Number.isFinite(size.width) && Number.isFinite(size.height)) return size
  const dataSize = node.data.size
  if (!dataSize || typeof dataSize !== 'object') return undefined
  const width = Number((dataSize as { width?: unknown }).width)
  const height = Number((dataSize as { height?: unknown }).height)
  return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : undefined
}

const legacyResourceNodeToAssetNode = (node: CanvasNode, project: ProjectState): AssetGraphNode | undefined => {
  const resourceId = typeof node.data.resourceId === 'string' ? node.data.resourceId : undefined
  if (!resourceId) return undefined
  const resource = project.resources[resourceId]
  return {
    id: node.id,
    type: 'asset',
    position: node.position,
    ...(canvasNodeSize(node) ? { size: canvasNodeSize(node) } : {}),
    data: {
      resourceId,
      title: typeof node.data.title === 'string' ? node.data.title : resource?.name,
    },
  }
}

const nativeAssetNodeToAssetNode = (node: CanvasNode, project: ProjectState): AssetGraphNode | undefined => {
  const resourceId = typeof node.data.resourceId === 'string' ? node.data.resourceId : undefined
  if (!resourceId || !project.resources[resourceId]) return undefined
  const size = canvasNodeSize(node)
  return {
    id: node.id,
    type: 'asset',
    position: node.position,
    ...(size ? { size } : {}),
    data: {
      resourceId,
      title: typeof node.data.title === 'string' ? node.data.title : project.resources[resourceId]?.name,
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
    .filter((node) => node.type === 'asset' || node.type === 'resource')
    .map((node) => (node.type === 'asset' ? nativeAssetNodeToAssetNode(node, project) : legacyResourceNodeToAssetNode(node, project)))
    .filter((node): node is AssetGraphNode => Boolean(node))
  const visibleNodeIds = new Set(assetNodes.map((node) => node.id))
  const resourceIdsWithNodes = new Set(assetNodes.map((node) => (node.type === 'asset' ? node.data.resourceId : undefined)).filter(Boolean))
  const groupNodes = project.canvas.nodes
    .filter((node) => node.type === 'group')
    .map((node) => legacyGroupNodeToAssetGroupNode(node, visibleNodeIds))

  const edgeIds = new Set<string>()
  const addLineageEdge = (edge: AssetLineageEdge) => {
    if (
      edge.sourceResourceId === edge.targetResourceId ||
      !resourceIdsWithNodes.has(edge.sourceResourceId) ||
      !resourceIdsWithNodes.has(edge.targetResourceId) ||
      edgeIds.has(edge.id)
    ) {
      return []
    }
    edgeIds.add(edge.id)
    return [edge]
  }
  const canvasEdges = project.canvas.edges.flatMap((edge) => (isAssetLineageEdge(edge) ? addLineageEdge(edge) : []))
  const taskEdges = Object.values(project.tasks).flatMap((task) =>
    Object.entries(task.inputRefs ?? {}).flatMap(([inputKey, inputRef]) => {
      if (!isResourceRef(inputRef) || !resourceIdsWithNodes.has(inputRef.resourceId)) return []
      return Object.values(task.outputRefs ?? {})
        .flat()
        .filter(isResourceRef)
        .flatMap((outputRef) => {
          const runId = project.resources[outputRef.resourceId]?.source.runId ?? task.id
          const edge = createAssetLineageEdge({
            runId,
            inputKey,
            sourceResourceId: inputRef.resourceId,
            targetResourceId: outputRef.resourceId,
          })
          return addLineageEdge(edge)
        })
    }),
  )

  return {
    nodes: [...assetNodes, ...groupNodes],
    edges: [...canvasEdges, ...taskEdges],
  }
}

export function selectedResourcesForAssetNodes(project: ProjectState, selectedNodes: AssetGraphSelectionNode[]) {
  const resourceIds = selectedNodes
    .filter((node) => node.type === 'asset')
    .map((node) => resourceIdFromNodeData(node.data))
    .filter((resourceId): resourceId is string => Boolean(resourceId))
  return resourceIds.map((resourceId) => project.resources[resourceId]).filter((resource): resource is ProjectState['resources'][string] => Boolean(resource))
}

const assetReferencesByResourceId = (
  graph: { nodes: AssetGraphNode[]; edges: AssetLineageEdge[] },
  resources: Record<string, Resource>,
) => {
  const assetNodesByResourceId = new Map(
    graph.nodes
      .filter((node): node is Extract<AssetGraphNode, { type: 'asset' }> => node.type === 'asset')
      .map((node) => [node.data.resourceId, node]),
  )
  const references: Record<string, AssetNodeReference[]> = {}

  const pushReference = (resourceId: string, reference: AssetNodeReference) => {
    references[resourceId] = [...(references[resourceId] ?? []), reference]
  }

  for (const edge of graph.edges) {
    const sourceNode = assetNodesByResourceId.get(edge.sourceResourceId)
    const targetNode = assetNodesByResourceId.get(edge.targetResourceId)
    const sourceResource = resources[edge.sourceResourceId]
    const targetResource = resources[edge.targetResourceId]
    if (!sourceNode || !targetNode || !sourceResource || !targetResource) continue

    pushReference(edge.sourceResourceId, {
      id: `${edge.id}:outgoing`,
      title: targetNode.data.title ?? targetResource.name ?? edge.targetResourceId,
      direction: 'outgoing',
      inputKey: edge.inputKey,
      resource: targetResource,
    })
    pushReference(edge.targetResourceId, {
      id: `${edge.id}:incoming`,
      title: sourceNode.data.title ?? sourceResource.name ?? edge.sourceResourceId,
      direction: 'incoming',
      inputKey: edge.inputKey,
      resource: sourceResource,
    })
  }

  return references
}

function CanvasSurface() {
  const project = useProjectStore((state) => state.project)
  const addEmptyResourceAtPosition = useProjectStore((state) => state.addEmptyResourceAtPosition)
  const addAssetResourcesAtPositions = useProjectStore((state) => state.addAssetResourcesAtPositions)
  const replaceAssetResource = useProjectStore((state) => state.replaceAssetResource)
  const runFunctionAtPosition = useProjectStore((state) => state.runFunctionAtPosition)
  const updateNodePositions = useProjectStore((state) => state.updateNodePositions)
  const { screenToFlowPosition } = useReactFlow()
  const [contextMenuPosition, setContextMenuPosition] = useState<ContextMenuState>()
  const [commandState, setCommandState] = useState<FunctionCommandState>()
  const [pickMode, setPickMode] = useState<{ inputKey: string; inputType?: ResourceType }>()
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([])
  const [previewResource, setPreviewResource] = useState<Resource | undefined>()
  const [dropFeedback, setDropFeedback] = useState<string>()
  const [draftNodePositions, setDraftNodePositions] = useState<Record<string, { x: number; y: number }>>({})
  const [liveEndAt, setLiveEndAt] = useState(() => new Date().toISOString())
  const [pickedResource, setPickedResource] = useState<{
    pickId: string
    inputKey: string
    resource: Resource
  }>()
  const graph = useMemo(() => projectToAssetGraph(project), [project])
  const projection = useMemo(() => buildAssetGraphProjection(graph), [graph])
  const referencesByResourceId = useMemo(
    () => assetReferencesByResourceId(graph, project.resources),
    [graph, project.resources],
  )
  const hasLiveAssetRuns = useMemo(
    () => Object.values(project.resources).some((resource) => assetRunPresentation(project, resource, liveEndAt).isLive),
    [liveEndAt, project],
  )

  useEffect(() => {
    if (!hasLiveAssetRuns) return undefined
    const updateLiveEnd = () => setLiveEndAt(new Date().toISOString())
    updateLiveEnd()
    const timer = window.setInterval(updateLiveEnd, 1000)
    return () => window.clearInterval(timer)
  }, [hasLiveAssetRuns])

  const nodes = useMemo(
    () =>
      projection.nodes.map((node) =>
        node.type === 'asset' && 'resourceId' in node.data
          ? (() => {
              const resource = project.resources[node.data.resourceId]
              return {
                ...node,
                position: draftNodePositions[node.id] ?? node.position,
                data: {
                  ...node.data,
                  resource,
                  references: referencesByResourceId[node.data.resourceId] ?? [],
                  ...assetRunPresentation(project, resource, liveEndAt),
                  onPreview: setPreviewResource,
                  onEditRun: openEditRunForResource,
                },
              }
            })()
          : {
              ...node,
              position: draftNodePositions[node.id] ?? node.position,
            },
      ),
    [draftNodePositions, liveEndAt, project, projection.nodes],
  )

  const selectedCandidateResources = useMemo(
    () =>
      selectedResourceIds
        .map((resourceId) => project.resources[resourceId])
        .filter((resource): resource is Resource => Boolean(resource)),
    [project.resources, selectedResourceIds],
  )
  const menuCandidateResources = useMemo(() => {
    if (contextMenuPosition?.mode !== 'asset' || !contextMenuPosition.resourceIds?.length) return selectedCandidateResources
    return contextMenuPosition.resourceIds
      .map((resourceId) => project.resources[resourceId])
      .filter((resource): resource is Resource => Boolean(resource))
  }, [contextMenuPosition, project.resources, selectedCandidateResources])
  const openFunctionCommand = (
    functionDef: GenerationFunction,
    resources: Resource[],
    position = contextMenuPosition?.flow ?? { x: 0, y: 0 },
    initialInputValues?: Record<string, PrimitiveInputValue | ResourceRef>,
  ) => {
    setPickedResource(undefined)
    setCommandState({
      functionDef,
      candidateResources: resources,
      initialInputValues,
      position,
    })
  }
  function openEditRunForResource(resource: Resource) {
    if (resource.source.kind !== 'function_output' || !resource.source.runId) return
    const run = project.runs?.[resource.source.runId]
    if (!run) return

    const resourcesById = new Map<string, Resource>()
    const initialInputValues: Record<string, PrimitiveInputValue | ResourceRef> = {}
    for (const input of run.functionSnapshot.inputs) {
      const ref = run.inputRefs[input.key]
      if (isResourceRef(ref)) {
        initialInputValues[input.key] = ref
        const inputResource = project.resources[ref.resourceId]
        if (inputResource) resourcesById.set(inputResource.id, inputResource)
        continue
      }

      const snapshotValue = run.inputValuesSnapshot[input.key]?.value
      if (isPrimitiveInputValue(snapshotValue)) initialInputValues[input.key] = snapshotValue
    }

    const sourceNode = graph.nodes.find(
      (node) => node.type === 'asset' && 'resourceId' in node.data && node.data.resourceId === resource.id,
    )
    openFunctionCommand(
      run.functionSnapshot,
      Array.from(resourcesById.values()),
      sourceNode ? { x: sourceNode.position.x + 360, y: sourceNode.position.y } : contextMenuPosition?.flow ?? { x: 0, y: 0 },
      initialInputValues,
    )
  }
  const openCanvasMenu = (event: MouseEvent | ReactMouseEvent<Element>) => {
    if (event.defaultPrevented) return
    const target = event.target instanceof Element ? event.target : undefined
    if (
      target?.closest('.asset-canvas-context-menu') ||
      target?.closest('.react-flow__node') ||
      target?.closest('.react-flow__controls')
    ) {
      return
    }
    event.preventDefault()
    setContextMenuPosition({
      client: { x: event.clientX, y: event.clientY },
      flow: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      mode: 'canvas',
    })
  }
  const openAssetMenu = (event: ReactMouseEvent<Element>, node: AssetGraphSelectionNode) => {
    if (node.type !== 'asset') return
    const resourceId = resourceIdFromNodeData(node.data)
    if (!resourceId || !project.resources[resourceId]) return
    event.preventDefault()
    event.stopPropagation()
    const menuResourceIds = selectedResourceIds.includes(resourceId) && selectedResourceIds.length > 0 ? selectedResourceIds : [resourceId]
    setSelectedResourceIds((current) => (current.includes(resourceId) ? current : [resourceId]))
    setContextMenuPosition({
      client: { x: event.clientX, y: event.clientY },
      flow: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      mode: 'asset',
      resourceIds: menuResourceIds,
    })
  }
  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }
  const handleDrop = (event: DragEvent<HTMLElement>) => {
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (!files.length) return
    event.preventDefault()
    const dropPosition = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const target = event.target instanceof Element ? event.target : undefined
    const targetResourceId = target?.closest('[data-resource-id]')?.getAttribute('data-resource-id') ?? undefined
    void Promise.all(
      files.map(async (file) => {
        try {
          const result = await readFileAsAssetResource(file)
          if (!result) return undefined
          return result.type === 'text'
            ? { type: 'text' as const, name: file.name, value: result.value }
            : { type: result.type, name: file.name, media: result.media }
        } catch {
          return undefined
        }
      }),
    ).then((items) => {
      const supportedItems = items.filter((item): item is NonNullable<(typeof items)[number]> => Boolean(item))
      const failedCount = files.length - supportedItems.length
      setDropFeedback(failedCount > 0 ? importFeedbackMessage(failedCount) : undefined)
      if (supportedItems.length === 0) return
      const [replacement, ...additionalItems] = supportedItems
      if (targetResourceId && replacement) {
        replaceAssetResource(targetResourceId, replacement)
        if (additionalItems.length === 0) return
      }
      const itemsToCreate = targetResourceId ? additionalItems : supportedItems
      addAssetResourcesAtPositions(
        itemsToCreate.map((item, index) => ({
          ...item,
          position: {
            x: dropPosition.x,
            y: dropPosition.y + index * droppedAssetVerticalGap,
          },
        })),
      )
    })
  }
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const draggingPositions: Record<string, { x: number; y: number }> = {}
      const settledPositions: Record<string, { x: number; y: number }> = {}

      for (const change of changes) {
        if (change.type !== 'position' || !change.position) continue
        if (change.dragging) {
          draggingPositions[change.id] = change.position
        } else {
          settledPositions[change.id] = change.position
        }
      }

      if (Object.keys(draggingPositions).length > 0) {
        setDraftNodePositions((current) => ({ ...current, ...draggingPositions }))
      }

      const settledNodeIds = Object.keys(settledPositions)
      if (settledNodeIds.length > 0) {
        setDraftNodePositions((current) => {
          const next = { ...current }
          for (const nodeId of settledNodeIds) delete next[nodeId]
          return next
        })
        updateNodePositions(settledPositions)
      }
    },
    [updateNodePositions],
  )

  return (
    <section
      className="workspace-canvas canvas-workspace asset-only-canvas-workspace"
      aria-label="Asset canvas workspace"
      onContextMenu={openCanvasMenu}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={projection.edges}
        autoPanOnNodeDrag={false}
        fitViewOptions={{ maxZoom: 1 }}
        onlyRenderVisibleElements={false}
        nodeTypes={assetCanvasNodeTypes}
        fitView
        onNodeContextMenu={openAssetMenu}
        onNodesChange={handleNodesChange}
        onPaneContextMenu={openCanvasMenu}
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
        <CanvasMinimap nodes={nodes} edges={projection.edges} />
      </ReactFlow>
      {dropFeedback ? (
        <div className="asset-drop-feedback" role="status">
          {dropFeedback}
        </div>
      ) : null}
      <CanvasContextMenus
        functions={Object.values(project.functions)}
        mode={contextMenuPosition?.mode}
        position={contextMenuPosition?.client}
        resourceTypes={menuCandidateResources.map((resource) => resource.type)}
        onCreateAsset={(type) => {
          addEmptyResourceAtPosition(type, contextMenuPosition?.flow ?? { x: 0, y: 0 })
          setContextMenuPosition(undefined)
        }}
        onRunFunction={(functionId) => {
          setContextMenuPosition(undefined)
          const functionDef = project.functions[functionId]
          if (functionDef) openFunctionCommand(functionDef, menuCandidateResources)
        }}
      />
      <CanvasPickMode
        inputKey={pickMode?.inputKey}
        inputType={pickMode?.inputType}
        onCancel={() => setPickMode(undefined)}
      />
      {commandState ? (
        <FunctionCommandModal
          functionDef={commandState.functionDef}
          candidateResources={commandState.candidateResources}
          initialInputValues={commandState.initialInputValues}
          pickedResource={pickedResource}
          onClose={() => setCommandState(undefined)}
          onPickSlot={(inputKey) => {
            const input = commandState.functionDef.inputs.find((item) => item.key === inputKey)
            setPickMode({ inputKey, inputType: input?.type })
          }}
          onRun={(request) => {
            void runFunctionAtPosition(
              request.functionId,
              request.inputValues,
              commandState.position,
              request.functionDef.runtimeDefaults?.runCount ?? 1,
              request.functionDef,
            )
            setCommandState(undefined)
            setPickMode(undefined)
          }}
        />
      ) : null}
      <FullResourcePreviewModal
        resource={previewResource}
        resources={previewResource ? [previewResource] : []}
        onClose={() => setPreviewResource(undefined)}
      />
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
