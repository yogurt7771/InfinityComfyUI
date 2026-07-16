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

export function normalizeComfyEndpointCredentials(endpoint: ComfyEndpointConfig): ComfyEndpointConfig {
  const auth = endpoint.auth
  const token = auth?.token
  const password = auth?.type === 'password' ? auth.password : undefined
  return {
    ...endpoint,
    auth: password
      ? { type: 'password', password, token, exportSecret: auth?.exportSecret }
      : token
        ? { type: 'token', token, exportSecret: auth?.exportSecret }
        : { type: 'none' },
  }
}

export const normalizeComfyEndpointCredentialsList = (endpoints: ComfyEndpointConfig[]) =>
  endpoints.map(normalizeComfyEndpointCredentials)
