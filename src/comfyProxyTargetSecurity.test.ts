import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import net, { type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type ObservedRequest = {
  transport: 'http' | 'websocket'
  url: string
  authorization?: string
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
    })
    response.statusCode = 200
    response.setHeader('content-type', 'application/json')
    response.end('{"ok":true}')
  })
  server.on('upgrade', (request, socket) => {
    requests.push({
      transport: 'websocket',
      url: request.url ?? '/',
      authorization: request.headers.authorization,
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

const rawProxyRequest = (port: number, path: string, websocket = false) =>
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
      reject(new Error(`proxy request timed out: ${path}`))
    })
    socket.on('error', reject)
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8')
      if (response.includes('\r\n\r\n')) finish()
    })
    socket.on('end', finish)
    socket.on('connect', () => {
      const upgradeHeaders = websocket
        ? 'Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGVzdC1rZXk=\r\nSec-WebSocket-Version: 13\r\n'
        : 'Connection: close\r\n'
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n${upgradeHeaders}\r\n`)
    })
  })

const proxyPath = (targetBase: string, suffix: string) =>
  `/__comfy_proxy/${encodeURIComponent(targetBase)}/${suffix.replace(/^\/+/, '')}`

const startProxy = async (allowedTargetBase: string, bearerToken: string) => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'infinity-proxy-target-'))
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
      COMFY_PROXY_BEARER_TOKEN: bearerToken,
      COMFY_PROXY_TARGET_BASE: allowedTargetBase,
      COMFY_PROXY_TOKEN_FILE: '',
      COMFY_PROXY_LOOPBACK_HOST: '',
    },
    stdio: 'ignore',
  })
  await waitForServer(`http://127.0.0.1:${port}/`, child)
  return { child, port, tempRoot }
}

describe('production ComfyUI proxy target security', () => {
  it('rejects HTTP target-origin and authority bypasses without leaking the global Bearer token', async () => {
    const allowed = observedServer()
    const untrusted = observedServer()
    const allowedPort = await listenOnLoopback(allowed.server)
    const untrustedPort = await listenOnLoopback(untrusted.server)
    const allowedTargetBase = `http://127.0.0.1:${allowedPort}/comfy`
    const untrustedTargetBase = `http://127.0.0.1:${untrustedPort}`
    const bearerToken = `security-${Date.now()}-${Math.random()}`
    const proxy = await startProxy(allowedTargetBase, bearerToken)

    try {
      const attackPaths = [
        proxyPath(untrustedTargetBase, 'steal'),
        `/__comfy_proxy/${encodeURIComponent(allowedTargetBase)}//127.0.0.1:${untrustedPort}/steal`,
        `/__comfy_proxy/${encodeURIComponent(allowedTargetBase)}/\\\\127.0.0.1:${untrustedPort}/steal`,
      ]

      for (const attackPath of attackPaths) {
        const response = await rawProxyRequest(proxy.port, attackPath)
        expect.soft(response, attackPath).toMatch(/^HTTP\/1\.1 4\d\d/)
      }
      expect(untrusted.requests).toEqual([])
      expect(allowed.requests).toEqual([])
    } finally {
      await stopChild(proxy.child)
      await closeServer(allowed.server)
      await closeServer(untrusted.server)
      rmSync(proxy.tempRoot, { recursive: true, force: true })
    }
  })

  it('rejects WebSocket target-origin and authority bypasses without leaking the global Bearer token', async () => {
    const allowed = observedServer()
    const untrusted = observedServer()
    const allowedPort = await listenOnLoopback(allowed.server)
    const untrustedPort = await listenOnLoopback(untrusted.server)
    const allowedTargetBase = `http://127.0.0.1:${allowedPort}/comfy`
    const untrustedTargetBase = `http://127.0.0.1:${untrustedPort}`
    const bearerToken = `security-${Date.now()}-${Math.random()}`
    const proxy = await startProxy(allowedTargetBase, bearerToken)

    try {
      const attackPaths = [
        proxyPath(untrustedTargetBase, 'ws'),
        `/__comfy_proxy/${encodeURIComponent(allowedTargetBase)}//127.0.0.1:${untrustedPort}/ws`,
        `/__comfy_proxy/${encodeURIComponent(allowedTargetBase)}/\\\\127.0.0.1:${untrustedPort}/ws`,
      ]

      for (const attackPath of attackPaths) {
        const response = await rawProxyRequest(proxy.port, attackPath, true)
        expect.soft(response, attackPath).toMatch(/^HTTP\/1\.1 4\d\d/)
      }
      expect(untrusted.requests).toEqual([])
      expect(allowed.requests).toEqual([])
    } finally {
      await stopChild(proxy.child)
      await closeServer(allowed.server)
      await closeServer(untrusted.server)
      rmSync(proxy.tempRoot, { recursive: true, force: true })
    }
  })

  it('preserves an allowed target subpath for HTTP and WebSocket requests after validation', async () => {
    const allowed = observedServer()
    const allowedPort = await listenOnLoopback(allowed.server)
    const allowedTargetBase = `http://127.0.0.1:${allowedPort}/comfy`
    const bearerToken = `security-${Date.now()}-${Math.random()}`
    const proxy = await startProxy(allowedTargetBase, bearerToken)

    try {
      const httpResponse = await fetch(
        `http://127.0.0.1:${proxy.port}${proxyPath(allowedTargetBase, 'system_stats')}`,
        { headers: { Accept: 'application/json' } },
      )
      const websocketResponse = await rawProxyRequest(
        proxy.port,
        `${proxyPath(allowedTargetBase, 'ws')}?clientId=browser-client`,
        true,
      )

      expect(httpResponse.status).toBe(200)
      expect(websocketResponse).toMatch(/^HTTP\/1\.1 101/)
      expect(allowed.requests).toEqual([
        {
          transport: 'http',
          url: '/comfy/system_stats',
          authorization: `Bearer ${bearerToken}`,
        },
        {
          transport: 'websocket',
          url: '/comfy/ws?clientId=browser-client',
          authorization: `Bearer ${bearerToken}`,
        },
      ])
    } finally {
      await stopChild(proxy.child)
      await closeServer(allowed.server)
      rmSync(proxy.tempRoot, { recursive: true, force: true })
    }
  })
})
