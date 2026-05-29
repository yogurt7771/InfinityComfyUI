export const COMFY_PROXY_PREFIX = '/__comfy_proxy/'

export function normalizedComfyBaseUrl(baseUrl: string) {
  const parsed = new URL(baseUrl)
  parsed.hash = ''
  parsed.search = ''
  return parsed.toString().replace(/\/+$/, '')
}

export function comfyProxyUrl(baseUrl: string) {
  return `${COMFY_PROXY_PREFIX}${encodeURIComponent(normalizedComfyBaseUrl(baseUrl))}/`
}
