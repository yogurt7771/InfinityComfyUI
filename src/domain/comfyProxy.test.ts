import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  comfyProxyAuthUrl,
  comfyProxyTokenFromFileContent,
  comfyProxyUrl,
  prepareComfyProxySession,
} from './comfyProxy'

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.sessionStorage.clear()
  vi.resetModules()
})

describe('ComfyUI proxy URLs', () => {
  it('builds a stable same-origin proxy URL from a ComfyUI base URL', () => {
    expect(comfyProxyUrl('http://127.0.0.1:27707/')).toBe('/__comfy_proxy/http%3A%2F%2F127.0.0.1%3A27707/')
  })

  it('builds a credential-free same-origin session bootstrap URL', () => {
    expect(comfyProxyAuthUrl('http://127.0.0.1:27707/?secret=discarded#fragment')).toBe(
      '/__comfy_proxy/auth/http%3A%2F%2F127.0.0.1%3A27707',
    )
  })

  it('sends an editor bearer token only in the session bootstrap request body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    const token = '$2b$token/with+chars'

    await prepareComfyProxySession('http://127.0.0.1:27707/', token)

    expect(fetchMock).toHaveBeenCalledWith(
      new URL(comfyProxyAuthUrl('http://127.0.0.1:27707/'), window.location.href),
      {
        method: 'POST',
        cache: 'no-store',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bearerToken: token }),
      },
    )
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain(token)
  })

  it('sends a ComfyUI login password only in the credential bootstrap body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    const password = 'fixture-password/with + & = chars'

    const result = await prepareComfyProxySession('http://127.0.0.1:27707/', undefined, password)

    expect(fetchMock).toHaveBeenCalledWith(
      new URL(comfyProxyAuthUrl('http://127.0.0.1:27707/'), window.location.href),
      {
        method: 'POST',
        cache: 'no-store',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      },
    )
    const browserVisibleArtifacts = JSON.stringify({
      input: fetchMock.mock.calls[0]?.[0],
      localStorage: Object.fromEntries(Object.entries(window.localStorage)),
      result,
      sessionStorage: Object.fromEntries(Object.entries(window.sessionStorage)),
    })
    expect(browserVisibleArtifacts).not.toContain(password)
  })

  it('reads only the first PASSWORD file line as the ComfyUI login token', () => {
    expect(comfyProxyTokenFromFileContent('hash-token\nusername\n')).toBe('hash-token')
    expect(comfyProxyTokenFromFileContent('\nusername\n')).toBeUndefined()
  })

  it('uses all 16 bytes of cryptographic randomness for each new isolated frame label', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    const entropySpy = vi.spyOn(globalThis.crypto, 'getRandomValues')
    const isolatedModule = await import('./comfyProxy')

    const session = await isolatedModule.prepareIsolatedComfyProxySession('http://127.0.0.1:27707/')
    const entropyBuffer = entropySpy.mock.calls[0]?.[0]

    expect(new URL(session.frameOrigin).hostname.split('.')[0]).toMatch(/^frame-[0-9a-f]{32}$/)
    expect(entropySpy).toHaveBeenCalledTimes(1)
    expect(entropyBuffer).toBeInstanceOf(Uint8Array)
    expect(entropyBuffer?.byteLength).toBe(16)
  })

  it('persists one random isolated frame origin per normalized target across editor and module reloads', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    const firstModule = await import('./comfyProxy')
    const first = await firstModule.prepareIsolatedComfyProxySession('http://127.0.0.1:27707/')
    const reopened = await firstModule.prepareIsolatedComfyProxySession(
      'http://127.0.0.1:27707/?transient=discarded#fragment',
    )

    vi.resetModules()
    const reloadedModule = await import('./comfyProxy')
    const reloaded = await reloadedModule.prepareIsolatedComfyProxySession('http://127.0.0.1:27707')
    const otherTarget = await reloadedModule.prepareIsolatedComfyProxySession('http://127.0.0.1:8188/')

    expect(reopened.frameOrigin).toBe(first.frameOrigin)
    expect(reloaded.frameOrigin).toBe(first.frameOrigin)
    expect(otherTarget.frameOrigin).not.toBe(first.frameOrigin)
    expect(new URL(first.frameOrigin).hostname.split('.')[0]).toMatch(/^frame-[0-9a-f]{32}$/)
    expect(new URL(otherTarget.frameOrigin).hostname.split('.')[0]).toMatch(/^frame-[0-9a-f]{32}$/)
    expect(first.frameOrigin).not.toContain('127-0-0-1')
    expect(first.frameOrigin).not.toContain('27707')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('recovers with a fresh random frame label when the persisted target mapping is invalid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    const firstModule = await import('./comfyProxy')
    const first = await firstModule.prepareIsolatedComfyProxySession('http://127.0.0.1:27707/')
    const firstLabel = new URL(first.frameOrigin).hostname.split('.')[0]
    const mappingKeys = Object.keys(window.localStorage).filter((key) => (
      window.localStorage.getItem(key)?.includes(firstLabel)
    ))

    expect(mappingKeys.length).toBeGreaterThan(0)
    for (const key of mappingKeys) window.localStorage.setItem(key, '{invalid-frame-origin')

    vi.resetModules()
    const reloadedModule = await import('./comfyProxy')
    const recovered = await reloadedModule.prepareIsolatedComfyProxySession('http://127.0.0.1:27707/')
    const recoveredLabel = new URL(recovered.frameOrigin).hostname.split('.')[0]

    expect(recoveredLabel).toMatch(/^frame-[0-9a-f]{32}$/)
    expect(recovered.frameOrigin).not.toBe(first.frameOrigin)
  })

  it('keeps bearer and UI login secrets out of returned URLs and browser storage', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    const bearerSecret = 'fixture-bearer-secret-not-for-storage'
    const uiPasswordSecret = 'fixture-ui-password-not-for-storage'
    const isolatedModule = await import('./comfyProxy')

    const session = await isolatedModule.prepareIsolatedComfyProxySession(
      `http://127.0.0.1:27707/?password=${encodeURIComponent(uiPasswordSecret)}#discarded`,
      bearerSecret,
    )

    const persistedArtifacts = JSON.stringify({
      localStorage: Object.fromEntries(Object.entries(window.localStorage)),
      sessionStorage: Object.fromEntries(Object.entries(window.sessionStorage)),
    })
    const returnedArtifacts = JSON.stringify(session)
    const [authInput, authInit] = fetchMock.mock.calls[0] ?? []

    expect(String(authInput)).not.toContain(bearerSecret)
    expect(String(authInput)).not.toContain(uiPasswordSecret)
    expect(authInit).toEqual(expect.objectContaining({ body: JSON.stringify({ bearerToken: bearerSecret }) }))
    expect(returnedArtifacts).not.toContain(bearerSecret)
    expect(returnedArtifacts).not.toContain(uiPasswordSecret)
    expect(persistedArtifacts).not.toContain(bearerSecret)
    expect(persistedArtifacts).not.toContain(uiPasswordSecret)
  })

  it('prepares a random credential-free isolated session when browser storage is unavailable', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage is unavailable', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is unavailable', 'SecurityError')
    })
    const isolatedModule = await import('./comfyProxy')
    const bearerSecret = 'fixture-storage-fallback-bearer'

    const first = await isolatedModule.prepareIsolatedComfyProxySession('http://127.0.0.1:27707/', bearerSecret)
    const second = await isolatedModule.prepareIsolatedComfyProxySession('http://127.0.0.1:27707/', bearerSecret)

    expect(new URL(first.frameOrigin).hostname.split('.')[0]).toMatch(/^frame-[0-9a-f]{32}$/)
    expect(new URL(second.frameOrigin).hostname.split('.')[0]).toMatch(/^frame-[0-9a-f]{32}$/)
    expect(JSON.stringify([first, second])).not.toContain(bearerSecret)
    expect(fetchMock.mock.calls.every(([input]) => !String(input).includes(bearerSecret))).toBe(true)
  })
})
