import type {
  GeminiLlmConfig,
  GeminiLlmContentPart,
  GeminiLlmMessage,
  GenerationFunction,
  PrimitiveInputValue,
  Resource,
  ResourceRef,
} from './types'

export const GEMINI_LLM_FUNCTION_ID = 'fn_gemini_llm'

type RuntimeInputValues = Record<string, PrimitiveInputValue | ResourceRef>
type ResourceBlobLoader = (resource: Resource) => Promise<Blob>

type GeminiTextPart = {
  text: string
}

type GeminiInlineDataPart = {
  inline_data: {
    mime_type: string
    data: string
  }
}

type GeminiRequestPart = GeminiTextPart | GeminiInlineDataPart

type GeminiRequestContent = {
  role: 'user' | 'model'
  parts: GeminiRequestPart[]
}

export type GeminiGenerateContentRequest = {
  system_instruction?: {
    parts: GeminiTextPart[]
  }
  contents: GeminiRequestContent[]
}

const defaultUserContent = (): GeminiLlmContentPart[] => [
  {
    type: 'text',
    content: 'Analyze the provided images and respond with useful text.',
  },
  ...Array.from({ length: 6 }, (_, index) => ({
    type: 'image_url' as const,
    content: `image_${index + 1}`,
  })),
]

export const defaultGeminiLlmConfig = (): GeminiLlmConfig => ({
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  apiKey: '',
  model: 'gemini-2.5-flash',
  messages: [
    {
      role: 'system',
      content: [
        {
          type: 'text',
          content: 'You are a concise visual analysis assistant. Return plain text only.',
        },
      ],
    },
    {
      role: 'user',
      content: defaultUserContent(),
    },
  ],
})

export function createGeminiLlmFunction(now: string): GenerationFunction {
  return {
    id: GEMINI_LLM_FUNCTION_ID,
    name: 'Gemini LLM',
    description: 'Gemini generateContent multimodal text generator',
    category: 'LLM',
    workflow: {
      format: 'gemini_generate_content',
      rawJson: {},
    },
    gemini: defaultGeminiLlmConfig(),
    inputs: Array.from({ length: 6 }, (_, index) => ({
      key: `image_${index + 1}`,
      label: `Image ${index + 1}`,
      type: 'image' as const,
      required: false,
      bind: { path: `gemini.images.${index + 1}` },
      upload: { strategy: 'none' as const },
    })),
    outputs: [
      {
        key: 'text',
        label: 'Text',
        type: 'text',
        bind: { path: 'candidates.0.content.parts.0.text' },
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

export const isGeminiLlmFunction = (fn: GenerationFunction) => fn.workflow.format === 'gemini_generate_content'

const normalizeRole = (value: unknown): GeminiLlmMessage['role'] => {
  if (value === 'model' || value === 'assistant') return 'model'
  if (value === 'system' || value === 'developer') return 'system'
  return 'user'
}

const normalizeContentType = (value: unknown): GeminiLlmContentPart['type'] =>
  value === 'image_url' || value === 'input_image' ? 'image_url' : 'text'

const normalizeContentPart = (value: unknown): GeminiLlmContentPart | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const type = normalizeContentType(record.type)
  const contentValue = record.content ?? record.text ?? record.image_url
  const content =
    typeof contentValue === 'object' && contentValue !== null && 'url' in contentValue
      ? String((contentValue as { url: unknown }).url)
      : String(contentValue ?? '')

  return { type, content }
}

const normalizeMessages = (messages: unknown): GeminiLlmMessage[] => {
  if (!Array.isArray(messages)) return defaultGeminiLlmConfig().messages

  const normalized: GeminiLlmMessage[] = []
  for (const item of messages) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const role = normalizeRole(record.role)
    const parts = Array.isArray(record.content)
      ? record.content.map(normalizeContentPart).filter((part): part is GeminiLlmContentPart => Boolean(part))
      : [normalizeContentPart(record)].filter((part): part is GeminiLlmContentPart => Boolean(part))

    if (parts.length === 0) continue
    const previous = normalized[normalized.length - 1]
    if (previous?.role === role) {
      previous.content.push(...parts)
    } else {
      normalized.push({ role, content: parts })
    }
  }

  return normalized.length > 0 ? normalized : defaultGeminiLlmConfig().messages
}

export const mergedGeminiLlmConfig = (
  base?: GeminiLlmConfig,
  override?: Partial<GeminiLlmConfig>,
): GeminiLlmConfig => {
  const fallback = defaultGeminiLlmConfig()
  return {
    ...fallback,
    ...base,
    ...override,
    messages: normalizeMessages(override?.messages ?? base?.messages ?? fallback.messages),
  }
}

const isResourceRef = (value: PrimitiveInputValue | ResourceRef | undefined): value is ResourceRef =>
  typeof value === 'object' && value !== null && 'resourceId' in value

const mediaValue = (resource: Resource) =>
  typeof resource.value === 'object' && resource.value !== null && 'url' in resource.value ? resource.value : undefined

const imageResourceFromContent = (
  content: string,
  inputValues: RuntimeInputValues,
  resources: Record<string, Resource>,
) => {
  const value = content.trim()
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:image/')) return undefined

  const inputValue = inputValues[value]
  if (!isResourceRef(inputValue)) return undefined

  const resource = resources[inputValue.resourceId]
  if (!resource || resource.type !== 'image') return undefined
  return resource
}

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

const imageUrlAsInlineData = async (url: string): Promise<GeminiInlineDataPart> => {
  const dataUrl = parseImageDataUrl(url)
  if (dataUrl) {
    return {
      inline_data: {
        mime_type: dataUrl.mimeType,
        data: dataUrl.data,
      },
    }
  }

  const response = await fetch(url)
  if (!response.ok) throw new Error(`Image download failed before Gemini request: ${response.status}`)

  const blob = await response.blob()
  const mimeType = blob.type || response.headers.get('Content-Type')?.split(';')[0] || 'image/png'
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return {
    inline_data: {
      mime_type: mimeType,
      data: bytesToBase64(bytes),
    },
  }
}

const imageResourceAsInlineData = async (
  resource: Resource,
  loadResourceBlob?: ResourceBlobLoader,
): Promise<GeminiInlineDataPart | undefined> => {
  const media = mediaValue(resource)
  if (!media?.url) return undefined
  const dataUrl = parseImageDataUrl(media.url)
  if (dataUrl) {
    return {
      inline_data: {
        mime_type: dataUrl.mimeType,
        data: dataUrl.data,
      },
    }
  }

  if (!loadResourceBlob) return imageUrlAsInlineData(media.url)
  const blob = await loadResourceBlob(resource)
  const mimeType = blob.type || media.mimeType || 'image/png'
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return {
    inline_data: {
      mime_type: mimeType,
      data: bytesToBase64(bytes),
    },
  }
}

const contentPartForMessage = async (
  role: GeminiLlmMessage['role'],
  part: GeminiLlmContentPart,
  inputValues: RuntimeInputValues,
  resources: Record<string, Resource>,
  loadResourceBlob?: ResourceBlobLoader,
): Promise<GeminiRequestPart | undefined> => {
  if (part.type === 'text') {
    const text = part.content.trim()
    return text ? { text } : undefined
  }

  if (role !== 'user') return undefined
  const directValue = part.content.trim()
  const imageUrl =
    directValue.startsWith('http://') || directValue.startsWith('https://') || directValue.startsWith('data:image/')
      ? directValue
      : undefined
  const imageResource = imageResourceFromContent(part.content, inputValues, resources)
  if (imageResource) return imageResourceAsInlineData(imageResource, loadResourceBlob)
  if (!imageUrl) return undefined

  return imageUrlAsInlineData(imageUrl)
}

export async function createGeminiGenerateContentRequest(
  config: GeminiLlmConfig,
  inputValues: RuntimeInputValues,
  resources: Record<string, Resource>,
  loadResourceBlob?: ResourceBlobLoader,
): Promise<GeminiGenerateContentRequest> {
  const systemParts: GeminiTextPart[] = []
  const contents: GeminiRequestContent[] = []

  for (const message of config.messages) {
    const parts = (
      await Promise.all(
        message.content.map((part) => contentPartForMessage(message.role, part, inputValues, resources, loadResourceBlob)),
      )
    ).filter((part): part is GeminiRequestPart => Boolean(part))

    if (parts.length === 0) continue
    if (message.role === 'system') {
      systemParts.push(...parts.filter((part): part is GeminiTextPart => 'text' in part))
    } else {
      contents.push({ role: message.role, parts })
    }
  }

  return {
    ...(systemParts.length ? { system_instruction: { parts: systemParts } } : {}),
    contents,
  }
}

export function extractGeminiGenerateContentText(response: unknown): string {
  if (typeof response !== 'object' || response === null) return ''

  const candidates = (response as { candidates?: unknown }).candidates
  const firstCandidate = Array.isArray(candidates) ? candidates[0] : undefined
  const content =
    typeof firstCandidate === 'object' && firstCandidate !== null
      ? (firstCandidate as { content?: unknown }).content
      : undefined
  if (typeof content !== 'object' || content === null) return ''

  const parts = (content as { parts?: unknown }).parts
  if (!Array.isArray(parts)) return ''

  return parts
    .map((part) => (typeof part === 'object' && part !== null ? (part as { text?: unknown }).text : undefined))
    .filter((text): text is string => typeof text === 'string' && text.trim().length > 0)
    .join('\n')
    .trim()
}
