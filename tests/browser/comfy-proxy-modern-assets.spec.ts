import { expect, test, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'

type RuntimeKind = 'production server' | 'Vite dev proxy' | 'Electron proxy'
type ObservedRequest = { authorization?: string; url: string }

const workspaceRoot = resolve(process.cwd())

const listen = (server: Server) =>
  new Promise<number>((resolvePort, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolvePort((server.address() as AddressInfo).port)
    })
  })

const closeServer = (server: Server) =>
  new Promise<void>((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())))

const reservePort = async () => {
  const server = createServer()
  const port = await listen(server)
  await closeServer(server)
  return port
}

const rawHttpRequest = (origin: string, path: string, headers: Record<string, string>) =>
  new Promise<{ headers: IncomingHttpHeaders; status: number }>((resolveResponse) => {
    const target = new URL(origin)
    let settled = false
    const finish = (status = 0, responseHeaders: IncomingHttpHeaders = {}) => {
      if (settled) return
      settled = true
      resolveResponse({ headers: responseHeaders, status })
    }
    const request = httpRequest(
      {
        host: target.hostname,
        port: Number(target.port),
        path,
        headers: { Host: target.host, ...headers },
      },
      (response) => {
        response.resume()
        response.on('end', () => finish(response.statusCode ?? 0, response.headers))
      },
    )
    request.setTimeout(1500, () => {
      request.destroy()
      finish()
    })
    request.on('error', () => finish())
    request.end()
  })

const stopChild = async (child: ChildProcess) => {
  if (child.exitCode !== null) return
  child.kill()
  await Promise.race([once(child, 'exit'), new Promise((resolveWait) => setTimeout(resolveWait, 2000))])
}

const waitForHttp = async (origin: string, child: ChildProcess) => {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`proxy exited before startup (${child.exitCode})`)
    try {
      const response = await fetch(origin)
      if (response.ok) return
    } catch (error) {
      if (attempt === 239) throw error
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  throw new Error('proxy did not start')
}

const waitForElectronOrigin = async (urlFile: string, child: ChildProcess) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Electron proxy exited before startup (${child.exitCode})`)
    if (existsSync(urlFile)) return readFileSync(urlFile, 'utf8').trim().replace(/\/$/, '')
    await new Promise((resolveWait) => setTimeout(resolveWait, 25))
  }
  throw new Error('Electron proxy did not publish its app origin')
}

const modernEntrySource = `
const dispatchPreloadError = (error) => {
  const event = new Event('vite:preloadError', { cancelable: true });
  event.payload = error;
  window.dispatchEvent(event);
  if (!event.defaultPrevented) throw error;
};
const preload = async (loader, dependencies) => {
  try {
    await Promise.all(dependencies.map((href) => new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'modulepreload';
      link.href = href;
      link.onload = resolve;
      link.onerror = () => reject(new Error('preload failed: ' + href));
      document.head.append(link);
    })));
    return await loader();
  } catch (error) {
    return dispatchPreloadError(error);
  }
};
try {
  const relativeModule = await import('./relative.js');
  const absoluteModule = await preload(() => import('/comfy/assets/absolute.js'), ['/comfy/assets/preloaded.js']);
  const stats = await fetch('./system_stats').then((response) => response.json());
  window.app = {};
  window.comfyAPI = { app: { app: { graphToPrompt: async () => ({ output: {}, workflow: {} }) } } };
  document.querySelector('#startup-overlay').hidden = true;
  const editor = document.querySelector('#actual-editor');
  editor.hidden = false;
  editor.textContent = [relativeModule.label, absoluteModule.label, stats.ready].join(':');
} catch (error) {
  document.querySelector('#startup-overlay').dataset.error = String(error);
  throw error;
}
`

const modernUpstream = () => {
  const requests: ObservedRequest[] = []
  const server = createServer((request, response) => {
    const url = request.url ?? '/'
    const requestUrl = new URL(url, 'http://127.0.0.1')
    requests.push({ authorization: request.headers.authorization, url })
    if (requestUrl.pathname === '/comfy/' || requestUrl.pathname === '/comfy') {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(`<!doctype html><html><head><link rel="modulepreload" href="/comfy/assets/preloaded.js"></head><body><div id="startup-overlay">Starting modern ComfyUI</div><main id="actual-editor" hidden></main><script type="module" src="./assets/entry.js"></script></body></html>`)
      return
    }
    if (url === '/comfy/assets/entry.js') {
      response.setHeader('content-type', 'text/javascript; charset=utf-8')
      response.end(modernEntrySource)
      return
    }
    if (url === '/comfy/assets/relative.js') {
      response.setHeader('content-type', 'text/javascript; charset=utf-8')
      response.end(`export const label = 'relative';`)
      return
    }
    if (url === '/comfy/assets/absolute.js') {
      response.setHeader('content-type', 'text/javascript; charset=utf-8')
      response.end(`export const label = 'absolute';`)
      return
    }
    if (url === '/comfy/assets/preloaded.js') {
      response.setHeader('content-type', 'text/javascript; charset=utf-8')
      response.end(`export const preloaded = true;`)
      return
    }
    if (url === '/comfy/system_stats') {
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end('{"ready":true}')
      return
    }
    response.statusCode = 404
    response.end('not found')
  })
  return { requests, server }
}

const deepExtensionUpstream = () => {
  const requests: ObservedRequest[] = []
  const server = createServer((request, response) => {
    const url = request.url ?? '/'
    const requestUrl = new URL(url, 'http://127.0.0.1')
    requests.push({ authorization: request.headers.authorization, url })
    if (requestUrl.pathname === '/comfy/' || requestUrl.pathname === '/comfy') {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(
        '<!doctype html><html><head></head><body><div id="startup-overlay">Starting extension</div><main id="actual-editor" hidden></main><script type="module" src="./assets/deep-entry.js"></script></body></html>',
      )
      return
    }
    if (requestUrl.pathname === '/comfy/assets/deep-entry.js') {
      response.setHeader('content-type', 'text/javascript; charset=utf-8')
      response.end(`
try {
  const extension = await import('../extensions/demo/extension.js');
  const xhrReady = new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/comfy/api?transport=xhr');
    xhr.onload = resolve;
    xhr.onerror = reject;
    xhr.send();
  });
  const websocketReady = new Promise((resolve, reject) => {
    const url = new URL('/comfy/api?transport=ws', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    socket.onopen = () => { socket.close(); resolve(); };
    socket.onerror = reject;
  });
  await Promise.all([fetch('/comfy/api?transport=fetch'), xhrReady, websocketReady]);
  const stats = await fetch('./system_stats').then((result) => result.json());
  window.comfyAPI = { app: { app: extension.app } };
  document.querySelector('#startup-overlay').hidden = true;
  const editor = document.querySelector('#actual-editor');
  editor.hidden = false;
  editor.textContent = extension.app.label + ':' + stats.ready;
} catch (error) {
  const event = new Event('vite:preloadError', { cancelable: true });
  event.payload = error;
  window.dispatchEvent(event);
  document.querySelector('#startup-overlay').dataset.error = String(error);
  throw error;
}
`)
      return
    }
    if (requestUrl.pathname === '/comfy/extensions/demo/extension.js') {
      response.setHeader('content-type', 'text/javascript; charset=utf-8')
      response.end(`import { app } from '../../../scripts/app.js'; export { app };`)
      return
    }
    if (requestUrl.pathname === '/comfy/scripts/app.js') {
      response.setHeader('content-type', 'text/javascript; charset=utf-8')
      response.end(`export const app = { label: 'deep-target', graphToPrompt: async () => ({ output: {}, workflow: {} }) };`)
      return
    }
    if (requestUrl.pathname === '/comfy/api') {
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end('{"bridge":true}')
      return
    }
    if (requestUrl.pathname === '/comfy/system_stats') {
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end('{"ready":true}')
      return
    }
    response.statusCode = 404
    response.end('not found')
  })
  server.on('upgrade', (request, socket) => {
    requests.push({ authorization: request.headers.authorization, url: request.url ?? '/' })
    const websocketKey = request.headers['sec-websocket-key']
    if (typeof websocketKey !== 'string') {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      return
    }
    const websocketAccept = createHash('sha1')
      .update(`${websocketKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64')
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${websocketAccept}\r\n\r\n`,
    )
    socket.once('data', () => socket.end())
  })
  return { requests, server }
}

const serviceWorkerUpstream = () => {
  const requests: ObservedRequest[] = []
  const server = createServer((request, response) => {
    const url = request.url ?? '/'
    const requestUrl = new URL(url, 'http://127.0.0.1')
    requests.push({ authorization: request.headers.authorization, url })
    if (requestUrl.pathname === '/comfy/' || requestUrl.pathname === '/comfy') {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(`<!doctype html><html><head></head><body><main id="service-worker-status">registering</main><script>
const serviceWorkerResult = { settled: false, registrations: {} };
window.__serviceWorkerResult = serviceWorkerResult;
const recordRegistration = async (label, scriptUrl, options) => {
  try {
    const registration = options === undefined
      ? await navigator.serviceWorker.register(scriptUrl)
      : await navigator.serviceWorker.register(scriptUrl, options);
    const worker = registration.installing || registration.waiting || registration.active;
    serviceWorkerResult.registrations[label] = {
      scope: registration.scope,
      scriptUrl: worker ? worker.scriptURL : null,
    };
  } catch (error) {
    serviceWorkerResult.registrations[label] = { error: String(error) };
  }
};
const blobUrl = URL.createObjectURL(new Blob(['self.addEventListener("fetch", () => {});'], { type: 'text/javascript' }));
Promise.all([
  recordRegistration('root', '/root-service-worker.js'),
  recordRegistration('sameOrigin', new URL('/comfy/scoped-service-worker.js', location.origin).href, { scope: '/comfy/custom-scope/' }),
  recordRegistration('alreadyProxied', location.pathname + 'existing-service-worker.js', { scope: location.pathname + 'existing-scope/' }),
  recordRegistration('data', 'data:text/javascript,self.addEventListener("fetch",()=>{})'),
  recordRegistration('blob', blobUrl),
  recordRegistration('external', 'https://foreign.invalid/service-worker.js'),
  recordRegistration('protocolRelativeExternal', '//foreign.invalid/protocol-relative-service-worker.js', { scope: '//foreign.invalid/protocol-relative-scope/' }),
]).finally(() => {
  URL.revokeObjectURL(blobUrl);
  serviceWorkerResult.settled = true;
  document.querySelector('#service-worker-status').textContent = 'settled';
});
</script></body></html>`)
      return
    }
    if (
      requestUrl.pathname === '/comfy/root-service-worker.js' ||
      requestUrl.pathname === '/comfy/scoped-service-worker.js' ||
      requestUrl.pathname === '/comfy/existing-service-worker.js'
    ) {
      response.setHeader('content-type', 'text/javascript; charset=utf-8')
      response.end(`self.addEventListener('install', () => self.skipWaiting());`)
      return
    }
    response.statusCode = 404
    response.end('not found')
  })
  return { requests, server }
}

const startRuntime = async (kind: RuntimeKind, mainTarget: string, options: { appOrigins?: string } = {}) => {
  const port = await reservePort()
  const tempRoot = mkdtempSync(join(tmpdir(), 'infinity-modern-assets-'))
  const baseEnv = {
    ...process.env,
    COMFY_PROXY_BEARER_TOKEN: '',
    COMFY_PROXY_TARGET_BASE: mainTarget,
    COMFY_PROXY_TARGET_BASES: '',
    COMFY_PROXY_TOKEN_FILE: '',
    COMFY_PROXY_APP_ORIGINS: options.appOrigins ?? '',
  }
  let child: ChildProcess
  let origin: string

  if (kind === 'production server') {
    const distDir = join(tempRoot, 'dist')
    mkdirSync(distDir)
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>proxy host</title>', 'utf8')
    child = spawn(process.execPath, [join(workspaceRoot, 'server', 'serve.mjs')], {
      cwd: workspaceRoot,
      env: { ...baseEnv, HOST: '127.0.0.1', PORT: String(port), DIST_DIR: distDir },
      stdio: 'ignore',
    })
    origin = `http://127.0.0.1:${port}`
    await waitForHttp(origin, child)
  } else if (kind === 'Vite dev proxy') {
    child = spawn(
      process.execPath,
      [join(workspaceRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      { cwd: workspaceRoot, env: baseEnv, stdio: 'ignore' },
    )
    origin = `http://127.0.0.1:${port}`
    await waitForHttp(origin, child)
  } else {
    const urlFile = join(tempRoot, 'electron-url.txt')
    child = spawn(process.execPath, [join(workspaceRoot, 'electron', 'main.cjs')], {
      cwd: workspaceRoot,
      env: {
        ...baseEnv,
        NODE_OPTIONS: `--require=${join(workspaceRoot, 'tests', 'fixtures', 'electron-runtime-stub.cjs')}`,
        INFINITY_ELECTRON_TEST_URL_FILE: urlFile,
      },
      stdio: 'ignore',
    })
    origin = await waitForElectronOrigin(urlFile, child)
  }

  return {
    child,
    origin,
    tempRoot,
    stop: async () => {
      await stopChild(child)
      rmSync(tempRoot, { recursive: true, force: true })
    },
  }
}

const proxyBase = (origin: string, targetBase: string) =>
  `${origin}/__comfy_proxy/${encodeURIComponent(targetBase)}/`

const authUrl = (origin: string, targetBase: string) =>
  `${origin}/__comfy_proxy/auth/${encodeURIComponent(targetBase)}`

const embeddedProxyFrame = async (page: Page, source: string) => {
  await page.evaluate((frameSource) => {
    const iframe = document.createElement('iframe')
    iframe.id = 'modern-comfy-frame'
    iframe.src = frameSource
    document.body.append(iframe)
  }, source)
  await page.locator('#modern-comfy-frame').waitFor()
  await page.waitForTimeout(1600)
  return page.frames().find((candidate) => candidate !== page.mainFrame() && candidate.url().startsWith(source))
}

const openSameOriginHarness = async (page: Page, origin: string) => {
  const harnessUrl = `${origin}/__comfy_proxy_test_harness__`
  await page.route(harnessUrl, (route) =>
    route.fulfill({ body: '<!doctype html><title>proxy harness</title>', contentType: 'text/html', status: 200 }),
  )
  await page.goto(harnessUrl, { waitUntil: 'domcontentloaded' })
}

const exerciseFrameBridge = async (page: Page, frameOrigin: string) =>
  page.evaluate(async ({ expectedOrigin }) => {
    const channel = 'infinity-comfy-editor-v1'
    const frameWindow = (document.querySelector('#modern-comfy-frame') as HTMLIFrameElement | null)?.contentWindow
    if (!frameWindow) throw new Error('ComfyUI frame is unavailable')
    let sequence = 0
    const send = (command: 'ping' | 'export') =>
      new Promise<{ error?: string; payload?: { ready?: boolean; rawJson?: unknown; uiJson?: unknown } }>(
        (resolveResponse, reject) => {
          const id = `fixture-frame-bridge-${sequence++}`
          const timeout = window.setTimeout(() => reject(new Error(`Frame bridge ${command} timed out`)), 2000)
          const onMessage = (event: MessageEvent) => {
            const message = event.data as {
              channel?: string
              type?: string
              id?: string
              error?: string
              payload?: { ready?: boolean; rawJson?: unknown; uiJson?: unknown }
            }
            if (
              event.source !== frameWindow ||
              event.origin !== expectedOrigin ||
              message.channel !== channel ||
              message.type !== 'response' ||
              message.id !== id
            ) {
              return
            }
            window.clearTimeout(timeout)
            window.removeEventListener('message', onMessage)
            resolveResponse(message)
          }
          window.addEventListener('message', onMessage)
          frameWindow.postMessage({ channel, type: 'request', id, command }, expectedOrigin)
        },
      )

    const ping = await send('ping')
    return { exported: await send('export'), ping }
  }, { expectedOrigin: frameOrigin })

test.describe.configure({ mode: 'serial' })

for (const kind of ['production server', 'Vite dev proxy', 'Electron proxy'] as const) {
  test(`${kind} loads modern ComfyUI entry, preload, and dynamic chunks inside the proxy subpath`, async ({ page }) => {
    const upstream = modernUpstream()
    const upstreamPort = await listen(upstream.server)
    const targetBase = `http://127.0.0.1:${upstreamPort}/comfy`
    const runtime = await startRuntime(kind, targetBase)
    const sessionToken = `fixture-modern-assets-session-${Date.now()}-${kind.replaceAll(' ', '-')}`
    const browserRequestUrls: string[] = []
    const consoleMessages: string[] = []
    const pageErrors: string[] = []
    page.on('request', (request) => browserRequestUrls.push(request.url()))
    page.on('console', (message) => consoleMessages.push(message.text()))
    page.on('pageerror', (error) => pageErrors.push(error.message))

    try {
      await page.addInitScript(() => {
        const state = window as Window & { __preloadErrors?: string[] }
        state.__preloadErrors = []
        window.addEventListener('vite:preloadError', (event) => {
          const payload = (event as Event & { payload?: unknown }).payload
          state.__preloadErrors?.push(String(payload ?? 'vite:preloadError'))
        })
      })
      const authResponse = await page.context().request.post(authUrl(runtime.origin, targetBase), {
        data: { bearerToken: sessionToken },
        headers: { Origin: runtime.origin },
      })
      expect(authResponse.status()).toBe(204)

      await page.goto(runtime.origin, { waitUntil: 'domcontentloaded' })
      const source = proxyBase(runtime.origin, targetBase)
      const frame = await embeddedProxyFrame(page, source)
      expect(frame).toBeDefined()
      if (!frame) return

      const frameState = await frame.evaluate(() => {
        const state = window as Window & { __preloadErrors?: string[]; app?: unknown }
        return {
          historyState: history.state,
          location: location.href,
          preloadErrors: state.__preloadErrors ?? [],
          resources: performance.getEntriesByType('resource').map((entry) => entry.name),
        }
      })
      const paths = upstream.requests.map((request) => request.url)
      const editorVisible = await frame.locator('#actual-editor').isVisible()
      const overlayVisible = await frame.locator('#startup-overlay').isVisible()
      const bridge = await exerciseFrameBridge(page, new URL(source).origin)

      expect.soft(paths).toContain('/comfy/assets/entry.js')
      expect.soft(paths).toContain('/comfy/assets/relative.js')
      expect.soft(paths).toContain('/comfy/assets/preloaded.js')
      expect.soft(paths).toContain('/comfy/assets/absolute.js')
      expect.soft(paths).toContain('/comfy/system_stats')
      expect.soft(frameState.preloadErrors).toEqual([])
      expect.soft(pageErrors).toEqual([])
      expect.soft(editorVisible).toBe(true)
      expect.soft(overlayVisible).toBe(false)
      expect.soft(bridge.ping.error).toBeUndefined()
      expect.soft(bridge.ping.payload?.ready).toBe(true)
      expect.soft(bridge.exported.error).toBeUndefined()
      expect.soft(bridge.exported.payload).toEqual({ rawJson: {}, uiJson: {} })
      expect.soft(upstream.requests.find((request) => request.url === '/comfy/system_stats')?.authorization).toBe(
        `Bearer ${sessionToken}`,
      )

      const browserVisibleArtifacts = JSON.stringify({
        browserRequestUrls,
        consoleMessages,
        frameState,
        mainLocation: page.url(),
      })
      expect.soft(browserVisibleArtifacts).not.toContain(sessionToken)
      expect.soft(source).not.toContain(sessionToken)
    } finally {
      await runtime.stop()
      await closeServer(upstream.server)
    }
  })
}

for (const kind of ['production server', 'Vite dev proxy', 'Electron proxy'] as const) {
  test(`${kind} restores deep extension imports to their original authorized proxy target`, async ({ page }) => {
    const upstream = deepExtensionUpstream()
    const otherUpstream = deepExtensionUpstream()
    const upstreamPort = await listen(upstream.server)
    const otherUpstreamPort = await listen(otherUpstream.server)
    const targetBase = `http://127.0.0.1:${upstreamPort}/comfy`
    const otherTargetBase = `http://127.0.0.1:${otherUpstreamPort}/comfy`
    const runtime = await startRuntime(kind, targetBase)
    const sessionToken = `fixture-deep-extension-session-${Date.now()}-${kind.replaceAll(' ', '-')}`
    const browserRequestUrls: string[] = []
    const consoleMessages: string[] = []
    const pageErrors: string[] = []
    page.on('request', (request) => browserRequestUrls.push(request.url()))
    page.on('console', (message) => consoleMessages.push(message.text()))
    page.on('pageerror', (error) => pageErrors.push(error.message))

    try {
      await page.addInitScript(() => {
        const state = window as Window & { __preloadErrors?: string[] }
        state.__preloadErrors = []
        window.addEventListener('vite:preloadError', (event) => {
          const payload = (event as Event & { payload?: unknown }).payload
          state.__preloadErrors?.push(String(payload ?? 'vite:preloadError'))
        })
      })
      const authResponse = await page.context().request.post(authUrl(runtime.origin, targetBase), {
        data: { bearerToken: sessionToken },
        headers: { Origin: runtime.origin },
      })
      expect(authResponse.status()).toBe(204)
      const sessionCookie = (authResponse.headers()['set-cookie'] ?? '').split(';', 1)[0] ?? ''

      await openSameOriginHarness(page, runtime.origin)
      const source = proxyBase(runtime.origin, targetBase)
      const frame = await embeddedProxyFrame(page, source)
      expect(frame).toBeDefined()
      if (!frame) return

      const frameState = await frame.evaluate(() => {
        const state = window as Window & { __preloadErrors?: string[] }
        return {
          historyState: history.state,
          location: location.href,
          preloadErrors: state.__preloadErrors ?? [],
          resources: performance.getEntriesByType('resource').map((entry) => entry.name),
        }
      })
      const editorVisible = await frame.locator('#actual-editor').isVisible()
      const overlayVisible = await frame.locator('#startup-overlay').isVisible()
      const paths = upstream.requests.map((entry) => entry.url)
      const recoveredScriptLoads = paths.filter((path) => path === '/comfy/scripts/app.js').length

      const missingTargetPath = '/__comfy_proxy/scripts/app.js'
      const crossOriginResponse = await rawHttpRequest(runtime.origin, missingTargetPath, {
        Cookie: sessionCookie,
        Referer: `https://untrusted.invalid${new URL(source).pathname}extensions/demo/extension.js`,
        'Sec-Fetch-Site': 'cross-site',
      })
      const malformedResponse = await rawHttpRequest(runtime.origin, missingTargetPath, {
        Cookie: sessionCookie,
        Referer: `${runtime.origin}/__comfy_proxy/not-a-target/extensions/demo/extension.js`,
        'Sec-Fetch-Site': 'same-origin',
      })
      const otherTargetResponse = await rawHttpRequest(runtime.origin, missingTargetPath, {
        Cookie: sessionCookie,
        Referer: `${proxyBase(runtime.origin, otherTargetBase)}extensions/demo/extension.js`,
        'Sec-Fetch-Site': 'same-origin',
      })

      expect.soft(paths).toContain('/comfy/assets/deep-entry.js')
      expect.soft(paths).toContain('/comfy/extensions/demo/extension.js')
      expect.soft(paths).toContain('/comfy/scripts/app.js')
      expect.soft(paths).toContain('/comfy/system_stats')
      expect.soft(paths).toContain('/comfy/api?transport=fetch')
      expect.soft(paths).toContain('/comfy/api?transport=xhr')
      expect.soft(paths).toContain('/comfy/api?transport=ws')
      expect.soft(paths.some((path) => path.startsWith('/comfy/comfy/'))).toBe(false)
      expect.soft(frameState.preloadErrors).toEqual([])
      expect.soft(pageErrors).toEqual([])
      expect.soft(editorVisible).toBe(true)
      expect.soft(overlayVisible).toBe(false)
      expect.soft(upstream.requests.find((entry) => entry.url === '/comfy/system_stats')?.authorization).toBe(
        `Bearer ${sessionToken}`,
      )
      expect.soft(browserRequestUrls.some((url) => url.endsWith('/__comfy_proxy/scripts/app.js'))).toBe(true)

      for (const [label, response] of [
        ['cross-origin Referer', crossOriginResponse],
        ['malformed Referer', malformedResponse],
        ['other-target Referer', otherTargetResponse],
      ] as const) {
        expect.soft(response.status, label).not.toBe(200)
        expect.soft(response.status, label).not.toBe(307)
        expect.soft(JSON.stringify(response.headers), label).not.toContain(sessionToken)
      }
      expect.soft(upstream.requests.filter((entry) => entry.url === '/comfy/scripts/app.js')).toHaveLength(
        recoveredScriptLoads,
      )
      expect.soft(otherUpstream.requests).toEqual([])

      const browserVisibleArtifacts = JSON.stringify({
        browserRequestUrls,
        consoleMessages,
        frameState,
        mainLocation: page.url(),
      })
      expect.soft(browserVisibleArtifacts).not.toContain(sessionToken)
      expect.soft(source).not.toContain(sessionToken)
    } finally {
      await runtime.stop()
      await closeServer(upstream.server)
      await closeServer(otherUpstream.server)
    }
  })
}

test('production proxy registers Service Worker scripts and scopes directly under the isolated proxy path', async ({
  page,
}) => {
  const upstream = serviceWorkerUpstream()
  const upstreamPort = await listen(upstream.server)
  const targetBase = `http://127.0.0.1:${upstreamPort}/comfy`
  const runtime = await startRuntime('production server', targetBase)

  try {
    await page.addInitScript(() => {
      const state = window as Window & {
        __nativeServiceWorkerRegistrations?: Array<{ scope: string | null; scriptUrl: string }>
      }
      state.__nativeServiceWorkerRegistrations = []
      const serviceWorkerPrototype = Object.getPrototypeOf(navigator.serviceWorker) as ServiceWorkerContainer
      const nativeRegister = serviceWorkerPrototype.register
      serviceWorkerPrototype.register = function register(scriptUrl, options) {
        state.__nativeServiceWorkerRegistrations?.push({
          scope: options && Object.prototype.hasOwnProperty.call(options, 'scope') ? String(options.scope) : null,
          scriptUrl: String(scriptUrl),
        })
        return options === undefined
          ? nativeRegister.call(this, scriptUrl)
          : nativeRegister.call(this, scriptUrl, options)
      }
    })

    const source = proxyBase(runtime.origin, targetBase)
    await page.goto(source, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => {
      const state = window as Window & { __serviceWorkerResult?: { settled?: boolean } }
      return state.__serviceWorkerResult?.settled === true
    })

    const browserState = await page.evaluate(() => {
      const state = window as Window & {
        __nativeServiceWorkerRegistrations?: Array<{ scope: string | null; scriptUrl: string }>
        __serviceWorkerResult?: {
          registrations?: Record<string, { error?: string; scope?: string; scriptUrl?: string | null }>
        }
      }
      return {
        nativeCalls: state.__nativeServiceWorkerRegistrations ?? [],
        registrations: state.__serviceWorkerResult?.registrations ?? {},
      }
    })
    const legacyProxyPathname = new URL(source).pathname
    expect([
      browserState.registrations.root,
      browserState.registrations.sameOrigin,
      browserState.registrations.alreadyProxied,
    ]).toEqual([
      expect.objectContaining({ scope: expect.any(String), scriptUrl: expect.any(String) }),
      expect.objectContaining({ scope: expect.any(String), scriptUrl: expect.any(String) }),
      expect.objectContaining({ scope: expect.any(String), scriptUrl: expect.any(String) }),
    ])
    const registrationUrl = (label: string, field: 'scope' | 'scriptUrl') =>
      new URL(String(browserState.registrations[label]?.[field]), runtime.origin)
    const nativeCallFor = (suffix: string) =>
      browserState.nativeCalls.find((call) => new URL(call.scriptUrl, runtime.origin).pathname.endsWith(suffix))
    const rootRegistrationScript = registrationUrl('root', 'scriptUrl')
    const rootRegistrationScope = registrationUrl('root', 'scope')
    const scopedRegistrationScript = registrationUrl('sameOrigin', 'scriptUrl')
    const scopedRegistrationScope = registrationUrl('sameOrigin', 'scope')
    const existingRegistrationScript = registrationUrl('alreadyProxied', 'scriptUrl')
    const existingRegistrationScope = registrationUrl('alreadyProxied', 'scope')
    const safeProxyBase = `/__comfy_proxy_sw/${Buffer.from(targetBase).toString('base64url')}/`
    const rootNativeCall = nativeCallFor('/root-service-worker.js')
    const scopedNativeCall = nativeCallFor('/scoped-service-worker.js')
    const existingNativeCall = nativeCallFor('/existing-service-worker.js')

    expect.soft(rootRegistrationScript.origin).toBe(runtime.origin)
    expect.soft(rootRegistrationScript.pathname).toBe(`${safeProxyBase}root-service-worker.js`)
    expect.soft(rootRegistrationScope.pathname).toBe(safeProxyBase)
    expect.soft(scopedRegistrationScript.origin).toBe(runtime.origin)
    expect.soft(scopedRegistrationScript.pathname).toBe(`${safeProxyBase}scoped-service-worker.js`)
    expect.soft(scopedRegistrationScope.pathname).toBe(`${safeProxyBase}custom-scope/`)
    expect.soft(existingRegistrationScript.pathname).toBe(`${safeProxyBase}existing-service-worker.js`)
    expect.soft(existingRegistrationScope.pathname).toBe(`${safeProxyBase}existing-scope/`)
    expect.soft(rootNativeCall).toEqual({ scope: null, scriptUrl: `${safeProxyBase}root-service-worker.js` })
    expect.soft(scopedNativeCall).toEqual({
      scope: `${safeProxyBase}custom-scope/`,
      scriptUrl: `${safeProxyBase}scoped-service-worker.js`,
    })
    expect.soft(existingNativeCall).toEqual({
      scope: `${safeProxyBase}existing-scope/`,
      scriptUrl: `${safeProxyBase}existing-service-worker.js`,
    })
    expect.soft(
      browserState.nativeCalls.find(
        (call) => call.scriptUrl === 'data:text/javascript,self.addEventListener("fetch",()=>{})',
      )?.scope,
    ).toBeNull()
    expect.soft(browserState.nativeCalls.some((call) => call.scriptUrl.startsWith('blob:'))).toBe(true)
    expect.soft(
      browserState.nativeCalls.find((call) => call.scriptUrl === 'https://foreign.invalid/service-worker.js')?.scope,
    ).toBeNull()
    expect.soft(nativeCallFor('/protocol-relative-service-worker.js')).toEqual({
      scope: '//foreign.invalid/protocol-relative-scope/',
      scriptUrl: '//foreign.invalid/protocol-relative-service-worker.js',
    })
    for (const call of [rootNativeCall, scopedNativeCall, existingNativeCall]) {
      const scriptPathname = new URL(call?.scriptUrl ?? '', runtime.origin).pathname
      expect.soft(scriptPathname.startsWith(safeProxyBase)).toBe(true)
      expect.soft((scriptPathname.match(/\/__comfy_proxy_sw\//g) ?? [])).toHaveLength(1)
      expect.soft(scriptPathname.includes(legacyProxyPathname)).toBe(false)
      if (call?.scope) {
        const scopePathname = new URL(call.scope, runtime.origin).pathname
        expect.soft((scopePathname.match(/\/__comfy_proxy_sw\//g) ?? [])).toHaveLength(1)
        expect.soft(scopePathname.includes(legacyProxyPathname)).toBe(false)
      }
    }

    const upstreamPaths = upstream.requests.map((request) => request.url)
    expect.soft(upstreamPaths.filter((path) => path === '/comfy/root-service-worker.js')).toHaveLength(1)
    expect.soft(upstreamPaths.filter((path) => path === '/comfy/scoped-service-worker.js')).toHaveLength(1)
    expect.soft(upstreamPaths.some((path) => path.includes('data:') || path.includes('blob:') || path.includes('foreign.invalid'))).toBe(
      false,
    )
  } finally {
    await runtime.stop()
    await closeServer(upstream.server)
  }
})

test('production server redirects HTTPS root assets back into the trusted authenticated proxy target', async ({
  request,
}) => {
  const upstream = modernUpstream()
  const upstreamPort = await listen(upstream.server)
  const targetBase = `http://127.0.0.1:${upstreamPort}/comfy`
  const reservedPort = await reservePort()
  const trustedOrigin = `https://127.0.0.1:${reservedPort}`
  const tempRoot = mkdtempSync(join(tmpdir(), 'infinity-modern-assets-tls-'))
  const distDir = join(tempRoot, 'dist')
  mkdirSync(distDir)
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>proxy host</title>', 'utf8')
  const child = spawn(process.execPath, [join(workspaceRoot, 'server', 'serve.mjs')], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(reservedPort),
      DIST_DIR: distDir,
      COMFY_PROXY_BEARER_TOKEN: '',
      COMFY_PROXY_TARGET_BASE: targetBase,
      COMFY_PROXY_TARGET_BASES: '',
      COMFY_PROXY_TOKEN_FILE: '',
      COMFY_PROXY_APP_ORIGINS: trustedOrigin,
    },
    stdio: 'ignore',
  })
  const internalOrigin = `http://127.0.0.1:${reservedPort}`
  const forwardedHeaders = {
    Host: `127.0.0.1:${reservedPort}`,
    Origin: trustedOrigin,
    Referer: `${trustedOrigin}${new URL(proxyBase(internalOrigin, targetBase)).pathname}`,
    'Sec-Fetch-Site': 'same-origin',
    'X-Forwarded-Proto': 'https',
  }
  const sessionToken = `fixture-modern-assets-tls-session-${Date.now()}`

  try {
    await waitForHttp(internalOrigin, child)
    const authResponse = await request.post(authUrl(internalOrigin, targetBase), {
      data: { bearerToken: sessionToken },
      headers: forwardedHeaders,
    })
    expect(authResponse.status()).toBe(204)
    const sessionCookie = (authResponse.headers()['set-cookie'] ?? '').split(';', 1)[0] ?? ''
    expect(sessionCookie).not.toContain(sessionToken)

    const redirectResponse = await request.get(`${internalOrigin}/comfy/assets/preloaded.js`, {
      headers: { ...forwardedHeaders, Cookie: sessionCookie },
      maxRedirects: 0,
    })
    const location = redirectResponse.headers().location ?? ''
    const expectedProxyPath = `${new URL(proxyBase(internalOrigin, targetBase)).pathname}assets/preloaded.js`

    expect(redirectResponse.status()).toBe(307)
    expect(location).toBe(expectedProxyPath)
    expect(redirectResponse.headers()['cache-control']).toContain('no-store')
    expect(redirectResponse.headers().vary?.toLowerCase()).toContain('referer')
    expect(JSON.stringify(redirectResponse.headers())).not.toContain(sessionToken)
    expect(location).not.toContain(sessionToken)

    const redirected = new URL(location, trustedOrigin)
    const loadedResponse = await request.get(`${internalOrigin}${redirected.pathname}${redirected.search}`, {
      headers: { ...forwardedHeaders, Cookie: sessionCookie },
    })
    expect(loadedResponse.status()).toBe(200)
    expect(loadedResponse.headers()['content-type']).toContain('text/javascript')
    expect(await loadedResponse.text()).toContain('preloaded')
    expect(upstream.requests.some((entry) => entry.url === '/comfy/assets/preloaded.js')).toBe(true)
  } finally {
    await stopChild(child)
    await closeServer(upstream.server)
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
