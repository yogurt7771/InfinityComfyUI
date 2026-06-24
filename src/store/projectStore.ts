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
import {
  compileRequestFunctionRequest,
  createRequestFunction,
  extractRequestFunctionOutputs,
  isRequestFunction,
  mergedRequestConfig,
  normalizeRequestOutputsForParse,
  REQUEST_FUNCTION_ID,
  requestDefaultEncoding,
  type RequestBinaryOutputValue,
} from '../domain/requestFunction'
import {
  createLocalTransformFunctions,
  executeLocalTransformFunction,
  isLocalTransformFunction,
  type LocalTransformOutputValue,
} from '../domain/localTransforms'
import { inputValuesFromTaskSnapshot, resolveExecutionTaskDependencies } from '../domain/runs/dependencyResolver'
import { createRunSnapshot, generatedResourceSourceForRun, runProviderForFunction } from '../domain/runs/runSnapshot'
import { createConfigPackage, createProjectPackage, type ConfigPackage, type FullProjectPackage } from '../domain/projectPackage'
import { createIdleProjectPersistenceController } from '../domain/persistence/projectPersistence'
import {
  createPersistentProjectSnapshot,
  createProjectLibraryRevisionKey,
  createProjectLibrarySnapshot,
  restoreProjectLibrarySnapshot,
  type ProjectLibraryPackage,
} from '../domain/persistence/projectSerializer'
import { blobToDataUrl } from '../domain/projectAssets'
import { randomizeWorkflowSeeds } from '../domain/seed'
import { selectEndpoint } from '../domain/scheduler'
import { createGenerationFunctionFromWorkflow, injectWorkflowInputs, workflowPrimitiveInputValue } from '../domain/workflow'
import { isBuiltInFunction, withoutBuiltInProjectFunctions } from '../domain/builtInFunctions'
import type { MediaResourcePayload, MediaResourceKind } from '../domain/resourceFiles'
import {
  isAssetBackedPrimitiveResourceValue,
  isMediaResourceValue,
  primitiveAssetRecord,
  primitiveResourceValueWithAsset,
  resolvedPrimitiveResourceValue,
  resolveResourceForDisplay,
  resourceAssetId as assetIdForResource,
} from '../domain/resourceValues'
import type {
  CanvasEdge,
  CanvasNode,
  CanvasTemplate,
  ComfyEndpointConfig,
  ComfyUiWorkflow,
  ComfyWorkflowEditorMetadata,
  ComfyWorkflow,
  ExecutionInputSnapshot,
  ExecutionTask,
  FunctionInputDef,
  FunctionOutputDef,
  GeminiImageConfig,
  GeminiLlmConfig,
  GenerationFunction,
  InputResourceRef,
  MediaResourceValue,
  OpenAIImageConfig,
  OpenAILlmConfig,
  PendingResourceRef,
  PrimitiveInputValue,
  ProjectHistoryPreview,
  ProjectHistorySnapshot,
  ProjectHistoryState,
  ProjectTransactionType,
  ProjectState,
  RequestFunctionConfig,
  AssetRecord,
  Resource,
  ResourceRef,
  ResourceType,
} from '../domain/types'

type RuntimeInputValues = Record<string, PrimitiveInputValue | InputResourceRef>
type ResolvedRuntimeInputValues = Record<string, PrimitiveInputValue | ResourceRef>
type ConnectNodesOptions = {
  sourceHandleId?: string | null
  targetInputKey?: string | null
}
type AddFunctionNodeOptions = {
  autoBindRequiredInputs?: boolean
}
type NodeSelectionMode = 'replace' | 'add' | 'remove' | 'toggle'
type FunctionEditScope = 'node' | 'all'
type AssetResourceValueInput =
  | {
      type: 'text'
      name: string
      value: string
    }
  | {
      type: 'number'
      name: string
      value: number
    }
  | {
      type: MediaResourceKind
      name: string
      media: MediaResourcePayload
    }
type AssetResourceCreateInput = AssetResourceValueInput & { position: { x: number; y: number } }

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
  inputValues: ResolvedRuntimeInputValues
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
  inputValues: ResolvedRuntimeInputValues
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
  inputValues: ResolvedRuntimeInputValues
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
  inputValues: ResolvedRuntimeInputValues
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
  inputValues: ResolvedRuntimeInputValues
  config: GeminiImageConfig
  runIndex: number
  runTotal: number
}

type QueuedRequestRun = {
  taskId: string
  resultNodeId: string
  functionNodeId: string
  functionId: string
  functionDef: GenerationFunction
  inputValues: ResolvedRuntimeInputValues
  runIndex: number
  runTotal: number
}

type QueuedLocalRun = {
  taskId: string
  resultNodeId: string
  sourceNodeId: string
  functionId: string
  functionDef: GenerationFunction
  inputValues: ResolvedRuntimeInputValues
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
export type { ProjectLibraryPackage } from '../domain/persistence/projectSerializer'

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
  addAssetResourcesAtPositions: (items: AssetResourceCreateInput[]) => string[]
  replaceAssetResource: (resourceId: string, item: AssetResourceValueInput) => void
  updateTextResourceValue: (resourceId: string, value: string) => void
  updateNumberResourceValue: (resourceId: string, value: number) => void
  replaceResourceMedia: (resourceId: string, type: MediaResourceKind, media: MediaResourcePayload) => void
  addFunctionFromWorkflow: (
    name: string,
    workflow: ComfyWorkflow,
    options?: { uiJson?: ComfyUiWorkflow; editor?: ComfyWorkflowEditorMetadata },
  ) => string
  addRequestFunction: (name: string, config?: Partial<RequestFunctionConfig>) => string
  addOpenAILlmFunction: (name: string, config?: Partial<OpenAILlmConfig>) => string
  addGeminiLlmFunction: (name: string, config?: Partial<GeminiLlmConfig>) => string
  updateFunction: (functionId: string, patch: Partial<Omit<GenerationFunction, 'id' | 'createdAt'>>) => void
  ensureEditableFunctionForNode: (nodeId: string, scope: FunctionEditScope) => string | undefined
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
  updateFunctionNodeRequestConfig: (nodeId: string, patch: Partial<RequestFunctionConfig>) => void
  updateFunctionNodeRequestOutputs: (nodeId: string, outputs: FunctionOutputDef[]) => void
  runFunctionAtPosition: (
    functionId: string,
    inputValues: Record<string, PrimitiveInputValue | ResourceRef>,
    position: { x: number; y: number },
    runCount?: number,
    functionSnapshot?: GenerationFunction,
  ) => Promise<string | undefined>
  runFunctionNode: (nodeId: string, runCount?: number) => void
  runFunctionNodeWithComfy: (nodeId: string, runCount?: number) => Promise<void>
  runLocalFunctionForResourceNode: (
    sourceNodeId: string,
    functionId: string,
    inputValues?: Record<string, PrimitiveInputValue>,
  ) => Promise<void>
  rerunResultNode: (nodeId: string) => Promise<void>
  cancelResultRun: (nodeId: string) => void
  undoLastProjectChange: () => void
  redoProjectChange: () => void
  connectNodes: (sourceNodeId: string, targetNodeId: string, options?: ConnectNodesOptions) => void
  deleteEdges: (edgeIds: string[]) => void
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void
  updateNodePositions: (positionsByNodeId: Record<string, { x: number; y: number }>) => void
  updateNodeSize: (nodeId: string, size: { width: number; height: number }) => void
  renameNode: (nodeId: string, title: string) => void
  deleteSelectedNode: () => void
  deleteNode: (nodeId: string) => void
  deleteNodes: (nodeIds: string[]) => void
  groupSelectedNodes: () => string | undefined
  ungroupNode: (nodeId: string) => void
  saveTemplateFromSelection: (name?: string) => string | undefined
  instantiateTemplate: (templateId: string, position?: { x: number; y: number }) => string | undefined
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

const PROJECT_HISTORY_SCHEMA_VERSION = '1.0.0'
const PROJECT_HISTORY_LIMIT = 100
const PROJECT_PERSIST_IDLE_MS = 5000

const emptyProjectHistory = (): ProjectHistoryState => ({
  schemaVersion: PROJECT_HISTORY_SCHEMA_VERSION,
  undoStack: [],
  redoStack: [],
})

const ensureProjectHistory = (project: ProjectState): ProjectState =>
  project.history
    ? project
    : {
        ...project,
        history: emptyProjectHistory(),
      }

const compactHistoryAssetRecord = (asset: AssetRecord): AssetRecord => {
  const { blobUrl, primitiveValue, ...metadata } = asset
  return metadata
}

const compactHistoryResource = (resource: Resource): Resource => {
  if (!isMediaResourceValue(resource.value)) return resource
  const { thumbnailUrl, ...valueWithoutThumbnail } = resource.value
  return {
    ...resource,
    value: {
      ...valueWithoutThumbnail,
      url: '',
    },
  }
}

const compactHistoryResources = (resources: Record<string, Resource>) =>
  Object.fromEntries(Object.entries(resources).map(([resourceId, resource]) => [resourceId, compactHistoryResource(resource)]))

const compactHistoryAssets = (assets: Record<string, AssetRecord>) =>
  Object.fromEntries(Object.entries(assets).map(([assetId, asset]) => [assetId, compactHistoryAssetRecord(asset)]))

const compactHistoryTemplates = (templates: ProjectState['templates']) =>
  Object.fromEntries(
    Object.entries(templates ?? {}).map(([templateId, template]) => [
      templateId,
      {
        ...template,
        resources: compactHistoryResources(template.resources),
        assets: compactHistoryAssets(template.assets),
      },
    ]),
  )

const compactHistoryProjectAssets = (project: ProjectHistorySnapshot): ProjectHistorySnapshot => ({
  ...project,
  resources: compactHistoryResources(project.resources),
  assets: compactHistoryAssets(project.assets),
  templates: compactHistoryTemplates(project.templates),
})

const projectHistorySnapshot = (project: ProjectState): ProjectHistorySnapshot => {
  const snapshot = structuredClone(project)
  delete snapshot.history
  return compactHistoryProjectAssets(withoutBuiltInProjectFunctions(snapshot) as ProjectHistorySnapshot)
}

const historySnapshotKey = (snapshot: ProjectHistorySnapshot) => JSON.stringify(snapshot)

const historyEntryId = (history: ProjectHistoryState, now: string) =>
  `history_${history.undoStack.length + history.redoStack.length + 1}_${now.replace(/\W/g, '')}`

const uniqueHistoryIds = (ids: Array<string | undefined>) => [...new Set(ids.filter((id): id is string => Boolean(id)))]

const canvasNodeResourceId = (node: CanvasNode) =>
  (node.type === 'asset' || node.type === 'resource') && typeof node.data.resourceId === 'string'
    ? node.data.resourceId
    : undefined

const nodeResourceIds = (project: ProjectState, nodeIds: string[]) => {
  const ids = new Set<string>()
  const nodesById = new Map(project.canvas.nodes.map((node) => [node.id, node]))

  const visit = (nodeId: string) => {
    const node = nodesById.get(nodeId)
    if (!node) return

    const directResourceId = canvasNodeResourceId(node)
    if (directResourceId) {
      ids.add(directResourceId)
      return
    }

    if (node.type === 'result_group' && Array.isArray(node.data.resources)) {
      for (const resource of node.data.resources) {
        if (typeof resource === 'object' && resource !== null && 'resourceId' in resource) {
          ids.add(String((resource as { resourceId: unknown }).resourceId))
        }
      }
      return
    }

    if (node.type === 'group' && Array.isArray(node.data.childNodeIds)) {
      for (const childNodeId of node.data.childNodeIds) visit(String(childNodeId))
    }
  }

  for (const nodeId of nodeIds) visit(nodeId)
  return [...ids]
}

const outputResourceNodeId = (resultNodeId: string, resourceId: string) => `output_node_${resultNodeId}_${resourceId}`
const resourceNodeId = (resourceId: string) => `node_${resourceId}`

const emptyFunctionOutputValue = (type: ResourceType, resourceId: string): Resource['value'] => {
  if (type === 'number') return primitiveResourceValueWithAsset(`pending_${resourceId}`, 'number', 0)
  if (type === 'text') return primitiveResourceValueWithAsset(`pending_${resourceId}`, 'text', '')
  return {
    assetId: `pending_${resourceId}`,
    url: '',
    filename: resourceNameForType(type),
    mimeType: `${type}/*`,
    sizeBytes: 0,
  }
}

const commandOutputPosition = (
  basePosition: { x: number; y: number },
  runIndex: number,
  outputIndex: number,
) => ({
  x: basePosition.x + outputIndex * 260,
  y: basePosition.y + runIndex * 230,
})

const projectWithRecordedHistory = (
  beforeProject: ProjectState,
  nextProject: ProjectState,
  now: string,
  options: {
    label: string
    transactionType: ProjectTransactionType
    preview: ProjectHistoryPreview
    nodeIds?: string[]
    assetIds?: string[]
    groupIds?: string[]
    templateIds?: string[]
  },
): ProjectState => {
  const before = ensureProjectHistory(beforeProject)
  const next = ensureProjectHistory(nextProject)
  const beforeSnapshot = projectHistorySnapshot(before)
  const afterSnapshot = projectHistorySnapshot(next)
  if (historySnapshotKey(beforeSnapshot) === historySnapshotKey(afterSnapshot)) return next

  const history = before.history ?? emptyProjectHistory()
  const nodeIds = uniqueHistoryIds(options.nodeIds ?? options.preview.nodeIds ?? [])
  const assetIds = uniqueHistoryIds([
    ...(options.assetIds ?? []),
    ...(options.preview.assetIds ?? []),
    ...nodeResourceIds(next, nodeIds),
    ...nodeResourceIds(before, nodeIds),
  ])
  const groupIds = uniqueHistoryIds(options.groupIds ?? options.preview.groupIds ?? [])
  const templateIds = uniqueHistoryIds(options.templateIds ?? options.preview.templateIds ?? [])
  const entry = {
    id: historyEntryId(history, now),
    label: options.label,
    transactionType: options.transactionType,
    createdAt: now,
    affectedIds: {
      assetIds,
      nodeIds,
      groupIds,
      templateIds,
    },
    preview: {
      ...options.preview,
      assetIds,
      nodeIds,
      groupIds,
      templateIds,
    },
    before: beforeSnapshot,
    after: afterSnapshot,
  }

  return {
    ...next,
    history: {
      schemaVersion: PROJECT_HISTORY_SCHEMA_VERSION,
      undoStack: [...history.undoStack, entry].slice(-PROJECT_HISTORY_LIMIT),
      redoStack: [],
    },
  }
}

const restoreProjectHistorySnapshot = (
  snapshot: ProjectHistorySnapshot,
  history: ProjectHistoryState,
  now: string,
  assetLibrary: Record<string, AssetRecord> = {},
): ProjectState => {
  const restored = structuredClone(snapshot)
  const assets = {
    ...assetLibrary,
    ...Object.fromEntries(
      Object.entries(restored.assets).map(([assetId, asset]) => [
        assetId,
        {
          ...asset,
          blobUrl: asset.blobUrl ?? assetLibrary[assetId]?.blobUrl,
          primitiveValue: asset.primitiveValue ?? assetLibrary[assetId]?.primitiveValue,
        },
      ]),
    ),
  }
  const resources = Object.fromEntries(
    Object.entries(restored.resources).map(([resourceId, resource]) => {
      if (!isMediaResourceValue(resource.value)) return [resourceId, resource]
      const asset = assets[resource.value.assetId]
      return [
        resourceId,
        {
          ...resource,
          value: {
            ...resource.value,
            url: resource.value.url || asset?.blobUrl || '',
          },
        },
      ]
    }),
  )
  return withBuiltInFunctions({ ...restored, assets, resources, history }, now)
}

const initialProject = (now: string, options: ProjectCreateOptions & { id?: string } = {}): ProjectState => {
  const openAiFunction = createOpenAILlmFunction(now)
  const geminiFunction = createGeminiLlmFunction(now)
  const openAiImageFunction = createOpenAIImageFunction(now)
  const geminiImageFunction = createGeminiImageFunction(now)
  const requestFunction = createRequestFunction(REQUEST_FUNCTION_ID, 'Request', now)
  const localFunctions = createLocalTransformFunctions(now)
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
      [requestFunction.id]: requestFunction,
      ...Object.fromEntries(localFunctions.map((fn) => [fn.id, fn])),
    },
    runs: {},
    tasks: {},
    history: emptyProjectHistory(),
    templates: {},
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
    request: current.request ? { ...latest.request, ...current.request } : latest.request,
    localTransform: latest.localTransform,
  }
}

const withBuiltInFunctions = (project: ProjectState, now: string): ProjectState => {
  const latestBuiltIns = [
    createOpenAILlmFunction(now),
    createGeminiLlmFunction(now),
    createOpenAIImageFunction(now),
    createGeminiImageFunction(now),
    createRequestFunction(REQUEST_FUNCTION_ID, 'Request', now),
    ...createLocalTransformFunctions(now),
  ]
  const builtIns = Object.fromEntries(
    latestBuiltIns.map((builtInFunction) => [
      builtInFunction.id,
      syncBuiltInFunction(project.functions[builtInFunction.id], builtInFunction),
    ]),
  ) as Record<string, GenerationFunction>

  return {
    ...project,
    history: project.history ?? emptyProjectHistory(),
    templates: project.templates ?? {},
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

const activeTaskStatuses = new Set<ExecutionTask['status']>(['pending', 'queued', 'running', 'fetching_outputs'])

const endpointIsWorkerEligible = (endpoint: ComfyEndpointConfig) => {
  const status = endpoint.health?.status ?? 'unknown'
  return endpoint.enabled && (status === 'unknown' || status === 'online')
}

const endpointSupportsFunction = (endpoint: ComfyEndpointConfig, functionId: string) => {
  const supportedFunctions = endpoint.capabilities?.supportedFunctions
  return supportedFunctions === undefined || supportedFunctions.includes(functionId)
}

const endpointCapabilitySupportedFunctionsPatch = (
  endpoint: ComfyEndpointConfig,
  supportedFunctions: string[],
): Pick<ComfyEndpointConfig, 'capabilities'> => ({
  capabilities: { ...(endpoint.capabilities ?? {}), supportedFunctions },
})

const comfyWorkflowFunctionIds = (functions: Record<string, GenerationFunction>) =>
  Object.values(functions)
    .filter((fn) => fn.workflow.format === 'comfyui_api_json')
    .map((fn) => fn.id)

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

const primitiveAssetIdForResource = (resourceId: string) => `asset_${resourceId}`

const primitiveResourceWithAsset = (
  resourceId: string,
  type: Extract<ResourceType, 'text' | 'number'>,
  name: string,
  value: string | number,
  source: Resource['source'],
  metadata: Resource['metadata'],
): { resource: Resource; asset: AssetRecord; ref: ResourceRef } => {
  const normalizedValue = type === 'number' ? Number(value) : String(value ?? '')
  const safeValue = type === 'number' ? (Number.isFinite(normalizedValue as number) ? (normalizedValue as number) : 0) : String(normalizedValue)
  const assetId = primitiveAssetIdForResource(resourceId)

  return {
    resource: {
      id: resourceId,
      type,
      name,
      value: primitiveResourceValueWithAsset(assetId, type, safeValue),
      source,
      metadata,
    },
    asset: primitiveAssetRecord(assetId, name, type, safeValue, metadata?.createdAt ?? new Date().toISOString()),
    ref: { resourceId, type },
  }
}

const runtimeResourcesForProject = (project: ProjectState): Record<string, Resource> =>
  Object.fromEntries(
    Object.entries(project.resources).map(([resourceId, resource]) => [resourceId, resolveResourceForDisplay(project, resource)]),
  )

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
  value: PrimitiveInputValue | InputResourceRef | undefined,
  resources: Record<string, Resource>,
) => {
  if (isResourceRef(value)) return resources[value.resourceId]?.type === input.type
  if (isPendingResourceRef(value)) return value.type === input.type
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

const pendingOutputKeyFromHandle = (handleId?: string | null) =>
  handleId?.startsWith('pending:') ? handleId.slice('pending:'.length) : undefined

const sourceHandleForResource = (node: CanvasNode, resourceId: string) =>
  node.type === 'result_group' ? `result:${resourceId}` : `resource:${resourceId}`

const nodeResourceRefs = (node: CanvasNode): ResourceRef[] => {
  const directResourceId = canvasNodeResourceId(node)
  if (directResourceId) {
    return [{ resourceId: directResourceId, type: String(node.data.resourceType ?? 'text') as ResourceType }]
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

const pendingOutputRefForNode = (
  node: CanvasNode,
  functions: Record<string, GenerationFunction>,
  handleId?: string | null,
): PendingResourceRef | undefined => {
  if (node.type !== 'result_group') return undefined
  const outputKey = pendingOutputKeyFromHandle(handleId)
  const taskId = typeof node.data.taskId === 'string' ? node.data.taskId : undefined
  const functionId = typeof node.data.functionId === 'string' ? node.data.functionId : undefined
  const functionDef = functionId ? functions[functionId] : undefined
  const output = outputKey ? functionDef?.outputs.find((item) => item.key === outputKey) : undefined
  if (!taskId || !output) return undefined
  return { pendingTaskId: taskId, outputKey: output.key, type: output.type }
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

const canvasNodeEstimatedSize = (node: CanvasNode, functions: Record<string, GenerationFunction>) => {
  const storedSize = nodeStoredSize(node)
  if (storedSize) return storedSize
  if (node.type === 'function') {
    const functionId = typeof node.data.functionId === 'string' ? node.data.functionId : undefined
    return functionNodeEstimatedSize(functionId ? functions[functionId] : undefined)
  }
  if (node.type === 'result_group') return { width: RESULT_NODE_ESTIMATED_WIDTH, height: 180 }
  if (node.type === 'group') return { width: 260, height: 180 }
  return { width: 230, height: 180 }
}

const groupBoundsForNodes = (nodes: CanvasNode[], functions: Record<string, GenerationFunction>) => {
  const padding = 32
  const boxes = nodes.map((node) => {
    const size = canvasNodeEstimatedSize(node, functions)
    return {
      left: node.position.x,
      top: node.position.y,
      right: node.position.x + size.width,
      bottom: node.position.y + size.height,
    }
  })
  const left = Math.min(...boxes.map((box) => box.left)) - padding
  const top = Math.min(...boxes.map((box) => box.top)) - padding
  const right = Math.max(...boxes.map((box) => box.right)) + padding
  const bottom = Math.max(...boxes.map((box) => box.bottom)) + padding
  return {
    position: { x: left, y: top },
    size: { width: Math.max(240, right - left), height: Math.max(160, bottom - top) },
  }
}

const groupChildNodeIds = (node: CanvasNode) =>
  Array.isArray(node.data.childNodeIds)
    ? node.data.childNodeIds.filter((childNodeId): childNodeId is string => typeof childNodeId === 'string')
    : []

const mediaAssetId = (resource: Resource) =>
  assetIdForResource(resource)

const cloneResourceValueAndAssets = (
  resource: Resource,
  assets: Record<string, AssetRecord>,
  nextResourceId: string,
  now: string,
  idFactory: () => string,
) => {
  const value = structuredClone(resource.value)
  const originalAssetId = mediaAssetId(resource)
  const clonedAssets: Record<string, AssetRecord> = {}
  if (originalAssetId && typeof value === 'object' && value !== null && 'assetId' in value) {
    const nextAssetId = isAssetBackedPrimitiveResourceValue(value)
      ? primitiveAssetIdForResource(nextResourceId)
      : idFactory()
    ;(value as { assetId: string }).assetId = nextAssetId
    const sourceAsset = assets[originalAssetId]
    if (sourceAsset) {
      clonedAssets[nextAssetId] = {
        ...structuredClone(sourceAsset),
        id: nextAssetId,
        createdAt: now,
      }
    }
  }
  return { value, assets: clonedAssets }
}

const selectedTemplateNodeIds = (nodes: CanvasNode[], selectedIds: string[]) => {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const ids: string[] = []
  for (const nodeId of uniqueIds(selectedIds)) {
    const node = nodesById.get(nodeId)
    if (!node) continue
    if (node.type === 'group') {
      ids.push(...groupChildNodeIds(node))
    } else {
      ids.push(node.id)
    }
  }
  return uniqueIds(ids).filter((nodeId) => nodesById.has(nodeId))
}

const resourceIdsForNodes = (nodes: CanvasNode[]) =>
  uniqueIds(
    nodes.flatMap((node) => {
      const directResourceId = canvasNodeResourceId(node)
      if (directResourceId) return [directResourceId]
      if (node.type === 'result_group' && Array.isArray(node.data.resources)) {
        return node.data.resources
          .map((resource) =>
            typeof resource === 'object' && resource !== null && 'resourceId' in resource
              ? String((resource as { resourceId: unknown }).resourceId)
              : undefined,
          )
          .filter((resourceId): resourceId is string => Boolean(resourceId))
      }
      return []
    }),
  )

const nextResultNodePosition = (nodes: CanvasNode[], functionNode: CanvasNode, functionDef?: GenerationFunction) => {
  const existingResultNodes = nodes.filter(
    (node) => node.type === 'result_group' && node.data.sourceFunctionNodeId === functionNode.id,
  )
  const functionSize =
    nodeStoredSize(functionNode) ??
    (functionNode.type === 'function'
      ? functionNodeEstimatedSize(functionDef)
      : { width: functionNode.type === 'result_group' ? RESULT_NODE_ESTIMATED_WIDTH : 230, height: 180 })
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

const isResourceRef = (value: PrimitiveInputValue | InputResourceRef | undefined): value is ResourceRef =>
  typeof value === 'object' && value !== null && 'resourceId' in value

const isPendingResourceRef = (value: PrimitiveInputValue | InputResourceRef | undefined): value is PendingResourceRef =>
  typeof value === 'object' &&
  value !== null &&
  'pendingTaskId' in value &&
  typeof (value as { pendingTaskId?: unknown }).pendingTaskId === 'string' &&
  'outputKey' in value &&
  typeof (value as { outputKey?: unknown }).outputKey === 'string'

const inputResourceRefs = (inputValues: RuntimeInputValues): Record<string, InputResourceRef> =>
  Object.fromEntries(
    Object.entries(inputValues).filter((entry): entry is [string, InputResourceRef] =>
      isResourceRef(entry[1]) || isPendingResourceRef(entry[1]),
    ),
  )

const resourceInputRefs = (inputValues: RuntimeInputValues): Record<string, ResourceRef> =>
  Object.fromEntries(
    Object.entries(inputValues).filter((entry): entry is [string, ResourceRef] => isResourceRef(entry[1])),
  )

const pendingInputRefs = (inputValues: RuntimeInputValues): PendingResourceRef[] =>
  Object.values(inputValues).filter((value): value is PendingResourceRef => isPendingResourceRef(value))

const hasPendingInputRefs = (inputValues: RuntimeInputValues) => pendingInputRefs(inputValues).length > 0

const pendingRefKey = (ref: PendingResourceRef) => `${ref.pendingTaskId}:${ref.outputKey}`

const asResolvedInputValues = (inputValues: RuntimeInputValues): ResolvedRuntimeInputValues =>
  inputValues as ResolvedRuntimeInputValues

const resourceInputSnapshot = (
  inputValues: RuntimeInputValues,
  resources: Record<string, Resource>,
): Record<string, Resource> =>
  Object.fromEntries(
    Object.entries(resourceInputRefs(inputValues))
      .map(([key, ref]) => [key, resources[ref.resourceId]])
      .filter((entry): entry is [string, Resource] => Boolean(entry[1])),
  )

const valueForInputSnapshot = (
  resource: Resource | undefined,
  assets: Record<string, AssetRecord>,
  fallback: PrimitiveInputValue,
) => {
  if (!resource) return fallback
  if (isAssetBackedPrimitiveResourceValue(resource.value)) {
    return resolvedPrimitiveResourceValue(resource, assets, fallback)
  }
  return resource.value
}

const executionInputSnapshot = (
  functionDef: GenerationFunction,
  inputValues: RuntimeInputValues,
  resources: Record<string, Resource>,
  assets: Record<string, AssetRecord> = {},
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
            value: valueForInputSnapshot(resource, assets, null),
            resourceId: value.resourceId,
            resourceName: resource?.name,
          },
        ]
      }

      if (isPendingResourceRef(value)) {
        return [
          input.key,
          {
            key: input.key,
            label: input.label,
            type: input.type,
            required: input.required,
            source: 'pending',
            value: null,
            pendingTaskId: value.pendingTaskId,
            outputKey: value.outputKey,
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

const extensionForMimeType = (type: ResourceType, mimeType: string) => {
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (type === 'image') {
    if (normalized === 'image/jpeg') return 'jpg'
    if (normalized === 'image/webp') return 'webp'
    if (normalized === 'image/gif') return 'gif'
    return 'png'
  }
  if (type === 'video') {
    if (normalized === 'video/webm') return 'webm'
    if (normalized === 'video/quicktime') return 'mov'
    return 'mp4'
  }
  if (type === 'audio') {
    if (normalized === 'audio/ogg') return 'ogg'
    if (normalized === 'audio/wav') return 'wav'
    return 'mp3'
  }
  return 'bin'
}

const filenameFromContentDisposition = (header: string | null) => {
  if (!header) return undefined
  const encodedMatch = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1].replace(/^"|"$/g, ''))
    } catch {
      return encodedMatch[1].replace(/^"|"$/g, '')
    }
  }
  const match = /filename="?([^";]+)"?/i.exec(header)
  return match?.[1]?.trim()
}

const filenameFromRequestUrl = (url: string) => {
  try {
    const pathname = new URL(url).pathname
    return pathname.split('/').filter(Boolean).at(-1)
  } catch {
    return url.split(/[/?#]/).filter(Boolean).at(-1)
  }
}

const responseMimeType = (response: Response, outputType: ResourceType, filename: string) => {
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim()
  return contentType || outputMimeType(outputType, filename)
}

const decodeResponseBuffer = (buffer: ArrayBuffer, encoding: string) => {
  try {
    return new TextDecoder((encoding || requestDefaultEncoding).trim() || requestDefaultEncoding).decode(buffer)
  } catch {
    throw new Error(`Unsupported response encoding: ${encoding || requestDefaultEncoding}`)
  }
}

const uploadedImageValue = (result: ComfyUploadImageResult) =>
  result.subfolder ? `${result.subfolder}/${result.name}` : result.name

const resourceFilename = (resource: Resource) => {
  if (isMediaResourceValue(resource.value) && resource.value.filename) {
    return resource.value.filename
  }

  return `${resource.name ?? resource.id}.${resource.type === 'text' || resource.type === 'number' ? 'txt' : 'png'}`
}

const resourceMimeType = (resource: Resource) => {
  if (isMediaResourceValue(resource.value)) {
    return resource.value.mimeType
  }

  if (resource.type === 'text' || resource.type === 'number') return 'text/plain'
  return 'image/png'
}

const resourceUrl = (resource: Resource) => {
  if (isMediaResourceValue(resource.value)) return resource.value.url
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
  if (resource.type === 'text' || resource.type === 'number') {
    const primitiveValue = resolvedPrimitiveResourceValue(resource, project.assets, undefined)
    if (primitiveValue !== undefined) return new Blob([String(primitiveValue)], { type: resourceMimeType(resource) })
  }

  const media = isMediaResourceValue(resource.value) ? resource.value : undefined
  const assetUrl = media?.assetId ? project.assets[media.assetId]?.blobUrl : undefined
  if (assetUrl) {
    try {
      return await fetchUrlBlob(assetUrl)
    } catch {
      // Fall through to the resource URL or ComfyUI provenance when an old browser blob URL is stale.
    }
  }

  const url = resourceUrl(resource)
  if (url) {
    const dataBlob = dataUrlToBlob(url)
    if (dataBlob) return dataBlob
    if (url.startsWith('blob:')) {
      try {
        return await fetchUrlBlob(url)
      } catch {
        // Fall through to ComfyUI metadata if this was a stale object URL.
      }
    }
  }

  const endpoint = comfyEndpointForResource(project, resource)
  if (endpoint) {
    const server = new ComfyServer(endpoint, createComfyClient(endpoint))
    return server.readResourceBlob(resource)
  }

  if (!url) throw new Error(`Resource is missing a URL: ${resource.id}`)
  return fetchUrlBlob(url)
}

const persistedComfyFile = async (
  client: RuntimeComfyClient,
  endpoint: ComfyEndpointConfig,
  file: ComfyFileRef,
  fallbackMimeType: string,
) => {
  const externalUrl = comfyViewUrl(endpoint, file)
  try {
    const blob = client.viewFile ? await client.viewFile(file) : await fetchUrlBlob(externalUrl)
    const mimeType = blob.type || fallbackMimeType
    return {
      url: await blobToDataUrl(blob, mimeType),
      mimeType,
      sizeBytes: blob.size,
    }
  } catch {
    return {
      url: externalUrl,
      mimeType: fallbackMimeType,
      sizeBytes: 0,
    }
  }
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

    const outputResourceNodesForRefs = (
      refs: ResourceRef[],
      resources: Record<string, Resource>,
      resultNodeId: string,
      nodes: CanvasNode[],
    ) => {
      const resultNode = nodes.find((node) => node.id === resultNodeId)
      const existingResourceNodeIds = new Set(
        nodes
          .map(canvasNodeResourceId)
          .filter((resourceId): resourceId is string => Boolean(resourceId)),
      )
      const baseX = resultNode ? resultNode.position.x : 0
      const baseY = resultNode ? resultNode.position.y : 0
      const uniqueRefs = refs.filter((ref, index) => refs.findIndex((item) => item.resourceId === ref.resourceId) === index)

      return uniqueRefs
        .filter((ref) => resources[ref.resourceId] && !existingResourceNodeIds.has(ref.resourceId))
        .map((ref, index): CanvasNode => ({
          id: outputResourceNodeId(resultNodeId, ref.resourceId),
          type: 'resource',
          position: {
            x: baseX + (index % 3) * 260,
            y: baseY + Math.floor(index / 3) * 230,
          },
          data: {
            resourceId: ref.resourceId,
            sourceResultNodeId: resultNodeId,
            sourceFunctionNodeId:
              typeof resultNode?.data.sourceFunctionNodeId === 'string' ? resultNode.data.sourceFunctionNodeId : undefined,
            taskId: typeof resultNode?.data.taskId === 'string' ? resultNode.data.taskId : undefined,
          },
        }))
    }

    const resetResultNodeForRetry = (resultNodeId: string, taskId: string, now: string) => {
      set((current) => {
        const resultNode = current.project.canvas.nodes.find((node) => node.id === resultNodeId && node.type === 'result_group')
        const task = current.project.tasks[taskId]
        if (!resultNode || !task) return current

        const resourceIdsToRemove = resourceIdsForResultNode(resultNode, taskId)
        return {
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: now },
            resources: Object.fromEntries(
              Object.entries(current.project.resources).filter(([resourceId]) => !resourceIdsToRemove.has(resourceId)),
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
              nodes: current.project.canvas.nodes
                .filter(
                  (node) =>
                    node.type !== 'resource' ||
                    typeof node.data.resourceId !== 'string' ||
                    !resourceIdsToRemove.has(node.data.resourceId),
                )
                .map((node) =>
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
      void resolvePendingDependencyTasks()
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
            runtimeResourcesForProject(get().project),
            (resource) => readProjectResourceBlob(get().project, resource, runtime.createComfyClient),
          )
          if (taskWasCanceled(item.taskId)) return
          const compiledWithInputs = injectWorkflowInputs(
            item.functionDef.workflow.rawJson,
            item.functionDef.inputs,
            asResolvedInputValues(preparedInputValues),
            runtimeResourcesForProject(get().project),
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
            const persisted = await persistedComfyFile(client, endpoint, file, outputMimeType(output.type, file.filename))

            newAssets[assetId] = {
              id: assetId,
              name: file.filename,
              mimeType: persisted.mimeType,
              sizeBytes: persisted.sizeBytes,
              blobUrl: persisted.url,
              createdAt: runtime.now(),
            }
            newResources[resourceId] = {
              id: resourceId,
              type: output.type,
              name: file.filename,
              value: {
                assetId,
                url: persisted.url,
                filename: file.filename,
                mimeType: persisted.mimeType,
                sizeBytes: persisted.sizeBytes,
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
            const created = primitiveResourceWithAsset(
              resourceId,
              'text',
              output.key,
              text,
              {
                kind: 'function_output',
                functionNodeId: item.functionNodeId,
                resultGroupNodeId: item.resultNodeId,
                taskId: item.taskId,
                outputKey: output.key,
              },
              {
                workflowFunctionId: item.functionId,
                endpointId: endpoint.id,
                createdAt: runtime.now(),
              },
            )
            newResources[resourceId] = created.resource
            newAssets[created.asset.id] = created.asset
            outputRefs.push({ resourceId, type: 'text' })
          }

          outputRefsByKey[output.key] = outputRefs
          resourceRefs.push(...outputRefs)
        }

        if (taskWasCanceled(item.taskId)) return
        const completedAt = runtime.now()
        const outputResourceNodes = outputResourceNodesForRefs(
          resourceRefs,
          { ...get().project.resources, ...newResources },
          item.resultNodeId,
          get().project.canvas.nodes,
        )
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
              nodes: [
                ...current.project.canvas.nodes.map((node) =>
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
                ...outputResourceNodes,
              ],
            },
          },
        }))
        void resolvePendingDependencyTasks()
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
        void resolvePendingDependencyTasks()
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
          runtimeResourcesForProject(get().project),
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
        const created = primitiveResourceWithAsset(
          resourceId,
          'text',
          `${item.functionDef.name} Run ${item.runIndex}`,
          outputText,
          {
            kind: 'function_output',
            functionNodeId: item.functionNodeId,
            resultGroupNodeId: item.resultNodeId,
            taskId: item.taskId,
            outputKey,
          },
          {
            workflowFunctionId: item.functionId,
            endpointId: 'openai',
            createdAt: completedAt,
          },
        )
        const resource = created.resource

        if (taskWasCanceled(item.taskId)) return
        const resourceRefs: ResourceRef[] = [{ resourceId, type: 'text' }]
        const outputResourceNodes = outputResourceNodesForRefs(
          resourceRefs,
          { ...get().project.resources, [resourceId]: resource },
          item.resultNodeId,
          get().project.canvas.nodes,
        )
        set((current) => ({
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: runtime.now() },
            assets: { ...current.project.assets, [created.asset.id]: created.asset },
            resources: { ...current.project.resources, [resourceId]: resource },
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
              nodes: [
                ...current.project.canvas.nodes.map((node) =>
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
                ...outputResourceNodes,
              ],
            },
          },
        }))
        void resolvePendingDependencyTasks()
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
        void resolvePendingDependencyTasks()
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
          runtimeResourcesForProject(get().project),
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
        const created = primitiveResourceWithAsset(
          resourceId,
          'text',
          `${item.functionDef.name} Run ${item.runIndex}`,
          outputText,
          {
            kind: 'function_output',
            functionNodeId: item.functionNodeId,
            resultGroupNodeId: item.resultNodeId,
            taskId: item.taskId,
            outputKey,
          },
          {
            workflowFunctionId: item.functionId,
            endpointId: 'gemini',
            createdAt: completedAt,
          },
        )
        const resource = created.resource

        if (taskWasCanceled(item.taskId)) return
        const resourceRefs: ResourceRef[] = [{ resourceId, type: 'text' }]
        const outputResourceNodes = outputResourceNodesForRefs(
          resourceRefs,
          { ...get().project.resources, [resourceId]: resource },
          item.resultNodeId,
          get().project.canvas.nodes,
        )
        set((current) => ({
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: runtime.now() },
            assets: { ...current.project.assets, [created.asset.id]: created.asset },
            resources: { ...current.project.resources, [resourceId]: resource },
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
              nodes: [
                ...current.project.canvas.nodes.map((node) =>
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
                ...outputResourceNodes,
              ],
            },
          },
        }))
        void resolvePendingDependencyTasks()
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
        void resolvePendingDependencyTasks()
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
          runtimeResourcesForProject(get().project),
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
        const outputResourceNodes = outputResourceNodesForRefs(
          resourceRefs,
          { ...get().project.resources, ...newResources },
          item.resultNodeId,
          get().project.canvas.nodes,
        )
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
              nodes: [
                ...current.project.canvas.nodes.map((node) =>
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
                ...outputResourceNodes,
              ],
            },
          },
        }))
        void resolvePendingDependencyTasks()
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
        void resolvePendingDependencyTasks()
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
          runtimeResourcesForProject(get().project),
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
        const outputResourceNodes = outputResourceNodesForRefs(
          resourceRefs,
          { ...get().project.resources, ...newResources },
          item.resultNodeId,
          get().project.canvas.nodes,
        )
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
              nodes: [
                ...current.project.canvas.nodes.map((node) =>
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
                ...outputResourceNodes,
              ],
            },
          },
        }))
        void resolvePendingDependencyTasks()
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
        void resolvePendingDependencyTasks()
      }
    }

    const resourceForRequestOutput = (
      output: { key: string; label: string; type: ResourceType },
      value: string | RequestBinaryOutputValue,
      item: QueuedRequestRun,
      now: string,
    ): { resource: Resource; asset?: ProjectState['assets'][string]; ref: ResourceRef } => {
      const resourceId = runtime.idFactory()
      if (output.type === 'number') {
        const numericValue = Number(typeof value === 'string' ? value : value.sizeBytes)
        return primitiveResourceWithAsset(
          resourceId,
          'number',
          output.label,
          Number.isFinite(numericValue) ? numericValue : 0,
          {
            kind: 'function_output',
            functionNodeId: item.functionNodeId,
            resultGroupNodeId: item.resultNodeId,
            taskId: item.taskId,
            outputKey: output.key,
          },
          {
            workflowFunctionId: item.functionId,
            createdAt: now,
          },
        )
      }

      if (output.type === 'image' || output.type === 'video' || output.type === 'audio') {
        const assetId = runtime.idFactory()
        const filename = typeof value === 'string' ? value.split(/[/?#]/).filter(Boolean).at(-1) || output.label : value.filename
        const mimeType = typeof value === 'string' ? outputMimeType(output.type, filename) : value.mimeType
        const url = typeof value === 'string' ? value : value.url
        const sizeBytes = typeof value === 'string' ? 0 : value.sizeBytes
        const asset = {
          id: assetId,
          name: filename,
          mimeType,
          sizeBytes,
          blobUrl: url,
          createdAt: now,
        }
        return {
          asset,
          resource: {
            id: resourceId,
            type: output.type,
            name: filename,
            value: {
              assetId,
              url,
              filename,
              mimeType,
              sizeBytes,
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
              createdAt: now,
            },
          },
          ref: { resourceId, type: output.type },
        }
      }

      return primitiveResourceWithAsset(
        resourceId,
        'text',
        output.label,
        typeof value === 'string' ? value : value.url,
        {
          kind: 'function_output',
          functionNodeId: item.functionNodeId,
          resultGroupNodeId: item.resultNodeId,
          taskId: item.taskId,
          outputKey: output.key,
        },
        {
          workflowFunctionId: item.functionId,
          createdAt: now,
        },
      )
    }

    const resourceForLocalOutput = (
      output: { key: string; label: string; type: ResourceType },
      value: LocalTransformOutputValue,
      item: QueuedLocalRun,
      now: string,
    ): { resource: Resource; asset?: ProjectState['assets'][string]; ref: ResourceRef } => {
      const resourceId = runtime.idFactory()

      if (output.type === 'number') {
        const numericValue = Number(value)
        return primitiveResourceWithAsset(
          resourceId,
          'number',
          output.label,
          Number.isFinite(numericValue) ? numericValue : 0,
          {
            kind: 'function_output',
            functionNodeId: item.sourceNodeId,
            resultGroupNodeId: item.resultNodeId,
            taskId: item.taskId,
            outputKey: output.key,
          },
          {
            workflowFunctionId: item.functionId,
            endpointId: 'local',
            createdAt: now,
          },
        )
      }

      if (output.type === 'image' || output.type === 'video' || output.type === 'audio') {
        if (typeof value !== 'object' || value === null || !('url' in value)) {
          throw new Error(`Local output ${output.key} did not produce a media payload`)
        }
        const assetId = runtime.idFactory()
        const filename = value.filename ?? output.label
        const asset = {
          id: assetId,
          name: filename,
          mimeType: value.mimeType,
          sizeBytes: value.sizeBytes,
          blobUrl: value.url,
          createdAt: now,
        }
        return {
          asset,
          resource: {
            id: resourceId,
            type: output.type,
            name: filename,
            value: mediaValueWithAsset(assetId, value),
            source: {
              kind: 'function_output',
              functionNodeId: item.sourceNodeId,
              resultGroupNodeId: item.resultNodeId,
              taskId: item.taskId,
              outputKey: output.key,
            },
            metadata: {
              workflowFunctionId: item.functionId,
              endpointId: 'local',
              createdAt: now,
            },
          },
          ref: { resourceId, type: output.type },
        }
      }

      return primitiveResourceWithAsset(
        resourceId,
        'text',
        output.label,
        String(value ?? ''),
        {
          kind: 'function_output',
          functionNodeId: item.sourceNodeId,
          resultGroupNodeId: item.resultNodeId,
          taskId: item.taskId,
          outputKey: output.key,
        },
        {
          workflowFunctionId: item.functionId,
          endpointId: 'local',
          createdAt: now,
        },
      )
    }

    const executeLocalQueueItem = async (item: QueuedLocalRun) => {
      const startedAt = runtime.now()
      set((current) => ({
        project: {
          ...current.project,
          tasks: {
            ...current.project.tasks,
            [item.taskId]: {
              ...current.project.tasks[item.taskId]!,
              status: 'running',
              endpointId: 'local',
              startedAt,
              updatedAt: startedAt,
            },
          },
          canvas: {
            ...current.project.canvas,
            nodes: current.project.canvas.nodes.map((node) =>
              node.id === item.resultNodeId
                ? { ...node, data: { ...node.data, endpointId: 'local', status: 'running', startedAt } }
                : node,
            ),
          },
        },
      }))

      try {
        const outputs = await executeLocalTransformFunction(
          item.functionDef,
          item.inputValues,
          runtimeResourcesForProject(get().project),
          (resource) => readProjectResourceBlob(get().project, resource, runtime.createComfyClient),
        )
        const outputRefsByKey: Record<string, ResourceRef[]> = {}
        const resourceRefs: ResourceRef[] = []
        const newResources: Record<string, Resource> = {}
        const newAssets: ProjectState['assets'] = {}
        const completedAt = runtime.now()

        for (const outputItem of outputs) {
          const refs: ResourceRef[] = []
          for (const value of outputItem.values) {
            const created = resourceForLocalOutput(outputItem, value, item, completedAt)
            newResources[created.resource.id] = created.resource
            if (created.asset) newAssets[created.asset.id] = created.asset
            refs.push(created.ref)
            resourceRefs.push(created.ref)
          }
          outputRefsByKey[outputItem.key] = refs
        }

        const outputResourceNodes = outputResourceNodesForRefs(
          resourceRefs,
          { ...get().project.resources, ...newResources },
          item.resultNodeId,
          get().project.canvas.nodes,
        )
        set((current) => ({
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: completedAt },
            resources: { ...current.project.resources, ...newResources },
            assets: { ...current.project.assets, ...newAssets },
            tasks: {
              ...current.project.tasks,
              [item.taskId]: {
                ...current.project.tasks[item.taskId]!,
                status: 'succeeded',
                outputRefs: outputRefsByKey,
                updatedAt: completedAt,
                completedAt,
              },
            },
            canvas: {
              ...current.project.canvas,
              nodes: [
                ...current.project.canvas.nodes.map((node) =>
                  node.id === item.resultNodeId
                    ? { ...node, data: { ...node.data, resources: resourceRefs, status: 'succeeded', completedAt } }
                    : node,
                ),
                ...outputResourceNodes,
              ],
            },
          },
        }))
        void resolvePendingDependencyTasks()
      } catch (err) {
        const failedAt = runtime.now()
        const errorMessage = err instanceof Error ? err.message : 'Local transform execution failed'
        const taskError = { code: 'local_transform_failed', message: errorMessage, raw: err }
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
                        error: { code: taskError.code, message: errorMessage },
                        completedAt: failedAt,
                      },
                    }
                  : node,
              ),
            },
          },
        }))
        void resolvePendingDependencyTasks()
      }
    }

    const executeRequestQueueItem = async (item: QueuedRequestRun) => {
      const startedAt = runtime.now()
      set((current) => ({
        project: {
          ...current.project,
          tasks: {
            ...current.project.tasks,
            [item.taskId]: {
              ...current.project.tasks[item.taskId]!,
              status: 'running',
              endpointId: 'request',
              startedAt,
              updatedAt: startedAt,
            },
          },
          canvas: {
            ...current.project.canvas,
            nodes: current.project.canvas.nodes.map((node) =>
              node.id === item.resultNodeId
                ? { ...node, data: { ...node.data, endpointId: 'request', status: 'running', startedAt } }
                : node,
            ),
          },
        },
      }))

      try {
        const request = compileRequestFunctionRequest(item.functionDef, item.inputValues, runtimeResourcesForProject(get().project))
        set((current) => ({
          project: {
            ...current.project,
            tasks: {
              ...current.project.tasks,
              [item.taskId]: {
                ...current.project.tasks[item.taskId]!,
                requestSnapshot: request,
                updatedAt: runtime.now(),
              },
            },
          },
        }))

        const response = await fetch(request.url, request.init)
        const responseBuffer = await response.arrayBuffer()
        const errorText = response.ok ? '' : decodeResponseBuffer(responseBuffer, request.responseEncoding)
        if (!response.ok) throw new Error(`Request failed: ${response.status} ${errorText}`)
        let responseText = ''
        let responseBinary: RequestBinaryOutputValue | undefined
        if (request.responseParse === 'binary') {
          const firstBinaryOutput = item.functionDef.outputs.find(
            (output) => output.type === 'image' || output.type === 'video' || output.type === 'audio',
          )
          const outputType = firstBinaryOutput?.type ?? 'image'
          const fallbackMimeType = outputMimeType(outputType, '')
          const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || fallbackMimeType
          const filename =
            filenameFromContentDisposition(response.headers.get('content-disposition')) ||
            filenameFromRequestUrl(request.url) ||
            `${firstBinaryOutput?.label ?? 'response'}.${extensionForMimeType(outputType, mimeType)}`
          const blob = new Blob([responseBuffer], { type: mimeType })
          responseBinary = {
            url: await blobToDataUrl(blob, mimeType),
            filename,
            mimeType: responseMimeType(response, outputType, filename),
            sizeBytes: responseBuffer.byteLength,
          }
        } else {
          responseText = decodeResponseBuffer(responseBuffer, request.responseEncoding)
        }
        const responseJson = request.responseParse === 'json' ? JSON.parse(responseText || 'null') : undefined
        const outputs = extractRequestFunctionOutputs(responseText, responseJson, item.functionDef.outputs, responseBinary)
        const outputRefsByKey: Record<string, ResourceRef[]> = {}
        const resourceRefs: ResourceRef[] = []
        const newResources: Record<string, Resource> = {}
        const newAssets: ProjectState['assets'] = {}
        const completedAt = runtime.now()

        for (const output of outputs) {
          const refs: ResourceRef[] = []
          for (const value of output.values) {
            const created = resourceForRequestOutput(output, value, item, completedAt)
            newResources[created.resource.id] = created.resource
            if (created.asset) newAssets[created.asset.id] = created.asset
            refs.push(created.ref)
            resourceRefs.push(created.ref)
          }
          outputRefsByKey[output.key] = refs
        }

        const outputResourceNodes = outputResourceNodesForRefs(
          resourceRefs,
          { ...get().project.resources, ...newResources },
          item.resultNodeId,
          get().project.canvas.nodes,
        )
        set((current) => ({
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: completedAt },
            resources: { ...current.project.resources, ...newResources },
            assets: { ...current.project.assets, ...newAssets },
            tasks: {
              ...current.project.tasks,
              [item.taskId]: {
                ...current.project.tasks[item.taskId]!,
                status: 'succeeded',
                outputRefs: outputRefsByKey,
                updatedAt: completedAt,
                completedAt,
              },
            },
            canvas: {
              ...current.project.canvas,
              nodes: [
                ...current.project.canvas.nodes.map((node) =>
                  node.id === item.resultNodeId
                    ? { ...node, data: { ...node.data, resources: resourceRefs, status: 'succeeded', completedAt } }
                    : node,
                ),
                ...outputResourceNodes,
              ],
            },
          },
        }))
        void resolvePendingDependencyTasks()
      } catch (err) {
        const failedAt = runtime.now()
        const errorMessage = err instanceof Error ? err.message : 'Request execution failed'
        const taskError = { code: 'request_execution_failed', message: errorMessage, raw: err }
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
                        error: { code: taskError.code, message: errorMessage },
                        completedAt: failedAt,
                      },
                    }
                  : node,
              ),
            },
          },
        }))
        void resolvePendingDependencyTasks()
      }
    }

    const taskResultNode = (project: ProjectState, taskId: string) =>
      project.canvas.nodes.find((node) => node.type === 'result_group' && node.data.taskId === taskId)

    const resolveTaskInputDependencies = (task: ExecutionTask, project: ProjectState) =>
      resolveExecutionTaskDependencies(task, project.tasks)

    const markPendingTaskReady = (
      task: ExecutionTask,
      resultNodeId: string,
      functionDef: GenerationFunction,
      inputValues: ResolvedRuntimeInputValues,
      resolvedRefsByPendingKey: Map<string, ResourceRef>,
    ) => {
      const now = runtime.now()
      set((current) => {
        const taskIdByResultNodeId = new Map<string, string>()
        for (const node of current.project.canvas.nodes) {
          if (node.type === 'result_group' && typeof node.data.taskId === 'string') {
            taskIdByResultNodeId.set(node.id, node.data.taskId)
          }
        }

        return {
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: now },
            tasks: {
              ...current.project.tasks,
              [task.id]: {
                ...task,
                status: 'queued',
                inputRefs: inputResourceRefs(inputValues),
                inputSnapshot: resourceInputSnapshot(inputValues, current.project.resources),
                inputValuesSnapshot: executionInputSnapshot(functionDef, inputValues, current.project.resources, current.project.assets),
                updatedAt: now,
              },
            },
            canvas: {
              ...current.project.canvas,
              nodes: current.project.canvas.nodes.map((node) => {
                if (node.id === resultNodeId) {
                  return {
                    ...node,
                    data: {
                      ...node.data,
                      status: 'queued',
                      error: undefined,
                    },
                  }
                }

                if (node.id !== task.functionNodeId || node.type !== 'function') return node
                const nodeInputValues = { ...((node.data.inputValues ?? {}) as RuntimeInputValues) }
                let changed = false
                for (const [key, value] of Object.entries(nodeInputValues)) {
                  if (!isPendingResourceRef(value)) continue
                  const resolvedRef = resolvedRefsByPendingKey.get(pendingRefKey(value))
                  if (!resolvedRef) continue
                  nodeInputValues[key] = resolvedRef
                  changed = true
                }
                return changed ? { ...node, data: { ...node.data, inputValues: nodeInputValues } } : node
              }),
              edges: current.project.canvas.edges.map((edge) => {
                const dependencyTaskId = taskIdByResultNodeId.get(edge.source.nodeId)
                const outputKey = edge.source.outputKey ?? pendingOutputKeyFromHandle(edge.source.handleId)
                if (!dependencyTaskId || !outputKey) return edge
                const resolvedRef = resolvedRefsByPendingKey.get(`${dependencyTaskId}:${outputKey}`)
                if (!resolvedRef) return edge
                return {
                  ...edge,
                  source: {
                    ...edge.source,
                    handleId: sourceHandleForResource(
                      current.project.canvas.nodes.find((node) => node.id === edge.source.nodeId) ?? {
                        id: edge.source.nodeId,
                        type: 'result_group',
                        position: { x: 0, y: 0 },
                        data: {},
                      },
                      resolvedRef.resourceId,
                    ),
                    resourceId: resolvedRef.resourceId,
                    outputKey,
                  },
                }
              }),
            },
          },
        }
      })
    }

    const resolveReadyPendingInputBindings = () => {
      const now = runtime.now()
      let didResolve = false
      set((current) => {
        const taskIdByResultNodeId = new Map<string, string>()
        for (const node of current.project.canvas.nodes) {
          if (node.type === 'result_group' && typeof node.data.taskId === 'string') {
            taskIdByResultNodeId.set(node.id, node.data.taskId)
          }
        }

        const resolvedRefsByPendingKey = new Map<string, ResourceRef>()
        const nodes = current.project.canvas.nodes.map((node) => {
          if (node.type !== 'function') return node

          const inputValues = { ...((node.data.inputValues ?? {}) as RuntimeInputValues) }
          let changed = false
          for (const [inputKey, value] of Object.entries(inputValues)) {
            if (!isPendingResourceRef(value)) continue
            const dependencyTask = current.project.tasks[value.pendingTaskId]
            if (dependencyTask?.status !== 'succeeded') continue
            const outputRefs = dependencyTask.outputRefs[value.outputKey] ?? []
            const resolvedRef = outputRefs.find((ref) => ref.type === value.type) ?? outputRefs[0]
            if (!resolvedRef) continue
            inputValues[inputKey] = resolvedRef
            resolvedRefsByPendingKey.set(pendingRefKey(value), resolvedRef)
            changed = true
            didResolve = true
          }

          return changed ? { ...node, data: { ...node.data, inputValues } } : node
        })

        if (!didResolve) return current

        return {
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: now },
            canvas: {
              ...current.project.canvas,
              nodes,
              edges: current.project.canvas.edges.map((edge) => {
                const dependencyTaskId = taskIdByResultNodeId.get(edge.source.nodeId)
                const outputKey = edge.source.outputKey ?? pendingOutputKeyFromHandle(edge.source.handleId)
                if (!dependencyTaskId || !outputKey) return edge
                const resolvedRef = resolvedRefsByPendingKey.get(`${dependencyTaskId}:${outputKey}`)
                if (!resolvedRef) return edge
                const sourceNode = current.project.canvas.nodes.find((node) => node.id === edge.source.nodeId)
                return {
                  ...edge,
                  source: {
                    ...edge.source,
                    handleId: sourceNode ? sourceHandleForResource(sourceNode, resolvedRef.resourceId) : edge.source.handleId,
                    resourceId: resolvedRef.resourceId,
                    outputKey,
                  },
                }
              }),
            },
          },
        }
      })
      return didResolve
    }

    const executeResolvedTask = async (
      task: ExecutionTask,
      resultNodeId: string,
      functionDef: GenerationFunction,
      inputValues: ResolvedRuntimeInputValues,
    ) => {
      if (isOpenAILlmFunction(functionDef)) {
        const functionNode = get().project.canvas.nodes.find((node) => node.id === task.functionNodeId && node.type === 'function')
        const nodeConfig = functionNode?.data.openaiConfig as Partial<OpenAILlmConfig> | undefined
        await executeOpenAiQueueItem({
          taskId: task.id,
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
          taskId: task.id,
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
          taskId: task.id,
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
          taskId: task.id,
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

      if (isRequestFunction(functionDef)) {
        await executeRequestQueueItem({
          taskId: task.id,
          resultNodeId,
          functionNodeId: task.functionNodeId,
          functionId: task.functionId,
          functionDef,
          inputValues,
          runIndex: task.runIndex,
          runTotal: task.runTotal,
        })
        return
      }

      if (isLocalTransformFunction(functionDef)) {
        await executeLocalQueueItem({
          taskId: task.id,
          resultNodeId,
          sourceNodeId: task.functionNodeId,
          functionId: task.functionId,
          functionDef,
          inputValues,
          runIndex: task.runIndex,
          runTotal: task.runTotal,
        })
        return
      }

      const workerEndpoints = get().project.comfy.endpoints.filter(
        (endpoint) => endpointIsWorkerEligible(endpoint) && endpointSupportsFunction(endpoint, task.functionId),
      )
      if (workerEndpoints.length === 0) {
        failResultRunInPlace(resultNodeId, task.id, 'endpoint_unavailable', 'No eligible ComfyUI endpoint')
        return
      }

      let resolveCompletion: () => void = () => undefined
      const completion = new Promise<void>((resolve) => {
        resolveCompletion = resolve
      })
      comfyQueue.push({
        taskId: task.id,
        resultNodeId,
        functionNodeId: task.functionNodeId,
        functionId: task.functionId,
        functionDef,
        inputValues,
        seedPatchLog: structuredClone(task.seedPatchLog),
        runIndex: task.runIndex,
        runTotal: task.runTotal,
        createdAt: task.createdAt,
        completion,
        resolveCompletion,
      })
      ensureComfyWorkers()
      await completion
    }

    let resolvingPendingDependencies = false
    const resolvePendingDependencyTasks = async () => {
      if (resolvingPendingDependencies) return
      resolvingPendingDependencies = true
      try {
        while (true) {
          const resolvedBindings = resolveReadyPendingInputBindings()
          const pendingTasks = Object.values(get().project.tasks).filter((task) => task.status === 'pending')
          if (pendingTasks.length === 0) {
            if (resolvedBindings) continue
            return
          }

          let progressed = resolvedBindings
          for (const pendingTask of pendingTasks) {
            const project = get().project
            const resultNode = taskResultNode(project, pendingTask.id)
            const functionDef = project.functions[pendingTask.functionId]
            if (!resultNode) continue
            if (!functionDef) {
              failResultRunInPlace(resultNode.id, pendingTask.id, 'function_missing', 'Function definition is missing')
              progressed = true
              break
            }

            const resolution = resolveTaskInputDependencies(pendingTask, project)
            if (resolution.status === 'waiting') continue
            if (resolution.status === 'failed') {
              failResultRunInPlace(resultNode.id, pendingTask.id, resolution.code, resolution.message, resolution.raw)
              progressed = true
              break
            }

            markPendingTaskReady(
              pendingTask,
              resultNode.id,
              functionDef,
              resolution.inputValues,
              resolution.resolvedRefsByPendingKey,
            )
            await executeResolvedTask(pendingTask, resultNode.id, functionDef, resolution.inputValues)
            progressed = true
            break
          }

          if (!progressed) return
        }
      } finally {
        resolvingPendingDependencies = false
      }
    }

    const runLocalFunctionNode = async (nodeId: string, requestedRunCount?: number) => {
      const state = get()
      const node = state.project.canvas.nodes.find((item) => item.id === nodeId && item.type === 'function')
      if (!node) return
      const functionId = String(node.data.functionId ?? '')
      const functionDef = state.project.functions[functionId]
      if (!functionDef || !isLocalTransformFunction(functionDef)) return

      const runCount = normalizedRunCount(
        requestedRunCount ?? Number((node.data.runtime as { runCount?: number } | undefined)?.runCount ?? 1),
      )
      const now = runtime.now()
      const inputValues = (node.data.inputValues ?? {}) as RuntimeInputValues
      if (validateRequiredInputs(nodeId, functionDef, inputValues, state.project.resources).length > 0) return
      const hasPendingDependencies = hasPendingInputRefs(inputValues)

      const queuedNodes: CanvasNode[] = []
      const queuedTasks: Record<string, ExecutionTask> = {}
      const queuedRuns: QueuedLocalRun[] = []
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
          status: hasPendingDependencies ? 'pending' : 'queued',
          inputRefs: inputResourceRefs(inputValues),
          inputSnapshot: resourceInputSnapshot(inputValues, state.project.resources),
          inputValuesSnapshot: executionInputSnapshot(functionDef, inputValues, state.project.resources, state.project.assets),
          paramsSnapshot: {
            runCount,
            mode: 'local_transform',
            kind: functionDef.localTransform?.kind,
          },
          workflowTemplateSnapshot: {},
          compiledWorkflowSnapshot: {},
          requestSnapshot: { mode: 'local_transform', kind: functionDef.localTransform?.kind, inputValues },
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
            endpointId: 'local',
            resources: [],
            status: hasPendingDependencies ? 'pending' : 'queued',
            seedPatchLog: [],
            createdAt: now,
          },
        }

        queuedTasks[taskId] = task
        queuedNodes.push(resultNode)
        if (!hasPendingDependencies) {
          queuedRuns.push({
            taskId,
            resultNodeId,
            sourceNodeId: nodeId,
            functionId,
            functionDef,
            inputValues: asResolvedInputValues(inputValues),
            runIndex,
            runTotal: runRange.total,
          })
        }
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

      if (hasPendingDependencies) {
        void resolvePendingDependencyTasks()
        return
      }

      await Promise.all(queuedRuns.map((item) => executeLocalQueueItem(item)))
    }

    const runRequestFunctionNode = async (nodeId: string, requestedRunCount?: number) => {
      const state = get()
      const node = state.project.canvas.nodes.find((item) => item.id === nodeId && item.type === 'function')
      if (!node) return
      const functionId = String(node.data.functionId ?? '')
      const functionDef = state.project.functions[functionId]
      if (!functionDef || !isRequestFunction(functionDef)) return
      const requestConfig = mergedRequestConfig(
        functionDef.request,
        node.data.requestConfig as Partial<RequestFunctionConfig> | undefined,
      )
      const requestOutputs = Array.isArray(node.data.requestOutputs)
        ? (node.data.requestOutputs as FunctionOutputDef[])
        : undefined
      const runtimeFunctionDef: GenerationFunction = {
        ...functionDef,
        request: requestConfig,
        outputs: normalizeRequestOutputsForParse(
          requestOutputs?.length ? requestOutputs : functionDef.outputs,
          requestConfig.responseParse,
        ),
      }

      const runCount = normalizedRunCount(
        requestedRunCount ?? Number((node.data.runtime as { runCount?: number } | undefined)?.runCount ?? 1),
      )
      const now = runtime.now()
      const inputValues = (node.data.inputValues ?? {}) as RuntimeInputValues
      if (validateRequiredInputs(nodeId, runtimeFunctionDef, inputValues, state.project.resources).length > 0) return
      const hasPendingDependencies = hasPendingInputRefs(inputValues)
      const queuedNodes: CanvasNode[] = []
      const queuedTasks: Record<string, ExecutionTask> = {}
      const queuedRuns: QueuedRequestRun[] = []
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
          status: hasPendingDependencies ? 'pending' : 'queued',
          inputRefs: inputResourceRefs(inputValues),
          inputSnapshot: resourceInputSnapshot(inputValues, state.project.resources),
          inputValuesSnapshot: executionInputSnapshot(runtimeFunctionDef, inputValues, state.project.resources, state.project.assets),
          paramsSnapshot: {
            runCount,
            mode: 'http_request',
            method: runtimeFunctionDef.request?.method,
            responseParse: runtimeFunctionDef.request?.responseParse,
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
          position: nextResultNodePosition([...state.project.canvas.nodes, ...queuedNodes], node, runtimeFunctionDef),
          data: {
            sourceFunctionNodeId: nodeId,
            functionId,
            taskId,
            runIndex,
            runTotal: runRange.total,
            title: `Run ${runIndex}`,
            endpointId: 'request',
            resources: [],
            status: hasPendingDependencies ? 'pending' : 'queued',
            seedPatchLog: [],
            createdAt: now,
          },
        }

        queuedTasks[taskId] = task
        queuedNodes.push(resultNode)
        if (!hasPendingDependencies) {
          queuedRuns.push({
            taskId,
            resultNodeId,
            functionNodeId: nodeId,
            functionId,
            functionDef: runtimeFunctionDef,
            inputValues: asResolvedInputValues(inputValues),
            runIndex,
            runTotal: runRange.total,
          })
        }
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

      if (hasPendingDependencies) {
        void resolvePendingDependencyTasks()
        return
      }

      await Promise.all(queuedRuns.map((item) => executeRequestQueueItem(item)))
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
      const hasPendingDependencies = hasPendingInputRefs(inputValues)
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
          status: hasPendingDependencies ? 'pending' : 'queued',
          inputRefs: inputResourceRefs(inputValues),
          inputSnapshot: resourceInputSnapshot(inputValues, state.project.resources),
          inputValuesSnapshot: executionInputSnapshot(functionDef, inputValues, state.project.resources, state.project.assets),
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
            status: hasPendingDependencies ? 'pending' : 'queued',
            seedPatchLog: [],
            createdAt: now,
          },
        }

        queuedTasks[taskId] = task
        queuedNodes.push(resultNode)
        if (!hasPendingDependencies) {
          queuedRuns.push({
            taskId,
            resultNodeId,
            functionNodeId: nodeId,
            functionId,
            functionDef,
            inputValues: asResolvedInputValues(inputValues),
            config,
            runIndex,
            runTotal: runRange.total,
          })
        }
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

      if (hasPendingDependencies) {
        void resolvePendingDependencyTasks()
        return
      }

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
      const hasPendingDependencies = hasPendingInputRefs(inputValues)
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
          status: hasPendingDependencies ? 'pending' : 'queued',
          inputRefs: inputResourceRefs(inputValues),
          inputSnapshot: resourceInputSnapshot(inputValues, state.project.resources),
          inputValuesSnapshot: executionInputSnapshot(functionDef, inputValues, state.project.resources, state.project.assets),
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
            status: hasPendingDependencies ? 'pending' : 'queued',
            seedPatchLog: [],
            createdAt: now,
          },
        }

        queuedTasks[taskId] = task
        queuedNodes.push(resultNode)
        if (!hasPendingDependencies) {
          queuedRuns.push({
            taskId,
            resultNodeId,
            functionNodeId: nodeId,
            functionId,
            functionDef,
            inputValues: asResolvedInputValues(inputValues),
            config,
            runIndex,
            runTotal: runRange.total,
          })
        }
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

      if (hasPendingDependencies) {
        void resolvePendingDependencyTasks()
        return
      }

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
      const hasPendingDependencies = hasPendingInputRefs(inputValues)
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
          status: hasPendingDependencies ? 'pending' : 'queued',
          inputRefs: inputResourceRefs(inputValues),
          inputSnapshot: resourceInputSnapshot(inputValues, state.project.resources),
          inputValuesSnapshot: executionInputSnapshot(functionDef, inputValues, state.project.resources, state.project.assets),
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
            status: hasPendingDependencies ? 'pending' : 'queued',
            seedPatchLog: [],
            createdAt: now,
          },
        }

        queuedTasks[taskId] = task
        queuedNodes.push(resultNode)
        if (!hasPendingDependencies) {
          queuedRuns.push({
            taskId,
            resultNodeId,
            functionNodeId: nodeId,
            functionId,
            functionDef,
            inputValues: asResolvedInputValues(inputValues),
            config,
            runIndex,
            runTotal: runRange.total,
          })
        }
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

      if (hasPendingDependencies) {
        void resolvePendingDependencyTasks()
        return
      }

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
      const hasPendingDependencies = hasPendingInputRefs(inputValues)
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
          status: hasPendingDependencies ? 'pending' : 'queued',
          inputRefs: inputResourceRefs(inputValues),
          inputSnapshot: resourceInputSnapshot(inputValues, state.project.resources),
          inputValuesSnapshot: executionInputSnapshot(functionDef, inputValues, state.project.resources, state.project.assets),
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
            status: hasPendingDependencies ? 'pending' : 'queued',
            seedPatchLog: [],
            createdAt: now,
          },
        }

        queuedTasks[taskId] = task
        queuedNodes.push(resultNode)
        if (!hasPendingDependencies) {
          queuedRuns.push({
            taskId,
            resultNodeId,
            functionNodeId: nodeId,
            functionId,
            functionDef,
            inputValues: asResolvedInputValues(inputValues),
            config,
            runIndex,
            runTotal: runRange.total,
          })
        }
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

      if (hasPendingDependencies) {
        void resolvePendingDependencyTasks()
        return
      }

      await Promise.all(queuedRuns.map((item) => executeGeminiImageQueueItem(item)))
    }

    const ensureComfyWorkers = () => {
      const endpoints = get().project.comfy.endpoints.filter(endpointIsWorkerEligible)
      for (let index = comfyQueue.length - 1; index >= 0; index -= 1) {
        const queuedRun = comfyQueue[index]!
        if (endpoints.some((endpoint) => endpointSupportsFunction(endpoint, queuedRun.functionId))) continue
        comfyQueue.splice(index, 1)
        failResultRunInPlace(queuedRun.resultNodeId, queuedRun.taskId, 'endpoint_unavailable', 'No eligible ComfyUI endpoint')
        queuedRun.resolveCompletion()
      }

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

    const deleteNodesFromState = (state: ProjectStoreState, nodeIds: string[], now: string) => {
      const requestedNodeIds = new Set(nodeIds.filter(Boolean))
      if (requestedNodeIds.size === 0) return state

      const targetNodes = state.project.canvas.nodes.filter((node) => requestedNodeIds.has(node.id))
      if (targetNodes.length === 0) return state

      const nodeIdsToDelete = new Set<string>(targetNodes.map((node) => node.id))
      for (const targetNode of targetNodes) {
        if (targetNode.type === 'group') {
          for (const childNodeId of groupChildNodeIds(targetNode)) nodeIdsToDelete.add(childNodeId)
        }
        if (targetNode.type === 'function') {
          for (const node of state.project.canvas.nodes) {
            if (node.type === 'result_group' && node.data.sourceFunctionNodeId === targetNode.id) {
              nodeIdsToDelete.add(node.id)
            }
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
            if (isPendingResourceRef(value) && taskIdsToDelete.has(value.pendingTaskId)) delete inputValues[key]
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
        undoStack: [],
        project: projectWithRecordedHistory(state.project, {
          ...ensureProjectHistory(state.project),
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
        }, now, {
          label: targetNodes.length > 1 ? 'Delete nodes' : 'Delete node',
          transactionType: 'canvas',
          nodeIds: [...nodeIdsToDelete],
          assetIds: [...resourceIdsToDelete],
          preview: {
            title: targetNodes.length > 1 ? 'Delete nodes' : 'Delete node',
            subtitle: `${nodeIdsToDelete.size} nodes`,
            nodeIds: [...nodeIdsToDelete],
            assetIds: [...resourceIdsToDelete],
          },
        }),
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
      const assetId = primitiveAssetIdForResource(resourceId)
      const nodeId = `node_${resourceId}`
      const now = runtime.now()
      const resource: Resource = {
        id: resourceId,
        type: 'text',
        name,
        value: primitiveResourceValueWithAsset(assetId, 'text', value),
        source: { kind: 'manual_input' },
        metadata: { createdAt: now },
      }
      const node: CanvasNode = {
        id: nodeId,
        type: 'resource',
        position,
        data: { resourceId, resourceType: 'text' },
      }

      set((state) => {
        const nextProject = {
          ...ensureProjectHistory(state.project),
          project: { ...state.project.project, updatedAt: now },
          assets: {
            ...state.project.assets,
            [assetId]: primitiveAssetRecord(assetId, name, 'text', value, now),
          },
          resources: { ...state.project.resources, [resourceId]: resource },
          canvas: { ...state.project.canvas, nodes: [...state.project.canvas.nodes, node] },
        }
        return {
          project: projectWithRecordedHistory(state.project, nextProject, now, {
            label: 'Create text asset',
            transactionType: 'asset',
            nodeIds: [nodeId],
            assetIds: [resourceId],
            preview: {
              title: 'Create text asset',
              subtitle: name,
              nodeIds: [nodeId],
              assetIds: [resourceId],
            },
          }),
        }
      })
      return nodeId
    },

    addEmptyResourceAtPosition: (type, position, initialValue) => {
      if (type === 'text') {
        return get().addTextResourceAtPosition('Prompt', typeof initialValue === 'string' ? initialValue : '', position)
      }

      if (type === 'number') {
        const numericValue = Number(initialValue)
        const resourceId = runtime.idFactory()
        const assetId = primitiveAssetIdForResource(resourceId)
        const nodeId = `node_${resourceId}`
        const now = runtime.now()
        const value = Number.isFinite(numericValue) ? numericValue : 0
        const resource: Resource = {
          id: resourceId,
          type,
          name: resourceNameForType(type),
          value: primitiveResourceValueWithAsset(assetId, 'number', value),
          source: { kind: 'manual_input' },
          metadata: { createdAt: now },
        }
        const node: CanvasNode = {
          id: nodeId,
          type: 'resource',
          position,
          data: { resourceId, resourceType: type },
        }

        set((state) => {
          const nextProject = {
            ...ensureProjectHistory(state.project),
            project: { ...state.project.project, updatedAt: now },
            assets: {
              ...state.project.assets,
              [assetId]: primitiveAssetRecord(assetId, resource.name ?? resourceNameForType(type), 'number', value, now),
            },
            resources: { ...state.project.resources, [resourceId]: resource },
            canvas: { ...state.project.canvas, nodes: [...state.project.canvas.nodes, node] },
          }
          return {
            project: projectWithRecordedHistory(state.project, nextProject, now, {
              label: 'Create number asset',
              transactionType: 'asset',
              nodeIds: [nodeId],
              assetIds: [resourceId],
              preview: {
                title: 'Create number asset',
                subtitle: resource.name,
                nodeIds: [nodeId],
                assetIds: [resourceId],
              },
            }),
          }
        })
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

      set((state) => {
        const nextProject = {
          ...ensureProjectHistory(state.project),
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
        }
        return {
          ...selectedState([nodeId]),
          project: projectWithRecordedHistory(state.project, nextProject, now, {
            label: `Create ${type} asset`,
            transactionType: 'asset',
            nodeIds: [nodeId],
            assetIds: [resourceId],
            preview: {
              title: `Create ${type} asset`,
              subtitle: name,
              nodeIds: [nodeId],
              assetIds: [resourceId],
            },
          }),
        }
      })
      return nodeId
    },

    addAssetResourcesAtPositions: (items) => {
      if (items.length === 0) return []
      const now = runtime.now()
      const nodes: CanvasNode[] = []
      const resources: Record<string, Resource> = {}
      const assets: Record<string, AssetRecord> = {}

      for (const item of items) {
        const resourceId = runtime.idFactory()
        const nodeId = `node_${resourceId}`
        const resourceBase = {
          id: resourceId,
          type: item.type,
          name: item.name,
          source: { kind: 'manual_input' as const },
          metadata: { createdAt: now },
        }

        if (item.type === 'text') {
          const assetId = primitiveAssetIdForResource(resourceId)
          resources[resourceId] = {
            ...resourceBase,
            type: 'text',
            value: primitiveResourceValueWithAsset(assetId, 'text', item.value),
          }
          assets[assetId] = primitiveAssetRecord(assetId, item.name, 'text', item.value, now)
        } else if (item.type === 'number') {
          const assetId = primitiveAssetIdForResource(resourceId)
          resources[resourceId] = {
            ...resourceBase,
            type: 'number',
            value: primitiveResourceValueWithAsset(assetId, 'number', item.value),
          }
          assets[assetId] = primitiveAssetRecord(assetId, item.name, 'number', item.value, now)
        } else {
          const assetId = runtime.idFactory()
          resources[resourceId] = {
            ...resourceBase,
            type: item.type,
            value: mediaValueWithAsset(assetId, item.media),
          }
          assets[assetId] = {
            id: assetId,
            name: item.media.filename ?? item.name,
            mimeType: item.media.mimeType,
            sizeBytes: item.media.sizeBytes,
            blobUrl: item.media.url,
            createdAt: now,
          }
        }

        nodes.push({
          id: nodeId,
          type: 'resource',
          position: item.position,
          data: { resourceId, resourceType: item.type },
        })
      }

      const nodeIds = nodes.map((node) => node.id)
      const resourceIds = Object.keys(resources)
      set((state) => {
        const nextProject = {
          ...ensureProjectHistory(state.project),
          project: { ...state.project.project, updatedAt: now },
          assets: { ...state.project.assets, ...assets },
          resources: { ...state.project.resources, ...resources },
          canvas: { ...state.project.canvas, nodes: [...state.project.canvas.nodes, ...nodes] },
        }
        return {
          ...selectedState(nodeIds),
          project: projectWithRecordedHistory(state.project, nextProject, now, {
            label: items.length > 1 ? 'Create assets' : `Create ${items[0]?.type ?? 'asset'} asset`,
            transactionType: 'asset',
            nodeIds,
            assetIds: resourceIds,
            preview: {
              title: items.length > 1 ? 'Create assets' : `Create ${items[0]?.type ?? 'asset'} asset`,
              subtitle: items.length > 1 ? `${items.length} assets` : items[0]?.name,
              nodeIds,
              assetIds: resourceIds,
            },
          }),
        }
      })
      return nodeIds
    },

    replaceAssetResource: (resourceId, item) => {
      const now = runtime.now()
      set((state) => {
        const resource = state.project.resources[resourceId]
        if (!resource) return state
        const nodeIds = state.project.canvas.nodes
          .filter((node) => canvasNodeResourceId(node) === resourceId)
          .map((node) => node.id)
        const nextAssets: Record<string, AssetRecord> = {}
        let nextResource: Resource

        if (item.type === 'text') {
          const assetId = primitiveAssetIdForResource(resourceId)
          nextAssets[assetId] = primitiveAssetRecord(assetId, item.name, 'text', item.value, now)
          nextResource = {
            ...resource,
            type: 'text',
            name: item.name,
            value: primitiveResourceValueWithAsset(assetId, 'text', item.value),
          }
        } else if (item.type === 'number') {
          const assetId = primitiveAssetIdForResource(resourceId)
          nextAssets[assetId] = primitiveAssetRecord(assetId, item.name, 'number', item.value, now)
          nextResource = {
            ...resource,
            type: 'number',
            name: item.name,
            value: primitiveResourceValueWithAsset(assetId, 'number', item.value),
          }
        } else {
          const assetId = runtime.idFactory()
          nextAssets[assetId] = {
            id: assetId,
            name: item.media.filename ?? item.name,
            mimeType: item.media.mimeType,
            sizeBytes: item.media.sizeBytes,
            blobUrl: item.media.url,
            createdAt: now,
          }
          nextResource = {
            ...resource,
            type: item.type,
            name: item.media.filename ?? item.name,
            value: mediaValueWithAsset(assetId, item.media),
          }
        }

        const nextProject = {
          ...ensureProjectHistory(state.project),
          project: { ...state.project.project, updatedAt: now },
          assets: { ...state.project.assets, ...nextAssets },
          resources: {
            ...state.project.resources,
            [resourceId]: nextResource,
          },
          canvas: {
            ...state.project.canvas,
            nodes: state.project.canvas.nodes.map((node) =>
              canvasNodeResourceId(node) === resourceId
                ? { ...node, data: { ...node.data, resourceType: item.type } }
                : node,
            ),
          },
        }

        return {
          project: projectWithRecordedHistory(state.project, nextProject, now, {
            label: `Replace ${item.type} asset`,
            transactionType: 'asset',
            nodeIds,
            assetIds: [resourceId],
            preview: {
              title: `Replace ${item.type} asset`,
              subtitle: item.name,
              nodeIds,
              assetIds: [resourceId],
            },
          }),
        }
      })
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
                value: primitiveResourceValueWithAsset(primitiveAssetIdForResource(resourceId), 'text', value),
              },
            },
            assets: {
              ...state.project.assets,
              [primitiveAssetIdForResource(resourceId)]: primitiveAssetRecord(
                primitiveAssetIdForResource(resourceId),
                resource.name ?? resourceNameForType('text'),
                'text',
                value,
                now,
              ),
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
                value: primitiveResourceValueWithAsset(primitiveAssetIdForResource(resourceId), 'number', value),
              },
            },
            assets: {
              ...state.project.assets,
              [primitiveAssetIdForResource(resourceId)]: primitiveAssetRecord(
                primitiveAssetIdForResource(resourceId),
                resource.name ?? resourceNameForType('number'),
                'number',
                value,
                now,
              ),
            },
          },
        }
      })
    },

    replaceResourceMedia: (resourceId, type, media) => {
      get().replaceAssetResource(resourceId, {
        type,
        name: media.filename ?? resourceNameForType(type),
        media,
      })
    },

    addFunctionFromWorkflow: (name, workflow, options) => {
      const id = runtime.idFactory()
      const now = runtime.now()
      const generationFunction = createGenerationFunctionFromWorkflow(id, name, workflow, now, options)

      set((state) => ({
        project: {
          ...state.project,
          project: { ...state.project.project, updatedAt: now },
          functions: { ...state.project.functions, [id]: generationFunction },
        },
      }))
      return id
    },

    addRequestFunction: (name, config) => {
      const id = runtime.idFactory()
      const now = runtime.now()
      const baseFunction = createRequestFunction(id, name, now)
      const request = mergedRequestConfig(undefined, config)
      const generationFunction: GenerationFunction = {
        ...baseFunction,
        request,
        outputs: normalizeRequestOutputsForParse(baseFunction.outputs, request.responseParse),
      }

      set((state) => ({
        project: {
          ...state.project,
          project: { ...state.project.project, updatedAt: now },
          functions: { ...state.project.functions, [id]: generationFunction },
        },
      }))
      return id
    },

    addOpenAILlmFunction: (name, config) => {
      const id = runtime.idFactory()
      const now = runtime.now()
      const generationFunction = createOpenAILlmFunction(now, {
        id,
        name,
        config,
      })

      set((state) => ({
        project: {
          ...state.project,
          project: { ...state.project.project, updatedAt: now },
          functions: { ...state.project.functions, [id]: generationFunction },
        },
      }))
      return id
    },

    addGeminiLlmFunction: (name, config) => {
      const id = runtime.idFactory()
      const now = runtime.now()
      const generationFunction = createGeminiLlmFunction(now, {
        id,
        name,
        config,
      })

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
                    if (isPendingResourceRef(value)) return value.type === input.type

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

    ensureEditableFunctionForNode: (nodeId, scope) => {
      const now = runtime.now()
      let editableFunctionId: string | undefined

      set((state) => {
        const targetNode = state.project.canvas.nodes.find((node) => node.id === nodeId && node.type === 'function')
        const sourceFunctionId = typeof targetNode?.data.functionId === 'string' ? targetNode.data.functionId : undefined
        const sourceFunction = sourceFunctionId ? state.project.functions[sourceFunctionId] : undefined
        if (!targetNode || !sourceFunction) return state

        if (scope === 'node' && targetNode.data.functionScope === 'node' && !isBuiltInFunction(sourceFunction)) {
          editableFunctionId = sourceFunction.id
          return state
        }

        if (scope === 'all' && !isBuiltInFunction(sourceFunction)) {
          editableFunctionId = sourceFunction.id
          return state
        }

        const clonedFunctionId = runtime.idFactory()
        const clonedFunctionName = scope === 'node' ? `${sourceFunction.name} (this node)` : sourceFunction.name
        const clonedFunction: GenerationFunction = {
          ...structuredClone(sourceFunction),
          id: clonedFunctionId,
          name: clonedFunctionName,
          createdAt: now,
          updatedAt: now,
        }
        const shouldRetargetNode = (node: CanvasNode) =>
          node.type === 'function' &&
          (scope === 'node' ? node.id === nodeId : node.data.functionId === sourceFunction.id)

        editableFunctionId = clonedFunctionId

        return {
          project: {
            ...state.project,
            project: { ...state.project.project, updatedAt: now },
            functions: { ...state.project.functions, [clonedFunctionId]: clonedFunction },
            comfy: {
              ...state.project.comfy,
              endpoints: state.project.comfy.endpoints.map((endpoint) => {
                const supportedFunctions = endpoint.capabilities?.supportedFunctions
                if (!sourceFunctionId || supportedFunctions === undefined || !supportedFunctions.includes(sourceFunctionId)) {
                  return endpoint
                }
                return {
                  ...endpoint,
                  ...endpointCapabilitySupportedFunctionsPatch(endpoint, [...supportedFunctions, clonedFunctionId]),
                }
              }),
            },
            canvas: {
              ...state.project.canvas,
              nodes: state.project.canvas.nodes.map((node) => {
                if (!shouldRetargetNode(node)) return node
                const shouldUpdateTitle = node.data.title === sourceFunction.name
                return {
                  ...node,
                  data: {
                    ...node.data,
                    functionId: clonedFunctionId,
                    title: shouldUpdateTitle ? clonedFunctionName : node.data.title,
                    functionScope: scope,
                    baseFunctionId: sourceFunction.id,
                  },
                }
              }),
            },
          },
        }
      })

      return editableFunctionId
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
            comfy: {
              ...state.project.comfy,
              endpoints: state.project.comfy.endpoints.map((endpoint) =>
                endpoint.capabilities?.supportedFunctions === undefined
                  ? endpoint
                  : {
                      ...endpoint,
                      ...endpointCapabilitySupportedFunctionsPatch(
                        endpoint,
                        endpoint.capabilities.supportedFunctions.filter((id) => id !== functionId),
                      ),
                    },
              ),
            },
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

    runFunctionAtPosition: async (functionId, inputValues, position, runCount, functionSnapshot) => {
      const state = get()
      const functionDef = functionSnapshot ?? state.project.functions[functionId]
      if (!functionDef) return undefined

      const now = runtime.now()
      const normalizedRuns = normalizedRunCount(runCount ?? functionDef.runtimeDefaults?.runCount ?? 1)
      const runtimeInputValues = inputValues as RuntimeInputValues
      if (missingRequiredInputKeys(functionDef.inputs, runtimeInputValues, state.project.resources).length > 0) {
        return undefined
      }

      const hasPendingDependencies = hasPendingInputRefs(runtimeInputValues)
      const provider = runProviderForFunction(functionDef)
      const tasks: Record<string, ExecutionTask> = {}
      const runs: Record<string, NonNullable<ProjectState['runs']>[string]> = {}
      const resources: Record<string, Resource> = {}
      const nodes: CanvasNode[] = []
      const queuedRuns: Array<{
        taskId: string
        runIndex: number
        outputRefs: Record<string, ResourceRef[]>
        inputValues: ResolvedRuntimeInputValues
      }> = []

      for (let index = 0; index < normalizedRuns; index += 1) {
        const taskId = runtime.idFactory()
        const runIndex = index + 1
        const outputRefs: Record<string, ResourceRef[]> = {}

        functionDef.outputs.forEach((output, outputIndex) => {
          const resourceId = runtime.idFactory()
          const ref: ResourceRef = { resourceId, type: output.type }
          outputRefs[output.key] = [ref]
          resources[resourceId] = {
            id: resourceId,
            type: output.type,
            name: `${functionDef.name} ${output.label || output.key}`,
            value: emptyFunctionOutputValue(output.type, resourceId),
            source: generatedResourceSourceForRun({ runId: taskId, outputKey: output.key }),
            metadata: {
              workflowFunctionId: functionId,
              endpointId: provider === 'local_transform' ? 'local' : undefined,
              createdAt: now,
            },
          }
          nodes.push({
            id: resourceNodeId(resourceId),
            type: 'resource',
            position: commandOutputPosition(position, index, outputIndex),
            data: {
              resourceId,
              resourceType: output.type,
              functionId,
              taskId,
              outputKey: output.key,
              status: hasPendingDependencies ? 'pending' : 'queued',
            },
          })
        })

        tasks[taskId] = {
          id: taskId,
          functionNodeId: taskId,
          functionId,
          runIndex,
          runTotal: normalizedRuns,
          status: hasPendingDependencies ? 'pending' : 'queued',
          inputRefs: inputResourceRefs(runtimeInputValues),
          inputSnapshot: resourceInputSnapshot(runtimeInputValues, state.project.resources),
          inputValuesSnapshot: executionInputSnapshot(functionDef, runtimeInputValues, state.project.resources, state.project.assets),
          paramsSnapshot: { runCount: normalizedRuns, mode: 'function_command' },
          workflowTemplateSnapshot: functionDef.workflow.rawJson,
          compiledWorkflowSnapshot: functionDef.workflow.rawJson,
          seedPatchLog: [],
          endpointId: provider === 'local_transform' ? 'local' : undefined,
          outputRefs,
          createdAt: now,
          updatedAt: now,
        }
        runs[taskId] = createRunSnapshot({
          id: taskId,
          functionDef,
          provider,
          inputRefs: inputResourceRefs(runtimeInputValues),
          inputValuesSnapshot: executionInputSnapshot(functionDef, runtimeInputValues, state.project.resources, state.project.assets),
          primitiveParams: { runCount: normalizedRuns },
          runIndex,
          runTotal: normalizedRuns,
          outputRefs,
          endpointId: provider === 'local_transform' ? 'local' : undefined,
          workflowTemplateSnapshot: functionDef.workflow.rawJson,
          compiledWorkflowSnapshot: functionDef.workflow.rawJson,
          taskIds: [taskId],
          status: hasPendingDependencies ? 'pending' : 'queued',
          now,
        })

        if (!hasPendingDependencies) {
          queuedRuns.push({
            taskId,
            runIndex,
            outputRefs,
            inputValues: asResolvedInputValues(runtimeInputValues),
          })
        }
      }

      const firstTaskId = Object.keys(tasks)[0]

      set((state) => ({
        ...selectedState([]),
        project: {
          ...state.project,
          project: { ...state.project.project, updatedAt: now },
          resources: { ...state.project.resources, ...resources },
          runs: { ...(state.project.runs ?? {}), ...runs },
          tasks: { ...state.project.tasks, ...tasks },
          canvas: { ...state.project.canvas, nodes: [...state.project.canvas.nodes, ...nodes] },
        },
      }))

      const outputRefsWithExtraRef = (
        outputRefs: Record<string, ResourceRef[]>,
        outputKey: string,
        type: ResourceType,
        valueIndex: number,
        outputIndex: number,
        runIndex: number,
        taskId: string,
        completedAt: string,
      ) => {
        const refs = outputRefs[outputKey] ? [...outputRefs[outputKey]] : []
        let ref = refs[valueIndex]
        let extraNode: CanvasNode | undefined
        if (!ref) {
          const resourceId = runtime.idFactory()
          ref = { resourceId, type }
          refs.push(ref)
          extraNode = {
            id: resourceNodeId(resourceId),
            type: 'resource',
            position: commandOutputPosition(position, runIndex - 1, outputIndex + valueIndex),
            data: {
              resourceId,
              resourceType: type,
              functionId,
              taskId,
              outputKey,
              status: 'succeeded',
              completedAt,
            },
          }
        }
        return { ref, refs, extraNode }
      }

      const sourceForOutput = (runId: string, outputKey: string) =>
        generatedResourceSourceForRun({ runId, outputKey })

      const outputResourceFromLocalValue = (
        resourceId: string,
        output: { key: string; label: string; type: ResourceType },
        value: LocalTransformOutputValue,
        taskId: string,
        completedAt: string,
      ): { resource: Resource; asset?: ProjectState['assets'][string] } => {
        if (output.type === 'number') {
          const numericValue = Number(value)
          return primitiveResourceWithAsset(
            resourceId,
            'number',
            output.label,
            Number.isFinite(numericValue) ? numericValue : 0,
            sourceForOutput(taskId, output.key),
            { workflowFunctionId: functionId, endpointId: 'local', createdAt: completedAt },
          )
        }

        if (output.type === 'image' || output.type === 'video' || output.type === 'audio') {
          if (typeof value !== 'object' || value === null || !('url' in value)) {
            throw new Error(`Local output ${output.key} did not produce a media payload`)
          }
          const assetId = runtime.idFactory()
          const filename = value.filename ?? output.label
          const asset = {
            id: assetId,
            name: filename,
            mimeType: value.mimeType,
            sizeBytes: value.sizeBytes,
            blobUrl: value.url,
            createdAt: completedAt,
          }
          return {
            asset,
            resource: {
              id: resourceId,
              type: output.type,
              name: filename,
              value: mediaValueWithAsset(assetId, value),
              source: sourceForOutput(taskId, output.key),
              metadata: { workflowFunctionId: functionId, endpointId: 'local', createdAt: completedAt },
            },
          }
        }

        return primitiveResourceWithAsset(
          resourceId,
          'text',
          output.label,
          String(value ?? ''),
          sourceForOutput(taskId, output.key),
          { workflowFunctionId: functionId, endpointId: 'local', createdAt: completedAt },
        )
      }

      const mediaResourceFromGeneratedImage = (
        resourceId: string,
        output: { key: string; label: string; type: 'image' },
        value: { dataUrl: string; filename: string; mimeType: string },
        taskId: string,
        endpointId: string,
        completedAt: string,
      ): { resource: Resource; asset: ProjectState['assets'][string] } => {
        const assetId = runtime.idFactory()
        const asset = {
          id: assetId,
          name: value.filename,
          mimeType: value.mimeType,
          sizeBytes: 0,
          blobUrl: value.dataUrl,
          createdAt: completedAt,
        }
        return {
          asset,
          resource: {
            id: resourceId,
            type: 'image',
            name: value.filename || output.label,
            value: {
              assetId,
              url: value.dataUrl,
              filename: value.filename,
              mimeType: value.mimeType,
              sizeBytes: 0,
            },
            source: sourceForOutput(taskId, output.key),
            metadata: { workflowFunctionId: functionId, endpointId, createdAt: completedAt },
          },
        }
      }

      const resourceFromRequestValue = (
        resourceId: string,
        output: { key: string; label: string; type: ResourceType },
        value: string | RequestBinaryOutputValue,
        taskId: string,
        completedAt: string,
      ): { resource: Resource; asset?: ProjectState['assets'][string] } => {
        if (output.type === 'number') {
          const numericValue = Number(typeof value === 'string' ? value : value.sizeBytes)
          return primitiveResourceWithAsset(
            resourceId,
            'number',
            output.label,
            Number.isFinite(numericValue) ? numericValue : 0,
            sourceForOutput(taskId, output.key),
            { workflowFunctionId: functionId, endpointId: 'request', createdAt: completedAt },
          )
        }

        if (output.type === 'image' || output.type === 'video' || output.type === 'audio') {
          const assetId = runtime.idFactory()
          const filename = typeof value === 'string' ? value.split(/[/?#]/).filter(Boolean).at(-1) || output.label : value.filename
          const mimeType = typeof value === 'string' ? outputMimeType(output.type, filename) : value.mimeType
          const url = typeof value === 'string' ? value : value.url
          const sizeBytes = typeof value === 'string' ? 0 : value.sizeBytes
          const asset = {
            id: assetId,
            name: filename,
            mimeType,
            sizeBytes,
            blobUrl: url,
            createdAt: completedAt,
          }
          return {
            asset,
            resource: {
              id: resourceId,
              type: output.type,
              name: filename,
              value: { assetId, url, filename, mimeType, sizeBytes },
              source: sourceForOutput(taskId, output.key),
              metadata: { workflowFunctionId: functionId, endpointId: 'request', createdAt: completedAt },
            },
          }
        }

        return primitiveResourceWithAsset(
          resourceId,
          'text',
          output.label,
          String(value ?? ''),
          sourceForOutput(taskId, output.key),
          { workflowFunctionId: functionId, endpointId: 'request', createdAt: completedAt },
        )
      }

      const markCommandTaskRunning = (taskId: string, endpointId: string) => {
        const startedAt = runtime.now()
        set((current) => ({
          project: {
            ...current.project,
            tasks: {
              ...current.project.tasks,
              [taskId]: {
                ...current.project.tasks[taskId]!,
                status: 'running',
                endpointId,
                startedAt,
                updatedAt: startedAt,
              },
            },
            runs: {
              ...(current.project.runs ?? {}),
              [taskId]: {
                ...(current.project.runs?.[taskId] ?? runs[taskId]!),
                status: 'running',
                endpointId,
                updatedAt: startedAt,
              },
            },
            canvas: {
              ...current.project.canvas,
              nodes: current.project.canvas.nodes.map((node) =>
                node.data.taskId === taskId
                  ? { ...node, data: { ...node.data, endpointId, status: 'running', startedAt } }
                  : node,
              ),
            },
          },
        }))
      }

      const failCommandTask = (taskId: string, err: unknown) => {
        const failedAt = runtime.now()
        const message = err instanceof Error ? err.message : 'Function command failed'
        set((current) => ({
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: failedAt },
            tasks: {
              ...current.project.tasks,
              [taskId]: {
                ...current.project.tasks[taskId]!,
                status: 'failed',
                error: { code: 'function_command_failed', message, raw: err },
                updatedAt: failedAt,
                completedAt: failedAt,
              },
            },
            runs: {
              ...(current.project.runs ?? {}),
              [taskId]: {
                ...(current.project.runs?.[taskId] ?? runs[taskId]!),
                status: 'failed',
                error: { code: 'function_command_failed', message, raw: err },
                updatedAt: failedAt,
                completedAt: failedAt,
              },
            },
            canvas: {
              ...current.project.canvas,
              nodes: current.project.canvas.nodes.map((node) =>
                node.data.taskId === taskId
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        status: 'failed',
                        error: { code: 'function_command_failed', message },
                        completedAt: failedAt,
                      },
                    }
                  : node,
              ),
            },
          },
        }))
      }

      const completeCommandTask = (
        taskId: string,
        outputRefs: Record<string, ResourceRef[]>,
        nextResources: Record<string, Resource>,
        nextAssets: ProjectState['assets'],
        completedAt: string,
        extraNodes: CanvasNode[],
        taskPatch: Partial<ExecutionTask> = {},
      ) => {
        const completedResourceIds = new Set(Object.keys(nextResources))
        set((current) => ({
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: completedAt },
            resources: { ...current.project.resources, ...nextResources },
            assets: { ...current.project.assets, ...nextAssets },
            tasks: {
              ...current.project.tasks,
              [taskId]: {
                ...current.project.tasks[taskId]!,
                ...taskPatch,
                status: 'succeeded',
                outputRefs,
                updatedAt: completedAt,
                completedAt,
              },
            },
            runs: {
              ...(current.project.runs ?? {}),
              [taskId]: {
                ...(current.project.runs?.[taskId] ?? runs[taskId]!),
                requestSnapshot: taskPatch.requestSnapshot ?? current.project.runs?.[taskId]?.requestSnapshot,
                compiledWorkflowSnapshot:
                  taskPatch.compiledWorkflowSnapshot ?? current.project.runs?.[taskId]?.compiledWorkflowSnapshot,
                seedPatchLog: taskPatch.seedPatchLog ?? current.project.runs?.[taskId]?.seedPatchLog ?? [],
                endpointId: taskPatch.endpointId ?? current.project.runs?.[taskId]?.endpointId,
                status: 'succeeded',
                outputRefs,
                updatedAt: completedAt,
                completedAt,
              },
            },
            canvas: {
              ...current.project.canvas,
              nodes: [
                ...current.project.canvas.nodes.map((node) =>
                  completedResourceIds.has(String(node.data.resourceId))
                    ? { ...node, data: { ...node.data, status: 'succeeded', completedAt } }
                    : node,
                ),
                ...extraNodes,
              ],
            },
          },
        }))
        void resolvePendingDependencyTasks()
      }

      for (const queuedRun of queuedRuns) {
        if (provider === 'local_transform') {
        markCommandTaskRunning(queuedRun.taskId, 'local')
        try {
          const outputs = await executeLocalTransformFunction(
            functionDef,
            queuedRun.inputValues,
            runtimeResourcesForProject(get().project),
            (resource) => readProjectResourceBlob(get().project, resource, runtime.createComfyClient),
          )
          const completedAt = runtime.now()
          const nextResources: Record<string, Resource> = {}
          const nextAssets: ProjectState['assets'] = {}
          const nextOutputRefs: Record<string, ResourceRef[]> = {}
          const extraNodes: CanvasNode[] = []

          outputs.forEach((outputItem, outputIndex) => {
            let refs = queuedRun.outputRefs[outputItem.key] ? [...queuedRun.outputRefs[outputItem.key]] : []
            outputItem.values.forEach((value, valueIndex) => {
              const { ref, refs: nextRefs, extraNode } = outputRefsWithExtraRef(
                queuedRun.outputRefs,
                outputItem.key,
                outputItem.type,
                valueIndex,
                outputIndex,
                queuedRun.runIndex,
                queuedRun.taskId,
                completedAt,
              )
              refs = nextRefs
              if (extraNode) extraNodes.push(extraNode)

              const created = outputResourceFromLocalValue(ref.resourceId, outputItem, value, queuedRun.taskId, completedAt)
              nextResources[created.resource.id] = created.resource
              if (created.asset) nextAssets[created.asset.id] = created.asset
            })
            nextOutputRefs[outputItem.key] = refs
          })

          completeCommandTask(queuedRun.taskId, nextOutputRefs, nextResources, nextAssets, completedAt, extraNodes)
        } catch (err) {
          failCommandTask(queuedRun.taskId, err)
        }
          continue
        }

        if (provider === 'comfyui') {
        const endpoint = selectEndpoint(get().project.comfy.endpoints, activeJobs(get().project.tasks), functionId)
        if (!endpoint) {
          failCommandTask(queuedRun.taskId, new Error('No eligible ComfyUI endpoint'))
          continue
        }

        markCommandTaskRunning(queuedRun.taskId, endpoint.id)
        try {
          const client = runtime.createComfyClient(endpoint)
          const preparedInputValues = await prepareComfyInputValues(
            client,
            functionDef.inputs,
            queuedRun.inputValues,
            runtimeResourcesForProject(get().project),
            (resource) => readProjectResourceBlob(get().project, resource, runtime.createComfyClient),
          )
          const compiledWithInputs = injectWorkflowInputs(
            functionDef.workflow.rawJson,
            functionDef.inputs,
            asResolvedInputValues(preparedInputValues),
            runtimeResourcesForProject(get().project),
          )
          const randomized = randomizeWorkflowSeeds(compiledWithInputs, {
            now: runtime.now,
            randomInt: runtime.randomInt,
          })
          set((current) => ({
            project: {
              ...current.project,
              tasks: {
                ...current.project.tasks,
                [queuedRun.taskId]: {
                  ...current.project.tasks[queuedRun.taskId]!,
                  compiledWorkflowSnapshot: randomized.workflow,
                  requestSnapshot: randomized.workflow,
                  seedPatchLog: randomized.patchLog,
                  updatedAt: runtime.now(),
                },
              },
              runs: {
                ...(current.project.runs ?? {}),
                [queuedRun.taskId]: {
                  ...(current.project.runs?.[queuedRun.taskId] ?? runs[queuedRun.taskId]!),
                  compiledWorkflowSnapshot: randomized.workflow,
                  requestSnapshot: randomized.workflow,
                  seedPatchLog: randomized.patchLog,
                  updatedAt: runtime.now(),
                },
              },
            },
          }))

          const result = await runComfyPrompt(client, randomized.workflow, runtime.comfyRunOptions)
          const outputs = extractComfyOutputs(result.history, randomized.workflow, functionDef.outputs)
          const completedAt = runtime.now()
          const nextResources: Record<string, Resource> = {}
          const nextAssets: ProjectState['assets'] = {}
          const nextOutputRefs: Record<string, ResourceRef[]> = {}
          const extraNodes: CanvasNode[] = []

          for (const [outputIndex, output] of outputs.entries()) {
            let valueIndex = 0

            for (const file of output.files) {
              const { ref, extraNode } = outputRefsWithExtraRef(
                queuedRun.outputRefs,
                output.key,
                output.type,
                valueIndex,
                outputIndex,
                queuedRun.runIndex,
                queuedRun.taskId,
                completedAt,
              )
              if (extraNode) extraNodes.push(extraNode)

              const assetId = runtime.idFactory()
              const persisted = await persistedComfyFile(client, endpoint, file, outputMimeType(output.type, file.filename))
              nextAssets[assetId] = {
                id: assetId,
                name: file.filename,
                mimeType: persisted.mimeType,
                sizeBytes: persisted.sizeBytes,
                blobUrl: persisted.url,
                createdAt: completedAt,
              }
              nextResources[ref.resourceId] = {
                id: ref.resourceId,
                type: output.type,
                name: file.filename,
                value: {
                  assetId,
                  url: persisted.url,
                  filename: file.filename,
                  mimeType: persisted.mimeType,
                  sizeBytes: persisted.sizeBytes,
                  comfy: {
                    endpointId: endpoint.id,
                    filename: file.filename,
                    subfolder: file.subfolder ?? '',
                    type: file.type,
                  },
                },
                source: sourceForOutput(queuedRun.taskId, output.key),
                metadata: { workflowFunctionId: functionId, endpointId: endpoint.id, createdAt: completedAt },
              }
              valueIndex += 1
            }

            for (const text of output.texts ?? []) {
              const { ref, extraNode } = outputRefsWithExtraRef(
                queuedRun.outputRefs,
                output.key,
                'text',
                valueIndex,
                outputIndex,
                queuedRun.runIndex,
                queuedRun.taskId,
                completedAt,
              )
              if (extraNode) extraNodes.push(extraNode)

              const created = primitiveResourceWithAsset(
                ref.resourceId,
                'text',
                output.key,
                text,
                sourceForOutput(queuedRun.taskId, output.key),
                { workflowFunctionId: functionId, endpointId: endpoint.id, createdAt: completedAt },
              )
              nextResources[ref.resourceId] = created.resource
              nextAssets[created.asset.id] = created.asset
              valueIndex += 1
            }

            nextOutputRefs[output.key] = Object.values(nextResources)
              .filter((resource) => resource.source.outputKey === output.key)
              .map((resource) => ({ resourceId: resource.id, type: resource.type }))
          }

          completeCommandTask(queuedRun.taskId, nextOutputRefs, nextResources, nextAssets, completedAt, extraNodes, {
            comfyPromptId: result.promptId,
            endpointId: endpoint.id,
            compiledWorkflowSnapshot: randomized.workflow,
            requestSnapshot: randomized.workflow,
            seedPatchLog: randomized.patchLog,
          })
        } catch (err) {
          failCommandTask(queuedRun.taskId, err)
        }
          continue
        }

        markCommandTaskRunning(queuedRun.taskId, provider)
        try {
          const completedAt = runtime.now()
          const nextResources: Record<string, Resource> = {}
          const nextAssets: ProjectState['assets'] = {}
          const nextOutputRefs: Record<string, ResourceRef[]> = {}
          const extraNodes: CanvasNode[] = []
          let requestSnapshot: unknown

          if (provider === 'openai_llm') {
            const config = mergedOpenAILlmConfig(functionDef.openai)
            if (!config.apiKey.trim()) throw new Error('OpenAI API key is required')
            const request = await createOpenAIChatCompletionRequest(
              config,
              queuedRun.inputValues,
              runtimeResourcesForProject(get().project),
              (resource) => readProjectResourceBlob(get().project, resource, runtime.createComfyClient),
            )
            requestSnapshot = request
            const response = await fetch(chatCompletionsUrl(config.baseUrl), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey.trim()}` },
              body: JSON.stringify(request),
            })
            if (!response.ok) throw new Error(`OpenAI request failed: ${response.status}`)
            const responseJson = await response.json()
            const outputText = extractOpenAIChatCompletionText(responseJson)
            if (!outputText) throw new Error('OpenAI response did not include output text')
            const output = functionDef.outputs[0] ?? { key: 'text', label: 'Text', type: 'text' as const }
            const ref = queuedRun.outputRefs[output.key]?.[0]
            if (!ref) throw new Error(`Missing pending output ref: ${output.key}`)
            const created = primitiveResourceWithAsset(
              ref.resourceId,
              'text',
              output.label,
              outputText,
              sourceForOutput(queuedRun.taskId, output.key),
              { workflowFunctionId: functionId, endpointId: 'openai', createdAt: completedAt },
            )
            nextResources[ref.resourceId] = created.resource
            nextAssets[created.asset.id] = created.asset
            nextOutputRefs[output.key] = [ref]
          } else if (provider === 'gemini_llm') {
            const config = mergedGeminiLlmConfig(functionDef.gemini)
            if (!config.apiKey.trim()) throw new Error('Gemini API key is required')
            const request = await createGeminiGenerateContentRequest(
              config,
              queuedRun.inputValues,
              runtimeResourcesForProject(get().project),
              (resource) => readProjectResourceBlob(get().project, resource, runtime.createComfyClient),
            )
            requestSnapshot = request
            const response = await fetch(geminiGenerateContentUrl(config.baseUrl, config.model), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey.trim() },
              body: JSON.stringify(request),
            })
            if (!response.ok) throw new Error(`Gemini request failed: ${response.status}`)
            const responseJson = await response.json()
            const outputText = extractGeminiGenerateContentText(responseJson)
            if (!outputText) throw new Error('Gemini response did not include output text')
            const output = functionDef.outputs[0] ?? { key: 'text', label: 'Text', type: 'text' as const }
            const ref = queuedRun.outputRefs[output.key]?.[0]
            if (!ref) throw new Error(`Missing pending output ref: ${output.key}`)
            const created = primitiveResourceWithAsset(
              ref.resourceId,
              'text',
              output.label,
              outputText,
              sourceForOutput(queuedRun.taskId, output.key),
              { workflowFunctionId: functionId, endpointId: 'gemini', createdAt: completedAt },
            )
            nextResources[ref.resourceId] = created.resource
            nextAssets[created.asset.id] = created.asset
            nextOutputRefs[output.key] = [ref]
          } else if (provider === 'openai_image') {
            const config = mergedOpenAIImageConfig(functionDef.openaiImage)
            if (!config.apiKey.trim()) throw new Error('OpenAI API key is required')
            const request = await createOpenAIImageApiRequest(
              config,
              queuedRun.inputValues,
              runtimeResourcesForProject(get().project),
              functionDef.inputs.find((input) => input.key === 'prompt')?.defaultValue,
              (resource) => readProjectResourceBlob(get().project, resource, runtime.createComfyClient),
            )
            requestSnapshot = request.kind === 'edit' ? { kind: request.kind, body: snapshotFormData(request.body) } : request
            const response = await fetch(
              request.kind === 'edit' ? openAiImagesEditsUrl(config.baseUrl) : openAiImagesGenerationsUrl(config.baseUrl),
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${config.apiKey.trim()}`,
                  ...(request.kind === 'generation' ? { 'Content-Type': 'application/json' } : {}),
                },
                body: request.kind === 'edit' ? request.body : JSON.stringify(request.body),
              },
            )
            if (!response.ok) throw new Error(`OpenAI image request failed: ${response.status}`)
            const outputs = extractOpenAIImageGenerationOutputs(await response.json(), config.outputFormat)
            if (outputs.length === 0) throw new Error('OpenAI image response did not include image data')
            const output = functionDef.outputs[0] ?? { key: 'image', label: 'Image', type: 'image' as const }
            outputs.forEach((value, valueIndex) => {
              const { ref, refs, extraNode } = outputRefsWithExtraRef(
                queuedRun.outputRefs,
                output.key,
                'image',
                valueIndex,
                0,
                queuedRun.runIndex,
                queuedRun.taskId,
                completedAt,
              )
              if (extraNode) extraNodes.push(extraNode)
              const created = mediaResourceFromGeneratedImage(
                ref.resourceId,
                { key: output.key, label: output.label, type: 'image' },
                value,
                queuedRun.taskId,
                'openai_image',
                completedAt,
              )
              nextResources[created.resource.id] = created.resource
              nextAssets[created.asset.id] = created.asset
              nextOutputRefs[output.key] = refs
            })
          } else if (provider === 'gemini_image') {
            const config = mergedGeminiImageConfig(functionDef.geminiImage)
            if (!config.apiKey.trim()) throw new Error('Gemini API key is required')
            const request = await createGeminiImageGenerationRequest(
              config,
              queuedRun.inputValues,
              runtimeResourcesForProject(get().project),
              functionDef.inputs.find((input) => input.key === 'prompt')?.defaultValue,
              (resource) => readProjectResourceBlob(get().project, resource, runtime.createComfyClient),
            )
            requestSnapshot = request
            const response = await fetch(geminiGenerateContentUrl(config.baseUrl, config.model), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey.trim() },
              body: JSON.stringify(request),
            })
            if (!response.ok) throw new Error(`Gemini image request failed: ${response.status}`)
            const outputs = extractGeminiImageGenerationOutputs(await response.json())
            if (outputs.length === 0) throw new Error('Gemini image response did not include image data')
            const output = functionDef.outputs[0] ?? { key: 'image', label: 'Image', type: 'image' as const }
            outputs.forEach((value, valueIndex) => {
              const { ref, refs, extraNode } = outputRefsWithExtraRef(
                queuedRun.outputRefs,
                output.key,
                'image',
                valueIndex,
                0,
                queuedRun.runIndex,
                queuedRun.taskId,
                completedAt,
              )
              if (extraNode) extraNodes.push(extraNode)
              const created = mediaResourceFromGeneratedImage(
                ref.resourceId,
                { key: output.key, label: output.label, type: 'image' },
                value,
                queuedRun.taskId,
                'gemini_image',
                completedAt,
              )
              nextResources[created.resource.id] = created.resource
              nextAssets[created.asset.id] = created.asset
              nextOutputRefs[output.key] = refs
            })
          } else if (provider === 'http_request') {
            const request = compileRequestFunctionRequest(functionDef, queuedRun.inputValues, runtimeResourcesForProject(get().project))
            requestSnapshot = request
            const response = await fetch(request.url, request.init)
            const responseBuffer = await response.arrayBuffer()
            const errorText = response.ok ? '' : decodeResponseBuffer(responseBuffer, request.responseEncoding)
            if (!response.ok) throw new Error(`Request failed: ${response.status} ${errorText}`)
            let responseText = ''
            let responseBinary: RequestBinaryOutputValue | undefined
            if (request.responseParse === 'binary') {
              const firstBinaryOutput = functionDef.outputs.find(
                (output) => output.type === 'image' || output.type === 'video' || output.type === 'audio',
              )
              const outputType = firstBinaryOutput?.type ?? 'image'
              const fallbackMimeType = outputMimeType(outputType, '')
              const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || fallbackMimeType
              const filename =
                filenameFromContentDisposition(response.headers.get('content-disposition')) ||
                filenameFromRequestUrl(request.url) ||
                `${firstBinaryOutput?.label ?? 'response'}.${extensionForMimeType(outputType, mimeType)}`
              const blob = new Blob([responseBuffer], { type: mimeType })
              responseBinary = {
                url: await blobToDataUrl(blob, mimeType),
                filename,
                mimeType: responseMimeType(response, outputType, filename),
                sizeBytes: responseBuffer.byteLength,
              }
            } else {
              responseText = decodeResponseBuffer(responseBuffer, request.responseEncoding)
            }
            const responseJson = request.responseParse === 'json' ? JSON.parse(responseText || 'null') : undefined
            const outputs = extractRequestFunctionOutputs(responseText, responseJson, functionDef.outputs, responseBinary)
            outputs.forEach((output, outputIndex) => {
              output.values.forEach((value, valueIndex) => {
                const { ref, refs, extraNode } = outputRefsWithExtraRef(
                  queuedRun.outputRefs,
                  output.key,
                  output.type,
                  valueIndex,
                  outputIndex,
                  queuedRun.runIndex,
                  queuedRun.taskId,
                  completedAt,
                )
                if (extraNode) extraNodes.push(extraNode)
                const created = resourceFromRequestValue(ref.resourceId, output, value, queuedRun.taskId, completedAt)
                nextResources[created.resource.id] = created.resource
                if (created.asset) nextAssets[created.asset.id] = created.asset
                nextOutputRefs[output.key] = refs
              })
            })
          }

          completeCommandTask(queuedRun.taskId, nextOutputRefs, nextResources, nextAssets, completedAt, extraNodes, {
            requestSnapshot,
            compiledWorkflowSnapshot: {},
            endpointId: provider,
          })
        } catch (err) {
          failCommandTask(queuedRun.taskId, err)
        }
      }

      return firstTaskId
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

    updateFunctionNodeRequestConfig: (nodeId, patch) => {
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
              if (!functionDef || !isRequestFunction(functionDef)) return node
              const currentConfig = mergedRequestConfig(
                functionDef.request,
                node.data.requestConfig as Partial<RequestFunctionConfig> | undefined,
              )
              return {
                ...node,
                data: {
                  ...node.data,
                  requestConfig: mergedRequestConfig(currentConfig, patch),
                  requestOutputs:
                    patch.responseParse && Array.isArray(node.data.requestOutputs)
                      ? normalizeRequestOutputsForParse(
                          node.data.requestOutputs as FunctionOutputDef[],
                          patch.responseParse,
                        )
                      : node.data.requestOutputs,
                },
              }
            }),
          },
        },
      }))
    },

    updateFunctionNodeRequestOutputs: (nodeId, outputs) => {
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
              if (!functionDef || !isRequestFunction(functionDef)) return node
              return {
                ...node,
                data: {
                  ...node.data,
                  requestOutputs: outputs,
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
      if (isRequestFunction(functionDef)) {
        void runRequestFunctionNode(nodeId, requestedRunCount)
        return
      }
      if (isLocalTransformFunction(functionDef)) {
        void runLocalFunctionNode(nodeId, requestedRunCount)
        return
      }

      const runCount = normalizedRunCount(
        requestedRunCount ?? Number((node.data.runtime as { runCount?: number } | undefined)?.runCount ?? 1),
      )
      const now = runtime.now()
      const inputValues = (node.data.inputValues ?? {}) as RuntimeInputValues
      const endpoint = selectEndpoint(state.project.comfy.endpoints, activeJobs(state.project.tasks), functionId)

      if (validateRequiredInputs(nodeId, functionDef, inputValues, state.project.resources).length > 0) return
      const hasPendingDependencies = hasPendingInputRefs(inputValues)

      const nextNodes: CanvasNode[] = []
      const nextResources: Record<string, Resource> = {}
      const nextTasks: Record<string, ExecutionTask> = {}
      const runRange = functionRunRange(state.project, nodeId, runCount)

      for (let index = 1; index <= runCount; index += 1) {
        const runIndex = runRange.start + index - 1
        const taskId = runtime.idFactory()
        const outputKey = functionDef.outputs[0]?.key ?? 'result'
        const outputResourceId = hasPendingDependencies ? undefined : runtime.idFactory()
        const resultNodeId = runtime.idFactory()
        const compiledWithInputs = hasPendingDependencies
          ? functionDef.workflow.rawJson
          : injectWorkflowInputs(
              functionDef.workflow.rawJson,
              functionDef.inputs,
              asResolvedInputValues(inputValues),
              state.project.resources,
            )
        const randomized = hasPendingDependencies
          ? { workflow: functionDef.workflow.rawJson, patchLog: [] }
          : randomizeWorkflowSeeds(compiledWithInputs, {
              now: runtime.now,
              randomInt: runtime.randomInt,
            })
        const outputRef = outputResourceId ? { resourceId: outputResourceId, type: 'text' as const } : undefined
        const resource: Resource | undefined = outputResourceId
          ? {
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
          : undefined
        const status = hasPendingDependencies ? 'pending' : endpoint ? 'succeeded' : 'failed'
        const task: ExecutionTask = {
          id: taskId,
          functionNodeId: nodeId,
          functionId,
          runIndex,
          runTotal: runRange.total,
          status,
          inputRefs: inputResourceRefs(inputValues),
          inputSnapshot: resourceInputSnapshot(inputValues, state.project.resources),
          inputValuesSnapshot: executionInputSnapshot(functionDef, inputValues, state.project.resources, state.project.assets),
          paramsSnapshot: { runCount },
          workflowTemplateSnapshot: functionDef.workflow.rawJson,
          compiledWorkflowSnapshot: randomized.workflow,
          seedPatchLog: randomized.patchLog,
          endpointId: endpoint?.id,
          outputRefs: outputRef ? { [outputKey]: [outputRef] } : {},
          error: !hasPendingDependencies && !endpoint ? { code: 'endpoint_unavailable', message: 'No eligible ComfyUI endpoint' } : undefined,
          createdAt: now,
          startedAt: hasPendingDependencies ? undefined : now,
          updatedAt: now,
          completedAt: hasPendingDependencies ? undefined : now,
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
            resources: outputRef ? [outputRef] : [],
            status: task.status,
            seedPatchLog: randomized.patchLog,
            createdAt: now,
            startedAt: hasPendingDependencies ? undefined : now,
            completedAt: hasPendingDependencies ? undefined : now,
          },
        }

        if (resource) nextResources[resource.id] = resource
        const outputResourceNodes =
          resource && outputRef && status === 'succeeded'
            ? outputResourceNodesForRefs(
                [outputRef],
                { ...state.project.resources, ...nextResources },
                resultNodeId,
                [...state.project.canvas.nodes, ...nextNodes, resultNode],
              )
            : []
        nextTasks[taskId] = task
        nextNodes.push(resultNode, ...outputResourceNodes)
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
      if (hasPendingDependencies) void resolvePendingDependencyTasks()
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
      if (isRequestFunction(functionDef)) {
        await runRequestFunctionNode(nodeId, requestedRunCount)
        return
      }
      if (isLocalTransformFunction(functionDef)) {
        await runLocalFunctionNode(nodeId, requestedRunCount)
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
      const hasPendingDependencies = hasPendingInputRefs(inputValues)

      if (workerEndpoints.length === 0 && !hasPendingDependencies) {
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
          status: hasPendingDependencies ? 'pending' : 'queued',
          inputRefs: inputResourceRefs(inputValues),
          inputSnapshot: resourceInputSnapshot(inputValues, state.project.resources),
          inputValuesSnapshot: executionInputSnapshot(functionDef, inputValues, state.project.resources, state.project.assets),
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
            status: hasPendingDependencies ? 'pending' : 'queued',
            seedPatchLog: [],
            createdAt: now,
          },
        }

        queuedTasks[taskId] = task
        queuedNodes.push(resultNode)
        if (!hasPendingDependencies) {
          let resolveCompletion: () => void = () => undefined
          const completion = new Promise<void>((resolve) => {
            resolveCompletion = resolve
          })
          queuedRuns.push({
            taskId,
            resultNodeId,
            functionNodeId: nodeId,
            functionId,
            functionDef,
            inputValues: asResolvedInputValues(inputValues),
            runIndex,
            runTotal: runRange.total,
            createdAt: now,
            completion,
            resolveCompletion,
          })
          completionPromises.push(completion)
        }
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

      if (hasPendingDependencies) {
        void resolvePendingDependencyTasks()
        return
      }

      comfyQueue.push(...queuedRuns)
      ensureComfyWorkers()
      await Promise.all(completionPromises)
    },

    runLocalFunctionForResourceNode: async (sourceNodeId, functionId, primitiveInputs = {}) => {
      const state = get()
      const sourceNode = state.project.canvas.nodes.find((node) => node.id === sourceNodeId)
      const functionDef = state.project.functions[functionId]
      if (!sourceNode || !functionDef || !isLocalTransformFunction(functionDef)) return

      const sourceRefs = nodeResourceRefs(sourceNode)
      const inputValues: RuntimeInputValues = {}
      for (const input of functionDef.inputs) {
        if (input.required) {
          const ref = sourceRefs.find((item) => item.type === input.type)
          if (!ref) return
          inputValues[input.key] = ref
        } else if (input.key in primitiveInputs && (input.type === 'text' || input.type === 'number')) {
          inputValues[input.key] = primitiveInputs[input.key] ?? null
        }
      }

      const runCount = 1
      const now = runtime.now()
      const runRange = functionRunRange(state.project, sourceNodeId, runCount)
      const runIndex = runRange.start
      const taskId = runtime.idFactory()
      const resultNodeId = runtime.idFactory()
      const task: ExecutionTask = {
        id: taskId,
        functionNodeId: sourceNodeId,
        functionId,
        runIndex,
        runTotal: runRange.total,
        status: 'queued',
        inputRefs: inputResourceRefs(inputValues),
        inputSnapshot: resourceInputSnapshot(inputValues, state.project.resources),
        inputValuesSnapshot: executionInputSnapshot(functionDef, inputValues, state.project.resources, state.project.assets),
        paramsSnapshot: {
          runCount,
          mode: 'local_transform',
          kind: functionDef.localTransform?.kind,
        },
        workflowTemplateSnapshot: {},
        compiledWorkflowSnapshot: {},
        requestSnapshot: { mode: 'local_transform', kind: functionDef.localTransform?.kind, inputValues },
        seedPatchLog: [],
        outputRefs: {},
        createdAt: now,
        updatedAt: now,
      }
      const resultNode: CanvasNode = {
        id: resultNodeId,
        type: 'result_group',
        position: nextResultNodePosition(state.project.canvas.nodes, sourceNode, functionDef),
        data: {
          sourceFunctionNodeId: sourceNodeId,
          functionId,
          taskId,
          runIndex,
          runTotal: runRange.total,
          title: `${functionDef.name} Run ${runIndex}`,
          endpointId: 'local',
          resources: [],
          status: 'queued',
          seedPatchLog: [],
          createdAt: now,
        },
      }
      const queuedRun: QueuedLocalRun = {
        taskId,
        resultNodeId,
        sourceNodeId,
        functionId,
        functionDef,
        inputValues: asResolvedInputValues(inputValues),
        runIndex,
        runTotal: runRange.total,
      }

      set((current) => ({
        ...selectedState([resultNodeId]),
        project: {
          ...current.project,
          project: { ...current.project.project, updatedAt: now },
          tasks: { ...tasksWithRunTotal(current.project.tasks, sourceNodeId, runRange.total), [taskId]: task },
          canvas: {
            ...current.project.canvas,
            nodes: [...nodesWithRunTotal(current.project.canvas.nodes, sourceNodeId, runRange.total), resultNode],
          },
        },
      }))

      await executeLocalQueueItem(queuedRun)
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
      const inputValues = structuredClone(task.inputRefs ?? {}) as RuntimeInputValues
      const resolvedInputValues = asResolvedInputValues(inputValues)
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
          inputValues: resolvedInputValues,
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
          inputValues: resolvedInputValues,
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
          inputValues: resolvedInputValues,
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
          inputValues: resolvedInputValues,
          config: mergedGeminiImageConfig(functionDef.geminiImage, nodeConfig),
          runIndex: task.runIndex,
          runTotal: task.runTotal,
        })
        return
      }

      if (isRequestFunction(functionDef)) {
        await executeRequestQueueItem({
          taskId,
          resultNodeId,
          functionNodeId: task.functionNodeId,
          functionId: task.functionId,
          functionDef,
          inputValues: resolvedInputValues,
          runIndex: task.runIndex,
          runTotal: task.runTotal,
        })
        return
      }

      if (isLocalTransformFunction(functionDef)) {
        await executeLocalQueueItem({
          taskId,
          resultNodeId,
          sourceNodeId: task.functionNodeId,
          functionId: task.functionId,
          functionDef,
          inputValues: asResolvedInputValues(inputValuesFromTaskSnapshot(task)),
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
        inputValues: resolvedInputValues,
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
      void resolvePendingDependencyTasks()
    },

    undoLastProjectChange: () => {
      set((state) => {
        const currentProject = ensureProjectHistory(state.project)
        const history = currentProject.history ?? emptyProjectHistory()
        const entry = history.undoStack.at(-1)
        if (entry) {
          const nextHistory: ProjectHistoryState = {
            schemaVersion: PROJECT_HISTORY_SCHEMA_VERSION,
            undoStack: history.undoStack.slice(0, -1),
            redoStack: [...history.redoStack, entry].slice(-PROJECT_HISTORY_LIMIT),
          }
          const project = restoreProjectHistorySnapshot(entry.before, nextHistory, runtime.now(), currentProject.assets)
          return {
            project,
            projectLibrary: {
              ...state.projectLibrary,
              [project.project.id]: project,
            },
            undoStack: [],
            ...selectedState([]),
          }
        }

        const previousProject = state.undoStack.at(-1)
        if (!previousProject) return { ...state, project: currentProject }
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

    redoProjectChange: () => {
      set((state) => {
        const currentProject = ensureProjectHistory(state.project)
        const history = currentProject.history ?? emptyProjectHistory()
        const entry = history.redoStack.at(-1)
        if (!entry) return { ...state, project: currentProject }

        const nextHistory: ProjectHistoryState = {
          schemaVersion: PROJECT_HISTORY_SCHEMA_VERSION,
          undoStack: [...history.undoStack, entry].slice(-PROJECT_HISTORY_LIMIT),
          redoStack: history.redoStack.slice(0, -1),
        }
        const project = restoreProjectHistorySnapshot(entry.after, nextHistory, runtime.now(), currentProject.assets)
        return {
          project,
          projectLibrary: {
            ...state.projectLibrary,
            [project.project.id]: project,
          },
          undoStack: [],
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
      const pendingRef = pendingOutputRefForNode(sourceNode, state.project.functions, options?.sourceHandleId)
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
      if (!sourceResource && !pendingRef) return

      const resourceType = pendingRef?.type ?? sourceResource?.type
      if (!resourceType) return
      const inputKey = inputKeyForConnection(functionDef.inputs, resourceType, currentInputValues, options?.targetInputKey)
      if (!inputKey) return
      const inputValue: InputResourceRef = pendingRef ?? { resourceId: sourceResource!.id, type: sourceResource!.type }

      const now = runtime.now()
      const edge: CanvasEdge = {
        id: `edge_${sourceNodeId}_${targetNodeId}_${inputKey}`,
        source: {
          nodeId: sourceNodeId,
          handleId: options?.sourceHandleId ?? (sourceResource ? sourceHandleForResource(sourceNode, sourceResource.id) : `pending:${pendingRef!.outputKey}`),
          resourceId: sourceResource?.id,
          outputKey: pendingRef?.outputKey,
        },
        target: { nodeId: targetNodeId, inputKey },
        type: 'resource_to_input',
      }

      set((current) => {
        const nextProject = {
          ...ensureProjectHistory(current.project),
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
                        [inputKey]: inputValue,
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
        }
        return {
          project: projectWithRecordedHistory(current.project, nextProject, now, {
            label: 'Connect asset',
            transactionType: 'connection',
            nodeIds: [sourceNodeId, targetNodeId],
            assetIds: sourceResource ? [sourceResource.id] : [],
            preview: {
              title: 'Connect asset',
              subtitle: inputKey,
              nodeIds: [sourceNodeId, targetNodeId],
              assetIds: sourceResource ? [sourceResource.id] : [],
            },
          }),
        }
      })
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

        const nextProject = {
          ...ensureProjectHistory(state.project),
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
        }

        return {
          undoStack: [],
          project: projectWithRecordedHistory(state.project, nextProject, now, {
            label: 'Disconnect asset',
            transactionType: 'connection',
            nodeIds: uniqueHistoryIds([
              ...state.project.canvas.edges
                .filter((edge) => explicitEdgeIds.has(edge.id))
                .flatMap((edge) => [edge.source.nodeId, edge.target.nodeId]),
              ...clearedInputsByNode.keys(),
            ]),
            assetIds: uniqueHistoryIds(
              state.project.canvas.edges
                .filter((edge) => explicitEdgeIds.has(edge.id))
                .map((edge) => edge.source.resourceId),
            ),
            preview: {
              title: 'Disconnect asset',
              subtitle: `${explicitEdgeIds.size + clearedInputsByNode.size} bindings`,
            },
          }),
        }
      })
    },

    updateNodePosition: (nodeId, position) => {
      get().updateNodePositions({ [nodeId]: position })
    },

    updateNodePositions: (positionsByNodeId) => {
      const now = runtime.now()
      set((state) => {
        const expandedPositions = { ...positionsByNodeId }
        for (const node of state.project.canvas.nodes) {
          if (node.type !== 'group') continue
          const nextGroupPosition = positionsByNodeId[node.id]
          if (!nextGroupPosition) continue
          const delta = {
            x: nextGroupPosition.x - node.position.x,
            y: nextGroupPosition.y - node.position.y,
          }
          if (delta.x === 0 && delta.y === 0) continue
          for (const childNodeId of groupChildNodeIds(node)) {
            const childNode = state.project.canvas.nodes.find((item) => item.id === childNodeId)
            if (!childNode || positionsByNodeId[childNodeId]) continue
            expandedPositions[childNodeId] = {
              x: childNode.position.x + delta.x,
              y: childNode.position.y + delta.y,
            }
          }
        }

        const hasPositionChange = state.project.canvas.nodes.some((node) => {
          const nextPosition = expandedPositions[node.id]
          return Boolean(nextPosition && (node.position.x !== nextPosition.x || node.position.y !== nextPosition.y))
        })
        if (!hasPositionChange) return state

        const movedNodeIds = Object.keys(expandedPositions).filter((nodeId) =>
          state.project.canvas.nodes.some((node) => {
            const nextPosition = expandedPositions[nodeId]
            return node.id === nodeId && nextPosition && (node.position.x !== nextPosition.x || node.position.y !== nextPosition.y)
          }),
        )
        const nextProject = {
          ...ensureProjectHistory(state.project),
          project: { ...state.project.project, updatedAt: now },
          canvas: {
            ...state.project.canvas,
            nodes: state.project.canvas.nodes.map((node) =>
              expandedPositions[node.id] ? { ...node, position: expandedPositions[node.id] } : node,
            ),
          },
        }

        return {
          project: projectWithRecordedHistory(state.project, nextProject, now, {
            label: movedNodeIds.length > 1 ? 'Move nodes' : 'Move node',
            transactionType: 'canvas',
            nodeIds: movedNodeIds,
            groupIds: movedNodeIds.filter((nodeId) => state.project.canvas.nodes.some((node) => node.id === nodeId && node.type === 'group')),
            preview: {
              title: movedNodeIds.length > 1 ? 'Move nodes' : 'Move node',
              subtitle: `${movedNodeIds.length} nodes`,
              nodeIds: movedNodeIds,
            },
          }),
        }
      })
    },

    updateNodeSize: (nodeId, size) => {
      const width = Math.round(Number(size.width))
      const height = Math.round(Number(size.height))
      if (!Number.isFinite(width) || !Number.isFinite(height)) return

      const now = runtime.now()
      set((state) => {
        const nextSize = {
          width: Math.max(220, width),
          height: Math.max(120, height),
        }
        const targetNode = state.project.canvas.nodes.find((node) => node.id === nodeId)
        const currentSize = targetNode?.data.size as { width?: unknown; height?: unknown } | undefined
        if (
          !targetNode ||
          (Number(currentSize?.width) === nextSize.width && Number(currentSize?.height) === nextSize.height)
        ) {
          return state
        }

        return {
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
                        size: nextSize,
                      },
                    }
                  : node,
              ),
            },
          },
        }
      })
    },

    renameNode: (nodeId, title) => {
      const trimmedTitle = title.trim()
      if (!trimmedTitle) return

      const now = runtime.now()
      set((state) => {
        const node = state.project.canvas.nodes.find((item) => item.id === nodeId)
        if (!node) return state

        const resources = { ...state.project.resources }
        if (node.type === 'asset' || node.type === 'resource') {
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

    deleteNodes: (nodeIds) => {
      const now = runtime.now()
      set((state) => deleteNodesFromState(state, nodeIds, now))
    },

    groupSelectedNodes: () => {
      const state = get()
      const selectedIds = state.selectedNodeIds.length
        ? state.selectedNodeIds
        : state.selectedNodeId
          ? [state.selectedNodeId]
          : []
      const childNodes = selectedIds
        .map((nodeId) => state.project.canvas.nodes.find((node) => node.id === nodeId))
        .filter((node): node is CanvasNode => Boolean(node && node.type !== 'group'))
      if (childNodes.length < 2) return undefined

      const groupId = runtime.idFactory()
      const groupNodeId = `node_${groupId}`
      const now = runtime.now()
      const bounds = groupBoundsForNodes(childNodes, state.project.functions)
      const childNodeIds = childNodes.map((node) => node.id)
      const groupNode: CanvasNode = {
        id: groupNodeId,
        type: 'group',
        position: bounds.position,
        data: {
          title: 'Group',
          childNodeIds,
          collapsed: false,
          color: '#14b8a6',
          size: bounds.size,
        },
      }

      set((current) => {
        const nextProject = {
          ...ensureProjectHistory(current.project),
          project: { ...current.project.project, updatedAt: now },
          canvas: {
            ...current.project.canvas,
            nodes: [...current.project.canvas.nodes, groupNode],
          },
        }
        return {
          ...selectedState([groupNodeId]),
          undoStack: [],
          project: projectWithRecordedHistory(current.project, nextProject, now, {
            label: 'Group selection',
            transactionType: 'group',
            nodeIds: [groupNodeId, ...childNodeIds],
            groupIds: [groupNodeId],
            preview: {
              title: 'Group selection',
              subtitle: `${childNodeIds.length} nodes`,
              nodeIds: [groupNodeId, ...childNodeIds],
              groupIds: [groupNodeId],
            },
          }),
        }
      })

      return groupNodeId
    },

    ungroupNode: (nodeId) => {
      const now = runtime.now()
      set((state) => {
        const groupNode = state.project.canvas.nodes.find((node) => node.id === nodeId && node.type === 'group')
        if (!groupNode) return state

        const childNodeIds = groupChildNodeIds(groupNode)
        const nextProject = {
          ...ensureProjectHistory(state.project),
          project: { ...state.project.project, updatedAt: now },
          canvas: {
            ...state.project.canvas,
            nodes: state.project.canvas.nodes.filter((node) => node.id !== nodeId),
          },
        }

        return {
          ...selectedState(childNodeIds),
          undoStack: [],
          project: projectWithRecordedHistory(state.project, nextProject, now, {
            label: 'Ungroup',
            transactionType: 'group',
            nodeIds: [nodeId, ...childNodeIds],
            groupIds: [nodeId],
            preview: {
              title: 'Ungroup',
              subtitle: String(groupNode.data.title ?? 'Group'),
              nodeIds: [nodeId, ...childNodeIds],
              groupIds: [nodeId],
            },
          }),
        }
      })
    },

    saveTemplateFromSelection: (name) => {
      const state = get()
      const selectedIds = state.selectedNodeIds.length
        ? state.selectedNodeIds
        : state.selectedNodeId
          ? [state.selectedNodeId]
          : []
      const templateNodeIds = selectedTemplateNodeIds(state.project.canvas.nodes, selectedIds)
      if (templateNodeIds.length === 0) return undefined

      const selectedNodeSet = new Set(templateNodeIds)
      const nodes = state.project.canvas.nodes
        .filter((node) => selectedNodeSet.has(node.id))
        .map((node) => structuredClone(node))
      const edges = state.project.canvas.edges
        .filter((edge) => selectedNodeSet.has(edge.source.nodeId) && selectedNodeSet.has(edge.target.nodeId))
        .map((edge) => structuredClone(edge))
      const resourceIds = resourceIdsForNodes(nodes)
      const resources = Object.fromEntries(
        resourceIds
          .map((resourceId) => state.project.resources[resourceId])
          .filter((resource): resource is Resource => Boolean(resource))
          .map((resource) => [resource.id, structuredClone(resource)]),
      )
      const assetIds = uniqueIds(Object.values(resources).map(mediaAssetId).filter((assetId): assetId is string => Boolean(assetId)))
      const assets = Object.fromEntries(
        assetIds
          .map((assetId) => state.project.assets[assetId])
          .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
          .map((asset) => [asset.id, structuredClone(asset)]),
      )
      const templateId = runtime.idFactory()
      const now = runtime.now()
      const template: CanvasTemplate = {
        id: templateId,
        name: name?.trim() || 'Template',
        createdAt: now,
        updatedAt: now,
        nodes,
        edges,
        resources,
        assets,
        inputResourceIds: resourceIds,
        outputResourceIds: resourceIds,
      }

      set((current) => {
        const nextProject = {
          ...ensureProjectHistory(current.project),
          project: { ...current.project.project, updatedAt: now },
          templates: {
            ...(current.project.templates ?? {}),
            [templateId]: template,
          },
        }
        return {
          project: projectWithRecordedHistory(current.project, nextProject, now, {
            label: 'Save template',
            transactionType: 'template',
            nodeIds: templateNodeIds,
            assetIds: resourceIds,
            templateIds: [templateId],
            preview: {
              title: 'Save template',
              subtitle: template.name,
              nodeIds: templateNodeIds,
              assetIds: resourceIds,
              templateIds: [templateId],
            },
          }),
        }
      })

      return templateId
    },

    instantiateTemplate: (templateId, position) => {
      const state = get()
      const template = state.project.templates?.[templateId]
      if (!template || template.nodes.length === 0) return undefined

      const now = runtime.now()
      const minX = Math.min(...template.nodes.map((node) => node.position.x))
      const minY = Math.min(...template.nodes.map((node) => node.position.y))
      const targetPosition = position ?? { x: minX + 48, y: minY + 48 }
      const offset = { x: targetPosition.x - minX, y: targetPosition.y - minY }
      const nodeIdMap = new Map<string, string>()
      const resourceIdMap = new Map<string, string>()
      const clonedResources: Record<string, Resource> = {}
      const clonedAssets: Record<string, NonNullable<CanvasTemplate['assets'][string]>> = {}

      for (const resource of Object.values(template.resources)) {
        const nextResourceId = runtime.idFactory()
        resourceIdMap.set(resource.id, nextResourceId)
        const clonedValue = cloneResourceValueAndAssets(resource, template.assets, nextResourceId, now, runtime.idFactory)
        Object.assign(clonedAssets, clonedValue.assets)
        clonedResources[nextResourceId] = {
          ...structuredClone(resource),
          id: nextResourceId,
          name: `${resource.name ?? 'Resource'} Copy`,
          value: clonedValue.value,
          source: {
            kind: 'duplicated',
            parentResourceId: resource.id,
          },
          metadata: {
            ...resource.metadata,
            createdAt: now,
          },
        }
      }

      const clonedNodes = template.nodes.map((node) => {
        const clonedNode = structuredClone(node)
        let nextNodeId: string
        const nodeResourceId = canvasNodeResourceId(node)
        if (nodeResourceId) {
          const nextResourceId = resourceIdMap.get(nodeResourceId)
          nextNodeId = nextResourceId ? `node_${nextResourceId}` : `node_${runtime.idFactory()}`
          clonedNode.data = {
            ...clonedNode.data,
            resourceId: nextResourceId ?? clonedNode.data.resourceId,
          }
        } else {
          nextNodeId = `node_${runtime.idFactory()}`
        }
        nodeIdMap.set(node.id, nextNodeId)
        clonedNode.id = nextNodeId
        clonedNode.position = {
          x: node.position.x + offset.x,
          y: node.position.y + offset.y,
        }
        return clonedNode
      })

      const clonedEdges: CanvasEdge[] = template.edges
        .flatMap((edge): CanvasEdge[] => {
          const sourceNodeId = nodeIdMap.get(edge.source.nodeId)
          const targetNodeId = nodeIdMap.get(edge.target.nodeId)
          if (!sourceNodeId || !targetNodeId) return []
          const sourceResourceId = edge.source.resourceId ? resourceIdMap.get(edge.source.resourceId) : undefined
          const sourceHandleId = sourceResourceId
            ? edge.source.handleId.replace(edge.source.resourceId ?? '', sourceResourceId)
            : edge.source.handleId
          return [{
            ...structuredClone(edge),
            id: `edge_${sourceNodeId}_${targetNodeId}_${edge.target.inputKey}`,
            source: {
              ...edge.source,
              nodeId: sourceNodeId,
              handleId: sourceHandleId,
              ...(sourceResourceId ? { resourceId: sourceResourceId } : {}),
            },
            target: {
              ...edge.target,
              nodeId: targetNodeId,
            },
          }]
        })

      const groupId = runtime.idFactory()
      const groupNodeId = `node_${groupId}`
      const bounds = groupBoundsForNodes(clonedNodes, state.project.functions)
      const childNodeIds = clonedNodes.map((node) => node.id)
      const groupNode: CanvasNode = {
        id: groupNodeId,
        type: 'group',
        position: bounds.position,
        data: {
          title: template.name,
          childNodeIds,
          collapsed: false,
          color: '#14b8a6',
          size: bounds.size,
        },
      }

      set((current) => {
        const nextProject = {
          ...ensureProjectHistory(current.project),
          project: { ...current.project.project, updatedAt: now },
          assets: { ...current.project.assets, ...clonedAssets },
          resources: { ...current.project.resources, ...clonedResources },
          canvas: {
            ...current.project.canvas,
            nodes: [...current.project.canvas.nodes, ...clonedNodes, groupNode],
            edges: [...current.project.canvas.edges, ...clonedEdges],
          },
        }
        return {
          ...selectedState([groupNodeId]),
          project: projectWithRecordedHistory(current.project, nextProject, now, {
            label: 'Create template instance',
            transactionType: 'template',
            nodeIds: [groupNodeId, ...childNodeIds],
            assetIds: Object.keys(clonedResources),
            groupIds: [groupNodeId],
            templateIds: [templateId],
            preview: {
              title: 'Create template instance',
              subtitle: template.name,
              nodeIds: [groupNodeId, ...childNodeIds],
              assetIds: Object.keys(clonedResources),
              groupIds: [groupNodeId],
              templateIds: [templateId],
            },
          }),
        }
      })

      return groupNodeId
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
        const clonedValue = cloneResourceValueAndAssets(
          originalResource,
          get().project.assets,
          resourceId,
          now,
          runtime.idFactory,
        )
        const nodeId = `node_${resourceId}`
        const resource: Resource = {
          ...structuredClone(originalResource),
          id: resourceId,
          name: `${originalResource.name ?? 'Resource'} Copy`,
          value: clonedValue.value,
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
            assets: { ...state.project.assets, ...clonedValue.assets },
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
        const newAssets: Record<string, AssetRecord> = {}
        const selectedIds: string[] = []

        for (const nodeId of ids) {
          const node = nodesById.get(nodeId)
          if (!node) continue

          const originalResourceId = canvasNodeResourceId(node)
          if (originalResourceId) {
            const originalResource = state.project.resources[originalResourceId]
            if (!originalResource) continue

            const resourceId = runtime.idFactory()
            const clonedValue = cloneResourceValueAndAssets(
              originalResource,
              state.project.assets,
              resourceId,
              now,
              runtime.idFactory,
            )
            const duplicatedNodeId = `node_${resourceId}`
            const resource: Resource = {
              ...structuredClone(originalResource),
              id: resourceId,
              name: `${originalResource.name ?? 'Resource'} Copy`,
              value: clonedValue.value,
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
            Object.assign(newAssets, clonedValue.assets)
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
            assets: { ...state.project.assets, ...newAssets },
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
        capabilities: { supportedFunctions: comfyWorkflowFunctionIds(get().project.functions) },
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
      ensureComfyWorkers()
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
      ensureComfyWorkers()
    },

    markEndpoint: (endpointId, status, message) => {
      const now = runtime.now()
      set((state) => ({
        project: {
          ...state.project,
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

const loadProjectLibrary = (payload: ProjectLibraryPackage | undefined, now: string) => {
  const restored = restoreProjectLibrarySnapshot(payload, (project) => withBuiltInFunctions(project, now))
  if (!restored) return false

  projectStore.setState({
    project: restored.activeProject,
    projectLibrary: restored.projects,
    ...selectedState([]),
  })
  return true
}

const loadIndexedDbProjectLibrary = () =>
  getIdb<ProjectLibraryPackage>(PROJECT_LIBRARY_STORAGE_KEY)
    .then(async (savedLibrary) => {
      const now = new Date().toISOString()
      if (loadProjectLibrary(savedLibrary, now)) return true

      const savedProject = await getIdb<ProjectState>(PROJECT_STORAGE_KEY)
      if (!savedProject) return false
      const project = withBuiltInFunctions(savedProject, now)
      projectStore.setState({
        project,
        projectLibrary: { [project.project.id]: project },
        ...selectedState([]),
      })
      return true
    })
    .catch(() => false)

const startIndexedDbProjectPersistence = () => {
  const startupRevisionKey = createProjectLibraryRevisionKey(projectStore.getState())
  const controller = createIdleProjectPersistenceController<ProjectLibraryPackage>({
    idleMs: PROJECT_PERSIST_IDLE_MS,
    getRevisionKey: () => createProjectLibraryRevisionKey(projectStore.getState()),
    createSnapshot: () => createProjectLibrarySnapshot(projectStore.getState()),
    saveSnapshot: async (nextLibrary) => {
    try {
        const activeProject = nextLibrary.projects[nextLibrary.currentProjectId]
        await Promise.all([
          setIdb(PROJECT_STORAGE_KEY, activeProject ?? createPersistentProjectSnapshot(projectStore.getState().project)),
          setIdb(PROJECT_LIBRARY_STORAGE_KEY, nextLibrary),
        ])
      return true
    } catch {
      return false
    }
    },
  })

  void loadIndexedDbProjectLibrary().then((restoredProject) => {
    controller.markLoaded(restoredProject ? undefined : startupRevisionKey)
    controller.schedule()
  })

  projectStore.subscribe(() => controller.schedule())

  window.addEventListener('beforeunload', () => {
    controller.flush()
  })
}

const startDesktopProjectPersistence = (storage: DesktopProjectStorage) => {
  const startupRevisionKey = createProjectLibraryRevisionKey(projectStore.getState())
  const controller = createIdleProjectPersistenceController<ProjectLibraryPackage>({
    idleMs: PROJECT_PERSIST_IDLE_MS,
    getRevisionKey: () => createProjectLibraryRevisionKey(projectStore.getState()),
    createSnapshot: () => createProjectLibrarySnapshot(projectStore.getState()),
    saveSnapshot: async (nextLibrary) => {
    try {
      const result = await storage.saveProjectLibrary(nextLibrary)
      if (!result?.ok) return false
      return true
    } catch {
      return false
    }
    },
  })

  void storage
    .loadProjectLibrary()
    .then((savedLibrary) => {
      const now = new Date().toISOString()
      const restoredProject = loadProjectLibrary(savedLibrary, now)
      controller.markLoaded(restoredProject ? undefined : startupRevisionKey)
      controller.schedule()
    })
    .catch(() => {
      controller.markLoaded(startupRevisionKey)
      controller.schedule()
    })

  projectStore.subscribe(() => controller.schedule())

  window.addEventListener('beforeunload', () => {
    controller.flush()
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
