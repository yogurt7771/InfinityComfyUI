import { describe, expect, it } from 'vitest'
import { comfyProxyUrl } from './comfyProxy'

describe('ComfyUI proxy URLs', () => {
  it('builds a stable same-origin proxy URL from a ComfyUI base URL', () => {
    expect(comfyProxyUrl('http://127.0.0.1:27707/')).toBe('/__comfy_proxy/http%3A%2F%2F127.0.0.1%3A27707/')
  })
})
