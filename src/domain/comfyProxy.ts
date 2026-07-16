export const COMFY_PROXY_PREFIX = '/__comfy_proxy/'
export const COMFY_PROXY_TOKEN_PARAM = '__infinity_comfy_token'
export const COMFY_PROXY_LOGIN_MESSAGE = 'infinity-comfy-login'
export const COMFY_PROXY_LOGIN_READY_MESSAGE = `${COMFY_PROXY_LOGIN_MESSAGE}-ready`
export const COMFY_PROXY_LOGIN_HANDLED_MESSAGE = `${COMFY_PROXY_LOGIN_MESSAGE}-handled`

export type ComfyProxyUrlOptions = {
  bearerToken?: string
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

export function comfyProxyUrl(baseUrl: string, options: ComfyProxyUrlOptions = {}) {
  const proxyUrl = `${COMFY_PROXY_PREFIX}${encodeURIComponent(normalizedComfyBaseUrl(baseUrl))}/`
  const bearerToken = options.bearerToken?.trim()
  if (!bearerToken) return proxyUrl

  const params = new URLSearchParams({ [COMFY_PROXY_TOKEN_PARAM]: bearerToken })
  return `${proxyUrl}?${params.toString()}`
}

type ComfyProxyMessageTarget = {
  postMessage: (message: unknown, targetOrigin: string) => void
}

export function postComfyProxyPassword(
  target: ComfyProxyMessageTarget | null,
  password: string | undefined,
  targetOrigin: string,
) {
  if (!password || !target) return false
  target.postMessage(
    {
      type: COMFY_PROXY_LOGIN_MESSAGE,
      password,
    },
    targetOrigin,
  )
  return true
}

export function submitComfyProxyPassword(
  frame: { contentWindow: ComfyProxyMessageTarget | null },
  password: string | undefined,
  targetOrigin: string,
) {
  return postComfyProxyPassword(frame.contentWindow, password, targetOrigin)
}
