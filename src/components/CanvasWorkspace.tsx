import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  type Connection,
  type FinalConnectionState,
  type Edge,
  type Node,
  type NodeTypes,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useViewport,
} from '@xyflow/react'
import {
  CaseSensitive,
  GitCompareArrows,
  Grid2X2,
  Image,
  Info,
  Layers,
  MousePointer2,
  Pencil,
  Plus,
  Scissors,
  Shrink,
  Trash2,
  Video,
  Volume2,
  X,
} from 'lucide-react'
import { EmptyNodeView, FunctionNodeView, GroupNodeView, ResourceNodeView, ResultGroupNodeView } from './NodeViews'
import { ComfyWorkflowEditorDialog, FunctionManager, type EmbeddedComfySave } from './WorkbenchPanels'
import { ResourcePreview } from './ResourcePreview'
import { FullResourcePreviewModal } from './ResourcePreviewModal'
import { buildCanvasFlowEdges } from '../domain/canvasEdges'
import { targetInputInitialResourceValue } from '../domain/inputInitialValue'
import { buildNodeReferenceMap } from '../domain/nodeReferences'
import { readFileAsMediaResource } from '../domain/resourceFiles'
import { isBuiltInFunction } from '../domain/builtInFunctions'
import { GEMINI_LLM_FUNCTION_ID, isGeminiLlmFunction, mergedGeminiLlmConfig } from '../domain/geminiLlm'
import { GEMINI_IMAGE_FUNCTION_ID, isGeminiImageFunction, mergedGeminiImageConfig } from '../domain/geminiImage'
import { OPENAI_LLM_FUNCTION_ID, isOpenAILlmFunction, mergedOpenAILlmConfig } from '../domain/openaiLlm'
import { OPENAI_IMAGE_FUNCTION_ID, isOpenAIImageFunction, mergedOpenAIImageConfig } from '../domain/openaiImage'
import {
  isRequestFunction,
  mergedRequestConfig,
  normalizeRequestOutputsForParse,
  REQUEST_FUNCTION_ID,
  requestMethods,
  requestParseModes,
} from '../domain/requestFunction'
import {
  resourceNodeMinSize,
  resourceNodeMinSizeForCanvasNode,
  type ResourceNodeLayoutContext,
} from '../domain/resourceNodeLayout'
import {
  createGenerationFunctionFromWorkflow,
  isMediaResourceType,
  workflowInputBindingExists,
  workflowInputCandidates,
  workflowPrimitiveInputValue,
} from '../domain/workflow'
import { useProjectStore } from '../store/projectStore'
import { shouldIgnoreCanvasShortcut } from './canvasKeyboard'
import type {
  CanvasNode,
  ExecutionTask,
  FunctionInputDef,
  GenerationFunction,
  ComfyEndpointConfig,
  PrimitiveInputValue,
  ProjectState,
  Resource,
  ResourceRef,
  ResourceType,
} from '../domain/types'

type AddNodeMenuState = {
  screen: { x: number; y: number }
  flow: { x: number; y: number }
  placement?: {
    anchorNodeId: string
    side: 'left' | 'right'
  }
  connection?:
    | {
        kind: 'source'
        sourceNodeId: string
        sourceHandleId?: string | null
        resourceType?: ResourceType
      }
    | {
        kind: 'target'
        targetNodeId: string
        targetInputKey: string
        resourceType: ResourceType
      }
}

type ConnectionStartState = {
  nodeId: string | null
  handleId?: string | null
}

type CompareImagePair = {
  left: Resource
  right: Resource
}

type QuickToolbarState = {
  sourceNodeId: string
  left: number
  top: number
}

type FunctionNodeMenuState = {
  nodeId: string
  left: number
  top: number
}

type GroupNodeMenuState = {
  kind: 'selection' | 'group'
  nodeId?: string
  left: number
  top: number
}

type FunctionEditorState = {
  nodeId: string
  functionId: string
}

type FunctionRunMode = 'replace' | 'new'

type FunctionRunDialogState = {
  functionId: string
  temporaryFunction?: GenerationFunction
  inputValues: Record<string, PrimitiveInputValue | ResourceRef>
  runCount: number
  position: { x: number; y: number }
  replaceTarget?: {
    resourceId: string
    outputKey?: string
  }
}

type TemporaryComfyWorkflowState = {
  position: { x: number; y: number }
  endpointId?: string
  editorOpen: boolean
  candidateRefs: ResourceRef[]
}

type BuiltInRunnerMenuItem = {
  id: string
  label: string
  functionId?: string
  kind: 'comfyui' | 'function'
}

type FunctionInputPickMode = {
  functionId: string
  inputKey: string
  inputLabel: string
  inputType: ResourceType
}

export const functionRunFloatingMenuReset = () => ({
  addMenu: null as AddNodeMenuState | null,
  quickToolbar: undefined as QuickToolbarState | undefined,
  functionNodeMenu: undefined as FunctionNodeMenuState | undefined,
  groupNodeMenu: undefined as GroupNodeMenuState | undefined,
  inputPickMode: undefined as FunctionInputPickMode | undefined,
})

const nodeTypes: NodeTypes = {
  resource: ResourceNodeView,
  function: FunctionNodeView,
  result_group: ResultGroupNodeView,
  group: GroupNodeView,
  default: EmptyNodeView,
}

const builtInFunctionMenuOrder = [
  REQUEST_FUNCTION_ID,
  OPENAI_LLM_FUNCTION_ID,
  GEMINI_LLM_FUNCTION_ID,
  OPENAI_IMAGE_FUNCTION_ID,
  GEMINI_IMAGE_FUNCTION_ID,
]

const builtInFunctionMenuLabels: Record<string, string> = {
  [REQUEST_FUNCTION_ID]: 'Request',
  [OPENAI_LLM_FUNCTION_ID]: 'OpenAI LLM',
  [GEMINI_LLM_FUNCTION_ID]: 'Gemini LLM',
  [OPENAI_IMAGE_FUNCTION_ID]: 'OpenAI Image',
  [GEMINI_IMAGE_FUNCTION_ID]: 'Gemini Image',
}

const temporaryRunnerId = (functionId: string) =>
  `temp_${functionId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

export const visibleCanvasNodes = (nodes: CanvasNode[]) =>
  nodes.filter((node) => node.type === 'resource' || node.type === 'group')

const GROUP_NODE_Z_INDEX_BASE = 0
const ASSET_NODE_Z_INDEX_BASE = 10000

const parsedTimestamp = (value: unknown) => {
  if (typeof value !== 'string') return 0
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}

const canvasNodeCreatedAtMs = (node: CanvasNode, resourcesById: Record<string, Resource>) => {
  if (node.type === 'resource' && typeof node.data.resourceId === 'string') {
    const resource = resourcesById[node.data.resourceId]
    return (
      parsedTimestamp(resource?.metadata?.createdAt) ||
      parsedTimestamp(node.data.createdAt) ||
      parsedTimestamp(node.data.highlightedAt)
    )
  }

  return parsedTimestamp(node.data.createdAt) || parsedTimestamp(node.data.highlightedAt)
}

export const buildCanvasNodeZIndexMap = (
  nodes: CanvasNode[],
  resourcesById: Record<string, Resource>,
  selectedNodeRecencyById: Record<string, number> = {},
) => {
  const zIndexById = new Map<string, number>()
  const layers = [
    { base: GROUP_NODE_Z_INDEX_BASE, nodes: nodes.filter((node) => node.type === 'group') },
    { base: ASSET_NODE_Z_INDEX_BASE, nodes: nodes.filter((node) => node.type !== 'group') },
  ]

  for (const layer of layers) {
    layer.nodes
      .map((node) => ({
        node,
        originalIndex: nodes.findIndex((item) => item.id === node.id),
        selectedRecency: selectedNodeRecencyById[node.id] ?? 0,
        createdAt: canvasNodeCreatedAtMs(node, resourcesById),
      }))
      .sort(
        (left, right) =>
          left.selectedRecency - right.selectedRecency ||
          left.createdAt - right.createdAt ||
          left.originalIndex - right.originalIndex,
      )
      .forEach((item, index) => {
        zIndexById.set(item.node.id, layer.base + index)
      })
  }

  return zIndexById
}

const visibleFlowEdges = (edges: Edge[], visibleNodes: CanvasNode[]) => {
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id))
  return edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
}

const inputKeyFromHandle = (handleId?: string | null) =>
  handleId?.startsWith('input:') ? handleId.slice('input:'.length) : undefined

const resourceIdFromHandle = (handleId?: string | null) => {
  if (!handleId) return undefined
  if (handleId.startsWith('resource:')) return handleId.slice('resource:'.length)
  if (handleId.startsWith('result:')) return handleId.slice('result:'.length)
  return undefined
}

const pendingOutputKeyFromHandle = (handleId?: string | null) =>
  handleId?.startsWith('pending:') ? handleId.slice('pending:'.length) : undefined

const functionAcceptsResourceType = (fn: GenerationFunction, resourceType?: ResourceType) =>
  !resourceType || fn.inputs.some((input) => input.type === resourceType)

const isResourceRefValue = (value: unknown): value is ResourceRef =>
  typeof value === 'object' &&
  value !== null &&
  'resourceId' in value &&
  typeof (value as { resourceId?: unknown }).resourceId === 'string'

const functionRunInputsFromTask = (task: ExecutionTask): Record<string, PrimitiveInputValue | ResourceRef> => {
  const values: Record<string, PrimitiveInputValue | ResourceRef> = {}
  for (const [key, snapshot] of Object.entries(task.inputValuesSnapshot ?? {})) {
    if (snapshot.source === 'resource' && snapshot.resourceId) {
      values[key] = { resourceId: snapshot.resourceId, type: snapshot.type }
    } else if (
      snapshot.source !== 'pending' &&
      (snapshot.value === null ||
        typeof snapshot.value === 'string' ||
        typeof snapshot.value === 'number' ||
        typeof snapshot.value === 'boolean')
    ) {
      values[key] = snapshot.value
    }
  }

  for (const [key, ref] of Object.entries(task.inputRefs ?? {})) {
    if (isResourceRefValue(ref)) values[key] = ref
  }

  return values
}

export const buildFunctionRunInputDraft = (
  functionDef: GenerationFunction,
  resourcesById: Record<string, Resource>,
  candidateRefs: ResourceRef[],
) => {
  const usedResourceIds = new Set<string>()
  const inputValues: Record<string, PrimitiveInputValue | ResourceRef> = {}

  for (const input of functionDef.inputs) {
    const resourceRef = candidateRefs.find((ref) => {
      if (usedResourceIds.has(ref.resourceId) || ref.type !== input.type) return false
      return Boolean(resourcesById[ref.resourceId])
    })

    if (resourceRef) {
      inputValues[input.key] = resourceRef
      usedResourceIds.add(resourceRef.resourceId)
      continue
    }

    if (input.type === 'text' || input.type === 'number' || input.type === 'boolean') {
      inputValues[input.key] =
        input.defaultValue ??
        workflowPrimitiveInputValue(functionDef, input) ??
        (input.type === 'number' ? 0 : input.type === 'boolean' ? false : '')
    }
  }

  return inputValues
}

export const pickableResourceRefsForInput = (project: ProjectState, inputType: ResourceType) =>
  visibleCanvasNodes(project.canvas.nodes).flatMap((node) => {
    if (node.type !== 'resource' || typeof node.data.resourceId !== 'string') return []
    const resourceId = node.data.resourceId
    const resource = project.resources[resourceId]
    if (!resource || resource.type !== inputType) return []
    return [{ nodeId: node.id, resourceId, type: resource.type }]
  })

const addMenuItemMatches = (label: string, query: string) => {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (tokens.length === 0) return true
  const normalizedLabel = label.toLowerCase()
  return tokens.every((token) => normalizedLabel.includes(token))
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const markerKey = (marker: Edge['markerEnd']) =>
  marker && typeof marker === 'object'
    ? `${marker.type ?? ''}|${marker.width ?? ''}|${marker.height ?? ''}|${marker.color ?? ''}`
    : String(marker ?? '')

export const sameFlowEdgesForSync = (left: Edge[], right: Edge[]) => {
  if (left === right) return true
  if (left.length !== right.length) return false

  const rightById = new Map(right.map((edge) => [edge.id, edge]))
  return left.every((edge) => {
    const next = rightById.get(edge.id)
    return (
      next &&
      edge.id === next.id &&
      edge.source === next.source &&
      edge.sourceHandle === next.sourceHandle &&
      edge.target === next.target &&
      edge.targetHandle === next.targetHandle &&
      edge.animated === next.animated &&
      edge.label === next.label &&
      edge.type === next.type &&
      edge.className === next.className &&
      edge.selected === next.selected &&
      markerKey(edge.markerEnd) === markerKey(next.markerEnd)
    )
  })
}

export const selectedEdgeIdsFromSelectionChange = (current: string[], changedEdgeIds: string[]) => {
  if (changedEdgeIds.length === 0) return current
  return current.length === changedEdgeIds.length && current.every((edgeId, index) => edgeId === changedEdgeIds[index])
    ? current
    : changedEdgeIds
}

type SelectionHighlightNodeLike = Pick<Node, 'id'>
type SelectionHighlightEdgeLike = Pick<Edge, 'id' | 'source' | 'target'>

const mergeClassNames = (...classNames: Array<string | undefined | false>) =>
  classNames.filter(Boolean).join(' ') || undefined

export function buildCanvasSelectionHighlights(
  nodes: SelectionHighlightNodeLike[],
  edges: SelectionHighlightEdgeLike[],
  selectedNodeIds: string[],
  selectedEdgeIds: string[],
  traceNodeIds: string[] = [],
) {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const selectedNodes = new Set(selectedNodeIds.filter((nodeId) => nodeIds.has(nodeId)))
  const selectedEdges = new Set(selectedEdgeIds)
  const traceStarts = traceNodeIds.filter((nodeId) => nodeIds.has(nodeId))
  const relatedNodes = new Set<string>()
  const relatedEdges = new Set<string>()
  const hasSelection = selectedNodes.size > 0 || selectedEdges.size > 0 || traceStarts.length > 0

  if (traceStarts.length > 0) {
    const adjacency = new Map<string, string[]>()
    for (const nodeId of nodeIds) adjacency.set(nodeId, [])
    for (const edge of edges) {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue
      adjacency.get(edge.source)?.push(edge.target)
      adjacency.get(edge.target)?.push(edge.source)
    }

    const queue = [...traceStarts]
    for (const nodeId of traceStarts) relatedNodes.add(nodeId)
    while (queue.length > 0) {
      const nodeId = queue.shift()
      if (!nodeId) continue
      for (const nextNodeId of adjacency.get(nodeId) ?? []) {
        if (relatedNodes.has(nextNodeId)) continue
        relatedNodes.add(nextNodeId)
        queue.push(nextNodeId)
      }
    }

    for (const edge of edges) {
      if (relatedNodes.has(edge.source) && relatedNodes.has(edge.target)) relatedEdges.add(edge.id)
    }
  } else {
    for (const edge of edges) {
      if (selectedNodes.has(edge.source) || selectedNodes.has(edge.target)) {
        relatedEdges.add(edge.id)
        relatedNodes.add(edge.source)
        relatedNodes.add(edge.target)
      }
    }
  }

  for (const edge of edges) {
    if (!selectedEdges.has(edge.id)) continue
    relatedNodes.add(edge.source)
    relatedNodes.add(edge.target)
  }

  const nodeClassNamesById = new Map<string, string>()
  for (const node of nodes) {
    if (selectedNodes.has(node.id)) {
      nodeClassNamesById.set(node.id, 'selection-primary')
    } else if (relatedNodes.has(node.id)) {
      nodeClassNamesById.set(node.id, 'selection-related')
    } else if (hasSelection) {
      nodeClassNamesById.set(node.id, 'selection-dimmed')
    }
  }

  const edgeClassNamesById = new Map<string, string>()
  for (const edge of edges) {
    if (selectedEdges.has(edge.id)) {
      edgeClassNamesById.set(edge.id, 'selection-primary-edge')
    } else if (relatedEdges.has(edge.id)) {
      edgeClassNamesById.set(edge.id, 'selection-related-edge')
    } else if (hasSelection) {
      edgeClassNamesById.set(edge.id, 'selection-dimmed-edge')
    }
  }

  return { nodeClassNamesById, edgeClassNamesById }
}

type MinimapNodeLike = Pick<Node, 'id' | 'position' | 'style'> & {
  width?: number | null
  height?: number | null
  measured?: { width?: number; height?: number }
}

type MinimapEdgeLike = Pick<Edge, 'id' | 'source' | 'target'>

type MinimapRect = {
  id?: string
  x: number
  y: number
  width: number
  height: number
}

type MinimapPoint = {
  x: number
  y: number
}

export type ComfyMinimapLayout = {
  width: number
  height: number
  padding: number
  content: MinimapRect
  scale: number
  offsetX: number
  offsetY: number
  nodeRects: MinimapRect[]
  edgeLines: { id: string; x1: number; y1: number; x2: number; y2: number }[]
  viewportRect: MinimapRect
}

const COMFY_MINIMAP_MIN_WIDTH = 260
const COMFY_MINIMAP_MAX_WIDTH = 380
const COMFY_MINIMAP_MIN_HEIGHT = 160
const COMFY_MINIMAP_MAX_HEIGHT = 250
const COMFY_MINIMAP_PADDING = 24
const MINIMAP_NODE_DEFAULT_WIDTH = 230
const MINIMAP_NODE_DEFAULT_HEIGHT = 180

const numericStyleSize = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

const minimapNodeSize = (node: MinimapNodeLike) => {
  const style = node.style as Record<string, unknown> | undefined
  return {
    width:
      numericStyleSize(node.width) ??
      numericStyleSize(node.measured?.width) ??
      numericStyleSize(style?.width) ??
      MINIMAP_NODE_DEFAULT_WIDTH,
    height:
      numericStyleSize(node.height) ??
      numericStyleSize(node.measured?.height) ??
      numericStyleSize(style?.height) ??
      MINIMAP_NODE_DEFAULT_HEIGHT,
  }
}

const minimapNodeFlowRects = (nodes: MinimapNodeLike[]) =>
  nodes.map((node) => {
    const size = minimapNodeSize(node)
    return {
      id: node.id,
      x: node.position.x,
      y: node.position.y,
      width: size.width,
      height: size.height,
    }
  })

const minimapContentRect = (nodeRects: MinimapRect[]) => {
  if (nodeRects.length === 0) return { x: -600, y: -360, width: 1200, height: 720 }
  const minX = Math.min(...nodeRects.map((node) => node.x))
  const minY = Math.min(...nodeRects.map((node) => node.y))
  const maxX = Math.max(...nodeRects.map((node) => node.x + node.width))
  const maxY = Math.max(...nodeRects.map((node) => node.y + node.height))
  const graphWidth = Math.max(1, maxX - minX)
  const graphHeight = Math.max(1, maxY - minY)
  const graphPadding = clamp(Math.max(graphWidth, graphHeight) * 0.08, 160, 520)
  return {
    x: minX - graphPadding,
    y: minY - graphPadding,
    width: graphWidth + graphPadding * 2,
    height: graphHeight + graphPadding * 2,
  }
}

const comfyMinimapPanelSize = (content: MinimapRect, nodeCount: number) => {
  const aspect = clamp(content.width / Math.max(content.height, 1), 0.85, 2.35)
  const nodeBoost = clamp(nodeCount * 5, 0, 72)
  let width = clamp(292 + nodeBoost, COMFY_MINIMAP_MIN_WIDTH, COMFY_MINIMAP_MAX_WIDTH)
  let height = clamp(width / aspect, COMFY_MINIMAP_MIN_HEIGHT, COMFY_MINIMAP_MAX_HEIGHT)
  if (height === COMFY_MINIMAP_MAX_HEIGHT && aspect > 1) width = clamp(height * aspect, COMFY_MINIMAP_MIN_WIDTH, COMFY_MINIMAP_MAX_WIDTH)
  return { width: Math.round(width), height: Math.round(height) }
}

const mapFlowRectToMinimap = (rect: MinimapRect, layout: Pick<ComfyMinimapLayout, 'content' | 'scale' | 'offsetX' | 'offsetY'>) => ({
  id: rect.id,
  x: layout.offsetX + (rect.x - layout.content.x) * layout.scale,
  y: layout.offsetY + (rect.y - layout.content.y) * layout.scale,
  width: rect.width * layout.scale,
  height: rect.height * layout.scale,
})

export function buildComfyMinimapLayout(
  nodes: MinimapNodeLike[],
  edges: MinimapEdgeLike[],
  viewport: { x: number; y: number; zoom: number },
  canvasSize: { width: number; height: number },
): ComfyMinimapLayout {
  const flowNodeRects = minimapNodeFlowRects(nodes)
  const zoom = viewport.zoom || 1
  const visibleFlowRect = {
    x: -viewport.x / zoom,
    y: -viewport.y / zoom,
    width: canvasSize.width / zoom,
    height: canvasSize.height / zoom,
  }
  const content = minimapContentRect(flowNodeRects.length > 0 ? [...flowNodeRects, visibleFlowRect] : [visibleFlowRect])
  const panelSize = comfyMinimapPanelSize(content, nodes.length)
  const innerWidth = Math.max(1, panelSize.width - COMFY_MINIMAP_PADDING * 2)
  const innerHeight = Math.max(1, panelSize.height - COMFY_MINIMAP_PADDING * 2)
  const scale = Math.min(innerWidth / content.width, innerHeight / content.height)
  const offsetX = (panelSize.width - content.width * scale) / 2
  const offsetY = (panelSize.height - content.height * scale) / 2
  const layoutBase = { content, scale, offsetX, offsetY }
  const nodeRects = flowNodeRects.map((rect) => mapFlowRectToMinimap(rect, layoutBase))
  const nodeRectById = new Map(flowNodeRects.map((rect) => [rect.id, rect]))
  const edgeLines = edges.flatMap((edge) => {
    const source = nodeRectById.get(edge.source)
    const target = nodeRectById.get(edge.target)
    if (!source || !target) return []
    const sourceCenter = mapFlowRectToMinimap(
      { x: source.x + source.width / 2, y: source.y + source.height / 2, width: 0, height: 0 },
      layoutBase,
    )
    const targetCenter = mapFlowRectToMinimap(
      { x: target.x + target.width / 2, y: target.y + target.height / 2, width: 0, height: 0 },
      layoutBase,
    )
    return [{ id: edge.id, x1: sourceCenter.x, y1: sourceCenter.y, x2: targetCenter.x, y2: targetCenter.y }]
  })
  const viewportRect = mapFlowRectToMinimap(visibleFlowRect, layoutBase)

  return {
    ...panelSize,
    padding: COMFY_MINIMAP_PADDING,
    content,
    scale,
    offsetX,
    offsetY,
    nodeRects,
    edgeLines,
    viewportRect,
  }
}

export function minimapPointToFlowPosition(point: MinimapPoint, layout: ComfyMinimapLayout) {
  return {
    x: layout.content.x + (point.x - layout.offsetX) / layout.scale,
    y: layout.content.y + (point.y - layout.offsetY) / layout.scale,
  }
}

const mediaValue = (resource: Resource | undefined) =>
  typeof resource?.value === 'object' && resource.value !== null && 'url' in resource.value ? resource.value : undefined

const resourceLabel = (resource: Resource) => mediaValue(resource)?.filename ?? resource.name ?? resource.id

function LocalQuickActionIcon({ kind }: { kind?: string }) {
  if (kind === 'image_resize') return <Shrink aria-hidden="true" size={14} />
  if (kind === 'image_blur') return <Image aria-hidden="true" size={14} />
  if (kind === 'image_grid_split') return <Grid2X2 aria-hidden="true" size={14} />
  if (kind === 'text_trim') return <Scissors aria-hidden="true" size={14} />
  if (kind === 'text_case') return <CaseSensitive aria-hidden="true" size={14} />
  if (kind === 'video_info') return <Video aria-hidden="true" size={14} />
  if (kind === 'audio_info') return <Volume2 aria-hidden="true" size={14} />
  return <Info aria-hidden="true" size={14} />
}

const resultImageResource = (node: CanvasNode | undefined, resourcesById: Record<string, Resource>) => {
  if (!node || node.type !== 'result_group' || !Array.isArray(node.data.resources)) return undefined

  for (const ref of node.data.resources) {
    if (typeof ref !== 'object' || ref === null || !('resourceId' in ref)) continue
    const resourceId = String((ref as { resourceId: unknown }).resourceId)
    const resource = resourcesById[resourceId]
    if (resource?.type === 'image' && mediaValue(resource)?.url) return resource
  }

  return undefined
}

const storedNodeSize = (node: CanvasNode) => {
  const size = node.data.size
  if (!size || typeof size !== 'object') return undefined
  const width = Number((size as { width?: unknown }).width)
  const height = Number((size as { height?: unknown }).height)
  return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : undefined
}

const defaultFunctionWidth = (functionDef: GenerationFunction | undefined) => {
  const format = functionDef?.workflow.format
  return format && format !== 'comfyui_api_json' ? 430 : 520
}

const defaultFunctionHeight = (functionDef: GenerationFunction | undefined) => {
  const format = functionDef?.workflow.format
  return format && format !== 'comfyui_api_json' ? 620 : undefined
}

const MENU_NODE_GAP = 96
const DEFAULT_ASSET_NODE_WIDTH = resourceNodeMinSize({ resourceType: 'image', title: 'Resource', referenceCount: 0 }).width

const defaultNodeSize = (node: CanvasNode, functionsById: Record<string, GenerationFunction>) => {
  if (node.type === 'function') {
    const functionId = typeof node.data.functionId === 'string' ? node.data.functionId : undefined
    const functionDef = functionId ? functionsById[functionId] : undefined
    return {
      width: defaultFunctionWidth(functionDef),
      height: defaultFunctionHeight(functionDef),
    }
  }

  if (node.type === 'result_group') return { width: 300, height: undefined }
  if (node.type === 'group') return { width: 230, height: undefined }
  return resourceNodeMinSizeForCanvasNode(node, { functionsById })
}

export const flowNodeStyle = (node: CanvasNode, context: ResourceNodeLayoutContext) => {
  const defaultSize = defaultNodeSize(node, context.functionsById)
  const size = storedNodeSize(node)
  if (node.type === 'resource') {
    const minSize = resourceNodeMinSizeForCanvasNode(node, context)
    return {
      width: Math.max(size?.width ?? minSize.width, minSize.width),
      height: Math.max(size?.height ?? minSize.height, minSize.height),
    }
  }
  return {
    width: size?.width ?? defaultSize.width,
    ...(size?.height ?? defaultSize.height
      ? { height: size?.height ?? defaultSize.height }
      : {}),
  }
}

function CompareRunResultsModal({ pair, onClose }: { pair: CompareImagePair; onClose: () => void }) {
  const [splitPercent, setSplitPercent] = useState(50)
  const sliderRef = useRef<HTMLDivElement | null>(null)
  const leftMedia = mediaValue(pair.left)
  const rightMedia = mediaValue(pair.right)
  const leftLabel = resourceLabel(pair.left)
  const rightLabel = resourceLabel(pair.right)
  const setSplitFromClientX = (clientX: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    if (!rect.width) return
    setSplitPercent(Math.round(clamp(((clientX - rect.left) / rect.width) * 100, 0, 100)))
  }
  const adjustSplit = useCallback((delta: number) => {
    setSplitPercent((current) => Math.round(clamp(current + delta, 0, 100)))
  }, [])

  useEffect(() => {
    sliderRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        adjustSplit(-2)
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        adjustSplit(2)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [adjustSplit, onClose])

  if (!leftMedia?.url || !rightMedia?.url) return null

  return (
    <div
      className="compare-backdrop nodrag nopan"
      onMouseDown={(event) => {
        event.stopPropagation()
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        aria-label="Compare run results"
        aria-modal="true"
        className="compare-modal"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="compare-header">
          <div>
            <h2>Compare</h2>
            <span>{leftLabel}</span>
          </div>
          <div className="compare-header-right">
            <span>{rightLabel}</span>
            <button type="button" aria-label="Close comparison" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>
        <div
          ref={sliderRef}
          aria-label="Image comparison slider"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={splitPercent}
          className="compare-stage"
          role="slider"
          tabIndex={0}
          onPointerDown={(event) => setSplitFromClientX(event.clientX, event.currentTarget)}
          onPointerMove={(event) => setSplitFromClientX(event.clientX, event.currentTarget)}
        >
          <img className="compare-image" src={String(rightMedia.url)} alt={rightLabel} draggable={false} />
          <div className="compare-left-clip" style={{ clipPath: `inset(0 ${100 - splitPercent}% 0 0)` }}>
            <img className="compare-image" src={String(leftMedia.url)} alt={leftLabel} draggable={false} />
          </div>
          <div className="compare-divider" style={{ left: `${splitPercent}%` }}>
            <span />
          </div>
        </div>
      </section>
    </div>
  )
}

function ComfyMinimap({
  nodes,
  edges,
  canvasRef,
}: {
  nodes: Node[]
  edges: Edge[]
  canvasRef: RefObject<HTMLElement | null>
}) {
  const viewport = useViewport()
  const { setCenter } = useReactFlow()
  const minimapRef = useRef<SVGSVGElement | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 })

  useLayoutEffect(() => {
    let observer: ResizeObserver | undefined
    let animationFrame = 0

    const updateCanvasSize = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      setCanvasSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) })
    }

    const attachObserver = () => {
      const canvas = canvasRef.current
      if (!canvas) {
        animationFrame = window.requestAnimationFrame(attachObserver)
        return
      }
      updateCanvasSize()
      observer = new ResizeObserver(updateCanvasSize)
      observer.observe(canvas)
    }

    attachObserver()
    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      observer?.disconnect()
    }
  }, [canvasRef])

  const layout = useMemo(
    () => buildComfyMinimapLayout(nodes, edges, viewport, canvasSize),
    [canvasSize, edges, nodes, viewport],
  )
  const viewportDisplayRect = useMemo(() => {
    const width = Math.max(10, layout.viewportRect.width)
    const height = Math.max(10, layout.viewportRect.height)
    return {
      ...layout.viewportRect,
      x: layout.viewportRect.x + (layout.viewportRect.width - width) / 2,
      y: layout.viewportRect.y + (layout.viewportRect.height - height) / 2,
      width,
      height,
    }
  }, [layout.viewportRect])

  const setViewportFromClientPoint = useCallback(
    (clientX: number, clientY: number, dragOffset: MinimapPoint = { x: 0, y: 0 }) => {
      const rect = minimapRef.current?.getBoundingClientRect()
      if (!rect) return
      const point = {
        x: clamp(((clientX - rect.left) / Math.max(1, rect.width)) * layout.width, 0, layout.width),
        y: clamp(((clientY - rect.top) / Math.max(1, rect.height)) * layout.height, 0, layout.height),
      }
      const flowPoint = minimapPointToFlowPosition({ x: point.x - dragOffset.x, y: point.y - dragOffset.y }, layout)
      setCenter(flowPoint.x, flowPoint.y, { zoom: viewport.zoom, duration: 0 })
    },
    [layout, setCenter, viewport.zoom],
  )

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = minimapRef.current?.getBoundingClientRect()
    if (!rect) return
    const point = {
      x: clamp(((event.clientX - rect.left) / Math.max(1, rect.width)) * layout.width, 0, layout.width),
      y: clamp(((event.clientY - rect.top) / Math.max(1, rect.height)) * layout.height, 0, layout.height),
    }
    const viewportCenter = {
      x: viewportDisplayRect.x + viewportDisplayRect.width / 2,
      y: viewportDisplayRect.y + viewportDisplayRect.height / 2,
    }
    const isDraggingViewport =
      point.x >= viewportDisplayRect.x &&
      point.x <= viewportDisplayRect.x + viewportDisplayRect.width &&
      point.y >= viewportDisplayRect.y &&
      point.y <= viewportDisplayRect.y + viewportDisplayRect.height
    const dragOffset = isDraggingViewport ? { x: point.x - viewportCenter.x, y: point.y - viewportCenter.y } : { x: 0, y: 0 }
    setViewportFromClientPoint(event.clientX, event.clientY, dragOffset)

    const handlePointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault()
      setViewportFromClientPoint(moveEvent.clientX, moveEvent.clientY, dragOffset)
    }
    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })
  }

  return (
    <div className="comfy-minimap nodrag nopan" style={{ width: layout.width, height: layout.height }}>
      <div className="comfy-minimap-header" aria-hidden="true">
        <span />
        <span />
      </div>
      <svg
        ref={minimapRef}
        aria-label="Workflow minimap"
        className="comfy-minimap-map"
        height={layout.height}
        role="img"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        onPointerDown={handlePointerDown}
      >
        <rect className="comfy-minimap-bg" x={0} y={0} width={layout.width} height={layout.height} rx={14} />
        <g className="comfy-minimap-content">
          {layout.edgeLines.map((edge) => (
            <line
              key={edge.id}
              className="comfy-minimap-edge"
              x1={edge.x1}
              y1={edge.y1}
              x2={edge.x2}
              y2={edge.y2}
            />
          ))}
          {layout.nodeRects.map((node) => (
            <rect
              key={node.id}
              className="comfy-minimap-node"
              x={node.x}
              y={node.y}
              width={Math.max(3, node.width)}
              height={Math.max(3, node.height)}
              rx={1.5}
            />
          ))}
          <rect
            className="comfy-minimap-viewport"
            x={viewportDisplayRect.x}
            y={viewportDisplayRect.y}
            width={viewportDisplayRect.width}
            height={viewportDisplayRect.height}
            rx={1.5}
          />
        </g>
      </svg>
    </div>
  )
}

function functionInputSatisfied(value: PrimitiveInputValue | ResourceRef | undefined, resourcesById: Record<string, Resource>) {
  if (isResourceRefValue(value)) return Boolean(resourcesById[value.resourceId])
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'boolean') return true
  return value !== undefined && value !== null
}

const workflowSlotValueSeparator = '\u001F'

const workflowSlotValue = (input: FunctionInputDef) =>
  `${input.bind.nodeId ?? ''}${workflowSlotValueSeparator}${input.bind.path}`

const workflowSlotDisplay = (input: FunctionInputDef) => {
  const node = input.bind.nodeId ? `${input.bind.nodeId} · ${input.bind.nodeTitle ?? input.bind.nodeId}` : input.bind.nodeTitle
  return `${node ?? 'Workflow'} / ${input.bind.path} · ${input.type}`
}

const uniqueRunInputKey = (baseKey: string, inputs: FunctionInputDef[]) => {
  const normalized = baseKey.trim() || 'input'
  const existing = new Set(inputs.map((input) => input.key))
  if (!existing.has(normalized)) return normalized
  let suffix = 2
  while (existing.has(`${normalized}_${suffix}`)) suffix += 1
  return `${normalized}_${suffix}`
}

const inputValueForNewSlot = (input: FunctionInputDef): PrimitiveInputValue | undefined => {
  if (input.defaultValue !== undefined) return input.defaultValue
  if (input.type === 'text') return ''
  if (input.type === 'number') return 0
  if (input.type === 'boolean') return false
  return undefined
}

const workflowInputIdentity = (input: FunctionInputDef) =>
  [input.bind.nodeId ?? '', input.bind.nodeTitle ?? '', input.bind.path].join(workflowSlotValueSeparator)

const workflowInputTitleIdentity = (input: FunctionInputDef) =>
  [input.bind.nodeTitle ?? '', input.bind.path].join(workflowSlotValueSeparator)

const mergeEditedWorkflowInputs = (currentInputs: FunctionInputDef[], generatedInputs: FunctionInputDef[]) => {
  const usedKeys = new Set(currentInputs.map((input) => input.key))
  const usedBindings = new Set(currentInputs.flatMap((input) => [
    workflowInputIdentity(input),
    workflowInputTitleIdentity(input),
  ]))
  const nextInputs = [...currentInputs]

  for (const input of generatedInputs) {
    const titleIdentity = workflowInputTitleIdentity(input)
    if (usedBindings.has(workflowInputIdentity(input)) || usedBindings.has(titleIdentity)) continue
    if (usedKeys.has(input.key)) continue
    nextInputs.push(input)
    usedKeys.add(input.key)
    usedBindings.add(workflowInputIdentity(input))
    usedBindings.add(titleIdentity)
  }

  return nextInputs
}

const textPromptFromProviderMessages = (
  messages: Array<{ role: string; content: Array<{ type: string; content: string }> }>,
) => {
  const userMessage = messages.find((message) => message.role === 'user') ?? messages[0]
  const textPart = userMessage?.content.find((part) => part.type === 'text')
  return textPart?.content ?? ''
}

const providerImageContentParts = (functionDef: GenerationFunction) =>
  functionDef.inputs
    .filter((input) => input.type === 'image')
    .map((input) => ({ type: 'image_url' as const, content: input.key, detail: 'auto' as const }))

const blockModalContextMenu = (event: ReactMouseEvent) => {
  event.preventDefault()
  event.stopPropagation()
}

export function FunctionRunDialog({
  functionDef,
  values,
  runCount,
  resourcesById,
  canReplaceCurrent = false,
  onClose,
  onPickInput,
  onRun,
  onFunctionDefChange,
  onEditComfyWorkflow,
  onRunCountChange,
  onValuesChange,
}: {
  functionDef: GenerationFunction
  values: Record<string, PrimitiveInputValue | ResourceRef>
  runCount: number
  resourcesById: Record<string, Resource>
  canReplaceCurrent?: boolean
  onClose: () => void
  onPickInput: (input: { key: string; label: string; type: ResourceType }) => void
  onRun: (values: Record<string, PrimitiveInputValue | ResourceRef>, runCount: number, mode: FunctionRunMode) => void
  onFunctionDefChange?: (functionDef: GenerationFunction) => void
  onEditComfyWorkflow?: () => void
  onRunCountChange: (runCount: number) => void
  onValuesChange: (values: Record<string, PrimitiveInputValue | ResourceRef>) => void
}) {
  const [slotDraft, setSlotDraft] = useState('')
  const [previewResource, setPreviewResource] = useState<Resource | undefined>()
  const selectedResources = functionDef.inputs
    .map((input) => values[input.key])
    .filter(isResourceRefValue)
    .map((ref) => resourcesById[ref.resourceId])
    .filter((resource): resource is Resource => Boolean(resource))
  const missingRequiredInputs = functionDef.inputs.filter(
    (input) => input.required && !functionInputSatisfied(values[input.key], resourcesById),
  )
  const disabledRunTitle =
    missingRequiredInputs.length > 0
      ? `Missing ${missingRequiredInputs.map((input) => input.label || input.key).join(', ')}`
      : undefined
  const handleRun = (mode: FunctionRunMode) => {
    onRun(values, runCount, mode)
    onClose()
  }
  const canEditComfySlots = Boolean(onFunctionDefChange && functionDef.workflow.format === 'comfyui_api_json')
  const availableWorkflowSlots = useMemo(
    () => (canEditComfySlots ? workflowInputCandidates(functionDef.workflow.rawJson, functionDef.inputs) : []),
    [canEditComfySlots, functionDef.inputs, functionDef.workflow.rawJson],
  )
  const selectedSlotValue =
    availableWorkflowSlots.some((input) => workflowSlotValue(input) === slotDraft)
      ? slotDraft
      : (availableWorkflowSlots[0] ? workflowSlotValue(availableWorkflowSlots[0]) : '')

  const addWorkflowInputSlot = () => {
    if (!onFunctionDefChange || !selectedSlotValue) return
    const candidate = availableWorkflowSlots.find((input) => workflowSlotValue(input) === selectedSlotValue)
    if (!candidate) return
    const key = uniqueRunInputKey(candidate.key, functionDef.inputs)
    const input: FunctionInputDef = {
      ...candidate,
      key,
      bind: { ...candidate.bind },
      upload: candidate.upload ? { ...candidate.upload } : undefined,
    }
    onFunctionDefChange({
      ...functionDef,
      inputs: [...functionDef.inputs, input],
      updatedAt: new Date().toISOString(),
    })
    const value = inputValueForNewSlot(input)
    if (value !== undefined) onValuesChange({ ...values, [key]: value })
    setSlotDraft('')
  }

  const deleteWorkflowInputSlot = (inputKey: string) => {
    if (!onFunctionDefChange) return
    onFunctionDefChange({
      ...functionDef,
      inputs: functionDef.inputs.filter((input) => input.key !== inputKey),
      updatedAt: new Date().toISOString(),
    })
    const nextValues = { ...values }
    delete nextValues[inputKey]
    onValuesChange(nextValues)
  }

  const setResourceValue = (inputKey: string, resourceId: string, type: ResourceType) => {
    if (!resourceId) {
      const next = { ...values }
      delete next[inputKey]
      onValuesChange(next)
      return
    }
    onValuesChange({ ...values, [inputKey]: { resourceId, type } })
  }

  const setPrimitiveValue = (inputKey: string, value: PrimitiveInputValue) => {
    onValuesChange({ ...values, [inputKey]: value })
  }

  const updateRequestConfig = (patch: Parameters<typeof mergedRequestConfig>[1]) => {
    const request = mergedRequestConfig(functionDef.request, patch)
    onFunctionDefChange?.({
      ...functionDef,
      request,
      outputs: patch?.responseParse ? normalizeRequestOutputsForParse(functionDef.outputs, request.responseParse) : functionDef.outputs,
    })
  }

  const updateRequestHeader = (name: string, value: string) => {
    const currentHeaders = mergedRequestConfig(functionDef.request).headers ?? {}
    const nextHeaders = { ...currentHeaders }
    const trimmedValue = value.trim()
    if (trimmedValue) {
      nextHeaders[name] = value
    } else {
      delete nextHeaders[name]
    }
    updateRequestConfig({ headers: nextHeaders })
  }

  const updateOpenAiConfig = (patch: Parameters<typeof mergedOpenAILlmConfig>[1]) => {
    onFunctionDefChange?.({ ...functionDef, openai: mergedOpenAILlmConfig(functionDef.openai, patch) })
  }

  const updateGeminiConfig = (patch: Parameters<typeof mergedGeminiLlmConfig>[1]) => {
    onFunctionDefChange?.({ ...functionDef, gemini: mergedGeminiLlmConfig(functionDef.gemini, patch) })
  }

  const updateOpenAiImageConfig = (patch: Parameters<typeof mergedOpenAIImageConfig>[1]) => {
    onFunctionDefChange?.({ ...functionDef, openaiImage: mergedOpenAIImageConfig(functionDef.openaiImage, patch) })
  }

  const updateGeminiImageConfig = (patch: Parameters<typeof mergedGeminiImageConfig>[1]) => {
    onFunctionDefChange?.({ ...functionDef, geminiImage: mergedGeminiImageConfig(functionDef.geminiImage, patch) })
  }

  const updateOpenAiPrompt = (prompt: string) => {
    updateOpenAiConfig({
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', content: prompt }, ...providerImageContentParts(functionDef)],
        },
      ],
    })
  }

  const updateGeminiPrompt = (prompt: string) => {
    updateGeminiConfig({
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', content: prompt }, ...providerImageContentParts(functionDef)],
        },
      ],
    })
  }

  const requestConfig = isRequestFunction(functionDef) ? mergedRequestConfig(functionDef.request) : undefined
  const openAiConfig = isOpenAILlmFunction(functionDef) ? mergedOpenAILlmConfig(functionDef.openai) : undefined
  const geminiConfig = isGeminiLlmFunction(functionDef) ? mergedGeminiLlmConfig(functionDef.gemini) : undefined
  const openAiImageConfig = isOpenAIImageFunction(functionDef)
    ? mergedOpenAIImageConfig(functionDef.openaiImage)
    : undefined
  const geminiImageConfig = isGeminiImageFunction(functionDef)
    ? mergedGeminiImageConfig(functionDef.geminiImage)
    : undefined

  return (
    <div
      className="local-action-backdrop nodrag nopan"
      onContextMenu={blockModalContextMenu}
      onMouseDown={(event) => {
        event.stopPropagation()
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        aria-label={`Run ${functionDef.name}`}
        aria-modal="true"
        className="local-action-dialog function-run-dialog"
        role="dialog"
        onContextMenu={blockModalContextMenu}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>{functionDef.name}</h2>
            <span>{functionDef.category ?? 'Function'}</span>
          </div>
          <div className="function-run-header-actions">
            {onEditComfyWorkflow ? (
              <button
                type="button"
                className="function-run-edit-workflow"
                aria-label="Edit workflow in ComfyUI"
                onClick={onEditComfyWorkflow}
              >
                <Pencil size={15} />
                <span>Edit workflow</span>
              </button>
            ) : null}
            <button type="button" aria-label="Close function runner" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="function-run-gallery" aria-label="Selected function inputs">
          {selectedResources.length ? (
            selectedResources.map((resource, index) => (
              <div key={`${resource.id}-${index}`} className="function-run-gallery-item">
                <ResourcePreview resource={resource} />
                <span>{resource.name ?? resource.id}</span>
              </div>
            ))
          ) : (
            <p>No assets selected yet.</p>
          )}
        </div>
        {onFunctionDefChange && requestConfig ? (
          <div className="function-run-provider-fields" aria-label="Request settings">
            <label>
              <span>URL</span>
              <input
                aria-label="Request URL"
                value={requestConfig.url}
                onChange={(event) => updateRequestConfig({ url: event.target.value })}
              />
            </label>
            <label>
              <span>Method</span>
              <select
                aria-label="Request method"
                value={requestConfig.method}
                onChange={(event) => updateRequestConfig({ method: event.target.value })}
              >
                {requestMethods.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Response</span>
              <select
                aria-label="Request response parse"
                value={requestConfig.responseParse}
                onChange={(event) =>
                  updateRequestConfig({ responseParse: event.target.value as typeof requestConfig.responseParse })
                }
              >
                {requestParseModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Authorization</span>
              <input
                aria-label="Request Authorization header"
                autoComplete="off"
                value={requestConfig.headers.Authorization ?? ''}
                onChange={(event) => updateRequestHeader('Authorization', event.target.value)}
                placeholder="Bearer ..."
              />
            </label>
            <label className="function-run-provider-wide">
              <span>Body</span>
              <textarea
                aria-label="Request body"
                rows={3}
                value={requestConfig.body}
                onChange={(event) => updateRequestConfig({ body: event.target.value })}
              />
            </label>
          </div>
        ) : null}
        {onFunctionDefChange && openAiConfig ? (
          <div className="function-run-provider-fields" aria-label="OpenAI settings">
            <label>
              <span>API key</span>
              <input
                aria-label="OpenAI API key"
                type="password"
                value={openAiConfig.apiKey}
                onChange={(event) => updateOpenAiConfig({ apiKey: event.target.value })}
              />
            </label>
            <label>
              <span>Base URL</span>
              <input
                aria-label="OpenAI base URL"
                value={openAiConfig.baseUrl}
                onChange={(event) => updateOpenAiConfig({ baseUrl: event.target.value })}
              />
            </label>
            <label>
              <span>Model</span>
              <input
                aria-label="OpenAI model"
                value={openAiConfig.model}
                onChange={(event) => updateOpenAiConfig({ model: event.target.value })}
              />
            </label>
            <label className="function-run-provider-wide">
              <span>Prompt</span>
              <textarea
                aria-label="OpenAI prompt"
                rows={3}
                value={textPromptFromProviderMessages(openAiConfig.messages)}
                onChange={(event) => updateOpenAiPrompt(event.target.value)}
              />
            </label>
          </div>
        ) : null}
        {onFunctionDefChange && geminiConfig ? (
          <div className="function-run-provider-fields" aria-label="Gemini settings">
            <label>
              <span>API key</span>
              <input
                aria-label="Gemini API key"
                type="password"
                value={geminiConfig.apiKey}
                onChange={(event) => updateGeminiConfig({ apiKey: event.target.value })}
              />
            </label>
            <label>
              <span>Base URL</span>
              <input
                aria-label="Gemini base URL"
                value={geminiConfig.baseUrl}
                onChange={(event) => updateGeminiConfig({ baseUrl: event.target.value })}
              />
            </label>
            <label>
              <span>Model</span>
              <input
                aria-label="Gemini model"
                value={geminiConfig.model}
                onChange={(event) => updateGeminiConfig({ model: event.target.value })}
              />
            </label>
            <label className="function-run-provider-wide">
              <span>Prompt</span>
              <textarea
                aria-label="Gemini prompt"
                rows={3}
                value={textPromptFromProviderMessages(geminiConfig.messages)}
                onChange={(event) => updateGeminiPrompt(event.target.value)}
              />
            </label>
          </div>
        ) : null}
        {onFunctionDefChange && openAiImageConfig ? (
          <div className="function-run-provider-fields" aria-label="OpenAI image settings">
            <label>
              <span>API key</span>
              <input
                aria-label="OpenAI image API key"
                type="password"
                value={openAiImageConfig.apiKey}
                onChange={(event) => updateOpenAiImageConfig({ apiKey: event.target.value })}
              />
            </label>
            <label>
              <span>Base URL</span>
              <input
                aria-label="OpenAI image base URL"
                value={openAiImageConfig.baseUrl}
                onChange={(event) => updateOpenAiImageConfig({ baseUrl: event.target.value })}
              />
            </label>
            <label>
              <span>Model</span>
              <input
                aria-label="OpenAI image model"
                value={openAiImageConfig.model}
                onChange={(event) => updateOpenAiImageConfig({ model: event.target.value })}
              />
            </label>
          </div>
        ) : null}
        {onFunctionDefChange && geminiImageConfig ? (
          <div className="function-run-provider-fields" aria-label="Gemini image settings">
            <label>
              <span>API key</span>
              <input
                aria-label="Gemini image API key"
                type="password"
                value={geminiImageConfig.apiKey}
                onChange={(event) => updateGeminiImageConfig({ apiKey: event.target.value })}
              />
            </label>
            <label>
              <span>Base URL</span>
              <input
                aria-label="Gemini image base URL"
                value={geminiImageConfig.baseUrl}
                onChange={(event) => updateGeminiImageConfig({ baseUrl: event.target.value })}
              />
            </label>
            <label>
              <span>Model</span>
              <input
                aria-label="Gemini image model"
                value={geminiImageConfig.model}
                onChange={(event) => updateGeminiImageConfig({ model: event.target.value })}
              />
            </label>
          </div>
        ) : null}
        {canEditComfySlots ? (
          <div className="function-run-slot-editor" aria-label="ComfyUI input slots">
            <div>
              <strong>Input slots</strong>
              <span>Expose workflow fields only when they should be changed before reuse.</span>
            </div>
            <select
              aria-label="Workflow input slot"
              value={selectedSlotValue}
              disabled={availableWorkflowSlots.length === 0}
              onChange={(event) => setSlotDraft(event.target.value)}
            >
              {availableWorkflowSlots.length > 0 ? (
                availableWorkflowSlots.map((input) => (
                  <option key={workflowSlotValue(input)} value={workflowSlotValue(input)}>
                    {workflowSlotDisplay(input)}
                  </option>
                ))
              ) : (
                <option value="">No hidden workflow inputs</option>
              )}
            </select>
            <button type="button" aria-label="Add input slot" disabled={!selectedSlotValue} onClick={addWorkflowInputSlot}>
              <Plus size={15} />
              Add slot
            </button>
          </div>
        ) : null}
        <div className="function-run-fields">
          {functionDef.inputs.map((input) => {
            const value = values[input.key]
            const resourceValue = isResourceRefValue(value) ? value : undefined
            const selectedResource = resourceValue ? resourcesById[resourceValue.resourceId] : undefined
            const matchingResources = Object.values(resourcesById).filter((resource) => resource.type === input.type)
            const primitiveValue = isResourceRefValue(value) ? '' : value
            const inputLabel = input.label || input.key
            const workflowSlotExists =
              !canEditComfySlots || workflowInputBindingExists(functionDef.workflow.rawJson, input)
            return (
              <div
                key={input.key}
                className={`function-run-field${workflowSlotExists ? '' : ' function-run-field-invalid'}`}
                aria-invalid={workflowSlotExists ? undefined : true}
              >
                <div className="function-run-field-heading">
                  <span>
                    {inputLabel}
                    {input.required ? <strong>Required</strong> : null}
                  </span>
                  {canEditComfySlots ? (
                    <button
                      type="button"
                      className="function-run-delete-slot"
                      aria-label={`Delete input slot ${input.key}`}
                      title="Delete input slot"
                      onClick={() => deleteWorkflowInputSlot(input.key)}
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
                {!workflowSlotExists ? <span className="field-error">Workflow slot no longer exists</span> : null}
                <div className="function-run-slot-row">
                  <select
                    aria-label={`Asset input ${inputLabel}`}
                    value={resourceValue?.resourceId ?? ''}
                    onChange={(event) => setResourceValue(input.key, event.target.value, input.type)}
                  >
                    <option value="">Manual / empty</option>
                    {matchingResources.map((resource) => (
                      <option key={resource.id} value={resource.id}>
                        {resource.name ?? resource.id}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={`Pick asset for ${inputLabel}`}
                    className="function-run-pick-button"
                    title={`Pick ${inputLabel} from canvas`}
                    onClick={() => onPickInput({ key: input.key, label: inputLabel, type: input.type })}
                  >
                    <MousePointer2 aria-hidden="true" size={15} />
                  </button>
                </div>
                {selectedResource && isMediaResourceType(selectedResource.type) ? (
                  <button
                    type="button"
                    className="function-run-input-preview"
                    aria-label={`Preview ${inputLabel} input`}
                    onClick={() => setPreviewResource(selectedResource)}
                  >
                    <ResourcePreview resource={selectedResource} />
                  </button>
                ) : null}
                {(input.type === 'number' || input.type === 'text' || input.type === 'boolean') && !resourceValue ? (
                  <span className="function-run-manual-label">Manual value</span>
                ) : null}
                {input.type === 'number' ? (
                  <input
                    aria-label={`Manual input ${inputLabel}`}
                    disabled={Boolean(resourceValue)}
                    inputMode="decimal"
                    type="number"
                    value={Number(primitiveValue ?? 0)}
                    onChange={(event) => setPrimitiveValue(input.key, Number(event.target.value))}
                  />
                ) : input.type === 'text' ? (
                  <textarea
                    aria-label={`Manual input ${inputLabel}`}
                    disabled={Boolean(resourceValue)}
                    rows={3}
                    value={String(primitiveValue ?? '')}
                    onChange={(event) => setPrimitiveValue(input.key, event.target.value)}
                  />
                ) : input.type === 'boolean' ? (
                  <label className="function-run-boolean-input">
                    <input
                      aria-label={`Manual input ${inputLabel}`}
                      checked={primitiveValue === true}
                      disabled={Boolean(resourceValue)}
                      type="checkbox"
                      onChange={(event) => setPrimitiveValue(input.key, event.target.checked)}
                    />
                    <span>{primitiveValue === true ? 'true' : 'false'}</span>
                  </label>
                ) : null}
              </div>
            )
          })}
        </div>
        <div className="local-action-footer">
          <label className="function-run-count">
            <span>Runs</span>
            <input
              aria-label="Function run count"
              max={99}
              min={1}
              type="number"
              value={runCount}
              onChange={(event) => onRunCountChange(Math.max(1, Math.min(99, Number(event.target.value) || 1)))}
            />
          </label>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          {canReplaceCurrent ? (
            <>
              <button
                type="button"
                aria-label="Run and replace current output"
                disabled={missingRequiredInputs.length > 0}
                title={disabledRunTitle}
                onClick={() => handleRun('replace')}
              >
                Run & Replace
              </button>
              <button
                type="button"
                aria-label="Run and create new output node"
                className="primary"
                disabled={missingRequiredInputs.length > 0}
                title={disabledRunTitle}
                onClick={() => handleRun('new')}
              >
                Run New Node
              </button>
            </>
          ) : (
            <button
              type="button"
              aria-label="Run function from popup"
              className="primary"
              disabled={missingRequiredInputs.length > 0}
              title={disabledRunTitle}
              onClick={() => handleRun('new')}
            >
              Run
            </button>
          )}
        </div>
        <FullResourcePreviewModal
          resource={previewResource}
          resources={previewResource ? [previewResource] : []}
          onClose={() => setPreviewResource(undefined)}
        />
      </section>
    </div>
  )
}

function TemporaryComfyWorkflowDialog({
  endpoints,
  endpointId,
  onEndpointChange,
  onEdit,
  onClose,
}: {
  endpoints: ComfyEndpointConfig[]
  endpointId?: string
  onEndpointChange: (endpointId: string) => void
  onEdit: () => void
  onClose: () => void
}) {
  const enabledEndpoints = endpoints.filter((endpoint) => endpoint.enabled !== false)
  const selectedEndpoint = enabledEndpoints.find((endpoint) => endpoint.id === endpointId) ?? enabledEndpoints[0]

  return (
    <div
      className="local-action-backdrop nodrag nopan"
      onContextMenu={blockModalContextMenu}
      onMouseDown={(event) => {
        event.stopPropagation()
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        aria-label="ComfyUI workflow runner"
        aria-modal="true"
        className="local-action-dialog temporary-comfy-runner"
        role="dialog"
        onContextMenu={blockModalContextMenu}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>ComfyUI Workflow</h2>
            <span>Build a one-off workflow, then run it from selected inputs</span>
          </div>
          <button type="button" aria-label="Close ComfyUI workflow runner" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <label className="temporary-comfy-endpoint">
          <span>ComfyUI server</span>
          <select
            aria-label="ComfyUI server for temporary workflow"
            value={selectedEndpoint?.id ?? ''}
            onChange={(event) => onEndpointChange(event.target.value)}
          >
            {enabledEndpoints.length ? (
              enabledEndpoints.map((endpoint) => (
                <option key={endpoint.id} value={endpoint.id}>
                  {endpoint.name} - {endpoint.baseUrl}
                </option>
              ))
            ) : (
              <option value="">No ComfyUI server configured</option>
            )}
          </select>
        </label>
        <div className="temporary-comfy-panel">
          <strong>No workflow saved yet</strong>
          <span>Open ComfyUI, create or import the workflow, then save it back here.</span>
        </div>
        <div className="local-action-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" aria-label="Edit temporary workflow in ComfyUI" className="primary" disabled={!selectedEndpoint} onClick={onEdit}>
            Edit in ComfyUI
          </button>
        </div>
      </section>
    </div>
  )
}

function FunctionInputPickStrip({
  pickMode,
  compatibleCount,
  onCancel,
}: {
  pickMode: FunctionInputPickMode
  compatibleCount: number
  onCancel: () => void
}) {
  return (
    <div className="function-input-pick-strip nodrag nopan" aria-label="Asset pick mode" role="status">
      <MousePointer2 aria-hidden="true" size={18} />
      <div>
        <strong>Selecting: {pickMode.inputLabel}</strong>
        <span>
          {pickMode.inputType}
          {' · '}
          {compatibleCount} compatible
        </span>
      </div>
      <button type="button" aria-label="Cancel asset pick" onClick={onCancel}>
        <X aria-hidden="true" size={16} />
      </button>
    </div>
  )
}

function CanvasSurface() {
  const project = useProjectStore((state) => state.project)
  const selectedNodeId = useProjectStore((state) => state.selectedNodeId)
  const selectedNodeIds = useProjectStore((state) => state.selectedNodeIds)
  const selectNode = useProjectStore((state) => state.selectNode)
  const selectNodes = useProjectStore((state) => state.selectNodes)
  const runFunctionNodeWithComfy = useProjectStore((state) => state.runFunctionNodeWithComfy)
  const runFunctionAtPosition = useProjectStore((state) => state.runFunctionAtPosition)
  const runTemporaryFunctionAtPosition = useProjectStore((state) => state.runTemporaryFunctionAtPosition)
  const rerunResultNode = useProjectStore((state) => state.rerunResultNode)
  const cancelResultRun = useProjectStore((state) => state.cancelResultRun)
  const addTextResourceAtPosition = useProjectStore((state) => state.addTextResourceAtPosition)
  const addEmptyResourceAtPosition = useProjectStore((state) => state.addEmptyResourceAtPosition)
  const addMediaResourceAtPosition = useProjectStore((state) => state.addMediaResourceAtPosition)
  const updateTextResourceValue = useProjectStore((state) => state.updateTextResourceValue)
  const updateNumberResourceValue = useProjectStore((state) => state.updateNumberResourceValue)
  const replaceResourceMedia = useProjectStore((state) => state.replaceResourceMedia)
  const updateFunctionNodeRunCount = useProjectStore((state) => state.updateFunctionNodeRunCount)
  const updateFunctionNodeInputValue = useProjectStore((state) => state.updateFunctionNodeInputValue)
  const updateFunctionNodeOpenAiConfig = useProjectStore((state) => state.updateFunctionNodeOpenAiConfig)
  const updateFunctionNodeGeminiConfig = useProjectStore((state) => state.updateFunctionNodeGeminiConfig)
  const updateFunctionNodeOpenAiImageConfig = useProjectStore((state) => state.updateFunctionNodeOpenAiImageConfig)
  const updateFunctionNodeGeminiImageConfig = useProjectStore((state) => state.updateFunctionNodeGeminiImageConfig)
  const updateFunctionNodeRequestConfig = useProjectStore((state) => state.updateFunctionNodeRequestConfig)
  const updateFunctionNodeRequestOutputs = useProjectStore((state) => state.updateFunctionNodeRequestOutputs)
  const ensureEditableFunctionForNode = useProjectStore((state) => state.ensureEditableFunctionForNode)
  const addFunctionFromWorkflow = useProjectStore((state) => state.addFunctionFromWorkflow)
  const addRequestFunction = useProjectStore((state) => state.addRequestFunction)
  const addOpenAILlmFunction = useProjectStore((state) => state.addOpenAILlmFunction)
  const addGeminiLlmFunction = useProjectStore((state) => state.addGeminiLlmFunction)
  const updateFunction = useProjectStore((state) => state.updateFunction)
  const connectNodes = useProjectStore((state) => state.connectNodes)
  const deleteEdges = useProjectStore((state) => state.deleteEdges)
  const updateNodePosition = useProjectStore((state) => state.updateNodePosition)
  const updateNodePositions = useProjectStore((state) => state.updateNodePositions)
  const updateNodeSize = useProjectStore((state) => state.updateNodeSize)
  const renameNode = useProjectStore((state) => state.renameNode)
  const deleteNode = useProjectStore((state) => state.deleteNode)
  const deleteNodes = useProjectStore((state) => state.deleteNodes)
  const deleteSelectedNode = useProjectStore((state) => state.deleteSelectedNode)
  const undoLastProjectChange = useProjectStore((state) => state.undoLastProjectChange)
  const redoProjectChange = useProjectStore((state) => state.redoProjectChange)
  const groupSelectedNodes = useProjectStore((state) => state.groupSelectedNodes)
  const ungroupNode = useProjectStore((state) => state.ungroupNode)
  const saveTemplateFromSelection = useProjectStore((state) => state.saveTemplateFromSelection)
  const instantiateTemplate = useProjectStore((state) => state.instantiateTemplate)
  const duplicateSelectedNode = useProjectStore((state) => state.duplicateSelectedNode)
  const duplicateNodes = useProjectStore((state) => state.duplicateNodes)
  const { screenToFlowPosition, setCenter } = useReactFlow()
  const [addMenu, setAddMenu] = useState<AddNodeMenuState | null>(null)
  const [quickToolbar, setQuickToolbar] = useState<QuickToolbarState>()
  const [functionNodeMenu, setFunctionNodeMenu] = useState<FunctionNodeMenuState>()
  const [groupNodeMenu, setGroupNodeMenu] = useState<GroupNodeMenuState>()
  const [functionEditor, setFunctionEditor] = useState<FunctionEditorState>()
  const [functionRunDialog, setFunctionRunDialog] = useState<FunctionRunDialogState>()
  const [temporaryComfyWorkflow, setTemporaryComfyWorkflow] = useState<TemporaryComfyWorkflowState>()
  const [inputPickMode, setInputPickMode] = useState<FunctionInputPickMode>()
  const [comparePair, setComparePair] = useState<CompareImagePair | null>(null)
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([])
  const [traceHighlightNodeIds, setTraceHighlightNodeIds] = useState<string[]>([])
  const [selectedNodeRecencyById, setSelectedNodeRecencyById] = useState<Record<string, number>>({})
  const [addMenuQuery, setAddMenuQuery] = useState('')
  const addMenuRef = useRef<HTMLDivElement | null>(null)
  const quickToolbarRef = useRef<HTMLDivElement | null>(null)
  const functionNodeMenuRef = useRef<HTMLDivElement | null>(null)
  const groupNodeMenuRef = useRef<HTMLDivElement | null>(null)
  const addMenuSearchRef = useRef<HTMLInputElement | null>(null)
  const canvasRef = useRef<HTMLElement | null>(null)
  const connectionStart = useRef<ConnectionStartState | null>(null)
  const copiedNodeIds = useRef<string[]>([])
  const suppressNextNodeClick = useRef(false)
  const modifierKeys = useRef({ alt: false, ctrl: false, shift: false })
  const selectionBoxActive = useRef(false)
  const selectionBoxNodeIds = useRef<string[]>([])
  const selectionRecencyCounter = useRef(0)
  const recordNodeSelectionRecency = useCallback((nodeIds: string[]) => {
    const ids = nodeIds.filter(Boolean)
    if (ids.length === 0) return
    setSelectedNodeRecencyById((current) => {
      const next = { ...current }
      for (const nodeId of ids) {
        selectionRecencyCounter.current += 1
        next[nodeId] = selectionRecencyCounter.current
      }
      return next
    })
  }, [])
  const activeSelectedNodeIds = useMemo(
    () => (selectedNodeIds.length ? selectedNodeIds : selectedNodeId ? [selectedNodeId] : []),
    [selectedNodeId, selectedNodeIds],
  )
  const nodeReferenceMap = useMemo(() => buildNodeReferenceMap(project), [project])
  const flowNodeLayoutContext = useMemo<ResourceNodeLayoutContext>(
    () => ({
      functionsById: project.functions,
      resourcesById: project.resources,
      tasksById: project.tasks,
      nodeReferenceCountsById: Object.fromEntries(
        Object.entries(nodeReferenceMap).map(([nodeId, references]) => [nodeId, references.length]),
      ),
    }),
    [nodeReferenceMap, project.functions, project.resources, project.tasks],
  )
  const focusCanvasNode = useCallback(
    (nodeId: string) => {
      selectNode(nodeId)
      window.dispatchEvent(new CustomEvent('infinity-focus-node', { detail: { nodeId } }))
    },
    [selectNode],
  )

  const closeFunctionRunFloatingMenus = useCallback(() => {
    const reset = functionRunFloatingMenuReset()
    setAddMenu(reset.addMenu)
    setQuickToolbar(reset.quickToolbar)
    setFunctionNodeMenu(reset.functionNodeMenu)
    setGroupNodeMenu(reset.groupNodeMenu)
    setInputPickMode(reset.inputPickMode)
  }, [])

  const clearCanvasSelection = useCallback(() => {
    selectNode(undefined)
    setSelectedEdgeIds([])
    setTraceHighlightNodeIds([])
    setAddMenu(null)
    setQuickToolbar(undefined)
    setFunctionNodeMenu(undefined)
    setGroupNodeMenu(undefined)
  }, [selectNode])

  const openFunctionRunDialog = useCallback(
    (dialog: FunctionRunDialogState) => {
      closeFunctionRunFloatingMenus()
      setFunctionRunDialog(dialog)
    },
    [closeFunctionRunFloatingMenus],
  )

  const inputPickableRefs = useMemo(
    () => (inputPickMode ? pickableResourceRefsForInput(project, inputPickMode.inputType) : []),
    [inputPickMode, project],
  )
  const inputPickableResourceIds = useMemo(
    () => new Set(inputPickableRefs.map((ref) => ref.resourceId)),
    [inputPickableRefs],
  )
  const visibleNodes = useMemo(() => visibleCanvasNodes(project.canvas.nodes), [project.canvas.nodes])
  const visibleEdges = useMemo(() => visibleFlowEdges(buildCanvasFlowEdges(project), visibleNodes), [project, visibleNodes])
  const selectionHighlights = useMemo(
    () => buildCanvasSelectionHighlights(visibleNodes, visibleEdges, activeSelectedNodeIds, selectedEdgeIds, traceHighlightNodeIds),
    [activeSelectedNodeIds, selectedEdgeIds, traceHighlightNodeIds, visibleEdges, visibleNodes],
  )
  const zIndexByNodeId = useMemo(
    () => buildCanvasNodeZIndexMap(visibleNodes, project.resources, selectedNodeRecencyById),
    [project.resources, selectedNodeRecencyById, visibleNodes],
  )

  const openFunctionRunForResource = useCallback(
    (resourceId: string) => {
      const resource = project.resources[resourceId]
      const taskId = resource?.source.taskId
      const task = taskId ? project.tasks[taskId] : undefined
      const functionId = task?.functionId ?? resource?.metadata?.workflowFunctionId
      const functionDef = functionId
        ? project.functions[functionId] ?? task?.functionSnapshot ?? resource?.metadata?.functionSnapshot
        : undefined
      if (!resource || !task || !functionId || !functionDef) return

      const sourceNode = project.canvas.nodes.find(
        (node) => node.type === 'resource' && node.data.resourceId === resourceId,
      )
      const sourceWidth = sourceNode ? Number(flowNodeStyle(sourceNode, flowNodeLayoutContext).width) : DEFAULT_ASSET_NODE_WIDTH
      openFunctionRunDialog({
        functionId,
        temporaryFunction: project.functions[functionId] ? undefined : functionDef,
        inputValues: functionRunInputsFromTask(task),
        runCount: Number((task.paramsSnapshot as { runCount?: unknown } | undefined)?.runCount ?? functionDef.runtimeDefaults?.runCount ?? 1),
        position: sourceNode
          ? {
              x: sourceNode.position.x + (Number.isFinite(sourceWidth) ? sourceWidth : DEFAULT_ASSET_NODE_WIDTH) + MENU_NODE_GAP,
              y: sourceNode.position.y,
            }
          : { x: 0, y: 0 },
        replaceTarget: {
          resourceId,
          outputKey: resource.source.kind === 'function_output' ? resource.source.outputKey : undefined,
        },
      })
    },
    [flowNodeLayoutContext, openFunctionRunDialog, project.canvas.nodes, project.functions, project.resources, project.tasks],
  )

  useEffect(() => {
    const focusNode = (event: Event) => {
      const nodeId = (event as CustomEvent<{ nodeId?: string }>).detail?.nodeId
      if (!nodeId) return
      const targetNode = project.canvas.nodes.find((node) => node.id === nodeId)
      if (!targetNode) return
      const storedSize = targetNode.data.size as { width?: unknown; height?: unknown } | undefined
      const width = Number(storedSize?.width)
      const height = Number(storedSize?.height)
      const nodeWidth = Number.isFinite(width) ? width : 320
      const nodeHeight = Number.isFinite(height) ? height : 240

      setCenter(targetNode.position.x + nodeWidth / 2, targetNode.position.y + nodeHeight / 2, {
        zoom: 0.9,
        duration: 350,
      })
    }

    window.addEventListener('infinity-focus-node', focusNode)
    return () => window.removeEventListener('infinity-focus-node', focusNode)
  }, [project.canvas.nodes, setCenter])

  const flowNodes = useMemo<Node[]>(
    () =>
      visibleNodes.map((node) => ({
        id: node.id,
        type: node.type,
        position: node.position,
        selected: activeSelectedNodeIds.includes(node.id),
        zIndex: zIndexByNodeId.get(node.id),
        className: mergeClassNames(
          selectionHighlights.nodeClassNamesById.get(node.id),
          inputPickMode && node.type === 'resource' && typeof node.data.resourceId === 'string'
            ? inputPickableResourceIds.has(node.data.resourceId)
              ? 'asset-pickable'
              : 'asset-pick-incompatible'
            : undefined,
        ),
        style: flowNodeStyle(node, flowNodeLayoutContext),
        data: {
          ...node.data,
          nodeReferences: nodeReferenceMap[node.id] ?? [],
          resourcesById: project.resources,
          functionsById: project.functions,
          tasksById: project.tasks,
          onFocusReferenceNode: focusCanvasNode,
          onRunFunction: (nodeId: string) => {
            void runFunctionNodeWithComfy(nodeId)
          },
          onRerunResultNode: (nodeId: string) => {
            void rerunResultNode(nodeId)
          },
          onCancelResultRun: cancelResultRun,
          onUpdateFunctionRunCount: updateFunctionNodeRunCount,
          onUpdateFunctionInputValue: updateFunctionNodeInputValue,
          onUpdateOpenAiConfig: updateFunctionNodeOpenAiConfig,
          onUpdateGeminiConfig: updateFunctionNodeGeminiConfig,
          onUpdateOpenAiImageConfig: updateFunctionNodeOpenAiImageConfig,
          onUpdateGeminiImageConfig: updateFunctionNodeGeminiImageConfig,
          onUpdateRequestConfig: updateFunctionNodeRequestConfig,
          onUpdateRequestOutputs: updateFunctionNodeRequestOutputs,
          onDeleteNode: deleteNode,
          onRenameNode: renameNode,
          onUpdateTextResourceValue: updateTextResourceValue,
          onUpdateNumberResourceValue: updateNumberResourceValue,
          onReplaceResourceMedia: replaceResourceMedia,
          onOpenFunctionRunForResource: openFunctionRunForResource,
          onResizeNode: updateNodeSize,
        },
      })),
    [
      deleteNode,
      focusCanvasNode,
      flowNodeLayoutContext,
      zIndexByNodeId,
      nodeReferenceMap,
      openFunctionRunForResource,
      inputPickMode,
      inputPickableResourceIds,
      project.functions,
      project.resources,
      project.tasks,
      renameNode,
      replaceResourceMedia,
      rerunResultNode,
      runFunctionNodeWithComfy,
      activeSelectedNodeIds,
      cancelResultRun,
      updateFunctionNodeInputValue,
      updateFunctionNodeRunCount,
      updateFunctionNodeOpenAiConfig,
      updateFunctionNodeGeminiConfig,
      updateFunctionNodeOpenAiImageConfig,
      updateFunctionNodeGeminiImageConfig,
      updateFunctionNodeRequestConfig,
      updateFunctionNodeRequestOutputs,
      updateNodeSize,
      updateNumberResourceValue,
      updateTextResourceValue,
      selectionHighlights.nodeClassNamesById,
      visibleNodes,
    ],
  )

  const flowEdges = useMemo<Edge[]>(() => {
    return visibleEdges.map((edge) => ({
      ...edge,
      className: mergeClassNames(edge.className, selectionHighlights.edgeClassNamesById.get(edge.id)),
      selected: selectedEdgeIds.includes(edge.id),
    }))
  }, [selectedEdgeIds, selectionHighlights.edgeClassNamesById, visibleEdges])

  const selectedComparePair = useMemo<CompareImagePair | undefined>(() => {
    if (activeSelectedNodeIds.length !== 2) return undefined
    const [leftNodeId, rightNodeId] = activeSelectedNodeIds
    const leftNode = project.canvas.nodes.find((node) => node.id === leftNodeId)
    const rightNode = project.canvas.nodes.find((node) => node.id === rightNodeId)
    const left = resultImageResource(leftNode, project.resources)
    const right = resultImageResource(rightNode, project.resources)
    return left && right ? { left, right } : undefined
  }, [activeSelectedNodeIds, project.canvas.nodes, project.resources])

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges)

  useEffect(() => {
    setNodes(flowNodes)
  }, [flowNodes, setNodes])

  useEffect(() => {
    setEdges((current) => (sameFlowEdgesForSync(current, flowEdges) ? current : flowEdges))
  }, [flowEdges, setEdges])

  const clipboardPastePosition = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    return screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  }, [screenToFlowPosition])

  const pasteClipboardContent = useCallback(async () => {
    const point = clipboardPastePosition()

    if (navigator.clipboard?.read) {
      try {
        const items = await navigator.clipboard.read()
        for (const item of items) {
          const mediaType = item.types.find(
            (type) => type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/'),
          )
          if (!mediaType) continue

          const blob = await item.getType(mediaType)
          const extension = mediaType.split('/')[1]?.split('+')[0] || 'bin'
          const file = new File([blob], `clipboard.${extension}`, { type: mediaType })
          const result = await readFileAsMediaResource(file)
          if (result) {
            addMediaResourceAtPosition(result.type, result.media.filename ?? file.name, result.media, point)
            setAddMenu(null)
            return
          }
        }
      } catch {
        // Some browsers require permissions for binary clipboard reads; fall back to text below.
      }
    }

    const clipboardText = navigator.clipboard?.readText ? await navigator.clipboard.readText().catch(() => '') : ''
    const text = clipboardText.trim()
    if (text) {
      addTextResourceAtPosition('Prompt', text, point)
      setAddMenu(null)
    }
  }, [addMediaResourceAtPosition, addTextResourceAtPosition, clipboardPastePosition])

  const selectedDomNodeIds = useCallback(() =>
    [...document.querySelectorAll<HTMLElement>('.workspace-canvas .react-flow__node.selected')]
      .map((node) => node.getAttribute('data-id'))
      .filter((nodeId): nodeId is string => Boolean(nodeId)), [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      modifierKeys.current = { alt: event.altKey, ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey }
      if (shouldIgnoreCanvasShortcut(event)) return

      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        undoLastProjectChange()
        setSelectedEdgeIds([])
        setTraceHighlightNodeIds([])
        return
      }

      if (((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'z') || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y')) {
        event.preventDefault()
        redoProjectChange()
        setSelectedEdgeIds([])
        setTraceHighlightNodeIds([])
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        const domNodeIds = selectedDomNodeIds()
        if (domNodeIds.length > 1 || (domNodeIds.length > 0 && activeSelectedNodeIds.length === 0)) {
          deleteNodes(domNodeIds)
        } else if (selectedEdgeIds.length > 0) {
          deleteEdges(selectedEdgeIds)
          setSelectedEdgeIds([])
          setTraceHighlightNodeIds([])
        } else {
          deleteSelectedNode()
        }
      }
      if (event.key === 'Escape') {
        if (inputPickMode) {
          event.preventDefault()
          setInputPickMode(undefined)
          return
        }
        setAddMenu(null)
        setQuickToolbar(undefined)
        setFunctionNodeMenu(undefined)
        setGroupNodeMenu(undefined)
        setFunctionRunDialog(undefined)
        selectNode(undefined)
        setSelectedEdgeIds([])
        setTraceHighlightNodeIds([])
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
        const nodeIds = activeSelectedNodeIds.length > 0 ? activeSelectedNodeIds : selectedDomNodeIds()
        if (nodeIds.length > 0) {
          event.preventDefault()
          copiedNodeIds.current = [...nodeIds]
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        if (copiedNodeIds.current.length > 0) {
          duplicateNodes(copiedNodeIds.current)
        } else {
          void pasteClipboardContent()
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        duplicateSelectedNode()
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      modifierKeys.current = { alt: event.altKey, ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
    }
  }, [
    activeSelectedNodeIds,
    deleteEdges,
    deleteNode,
    deleteNodes,
    deleteSelectedNode,
    duplicateNodes,
    duplicateSelectedNode,
    inputPickMode,
    pasteClipboardContent,
    selectNode,
    selectedDomNodeIds,
    selectedEdgeIds,
    redoProjectChange,
    undoLastProjectChange,
  ])

  const handleConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return
    connectNodes(connection.source, connection.target, {
      sourceHandleId: connection.sourceHandle,
      targetInputKey: inputKeyFromHandle(connection.targetHandle),
    })
  }

  const selectionModeFromEvent = (event: MouseEvent | ReactMouseEvent) => {
    if (event.altKey) return 'remove' as const
    if (event.shiftKey) return 'add' as const
    return 'replace' as const
  }

  const handleSelectionChange = ({ nodes: changedNodes, edges: changedEdges }: { nodes: Node[]; edges: Edge[] }) => {
    const changedEdgeIds = changedEdges.map((edge) => edge.id)
    setSelectedEdgeIds((current) => selectedEdgeIdsFromSelectionChange(current, changedEdgeIds))
    if (changedEdgeIds.length > 0) {
      selectNode(undefined)
      setTraceHighlightNodeIds([])
    }
    if (!selectionBoxActive.current) return
    selectionBoxNodeIds.current = changedNodes.map((node) => node.id)
  }

  const sourceResourceRefs = useCallback((sourceNodeId: string | undefined, sourceHandleId?: string | null): ResourceRef[] => {
    if (!sourceNodeId) return []
    const node = project.canvas.nodes.find((item) => item.id === sourceNodeId)
    if (!node) return []

    const preferredResourceId = resourceIdFromHandle(sourceHandleId)
    if (node.type === 'resource' && typeof node.data.resourceId === 'string') {
      const resourceId = String(node.data.resourceId)
      if (preferredResourceId && preferredResourceId !== resourceId) return []
      const resource = project.resources[resourceId]
      return resource ? [{ resourceId, type: resource.type }] : []
    }

    if (node.type !== 'result_group' || !Array.isArray(node.data.resources)) return []
    return node.data.resources
      .map((resource) => {
        if (typeof resource !== 'object' || resource === null) return undefined
        const resourceId = 'resourceId' in resource ? String((resource as { resourceId: unknown }).resourceId) : undefined
        if (!resourceId || (preferredResourceId && preferredResourceId !== resourceId)) return undefined
        const typedResource = project.resources[resourceId]
        return typedResource ? { resourceId, type: typedResource.type } : undefined
      })
      .filter((resource): resource is ResourceRef => Boolean(resource))
  }, [project.canvas.nodes, project.resources])

  const selectedQuickSourceNodeId = useMemo(() => {
    if (activeSelectedNodeIds.length !== 1) return undefined
    const nodeId = activeSelectedNodeIds[0]
    const node = project.canvas.nodes.find((item) => item.id === nodeId)
    return node?.type === 'resource' || node?.type === 'result_group' ? node.id : undefined
  }, [activeSelectedNodeIds, project.canvas.nodes])

  const quickActionsForSourceNode = useCallback((sourceNodeId: string | undefined) => {
    if (!sourceNodeId) return []
    const refs = sourceResourceRefs(sourceNodeId)
    if (refs.length === 0) return []

    return Object.values(project.functions).filter((fn) => {
      if (fn.workflow.format !== 'local_transform') return false
      const requiredInputs = fn.inputs.filter((input) => input.required)
      return requiredInputs.length > 0 && requiredInputs.every((input) => refs.some((ref) => ref.type === input.type))
    })
  }, [project.functions, sourceResourceRefs])

  const quickToolbarSourceNodeId = quickToolbar?.sourceNodeId
  const localQuickActions = useMemo(
    () => quickActionsForSourceNode(quickToolbarSourceNodeId),
    [quickActionsForSourceNode, quickToolbarSourceNodeId],
  )

  useEffect(() => {
    setQuickToolbar((current) => {
      if (!current) return current
      return activeSelectedNodeIds.length === 1 && activeSelectedNodeIds[0] === current.sourceNodeId ? current : undefined
    })
  }, [activeSelectedNodeIds])

  useEffect(() => {
    setFunctionNodeMenu((current) => {
      if (!current) return current
      return activeSelectedNodeIds.length === 1 && activeSelectedNodeIds[0] === current.nodeId ? current : undefined
    })
  }, [activeSelectedNodeIds])

  useEffect(() => {
    setTraceHighlightNodeIds((current) => {
      if (current.length === 0) return current
      return current.some((nodeId) => activeSelectedNodeIds.includes(nodeId)) ? current : []
    })
  }, [activeSelectedNodeIds])

  useEffect(() => {
    if (quickToolbar && localQuickActions.length === 0) setQuickToolbar(undefined)
  }, [localQuickActions.length, quickToolbar])

  useLayoutEffect(() => {
    if (!quickToolbar) return

    const toolbar = quickToolbarRef.current
    if (!toolbar) return

    const margin = 8
    const rect = toolbar.getBoundingClientRect()
    const left = Math.min(Math.max(quickToolbar.left, margin), Math.max(margin, window.innerWidth - rect.width - margin))
    const top = Math.min(Math.max(quickToolbar.top, margin), Math.max(margin, window.innerHeight - rect.height - margin))

    toolbar.style.left = `${left}px`
    toolbar.style.top = `${top}px`
  }, [localQuickActions.length, quickToolbar])

  useLayoutEffect(() => {
    if (!functionNodeMenu) return

    const menu = functionNodeMenuRef.current
    if (!menu) return

    const margin = 8
    const rect = menu.getBoundingClientRect()
    const left = Math.min(Math.max(functionNodeMenu.left, margin), Math.max(margin, window.innerWidth - rect.width - margin))
    const top = Math.min(Math.max(functionNodeMenu.top, margin), Math.max(margin, window.innerHeight - rect.height - margin))

    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
  }, [functionNodeMenu])

  useLayoutEffect(() => {
    if (!groupNodeMenu) return

    const menu = groupNodeMenuRef.current
    if (!menu) return

    const margin = 8
    const rect = menu.getBoundingClientRect()
    const left = Math.min(Math.max(groupNodeMenu.left, margin), Math.max(margin, window.innerWidth - rect.width - margin))
    const top = Math.min(Math.max(groupNodeMenu.top, margin), Math.max(margin, window.innerHeight - rect.height - margin))

    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
  }, [groupNodeMenu])

  const connectionResourceType = (sourceNodeId: string | undefined, sourceHandleId?: string | null) => {
    const existingResourceType = sourceResourceRefs(sourceNodeId, sourceHandleId)[0]?.type
    if (existingResourceType || !sourceNodeId) return existingResourceType

    const pendingOutputKey = pendingOutputKeyFromHandle(sourceHandleId)
    if (!pendingOutputKey) return undefined
    const node = project.canvas.nodes.find((item) => item.id === sourceNodeId && item.type === 'result_group')
    const functionId = typeof node?.data.functionId === 'string' ? node.data.functionId : undefined
    const functionDef = functionId ? project.functions[functionId] : undefined
    return functionDef?.outputs.find((output) => output.key === pendingOutputKey)?.type
  }

  const inputTypeForFunctionInput = (nodeId: string | undefined, inputKey: string | undefined) => {
    if (!nodeId || !inputKey) return undefined
    const node = project.canvas.nodes.find((item) => item.id === nodeId && item.type === 'function')
    const functionId = typeof node?.data.functionId === 'string' ? node.data.functionId : undefined
    const functionDef = functionId ? project.functions[functionId] : undefined
    return functionDef?.inputs.find((input) => input.key === inputKey)?.type
  }

  const outputTypeForFunctionOutput = (nodeId: string | undefined, outputKey: string | undefined) => {
    if (!nodeId || !outputKey) return undefined
    const node = project.canvas.nodes.find((item) => item.id === nodeId && item.type === 'function')
    const functionId = typeof node?.data.functionId === 'string' ? node.data.functionId : undefined
    const functionDef = functionId ? project.functions[functionId] : undefined
    return functionDef?.outputs.find((output) => output.key === outputKey)?.type
  }

  const connectByNodeRoles = (
    firstNodeId: string | undefined,
    secondNodeId: string | undefined,
    options: {
      sourceHandleId?: string | null
      targetHandleId?: string | null
      targetInputKey?: string | null
      startedInputKey?: string | null
    } = {},
  ) => {
    if (!firstNodeId || !secondNodeId || firstNodeId === secondNodeId) return false

    const firstNode = project.canvas.nodes.find((node) => node.id === firstNodeId)
    const secondNode = project.canvas.nodes.find((node) => node.id === secondNodeId)

    if ((firstNode?.type === 'resource' || firstNode?.type === 'result_group') && secondNode?.type === 'function') {
      connectNodes(firstNodeId, secondNodeId, {
        sourceHandleId: options.sourceHandleId,
        targetInputKey: options.targetInputKey,
      })
      return true
    }

    if ((secondNode?.type === 'resource' || secondNode?.type === 'result_group') && firstNode?.type === 'function') {
      connectNodes(secondNodeId, firstNodeId, {
        sourceHandleId: options.targetHandleId,
        targetInputKey: options.startedInputKey ?? options.targetInputKey,
      })
      return true
    }

    return false
  }

  const openAddMenu = (
    clientX: number,
    clientY: number,
    connection?: AddNodeMenuState['connection'],
    placement?: AddNodeMenuState['placement'],
  ) => {
    setQuickToolbar(undefined)
    setFunctionNodeMenu(undefined)
    setGroupNodeMenu(undefined)
    setAddMenuQuery('')
    setAddMenu({
      screen: { x: clientX, y: clientY },
      flow: screenToFlowPosition({ x: clientX, y: clientY }),
      placement,
      connection,
    })
  }

  const applyInputPickFromNode = useCallback(
    (nodeId: string) => {
      if (!inputPickMode) return false
      const canvasNode = project.canvas.nodes.find((node) => node.id === nodeId)
      if (canvasNode?.type !== 'resource' || typeof canvasNode.data.resourceId !== 'string') return true
      const resource = project.resources[canvasNode.data.resourceId]
      if (!resource || resource.type !== inputPickMode.inputType) return true

      setFunctionRunDialog((current) =>
        current && current.functionId === inputPickMode.functionId
          ? {
              ...current,
              inputValues: {
                ...current.inputValues,
                [inputPickMode.inputKey]: { resourceId: resource.id, type: resource.type },
              },
            }
          : current,
      )
      setInputPickMode(undefined)
      return true
    },
    [inputPickMode, project.canvas.nodes, project.resources],
  )

  const handleNodeContextMenu = (event: ReactMouseEvent, node: Node) => {
    event.preventDefault()
    event.stopPropagation()
    if (inputPickMode) {
      applyInputPickFromNode(node.id)
      return
    }
    setAddMenu(null)
    setFunctionNodeMenu(undefined)
    setGroupNodeMenu(undefined)

    const canvasNode = project.canvas.nodes.find((item) => item.id === node.id)
    if (canvasNode?.type === 'group') {
      recordNodeSelectionRecency([node.id])
      selectNode(node.id)
      setSelectedEdgeIds([])
      setQuickToolbar(undefined)
      setGroupNodeMenu({
        kind: 'group',
        nodeId: node.id,
        left: event.clientX,
        top: event.clientY,
      })
      return
    }

    const selectedIds = activeSelectedNodeIds.includes(node.id) ? activeSelectedNodeIds : [node.id]
    if (selectedIds.length > 1) {
      recordNodeSelectionRecency(selectedIds)
      if (!activeSelectedNodeIds.includes(node.id)) selectNodes(selectedIds)
      setSelectedEdgeIds([])
      setQuickToolbar(undefined)
      setGroupNodeMenu({
        kind: 'selection',
        left: event.clientX,
        top: event.clientY,
      })
      return
    }

    if (canvasNode?.type === 'function') {
      recordNodeSelectionRecency([node.id])
      selectNode(node.id)
      setSelectedEdgeIds([])
      setQuickToolbar(undefined)
      const functionId = typeof canvasNode.data.functionId === 'string' ? canvasNode.data.functionId : undefined
      if (!functionId || !project.functions[functionId]) return
      setFunctionNodeMenu({
        nodeId: node.id,
        left: event.clientX,
        top: event.clientY,
      })
      return
    }

    if (selectedQuickSourceNodeId !== node.id) {
      recordNodeSelectionRecency([node.id])
      selectNode(node.id)
      setQuickToolbar(undefined)
      return
    }

    if (quickActionsForSourceNode(node.id).length === 0) {
      setQuickToolbar(undefined)
      return
    }

    setQuickToolbar({
      sourceNodeId: node.id,
      left: event.clientX,
      top: event.clientY,
    })
  }

  const openFunctionEditorForNode = (nodeId: string, scope: 'node' | 'all') => {
    const functionId = ensureEditableFunctionForNode(nodeId, scope)
    if (!functionId) return
    setFunctionNodeMenu(undefined)
    setGroupNodeMenu(undefined)
    setQuickToolbar(undefined)
    setFunctionEditor({ nodeId, functionId })
  }

  const activeFunctionEditorFunction = functionEditor ? project.functions[functionEditor.functionId] : undefined
  const activeFunctionEditorFunctions = activeFunctionEditorFunction ? [activeFunctionEditorFunction] : []
  const activeFunctionRunFunction = functionRunDialog
    ? functionRunDialog.temporaryFunction ?? project.functions[functionRunDialog.functionId]
    : undefined

  const placedNodePosition = (newNodeWidth: number) => {
    if (!addMenu?.placement) return addMenu?.flow
    const anchorNode = project.canvas.nodes.find((node) => node.id === addMenu.placement?.anchorNodeId)
    if (!anchorNode) return addMenu.flow

    const anchorSize = flowNodeStyle(anchorNode, flowNodeLayoutContext)
    const anchorWidth = Number(anchorSize.width)
    const resolvedAnchorWidth = Number.isFinite(anchorWidth) ? anchorWidth : DEFAULT_ASSET_NODE_WIDTH
    return addMenu.placement.side === 'right'
      ? { x: anchorNode.position.x + resolvedAnchorWidth + MENU_NODE_GAP, y: anchorNode.position.y }
      : { x: anchorNode.position.x - newNodeWidth - MENU_NODE_GAP, y: anchorNode.position.y }
  }

  const commandPositionForSourceNode = (sourceNodeId: string) => {
    const sourceNode = project.canvas.nodes.find((node) => node.id === sourceNodeId)
    if (!sourceNode) return { x: 0, y: 0 }
    const sourceSize = flowNodeStyle(sourceNode, flowNodeLayoutContext)
    const sourceWidth = Number(sourceSize.width)
    const resolvedSourceWidth = Number.isFinite(sourceWidth) ? sourceWidth : DEFAULT_ASSET_NODE_WIDTH
    return {
      x: sourceNode.position.x + resolvedSourceWidth + MENU_NODE_GAP,
      y: sourceNode.position.y,
    }
  }

  const uniqueResourceRefs = (refs: ResourceRef[]) => {
    const seen = new Set<string>()
    return refs.filter((ref) => {
      if (seen.has(ref.resourceId)) return false
      seen.add(ref.resourceId)
      return true
    })
  }

  const resourceRefsForFunctionMenu = () => {
    const refs =
      addMenu?.connection?.kind === 'source'
        ? sourceResourceRefs(addMenu.connection.sourceNodeId, addMenu.connection.sourceHandleId)
        : activeSelectedNodeIds.flatMap((nodeId) => sourceResourceRefs(nodeId))
    return uniqueResourceRefs(refs)
  }

  const addMenuFunctionOptions = Object.values(project.functions).filter((fn) =>
    addMenu?.connection?.kind === 'target' ? false : functionAcceptsResourceType(fn, addMenu?.connection?.resourceType),
  )
  const addMenuBuiltInFunctionOptions = addMenuFunctionOptions.filter(isBuiltInFunction)
  const addMenuCustomFunctionOptions = addMenuFunctionOptions.filter((fn) => !isBuiltInFunction(fn))
  const addMenuBuiltInRunners: BuiltInRunnerMenuItem[] =
    addMenu?.connection?.kind === 'target'
      ? []
      : [
          { id: 'builtin_comfyui_workflow', label: 'ComfyUI Workflow', kind: 'comfyui' },
          ...builtInFunctionMenuOrder
            .map((functionId) => addMenuBuiltInFunctionOptions.find((fn) => fn.id === functionId))
            .filter((fn): fn is GenerationFunction => Boolean(fn))
            .map((fn) => ({
              id: `builtin_${fn.id}`,
              label: builtInFunctionMenuLabels[fn.id] ?? fn.name,
              functionId: fn.id,
              kind: 'function' as const,
            })),
          ...addMenuBuiltInFunctionOptions
            .filter((fn) => !builtInFunctionMenuOrder.includes(fn.id))
            .map((fn) => ({
              id: `builtin_${fn.id}`,
              label: fn.name,
              functionId: fn.id,
              kind: 'function' as const,
            })),
        ]
  const assetTypeAllowedInMenu = (type: ResourceType) =>
    addMenu?.connection?.kind !== 'target' || addMenu.connection.resourceType === type
  const addMenuAssetOptions = [
    { type: 'text' as const, label: 'Text Asset' },
    { type: 'number' as const, label: 'Number Asset' },
    { type: 'boolean' as const, label: 'Boolean Asset' },
    { type: 'image' as const, label: 'Image Asset' },
    { type: 'video' as const, label: 'Video Asset' },
    { type: 'audio' as const, label: 'Audio Asset' },
  ].filter((item) => assetTypeAllowedInMenu(item.type))
  const filteredAddMenuAssets = addMenuAssetOptions.filter((item) => addMenuItemMatches(item.label, addMenuQuery))
  const filteredAddMenuBuiltInRunners = addMenuBuiltInRunners.filter((runner) =>
    addMenuItemMatches(runner.label, addMenuQuery),
  )
  const filteredAddMenuFunctions = addMenuCustomFunctionOptions.filter((fn) => addMenuItemMatches(fn.name, addMenuQuery))
  const filteredAddMenuTemplates = Object.values(project.templates ?? {}).filter((template) =>
    addMenuItemMatches(template.name, addMenuQuery),
  )

  useLayoutEffect(() => {
    if (!addMenu) return

    const menu = addMenuRef.current
    if (!menu) return

    const margin = 8
    const rect = menu.getBoundingClientRect()
    const maxHeight = Math.max(120, window.innerHeight - margin * 2)
    const left = Math.min(Math.max(addMenu.screen.x, margin), Math.max(margin, window.innerWidth - rect.width - margin))
    const top = Math.min(Math.max(addMenu.screen.y, margin), Math.max(margin, window.innerHeight - rect.height - margin))

    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
    menu.style.maxHeight = rect.height > maxHeight ? `${maxHeight}px` : ''
    addMenuSearchRef.current?.focus()
  }, [
    addMenu,
    filteredAddMenuAssets.length,
    filteredAddMenuBuiltInRunners.length,
    filteredAddMenuFunctions.length,
    filteredAddMenuTemplates.length,
  ])

  const createFunctionFromMenu = (functionId: string) => {
    if (!addMenu) return
    const functionDef = project.functions[functionId]
    if (!functionDef) return
    const inputValues = buildFunctionRunInputDraft(functionDef, project.resources, resourceRefsForFunctionMenu())
    const position = placedNodePosition(defaultFunctionWidth(functionDef)) ?? addMenu.flow
    openFunctionRunDialog({ functionId, inputValues, runCount: functionDef.runtimeDefaults?.runCount ?? 1, position })
    setAddMenu(null)
  }

  const createBuiltInRunnerFromMenu = (runner: BuiltInRunnerMenuItem) => {
    if (runner.kind === 'comfyui') {
      if (!addMenu) return
      const enabledEndpoint = project.comfy.endpoints.find((endpoint) => endpoint.enabled !== false)
      setTemporaryComfyWorkflow({
        position: placedNodePosition(DEFAULT_ASSET_NODE_WIDTH) ?? addMenu.flow,
        endpointId: enabledEndpoint?.id,
        editorOpen: false,
        candidateRefs: resourceRefsForFunctionMenu(),
      })
      setAddMenu(null)
      return
    }

    if (runner.kind === 'function' && runner.functionId) {
      if (!addMenu) return
      const functionDef = project.functions[runner.functionId]
      if (!functionDef) return
      const temporaryFunction = {
        ...functionDef,
        id: temporaryRunnerId(functionDef.id),
        name: runner.label,
      }
      const inputValues = buildFunctionRunInputDraft(temporaryFunction, project.resources, resourceRefsForFunctionMenu())
      const position = placedNodePosition(defaultFunctionWidth(temporaryFunction)) ?? addMenu.flow
      openFunctionRunDialog({
        functionId: temporaryFunction.id,
        temporaryFunction,
        inputValues,
        runCount: temporaryFunction.runtimeDefaults?.runCount ?? 1,
        position,
      })
      setAddMenu(null)
      return
    }
    setAddMenu(null)
  }

  const saveTemporaryComfyWorkflow = (value: EmbeddedComfySave) => {
    if (!temporaryComfyWorkflow) return
    const createdAt = value.editor.savedAt || new Date().toISOString()
    const currentTemporaryFunction =
      functionRunDialog?.temporaryFunction?.workflow.format === 'comfyui_api_json'
        ? functionRunDialog.temporaryFunction
        : undefined
    const generatedFunction = createGenerationFunctionFromWorkflow(
      `temp_comfy_${createdAt.replace(/\W/g, '')}`,
      'ComfyUI Workflow',
      value.rawJson,
      createdAt,
      {
        uiJson: value.uiJson,
        editor: value.editor,
      },
    )
    const temporaryFunction = currentTemporaryFunction
      ? {
          ...generatedFunction,
          id: currentTemporaryFunction.id,
          name: currentTemporaryFunction.name,
          category: currentTemporaryFunction.category,
          description: currentTemporaryFunction.description,
          inputs: mergeEditedWorkflowInputs(currentTemporaryFunction.inputs, generatedFunction.inputs),
          runtimeDefaults: currentTemporaryFunction.runtimeDefaults,
          createdAt: currentTemporaryFunction.createdAt,
        }
      : generatedFunction
    const nextInputValues = buildFunctionRunInputDraft(
      temporaryFunction,
      project.resources,
      temporaryComfyWorkflow.candidateRefs,
    )
    const preservedInputValues = functionRunDialog?.temporaryFunction
      ? { ...nextInputValues, ...functionRunDialog.inputValues }
      : nextInputValues
    openFunctionRunDialog({
      functionId: temporaryFunction.id,
      temporaryFunction,
      inputValues: preservedInputValues,
      runCount: functionRunDialog?.runCount ?? temporaryFunction.runtimeDefaults?.runCount ?? 1,
      position: functionRunDialog?.position ?? temporaryComfyWorkflow.position,
      replaceTarget: functionRunDialog?.replaceTarget,
    })
    setTemporaryComfyWorkflow({
      ...temporaryComfyWorkflow,
      endpointId: value.editor.endpointId,
      editorOpen: false,
    })
  }

  const createAssetFromMenu = (type: ResourceType) => {
    if (!addMenu) return
    const initialValue =
      addMenu.connection?.kind === 'target'
        ? targetInputInitialResourceValue(project, addMenu.connection.targetNodeId, addMenu.connection.targetInputKey)
        : undefined
    const nodeId = addEmptyResourceAtPosition(type, placedNodePosition(DEFAULT_ASSET_NODE_WIDTH) ?? addMenu.flow, initialValue)
    if (nodeId && addMenu.connection?.kind === 'target') {
      connectNodes(nodeId, addMenu.connection.targetNodeId, {
        targetInputKey: addMenu.connection.targetInputKey,
      })
    }
    setAddMenu(null)
  }

  const createTemplateFromMenu = (templateId: string) => {
    if (!addMenu) return
    instantiateTemplate(templateId, addMenu.flow)
    setAddMenu(null)
  }

  const saveSelectionAsTemplate = () => {
    const name = window.prompt('Template name', 'Template')
    if (name === null) return
    saveTemplateFromSelection(name)
    setGroupNodeMenu(undefined)
  }

  const createTextAtPoint = (text: string, clientX: number, clientY: number) => {
    addTextResourceAtPosition('Prompt', text, screenToFlowPosition({ x: clientX, y: clientY }))
  }

  const handleCanvasDrop = async (event: DragEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('.react-flow__node, button, input, textarea, .add-node-menu')) return

    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const file = [...event.dataTransfer.files].find((item) => item.type.startsWith('image/') || item.type.startsWith('video/') || item.type.startsWith('audio/'))
    if (file) {
      event.preventDefault()
      const result = await readFileAsMediaResource(file)
      if (result) addMediaResourceAtPosition(result.type, result.media.filename ?? file.name, result.media, point)
      setAddMenu(null)
      return
    }

    const text = event.dataTransfer.getData('text/plain').trim()
    if (text) {
      event.preventDefault()
      createTextAtPoint(text, event.clientX, event.clientY)
      setAddMenu(null)
    }
  }

  const handleCanvasDragOver = (event: DragEvent<HTMLElement>) => {
    const hasFiles = [...event.dataTransfer.types].includes('Files')
    const hasText = [...event.dataTransfer.types].includes('text/plain')
    if (hasFiles || hasText) event.preventDefault()
  }

  const eventPoint = (event: MouseEvent | TouchEvent) => {
    if ('changedTouches' in event && event.changedTouches.length > 0) {
      const touch = event.changedTouches[0]
      return { x: touch.clientX, y: touch.clientY }
    }

    return { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY }
  }

  const handleInfoFromElement = (element: Element | null) => {
    if (element?.classList.contains('asset-lineage-anchor-handle')) return undefined
    const nodeId = element?.closest('.react-flow__node')?.getAttribute('data-id') ?? undefined
    const handleId = element?.getAttribute('data-slot-handle') ?? element?.getAttribute('data-handleid') ?? undefined
    return nodeId ? { nodeId, handleId } : undefined
  }

  const handleInfoNearPoint = (clientX: number, clientY: number) => {
    for (const handle of document.querySelectorAll('.workspace-canvas .react-flow__handle')) {
      const rect = handle.getBoundingClientRect()
      const padding = 14
      const isNear =
        clientX >= rect.left - padding &&
        clientX <= rect.right + padding &&
        clientY >= rect.top - padding &&
        clientY <= rect.bottom + padding
      if (isNear) return handleInfoFromElement(handle)
    }

    return undefined
  }

  const handleClickAddMenuConnection = (nodeId: string | undefined, handleId: string | undefined) => {
    if (!nodeId || !handleId) return undefined
    const node = project.canvas.nodes.find((item) => item.id === nodeId)
    if (!node) return undefined

    const inputKey = inputKeyFromHandle(handleId)
    const outputKey = handleId.startsWith('output:') ? handleId.slice('output:'.length) : undefined
    if (node.type === 'function' && inputKey) {
      const resourceType = inputTypeForFunctionInput(node.id, inputKey)
      return resourceType
        ? {
            connection: {
              kind: 'target' as const,
              targetNodeId: node.id,
              targetInputKey: inputKey,
              resourceType,
            },
            placement: { anchorNodeId: node.id, side: 'left' as const },
          }
        : undefined
    }

    if (node.type === 'resource' || node.type === 'result_group') {
      return {
        connection: {
          kind: 'source' as const,
          sourceNodeId: node.id,
          sourceHandleId: handleId,
          resourceType: connectionResourceType(node.id, handleId),
        },
        placement: { anchorNodeId: node.id, side: 'right' as const },
      }
    }

    if (node.type === 'function' && outputKey) {
      return {
        connection: {
          kind: 'source' as const,
          sourceNodeId: node.id,
          sourceHandleId: handleId,
          resourceType: outputTypeForFunctionOutput(node.id, outputKey),
        },
        placement: { anchorNodeId: node.id, side: 'right' as const },
      }
    }

    return undefined
  }

  const handleHandleClick = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    const handle = target.closest('.react-flow__handle') as HTMLElement | null
    if (!handle || !canvasRef.current?.contains(handle)) return

    const info = handleInfoFromElement(handle)
    const menuState = handleClickAddMenuConnection(info?.nodeId, info?.handleId)
    if (!menuState) return

    const rect = handle.getBoundingClientRect()
    event.preventDefault()
    event.stopPropagation()
    openAddMenu(rect.left + rect.width / 2, rect.top + rect.height / 2, menuState.connection, menuState.placement)
  }

  return (
    <section
      ref={canvasRef}
      className={`workspace-canvas${inputPickMode ? ' asset-pick-mode' : ''}`}
      aria-label="Canvas"
      onClickCapture={handleHandleClick}
      onMouseDownCapture={(event) => {
        if (inputPickMode) return
        const target = event.target instanceof HTMLElement ? event.target : null
        if (
          target?.closest(
            '.react-flow__node, .react-flow__edge, button, input, select, textarea, .react-flow__controls, .comfy-minimap, .add-node-menu, .resource-quick-actions, .function-node-actions',
          )
        ) {
          return
        }
        clearCanvasSelection()
      }}
      onDoubleClick={(event) => {
        const target = event.target as HTMLElement
        if (target.closest('.react-flow__node, button, input, textarea, .react-flow__controls, .comfy-minimap, .add-node-menu')) {
          return
        }
        event.preventDefault()
        openAddMenu(event.clientX, event.clientY)
      }}
      onContextMenu={(event) => {
        const target = event.target as HTMLElement
        if (
          target.closest(
            '.react-flow__node, button, input, textarea, .react-flow__controls, .comfy-minimap, .add-node-menu, .resource-quick-actions, .function-node-actions',
          )
        ) {
          return
        }
        event.preventDefault()
        openAddMenu(event.clientX, event.clientY)
      }}
      onDragOver={handleCanvasDragOver}
      onDrop={(event) => void handleCanvasDrop(event)}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionStart={() => {
          selectionBoxActive.current = true
          selectionBoxNodeIds.current = []
          setSelectedEdgeIds([])
          setTraceHighlightNodeIds([])
          setQuickToolbar(undefined)
          setFunctionNodeMenu(undefined)
          setGroupNodeMenu(undefined)
        }}
        onSelectionEnd={() => {
          selectionBoxActive.current = false
          window.requestAnimationFrame(() => {
            const selectedIds = [
              ...document.querySelectorAll<HTMLElement>('.workspace-canvas .react-flow__node.selected'),
            ]
              .map((node) => node.getAttribute('data-id'))
              .filter((nodeId): nodeId is string => Boolean(nodeId))

            selectNodes(selectedIds.length > 0 ? selectedIds : selectionBoxNodeIds.current)
            recordNodeSelectionRecency(selectedIds.length > 0 ? selectedIds : selectionBoxNodeIds.current)
            selectionBoxNodeIds.current = []
          })
        }}
        onSelectionChange={handleSelectionChange}
        onConnect={handleConnect}
        onEdgeClick={(event, edge) => {
          event.stopPropagation()
          setSelectedEdgeIds([edge.id])
          setTraceHighlightNodeIds([])
          setQuickToolbar(undefined)
          setFunctionNodeMenu(undefined)
          setGroupNodeMenu(undefined)
          selectNode(undefined)
        }}
        onConnectStart={(_, params) => {
          connectionStart.current = { nodeId: params.nodeId, handleId: params.handleId }
        }}
        onConnectEnd={(event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
          const point = eventPoint(event)
          const targetHandle = handleInfoNearPoint(point.x, point.y)
          const sourceNodeId =
            connectionState.fromNode?.id ?? connectionState.fromHandle?.nodeId ?? connectionStart.current?.nodeId ?? undefined
          const sourceHandleId = connectionState.fromHandle?.id ?? connectionStart.current?.handleId ?? undefined
          const targetHandleId = connectionState.toHandle?.id ?? targetHandle?.handleId
          const targetNodeId = connectionState.toNode?.id ?? connectionState.toHandle?.nodeId ?? targetHandle?.nodeId

          connectionStart.current = null

          if (
            connectByNodeRoles(sourceNodeId, targetNodeId, {
              sourceHandleId,
              targetHandleId,
              targetInputKey: inputKeyFromHandle(targetHandleId),
              startedInputKey: inputKeyFromHandle(sourceHandleId),
            })
          ) {
            return
          }
          if (connectionState.isValid) return

          const sourceNode = project.canvas.nodes.find((node) => node.id === sourceNodeId)
          const startedInputKey = inputKeyFromHandle(sourceHandleId)
          const resourceType = inputTypeForFunctionInput(sourceNodeId, startedInputKey)
          const menuConnection =
            sourceNode?.type === 'function' && startedInputKey && resourceType
              ? {
                  kind: 'target' as const,
                  targetNodeId: sourceNode.id,
                  targetInputKey: startedInputKey,
                  resourceType,
                }
              : sourceNode?.type === 'resource' || sourceNode?.type === 'result_group'
                ? {
                    kind: 'source' as const,
                    sourceNodeId: sourceNode.id,
                    sourceHandleId,
                    resourceType: connectionResourceType(sourceNode.id, sourceHandleId),
                  }
                : undefined

          window.requestAnimationFrame(() =>
            openAddMenu(point.x, point.y, menuConnection),
          )
        }}
        onNodeClick={(event, node) => {
          if (inputPickMode) {
            event.preventDefault()
            event.stopPropagation()
            applyInputPickFromNode(node.id)
            return
          }
          setSelectedEdgeIds([])
          setQuickToolbar(undefined)
          setFunctionNodeMenu(undefined)
          setGroupNodeMenu(undefined)
          if (suppressNextNodeClick.current) {
            suppressNextNodeClick.current = false
            return
          }
          if (!event.shiftKey && !event.altKey && activeSelectedNodeIds.length > 1 && activeSelectedNodeIds.includes(node.id)) {
            recordNodeSelectionRecency([node.id])
            return
          }
          recordNodeSelectionRecency([node.id])
          selectNode(node.id, selectionModeFromEvent(event))
        }}
        onNodeDoubleClick={(event, node) => {
          if (inputPickMode) return
          event.preventDefault()
          event.stopPropagation()
          setSelectedEdgeIds([])
          setQuickToolbar(undefined)
          setFunctionNodeMenu(undefined)
          setGroupNodeMenu(undefined)
          recordNodeSelectionRecency([node.id])
          if (!activeSelectedNodeIds.includes(node.id)) {
            selectNode(node.id)
          }
          setTraceHighlightNodeIds([node.id])
        }}
        onNodeContextMenu={handleNodeContextMenu}
        onNodeDragStop={(_, node, draggedNodes) => {
          suppressNextNodeClick.current = true
          window.setTimeout(() => {
            suppressNextNodeClick.current = false
          }, 0)
          if (draggedNodes.length > 0) {
            updateNodePositions(Object.fromEntries(draggedNodes.map((draggedNode) => [draggedNode.id, draggedNode.position])))
            return
          }
          updateNodePosition(node.id, node.position)
        }}
        onPaneClick={() => {
          if (inputPickMode) return
          clearCanvasSelection()
        }}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        selectionKeyCode="Control"
        multiSelectionKeyCode="Shift"
        selectionMode={SelectionMode.Partial}
        snapToGrid
        snapGrid={[24, 24]}
      >
        <Background gap={24} size={1} />
        <ComfyMinimap nodes={nodes} edges={edges} canvasRef={canvasRef} />
        <Controls />
      </ReactFlow>
      {addMenu ? (
        <div
          ref={addMenuRef}
          aria-label="Add node"
          className="add-node-menu"
          role="menu"
          style={{
            left: addMenu.screen.x,
            top: addMenu.screen.y,
          }}
        >
          <input
            ref={addMenuSearchRef}
            aria-label="Search nodes"
            className="add-node-search nodrag nopan"
            placeholder="Search nodes"
            role="searchbox"
            value={addMenuQuery}
            onChange={(event) => setAddMenuQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setAddMenu(null)
            }}
          />
          {filteredAddMenuAssets.length > 0 ? <div className="add-node-section-label">Assets</div> : null}
          {filteredAddMenuAssets.map((item) => (
            <button key={item.type} role="menuitem" type="button" onClick={() => createAssetFromMenu(item.type)}>
              {item.label}
            </button>
          ))}
          {filteredAddMenuBuiltInRunners.length > 0 ? <div className="add-node-section-label">Built-in</div> : null}
          {filteredAddMenuBuiltInRunners.map((runner) => (
            <button key={runner.id} role="menuitem" type="button" onClick={() => createBuiltInRunnerFromMenu(runner)}>
              {runner.label}
            </button>
          ))}
          {filteredAddMenuTemplates.length > 0 ? <div className="add-node-section-label">Templates</div> : null}
          {filteredAddMenuTemplates.map((template) => (
            <button key={template.id} role="menuitem" type="button" onClick={() => createTemplateFromMenu(template.id)}>
              Template: {template.name}
            </button>
          ))}
          {filteredAddMenuFunctions.length > 0 ? <div className="add-node-section-label">Functions</div> : null}
          {filteredAddMenuFunctions.map((fn) => (
            <button key={fn.id} role="menuitem" type="button" onClick={() => createFunctionFromMenu(fn.id)}>
              {fn.name}
            </button>
          ))}
          {filteredAddMenuAssets.length === 0 &&
          filteredAddMenuBuiltInRunners.length === 0 &&
          filteredAddMenuTemplates.length === 0 &&
          filteredAddMenuFunctions.length === 0 ? (
            <div className="add-node-empty">No matching nodes</div>
          ) : null}
        </div>
      ) : null}
      {quickToolbar && localQuickActions.length > 0 ? (
        <div
          ref={quickToolbarRef}
          aria-label="Resource quick actions"
          className="resource-quick-actions nodrag nopan"
          style={{
            left: quickToolbar.left,
            top: quickToolbar.top,
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {localQuickActions.map((fn) => (
            <button
              key={fn.id}
              type="button"
              aria-label={fn.name}
              title={fn.name}
              onClick={() => {
                const inputValues = buildFunctionRunInputDraft(
                  fn,
                  project.resources,
                  uniqueResourceRefs(sourceResourceRefs(quickToolbar.sourceNodeId)),
                )
                openFunctionRunDialog({
                  functionId: fn.id,
                  inputValues,
                  runCount: fn.runtimeDefaults?.runCount ?? 1,
                  position: commandPositionForSourceNode(quickToolbar.sourceNodeId),
                })
              }}
            >
              <LocalQuickActionIcon kind={fn.localTransform?.kind} />
              <span>{fn.name}</span>
            </button>
          ))}
        </div>
      ) : null}
      {functionNodeMenu ? (
        <div
          ref={functionNodeMenuRef}
          aria-label="Function node actions"
          className="resource-quick-actions function-node-actions nodrag nopan"
          style={{
            left: functionNodeMenu.left,
            top: functionNodeMenu.top,
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Edit This Node"
            title="Edit this node"
            onClick={() => openFunctionEditorForNode(functionNodeMenu.nodeId, 'node')}
          >
            <Pencil size={16} />
            <span>Edit This Node</span>
          </button>
          <button
            type="button"
            aria-label="Edit All Nodes"
            title="Edit all nodes of this type"
            onClick={() => openFunctionEditorForNode(functionNodeMenu.nodeId, 'all')}
          >
            <Layers size={16} />
            <span>Edit All Nodes</span>
          </button>
        </div>
      ) : null}
      {groupNodeMenu ? (
        <div
          ref={groupNodeMenuRef}
          aria-label="Group actions"
          className="resource-quick-actions group-node-actions nodrag nopan"
          style={{
            left: groupNodeMenu.left,
            top: groupNodeMenu.top,
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {groupNodeMenu.kind === 'selection' ? (
            <>
            <button
              type="button"
              aria-label="Group Selection"
              title="Group selection"
              onClick={() => {
                groupSelectedNodes()
                setGroupNodeMenu(undefined)
              }}
            >
              <Layers size={16} />
              <span>Group Selection</span>
            </button>
            <button
              type="button"
              aria-label="Save Selection as Template"
              title="Save selection as template"
              onClick={saveSelectionAsTemplate}
            >
              <Layers size={16} />
              <span>Save as Template</span>
            </button>
            </>
          ) : null}
          {groupNodeMenu.kind === 'group' && groupNodeMenu.nodeId ? (
            <>
            <button
              type="button"
              aria-label="Ungroup"
              title="Ungroup"
              onClick={() => {
                if (groupNodeMenu.nodeId) ungroupNode(groupNodeMenu.nodeId)
                setGroupNodeMenu(undefined)
              }}
            >
              <Scissors size={16} />
              <span>Ungroup</span>
            </button>
            <button
              type="button"
              aria-label="Save Group as Template"
              title="Save group as template"
              onClick={saveSelectionAsTemplate}
            >
              <Layers size={16} />
              <span>Save as Template</span>
            </button>
            </>
          ) : null}
        </div>
      ) : null}
      {inputPickMode ? (
        <FunctionInputPickStrip
          pickMode={inputPickMode}
          compatibleCount={inputPickableRefs.length}
          onCancel={() => setInputPickMode(undefined)}
        />
      ) : null}
      {temporaryComfyWorkflow && !temporaryComfyWorkflow.editorOpen && !functionRunDialog ? (
        <TemporaryComfyWorkflowDialog
          endpoints={project.comfy.endpoints}
          endpointId={temporaryComfyWorkflow.endpointId}
          onEndpointChange={(endpointId) =>
            setTemporaryComfyWorkflow((current) => (current ? { ...current, endpointId } : current))
          }
          onEdit={() => setTemporaryComfyWorkflow((current) => (current ? { ...current, editorOpen: true } : current))}
          onClose={() => setTemporaryComfyWorkflow(undefined)}
        />
      ) : null}
      {temporaryComfyWorkflow?.editorOpen ? (
        <ComfyWorkflowEditorDialog
          endpoint={project.comfy.endpoints.find((endpoint) => endpoint.id === temporaryComfyWorkflow.endpointId)}
          initialUiJson={functionRunDialog?.temporaryFunction?.workflow.uiJson}
          initialApiJson={functionRunDialog?.temporaryFunction?.workflow.rawJson}
          onSave={saveTemporaryComfyWorkflow}
          onClose={() => setTemporaryComfyWorkflow((current) => (current ? { ...current, editorOpen: false } : current))}
        />
      ) : null}
      {functionRunDialog && activeFunctionRunFunction && !inputPickMode && !temporaryComfyWorkflow?.editorOpen ? (
        <FunctionRunDialog
          functionDef={activeFunctionRunFunction}
          values={functionRunDialog.inputValues}
          runCount={functionRunDialog.runCount}
          resourcesById={project.resources}
          canReplaceCurrent={Boolean(functionRunDialog.replaceTarget?.resourceId)}
          onClose={() => {
            setInputPickMode(undefined)
            setFunctionRunDialog(undefined)
            if (functionRunDialog.temporaryFunction?.workflow.format === 'comfyui_api_json') {
              setTemporaryComfyWorkflow(undefined)
            }
          }}
          onPickInput={(input) => {
            setInputPickMode({
              functionId: functionRunDialog.functionId,
              inputKey: input.key,
              inputLabel: input.label,
              inputType: input.type,
            })
          }}
          onRun={(values, runCount, mode) => {
            const options =
              mode === 'replace' && functionRunDialog.replaceTarget
                ? { replace: functionRunDialog.replaceTarget }
                : undefined
            if (functionRunDialog.temporaryFunction) {
              void runTemporaryFunctionAtPosition(
                functionRunDialog.temporaryFunction,
                values,
                functionRunDialog.position,
                runCount,
                options,
              )
              return
            }
            void runFunctionAtPosition(functionRunDialog.functionId, values, functionRunDialog.position, runCount, options)
          }}
          onFunctionDefChange={
            functionRunDialog.temporaryFunction
              ? (temporaryFunction) =>
                  setFunctionRunDialog((current) => (current ? { ...current, temporaryFunction } : current))
              : undefined
          }
          onEditComfyWorkflow={
            functionRunDialog.temporaryFunction?.workflow.format === 'comfyui_api_json'
              ? () => {
                  const endpointId =
                    functionRunDialog.temporaryFunction?.workflow.editor?.endpointId ??
                    temporaryComfyWorkflow?.endpointId ??
                    project.comfy.endpoints.find((endpoint) => endpoint.enabled !== false)?.id
                  setTemporaryComfyWorkflow((current) => ({
                    position: current?.position ?? functionRunDialog.position,
                    endpointId,
                    editorOpen: true,
                    candidateRefs: current?.candidateRefs ?? [],
                  }))
                }
              : undefined
          }
          onRunCountChange={(runCount) =>
            setFunctionRunDialog((current) => (current ? { ...current, runCount } : current))
          }
          onValuesChange={(inputValues) =>
            setFunctionRunDialog((current) => (current ? { ...current, inputValues } : current))
          }
        />
      ) : null}
      {functionEditor && activeFunctionEditorFunction ? (
        <FunctionManager
          functions={activeFunctionEditorFunctions}
          comfyEndpoints={project.comfy.endpoints}
          selectedFunctionId={functionEditor.functionId}
          allowCreate={false}
          allowDelete={false}
          onSelectFunction={(functionId) => {
            if (!functionId) return
            setFunctionEditor((current) => (current ? { ...current, functionId } : current))
          }}
          onAddWorkflow={addFunctionFromWorkflow}
          onAddRequestFunction={addRequestFunction}
          onAddOpenAIFunction={addOpenAILlmFunction}
          onAddGeminiFunction={addGeminiLlmFunction}
          onUpdateFunction={updateFunction}
          onDeleteFunction={() => undefined}
          onClose={() => setFunctionEditor(undefined)}
        />
      ) : null}
      {selectedComparePair ? (
        <div className="compare-toolbar">
          <button type="button" aria-label="Compare selected runs" onClick={() => setComparePair(selectedComparePair)}>
            <GitCompareArrows size={15} />
            Compare
          </button>
        </div>
      ) : null}
      {comparePair ? <CompareRunResultsModal pair={comparePair} onClose={() => setComparePair(null)} /> : null}
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
