import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const workspaceRoot = resolve(__dirname, '..')
const serverPort = 28100 + Math.floor(Math.random() * 500)
const baseUrl = `http://127.0.0.1:${serverPort}`

let serverProcess: ChildProcess

beforeAll(async () => {
  serverProcess = spawn(process.execPath, [resolve(workspaceRoot, 'server/serve.mjs')], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(serverPort) },
    stdio: 'ignore',
  })
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/__infinity_health`)
      if (response.ok) return
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('server/serve.mjs did not start in time')
})

afterAll(() => {
  serverProcess.kill()
})

describe('ComfyUI proxy service worker endpoint', () => {
  it('serves the service worker script itself instead of forwarding it to ComfyUI', async () => {
    // No upstream listens on this port: a forwarded request would fail with 502.
    const target = encodeURIComponent('http://127.0.0.1:59998')
    const response = await fetch(
      `${baseUrl}/__comfy_proxy/${target}/__infinity_sw.js?__infinity_comfy_token=test-token`,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/javascript')
    const body = await response.text()
    expect(body).toContain(`/__comfy_proxy/${target}/`)
    expect(body).toContain("addEventListener('fetch'")
    expect(body).toContain('__infinity_comfy_token')
  })

  it('injects the app-ready announcement and service worker registration into proxied pages', async () => {
    const upstream: Server = createServer((_request, response) => {
      response.setHeader('content-type', 'text/html')
      response.end('<!doctype html><html><head></head><body>ComfyUI</body></html>')
    })
    await new Promise<void>((resolveListen) => upstream.listen(0, '127.0.0.1', () => resolveListen()))
    const upstreamPort = (upstream.address() as AddressInfo).port

    try {
      const target = encodeURIComponent(`http://127.0.0.1:${upstreamPort}`)
      const response = await fetch(`${baseUrl}/__comfy_proxy/${target}/`)
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain('infinity-comfy-app-ready')
      expect(html).toContain('vueAppReady')
      expect(html).toContain('serviceWorker.register')
      expect(html).toContain('__infinity_sw.js')
    } finally {
      upstream.close()
    }
  })
})
