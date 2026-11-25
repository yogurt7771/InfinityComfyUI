import type { ProviderApiFormat } from './types'

/**
 * What each image / text model accepts, so the Image and LLM built-ins only offer parameters the selected model supports.
 *
 * Every entry comes from the providers' official documentation, checked on MODEL_CATALOG_CHECKED_AT (see `sources`).
 * Values the pages did not confirm for a model are left out (they can still be sent through custom parameters) and said
 * so in `note`. Models the docs list as shut down are not offered.
 */
export const MODEL_CATALOG_CHECKED_AT = '2026-11-25'

export const MODEL_CATALOG_SOURCES = {
  openaiImagesReference: 'https://developers.openai.com/api/reference/resources/images',
  openaiImageGuide: 'https://developers.openai.com/api/docs/guides/image-generation',
  openaiModels: 'https://developers.openai.com/api/docs/models',
  openaiDeprecations: 'https://developers.openai.com/api/docs/deprecations',
  openaiLatestModelGuide: 'https://developers.openai.com/api/docs/guides/latest-model',
  openaiAstra: 'https://developers.openai.com/api/docs/models/gpt-6.2-astra',
  openaiSol: 'https://developers.openai.com/api/docs/models/gpt-6.2-sol',
  openaiTerra: 'https://developers.openai.com/api/docs/models/gpt-6.1-terra',
  openaiLuna: 'https://developers.openai.com/api/docs/models/gpt-6-luna',
  geminiImageGeneration: 'https://ai.google.dev/gemini-api/docs/image-generation',
  geminiModels: 'https://ai.google.dev/gemini-api/docs/models',
  geminiThinking: 'https://ai.google.dev/gemini-api/docs/thinking',
  geminiGenerateContent: 'https://ai.google.dev/api/generate-content',
} as const

export type ModelKind = 'image' | 'llm'

export type ParamSpec = {
  id: string
  label: string
  /** Dotted path in the request JSON body. */
  field: string
  kind: 'enum' | 'number'
  options?: Array<{ value: string; label?: string }>
  min?: number
  max?: number
  step?: number
  /** undefined: not sent unless the user sets it. */
  default?: string | number
  /** Values that mean "leave it to the model" and are not sent. */
  omitValues?: Array<string | number>
  note?: string
}

export type ModelCapability = {
  id: string
  label: string
  kind: ModelKind
  apiFormat: ProviderApiFormat
  status: 'current' | 'preview' | 'legacy' | 'deprecated'
  params: ParamSpec[]
  maxInputImages?: number
  /** Accepts image input (LLMs); undefined = not confirmed by the docs. */
  imageInput?: boolean
  note?: string
  sources: string[]
}

const S = MODEL_CATALOG_SOURCES
const AUTO = { value: 'auto', label: 'Model default' }
const opts = (...values: string[]) => values.map((value) => ({ value }))
const autoEnum = (
  id: string,
  label: string,
  field: string,
  values: string[],
  note?: string,
): ParamSpec => ({ id, label, field, kind: 'enum', options: [AUTO, ...opts(...values)], default: 'auto', omitValues: ['auto'], ...(note ? { note } : {}) })

// ---- OpenAI Images API (POST /v1/images/generations, /v1/images/edits) ----

const OPENAI_SIZES = ['1024x1024', '1536x1024', '1024x1536']
const openAiImageParams = (options: {
  sizes?: string[]
  sizeAuto?: boolean
  qualities: string[]
  qualityAuto?: boolean
  backgrounds?: string[]
  formats: string[]
  sizeNote?: string
  qualityNote?: string
  backgroundNote?: string
  formatNote?: string
}): ParamSpec[] => [
  options.sizeAuto === false
    ? { id: 'size', label: 'Size', field: 'size', kind: 'enum', options: opts(...(options.sizes ?? OPENAI_SIZES)), ...(options.sizeNote ? { note: options.sizeNote } : {}) }
    : autoEnum('size', 'Size', 'size', options.sizes ?? OPENAI_SIZES, options.sizeNote),
  options.qualityAuto === false
    ? { id: 'quality', label: 'Quality', field: 'quality', kind: 'enum', options: opts(...options.qualities), ...(options.qualityNote ? { note: options.qualityNote } : {}) }
    : autoEnum('quality', 'Quality', 'quality', options.qualities, options.qualityNote),
  ...(options.backgrounds ? [autoEnum('background', 'Background', 'background', options.backgrounds, options.backgroundNote)] : []),
  {
    id: 'output_format',
    label: 'Output format',
    field: 'output_format',
    kind: 'enum',
    options: opts(...options.formats),
    default: 'png',
    omitValues: ['png'],
    ...(options.formatNote ? { note: options.formatNote } : {}),
  },
  { id: 'output_compression', label: 'Compression', field: 'output_compression', kind: 'number', min: 0, max: 100, step: 1, note: 'jpeg / webp only (0–100)' },
  { id: 'n', label: 'Images', field: 'n', kind: 'number', min: 1, max: 10, step: 1 },
  autoEnum('moderation', 'Moderation', 'moderation', ['low']),
]

const OPENAI_IMAGE_SOURCES = [S.openaiImagesReference, S.openaiImageGuide, S.openaiModels, S.openaiDeprecations]
const GPT_IMAGE_25 = openAiImageParams({
  qualities: ['low', 'medium', 'high', 'xhigh', 'max'],
  backgrounds: ['opaque', 'transparent'],
  backgroundNote: 'transparent needs png or webp output',
  formats: ['png', 'jpeg', 'webp', 'gif', 'svg'],
  sizeNote: 'Other WIDTHxHEIGHT sizes (multiples of 16, ratio 1:3–3:1, max edge 3840) can be sent as a custom parameter.',
})
const GPT_IMAGE_26 = openAiImageParams({
  qualities: ['low', 'medium', 'high'],
  backgrounds: ['opaque'],
  formats: ['png', 'jpeg', 'webp', 'gif', 'svg'],
  sizeNote: 'Other WIDTHxHEIGHT sizes (multiples of 16, ratio 1:3–3:1, max edge 3840) can be sent as a custom parameter.',
  qualityNote: 'xhigh / max are documented for the 2.5 models only (not confirmed for 2.6).',
  backgroundNote: 'Transparent background is not confirmed for 2.6.',
  formatNote: 'gif / svg per the image generation guide.',
})

// ---- Gemini generateContent with image output (Nano Banana) ----

const GEMINI_RATIOS_10 = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
const GEMINI_RATIOS_14 = ['1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9']
const ASPECT_FIELD = 'generationConfig.imageConfig.aspectRatio'
const IMAGE_SIZE_FIELD = 'generationConfig.imageConfig.imageSize'
const THINKING_FIELD = 'generationConfig.thinkingConfig.thinkingLevel'
const GEMINI_IMAGE_SOURCES = [S.geminiImageGeneration, S.geminiModels]
// generateContent takes the ThinkingLevel enum names (API reference); the guides show the same levels in lower case.
const thinkingLevels = (levels: string[], defaultLevel: string) =>
  autoEnum('thinkingLevel', 'Thinking', THINKING_FIELD, levels.map((level) => level.toUpperCase()), `Model default: ${defaultLevel}`)

// ---- OpenAI Chat Completions ----

const reasoningEffort = (values: string[]) =>
  autoEnum('reasoning_effort', 'Reasoning effort', 'reasoning_effort', values)
const OPENAI_LLM_NOTE = 'Temperature / max output tokens are not offered: not confirmed for this model on the docs read (send them as custom parameters if your endpoint accepts them).'

// ---- Gemini generateContent (text) ----

const geminiTemperature: ParamSpec = { id: 'temperature', label: 'Temperature', field: 'generationConfig.temperature', kind: 'number', min: 0, max: 2, step: 0.1 }
const geminiMaxOutput = (max?: number): ParamSpec => ({
  id: 'maxOutputTokens',
  label: 'Max output tokens',
  field: 'generationConfig.maxOutputTokens',
  kind: 'number',
  min: 1,
  ...(max ? { max } : {}),
  step: 1,
})
const GEMINI_TEXT_SOURCES = [S.geminiModels, S.geminiThinking, S.geminiGenerateContent]
const NO_TEMPERATURE = 'Temperature is ignored on Gemini 3.6 Flash and newer models (API reference), so it is not offered.'

export const MODEL_CATALOG: ModelCapability[] = [
  // Image — OpenAI
  { id: 'gpt-image-2.6-sunburst', label: 'GPT Image 2.6 Sunburst', kind: 'image', apiFormat: 'openai', status: 'current', params: GPT_IMAGE_26, maxInputImages: 16, sources: OPENAI_IMAGE_SOURCES },
  { id: 'gpt-image-2.6-flare', label: 'GPT Image 2.6 Flare', kind: 'image', apiFormat: 'openai', status: 'current', params: GPT_IMAGE_26, maxInputImages: 16, sources: OPENAI_IMAGE_SOURCES },
  { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst', kind: 'image', apiFormat: 'openai', status: 'current', params: GPT_IMAGE_25, maxInputImages: 16, sources: OPENAI_IMAGE_SOURCES },
  { id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare', kind: 'image', apiFormat: 'openai', status: 'current', params: GPT_IMAGE_25, maxInputImages: 16, sources: OPENAI_IMAGE_SOURCES },
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2',
    kind: 'image',
    apiFormat: 'openai',
    status: 'deprecated',
    note: 'Deprecated; shuts down 2027-02-10 (replacement: GPT Image 2.6).',
    params: openAiImageParams({
      qualities: ['low', 'medium', 'high'],
      backgrounds: ['opaque', 'transparent'],
      backgroundNote: 'Transparent background is a preview feature on this model.',
      formats: ['png', 'jpeg', 'webp'],
    }),
    maxInputImages: 16,
    sources: OPENAI_IMAGE_SOURCES,
  },
  {
    id: 'gpt-image-1.5',
    label: 'GPT Image 1.5',
    kind: 'image',
    apiFormat: 'openai',
    status: 'deprecated',
    note: 'Deprecated; shuts down 2026-12-01 (replacement: GPT Image 2.6).',
    params: [
      ...openAiImageParams({ sizeAuto: false, qualities: ['low', 'medium', 'high'], formats: ['png', 'jpeg', 'webp'] }),
      autoEnum('input_fidelity', 'Input fidelity', 'input_fidelity', ['high', 'low']),
    ],
    sources: OPENAI_IMAGE_SOURCES,
  },
  {
    id: 'gpt-image-1-mini',
    label: 'GPT Image 1 mini',
    kind: 'image',
    apiFormat: 'openai',
    status: 'deprecated',
    note: 'Deprecated; shuts down 2026-12-01 (replacement: GPT Image 2.6).',
    params: openAiImageParams({ sizeAuto: false, qualities: ['low', 'medium', 'high'], formats: ['png', 'jpeg', 'webp'] }),
    sources: OPENAI_IMAGE_SOURCES,
  },

  // Image — Gemini (Nano Banana)
  {
    id: 'gemini-nano-banana-2.1',
    label: 'Nano Banana 2.1',
    kind: 'image',
    apiFormat: 'gemini',
    status: 'current',
    params: [
      autoEnum('aspectRatio', 'Aspect ratio', ASPECT_FIELD, GEMINI_RATIOS_14),
      autoEnum('imageSize', 'Resolution', IMAGE_SIZE_FIELD, ['1K', '2K', '4K'], 'Model default: 1K'),
      thinkingLevels(['minimal', 'medium', 'high'], 'medium'),
    ],
    maxInputImages: 14,
    sources: GEMINI_IMAGE_SOURCES,
  },
  {
    id: 'gemini-3.1-flash-image',
    label: 'Nano Banana 2 (Gemini 3.1 Flash Image)',
    kind: 'image',
    apiFormat: 'gemini',
    status: 'current',
    params: [
      autoEnum('aspectRatio', 'Aspect ratio', ASPECT_FIELD, GEMINI_RATIOS_14),
      autoEnum('imageSize', 'Resolution', IMAGE_SIZE_FIELD, ['512', '1K', '2K', '4K'], 'Model default: 1K'),
      thinkingLevels(['minimal', 'high'], 'minimal'),
    ],
    maxInputImages: 14,
    sources: GEMINI_IMAGE_SOURCES,
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    label: 'Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image)',
    kind: 'image',
    apiFormat: 'gemini',
    status: 'current',
    note: 'Aspect ratios and resolutions are not listed for this model; the common ratios are offered. Not optimized for several reference images.',
    params: [autoEnum('aspectRatio', 'Aspect ratio', ASPECT_FIELD, GEMINI_RATIOS_10, 'Not confirmed for this model'), thinkingLevels(['minimal', 'high'], 'minimal')],
    sources: [S.geminiImageGeneration, S.geminiModels, S.geminiThinking],
  },
  {
    id: 'gemini-3-pro-image',
    label: 'Nano Banana Pro (Gemini 3 Pro Image)',
    kind: 'image',
    apiFormat: 'gemini',
    status: 'current',
    note: 'Thinking is always on and has no level control.',
    params: [
      autoEnum('aspectRatio', 'Aspect ratio', ASPECT_FIELD, GEMINI_RATIOS_10),
      autoEnum('imageSize', 'Resolution', IMAGE_SIZE_FIELD, ['1K', '2K', '4K'], 'Model default: 1K'),
    ],
    maxInputImages: 14,
    sources: GEMINI_IMAGE_SOURCES,
  },
  {
    id: 'gemini-2.5-flash-image',
    label: 'Nano Banana (Gemini 2.5 Flash Image)',
    kind: 'image',
    apiFormat: 'gemini',
    status: 'legacy',
    note: 'Legacy; one resolution per aspect ratio. Works best with up to 3 input images.',
    params: [autoEnum('aspectRatio', 'Aspect ratio', ASPECT_FIELD, GEMINI_RATIOS_10)],
    maxInputImages: 3,
    sources: GEMINI_IMAGE_SOURCES,
  },

  // LLM — OpenAI (Chat Completions)
  {
    id: 'gpt-6.2-astra',
    label: 'GPT-6.2 Astra',
    kind: 'llm',
    apiFormat: 'openai',
    status: 'current',
    imageInput: true,
    note: `Rejects reasoning effort "none". ${OPENAI_LLM_NOTE}`,
    params: [reasoningEffort(['low', 'medium', 'high', 'xhigh', 'max'])],
    sources: [S.openaiAstra, S.openaiModels, S.openaiLatestModelGuide],
  },
  {
    id: 'gpt-6.2-sol',
    label: 'GPT-6.2 Sol',
    kind: 'llm',
    apiFormat: 'openai',
    status: 'current',
    imageInput: true,
    note: `Rejects reasoning effort "none". ${OPENAI_LLM_NOTE}`,
    params: [reasoningEffort(['low', 'medium', 'high', 'xhigh', 'max'])],
    sources: [S.openaiSol, S.openaiModels, S.openaiLatestModelGuide],
  },
  {
    id: 'gpt-6.1-terra',
    label: 'GPT-6.1 Terra',
    kind: 'llm',
    apiFormat: 'openai',
    status: 'current',
    imageInput: true,
    note: OPENAI_LLM_NOTE,
    params: [reasoningEffort(['none', 'low', 'medium', 'high', 'xhigh', 'max'])],
    sources: [S.openaiTerra, S.openaiModels],
  },
  {
    id: 'gpt-6-luna',
    label: 'GPT-6 Luna',
    kind: 'llm',
    apiFormat: 'openai',
    status: 'current',
    imageInput: true,
    note: OPENAI_LLM_NOTE,
    params: [reasoningEffort(['none', 'low', 'medium', 'high', 'xhigh', 'max'])],
    sources: [S.openaiLuna, S.openaiModels],
  },

  // LLM — Gemini (generateContent)
  ...(
    [
      ['gemini-4-carbon', 'Gemini 4 Carbon', ['low', 'medium', 'high'], 'medium'],
      ['gemini-4-neon', 'Gemini 4 Neon', ['low', 'medium', 'high', 'xhigh'], 'high'],
      ['gemini-4-hydrogen', 'Gemini 4 Hydrogen', ['low', 'medium', 'high', 'xhigh'], 'high'],
      ['gemini-4-argon', 'Gemini 4 Argon', ['low', 'medium', 'high'], 'medium'],
    ] as Array<[string, string, string[], string]>
  ).map(([id, label, levels, defaultLevel]): ModelCapability => ({
    id,
    label,
    kind: 'llm',
    apiFormat: 'gemini',
    status: 'current',
    imageInput: true,
    note: `${NO_TEMPERATURE} Max output listed as 64K.`,
    params: [
      autoEnum('thinkingLevel', 'Thinking', THINKING_FIELD, levels.map((level) => level.toUpperCase()), `Model default: ${defaultLevel}`),
      geminiMaxOutput(65536),
    ],
    sources: GEMINI_TEXT_SOURCES,
  })),
  ...(
    [
      ['gemini-3.8-flash', 'Gemini 3.8 Flash', ['low', 'medium', 'high'], 'medium', false],
      ['gemini-3.6-flash', 'Gemini 3.6 Flash', ['minimal', 'low', 'medium', 'high'], 'medium', false],
      ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite', ['minimal', 'low', 'medium', 'high'], 'minimal', false],
      ['gemini-3.1-pro-preview', 'Gemini 3.1 Pro (preview)', ['low', 'medium', 'high'], 'high', true],
      ['gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite', ['minimal', 'low', 'medium', 'high'], 'minimal', true],
      ['gemini-3-flash-preview', 'Gemini 3 Flash (preview)', ['minimal', 'low', 'medium', 'high'], 'high', true],
      ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', ['low', 'medium', 'high'], 'off', true],
    ] as Array<[string, string, string[], string, boolean]>
  ).map(([id, label, levels, defaultLevel, temperature]): ModelCapability => ({
    id,
    label,
    kind: 'llm',
    apiFormat: 'gemini',
    status: id.endsWith('-preview') ? 'preview' : id.startsWith('gemini-2.5') ? 'legacy' : 'current',
    note: temperature
      ? 'Image input and max output are not listed per model on the docs read.'
      : `${NO_TEMPERATURE} Image input and max output are not listed per model on the docs read.`,
    params: [
      autoEnum('thinkingLevel', 'Thinking', THINKING_FIELD, levels.map((level) => level.toUpperCase()), `Model default: ${defaultLevel}`),
      ...(temperature ? [geminiTemperature] : []),
      geminiMaxOutput(),
    ],
    sources: GEMINI_TEXT_SOURCES,
  })),
]

const GENERIC_PARAMS: Record<ModelKind, Record<ProviderApiFormat, ParamSpec[]>> = {
  image: {
    openai: [autoEnum('size', 'Size', 'size', OPENAI_SIZES), autoEnum('quality', 'Quality', 'quality', ['low', 'medium', 'high'])],
    gemini: [autoEnum('aspectRatio', 'Aspect ratio', ASPECT_FIELD, GEMINI_RATIOS_10)],
  },
  llm: {
    openai: [{ id: 'temperature', label: 'Temperature', field: 'temperature', kind: 'number', min: 0, max: 2, step: 0.1 }],
    gemini: [geminiTemperature],
  },
}

export function findModel(kind: ModelKind, modelId: string): ModelCapability | undefined {
  const id = modelId.trim().toLowerCase()
  if (!id) return undefined
  return MODEL_CATALOG.find((entry) => entry.kind === kind && entry.id.toLowerCase() === id)
}

/** The conservative parameters offered for a model the catalog does not know ("capabilities unknown"). */
export function genericParams(kind: ModelKind, apiFormat: ProviderApiFormat): ParamSpec[] {
  return GENERIC_PARAMS[kind][apiFormat]
}

export function paramsFor(kind: ModelKind, modelId: string, apiFormat: ProviderApiFormat): { params: ParamSpec[]; known: boolean } {
  const entry = findModel(kind, modelId)
  return entry && entry.apiFormat === apiFormat ? { params: entry.params, known: true } : { params: genericParams(kind, apiFormat), known: false }
}

export function defaultParamValues(specs: ParamSpec[]): Record<string, string | number> {
  return Object.fromEntries(specs.filter((spec) => spec.default !== undefined).map((spec) => [spec.id, spec.default!]))
}

const validFor = (spec: ParamSpec, value: unknown) => {
  if (spec.kind === 'enum') return typeof value === 'string' && Boolean(spec.options?.some((option) => option.value === value))
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  return Number.isFinite(number) && (spec.min === undefined || number >= spec.min) && (spec.max === undefined || number <= spec.max)
}

/** Keeps what the (new) model supports; anything else falls back to its default or is dropped, and says what changed. */
export function reconcileParams(
  specs: ParamSpec[],
  values: Record<string, string | number | boolean>,
): {
  values: Record<string, string | number | boolean>
  changed: Array<{ id: string; label: string; from: string | number | boolean; to?: string | number }>
} {
  const next: Record<string, string | number | boolean> = {}
  const changed: Array<{ id: string; label: string; from: string | number | boolean; to?: string | number }> = []
  for (const [id, value] of Object.entries(values)) {
    const spec = specs.find((item) => item.id === id)
    if (!spec) {
      changed.push({ id, label: id, from: value })
      continue
    }
    if (validFor(spec, value)) {
      next[id] = spec.kind === 'number' && typeof value === 'string' ? Number(value) : value
      continue
    }
    if (spec.default !== undefined) {
      next[id] = spec.default
      changed.push({ id, label: spec.label, from: value, to: spec.default })
    } else {
      changed.push({ id, label: spec.label, from: value })
    }
  }
  return { values: next, changed }
}

export const setPath = (target: Record<string, unknown>, path: string, value: unknown) => {
  const parts = path.split('.').filter(Boolean)
  let cursor = target
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part]
    if (typeof next !== 'object' || next === null || Array.isArray(next)) cursor[part] = {}
    cursor = cursor[part] as Record<string, unknown>
  }
  cursor[parts.at(-1)!] = value
}

/** The request fields the parameters stand for (values meaning "model default" are not sent). */
export function requestOverlay(specs: ParamSpec[], values: Record<string, string | number | boolean>): Record<string, unknown> {
  const overlay: Record<string, unknown> = {}
  for (const spec of specs) {
    const value = values[spec.id]
    if (value === undefined || value === '' || (spec.omitValues ?? []).includes(value as string | number)) continue
    setPath(overlay, spec.field, spec.kind === 'number' && typeof value === 'string' ? Number(value) : value)
  }
  return overlay
}

export function parseCustomParams(text: string): { value: Record<string, unknown>; error?: string } {
  if (!text.trim()) return { value: {} }
  try {
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { value: {}, error: 'Custom parameters must be a JSON object, e.g. {"seed": 42}.' }
    }
    return { value: parsed as Record<string, unknown> }
  } catch (error) {
    return { value: {}, error: error instanceof Error ? `Invalid JSON: ${error.message}` : 'Invalid JSON' }
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function deepMerge(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(overlay)) {
    const current = merged[key]
    merged[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : structuredClone(value)
  }
  return merged
}
