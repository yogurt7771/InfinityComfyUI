import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import net from 'node:net'
import path from 'node:path'
import tls from 'node:tls'
import { fileURLToPath } from 'node:url'

const COMFY_PROXY_PREFIX = '/__comfy_proxy/'
const COMFY_PROXY_TOKEN_PARAM = '__infinity_comfy_token'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distRoot = path.resolve(process.env.DIST_DIR ?? path.join(__dirname, '..', 'app-dist'))
const host = process.env.HOST ?? '0.0.0.0'
const port = Number(process.env.PORT ?? 7930)
const loopbackProxyHost = process.env.COMFY_PROXY_LOOPBACK_HOST

const blockedProxyHeaders = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const mimeTypes = new Map([
  ['.avif', 'image/avif'],
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.mp3', 'audio/mpeg'],
  ['.mp4', 'video/mp4'],
  ['.ogg', 'audio/ogg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wav', 'audio/wav'],
  ['.webm', 'video/webm'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
])

function normalizedComfyBaseUrl(baseUrl) {
  const parsed = new URL(baseUrl)
  parsed.hash = ''
  parsed.search = ''
  return parsed.toString().replace(/\/+$/, '')
}

class ComfyProxyTargetError extends Error {}

function validatedComfyProxyTargetBase(configuredTarget) {
  const targetBase = normalizedComfyBaseUrl(configuredTarget)
  const parsed = new URL(targetBase)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new ComfyProxyTargetError('ComfyUI proxy target is invalid')
  }
  return targetBase
}

function configuredValueList(value) {
  const configuredValue = String(value ?? '').trim()
  if (!configuredValue) return []
  if (!configuredValue.startsWith('[')) return [configuredValue]

  let parsed
  try {
    parsed = JSON.parse(configuredValue)
  } catch {
    throw new ComfyProxyTargetError('Configured proxy list is invalid JSON')
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new ComfyProxyTargetError('Configured proxy list must be an array of strings')
  }
  return parsed.map((item) => item.trim()).filter(Boolean)
}

function configuredComfyProxyTargets() {
  const primaryTarget = process.env.COMFY_PROXY_TARGET_BASE?.trim()
  const additionalTargets = configuredValueList(process.env.COMFY_PROXY_TARGET_BASES)
  const primaryTargetBase = primaryTarget ? validatedComfyProxyTargetBase(primaryTarget) : undefined
  const allowedTargetBases = new Set([
    ...(primaryTargetBase ? [primaryTargetBase] : []),
    ...additionalTargets.map(validatedComfyProxyTargetBase),
  ])
  if (allowedTargetBases.size === 0) throw new ComfyProxyTargetError('ComfyUI proxy target is not configured')
  return { primaryTargetBase, allowedTargetBases }
}

function configuredComfyProxyAppOrigins() {
  const configuredOrigins = configuredValueList(process.env.COMFY_PROXY_APP_ORIGINS)
  const originValues =
    configuredOrigins.length > 0
      ? configuredOrigins
      : [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`]
  return new Set(
    originValues.map((value) => {
      const parsed = new URL(value)
      if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== '/' ||
        parsed.search ||
        parsed.hash
      ) {
        throw new ComfyProxyTargetError('Configured app origin is invalid')
      }
      return parsed.origin
    }),
  )
}

function allowedComfyProxyTargetUrl(targetBase, targetPath) {
  const { allowedTargetBases } = configuredComfyProxyTargets()
  if (!allowedTargetBases.has(targetBase)) throw new ComfyProxyTargetError('ComfyUI proxy target is not allowed')

  let decodedTargetPath
  try {
    decodedTargetPath = decodeURIComponent(targetPath)
  } catch {
    throw new ComfyProxyTargetError('ComfyUI proxy path is invalid')
  }
  if (
    targetPath.startsWith('//') ||
    decodedTargetPath.startsWith('//') ||
    targetPath.includes('\\') ||
    decodedTargetPath.includes('\\')
  ) {
    throw new ComfyProxyTargetError('ComfyUI proxy path is invalid')
  }

  const allowedBaseUrl = new URL(`${targetBase}/`)
  const targetUrl = new URL(targetPath.replace(/^\/+/, ''), allowedBaseUrl)
  const allowedPathPrefix = allowedBaseUrl.pathname
  const targetStaysInAllowedBase =
    targetUrl.origin === allowedBaseUrl.origin &&
    (targetUrl.pathname === allowedPathPrefix.slice(0, -1) || targetUrl.pathname.startsWith(allowedPathPrefix))
  if (!targetStaysInAllowedBase) throw new ComfyProxyTargetError('ComfyUI proxy path is not allowed')

  return targetUrl
}

function proxyRequestComesFromAllowedOrigin(request) {
  const fetchSite = String(request.headers['sec-fetch-site'] ?? '').trim().toLowerCase()
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false

  const origin = String(request.headers.origin ?? '').trim()
  if (!origin || origin === 'undefined') return true
  if (origin === 'null') return false

  try {
    return configuredComfyProxyAppOrigins().has(new URL(origin).origin)
  } catch {
    return false
  }
}

function assertAllowedProxyRequestOrigin(request) {
  if (!proxyRequestComesFromAllowedOrigin(request)) {
    throw new ComfyProxyTargetError('Cross-origin ComfyUI proxy requests are not allowed')
  }
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

function comfyProxyTokenFromFileContent(content) {
  const token = content.split(/\r?\n/, 1)[0]?.trim()
  return token || undefined
}

async function configuredProxyBearerToken(targetBase) {
  const { primaryTargetBase } = configuredComfyProxyTargets()
  if (!primaryTargetBase || targetBase !== primaryTargetBase) return undefined

  const envToken = process.env.COMFY_PROXY_BEARER_TOKEN?.trim()
  if (envToken) return envToken

  const tokenFile = process.env.COMFY_PROXY_TOKEN_FILE?.trim()
  if (!tokenFile) return undefined

  try {
    return comfyProxyTokenFromFileContent(await readFile(tokenFile, 'utf8'))
  } catch {
    return undefined
  }
}

async function upstreamProxyBearerToken(targetBase, clientBearerToken) {
  const token = clientBearerToken || (await configuredProxyBearerToken(targetBase))
  if (!token || !/^[\x21-\x7e]+$/.test(token)) return undefined
  return token
}

async function proxyRequestHeaders(request, bearerToken) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (blockedProxyHeaders.has(key.toLowerCase())) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else if (value !== undefined) {
      headers.set(key, value)
    }
  }
  if (bearerToken && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${bearerToken}`)
  return headers
}

function shouldAttachProxyBearer(request, targetUrl) {
  const accept = String(request.headers.accept ?? '').toLowerCase()
  if (accept.includes('text/html')) return false
  const pathname = targetUrl.pathname.toLowerCase()
  const staticFileExtension = /\.[a-z0-9]{1,8}$/.test(pathname)
  return !staticFileExtension || pathname.endsWith('.json')
}

function proxyCookiePath(proxyBase) {
  return proxyBase.endsWith('/') ? proxyBase : `${proxyBase}/`
}

function rewriteComfyProxySetCookie(value, proxyBase) {
  const parts = value.split(';')
  let hasPath = false
  const rewritten = []
  for (const part of parts) {
    const trimmed = part.trim()
    const key = trimmed.split('=', 1)[0]?.toLowerCase()
    if (key === 'domain') continue
    if (key === 'path') {
      if (!hasPath) rewritten.push(` Path=${proxyCookiePath(proxyBase)}`)
      hasPath = true
      continue
    }
    rewritten.push(part)
  }
  if (!hasPath) rewritten.push(` Path=${proxyCookiePath(proxyBase)}`)
  return rewritten.join(';')
}

function proxiedTargetUrl(targetUrl) {
  const parsed = new URL(targetUrl)
  const isLoopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname)
  if (loopbackProxyHost && isLoopback) parsed.hostname = loopbackProxyHost
  return parsed
}

function comfyProxyRequestParts(rawUrl) {
  const requestUrl = new URL(rawUrl ?? '/', 'http://infinity.local')
  if (!requestUrl.pathname.startsWith(COMFY_PROXY_PREFIX)) return undefined

  const pathAfterPrefix = requestUrl.pathname.slice(COMFY_PROXY_PREFIX.length)
  const slashIndex = pathAfterPrefix.indexOf('/')
  const encodedBaseUrl = slashIndex === -1 ? pathAfterPrefix : pathAfterPrefix.slice(0, slashIndex)
  const targetPath = slashIndex === -1 ? '/' : pathAfterPrefix.slice(slashIndex) || '/'
  const targetBase = normalizedComfyBaseUrl(decodeURIComponent(encodedBaseUrl))
  return {
    requestUrl,
    encodedBaseUrl,
    targetBase,
    targetPath,
    proxyBase: `${COMFY_PROXY_PREFIX}${encodedBaseUrl}/`,
  }
}

function websocketOriginFor(targetUrl) {
  return `${targetUrl.protocol === 'wss:' ? 'https:' : 'http:'}//${targetUrl.host}`
}

const blockedWebSocketProxyHeaders = new Set([
  'connection',
  'content-length',
  'host',
  'proxy-authenticate',
  'proxy-authorization',
  'sec-websocket-accept',
  'upgrade',
])

function websocketProxyHeaders(request, targetUrl, bearerToken) {
  const headers = []
  const seen = new Set()
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const key = request.rawHeaders[index]
    const value = request.rawHeaders[index + 1]
    const lower = key.toLowerCase()
    if (blockedWebSocketProxyHeaders.has(lower)) continue
    if (lower === 'origin') {
      headers.push(`${key}: ${websocketOriginFor(targetUrl)}`)
    } else {
      headers.push(`${key}: ${value}`)
    }
    seen.add(lower)
  }

  headers.unshift(`Host: ${targetUrl.host}`, 'Connection: Upgrade', 'Upgrade: websocket')
  if (!seen.has('origin')) headers.push(`Origin: ${websocketOriginFor(targetUrl)}`)
  if (bearerToken && !seen.has('authorization')) headers.push(`Authorization: Bearer ${bearerToken}`)
  return headers
}

function scriptSafeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

function comfyProxyBridge(proxyBase, targetBase, bearerToken) {
  return `<script>
(() => {
  const proxyBase = ${scriptSafeJson(proxyBase)};
  const targetBase = ${scriptSafeJson(targetBase)};
  const proxyTokenParam = ${scriptSafeJson(COMFY_PROXY_TOKEN_PARAM)};
  const proxyBearerToken = ${scriptSafeJson(bearerToken ?? '')};
  const proxyAuthParams = new URLSearchParams(location.search);
  if (proxyBearerToken && !proxyAuthParams.has(proxyTokenParam)) proxyAuthParams.set(proxyTokenParam, proxyBearerToken);
  const withProxyAuth = (value) => {
    try {
      const parsed = new URL(value, location.href);
      if (parsed.origin !== location.origin || !parsed.pathname.startsWith(proxyBase)) return value;
      for (const [key, authValue] of proxyAuthParams) {
        if (!parsed.searchParams.has(key)) parsed.searchParams.set(key, authValue);
      }
      return parsed.pathname + parsed.search + parsed.hash;
    } catch {
      return value;
    }
  };
  const proxiedPath = (pathname, search = '', hash = '') =>
    withProxyAuth(proxyBase + String(pathname || '/').replace(/^\\/+/, '') + search + hash);
  const proxiedWebSocketUrl = (pathname, search = '', hash = '') => {
    const routed = new URL(proxiedPath(pathname, search, hash), location.href);
    routed.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return routed.toString();
  };
  const route = (value) => {
    const raw = String(value);
    if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
    if (raw.startsWith(proxyBase)) return withProxyAuth(raw);
    if (raw.startsWith('/')) return withProxyAuth(proxyBase + raw.slice(1));
    try {
      const parsed = new URL(raw, location.href);
      const target = new URL(targetBase);
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin === target.origin) {
        return proxiedPath(parsed.pathname, parsed.search, parsed.hash);
      }
      if (parsed.origin === location.origin && parsed.pathname.startsWith(proxyBase)) {
        return withProxyAuth(parsed.pathname + parsed.search + parsed.hash);
      }
      if (parsed.origin === location.origin && !parsed.pathname.startsWith(proxyBase)) {
        return proxiedPath(parsed.pathname, parsed.search, parsed.hash);
      }
    } catch {}
    return raw;
  };
  const routeWebSocket = (value) => {
    const raw = String(value);
    try {
      const parsed = new URL(raw, location.href);
      const target = new URL(targetBase);
      if (parsed.host === location.host && parsed.pathname.startsWith(proxyBase)) {
        const routed = new URL(withProxyAuth(parsed.pathname + parsed.search + parsed.hash), location.href);
        routed.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        return routed.toString();
      }
      if (parsed.origin === location.origin && parsed.pathname.startsWith(proxyBase)) {
        const routed = new URL(withProxyAuth(parsed.pathname + parsed.search + parsed.hash), location.href);
        routed.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        return routed.toString();
      }
      if ((parsed.protocol === 'ws:' || parsed.protocol === 'wss:') && parsed.host === target.host) {
        return proxiedWebSocketUrl(parsed.pathname, parsed.search, parsed.hash);
      }
      if ((parsed.protocol === 'ws:' || parsed.protocol === 'wss:') && parsed.host === location.host) {
        return proxiedWebSocketUrl(parsed.pathname, parsed.search, parsed.hash);
      }
      if (parsed.origin === location.origin && !parsed.pathname.startsWith(proxyBase)) {
        return proxiedWebSocketUrl(parsed.pathname, parsed.search, parsed.hash);
      }
    } catch {}
    return raw;
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === 'string' || input instanceof URL) return nativeFetch(route(input), init);
    if (input instanceof Request) {
      const next = route(input.url);
      return nativeFetch(next === input.url ? input : new Request(next, input), init);
    }
    return nativeFetch(input, init);
  };
  const NativeXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function XMLHttpRequest() {
    const xhr = new NativeXHR();
    const open = xhr.open;
    xhr.open = function(method, url, ...rest) {
      return open.call(xhr, method, route(url), ...rest);
    };
    return xhr;
  };
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = function WebSocket(url, protocols) {
    const next = routeWebSocket(url);
    return protocols === undefined ? new NativeWebSocket(next) : new NativeWebSocket(next, protocols);
  };
  window.WebSocket.prototype = NativeWebSocket.prototype;
  if (window.EventSource) {
    const NativeEventSource = window.EventSource;
    window.EventSource = function EventSource(url, init) {
      return new NativeEventSource(route(url), init);
    };
    window.EventSource.prototype = NativeEventSource.prototype;
  }
  if (navigator.sendBeacon) {
    const nativeSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => nativeSendBeacon(route(url), data);
  }
  if (window.Worker) {
    const NativeWorker = window.Worker;
    window.Worker = function Worker(url, options) {
      return new NativeWorker(route(url), options);
    };
    window.Worker.prototype = NativeWorker.prototype;
  }
  if (window.SharedWorker) {
    const NativeSharedWorker = window.SharedWorker;
    window.SharedWorker = function SharedWorker(url, options) {
      return new NativeSharedWorker(route(url), options);
    };
    window.SharedWorker.prototype = NativeSharedWorker.prototype;
  }
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const action = form.getAttribute('action');
    if (!action) return;
    const routed = route(action);
    if (routed !== action) form.action = new URL(routed, location.href).toString();
  }, true);
  document.addEventListener('click', (event) => {
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor || anchor.target || anchor.download || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const href = anchor.getAttribute('href');
    if (!href) return;
    const routed = route(href);
    if (routed === href) return;
    event.preventDefault();
    location.href = routed;
  }, true);
})();
</script>`
}

function injectComfyProxyBridge(html, proxyBase, targetBase, bearerToken) {
  const bridge = comfyProxyBridge(proxyBase, targetBase, bearerToken)
  return html.includes('</head>') ? html.replace('</head>', `${bridge}</head>`) : `${bridge}${html}`
}

function rewriteComfyProxyLocationWithToken(value, proxyBase, targetBase, bearerToken) {
  try {
    const targetOrigin = new URL(targetBase).origin
    const parsed = new URL(value, `${targetBase}/`)
    if (parsed.origin !== targetOrigin) return value
    if (bearerToken && !parsed.searchParams.has(COMFY_PROXY_TOKEN_PARAM)) {
      parsed.searchParams.set(COMFY_PROXY_TOKEN_PARAM, bearerToken)
    }
    return `${proxyBase}${parsed.pathname.replace(/^\/+/, '')}${parsed.search}${parsed.hash}`
  } catch {
    return value
  }
}

function rewriteComfyProxyResponseHeader(key, value, proxyBase, targetBase, bearerToken) {
  if (key.toLowerCase() === 'location') return rewriteComfyProxyLocationWithToken(value, proxyBase, targetBase, bearerToken)
  if (key.toLowerCase() === 'set-cookie') return rewriteComfyProxySetCookie(value, proxyBase)
  return value
}

function setComfyProxyResponseHeaders(response, headers, proxyBase, targetBase, bearerToken) {
  const setCookies =
    typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : headers.get('set-cookie') ? [headers.get('set-cookie')] : []
  headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (lower === 'set-cookie' || blockedProxyHeaders.has(lower)) return
    response.setHeader(key, rewriteComfyProxyResponseHeader(key, value, proxyBase, targetBase, bearerToken))
  })
  if (setCookies.length > 0) {
    response.setHeader(
      'set-cookie',
      setCookies.filter(Boolean).map((value) => rewriteComfyProxySetCookie(value, proxyBase)),
    )
  }
}

async function handleComfyProxy(request, response) {
  try {
    assertAllowedProxyRequestOrigin(request)
    const parts = comfyProxyRequestParts(request.url)
    if (!parts) {
      response.statusCode = 404
      response.end('Not found')
      return
    }
    const { requestUrl, targetPath, targetBase, proxyBase } = parts
    const targetUrl = proxiedTargetUrl(allowedComfyProxyTargetUrl(targetBase, targetPath))
    targetUrl.search = requestUrl.search
    targetUrl.searchParams.delete(COMFY_PROXY_TOKEN_PARAM)
    const clientBearerToken = requestUrl.searchParams.get(COMFY_PROXY_TOKEN_PARAM)?.trim()
    const upstreamBearerToken = await upstreamProxyBearerToken(targetBase, clientBearerToken)

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
    const bodyBuffer = hasBody ? await readRequestBody(request) : undefined
    const proxied = await fetch(targetUrl, {
      method: request.method,
      headers: await proxyRequestHeaders(request, shouldAttachProxyBearer(request, targetUrl) ? upstreamBearerToken : undefined),
      body: bodyBuffer,
      redirect: 'manual',
    })
    const contentType = proxied.headers.get('content-type') ?? ''
    response.statusCode = proxied.status
    setComfyProxyResponseHeaders(response, proxied.headers, proxyBase, targetBase, clientBearerToken)
    if (contentType.includes('text/html')) {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(injectComfyProxyBridge(await proxied.text(), proxyBase, targetBase, clientBearerToken))
      return
    }

    response.end(Buffer.from(await proxied.arrayBuffer()))
  } catch (err) {
    response.statusCode = err instanceof ComfyProxyTargetError ? 403 : 502
    response.setHeader('content-type', 'text/plain; charset=utf-8')
    response.end(err instanceof Error ? err.message : 'ComfyUI proxy failed')
  }
}

function safeResolveStaticPath(pathname) {
  const decodedPath = decodeURIComponent(pathname)
  const targetPath = decodedPath.endsWith('/') ? `${decodedPath}index.html` : decodedPath
  const resolved = path.resolve(distRoot, `.${targetPath}`)
  const insideRoot = resolved === distRoot || resolved.startsWith(`${distRoot}${path.sep}`)
  return insideRoot ? resolved : undefined
}

async function staticFileFor(pathname) {
  const resolved = safeResolveStaticPath(pathname)
  if (!resolved) return undefined

  try {
    const info = await stat(resolved)
    if (info.isFile()) return resolved
  } catch {}

  return path.extname(pathname) ? undefined : safeResolveStaticPath('/index.html')
}

async function handleStatic(request, response) {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const filePath = await staticFileFor(requestUrl.pathname)
  if (!filePath) {
    response.statusCode = 404
    response.setHeader('content-type', 'text/plain; charset=utf-8')
    response.end('Not found')
    return
  }

  response.statusCode = 200
  response.setHeader('content-type', mimeTypes.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream')
  if (path.basename(filePath) !== 'index.html') response.setHeader('cache-control', 'public, max-age=31536000, immutable')
  createReadStream(filePath).pipe(response)
}

const server = createServer((request, response) => {
  if (request.url?.startsWith(COMFY_PROXY_PREFIX)) {
    void handleComfyProxy(request, response)
    return
  }
  void handleStatic(request, response)
})

server.on('upgrade', (request, socket, head) => {
  void (async () => {
    const fail = (status = '502 Bad Gateway') => {
      if (!socket.destroyed) {
        socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`)
        socket.destroy()
      }
    }

    try {
      assertAllowedProxyRequestOrigin(request)
      const parts = comfyProxyRequestParts(request.url)
      if (!parts) {
        socket.destroy()
        return
      }
      const { requestUrl, targetPath, targetBase } = parts
      const targetUrl = proxiedTargetUrl(allowedComfyProxyTargetUrl(targetBase, targetPath))
      targetUrl.protocol = targetUrl.protocol === 'https:' ? 'wss:' : 'ws:'
      targetUrl.search = requestUrl.search
      targetUrl.searchParams.delete(COMFY_PROXY_TOKEN_PARAM)
      const clientBearerToken = requestUrl.searchParams.get(COMFY_PROXY_TOKEN_PARAM)?.trim()
      const upstreamBearerToken = await upstreamProxyBearerToken(targetBase, clientBearerToken)
      const portNumber = Number(targetUrl.port || (targetUrl.protocol === 'wss:' ? 443 : 80))
      const connectOptions = { host: targetUrl.hostname, port: portNumber, servername: targetUrl.hostname }
      const upstream =
        targetUrl.protocol === 'wss:' ? tls.connect(connectOptions, onConnect) : net.connect(connectOptions, onConnect)

      function onConnect() {
        const pathAndSearch = `${targetUrl.pathname}${targetUrl.search}`
        upstream.write(
          `GET ${pathAndSearch} HTTP/1.1\r\n${websocketProxyHeaders(request, targetUrl, upstreamBearerToken).join('\r\n')}\r\n\r\n`,
        )
        if (head.length > 0) upstream.write(head)
        upstream.pipe(socket)
        socket.pipe(upstream)
      }

      upstream.on('error', fail)
      socket.on('error', () => upstream.destroy())
    } catch (error) {
      fail(error instanceof ComfyProxyTargetError ? '403 Forbidden' : '502 Bad Gateway')
    }
  })()
})

server.listen(port, host, () => {
  console.log(`Infinity ComfyUI serving ${distRoot} at http://${host}:${port}`)
})
