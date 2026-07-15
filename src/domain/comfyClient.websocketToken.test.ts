import { describe, expect, it, vi } from 'vitest'
import { ComfyClient } from './comfyClient'

describe('ComfyClient WebSocket token routing', () => {
  it('adds only runtime parameters to the WebSocket URL when the endpoint contains UI query and hash', () => {
    const client = new ComfyClient({
      baseUrl: 'https://comfyui.example.test:8443/custom/ui/?theme=dark&token=ui-token#canvas',
      clientId: 'browser-client',
      token: 'token/with + & =',
      fetchImpl: vi.fn(),
    })

    const websocketUrl = new URL(client.createWebSocketUrl())

    expect(websocketUrl.origin).toBe('wss://comfyui.example.test:8443')
    expect(websocketUrl.pathname).toBe('/custom/ui/ws')
    expect(websocketUrl.searchParams.get('clientId')).toBe('browser-client')
    expect(websocketUrl.searchParams.getAll('token')).toEqual(['token/with + & ='])
    expect(websocketUrl.searchParams.has('theme')).toBe(false)
    expect(websocketUrl.hash).toBe('')
  })

  it('keeps the token-free WebSocket URL behavior unchanged', () => {
    const client = new ComfyClient({
      baseUrl: 'http://127.0.0.1:8188/comfy/',
      clientId: 'browser-client',
      fetchImpl: vi.fn(),
    })

    expect(client.createWebSocketUrl()).toBe('ws://127.0.0.1:8188/comfy/ws?clientId=browser-client')
  })
})
