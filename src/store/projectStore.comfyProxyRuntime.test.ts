// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComfyClient } from '../domain/comfyClient'

const browserOrigin = 'https://infinity.test:7930'
const endpointBaseUrl = 'http://127.0.0.1:27707'

const systemStatsResponse = (status = 200) =>
  new Response(status === 200 ? JSON.stringify({ system: { comfyui_version: 'test' } }) : null, {
    status,
    headers: status === 200 ? { 'Content-Type': 'application/json' } : undefined,
  })

const deferredResponse = () => {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('default project runtime direct ComfyUI routing', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('location', { origin: browserOrigin })
    vi.stubGlobal('window', { location: { origin: browserOrigin, href: `${browserOrigin}/` } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends bearer-backed browser API requests directly with Authorization and custom headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(systemStatsResponse())
    vi.stubGlobal('fetch', fetchMock)
    const { projectStore } = await import('./projectStore')
    const endpoint = {
      ...projectStore.getState().project.comfy.endpoints[0]!,
      baseUrl: `${endpointBaseUrl}/`,
      auth: { type: 'token' as const, token: 'endpoint-token' },
      customHeaders: { 'X-Workspace': 'infinity' },
    }
    projectStore.setState((state) => ({
      project: { ...state.project, comfy: { ...state.project.comfy, endpoints: [endpoint] } },
    }))

    await projectStore.getState().checkEndpointStatus(endpoint.id)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(`${endpointBaseUrl}/system_stats`, {
      method: 'GET',
      headers: { Authorization: 'Bearer endpoint-token', 'X-Workspace': 'infinity' },
    })
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/__comfy_proxy/'))).toBe(false)
  })

  it('does not bootstrap or expose a password when no bearer fallback is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(systemStatsResponse())
    vi.stubGlobal('fetch', fetchMock)
    const { projectStore } = await import('./projectStore')
    const endpoint = {
      ...projectStore.getState().project.comfy.endpoints[0]!,
      baseUrl: endpointBaseUrl,
      auth: { type: 'password' as const, password: 'ui-password' },
      customHeaders: { 'X-Workspace': 'password-direct' },
    }
    projectStore.setState((state) => ({
      project: { ...state.project, comfy: { ...state.project.comfy, endpoints: [endpoint] } },
    }))

    await projectStore.getState().checkEndpointStatus(endpoint.id)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(`${endpointBaseUrl}/system_stats`, {
      method: 'GET',
      headers: { 'X-Workspace': 'password-direct' },
    })
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('ui-password')
  })

  it('uses a password endpoint fallback token as direct bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(systemStatsResponse())
    vi.stubGlobal('fetch', fetchMock)
    const { projectStore } = await import('./projectStore')
    const endpoint = {
      ...projectStore.getState().project.comfy.endpoints[0]!,
      baseUrl: endpointBaseUrl,
      auth: { type: 'password' as const, password: 'ui-password', token: 'fallback-token' },
    }
    projectStore.setState((state) => ({
      project: { ...state.project, comfy: { ...state.project.comfy, endpoints: [endpoint] } },
    }))

    await projectStore.getState().checkEndpointStatus(endpoint.id)

    expect(fetchMock).toHaveBeenCalledWith(`${endpointBaseUrl}/system_stats`, {
      method: 'GET',
      headers: { Authorization: 'Bearer fallback-token' },
    })
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('ui-password')
  })

  it('lets concurrent clients issue independent direct requests for the same endpoint config', async () => {
    const fetchMock = vi.fn().mockResolvedValue(systemStatsResponse())
    vi.stubGlobal('fetch', fetchMock)
    const { projectStore } = await import('./projectStore')
    const endpoint = {
      ...projectStore.getState().project.comfy.endpoints[0]!,
      baseUrl: endpointBaseUrl,
      auth: { type: 'token' as const, token: 'shared-token' },
      customHeaders: { 'X-Workspace': 'shared' },
    }
    projectStore.setState((state) => ({
      project: { ...state.project, comfy: { ...state.project.comfy, endpoints: [endpoint] } },
    }))

    await Promise.all([
      projectStore.getState().checkEndpointStatus(endpoint.id),
      projectStore.getState().checkEndpointStatus(endpoint.id),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every(([input]) => input === `${endpointBaseUrl}/system_stats`)).toBe(true)
    expect(fetchMock.mock.calls.every(([, init]) => new Headers(init?.headers).get('Authorization') === 'Bearer shared-token')).toBe(true)
  })

  it('does not retry or prepare a recovery session after a direct 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue(systemStatsResponse(401))
    vi.stubGlobal('fetch', fetchMock)
    const { projectStore } = await import('./projectStore')
    const endpoint = {
      ...projectStore.getState().project.comfy.endpoints[0]!,
      baseUrl: endpointBaseUrl,
      auth: { type: 'token' as const, token: 'expired-token' },
    }
    projectStore.setState((state) => ({
      project: { ...state.project, comfy: { ...state.project.comfy, endpoints: [endpoint] } },
    }))

    await projectStore.getState().checkEndpointStatus(endpoint.id)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(projectStore.getState().project.comfy.endpoints[0]?.health?.status).toBe('offline')
  })

  it('performs one fresh direct request per explicit check even after an earlier 401', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(systemStatsResponse(401))
      .mockResolvedValueOnce(systemStatsResponse())
    vi.stubGlobal('fetch', fetchMock)
    const { projectStore } = await import('./projectStore')
    const endpoint = { ...projectStore.getState().project.comfy.endpoints[0]!, baseUrl: endpointBaseUrl }
    projectStore.setState((state) => ({
      project: { ...state.project, comfy: { ...state.project.comfy, endpoints: [endpoint] } },
    }))

    await projectStore.getState().checkEndpointStatus(endpoint.id)
    await projectStore.getState().checkEndpointStatus(endpoint.id)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(projectStore.getState().project.comfy.endpoints[0]?.health?.status).toBe('online')
  })

  it('keeps direct targets and credentials isolated between endpoint configs', async () => {
    const calls: Array<{ url: string; authorization: string | null; workspace: string | null }> = []
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      calls.push({
        url: String(input),
        authorization: headers.get('Authorization'),
        workspace: headers.get('X-Workspace'),
      })
      return systemStatsResponse()
    })
    vi.stubGlobal('fetch', fetchMock)
    const { projectStore } = await import('./projectStore')
    const template = projectStore.getState().project.comfy.endpoints[0]!
    const first = { ...template, id: 'first', baseUrl: endpointBaseUrl, auth: { type: 'token' as const, token: 'first-token' }, customHeaders: { 'X-Workspace': 'first' } }
    const second = { ...template, id: 'second', baseUrl: 'http://127.0.0.1:8188', auth: { type: 'token' as const, token: 'second-token' }, customHeaders: { 'X-Workspace': 'second' } }
    projectStore.setState((state) => ({ project: { ...state.project, comfy: { ...state.project.comfy, endpoints: [first, second] } } }))

    await projectStore.getState().checkComfyEndpointStatuses()

    expect(calls).toEqual(expect.arrayContaining([
      { url: `${endpointBaseUrl}/system_stats`, authorization: 'Bearer first-token', workspace: 'first' },
      { url: 'http://127.0.0.1:8188/system_stats', authorization: 'Bearer second-token', workspace: 'second' },
    ]))
  })

  it('does not share credentials between concurrent endpoint IDs with one base URL', async () => {
    const seenTokens: Array<string | null> = []
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      seenTokens.push(new Headers(init?.headers).get('Authorization'))
      return systemStatsResponse()
    }))
    const { projectStore } = await import('./projectStore')
    const template = projectStore.getState().project.comfy.endpoints[0]!
    const endpoints = [
      { ...template, id: 'first', baseUrl: endpointBaseUrl, auth: { type: 'token' as const, token: 'first-token' } },
      { ...template, id: 'second', baseUrl: endpointBaseUrl, auth: { type: 'token' as const, token: 'second-token' } },
    ]
    projectStore.setState((state) => ({ project: { ...state.project, comfy: { ...state.project.comfy, endpoints } } }))

    await projectStore.getState().checkComfyEndpointStatuses()

    expect(seenTokens).toEqual(expect.arrayContaining(['Bearer first-token', 'Bearer second-token']))
    expect(seenTokens).toHaveLength(2)
  })

  it('uses each endpoint snapshot directly when configuration changes during an in-flight request', async () => {
    const oldResponse = deferredResponse()
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      calls.push(String(input))
      return String(input).startsWith(endpointBaseUrl) ? oldResponse.promise : Promise.resolve(systemStatsResponse())
    }))
    const { projectStore } = await import('./projectStore')
    const endpoint = { ...projectStore.getState().project.comfy.endpoints[0]!, baseUrl: endpointBaseUrl }
    projectStore.setState((state) => ({ project: { ...state.project, comfy: { ...state.project.comfy, endpoints: [endpoint] } } }))

    const oldCheck = projectStore.getState().checkEndpointStatus(endpoint.id)
    projectStore.getState().updateEndpoint(endpoint.id, { baseUrl: 'http://127.0.0.1:8188' })
    const newCheck = projectStore.getState().checkEndpointStatus(endpoint.id)
    await newCheck
    oldResponse.resolve(systemStatsResponse())
    await oldCheck

    expect(calls).toEqual([
      `${endpointBaseUrl}/system_stats`,
      'http://127.0.0.1:8188/system_stats',
    ])
  })

  it('does not recover an old 401 while a new endpoint configuration connects directly', async () => {
    const oldResponse = deferredResponse()
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      calls.push(String(input))
      return String(input).startsWith(endpointBaseUrl) ? oldResponse.promise : Promise.resolve(systemStatsResponse())
    }))
    const { projectStore } = await import('./projectStore')
    const endpoint = { ...projectStore.getState().project.comfy.endpoints[0]!, baseUrl: endpointBaseUrl }
    projectStore.setState((state) => ({ project: { ...state.project, comfy: { ...state.project.comfy, endpoints: [endpoint] } } }))

    const oldCheck = projectStore.getState().checkEndpointStatus(endpoint.id)
    projectStore.getState().updateEndpoint(endpoint.id, { baseUrl: 'http://127.0.0.1:8188' })
    await projectStore.getState().checkEndpointStatus(endpoint.id)
    oldResponse.resolve(systemStatsResponse(401))
    await oldCheck

    expect(calls).toEqual([
      `${endpointBaseUrl}/system_stats`,
      'http://127.0.0.1:8188/system_stats',
    ])
    expect(calls.every((url) => !url.includes('/__comfy_proxy/'))).toBe(true)
  })

  it('creates a direct WebSocket URL on the ComfyUI host with client and token query parameters', () => {
    const client = new ComfyClient({
      baseUrl: `${endpointBaseUrl}/comfy/`,
      clientId: 'browser-client',
      token: 'socket-token',
    })

    const websocketUrl = new URL(client.createWebSocketUrl())

    expect(websocketUrl.origin).toBe('ws://127.0.0.1:27707')
    expect(websocketUrl.pathname).toBe('/comfy/ws')
    expect(websocketUrl.searchParams.get('clientId')).toBe('browser-client')
    expect(websocketUrl.searchParams.get('token')).toBe('socket-token')
  })

  it('uses the endpoint URL directly when no browser window exists', async () => {
    vi.unstubAllGlobals()
    const fetchMock = vi.fn().mockResolvedValue(systemStatsResponse())
    vi.stubGlobal('fetch', fetchMock)
    const { projectStore } = await import('./projectStore')
    const endpoint = { ...projectStore.getState().project.comfy.endpoints[0]!, baseUrl: endpointBaseUrl }
    projectStore.setState((state) => ({ project: { ...state.project, comfy: { ...state.project.comfy, endpoints: [endpoint] } } }))

    await projectStore.getState().checkEndpointStatus(endpoint.id)

    expect(fetchMock).toHaveBeenCalledWith(`${endpointBaseUrl}/system_stats`, {
      method: 'GET',
      headers: {},
    })
  })
})
