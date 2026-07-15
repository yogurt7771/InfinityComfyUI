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

  it('coalesces one proxy bootstrap across concurrent clients for the same endpoint config', async () => {
    const browserOrigin = 'https://infinity.test:7930'
    const password = 'fixture-concurrent-password'
    const token = 'fixture-concurrent-token'
    vi.stubGlobal('location', { origin: browserOrigin })
    vi.stubGlobal('window', { location: { origin: browserOrigin, href: `${browserOrigin}/` } })
    let releaseBootstrap: () => void = () => undefined
    let sessionReady = false
    const bootstrapGate = new Promise<void>((resolveGate) => {
      releaseBootstrap = () => {
        sessionReady = true
        resolveGate()
      }
    })
    const apiSessionStates: boolean[] = []
    const authPath = comfyProxyAuthUrl(endpointBaseUrl)
    const apiPath = `${comfyProxyUrl(endpointBaseUrl)}system_stats`
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      void _init
      const pathname = new URL(String(input), browserOrigin).pathname
      if (pathname === authPath) {
        return bootstrapGate.then(() => new Response(null, { status: 204 }))
      }
      if (pathname === apiPath) {
        apiSessionStates.push(sessionReady)
        return Promise.resolve(systemStatsResponse())
      }
      return Promise.reject(new Error(`Unexpected request: ${pathname}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { projectStore } = await import('./projectStore')
    const endpoint = {
      ...projectStore.getState().project.comfy.endpoints[0]!,
      baseUrl: endpointBaseUrl,
      auth: { type: 'password' as const, password, token },
      customHeaders: { 'X-Workspace': 'concurrent-session' },
    }
    projectStore.setState((state) => ({
      project: {
        ...state.project,
        comfy: { ...state.project.comfy, endpoints: [endpoint] },
      },
    }))

    const concurrentChecks = [
      projectStore.getState().checkEndpointStatus(endpoint.id),
      projectStore.getState().checkEndpointStatus(endpoint.id),
      projectStore.getState().checkEndpointStatus(endpoint.id),
    ]
    await Promise.resolve()
    releaseBootstrap()
    await Promise.all(concurrentChecks)

    const authCalls = fetchMock.mock.calls.filter(([input]) =>
      new URL(String(input), browserOrigin).pathname === authPath)
    const apiCalls = fetchMock.mock.calls.filter(([input]) =>
      new URL(String(input), browserOrigin).pathname === apiPath)
    expect(authCalls).toHaveLength(1)
    expect(authCalls[0]?.[1]).toEqual(expect.objectContaining({
      body: JSON.stringify({ bearerToken: token, password }),
      credentials: 'include',
      method: 'POST',
    }))
    expect(apiCalls).toHaveLength(3)
    expect(apiSessionStates).toEqual([true, true, true])
    for (const [input, init] of apiCalls) {
      expect(String(input)).not.toContain(password)
      expect(String(input)).not.toContain(token)
      expect(new Headers(init?.headers).has('Authorization')).toBe(false)
      expect(JSON.stringify(init)).not.toContain(password)
      expect(JSON.stringify(init)).not.toContain(token)
    }
    expect(fetchMock.mock.calls.every(([input]) => !String(input).includes(password) && !String(input).includes(token))).toBe(true)
  })

  it('re-establishes an expired proxy session and retries only the rejected API request once', async () => {
    const browserOrigin = 'https://infinity.test:7930'
    vi.stubGlobal('location', { origin: browserOrigin })
    vi.stubGlobal('window', { location: { origin: browserOrigin, href: `${browserOrigin}/` } })
    const authPath = comfyProxyAuthUrl(endpointBaseUrl)
    const apiPath = `${comfyProxyUrl(endpointBaseUrl)}system_stats`
    const trace: string[] = []
    let apiAttempt = 0
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      void _init
      const pathname = new URL(String(input), browserOrigin).pathname
      if (pathname === authPath) {
        trace.push('auth')
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (pathname === apiPath) {
        apiAttempt += 1
        trace.push(`api:${apiAttempt}`)
        return Promise.resolve(apiAttempt === 2
          ? new Response('expired session', { status: 401 })
          : systemStatsResponse())
      }
      return Promise.reject(new Error(`Unexpected request: ${pathname}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { projectStore } = await import('./projectStore')
    const endpoint = {
      ...projectStore.getState().project.comfy.endpoints[0]!,
      baseUrl: endpointBaseUrl,
      auth: { type: 'token' as const, token: 'fixture-refresh-token' },
    }
    projectStore.setState((state) => ({
      project: {
        ...state.project,
        comfy: { ...state.project.comfy, endpoints: [endpoint] },
      },
    }))

    await projectStore.getState().checkEndpointStatus(endpoint.id)
    await projectStore.getState().checkEndpointStatus(endpoint.id)

    expect(trace).toEqual(['auth', 'api:1', 'api:2', 'auth', 'api:3'])
    expect(projectStore.getState().project.comfy.endpoints[0]?.health?.status).toBe('online')
    const apiCalls = fetchMock.mock.calls.filter(([input]) =>
      new URL(String(input), browserOrigin).pathname === apiPath)
    expect(apiCalls).toHaveLength(3)
    expect(apiCalls.every(([, init]) => !new Headers(init?.headers).has('Authorization'))).toBe(true)
    expect(fetchMock.mock.calls.every(([input]) => !String(input).includes('fixture-refresh-token'))).toBe(true)
  })

  it('stops after one proxy-session recovery when the retried API request is still unauthorized', async () => {
    const browserOrigin = 'https://infinity.test:7930'
    vi.stubGlobal('location', { origin: browserOrigin })
    vi.stubGlobal('window', { location: { origin: browserOrigin, href: `${browserOrigin}/` } })
    const authPath = comfyProxyAuthUrl(endpointBaseUrl)
    const apiPath = `${comfyProxyUrl(endpointBaseUrl)}system_stats`
    const trace: string[] = []
    let apiAttempt = 0
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      void _init
      const pathname = new URL(String(input), browserOrigin).pathname
      if (pathname === authPath) {
        trace.push('auth')
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (pathname === apiPath) {
        apiAttempt += 1
        trace.push(`api:${apiAttempt}`)
        if (apiAttempt === 1) return Promise.resolve(systemStatsResponse())
        return Promise.resolve(new Response('still unauthorized', { status: 401 }))
      }
      return Promise.reject(new Error(`Unexpected request: ${pathname}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { projectStore } = await import('./projectStore')
    const endpoint = {
      ...projectStore.getState().project.comfy.endpoints[0]!,
      baseUrl: endpointBaseUrl,
      auth: { type: 'password' as const, password: 'fixture-retry-limit-password' },
    }
    projectStore.setState((state) => ({
      project: {
        ...state.project,
        comfy: { ...state.project.comfy, endpoints: [endpoint] },
      },
    }))

    await projectStore.getState().checkEndpointStatus(endpoint.id)
    await projectStore.getState().checkEndpointStatus(endpoint.id)

    expect(trace).toEqual(['auth', 'api:1', 'api:2', 'auth', 'api:3'])
    expect(projectStore.getState().project.comfy.endpoints[0]?.health?.status).toBe('offline')
    expect(apiAttempt).toBe(3)
  })

  it('keeps proxy-session state isolated between different endpoint configs', async () => {
    const browserOrigin = 'https://infinity.test:7930'
    const otherBaseUrl = 'http://127.0.0.1:8188'
    vi.stubGlobal('location', { origin: browserOrigin })
    vi.stubGlobal('window', { location: { origin: browserOrigin, href: `${browserOrigin}/` } })
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      void _init
      const pathname = new URL(String(input), browserOrigin).pathname
      if (pathname.startsWith('/__comfy_proxy/auth/')) {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (pathname.endsWith('/system_stats')) return Promise.resolve(systemStatsResponse())
      return Promise.reject(new Error(`Unexpected request: ${pathname}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { projectStore } = await import('./projectStore')
    const firstEndpoint = {
      ...projectStore.getState().project.comfy.endpoints[0]!,
      id: 'endpoint_session_first',
      baseUrl: endpointBaseUrl,
      auth: { type: 'token' as const, token: 'fixture-first-endpoint-token' },
    }
    const secondEndpoint = {
      ...firstEndpoint,
      id: 'endpoint_session_second',
      baseUrl: otherBaseUrl,
      auth: { type: 'password' as const, password: 'fixture-second-endpoint-password' },
    }
    projectStore.setState((state) => ({
      project: {
        ...state.project,
        comfy: { ...state.project.comfy, endpoints: [firstEndpoint, secondEndpoint] },
      },
    }))

    await Promise.all([
      projectStore.getState().checkEndpointStatus(firstEndpoint.id),
      projectStore.getState().checkEndpointStatus(secondEndpoint.id),
    ])

    const authCalls = fetchMock.mock.calls.filter(([input]) =>
      new URL(String(input), browserOrigin).pathname.startsWith('/__comfy_proxy/auth/'))
    expect(authCalls).toHaveLength(2)
    expect(authCalls.map(([input]) => new URL(String(input), browserOrigin).pathname)).toEqual(expect.arrayContaining([
      comfyProxyAuthUrl(endpointBaseUrl),
      comfyProxyAuthUrl(otherBaseUrl),
    ]))
    expect(authCalls.map(([, init]) => init?.body)).toEqual(expect.arrayContaining([
      JSON.stringify({ bearerToken: 'fixture-first-endpoint-token' }),
      JSON.stringify({ password: 'fixture-second-endpoint-password' }),
    ]))
    const apiCalls = fetchMock.mock.calls.filter(([input]) =>
      new URL(String(input), browserOrigin).pathname.endsWith('/system_stats'))
    expect(apiCalls.map(([input]) => new URL(String(input), browserOrigin).pathname)).toEqual(expect.arrayContaining([
      `${comfyProxyUrl(endpointBaseUrl)}system_stats`,
      `${comfyProxyUrl(otherBaseUrl)}system_stats`,
    ]))
    expect(apiCalls.every(([, init]) => !new Headers(init?.headers).has('Authorization'))).toBe(true)
    const visibleUrls = apiCalls.map(([input]) => String(input)).join('\n')
    expect(visibleUrls).not.toContain('fixture-first-endpoint-token')
    expect(visibleUrls).not.toContain('fixture-second-endpoint-password')
  })

  it('serializes different credentials for endpoint IDs that share one base URL', async () => {
    const browserOrigin = 'https://infinity.test:7930'
    const firstToken = 'fixture-shared-target-first-token'
    const secondPassword = 'fixture-shared-target-second-password'
    vi.stubGlobal('location', { origin: browserOrigin })
    vi.stubGlobal('window', { location: { origin: browserOrigin, href: `${browserOrigin}/` } })
    const authPath = comfyProxyAuthUrl(endpointBaseUrl)
    const apiPath = `${comfyProxyUrl(endpointBaseUrl)}system_stats`
    const trace: string[] = []
    const mismatchedApiSessions: string[] = []
    let activeCredential: 'first' | 'second' | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const pathname = new URL(String(input), browserOrigin).pathname
      if (pathname === authPath) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { bearerToken?: string; password?: string }
        const owner = body.bearerToken === firstToken
          ? 'first'
          : body.password === secondPassword
            ? 'second'
            : undefined
        trace.push(`auth:${owner ?? 'unknown'}`)
        await Promise.resolve()
        activeCredential = owner
        return new Response(null, { status: 204 })
      }
      if (pathname === apiPath) {
        const owner = new Headers(init?.headers).get('X-Endpoint-Fixture')
        trace.push(`api:${owner ?? 'unknown'}:${activeCredential ?? 'none'}`)
        if (owner !== activeCredential) {
          mismatchedApiSessions.push(`${owner ?? 'unknown'}:${activeCredential ?? 'none'}`)
          return new Response('wrong endpoint session', { status: 401 })
        }
        return systemStatsResponse()
      }
      throw new Error(`Unexpected request: ${pathname}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { projectStore } = await import('./projectStore')
    const firstEndpoint = {
      ...projectStore.getState().project.comfy.endpoints[0]!,
      id: 'endpoint_shared_target_first',
      baseUrl: endpointBaseUrl,
      auth: { type: 'token' as const, token: firstToken },
      customHeaders: { 'X-Endpoint-Fixture': 'first' },
    }
    const secondEndpoint = {
      ...firstEndpoint,
      id: 'endpoint_shared_target_second',
      auth: { type: 'password' as const, password: secondPassword },
      customHeaders: { 'X-Endpoint-Fixture': 'second' },
    }
    projectStore.setState((state) => ({
      project: {
        ...state.project,
        comfy: { ...state.project.comfy, endpoints: [firstEndpoint, secondEndpoint] },
      },
    }))

    await Promise.all([
      projectStore.getState().checkEndpointStatus(firstEndpoint.id),
      projectStore.getState().checkEndpointStatus(secondEndpoint.id),
    ])

    expect(mismatchedApiSessions).toEqual([])
    expect(trace.filter((entry) => entry === 'auth:first')).toHaveLength(1)
    expect(trace.filter((entry) => entry === 'auth:second')).toHaveLength(1)
    expect(projectStore.getState().project.comfy.endpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstEndpoint.id, health: expect.objectContaining({ status: 'online' }) }),
      expect.objectContaining({ id: secondEndpoint.id, health: expect.objectContaining({ status: 'online' }) }),
    ]))
    const apiCalls = fetchMock.mock.calls.filter(([input]) =>
      new URL(String(input), browserOrigin).pathname === apiPath)
    for (const [input, init] of apiCalls) {
      expect(String(input)).not.toContain(firstToken)
      expect(String(input)).not.toContain(secondPassword)
      expect(new Headers(init?.headers).has('Authorization')).toBe(false)
      expect(JSON.stringify(init)).not.toContain(firstToken)
      expect(JSON.stringify(init)).not.toContain(secondPassword)
    }
    expect(fetchMock.mock.calls.every(([input]) => !String(input).includes(firstToken) && !String(input).includes(secondPassword))).toBe(true)
  })

  it('does not let a late bootstrap from an old endpoint config replace the current session', async () => {
    const browserOrigin = 'https://infinity.test:7930'
    const newBaseUrl = 'http://127.0.0.1:8188'
    const oldToken = 'fixture-late-old-token'
    const newToken = 'fixture-current-new-token'
    vi.stubGlobal('location', { origin: browserOrigin })
    vi.stubGlobal('window', { location: { origin: browserOrigin, href: `${browserOrigin}/` } })
    const oldAuthPath = comfyProxyAuthUrl(endpointBaseUrl)
    const newAuthPath = comfyProxyAuthUrl(newBaseUrl)
    const oldApiPath = `${comfyProxyUrl(endpointBaseUrl)}system_stats`
    const newApiPath = `${comfyProxyUrl(newBaseUrl)}system_stats`
    let signalOldBootstrapStarted: () => void = () => undefined
    const oldBootstrapStarted = new Promise<void>((resolveStarted) => {
      signalOldBootstrapStarted = resolveStarted
    })
    let releaseOldBootstrap: () => void = () => undefined
    const oldBootstrapGate = new Promise<void>((resolveBootstrap) => {
      releaseOldBootstrap = resolveBootstrap
    })
    let oldSessionReady = false
    let newSessionReady = false
    const trace: string[] = []
    const mismatchedApiSessions: string[] = []
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const pathname = new URL(String(input), browserOrigin).pathname
      if (pathname === oldAuthPath || pathname === newAuthPath) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { bearerToken?: string }
        if (pathname === oldAuthPath && body.bearerToken === oldToken) {
          trace.push('auth:old:start')
          signalOldBootstrapStarted()
          return oldBootstrapGate.then(() => {
            oldSessionReady = true
            trace.push('auth:old:complete')
            return new Response(null, { status: 204 })
          })
        }
        if (pathname === newAuthPath && body.bearerToken === newToken) {
          newSessionReady = true
          trace.push('auth:new:complete')
          return Promise.resolve(new Response(null, { status: 204 }))
        }
        return Promise.resolve(new Response('unknown credentials', { status: 401 }))
      }
      if (pathname === oldApiPath) {
        trace.push(`api:old:${oldSessionReady ? 'old' : 'none'}`)
        if (!oldSessionReady) {
          mismatchedApiSessions.push('old:none')
          return Promise.resolve(new Response('stale session', { status: 401 }))
        }
        return Promise.resolve(systemStatsResponse())
      }
      if (pathname === newApiPath) {
        trace.push(`api:new:${newSessionReady ? 'new' : 'none'}`)
        if (!newSessionReady) {
          mismatchedApiSessions.push('new:none')
          return Promise.resolve(new Response('missing current session', { status: 401 }))
        }
        return Promise.resolve(systemStatsResponse())
      }
      return Promise.reject(new Error(`Unexpected request: ${pathname}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { projectStore } = await import('./projectStore')
    const endpointId = 'endpoint_config_race'
    const oldEndpoint = {
      ...projectStore.getState().project.comfy.endpoints[0]!,
      id: endpointId,
      baseUrl: endpointBaseUrl,
      auth: { type: 'token' as const, token: oldToken },
      customHeaders: { 'X-Endpoint-Version': 'old' },
    }
    projectStore.setState((state) => ({
      project: {
        ...state.project,
        comfy: { ...state.project.comfy, endpoints: [oldEndpoint] },
      },
    }))

    const oldCheck = projectStore.getState().checkEndpointStatus(endpointId)
    await oldBootstrapStarted
    const newEndpoint = {
      ...oldEndpoint,
      baseUrl: newBaseUrl,
      auth: { type: 'token' as const, token: newToken },
      customHeaders: { 'X-Endpoint-Version': 'new' },
    }
    projectStore.setState((state) => ({
      project: {
        ...state.project,
        comfy: { ...state.project.comfy, endpoints: [newEndpoint] },
      },
    }))
    const newCheck = projectStore.getState().checkEndpointStatus(endpointId)
    const newFinishedBeforeOld = await Promise.race([
      newCheck.then(() => true),
      new Promise<boolean>((resolveTimeout) => setTimeout(() => resolveTimeout(false), 50)),
    ])
    releaseOldBootstrap()
    await Promise.all([oldCheck, newCheck])
    await projectStore.getState().checkEndpointStatus(endpointId)

    expect(newFinishedBeforeOld).toBe(true)
    expect(trace.indexOf('api:new:new')).toBeLessThan(trace.indexOf('auth:old:complete'))
    expect(mismatchedApiSessions).toEqual([])
    expect(trace.some((entry) => entry.startsWith('api:old:'))).toBe(false)
    expect(trace.filter((entry) => entry === 'auth:new:complete')).toHaveLength(1)
    expect(newSessionReady).toBe(true)
    expect(projectStore.getState().project.comfy.endpoints[0]).toMatchObject({
      id: endpointId,
      baseUrl: newBaseUrl,
      auth: { type: 'token', token: newToken },
      customHeaders: { 'X-Endpoint-Version': 'new' },
      health: { status: 'online' },
    })
    expect(fetchMock.mock.calls.every(([input]) => !String(input).includes(oldToken) && !String(input).includes(newToken))).toBe(true)
  })

  it('does not let an old client recover or pollute the session after its endpoint config changes', async () => {
    const browserOrigin = 'https://infinity.test:7930'
    const oldBaseUrl = endpointBaseUrl
    const newBaseUrl = 'http://127.0.0.1:8188'
    const oldPassword = 'fixture-retired-client-password'
    const newToken = 'fixture-current-client-token'
    vi.stubGlobal('location', { origin: browserOrigin })
    vi.stubGlobal('window', { location: { origin: browserOrigin, href: `${browserOrigin}/` } })
    const oldAuthPath = comfyProxyAuthUrl(oldBaseUrl)
    const newAuthPath = comfyProxyAuthUrl(newBaseUrl)
    const oldApiPath = `${comfyProxyUrl(oldBaseUrl)}system_stats`
    const newApiPath = `${comfyProxyUrl(newBaseUrl)}system_stats`
    let signalOldApiStarted: () => void = () => undefined
    const oldApiStarted = new Promise<void>((resolveStarted) => {
      signalOldApiStarted = resolveStarted
    })
    let releaseOldApi: () => void = () => undefined
    const oldApiGate = new Promise<void>((resolveOldApi) => {
      releaseOldApi = resolveOldApi
    })
    let oldApiAttempts = 0
    let newConfigActive = false
    const forbiddenCallsAfterActivation: Array<{ body?: BodyInit | null; pathname: string }> = []
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const pathname = new URL(String(input), browserOrigin).pathname
      if (newConfigActive && pathname !== newApiPath) {
        forbiddenCallsAfterActivation.push({ body: init?.body, pathname })
      }
      if (pathname === oldAuthPath || pathname === newAuthPath) {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (pathname === oldApiPath) {
        oldApiAttempts += 1
        if (oldApiAttempts === 1) {
          signalOldApiStarted()
          return oldApiGate.then(() => new Response('expired retired session', { status: 401 }))
        }
        return Promise.resolve(new Response('retired session must stay rejected', { status: 401 }))
      }
      if (pathname === newApiPath) return Promise.resolve(systemStatsResponse())
      return Promise.reject(new Error(`Unexpected request: ${pathname}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { projectStore } = await import('./projectStore')
    const endpointId = 'endpoint_retired_client'
    const oldEndpoint = {
      ...projectStore.getState().project.comfy.endpoints[0]!,
      id: endpointId,
      baseUrl: oldBaseUrl,
      auth: { type: 'password' as const, password: oldPassword },
      customHeaders: { 'X-Endpoint-Version': 'old' },
    }
    projectStore.setState((state) => ({
      project: {
        ...state.project,
        comfy: { ...state.project.comfy, endpoints: [oldEndpoint] },
      },
    }))

    const oldCheck = projectStore.getState().checkEndpointStatus(endpointId)
    await oldApiStarted
    const newEndpoint = {
      ...oldEndpoint,
      baseUrl: newBaseUrl,
      auth: { type: 'token' as const, token: newToken },
      customHeaders: { 'X-Endpoint-Version': 'new' },
    }
    projectStore.setState((state) => ({
      project: {
        ...state.project,
        comfy: { ...state.project.comfy, endpoints: [newEndpoint] },
      },
    }))
    await projectStore.getState().checkEndpointStatus(endpointId)
    newConfigActive = true
    releaseOldApi()
    await oldCheck
    await projectStore.getState().checkEndpointStatus(endpointId)

    expect(forbiddenCallsAfterActivation).toEqual([])
    expect(oldApiAttempts).toBe(1)
    const authCalls = fetchMock.mock.calls.filter(([input]) => {
      const pathname = new URL(String(input), browserOrigin).pathname
      return pathname === oldAuthPath || pathname === newAuthPath
    })
    expect(authCalls.filter(([input]) => new URL(String(input), browserOrigin).pathname === oldAuthPath)).toHaveLength(1)
    expect(authCalls.filter(([input]) => new URL(String(input), browserOrigin).pathname === newAuthPath)).toHaveLength(1)
    expect(authCalls.find(([input]) => new URL(String(input), browserOrigin).pathname === oldAuthPath)?.[1]?.body).toBe(
      JSON.stringify({ password: oldPassword }),
    )
    expect(authCalls.find(([input]) => new URL(String(input), browserOrigin).pathname === newAuthPath)?.[1]?.body).toBe(
      JSON.stringify({ bearerToken: newToken }),
    )
    expect(projectStore.getState().project.comfy.endpoints[0]).toMatchObject({
      id: endpointId,
      baseUrl: newBaseUrl,
      auth: { type: 'token', token: newToken },
      customHeaders: { 'X-Endpoint-Version': 'new' },
      health: { status: 'online' },
    })
    const apiCalls = fetchMock.mock.calls.filter(([input]) =>
      new URL(String(input), browserOrigin).pathname.endsWith('/system_stats'))
    for (const [input, init] of apiCalls) {
      expect(String(input)).not.toContain(oldPassword)
      expect(String(input)).not.toContain(newToken)
      expect(new Headers(init?.headers).has('Authorization')).toBe(false)
      expect(JSON.stringify(init)).not.toContain(oldPassword)
      expect(JSON.stringify(init)).not.toContain(newToken)
    }
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
