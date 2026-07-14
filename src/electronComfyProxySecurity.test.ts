import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, request as httpRequest, type Server } from 'node:http'
import net, { type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { comfyProxyAuthUrl, comfyProxyUrl } from './domain/comfyProxy'

type ObservedRequest = { authorization?: string; transport: 'http' | 'websocket'; url: string }
type ElectronSecurityProbe = {
  authorization?: {
    mainFrame: { error?: string; ok: boolean; value?: unknown }
    sameOriginSubframe: { error?: string; ok: boolean; value?: unknown }
  }
  openedExternalUrls: string[]
  popupResults: Array<{
    outcome: { error?: string; ok: boolean; value?: unknown }
    url: string
  }>
}

const listen = (server: Server) =>
  new Promise<number>((resolvePort, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolvePort((server.address() as AddressInfo).port)
    })
  })

const close = (server: Server) =>
  new Promise<void>((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())))

const observedServer = () => {
  const requests: ObservedRequest[] = []
  const server = createServer((request, response) => {
    requests.push({ authorization: request.headers.authorization, transport: 'http', url: request.url ?? '/' })
    if (request.url === '/redirect') {
      response.statusCode = 302
      response.setHeader('location', '/redirected')
      response.end()
      return
    }
    if (String(request.headers.accept ?? '').includes('text/html')) {
      response.statusCode = 200
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end('<!doctype html><html><head></head><body>Electron ComfyUI</body></html>')
      return
    }
    response.statusCode = 200
    response.setHeader('content-type', 'application/json')
    response.end('{"ok":true}')
  })
  server.on('upgrade', (request, socket) => {
    requests.push({ authorization: request.headers.authorization, transport: 'websocket', url: request.url ?? '/' })
    socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
  })
  return { requests, server }
}

const stopChild = async (child: ChildProcess) => {
  if (child.exitCode !== null) return
  child.kill()
  await Promise.race([once(child, 'exit'), new Promise((resolveWait) => setTimeout(resolveWait, 2000))])
}

const waitForAppUrl = async (file: string, child: ChildProcess) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Electron runtime exited before app server startup (${child.exitCode})`)
    if (existsSync(file)) return readFileSync(file, 'utf8').trim().replace(/\/$/, '')
    await new Promise((resolveWait) => setTimeout(resolveWait, 25))
  }
  throw new Error('Electron app server did not start')
}

const waitForSecurityProbe = async (file: string, child: ChildProcess) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Electron runtime exited before security probe (${child.exitCode})`)
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as ElectronSecurityProbe
    await new Promise((resolveWait) => setTimeout(resolveWait, 25))
  }
  throw new Error('Electron security probe did not finish')
}

const runElectronSecurityProbe = async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'infinity-electron-window-security-'))
  const urlFile = join(tempRoot, 'app-url.txt')
  const probeFile = join(tempRoot, 'probe.json')
  const workspaceRoot = resolve(__dirname, '..')
  const child = spawn(process.execPath, [join(workspaceRoot, 'electron', 'main.cjs')], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${join(workspaceRoot, 'tests', 'fixtures', 'electron-runtime-stub.cjs')}`,
      INFINITY_ELECTRON_TEST_URL_FILE: urlFile,
      INFINITY_ELECTRON_TEST_PROBE_FILE: probeFile,
      COMFY_PROXY_TARGET_BASE: 'http://127.0.0.1:9',
      COMFY_PROXY_TARGET_BASES: '',
      COMFY_PROXY_TOKEN_FILE: '',
    },
    stdio: 'ignore',
  })

  try {
    await waitForAppUrl(urlFile, child)
    return await waitForSecurityProbe(probeFile, child)
  } finally {
    await stopChild(child)
    rmSync(tempRoot, { recursive: true, force: true })
  }
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
      reject(new Error('Electron WebSocket request timed out'))
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
        `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: Zml4dHVyZS1rZXk=\r\nSec-WebSocket-Version: 13\r\n${extraHeaders}\r\n`,
      )
    })
  })

const rawHttpRequest = (port: number, path: string, headers: Record<string, string>) =>
  new Promise<{ body: string; status: number }>((resolveResponse, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path, headers }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => resolveResponse({ body, status: response.statusCode ?? 0 }))
    })
    request.on('error', reject)
    request.end()
  })

describe('Electron ComfyUI proxy security', () => {
  it(
    'authorizes ComfyUI targets only for the main frame, not a same-origin subframe',
    async () => {
      const probe = await runElectronSecurityProbe()

      expect(probe.authorization?.mainFrame).toMatchObject({ ok: true, value: { ok: true } })
      expect(probe.authorization?.sameOriginSubframe).toMatchObject({ ok: false })
    },
    15_000,
  )

  it(
    'opens popup URLs externally only for valid HTTP and HTTPS destinations',
    async () => {
      const probe = await runElectronSecurityProbe()

      expect(probe.popupResults).toHaveLength(6)
      expect(probe.popupResults.every(({ outcome }) => outcome.ok)).toBe(true)
      expect(probe.popupResults.map(({ outcome }) => outcome.value)).toEqual(
        Array.from({ length: 6 }, () => ({ action: 'deny' })),
      )
      expect(probe.openedExternalUrls).toEqual(['https://example.com/docs', 'http://example.com/path?x=1'])
    },
    15_000,
  )

  it(
    'keeps credentials in revocable same-origin sessions across HTTP, redirects, bridge HTML, and WebSockets',
    async () => {
      const main = observedServer()
      const sessionTarget = observedServer()
      const attacker = observedServer()
      const mainPort = await listen(main.server)
      const sessionTargetPort = await listen(sessionTarget.server)
      const attackerPort = await listen(attacker.server)
      const mainTarget = `http://127.0.0.1:${mainPort}`
      const sessionTargetBase = `http://127.0.0.1:${sessionTargetPort}`
      const attackerTarget = `http://127.0.0.1:${attackerPort}`
      const globalToken = 'fixture-electron-global-token'
      const endpointTokenA = 'fixture-electron-endpoint-token-a'
      const endpointTokenB = 'fixture-electron-endpoint-token-b'
      const tempRoot = mkdtempSync(join(tmpdir(), 'infinity-electron-security-'))
      const urlFile = join(tempRoot, 'app-url.txt')
      const workspaceRoot = resolve(__dirname, '..')
      const child = spawn(process.execPath, [join(workspaceRoot, 'electron', 'main.cjs')], {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${join(workspaceRoot, 'tests', 'fixtures', 'electron-runtime-stub.cjs')}`,
          INFINITY_ELECTRON_TEST_URL_FILE: urlFile,
          COMFY_PROXY_BEARER_TOKEN: globalToken,
          COMFY_PROXY_TARGET_BASE: mainTarget,
          COMFY_PROXY_TARGET_BASES: JSON.stringify([sessionTargetBase]),
          COMFY_PROXY_TOKEN_FILE: '',
        },
        stdio: 'ignore',
      })

      try {
        const appOrigin = await waitForAppUrl(urlFile, child)
        const appPort = Number(new URL(appOrigin).port)
        const mainProxyBase = `${appOrigin}${comfyProxyUrl(mainTarget)}`
        const sessionProxyBase = `${appOrigin}${comfyProxyUrl(sessionTargetBase)}`
        const attackerProxyBase = `${appOrigin}${comfyProxyUrl(attackerTarget)}`
        const authUrl = `${appOrigin}${comfyProxyAuthUrl(sessionTargetBase)}`
        const sessionA = await fetch(authUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: appOrigin },
          body: JSON.stringify({ bearerToken: endpointTokenA }),
        })
        const cookieA = (sessionA.headers.get('set-cookie') ?? '').split(';', 1)[0] ?? ''
        const sessionB = await fetch(authUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookieA, Origin: appOrigin },
          body: JSON.stringify({ bearerToken: endpointTokenB }),
        })
        const cookieB = (sessionB.headers.get('set-cookie') ?? '').split(';', 1)[0] ?? ''
        const unconfiguredAuth = await fetch(`${appOrigin}${comfyProxyAuthUrl(attackerTarget)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: appOrigin },
          body: JSON.stringify({ bearerToken: 'fixture-unconfigured-target-token' }),
        })
        const metadataAuth = await fetch(`${appOrigin}${comfyProxyAuthUrl('http://169.254.169.254/latest')}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: appOrigin },
          body: '{}',
        })
        await fetch(`${mainProxyBase}system_stats`, { headers: { Origin: appOrigin } })
        sessionTarget.requests.length = 0
        await fetch(`${sessionProxyBase}system_stats`, { headers: { Cookie: cookieA, Origin: appOrigin } })
        await fetch(`${sessionProxyBase}system_stats`, { headers: { Cookie: cookieB, Origin: appOrigin } })
        const htmlResponse = await fetch(sessionProxyBase, {
          headers: { Accept: 'text/html', Cookie: cookieB, Origin: appOrigin },
        })
        const redirectResponse = await fetch(`${sessionProxyBase}redirect`, {
          headers: { Cookie: cookieB, Origin: appOrigin },
          redirect: 'manual',
        })
        const arbitraryResponse = await fetch(`${attackerProxyBase}system_stats`, { headers: { Origin: appOrigin } })
        const crossSiteResponse = await fetch(`${attackerProxyBase}cross-site`, {
          headers: { Origin: 'https://untrusted.invalid' },
        })
        const crossSiteWebSocket = await rawWebSocketRequest(
          appPort,
          `${comfyProxyUrl(attackerTarget)}ws`,
          { Origin: 'https://untrusted.invalid' },
        )
        const html = await htmlResponse.text()
        const redirectLocation = redirectResponse.headers.get('location') ?? ''

        expect.soft(sessionA.status).toBe(204)
        expect.soft(sessionB.status).toBe(204)
        expect.soft(unconfiguredAuth.status).toBe(403)
        expect.soft(metadataAuth.status).toBe(403)
        expect.soft(main.requests.at(-1)?.authorization).toBe(`Bearer ${globalToken}`)
        expect.soft(sessionTarget.requests[0]?.authorization).toBeUndefined()
        expect.soft(sessionTarget.requests[1]?.authorization).toBe(`Bearer ${endpointTokenB}`)
        expect.soft(html).not.toContain(endpointTokenB)
        expect.soft(html).not.toContain(globalToken)
        expect.soft(html).toContain('infinity-comfy-editor-v1')
        expect.soft(html).toContain('comfyAPI')
        expect.soft(redirectLocation).not.toContain(endpointTokenB)
        expect.soft(redirectLocation).not.toContain(globalToken)
        expect.soft(arbitraryResponse.status).toBe(403)
        expect.soft(attacker.requests.find((request) => request.url === '/system_stats')?.authorization).toBeUndefined()
        expect.soft(attacker.requests.some((request) => request.url === '/system_stats')).toBe(false)
        expect.soft(crossSiteResponse.status).toBe(403)
        expect.soft(attacker.requests.some((request) => request.url === '/cross-site')).toBe(false)
        expect.soft(crossSiteWebSocket).not.toContain('101 Switching Protocols')
        expect.soft(attacker.requests.some((request) => request.url === '/ws')).toBe(false)
      } finally {
        await stopChild(child)
        await close(main.server)
        await close(sessionTarget.server)
        await close(attacker.server)
        rmSync(tempRoot, { recursive: true, force: true })
      }
    },
    15_000,
  )

  it(
    'rejects Electron DNS-rebinding HTTP and WebSocket requests without exposing the primary target token',
    async () => {
      const main = observedServer()
      const mainPort = await listen(main.server)
      const mainTarget = `http://127.0.0.1:${mainPort}`
      const globalToken = 'fixture-electron-rebinding-global-token'
      const tempRoot = mkdtempSync(join(tmpdir(), 'infinity-electron-rebinding-'))
      const urlFile = join(tempRoot, 'app-url.txt')
      const workspaceRoot = resolve(__dirname, '..')
      const child = spawn(process.execPath, [join(workspaceRoot, 'electron', 'main.cjs')], {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${join(workspaceRoot, 'tests', 'fixtures', 'electron-runtime-stub.cjs')}`,
          INFINITY_ELECTRON_TEST_URL_FILE: urlFile,
          COMFY_PROXY_BEARER_TOKEN: globalToken,
          COMFY_PROXY_TARGET_BASE: mainTarget,
          COMFY_PROXY_TARGET_BASES: '',
          COMFY_PROXY_TOKEN_FILE: '',
        },
        stdio: 'ignore',
      })

      try {
        const appOrigin = await waitForAppUrl(urlFile, child)
        const appPort = Number(new URL(appOrigin).port)
        const proxyPathname = `${comfyProxyUrl(mainTarget)}system_stats`
        const websocketPathname = `${comfyProxyUrl(mainTarget)}ws`
        const trustedHeaders = {
          Host: `127.0.0.1:${appPort}`,
          Origin: appOrigin,
          'Sec-Fetch-Site': 'same-origin',
        }
        const trustedHttp = await rawHttpRequest(appPort, proxyPathname, trustedHeaders)
        const trustedWebSocket = await rawWebSocketRequest(appPort, websocketPathname, trustedHeaders)

        expect(trustedHttp.status).toBe(200)
        expect(trustedWebSocket).toMatch(/^HTTP\/1\.1 101/)
        expect(main.requests).toHaveLength(2)
        expect(main.requests.every((request) => request.authorization === `Bearer ${globalToken}`)).toBe(true)

        main.requests.length = 0
        const rebindingHeaders = {
          Host: `evil.test:${appPort}`,
          Origin: `http://evil.test:${appPort}`,
          'Sec-Fetch-Site': 'same-origin',
        }
        const rejectedHttp = await rawHttpRequest(appPort, proxyPathname, rebindingHeaders)
        const rejectedWebSocket = await rawWebSocketRequest(appPort, websocketPathname, rebindingHeaders)

        expect.soft(rejectedHttp.status).toBe(403)
        expect.soft(rejectedWebSocket).not.toMatch(/^HTTP\/1\.1 101/)
        expect.soft(main.requests).toEqual([])
        expect.soft(JSON.stringify(main.requests)).not.toContain(globalToken)
      } finally {
        await stopChild(child)
        await close(main.server)
        rmSync(tempRoot, { recursive: true, force: true })
      }
    },
    15_000,
  )
})
