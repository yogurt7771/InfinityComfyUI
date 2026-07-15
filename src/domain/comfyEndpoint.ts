import type { ComfyEndpointConfig } from './types'

const invalidEndpointMessage =
  'ComfyUI server URL must use http:// or https:// and cannot include embedded credentials.'

export function parseComfyEndpointUrl(baseUrl: string) {
  let url: URL
  try {
    url = new URL(baseUrl.trim())
  } catch {
    throw new TypeError(invalidEndpointMessage)
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new TypeError(invalidEndpointMessage)
  }
  return url
}

export function assertSafeComfyEndpoints(endpoints: ComfyEndpointConfig[]) {
  for (const endpoint of endpoints) parseComfyEndpointUrl(endpoint.baseUrl)
}

export function normalizeBrowserDirectComfyEndpoint(endpoint: ComfyEndpointConfig): ComfyEndpointConfig {
  const token = endpoint.auth?.token
  return {
    ...endpoint,
    auth: token
      ? { type: 'token', token, exportSecret: endpoint.auth?.exportSecret }
      : { type: 'none' },
  }
}

export const normalizeBrowserDirectComfyEndpoints = (endpoints: ComfyEndpointConfig[]) =>
  endpoints.map(normalizeBrowserDirectComfyEndpoint)
