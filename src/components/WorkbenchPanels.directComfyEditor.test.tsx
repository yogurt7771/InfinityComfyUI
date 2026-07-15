import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComfyEndpointConfig } from '../domain/types'
import { openComfyEditorInBrowser } from './WorkbenchPanels'

const directEndpoint: ComfyEndpointConfig = {
  id: 'endpoint_direct',
  name: 'Direct ComfyUI',
  baseUrl:
    'https://comfyui.example.test:8443/custom/ui/?theme=dark&token=stale-token&TOKEN=legacy-token&ToKeN=mixed-token#canvas',
  enabled: true,
  maxConcurrentJobs: 1,
  priority: 10,
  timeoutMs: 600_000,
  auth: { type: 'token', token: 'fixture-editor-token' },
  customHeaders: { 'X-Workspace': 'infinity' },
  health: { status: 'unknown' },
}

afterEach(() => {
  vi.restoreAllMocks()
  document.querySelectorAll('form').forEach((form) => form.remove())
})

describe('top-level ComfyUI editor launcher', () => {
  it('opens a non-password endpoint directly while removing every token URL parameter', () => {
    const popup = {} as WindowProxy
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(popup)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const error = openComfyEditorInBrowser(directEndpoint)

    expect(error).toBeUndefined()
    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(openSpy.mock.calls[0]?.[1]).toBe('_blank')
    const openedUrl = new URL(String(openSpy.mock.calls[0]?.[0]))
    expect(openedUrl.origin).toBe('https://comfyui.example.test:8443')
    expect(openedUrl.pathname).toBe('/custom/ui/')
    expect(openedUrl.searchParams.get('theme')).toBe('dark')
    expect([...openedUrl.searchParams.keys()].filter((key) => key.toLowerCase() === 'token')).toEqual([])
    expect(openedUrl.hash).toBe('#canvas')
    expect(openedUrl.href).not.toContain('/__comfy_proxy/')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(popup.opener).toBeNull()
  })

  it('submits only the password to the endpoint login route in the new top-level tab', () => {
    const popup = {} as WindowProxy
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(popup)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined)
    const endpoint: ComfyEndpointConfig = {
      ...directEndpoint,
      auth: {
        type: 'password',
        password: 'fixture-ui-password',
        token: 'fixture-fallback-token',
      },
    }

    const error = openComfyEditorInBrowser(endpoint)
    const submittedForm = submitSpy.mock.contexts[0] as HTMLFormElement | undefined

    expect(error).toBeUndefined()
    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(openSpy.mock.calls[0]?.[0]).toBe('')
    expect(openSpy.mock.calls[0]?.[1]).toMatch(/^infinity-comfy-/)
    expect(submittedForm?.method.toLowerCase()).toBe('post')
    expect(submittedForm?.action).toBe('https://comfyui.example.test:8443/custom/ui/login')
    expect(submittedForm?.target).toBe(openSpy.mock.calls[0]?.[1])
    const body = new FormData(submittedForm)
    expect(body.get('password')).toBe('fixture-ui-password')
    expect(body.get('token')).toBeNull()
    expect(submittedForm?.outerHTML).not.toContain('/__comfy_proxy/')
    expect(submittedForm?.isConnected).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(popup.opener).toBeNull()
  })

  it('removes the hidden password form and closes its popup when submission throws', () => {
    const close = vi.fn()
    const popup = { close } as unknown as WindowProxy
    vi.spyOn(window, 'open').mockReturnValue(popup)
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {
      throw new Error('fixture submit failure')
    })
    const endpoint: ComfyEndpointConfig = {
      ...directEndpoint,
      auth: { type: 'password', password: 'fixture-ui-password' },
    }

    const error = openComfyEditorInBrowser(endpoint)
    const submittedForm = submitSpy.mock.contexts[0] as HTMLFormElement | undefined

    expect(error).toMatch(/could not open/i)
    expect(submittedForm).toBeDefined()
    expect(submittedForm?.isConnected).toBe(false)
    expect(document.body.contains(submittedForm ?? null)).toBe(false)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('opens an endpoint with no configured authentication directly for interactive login', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as WindowProxy)
    const endpoint: ComfyEndpointConfig = {
      ...directEndpoint,
      baseUrl: 'https://comfyui.example.test:8443/',
      auth: { type: 'none' },
    }

    expect(openComfyEditorInBrowser(endpoint)).toBeUndefined()
    expect(openSpy).toHaveBeenCalledWith('https://comfyui.example.test:8443/', '_blank')
  })

  it('returns a clear user-facing error when the browser blocks the popup', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)

    expect(openComfyEditorInBrowser(directEndpoint)).toMatch(/could not open.*allow pop-ups/i)
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,fixture',
    'file:///C:/fixture/comfyui.html',
    'https://user:secret@comfyui.example.test:8443/',
  ])('rejects unsafe ComfyUI editor URL %s before opening a browser window', (baseUrl) => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as WindowProxy)

    expect(openComfyEditorInBrowser({ ...directEndpoint, baseUrl })).toMatch(/valid.*https?|https?.*URL|credentials/i)
    expect(openSpy).not.toHaveBeenCalled()
  })
})
