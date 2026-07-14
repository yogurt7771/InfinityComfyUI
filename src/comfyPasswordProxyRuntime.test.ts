// @vitest-environment node

import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { comfyProxyAuthUrl, comfyProxyUrl } from './domain/comfyProxy'

type RuntimeKind = 'production' | 'vite' | 'electron'

type ObservedLogin = {
  authorization?: string
  body: string
  contentType?: string
  cookie?: string
  method?: string
  url: string
}

type ObservedApi = {
  authorization?: string
  cookie?: string
  url: string
}

type StartedRuntime = {
  child: ChildProcess
  cleanup: () => Promise<void>
  origin: string
  readonly output: string
}

const workspaceRoot = resolve(__dirname, '..')

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

const reservePort = async () => {
  const server = createServer()
  const port = await listen(server)
  await close(server)
  return port
}

const stopChild = async (child: ChildProcess) => {
  if (child.exitCode !== null) return
  child.kill()
  await Promise.race([once(child, 'exit'), new Promise((resolveWait) => setTimeout(resolveWait, 2000))])
}

const waitForHttp = async (url: string, child: ChildProcess) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`runtime exited before startup (${child.exitCode})`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch (error) {
      if (attempt === 119) throw error
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25))
  }
  throw new Error('runtime did not become ready')
}

const waitForFile = async (file: string, child: ChildProcess) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Electron runtime exited before startup (${child.exitCode})`)
    if (existsSync(file)) return readFileSync(file, 'utf8').trim().replace(/\/$/, '')
    await new Promise((resolveWait) => setTimeout(resolveWait, 25))
  }
  throw new Error('Electron runtime did not become ready')
}

const startRuntime = async (
  kind: RuntimeKind,
  targetBase: string,
  additionalTargets: string[] = [],
): Promise<StartedRuntime> => {
  const tempRoot = mkdtempSync(join(tmpdir(), `infinity-comfy-password-${kind}-`))
  const output: string[] = []
  let child: ChildProcess
  let origin: string

  if (kind === 'electron') {
    const urlFile = join(tempRoot, 'app-url.txt')
    child = spawn(process.execPath, [join(workspaceRoot, 'electron', 'main.cjs')], {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${join(workspaceRoot, 'tests', 'fixtures', 'electron-runtime-stub.cjs')}`,
        INFINITY_ELECTRON_TEST_URL_FILE: urlFile,
        COMFY_PROXY_BEARER_TOKEN: '',
        COMFY_PROXY_TARGET_BASE: targetBase,
        COMFY_PROXY_TARGET_BASES: JSON.stringify(additionalTargets),
        COMFY_PROXY_TOKEN_FILE: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.on('data', (chunk) => output.push(chunk.toString('utf8')))
    child.stderr?.on('data', (chunk) => output.push(chunk.toString('utf8')))
    origin = await waitForFile(urlFile, child)
  } else {
    const port = await reservePort()
    if (kind === 'production') {
      const distDir = join(tempRoot, 'dist')
      mkdirSync(distDir)
      writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>ready</title>', 'utf8')
      child = spawn(process.execPath, [join(workspaceRoot, 'server', 'serve.mjs')], {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          HOST: '127.0.0.1',
          PORT: String(port),
          DIST_DIR: distDir,
          COMFY_PROXY_BEARER_TOKEN: '',
          COMFY_PROXY_TARGET_BASE: targetBase,
          COMFY_PROXY_TARGET_BASES: JSON.stringify(additionalTargets),
          COMFY_PROXY_TOKEN_FILE: '',
          COMFY_PROXY_LOOPBACK_HOST: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } else {
      child = spawn(
        process.execPath,
        [
          join(workspaceRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '--strictPort',
        ],
        {
          cwd: workspaceRoot,
          env: {
            ...process.env,
            COMFY_PROXY_BEARER_TOKEN: '',
            COMFY_PROXY_TARGET_BASE: targetBase,
            COMFY_PROXY_TARGET_BASES: JSON.stringify(additionalTargets),
            COMFY_PROXY_TOKEN_FILE: '',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
    }
    child.stdout?.on('data', (chunk) => output.push(chunk.toString('utf8')))
    child.stderr?.on('data', (chunk) => output.push(chunk.toString('utf8')))
    origin = `http://127.0.0.1:${port}`
    await waitForHttp(`${origin}/`, child)
  }

  return {
    child,
    origin,
    cleanup: async () => {
      await stopChild(child)
      rmSync(tempRoot, { recursive: true, force: true })
    },
    get output() {
      return output.join('')
    },
  }
}

const readBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

const responseCookies = (response: Response) => {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  const values = headers.getSetCookie?.() ?? (headers.get('set-cookie') ? [headers.get('set-cookie')!] : [])
  return values
}

const cookieHeader = (setCookies: string[]) => setCookies.map((value) => value.split(';', 1)[0]).join('; ')

const rawRequest = (
  port: number,
  path: string,
  options: { body?: string; headers?: Record<string, string>; method?: string } = {},
) =>
  new Promise<{ body: string; headers: Record<string, string | string[] | undefined>; status: number }>(
    (resolveResponse, reject) => {
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path,
          method: options.method ?? 'GET',
          headers: options.headers,
        },
        (response) => {
          let body = ''
          response.setEncoding('utf8')
          response.on('data', (chunk) => {
            body += chunk
          })
          response.on('end', () => resolveResponse({
            body,
            headers: response.headers,
            status: response.statusCode ?? 0,
          }))
        },
      )
      request.on('error', reject)
      request.end(options.body)
    },
  )

const rawSetCookies = (headers: Record<string, string | string[] | undefined>) => {
  const value = headers['set-cookie']
  return Array.isArray(value) ? value : value ? [value] : []
}

const setCookieName = (value: string) => value.slice(0, value.indexOf('='))

const applySetCookies = (jar: Map<string, string>, values: string[]) => {
  for (const value of values) {
    const pair = value.split(';', 1)[0] ?? ''
    const separator = pair.indexOf('=')
    if (separator <= 0) continue
    const name = pair.slice(0, separator)
    const cookieValue = pair.slice(separator + 1)
    if (!cookieValue || /(?:^|;)\s*max-age=0(?:;|$)/i.test(value)) jar.delete(name)
    else jar.set(name, cookieValue)
  }
}

const jarHeader = (jar: Map<string, string>) => [...jar].map(([name, value]) => `${name}=${value}`).join('; ')

describe.each(['production', 'vite', 'electron'] as const)('%s password-backed ComfyUI proxy session', (kind) => {
  it(
    'logs in with a form password, calls the API with only the namespaced upstream cookie, and rejects a wrong password',
    async () => {
      const acceptedPassword = 'fixture correct + & = password'
      const rejectedPassword = 'fixture wrong + & = password'
      const loginRequests: ObservedLogin[] = []
      const apiRequests: ObservedApi[] = []
      const upstream = createServer(async (request, response) => {
        if (request.url === '/comfy/login') {
          const body = await readBody(request)
          loginRequests.push({
            authorization: request.headers.authorization,
            body,
            contentType: request.headers['content-type'],
            cookie: request.headers.cookie,
            method: request.method,
            url: request.url,
          })
          const password = new URLSearchParams(body).get('password')
          response.statusCode = 302
          if (password === acceptedPassword) {
            response.setHeader('location', '/comfy/')
            response.setHeader('set-cookie', 'comfy_sid=session-ok; Path=/; HttpOnly; SameSite=Lax')
          } else {
            response.setHeader('location', '/comfy/login?wrong_password=1')
          }
          response.end()
          return
        }

        if (request.url === '/comfy/system_stats') {
          apiRequests.push({
            authorization: request.headers.authorization,
            cookie: request.headers.cookie,
            url: request.url,
          })
          if (request.headers.cookie?.includes('comfy_sid=session-ok')) {
            response.statusCode = 200
            response.setHeader('content-type', 'application/json')
            response.end('{"system":{"comfyui_version":"test"}}')
          } else {
            response.statusCode = 401
            response.end('login required')
          }
          return
        }

        response.statusCode = 404
        response.end('not found')
      })
      const upstreamPort = await listen(upstream)
      const targetBase = `http://127.0.0.1:${upstreamPort}/comfy`
      let runtime: (StartedRuntime & { output?: string }) | undefined

      try {
        runtime = await startRuntime(kind, targetBase)
        const authUrl = `${runtime.origin}${comfyProxyAuthUrl(targetBase)}`
        const successfulAuth = await fetch(authUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: runtime.origin },
          body: JSON.stringify({ password: acceptedPassword }),
          redirect: 'manual',
        })
        const successfulSetCookies = responseCookies(successfulAuth)
        const successfulCookieHeader = cookieHeader(successfulSetCookies)
        const apiResponse = await fetch(`${runtime.origin}${comfyProxyUrl(targetBase)}system_stats`, {
          headers: { Accept: 'application/json', Cookie: successfulCookieHeader, Origin: runtime.origin },
        })
        const wrongAuth = await fetch(authUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: runtime.origin },
          body: JSON.stringify({ password: rejectedPassword }),
          redirect: 'manual',
        })
        const wrongSetCookies = responseCookies(wrongAuth)
        const apiAfterWrongPassword = await fetch(`${runtime.origin}${comfyProxyUrl(targetBase)}system_stats`, {
          headers: { Accept: 'application/json', Cookie: cookieHeader(wrongSetCookies), Origin: runtime.origin },
        })

        expect.soft(successfulAuth.status).toBe(204)
        expect.soft(loginRequests[0]).toEqual({
          authorization: undefined,
          body: new URLSearchParams({ password: acceptedPassword }).toString(),
          contentType: expect.stringMatching(/^application\/x-www-form-urlencoded(?:;|$)/i),
          cookie: undefined,
          method: 'POST',
          url: '/comfy/login',
        })
        expect.soft(successfulSetCookies.some((value) => value.startsWith('__infinity_comfy_upstream_'))).toBe(true)
        expect.soft(successfulSetCookies.every((value) => value.includes('Path=/__comfy_proxy/'))).toBe(true)
        expect.soft(apiResponse.status).toBe(200)
        expect.soft(apiRequests[0]).toEqual({
          authorization: undefined,
          cookie: 'comfy_sid=session-ok',
          url: '/comfy/system_stats',
        })

        expect.soft(wrongAuth.status).toBe(401)
        expect.soft(loginRequests[1]?.url).toBe('/comfy/login')
        expect.soft(loginRequests[1]?.authorization).toBeUndefined()
        expect.soft(new URLSearchParams(loginRequests[1]?.body).get('password')).toBe(rejectedPassword)
        expect.soft(wrongSetCookies.some((value) => value.startsWith('__infinity_comfy_proxy_session_'))).toBe(false)
        expect.soft(apiAfterWrongPassword.status).toBe(401)

        const externallyVisible = JSON.stringify({
          apiRequests,
          authUrl,
          responseCookies: [...successfulSetCookies, ...wrongSetCookies],
          runtimeOutput: runtime.output ?? '',
          successfulAuthBody: await successfulAuth.text(),
          wrongAuthBody: await wrongAuth.text(),
        })
        expect.soft(externallyVisible).not.toContain(acceptedPassword)
        expect.soft(externallyVisible).not.toContain(rejectedPassword)
      } finally {
        if (runtime) await runtime.cleanup()
        await close(upstream)
      }
    },
    20_000,
  )

  it(
    'uses one latest isolated context capability while revoking failed and replaced sessions',
    async () => {
      const acceptedPassword = 'fixture accepted password for rotation'
      const rejectedPassword = 'fixture rejected password for rotation'
      const apiRequests: ObservedApi[] = []
      const upstream = createServer(async (request, response) => {
        if (request.url === '/comfy/login') {
          const password = new URLSearchParams(await readBody(request)).get('password')
          response.statusCode = 302
          if (password === acceptedPassword) {
            response.setHeader('location', '/comfy/')
            response.setHeader('set-cookie', 'comfy_sid=rotation-ok; Path=/; HttpOnly; SameSite=Lax')
          } else {
            response.setHeader('location', '/comfy/login?wrong_password=1')
          }
          response.end()
          return
        }
        if (request.url === '/comfy/system_stats' || request.url === '/other/system_stats') {
          apiRequests.push({
            authorization: request.headers.authorization,
            cookie: request.headers.cookie,
            url: request.url,
          })
          const authorized = request.headers.cookie?.includes('comfy_sid=rotation-ok') || Boolean(request.headers.authorization)
          response.statusCode = authorized ? 200 : 401
          response.end(authorized ? '{"ok":true}' : 'login required')
          return
        }
        response.statusCode = 404
        response.end('not found')
      })
      const upstreamPort = await listen(upstream)
      const targetBase = `http://127.0.0.1:${upstreamPort}/comfy`
      const otherTargetBase = `http://127.0.0.1:${upstreamPort}/other`
      let runtime: StartedRuntime | undefined

      try {
        runtime = await startRuntime(kind, targetBase, [otherTargetBase])
        const runtimeUrl = new URL(runtime.origin)
        const port = Number(runtimeUrl.port)
        const frameHost = `frame-${'a'.repeat(32)}.localhost:${port}`
        const frameOrigin = `${runtimeUrl.protocol}//${frameHost}`
        const secondFrameHost = `frame-${'b'.repeat(32)}.localhost:${port}`
        const secondFrameOrigin = `${runtimeUrl.protocol}//${secondFrameHost}`
        const authPath = comfyProxyAuthUrl(targetBase)
        const otherAuthPath = comfyProxyAuthUrl(otherTargetBase)
        const proxyApiPath = `${comfyProxyUrl(targetBase)}system_stats`
        const otherProxyApiPath = `${comfyProxyUrl(otherTargetBase)}system_stats`
        const authHeaders = {
          Host: frameHost,
          Origin: runtime.origin,
          'Sec-Fetch-Site': 'cross-site',
          'Content-Type': 'application/json',
        }
        const frameApiHeaders = {
          Host: frameHost,
          Origin: frameOrigin,
          'Sec-Fetch-Site': 'same-origin',
          Accept: 'application/json',
        }
        const secondFrameAuthHeaders = {
          ...authHeaders,
          Host: secondFrameHost,
        }
        const secondFrameApiHeaders = {
          ...frameApiHeaders,
          Host: secondFrameHost,
          Origin: secondFrameOrigin,
        }
        const successfulAuth = await rawRequest(port, authPath, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ password: acceptedPassword }),
        })
        const successfulCookies = rawSetCookies(successfulAuth.headers)
        const jar = new Map<string, string>()
        applySetCookies(jar, successfulCookies)
        const successfulCookieHeader = jarHeader(jar)
        const internalCookie = [...jar].find(([name]) => name.startsWith('__infinity_comfy_session_'))
        const upstreamCookie = [...jar].find(([name]) => name.startsWith('__infinity_comfy_upstream_'))

        const apiCountBeforePasswordCapability = apiRequests.length
        const passwordCapabilityApi = await rawRequest(port, proxyApiPath, { headers: frameApiHeaders })
        const passwordCapabilityRequests = apiRequests.slice(apiCountBeforePasswordCapability)

        expect.soft(passwordCapabilityApi.status).toBe(200)
        expect.soft(passwordCapabilityRequests).toEqual([
          {
            authorization: undefined,
            cookie: 'comfy_sid=rotation-ok',
            url: '/comfy/system_stats',
          },
        ])
        expect.soft(successfulCookies.some((value) => value.startsWith('comfy_sid='))).toBe(false)
        expect.soft(successfulAuth.body).not.toContain('comfy_sid=rotation-ok')
        expect.soft(runtime.output).not.toContain('comfy_sid=rotation-ok')

        const rejectedAuth = await rawRequest(port, authPath, {
          method: 'POST',
          headers: { ...authHeaders, Cookie: successfulCookieHeader },
          body: JSON.stringify({ password: rejectedPassword }),
        })
        const rejectedCookies = rawSetCookies(rejectedAuth.headers)

        expect.soft(successfulAuth.status).toBe(204)
        expect.soft(internalCookie).toBeDefined()
        expect.soft(upstreamCookie).toBeDefined()
        expect.soft(rejectedAuth.status).toBe(401)
        for (const cookie of successfulCookies) {
          const name = setCookieName(cookie)
          expect.soft(rejectedCookies.some((value) => (
            value.startsWith(`${name}=`) && /(?:^|;)\s*max-age=0(?:;|$)/i.test(value)
          )), `clears ${name}`).toBe(true)
        }

        applySetCookies(jar, rejectedCookies)
        expect.soft([...jar.keys()].some((name) => name.startsWith('__infinity_comfy_session_'))).toBe(false)
        expect.soft([...jar.keys()].some((name) => name.startsWith('__infinity_comfy_upstream_'))).toBe(false)

        const apiCountBeforeClearedJar = apiRequests.length
        const clearedJarApi = await rawRequest(port, proxyApiPath, {
          headers: { ...frameApiHeaders, ...(jar.size ? { Cookie: jarHeader(jar) } : {}) },
        })
        expect.soft(clearedJarApi.status).toBeGreaterThanOrEqual(400)
        expect.soft(apiRequests.slice(apiCountBeforeClearedJar)).toEqual([])

        const apiCountBeforeOldInternal = apiRequests.length
        const oldInternalApi = await rawRequest(port, proxyApiPath, {
          headers: {
            ...frameApiHeaders,
            Cookie: internalCookie ? `${internalCookie[0]}=${internalCookie[1]}` : '',
          },
        })
        expect.soft(oldInternalApi.status).toBeGreaterThanOrEqual(400)
        expect.soft(apiRequests.slice(apiCountBeforeOldInternal)).toEqual([])

        const concurrentA = await rawRequest(port, authPath, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ bearerToken: 'fixture-concurrent-token-a' }),
        })
        const concurrentACookie = rawSetCookies(concurrentA.headers)
          .map((value) => value.split(';', 1)[0] ?? '')
          .find((value) => value.startsWith('__infinity_comfy_session_'))
        const concurrentB = await rawRequest(port, authPath, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ bearerToken: 'fixture-concurrent-token-b' }),
        })
        const secondFrameSession = await rawRequest(port, authPath, {
          method: 'POST',
          headers: secondFrameAuthHeaders,
          body: JSON.stringify({ bearerToken: 'fixture-second-frame-token' }),
        })
        const otherTargetSession = await rawRequest(port, otherAuthPath, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ bearerToken: 'fixture-other-target-token' }),
        })

        const apiCountBeforeCapabilityChecks = apiRequests.length
        const noCookieApi = await rawRequest(port, proxyApiPath, { headers: frameApiHeaders })
        const replacedCookieApi = await rawRequest(port, proxyApiPath, {
          headers: { ...frameApiHeaders, ...(concurrentACookie ? { Cookie: concurrentACookie } : {}) },
        })
        const secondFrameApi = await rawRequest(port, proxyApiPath, { headers: secondFrameApiHeaders })
        const otherTargetApi = await rawRequest(port, otherProxyApiPath, { headers: frameApiHeaders })
        const parentNoCookieApi = await rawRequest(port, proxyApiPath, {
          headers: {
            Host: runtimeUrl.host,
            Origin: runtime.origin,
            'Sec-Fetch-Site': 'same-origin',
            Accept: 'application/json',
          },
        })

        expect.soft(concurrentA.status).toBe(204)
        expect.soft(concurrentB.status).toBe(204)
        expect.soft(secondFrameSession.status).toBe(204)
        expect.soft(otherTargetSession.status).toBe(204)
        expect.soft(concurrentACookie).toBeDefined()
        expect.soft(noCookieApi.status).toBe(200)
        expect.soft(replacedCookieApi.status).toBe(200)
        expect.soft(secondFrameApi.status).toBe(200)
        expect.soft(otherTargetApi.status).toBe(200)
        expect.soft(parentNoCookieApi.status).toBeGreaterThanOrEqual(400)
        expect.soft(apiRequests.slice(apiCountBeforeCapabilityChecks)).toEqual([
          { authorization: 'Bearer fixture-concurrent-token-b', cookie: undefined, url: '/comfy/system_stats' },
          { authorization: 'Bearer fixture-concurrent-token-b', cookie: undefined, url: '/comfy/system_stats' },
          { authorization: 'Bearer fixture-second-frame-token', cookie: undefined, url: '/comfy/system_stats' },
          { authorization: 'Bearer fixture-other-target-token', cookie: undefined, url: '/other/system_stats' },
          { authorization: undefined, cookie: undefined, url: '/comfy/system_stats' },
        ])

        const malformedCases = [
          { label: 'malformed JSON', body: '{not-json', expectedStatus: 400 },
          { label: 'invalid credential type', body: JSON.stringify({ bearerToken: 42 }), expectedStatus: 400 },
          { label: 'oversized payload', body: `{"password":"${'x'.repeat(17 * 1024)}"}`, expectedStatus: 413 },
        ]
        for (const [index, malformedCase] of malformedCases.entries()) {
          const token = `fixture-before-${index}`
          const bootstrap = await rawRequest(port, authPath, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ bearerToken: token }),
          })
          const rejected = await rawRequest(port, authPath, {
            method: 'POST',
            headers: authHeaders,
            body: malformedCase.body,
          })
          const requestsBeforeProbe = apiRequests.length
          const probe = await rawRequest(port, proxyApiPath, { headers: frameApiHeaders })
          const forwardedAfterFailure = apiRequests.slice(requestsBeforeProbe)

          expect.soft(bootstrap.status, malformedCase.label).toBe(204)
          expect.soft(rejected.status, malformedCase.label).toBe(malformedCase.expectedStatus)
          expect.soft(probe.status, malformedCase.label).toBeGreaterThanOrEqual(400)
          expect.soft(
            forwardedAfterFailure.every((request) => request.authorization === undefined),
            malformedCase.label,
          ).toBe(true)
          expect.soft(JSON.stringify(forwardedAfterFailure), malformedCase.label).not.toContain(token)
        }
      } finally {
        if (runtime) await runtime.cleanup()
        await close(upstream)
      }
    },
    20_000,
  )
})
