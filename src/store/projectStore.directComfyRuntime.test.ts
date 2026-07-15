// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const endpointBaseUrl = 'https://comfyui.example.test:8443'

const systemStatsResponse = () =>
  new Response(JSON.stringify({ system: { comfyui_version: 'test' } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

describe('default project runtime direct ComfyUI routing', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends browser API requests directly to the configured endpoint with its credentials and headers', async () => {
    const browserOrigin = 'https://infinity.example.test:7930'
    vi.stubGlobal('location', { origin: browserOrigin })
    vi.stubGlobal('window', { location: { origin: browserOrigin, href: `${browserOrigin}/` } })
    const fetchMock = vi.fn().mockResolvedValue(systemStatsResponse())
    vi.stubGlobal('fetch', fetchMock)
    const { projectStore } = await import('./projectStore')
    const endpoint = {
      ...projectStore.getState().project.comfy.endpoints[0]!,
      baseUrl: `${endpointBaseUrl}/`,
      auth: { type: 'token' as const, token: 'endpoint-token' },
      customHeaders: {
        'X-Workspace': 'infinity',
        'X-Comfy-Route': 'browser-direct',
      },
    }
    projectStore.setState((state) => ({
      project: {
        ...state.project,
        comfy: { ...state.project.comfy, endpoints: [endpoint] },
      },
    }))

    await projectStore.getState().checkEndpointStatus(endpoint.id)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(`${endpointBaseUrl}/system_stats`, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer endpoint-token',
        'X-Workspace': 'infinity',
        'X-Comfy-Route': 'browser-direct',
      },
    })
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/__comfy_proxy/'))).toBe(false)
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/__comfy_proxy/auth/'))).toBe(false)
  })
})
