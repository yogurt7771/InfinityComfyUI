import { describe, expect, it } from 'vitest'
import { COMFY_PROXY_TOKEN_PARAM, comfyProxyTokenFromFileContent, comfyProxyUrl } from './comfyProxy'

describe('ComfyUI proxy URLs', () => {
  it('builds a stable same-origin proxy URL from a ComfyUI base URL', () => {
    expect(comfyProxyUrl('http://127.0.0.1:27707/')).toBe('/__comfy_proxy/http%3A%2F%2F127.0.0.1%3A27707/')
  })

  it('can carry an editor bearer token for same-origin proxy requests', () => {
    const url = comfyProxyUrl('http://127.0.0.1:27707/', { bearerToken: '$2b$token/with+chars' })

    expect(url).toBe(
      `/__comfy_proxy/http%3A%2F%2F127.0.0.1%3A27707/?${COMFY_PROXY_TOKEN_PARAM}=%242b%24token%2Fwith%2Bchars`,
    )
  })

  it('reads only the first PASSWORD file line as the ComfyUI login token', () => {
    expect(comfyProxyTokenFromFileContent('hash-token\nusername\n')).toBe('hash-token')
    expect(comfyProxyTokenFromFileContent('\nusername\n')).toBeUndefined()
  })
})
