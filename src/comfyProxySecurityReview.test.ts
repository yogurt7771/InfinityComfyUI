import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request as httpRequest, type Server } from 'node:http'
import net, { type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { COMFY_PROXY_TOKEN_PARAM } from './domain/comfyProxy'

type ObservedRequest = {
  transport: 'http' | 'websocket'
  url: string
  authorization?: string
  origin?: string
  workspace?: string
}

const workspaceRoot = resolve(__dirname, '..')

const listenOnLoopback = (server: Server) =>
  new Promise<number>((resolvePort, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolvePort((server.address() as AddressInfo).port)
    })
  })

const closeServer = (server: Server) =>
  new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()))
  })

const reserveLoopbackPort = async () => {
  const reservation = createServer()
  const port = await listenOnLoopback(reservation)
  await closeServer(reservation)
  return port
}

const observedServer = () => {
  const requests: ObservedRequest[] = []
  const server = createServer((request, response) => {
    requests.push({
      transport: 'http',
      url: request.url ?? '/',
      authorization: request.headers.authorization,
      origin: request.headers.origin,
      workspace: request.headers['x-workspace'] as string | undefined,
    })
    if (request.url === '/comfy/ui') {
      response.statusCode = 200
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end('<!doctype html><html><head></head><body>Comfy UI</body></html>')
      return
    }
    if (request.url === '/comfy/redirect') {
      response.statusCode = 302
      response.setHeader('location', '/comfy/next')
      response.end('redirect')
      return
    }
    response.statusCode = 200
    response.setHeader('content-type', 'application/json')
    response.end('{"ok":true}')
  })
  server.on('upgrade', (request, socket) => {
    requests.push({
      transport: 'websocket',
      url: request.url ?? '/',
      authorization: request.headers.authorization,
      origin: request.headers.origin,
      workspace: request.headers['x-workspace'] as string | undefined,
    })
    socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
  })
  return { server, requests }
}

const waitForServer = async (url: string, child: ChildProcess) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited before becoming ready (${child.exitCode})`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch (error) {
      if (attempt === 79) throw error
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25))
  }
  throw new Error('server did not become ready')
}

const stopChild = async (child: ChildProcess) => {
  if (child.exitCode !== null) return
  child.kill()
  await Promise.race([once(child, 'exit'), new Promise((resolveWait) => setTimeout(resolveWait, 2000))])
}

const proxyPath = (targetBase: string, suffix: string) =>
  `/__comfy_proxy/${encodeURIComponent(targetBase)}/${suffix.replace(/^\/+/, '')}`

const startProxy = async (options: {
  mainTarget: string
  bearerToken: string
  additionalTargets?: string[]
  additionalTargetsValue?: string
  appOrigins?: (port: number) => string
}) => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'infinity-proxy-review-'))
  const distDir = join(tempRoot, 'dist')
  mkdirSync(distDir)
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>ready</title>', 'utf8')
  const port = await reserveLoopbackPort()
  const child = spawn(process.execPath, [join(workspaceRoot, 'server', 'serve.mjs')], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DIST_DIR: distDir,
      COMFY_PROXY_BEARER_TOKEN: options.bearerToken,
      COMFY_PROXY_TARGET_BASE: options.mainTarget,
      COMFY_PROXY_TARGET_BASES:
        options.additionalTargetsValue ?? options.additionalTargets?.join(',') ?? '',
      COMFY_PROXY_APP_ORIGINS: options.appOrigins?.(port) ?? '',
      COMFY_PROXY_TOKEN_FILE: '',
      COMFY_PROXY_LOOPBACK_HOST: '',
    },
    stdio: 'ignore',
  })
  await waitForServer(`http://127.0.0.1:${port}/`, child)
  return { child, port, tempRoot }
}

const rawWebSocketRequest = (port: number, path: string, headers: Record<string, string> = {}) =>
  new Promise<string>((resolveResponse, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    let response = ''
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      socket.destroy()
      resolveResponse(response)
    }
    socket.setTimeout(3000, () => {
      socket.destroy()
      reject(new Error(`WebSocket request timed out: ${path}`))
    })
    socket.on('error', reject)
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8')
      if (response.includes('\r\n\r\n')) finish()
    })
    socket.on('end', finish)
    socket.on('connect', () => {
      const host = headers.Host ?? `127.0.0.1:${port}`
      const extraHeaders = Object.entries(headers)
        .filter(([key]) => key.toLowerCase() !== 'host')
        .map(([key, value]) => `${key}: ${value}\r\n`)
        .join('')
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGVzdC1rZXk=\r\nSec-WebSocket-Version: 13\r\n${extraHeaders}\r\n`,
      )
    })
  })

const rawHttpRequest = (port: number, path: string, headers: Record<string, string>) =>
  new Promise<{ body: string; status: number }>((resolveResponse, reject) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        headers,
      },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          body += chunk
        })
        response.on('end', () => resolveResponse({ body, status: response.statusCode ?? 0 }))
      },
    )
    request.on('error', reject)
    request.end()
  })

describe('ComfyUI proxy security review invariants', () => {
  it('keeps the global Bearer token server-side while preserving an explicit client bridge token', async () => {
    const upstream = observedServer()
    const upstreamPort = await listenOnLoopback(upstream.server)
    const mainTarget = `http://127.0.0.1:${upstreamPort}/comfy`
    const globalToken = `global-${Date.now()}-${Math.random()}`
    const clientToken = `client-${Date.now()}-${Math.random()}`
    const proxy = await startProxy({ mainTarget, bearerToken: globalToken })
    const proxyBase = `http://127.0.0.1:${proxy.port}${proxyPath(mainTarget, '')}`

    try {
      const apiResponse = await fetch(`${proxyBase}system_stats`, { headers: { Accept: 'application/json' } })
      const htmlResponse = await fetch(`${proxyBase}ui`, { headers: { Accept: 'text/html' } })
      const redirectResponse = await fetch(`${proxyBase}redirect`, { redirect: 'manual' })
      const clientHtmlResponse = await fetch(
        `${proxyBase}ui?${COMFY_PROXY_TOKEN_PARAM}=${encodeURIComponent(clientToken)}`,
        { headers: { Accept: 'text/html' } },
      )
      const clientRedirectResponse = await fetch(
        `${proxyBase}redirect?${COMFY_PROXY_TOKEN_PARAM}=${encodeURIComponent(clientToken)}`,
        { redirect: 'manual' },
      )
      const html = await htmlResponse.text()
      const redirectLocation = redirectResponse.headers.get('location') ?? ''
      const clientHtml = await clientHtmlResponse.text()
      const clientRedirectLocation = clientRedirectResponse.headers.get('location') ?? ''

      expect(apiResponse.status).toBe(200)
      expect(upstream.requests[0]?.authorization).toBe(`Bearer ${globalToken}`)
      expect(html).not.toContain(globalToken)
      expect(redirectLocation).not.toContain(globalToken)
      expect(clientHtml).toContain(clientToken)
      expect(clientHtml).not.toContain(globalToken)
      expect(clientRedirectLocation).toContain(encodeURIComponent(clientToken))
      expect(clientRedirectLocation).not.toContain(globalToken)
    } finally {
      await stopChild(proxy.child)
      await closeServer(upstream.server)
      rmSync(proxy.tempRoot, { recursive: true, force: true })
    }
  })

  it('rejects cross-origin HTTP and WebSocket requests before contacting the upstream', async () => {
    const upstream = observedServer()
    const upstreamPort = await listenOnLoopback(upstream.server)
    const mainTarget = `http://127.0.0.1:${upstreamPort}/comfy`
    const globalToken = `global-${Date.now()}-${Math.random()}`
    const proxy = await startProxy({ mainTarget, bearerToken: globalToken })
    const proxyOrigin = `http://127.0.0.1:${proxy.port}`
    const apiUrl = `${proxyOrigin}${proxyPath(mainTarget, 'system_stats')}`
    const wsPath = proxyPath(mainTarget, 'ws')

    try {
      const rejectedHttpHeaders: Array<Record<string, string>> = [
        { Origin: 'https://evil.example' },
        { Origin: 'null' },
        { 'Sec-Fetch-Site': 'cross-site' },
      ]
      for (const headers of rejectedHttpHeaders) {
        const response = await fetch(apiUrl, { headers })
        expect.soft(response.status, JSON.stringify(headers)).toBe(403)
      }
      const rejectedWebSocketHeaders: Array<Record<string, string>> = [
        { Origin: 'https://evil.example' },
        { Origin: 'null' },
        { 'Sec-Fetch-Site': 'cross-site' },
      ]
      for (const headers of rejectedWebSocketHeaders) {
        const response = await rawWebSocketRequest(proxy.port, wsPath, headers)
        expect.soft(response, JSON.stringify(headers)).toMatch(/^HTTP\/1\.1 403/)
      }
      expect(upstream.requests).toEqual([])

      const sameOriginHttp = await fetch(apiUrl, { headers: { Origin: proxyOrigin } })
      const cliHttp = await fetch(apiUrl)
      const sameOriginWebSocket = await rawWebSocketRequest(proxy.port, wsPath, { Origin: proxyOrigin })
      const cliWebSocket = await rawWebSocketRequest(proxy.port, wsPath)

      expect(sameOriginHttp.status).toBe(200)
      expect(cliHttp.status).toBe(200)
      expect(sameOriginWebSocket).toMatch(/^HTTP\/1\.1 101/)
      expect(cliWebSocket).toMatch(/^HTTP\/1\.1 101/)
      expect(upstream.requests).toHaveLength(4)
    } finally {
      await stopChild(proxy.child)
      await closeServer(upstream.server)
      rmSync(proxy.tempRoot, { recursive: true, force: true })
    }
  })

  it('rejects DNS-rebinding HTTP and WebSocket requests while allowing an explicitly trusted app origin', async () => {
    const upstream = observedServer()
    const upstreamPort = await listenOnLoopback(upstream.server)
    const mainTarget = `http://127.0.0.1:${upstreamPort}/comfy`
    const globalToken = `global-${Date.now()}-${Math.random()}`
    const proxy = await startProxy({
      mainTarget,
      bearerToken: globalToken,
      appOrigins: (port) => `http://127.0.0.1:${port}`,
    })
    const path = proxyPath(mainTarget, 'system_stats')
    const wsPath = proxyPath(mainTarget, 'ws')
    const rebindingHeaders = {
      Host: 'evil.test:7930',
      Origin: 'http://evil.test:7930',
      'Sec-Fetch-Site': 'same-origin',
    }

    try {
      const rejectedHttp = await rawHttpRequest(proxy.port, path, rebindingHeaders)
      const rejectedWebSocket = await rawWebSocketRequest(proxy.port, wsPath, rebindingHeaders)

      expect.soft(rejectedHttp.status).toBe(403)
      expect.soft(rejectedWebSocket).toMatch(/^HTTP\/1\.1 403/)
      expect.soft(upstream.requests).toEqual([])
      expect.soft(JSON.stringify(upstream.requests)).not.toContain(globalToken)

      upstream.requests.length = 0
      const trustedOrigin = `http://127.0.0.1:${proxy.port}`
      const trustedHeaders = {
        Host: `127.0.0.1:${proxy.port}`,
        Origin: trustedOrigin,
        'Sec-Fetch-Site': 'same-origin',
      }
      const trustedHttp = await rawHttpRequest(proxy.port, path, trustedHeaders)
      const trustedWebSocket = await rawWebSocketRequest(proxy.port, wsPath, trustedHeaders)

      expect(trustedHttp.status).toBe(200)
      expect(trustedWebSocket).toMatch(/^HTTP\/1\.1 101/)
      expect(upstream.requests).toHaveLength(2)
      expect(upstream.requests.every((request) => request.authorization === `Bearer ${globalToken}`)).toBe(true)
    } finally {
      await stopChild(proxy.child)
      await closeServer(upstream.server)
      rmSync(proxy.tempRoot, { recursive: true, force: true })
    }
  })

  it('script-safely serializes an explicit client token while preserving its bridge and redirect semantics', async () => {
    const upstream = observedServer()
    const upstreamPort = await listenOnLoopback(upstream.server)
    const mainTarget = `http://127.0.0.1:${upstreamPort}/comfy`
    const globalToken = `global-${Date.now()}-${Math.random()}`
    const injectionFragment = '</script><script>globalThis.__proxyInjected=true</script><script>'
    const clientToken = `${injectionFragment}<line\u2028paragraph\u2029end`
    const proxy = await startProxy({ mainTarget, bearerToken: globalToken })
    const proxyOrigin = `http://127.0.0.1:${proxy.port}`
    const proxyBase = `${proxyOrigin}${proxyPath(mainTarget, '')}`
    const tokenQuery = `${COMFY_PROXY_TOKEN_PARAM}=${encodeURIComponent(clientToken)}`

    try {
      const htmlResponse = await fetch(`${proxyBase}ui?${tokenQuery}`, {
        headers: { Accept: 'text/html' },
      })
      const redirectResponse = await fetch(`${proxyBase}redirect?${tokenQuery}`, { redirect: 'manual' })
      const html = await htmlResponse.text()
      const redirectLocation = redirectResponse.headers.get('location') ?? ''
      const serializedToken = html.match(/const proxyBearerToken = ("(?:\\.|[^"\\])*");/)?.[1] ?? ''

      expect(htmlResponse.status).toBe(200)
      expect(html).not.toContain(injectionFragment)
      expect(serializedToken).not.toBe('')
      expect(serializedToken).not.toContain('<')
      expect(serializedToken).toContain('\\u2028')
      expect(serializedToken).toContain('\\u2029')
      expect(runInNewContext(serializedToken)).toBe(clientToken)
      expect(html).not.toContain(globalToken)

      expect(redirectResponse.status).toBe(302)
      expect(redirectLocation).not.toBe('')
      expect(redirectLocation).not.toContain(injectionFragment)
      expect(new URL(redirectLocation, proxyOrigin).searchParams.get(COMFY_PROXY_TOKEN_PARAM)).toBe(clientToken)
      expect(redirectLocation).not.toContain(globalToken)
    } finally {
      await stopChild(proxy.child)
      await closeServer(upstream.server)
      rmSync(proxy.tempRoot, { recursive: true, force: true })
    }
  })

  it('allows explicitly listed additional targets without attaching the main target global token', async () => {
    const main = observedServer()
    const additional = observedServer()
    const mainPort = await listenOnLoopback(main.server)
    const additionalPort = await listenOnLoopback(additional.server)
    const mainTarget = `http://127.0.0.1:${mainPort}/comfy`
    const additionalTarget = `http://127.0.0.1:${additionalPort}/comfy`
    const globalToken = `global-${Date.now()}-${Math.random()}`
    const clientToken = `client-${Date.now()}-${Math.random()}`
    const proxy = await startProxy({ mainTarget, bearerToken: globalToken, additionalTargets: [additionalTarget] })
    const proxyOrigin = `http://127.0.0.1:${proxy.port}`

    try {
      const mainResponse = await fetch(`${proxyOrigin}${proxyPath(mainTarget, 'system_stats')}`)
      const anonymousAdditionalResponse = await fetch(
        `${proxyOrigin}${proxyPath(additionalTarget, 'system_stats')}`,
        { headers: { 'X-Workspace': 'anonymous' } },
      )
      const clientAdditionalResponse = await fetch(
        `${proxyOrigin}${proxyPath(additionalTarget, 'object_info')}`,
        {
          headers: {
            Authorization: `Bearer ${clientToken}`,
            'X-Workspace': 'infinity',
          },
        },
      )
      const clientAdditionalWebSocket = await rawWebSocketRequest(
        proxy.port,
        proxyPath(additionalTarget, 'ws'),
        {
          Authorization: `Bearer ${clientToken}`,
          'X-Workspace': 'infinity-ws',
        },
      )

      expect(mainResponse.status).toBe(200)
      expect(anonymousAdditionalResponse.status).toBe(200)
      expect(clientAdditionalResponse.status).toBe(200)
      expect(clientAdditionalWebSocket).toMatch(/^HTTP\/1\.1 101/)
      expect(main.requests[0]?.authorization).toBe(`Bearer ${globalToken}`)
      expect(additional.requests).toEqual([
        expect.objectContaining({
          transport: 'http',
          url: '/comfy/system_stats',
          authorization: undefined,
          workspace: 'anonymous',
        }),
        expect.objectContaining({
          transport: 'http',
          url: '/comfy/object_info',
          authorization: `Bearer ${clientToken}`,
          workspace: 'infinity',
        }),
        expect.objectContaining({
          transport: 'websocket',
          url: '/comfy/ws',
          authorization: `Bearer ${clientToken}`,
          workspace: 'infinity-ws',
        }),
      ])
      expect(JSON.stringify(additional.requests)).not.toContain(globalToken)
    } finally {
      await stopChild(proxy.child)
      await closeServer(main.server)
      await closeServer(additional.server)
      rmSync(proxy.tempRoot, { recursive: true, force: true })
    }
  })

  it('accepts a JSON additional-target allowlist without splitting a valid comma-containing URL', async () => {
    const main = observedServer()
    const additional = observedServer()
    const mainPort = await listenOnLoopback(main.server)
    const additionalPort = await listenOnLoopback(additional.server)
    const mainTarget = `http://127.0.0.1:${mainPort}/comfy`
    const additionalTarget = `http://127.0.0.1:${additionalPort}/comfy,tenant`
    const globalToken = `global-${Date.now()}-${Math.random()}`
    const proxy = await startProxy({
      mainTarget,
      bearerToken: globalToken,
      additionalTargetsValue: JSON.stringify([additionalTarget]),
    })
    const proxyOrigin = `http://127.0.0.1:${proxy.port}`

    try {
      const response = await fetch(`${proxyOrigin}${proxyPath(additionalTarget, 'system_stats')}`, {
        headers: { 'X-Workspace': 'json-allowlist' },
      })

      expect(response.status).toBe(200)
      expect(additional.requests).toEqual([
        expect.objectContaining({
          transport: 'http',
          url: '/comfy,tenant/system_stats',
          authorization: undefined,
          workspace: 'json-allowlist',
        }),
      ])
      expect(JSON.stringify(additional.requests)).not.toContain(globalToken)
    } finally {
      await stopChild(proxy.child)
      await closeServer(main.server)
      await closeServer(additional.server)
      rmSync(proxy.tempRoot, { recursive: true, force: true })
    }
  })

  it('passes the explicit additional ComfyUI target allowlist through Docker Compose', () => {
    const compose = readFileSync(join(workspaceRoot, 'docker-compose.yml'), 'utf8')

    expect(compose).toMatch(
      /^\s+COMFY_PROXY_TARGET_BASES:\s*["']?\$\{COMFY_PROXY_TARGET_BASES:-\}["']?\s*$/m,
    )
    expect(compose).toMatch(
      /^\s+COMFY_PROXY_APP_ORIGINS:\s*["']?\$\{COMFY_PROXY_APP_ORIGINS:-http:\/\/127\.0\.0\.1:7930\}["']?\s*$/m,
    )
  })
})
