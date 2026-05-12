import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  Background,
  Controls,
  MiniMap,
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
} from '@xyflow/react'
import { GitCompareArrows, X } from 'lucide-react'
import { EmptyNodeView, FunctionNodeView, GroupNodeView, ResourceNodeView, ResultGroupNodeView } from './NodeViews'
import { buildCanvasFlowEdges } from '../domain/canvasEdges'
import { targetInputInitialResourceValue } from '../domain/inputInitialValue'
import { readFileAsMediaResource } from '../domain/resourceFiles'
import { useProjectStore } from '../store/projectStore'
import { shouldIgnoreCanvasShortcut } from './canvasKeyboard'
import type {
  CanvasNode,
  GenerationFunction,
  Resource,
  ResourceRef,
  ResourceType,
} from '../domain/types'

type AddNodeMenuState = {
  screen: { x: number; y: number }
  flow: { x: number; y: number }
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

const nodeTypes: NodeTypes = {
  resource: ResourceNodeView,
  function: FunctionNodeView,
  result_group: ResultGroupNodeView,
  group: GroupNodeView,
  default: EmptyNodeView,
}

const inputKeyFromHandle = (handleId?: string | null) =>
  handleId?.startsWith('input:') ? handleId.slice('input:'.length) : undefined

const resourceIdFromHandle = (handleId?: string | null) => {
  if (!handleId) return undefined
  if (handleId.startsWith('resource:')) return handleId.slice('resource:'.length)
  if (handleId.startsWith('result:')) return handleId.slice('result:'.length)
  return undefined
}

const functionAcceptsResourceType = (fn: GenerationFunction, resourceType?: ResourceType) =>
  !resourceType || fn.inputs.some((input) => input.type === resourceType)

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const mediaValue = (resource: Resource | undefined) =>
  typeof resource?.value === 'object' && resource.value !== null && 'url' in resource.value ? resource.value : undefined

const resourceLabel = (resource: Resource) => mediaValue(resource)?.filename ?? resource.name ?? resource.id

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
  return { width: 230, height: undefined }
}

const flowNodeStyle = (node: CanvasNode, functionsById: Record<string, GenerationFunction>) => {
  const defaultSize = defaultNodeSize(node, functionsById)
  const size = storedNodeSize(node)
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

function CanvasSurface() {
  const project = useProjectStore((state) => state.project)
  const selectedNodeId = useProjectStore((state) => state.selectedNodeId)
  const selectedNodeIds = useProjectStore((state) => state.selectedNodeIds)
  const selectNode = useProjectStore((state) => state.selectNode)
  const selectNodes = useProjectStore((state) => state.selectNodes)
  const runFunctionNodeWithComfy = useProjectStore((state) => state.runFunctionNodeWithComfy)
  const rerunResultNode = useProjectStore((state) => state.rerunResultNode)
  const cancelResultRun = useProjectStore((state) => state.cancelResultRun)
  const addTextResourceAtPosition = useProjectStore((state) => state.addTextResourceAtPosition)
  const addEmptyResourceAtPosition = useProjectStore((state) => state.addEmptyResourceAtPosition)
  const addMediaResourceAtPosition = useProjectStore((state) => state.addMediaResourceAtPosition)
  const addFunctionNodeAtPosition = useProjectStore((state) => state.addFunctionNodeAtPosition)
  const updateTextResourceValue = useProjectStore((state) => state.updateTextResourceValue)
  const updateNumberResourceValue = useProjectStore((state) => state.updateNumberResourceValue)
  const replaceResourceMedia = useProjectStore((state) => state.replaceResourceMedia)
  const updateFunctionNodeRunCount = useProjectStore((state) => state.updateFunctionNodeRunCount)
  const updateFunctionNodeInputValue = useProjectStore((state) => state.updateFunctionNodeInputValue)
  const updateFunctionNodeOpenAiConfig = useProjectStore((state) => state.updateFunctionNodeOpenAiConfig)
  const updateFunctionNodeGeminiConfig = useProjectStore((state) => state.updateFunctionNodeGeminiConfig)
  const updateFunctionNodeOpenAiImageConfig = useProjectStore((state) => state.updateFunctionNodeOpenAiImageConfig)
  const updateFunctionNodeGeminiImageConfig = useProjectStore((state) => state.updateFunctionNodeGeminiImageConfig)
  const connectNodes = useProjectStore((state) => state.connectNodes)
  const deleteEdges = useProjectStore((state) => state.deleteEdges)
  const updateNodePosition = useProjectStore((state) => state.updateNodePosition)
  const updateNodePositions = useProjectStore((state) => state.updateNodePositions)
  const updateNodeSize = useProjectStore((state) => state.updateNodeSize)
  const renameNode = useProjectStore((state) => state.renameNode)
  const deleteNode = useProjectStore((state) => state.deleteNode)
  const deleteSelectedNode = useProjectStore((state) => state.deleteSelectedNode)
  const undoLastProjectChange = useProjectStore((state) => state.undoLastProjectChange)
  const duplicateSelectedNode = useProjectStore((state) => state.duplicateSelectedNode)
  const duplicateNodes = useProjectStore((state) => state.duplicateNodes)
  const { screenToFlowPosition, setCenter } = useReactFlow()
  const [addMenu, setAddMenu] = useState<AddNodeMenuState | null>(null)
  const [comparePair, setComparePair] = useState<CompareImagePair | null>(null)
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([])
  const addMenuRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLElement | null>(null)
  const connectionStart = useRef<ConnectionStartState | null>(null)
  const copiedNodeIds = useRef<string[]>([])
  const suppressNextNodeClick = useRef(false)
  const modifierKeys = useRef({ alt: false, ctrl: false, shift: false })
  const selectionBoxActive = useRef(false)
  const selectionBoxNodeIds = useRef<string[]>([])
  const activeSelectedNodeIds = useMemo(
    () => (selectedNodeIds.length ? selectedNodeIds : selectedNodeId ? [selectedNodeId] : []),
    [selectedNodeId, selectedNodeIds],
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
      project.canvas.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        position: node.position,
        selected: activeSelectedNodeIds.includes(node.id),
        style: flowNodeStyle(node, project.functions),
        data: {
          ...node.data,
          resourcesById: project.resources,
          functionsById: project.functions,
          tasksById: project.tasks,
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
          onDeleteNode: deleteNode,
          onRenameNode: renameNode,
          onUpdateTextResourceValue: updateTextResourceValue,
          onUpdateNumberResourceValue: updateNumberResourceValue,
          onReplaceResourceMedia: replaceResourceMedia,
          onResizeNode: updateNodeSize,
        },
      })),
    [
      deleteNode,
      project.canvas.nodes,
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
      updateNodeSize,
      updateNumberResourceValue,
      updateTextResourceValue,
    ],
  )

  const flowEdges = useMemo<Edge[]>(() => {
    return buildCanvasFlowEdges(project).map((edge) => ({
      ...edge,
      selected: selectedEdgeIds.includes(edge.id),
    }))
  }, [project, selectedEdgeIds])

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
    setEdges(flowEdges)
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
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        const domNodeIds = selectedDomNodeIds()
        if (domNodeIds.length > 1 || (domNodeIds.length > 0 && activeSelectedNodeIds.length === 0)) {
          for (const nodeId of domNodeIds) deleteNode(nodeId)
        } else if (selectedEdgeIds.length > 0) {
          deleteEdges(selectedEdgeIds)
          setSelectedEdgeIds([])
        } else {
          deleteSelectedNode()
        }
      }
      if (event.key === 'Escape') {
        setAddMenu(null)
        selectNode(undefined)
        setSelectedEdgeIds([])
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
    deleteSelectedNode,
    duplicateNodes,
    duplicateSelectedNode,
    pasteClipboardContent,
    selectNode,
    selectedDomNodeIds,
    selectedEdgeIds,
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
    if (changedEdgeIds.length > 0) {
      setSelectedEdgeIds((current) =>
        current.length === changedEdgeIds.length && current.every((edgeId, index) => edgeId === changedEdgeIds[index])
          ? current
          : changedEdgeIds,
      )
    }
    if (!selectionBoxActive.current) return
    selectionBoxNodeIds.current = changedNodes.map((node) => node.id)
  }

  const sourceResourceRefs = (sourceNodeId: string | undefined, sourceHandleId?: string | null): ResourceRef[] => {
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
  }

  const connectionResourceType = (sourceNodeId: string | undefined, sourceHandleId?: string | null) =>
    sourceResourceRefs(sourceNodeId, sourceHandleId)[0]?.type

  const inputTypeForFunctionInput = (nodeId: string | undefined, inputKey: string | undefined) => {
    if (!nodeId || !inputKey) return undefined
    const node = project.canvas.nodes.find((item) => item.id === nodeId && item.type === 'function')
    const functionId = typeof node?.data.functionId === 'string' ? node.data.functionId : undefined
    const functionDef = functionId ? project.functions[functionId] : undefined
    return functionDef?.inputs.find((input) => input.key === inputKey)?.type
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
  ) => {
    setAddMenu({
      screen: { x: clientX, y: clientY },
      flow: screenToFlowPosition({ x: clientX, y: clientY }),
      connection,
    })
  }

  const addMenuFunctions = Object.values(project.functions).filter((fn) =>
    addMenu?.connection?.kind === 'target' ? false : functionAcceptsResourceType(fn, addMenu?.connection?.resourceType),
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
  }, [addMenu, addMenuFunctions.length])

  const createFunctionFromMenu = (functionId: string) => {
    if (!addMenu) return
    const nodeId = addFunctionNodeAtPosition(functionId, addMenu.flow, {
      autoBindRequiredInputs: false,
    })
    if (nodeId && addMenu.connection?.kind === 'source') {
      connectNodes(addMenu.connection.sourceNodeId, nodeId, {
        sourceHandleId: addMenu.connection.sourceHandleId,
      })
    }
    setAddMenu(null)
  }

  const assetTypeAllowedInMenu = (type: ResourceType) =>
    addMenu?.connection?.kind !== 'target' || addMenu.connection.resourceType === type

  const createAssetFromMenu = (type: ResourceType) => {
    if (!addMenu) return
    const initialValue =
      addMenu.connection?.kind === 'target'
        ? targetInputInitialResourceValue(project, addMenu.connection.targetNodeId, addMenu.connection.targetInputKey)
        : undefined
    const nodeId = addEmptyResourceAtPosition(type, addMenu.flow, initialValue)
    if (nodeId && addMenu.connection?.kind === 'target') {
      connectNodes(nodeId, addMenu.connection.targetNodeId, {
        targetInputKey: addMenu.connection.targetInputKey,
      })
    }
    setAddMenu(null)
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

  return (
    <section
      ref={canvasRef}
      className="workspace-canvas"
      aria-label="Canvas"
      onDoubleClick={(event) => {
        const target = event.target as HTMLElement
        if (target.closest('.react-flow__node, button, input, textarea, .react-flow__controls, .react-flow__minimap, .add-node-menu')) {
          return
        }
        event.preventDefault()
        openAddMenu(event.clientX, event.clientY)
      }}
      onContextMenu={(event) => {
        const target = event.target as HTMLElement
        if (target.closest('.react-flow__node, button, input, textarea, .react-flow__controls, .react-flow__minimap, .add-node-menu')) {
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
            selectionBoxNodeIds.current = []
          })
        }}
        onSelectionChange={handleSelectionChange}
        onConnect={handleConnect}
        onEdgeClick={(event, edge) => {
          event.stopPropagation()
          setSelectedEdgeIds([edge.id])
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
          setSelectedEdgeIds([])
          if (suppressNextNodeClick.current) {
            suppressNextNodeClick.current = false
            return
          }
          if (!event.shiftKey && !event.altKey && activeSelectedNodeIds.length > 1 && activeSelectedNodeIds.includes(node.id)) {
            return
          }
          selectNode(node.id, selectionModeFromEvent(event))
        }}
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
          selectNode(undefined)
          setSelectedEdgeIds([])
          setAddMenu(null)
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
        <MiniMap pannable zoomable position="top-left" />
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
          {assetTypeAllowedInMenu('text') ? (
            <button role="menuitem" type="button" onClick={() => createAssetFromMenu('text')}>
              Text Asset
            </button>
          ) : null}
          {assetTypeAllowedInMenu('number') ? (
            <button role="menuitem" type="button" onClick={() => createAssetFromMenu('number')}>
              Number Asset
            </button>
          ) : null}
          {assetTypeAllowedInMenu('image') ? (
            <button role="menuitem" type="button" onClick={() => createAssetFromMenu('image')}>
              Image Asset
            </button>
          ) : null}
          {assetTypeAllowedInMenu('video') ? (
            <button role="menuitem" type="button" onClick={() => createAssetFromMenu('video')}>
              Video Asset
            </button>
          ) : null}
          {assetTypeAllowedInMenu('audio') ? (
            <button role="menuitem" type="button" onClick={() => createAssetFromMenu('audio')}>
              Audio Asset
            </button>
          ) : null}
          {addMenuFunctions.map((fn) => (
            <button key={fn.id} role="menuitem" type="button" onClick={() => createFunctionFromMenu(fn.id)}>
              {fn.name}
            </button>
          ))}
        </div>
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
