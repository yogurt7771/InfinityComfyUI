import type {
  GenerationFunction,
  OpenAIImageDetail,
  OpenAILlmConfig,
  OpenAILlmContentPart,
  OpenAILlmMessage,
  PrimitiveInputValue,
  Resource,
  ResourceRef,
} from './types'

export const OPENAI_LLM_FUNCTION_ID = 'fn_openai_llm'

type RuntimeInputValues = Record<string, PrimitiveInputValue | ResourceRef>
type ResourceBlobLoader = (resource: Resource) => Promise<Blob>

type ChatCompletionTextPart = {
  type: 'text'
  text: string
}

type ChatCompletionImagePart = {
  type: 'image_url'
  image_url: {
    url: string
    detail: OpenAIImageDetail
  }
}

type ChatCompletionContentPart = ChatCompletionTextPart | ChatCompletionImagePart

type ChatCompletionMessage = {
  role: OpenAILlmMessage['role']
  content: ChatCompletionContentPart[]
}

export type OpenAIChatCompletionRequest = {
  model: string
  messages: ChatCompletionMessage[]
}

const defaultUserContent = (): OpenAILlmContentPart[] => [
  {
    type: 'text',
    content: 'Analyze the provided images and respond with useful text.',
  },
  ...Array.from({ length: 6 }, (_, index) => ({
    type: 'image_url' as const,
    content: `image_${index + 1}`,
    detail: 'auto' as const,
  })),
]

export const defaultOpenAILlmConfig = (): OpenAILlmConfig => ({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4.1-mini',
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

export function createOpenAILlmFunction(now: string): GenerationFunction {
  return {
    id: OPENAI_LLM_FUNCTION_ID,
    name: 'OpenAI LLM',
    description: 'Chat Completions multimodal text generator',
    category: 'LLM',
    workflow: {
      format: 'openai_chat_completions',
      rawJson: {},
    },
    openai: defaultOpenAILlmConfig(),
    inputs: Array.from({ length: 6 }, (_, index) => ({
      key: `image_${index + 1}`,
      label: `Image ${index + 1}`,
      type: 'image' as const,
      required: false,
      bind: { path: `openai.images.${index + 1}` },
      upload: { strategy: 'none' as const },
    })),
    outputs: [
      {
        key: 'text',
        label: 'Text',
        type: 'text',
        bind: { path: 'choices.0.message.content' },
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

export const isOpenAILlmFunction = (fn: GenerationFunction) =>
  fn.workflow.format === 'openai_chat_completions' || fn.workflow.format === 'openai_responses'

const isOpenAIMessageRole = (value: unknown): value is OpenAILlmMessage['role'] =>
  value === 'system' || value === 'developer' || value === 'user' || value === 'assistant'

const normalizeContentType = (value: unknown): OpenAILlmContentPart['type'] =>
  value === 'image_url' || value === 'input_image' ? 'image_url' : 'text'

const normalizeContentPart = (value: unknown): OpenAILlmContentPart | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const type = normalizeContentType(record.type)
  const contentValue = record.content ?? record.text ?? record.image_url
  const content =
    typeof contentValue === 'object' && contentValue !== null && 'url' in contentValue
      ? String((contentValue as { url: unknown }).url)
      : String(contentValue ?? '')

  return {
    type,
    content,
    detail: type === 'image_url' && (record.detail === 'low' || record.detail === 'high') ? record.detail : 'auto',
  }
}

const normalizeMessages = (messages: unknown): OpenAILlmMessage[] => {
  if (!Array.isArray(messages)) return defaultOpenAILlmConfig().messages

  const normalized: OpenAILlmMessage[] = []
  for (const item of messages) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const role = isOpenAIMessageRole(record.role) ? record.role : 'user'
    const parts = Array.isArray(record.content)
      ? record.content.map(normalizeContentPart).filter((part): part is OpenAILlmContentPart => Boolean(part))
      : [normalizeContentPart(record)].filter((part): part is OpenAILlmContentPart => Boolean(part))

    if (parts.length === 0) continue
    const previous = normalized[normalized.length - 1]
    if (previous?.role === role) {
      previous.content.push(...parts)
    } else {
      normalized.push({ role, content: parts })
    }
  }

  return normalized.length > 0 ? normalized : defaultOpenAILlmConfig().messages
}

export const mergedOpenAILlmConfig = (base?: OpenAILlmConfig, override?: Partial<OpenAILlmConfig>): OpenAILlmConfig => {
  const fallback = defaultOpenAILlmConfig()
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

const imageUrlAsDataUrl = async (url: string) => {
  if (url.startsWith('data:image/')) return url

  const response = await fetch(url)
  if (!response.ok) throw new Error(`Image download failed before OpenAI request: ${response.status}`)

  const blob = await response.blob()
  const mimeType = blob.type || response.headers.get('Content-Type')?.split(';')[0] || 'image/png'
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`
}

const imageResourceAsDataUrl = async (resource: Resource, loadResourceBlob?: ResourceBlobLoader) => {
  const media = mediaValue(resource)
  if (!media?.url) return undefined
  if (media.url.startsWith('data:image/')) return media.url

  if (!loadResourceBlob) return imageUrlAsDataUrl(media.url)
  const blob = await loadResourceBlob(resource)
  const mimeType = blob.type || media.mimeType || 'image/png'
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`
}

const contentPartForMessage = async (
  role: OpenAILlmMessage['role'],
  part: OpenAILlmContentPart,
  inputValues: RuntimeInputValues,
  resources: Record<string, Resource>,
  loadResourceBlob?: ResourceBlobLoader,
): Promise<ChatCompletionContentPart | undefined> => {
  if (part.type === 'text') {
    const text = part.content.trim()
    return text ? { type: 'text', text } : undefined
  }

  if (role !== 'user') return undefined
  const directValue = part.content.trim()
  const imageUrl =
    directValue.startsWith('http://') || directValue.startsWith('https://') || directValue.startsWith('data:image/')
      ? directValue
      : undefined
  const imageResource = imageResourceFromContent(part.content, inputValues, resources)
  const resolvedImageUrl = imageResource ? await imageResourceAsDataUrl(imageResource, loadResourceBlob) : imageUrl
  if (!resolvedImageUrl) return undefined

  return {
    type: 'image_url',
    image_url: {
      url: imageResource ? resolvedImageUrl : await imageUrlAsDataUrl(resolvedImageUrl),
      detail: part.detail ?? 'auto',
    },
  }
}

export async function createOpenAIChatCompletionRequest(
  config: OpenAILlmConfig,
  inputValues: RuntimeInputValues,
  resources: Record<string, Resource>,
  loadResourceBlob?: ResourceBlobLoader,
): Promise<OpenAIChatCompletionRequest> {
  const messages = await Promise.all(
    config.messages.map(async (message) => ({
      role: message.role,
      content: (
        await Promise.all(
          message.content.map((part) => contentPartForMessage(message.role, part, inputValues, resources, loadResourceBlob)),
        )
      ).filter((part): part is ChatCompletionContentPart => Boolean(part)),
    })),
  )

  return {
    model: config.model.trim() || 'gpt-4.1-mini',
    messages: messages.filter((message) => message.content.length > 0),
  }
}

const collectTextParts = (value: unknown): string[] => {
  if (typeof value !== 'object' || value === null) return []

  if ('type' in value && (value as { type?: unknown }).type === 'text' && 'text' in value) {
    const text = (value as { text?: unknown }).text
    return typeof text === 'string' ? [text] : []
  }

  if (Array.isArray(value)) return value.flatMap(collectTextParts)
  return Object.values(value).flatMap(collectTextParts)
}

export function extractOpenAIChatCompletionText(response: unknown): string {
  if (typeof response !== 'object' || response === null) return ''

  const choices = (response as { choices?: unknown }).choices
  const firstChoice = Array.isArray(choices) ? choices[0] : undefined
  const message = typeof firstChoice === 'object' && firstChoice !== null ? (firstChoice as { message?: unknown }).message : undefined
  if (typeof message === 'object' && message !== null) {
    const content = (message as { content?: unknown }).content
    if (typeof content === 'string' && content.trim()) return content
    const textParts = collectTextParts(content).filter((text) => text.trim())
    if (textParts.length > 0) return textParts.join('\n').trim()
  }

  const outputText = (response as { output_text?: unknown }).output_text
  return typeof outputText === 'string' ? outputText : ''
}
