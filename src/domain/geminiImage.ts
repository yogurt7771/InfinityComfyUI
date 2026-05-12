import type {
  GeminiImageAspectRatio,
  GeminiImageConfig,
  GeminiImageResponseModalities,
  GeminiImageSize,
  GenerationFunction,
  PrimitiveInputValue,
  Resource,
  ResourceRef,
} from './types'

export const GEMINI_IMAGE_FUNCTION_ID = 'fn_gemini_image'

type RuntimeInputValues = Record<string, PrimitiveInputValue | ResourceRef>

export type GeminiImageGenerationRequest = {
  contents: Array<{
    parts: GeminiImageRequestPart[]
  }>
  generationConfig: {
    responseModalities: Array<'TEXT' | 'IMAGE'>
    responseFormat?: {
      image: {
        aspectRatio?: Exclude<GeminiImageAspectRatio, 'auto'>
        imageSize?: Exclude<GeminiImageSize, 'auto'>
      }
    }
  }
}

type GeminiImageTextPart = {
  text: string
}

type GeminiImageInlineDataPart = {
  inline_data: {
    mime_type: string
    data: string
  }
}

type GeminiImageRequestPart = GeminiImageTextPart | GeminiImageInlineDataPart

export type GeneratedGeminiImageOutput = {
  dataUrl: string
  filename: string
  mimeType: string
}

const geminiModalities: GeminiImageResponseModalities[] = ['IMAGE', 'TEXT_IMAGE']
const geminiAspectRatios: GeminiImageAspectRatio[] = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4']
const geminiImageSizes: GeminiImageSize[] = ['auto', '1K', '2K', '4K']

const optionOrDefault = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback

const imageInputs = () =>
  Array.from({ length: 10 }, (_, index) => ({
    key: `image_${index + 1}`,
    label: `Image ${index + 1}`,
    type: 'image' as const,
    required: false,
    bind: { path: `gemini.images.${index + 1}` },
    upload: { strategy: 'none' as const },
  }))

export const defaultGeminiImageConfig = (): GeminiImageConfig => ({
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  apiKey: '',
  model: 'gemini-3.1-flash-image-preview',
  responseModalities: 'IMAGE',
  aspectRatio: 'auto',
  imageSize: 'auto',
})

export function createGeminiImageFunction(now: string): GenerationFunction {
  return {
    id: GEMINI_IMAGE_FUNCTION_ID,
    name: 'Gemini Generate Image',
    description: 'Gemini generateContent image generator',
    category: 'Image',
    workflow: {
      format: 'gemini_image_generation',
      rawJson: {},
    },
    geminiImage: defaultGeminiImageConfig(),
    inputs: [
      {
        key: 'prompt',
        label: 'Prompt',
        type: 'text',
        required: true,
        defaultValue: 'A high quality product image',
        bind: { path: 'contents.0.parts.0.text' },
        upload: { strategy: 'none' },
      },
      ...imageInputs(),
    ],
    outputs: [
      {
        key: 'image',
        label: 'Image',
        type: 'image',
        bind: { path: 'candidates.0.content.parts' },
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

export const isGeminiImageFunction = (fn: GenerationFunction) => fn.workflow.format === 'gemini_image_generation'

export const mergedGeminiImageConfig = (
  base?: GeminiImageConfig,
  override?: Partial<GeminiImageConfig>,
): GeminiImageConfig => {
  const fallback = defaultGeminiImageConfig()
  const merged = { ...fallback, ...base, ...override }
  return {
    baseUrl: String(merged.baseUrl || fallback.baseUrl),
    apiKey: String(merged.apiKey ?? ''),
    model: String(merged.model || fallback.model),
    responseModalities: optionOrDefault(merged.responseModalities, geminiModalities, fallback.responseModalities),
    aspectRatio: optionOrDefault(merged.aspectRatio, geminiAspectRatios, fallback.aspectRatio),
    imageSize: optionOrDefault(merged.imageSize, geminiImageSizes, fallback.imageSize),
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

const responseModalities = (value: GeminiImageResponseModalities): Array<'TEXT' | 'IMAGE'> =>
  value === 'TEXT_IMAGE' ? ['TEXT', 'IMAGE'] : ['IMAGE']

const mediaValue = (resource: Resource | undefined) =>
  resource && typeof resource.value === 'object' && resource.value !== null && 'url' in resource.value
    ? resource.value
    : undefined

const imageResourceRefsFromInput = (inputValues: RuntimeInputValues, resources: Record<string, Resource>) =>
  Array.from({ length: 10 }, (_, index) => inputValues[`image_${index + 1}`])
    .filter(isResourceRef)
    .map((ref) => resources[ref.resourceId])
    .filter((resource): resource is Resource => Boolean(resource && resource.type === 'image'))

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize))
  }
  return btoa(binary)
}

const parseImageDataUrl = (url: string) => {
  const match = url.match(/^data:([^;,]+);base64,(.*)$/)
  if (!match) return undefined
  return {
    mimeType: match[1],
    data: match[2],
  }
}

const imageResourceAsInlineData = async (resource: Resource): Promise<GeminiImageInlineDataPart> => {
  const media = mediaValue(resource)
  if (!media?.url) throw new Error(`Image resource is missing a URL: ${resource.id}`)

  const parsed = parseImageDataUrl(media.url)
  if (parsed) {
    return {
      inline_data: {
        mime_type: parsed.mimeType,
        data: parsed.data,
      },
    }
  }

  const response = await fetch(media.url)
  if (!response.ok) throw new Error(`Image download failed before Gemini image request: ${response.status}`)

  const blob = await response.blob()
  const mimeType = blob.type || media.mimeType || response.headers.get('Content-Type')?.split(';')[0] || 'image/png'
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return {
    inline_data: {
      mime_type: mimeType,
      data: bytesToBase64(bytes),
    },
  }
}

export async function createGeminiImageGenerationRequest(
  config: GeminiImageConfig,
  inputValues: RuntimeInputValues,
  resources: Record<string, Resource>,
  defaultPrompt?: string | number | null,
): Promise<GeminiImageGenerationRequest> {
  const normalized = mergedGeminiImageConfig(undefined, config)
  const imageOptions: {
    aspectRatio?: Exclude<GeminiImageAspectRatio, 'auto'>
    imageSize?: Exclude<GeminiImageSize, 'auto'>
  } = {}
  if (normalized.aspectRatio !== 'auto') imageOptions.aspectRatio = normalized.aspectRatio
  if (normalized.imageSize !== 'auto') imageOptions.imageSize = normalized.imageSize

  const imageParts = await Promise.all(
    imageResourceRefsFromInput(inputValues, resources).map((resource) => imageResourceAsInlineData(resource)),
  )

  return {
    contents: [
      {
        parts: [...imageParts, { text: promptFromInput(inputValues, resources, defaultPrompt) }],
      },
    ],
    generationConfig: {
      responseModalities: responseModalities(normalized.responseModalities),
      ...(Object.keys(imageOptions).length ? { responseFormat: { image: imageOptions } } : {}),
    },
  }
}

const extensionForMimeType = (mimeType: string) => {
  if (mimeType === 'image/jpeg') return 'jpeg'
  if (mimeType === 'image/webp') return 'webp'
  return 'png'
}

const inlineDataFromPart = (part: unknown) => {
  if (typeof part !== 'object' || part === null) return undefined
  const record = part as Record<string, unknown>
  const inlineData = record.inlineData ?? record.inline_data
  if (typeof inlineData !== 'object' || inlineData === null) return undefined
  const dataRecord = inlineData as Record<string, unknown>
  const data = dataRecord.data
  const mimeType = dataRecord.mimeType ?? dataRecord.mime_type
  if (typeof data !== 'string' || !data.trim()) return undefined
  return {
    data,
    mimeType: typeof mimeType === 'string' && mimeType.trim() ? mimeType : 'image/png',
  }
}

const responseParts = (response: unknown) => {
  if (typeof response !== 'object' || response === null) return []
  const candidates = (response as { candidates?: unknown }).candidates
  if (!Array.isArray(candidates)) return []

  return candidates.flatMap((candidate) => {
    if (typeof candidate !== 'object' || candidate === null) return []
    const content = (candidate as { content?: unknown }).content
    if (typeof content !== 'object' || content === null) return []
    const parts = (content as { parts?: unknown }).parts
    return Array.isArray(parts) ? parts : []
  })
}

export function extractGeminiImageGenerationOutputs(response: unknown): GeneratedGeminiImageOutput[] {
  return responseParts(response)
    .map(inlineDataFromPart)
    .filter((output): output is { data: string; mimeType: string } => Boolean(output))
    .map((output, index) => {
      const extension = extensionForMimeType(output.mimeType)
      return {
        dataUrl: `data:${output.mimeType};base64,${output.data}`,
        filename: `gemini-image-${index + 1}.${extension}`,
        mimeType: output.mimeType,
      }
    })
}
