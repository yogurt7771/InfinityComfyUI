import { expect, test, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const proxyTokenParameter = '__infinity_comfy_token'
const apiCredential = 'fixture_comfy_bearer_token_for_browser_test_only'
const legacyQueryFixture = 'fixture_legacy_query_value_for_canonicalization_only'

type ObservedRequest = {
  authorization?: string
  url: string
}

type BrowserUrlAudit = {
  historyUrls: string[]
  openedUrls: string[]
}

type IsolationAudit = {
  ownIndexedDb: boolean
  parentDocumentBlocked: boolean
  parentIndexedDbBlocked: boolean
  parentPreloadBridgeBlocked: boolean
}

declare global {
  interface Window {
    __credentialUrlAudit?: BrowserUrlAudit
    __isolationAudit?: IsolationAudit
    infinityComfyUIStorage?: unknown
  }
}

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
    if (child.exitCode !== null) throw new Error(`Vite exited before becoming ready (${child.exitCode})`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch (error) {
      if (attempt === 79) throw error
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  throw new Error('Vite did not become ready')
}

const stopChild = async (child: ChildProcess) => {
  if (child.exitCode !== null) return
  child.kill()
  await Promise.race([once(child, 'exit'), new Promise((resolveWait) => setTimeout(resolveWait, 2000))])
}

const installBrowserUrlAudit = async (page: Page) => {
  await page.addInitScript(() => {
    const audit: BrowserUrlAudit = { historyUrls: [], openedUrls: [] }
    window.__credentialUrlAudit = audit

    const absoluteUrl = (value: unknown) => {
      if (value === undefined || value === null || value === '') return window.location.href
      try {
        return new URL(String(value), window.location.href).href
      } catch {
        return String(value)
      }
    }

    const pushState = window.history.pushState.bind(window.history)
    window.history.pushState = ((state: unknown, unused: string, url?: string | URL | null) => {
      audit.historyUrls.push(absoluteUrl(url))
      return pushState(state, unused, url)
    }) as History['pushState']

    const replaceState = window.history.replaceState.bind(window.history)
    window.history.replaceState = ((state: unknown, unused: string, url?: string | URL | null) => {
      audit.historyUrls.push(absoluteUrl(url))
      return replaceState(state, unused, url)
    }) as History['replaceState']

    const open = window.open.bind(window)
    window.open = ((url?: string | URL, target?: string, features?: string) => {
      audit.openedUrls.push(absoluteUrl(url))
      return open(url, target, features)
    }) as typeof window.open
  })
}

const attachComfyFrame = async (
  page: Page,
  src: string,
  options: { sandbox?: string; title?: string } = {},
) => {
  await page.evaluate(({ frameOptions, frameSource }) => {
    const frame = document.createElement('iframe')
    frame.title = frameOptions.title ?? 'Configured ComfyUI proxy'
    if (frameOptions.sandbox) frame.setAttribute('sandbox', frameOptions.sandbox)
    frame.src = frameSource
    document.body.append(frame)
  }, { frameOptions: options, frameSource: src })
  const frame = page.getByTitle(options.title ?? 'Configured ComfyUI proxy')
  await expect(frame).toBeVisible()
  return frame
}

test.describe('ComfyUI proxy credential secrecy', () => {
  test.describe.configure({ mode: 'serial' })

  const observedRequests: ObservedRequest[] = []
  const upstream = createServer((request, response) => {
    observedRequests.push({ authorization: request.headers.authorization, url: request.url ?? '/' })
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')

    if (requestUrl.pathname === '/comfy/') {
      response.statusCode = 200
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(`<!doctype html>
        <html><body>
          <span id="status">Mock ComfyUI authenticated UI</span>
          <script>
            const blocked = (read) => { try { read(); return false; } catch { return true; } };
            window.__isolationAudit = {
              ownIndexedDb: typeof indexedDB === 'object',
              parentDocumentBlocked: blocked(() => parent.document.body),
              parentIndexedDbBlocked: blocked(() => parent.indexedDB),
              parentPreloadBridgeBlocked: blocked(() => parent.infinityComfyUIStorage)
            };
            window.app = { graphToPrompt: async () => ({ output: {}, workflow: { nodes: [], links: [] } }) };
            Promise.all([
              fetch('system_stats').then((response) => response.json()),
              fetch('redirect').then((response) => response.json())
            ]).then(() => document.body.dataset.apiReady = 'true');
          </script>
        </body></html>`)
      return
    }
    if (requestUrl.pathname === '/comfy/redirect') {
      response.statusCode = 302
      response.setHeader('location', '/comfy/redirected')
      response.end()
      return
    }
    response.statusCode = 200
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ ok: true }))
  })

  let upstreamPort = 0
  let appPort = 0
  let appServer: ChildProcess
  let tempRoot = ''

  test.beforeAll(async () => {
    upstreamPort = await listenOnLoopback(upstream)
    appPort = await reserveLoopbackPort()
    const workspaceRoot = process.cwd()
    tempRoot = mkdtempSync(join(tmpdir(), 'infinity-credential-security-'))
    const distDir = join(tempRoot, 'dist')
    mkdirSync(distDir)
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>Infinity ComfyUI security test</title>', 'utf8')
    appServer = spawn(
      process.execPath,
      [resolve(workspaceRoot, 'server/serve.mjs')],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          HOST: '0.0.0.0',
          PORT: String(appPort),
          DIST_DIR: distDir,
          COMFY_PROXY_BEARER_TOKEN: '',
          COMFY_PROXY_TARGET_BASE: `http://127.0.0.1:${upstreamPort}/comfy`,
          COMFY_PROXY_TARGET_BASES: '',
          COMFY_PROXY_TOKEN_FILE: '',
          COMFY_PROXY_APP_ORIGINS: JSON.stringify([
            `http://127.0.0.1:${appPort}`,
          ]),
        },
        stdio: 'ignore',
      },
    )
    await waitForServer(`http://127.0.0.1:${appPort}/`, appServer)
  })

  test.afterAll(async () => {
    await stopChild(appServer)
    await closeServer(upstream)
    rmSync(tempRoot, { recursive: true, force: true })
  })

  test.beforeEach(() => {
    observedRequests.length = 0
  })

  test('opens a token-authenticated ComfyUI without putting the credential in browser-visible URLs', async ({ page }) => {
    const appOrigin = `http://127.0.0.1:${appPort}`
    const targetBaseUrl = `http://127.0.0.1:${upstreamPort}/comfy`
    const requestedUrls: string[] = []
    const navigatedUrls: string[] = []
    page.on('request', (request) => requestedUrls.push(request.url()))
    page.on('framenavigated', (frame) => navigatedUrls.push(frame.url()))
    await installBrowserUrlAudit(page)

    await page.goto(appOrigin)
    const authUrl = `/__comfy_proxy/auth/${encodeURIComponent(targetBaseUrl)}`
    const authStatus = await page.evaluate(
      async ({ bearerToken, url }) =>
        (
          await fetch(url, {
            method: 'POST',
            cache: 'no-store',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bearerToken }),
          })
        ).status,
      { bearerToken: apiCredential, url: authUrl },
    )
    expect(authStatus).toBe(204)
    expect(authUrl).not.toContain(apiCredential)
    const configuredProxyUrl = `/__comfy_proxy/${encodeURIComponent(targetBaseUrl)}/`
    const apiStatus = await page.evaluate(
      async (url) => (await fetch(url, { headers: { Accept: 'application/json' } })).status,
      `/__comfy_proxy/${encodeURIComponent(targetBaseUrl)}/system_stats`,
    )
    expect(apiStatus).toBe(200)
    const frame = await attachComfyFrame(page, configuredProxyUrl)
    await expect
      .poll(() => observedRequests.some((request) => request.url.startsWith('/comfy/system_stats')))
      .toBe(true)

    const childFrame = await (await frame.elementHandle())?.contentFrame()
    if (!childFrame) throw new Error('configured ComfyUI frame did not attach')
    const frameUrl = childFrame.url()
    const frameSource = (await frame.getAttribute('src')) ?? ''
    const mainAudit = await page.evaluate(() => window.__credentialUrlAudit ?? { historyUrls: [], openedUrls: [] })
    const frameAudit = await childFrame.evaluate(() =>
      window.__credentialUrlAudit ?? { historyUrls: [], openedUrls: [] },
    )
    const performanceUrls = await page.evaluate(() =>
      performance.getEntriesByType('resource').map((entry) => (entry as PerformanceResourceTiming).name),
    )
    const sessionState = await page.evaluate(() => ({
      localStorage: Object.entries(localStorage),
      sessionStorage: Object.entries(sessionStorage),
    }))
    const urlSurfaces = [
      page.url(),
      frameSource,
      frameUrl,
      ...requestedUrls,
      ...navigatedUrls,
      ...performanceUrls,
      ...mainAudit.historyUrls,
      ...mainAudit.openedUrls,
      ...frameAudit.historyUrls,
      ...frameAudit.openedUrls,
    ]
    const leakedUrlSurfaces = urlSurfaces.filter(
      (value) => value.includes(apiCredential) || value.includes(proxyTokenParameter),
    )

    expect(observedRequests).toContainEqual(
      expect.objectContaining({ authorization: `Bearer ${apiCredential}`, url: '/comfy/system_stats' }),
    )
    expect.soft(leakedUrlSurfaces, 'credential-bearing browser-visible URLs').toEqual([])
    expect.soft(await page.locator('body').innerText()).not.toContain(apiCredential)
    expect.soft(await childFrame.locator('body').innerText()).not.toContain(apiCredential)
    expect.soft(JSON.stringify(sessionState)).not.toContain(apiCredential)
  })

  test('keeps ordinary no-credential ComfyUI proxy navigation unchanged', async ({ page }) => {
    const appOrigin = `http://127.0.0.1:${appPort}`
    const targetBaseUrl = `http://127.0.0.1:${upstreamPort}/comfy`
    await page.goto(appOrigin)
    const frame = await attachComfyFrame(page, `/__comfy_proxy/${encodeURIComponent(targetBaseUrl)}/`)

    await expect(frame).toHaveAttribute('src', `/__comfy_proxy/${encodeURIComponent(targetBaseUrl)}/`)
    await expect
      .poll(() => observedRequests.find((request) => request.url === '/comfy/system_stats')?.authorization)
      .toBeUndefined()
    expect((await frame.getAttribute('src')) ?? '').not.toContain(proxyTokenParameter)
  })

  test('initializes token and no-token editors on a storage-capable origin isolated from the Infinity parent', async ({
    page,
  }) => {
    const parentOrigin = `http://127.0.0.1:${appPort}`
    const targetBaseUrl = `http://127.0.0.1:${upstreamPort}/comfy`
    const requestedUrls: string[] = []
    const failedRequests: Array<{ error?: string; url: string }> = []
    const authResponses: Array<{ allowCredentials?: string; allowOrigin?: string; status: number; url: string }> = []
    const consoleMessages: string[] = []
    page.on('request', (request) => requestedUrls.push(request.url()))
    page.on('requestfailed', (request) => failedRequests.push({ error: request.failure()?.errorText, url: request.url() }))
    page.on('response', (response) => {
      if (!response.url().includes('/__comfy_proxy/auth/')) return
      authResponses.push({
        allowCredentials: response.headers()['access-control-allow-credentials'],
        allowOrigin: response.headers()['access-control-allow-origin'],
        status: response.status(),
        url: response.url(),
      })
    })
    page.on('console', (message) => consoleMessages.push(message.text()))
    await installBrowserUrlAudit(page)
    await page.goto(parentOrigin)
    await page.evaluate(() => {
      window.infinityComfyUIStorage = { fixture: 'parent preload bridge' }
    })

    for (const [label, token] of [
      ['no-token', undefined],
      ['token', `fixture-isolated-browser-token-${Date.now()}`],
    ] as const) {
      observedRequests.length = 0
      const isolatedOrigin = `http://frame-${randomUUID().replaceAll('-', '')}.localhost:${appPort}`
      const authEndpoint = `${isolatedOrigin}/__comfy_proxy/auth/${encodeURIComponent(targetBaseUrl)}`
      const authResult = await page.evaluate(
        async ({ bearerToken, url }) => {
          try {
            const response = await fetch(url, {
              method: 'POST',
              cache: 'no-store',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(bearerToken ? { bearerToken } : {}),
            })
            return { status: response.status }
          } catch (error) {
            return { error: String(error), status: 0 }
          }
        },
        { bearerToken: token, url: authEndpoint },
      )
      const frameSource = `${isolatedOrigin}/__comfy_proxy/${encodeURIComponent(targetBaseUrl)}/`
      const frame = await attachComfyFrame(page, frameSource, {
        sandbox: 'allow-scripts allow-same-origin allow-forms allow-downloads',
        title: `Isolated ComfyUI ${label}`,
      })
      await page.waitForTimeout(500)
      const childFrame = await (await frame.elementHandle())?.contentFrame()
      if (!childFrame) throw new Error(`isolated ${label} frame did not attach`)
      const isolationAudit = await childFrame.evaluate(() => window.__isolationAudit)
      const frameAudit = await childFrame.evaluate(() =>
        window.__credentialUrlAudit ?? { historyUrls: [], openedUrls: [] },
      )
      const frameResources = await childFrame.evaluate(() =>
        performance.getEntriesByType('resource').map((entry) => entry.name),
      )
      const expectedAuthorization = token ? `Bearer ${token}` : undefined

      expect.soft(
        authResult.status,
        `${label} isolated auth${authResult.error ? `: ${authResult.error}` : ''}; failures=${JSON.stringify(failedRequests)}; responses=${JSON.stringify(authResponses)}; console=${JSON.stringify(consoleMessages)}`,
      ).toBe(204)
      expect.soft(new URL(childFrame.url()).origin).toBe(isolatedOrigin)
      expect.soft(new URL(childFrame.url()).origin).not.toBe(parentOrigin)
      expect.soft(isolationAudit).toEqual({
        ownIndexedDb: true,
        parentDocumentBlocked: true,
        parentIndexedDbBlocked: true,
        parentPreloadBridgeBlocked: true,
      })
      expect.soft(observedRequests.find((entry) => entry.url === '/comfy/system_stats')?.authorization).toBe(
        expectedAuthorization,
      )
      const browserVisibleArtifacts = JSON.stringify({
        authEndpoint,
        consoleMessages,
        dom: await page.locator('html').innerHTML(),
        frameHistory: [...frameAudit.historyUrls, ...frameAudit.openedUrls],
        frameResources,
        frameSource,
        requestedUrls,
      })
      if (token) expect.soft(browserVisibleArtifacts).not.toContain(token)
      expect.soft(browserVisibleArtifacts).not.toContain(proxyTokenParameter)
      await frame.evaluate((element) => element.remove())
    }
  })

  test('canonicalizes a legacy token entry without forwarding or retaining it in downstream browser URLs', async ({
    page,
  }) => {
    const appOrigin = `http://127.0.0.1:${appPort}`
    const targetBaseUrl = `http://127.0.0.1:${upstreamPort}/comfy`
    const proxyPath = `/__comfy_proxy/${encodeURIComponent(targetBaseUrl)}/`
    const legacyEntry = `${proxyPath}?${proxyTokenParameter}=${encodeURIComponent(legacyQueryFixture)}`
    const requestedUrls: string[] = []
    const navigatedUrls: string[] = []
    page.on('request', (request) => requestedUrls.push(request.url()))
    page.on('framenavigated', (frame) => navigatedUrls.push(frame.url()))
    await installBrowserUrlAudit(page)

    await page.goto(appOrigin)
    const frame = await attachComfyFrame(page, legacyEntry)
    await expect.poll(() => observedRequests.some((request) => request.url === '/comfy/system_stats')).toBe(true)
    const childFrame = await (await frame.elementHandle())?.contentFrame()
    if (!childFrame) throw new Error('legacy ComfyUI frame did not attach')
    const canonicalUrl = new URL(proxyPath, appOrigin).href
    const legacyAbsoluteUrl = new URL(legacyEntry, appOrigin).href
    const frameAudit = await childFrame.evaluate(() =>
      window.__credentialUrlAudit ?? { historyUrls: [], openedUrls: [] },
    )
    const framePerformanceUrls = await childFrame.evaluate(() =>
      performance.getEntriesByType('resource').map((entry) => (entry as PerformanceResourceTiming).name),
    )
    const downstreamProxyUrls = [...requestedUrls, ...navigatedUrls]
      .filter((url) => url.includes('/__comfy_proxy/'))
      .filter((url) => url !== legacyAbsoluteUrl)

    expect.soft(childFrame.url()).toBe(canonicalUrl)
    expect.soft(downstreamProxyUrls.some((url) => url.includes(proxyTokenParameter))).toBe(false)
    expect.soft(framePerformanceUrls.some((url) => url.includes(proxyTokenParameter))).toBe(false)
    expect.soft([...frameAudit.historyUrls, ...frameAudit.openedUrls].some((url) => url.includes(proxyTokenParameter))).toBe(
      false,
    )
    expect.soft(observedRequests.some((request) => request.url.includes(proxyTokenParameter))).toBe(false)
    expect.soft(observedRequests.some((request) => request.authorization?.includes(legacyQueryFixture))).toBe(false)
  })
})
