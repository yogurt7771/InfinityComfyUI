// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComfyClient } from '../domain/comfyClient'
import { comfyProxyUrl } from '../domain/comfyProxy'

const endpointBaseUrl = 'http://127.0.0.1:27707'

const systemStatsResponse = () =>
  new Response(JSON.stringify({ system: { comfyui_version: 'test' } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

describe('default project runtime ComfyUI proxy routing', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('routes browser API requests through the current-origin proxy and preserves endpoint auth headers', async () => {
    const browserOrigin = 'https://infinity.test:7930'
    vi.stubGlobal('window', { location: { origin: browserOrigin } })
    const fetchMock = vi.fn().mockResolvedValue(systemStatsResponse())
    vi.stubGlobal('fetch', fetchMock)
    const { projectStore } = await import('./projectStore')
    const endpoint = {
      ...projectStore.getState().project.comfy.endpoints[0]!,
      baseUrl: endpointBaseUrl,
      auth: { type: 'token' as const, token: 'endpoint-token' },
      customHeaders: { 'X-Workspace': 'infinity' },
    }
    projectStore.setState((state) => ({
      project: {
        ...state.project,
        comfy: { ...state.project.comfy, endpoints: [endpoint] },
      },
    }))

    await projectStore.getState().checkEndpointStatus(endpoint.id)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const parsedRequestUrl = new URL(requestUrl, browserOrigin)
    expect(parsedRequestUrl.origin).toBe(browserOrigin)
    expect(parsedRequestUrl.pathname).toBe(`${comfyProxyUrl(endpointBaseUrl)}system_stats`)
    expect(requestInit).toMatchObject({
      method: 'GET',
      headers: {
        Authorization: 'Bearer endpoint-token',
        'X-Workspace': 'infinity',
      },
    })
  })

  it('keeps the proxy path when creating a browser WebSocket URL', () => {
    const browserOrigin = 'https://infinity.test:7930'
    const proxyBaseUrl = new URL(comfyProxyUrl(endpointBaseUrl), browserOrigin).toString()
    const client = new ComfyClient({ baseUrl: proxyBaseUrl, clientId: 'browser-client' })

    const websocketUrl = new URL(client.createWebSocketUrl())

    expect(websocketUrl.protocol).toBe('wss:')
    expect(websocketUrl.origin).toBe('wss://infinity.test:7930')
    expect(websocketUrl.pathname).toBe(`${comfyProxyUrl(endpointBaseUrl)}ws`)
    expect(websocketUrl.searchParams.get('clientId')).toBe('browser-client')
  })

  it('uses the endpoint URL directly when no browser window exists', async () => {
    Reflect.deleteProperty(globalThis, 'window')
    const fetchMock = vi.fn().mockResolvedValue(systemStatsResponse())
    vi.stubGlobal('fetch', fetchMock)
    const { projectStore } = await import('./projectStore')
    const endpoint = {
      ...projectStore.getState().project.comfy.endpoints[0]!,
      baseUrl: endpointBaseUrl,
    }
    projectStore.setState((state) => ({
      project: {
        ...state.project,
        comfy: { ...state.project.comfy, endpoints: [endpoint] },
      },
    }))

    await projectStore.getState().checkEndpointStatus(endpoint.id)

    expect(fetchMock).toHaveBeenCalledWith(`${endpointBaseUrl}/system_stats`, {
      method: 'GET',
      headers: {},
    })
  })
})
