// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComfyClient } from '../domain/comfyClient'
import { comfyProxyAuthUrl, comfyProxyUrl } from '../domain/comfyProxy'

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

  it('routes browser API requests through a bearer-backed proxy session without repeating Authorization', async () => {
    const browserOrigin = 'https://infinity.test:7930'
    vi.stubGlobal('location', { origin: browserOrigin })
    vi.stubGlobal('window', { location: { origin: browserOrigin, href: `${browserOrigin}/` } })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(systemStatsResponse())
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

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(1, new URL(comfyProxyAuthUrl(endpointBaseUrl), browserOrigin), {
      method: 'POST',
      cache: 'no-store',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bearerToken: 'endpoint-token' }),
    })
    const [requestUrl, requestInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    const parsedRequestUrl = new URL(requestUrl, browserOrigin)
    expect(parsedRequestUrl.origin).toBe(browserOrigin)
    expect(parsedRequestUrl.pathname).toBe(`${comfyProxyUrl(endpointBaseUrl)}system_stats`)
    expect(requestInit).toMatchObject({
      method: 'GET',
      headers: {
        'X-Workspace': 'infinity',
      },
    })
    expect(new Headers(requestInit.headers).has('Authorization')).toBe(false)
  })

  it('establishes a password-backed proxy session before a cookie-only browser API request', async () => {
    const browserOrigin = 'https://infinity.test:7930'
    vi.stubGlobal('location', { origin: browserOrigin })
    vi.stubGlobal('window', { location: { origin: browserOrigin, href: `${browserOrigin}/` } })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(systemStatsResponse())
    vi.stubGlobal('fetch', fetchMock)
    const { projectStore } = await import('./projectStore')
    const endpoint = {
      ...projectStore.getState().project.comfy.endpoints[0]!,
      baseUrl: endpointBaseUrl,
      auth: { type: 'password' as const, password: 'fixture-runtime-password' },
      customHeaders: { 'X-Workspace': 'cookie-only' },
    }
    projectStore.setState((state) => ({
      project: {
        ...state.project,
        comfy: { ...state.project.comfy, endpoints: [endpoint] },
      },
    }))

    await projectStore.getState().checkEndpointStatus(endpoint.id)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(1, new URL(comfyProxyAuthUrl(endpointBaseUrl), browserOrigin), {
      method: 'POST',
      cache: 'no-store',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'fixture-runtime-password' }),
    })
    const [requestUrl, requestInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(new URL(requestUrl, browserOrigin).pathname).toBe(`${comfyProxyUrl(endpointBaseUrl)}system_stats`)
    expect(requestInit).toMatchObject({
      method: 'GET',
      headers: { 'X-Workspace': 'cookie-only' },
    })
    expect(new Headers(requestInit.headers).has('Authorization')).toBe(false)
  })

  it('sends a password and legacy fallback token only to the proxy bootstrap, not the browser API request', async () => {
    const browserOrigin = 'https://infinity.test:7930'
    vi.stubGlobal('location', { origin: browserOrigin })
    vi.stubGlobal('window', { location: { origin: browserOrigin, href: `${browserOrigin}/` } })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(systemStatsResponse())
    vi.stubGlobal('fetch', fetchMock)
    const { projectStore } = await import('./projectStore')
    const endpoint = {
      ...projectStore.getState().project.comfy.endpoints[0]!,
      baseUrl: endpointBaseUrl,
      auth: {
        type: 'password' as const,
        password: 'fixture-runtime-password-with-fallback',
        token: 'fixture-runtime-fallback-token',
      },
      customHeaders: { 'X-Workspace': 'password-with-fallback' },
    }
    projectStore.setState((state) => ({
      project: {
        ...state.project,
        comfy: { ...state.project.comfy, endpoints: [endpoint] },
      },
    }))

    await projectStore.getState().checkEndpointStatus(endpoint.id)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(1, new URL(comfyProxyAuthUrl(endpointBaseUrl), browserOrigin), {
      method: 'POST',
      cache: 'no-store',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bearerToken: 'fixture-runtime-fallback-token',
        password: 'fixture-runtime-password-with-fallback',
      }),
    })
    const [, requestInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(requestInit).toMatchObject({
      method: 'GET',
      headers: { 'X-Workspace': 'password-with-fallback' },
    })
    expect(new Headers(requestInit.headers).has('Authorization')).toBe(false)
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
