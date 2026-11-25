import { defaultGeminiImageConfig, mergedGeminiImageConfig, MAX_REFERENCE_IMAGES } from './geminiImage'
import { mergedGeminiLlmConfig } from './geminiLlm'
import {
  deepMerge,
  defaultParamValues,
  paramsFor,
  parseCustomParams,
  reconcileParams,
  requestOverlay,
  setPath,
  type ModelKind,
} from './modelCatalog'
import { defaultOpenAIImageConfig, mergedOpenAIImageConfig } from './openaiImage'
import { defaultOpenAILlmConfig, mergedOpenAILlmConfig } from './openaiLlm'
import type {
  GeminiLlmMessage,
  GenerationFunction,
  LlmModelConfig,
  OpenAIImageOutputFormat,
  OpenAILlmMessage,
  ProviderApiFormat,
  ProviderModelConfig,
} from './types'

/** One "Image" and one "LLM" built-in: the model's catalog entry (or the chosen API format) decides which API is called. */
export const IMAGE_FUNCTION_ID = 'fn_image'
export const LLM_FUNCTION_ID = 'fn_llm'

const DEFAULT_IMAGE_MODEL = 'gpt-image-2.6-sunburst'
const DEFAULT_LLM_MODEL = 'gpt-6.2-astra'

export const defaultBaseUrl = (format: ProviderApiFormat) =>
  format === 'gemini' ? defaultGeminiImageConfig().baseUrl : defaultOpenAIImageConfig().baseUrl

export const isImageFunction = (fn: GenerationFunction) => fn.workflow.format === 'image_generation'
export const isLlmFunction = (fn: GenerationFunction) => fn.workflow.format === 'llm_chat'

export const defaultImageModelConfig = (): ProviderModelConfig => ({
  apiFormat: 'openai',
  model: DEFAULT_IMAGE_MODEL,
  baseUrl: '',
  apiKey: '',
  params: defaultParamValues(paramsFor('image', DEFAULT_IMAGE_MODEL, 'openai').params),
  customParams: '',
})

export const defaultLlmModelConfig = (): LlmModelConfig => ({
  apiFormat: 'openai',
  model: DEFAULT_LLM_MODEL,
  baseUrl: '',
  apiKey: '',
  params: defaultParamValues(paramsFor('llm', DEFAULT_LLM_MODEL, 'openai').params),
  customParams: '',
  messages: defaultOpenAILlmConfig().messages,
})

const runtimeDefaults = () => ({ runCount: 1, seedPolicy: { mode: 'randomize_all_before_submit' as const } })

const imageInputs = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, index) => ({
    key: `image_${index + 1}`,
    label: `Image ${index + 1}`,
    type: 'image' as const,
    required: false,
    bind: { path: `${prefix}.images.${index + 1}` },
    upload: { strategy: 'none' as const },
  }))

export function createImageFunction(now: string): GenerationFunction {
  return {
    id: IMAGE_FUNCTION_ID,
    name: 'Image',
    description: 'Image generation (OpenAI Images API or Gemini generateContent, chosen by the model)',
    category: 'Image',
    workflow: { format: 'image_generation', rawJson: {} },
    image: defaultImageModelConfig(),
    inputs: [
      {
        key: 'prompt',
        label: 'Prompt',
        type: 'text',
        required: true,
        defaultValue: 'A high quality product image',
        bind: { path: 'prompt' },
        upload: { strategy: 'none' },
      },
      ...imageInputs(MAX_REFERENCE_IMAGES, 'image'),
    ],
    outputs: [{ key: 'image', label: 'Image', type: 'image', bind: { path: 'images.0' }, extract: { source: 'node_output' } }],
    runtimeDefaults: runtimeDefaults(),
    createdAt: now,
    updatedAt: now,
  }
}

export function createLlmFunction(
  now: string,
  options: { id?: string; name?: string; config?: Partial<LlmModelConfig> } = {},
): GenerationFunction {
  return {
    id: options.id ?? LLM_FUNCTION_ID,
    name: options.name ?? 'LLM',
    description: 'Multimodal text generation (OpenAI Chat Completions or Gemini generateContent, chosen by the model)',
    category: 'LLM',
    workflow: { format: 'llm_chat', rawJson: {} },
    llm: { ...defaultLlmModelConfig(), ...options.config },
    inputs: imageInputs(6, 'llm'),
    outputs: [{ key: 'text', label: 'Text', type: 'text', bind: { path: 'text' }, extract: { source: 'node_output' } }],
    runtimeDefaults: runtimeDefaults(),
    createdAt: now,
    updatedAt: now,
  }
}

/** Why the custom-parameter JSON can't be used (the run is blocked until it is fixed), if it can't. */
export const customParamsError = (config: ProviderModelConfig | undefined) =>
  config ? parseCustomParams(config.customParams ?? '').error : undefined

/** The request fields a model config adds on top of the base request: catalog parameters, then custom JSON (wins). */
export function providerRequestOverlay(kind: ModelKind, config: ProviderModelConfig): Record<string, unknown> {
  const specs = paramsFor(kind, config.model, config.apiFormat).params
  return deepMerge(requestOverlay(specs, config.params ?? {}), parseCustomParams(config.customParams ?? '').value)
}

const providerFields = ['image', 'llm', 'openai', 'gemini', 'openaiImage', 'geminiImage'] as const

const withoutProviderFields = (fn: GenerationFunction): GenerationFunction => {
  const rest = { ...fn }
  for (const field of providerFields) delete rest[field]
  return rest
}

const openAiOutputFormats: OpenAIImageOutputFormat[] = ['png', 'jpeg', 'webp']

/** Unified Image / LLM function → the legacy provider format the executors run. Other functions are returned as is. */
export function compileProviderFunction(fn: GenerationFunction): GenerationFunction {
  if (isImageFunction(fn)) {
    const config: ProviderModelConfig = { ...defaultImageModelConfig(), ...fn.image }
    const overlay = providerRequestOverlay('image', config)
    const base = config.baseUrl.trim() || defaultBaseUrl(config.apiFormat)
    const rest = withoutProviderFields(fn)
    if (config.apiFormat === 'gemini') {
      return {
        ...rest,
        workflow: { ...fn.workflow, format: 'gemini_image_generation' },
        geminiImage: {
          baseUrl: base,
          apiKey: config.apiKey,
          model: config.model,
          responseModalities: 'IMAGE',
          aspectRatio: 'auto',
          imageSize: 'auto',
          extraBody: overlay,
          unified: config,
        },
      }
    }
    const format = overlay.output_format as OpenAIImageOutputFormat
    return {
      ...rest,
      workflow: { ...fn.workflow, format: 'openai_image_generation' },
      openaiImage: {
        baseUrl: base,
        apiKey: config.apiKey,
        model: config.model,
        size: 'auto',
        quality: 'auto',
        background: 'auto',
        outputFormat: openAiOutputFormats.includes(format) ? format : 'png',
        outputCompression: 100,
        extraBody: overlay,
        unified: config,
      },
    }
  }
  if (isLlmFunction(fn)) {
    const config: LlmModelConfig = { ...defaultLlmModelConfig(), ...fn.llm }
    const overlay = providerRequestOverlay('llm', config)
    const base = config.baseUrl.trim() || defaultBaseUrl(config.apiFormat)
    const rest = withoutProviderFields(fn)
    if (config.apiFormat === 'gemini') {
      return {
        ...rest,
        workflow: { ...fn.workflow, format: 'gemini_generate_content' },
        gemini: {
          baseUrl: base,
          apiKey: config.apiKey,
          model: config.model,
          messages: config.messages.map(
            (message): GeminiLlmMessage => ({
              role: message.role === 'assistant' ? 'model' : message.role === 'developer' ? 'system' : message.role,
              content: message.content,
            }),
          ),
          extraBody: overlay,
          unified: config,
        },
      }
    }
    return {
      ...rest,
      workflow: { ...fn.workflow, format: 'openai_chat_completions' },
      openai: { baseUrl: base, apiKey: config.apiKey, model: config.model, messages: config.messages, extraBody: overlay, unified: config },
    }
  }
  return fn
}

const legacyKinds: Record<string, { kind: ModelKind; apiFormat: ProviderApiFormat }> = {
  openai_image_generation: { kind: 'image', apiFormat: 'openai' },
  gemini_image_generation: { kind: 'image', apiFormat: 'gemini' },
  openai_chat_completions: { kind: 'llm', apiFormat: 'openai' },
  gemini_generate_content: { kind: 'llm', apiFormat: 'gemini' },
}

export const isLegacyProviderFunction = (fn: GenerationFunction) => fn.workflow.format in legacyKinds

const trimSlashes = (url: string) => url.trim().replace(/\/+$/, '')

/**
 * Legacy settings → catalog parameters where the model's catalog entry has that request field and accepts the value;
 * everything else goes to the custom-parameter JSON at the same request path, so the request stays the same.
 */
const placeSettings = (
  kind: ModelKind,
  model: string,
  apiFormat: ProviderApiFormat,
  settings: Array<[field: string, value: unknown]>,
) => {
  const specs = paramsFor(kind, model, apiFormat).params
  const params: Record<string, string | number | boolean> = {}
  const custom: Record<string, unknown> = {}
  for (const [field, value] of settings) {
    const spec = specs.find((item) => item.field === field)
    const scalar = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    if (spec && scalar && reconcileParams([spec], { [spec.id]: value }).changed.length === 0) params[spec.id] = value
    else setPath(custom, field, value)
  }
  return { params, customParams: Object.keys(custom).length ? JSON.stringify(custom, null, 2) : '' }
}

/** Legacy OpenAI / Gemini Image / LLM function → the unified Image / LLM function. Others are returned as is. */
export function migrateProviderFunction(fn: GenerationFunction): GenerationFunction {
  const legacy = legacyKinds[fn.workflow.format]
  if (!legacy) return fn
  const { kind, apiFormat } = legacy
  const legacyConfig = fn.openaiImage ?? fn.geminiImage ?? fn.openai ?? fn.gemini
  const rest = withoutProviderFields(fn)
  const workflow = { ...fn.workflow, format: kind === 'image' ? ('image_generation' as const) : ('llm_chat' as const) }
  if (legacyConfig?.unified) {
    const unified = structuredClone(legacyConfig.unified)
    return kind === 'image' ? { ...rest, workflow, image: unified } : { ...rest, workflow, llm: unified as LlmModelConfig }
  }

  const settings: Array<[string, unknown]> = []
  let shared: { model: string; apiKey: string; baseUrl: string }
  let messages: OpenAILlmMessage[] = []
  if (fn.workflow.format === 'openai_image_generation') {
    const config = mergedOpenAIImageConfig(fn.openaiImage)
    shared = config
    if (config.size !== 'auto') settings.push(['size', config.size])
    if (config.quality !== 'auto') settings.push(['quality', config.quality])
    if (config.background !== 'auto') settings.push(['background', config.background])
    if (config.outputFormat !== 'png') settings.push(['output_format', config.outputFormat], ['output_compression', config.outputCompression])
    if (config.user?.trim()) settings.push(['user', config.user.trim()])
  } else if (fn.workflow.format === 'gemini_image_generation') {
    const config = mergedGeminiImageConfig(fn.geminiImage)
    shared = config
    if (config.aspectRatio !== 'auto') settings.push(['generationConfig.imageConfig.aspectRatio', config.aspectRatio])
    if (config.imageSize !== 'auto') settings.push(['generationConfig.imageConfig.imageSize', config.imageSize])
    if (config.responseModalities === 'TEXT_IMAGE') settings.push(['generationConfig.responseModalities', ['TEXT', 'IMAGE']])
  } else if (fn.workflow.format === 'openai_chat_completions') {
    const config = mergedOpenAILlmConfig(fn.openai)
    shared = config
    messages = structuredClone(fn.openai?.messages ?? config.messages)
  } else {
    const config = mergedGeminiLlmConfig(fn.gemini)
    shared = config
    messages = structuredClone(fn.gemini?.messages ?? config.messages).map((message) => ({ role: message.role === 'model' ? 'assistant' : message.role, content: message.content }))
  }

  const model = shared.model
  const config: ProviderModelConfig = {
    apiFormat,
    model,
    baseUrl: trimSlashes(shared.baseUrl) === trimSlashes(defaultBaseUrl(apiFormat)) ? '' : shared.baseUrl,
    apiKey: shared.apiKey,
    ...placeSettings(kind, model, apiFormat, settings),
  }
  return kind === 'image' ? { ...rest, workflow, image: config } : { ...rest, workflow, llm: { ...config, messages } }
}
