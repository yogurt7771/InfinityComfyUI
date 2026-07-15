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

describe('separate ComfyUI editor launcher', () => {
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
    expect(openedUrl.hash).toBe('')
    expect(openedUrl.href).not.toContain('/__comfy_proxy/')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(popup.opener).toBeNull()
  })

  it('never submits a stored password and leaves login to the user in the new top-level tab', () => {
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
    expect(error).toBeUndefined()
    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(openSpy.mock.calls[0]?.[1]).toBe('_blank')
    const openedUrl = new URL(String(openSpy.mock.calls[0]?.[0]))
    expect(openedUrl.origin).toBe('https://comfyui.example.test:8443')
    expect(openedUrl.pathname).toBe('/custom/ui/')
    expect(openedUrl.searchParams.get('theme')).toBe('dark')
    expect(openedUrl.searchParams.has('token')).toBe(false)
    expect(openedUrl.href).not.toContain('fixture-ui-password')
    expect(openedUrl.href).not.toContain('fixture-fallback-token')
    expect(openedUrl.href).not.toContain('/__comfy_proxy/')
    expect(submitSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(popup.opener).toBeNull()
  })

  it('does not construct a hidden password form even when form submission would throw', () => {
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

    expect(openComfyEditorInBrowser(endpoint)).toBeUndefined()
    expect(submitSpy).not.toHaveBeenCalled()
    expect(document.querySelector('form')).toBeNull()
    expect(close).not.toHaveBeenCalled()
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
