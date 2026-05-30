import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const COMFY_PROXY_PREFIX = '/__comfy_proxy/'
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

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

function proxyRequestHeaders(request) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (blockedProxyHeaders.has(key.toLowerCase())) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else if (value !== undefined) {
      headers.set(key, value)
    }
  }
  return headers
}

function proxiedTargetUrl(targetUrl) {
  const parsed = new URL(targetUrl)
  const isLoopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname)
  if (loopbackProxyHost && isLoopback) parsed.hostname = loopbackProxyHost
  return parsed
}

function comfyProxyBridge(proxyBase, targetBase) {
  return `<script>
(() => {
  const proxyBase = ${JSON.stringify(proxyBase)};
  const targetBase = ${JSON.stringify(targetBase)};
  const route = (value) => {
    const raw = String(value);
    if (raw.startsWith(proxyBase) || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
    if (raw.startsWith('/')) return proxyBase + raw.slice(1);
    try {
      const parsed = new URL(raw, location.href);
      if (parsed.origin === location.origin && !parsed.pathname.startsWith(proxyBase)) {
        return proxyBase + parsed.pathname.replace(/^\\//, '') + parsed.search + parsed.hash;
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
    let next = String(url);
    try {
      const parsed = new URL(next, location.href);
      if ((parsed.protocol === 'ws:' || parsed.protocol === 'wss:') && parsed.host === location.host) {
        const target = new URL(targetBase);
        target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
        target.pathname = parsed.pathname;
        target.search = parsed.search;
        next = target.toString();
      }
    } catch {}
    return protocols === undefined ? new NativeWebSocket(next) : new NativeWebSocket(next, protocols);
  };
  window.WebSocket.prototype = NativeWebSocket.prototype;
})();
</script>`
}

function injectComfyProxyBridge(html, proxyBase, targetBase) {
  const bridge = comfyProxyBridge(proxyBase, targetBase)
  return html.includes('</head>') ? html.replace('</head>', `${bridge}</head>`) : `${bridge}${html}`
}

async function handleComfyProxy(request, response) {
  try {
    const requestUrl = new URL(request.url ?? '/', 'http://infinity.local')
    const pathAfterPrefix = requestUrl.pathname.slice(COMFY_PROXY_PREFIX.length)
    const slashIndex = pathAfterPrefix.indexOf('/')
    const encodedBaseUrl = slashIndex === -1 ? pathAfterPrefix : pathAfterPrefix.slice(0, slashIndex)
    const targetPath = slashIndex === -1 ? '/' : pathAfterPrefix.slice(slashIndex) || '/'
    const targetBase = normalizedComfyBaseUrl(decodeURIComponent(encodedBaseUrl))
    const targetUrl = proxiedTargetUrl(new URL(targetPath, `${targetBase}/`))
    targetUrl.search = requestUrl.search

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
    const bodyBuffer = hasBody ? await readRequestBody(request) : undefined
    const proxied = await fetch(targetUrl, {
      method: request.method,
      headers: proxyRequestHeaders(request),
      body: bodyBuffer,
      redirect: 'manual',
    })
    const contentType = proxied.headers.get('content-type') ?? ''
    response.statusCode = proxied.status
    proxied.headers.forEach((value, key) => {
      if (!blockedProxyHeaders.has(key.toLowerCase())) response.setHeader(key, value)
    })
    response.setHeader('Access-Control-Allow-Origin', '*')

    if (contentType.includes('text/html')) {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(injectComfyProxyBridge(await proxied.text(), `${COMFY_PROXY_PREFIX}${encodedBaseUrl}/`, targetBase))
      return
    }

    response.end(Buffer.from(await proxied.arrayBuffer()))
  } catch (err) {
    response.statusCode = 502
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

server.listen(port, host, () => {
  console.log(`Infinity ComfyUI serving ${distRoot} at http://${host}:${port}`)
})
