import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { get as getIdb, set as setIdb } from 'idb-keyval'
import { ComfyClient, type ComfyUploadImageOptions, type ComfyUploadImageResult } from '../domain/comfyClient'
import { comfyProxyUrl, normalizedComfyBaseUrl, prepareComfyProxySession } from '../domain/comfyProxy'
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
import { createConfigPackage, createProjectPackage, type ConfigPackage, type FullProjectPackage } from '../domain/projectPackage'
import { blobToDataUrl } from '../domain/projectAssets'
import { randomizeWorkflowSeeds } from '../domain/seed'
import { selectEndpoint } from '../domain/scheduler'
import { createGenerationFunctionFromWorkflow, injectWorkflowInputs, workflowPrimitiveInputValue } from '../domain/workflow'
import { isBuiltInFunction, withoutBuiltInProjectFunctions } from '../domain/builtInFunctions'
import { normalizeTextDisplayMode } from '../domain/textDisplay'
import type { MediaResourcePayload, MediaResourceKind } from '../domain/resourceFiles'
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
  TextDisplayMode,
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
type RunFunctionAtPositionOptions = {
  replace?: {
    resourceId: string
    outputKey?: string
  }
}
type NodeSelectionMode = 'replace' | 'add' | 'remove' | 'toggle'
type FunctionEditScope = 'node' | 'all'

type RuntimeComfyClient = ComfyPromptClient & {
  testConnection?: () => Promise<unknown>
  interrupt?: () => Promise<unknown>
  uploadImage?: (file: File, options?: ComfyUploadImageOptions) => Promise<ComfyUploadImageResult>
  viewFile?: (params: ComfyFileRef) => Promise<Blob>
}

type QueuedComfyResultRun = {
  kind?: 'result'
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

type QueuedComfyCommandRun = {
  kind: 'command'
  taskId: string
  functionNodeId: string
  functionId: string
  requiredEndpointId?: string
  functionDef: GenerationFunction
  inputValues: ResolvedRuntimeInputValues
  outputRefs: Record<string, ResourceRef[]>
  position: { x: number; y: number }
  runIndex: number
  runTotal: number
  createdAt: string
  completion: Promise<void>
  resolveCompletion: () => void
}

type QueuedComfyRun = QueuedComfyResultRun | QueuedComfyCommandRun

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
export type ProjectLibraryPackage = {
  currentProjectId: string
  projects: Record<string, ProjectState>
}

type DesktopProjectStorage = {
  loadProjectLibrary: () => Promise<ProjectLibraryPackage | undefined>
  saveProjectLibrary: (payload: ProjectLibraryPackage) => Promise<{ ok: boolean; rootPath?: string; error?: string }>
  authorizeComfyProxyTarget?: (baseUrl: string) => Promise<{ ok: boolean }>
}

declare global {
  interface Window {
    infinityComfyUIStorage?: DesktopProjectStorage
  }
}

export type ProjectStoreState = {
  project: ProjectState
  projectLibrary: Record<string, ProjectState>
  projectPersistenceReady: boolean
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
    initialValue?: PrimitiveInputValue,
  ) => string | undefined
  addMediaResourceAtPosition: (
    type: MediaResourceKind,
    name: string,
    media: MediaResourcePayload,
    position: { x: number; y: number },
  ) => string
  updateTextResourceValue: (resourceId: string, value: string) => void
  updateTextResourceDisplayMode: (resourceId: string, displayMode: TextDisplayMode) => void
  updateNumberResourceValue: (resourceId: string, value: number) => void
  updateBooleanResourceValue: (resourceId: string, value: boolean) => void
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
    options?: RunFunctionAtPositionOptions,
  ) => Promise<string | undefined>
  runTemporaryFunctionAtPosition: (
    functionDef: GenerationFunction,
    inputValues: Record<string, PrimitiveInputValue | ResourceRef>,
    position: { x: number; y: number },
    runCount?: number,
    options?: RunFunctionAtPositionOptions,
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
  groupSelectedNodes: (options?: GroupSelectedNodesOptions) => string | undefined
  ungroupNode: (nodeId: string) => void
  saveTemplateFromSelection: (name?: string) => string | undefined
  instantiateTemplate: (templateId: string, position?: { x: number; y: number }) => string | undefined
  duplicateSelectedNode: () => void
  duplicateNodes: (nodeIds: string[]) => void
  selectNode: (nodeId?: string, mode?: NodeSelectionMode) => void
  selectNodes: (nodeIds: string[], mode?: NodeSelectionMode) => void
  addEndpoint: (patch?: Omit<Partial<ComfyEndpointConfig>, 'id' | 'health'>) => string
  updateEndpoint: (endpointId: string, patch: Partial<ComfyEndpointConfig>) => void
  deleteEndpoint: (endpointId: string) => void
  markEndpoint: (endpointId: string, status: NonNullable<ComfyEndpointConfig['health']>['status'], message?: string) => void
  exportProject: () => FullProjectPackage
  exportConfig: () => ConfigPackage
  importProject: (payload: ImportableProject) => void
  importConfig: (payload: ImportableConfig) => void
}

type BrowserComfyProxyEndpointGeneration = {
  endpointId: string
  targetBase: string
  auth: ComfyEndpointConfig['auth']
  generation: number
}

const browserComfyProxyEndpointGenerations = new Map<string, BrowserComfyProxyEndpointGeneration>()
const browserComfyProxyGenerationCounters = new Map<string, number>()
const browserComfyProxyActiveSessions = new Map<string, BrowserComfyProxyEndpointGeneration>()
const browserComfyProxyLocks = new Map<string, Promise<void>>()

const registerBrowserComfyProxyEndpoint = (endpoint: ComfyEndpointConfig) => {
  const targetBase = normalizedComfyBaseUrl(endpoint.baseUrl)
  const current = browserComfyProxyEndpointGenerations.get(endpoint.id)
  if (current && current.targetBase === targetBase && current.auth === endpoint.auth) return current

  const generation = (browserComfyProxyGenerationCounters.get(endpoint.id) ?? 0) + 1
  browserComfyProxyGenerationCounters.set(endpoint.id, generation)
  const next: BrowserComfyProxyEndpointGeneration = {
    endpointId: endpoint.id,
    targetBase,
    auth: endpoint.auth,
    generation,
  }
  browserComfyProxyEndpointGenerations.set(endpoint.id, next)
  return next
}

const invalidateBrowserComfyProxyEndpoint = (endpointId: string) => {
  browserComfyProxyGenerationCounters.set(endpointId, (browserComfyProxyGenerationCounters.get(endpointId) ?? 0) + 1)
  browserComfyProxyEndpointGenerations.delete(endpointId)
}

const assertCurrentBrowserComfyProxyEndpoint = (endpoint: BrowserComfyProxyEndpointGeneration) => {
  if (browserComfyProxyEndpointGenerations.get(endpoint.endpointId) !== endpoint) {
    throw new Error('ComfyUI endpoint configuration changed; retry with the current server settings')
  }
}

const withBrowserComfyProxyLock = <T>(targetBase: string, action: () => Promise<T>) => {
  const previous = browserComfyProxyLocks.get(targetBase) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(action)
  const tail = run.then(
    () => undefined,
    () => undefined,
  )
  browserComfyProxyLocks.set(targetBase, tail)
  return run.finally(() => {
    if (browserComfyProxyLocks.get(targetBase) === tail) browserComfyProxyLocks.delete(targetBase)
  })
}

const ensureBrowserComfyProxySession = async (
  endpoint: BrowserComfyProxyEndpointGeneration,
  credentials: { bearerToken?: string; password?: string },
  force = false,
) => {
  assertCurrentBrowserComfyProxyEndpoint(endpoint)
  if (!force && browserComfyProxyActiveSessions.get(endpoint.targetBase) === endpoint) return

  browserComfyProxyActiveSessions.delete(endpoint.targetBase)
  await prepareComfyProxySession(endpoint.targetBase, credentials)
  assertCurrentBrowserComfyProxyEndpoint(endpoint)
  browserComfyProxyActiveSessions.set(endpoint.targetBase, endpoint)
}

const defaultDeps: ProjectStoreDeps = {
  idFactory: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
  randomInt: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
  createComfyClient: (endpoint) => {
    const browserProxyAvailable = typeof window !== 'undefined' && window.location.origin !== 'null'
    const bearerToken =
      endpoint.auth?.type === 'token' || endpoint.auth?.type === 'password' ? endpoint.auth.token : undefined
    const password = endpoint.auth?.type === 'password' ? endpoint.auth.password : undefined
    const credentials = { bearerToken, password }
    const endpointGeneration = browserProxyAvailable ? registerBrowserComfyProxyEndpoint(endpoint) : undefined
    return new ComfyClient({
      baseUrl: browserProxyAvailable
        ? new URL(comfyProxyUrl(endpoint.baseUrl), window.location.origin).toString()
        : endpoint.baseUrl,
      clientId: crypto.randomUUID(),
      token: browserProxyAvailable ? undefined : bearerToken,
      headers: endpoint.customHeaders,
      fetchImpl: browserProxyAvailable
        ? async (input, init) => {
            if (!endpointGeneration) throw new Error('ComfyUI browser proxy session is unavailable')
            return withBrowserComfyProxyLock(endpointGeneration.targetBase, async () => {
              assertCurrentBrowserComfyProxyEndpoint(endpointGeneration)
              await ensureBrowserComfyProxySession(endpointGeneration, credentials)
              const retryInput = input instanceof Request ? input.clone() : input
              const response = await fetch(input, init)
              if (response.status !== 401) return response

              await ensureBrowserComfyProxySession(endpointGeneration, credentials, true)
              const retryResponse = await fetch(retryInput, init)
              if (
                retryResponse.status === 401 &&
                browserComfyProxyActiveSessions.get(endpointGeneration.targetBase) === endpointGeneration
              ) {
                browserComfyProxyActiveSessions.delete(endpointGeneration.targetBase)
              }
              return retryResponse
            })
          }
        : undefined,
    })
  },
  comfyRunOptions: {
    pollIntervalMs: 1000,
  },
}

const PROJECT_HISTORY_SCHEMA_VERSION = '1.0.0'
const PROJECT_HISTORY_LIMIT = 100
const PROJECT_PERSIST_IDLE_MS = 5000

type CanvasNodeMeasuredSize = { width: number; height: number }
type GroupSelectedNodesOptions = {
  nodeIds?: string[]
  nodeSizesById?: Record<string, CanvasNodeMeasuredSize | undefined>
}

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

const isMediaResourceValue = (value: Resource['value']): value is MediaResourceValue =>
  typeof value === 'object' && value !== null && 'assetId' in value

const compactHistoryAssetRecord = (asset: AssetRecord): AssetRecord => {
  const metadata = { ...asset }
  delete metadata.blobUrl
  return metadata
}

const compactHistoryResource = (resource: Resource): Resource => {
  if (!isMediaResourceValue(resource.value)) return resource
  const valueWithoutThumbnail = { ...resource.value }
  delete valueWithoutThumbnail.thumbnailUrl
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

const nodeResourceIds = (project: ProjectState, nodeIds: string[]) => {
  const ids = new Set<string>()
  const nodesById = new Map(project.canvas.nodes.map((node) => [node.id, node]))

  const visit = (nodeId: string) => {
    const node = nodesById.get(nodeId)
    if (!node) return

    if (node.type === 'resource' && typeof node.data.resourceId === 'string') {
      ids.add(node.data.resourceId)
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
  if (type === 'number') return 0
  if (type === 'text') return ''
  if (type === 'boolean') return false
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

const withRuntimeHistory = (project: ProjectState): ProjectState => ({
  ...project,
  resources: Object.fromEntries(
    Object.entries(project.resources).map(([resourceId, resource]) => [
      resourceId,
      resource.type === 'text'
        ? { ...resource, displayMode: normalizeTextDisplayMode(resource.displayMode) }
        : resource,
    ]),
  ),
  history: emptyProjectHistory(),
})

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
  if (type === 'boolean') return 'Boolean'
  if (type === 'image') return 'Image'
  if (type === 'video') return 'Video'
  if (type === 'audio') return 'Audio'
  return 'Number'
}

const promptDefaultValue = (functionDef: GenerationFunction) => {
  const value = functionDef.inputs.find((input) => input.key === 'prompt')?.defaultValue
  return typeof value === 'string' || typeof value === 'number' || value === null ? value : undefined
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
  value: PrimitiveInputValue | InputResourceRef | undefined,
  resources: Record<string, Resource>,
) => {
  if (isResourceRef(value)) return resources[value.resourceId]?.type === input.type
  if (isPendingResourceRef(value)) return value.type === input.type
  if (value === undefined || value === null) return false
  if (input.type === 'text') return String(value).trim().length > 0
  if (input.type === 'number') return Number.isFinite(Number(value))
  if (input.type === 'boolean') return typeof value === 'boolean'
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
const NODE_PLACEMENT_GAP = 40
const NODE_PLACEMENT_STEP_X = 280
const NODE_PLACEMENT_STEP_Y = 220
const NEW_NODE_HIGHLIGHT = 'new-node'
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

const nodeRect = (position: { x: number; y: number }, size: { width: number; height: number }) => ({
  left: position.x,
  top: position.y,
  right: position.x + size.width,
  bottom: position.y + size.height,
})

const rectsOverlap = (
  left: ReturnType<typeof nodeRect>,
  right: ReturnType<typeof nodeRect>,
  gap = NODE_PLACEMENT_GAP,
) =>
  left.left < right.right + gap &&
  left.right + gap > right.left &&
  left.top < right.bottom + gap &&
  left.bottom + gap > right.top

const nonOverlappingNodePosition = (
  existingNodes: CanvasNode[],
  functions: Record<string, GenerationFunction>,
  requested: { x: number; y: number },
  size: { width: number; height: number },
) => {
  const existingRects = existingNodes.map((node) => nodeRect(node.position, canvasNodeEstimatedSize(node, functions)))

  for (let row = 0; row < 24; row += 1) {
    for (let column = 0; column < 24; column += 1) {
      const candidate = {
        x: requested.x + column * NODE_PLACEMENT_STEP_X,
        y: requested.y + row * NODE_PLACEMENT_STEP_Y,
      }
      const candidateRect = nodeRect(candidate, size)
      if (!existingRects.some((rect) => rectsOverlap(candidateRect, rect))) return candidate
    }
  }

  return {
    x: requested.x + existingNodes.length * NODE_PLACEMENT_STEP_X,
    y: requested.y,
  }
}

const markNewCanvasNode = (node: CanvasNode, now: string): CanvasNode => ({
  ...node,
  data: {
    ...node.data,
    highlight: NEW_NODE_HIGHLIGHT,
    highlightedAt: now,
  },
})

const measuredNodeSize = (size: CanvasNodeMeasuredSize | undefined) => {
  const width = Number(size?.width)
  const height = Number(size?.height)
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : undefined
}

const groupBoundsForNodes = (
  nodes: CanvasNode[],
  functions: Record<string, GenerationFunction>,
  nodeSizesById?: Record<string, CanvasNodeMeasuredSize | undefined>,
) => {
  const padding = 48
  const boxes = nodes.map((node) => {
    const size = measuredNodeSize(nodeSizesById?.[node.id]) ?? canvasNodeEstimatedSize(node, functions)
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
  typeof resource.value === 'object' && resource.value !== null && 'assetId' in resource.value
    ? String((resource.value as { assetId: unknown }).assetId)
    : undefined

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
      if (node.type === 'resource' && typeof node.data.resourceId === 'string') return [node.data.resourceId]
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

const resourceIdsForTask = (task: ExecutionTask) =>
  uniqueIds([
    ...Object.values(task.inputRefs ?? {}).flatMap((ref) => (isResourceRef(ref) ? [ref.resourceId] : [])),
    ...Object.values(task.outputRefs ?? {})
      .flat()
      .flatMap((ref) => (isResourceRef(ref) ? [ref.resourceId] : [])),
    ...Object.values(task.inputValuesSnapshot ?? {}).flatMap((snapshot) =>
      typeof snapshot.resourceId === 'string' ? [snapshot.resourceId] : [],
    ),
  ])

const functionSnapshotForTemplateTask = (
  project: ProjectState,
  task: ExecutionTask,
  resources: Record<string, Resource>,
): GenerationFunction | undefined =>
  project.functions[task.functionId] ??
  task.functionSnapshot ??
  Object.values(resources).find((resource) => resource.metadata?.workflowFunctionId === task.functionId)?.metadata?.functionSnapshot

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

const resourceTypeFromMimeType = (mimeType: string, fallback: ResourceType): ResourceType => {
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (normalized.startsWith('image/')) return 'image'
  if (normalized.startsWith('video/')) return 'video'
  if (normalized.startsWith('audio/')) return 'audio'
  return fallback
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
  const media =
    typeof resource.value === 'object' && resource.value !== null && 'assetId' in resource.value
      ? resource.value
      : undefined
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
  const temporaryFunctionDrafts = new Map<string, GenerationFunction>()

  return createStore<ProjectStoreState>((set, get) => {
    const functionDefinitionById = (functionId: string) =>
      get().project.functions[functionId] ?? temporaryFunctionDrafts.get(functionId)
    const functionDefinitionForTask = (task: ExecutionTask) =>
      task.functionSnapshot ?? functionDefinitionById(task.functionId)

    const isTemporaryFunctionDefinition = (functionDef: GenerationFunction) =>
      !get().project.functions[functionDef.id] && temporaryFunctionDrafts.has(functionDef.id)

    const isTemporaryComfyFunctionDefinition = (functionDef: GenerationFunction) =>
      isTemporaryFunctionDefinition(functionDef) && functionDef.workflow.format === 'comfyui_api_json'

    const temporaryComfyEndpointId = (functionDef: GenerationFunction) =>
      isTemporaryComfyFunctionDefinition(functionDef)
        ? functionDef.workflow.editor?.endpointId
        : undefined

    const endpointCanRunFunctionDefinition = (endpoint: ComfyEndpointConfig, functionDef: GenerationFunction) => {
      if (isTemporaryComfyFunctionDefinition(functionDef)) {
        const requiredEndpointId = temporaryComfyEndpointId(functionDef)
        return Boolean(requiredEndpointId) && endpoint.id === requiredEndpointId
      }
      return endpointSupportsFunction(endpoint, functionDef.id)
    }

    const endpointUnavailableMessageForFunction = (functionDef: GenerationFunction) => {
      const requiredEndpointId = temporaryComfyEndpointId(functionDef)
      if (isTemporaryComfyFunctionDefinition(functionDef) && !requiredEndpointId) {
        return 'Temporary ComfyUI workflow has no selected endpoint. Choose a ComfyUI server and retry.'
      }
      if (!requiredEndpointId) {
        return 'No eligible ComfyUI endpoint'
      }

      const selectedEndpoint = get().project.comfy.endpoints.find((endpoint) => endpoint.id === requiredEndpointId)
      if (!selectedEndpoint) {
        return `Selected ComfyUI endpoint "${requiredEndpointId}" was not found. Choose an available server and retry.`
      }
      if (!selectedEndpoint.enabled) {
        return `Selected ComfyUI endpoint "${requiredEndpointId}" is disabled. Enable it in ComfyUI Servers and retry.`
      }
      return `Selected ComfyUI endpoint "${requiredEndpointId}" is unavailable. Check the server status and retry.`
    }

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

    const outputResourceNodesForRefs = (
      refs: ResourceRef[],
      resources: Record<string, Resource>,
      resultNodeId: string,
      nodes: CanvasNode[],
    ) => {
      const resultNode = nodes.find((node) => node.id === resultNodeId)
      const existingResourceNodeIds = new Set(
        nodes
          .filter((node) => node.type === 'resource' && typeof node.data.resourceId === 'string')
          .map((node) => String(node.data.resourceId)),
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

    const failComfyCommandRunInPlace = (
      item: QueuedComfyCommandRun,
      code: string,
      message: string,
      raw?: unknown,
    ) => {
      const failedAt = runtime.now()
      set((current) => {
        const task = current.project.tasks[item.taskId]
        if (!task) return current
        return {
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: failedAt },
            tasks: {
              ...current.project.tasks,
              [item.taskId]: {
                ...task,
                status: 'failed',
                endpointId: item.requiredEndpointId ? undefined : task.endpointId,
                error: { code, message, raw },
                updatedAt: failedAt,
                completedAt: failedAt,
              },
            },
            canvas: {
              ...current.project.canvas,
              nodes: current.project.canvas.nodes.map((node) =>
                node.data.taskId === item.taskId
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        status: 'failed',
                        endpointId: item.requiredEndpointId ? undefined : node.data.endpointId,
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

    const endpointCanRunQueuedComfyItem = (endpoint: ComfyEndpointConfig, item: QueuedComfyRun) => {
      if (item.kind === 'command' && item.requiredEndpointId && endpoint.id !== item.requiredEndpointId) return false
      return endpointCanRunFunctionDefinition(endpoint, item.functionDef)
    }

    const takeNextQueuedRun = (endpoint: ComfyEndpointConfig) => {
      const index = comfyQueue.findIndex((item) => endpointCanRunQueuedComfyItem(endpoint, item))
      if (index < 0) return undefined
      return comfyQueue.splice(index, 1)[0]
    }

    const executeComfyCommandQueueItem = async (item: QueuedComfyCommandRun, endpoint: ComfyEndpointConfig) => {
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
              node.data.taskId === item.taskId
                ? { ...node, data: { ...node.data, endpointId: endpoint.id, status: 'running', startedAt } }
                : node,
            ),
          },
        },
      }))

      try {
        if (taskWasCanceled(item.taskId)) return
        const client = runtime.createComfyClient(endpoint)
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
          asResolvedInputValues(preparedInputValues),
          get().project.resources,
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
              [item.taskId]: {
                ...current.project.tasks[item.taskId]!,
                compiledWorkflowSnapshot: randomized.workflow,
                requestSnapshot: randomized.workflow,
                seedPatchLog: randomized.patchLog,
                updatedAt: runtime.now(),
              },
            },
          },
        }))

        if (taskWasCanceled(item.taskId)) return
        const result = await runComfyPrompt(client, randomized.workflow, runtime.comfyRunOptions)
        if (taskWasCanceled(item.taskId)) return
        const outputs = extractComfyOutputs(result.history, randomized.workflow, item.functionDef.outputs)
        const completedAt = runtime.now()
        const nextResources: Record<string, Resource> = {}
        const nextAssets: ProjectState['assets'] = {}
        const nextOutputRefs: Record<string, ResourceRef[]> = {}
        const extraNodes: CanvasNode[] = []

        for (const [outputIndex, output] of outputs.entries()) {
          const refs = item.outputRefs[output.key] ? [...item.outputRefs[output.key]] : []
          let valueIndex = 0

          for (const file of output.files) {
            let ref = refs[valueIndex]
            if (!ref) {
              const resourceId = runtime.idFactory()
              ref = { resourceId, type: output.type }
              refs.push(ref)
              extraNodes.push(
                markNewCanvasNode(
                  {
                    id: resourceNodeId(resourceId),
                    type: 'resource',
                    position: nonOverlappingNodePosition(
                      [...get().project.canvas.nodes, ...extraNodes],
                      get().project.functions,
                      commandOutputPosition(item.position, item.runIndex - 1, outputIndex + valueIndex),
                      { width: 230, height: 180 },
                    ),
                    data: {
                      resourceId,
                      resourceType: output.type,
                      functionId: item.functionId,
                      taskId: item.taskId,
                      outputKey: output.key,
                      endpointId: endpoint.id,
                      status: 'succeeded',
                      completedAt,
                    },
                  },
                  completedAt,
                ),
              )
            }

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
              source: { kind: 'function_output', functionNodeId: item.taskId, taskId: item.taskId, outputKey: output.key },
              metadata: {
                workflowFunctionId: item.functionId,
                functionSnapshot: structuredClone(item.functionDef),
                endpointId: endpoint.id,
                createdAt: completedAt,
              },
            }
            valueIndex += 1
          }

          for (const text of output.texts ?? []) {
            let ref = refs[valueIndex]
            if (!ref) {
              const resourceId = runtime.idFactory()
              ref = { resourceId, type: 'text' }
              refs.push(ref)
              extraNodes.push(
                markNewCanvasNode(
                  {
                    id: resourceNodeId(resourceId),
                    type: 'resource',
                    position: nonOverlappingNodePosition(
                      [...get().project.canvas.nodes, ...extraNodes],
                      get().project.functions,
                      commandOutputPosition(item.position, item.runIndex - 1, outputIndex + valueIndex),
                      { width: 230, height: 180 },
                    ),
                    data: {
                      resourceId,
                      resourceType: 'text',
                      functionId: item.functionId,
                      taskId: item.taskId,
                      outputKey: output.key,
                      endpointId: endpoint.id,
                      status: 'succeeded',
                      completedAt,
                    },
                  },
                  completedAt,
                ),
              )
            }

            nextResources[ref.resourceId] = {
              id: ref.resourceId,
              type: 'text',
              name: output.key,
              value: text,
              source: { kind: 'function_output', functionNodeId: item.taskId, taskId: item.taskId, outputKey: output.key },
              metadata: {
                workflowFunctionId: item.functionId,
                functionSnapshot: structuredClone(item.functionDef),
                endpointId: endpoint.id,
                createdAt: completedAt,
              },
            }
            valueIndex += 1
          }

          nextOutputRefs[output.key] = refs
        }

        const completedResourceIds = new Set(Object.keys(nextResources))
        set((current) => ({
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: completedAt },
            resources: { ...current.project.resources, ...nextResources },
            assets: { ...current.project.assets, ...nextAssets },
            tasks: {
              ...current.project.tasks,
              [item.taskId]: {
                ...current.project.tasks[item.taskId]!,
                status: 'succeeded',
                comfyPromptId: result.promptId,
                outputRefs: nextOutputRefs,
                updatedAt: completedAt,
                completedAt,
              },
            },
            canvas: {
              ...current.project.canvas,
              nodes: [
                ...current.project.canvas.nodes.map((node) =>
                  completedResourceIds.has(String(node.data.resourceId))
                    ? {
                        ...node,
                        data: {
                          ...node.data,
                          endpointId: endpoint.id,
                          resourceType:
                            nextResources[String(node.data.resourceId)]?.type ?? node.data.resourceType,
                          status: 'succeeded',
                          completedAt,
                        },
                      }
                    : node,
                ),
                ...extraNodes,
              ],
            },
          },
        }))
        void resolvePendingDependencyTasks()
      } catch (err) {
        if (taskWasCanceled(item.taskId)) return
        const failedAt = runtime.now()
        const message = err instanceof Error ? err.message : 'ComfyUI execution failed'
        set((current) => ({
          project: {
            ...current.project,
            project: { ...current.project.project, updatedAt: failedAt },
            tasks: {
              ...current.project.tasks,
              [item.taskId]: {
                ...current.project.tasks[item.taskId]!,
                status: 'failed',
                error: { code: 'function_command_failed', message, raw: err },
                updatedAt: failedAt,
                completedAt: failedAt,
              },
            },
            canvas: {
              ...current.project.canvas,
              nodes: current.project.canvas.nodes.map((node) =>
                node.data.taskId === item.taskId
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
        void resolvePendingDependencyTasks()
      } finally {
        item.resolveCompletion()
      }
    }

    const executeComfyQueueItem = async (item: QueuedComfyRun, endpoint: ComfyEndpointConfig) => {
      if (item.kind === 'command') {
        await executeComfyCommandQueueItem(item, endpoint)
        return
      }

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
            asResolvedInputValues(preparedInputValues),
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
        const defaultPrompt = promptDefaultValue(item.functionDef)
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
        const defaultPrompt = promptDefaultValue(item.functionDef)
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
      value: string | boolean | RequestBinaryOutputValue,
      item: QueuedRequestRun,
      now: string,
    ): { resource: Resource; asset?: ProjectState['assets'][string]; ref: ResourceRef } => {
      const resourceId = runtime.idFactory()
      if (output.type === 'number') {
        const numericValue = Number(typeof value === 'string' || typeof value === 'boolean' ? value : value.sizeBytes)
        return {
          resource: {
            id: resourceId,
            type: 'number',
            name: output.label,
            value: Number.isFinite(numericValue) ? numericValue : 0,
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
          ref: { resourceId, type: 'number' },
        }
      }

      if (output.type === 'boolean') {
        const booleanValue = typeof value === 'boolean' ? value : String(value).toLowerCase() === 'true'
        return {
          resource: {
            id: resourceId,
            type: 'boolean',
            name: output.label,
            value: booleanValue,
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
          ref: { resourceId, type: 'boolean' },
        }
      }

      if (output.type === 'image' || output.type === 'video' || output.type === 'audio') {
        if (typeof value === 'boolean') {
          throw new Error(`Request output ${output.key} did not produce media data`)
        }
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

      return {
        resource: {
          id: resourceId,
          type: 'text',
          name: output.label,
          value: typeof value === 'string' ? value : typeof value === 'boolean' ? String(value) : value.url,
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
        ref: { resourceId, type: 'text' },
      }
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
        return {
          resource: {
            id: resourceId,
            type: 'number',
            name: output.label,
            value: Number.isFinite(numericValue) ? numericValue : 0,
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
          ref: { resourceId, type: 'number' },
        }
      }

      if (output.type === 'boolean') {
        return {
          resource: {
            id: resourceId,
            type: 'boolean',
            name: output.label,
            value: Boolean(value),
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
          ref: { resourceId, type: 'boolean' },
        }
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

      return {
        resource: {
          id: resourceId,
          type: 'text',
          name: output.label,
          value: String(value ?? ''),
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
        ref: { resourceId, type: 'text' },
      }
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
          get().project.resources,
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
        const request = compileRequestFunctionRequest(item.functionDef, item.inputValues, get().project.resources)
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
        let binaryOutputType: ResourceType | undefined
        if (request.responseParse === 'binary') {
          const firstBinaryOutput = item.functionDef.outputs.find(
            (output) => output.type === 'image' || output.type === 'video' || output.type === 'audio',
          )
          const outputType = firstBinaryOutput?.type ?? 'image'
          const fallbackMimeType = outputMimeType(outputType, '')
          const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || fallbackMimeType
          binaryOutputType = resourceTypeFromMimeType(mimeType, outputType)
          const filename =
            filenameFromContentDisposition(response.headers.get('content-disposition')) ||
            filenameFromRequestUrl(request.url) ||
            `${firstBinaryOutput?.label ?? 'response'}.${extensionForMimeType(binaryOutputType, mimeType)}`
          const blob = new Blob([responseBuffer], { type: mimeType })
          responseBinary = {
            url: await blobToDataUrl(blob, mimeType),
            filename,
            mimeType: responseMimeType(response, binaryOutputType, filename),
            sizeBytes: responseBuffer.byteLength,
          }
        } else {
          responseText = decodeResponseBuffer(responseBuffer, request.responseEncoding)
        }
        const responseJson = request.responseParse === 'json' ? JSON.parse(responseText || 'null') : undefined
        const outputs =
          request.responseParse === 'binary' && responseBinary
            ? [
                {
                  key: item.functionDef.outputs[0]?.key ?? 'result',
                  label: item.functionDef.outputs[0]?.label ?? 'Result',
                  type: binaryOutputType ?? 'image',
                  values: [responseBinary],
                },
              ]
            : extractRequestFunctionOutputs(responseText, responseJson, item.functionDef.outputs, responseBinary)
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

    const inputValuesFromTaskSnapshot = (task: ExecutionTask): RuntimeInputValues => {
      const values: RuntimeInputValues = {}
      for (const [key, snapshot] of Object.entries(task.inputValuesSnapshot ?? {})) {
        if (snapshot.source === 'resource' && snapshot.resourceId) {
          values[key] = { resourceId: snapshot.resourceId, type: snapshot.type }
        } else if (snapshot.source === 'pending' && snapshot.pendingTaskId && snapshot.outputKey) {
          values[key] = { pendingTaskId: snapshot.pendingTaskId, outputKey: snapshot.outputKey, type: snapshot.type }
        } else if (
          snapshot.value === null ||
          typeof snapshot.value === 'string' ||
          typeof snapshot.value === 'number' ||
          typeof snapshot.value === 'boolean'
        ) {
          values[key] = snapshot.value
        }
      }
      return { ...values, ...structuredClone(task.inputRefs ?? {}) }
    }

    type DependencyResolution =
      | { status: 'waiting' }
      | { status: 'failed'; code: string; message: string; raw?: unknown }
      | {
          status: 'resolved'
          inputValues: ResolvedRuntimeInputValues
          resolvedRefsByPendingKey: Map<string, ResourceRef>
        }

    const taskResultNode = (project: ProjectState, taskId: string) =>
      project.canvas.nodes.find((node) => node.type === 'result_group' && node.data.taskId === taskId)

    const resolveTaskInputDependencies = (task: ExecutionTask, project: ProjectState): DependencyResolution => {
      const inputValues = inputValuesFromTaskSnapshot(task)
      const resolvedRefsByPendingKey = new Map<string, ResourceRef>()

      for (const [inputKey, value] of Object.entries(inputValues)) {
        if (!isPendingResourceRef(value)) continue

        const dependencyTask = project.tasks[value.pendingTaskId]
        if (!dependencyTask) {
          return {
            status: 'failed',
            code: 'dependency_missing',
            message: `Dependency task ${value.pendingTaskId} is missing`,
          }
        }
        if (dependencyTask.status === 'failed' || dependencyTask.status === 'canceled') {
          return {
            status: 'failed',
            code: 'dependency_failed',
            message: `Dependency task ${value.pendingTaskId} ${dependencyTask.status}`,
            raw: dependencyTask.error,
          }
        }
        if (dependencyTask.status !== 'succeeded') return { status: 'waiting' }

        const outputRefs = dependencyTask.outputRefs[value.outputKey] ?? []
        const resolvedRef = outputRefs.find((ref) => ref.type === value.type) ?? outputRefs[0]
        if (!resolvedRef) {
          return {
            status: 'failed',
            code: 'dependency_output_missing',
            message: `Dependency task ${value.pendingTaskId} did not produce ${value.outputKey}`,
          }
        }

        inputValues[inputKey] = resolvedRef
        resolvedRefsByPendingKey.set(pendingRefKey(value), resolvedRef)
      }

      return {
        status: 'resolved',
        inputValues: asResolvedInputValues(inputValues),
        resolvedRefsByPendingKey,
      }
    }

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
                inputValuesSnapshot: executionInputSnapshot(functionDef, inputValues, current.project.resources),
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
        (endpoint) => endpointIsWorkerEligible(endpoint) && endpointCanRunFunctionDefinition(endpoint, functionDef),
      )
      if (workerEndpoints.length === 0) {
        failResultRunInPlace(resultNodeId, task.id, 'endpoint_unavailable', endpointUnavailableMessageForFunction(functionDef))
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
            const functionDef = functionDefinitionForTask(pendingTask)
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
      const functionDef = functionDefinitionById(functionId)
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
          inputValuesSnapshot: executionInputSnapshot(functionDef, inputValues, state.project.resources),
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
          inputValuesSnapshot: executionInputSnapshot(runtimeFunctionDef, inputValues, state.project.resources),
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
        if (endpoints.some((endpoint) => endpointCanRunQueuedComfyItem(endpoint, queuedRun))) continue
        comfyQueue.splice(index, 1)
        if (queuedRun.kind === 'command') {
          failComfyCommandRunInPlace(
            queuedRun,
            'endpoint_unavailable',
            endpointUnavailableMessageForFunction(queuedRun.functionDef),
          )
        } else {
          failResultRunInPlace(
            queuedRun.resultNodeId,
            queuedRun.taskId,
            'endpoint_unavailable',
            endpointUnavailableMessageForFunction(queuedRun.functionDef),
          )
        }
        queuedRun.resolveCompletion()
      }

      for (const endpoint of endpoints) {
        if (activeComfyWorkerEndpointIds.has(endpoint.id)) continue
        if (!comfyQueue.some((item) => endpointCanRunQueuedComfyItem(endpoint, item))) continue

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
      projectPersistenceReady: true,
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
      const nodePosition = nonOverlappingNodePosition(
        get().project.canvas.nodes,
        get().project.functions,
        position,
        { width: 230, height: 180 },
      )
      const resource: Resource = {
        id: resourceId,
        type: 'text',
        name,
        displayMode: 'plaintext',
        value,
        source: { kind: 'manual_input' },
        metadata: { createdAt: now },
      }
      const node: CanvasNode = {
        id: nodeId,
        type: 'resource',
        position: nodePosition,
        data: { resourceId, resourceType: 'text' },
      }

      set((state) => {
        const nextProject = {
          ...ensureProjectHistory(state.project),
          project: { ...state.project.project, updatedAt: now },
          resources: { ...state.project.resources, [resourceId]: resource },
          canvas: { ...state.project.canvas, nodes: [...state.project.canvas.nodes, markNewCanvasNode(node, now)] },
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
        const nodeId = `node_${resourceId}`
        const now = runtime.now()
        const nodePosition = nonOverlappingNodePosition(
          get().project.canvas.nodes,
          get().project.functions,
          position,
          { width: 230, height: 180 },
        )
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
          position: nodePosition,
          data: { resourceId, resourceType: type },
        }

        set((state) => {
          const nextProject = {
            ...ensureProjectHistory(state.project),
            project: { ...state.project.project, updatedAt: now },
            resources: { ...state.project.resources, [resourceId]: resource },
            canvas: { ...state.project.canvas, nodes: [...state.project.canvas.nodes, markNewCanvasNode(node, now)] },
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

      if (type === 'boolean') {
        const resourceId = runtime.idFactory()
        const nodeId = `node_${resourceId}`
        const now = runtime.now()
        const nodePosition = nonOverlappingNodePosition(
          get().project.canvas.nodes,
          get().project.functions,
          position,
          { width: 230, height: 180 },
        )
        const resource: Resource = {
          id: resourceId,
          type,
          name: resourceNameForType(type),
          value: typeof initialValue === 'boolean' ? initialValue : false,
          source: { kind: 'manual_input' },
          metadata: { createdAt: now },
        }
        const node: CanvasNode = {
          id: nodeId,
          type: 'resource',
          position: nodePosition,
          data: { resourceId, resourceType: type },
        }

        set((state) => {
          const nextProject = {
            ...ensureProjectHistory(state.project),
            project: { ...state.project.project, updatedAt: now },
            resources: { ...state.project.resources, [resourceId]: resource },
            canvas: { ...state.project.canvas, nodes: [...state.project.canvas.nodes, markNewCanvasNode(node, now)] },
          }
          return {
            project: projectWithRecordedHistory(state.project, nextProject, now, {
              label: 'Create boolean asset',
              transactionType: 'asset',
              nodeIds: [nodeId],
              assetIds: [resourceId],
              preview: {
                title: 'Create boolean asset',
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
      const nodePosition = nonOverlappingNodePosition(
        get().project.canvas.nodes,
        get().project.functions,
        position,
        { width: 230, height: 180 },
      )
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
        position: nodePosition,
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
          canvas: { ...state.project.canvas, nodes: [...state.project.canvas.nodes, markNewCanvasNode(node, now)] },
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

    updateTextResourceValue: (resourceId, value) => {
      const now = runtime.now()
      set((state) => {
        const resource = state.project.resources[resourceId]
        if (!resource || resource.type !== 'text' || resource.value === value) return state
        const nodeId = state.project.canvas.nodes.find(
          (node) => node.type === 'resource' && node.data.resourceId === resourceId,
        )?.id
        const nextProject = {
          ...ensureProjectHistory(state.project),
          project: { ...state.project.project, updatedAt: now },
          resources: {
            ...state.project.resources,
            [resourceId]: { ...resource, value },
          },
        }

        return {
          project: projectWithRecordedHistory(state.project, nextProject, now, {
            label: 'Edit text asset',
            transactionType: 'asset',
            nodeIds: nodeId ? [nodeId] : [],
            assetIds: [resourceId],
            preview: {
              title: 'Edit text asset',
              subtitle: resource.name,
              nodeIds: nodeId ? [nodeId] : [],
              assetIds: [resourceId],
            },
          }),
        }
      })
    },

    updateTextResourceDisplayMode: (resourceId, displayMode) => {
      const normalizedMode = normalizeTextDisplayMode(displayMode)
      const now = runtime.now()
      set((state) => {
        const resource = state.project.resources[resourceId]
        if (!resource || resource.type !== 'text' || normalizeTextDisplayMode(resource.displayMode) === normalizedMode) {
          return state
        }
        const nodeId = state.project.canvas.nodes.find(
          (node) => node.type === 'resource' && node.data.resourceId === resourceId,
        )?.id
        const nextProject = {
          ...ensureProjectHistory(state.project),
          project: { ...state.project.project, updatedAt: now },
          resources: {
            ...state.project.resources,
            [resourceId]: { ...resource, displayMode: normalizedMode },
          },
        }

        return {
          project: projectWithRecordedHistory(state.project, nextProject, now, {
            label: 'Change text display mode',
            transactionType: 'settings',
            nodeIds: nodeId ? [nodeId] : [],
            assetIds: [resourceId],
            preview: {
              title: 'Change text display mode',
              subtitle: normalizedMode,
              nodeIds: nodeId ? [nodeId] : [],
              assetIds: [resourceId],
            },
          }),
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

    updateBooleanResourceValue: (resourceId, value) => {
      const now = runtime.now()
      set((state) => {
        const resource = state.project.resources[resourceId]
        if (!resource || resource.type !== 'boolean' || resource.value === value) return state
        const nodeId = state.project.canvas.nodes.find(
          (node) => node.type === 'resource' && node.data.resourceId === resourceId,
        )?.id
        const nextProject = {
          ...ensureProjectHistory(state.project),
          project: { ...state.project.project, updatedAt: now },
          resources: {
            ...state.project.resources,
            [resourceId]: { ...resource, value },
          },
        }

        return {
          project: projectWithRecordedHistory(state.project, nextProject, now, {
            label: 'Edit boolean asset',
            transactionType: 'asset',
            nodeIds: nodeId ? [nodeId] : [],
            assetIds: [resourceId],
            preview: {
              title: 'Edit boolean asset',
              subtitle: value ? 'true' : 'false',
              nodeIds: nodeId ? [nodeId] : [],
              assetIds: [resourceId],
            },
          }),
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
                    if (input.type === 'boolean') return typeof value === 'boolean'
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
      const nodePosition = nonOverlappingNodePosition(
        get().project.canvas.nodes,
        get().project.functions,
        position,
        functionNodeEstimatedSize(functionDef),
      )
      const inputValues =
        options?.autoBindRequiredInputs === false ? {} : defaultInputValues(functionDef.inputs, get().project.resources)
      const node: CanvasNode = {
        id,
        type: 'function',
        position: nodePosition,
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
          canvas: { ...state.project.canvas, nodes: [...state.project.canvas.nodes, markNewCanvasNode(node, now)] },
        },
      }))
      return id
    },

    runFunctionAtPosition: async (functionId, inputValues, position, runCount, options) => {
      const state = get()
      const functionDef = functionDefinitionById(functionId)
      if (!functionDef) return undefined

      const now = runtime.now()
      const normalizedRuns = normalizedRunCount(runCount ?? functionDef.runtimeDefaults?.runCount ?? 1)
      const runtimeInputValues = inputValues as RuntimeInputValues
      if (missingRequiredInputKeys(functionDef.inputs, runtimeInputValues, state.project.resources).length > 0) {
        return undefined
      }

      const hasPendingDependencies = hasPendingInputRefs(runtimeInputValues)
      const isTemporaryComfyFunction = isTemporaryComfyFunctionDefinition(functionDef)
      const preferredComfyEndpointId =
        isTemporaryComfyFunction && functionDef.workflow.format === 'comfyui_api_json'
          ? functionDef.workflow.editor?.endpointId
          : undefined
      const queuedComfyEndpointId =
        !hasPendingDependencies && functionDef.workflow.format === 'comfyui_api_json'
          ? isTemporaryComfyFunction
            ? preferredComfyEndpointId
            : (() => {
                const workerEndpoints = state.project.comfy.endpoints.filter(
                  (endpoint) => endpointIsWorkerEligible(endpoint) && endpointSupportsFunction(endpoint, functionId),
                )
                return workerEndpoints.length === 1 ? workerEndpoints[0]!.id : undefined
              })()
          : undefined
      const replaceResourceId =
        options?.replace?.resourceId && state.project.resources[options.replace.resourceId]
          ? options.replace.resourceId
          : undefined
      const replaceOutputKey =
        replaceResourceId && options?.replace?.outputKey && functionDef.outputs.some((output) => output.key === options.replace?.outputKey)
          ? options.replace.outputKey
          : replaceResourceId
            ? functionDef.outputs[0]?.key
            : undefined
      let replacementConsumed = false
      const tasks: Record<string, ExecutionTask> = {}
      const resources: Record<string, Resource> = {}
      const nodes: CanvasNode[] = []
      const replacementNodeDataByResourceId: Record<
        string,
        {
          resourceType: ResourceType
          functionId: string
          taskId: string
          outputKey: string
          status: ExecutionTask['status']
          endpointId?: string
        }
      > = {}
      const queuedLocalRuns: Array<{
        taskId: string
        runIndex: number
        outputRefs: Record<string, ResourceRef[]>
        inputValues: ResolvedRuntimeInputValues
      }> = []
      const queuedComfyRuns: Array<{
        taskId: string
        runIndex: number
        outputRefs: Record<string, ResourceRef[]>
        inputValues: ResolvedRuntimeInputValues
      }> = []
      const queuedOpenAiRuns: Array<{
        taskId: string
        runIndex: number
        outputRefs: Record<string, ResourceRef[]>
        inputValues: ResolvedRuntimeInputValues
      }> = []
      const queuedGeminiRuns: Array<{
        taskId: string
        runIndex: number
        outputRefs: Record<string, ResourceRef[]>
        inputValues: ResolvedRuntimeInputValues
      }> = []
      const queuedOpenAiImageRuns: Array<{
        taskId: string
        runIndex: number
        outputRefs: Record<string, ResourceRef[]>
        inputValues: ResolvedRuntimeInputValues
      }> = []
      const queuedGeminiImageRuns: Array<{
        taskId: string
        runIndex: number
        outputRefs: Record<string, ResourceRef[]>
        inputValues: ResolvedRuntimeInputValues
      }> = []
      const queuedRequestRuns: Array<{
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
          const shouldReplace =
            !replacementConsumed &&
            index === 0 &&
            Boolean(replaceResourceId) &&
            output.key === replaceOutputKey
          const resourceId = shouldReplace ? replaceResourceId! : runtime.idFactory()
          const ref: ResourceRef = { resourceId, type: output.type }
          outputRefs[output.key] = [ref]
          resources[resourceId] = {
            id: resourceId,
            type: output.type,
            name: `${functionDef.name} ${output.label || output.key}`,
            value: emptyFunctionOutputValue(output.type, resourceId),
            source: {
              kind: 'function_output',
              functionNodeId: taskId,
              taskId,
              outputKey: output.key,
            },
            metadata: {
              workflowFunctionId: functionId,
              functionSnapshot: structuredClone(functionDef),
              endpointId: functionDef.workflow.format === 'local_transform' ? 'local' : undefined,
              createdAt: now,
            },
          }
          if (shouldReplace) {
            replacementConsumed = true
            replacementNodeDataByResourceId[resourceId] = {
              resourceType: output.type,
              functionId,
              taskId,
              outputKey: output.key,
              status: hasPendingDependencies ? 'pending' : 'queued',
              endpointId: queuedComfyEndpointId,
            }
          } else {
            const nodePosition = nonOverlappingNodePosition(
              [...state.project.canvas.nodes, ...nodes],
              state.project.functions,
              commandOutputPosition(position, index, outputIndex),
              { width: 230, height: 180 },
            )
            nodes.push(
              markNewCanvasNode(
                {
                  id: resourceNodeId(resourceId),
                  type: 'resource',
                  position: nodePosition,
                  data: {
                    resourceId,
                    resourceType: output.type,
                    functionId,
                    taskId,
                    outputKey: output.key,
                    endpointId: queuedComfyEndpointId,
                    status: hasPendingDependencies ? 'pending' : 'queued',
                  },
                },
                now,
              ),
            )
          }
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
          inputValuesSnapshot: executionInputSnapshot(functionDef, runtimeInputValues, state.project.resources),
          paramsSnapshot: { runCount: normalizedRuns, mode: 'function_command' },
          ...(state.project.functions[functionId] ? {} : { functionSnapshot: structuredClone(functionDef) }),
          workflowTemplateSnapshot: functionDef.workflow.rawJson,
          compiledWorkflowSnapshot: functionDef.workflow.rawJson,
          seedPatchLog: [],
          endpointId: functionDef.workflow.format === 'local_transform' ? 'local' : queuedComfyEndpointId,
          outputRefs,
          createdAt: now,
          updatedAt: now,
        }

        if (isLocalTransformFunction(functionDef) && !hasPendingDependencies) {
          queuedLocalRuns.push({
            taskId,
            runIndex,
            outputRefs,
            inputValues: asResolvedInputValues(runtimeInputValues),
          })
        }
        if (functionDef.workflow.format === 'comfyui_api_json' && !hasPendingDependencies) {
          queuedComfyRuns.push({
            taskId,
            runIndex,
            outputRefs,
            inputValues: asResolvedInputValues(runtimeInputValues),
          })
        }
        if (isOpenAILlmFunction(functionDef) && !hasPendingDependencies) {
          queuedOpenAiRuns.push({
            taskId,
            runIndex,
            outputRefs,
            inputValues: asResolvedInputValues(runtimeInputValues),
          })
        }
        if (isGeminiLlmFunction(functionDef) && !hasPendingDependencies) {
          queuedGeminiRuns.push({
            taskId,
            runIndex,
            outputRefs,
            inputValues: asResolvedInputValues(runtimeInputValues),
          })
        }
        if (isOpenAIImageFunction(functionDef) && !hasPendingDependencies) {
          queuedOpenAiImageRuns.push({
            taskId,
            runIndex,
            outputRefs,
            inputValues: asResolvedInputValues(runtimeInputValues),
          })
        }
        if (isGeminiImageFunction(functionDef) && !hasPendingDependencies) {
          queuedGeminiImageRuns.push({
            taskId,
            runIndex,
            outputRefs,
            inputValues: asResolvedInputValues(runtimeInputValues),
          })
        }
        if (isRequestFunction(functionDef) && !hasPendingDependencies) {
          queuedRequestRuns.push({
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
          tasks: { ...state.project.tasks, ...tasks },
          canvas: {
            ...state.project.canvas,
            nodes: [
              ...state.project.canvas.nodes.map((node) => {
                const replacement = replacementNodeDataByResourceId[String(node.data.resourceId)]
                return replacement ? { ...node, data: { ...node.data, ...replacement } } : node
              }),
              ...nodes,
            ],
          },
        },
      }))

      const outputResourceFromLocalValue = (
        resourceId: string,
        output: { key: string; label: string; type: ResourceType },
        value: LocalTransformOutputValue,
        taskId: string,
        completedAt: string,
      ): { resource: Resource; asset?: ProjectState['assets'][string] } => {
        if (output.type === 'number') {
          const numericValue = Number(value)
          return {
            resource: {
              id: resourceId,
              type: 'number',
              name: output.label,
              value: Number.isFinite(numericValue) ? numericValue : 0,
              source: { kind: 'function_output', functionNodeId: taskId, taskId, outputKey: output.key },
              metadata: {
                workflowFunctionId: functionId,
                functionSnapshot: structuredClone(functionDef),
                endpointId: 'local',
                createdAt: completedAt,
              },
            },
          }
        }

        if (output.type === 'boolean') {
          return {
            resource: {
              id: resourceId,
              type: 'boolean',
              name: output.label,
              value: Boolean(value),
              source: { kind: 'function_output', functionNodeId: taskId, taskId, outputKey: output.key },
              metadata: {
                workflowFunctionId: functionId,
                functionSnapshot: structuredClone(functionDef),
                endpointId: 'local',
                createdAt: completedAt,
              },
            },
          }
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
              source: { kind: 'function_output', functionNodeId: taskId, taskId, outputKey: output.key },
              metadata: {
                workflowFunctionId: functionId,
                functionSnapshot: structuredClone(functionDef),
                endpointId: 'local',
                createdAt: completedAt,
              },
            },
          }
        }

        return {
          resource: {
            id: resourceId,
            type: 'text',
            name: output.label,
            value: String(value ?? ''),
            source: { kind: 'function_output', functionNodeId: taskId, taskId, outputKey: output.key },
            metadata: {
              workflowFunctionId: functionId,
              functionSnapshot: structuredClone(functionDef),
              endpointId: 'local',
              createdAt: completedAt,
            },
          },
        }
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

      type CommandOutputValue = string | number | boolean | MediaResourcePayload | RequestBinaryOutputValue
      type CommandOutputItem = {
        key: string
        label: string
        type: ResourceType
        values: CommandOutputValue[]
      }

      const commandOutputResourceFromValue = (
        resourceId: string,
        output: { key: string; label: string; type: ResourceType },
        value: CommandOutputValue,
        taskId: string,
        endpointId: string,
        completedAt: string,
      ): { resource: Resource; asset?: ProjectState['assets'][string] } => {
        const metadata = {
          workflowFunctionId: functionId,
          functionSnapshot: structuredClone(functionDef),
          endpointId,
          createdAt: completedAt,
        }
        if (output.type === 'number') {
          const numericValue = Number(typeof value === 'object' && value !== null && 'sizeBytes' in value ? value.sizeBytes : value)
          return {
            resource: {
              id: resourceId,
              type: 'number',
              name: output.label,
              value: Number.isFinite(numericValue) ? numericValue : 0,
              source: { kind: 'function_output', functionNodeId: taskId, taskId, outputKey: output.key },
              metadata,
            },
          }
        }

        if (output.type === 'boolean') {
          return {
            resource: {
              id: resourceId,
              type: 'boolean',
              name: output.label,
              value: typeof value === 'boolean' ? value : String(value).toLowerCase() === 'true',
              source: { kind: 'function_output', functionNodeId: taskId, taskId, outputKey: output.key },
              metadata,
            },
          }
        }

        if (output.type === 'image' || output.type === 'video' || output.type === 'audio') {
          const assetId = runtime.idFactory()
          const media =
            typeof value === 'object' && value !== null && 'url' in value
              ? value
              : {
                  url: String(value ?? ''),
                  filename: output.label,
                  mimeType: outputMimeType(output.type, output.label),
                  sizeBytes: 0,
                }
          const filename = media.filename ?? output.label
          const asset = {
            id: assetId,
            name: filename,
            mimeType: media.mimeType,
            sizeBytes: media.sizeBytes,
            blobUrl: media.url,
            createdAt: completedAt,
          }
          return {
            asset,
            resource: {
              id: resourceId,
              type: output.type,
              name: filename,
              value: mediaValueWithAsset(assetId, {
                url: media.url,
                filename,
                mimeType: media.mimeType,
                sizeBytes: media.sizeBytes,
              }),
              source: { kind: 'function_output', functionNodeId: taskId, taskId, outputKey: output.key },
              metadata,
            },
          }
        }

        return {
          resource: {
            id: resourceId,
            type: 'text',
            name: output.label,
            value: typeof value === 'object' && value !== null && 'url' in value ? value.url : String(value ?? ''),
            source: { kind: 'function_output', functionNodeId: taskId, taskId, outputKey: output.key },
            metadata,
          },
        }
      }

      const writeCommandOutputs = (
        taskId: string,
        runIndex: number,
        outputRefs: Record<string, ResourceRef[]>,
        outputs: CommandOutputItem[],
        endpointId: string,
        extraTaskPatch: Partial<ExecutionTask> = {},
      ) => {
        const completedAt = runtime.now()
        const nextResources: Record<string, Resource> = {}
        const nextAssets: ProjectState['assets'] = {}
        const nextOutputRefs: Record<string, ResourceRef[]> = {}
        const extraNodes: CanvasNode[] = []

        outputs.forEach((outputItem, outputIndex) => {
          const refs = outputRefs[outputItem.key] ? [...outputRefs[outputItem.key]] : []
          outputItem.values.forEach((value, valueIndex) => {
            let ref = refs[valueIndex]
            if (!ref) {
              const resourceId = runtime.idFactory()
              ref = { resourceId, type: outputItem.type }
              refs.push(ref)
              extraNodes.push(
                markNewCanvasNode(
                  {
                    id: resourceNodeId(resourceId),
                    type: 'resource',
                    position: nonOverlappingNodePosition(
                      [...get().project.canvas.nodes, ...extraNodes],
                      get().project.functions,
                      commandOutputPosition(position, runIndex - 1, outputIndex + valueIndex),
                      { width: 230, height: 180 },
                    ),
                    data: {
                      resourceId,
                      resourceType: outputItem.type,
                      functionId,
                      taskId,
                      outputKey: outputItem.key,
                      status: 'succeeded',
                      completedAt,
                    },
                  },
                  completedAt,
                ),
              )
            } else {
              ref = { ...ref, type: outputItem.type }
              refs[valueIndex] = ref
            }

            const created = commandOutputResourceFromValue(ref.resourceId, outputItem, value, taskId, endpointId, completedAt)
            nextResources[created.resource.id] = created.resource
            if (created.asset) nextAssets[created.asset.id] = created.asset
          })
          nextOutputRefs[outputItem.key] = refs
        })

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
                ...extraTaskPatch,
                status: 'succeeded',
                outputRefs: nextOutputRefs,
                updatedAt: completedAt,
                completedAt,
              },
            },
            canvas: {
              ...current.project.canvas,
              nodes: [
                ...current.project.canvas.nodes.map((node) =>
                  completedResourceIds.has(String(node.data.resourceId))
                    ? {
                        ...node,
                        data: {
                          ...node.data,
                          endpointId,
                          resourceType:
                            nextResources[String(node.data.resourceId)]?.type ?? node.data.resourceType,
                          status: 'succeeded',
                          completedAt,
                        },
                      }
                    : node,
                ),
                ...extraNodes,
              ],
            },
          },
        }))
        void resolvePendingDependencyTasks()
      }

      for (const queuedRun of queuedLocalRuns) {
        markCommandTaskRunning(queuedRun.taskId, 'local')
        try {
          const outputs = await executeLocalTransformFunction(
            functionDef,
            queuedRun.inputValues,
            get().project.resources,
            (resource) => readProjectResourceBlob(get().project, resource, runtime.createComfyClient),
          )
          const completedAt = runtime.now()
          const nextResources: Record<string, Resource> = {}
          const nextAssets: ProjectState['assets'] = {}
          const nextOutputRefs: Record<string, ResourceRef[]> = {}
          const extraNodes: CanvasNode[] = []

          outputs.forEach((outputItem, outputIndex) => {
            const refs = queuedRun.outputRefs[outputItem.key] ? [...queuedRun.outputRefs[outputItem.key]] : []
            outputItem.values.forEach((value, valueIndex) => {
              let ref = refs[valueIndex]
              if (!ref) {
              const resourceId = runtime.idFactory()
              ref = { resourceId, type: outputItem.type }
              refs.push(ref)
                extraNodes.push(
                  markNewCanvasNode(
                    {
                      id: resourceNodeId(resourceId),
                      type: 'resource',
                      position: nonOverlappingNodePosition(
                        [...get().project.canvas.nodes, ...extraNodes],
                        get().project.functions,
                        commandOutputPosition(position, queuedRun.runIndex - 1, outputIndex + valueIndex),
                        { width: 230, height: 180 },
                      ),
                      data: {
                        resourceId,
                        resourceType: outputItem.type,
                        functionId,
                        taskId: queuedRun.taskId,
                        outputKey: outputItem.key,
                        status: 'succeeded',
                        completedAt,
                      },
                    },
                    completedAt,
                  ),
                )
              }

              const created = outputResourceFromLocalValue(ref.resourceId, outputItem, value, queuedRun.taskId, completedAt)
              nextResources[created.resource.id] = created.resource
              if (created.asset) nextAssets[created.asset.id] = created.asset
            })
            nextOutputRefs[outputItem.key] = refs
          })

          const completedResourceIds = new Set(Object.keys(nextResources))
          set((current) => ({
            project: {
              ...current.project,
              project: { ...current.project.project, updatedAt: completedAt },
              resources: { ...current.project.resources, ...nextResources },
              assets: { ...current.project.assets, ...nextAssets },
              tasks: {
                ...current.project.tasks,
                [queuedRun.taskId]: {
                  ...current.project.tasks[queuedRun.taskId]!,
                  status: 'succeeded',
                  outputRefs: nextOutputRefs,
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
        } catch (err) {
          failCommandTask(queuedRun.taskId, err)
        }
      }

      if (queuedComfyRuns.length > 0) {
        const completionPromises: Promise<void>[] = []
        const queuedItems = queuedComfyRuns.map((queuedRun): QueuedComfyCommandRun => {
          let resolveCompletion: () => void = () => undefined
          const completion = new Promise<void>((resolve) => {
            resolveCompletion = resolve
          })
          completionPromises.push(completion)
          return {
            kind: 'command',
            taskId: queuedRun.taskId,
            functionNodeId: queuedRun.taskId,
            functionId,
            requiredEndpointId: preferredComfyEndpointId,
            functionDef,
            inputValues: queuedRun.inputValues,
            outputRefs: queuedRun.outputRefs,
            position,
            runIndex: queuedRun.runIndex,
            runTotal: normalizedRuns,
            createdAt: now,
            completion,
            resolveCompletion,
          }
        })

        comfyQueue.push(...queuedItems)
        ensureComfyWorkers()
        await Promise.all(completionPromises)
      }

      for (const queuedRun of queuedOpenAiRuns) {
        const config = mergedOpenAILlmConfig(functionDef.openai)
        markCommandTaskRunning(queuedRun.taskId, 'openai')
        try {
          if (!config.apiKey.trim()) throw new Error('OpenAI API key is required')
          const request = await createOpenAIChatCompletionRequest(
            config,
            queuedRun.inputValues,
            get().project.resources,
            (resource) => readProjectResourceBlob(get().project, resource, runtime.createComfyClient),
          )
          if (request.messages.length === 0) throw new Error('OpenAI messages are empty')
          set((current) => ({
            project: {
              ...current.project,
              tasks: {
                ...current.project.tasks,
                [queuedRun.taskId]: {
                  ...current.project.tasks[queuedRun.taskId]!,
                  requestSnapshot: structuredClone(request),
                  updatedAt: runtime.now(),
                },
              },
            },
          }))

          const response = await fetch(chatCompletionsUrl(config.baseUrl), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey.trim()}`,
            },
            body: JSON.stringify(request),
          })
          if (!response.ok) {
            const errorText = await response.text().catch(() => '')
            throw new Error(`OpenAI request failed: ${response.status}${errorText ? ` ${errorText}` : ''}`)
          }

          const outputText = extractOpenAIChatCompletionText(await response.json())
          if (!outputText) throw new Error('OpenAI response did not include output text')
          const output = functionDef.outputs[0] ?? {
            key: 'text',
            label: 'Text',
            type: 'text' as ResourceType,
          }
          writeCommandOutputs(
            queuedRun.taskId,
            queuedRun.runIndex,
            queuedRun.outputRefs,
            [{ key: output.key, label: output.label, type: output.type, values: [outputText] }],
            'openai',
            { compiledWorkflowSnapshot: {} },
          )
        } catch (err) {
          failCommandTask(queuedRun.taskId, err)
        }
      }

      for (const queuedRun of queuedGeminiRuns) {
        const config = mergedGeminiLlmConfig(functionDef.gemini)
        markCommandTaskRunning(queuedRun.taskId, 'gemini')
        try {
          if (!config.apiKey.trim()) throw new Error('Gemini API key is required')
          const request = await createGeminiGenerateContentRequest(
            config,
            queuedRun.inputValues,
            get().project.resources,
            (resource) => readProjectResourceBlob(get().project, resource, runtime.createComfyClient),
          )
          if (request.contents.length === 0) throw new Error('Gemini contents are empty')
          set((current) => ({
            project: {
              ...current.project,
              tasks: {
                ...current.project.tasks,
                [queuedRun.taskId]: {
                  ...current.project.tasks[queuedRun.taskId]!,
                  requestSnapshot: structuredClone(request),
                  updatedAt: runtime.now(),
                },
              },
            },
          }))

          const response = await fetch(geminiGenerateContentUrl(config.baseUrl, config.model), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': config.apiKey.trim(),
            },
            body: JSON.stringify(request),
          })
          if (!response.ok) {
            const errorText = await response.text().catch(() => '')
            throw new Error(`Gemini request failed: ${response.status}${errorText ? ` ${errorText}` : ''}`)
          }

          const outputText = extractGeminiGenerateContentText(await response.json())
          if (!outputText) throw new Error('Gemini response did not include output text')
          const output = functionDef.outputs[0] ?? {
            key: 'text',
            label: 'Text',
            type: 'text' as ResourceType,
          }
          writeCommandOutputs(
            queuedRun.taskId,
            queuedRun.runIndex,
            queuedRun.outputRefs,
            [{ key: output.key, label: output.label, type: output.type, values: [outputText] }],
            'gemini',
            { compiledWorkflowSnapshot: {} },
          )
        } catch (err) {
          failCommandTask(queuedRun.taskId, err)
        }
      }

      for (const queuedRun of queuedOpenAiImageRuns) {
        const config = mergedOpenAIImageConfig(functionDef.openaiImage)
        markCommandTaskRunning(queuedRun.taskId, 'openai_image')
        try {
          if (!config.apiKey.trim()) throw new Error('OpenAI API key is required')
          const defaultPrompt = promptDefaultValue(functionDef)
          const request = await createOpenAIImageApiRequest(
            config,
            queuedRun.inputValues,
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
                [queuedRun.taskId]: {
                  ...current.project.tasks[queuedRun.taskId]!,
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
          if (!response.ok) {
            const errorText = await response.text().catch(() => '')
            throw new Error(`OpenAI image request failed: ${response.status}${errorText ? ` ${errorText}` : ''}`)
          }

          const outputs = extractOpenAIImageGenerationOutputs(await response.json(), config.outputFormat)
          if (outputs.length === 0) throw new Error('OpenAI image response did not include image data')
          const output = functionDef.outputs[0] ?? {
            key: 'image',
            label: 'Image',
            type: 'image' as ResourceType,
          }
          writeCommandOutputs(
            queuedRun.taskId,
            queuedRun.runIndex,
            queuedRun.outputRefs,
            [
              {
                key: output.key,
                label: output.label,
                type: output.type,
                values: outputs.map((item) => ({
                  url: item.dataUrl,
                  filename: item.filename,
                  mimeType: item.mimeType,
                  sizeBytes: 0,
                })),
              },
            ],
            'openai_image',
            { compiledWorkflowSnapshot: {} },
          )
        } catch (err) {
          failCommandTask(queuedRun.taskId, err)
        }
      }

      for (const queuedRun of queuedGeminiImageRuns) {
        const config = mergedGeminiImageConfig(functionDef.geminiImage)
        markCommandTaskRunning(queuedRun.taskId, 'gemini_image')
        try {
          if (!config.apiKey.trim()) throw new Error('Gemini API key is required')
          const defaultPrompt = promptDefaultValue(functionDef)
          const request = await createGeminiImageGenerationRequest(
            config,
            queuedRun.inputValues,
            get().project.resources,
            defaultPrompt,
            (resource) => readProjectResourceBlob(get().project, resource, runtime.createComfyClient),
          )
          set((current) => ({
            project: {
              ...current.project,
              tasks: {
                ...current.project.tasks,
                [queuedRun.taskId]: {
                  ...current.project.tasks[queuedRun.taskId]!,
                  requestSnapshot: structuredClone(request),
                  updatedAt: runtime.now(),
                },
              },
            },
          }))
          const requestPrompt =
            request.contents[0]?.parts.find((part): part is { text: string } => 'text' in part)?.text ?? ''
          if (!requestPrompt.trim()) throw new Error('Gemini image prompt is empty')

          const response = await fetch(geminiGenerateContentUrl(config.baseUrl, config.model), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': config.apiKey.trim(),
            },
            body: JSON.stringify(request),
          })
          if (!response.ok) {
            const errorText = await response.text().catch(() => '')
            throw new Error(`Gemini image request failed: ${response.status}${errorText ? ` ${errorText}` : ''}`)
          }

          const outputs = extractGeminiImageGenerationOutputs(await response.json())
          if (outputs.length === 0) throw new Error('Gemini image response did not include image data')
          const output = functionDef.outputs[0] ?? {
            key: 'image',
            label: 'Image',
            type: 'image' as ResourceType,
          }
          writeCommandOutputs(
            queuedRun.taskId,
            queuedRun.runIndex,
            queuedRun.outputRefs,
            [
              {
                key: output.key,
                label: output.label,
                type: output.type,
                values: outputs.map((item) => ({
                  url: item.dataUrl,
                  filename: item.filename,
                  mimeType: item.mimeType,
                  sizeBytes: 0,
                })),
              },
            ],
            'gemini_image',
            { compiledWorkflowSnapshot: {} },
          )
        } catch (err) {
          failCommandTask(queuedRun.taskId, err)
        }
      }

      for (const queuedRun of queuedRequestRuns) {
        markCommandTaskRunning(queuedRun.taskId, 'request')
        try {
          const request = compileRequestFunctionRequest(functionDef, queuedRun.inputValues, get().project.resources)
          set((current) => ({
            project: {
              ...current.project,
              tasks: {
                ...current.project.tasks,
                [queuedRun.taskId]: {
                  ...current.project.tasks[queuedRun.taskId]!,
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
          let binaryOutputType: ResourceType | undefined
          if (request.responseParse === 'binary') {
            const firstBinaryOutput = functionDef.outputs.find(
              (output) => output.type === 'image' || output.type === 'video' || output.type === 'audio',
            )
            const outputType = firstBinaryOutput?.type ?? 'image'
            const fallbackMimeType = outputMimeType(outputType, '')
            const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || fallbackMimeType
            binaryOutputType = resourceTypeFromMimeType(mimeType, outputType)
            const filename =
              filenameFromContentDisposition(response.headers.get('content-disposition')) ||
              filenameFromRequestUrl(request.url) ||
              `${firstBinaryOutput?.label ?? 'response'}.${extensionForMimeType(binaryOutputType, mimeType)}`
            const blob = new Blob([responseBuffer], { type: mimeType })
            responseBinary = {
              url: await blobToDataUrl(blob, mimeType),
              filename,
              mimeType: responseMimeType(response, binaryOutputType, filename),
              sizeBytes: responseBuffer.byteLength,
            }
          } else {
            responseText = decodeResponseBuffer(responseBuffer, request.responseEncoding)
          }
          const responseJson = request.responseParse === 'json' ? JSON.parse(responseText || 'null') : undefined
          const outputs =
            request.responseParse === 'binary' && responseBinary
              ? [
                  {
                    key: functionDef.outputs[0]?.key ?? 'result',
                    label: functionDef.outputs[0]?.label ?? 'Result',
                    type: binaryOutputType ?? 'image',
                    values: [responseBinary],
                  },
                ]
              : extractRequestFunctionOutputs(responseText, responseJson, functionDef.outputs, responseBinary)
          writeCommandOutputs(
            queuedRun.taskId,
            queuedRun.runIndex,
            queuedRun.outputRefs,
            outputs.map((output) => ({ ...output, values: output.values })),
            'request',
          )
        } catch (err) {
          failCommandTask(queuedRun.taskId, err)
        }
      }

      return firstTaskId
    },

    runTemporaryFunctionAtPosition: async (functionDef, inputValues, position, runCount, options) => {
      if (!get().project.functions[functionDef.id]) temporaryFunctionDrafts.set(functionDef.id, functionDef)
      return await get().runFunctionAtPosition(functionDef.id, inputValues, position, runCount, options)
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
              if (!input || (input.type !== 'text' && input.type !== 'number' && input.type !== 'boolean')) return node

              const normalizedValue =
                input.type === 'number' ? Number(value) : input.type === 'boolean' ? Boolean(value) : String(value ?? '')
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
          inputValuesSnapshot: executionInputSnapshot(functionDef, inputValues, state.project.resources),
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
        } else if (input.key in primitiveInputs && (input.type === 'text' || input.type === 'number' || input.type === 'boolean')) {
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
        inputValuesSnapshot: executionInputSnapshot(functionDef, inputValues, state.project.resources),
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

      const functionDef = functionDefinitionForTask(task)
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
        (endpoint) => endpointIsWorkerEligible(endpoint) && endpointCanRunFunctionDefinition(endpoint, functionDef),
      )
      if (workerEndpoints.length === 0) {
        failResultRunInPlace(resultNodeId, taskId, 'endpoint_unavailable', endpointUnavailableMessageForFunction(functionDef))
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

    deleteNodes: (nodeIds) => {
      const now = runtime.now()
      set((state) => deleteNodesFromState(state, nodeIds, now))
    },

    groupSelectedNodes: (options) => {
      const state = get()
      const selectedIds = options?.nodeIds?.length
        ? uniqueIds(options.nodeIds)
        : state.selectedNodeIds.length
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
      const bounds = groupBoundsForNodes(childNodes, state.project.functions, options?.nodeSizesById)
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
          createdAt: now,
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
      const selectedResourceIds = new Set(resourceIds)
      const resources = Object.fromEntries(
        resourceIds
          .map((resourceId) => state.project.resources[resourceId])
          .filter((resource): resource is Resource => Boolean(resource))
          .map((resource) => [resource.id, structuredClone(resource)]),
      )
      const tasks = Object.fromEntries(
        Object.entries(state.project.tasks)
          .filter(([taskId, task]) => {
            const isDirectResourceTask = Object.values(resources).some((resource) => resource.source.taskId === taskId)
            return isDirectResourceTask || resourceIdsForTask(task).some((resourceId) => selectedResourceIds.has(resourceId))
          })
          .map(([taskId, task]) => [taskId, structuredClone(task)]),
      )
      const functions = Object.fromEntries(
        uniqueIds(Object.values(tasks).map((task) => task.functionId))
          .map((functionId) => {
            const task = Object.values(tasks).find((item) => item.functionId === functionId)
            const functionDef = task ? functionSnapshotForTemplateTask(state.project, task, resources) : undefined
            return functionDef ? [functionId, structuredClone(functionDef)] : undefined
          })
          .filter((entry): entry is [string, GenerationFunction] => Boolean(entry)),
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
        functions,
        tasks,
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
      const taskIdMap = new Map<string, string>()
      const clonedResources: Record<string, Resource> = {}
      const clonedAssets: Record<string, NonNullable<CanvasTemplate['assets'][string]>> = {}

      for (const resource of Object.values(template.resources)) {
        const nextResourceId = runtime.idFactory()
        resourceIdMap.set(resource.id, nextResourceId)
      }
      for (const taskId of Object.keys(template.tasks ?? {})) taskIdMap.set(taskId, runtime.idFactory())
      for (const node of template.nodes) {
        if (node.type === 'resource' && typeof node.data.resourceId === 'string') {
          const nextResourceId = resourceIdMap.get(node.data.resourceId)
          nodeIdMap.set(node.id, nextResourceId ? `node_${nextResourceId}` : `node_${runtime.idFactory()}`)
        } else {
          nodeIdMap.set(node.id, `node_${runtime.idFactory()}`)
        }
      }

      const clonedNodes = template.nodes.map((node) => {
        const clonedNode = structuredClone(node)
        if (node.type === 'resource' && typeof node.data.resourceId === 'string') {
          const nextResourceId = resourceIdMap.get(node.data.resourceId)
          clonedNode.data = {
            ...clonedNode.data,
            resourceId: nextResourceId ?? clonedNode.data.resourceId,
          }
        }
        const nextNodeId = nodeIdMap.get(node.id) ?? `node_${runtime.idFactory()}`
        clonedNode.id = nextNodeId
        if (Array.isArray(clonedNode.data.childNodeIds)) {
          clonedNode.data = {
            ...clonedNode.data,
            childNodeIds: clonedNode.data.childNodeIds
              .map((childNodeId) => (typeof childNodeId === 'string' ? nodeIdMap.get(childNodeId) : undefined))
              .filter((childNodeId): childNodeId is string => Boolean(childNodeId)),
          }
        }
        if (typeof clonedNode.data.taskId === 'string' && taskIdMap.has(clonedNode.data.taskId)) {
          clonedNode.data = { ...clonedNode.data, taskId: taskIdMap.get(clonedNode.data.taskId) }
        }
        if (typeof clonedNode.data.sourceFunctionNodeId === 'string' && nodeIdMap.has(clonedNode.data.sourceFunctionNodeId)) {
          clonedNode.data = { ...clonedNode.data, sourceFunctionNodeId: nodeIdMap.get(clonedNode.data.sourceFunctionNodeId) }
        }
        if (Array.isArray(clonedNode.data.resources)) {
          clonedNode.data = {
            ...clonedNode.data,
            resources: clonedNode.data.resources.map((resource) =>
              typeof resource === 'object' && resource !== null && 'resourceId' in resource
                ? {
                    ...resource,
                    resourceId: resourceIdMap.get(String((resource as { resourceId: unknown }).resourceId)) ?? String((resource as { resourceId: unknown }).resourceId),
                  }
                : resource,
            ),
          }
        }
        clonedNode.position = {
          x: node.position.x + offset.x,
          y: node.position.y + offset.y,
        }
        return clonedNode
      })

      for (const resource of Object.values(template.resources)) {
        const nextResourceId = resourceIdMap.get(resource.id)
        if (!nextResourceId) continue
        const originalAssetId = mediaAssetId(resource)
        const value = structuredClone(resource.value)
        if (originalAssetId && typeof value === 'object' && value !== null && 'assetId' in value) {
          const sourceAsset = template.assets[originalAssetId]
          if (sourceAsset) {
            const nextAssetId = runtime.idFactory()
            ;(value as { assetId: string }).assetId = nextAssetId
            clonedAssets[nextAssetId] = {
              ...structuredClone(sourceAsset),
              id: nextAssetId,
              createdAt: now,
            }
          }
        }
        const taskId = resource.source.taskId ? taskIdMap.get(resource.source.taskId) : undefined
        const source =
          resource.source.kind === 'function_output' && taskId
            ? {
                ...resource.source,
                taskId,
                functionNodeId: resource.source.functionNodeId
                  ? nodeIdMap.get(resource.source.functionNodeId) ?? resource.source.functionNodeId
                  : undefined,
                resultGroupNodeId: resource.source.resultGroupNodeId
                  ? nodeIdMap.get(resource.source.resultGroupNodeId) ?? resource.source.resultGroupNodeId
                  : undefined,
              }
            : {
                kind: 'duplicated' as const,
                parentResourceId: resource.id,
              }
        clonedResources[nextResourceId] = {
          ...structuredClone(resource),
          id: nextResourceId,
          name: `${resource.name ?? 'Resource'} Copy`,
          value,
          source,
          metadata: {
            ...resource.metadata,
            functionSnapshot: resource.metadata?.functionSnapshot
              ? structuredClone(resource.metadata.functionSnapshot)
              : resource.metadata?.workflowFunctionId
                ? structuredClone(template.functions?.[resource.metadata.workflowFunctionId])
                : undefined,
            createdAt: now,
          },
        }
      }

      const remapResourceRef = (ref: ResourceRef): ResourceRef => ({
        ...ref,
        resourceId: resourceIdMap.get(ref.resourceId) ?? ref.resourceId,
      })
      const remapInputRef = (ref: InputResourceRef): InputResourceRef => {
        if (isResourceRef(ref)) return remapResourceRef(ref)
        if (isPendingResourceRef(ref)) {
          return {
            ...ref,
            pendingTaskId: taskIdMap.get(ref.pendingTaskId) ?? ref.pendingTaskId,
          }
        }
        return ref
      }
      const remapInputSnapshot = (snapshot: ExecutionInputSnapshot): ExecutionInputSnapshot => ({
        ...structuredClone(snapshot),
        ...(snapshot.resourceId ? { resourceId: resourceIdMap.get(snapshot.resourceId) ?? snapshot.resourceId } : {}),
        ...(snapshot.pendingTaskId ? { pendingTaskId: taskIdMap.get(snapshot.pendingTaskId) ?? snapshot.pendingTaskId } : {}),
      })
      const remapTaskResourceSnapshot = (resource: Resource) => {
        const nextResourceId = resourceIdMap.get(resource.id)
        return nextResourceId && clonedResources[nextResourceId] ? structuredClone(clonedResources[nextResourceId]) : structuredClone(resource)
      }
      const clonedTasks: Record<string, ExecutionTask> = Object.fromEntries(
        Object.entries(template.tasks ?? {}).map(([taskId, task]) => {
          const nextTaskId = taskIdMap.get(taskId) ?? runtime.idFactory()
          return [
            nextTaskId,
            {
              ...structuredClone(task),
              id: nextTaskId,
              functionNodeId: nodeIdMap.get(task.functionNodeId) ?? task.functionNodeId,
              inputRefs: Object.fromEntries(Object.entries(task.inputRefs ?? {}).map(([key, ref]) => [key, remapInputRef(ref)])),
              inputSnapshot: Object.fromEntries(
                Object.entries(task.inputSnapshot ?? {}).map(([key, resource]) => [key, remapTaskResourceSnapshot(resource)]),
              ),
              inputValuesSnapshot: task.inputValuesSnapshot
                ? Object.fromEntries(Object.entries(task.inputValuesSnapshot).map(([key, snapshot]) => [key, remapInputSnapshot(snapshot)]))
                : undefined,
              functionSnapshot: task.functionSnapshot
                ? structuredClone(task.functionSnapshot)
                : task.functionId
                  ? structuredClone(template.functions?.[task.functionId])
                  : undefined,
              outputRefs: Object.fromEntries(
                Object.entries(task.outputRefs ?? {}).map(([key, refs]) => [key, refs.map((ref) => remapResourceRef(ref))]),
              ),
            },
          ]
        }),
      )

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
      const initialBounds = groupBoundsForNodes(clonedNodes, state.project.functions)
      const placedGroupPosition = nonOverlappingNodePosition(
        state.project.canvas.nodes,
        state.project.functions,
        initialBounds.position,
        initialBounds.size,
      )
      const placementDelta = {
        x: placedGroupPosition.x - initialBounds.position.x,
        y: placedGroupPosition.y - initialBounds.position.y,
      }
      const placedClonedNodes = clonedNodes.map((node) =>
        markNewCanvasNode(
          {
            ...node,
            position: {
              x: node.position.x + placementDelta.x,
              y: node.position.y + placementDelta.y,
            },
          },
          now,
        ),
      )
      const bounds = groupBoundsForNodes(placedClonedNodes, state.project.functions)
      const childNodeIds = clonedNodes.map((node) => node.id)
      const groupNode: CanvasNode = markNewCanvasNode(
        {
          id: groupNodeId,
          type: 'group',
          position: bounds.position,
          data: {
            title: template.name,
            childNodeIds,
            collapsed: false,
            color: '#14b8a6',
            size: bounds.size,
            createdAt: now,
          },
        },
        now,
      )

      set((current) => {
        const nextProject = {
          ...ensureProjectHistory(current.project),
          project: { ...current.project.project, updatedAt: now },
          assets: { ...current.project.assets, ...clonedAssets },
          resources: { ...current.project.resources, ...clonedResources },
          functions: { ...(template.functions ?? {}), ...current.project.functions },
          tasks: { ...current.project.tasks, ...clonedTasks },
          canvas: {
            ...current.project.canvas,
            nodes: [...current.project.canvas.nodes, ...placedClonedNodes, groupNode],
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

    addEndpoint: (patch) => {
      const endpointId = runtime.idFactory()
      const now = runtime.now()
      const baseEndpoint: ComfyEndpointConfig = {
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
      const endpoint: ComfyEndpointConfig = { ...baseEndpoint, ...patch, id: endpointId, health: { status: 'unknown' } }

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
      ensureComfyWorkers()
      return endpointId
    },

    updateEndpoint: (endpointId, patch) => {
      invalidateBrowserComfyProxyEndpoint(endpointId)
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
      invalidateBrowserComfyProxyEndpoint(endpointId)
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
      const importedProject = withRuntimeHistory(withBuiltInFunctions(payload.project, now))
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

const persistentProjectSnapshot = (project: ProjectState): ProjectState => {
  const baseProject = withoutBuiltInProjectFunctions(project)
  delete baseProject.history
  return {
    ...baseProject,
    comfy: {
      ...baseProject.comfy,
      endpoints: baseProject.comfy.endpoints.map((endpoint) => {
        const persistentEndpoint = { ...endpoint }
        delete persistentEndpoint.health
        return persistentEndpoint
      }),
    },
  }
}

const serializeProjectLibrary = (state: ProjectStoreState): ProjectLibraryPackage => {
  const projects = {
    ...state.projectLibrary,
    [state.project.project.id]: state.project,
  }
  return {
    currentProjectId: state.project.project.id,
    projects: Object.fromEntries(
      Object.entries(projects).map(([projectId, project]) => [projectId, persistentProjectSnapshot(project)]),
    ),
  }
}

const serializedProjectLibraryKey = (state: ProjectStoreState) => JSON.stringify(serializeProjectLibrary(state))

const loadProjectLibrary = (
  payload: ProjectLibraryPackage | undefined,
  now: string,
  applyState: (state: Partial<ProjectStoreState>) => void = (state) => projectStore.setState(state),
) => {
  const projectEntries = Object.entries(payload?.projects ?? {})
  if (projectEntries.length === 0) return false

  const projects = Object.fromEntries(
    projectEntries.map(([projectId, project]) => [projectId, withRuntimeHistory(withBuiltInFunctions(project, now))]),
  ) as Record<string, ProjectState>
  const activeProject = projects[payload?.currentProjectId ?? ''] ?? Object.values(projects)[0]
  if (!activeProject) return false

  applyState({
    project: activeProject,
    projectLibrary: projects,
    ...selectedState([]),
  })
  return true
}

const loadIndexedDbProjectLibrary = (
  applyState: (state: Partial<ProjectStoreState>) => void = (state) => projectStore.setState(state),
) =>
  getIdb<ProjectLibraryPackage>(PROJECT_LIBRARY_STORAGE_KEY)
    .then(async (savedLibrary) => {
      const now = new Date().toISOString()
      if (loadProjectLibrary(savedLibrary, now, applyState)) return

      const savedProject = await getIdb<ProjectState>(PROJECT_STORAGE_KEY)
      if (!savedProject) return
      const project = withRuntimeHistory(withBuiltInFunctions(savedProject, now))
      applyState({
        project,
        projectLibrary: { [project.project.id]: project },
        ...selectedState([]),
      })
    })
    .catch(() => undefined)

const startIndexedDbProjectPersistence = () => {
  let saveTimer: number | undefined
  let loadSettled = false
  let suppressSaveScheduling = false
  let lastSavedLibraryKey: string | undefined
  let scheduledLibraryKey: string | undefined
  let saveInFlight = false

  projectStore.setState({ projectPersistenceReady: false })

  const applyWithoutSchedulingSave = (state: Partial<ProjectStoreState>) => {
    suppressSaveScheduling = true
    projectStore.setState(state)
    suppressSaveScheduling = false
  }

  const applyLoadedState = (state: Partial<ProjectStoreState>) => {
    applyWithoutSchedulingSave(state)
  }

  const scheduleSaveProjectLibrary = (state: ProjectStoreState) => {
    if (suppressSaveScheduling) return
    if (!loadSettled) return

    const nextLibraryKey = serializedProjectLibraryKey(state)
    if (nextLibraryKey === lastSavedLibraryKey) return
    if (saveTimer !== undefined && nextLibraryKey === scheduledLibraryKey) return

    if (saveTimer !== undefined) window.clearTimeout(saveTimer)
    scheduledLibraryKey = nextLibraryKey
    saveTimer = window.setTimeout(() => {
      saveTimer = undefined
      scheduledLibraryKey = undefined
      runProjectLibrarySave(state)
    }, PROJECT_PERSIST_IDLE_MS)
  }

  const saveProjectLibrary = async (state: ProjectStoreState) => {
    const nextLibrary = serializeProjectLibrary(state)
    const nextLibraryKey = JSON.stringify(nextLibrary)
    if (nextLibraryKey === lastSavedLibraryKey) return true
    try {
      await Promise.all([setIdb(PROJECT_STORAGE_KEY, persistentProjectSnapshot(state.project)), setIdb(PROJECT_LIBRARY_STORAGE_KEY, nextLibrary)])
      lastSavedLibraryKey = nextLibraryKey
      return true
    } catch {
      return false
    }
  }

  const runProjectLibrarySave = (state: ProjectStoreState) => {
    if (saveInFlight) return
    saveInFlight = true
    void saveProjectLibrary(state).then(() => {
      saveInFlight = false
      const currentState = projectStore.getState()
      if (serializedProjectLibraryKey(currentState) !== lastSavedLibraryKey) {
        scheduleSaveProjectLibrary(currentState)
      }
    })
  }

  void loadIndexedDbProjectLibrary(applyLoadedState).finally(() => {
    loadSettled = true
    lastSavedLibraryKey = serializedProjectLibraryKey(projectStore.getState())
    applyWithoutSchedulingSave({ projectPersistenceReady: true })
  })

  projectStore.subscribe((state) => scheduleSaveProjectLibrary(state))

  window.addEventListener('beforeunload', () => {
    if (!loadSettled) return
    if (saveTimer !== undefined) window.clearTimeout(saveTimer)
    runProjectLibrarySave(projectStore.getState())
  })
}

const startDesktopProjectPersistence = (storage: DesktopProjectStorage) => {
  let saveTimer: number | undefined
  let loadSettled = false
  let suppressSaveScheduling = false
  let lastSavedLibraryKey: string | undefined
  let scheduledLibraryKey: string | undefined
  let saveInFlight = false

  projectStore.setState({ projectPersistenceReady: false })

  const applyWithoutSchedulingSave = (state: Partial<ProjectStoreState>) => {
    suppressSaveScheduling = true
    projectStore.setState(state)
    suppressSaveScheduling = false
  }

  const applyLoadedState = (state: Partial<ProjectStoreState>) => {
    applyWithoutSchedulingSave(state)
  }

  const scheduleSaveProjectLibrary = (state: ProjectStoreState) => {
    if (suppressSaveScheduling) return
    if (!loadSettled) return

    const nextLibraryKey = serializedProjectLibraryKey(state)
    if (nextLibraryKey === lastSavedLibraryKey) return
    if (saveTimer !== undefined && nextLibraryKey === scheduledLibraryKey) return

    if (saveTimer !== undefined) window.clearTimeout(saveTimer)
    scheduledLibraryKey = nextLibraryKey
    saveTimer = window.setTimeout(() => {
      saveTimer = undefined
      scheduledLibraryKey = undefined
      runProjectLibrarySave(state)
    }, PROJECT_PERSIST_IDLE_MS)
  }

  const saveProjectLibrary = async (state: ProjectStoreState) => {
    const nextLibrary = serializeProjectLibrary(state)
    const nextLibraryKey = JSON.stringify(nextLibrary)
    if (nextLibraryKey === lastSavedLibraryKey) return true
    try {
      const result = await storage.saveProjectLibrary(nextLibrary)
      if (!result?.ok) return false
      lastSavedLibraryKey = nextLibraryKey
      return true
    } catch {
      return false
    }
  }

  const runProjectLibrarySave = (state: ProjectStoreState) => {
    if (saveInFlight) return
    saveInFlight = true
    void saveProjectLibrary(state).then(() => {
      saveInFlight = false
      const currentState = projectStore.getState()
      if (serializedProjectLibraryKey(currentState) !== lastSavedLibraryKey) {
        scheduleSaveProjectLibrary(currentState)
      }
    })
  }

  void storage
    .loadProjectLibrary()
    .then((savedLibrary) => {
      const now = new Date().toISOString()
      loadProjectLibrary(savedLibrary, now, applyLoadedState)
      loadSettled = true
      lastSavedLibraryKey = serializedProjectLibraryKey(projectStore.getState())
      applyWithoutSchedulingSave({ projectPersistenceReady: true })
    })
    .catch(() => {
      loadSettled = true
      lastSavedLibraryKey = serializedProjectLibraryKey(projectStore.getState())
      applyWithoutSchedulingSave({ projectPersistenceReady: true })
    })

  projectStore.subscribe((state) => scheduleSaveProjectLibrary(state))

  window.addEventListener('beforeunload', () => {
    if (!loadSettled) return
    if (saveTimer !== undefined) window.clearTimeout(saveTimer)
    runProjectLibrarySave(projectStore.getState())
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
