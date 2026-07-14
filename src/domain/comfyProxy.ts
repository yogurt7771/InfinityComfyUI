export const COMFY_PROXY_PREFIX = '/__comfy_proxy/'
export const COMFY_PROXY_AUTH_PREFIX = '/__comfy_proxy/auth/'

type BrowserProxyRuntime = typeof globalThis & {
  location?: { origin?: string }
  infinityComfyUIStorage?: {
    authorizeComfyProxyTarget?: (baseUrl: string) => Promise<{ ok: boolean }>
  }
}

const browserRuntime = () => globalThis as BrowserProxyRuntime
const COMFY_FRAME_ORIGIN_STORAGE_KEY = 'infinity-comfyui:comfy-frame-origins:v1'
const comfyFrameLabels = new Map<string, string>()
const validFrameLabel = (value: unknown): value is string =>
  typeof value === 'string' && /^frame-[a-f0-9]{32}$/.test(value)

const currentBrowserOrigin = () => {
  const origin = browserRuntime().location?.origin
  if (!origin || origin === 'null') throw new Error('ComfyUI proxy requires a browser origin')
  return origin
}

export function normalizedComfyBaseUrl(baseUrl: string) {
  const parsed = new URL(baseUrl)
  parsed.hash = ''
  parsed.search = ''
  return parsed.toString().replace(/\/+$/, '')
}

export function comfyProxyTokenFromFileContent(content: string) {
  const token = content.split(/\r?\n/, 1)[0]?.trim()
  return token || undefined
}

export function comfyProxyUrl(baseUrl: string) {
  return `${COMFY_PROXY_PREFIX}${encodeURIComponent(normalizedComfyBaseUrl(baseUrl))}/`
}

export function comfyProxyAuthUrl(baseUrl: string) {
  return `${COMFY_PROXY_AUTH_PREFIX}${encodeURIComponent(normalizedComfyBaseUrl(baseUrl))}`
}

const isolatedFrameLabel = () => {
  const random = crypto.getRandomValues(new Uint8Array(16))
  return `frame-${Array.from(random, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

const persistedComfyFrameLabels = () => {
  try {
    const raw = localStorage.getItem(COMFY_FRAME_ORIGIN_STORAGE_KEY)
    if (!raw) return {} as Record<string, string>
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {} as Record<string, string>
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => validFrameLabel(entry[1]))
        .slice(-64),
    )
  } catch {
    return {} as Record<string, string>
  }
}

const persistentIsolatedFrameLabel = (baseUrl: string) => {
  const targetBase = normalizedComfyBaseUrl(baseUrl)
  const memoryLabel = comfyFrameLabels.get(targetBase)
  if (memoryLabel) return memoryLabel

  const persisted = persistedComfyFrameLabels()
  const persistedLabel = persisted[targetBase]
  if (validFrameLabel(persistedLabel)) {
    comfyFrameLabels.set(targetBase, persistedLabel)
    return persistedLabel
  }

  const label = isolatedFrameLabel()
  comfyFrameLabels.set(targetBase, label)
  try {
    localStorage.setItem(COMFY_FRAME_ORIGIN_STORAGE_KEY, JSON.stringify({ ...persisted, [targetBase]: label }))
  } catch {
    // In-memory reuse still gives the current browser session a stable isolated origin when storage is unavailable.
  }
  return label
}

export function isolatedComfyProxyOrigin(appOrigin: string, label = isolatedFrameLabel()) {
  if (!/^frame-[a-f0-9]{32}$/.test(label)) throw new Error('Invalid ComfyUI frame label')
  const parsed = new URL(appOrigin)
  const hostname = parsed.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost')) {
    parsed.hostname = `${label}.localhost`
  } else {
    parsed.hostname = `${label}.comfy-proxy.${hostname}`
  }
  return parsed.origin
}

export interface ComfyProxyCredentials {
  bearerToken?: string
  password?: string
}

type ComfyProxyCredentialInput = string | ComfyProxyCredentials | undefined

function normalizedComfyProxyCredentials(
  credentials: ComfyProxyCredentialInput,
  passwordOverride?: string,
): ComfyProxyCredentials {
  if (typeof credentials === 'string') {
    return {
      bearerToken: credentials.trim() || undefined,
      password: passwordOverride || undefined,
    }
  }
  return {
    bearerToken: credentials?.bearerToken?.trim() || undefined,
    password: passwordOverride || credentials?.password || undefined,
  }
}

async function createComfyProxySession(
  baseUrl: string,
  credentials: ComfyProxyCredentialInput,
  authOrigin: string,
  password?: string,
) {
  await browserRuntime().infinityComfyUIStorage?.authorizeComfyProxyTarget?.(normalizedComfyBaseUrl(baseUrl))
  const normalizedCredentials = normalizedComfyProxyCredentials(credentials, password)
  const response = await fetch(new URL(comfyProxyAuthUrl(baseUrl), authOrigin), {
    method: 'POST',
    cache: 'no-store',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalizedCredentials),
  })

  if (!response.ok) throw new Error(`Unable to prepare the ComfyUI proxy session (${response.status})`)
}

export async function prepareComfyProxySession(
  baseUrl: string,
  credentials?: ComfyProxyCredentialInput,
  password?: string,
) {
  const appOrigin = currentBrowserOrigin()
  await createComfyProxySession(baseUrl, credentials, appOrigin, password)
}

export async function prepareIsolatedComfyProxySession(
  baseUrl: string,
  credentials?: ComfyProxyCredentialInput,
  password?: string,
) {
  const frameOrigin = isolatedComfyProxyOrigin(currentBrowserOrigin(), persistentIsolatedFrameLabel(baseUrl))
  await createComfyProxySession(baseUrl, credentials, frameOrigin, password)
  return {
    frameOrigin,
    proxyUrl: new URL(comfyProxyUrl(baseUrl), frameOrigin).toString(),
  }
}
