import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { get as getIdb, set as setIdb } from 'idb-keyval'
import { ComfyClient, type ComfyUploadImageOptions, type ComfyUploadImageResult } from '../domain/comfyClient'
import { ComfyServer, comfyFileFromResource } from '../domain/comfyServer'
import { extractComfyOutputs, type ComfyFileRef } from '../domain/comfyOutputs'
import { runComfyPrompt, type ComfyPromptClient } from '../domain/comfyRunner'
import {
  createOpenAIChatCompletionRequest,
  createOpenAILlmFunction,
  extractOpenAIChatCompletionText,
  isOpenAILlmFunction,
  mergedOpenAILlmConfig,
} from '../domain/openaiLlm'
import {
  createGeminiGenerateContentRequest,
  createGeminiLlmFunction,
  extractGeminiGenerateContentText,
  isGeminiLlmFunction,
  mergedGeminiLlmConfig,
} from '../domain/geminiLlm'
import {
  createOpenAIImageApiRequest,
  createOpenAIImageFunction,
  extractOpenAIImageGenerationOutputs,
  isOpenAIImageFunction,
  mergedOpenAIImageConfig,
} from '../domain/openaiImage'
import {
  createGeminiImageFunction,
  createGeminiImageGenerationRequest,
  extractGeminiImageGenerationOutputs,
  isGeminiImageFunction,
  mergedGeminiImageConfig,
} from '../domain/geminiImage'
import { createConfigPackage, createProjectPackage, type ConfigPackage, type FullProjectPackage } from '../domain/projectPackage'
import { randomizeWorkflowSeeds } from '../domain/seed'
import { selectEndpoint } from '../domain/scheduler'
import { createGenerationFunctionFromWorkflow, injectWorkflowInputs, workflowPrimitiveInputValue } from '../domain/workflow'
import { isBuiltInFunction, withoutBuiltInProjectFunctions } from '../domain/builtInFunctions'
import type { MediaResourcePayload, MediaResourceKind } from '../domain/resourceFiles'
import type {
  CanvasEdge,
  CanvasNode,
  ComfyEndpointConfig,
  ComfyWorkflow,
  ExecutionInputSnapshot,
  ExecutionTask,
  FunctionInputDef,
  GeminiImageConfig,
  GeminiLlmConfig,
  GenerationFunction,
  MediaResourceValue,
  OpenAIImageConfig,
  OpenAILlmConfig,
  PrimitiveInputValue,
  ProjectState,
  Resource,
  ResourceRef,
  ResourceType,
} from '../domain/types'

type RuntimeInputValues = Record<string, PrimitiveInputValue | ResourceRef>
type ConnectNodesOptions = {
  sourceHandleId?: string | null
  targetInputKey?: string | null
}
type AddFunctionNodeOptions = {
  autoBindRequiredInputs?: boolean
}
type NodeSelectionMode = 'replace' | 'add' | 'remove' | 'toggle'

type RuntimeComfyClient = ComfyPromptClient & {
  testConnection?: () => Promise<unknown>
  interrupt?: () => Promise<unknown>
  uploadImage?: (file: File, options?: ComfyUploadImageOptions) => Promise<ComfyUploadImageResult>
  viewFile?: (params: ComfyFileRef) => Promise<Blob>
}

type QueuedComfyRun = {
  taskId: string
  resultNodeId: string
  functionNodeId: string
  functionId: string
  functionDef: GenerationFunction
  inputValues: RuntimeInputValues
  compiledWorkflowSnapshot?: ComfyWorkflow
  seedPatchLog?: ExecutionTask['seedPatchLog']
  runIndex: number
  runTotal: number
  createdAt: string
  completion: Promise<void>
  resolveCompletion: () => void
}

type QueuedOpenAiRun = {
  taskId: string
  resultNodeId: string
  functionNodeId: string
  functionId: string
  functionDef: GenerationFunction
  inputValues: RuntimeInputValues
  config: OpenAILlmConfig
  runIndex: number
  runTotal: number
}

type QueuedGeminiRun = {
  taskId: string
  resultNodeId: string
  functionNodeId: string
  functionId: string
  functionDef: GenerationFunction
  inputValues: RuntimeInputValues
  config: GeminiLlmConfig
  runIndex: number
  runTotal: number
}

type QueuedOpenAIImageRun = {
  taskId: string
  resultNodeId: string
  functionNodeId: string
  functionId: string
  functionDef: GenerationFunction
  inputValues: RuntimeInputValues
  config: OpenAIImageConfig
  runIndex: number
  runTotal: number
}

type QueuedGeminiImageRun = {
  taskId: string
  resultNodeId: string
  functionNodeId: string
  functionId: string
  functionDef: GenerationFunction
  inputValues: RuntimeInputValues
  config: GeminiImageConfig
  runIndex: number
  runTotal: number
}

type ProjectStoreDeps = {
  idFactory: () => string
  now: () => string
  randomInt: (min: number, max: number) => number
  createComfyClient: (endpoint: ComfyEndpointConfig) => RuntimeComfyClient
  comfyRunOptions: {
    maxPollAttempts?: number
    pollIntervalMs?: number
  }
}

type ImportableConfig = Pick<ConfigPackage, 'config'>
type ImportableProject = Pick<FullProjectPackage, 'project'>
type ProjectCreateOptions = {
  name?: string
  description?: string
}
type ProjectMetadataPatch = {
  name?: string
  description?: string
}
export type ProjectLibraryPackage = {
  currentProjectId: string
  projects: Record<string, ProjectState>
}

type DesktopProjectStorage = {
  loadProjectLibrary: () => Promise<ProjectLibraryPackage | undefined>
  saveProjectLibrary: (payload: ProjectLibraryPackage) => Promise<{ ok: boolean; rootPath?: string; error?: string }>
}

declare global {
  interface Window {
    infinityComfyUIStorage?: DesktopProjectStorage
  }
}

export type ProjectStoreState = {
  project: ProjectState
  projectLibrary: Record<string, ProjectState>
  undoStack: ProjectState[]
  selectedNodeId?: string
  selectedNodeIds: string[]
  createProject: (options?: ProjectCreateOptions) => string
  switchProject: (projectId: string) => void
  updateProjectMetadata: (patch: ProjectMetadataPatch) => void
  deleteProject: (projectId: string) => void
  checkEndpointStatus: (endpointId: string) => Promise<void>
  checkComfyEndpointStatuses: () => Promise<void>
  fetchResourceBlob: (resourceId: string) => Promise<Blob>
  fetchComfyHistory: (endpointId: string, promptId: string) => Promise<unknown>
  addTextResource: (name: string, value: string) => void
  addTextResourceAtPosition: (name: string, value: string, position: { x: number; y: number }) => string
  addEmptyResourceAtPosition: (
    type: ResourceType,
    position: { x: number; y: number },
    initialValue?: string | number | null,
  ) => string | undefined
  addMediaResourceAtPosition: (
    type: MediaResourceKind,
    name: string,
    media: MediaResourcePayload,
    position: { x: number; y: number },
  ) => string
  updateTextResourceValue: (resourceId: string, value: string) => void
  updateNumberResourceValue: (resourceId: string, value: number) => void
  replaceResourceMedia: (resourceId: string, type: MediaResourceKind, media: MediaResourcePayload) => void
  addFunctionFromWorkflow: (name: string, workflow: ComfyWorkflow) => string
  updateFunction: (functionId: string, patch: Partial<Omit<GenerationFunction, 'id' | 'createdAt'>>) => void
  deleteFunction: (functionId: string) => void
  addFunctionNode: (functionId: string) => void
  addFunctionNodeAtPosition: (
    functionId: string,
    position: { x: number; y: number },
    options?: AddFunctionNodeOptions,
  ) => string | undefined
  updateFunctionNodeRunCount: (nodeId: string, runCount: number) => void
  updateFunctionNodeInputValue: (nodeId: string, inputKey: string, value: PrimitiveInputValue) => void
  updateFunctionNodeOpenAiConfig: (nodeId: string, patch: Partial<OpenAILlmConfig>) => void
  updateFunctionNodeGeminiConfig: (nodeId: string, patch: Partial<GeminiLlmConfig>) => void
  updateFunctionNodeOpenAiImageConfig: (nodeId: string, patch: Partial<OpenAIImageConfig>) => void
  updateFunctionNodeGeminiImageConfig: (nodeId: string, patch: Partial<GeminiImageConfig>) => void
  runFunctionNode: (nodeId: string, runCount?: number) => void
  runFunctionNodeWithComfy: (nodeId: string, runCount?: number) => Promise<void>
  rerunResultNode: (nodeId: string) => Promise<void>
  cancelResultRun: (nodeId: string) => void
  undoLastProjectChange: () => void
  connectNodes: (sourceNodeId: string, targetNodeId: string, options?: ConnectNodesOptions) => void
  deleteEdges: (edgeIds: string[]) => void
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void
  updateNodePositions: (positionsByNodeId: Record<string, { x: number; y: number }>) => void
  updateNodeSize: (nodeId: string, size: { width: number; height: number }) => void
  renameNode: (nodeId: string, title: string) => void
  deleteSelectedNode: () => void
  deleteNode: (nodeId: string) => void
  duplicateSelectedNode: () => void
  duplicateNodes: (nodeIds: string[]) => void
  selectNode: (nodeId?: string, mode?: NodeSelectionMode) => void
  selectNodes: (nodeIds: string[], mode?: NodeSelectionMode) => void
  addEndpoint: () => void
  updateEndpoint: (endpointId: string, patch: Partial<ComfyEndpointConfig>) => void
  deleteEndpoint: (endpointId: string) => void
  markEndpoint: (endpointId: string, status: NonNullable<ComfyEndpointConfig['health']>['status'], message?: string) => void
  exportProject: () => FullProjectPackage
  exportConfig: () => ConfigPackage
  importProject: (payload: ImportableProject) => void
  importConfig: (payload: ImportableConfig) => void
}

const defaultDeps: ProjectStoreDeps = {
  idFactory: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
  randomInt: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
  createComfyClient: (endpoint) =>
    new ComfyClient({
      baseUrl: endpoint.baseUrl,
      clientId: crypto.randomUUID(),
      token: endpoint.auth?.type === 'token' ? endpoint.auth.token : undefined,
      headers: endpoint.customHeaders,
    }),
  comfyRunOptions: {
    pollIntervalMs: 1000,
  },
}

const initialProject = (now: string, options: ProjectCreateOptions & { id?: string } = {}): ProjectState => {
  const openAiFunction = createOpenAILlmFunction(now)
  const geminiFunction = createGeminiLlmFunction(now)
  const openAiImageFunction = createOpenAIImageFunction(now)
  const geminiImageFunction = createGeminiImageFunction(now)
  return {
    schemaVersion: '1.0.0',
    project: {
      id: options.id ?? 'project_local',
      name: options.name ?? 'Infinity ComfyUI Project',
      description: options.description,
      createdAt: now,
      updatedAt: now,
    },
    canvas: {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    resources: {},
    assets: {},
    functions: {
      [openAiFunction.id]: openAiFunction,
      [geminiFunction.id]: geminiFunction,
      [openAiImageFunction.id]: openAiImageFunction,
      [geminiImageFunction.id]: geminiImageFunction,
    },
    tasks: {},
    comfy: {
      endpoints: [
        {
          id: 'endpoint_local',
          name: 'Local ComfyUI',
          baseUrl: 'http://127.0.0.1:8188',
          enabled: true,
          maxConcurrentJobs: 2,
          priority: 10,
          timeoutMs: 600000,
          auth: { type: 'none' },
          health: { status: 'unknown' },
        },
      ],
      scheduler: {
        strategy: 'least_busy',
        retry: { maxAttempts: 1, fallbackToOtherEndpoint: true },
      },
    },
  }
}

const syncBuiltInFunction = (current: GenerationFunction | undefined, latest: GenerationFunction): GenerationFunction => {
  if (!current) return latest

  return {
    ...latest,
    createdAt: current.createdAt ?? latest.createdAt,
    openai: current.openai ? { ...latest.openai, ...current.openai } : latest.openai,
    gemini: current.gemini ? { ...latest.gemini, ...current.gemini } : latest.gemini,
    openaiImage: current.openaiImage ? { ...latest.openaiImage, ...current.openaiImage } : latest.openaiImage,
    geminiImage: current.geminiImage ? { ...latest.geminiImage, ...current.geminiImage } : latest.geminiImage,
  }
}

const withBuiltInFunctions = (project: ProjectState, now: string): ProjectState => {
  const latestBuiltIns = [
    createOpenAILlmFunction(now),
    createGeminiLlmFunction(now),
    createOpenAIImageFunction(now),
    createGeminiImageFunction(now),
  ]
  const builtIns = Object.fromEntries(
    latestBuiltIns.map((builtInFunction) => [
      builtInFunction.id,
      syncBuiltInFunction(project.functions[builtInFunction.id], builtInFunction),
    ]),
  ) as Record<string, GenerationFunction>

  return {
    ...project,
    functions: {
      ...project.functions,
      ...builtIns,
    },
  }
}

const activeJobs = (tasks: Record<string, ExecutionTask>) =>
  Object.values(tasks).reduce<Record<string, number>>((counts, task) => {
    if (!task.endpointId) return counts
    if (['queued', 'running', 'fetching_outputs'].includes(task.status)) {
      counts[task.endpointId] = (counts[task.endpointId] ?? 0) + 1
    }
    return counts
  }, {})

const activeTaskStatuses = new Set<ExecutionTask['status']>(['queued', 'running', 'fetching_outputs'])

const endpointIsWorkerEligible = (endpoint: ComfyEndpointConfig) => {
  const status = endpoint.health?.status ?? 'unknown'
  return endpoint.enabled && (status === 'unknown' || status === 'online')
}

const endpointSupportsFunction = (endpoint: ComfyEndpointConfig, functionId: string) => {
  const supportedFunctions = endpoint.capabilities?.supportedFunctions
  return !supportedFunctions || supportedFunctions.length === 0 || supportedFunctions.includes(functionId)
}

const resourceNameForType = (type: ResourceType) => {
  if (type === 'text') return 'Prompt'
  if (type === 'image') return 'Image'
  if (type === 'video') return 'Video'
  if (type === 'audio') return 'Audio'
  return 'Number'
}

const emptyMediaPayload = (type: MediaResourceKind): MediaResourcePayload => ({
  url: '',
  filename: resourceNameForType(type),
  mimeType: `${type}/*`,
  sizeBytes: 0,
})

const mediaValueWithAsset = (assetId: string, media: MediaResourcePayload): MediaResourceValue => ({
  assetId,
  url: media.url,
  filename: media.filename,
  mimeType: media.mimeType,
  sizeBytes: media.sizeBytes,
  width: media.width,
  height: media.height,
  durationMs: media.durationMs,
  thumbnailUrl: media.thumbnailUrl,
  comfy: media.comfy,
})

const uniqueIds = (nodeIds: string[]) => [...new Set(nodeIds.filter(Boolean))]

const existingNodeIds = (nodes: CanvasNode[], nodeIds: string[]) => {
  const existing = new Set(nodes.map((node) => node.id))
  return uniqueIds(nodeIds).filter((nodeId) => existing.has(nodeId))
}

const nextSelection = (
  nodes: CanvasNode[],
  currentNodeIds: string[],
  incomingNodeIds: string[],
  mode: NodeSelectionMode = 'replace',
) => {
  const current = existingNodeIds(nodes, currentNodeIds)
  const incoming = existingNodeIds(nodes, incomingNodeIds)

  if (mode === 'add') return uniqueIds([...current, ...incoming])
  if (mode === 'remove') {
    const incomingSet = new Set(incoming)
    return current.filter((nodeId) => !incomingSet.has(nodeId))
  }
  if (mode === 'toggle') {
    const currentSet = new Set(current)
    const toggled = current.filter((nodeId) => !incoming.includes(nodeId))
    for (const nodeId of incoming) {
      if (!currentSet.has(nodeId)) toggled.push(nodeId)
    }
    return toggled
  }

  return incoming
}

const selectedState = (nodeIds: string[]) => ({
  selectedNodeIds: nodeIds,
  selectedNodeId: nodeIds.at(-1),
})

const sameNodeIds = (left: string[], right: string[]) =>
  left.length === right.length && left.every((nodeId, index) => nodeId === right[index])

const latestResourceRefByType = (
  resources: Record<string, Resource>,
  type: ResourceType,
): ResourceRef | undefined => {
  const resource = Object.values(resources)
    .filter((item) => item.type === type)
    .toReversed()[0]
  return resource ? { resourceId: resource.id, type: resource.type } : undefined
}

const defaultInputValues = (
  inputs: FunctionInputDef[],
  resources: Record<string, Resource>,
): RuntimeInputValues => {
  const values: RuntimeInputValues = {}

  for (const input of inputs) {
    if (!input.required) continue
    const resourceRef = latestResourceRefByType(resources, input.type)
    if (resourceRef) values[input.key] = resourceRef
  }

  return values
}

const inputValueSatisfiesDefinition = (
  input: FunctionInputDef,
  value: PrimitiveInputValue | ResourceRef | undefined,
  resources: Record<string, Resource>,
) => {
  if (isResourceRef(value)) return resources[value.resourceId]?.type === input.type
  if (value === undefined || value === null) return false
  if (input.type === 'text') return String(value).trim().length > 0
  if (input.type === 'number') return Number.isFinite(Number(value))
  return false
}

const missingRequiredInputKeys = (
  inputs: FunctionInputDef[],
  inputValues: RuntimeInputValues,
  resources: Record<string, Resource>,
) =>
  inputs
    .filter((input) => input.required && !inputValueSatisfiesDefinition(input, inputValues[input.key], resources))
    .map((input) => input.key)

const matchingInputKey = (
  inputs: FunctionInputDef[],
  resourceType: ResourceType,
  currentInputValues: RuntimeInputValues,
) => {
  const candidates = inputs.filter((input) => input.type === resourceType)

  return (
    candidates.find((input) => input.required && !currentInputValues[input.key])?.key ??
    candidates.find((input) => !currentInputValues[input.key])?.key ??
    candidates.find((input) => input.required)?.key ??
    candidates[0]?.key
  )
}

const inputKeyForConnection = (
  inputs: FunctionInputDef[],
  resourceType: ResourceType,
  currentInputValues: RuntimeInputValues,
  targetInputKey?: string | null,
) => {
  if (targetInputKey) {
    const input = inputs.find((item) => item.key === targetInputKey)
    if (!input || input.type !== resourceType) return undefined
    return input.key
  }

  return matchingInputKey(inputs, resourceType, currentInputValues)
}

const resourceIdFromHandle = (handleId?: string | null) => {
  if (!handleId) return undefined
  if (handleId.startsWith('resource:')) return handleId.slice('resource:'.length)
  if (handleId.startsWith('result:')) return handleId.slice('result:'.length)
  return undefined
}

const sourceHandleForResource = (node: CanvasNode, resourceId: string) =>
  node.type === 'result_group' ? `result:${resourceId}` : `resource:${resourceId}`

const nodeResourceRefs = (node: CanvasNode): ResourceRef[] => {
  if (node.type === 'resource' && typeof node.data.resourceId === 'string') {
    return [{ resourceId: node.data.resourceId, type: String(node.data.resourceType ?? 'text') as ResourceType }]
  }

  if (node.type !== 'result_group' || !Array.isArray(node.data.resources)) return []

  return node.data.resources
    .map((resource) => {
      if (typeof resource !== 'object' || resource === null) return undefined
      const resourceId = 'resourceId' in resource ? String((resource as { resourceId: unknown }).resourceId) : undefined
      const type = 'type' in resource ? String((resource as { type: unknown }).type) : undefined
      if (!resourceId || !type) return undefined
      return { resourceId, type: type as ResourceType }
    })
    .filter((resource): resource is ResourceRef => Boolean(resource))
}

const DEFAULT_RESOURCE_X = 80
const DEFAULT_RESOURCE_Y = 220
const DEFAULT_FUNCTION_X = 420
const DEFAULT_FUNCTION_Y = 260
const RESULT_NODE_GAP_X = 48
const FUNCTION_NODE_ESTIMATED_WIDTH = 520
const FUNCTION_NODE_ESTIMATED_HEIGHT = 220
const OPENAI_FUNCTION_NODE_ESTIMATED_WIDTH = 430
const OPENAI_FUNCTION_NODE_ESTIMATED_HEIGHT = 640
const GEMINI_FUNCTION_NODE_ESTIMATED_WIDTH = 430
const GEMINI_FUNCTION_NODE_ESTIMATED_HEIGHT = 640
const IMAGE_FUNCTION_NODE_ESTIMATED_WIDTH = 430
const IMAGE_FUNCTION_NODE_ESTIMATED_HEIGHT = 640
const RESULT_NODE_ESTIMATED_WIDTH = 300

const normalizedRunCount = (value: unknown) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return 1
  return Math.max(1, Math.min(99, Math.floor(numberValue)))
}

const functionNodeEstimatedSize = (functionDef?: GenerationFunction) => {
  if (functionDef && isOpenAILlmFunction(functionDef)) {
    return {
      width: OPENAI_FUNCTION_NODE_ESTIMATED_WIDTH,
      height: OPENAI_FUNCTION_NODE_ESTIMATED_HEIGHT,
    }
  }
  if (functionDef && isGeminiLlmFunction(functionDef)) {
    return {
      width: GEMINI_FUNCTION_NODE_ESTIMATED_WIDTH,
      height: GEMINI_FUNCTION_NODE_ESTIMATED_HEIGHT,
    }
  }
  if (functionDef && (isOpenAIImageFunction(functionDef) || isGeminiImageFunction(functionDef))) {
    return {
      width: IMAGE_FUNCTION_NODE_ESTIMATED_WIDTH,
      height: IMAGE_FUNCTION_NODE_ESTIMATED_HEIGHT,
    }
  }
  return {
    width: FUNCTION_NODE_ESTIMATED_WIDTH,
    height: FUNCTION_NODE_ESTIMATED_HEIGHT,
  }
}

const nodeStoredSize = (node: CanvasNode) => {
  const size = node.data.size
  if (!size || typeof size !== 'object') return undefined
  const width = Number((size as { width?: unknown }).width)
  const height = Number((size as { height?: unknown }).height)
  return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : undefined
}

const nextResultNodePosition = (nodes: CanvasNode[], functionNode: CanvasNode, functionDef?: GenerationFunction) => {
  const existingResultNodes = nodes.filter(
    (node) => node.type === 'result_group' && node.data.sourceFunctionNodeId === functionNode.id,
  )
  const functionSize = nodeStoredSize(functionNode) ?? functionNodeEstimatedSize(functionDef)
  const existingRightEdges = existingResultNodes.map((node) => node.position.x + RESULT_NODE_ESTIMATED_WIDTH)
  const maxRightEdge = Math.max(functionNode.position.x + functionSize.width, ...existingRightEdges)

  return {
    x: maxRightEdge + RESULT_NODE_GAP_X,
    y: functionNode.position.y,
  }
}

const existingFunctionRunIndex = (project: ProjectState, functionNodeId: string) => {
  const taskRunIndices = Object.values(project.tasks)
    .filter((task) => task.functionNodeId === functionNodeId)
    .map((task) => Number(task.runIndex))
  const nodeRunIndices = project.canvas.nodes
    .filter((node) => node.type === 'result_group' && node.data.sourceFunctionNodeId === functionNodeId)
    .map((node) => Number(node.data.runIndex))
  const validRunIndices = [...taskRunIndices, ...nodeRunIndices].filter((value) => Number.isFinite(value))
  return validRunIndices.length > 0 ? Math.max(...validRunIndices) : 0
}

const functionRunRange = (project: ProjectState, functionNodeId: string, runCount: number) => {
  const start = existingFunctionRunIndex(project, functionNodeId) + 1
  return {
    start,
    total: start + runCount - 1,
  }
}

const tasksWithRunTotal = (
  tasks: Record<string, ExecutionTask>,
  functionNodeId: string,
  runTotal: number,
): Record<string, ExecutionTask> =>
  Object.fromEntries(
    Object.entries(tasks).map(([taskId, task]) => [
      taskId,
      task.functionNodeId === functionNodeId ? { ...task, runTotal } : task,
    ]),
  )

const nodesWithRunTotal = (nodes: CanvasNode[], functionNodeId: string, runTotal: number) =>
  nodes.map((node) =>
    node.type === 'result_group' && node.data.sourceFunctionNodeId === functionNodeId
      ? { ...node, data: { ...node.data, runTotal } }
      : node,
  )

const isResourceRef = (value: PrimitiveInputValue | ResourceRef | undefined): value is ResourceRef =>
  typeof value === 'object' && value !== null && 'resourceId' in value

const resourceInputRefs = (inputValues: RuntimeInputValues): Record<string, ResourceRef> =>
  Object.fromEntries(
    Object.entries(inputValues).filter((entry): entry is [string, ResourceRef] => isResourceRef(entry[1])),
  )

const resourceInputSnapshot = (
  inputValues: RuntimeInputValues,
  resources: Record<string, Resource>,
): Record<string, Resource> =>
  Object.fromEntries(
    Object.entries(resourceInputRefs(inputValues))
      .map(([key, ref]) => [key, resources[ref.resourceId]])
      .filter((entry): entry is [string, Resource] => Boolean(entry[1])),
  )

const valueForInputSnapshot = (resource: Resource | undefined, fallback: PrimitiveInputValue) => {
  if (!resource) return fallback
  return resource.value
}

const executionInputSnapshot = (
  functionDef: GenerationFunction,
  inputValues: RuntimeInputValues,
  resources: Record<string, Resource>,
): Record<string, ExecutionInputSnapshot> =>
  Object.fromEntries(
    functionDef.inputs.map((input) => {
      const value = inputValues[input.key]
      if (isResourceRef(value)) {
        const resource = resources[value.resourceId]
        return [
          input.key,
          {
            key: input.key,
            label: input.label,
            type: input.type,
            required: input.required,
            source: 'resource',
            value: valueForInputSnapshot(resource, null),
            resourceId: value.resourceId,
            resourceName: resource?.name,
          },
        ]
      }

      if (value !== undefined) {
        return [
          input.key,
          {
            key: input.key,
            label: input.label,
            type: input.type,
            required: input.required,
            source: 'inline',
            value,
          },
        ]
      }

      const defaultValue = workflowPrimitiveInputValue(functionDef, input) ?? input.defaultValue
      if (defaultValue !== undefined) {
        return [
          input.key,
          {
            key: input.key,
            label: input.label,
            type: input.type,
            required: input.required,
            source: 'default',
            value: defaultValue,
          },
        ]
      }

      return [
        input.key,
        {
          key: input.key,
          label: input.label,
          type: input.type,
          required: input.required,
          source: 'missing',
          value: null,
        },
      ]
    }),
  )

const comfyViewUrl = (endpoint: ComfyEndpointConfig, file: ComfyFileRef) => {
  const params = new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder ?? '',
    type: file.type,
  })
  return `${endpoint.baseUrl.replace(/\/+$/, '')}/view?${params.toString()}`
}

const outputMimeType = (type: ResourceType, filename: string) => {
  const extension = filename.split('.').pop()?.toLowerCase()
  if (type === 'image') {
    if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
    if (extension === 'webp') return 'image/webp'
    return 'image/png'
  }
  if (type === 'video') {
    if (extension === 'webm') return 'video/webm'
    if (extension === 'mov') return 'video/quicktime'
    return 'video/mp4'
  }
  if (type === 'audio') {
    if (extension === 'mp3') return 'audio/mpeg'
    if (extension === 'ogg') return 'audio/ogg'
    return 'audio/wav'
  }

  return 'text/plain'
}

const uploadedImageValue = (result: ComfyUploadImageResult) =>
  result.subfolder ? `${result.subfolder}/${result.name}` : result.name

const resourceFilename = (resource: Resource) => {
  if (typeof resource.value === 'object' && resource.value !== null && 'filename' in resource.value && resource.value.filename) {
    return resource.value.filename
  }

  return `${resource.name ?? resource.id}.png`
}

const resourceMimeType = (resource: Resource) => {
  if (typeof resource.value === 'object' && resource.value !== null && 'mimeType' in resource.value) {
    return resource.value.mimeType
  }

  return 'image/png'
}

const resourceUrl = (resource: Resource) => {
  if (typeof resource.value === 'object' && resource.value !== null && 'url' in resource.value) return resource.value.url
  if (typeof resource.value === 'string') return resource.value
  return undefined
}

const dataUrlToBlob = (url: string) => {
  const match = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/)
  if (!match) return undefined
  const mimeType = match[1] || 'application/octet-stream'
  const payload = match[3] ?? ''
  const binary = match[2] ? atob(payload) : decodeURIComponent(payload)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: mimeType })
}

const fetchUrlBlob = async (url: string) => {
  const dataBlob = dataUrlToBlob(url)
  if (dataBlob) return dataBlob
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Resource fetch failed: ${response.status}`)
  return response.blob()
}

const comfyEndpointForResource = (project: ProjectState, resource: Resource) =>
  project.comfy.endpoints.find((endpoint) => comfyFileFromResource(resource, endpoint))

const readProjectResourceBlob = async (
  project: ProjectState,
  resource: Resource,
  createComfyClient: ProjectStoreDeps['createComfyClient'],
) => {
  const endpoint = comfyEndpointForResource(project, resource)
  if (endpoint) {
    const server = new ComfyServer(endpoint, createComfyClient(endpoint))
    return server.readResourceBlob(resource)
  }

  const url = resourceUrl(resource)
  if (!url) throw new Error(`Resource is missing a URL: ${resource.id}`)
  return fetchUrlBlob(url)
}

const prepareComfyInputValues = async (
  client: RuntimeComfyClient,
  inputs: FunctionInputDef[],
  inputValues: RuntimeInputValues,
  resources: Record<string, Resource>,
  loadResourceBlob: (resource: Resource) => Promise<Blob>,
): Promise<RuntimeInputValues> => {
  const prepared: RuntimeInputValues = { ...inputValues }

  for (const input of inputs) {
    if (input.type !== 'image' || input.upload?.strategy !== 'comfy_upload') continue
    const value = prepared[input.key]
    if (!value || !isResourceRef(value)) continue

    if (!client.uploadImage) throw new Error('ComfyUI image upload is not available')
    const resource = resources[value.resourceId]
    if (!resource) throw new Error(`Resource not found: ${value.resourceId}`)
    const url = resourceUrl(resource)
    if (!url) throw new Error(`Image resource is missing a URL: ${value.resourceId}`)

    const blob = await loadResourceBlob(resource)
    const file = new File([blob], resourceFilename(resource), { type: blob.type || resourceMimeType(resource) })
    const uploaded = await client.uploadImage(file, {
      subfolder: input.upload.targetSubfolder,
      overwrite: true,
    })

    prepared[input.key] = uploadedImageValue(uploaded)
  }

  return prepared
}

const snapshotFormData = (formData: FormData) =>
  Object.fromEntries(
    [...formData.entries()].map(([key, value]) => [
      key,
      value instanceof File ? { name: value.name, type: value.type, size: value.size } : value,
    ]),
  )

const chatCompletionsUrl = (baseUrl: string) =>
  `${(baseUrl.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '')}/chat/completions`

const openAiImagesGenerationsUrl = (baseUrl: string) =>
  `${(baseUrl.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '')}/images/generations`

const openAiImagesEditsUrl = (baseUrl: string) =>
  `${(baseUrl.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '')}/images/edits`

const geminiGenerateContentUrl = (baseUrl: string, model: string) => {
  const modelName = model.trim() || 'gemini-2.5-flash'
  const modelPath = modelName.startsWith('models/') ? modelName : `models/${modelName}`
  return `${(baseUrl.trim() || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '')}/${modelPath}:generateContent`
}

export function createProjectSlice(deps: Partial<ProjectStoreDeps> = {}): StoreApi<ProjectStoreState> {
  const runtime = { ...defaultDeps, ...deps }
  const comfyQueue: QueuedComfyRun[] = []
  const activeComfyWorkerEndpointIds = new Set<string>()

  return createStore<ProjectStoreState>((set, get) => {
    const markMissingInputs = (nodeId: string, missingInputKeys: string[]) => {
      const now = runtime.now()
      set((current) => ({
        project: {
          ...current.project,
          project: { ...current.project.project, updatedAt: now },
          canvas: {
            ...current.project.canvas,
            nodes: current.project.canvas.nodes.map((node) => {
              if (node.id !== nodeId || node.type !== 'function') return node
              const status = missingInputKeys.length
                ? 'missing_inputs'
                : node.data.status === 'missing_inputs'
                  ? 'idle'
                  : node.data.status
              return {
                ...node,
                data: {
                  ...node.data,
                  missingInputKeys,
                  status,
                },
              }
            }),
          },
        },
      }))
    }

    const validateRequiredInputs = (
      nodeId: string,
      functionDef: GenerationFunction,
      inputValues: RuntimeInputValues,
      resources: Record<string, Resource>,
    ) => {
      const missingInputKeys = missingRequiredInputKeys(functionDef.inputs, inputValues, resources)
      markMissingInputs(nodeId, missingInputKeys)
      return missingInputKeys
    }

    const taskWasCanceled = (taskId: string) => get().project.tasks[taskId]?.status === 'canceled'

    const resourceIdsForResultNode = (node: CanvasNode, taskId?: string) => {
      const explicitIds = Array.isArray(node.data.resources)
        ? node.data.resources
            .map((resource) =>
              typeof resource === 'object' && resource !== null && 'resourceId' in resource
                ? String((resource as { resourceId: unknown }).resourceId)
                : undefined,
            )
            .filter((resourceId): resourceId is string => Boolean(resourceId))
        : []
      const ownedIds = Object.values(get().project.resources)
        .filter((resource) => resource.source.resultGroupNodeId === node.id || (taskId && resource.source.taskId === taskId))
        .map((resource) => resource.id)
      return new Set([...explicitIds, ...ownedIds])
    }

    const assetIdsForResources = (resources: Resource[]) =>
      new Set(
        resources
          .map((resource) =>
            typeof resource.value === 'object' && resource.value !== null && 'assetId' in resource.value
              ? String(resource.value.assetId)
              : undefined,
          )
          .filter((assetId): assetId is string => Boolean(assetId)),
      )

    const resetResultNodeForRetry = (resultNodeId: string, taskId: string, now: string) => {
      set((current) => {
        const resultNode = current.project.canvas.nodes.find((node) => node.id === resultNodeId && node.type === 'result_group')
        const task = current.project.tasks[taskId]
        if (!resultNode || !task) return current

        const resourceIdsToRemove = resourceIdsForResultNode(resultNode, taskId)
        const resourcesToRemove = [...resourceIdsToRemove]
          .map((resourceId) => current.project.resources[resourceId])
          .filter((resource): resource is Resource => Boolean(resource))
        const assetIdsToRemove = assetIdsForResources(resourcesToRemove)

        return {
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: now },
            resources: Object.fromEntries(
              Object.entries(current.project.resources).filter(([resourceId]) => !resourceIdsToRemove.has(resourceId)),
            ),
            assets: Object.fromEntries(
              Object.entries(current.project.assets).filter(([assetId]) => !assetIdsToRemove.has(assetId)),
            ),
            tasks: {
              ...current.project.tasks,
              [taskId]: {
                ...task,
                status: 'queued',
                comfyPromptId: undefined,
                outputRefs: {},
                error: undefined,
                updatedAt: now,
                completedAt: undefined,
              },
            },
            canvas: {
              ...current.project.canvas,
              nodes: current.project.canvas.nodes.map((node) =>
                node.id === resultNodeId
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        resources: [],
                        status: 'queued',
                        error: undefined,
                        completedAt: undefined,
                      },
                    }
                  : node,
              ),
            },
          },
        }
      })
    }

    const failResultRunInPlace = (
      resultNodeId: string,
      taskId: string,
      code: string,
      message: string,
      raw?: unknown,
    ) => {
      const failedAt = runtime.now()
      set((current) => {
        const task = current.project.tasks[taskId]
        if (!task) return current
        return {
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: failedAt },
            tasks: {
              ...current.project.tasks,
              [taskId]: {
                ...task,
                status: 'failed',
                error: { code, message, raw },
                updatedAt: failedAt,
                completedAt: failedAt,
              },
            },
            canvas: {
              ...current.project.canvas,
              nodes: current.project.canvas.nodes.map((node) =>
                node.id === resultNodeId
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        status: 'failed',
                        error: { code, message },
                        completedAt: failedAt,
                      },
                    }
                  : node,
              ),
            },
          },
        }
      })
    }

    const takeNextQueuedRun = (endpoint: ComfyEndpointConfig) => {
      const index = comfyQueue.findIndex((item) => endpointSupportsFunction(endpoint, item.functionId))
      if (index < 0) return undefined
      return comfyQueue.splice(index, 1)[0]
    }

    const executeComfyQueueItem = async (item: QueuedComfyRun, endpoint: ComfyEndpointConfig) => {
      if (taskWasCanceled(item.taskId)) {
        item.resolveCompletion()
        return
      }

      const startedAt = runtime.now()
      set((current) => ({
        project: {
          ...current.project,
          project: { ...current.project.project, updatedAt: startedAt },
          tasks: {
            ...current.project.tasks,
            [item.taskId]: {
              ...current.project.tasks[item.taskId]!,
              status: 'running',
              endpointId: endpoint.id,
              startedAt,
              updatedAt: startedAt,
            },
          },
          canvas: {
            ...current.project.canvas,
            nodes: current.project.canvas.nodes.map((node) =>
              node.id === item.resultNodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      endpointId: endpoint.id,
                      status: 'running',
                      startedAt,
                    },
                  }
                : node,
            ),
          },
        },
      }))

      try {
        if (taskWasCanceled(item.taskId)) return
        const client = runtime.createComfyClient(endpoint)
        let workflowForRun: ComfyWorkflow
        let seedPatchLog = item.seedPatchLog ?? []

        if (item.compiledWorkflowSnapshot) {
          workflowForRun = structuredClone(item.compiledWorkflowSnapshot)
        } else {
          const preparedInputValues = await prepareComfyInputValues(
            client,
            item.functionDef.inputs,
            item.inputValues,
            get().project.resources,
            (resource) => readProjectResourceBlob(get().project, resource, runtime.createComfyClient),
          )
          if (taskWasCanceled(item.taskId)) return
          const compiledWithInputs = injectWorkflowInputs(
            item.functionDef.workflow.rawJson,
            item.functionDef.inputs,
            preparedInputValues,
            get().project.resources,
          )
          const randomized = randomizeWorkflowSeeds(compiledWithInputs, {
            now: runtime.now,
            randomInt: runtime.randomInt,
          })
          workflowForRun = randomized.workflow
          seedPatchLog = randomized.patchLog
        }

        set((current) => ({
          project: {
            ...current.project,
            tasks: {
              ...current.project.tasks,
              [item.taskId]: {
                ...current.project.tasks[item.taskId]!,
                compiledWorkflowSnapshot: workflowForRun,
                requestSnapshot: workflowForRun,
                seedPatchLog,
                updatedAt: runtime.now(),
              },
            },
            canvas: {
              ...current.project.canvas,
              nodes: current.project.canvas.nodes.map((node) =>
                node.id === item.resultNodeId
                  ? {
                    ...node,
                    data: {
                      ...node.data,
                      seedPatchLog,
                    },
                  }
                : node,
              ),
            },
          },
        }))

        if (taskWasCanceled(item.taskId)) return
        const result = await runComfyPrompt(client, workflowForRun, runtime.comfyRunOptions)
        if (taskWasCanceled(item.taskId)) return
        const outputs = extractComfyOutputs(result.history, workflowForRun, item.functionDef.outputs)
        const resourceRefs: ResourceRef[] = []
        const outputRefsByKey: Record<string, ResourceRef[]> = {}
        const newResources: Record<string, Resource> = {}
        const newAssets: ProjectState['assets'] = {}

        for (const output of outputs) {
          const outputRefs: ResourceRef[] = []
          for (const file of output.files) {
            const assetId = runtime.idFactory()
            const resourceId = runtime.idFactory()
            const url = comfyViewUrl(endpoint, file)
            const mimeType = outputMimeType(output.type, file.filename)

            newAssets[assetId] = {
              id: assetId,
              name: file.filename,
              mimeType,
              sizeBytes: 0,
              blobUrl: url,
              createdAt: runtime.now(),
            }
            newResources[resourceId] = {
              id: resourceId,
              type: output.type,
              name: file.filename,
              value: {
                assetId,
                url,
                filename: file.filename,
                mimeType,
                sizeBytes: 0,
                comfy: {
                  endpointId: endpoint.id,
                  filename: file.filename,
                  subfolder: file.subfolder ?? '',
                  type: file.type,
                },
              },
              source: {
                kind: 'function_output',
                functionNodeId: item.functionNodeId,
                resultGroupNodeId: item.resultNodeId,
                taskId: item.taskId,
                outputKey: output.key,
              },
              metadata: {
                workflowFunctionId: item.functionId,
                endpointId: endpoint.id,
                createdAt: runtime.now(),
              },
            }
            outputRefs.push({ resourceId, type: output.type })
          }

          for (const text of output.texts ?? []) {
            const resourceId = runtime.idFactory()
            newResources[resourceId] = {
              id: resourceId,
              type: 'text',
              name: output.key,
              value: text,
              source: {
                kind: 'function_output',
                functionNodeId: item.functionNodeId,
                resultGroupNodeId: item.resultNodeId,
                taskId: item.taskId,
                outputKey: output.key,
              },
              metadata: {
                workflowFunctionId: item.functionId,
                endpointId: endpoint.id,
                createdAt: runtime.now(),
              },
            }
            outputRefs.push({ resourceId, type: 'text' })
          }

          outputRefsByKey[output.key] = outputRefs
          resourceRefs.push(...outputRefs)
        }

        if (taskWasCanceled(item.taskId)) return
        const completedAt = runtime.now()
        set((current) => ({
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: runtime.now() },
            resources: { ...current.project.resources, ...newResources },
            assets: { ...current.project.assets, ...newAssets },
            tasks: {
              ...current.project.tasks,
              [item.taskId]: {
                ...current.project.tasks[item.taskId]!,
                status: 'succeeded',
                comfyPromptId: result.promptId,
                outputRefs: outputRefsByKey,
                updatedAt: runtime.now(),
                completedAt,
              },
            },
            canvas: {
              ...current.project.canvas,
              nodes: current.project.canvas.nodes.map((node) =>
                node.id === item.resultNodeId
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        resources: resourceRefs,
                        status: 'succeeded',
                        completedAt,
                      },
                    }
                  : node,
              ),
            },
          },
        }))
      } catch (err) {
        if (taskWasCanceled(item.taskId)) return
        const failedAt = runtime.now()
        const errorMessage = err instanceof Error ? err.message : 'ComfyUI execution failed'
        const taskError = {
          code: 'comfy_execution_failed',
          message: errorMessage,
          raw: err,
        }
        const nodeError = {
          code: taskError.code,
          message: errorMessage,
        }
        set((current) => ({
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: failedAt },
            tasks: {
              ...current.project.tasks,
              [item.taskId]: {
                ...current.project.tasks[item.taskId]!,
                status: 'failed',
                error: taskError,
                updatedAt: failedAt,
                completedAt: failedAt,
              },
            },
            canvas: {
              ...current.project.canvas,
              nodes: current.project.canvas.nodes.map((node) =>
                node.id === item.resultNodeId
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        status: 'failed',
                        error: nodeError,
                        completedAt: failedAt,
                      },
                    }
                  : node,
              ),
            },
          },
        }))
      } finally {
        item.resolveCompletion()
      }
    }

    const executeOpenAiQueueItem = async (item: QueuedOpenAiRun) => {
      if (taskWasCanceled(item.taskId)) return
      const startedAt = runtime.now()
      set((current) => ({
        project: {
          ...current.project,
          project: { ...current.project.project, updatedAt: startedAt },
          tasks: {
            ...current.project.tasks,
            [item.taskId]: {
              ...current.project.tasks[item.taskId]!,
              status: 'running',
              endpointId: 'openai',
              startedAt,
              updatedAt: startedAt,
            },
          },
          canvas: {
            ...current.project.canvas,
            nodes: current.project.canvas.nodes.map((node) =>
              node.id === item.resultNodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      endpointId: 'openai',
                      status: 'running',
                      startedAt,
                    },
                  }
                : node,
            ),
          },
        },
      }))

      try {
        if (!item.config.apiKey.trim()) throw new Error('OpenAI API key is required')

        const request = await createOpenAIChatCompletionRequest(
          item.config,
          item.inputValues,
          get().project.resources,
          (resource) => readProjectResourceBlob(get().project, resource, runtime.createComfyClient),
        )
        if (request.messages.length === 0) throw new Error('OpenAI messages are empty')
        set((current) => ({
          project: {
            ...current.project,
            tasks: {
              ...current.project.tasks,
              [item.taskId]: {
                ...current.project.tasks[item.taskId]!,
                requestSnapshot: structuredClone(request),
                updatedAt: runtime.now(),
              },
            },
          },
        }))

        const response = await fetch(chatCompletionsUrl(item.config.baseUrl), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${item.config.apiKey.trim()}`,
          },
          body: JSON.stringify(request),
        })
        if (!response.ok) {
          const errorText = await response.text().catch(() => '')
          throw new Error(`OpenAI request failed: ${response.status}${errorText ? ` ${errorText}` : ''}`)
        }

        const responseJson = await response.json()
        const outputText = extractOpenAIChatCompletionText(responseJson)
        if (!outputText) throw new Error('OpenAI response did not include output text')

        const resourceId = runtime.idFactory()
        const outputKey = item.functionDef.outputs[0]?.key ?? 'text'
        const completedAt = runtime.now()
        const resource: Resource = {
          id: resourceId,
          type: 'text',
          name: `${item.functionDef.name} Run ${item.runIndex}`,
          value: outputText,
          source: {
            kind: 'function_output',
            functionNodeId: item.functionNodeId,
            resultGroupNodeId: item.resultNodeId,
            taskId: item.taskId,
            outputKey,
          },
          metadata: {
            workflowFunctionId: item.functionId,
            endpointId: 'openai',
            createdAt: completedAt,
          },
        }

        if (taskWasCanceled(item.taskId)) return
        set((current) => ({
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: runtime.now() },
            resources: { ...current.project.resources, [resourceId]: resource },
            tasks: {
              ...current.project.tasks,
              [item.taskId]: {
                ...current.project.tasks[item.taskId]!,
                status: 'succeeded',
                compiledWorkflowSnapshot: {},
                outputRefs: { [outputKey]: [{ resourceId, type: 'text' }] },
                updatedAt: runtime.now(),
                completedAt,
              },
            },
            canvas: {
              ...current.project.canvas,
              nodes: current.project.canvas.nodes.map((node) =>
                node.id === item.resultNodeId
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        resources: [{ resourceId, type: 'text' }],
                        status: 'succeeded',
                        completedAt,
                      },
                    }
                  : node,
              ),
            },
          },
        }))
      } catch (err) {
        if (taskWasCanceled(item.taskId)) return
        const failedAt = runtime.now()
        const errorMessage = err instanceof Error ? err.message : 'OpenAI execution failed'
        const taskError = {
          code: 'openai_execution_failed',
          message: errorMessage,
          raw: err,
        }
        const nodeError = {
          code: taskError.code,
          message: errorMessage,
        }
        set((current) => ({
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: failedAt },
            tasks: {
              ...current.project.tasks,
              [item.taskId]: {
                ...current.project.tasks[item.taskId]!,
                status: 'failed',
                error: taskError,
                updatedAt: failedAt,
                completedAt: failedAt,
              },
            },
            canvas: {
              ...current.project.canvas,
              nodes: current.project.canvas.nodes.map((node) =>
                node.id === item.resultNodeId
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        status: 'failed',
                        error: nodeError,
                        completedAt: failedAt,
                      },
                    }
                  : node,
              ),
            },
          },
        }))
      }
    }

    const executeGeminiQueueItem = async (item: QueuedGeminiRun) => {
      if (taskWasCanceled(item.taskId)) return
      const startedAt = runtime.now()
      set((current) => ({
        project: {
          ...current.project,
          project: { ...current.project.project, updatedAt: startedAt },
          tasks: {
            ...current.project.tasks,
            [item.taskId]: {
              ...current.project.tasks[item.taskId]!,
              status: 'running',
              endpointId: 'gemini',
              startedAt,
              updatedAt: startedAt,
            },
          },
          canvas: {
            ...current.project.canvas,
            nodes: current.project.canvas.nodes.map((node) =>
              node.id === item.resultNodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      endpointId: 'gemini',
                      status: 'running',
                      startedAt,
                    },
                  }
                : node,
            ),
          },
        },
      }))

      try {
        if (!item.config.apiKey.trim()) throw new Error('Gemini API key is required')

        const request = await createGeminiGenerateContentRequest(
          item.config,
          item.inputValues,
          get().project.resources,
          (resource) => readProjectResourceBlob(get().project, resource, runtime.createComfyClient),
        )
        if (request.contents.length === 0) throw new Error('Gemini contents are empty')
        set((current) => ({
          project: {
            ...current.project,
            tasks: {
              ...current.project.tasks,
              [item.taskId]: {
                ...current.project.tasks[item.taskId]!,
                requestSnapshot: structuredClone(request),
                updatedAt: runtime.now(),
              },
            },
          },
        }))

        const response = await fetch(geminiGenerateContentUrl(item.config.baseUrl, item.config.model), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': item.config.apiKey.trim(),
          },
          body: JSON.stringify(request),
        })
        if (!response.ok) {
          const errorText = await response.text().catch(() => '')
          throw new Error(`Gemini request failed: ${response.status}${errorText ? ` ${errorText}` : ''}`)
        }

        const responseJson = await response.json()
        const outputText = extractGeminiGenerateContentText(responseJson)
        if (!outputText) throw new Error('Gemini response did not include output text')

        const resourceId = runtime.idFactory()
        const outputKey = item.functionDef.outputs[0]?.key ?? 'text'
        const completedAt = runtime.now()
        const resource: Resource = {
          id: resourceId,
          type: 'text',
          name: `${item.functionDef.name} Run ${item.runIndex}`,
          value: outputText,
          source: {
            kind: 'function_output',
            functionNodeId: item.functionNodeId,
            resultGroupNodeId: item.resultNodeId,
            taskId: item.taskId,
            outputKey,
          },
          metadata: {
            workflowFunctionId: item.functionId,
            endpointId: 'gemini',
            createdAt: completedAt,
          },
        }

        if (taskWasCanceled(item.taskId)) return
        set((current) => ({
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: runtime.now() },
            resources: { ...current.project.resources, [resourceId]: resource },
            tasks: {
              ...current.project.tasks,
              [item.taskId]: {
                ...current.project.tasks[item.taskId]!,
                status: 'succeeded',
                compiledWorkflowSnapshot: {},
                outputRefs: { [outputKey]: [{ resourceId, type: 'text' }] },
                updatedAt: runtime.now(),
                completedAt,
              },
            },
            canvas: {
              ...current.project.canvas,
              nodes: current.project.canvas.nodes.map((node) =>
                node.id === item.resultNodeId
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        resources: [{ resourceId, type: 'text' }],
                        status: 'succeeded',
                        completedAt,
                      },
                    }
                  : node,
              ),
            },
          },
        }))
      } catch (err) {
        if (taskWasCanceled(item.taskId)) return
        const failedAt = runtime.now()
        const errorMessage = err instanceof Error ? err.message : 'Gemini execution failed'
        const taskError = {
          code: 'gemini_execution_failed',
          message: errorMessage,
          raw: err,
        }
        const nodeError = {
          code: taskError.code,
          message: errorMessage,
        }
        set((current) => ({
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: failedAt },
            tasks: {
              ...current.project.tasks,
              [item.taskId]: {
                ...current.project.tasks[item.taskId]!,
                status: 'failed',
                error: taskError,
                updatedAt: failedAt,
                completedAt: failedAt,
              },
            },
            canvas: {
              ...current.project.canvas,
              nodes: current.project.canvas.nodes.map((node) =>
                node.id === item.resultNodeId
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        status: 'failed',
                        error: nodeError,
                        completedAt: failedAt,
                      },
                    }
                  : node,
              ),
            },
          },
        }))
      }
    }

    const executeOpenAiImageQueueItem = async (item: QueuedOpenAIImageRun) => {
      if (taskWasCanceled(item.taskId)) return
      const startedAt = runtime.now()
      set((current) => ({
        project: {
          ...current.project,
          project: { ...current.project.project, updatedAt: startedAt },
          tasks: {
            ...current.project.tasks,
            [item.taskId]: {
              ...current.project.tasks[item.taskId]!,
              status: 'running',
              endpointId: 'openai_image',
              startedAt,
              updatedAt: startedAt,
            },
          },
          canvas: {
            ...current.project.canvas,
            nodes: current.project.canvas.nodes.map((node) =>
              node.id === item.resultNodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      endpointId: 'openai_image',
                      status: 'running',
                      startedAt,
                    },
                  }
                : node,
            ),
          },
        },
      }))

      try {
        if (!item.config.apiKey.trim()) throw new Error('OpenAI API key is required')
        const defaultPrompt = item.functionDef.inputs.find((input) => input.key === 'prompt')?.defaultValue
        const request = await createOpenAIImageApiRequest(
          item.config,
          item.inputValues,
          get().project.resources,
          defaultPrompt,
          (resource) => readProjectResourceBlob(get().project, resource, runtime.createComfyClient),
        )
        const requestSnapshot =
          request.kind === 'edit'
            ? { kind: request.kind, body: snapshotFormData(request.body) }
            : { kind: request.kind, body: structuredClone(request.body) }
        set((current) => ({
          project: {
            ...current.project,
            tasks: {
              ...current.project.tasks,
              [item.taskId]: {
                ...current.project.tasks[item.taskId]!,
                requestSnapshot,
                updatedAt: runtime.now(),
              },
            },
          },
        }))
        const requestPrompt =
          request.kind === 'edit' ? String(request.body.get('prompt') ?? '') : String(request.body.prompt ?? '')
        if (!requestPrompt.trim()) throw new Error('OpenAI image prompt is empty')

        const response = await fetch(
          request.kind === 'edit'
            ? openAiImagesEditsUrl(item.config.baseUrl)
            : openAiImagesGenerationsUrl(item.config.baseUrl),
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${item.config.apiKey.trim()}`,
              ...(request.kind === 'generation' ? { 'Content-Type': 'application/json' } : {}),
            },
            body: request.kind === 'edit' ? request.body : JSON.stringify(request.body),
          },
        )
        if (!response.ok) {
          const errorText = await response.text().catch(() => '')
          throw new Error(`OpenAI image request failed: ${response.status}${errorText ? ` ${errorText}` : ''}`)
        }

        const responseJson = await response.json()
        const outputs = extractOpenAIImageGenerationOutputs(responseJson, item.config.outputFormat)
        if (outputs.length === 0) throw new Error('OpenAI image response did not include image data')

        const outputKey = item.functionDef.outputs[0]?.key ?? 'image'
        const completedAt = runtime.now()
        const newAssets: ProjectState['assets'] = {}
        const newResources: ProjectState['resources'] = {}
        const resourceRefs: ResourceRef[] = []

        for (const output of outputs) {
          const assetId = runtime.idFactory()
          const resourceId = runtime.idFactory()
          newAssets[assetId] = {
            id: assetId,
            name: output.filename,
            mimeType: output.mimeType,
            sizeBytes: 0,
            blobUrl: output.dataUrl,
            createdAt: completedAt,
          }
          newResources[resourceId] = {
            id: resourceId,
            type: 'image',
            name: output.filename,
            value: {
              assetId,
              url: output.dataUrl,
              filename: output.filename,
              mimeType: output.mimeType,
              sizeBytes: 0,
            },
            source: {
              kind: 'function_output',
              functionNodeId: item.functionNodeId,
              resultGroupNodeId: item.resultNodeId,
              taskId: item.taskId,
              outputKey,
            },
            metadata: {
              workflowFunctionId: item.functionId,
              endpointId: 'openai_image',
              createdAt: completedAt,
            },
          }
          resourceRefs.push({ resourceId, type: 'image' })
        }

        if (taskWasCanceled(item.taskId)) return
        set((current) => ({
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: runtime.now() },
            assets: { ...current.project.assets, ...newAssets },
            resources: { ...current.project.resources, ...newResources },
            tasks: {
              ...current.project.tasks,
              [item.taskId]: {
                ...current.project.tasks[item.taskId]!,
                status: 'succeeded',
                compiledWorkflowSnapshot: {},
                outputRefs: { [outputKey]: resourceRefs },
                updatedAt: runtime.now(),
                completedAt,
              },
            },
            canvas: {
              ...current.project.canvas,
              nodes: current.project.canvas.nodes.map((node) =>
                node.id === item.resultNodeId
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        resources: resourceRefs,
                        status: 'succeeded',
                        completedAt,
                      },
                    }
                  : node,
              ),
            },
          },
        }))
      } catch (err) {
        if (taskWasCanceled(item.taskId)) return
        const failedAt = runtime.now()
        const errorMessage = err instanceof Error ? err.message : 'OpenAI image execution failed'
        const taskError = {
          code: 'openai_image_execution_failed',
          message: errorMessage,
          raw: err,
        }
        const nodeError = {
          code: taskError.code,
          message: errorMessage,
        }
        set((current) => ({
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: failedAt },
            tasks: {
              ...current.project.tasks,
              [item.taskId]: {
                ...current.project.tasks[item.taskId]!,
                status: 'failed',
                error: taskError,
                updatedAt: failedAt,
                completedAt: failedAt,
              },
            },
            canvas: {
              ...current.project.canvas,
              nodes: current.project.canvas.nodes.map((node) =>
                node.id === item.resultNodeId
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        status: 'failed',
                        error: nodeError,
                        completedAt: failedAt,
                      },
                    }
                  : node,
              ),
            },
          },
        }))
      }
    }

    const executeGeminiImageQueueItem = async (item: QueuedGeminiImageRun) => {
      if (taskWasCanceled(item.taskId)) return
      const startedAt = runtime.now()
      set((current) => ({
        project: {
          ...current.project,
          project: { ...current.project.project, updatedAt: startedAt },
          tasks: {
            ...current.project.tasks,
            [item.taskId]: {
              ...current.project.tasks[item.taskId]!,
              status: 'running',
              endpointId: 'gemini_image',
              startedAt,
              updatedAt: startedAt,
            },
          },
          canvas: {
            ...current.project.canvas,
            nodes: current.project.canvas.nodes.map((node) =>
              node.id === item.resultNodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      endpointId: 'gemini_image',
                      status: 'running',
                      startedAt,
                    },
                  }
                : node,
            ),
          },
        },
      }))

      try {
        if (!item.config.apiKey.trim()) throw new Error('Gemini API key is required')
        const defaultPrompt = item.functionDef.inputs.find((input) => input.key === 'prompt')?.defaultValue
        const request = await createGeminiImageGenerationRequest(
          item.config,
          item.inputValues,
          get().project.resources,
          defaultPrompt,
          (resource) => readProjectResourceBlob(get().project, resource, runtime.createComfyClient),
        )
        set((current) => ({
          project: {
            ...current.project,
            tasks: {
              ...current.project.tasks,
              [item.taskId]: {
                ...current.project.tasks[item.taskId]!,
                requestSnapshot: structuredClone(request),
                updatedAt: runtime.now(),
              },
            },
          },
        }))
        const requestPrompt =
          request.contents[0]?.parts.find((part): part is { text: string } => 'text' in part)?.text ?? ''
        if (!requestPrompt.trim()) throw new Error('Gemini image prompt is empty')

        const response = await fetch(geminiGenerateContentUrl(item.config.baseUrl, item.config.model), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': item.config.apiKey.trim(),
          },
          body: JSON.stringify(request),
        })
        if (!response.ok) {
          const errorText = await response.text().catch(() => '')
          throw new Error(`Gemini image request failed: ${response.status}${errorText ? ` ${errorText}` : ''}`)
        }

        const responseJson = await response.json()
        const outputs = extractGeminiImageGenerationOutputs(responseJson)
        if (outputs.length === 0) throw new Error('Gemini image response did not include image data')

        const outputKey = item.functionDef.outputs[0]?.key ?? 'image'
        const completedAt = runtime.now()
        const newAssets: ProjectState['assets'] = {}
        const newResources: ProjectState['resources'] = {}
        const resourceRefs: ResourceRef[] = []

        for (const output of outputs) {
          const assetId = runtime.idFactory()
          const resourceId = runtime.idFactory()
          newAssets[assetId] = {
            id: assetId,
            name: output.filename,
            mimeType: output.mimeType,
            sizeBytes: 0,
            blobUrl: output.dataUrl,
            createdAt: completedAt,
          }
          newResources[resourceId] = {
            id: resourceId,
            type: 'image',
            name: output.filename,
            value: {
              assetId,
              url: output.dataUrl,
              filename: output.filename,
              mimeType: output.mimeType,
              sizeBytes: 0,
            },
            source: {
              kind: 'function_output',
              functionNodeId: item.functionNodeId,
              resultGroupNodeId: item.resultNodeId,
              taskId: item.taskId,
              outputKey,
            },
            metadata: {
              workflowFunctionId: item.functionId,
              endpointId: 'gemini_image',
              createdAt: completedAt,
            },
          }
          resourceRefs.push({ resourceId, type: 'image' })
        }

        if (taskWasCanceled(item.taskId)) return
        set((current) => ({
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: runtime.now() },
            assets: { ...current.project.assets, ...newAssets },
            resources: { ...current.project.resources, ...newResources },
            tasks: {
              ...current.project.tasks,
              [item.taskId]: {
                ...current.project.tasks[item.taskId]!,
                status: 'succeeded',
                compiledWorkflowSnapshot: {},
                outputRefs: { [outputKey]: resourceRefs },
                updatedAt: runtime.now(),
                completedAt,
              },
            },
            canvas: {
              ...current.project.canvas,
              nodes: current.project.canvas.nodes.map((node) =>
                node.id === item.resultNodeId
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        resources: resourceRefs,
                        status: 'succeeded',
                        completedAt,
                      },
                    }
                  : node,
              ),
            },
          },
        }))
      } catch (err) {
        if (taskWasCanceled(item.taskId)) return
        const failedAt = runtime.now()
        const errorMessage = err instanceof Error ? err.message : 'Gemini image execution failed'
        const taskError = {
          code: 'gemini_image_execution_failed',
          message: errorMessage,
          raw: err,
        }
        const nodeError = {
          code: taskError.code,
          message: errorMessage,
        }
        set((current) => ({
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: failedAt },
            tasks: {
              ...current.project.tasks,
              [item.taskId]: {
                ...current.project.tasks[item.taskId]!,
                status: 'failed',
                error: taskError,
                updatedAt: failedAt,
                completedAt: failedAt,
              },
            },
            canvas: {
              ...current.project.canvas,
              nodes: current.project.canvas.nodes.map((node) =>
                node.id === item.resultNodeId
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        status: 'failed',
                        error: nodeError,
                        completedAt: failedAt,
                      },
                    }
                  : node,
              ),
            },
          },
        }))
      }
    }

    const runOpenAiFunctionNode = async (nodeId: string, requestedRunCount?: number) => {
      const state = get()
      const node = state.project.canvas.nodes.find((item) => item.id === nodeId && item.type === 'function')
      if (!node) return
      const functionId = String(node.data.functionId ?? '')
      const functionDef = state.project.functions[functionId]
      if (!functionDef || !isOpenAILlmFunction(functionDef)) return

      const runCount = normalizedRunCount(
        requestedRunCount ?? Number((node.data.runtime as { runCount?: number } | undefined)?.runCount ?? 1),
      )
      const now = runtime.now()
      const inputValues = (node.data.inputValues ?? {}) as RuntimeInputValues
      if (validateRequiredInputs(nodeId, functionDef, inputValues, state.project.resources).length > 0) return
      const nodeConfig = node.data.openaiConfig as Partial<OpenAILlmConfig> | undefined
      const config = mergedOpenAILlmConfig(functionDef.openai, nodeConfig)
      const queuedNodes: CanvasNode[] = []
      const queuedTasks: Record<string, ExecutionTask> = {}
      const queuedRuns: QueuedOpenAiRun[] = []
      const runRange = functionRunRange(state.project, nodeId, runCount)

      for (let index = 1; index <= runCount; index += 1) {
        const runIndex = runRange.start + index - 1
        const taskId = runtime.idFactory()
        const resultNodeId = runtime.idFactory()
        const task: ExecutionTask = {
          id: taskId,
          functionNodeId: nodeId,
          functionId,
          runIndex,
          runTotal: runRange.total,
          status: 'queued',
          inputRefs: resourceInputRefs(inputValues),
          inputSnapshot: resourceInputSnapshot(inputValues, state.project.resources),
          inputValuesSnapshot: executionInputSnapshot(functionDef, inputValues, state.project.resources),
          paramsSnapshot: {
            runCount,
            mode: 'openai_chat_completions',
            baseUrl: config.baseUrl,
            model: config.model,
            messageCount: config.messages.length,
          },
          workflowTemplateSnapshot: {},
          compiledWorkflowSnapshot: {},
          seedPatchLog: [],
          outputRefs: {},
          createdAt: now,
          updatedAt: now,
        }
        const resultNode: CanvasNode = {
          id: resultNodeId,
          type: 'result_group',
          position: nextResultNodePosition([...state.project.canvas.nodes, ...queuedNodes], node, functionDef),
          data: {
            sourceFunctionNodeId: nodeId,
            functionId,
            taskId,
            runIndex,
            runTotal: runRange.total,
            title: `Run ${runIndex}`,
            endpointId: 'openai',
            resources: [],
            status: 'queued',
            seedPatchLog: [],
            createdAt: now,
          },
        }

        queuedTasks[taskId] = task
        queuedNodes.push(resultNode)
        queuedRuns.push({
          taskId,
          resultNodeId,
          functionNodeId: nodeId,
          functionId,
          functionDef,
          inputValues,
          config,
          runIndex,
          runTotal: runRange.total,
        })
      }

      set((current) => ({
        project: {
          ...current.project,
          project: { ...current.project.project, updatedAt: now },
          tasks: { ...tasksWithRunTotal(current.project.tasks, nodeId, runRange.total), ...queuedTasks },
          canvas: {
            ...current.project.canvas,
            nodes: [...nodesWithRunTotal(current.project.canvas.nodes, nodeId, runRange.total), ...queuedNodes],
          },
        },
      }))

      await Promise.all(queuedRuns.map((item) => executeOpenAiQueueItem(item)))
    }

    const runGeminiFunctionNode = async (nodeId: string, requestedRunCount?: number) => {
      const state = get()
      const node = state.project.canvas.nodes.find((item) => item.id === nodeId && item.type === 'function')
      if (!node) return
      const functionId = String(node.data.functionId ?? '')
      const functionDef = state.project.functions[functionId]
      if (!functionDef || !isGeminiLlmFunction(functionDef)) return

      const runCount = normalizedRunCount(
        requestedRunCount ?? Number((node.data.runtime as { runCount?: number } | undefined)?.runCount ?? 1),
      )
      const now = runtime.now()
      const inputValues = (node.data.inputValues ?? {}) as RuntimeInputValues
      if (validateRequiredInputs(nodeId, functionDef, inputValues, state.project.resources).length > 0) return
      const nodeConfig = node.data.geminiConfig as Partial<GeminiLlmConfig> | undefined
      const config = mergedGeminiLlmConfig(functionDef.gemini, nodeConfig)
      const queuedNodes: CanvasNode[] = []
      const queuedTasks: Record<string, ExecutionTask> = {}
      const queuedRuns: QueuedGeminiRun[] = []
      const runRange = functionRunRange(state.project, nodeId, runCount)

      for (let index = 1; index <= runCount; index += 1) {
        const runIndex = runRange.start + index - 1
        const taskId = runtime.idFactory()
        const resultNodeId = runtime.idFactory()
        const task: ExecutionTask = {
          id: taskId,
          functionNodeId: nodeId,
          functionId,
          runIndex,
          runTotal: runRange.total,
          status: 'queued',
          inputRefs: resourceInputRefs(inputValues),
          inputSnapshot: resourceInputSnapshot(inputValues, state.project.resources),
          inputValuesSnapshot: executionInputSnapshot(functionDef, inputValues, state.project.resources),
          paramsSnapshot: {
            runCount,
            mode: 'gemini_generate_content',
            baseUrl: config.baseUrl,
            model: config.model,
            messageCount: config.messages.length,
          },
          workflowTemplateSnapshot: {},
          compiledWorkflowSnapshot: {},
          seedPatchLog: [],
          outputRefs: {},
          createdAt: now,
          updatedAt: now,
        }
        const resultNode: CanvasNode = {
          id: resultNodeId,
          type: 'result_group',
          position: nextResultNodePosition([...state.project.canvas.nodes, ...queuedNodes], node, functionDef),
          data: {
            sourceFunctionNodeId: nodeId,
            functionId,
            taskId,
            runIndex,
            runTotal: runRange.total,
            title: `Run ${runIndex}`,
            endpointId: 'gemini',
            resources: [],
            status: 'queued',
            seedPatchLog: [],
            createdAt: now,
          },
        }

        queuedTasks[taskId] = task
        queuedNodes.push(resultNode)
        queuedRuns.push({
          taskId,
          resultNodeId,
          functionNodeId: nodeId,
          functionId,
          functionDef,
          inputValues,
          config,
          runIndex,
          runTotal: runRange.total,
        })
      }

      set((current) => ({
        project: {
          ...current.project,
          project: { ...current.project.project, updatedAt: now },
          tasks: { ...tasksWithRunTotal(current.project.tasks, nodeId, runRange.total), ...queuedTasks },
          canvas: {
            ...current.project.canvas,
            nodes: [...nodesWithRunTotal(current.project.canvas.nodes, nodeId, runRange.total), ...queuedNodes],
          },
        },
      }))

      await Promise.all(queuedRuns.map((item) => executeGeminiQueueItem(item)))
    }

    const runOpenAiImageFunctionNode = async (nodeId: string, requestedRunCount?: number) => {
      const state = get()
      const node = state.project.canvas.nodes.find((item) => item.id === nodeId && item.type === 'function')
      if (!node) return
      const functionId = String(node.data.functionId ?? '')
      const functionDef = state.project.functions[functionId]
      if (!functionDef || !isOpenAIImageFunction(functionDef)) return

      const runCount = normalizedRunCount(
        requestedRunCount ?? Number((node.data.runtime as { runCount?: number } | undefined)?.runCount ?? 1),
      )
      const now = runtime.now()
      const inputValues = (node.data.inputValues ?? {}) as RuntimeInputValues
      if (validateRequiredInputs(nodeId, functionDef, inputValues, state.project.resources).length > 0) return
      const nodeConfig = node.data.openaiImageConfig as Partial<OpenAIImageConfig> | undefined
      const config = mergedOpenAIImageConfig(functionDef.openaiImage, nodeConfig)
      const queuedNodes: CanvasNode[] = []
      const queuedTasks: Record<string, ExecutionTask> = {}
      const queuedRuns: QueuedOpenAIImageRun[] = []
      const runRange = functionRunRange(state.project, nodeId, runCount)

      for (let index = 1; index <= runCount; index += 1) {
        const runIndex = runRange.start + index - 1
        const taskId = runtime.idFactory()
        const resultNodeId = runtime.idFactory()
        const task: ExecutionTask = {
          id: taskId,
          functionNodeId: nodeId,
          functionId,
          runIndex,
          runTotal: runRange.total,
          status: 'queued',
          inputRefs: resourceInputRefs(inputValues),
          inputSnapshot: resourceInputSnapshot(inputValues, state.project.resources),
          inputValuesSnapshot: executionInputSnapshot(functionDef, inputValues, state.project.resources),
          paramsSnapshot: {
            runCount,
            mode: 'openai_image_generation',
            baseUrl: config.baseUrl,
            model: config.model,
            size: config.size,
            quality: config.quality,
            background: config.background,
            outputFormat: config.outputFormat,
          },
          workflowTemplateSnapshot: {},
          compiledWorkflowSnapshot: {},
          seedPatchLog: [],
          outputRefs: {},
          createdAt: now,
          updatedAt: now,
        }
        const resultNode: CanvasNode = {
          id: resultNodeId,
          type: 'result_group',
          position: nextResultNodePosition([...state.project.canvas.nodes, ...queuedNodes], node, functionDef),
          data: {
            sourceFunctionNodeId: nodeId,
            functionId,
            taskId,
            runIndex,
            runTotal: runRange.total,
            title: `Run ${runIndex}`,
            endpointId: 'openai_image',
            resources: [],
            status: 'queued',
            seedPatchLog: [],
            createdAt: now,
          },
        }

        queuedTasks[taskId] = task
        queuedNodes.push(resultNode)
        queuedRuns.push({
          taskId,
          resultNodeId,
          functionNodeId: nodeId,
          functionId,
          functionDef,
          inputValues,
          config,
          runIndex,
          runTotal: runRange.total,
        })
      }

      set((current) => ({
        project: {
          ...current.project,
          project: { ...current.project.project, updatedAt: now },
          tasks: { ...tasksWithRunTotal(current.project.tasks, nodeId, runRange.total), ...queuedTasks },
          canvas: {
            ...current.project.canvas,
            nodes: [...nodesWithRunTotal(current.project.canvas.nodes, nodeId, runRange.total), ...queuedNodes],
          },
        },
      }))

      await Promise.all(queuedRuns.map((item) => executeOpenAiImageQueueItem(item)))
    }

    const runGeminiImageFunctionNode = async (nodeId: string, requestedRunCount?: number) => {
      const state = get()
      const node = state.project.canvas.nodes.find((item) => item.id === nodeId && item.type === 'function')
      if (!node) return
      const functionId = String(node.data.functionId ?? '')
      const functionDef = state.project.functions[functionId]
      if (!functionDef || !isGeminiImageFunction(functionDef)) return

      const runCount = normalizedRunCount(
        requestedRunCount ?? Number((node.data.runtime as { runCount?: number } | undefined)?.runCount ?? 1),
      )
      const now = runtime.now()
      const inputValues = (node.data.inputValues ?? {}) as RuntimeInputValues
      if (validateRequiredInputs(nodeId, functionDef, inputValues, state.project.resources).length > 0) return
      const nodeConfig = node.data.geminiImageConfig as Partial<GeminiImageConfig> | undefined
      const config = mergedGeminiImageConfig(functionDef.geminiImage, nodeConfig)
      const queuedNodes: CanvasNode[] = []
      const queuedTasks: Record<string, ExecutionTask> = {}
      const queuedRuns: QueuedGeminiImageRun[] = []
      const runRange = functionRunRange(state.project, nodeId, runCount)

      for (let index = 1; index <= runCount; index += 1) {
        const runIndex = runRange.start + index - 1
        const taskId = runtime.idFactory()
        const resultNodeId = runtime.idFactory()
        const task: ExecutionTask = {
          id: taskId,
          functionNodeId: nodeId,
          functionId,
          runIndex,
          runTotal: runRange.total,
          status: 'queued',
          inputRefs: resourceInputRefs(inputValues),
          inputSnapshot: resourceInputSnapshot(inputValues, state.project.resources),
          inputValuesSnapshot: executionInputSnapshot(functionDef, inputValues, state.project.resources),
          paramsSnapshot: {
            runCount,
            mode: 'gemini_image_generation',
            baseUrl: config.baseUrl,
            model: config.model,
            responseModalities: config.responseModalities,
            aspectRatio: config.aspectRatio,
            imageSize: config.imageSize,
          },
          workflowTemplateSnapshot: {},
          compiledWorkflowSnapshot: {},
          seedPatchLog: [],
          outputRefs: {},
          createdAt: now,
          updatedAt: now,
        }
        const resultNode: CanvasNode = {
          id: resultNodeId,
          type: 'result_group',
          position: nextResultNodePosition([...state.project.canvas.nodes, ...queuedNodes], node, functionDef),
          data: {
            sourceFunctionNodeId: nodeId,
            functionId,
            taskId,
            runIndex,
            runTotal: runRange.total,
            title: `Run ${runIndex}`,
            endpointId: 'gemini_image',
            resources: [],
            status: 'queued',
            seedPatchLog: [],
            createdAt: now,
          },
        }

        queuedTasks[taskId] = task
        queuedNodes.push(resultNode)
        queuedRuns.push({
          taskId,
          resultNodeId,
          functionNodeId: nodeId,
          functionId,
          functionDef,
          inputValues,
          config,
          runIndex,
          runTotal: runRange.total,
        })
      }

      set((current) => ({
        project: {
          ...current.project,
          project: { ...current.project.project, updatedAt: now },
          tasks: { ...tasksWithRunTotal(current.project.tasks, nodeId, runRange.total), ...queuedTasks },
          canvas: {
            ...current.project.canvas,
            nodes: [...nodesWithRunTotal(current.project.canvas.nodes, nodeId, runRange.total), ...queuedNodes],
          },
        },
      }))

      await Promise.all(queuedRuns.map((item) => executeGeminiImageQueueItem(item)))
    }

    const ensureComfyWorkers = () => {
      const endpoints = get().project.comfy.endpoints.filter(endpointIsWorkerEligible)
      for (const endpoint of endpoints) {
        if (activeComfyWorkerEndpointIds.has(endpoint.id)) continue
        if (!comfyQueue.some((item) => endpointSupportsFunction(endpoint, item.functionId))) continue

        activeComfyWorkerEndpointIds.add(endpoint.id)
        void (async () => {
          try {
            while (true) {
              const currentEndpoint = get().project.comfy.endpoints.find((item) => item.id === endpoint.id)
              if (!currentEndpoint || !endpointIsWorkerEligible(currentEndpoint)) break
              const queuedRun = takeNextQueuedRun(currentEndpoint)
              if (!queuedRun) break
              await executeComfyQueueItem(queuedRun, currentEndpoint)
            }
          } finally {
            activeComfyWorkerEndpointIds.delete(endpoint.id)
            if (comfyQueue.length > 0) ensureComfyWorkers()
          }
        })()
      }
    }

    const projectLibraryWithActive = (state: ProjectStoreState) => ({
      ...state.projectLibrary,
      [state.project.project.id]: state.project,
    })

    const createUniqueProjectId = (library: Record<string, ProjectState>) => {
      let projectId = runtime.idFactory()
      while (!projectId || library[projectId]) {
        projectId = runtime.idFactory()
      }
      return projectId
    }

    const undoStackWithSnapshot = (state: ProjectStoreState) => [
      ...state.undoStack.slice(-49),
      structuredClone(state.project),
    ]

    const deleteNodesFromState = (state: ProjectStoreState, nodeIds: string[], now: string) => {
      const requestedNodeIds = new Set(nodeIds.filter(Boolean))
      if (requestedNodeIds.size === 0) return state

      const targetNodes = state.project.canvas.nodes.filter((node) => requestedNodeIds.has(node.id))
      if (targetNodes.length === 0) return state

      const nodeIdsToDelete = new Set<string>(targetNodes.map((node) => node.id))
      for (const targetNode of targetNodes) {
        if (targetNode.type !== 'function') continue
        for (const node of state.project.canvas.nodes) {
          if (node.type === 'result_group' && node.data.sourceFunctionNodeId === targetNode.id) {
            nodeIdsToDelete.add(node.id)
          }
        }
      }

      const taskIdsToDelete = new Set<string>()
      for (const task of Object.values(state.project.tasks)) {
        if (nodeIdsToDelete.has(task.functionNodeId)) taskIdsToDelete.add(task.id)
      }
      for (const node of state.project.canvas.nodes) {
        if (node.type === 'result_group' && nodeIdsToDelete.has(node.id) && typeof node.data.taskId === 'string') {
          taskIdsToDelete.add(node.data.taskId)
        }
      }

      const resourceIdsToDelete = new Set<string>()
      for (const targetNode of targetNodes) {
        if (targetNode.type === 'resource' && typeof targetNode.data.resourceId === 'string') {
          resourceIdsToDelete.add(targetNode.data.resourceId)
        }
      }
      for (const resource of Object.values(state.project.resources)) {
        const source = resource.source
        if (
          (source.functionNodeId && nodeIdsToDelete.has(source.functionNodeId)) ||
          (source.resultGroupNodeId && nodeIdsToDelete.has(source.resultGroupNodeId)) ||
          (source.taskId && taskIdsToDelete.has(source.taskId))
        ) {
          resourceIdsToDelete.add(resource.id)
        }
      }

      const selectedNodeIds = state.selectedNodeIds.filter((selectedId) => !nodeIdsToDelete.has(selectedId))
      const disconnectedInputKeys = new Map<string, Set<string>>()
      for (const edge of state.project.canvas.edges) {
        if (!nodeIdsToDelete.has(edge.source.nodeId) && !nodeIdsToDelete.has(edge.target.nodeId)) continue
        const keys = disconnectedInputKeys.get(edge.target.nodeId) ?? new Set<string>()
        keys.add(edge.target.inputKey)
        disconnectedInputKeys.set(edge.target.nodeId, keys)
      }

      const remainingNodes = state.project.canvas.nodes
        .filter((node) => !nodeIdsToDelete.has(node.id))
        .map((node) => {
          if (node.type !== 'function') return node

          const inputValues: RuntimeInputValues = { ...((node.data.inputValues as RuntimeInputValues | undefined) ?? {}) }
          const removedKeys = disconnectedInputKeys.get(node.id)
          if (removedKeys) {
            for (const key of removedKeys) delete inputValues[key]
          }

          for (const [key, value] of Object.entries(inputValues)) {
            if (isResourceRef(value) && resourceIdsToDelete.has(value.resourceId)) delete inputValues[key]
          }

          return {
            ...node,
            data: {
              ...node.data,
              inputValues,
            },
          }
        })

      return {
        ...selectedState(selectedNodeIds),
        undoStack: undoStackWithSnapshot(state),
        project: {
          ...state.project,
          project: { ...state.project.project, updatedAt: now },
          canvas: {
            ...state.project.canvas,
            nodes: remainingNodes,
            edges: state.project.canvas.edges.filter(
              (edge) => !nodeIdsToDelete.has(edge.source.nodeId) && !nodeIdsToDelete.has(edge.target.nodeId),
            ),
          },
          resources: Object.fromEntries(
            Object.entries(state.project.resources).filter(([resourceId]) => !resourceIdsToDelete.has(resourceId)),
          ),
          tasks: Object.fromEntries(Object.entries(state.project.tasks).filter(([taskId]) => !taskIdsToDelete.has(taskId))),
        },
      }
    }

    const defaultProject = initialProject(runtime.now())

    return {
      project: defaultProject,
      projectLibrary: { [defaultProject.project.id]: defaultProject },
      undoStack: [],
      selectedNodeIds: [],

      createProject: (options) => {
        let createdProjectId = ''
        set((state) => {
          const now = runtime.now()
          const library = projectLibraryWithActive(state)
          const nextProject = initialProject(now, {
            id: createUniqueProjectId(library),
            name: options?.name?.trim() || 'Untitled Project',
            description: options?.description,
          })
          createdProjectId = nextProject.project.id
          return {
            project: nextProject,
            projectLibrary: {
              ...library,
              [nextProject.project.id]: nextProject,
            },
            undoStack: [],
            ...selectedState([]),
          }
        })
        return createdProjectId
      },

      switchProject: (projectId) => {
        const now = runtime.now()
        set((state) => {
          const library = projectLibraryWithActive(state)
          const targetProject = library[projectId]
          if (!targetProject) return { projectLibrary: library }
          const project = withBuiltInFunctions(targetProject, now)
          return {
            project,
            projectLibrary: {
              ...library,
              [project.project.id]: project,
            },
            undoStack: [],
            ...selectedState([]),
          }
        })
      },

      updateProjectMetadata: (patch) => {
        const now = runtime.now()
        set((state) => {
          const project = {
            ...state.project,
            project: {
              ...state.project.project,
              name: patch.name ?? state.project.project.name,
              description: patch.description === undefined ? state.project.project.description : patch.description || undefined,
              updatedAt: now,
            },
          }
          return {
            project,
            projectLibrary: {
              ...state.projectLibrary,
              [project.project.id]: project,
            },
          }
        })
      },

      deleteProject: (projectId) => {
        set((state) => {
          const now = runtime.now()
          const library = projectLibraryWithActive(state)
          if (!library[projectId]) return state

          const remainingProjects = Object.fromEntries(
            Object.entries(library).filter(([candidateProjectId]) => candidateProjectId !== projectId),
          )

          if (Object.keys(remainingProjects).length === 0) {
            const replacementProject = initialProject(now, {
              id: createUniqueProjectId(remainingProjects),
              name: 'Untitled Project',
            })
            return {
              project: replacementProject,
              projectLibrary: { [replacementProject.project.id]: replacementProject },
              undoStack: [],
              ...selectedState([]),
            }
          }

          if (state.project.project.id !== projectId) {
            return { projectLibrary: remainingProjects }
          }

          const nextProject = withBuiltInFunctions(
            Object.values(remainingProjects).sort((left, right) =>
              right.project.updatedAt.localeCompare(left.project.updatedAt),
            )[0],
            now,
          )

          return {
            project: nextProject,
            projectLibrary: {
              ...remainingProjects,
              [nextProject.project.id]: nextProject,
            },
            undoStack: [],
            ...selectedState([]),
          }
        })
      },

      checkEndpointStatus: async (endpointId) => {
        const endpoint = get().project.comfy.endpoints.find((item) => item.id === endpointId)
        if (!endpoint || !endpoint.enabled) return

        try {
          const client = runtime.createComfyClient(endpoint)
          if (!client.testConnection) throw new Error('Connection test is not supported')
          await client.testConnection()
          get().markEndpoint(endpoint.id, 'online')
        } catch (err) {
          get().markEndpoint(endpoint.id, 'offline', err instanceof Error ? err.message : 'Connection failed')
        }
      },

      checkComfyEndpointStatuses: async () => {
        const endpoints = get().project.comfy.endpoints.filter((endpoint) => endpoint.enabled)
        await Promise.all(endpoints.map((endpoint) => get().checkEndpointStatus(endpoint.id)))
      },

      fetchResourceBlob: async (resourceId) => {
        const resource = get().project.resources[resourceId]
        if (!resource) throw new Error(`Resource not found: ${resourceId}`)
        return readProjectResourceBlob(get().project, resource, runtime.createComfyClient)
      },

      fetchComfyHistory: async (endpointId, promptId) => {
        const endpoint = get().project.comfy.endpoints.find((item) => item.id === endpointId)
        if (!endpoint) throw new Error(`ComfyUI endpoint not found: ${endpointId}`)
        const server = new ComfyServer(endpoint, runtime.createComfyClient(endpoint))
        return server.getHistory(promptId)
      },

    addTextResource: (name, value) => {
      get().addTextResourceAtPosition(name, value, {
        x: DEFAULT_RESOURCE_X,
        y: DEFAULT_RESOURCE_Y + Object.keys(get().project.resources).length * 170,
      })
    },

    addTextResourceAtPosition: (name, value, position) => {
      const resourceId = runtime.idFactory()
      const nodeId = `node_${resourceId}`
      const now = runtime.now()
      const resource: Resource = {
        id: resourceId,
        type: 'text',
        name,
        value,
        source: { kind: 'manual_input' },
        metadata: { createdAt: now },
      }
      const node: CanvasNode = {
        id: nodeId,
        type: 'resource',
        position,
        data: { resourceId, resourceType: 'text' },
      }

      set((state) => ({
        project: {
          ...state.project,
          project: { ...state.project.project, updatedAt: now },
          resources: { ...state.project.resources, [resourceId]: resource },
          canvas: { ...state.project.canvas, nodes: [...state.project.canvas.nodes, node] },
        },
      }))
      return nodeId
    },

    addEmptyResourceAtPosition: (type, position, initialValue) => {
      if (type === 'text') {
        return get().addTextResourceAtPosition('Prompt', typeof initialValue === 'string' ? initialValue : '', position)
      }

      if (type === 'number') {
        const numericValue = Number(initialValue)
        const resourceId = runtime.idFactory()
        const nodeId = `node_${resourceId}`
        const now = runtime.now()
        const resource: Resource = {
          id: resourceId,
          type,
          name: resourceNameForType(type),
          value: Number.isFinite(numericValue) ? numericValue : 0,
          source: { kind: 'manual_input' },
          metadata: { createdAt: now },
        }
        const node: CanvasNode = {
          id: nodeId,
          type: 'resource',
          position,
          data: { resourceId, resourceType: type },
        }

        set((state) => ({
          project: {
            ...state.project,
            project: { ...state.project.project, updatedAt: now },
            resources: { ...state.project.resources, [resourceId]: resource },
            canvas: { ...state.project.canvas, nodes: [...state.project.canvas.nodes, node] },
          },
        }))
        return nodeId
      }

      return get().addMediaResourceAtPosition(type, resourceNameForType(type), emptyMediaPayload(type), position)
    },

    addMediaResourceAtPosition: (type, name, media, position) => {
      const resourceId = runtime.idFactory()
      const assetId = runtime.idFactory()
      const nodeId = `node_${resourceId}`
      const now = runtime.now()
      const resource: Resource = {
        id: resourceId,
        type,
        name,
        value: mediaValueWithAsset(assetId, media),
        source: { kind: 'manual_input' },
        metadata: { createdAt: now },
      }
      const node: CanvasNode = {
        id: nodeId,
        type: 'resource',
        position,
        data: { resourceId, resourceType: type },
      }

      set((state) => ({
        ...selectedState([nodeId]),
        project: {
          ...state.project,
          project: { ...state.project.project, updatedAt: now },
          assets: {
            ...state.project.assets,
            [assetId]: {
              id: assetId,
              name: media.filename ?? name,
              mimeType: media.mimeType,
              sizeBytes: media.sizeBytes,
              blobUrl: media.url,
              createdAt: now,
            },
          },
          resources: { ...state.project.resources, [resourceId]: resource },
          canvas: { ...state.project.canvas, nodes: [...state.project.canvas.nodes, node] },
        },
      }))
      return nodeId
    },

    updateTextResourceValue: (resourceId, value) => {
      const now = runtime.now()
      set((state) => {
        const resource = state.project.resources[resourceId]
        if (!resource || resource.type !== 'text') return state

        return {
          project: {
            ...state.project,
            project: { ...state.project.project, updatedAt: now },
            resources: {
              ...state.project.resources,
              [resourceId]: {
                ...resource,
                value,
              },
            },
          },
        }
      })
    },

    updateNumberResourceValue: (resourceId, value) => {
      if (!Number.isFinite(value)) return
      const now = runtime.now()
      set((state) => {
        const resource = state.project.resources[resourceId]
        if (!resource || resource.type !== 'number') return state

        return {
          project: {
            ...state.project,
            project: { ...state.project.project, updatedAt: now },
            resources: {
              ...state.project.resources,
              [resourceId]: {
                ...resource,
                value,
              },
            },
          },
        }
      })
    },

    replaceResourceMedia: (resourceId, type, media) => {
      const assetId = runtime.idFactory()
      const now = runtime.now()

      set((state) => {
        const resource = state.project.resources[resourceId]
        if (!resource) return state

        return {
          project: {
            ...state.project,
            project: { ...state.project.project, updatedAt: now },
            assets: {
              ...state.project.assets,
              [assetId]: {
                id: assetId,
                name: media.filename ?? resource.name ?? resourceNameForType(type),
                mimeType: media.mimeType,
                sizeBytes: media.sizeBytes,
                blobUrl: media.url,
                createdAt: now,
              },
            },
            resources: {
              ...state.project.resources,
              [resourceId]: {
                ...resource,
                type,
                name: media.filename ?? resource.name,
                value: mediaValueWithAsset(assetId, media),
              },
            },
            canvas: {
              ...state.project.canvas,
              nodes: state.project.canvas.nodes.map((node) =>
                node.type === 'resource' && node.data.resourceId === resourceId
                  ? { ...node, data: { ...node.data, resourceType: type } }
                  : node,
              ),
            },
          },
        }
      })
    },

    addFunctionFromWorkflow: (name, workflow) => {
      const id = runtime.idFactory()
      const now = runtime.now()
      const generationFunction = createGenerationFunctionFromWorkflow(id, name, workflow, now)

      set((state) => ({
        project: {
          ...state.project,
          project: { ...state.project.project, updatedAt: now },
          functions: { ...state.project.functions, [id]: generationFunction },
        },
      }))
      return id
    },

    updateFunction: (functionId, patch) => {
      const now = runtime.now()
      set((state) => {
        const currentFunction = state.project.functions[functionId]
        if (!currentFunction || isBuiltInFunction(currentFunction)) return state

        const nextFunction: GenerationFunction = {
          ...currentFunction,
          ...patch,
          id: currentFunction.id,
          createdAt: currentFunction.createdAt,
          updatedAt: now,
        }

        return {
          project: {
            ...state.project,
            project: { ...state.project.project, updatedAt: now },
            functions: { ...state.project.functions, [functionId]: nextFunction },
            canvas: {
              ...state.project.canvas,
              nodes: state.project.canvas.nodes.map((node) => {
                if (node.type !== 'function' || node.data.functionId !== functionId) return node

                const currentInputValues = (node.data.inputValues ?? {}) as RuntimeInputValues
                const inputsByKey = new Map(nextFunction.inputs.map((input) => [input.key, input]))
                const inputValues = Object.fromEntries(
                  Object.entries(currentInputValues).filter(([key, value]) => {
                    const input = inputsByKey.get(key)
                    if (!input) return false

                    if (isResourceRef(value)) {
                      return state.project.resources[value.resourceId]?.type === input.type
                    }

                    if (input.type === 'text') return typeof value === 'string'
                    if (input.type === 'number') return typeof value === 'number'
                    return false
                  }),
                )
                const shouldUpdateTitle = node.data.title === currentFunction.name

                return {
                  ...node,
                  data: {
                    ...node.data,
                    title: shouldUpdateTitle ? nextFunction.name : node.data.title,
                    inputValues,
                  },
                }
              }),
            },
          },
        }
      })
    },

    deleteFunction: (functionId) => {
      const now = runtime.now()
      set((state) => {
        const currentFunction = state.project.functions[functionId]
        if (!currentFunction || isBuiltInFunction(currentFunction)) return state

        const functions = { ...state.project.functions }
        delete functions[functionId]

        const removedNodeIds = new Set(
          state.project.canvas.nodes
            .filter((node) => node.type === 'function' && node.data.functionId === functionId)
            .map((node) => node.id),
        )

        const selectedNodeIds = state.selectedNodeIds.filter((nodeId) => !removedNodeIds.has(nodeId))

        return {
          ...selectedState(selectedNodeIds),
          project: {
            ...state.project,
            project: { ...state.project.project, updatedAt: now },
            functions,
            canvas: {
              ...state.project.canvas,
              nodes: state.project.canvas.nodes.filter((node) => !removedNodeIds.has(node.id)),
              edges: state.project.canvas.edges.filter(
                (edge) => !removedNodeIds.has(edge.source.nodeId) && !removedNodeIds.has(edge.target.nodeId),
              ),
            },
          },
        }
      })
    },

    addFunctionNode: (functionId) => {
      get().addFunctionNodeAtPosition(
        functionId,
        {
          x: DEFAULT_FUNCTION_X,
          y: DEFAULT_FUNCTION_Y + get().project.canvas.nodes.filter((item) => item.type === 'function').length * 220,
        },
        {
          autoBindRequiredInputs: false,
        },
      )
    },

    addFunctionNodeAtPosition: (functionId, position, options) => {
      const functionDef = get().project.functions[functionId]
      if (!functionDef) return undefined

      const id = runtime.idFactory()
      const now = runtime.now()
      const inputValues =
        options?.autoBindRequiredInputs === false ? {} : defaultInputValues(functionDef.inputs, get().project.resources)
      const node: CanvasNode = {
        id,
        type: 'function',
        position,
        data: {
          functionId,
          title: functionDef.name,
          inputValues,
          runtime: {
            runCount: functionDef.runtimeDefaults?.runCount ?? 1,
            seedPolicy: { mode: 'randomize_all_before_submit' },
            endpointPolicy: 'auto',
          },
          status: 'idle',
        },
      }

      set((state) => ({
        ...selectedState([id]),
        project: {
          ...state.project,
          project: { ...state.project.project, updatedAt: now },
          canvas: { ...state.project.canvas, nodes: [...state.project.canvas.nodes, node] },
        },
      }))
      return id
    },

    updateFunctionNodeRunCount: (nodeId, runCount) => {
      const now = runtime.now()
      set((state) => ({
        project: {
          ...state.project,
          project: { ...state.project.project, updatedAt: now },
          canvas: {
            ...state.project.canvas,
            nodes: state.project.canvas.nodes.map((node) => {
              if (node.id !== nodeId || node.type !== 'function') return node
              const currentRuntime = (node.data.runtime ?? {}) as Record<string, unknown>
              return {
                ...node,
                data: {
                  ...node.data,
                  runtime: {
                    ...currentRuntime,
                    runCount: normalizedRunCount(runCount),
                  },
                },
              }
            }),
          },
        },
      }))
    },

    updateFunctionNodeInputValue: (nodeId, inputKey, value) => {
      const now = runtime.now()
      set((state) => ({
        project: {
          ...state.project,
          project: { ...state.project.project, updatedAt: now },
          canvas: {
            ...state.project.canvas,
            nodes: state.project.canvas.nodes.map((node) => {
              if (node.id !== nodeId || node.type !== 'function') return node
              const functionId = typeof node.data.functionId === 'string' ? node.data.functionId : undefined
              const functionDef = functionId ? state.project.functions[functionId] : undefined
              const input = functionDef?.inputs.find((item) => item.key === inputKey)
              if (!input || (input.type !== 'text' && input.type !== 'number')) return node

              const normalizedValue = input.type === 'number' ? Number(value) : String(value ?? '')
              if (input.type === 'number' && !Number.isFinite(normalizedValue)) return node
              const nextInputValues = {
                ...((node.data.inputValues ?? {}) as RuntimeInputValues),
                [inputKey]: normalizedValue,
              }
              const nextMissingInputKeys = Array.isArray(node.data.missingInputKeys)
                ? node.data.missingInputKeys.filter((key) =>
                    key === inputKey
                      ? !inputValueSatisfiesDefinition(input, normalizedValue, state.project.resources)
                      : true,
                  )
                : []

              return {
                ...node,
                data: {
                  ...node.data,
                  missingInputKeys: nextMissingInputKeys,
                  status:
                    node.data.status === 'missing_inputs' && nextMissingInputKeys.length === 0 ? 'idle' : node.data.status,
                  inputValues: nextInputValues,
                },
              }
            }),
          },
        },
      }))
    },

    updateFunctionNodeOpenAiConfig: (nodeId, patch) => {
      const now = runtime.now()
      set((state) => ({
        project: {
          ...state.project,
          project: { ...state.project.project, updatedAt: now },
          canvas: {
            ...state.project.canvas,
            nodes: state.project.canvas.nodes.map((node) => {
              if (node.id !== nodeId || node.type !== 'function') return node
              const functionId = typeof node.data.functionId === 'string' ? node.data.functionId : undefined
              const functionDef = functionId ? state.project.functions[functionId] : undefined
              if (!functionDef || !isOpenAILlmFunction(functionDef)) return node
              const currentConfig = mergedOpenAILlmConfig(functionDef.openai, node.data.openaiConfig as Partial<OpenAILlmConfig>)
              return {
                ...node,
                data: {
                  ...node.data,
                  openaiConfig: mergedOpenAILlmConfig(currentConfig, patch),
                },
              }
            }),
          },
        },
      }))
    },

    updateFunctionNodeGeminiConfig: (nodeId, patch) => {
      const now = runtime.now()
      set((state) => ({
        project: {
          ...state.project,
          project: { ...state.project.project, updatedAt: now },
          canvas: {
            ...state.project.canvas,
            nodes: state.project.canvas.nodes.map((node) => {
              if (node.id !== nodeId || node.type !== 'function') return node
              const functionId = typeof node.data.functionId === 'string' ? node.data.functionId : undefined
              const functionDef = functionId ? state.project.functions[functionId] : undefined
              if (!functionDef || !isGeminiLlmFunction(functionDef)) return node
              const currentConfig = mergedGeminiLlmConfig(
                functionDef.gemini,
                node.data.geminiConfig as Partial<GeminiLlmConfig>,
              )
              return {
                ...node,
                data: {
                  ...node.data,
                  geminiConfig: mergedGeminiLlmConfig(currentConfig, patch),
                },
              }
            }),
          },
        },
      }))
    },

    updateFunctionNodeOpenAiImageConfig: (nodeId, patch) => {
      const now = runtime.now()
      set((state) => ({
        project: {
          ...state.project,
          project: { ...state.project.project, updatedAt: now },
          canvas: {
            ...state.project.canvas,
            nodes: state.project.canvas.nodes.map((node) => {
              if (node.id !== nodeId || node.type !== 'function') return node
              const functionId = typeof node.data.functionId === 'string' ? node.data.functionId : undefined
              const functionDef = functionId ? state.project.functions[functionId] : undefined
              if (!functionDef || !isOpenAIImageFunction(functionDef)) return node
              const currentConfig = mergedOpenAIImageConfig(
                functionDef.openaiImage,
                node.data.openaiImageConfig as Partial<OpenAIImageConfig>,
              )
              return {
                ...node,
                data: {
                  ...node.data,
                  openaiImageConfig: mergedOpenAIImageConfig(currentConfig, patch),
                },
              }
            }),
          },
        },
      }))
    },

    updateFunctionNodeGeminiImageConfig: (nodeId, patch) => {
      const now = runtime.now()
      set((state) => ({
        project: {
          ...state.project,
          project: { ...state.project.project, updatedAt: now },
          canvas: {
            ...state.project.canvas,
            nodes: state.project.canvas.nodes.map((node) => {
              if (node.id !== nodeId || node.type !== 'function') return node
              const functionId = typeof node.data.functionId === 'string' ? node.data.functionId : undefined
              const functionDef = functionId ? state.project.functions[functionId] : undefined
              if (!functionDef || !isGeminiImageFunction(functionDef)) return node
              const currentConfig = mergedGeminiImageConfig(
                functionDef.geminiImage,
                node.data.geminiImageConfig as Partial<GeminiImageConfig>,
              )
              return {
                ...node,
                data: {
                  ...node.data,
                  geminiImageConfig: mergedGeminiImageConfig(currentConfig, patch),
                },
              }
            }),
          },
        },
      }))
    },

    runFunctionNode: (nodeId, requestedRunCount) => {
      const state = get()
      const node = state.project.canvas.nodes.find((item) => item.id === nodeId && item.type === 'function')
      if (!node) return
      const functionId = String(node.data.functionId ?? '')
      const functionDef = state.project.functions[functionId]
      if (!functionDef) return
      if (isOpenAILlmFunction(functionDef)) {
        void runOpenAiFunctionNode(nodeId, requestedRunCount)
        return
      }
      if (isGeminiLlmFunction(functionDef)) {
        void runGeminiFunctionNode(nodeId, requestedRunCount)
        return
      }
      if (isOpenAIImageFunction(functionDef)) {
        void runOpenAiImageFunctionNode(nodeId, requestedRunCount)
        return
      }
      if (isGeminiImageFunction(functionDef)) {
        void runGeminiImageFunctionNode(nodeId, requestedRunCount)
        return
      }

      const runCount = normalizedRunCount(
        requestedRunCount ?? Number((node.data.runtime as { runCount?: number } | undefined)?.runCount ?? 1),
      )
      const now = runtime.now()
      const inputValues = (node.data.inputValues ?? {}) as RuntimeInputValues
      const endpoint = selectEndpoint(state.project.comfy.endpoints, activeJobs(state.project.tasks), functionId)

      if (validateRequiredInputs(nodeId, functionDef, inputValues, state.project.resources).length > 0) return

      const nextNodes: CanvasNode[] = []
      const nextResources: Record<string, Resource> = {}
      const nextTasks: Record<string, ExecutionTask> = {}
      const runRange = functionRunRange(state.project, nodeId, runCount)

      for (let index = 1; index <= runCount; index += 1) {
        const runIndex = runRange.start + index - 1
        const taskId = runtime.idFactory()
        const outputKey = functionDef.outputs[0]?.key ?? 'result'
        const compiledWithInputs = injectWorkflowInputs(
          functionDef.workflow.rawJson,
          functionDef.inputs,
          inputValues,
          state.project.resources,
        )
        const randomized = randomizeWorkflowSeeds(compiledWithInputs, {
          now: runtime.now,
          randomInt: runtime.randomInt,
        })
        const outputResourceId = runtime.idFactory()
        const resultNodeId = runtime.idFactory()
        const resource: Resource = {
          id: outputResourceId,
          type: 'text',
          name: `${functionDef.name} Run ${runIndex}`,
          value: `Simulated ComfyUI result for ${functionDef.name} run ${runIndex}`,
          source: {
            kind: 'function_output',
            functionNodeId: nodeId,
            resultGroupNodeId: resultNodeId,
            taskId,
            outputKey,
          },
          metadata: {
            workflowFunctionId: functionId,
            endpointId: endpoint?.id,
            createdAt: now,
          },
        }
        const task: ExecutionTask = {
          id: taskId,
          functionNodeId: nodeId,
          functionId,
          runIndex,
          runTotal: runRange.total,
          status: endpoint ? 'succeeded' : 'failed',
          inputRefs: resourceInputRefs(inputValues),
          inputSnapshot: resourceInputSnapshot(inputValues, state.project.resources),
          inputValuesSnapshot: executionInputSnapshot(functionDef, inputValues, state.project.resources),
          paramsSnapshot: { runCount },
          workflowTemplateSnapshot: functionDef.workflow.rawJson,
          compiledWorkflowSnapshot: randomized.workflow,
          seedPatchLog: randomized.patchLog,
          endpointId: endpoint?.id,
          outputRefs: { [outputKey]: [{ resourceId: outputResourceId, type: 'text' }] },
          error: endpoint ? undefined : { code: 'endpoint_unavailable', message: 'No eligible ComfyUI endpoint' },
          createdAt: now,
          startedAt: now,
          updatedAt: now,
          completedAt: now,
        }
        const resultNode: CanvasNode = {
          id: resultNodeId,
          type: 'result_group',
          position: nextResultNodePosition([...state.project.canvas.nodes, ...nextNodes], node, functionDef),
          data: {
            sourceFunctionNodeId: nodeId,
            functionId,
            taskId,
            runIndex,
            runTotal: runRange.total,
            title: `Run ${runIndex}`,
            endpointId: endpoint?.id ?? 'unassigned',
            resources: [{ resourceId: outputResourceId, type: 'text' }],
            status: task.status,
            seedPatchLog: randomized.patchLog,
            createdAt: now,
            startedAt: now,
            completedAt: now,
          },
        }

        nextResources[outputResourceId] = resource
        nextTasks[taskId] = task
        nextNodes.push(resultNode)
      }

      set((current) => ({
        project: {
          ...current.project,
          project: { ...current.project.project, updatedAt: now },
          resources: { ...current.project.resources, ...nextResources },
          tasks: { ...tasksWithRunTotal(current.project.tasks, nodeId, runRange.total), ...nextTasks },
          canvas: {
            ...current.project.canvas,
            nodes: [...nodesWithRunTotal(current.project.canvas.nodes, nodeId, runRange.total), ...nextNodes],
          },
        },
      }))
    },

    runFunctionNodeWithComfy: async (nodeId, requestedRunCount) => {
      const state = get()
      const node = state.project.canvas.nodes.find((item) => item.id === nodeId && item.type === 'function')
      if (!node) return
      const functionId = String(node.data.functionId ?? '')
      const functionDef = state.project.functions[functionId]
      if (!functionDef) return
      if (isOpenAILlmFunction(functionDef)) {
        await runOpenAiFunctionNode(nodeId, requestedRunCount)
        return
      }
      if (isGeminiLlmFunction(functionDef)) {
        await runGeminiFunctionNode(nodeId, requestedRunCount)
        return
      }
      if (isOpenAIImageFunction(functionDef)) {
        await runOpenAiImageFunctionNode(nodeId, requestedRunCount)
        return
      }
      if (isGeminiImageFunction(functionDef)) {
        await runGeminiImageFunctionNode(nodeId, requestedRunCount)
        return
      }

      const runCount = normalizedRunCount(
        requestedRunCount ?? Number((node.data.runtime as { runCount?: number } | undefined)?.runCount ?? 1),
      )
      const now = runtime.now()
      const inputValues = (node.data.inputValues ?? {}) as RuntimeInputValues
      const workerEndpoints = state.project.comfy.endpoints.filter(
        (endpoint) => endpointIsWorkerEligible(endpoint) && endpointSupportsFunction(endpoint, functionId),
      )

      if (validateRequiredInputs(nodeId, functionDef, inputValues, state.project.resources).length > 0) return

      if (workerEndpoints.length === 0) {
        get().runFunctionNode(nodeId, requestedRunCount)
        return
      }

      const queuedNodes: CanvasNode[] = []
      const queuedTasks: Record<string, ExecutionTask> = {}
      const queuedRuns: QueuedComfyRun[] = []
      const completionPromises: Promise<void>[] = []
      const runRange = functionRunRange(state.project, nodeId, runCount)

      for (let index = 1; index <= runCount; index += 1) {
        const runIndex = runRange.start + index - 1
        const taskId = runtime.idFactory()
        const resultNodeId = runtime.idFactory()
        const task: ExecutionTask = {
          id: taskId,
          functionNodeId: nodeId,
          functionId,
          runIndex,
          runTotal: runRange.total,
          status: 'queued',
          inputRefs: resourceInputRefs(inputValues),
          inputSnapshot: resourceInputSnapshot(inputValues, state.project.resources),
          inputValuesSnapshot: executionInputSnapshot(functionDef, inputValues, state.project.resources),
          paramsSnapshot: { runCount, mode: 'comfy' },
          workflowTemplateSnapshot: functionDef.workflow.rawJson,
          compiledWorkflowSnapshot: functionDef.workflow.rawJson,
          seedPatchLog: [],
          outputRefs: {},
          createdAt: now,
          updatedAt: now,
        }
        const resultNode: CanvasNode = {
          id: resultNodeId,
          type: 'result_group',
          position: nextResultNodePosition([...state.project.canvas.nodes, ...queuedNodes], node, functionDef),
          data: {
            sourceFunctionNodeId: nodeId,
            functionId,
            taskId,
            runIndex,
            runTotal: runRange.total,
            title: `Run ${runIndex}`,
            resources: [],
            status: 'queued',
            seedPatchLog: [],
            createdAt: now,
          },
        }
        let resolveCompletion: () => void = () => undefined
        const completion = new Promise<void>((resolve) => {
          resolveCompletion = resolve
        })

        queuedTasks[taskId] = task
        queuedNodes.push(resultNode)
        queuedRuns.push({
          taskId,
          resultNodeId,
          functionNodeId: nodeId,
          functionId,
          functionDef,
          inputValues,
          runIndex,
          runTotal: runRange.total,
          createdAt: now,
          completion,
          resolveCompletion,
        })
        completionPromises.push(completion)
      }

      set((current) => ({
        project: {
          ...current.project,
          project: { ...current.project.project, updatedAt: now },
          tasks: { ...tasksWithRunTotal(current.project.tasks, nodeId, runRange.total), ...queuedTasks },
          canvas: {
            ...current.project.canvas,
            nodes: [...nodesWithRunTotal(current.project.canvas.nodes, nodeId, runRange.total), ...queuedNodes],
          },
        },
      }))

      comfyQueue.push(...queuedRuns)
      ensureComfyWorkers()
      await Promise.all(completionPromises)
    },

    rerunResultNode: async (resultNodeId) => {
      const state = get()
      const resultNode = state.project.canvas.nodes.find((node) => node.id === resultNodeId && node.type === 'result_group')
      if (!resultNode || typeof resultNode.data.taskId !== 'string') return

      const taskId = resultNode.data.taskId
      const task = state.project.tasks[taskId]
      if (!task || activeTaskStatuses.has(task.status)) return

      const functionDef = state.project.functions[task.functionId]
      if (!functionDef) {
        failResultRunInPlace(resultNodeId, taskId, 'function_missing', 'Function definition is missing')
        return
      }

      const now = runtime.now()
      const inputValues = structuredClone(task.inputRefs) as RuntimeInputValues
      resetResultNodeForRetry(resultNodeId, taskId, now)

      if (isOpenAILlmFunction(functionDef)) {
        const functionNode = get().project.canvas.nodes.find((node) => node.id === task.functionNodeId && node.type === 'function')
        const nodeConfig = functionNode?.data.openaiConfig as Partial<OpenAILlmConfig> | undefined
        await executeOpenAiQueueItem({
          taskId,
          resultNodeId,
          functionNodeId: task.functionNodeId,
          functionId: task.functionId,
          functionDef,
          inputValues,
          config: mergedOpenAILlmConfig(functionDef.openai, nodeConfig),
          runIndex: task.runIndex,
          runTotal: task.runTotal,
        })
        return
      }

      if (isGeminiLlmFunction(functionDef)) {
        const functionNode = get().project.canvas.nodes.find((node) => node.id === task.functionNodeId && node.type === 'function')
        const nodeConfig = functionNode?.data.geminiConfig as Partial<GeminiLlmConfig> | undefined
        await executeGeminiQueueItem({
          taskId,
          resultNodeId,
          functionNodeId: task.functionNodeId,
          functionId: task.functionId,
          functionDef,
          inputValues,
          config: mergedGeminiLlmConfig(functionDef.gemini, nodeConfig),
          runIndex: task.runIndex,
          runTotal: task.runTotal,
        })
        return
      }

      if (isOpenAIImageFunction(functionDef)) {
        const functionNode = get().project.canvas.nodes.find((node) => node.id === task.functionNodeId && node.type === 'function')
        const nodeConfig = functionNode?.data.openaiImageConfig as Partial<OpenAIImageConfig> | undefined
        await executeOpenAiImageQueueItem({
          taskId,
          resultNodeId,
          functionNodeId: task.functionNodeId,
          functionId: task.functionId,
          functionDef,
          inputValues,
          config: mergedOpenAIImageConfig(functionDef.openaiImage, nodeConfig),
          runIndex: task.runIndex,
          runTotal: task.runTotal,
        })
        return
      }

      if (isGeminiImageFunction(functionDef)) {
        const functionNode = get().project.canvas.nodes.find((node) => node.id === task.functionNodeId && node.type === 'function')
        const nodeConfig = functionNode?.data.geminiImageConfig as Partial<GeminiImageConfig> | undefined
        await executeGeminiImageQueueItem({
          taskId,
          resultNodeId,
          functionNodeId: task.functionNodeId,
          functionId: task.functionId,
          functionDef,
          inputValues,
          config: mergedGeminiImageConfig(functionDef.geminiImage, nodeConfig),
          runIndex: task.runIndex,
          runTotal: task.runTotal,
        })
        return
      }

      const workerEndpoints = get().project.comfy.endpoints.filter(
        (endpoint) => endpointIsWorkerEligible(endpoint) && endpointSupportsFunction(endpoint, task.functionId),
      )
      if (workerEndpoints.length === 0) {
        failResultRunInPlace(resultNodeId, taskId, 'endpoint_unavailable', 'No eligible ComfyUI endpoint')
        return
      }

      let resolveCompletion: () => void = () => undefined
      const completion = new Promise<void>((resolve) => {
        resolveCompletion = resolve
      })
      const compiledWorkflowSnapshot =
        Object.keys(task.compiledWorkflowSnapshot).length > 0 ? structuredClone(task.compiledWorkflowSnapshot) : undefined
      comfyQueue.push({
        taskId,
        resultNodeId,
        functionNodeId: task.functionNodeId,
        functionId: task.functionId,
        functionDef,
        inputValues,
        compiledWorkflowSnapshot,
        seedPatchLog: structuredClone(task.seedPatchLog),
        runIndex: task.runIndex,
        runTotal: task.runTotal,
        createdAt: task.createdAt,
        completion,
        resolveCompletion,
      })
      ensureComfyWorkers()
      await completion
    },

    cancelResultRun: (resultNodeId) => {
      const state = get()
      const resultNode = state.project.canvas.nodes.find((node) => node.id === resultNodeId && node.type === 'result_group')
      if (!resultNode || typeof resultNode.data.taskId !== 'string') return

      const taskId = resultNode.data.taskId
      const task = state.project.tasks[taskId]
      if (!task || !activeTaskStatuses.has(task.status)) return

      if (task.status === 'running' && task.endpointId) {
        const endpoint = state.project.comfy.endpoints.find((item) => item.id === task.endpointId)
        if (endpoint) {
          void runtime
            .createComfyClient(endpoint)
            .interrupt?.()
            .catch(() => undefined)
        }
      }

      const queuedIndex = comfyQueue.findIndex((item) => item.taskId === taskId)
      if (queuedIndex >= 0) {
        const [queuedRun] = comfyQueue.splice(queuedIndex, 1)
        queuedRun?.resolveCompletion()
      }

      const canceledAt = runtime.now()
      set((current) => ({
        project: {
          ...current.project,
          project: { ...current.project.project, updatedAt: canceledAt },
          tasks: {
            ...current.project.tasks,
            [taskId]: {
              ...current.project.tasks[taskId]!,
              status: 'canceled',
              updatedAt: canceledAt,
              completedAt: canceledAt,
            },
          },
          canvas: {
            ...current.project.canvas,
            nodes: current.project.canvas.nodes.map((node) =>
              node.id === resultNodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      status: 'canceled',
                      completedAt: canceledAt,
                    },
                  }
                : node,
            ),
          },
        },
      }))
    },

    undoLastProjectChange: () => {
      set((state) => {
        const previousProject = state.undoStack.at(-1)
        if (!previousProject) return state
        const project = withBuiltInFunctions(structuredClone(previousProject), runtime.now())
        return {
          project,
          projectLibrary: {
            ...state.projectLibrary,
            [project.project.id]: project,
          },
          undoStack: state.undoStack.slice(0, -1),
          ...selectedState([]),
        }
      })
    },

    connectNodes: (sourceNodeId, targetNodeId, options) => {
      const state = get()
      const sourceNode = state.project.canvas.nodes.find((node) => node.id === sourceNodeId)
      const targetNode = state.project.canvas.nodes.find((node) => node.id === targetNodeId)
      if (!sourceNode || !targetNode || targetNode.type !== 'function') return

      const functionId = typeof targetNode.data.functionId === 'string' ? targetNode.data.functionId : undefined
      const functionDef = functionId ? state.project.functions[functionId] : undefined
      if (!functionDef) return

      const currentInputValues = (targetNode.data.inputValues ?? {}) as RuntimeInputValues
      const preferredResourceId = resourceIdFromHandle(options?.sourceHandleId)
      const sourceRefs = nodeResourceRefs(sourceNode).filter((ref) =>
        preferredResourceId ? ref.resourceId === preferredResourceId : true,
      )
      const sourceResource = sourceRefs
        .map((ref) => state.project.resources[ref.resourceId])
        .find((resource) =>
          resource
            ? inputKeyForConnection(functionDef.inputs, resource.type, currentInputValues, options?.targetInputKey)
            : false,
        )
      if (!sourceResource) return

      const resourceId = sourceResource.id
      const resource = sourceResource
      const inputKey = inputKeyForConnection(functionDef.inputs, resource.type, currentInputValues, options?.targetInputKey)
      if (!inputKey) return

      const now = runtime.now()
      const edge: CanvasEdge = {
        id: `edge_${sourceNodeId}_${targetNodeId}_${inputKey}`,
        source: {
          nodeId: sourceNodeId,
          handleId: options?.sourceHandleId ?? sourceHandleForResource(sourceNode, resourceId),
          resourceId,
        },
        target: { nodeId: targetNodeId, inputKey },
        type: 'resource_to_input',
      }

      set((current) => ({
        project: {
          ...current.project,
          project: { ...current.project.project, updatedAt: now },
          canvas: {
            ...current.project.canvas,
            nodes: current.project.canvas.nodes.map((node) =>
              node.id === targetNodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      missingInputKeys: Array.isArray(node.data.missingInputKeys)
                        ? node.data.missingInputKeys.filter((key) => key !== inputKey)
                        : [],
                      status:
                        node.data.status === 'missing_inputs' &&
                        Array.isArray(node.data.missingInputKeys) &&
                        node.data.missingInputKeys.filter((key) => key !== inputKey).length === 0
                          ? 'idle'
                          : node.data.status,
                      inputValues: {
                        ...((node.data.inputValues ?? {}) as RuntimeInputValues),
                        [inputKey]: { resourceId, type: resource.type },
                      },
                    },
                  }
                : node,
            ),
            edges: [
              ...current.project.canvas.edges.filter(
                (item) => !(item.target.nodeId === targetNodeId && item.target.inputKey === inputKey),
              ),
              edge,
            ],
          },
        },
      }))
    },

    deleteEdges: (edgeIds) => {
      const ids = new Set(edgeIds.filter(Boolean))
      if (ids.size === 0) return
      const now = runtime.now()
      set((state) => {
        const explicitEdgeIds = new Set<string>()
        const clearedInputsByNode = new Map<string, Set<string>>()
        const markInput = (nodeId: string, inputKey: string) => {
          const inputKeys = clearedInputsByNode.get(nodeId) ?? new Set<string>()
          inputKeys.add(inputKey)
          clearedInputsByNode.set(nodeId, inputKeys)
        }

        for (const edgeId of ids) {
          const explicitEdge = state.project.canvas.edges.find((edge) => edge.id === edgeId)
          if (explicitEdge) {
            explicitEdgeIds.add(edgeId)
            markInput(explicitEdge.target.nodeId, explicitEdge.target.inputKey)
            continue
          }

          const parts = edgeId.split(':')
          if (parts[0] === 'input' && parts.length >= 4) {
            markInput(parts[2], parts.slice(3).join(':'))
          }
        }

        if (explicitEdgeIds.size === 0 && clearedInputsByNode.size === 0) return state

        return {
          undoStack: undoStackWithSnapshot(state),
          project: {
            ...state.project,
            project: { ...state.project.project, updatedAt: now },
            canvas: {
              ...state.project.canvas,
              nodes: state.project.canvas.nodes.map((node) => {
                const inputKeys = clearedInputsByNode.get(node.id)
                if (!inputKeys || node.type !== 'function') return node
                const inputValues = { ...((node.data.inputValues ?? {}) as RuntimeInputValues) }
                for (const inputKey of inputKeys) delete inputValues[inputKey]
                return {
                  ...node,
                  data: {
                    ...node.data,
                    inputValues,
                  },
                }
              }),
              edges: state.project.canvas.edges.filter((edge) => !explicitEdgeIds.has(edge.id)),
            },
          },
        }
      })
    },

    updateNodePosition: (nodeId, position) => {
      get().updateNodePositions({ [nodeId]: position })
    },

    updateNodePositions: (positionsByNodeId) => {
      const now = runtime.now()
      set((state) => ({
        project: {
          ...state.project,
          project: { ...state.project.project, updatedAt: now },
          canvas: {
            ...state.project.canvas,
            nodes: state.project.canvas.nodes.map((node) =>
              positionsByNodeId[node.id] ? { ...node, position: positionsByNodeId[node.id] } : node,
            ),
          },
        },
      }))
    },

    updateNodeSize: (nodeId, size) => {
      const width = Math.round(Number(size.width))
      const height = Math.round(Number(size.height))
      if (!Number.isFinite(width) || !Number.isFinite(height)) return

      const now = runtime.now()
      set((state) => ({
        project: {
          ...state.project,
          project: { ...state.project.project, updatedAt: now },
          canvas: {
            ...state.project.canvas,
            nodes: state.project.canvas.nodes.map((node) =>
              node.id === nodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      size: {
                        width: Math.max(220, width),
                        height: Math.max(120, height),
                      },
                    },
                  }
                : node,
            ),
          },
        },
      }))
    },

    renameNode: (nodeId, title) => {
      const trimmedTitle = title.trim()
      if (!trimmedTitle) return

      const now = runtime.now()
      set((state) => {
        const node = state.project.canvas.nodes.find((item) => item.id === nodeId)
        if (!node) return state

        const resources = { ...state.project.resources }
        if (node.type === 'resource') {
          const resourceId = String(node.data.resourceId ?? '')
          const resource = resources[resourceId]
          if (resource) resources[resourceId] = { ...resource, name: trimmedTitle }
        }

        return {
          project: {
            ...state.project,
            project: { ...state.project.project, updatedAt: now },
            resources,
            canvas: {
              ...state.project.canvas,
              nodes: state.project.canvas.nodes.map((item) =>
                item.id === nodeId
                  ? {
                      ...item,
                      data: {
                        ...item.data,
                        title: trimmedTitle,
                      },
                    }
                  : item,
              ),
            },
          },
        }
      })
    },

    deleteSelectedNode: () => {
      const state = get()
      const nodeIds = state.selectedNodeIds.length
        ? state.selectedNodeIds
        : state.selectedNodeId
          ? [state.selectedNodeId]
          : []
      if (nodeIds.length === 0) return
      const now = runtime.now()
      set((current) => deleteNodesFromState(current, nodeIds, now))
    },

    deleteNode: (nodeId) => {
      const now = runtime.now()
      set((state) => deleteNodesFromState(state, [nodeId], now))
    },

    duplicateSelectedNode: () => {
      const selectedNodeId = get().selectedNodeId
      const selectedNode = selectedNodeId
        ? get().project.canvas.nodes.find((node) => node.id === selectedNodeId)
        : undefined
      if (!selectedNode) return

      const now = runtime.now()
      if (selectedNode.type === 'resource') {
        const originalResourceId = String(selectedNode.data.resourceId ?? '')
        const originalResource = get().project.resources[originalResourceId]
        if (!originalResource) return

        const resourceId = runtime.idFactory()
        const nodeId = `node_${resourceId}`
        const resource: Resource = {
          ...structuredClone(originalResource),
          id: resourceId,
          name: `${originalResource.name ?? 'Resource'} Copy`,
          source: {
            kind: 'duplicated',
            parentResourceId: originalResource.id,
          },
          metadata: {
            ...originalResource.metadata,
            createdAt: now,
          },
        }
        const node: CanvasNode = {
          ...selectedNode,
          id: nodeId,
          position: { x: selectedNode.position.x + 40, y: selectedNode.position.y + 40 },
          data: {
            ...selectedNode.data,
            resourceId,
            title: resource.name,
          },
        }

        set((state) => ({
          ...selectedState([nodeId]),
          project: {
            ...state.project,
            project: { ...state.project.project, updatedAt: now },
            resources: { ...state.project.resources, [resourceId]: resource },
            canvas: { ...state.project.canvas, nodes: [...state.project.canvas.nodes, node] },
          },
        }))
        return
      }

      if (selectedNode.type === 'function') {
        const nodeId = runtime.idFactory()
        const node: CanvasNode = {
          ...structuredClone(selectedNode),
          id: nodeId,
          position: { x: selectedNode.position.x + 40, y: selectedNode.position.y + 40 },
          data: {
            ...selectedNode.data,
            title: `${String(selectedNode.data.title ?? 'Function')} Copy`,
          },
        }

        set((state) => ({
          ...selectedState([nodeId]),
          project: {
            ...state.project,
            project: { ...state.project.project, updatedAt: now },
            canvas: { ...state.project.canvas, nodes: [...state.project.canvas.nodes, node] },
          },
        }))
      }
    },

    duplicateNodes: (nodeIds) => {
      const ids = uniqueIds(nodeIds)
      if (ids.length === 0) return
      const now = runtime.now()
      const offset = 48

      set((state) => {
        const nodesById = new Map(state.project.canvas.nodes.map((node) => [node.id, node]))
        const newNodes: CanvasNode[] = []
        const newResources: Record<string, Resource> = {}
        const selectedIds: string[] = []

        for (const nodeId of ids) {
          const node = nodesById.get(nodeId)
          if (!node) continue

          if (node.type === 'resource') {
            const originalResourceId = String(node.data.resourceId ?? '')
            const originalResource = state.project.resources[originalResourceId]
            if (!originalResource) continue

            const resourceId = runtime.idFactory()
            const duplicatedNodeId = `node_${resourceId}`
            const resource: Resource = {
              ...structuredClone(originalResource),
              id: resourceId,
              name: `${originalResource.name ?? 'Resource'} Copy`,
              source: {
                kind: 'duplicated',
                parentResourceId: originalResource.id,
              },
              metadata: {
                ...originalResource.metadata,
                createdAt: now,
              },
            }
            const duplicatedNode: CanvasNode = {
              ...structuredClone(node),
              id: duplicatedNodeId,
              position: { x: node.position.x + offset, y: node.position.y + offset },
              data: {
                ...node.data,
                resourceId,
                title: resource.name,
              },
            }

            newResources[resourceId] = resource
            newNodes.push(duplicatedNode)
            selectedIds.push(duplicatedNodeId)
            continue
          }

          if (node.type === 'function') {
            const duplicatedNodeId = runtime.idFactory()
            const duplicatedNode: CanvasNode = {
              ...structuredClone(node),
              id: duplicatedNodeId,
              position: { x: node.position.x + offset, y: node.position.y + offset },
              data: {
                ...structuredClone(node.data),
                title: `${String(node.data.title ?? 'Function')} Copy`,
                inputValues: {},
              },
            }

            newNodes.push(duplicatedNode)
            selectedIds.push(duplicatedNodeId)
          }
        }

        if (newNodes.length === 0) return state

        return {
          ...selectedState(selectedIds),
          project: {
            ...state.project,
            project: { ...state.project.project, updatedAt: now },
            resources: { ...state.project.resources, ...newResources },
            canvas: { ...state.project.canvas, nodes: [...state.project.canvas.nodes, ...newNodes] },
          },
        }
      })
    },

    selectNode: (nodeId, mode = 'replace') =>
      set((state) => {
        const current = state.selectedNodeIds.length
          ? state.selectedNodeIds
          : state.selectedNodeId
            ? [state.selectedNodeId]
            : []
        const nodeIds = nodeId ? nextSelection(state.project.canvas.nodes, current, [nodeId], mode) : []
        if (sameNodeIds(current, nodeIds)) return state
        return selectedState(nodeIds)
      }),

    selectNodes: (nodeIds, mode = 'replace') =>
      set((state) => {
        const current = state.selectedNodeIds.length
          ? state.selectedNodeIds
          : state.selectedNodeId
            ? [state.selectedNodeId]
            : []
        const nextNodeIds = nextSelection(state.project.canvas.nodes, current, nodeIds, mode)
        if (sameNodeIds(current, nextNodeIds)) return state
        return selectedState(nextNodeIds)
      }),

    addEndpoint: () => {
      const endpointId = runtime.idFactory()
      const now = runtime.now()
      const endpoint: ComfyEndpointConfig = {
        id: endpointId,
        name: `ComfyUI ${get().project.comfy.endpoints.length + 1}`,
        baseUrl: 'http://127.0.0.1:8188',
        enabled: true,
        maxConcurrentJobs: 1,
        priority: 1,
        timeoutMs: 600000,
        auth: { type: 'none' },
        health: { status: 'unknown' },
      }

      set((state) => ({
        project: {
          ...state.project,
          project: { ...state.project.project, updatedAt: now },
          comfy: {
            ...state.project.comfy,
            endpoints: [...state.project.comfy.endpoints, endpoint],
          },
        },
      }))
    },

    updateEndpoint: (endpointId, patch) => {
      const now = runtime.now()
      set((state) => ({
        project: {
          ...state.project,
          project: { ...state.project.project, updatedAt: now },
          comfy: {
            ...state.project.comfy,
            endpoints: state.project.comfy.endpoints.map((endpoint) =>
              endpoint.id === endpointId ? { ...endpoint, ...patch } : endpoint,
            ),
          },
        },
      }))
    },

    deleteEndpoint: (endpointId) => {
      const now = runtime.now()
      set((state) => ({
        project: {
          ...state.project,
          project: { ...state.project.project, updatedAt: now },
          comfy: {
            ...state.project.comfy,
            endpoints: state.project.comfy.endpoints.filter((endpoint) => endpoint.id !== endpointId),
          },
        },
      }))
    },

    markEndpoint: (endpointId, status, message) => {
      const now = runtime.now()
      set((state) => ({
        project: {
          ...state.project,
          project: { ...state.project.project, updatedAt: now },
          comfy: {
            ...state.project.comfy,
            endpoints: state.project.comfy.endpoints.map((endpoint) =>
              endpoint.id === endpointId
                ? { ...endpoint, health: { status, message, lastCheckedAt: now } }
                : endpoint,
            ),
          },
        },
      }))
    },

    exportProject: () => createProjectPackage(get().project),
    exportConfig: () => createConfigPackage(get().project),

    importProject: (payload) => {
      const now = runtime.now()
      const importedProject = withBuiltInFunctions(payload.project, now)
      set((state) => ({
        project: importedProject,
        projectLibrary: {
          ...projectLibraryWithActive(state),
          [importedProject.project.id]: importedProject,
        },
        undoStack: [],
        ...selectedState([]),
      }))
    },

    importConfig: (payload) => {
      const config = payload.config
      const now = runtime.now()
      set((state) => {
        const project = {
          ...state.project,
          project: { ...state.project.project, updatedAt: now },
          functions: withBuiltInFunctions({ ...state.project, functions: config.functions }, now).functions,
          comfy: {
            ...config.comfy,
            endpoints: config.comfy.endpoints.map((endpoint) => ({
              ...endpoint,
              health: { status: 'unknown' as const },
            })),
          },
        }
        return {
          project,
          projectLibrary: {
            ...state.projectLibrary,
            [project.project.id]: project,
          },
        }
      })
    },
    }
  })
}

export const projectStore = createProjectSlice()

const PROJECT_STORAGE_KEY = 'infinity-comfyui.project.v1'
const PROJECT_LIBRARY_STORAGE_KEY = 'infinity-comfyui.projects.v1'

const serializeProjectLibrary = (state: ProjectStoreState): ProjectLibraryPackage => {
  const projects = {
    ...state.projectLibrary,
    [state.project.project.id]: state.project,
  }
  return {
    currentProjectId: state.project.project.id,
    projects: Object.fromEntries(
      Object.entries(projects).map(([projectId, project]) => [projectId, withoutBuiltInProjectFunctions(project)]),
    ),
  }
}

const loadProjectLibrary = (payload: ProjectLibraryPackage | undefined, now: string) => {
  const projectEntries = Object.entries(payload?.projects ?? {})
  if (projectEntries.length === 0) return false

  const projects = Object.fromEntries(
    projectEntries.map(([projectId, project]) => [projectId, withBuiltInFunctions(project, now)]),
  ) as Record<string, ProjectState>
  const activeProject = projects[payload?.currentProjectId ?? ''] ?? Object.values(projects)[0]
  if (!activeProject) return false

  projectStore.setState({
    project: activeProject,
    projectLibrary: projects,
    ...selectedState([]),
  })
  return true
}

const loadIndexedDbProjectLibrary = () =>
  getIdb<ProjectLibraryPackage>(PROJECT_LIBRARY_STORAGE_KEY)
    .then(async (savedLibrary) => {
      const now = new Date().toISOString()
      if (loadProjectLibrary(savedLibrary, now)) return

      const savedProject = await getIdb<ProjectState>(PROJECT_STORAGE_KEY)
      if (!savedProject) return
      const project = withBuiltInFunctions(savedProject, now)
      projectStore.setState({
        project,
        projectLibrary: { [project.project.id]: project },
        ...selectedState([]),
      })
    })
    .catch(() => undefined)

const startIndexedDbProjectPersistence = () => {
  void loadIndexedDbProjectLibrary()

  projectStore.subscribe((state) => {
    void setIdb(PROJECT_STORAGE_KEY, withoutBuiltInProjectFunctions(state.project)).catch(() => undefined)
    void setIdb(PROJECT_LIBRARY_STORAGE_KEY, serializeProjectLibrary(state)).catch(() => undefined)
  })
}

const startDesktopProjectPersistence = (storage: DesktopProjectStorage) => {
  void storage
    .loadProjectLibrary()
    .then((savedLibrary) => {
      const now = new Date().toISOString()
      loadProjectLibrary(savedLibrary, now)
    })
    .catch(() => undefined)

  let saveTimer: number | undefined

  const saveProjectLibrary = (state: ProjectStoreState) =>
    storage.saveProjectLibrary(serializeProjectLibrary(state)).catch(() => undefined)

  projectStore.subscribe((state) => {
    if (saveTimer !== undefined) window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      saveTimer = undefined
      void saveProjectLibrary(state)
    }, 250)
  })

  window.addEventListener('beforeunload', () => {
    if (saveTimer !== undefined) window.clearTimeout(saveTimer)
    void saveProjectLibrary(projectStore.getState())
  })
}

if (typeof window !== 'undefined') {
  if (window.infinityComfyUIStorage) {
    startDesktopProjectPersistence(window.infinityComfyUIStorage)
  } else if (typeof indexedDB !== 'undefined') {
    startIndexedDbProjectPersistence()
  }
}

export function useProjectStore<T>(selector: (state: ProjectStoreState) => T): T {
  return useStore(projectStore, selector)
}
