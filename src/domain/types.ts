export type ResourceType = 'text' | 'number' | 'image' | 'video' | 'audio'

export type ResourceSourceKind =
  | 'user_upload'
  | 'manual_input'
  | 'function_output'
  | 'imported'
  | 'duplicated'
  | 'extracted_from_video'
  | 'converted_from_images'
  | 'extracted_from_audio'
  | 'converted_from_text'

export type AssetRecord = {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  blobUrl?: string
  createdAt: string
}

export type MediaResourceValue = {
  assetId: string
  url: string
  filename?: string
  mimeType: string
  sizeBytes: number
  width?: number
  height?: number
  durationMs?: number
  thumbnailUrl?: string
  comfy?: {
    endpointId: string
    filename: string
    subfolder?: string
    type: string
  }
}

export type Resource = {
  id: string
  type: ResourceType
  name?: string
  value: string | number | MediaResourceValue
  source: {
    kind: ResourceSourceKind
    functionNodeId?: string
    resultGroupNodeId?: string
    taskId?: string
    outputKey?: string
    parentResourceId?: string
  }
  metadata?: {
    prompt?: string
    seed?: number
    workflowFunctionId?: string
    endpointId?: string
    createdAt: string
  }
}

export type ResourceRef = {
  resourceId: string
  type: ResourceType
}

export type PrimitiveInputValue = string | number | null

export type ExecutionInputSnapshot = {
  key: string
  label: string
  type: ResourceType
  required: boolean
  source: 'resource' | 'inline' | 'default' | 'missing'
  value: Resource['value'] | PrimitiveInputValue
  resourceId?: string
  resourceName?: string
}

export type WorkflowNode = {
  class_type?: string
  _meta?: {
    title?: string
  }
  inputs?: Record<string, unknown>
  [key: string]: unknown
}

export type ComfyWorkflow = Record<string, WorkflowNode>

export type SeedPatchRecord = {
  nodeId: string
  nodeTitle?: string
  nodeClassType?: string
  path: string
  oldValue: unknown
  newValue: number
  patchedAt: string
}

export type FunctionInputDef = {
  key: string
  label: string
  description?: string
  type: ResourceType
  required: boolean
  defaultValue?: string | number | null
  bind: {
    nodeId?: string
    nodeTitle?: string
    field?: string
    path: string
    requestTarget?: 'url_param' | 'header' | 'body'
  }
  upload?: {
    strategy: 'comfy_upload' | 'comfy_input_path' | 'custom_endpoint' | 'manual_path' | 'none'
    targetSubfolder?: string
    customUploadUrl?: string
  }
}

export type FunctionOutputDef = {
  key: string
  label: string
  type: ResourceType
  bind: {
    nodeId?: string
    nodeTitle?: string
    field?: string
    path?: string
  }
  extract: {
    source:
      | 'history'
      | 'node_output'
      | 'final_images'
      | 'final_videos'
      | 'final_audios'
      | 'file_output'
      | 'response_text_regex'
      | 'response_json_path'
      | 'response_binary'
    index?: number
    multiple?: boolean
    pattern?: string
    path?: string
  }
}

export type OpenAIMessageRole = 'system' | 'developer' | 'user' | 'assistant'
export type OpenAIMessageContentType = 'text' | 'image_url'
export type OpenAIImageDetail = 'auto' | 'low' | 'high'

export type OpenAILlmContentPart = {
  type: OpenAIMessageContentType
  content: string
  detail?: OpenAIImageDetail
}

export type OpenAILlmMessage = {
  role: OpenAIMessageRole
  content: OpenAILlmContentPart[]
}

export type OpenAILlmConfig = {
  baseUrl: string
  apiKey: string
  model: string
  messages: OpenAILlmMessage[]
}

export type OpenAIImageSize = 'auto' | '1024x1024' | '1024x1536' | '1536x1024'
export type OpenAIImageQuality = 'auto' | 'low' | 'medium' | 'high'
export type OpenAIImageBackground = 'auto' | 'transparent' | 'opaque'
export type OpenAIImageOutputFormat = 'png' | 'jpeg' | 'webp'

export type OpenAIImageConfig = {
  baseUrl: string
  apiKey: string
  model: string
  size: OpenAIImageSize
  quality: OpenAIImageQuality
  background: OpenAIImageBackground
  outputFormat: OpenAIImageOutputFormat
  outputCompression: number
  user?: string
}

export type GeminiMessageRole = 'system' | 'user' | 'model'
export type GeminiLlmContentPart = {
  type: OpenAIMessageContentType
  content: string
  detail?: OpenAIImageDetail
}

export type GeminiLlmMessage = {
  role: GeminiMessageRole
  content: GeminiLlmContentPart[]
}

export type GeminiLlmConfig = {
  baseUrl: string
  apiKey: string
  model: string
  messages: GeminiLlmMessage[]
}

export type GeminiImageResponseModalities = 'IMAGE' | 'TEXT_IMAGE'
export type GeminiImageAspectRatio = 'auto' | '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
export type GeminiImageSize = 'auto' | '1K' | '2K' | '4K'

export type GeminiImageConfig = {
  baseUrl: string
  apiKey: string
  model: string
  responseModalities: GeminiImageResponseModalities
  aspectRatio: GeminiImageAspectRatio
  imageSize: GeminiImageSize
}

export type RequestFunctionConfig = {
  url: string
  method: string
  headers: Record<string, string>
  body: string
  responseParse: 'text' | 'json' | 'binary'
  responseEncoding: string
}

export type GenerationFunction = {
  id: string
  name: string
  description?: string
  category?: string
  workflow: {
    format:
      | 'comfyui_api_json'
      | 'openai_chat_completions'
      | 'openai_responses'
      | 'gemini_generate_content'
      | 'openai_image_generation'
      | 'gemini_image_generation'
      | 'http_request'
    version?: string
    rawJson: ComfyWorkflow
  }
  openai?: OpenAILlmConfig
  gemini?: GeminiLlmConfig
  openaiImage?: OpenAIImageConfig
  geminiImage?: GeminiImageConfig
  request?: RequestFunctionConfig
  inputs: FunctionInputDef[]
  outputs: FunctionOutputDef[]
  runtimeDefaults?: {
    runCount: number
    seedPolicy: {
      mode: 'randomize_all_before_submit'
    }
  }
  createdAt: string
  updatedAt: string
}

export type CanvasNodeKind = 'resource' | 'function' | 'result_group' | 'group'

export type CanvasNode = {
  id: string
  type: CanvasNodeKind
  position: { x: number; y: number }
  data: Record<string, unknown>
}

export type CanvasEdge = {
  id: string
  source: {
    nodeId: string
    handleId: string
    resourceId?: string
    outputKey?: string
  }
  target: {
    nodeId: string
    inputKey: string
  }
  type: 'resource_to_input'
}

export type CanvasState = {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  viewport: {
    x: number
    y: number
    zoom: number
  }
}

export type ComfyEndpointConfig = {
  id: string
  name: string
  baseUrl: string
  enabled: boolean
  maxConcurrentJobs: number
  priority: number
  tags?: string[]
  timeoutMs: number
  auth?: {
    type: 'none' | 'token' | 'basic'
    token?: string
    username?: string
    password?: string
    exportSecret?: boolean
  }
  customHeaders?: Record<string, string>
  capabilities?: {
    supportedFunctions?: string[]
    requiredModels?: string[]
    requiredNodes?: string[]
  }
  health?: {
    status: 'unknown' | 'online' | 'offline' | 'cors_error' | 'mixed_content' | 'auth_error'
    lastCheckedAt?: string
    message?: string
  }
}

export type SchedulerConfig = {
  strategy: 'least_busy' | 'priority' | 'round_robin'
  retry: {
    maxAttempts: number
    fallbackToOtherEndpoint: boolean
  }
}

export type ExecutionTask = {
  id: string
  functionNodeId: string
  functionId: string
  runIndex: number
  runTotal: number
  status:
    | 'created'
    | 'waiting_endpoint'
    | 'validating'
    | 'compiling_workflow'
    | 'uploading_assets'
    | 'randomizing_seeds'
    | 'queued'
    | 'running'
    | 'fetching_outputs'
    | 'succeeded'
    | 'failed'
    | 'canceled'
  inputRefs: Record<string, ResourceRef>
  inputSnapshot: Record<string, Resource>
  inputValuesSnapshot?: Record<string, ExecutionInputSnapshot>
  paramsSnapshot: Record<string, unknown>
  workflowTemplateSnapshot: ComfyWorkflow
  compiledWorkflowSnapshot: ComfyWorkflow
  requestSnapshot?: unknown
  seedPatchLog: SeedPatchRecord[]
  endpointId?: string
  comfyPromptId?: string
  outputRefs: Record<string, ResourceRef[]>
  error?: {
    code: string
    message: string
    raw?: unknown
  }
  createdAt: string
  startedAt?: string
  updatedAt: string
  completedAt?: string
}

export type ProjectState = {
  schemaVersion: string
  project: {
    id: string
    name: string
    description?: string
    createdAt: string
    updatedAt: string
  }
  canvas: CanvasState
  resources: Record<string, Resource>
  assets: Record<string, AssetRecord>
  functions: Record<string, GenerationFunction>
  tasks: Record<string, ExecutionTask>
  comfy: {
    endpoints: ComfyEndpointConfig[]
    scheduler: SchedulerConfig
  }
}
