import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request as httpRequest, type Server } from 'node:http'
import net, { type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { comfyProxyAuthUrl } from './domain/comfyProxy'

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
      response.setHeader('location', '/comfy/redirected')
      response.end('redirect')
      return
    }
    if (request.url === '/comfy/escape-redirect') {
      response.statusCode = 302
      response.setHeader('location', '/outside')
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

const cookieUpstream = (cookieValue: string) => {
  const requests: Array<{ cookie?: string; transport: 'http' | 'websocket'; url: string }> = []
  const server = createServer((request, response) => {
    requests.push({ cookie: request.headers.cookie, transport: 'http', url: request.url ?? '/' })
    if (request.url === '/comfy/set-cookie') {
      response.setHeader('set-cookie', `comfy_sid=${cookieValue}; Path=/; HttpOnly; SameSite=Lax`)
    }
    response.setHeader('content-type', 'application/json')
    response.end('{"ok":true}')
  })
  server.on('upgrade', (request, socket) => {
    requests.push({ cookie: request.headers.cookie, transport: 'websocket', url: request.url ?? '/' })
    socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
  })
  return { requests, server }
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

const prepareProxySession = async (proxyOrigin: string, targetBase: string, bearerToken?: string, requestCookie?: string) => {
  const authUrl = `${proxyOrigin}${comfyProxyAuthUrl(targetBase)}`
  const response = await fetch(authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(requestCookie ? { Cookie: requestCookie } : {}) },
    body: JSON.stringify(bearerToken ? { bearerToken } : {}),
  })
  const cookie = (response.headers.get('set-cookie') ?? '').split(';', 1)[0] ?? ''
  return { authUrl, cookie, response }
}

const startProxy = async (options: {
  mainTarget: string
  bearerToken: string
  additionalTargets?: string[]
  additionalTargetsValue?: string
  appOrigins?: (port: number) => string
  extraEnv?: NodeJS.ProcessEnv
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
      ...options.extraEnv,
    },
    stdio: 'ignore',
  })
  await waitForServer(`http://127.0.0.1:${port}/`, child)
  return { child, port, tempRoot }
}

const startViteProxy = async (mainTarget: string, bearerToken: string) => {
  const port = await reserveLoopbackPort()
  const child = spawn(
    process.execPath,
    [join(workspaceRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        COMFY_PROXY_BEARER_TOKEN: bearerToken,
        COMFY_PROXY_TARGET_BASE: mainTarget,
        COMFY_PROXY_TARGET_BASES: '',
        COMFY_PROXY_TOKEN_FILE: '',
      },
      stdio: 'ignore',
    },
  )
  await waitForServer(`http://127.0.0.1:${port}/`, child)
  return { child, port }
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

const oversizedStreamingAuthRequest = (port: number, path: string) =>
  new Promise<string>((resolveResponse) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    let response = ''
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      socket.destroy()
      resolveResponse(response)
    }
    const timeout = setTimeout(finish, 1200)
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8')
      if (response.includes('\r\n\r\n')) {
        clearTimeout(timeout)
        finish()
      }
    })
    socket.on('error', finish)
    socket.on('connect', () => {
      const chunk = 'x'.repeat(17 * 1024)
      socket.write(
        `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n${chunk.length.toString(16)}\r\n${chunk}\r\n`,
      )
    })
  })

describe('ComfyUI proxy security review invariants', () => {
  it('keeps global and endpoint Bearer tokens out of URLs while authenticating their proxy requests', async () => {
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
      const session = await prepareProxySession(`http://127.0.0.1:${proxy.port}`, mainTarget, clientToken)
      const sessionHeaders = { Cookie: session.cookie }
      const clientApiResponse = await fetch(`${proxyBase}system_stats`, {
        headers: { ...sessionHeaders, Accept: 'application/json' },
      })
      const clientHtmlResponse = await fetch(`${proxyBase}ui`, {
        headers: { ...sessionHeaders, Accept: 'text/html' },
      })
      const clientRedirectResponse = await fetch(`${proxyBase}redirect`, {
        headers: sessionHeaders,
        redirect: 'manual',
      })
      const html = await htmlResponse.text()
      const redirectLocation = redirectResponse.headers.get('location') ?? ''
      const clientHtml = await clientHtmlResponse.text()
      const clientRedirectLocation = clientRedirectResponse.headers.get('location') ?? ''

      expect(apiResponse.status).toBe(200)
      expect(upstream.requests[0]?.authorization).toBe(`Bearer ${globalToken}`)
      expect(session.response.status).toBe(204)
      expect(session.authUrl).not.toContain(clientToken)
      expect(session.cookie).not.toContain(clientToken)
      expect(clientApiResponse.status).toBe(200)
      expect(upstream.requests.findLast((request) => request.url === '/comfy/system_stats')?.authorization).toBe(
        `Bearer ${clientToken}`,
      )
      expect(html).not.toContain(globalToken)
      expect(redirectLocation).not.toContain(globalToken)
      expect(clientHtml).not.toContain(clientToken)
      expect(clientHtml).not.toContain(globalToken)
      expect(clientRedirectLocation).not.toContain(clientToken)
      expect(clientRedirectLocation).not.toContain(globalToken)
    } finally {
      await stopChild(proxy.child)
      await closeServer(upstream.server)
      rmSync(proxy.tempRoot, { recursive: true, force: true })
    }
  })

  it('binds the Vite global token to its explicit primary target and rejects cross-site HTTP and WebSocket proxying', async () => {
    const main = observedServer()
    const attacker = observedServer()
    const mainPort = await listenOnLoopback(main.server)
    const attackerPort = await listenOnLoopback(attacker.server)
    const mainTarget = `http://127.0.0.1:${mainPort}`
    const attackerTarget = `http://127.0.0.1:${attackerPort}`
    const globalToken = `fixture-vite-primary-token-${Date.now()}`
    const vite = await startViteProxy(mainTarget, globalToken)
    const proxyOrigin = `http://127.0.0.1:${vite.port}`

    try {
      const mainResponse = await fetch(`${proxyOrigin}${proxyPath(mainTarget, 'system_stats')}`, {
        headers: { Origin: proxyOrigin },
      })
      const arbitraryResponse = await fetch(`${proxyOrigin}${proxyPath(attackerTarget, 'system_stats')}`, {
        headers: { Origin: proxyOrigin },
      })
      const crossSiteResponse = await fetch(`${proxyOrigin}${proxyPath(attackerTarget, 'cross-site')}`, {
        headers: { Origin: 'https://untrusted.invalid' },
      })
      const mainWebSocketResponse = await rawWebSocketRequest(vite.port, proxyPath(mainTarget, 'ws'), {
        Origin: proxyOrigin,
      })
      const crossSiteWebSocketResponse = await rawWebSocketRequest(vite.port, proxyPath(attackerTarget, 'ws'), {
        Origin: 'https://untrusted.invalid',
      })

      expect.soft(mainResponse.status).toBe(200)
      expect.soft(main.requests.find((request) => request.url === '/system_stats')?.authorization).toBe(
        `Bearer ${globalToken}`,
      )
      expect.soft([200, 403]).toContain(arbitraryResponse.status)
      expect.soft(attacker.requests.find((request) => request.url === '/system_stats')?.authorization).toBeUndefined()
      expect.soft(crossSiteResponse.status).toBe(403)
      expect.soft(attacker.requests.some((request) => request.url === '/cross-site')).toBe(false)
      expect.soft(mainWebSocketResponse).toContain('101 Switching Protocols')
      expect.soft(main.requests.find((request) => request.url === '/ws')?.authorization).toBe(`Bearer ${globalToken}`)
      expect.soft(crossSiteWebSocketResponse).not.toContain('101 Switching Protocols')
      expect.soft(attacker.requests.some((request) => request.url === '/ws')).toBe(false)
    } finally {
      await stopChild(vite.child)
      await closeServer(main.server)
      await closeServer(attacker.server)
    }
  })

  it('rejects Vite DNS-rebinding HTTP and WebSocket requests without exposing the primary target token', async () => {
    const main = observedServer()
    const mainPort = await listenOnLoopback(main.server)
    const mainTarget = `http://127.0.0.1:${mainPort}`
    const globalToken = `fixture-vite-rebinding-token-${Date.now()}`
    const vite = await startViteProxy(mainTarget, globalToken)
    const proxyPathname = proxyPath(mainTarget, 'system_stats')
    const websocketPathname = proxyPath(mainTarget, 'ws')
    const trustedOrigin = `http://127.0.0.1:${vite.port}`
    const trustedHeaders = {
      Host: `127.0.0.1:${vite.port}`,
      Origin: trustedOrigin,
      'Sec-Fetch-Site': 'same-origin',
    }

    try {
      const trustedHttp = await rawHttpRequest(vite.port, proxyPathname, trustedHeaders)
      const trustedWebSocket = await rawWebSocketRequest(vite.port, websocketPathname, trustedHeaders)

      expect(trustedHttp.status).toBe(200)
      expect(trustedWebSocket).toMatch(/^HTTP\/1\.1 101/)
      expect(main.requests).toHaveLength(2)
      expect(main.requests.every((request) => request.authorization === `Bearer ${globalToken}`)).toBe(true)

      main.requests.length = 0
      const rebindingHeaders = {
        Host: `evil.test:${vite.port}`,
        Origin: `http://evil.test:${vite.port}`,
        'Sec-Fetch-Site': 'same-origin',
      }
      const rejectedHttp = await rawHttpRequest(vite.port, proxyPathname, rebindingHeaders)
      const rejectedWebSocket = await rawWebSocketRequest(vite.port, websocketPathname, rebindingHeaders)

      expect.soft(rejectedHttp.status).toBe(403)
      expect.soft(rejectedWebSocket).not.toMatch(/^HTTP\/1\.1 101/)
      expect.soft(main.requests).toEqual([])
      expect.soft(JSON.stringify(main.requests)).not.toContain(globalToken)
    } finally {
      await stopChild(vite.child)
      await closeServer(main.server)
    }
  })

  it('revokes older target sessions on rotation and clear while bounding retained sessions', async () => {
    const upstream = observedServer()
    const upstreamPort = await listenOnLoopback(upstream.server)
    const mainTarget = `http://127.0.0.1:${upstreamPort}/comfy`
    const proxy = await startProxy({ mainTarget, bearerToken: '' })
    const proxyOrigin = `http://127.0.0.1:${proxy.port}`
    const apiUrl = `${proxyOrigin}${proxyPath(mainTarget, 'system_stats')}`

    try {
      const first = await prepareProxySession(proxyOrigin, mainTarget, 'fixture-session-token-a')
      const rotated = await prepareProxySession(proxyOrigin, mainTarget, 'fixture-session-token-b', first.cookie)
      upstream.requests.length = 0
      await fetch(apiUrl, { headers: { Cookie: first.cookie } })
      await fetch(apiUrl, { headers: { Cookie: rotated.cookie } })
      expect.soft(upstream.requests[0]?.authorization).toBeUndefined()
      expect.soft(upstream.requests[1]?.authorization).toBe('Bearer fixture-session-token-b')

      const toClear = await prepareProxySession(proxyOrigin, mainTarget, 'fixture-session-token-clear')
      const cleared = await prepareProxySession(proxyOrigin, mainTarget, undefined, toClear.cookie)
      expect.soft(cleared.response.status).toBe(204)
      upstream.requests.length = 0
      await fetch(apiUrl, { headers: { Cookie: toClear.cookie } })
      expect.soft(upstream.requests[0]?.authorization).toBeUndefined()

      const oldest = await prepareProxySession(proxyOrigin, mainTarget, 'fixture-session-token-oldest')
      for (let index = 0; index < 260; index += 1) {
        const session = await prepareProxySession(proxyOrigin, mainTarget, `fixture-capacity-token-${index}`)
        expect.soft(session.response.status).toBe(204)
      }
      upstream.requests.length = 0
      await fetch(apiUrl, { headers: { Cookie: oldest.cookie } })
      expect.soft(upstream.requests[0]?.authorization).toBeUndefined()
    } finally {
      await stopChild(proxy.child)
      await closeServer(upstream.server)
      rmSync(proxy.tempRoot, { recursive: true, force: true })
    }
  })

  it('isolates upstream cookies by target and strips every Infinity application cookie from HTTP and WebSocket requests', async () => {
    const upstreamA = cookieUpstream('alpha')
    const upstreamB = cookieUpstream('beta')
    const portA = await listenOnLoopback(upstreamA.server)
    const portB = await listenOnLoopback(upstreamB.server)
    const targetA = `http://127.0.0.1:${portA}/comfy`
    const targetB = `http://127.0.0.1:${portB}/comfy`
    const proxy = await startProxy({ mainTarget: targetA, bearerToken: '', additionalTargets: [targetB] })
    const origin = `http://127.0.0.1:${proxy.port}`

    try {
      const sessionA = await prepareProxySession(origin, targetA)
      const sessionB = await prepareProxySession(origin, targetB)
      const setA = await fetch(`${origin}${proxyPath(targetA, 'set-cookie')}`, {
        headers: { Cookie: sessionA.cookie },
      })
      const setB = await fetch(`${origin}${proxyPath(targetB, 'set-cookie')}`, {
        headers: { Cookie: sessionB.cookie },
      })
      const cookieA = (setA.headers.get('set-cookie') ?? '').split(';', 1)[0] ?? ''
      const cookieB = (setB.headers.get('set-cookie') ?? '').split(';', 1)[0] ?? ''
      const cookieNameA = cookieA.split('=', 1)[0]
      const cookieNameB = cookieB.split('=', 1)[0]
      const forgedBrowserCookies = [
        cookieA,
        cookieB,
        'infinity_project=fixture-app-project-cookie',
        'theme=fixture-app-theme-cookie',
      ].join('; ')
      const browserCookies = [sessionA.cookie, sessionB.cookie, forgedBrowserCookies].join('; ')

      upstreamA.requests.length = 0
      upstreamB.requests.length = 0
      const forgedHttp = await fetch(`${origin}${proxyPath(targetA, 'forged-cookie')}`, {
        headers: { Cookie: forgedBrowserCookies },
      })
      const forgedWebSocket = await rawWebSocketRequest(proxy.port, proxyPath(targetA, 'forged-ws'), {
        Cookie: forgedBrowserCookies,
      })

      expect.soft(forgedHttp.status).toBe(200)
      expect.soft(forgedWebSocket).toMatch(/^HTTP\/1\.1 101/)
      expect.soft(upstreamA.requests).toEqual([
        expect.objectContaining({ transport: 'http', url: '/comfy/forged-cookie', cookie: undefined }),
        expect.objectContaining({ transport: 'websocket', url: '/comfy/forged-ws', cookie: undefined }),
      ])

      upstreamA.requests.length = 0
      upstreamB.requests.length = 0
      await fetch(`${origin}${proxyPath(targetA, 'system_stats')}`, { headers: { Cookie: browserCookies } })
      await fetch(`${origin}${proxyPath(targetB, 'system_stats')}`, { headers: { Cookie: browserCookies } })
      const websocketA = await rawWebSocketRequest(proxy.port, proxyPath(targetA, 'ws'), { Cookie: browserCookies })

      expect.soft(cookieNameA).not.toBe('comfy_sid')
      expect.soft(cookieNameB).not.toBe('comfy_sid')
      expect.soft(cookieNameA).not.toBe(cookieNameB)
      expect.soft(upstreamA.requests.find((entry) => entry.transport === 'http')?.cookie).toBe('comfy_sid=alpha')
      expect.soft(upstreamB.requests.find((entry) => entry.transport === 'http')?.cookie).toBe('comfy_sid=beta')
      expect.soft(upstreamA.requests.find((entry) => entry.transport === 'websocket')?.cookie).toBe('comfy_sid=alpha')
      expect.soft(websocketA).toMatch(/^HTTP\/1\.1 101/)
      expect.soft(JSON.stringify([...upstreamA.requests, ...upstreamB.requests])).not.toContain('infinity_project')
      expect.soft(JSON.stringify([...upstreamA.requests, ...upstreamB.requests])).not.toContain('fixture-app-theme-cookie')
    } finally {
      await stopChild(proxy.child)
      await closeServer(upstreamA.server)
      await closeServer(upstreamB.server)
      rmSync(proxy.tempRoot, { recursive: true, force: true })
    }
  })

  it('stops accepting an expired proxy session token', async () => {
    const upstream = observedServer()
    const upstreamPort = await listenOnLoopback(upstream.server)
    const mainTarget = `http://127.0.0.1:${upstreamPort}/comfy`
    const clockRoot = mkdtempSync(join(tmpdir(), 'infinity-proxy-clock-'))
    const clockFile = join(clockRoot, 'now.txt')
    const initialNow = 1_000_000
    writeFileSync(clockFile, String(initialNow), 'utf8')
    const proxy = await startProxy({
      mainTarget,
      bearerToken: '',
      extraEnv: {
        NODE_OPTIONS: `--require=${join(workspaceRoot, 'tests', 'fixtures', 'fake-now.cjs')}`,
        INFINITY_TEST_CLOCK_FILE: clockFile,
      },
    })
    const proxyOrigin = `http://127.0.0.1:${proxy.port}`
    const apiUrl = `${proxyOrigin}${proxyPath(mainTarget, 'system_stats')}`

    try {
      const session = await prepareProxySession(proxyOrigin, mainTarget, 'fixture-expiring-session-token')
      writeFileSync(clockFile, String(initialNow + 9 * 60 * 60 * 1000), 'utf8')
      upstream.requests.length = 0
      await fetch(apiUrl, { headers: { Cookie: session.cookie } })
      expect(upstream.requests[0]?.authorization).toBeUndefined()
    } finally {
      await stopChild(proxy.child)
      await closeServer(upstream.server)
      rmSync(proxy.tempRoot, { recursive: true, force: true })
      rmSync(clockRoot, { recursive: true, force: true })
    }
  })

  it('rejects an oversized streamed auth body before the client finishes uploading it', async () => {
    const upstream = observedServer()
    const upstreamPort = await listenOnLoopback(upstream.server)
    const mainTarget = `http://127.0.0.1:${upstreamPort}/comfy`
    const proxy = await startProxy({ mainTarget, bearerToken: '' })

    try {
      const response = await oversizedStreamingAuthRequest(
        proxy.port,
        comfyProxyAuthUrl(mainTarget),
      )
      expect(response).toContain('413')
      expect(upstream.requests).toEqual([])
    } finally {
      await stopChild(proxy.child)
      await closeServer(upstream.server)
      rmSync(proxy.tempRoot, { recursive: true, force: true })
    }
  })

  it('rewrites in-base redirects exactly once and does not proxy same-origin redirects outside the configured base', async () => {
    const upstream = observedServer()
    const upstreamPort = await listenOnLoopback(upstream.server)
    const mainTarget = `http://127.0.0.1:${upstreamPort}/comfy`
    const proxy = await startProxy({ mainTarget, bearerToken: '' })
    const proxyOrigin = `http://127.0.0.1:${proxy.port}`
    const proxyBase = `${proxyOrigin}${proxyPath(mainTarget, '')}`

    try {
      upstream.requests.length = 0
      const followed = await fetch(`${proxyBase}redirect`)
      expect.soft(followed.status).toBe(200)
      expect.soft(upstream.requests.map((request) => request.url)).toEqual(['/comfy/redirect', '/comfy/redirected'])

      const escaped = await fetch(`${proxyBase}escape-redirect`, { redirect: 'manual' })
      const escapedLocation = escaped.headers.get('location') ?? ''
      expect.soft([302, 403]).toContain(escaped.status)
      expect.soft(escapedLocation.startsWith(proxyBase)).toBe(false)
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

  it('rejects no-Origin navigation from an untrusted Host while allowing the configured production Host', async () => {
    const upstream = observedServer()
    const upstreamPort = await listenOnLoopback(upstream.server)
    const mainTarget = `http://127.0.0.1:${upstreamPort}/comfy`
    const globalToken = `fixture-no-origin-host-token-${Date.now()}`
    const proxy = await startProxy({
      mainTarget,
      bearerToken: globalToken,
      appOrigins: (port) => `http://127.0.0.1:${port}`,
    })
    const path = proxyPath(mainTarget, 'ui')
    const navigationHeaders = {
      Accept: 'text/html',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
    }

    try {
      const untrusted = await rawHttpRequest(proxy.port, path, {
        ...navigationHeaders,
        Host: `untrusted.invalid:${proxy.port}`,
      })

      expect.soft(untrusted.status).toBe(403)
      expect.soft(upstream.requests).toEqual([])
      expect.soft(JSON.stringify(upstream.requests)).not.toContain(globalToken)

      upstream.requests.length = 0
      const trusted = await rawHttpRequest(proxy.port, path, {
        ...navigationHeaders,
        Host: `127.0.0.1:${proxy.port}`,
      })

      expect(trusted.status).toBe(200)
      expect(upstream.requests.map((request) => request.url)).toEqual(['/comfy/ui'])
    } finally {
      await stopChild(proxy.child)
      await closeServer(upstream.server)
      rmSync(proxy.tempRoot, { recursive: true, force: true })
    }
  })

  it('never serializes a hostile endpoint token into bridge HTML or redirect URLs', async () => {
    const upstream = observedServer()
    const upstreamPort = await listenOnLoopback(upstream.server)
    const mainTarget = `http://127.0.0.1:${upstreamPort}/comfy`
    const globalToken = `global-${Date.now()}-${Math.random()}`
    const injectionFragment = '</script><script>globalThis.__proxyInjected=true</script><script>'
    const clientToken = `${injectionFragment}<line-paragraph-end`
    const proxy = await startProxy({ mainTarget, bearerToken: globalToken })
    const proxyOrigin = `http://127.0.0.1:${proxy.port}`
    const proxyBase = `${proxyOrigin}${proxyPath(mainTarget, '')}`

    try {
      const session = await prepareProxySession(proxyOrigin, mainTarget, clientToken)
      const sessionHeaders = { Cookie: session.cookie }
      const apiResponse = await fetch(`${proxyBase}system_stats`, {
        headers: { ...sessionHeaders, Accept: 'application/json' },
      })
      const htmlResponse = await fetch(`${proxyBase}ui`, {
        headers: { ...sessionHeaders, Accept: 'text/html' },
      })
      const redirectResponse = await fetch(`${proxyBase}redirect`, { headers: sessionHeaders, redirect: 'manual' })
      const html = await htmlResponse.text()
      const redirectLocation = redirectResponse.headers.get('location') ?? ''

      expect(session.response.status).toBe(204)
      expect(apiResponse.status).toBe(200)
      expect(upstream.requests.findLast((request) => request.url === '/comfy/system_stats')?.authorization).toBe(
        `Bearer ${clientToken}`,
      )
      expect(htmlResponse.status).toBe(200)
      expect(html).not.toContain(injectionFragment)
      expect(html).not.toContain(clientToken)
      expect(html).not.toContain(globalToken)

      expect(redirectResponse.status).toBe(302)
      expect(redirectLocation).not.toBe('')
      expect(redirectLocation).not.toContain(injectionFragment)
      expect(redirectLocation).not.toContain(clientToken)
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
      const forgedAdditionalResponse = await fetch(
        `${proxyOrigin}${proxyPath(additionalTarget, 'forged-authorization')}`,
        {
          headers: {
            Authorization: `Bearer ${clientToken}`,
            'X-Workspace': 'forged-http',
          },
        },
      )
      const forgedAdditionalWebSocket = await rawWebSocketRequest(
        proxy.port,
        proxyPath(additionalTarget, 'forged-ws'),
        {
          Authorization: `Bearer ${clientToken}`,
          'X-Workspace': 'forged-ws',
        },
      )

      expect(mainResponse.status).toBe(200)
      expect(anonymousAdditionalResponse.status).toBe(200)
      expect(forgedAdditionalResponse.status).toBe(200)
      expect(forgedAdditionalWebSocket).toMatch(/^HTTP\/1\.1 101/)
      expect(main.requests[0]?.authorization).toBe(`Bearer ${globalToken}`)
      expect(additional.requests.find((request) => request.url === '/comfy/system_stats')).toEqual(
        expect.objectContaining({ authorization: undefined, workspace: 'anonymous' }),
      )
      expect(additional.requests.find((request) => request.url === '/comfy/forged-authorization')).toEqual(
        expect.objectContaining({ authorization: undefined, workspace: 'forged-http' }),
      )
      expect(additional.requests.find((request) => request.url === '/comfy/forged-ws')).toEqual(
        expect.objectContaining({ authorization: undefined, workspace: 'forged-ws' }),
      )

      const session = await prepareProxySession(proxyOrigin, additionalTarget, clientToken)
      additional.requests.length = 0
      const clientAdditionalResponse = await fetch(
        `${proxyOrigin}${proxyPath(additionalTarget, 'object_info')}`,
        {
          headers: {
            Cookie: session.cookie,
            'X-Workspace': 'infinity',
          },
        },
      )
      const clientAdditionalWebSocket = await rawWebSocketRequest(
        proxy.port,
        proxyPath(additionalTarget, 'ws'),
        {
          Cookie: session.cookie,
          'X-Workspace': 'infinity-ws',
        },
      )

      expect(session.response.status).toBe(204)
      expect(clientAdditionalResponse.status).toBe(200)
      expect(clientAdditionalWebSocket).toMatch(/^HTTP\/1\.1 101/)
      expect(additional.requests).toEqual([
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
