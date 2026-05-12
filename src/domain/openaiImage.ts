import type {
  GenerationFunction,
  OpenAIImageBackground,
  OpenAIImageConfig,
  OpenAIImageOutputFormat,
  OpenAIImageQuality,
  OpenAIImageSize,
  PrimitiveInputValue,
  Resource,
  ResourceRef,
} from './types'

export const OPENAI_IMAGE_FUNCTION_ID = 'fn_openai_image'

type RuntimeInputValues = Record<string, PrimitiveInputValue | ResourceRef>

export type OpenAIImageGenerationRequest = {
  model: string
  prompt: string
  size?: OpenAIImageSize
  quality?: OpenAIImageQuality
  background?: OpenAIImageBackground
  output_format?: OpenAIImageOutputFormat
  output_compression?: number
  user?: string
}

export type OpenAIImageApiRequest =
  | {
      kind: 'generation'
      body: OpenAIImageGenerationRequest
    }
  | {
      kind: 'edit'
      body: FormData
    }

export type GeneratedImageOutput = {
  dataUrl: string
  filename: string
  mimeType: string
}

const openAiImageSizes: OpenAIImageSize[] = ['auto', '1024x1024', '1024x1536', '1536x1024']
const openAiImageQualities: OpenAIImageQuality[] = ['auto', 'low', 'medium', 'high']
const openAiImageBackgrounds: OpenAIImageBackground[] = ['auto', 'transparent', 'opaque']
const openAiImageFormats: OpenAIImageOutputFormat[] = ['png', 'jpeg', 'webp']

const optionOrDefault = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback

const normalizedCompression = (value: unknown) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return 100
  return Math.max(0, Math.min(100, Math.floor(numberValue)))
}

const imageInputs = () =>
  Array.from({ length: 10 }, (_, index) => ({
    key: `image_${index + 1}`,
    label: `Image ${index + 1}`,
    type: 'image' as const,
    required: false,
    bind: { path: `openai.images.${index + 1}` },
    upload: { strategy: 'none' as const },
  }))

export const defaultOpenAIImageConfig = (): OpenAIImageConfig => ({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-image-2',
  size: 'auto',
  quality: 'auto',
  background: 'auto',
  outputFormat: 'png',
  outputCompression: 100,
  user: '',
})

export function createOpenAIImageFunction(now: string): GenerationFunction {
  return {
    id: OPENAI_IMAGE_FUNCTION_ID,
    name: 'OpenAI Generate Image',
    description: 'OpenAI Images API text-to-image generator',
    category: 'Image',
    workflow: {
      format: 'openai_image_generation',
      rawJson: {},
    },
    openaiImage: defaultOpenAIImageConfig(),
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
      ...imageInputs(),
    ],
    outputs: [
      {
        key: 'image',
        label: 'Image',
        type: 'image',
        bind: { path: 'data.0.b64_json' },
        extract: { source: 'node_output' },
      },
    ],
    runtimeDefaults: {
      runCount: 1,
      seedPolicy: { mode: 'randomize_all_before_submit' },
    },
    createdAt: now,
    updatedAt: now,
  }
}

export const isOpenAIImageFunction = (fn: GenerationFunction) => fn.workflow.format === 'openai_image_generation'

export const mergedOpenAIImageConfig = (
  base?: OpenAIImageConfig,
  override?: Partial<OpenAIImageConfig>,
): OpenAIImageConfig => {
  const fallback = defaultOpenAIImageConfig()
  const merged = { ...fallback, ...base, ...override }
  return {
    baseUrl: String(merged.baseUrl || fallback.baseUrl),
    apiKey: String(merged.apiKey ?? ''),
    model: String(merged.model || fallback.model),
    size: optionOrDefault(merged.size, openAiImageSizes, fallback.size),
    quality: optionOrDefault(merged.quality, openAiImageQualities, fallback.quality),
    background: optionOrDefault(merged.background, openAiImageBackgrounds, fallback.background),
    outputFormat: optionOrDefault(merged.outputFormat, openAiImageFormats, fallback.outputFormat),
    outputCompression: normalizedCompression(merged.outputCompression),
    user: typeof merged.user === 'string' ? merged.user : '',
  }
}

const isResourceRef = (value: PrimitiveInputValue | ResourceRef | undefined): value is ResourceRef =>
  typeof value === 'object' && value !== null && 'resourceId' in value

const promptFromResource = (resource: Resource | undefined) => {
  if (!resource) return undefined
  if (typeof resource.value === 'string' || typeof resource.value === 'number') return String(resource.value)
  return undefined
}

const promptFromInput = (
  inputValues: RuntimeInputValues,
  resources: Record<string, Resource>,
  defaultPrompt?: string | number | null,
) => {
  const promptValue = inputValues.prompt
  if (isResourceRef(promptValue)) {
    return promptFromResource(resources[promptValue.resourceId])?.trim() ?? ''
  }
  if (typeof promptValue === 'string' || typeof promptValue === 'number') return String(promptValue).trim()
  if (typeof defaultPrompt === 'string' || typeof defaultPrompt === 'number') return String(defaultPrompt).trim()
  return ''
}

const mediaValue = (resource: Resource | undefined) =>
  resource && typeof resource.value === 'object' && resource.value !== null && 'url' in resource.value
    ? resource.value
    : undefined

const imageResourceRefsFromInput = (inputValues: RuntimeInputValues, resources: Record<string, Resource>) =>
  Array.from({ length: 10 }, (_, index) => inputValues[`image_${index + 1}`])
    .filter(isResourceRef)
    .map((ref) => resources[ref.resourceId])
    .filter((resource): resource is Resource => Boolean(resource && resource.type === 'image'))

const parseDataUrl = (url: string) => {
  const match = url.match(/^data:([^;,]+);base64,(.*)$/)
  if (!match) return undefined
  return {
    mimeType: match[1],
    data: match[2],
  }
}

const base64ToBytes = (base64: string) => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

const filenameForImageResource = (resource: Resource, mimeType: string, index: number) => {
  const media = mediaValue(resource)
  if (media?.filename) return media.filename
  if (resource.name?.trim()) return resource.name.trim()
  return `image-${index + 1}.${extensionForMimeType(mimeType)}`
}

const imageResourceAsFile = async (resource: Resource, index: number) => {
  const media = mediaValue(resource)
  if (!media?.url) throw new Error(`Image resource is missing a URL: ${resource.id}`)

  const parsed = parseDataUrl(media.url)
  if (parsed) {
    const bytes = base64ToBytes(parsed.data)
    return new File([bytes], filenameForImageResource(resource, parsed.mimeType, index), { type: parsed.mimeType })
  }

  const response = await fetch(media.url)
  if (!response.ok) throw new Error(`Image download failed before OpenAI image edit request: ${response.status}`)

  const blob = await response.blob()
  const mimeType = blob.type || media.mimeType || response.headers.get('Content-Type')?.split(';')[0] || 'image/png'
  return new File([blob], filenameForImageResource(resource, mimeType, index), { type: mimeType })
}

const appendOptionalFormField = (body: FormData, key: string, value: string | number | undefined) => {
  if (value === undefined) return
  const stringValue = String(value)
  if (!stringValue.trim()) return
  body.append(key, stringValue)
}

export function createOpenAIImageGenerationRequest(
  config: OpenAIImageConfig,
  inputValues: RuntimeInputValues,
  resources: Record<string, Resource>,
  defaultPrompt?: string | number | null,
): OpenAIImageGenerationRequest {
  const normalized = mergedOpenAIImageConfig(undefined, config)
  const request: OpenAIImageGenerationRequest = {
    model: normalized.model.trim() || 'gpt-image-2',
    prompt: promptFromInput(inputValues, resources, defaultPrompt),
  }

  if (normalized.size !== 'auto') request.size = normalized.size
  if (normalized.quality !== 'auto') request.quality = normalized.quality
  if (normalized.background !== 'auto') request.background = normalized.background
  if (normalized.outputFormat !== 'png') request.output_format = normalized.outputFormat
  if (normalized.outputFormat !== 'png') request.output_compression = normalized.outputCompression
  if (normalized.user?.trim()) request.user = normalized.user.trim()

  return request
}

export async function createOpenAIImageApiRequest(
  config: OpenAIImageConfig,
  inputValues: RuntimeInputValues,
  resources: Record<string, Resource>,
  defaultPrompt?: string | number | null,
): Promise<OpenAIImageApiRequest> {
  const images = imageResourceRefsFromInput(inputValues, resources)
  const normalized = mergedOpenAIImageConfig(undefined, config)
  const generationRequest = createOpenAIImageGenerationRequest(config, inputValues, resources, defaultPrompt)

  if (images.length === 0) {
    return {
      kind: 'generation',
      body: generationRequest,
    }
  }

  const body = new FormData()
  body.append('model', generationRequest.model || normalized.model || 'gpt-image-2')
  body.append('prompt', generationRequest.prompt)
  if (normalized.size !== 'auto') body.append('size', normalized.size)
  if (normalized.quality !== 'auto') body.append('quality', normalized.quality)
  if (normalized.background !== 'auto') body.append('background', normalized.background)
  if (normalized.outputFormat !== 'png') body.append('output_format', normalized.outputFormat)
  if (normalized.outputFormat !== 'png') body.append('output_compression', String(normalized.outputCompression))
  appendOptionalFormField(body, 'user', normalized.user)

  for (let index = 0; index < images.length; index += 1) {
    body.append('image', await imageResourceAsFile(images[index]!, index))
  }

  return {
    kind: 'edit',
    body,
  }
}

const mimeTypeForFormat = (format: string) => {
  if (format === 'jpg' || format === 'jpeg') return 'image/jpeg'
  if (format === 'webp') return 'image/webp'
  return 'image/png'
}

const extensionForMimeType = (mimeType: string) => {
  if (mimeType === 'image/jpeg') return 'jpeg'
  if (mimeType === 'image/webp') return 'webp'
  return 'png'
}

const outputFormatFromItem = (item: unknown, fallbackFormat: OpenAIImageOutputFormat) => {
  if (typeof item !== 'object' || item === null) return fallbackFormat
  const record = item as Record<string, unknown>
  if (typeof record.output_format === 'string') return record.output_format
  if (typeof record.format === 'string') return record.format
  return fallbackFormat
}

export function extractOpenAIImageGenerationOutputs(
  response: unknown,
  fallbackFormat: OpenAIImageOutputFormat = 'png',
): GeneratedImageOutput[] {
  if (typeof response !== 'object' || response === null) return []
  const data = (response as { data?: unknown }).data
  if (!Array.isArray(data)) return []

  return data
    .map((item, index): GeneratedImageOutput | undefined => {
      if (typeof item !== 'object' || item === null) return undefined
      const record = item as Record<string, unknown>
      const format = outputFormatFromItem(item, fallbackFormat)
      const mimeType = typeof record.mime_type === 'string' ? record.mime_type : mimeTypeForFormat(format)
      const extension = extensionForMimeType(mimeType)
      if (typeof record.b64_json === 'string' && record.b64_json.trim()) {
        return {
          dataUrl: `data:${mimeType};base64,${record.b64_json}`,
          filename: `openai-image-${index + 1}.${extension}`,
          mimeType,
        }
      }
      if (typeof record.url === 'string' && record.url.trim()) {
        return {
          dataUrl: record.url,
          filename: `openai-image-${index + 1}.${extension}`,
          mimeType,
        }
      }
      return undefined
    })
    .filter((output): output is GeneratedImageOutput => Boolean(output))
}
