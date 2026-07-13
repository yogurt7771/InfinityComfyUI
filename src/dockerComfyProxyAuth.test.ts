import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

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

describe('Docker ComfyUI proxy authentication', () => {
  it('passes an independently configured API Bearer token into the container', () => {
    const compose = readFileSync(join(workspaceRoot, 'docker-compose.yml'), 'utf8')

    expect(compose).toMatch(
      /^\s+COMFY_PROXY_BEARER_TOKEN:\s*["']?\$\{COMFY_PROXY_BEARER_TOKEN(?::-[^}]*)?\}["']?\s*$/m,
    )
  })

  it('does not use the ComfyUI login password file as an API Bearer token source', () => {
    const compose = readFileSync(join(workspaceRoot, 'docker-compose.yml'), 'utf8')

    expect(compose).not.toContain('COMFY_PROXY_PASSWORD_FILE')
    expect(compose).not.toMatch(/(?:^|[\\/])PASSWORD(?:["'}:]|$)/m)
  })

  it('binds the published app port to loopback and passes the allowed ComfyUI proxy target', () => {
    const compose = readFileSync(join(workspaceRoot, 'docker-compose.yml'), 'utf8')

    expect(compose).toMatch(/^\s+-\s*["']?127\.0\.0\.1:7930:7930["']?\s*$/m)
    expect(compose).toMatch(
      /^\s+COMFY_PROXY_TARGET_BASE:\s*["']?\$\{COMFY_PROXY_TARGET_BASE:-http:\/\/127\.0\.0\.1:27707\}["']?\s*$/m,
    )
  })

  it('uses the explicit API token instead of the configured token file in the production server', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'infinity-comfy-auth-'))
    const distDir = join(tempRoot, 'dist')
    const tokenFile = join(tempRoot, 'token.txt')
    const explicitApiToken = `api-${Date.now()}-${Math.random()}`
    const fileToken = `file-${Date.now()}-${Math.random()}`
    let observedAuthorization: string | undefined
    const upstream = createServer((request, response) => {
      observedAuthorization = request.headers.authorization
      response.statusCode = 200
      response.setHeader('content-type', 'application/json')
      response.end('{"ok":true}')
    })
    let child: ChildProcess | undefined

    try {
      mkdirSync(distDir)
      writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>ready</title>', 'utf8')
      writeFileSync(tokenFile, `${fileToken}\n`, 'utf8')
      const upstreamPort = await listenOnLoopback(upstream)
      const proxyPort = await reserveLoopbackPort()
      child = spawn(process.execPath, [join(workspaceRoot, 'server', 'serve.mjs')], {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          HOST: '127.0.0.1',
          PORT: String(proxyPort),
          DIST_DIR: distDir,
          COMFY_PROXY_BEARER_TOKEN: explicitApiToken,
          COMFY_PROXY_TARGET_BASE: `http://127.0.0.1:${upstreamPort}`,
          COMFY_PROXY_TOKEN_FILE: tokenFile,
        },
        stdio: 'ignore',
      })

      await waitForServer(`http://127.0.0.1:${proxyPort}/`, child)
      const targetBase = encodeURIComponent(`http://127.0.0.1:${upstreamPort}`)
      const response = await fetch(`http://127.0.0.1:${proxyPort}/__comfy_proxy/${targetBase}/system_stats`, {
        headers: { Accept: 'application/json' },
      })

      expect(response.status).toBe(200)
      expect(observedAuthorization).toBe(`Bearer ${explicitApiToken}`)
      expect(observedAuthorization).not.toBe(`Bearer ${fileToken}`)
    } finally {
      if (child) await stopChild(child)
      if (upstream.listening) await closeServer(upstream)
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })
})
