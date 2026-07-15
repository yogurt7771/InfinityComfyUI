import { describe, expect, it, vi } from 'vitest'
import { ComfyClient } from './comfyClient'

describe('ComfyClient', () => {
  it('binds the default browser fetch before issuing requests', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(function (this: typeof globalThis) {
      expect(this).toBe(globalThis)
      return Promise.resolve(
        new Response(JSON.stringify({ system: { comfyui_version: 'test' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }) as typeof fetch

    try {
      const client = new ComfyClient({
        baseUrl: 'http://127.0.0.1:8188/',
        clientId: 'client-1',
      })

      await expect(client.testConnection()).resolves.toEqual({ system: { comfyui_version: 'test' } })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('queues prompts with a stable client id and optional bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ prompt_id: 'abc', number: 1 }),
    })
    const client = new ComfyClient({
      baseUrl: 'http://127.0.0.1:8188/',
      clientId: 'client-1',
      token: 'demo',
      fetchImpl: fetchMock,
    })

    const result = await client.queuePrompt({ '3': { inputs: { seed: 1 } } })

    expect(result).toEqual({ prompt_id: 'abc', number: 1 })
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8188/prompt', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer demo',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: { '3': { inputs: { seed: 1 } } }, client_id: 'client-1' }),
    })
  })

  it('sends custom headers with ComfyUI requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ system: { comfyui_version: 'test' } }),
    })
    const client = new ComfyClient({
      baseUrl: 'http://127.0.0.1:8188/',
      clientId: 'client-1',
      headers: {
        'X-Workspace': 'infinity',
        '': 'ignored',
      },
      fetchImpl: fetchMock,
    })

    await client.testConnection()

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8188/system_stats', {
      method: 'GET',
      headers: { 'X-Workspace': 'infinity' },
    })
  })

  it('keeps exactly one token Authorization header regardless of custom-header casing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ system: { comfyui_version: 'test' } }),
    })
    const client = new ComfyClient({
      baseUrl: 'http://127.0.0.1:8188/',
      clientId: 'client-1',
      token: 'endpoint-token',
      headers: {
        Authorization: 'Bearer custom-standard',
        authorization: 'Bearer custom-lowercase',
        AUTHORIZATION: 'Bearer custom-uppercase',
        'X-Workspace': 'infinity',
      },
      fetchImpl: fetchMock,
    })

    await client.testConnection()

    const sentHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(Object.entries(sentHeaders).filter(([name]) => name.toLowerCase() === 'authorization')).toEqual([
      ['Authorization', 'Bearer endpoint-token'],
    ])
    expect(sentHeaders['X-Workspace']).toBe('infinity')
  })

  it('sends ComfyUI interrupt requests with auth and custom headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    })
    const client = new ComfyClient({
      baseUrl: 'http://localhost:8188/',
      clientId: 'client-1',
      token: 'demo',
      headers: { 'X-Workspace': 'infinity' },
      fetchImpl: fetchMock,
    })

    await client.interrupt()

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8188/interrupt', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer demo',
        'X-Workspace': 'infinity',
      },
    })
  })

  it('builds ComfyUI history and view requests like the Python reference client with custom headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ prompt: { outputs: {} } }),
      blob: async () => new Blob(['x'], { type: 'image/png' }),
    })
    const client = new ComfyClient({
      baseUrl: 'http://localhost:8188',
      clientId: 'client-1',
      headers: { 'X-Workspace': 'infinity' },
      fetchImpl: fetchMock,
    })

    await client.getHistory('prompt-1')
    await client.viewFile({ filename: 'out 1.png', subfolder: 'renders', type: 'output' })

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://localhost:8188/history/prompt-1', {
      headers: { 'X-Workspace': 'infinity' },
      method: 'GET',
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8188/view?filename=out+1.png&subfolder=renders&type=output',
      {
        headers: { 'X-Workspace': 'infinity' },
        method: 'GET',
      },
    )
  })

  it('uploads image files for LoadImage workflow inputs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'reference.png', subfolder: 'infinity-comfyui', type: 'input' }),
    })
    const client = new ComfyClient({
      baseUrl: 'http://localhost:8188',
      clientId: 'client-1',
      token: 'demo',
      fetchImpl: fetchMock,
    })

    const result = await client.uploadImage(
      new File([new Blob(['image-bytes'], { type: 'image/png' })], 'reference.png', { type: 'image/png' }),
      { subfolder: 'infinity-comfyui', overwrite: true },
    )

    expect(result).toEqual({ name: 'reference.png', subfolder: 'infinity-comfyui', type: 'input' })
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8188/upload/image', {
      method: 'POST',
      headers: { Authorization: 'Bearer demo' },
      body: expect.any(FormData),
    })
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData
    expect(body.get('subfolder')).toBe('infinity-comfyui')
    expect(body.get('overwrite')).toBe('true')
    expect(body.get('image')).toBeInstanceOf(File)
  })

  it.each(['http', 'https'])('keeps endpoint UI query and hash out of %s API, media, and upload URLs', async (protocol) => {
    const origin = `${protocol}://comfyui.example.test:8443`
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        system: { comfyui_version: 'test' },
        prompt_id: 'prompt-1',
        number: 1,
        name: 'reference.png',
        subfolder: 'infinity-comfyui',
        type: 'input',
      }),
      blob: async () => new Blob(['image-bytes'], { type: 'image/png' }),
    })
    const client = new ComfyClient({
      baseUrl: `${origin}/custom/ui/?theme=dark&token=ui-token#canvas`,
      clientId: 'client-1',
      token: 'api-token',
      fetchImpl: fetchMock,
    })

    await client.testConnection()
    await client.queuePrompt({ '3': { inputs: { seed: 1 } } })
    await client.interrupt()
    await client.getHistory('prompt-1')
    await client.viewFile({ filename: 'out 1.png', subfolder: 'renders', type: 'output' })
    await client.uploadImage(new File(['image-bytes'], 'reference.png', { type: 'image/png' }), {
      subfolder: 'infinity-comfyui',
      overwrite: true,
    })

    const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input)))
    expect(urls.map((url) => url.pathname)).toEqual([
      '/custom/ui/system_stats',
      '/custom/ui/prompt',
      '/custom/ui/interrupt',
      '/custom/ui/history/prompt-1',
      '/custom/ui/view',
      '/custom/ui/upload/image',
    ])
    expect(urls.every((url) => url.origin === origin)).toBe(true)
    expect(urls.every((url) => url.hash === '')).toBe(true)
    expect(urls.slice(0, 4).every((url) => url.search === '')).toBe(true)
    expect(urls[4]?.searchParams.get('filename')).toBe('out 1.png')
    expect(urls[4]?.searchParams.get('subfolder')).toBe('renders')
    expect(urls[4]?.searchParams.get('type')).toBe('output')
    expect(urls[5]?.search).toBe('')
    expect(urls.every((url) => !url.searchParams.has('theme'))).toBe(true)
    expect(urls.every((url) => !url.searchParams.has('token'))).toBe(true)
  })
})
