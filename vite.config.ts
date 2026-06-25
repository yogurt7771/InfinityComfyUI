import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import net, { type Socket } from 'node:net'
import tls from 'node:tls'
import type { Plugin, ViteDevServer } from 'vite'
import {
  COMFY_PROXY_PREFIX,
  COMFY_PROXY_TOKEN_PARAM,
  comfyProxyTokenFromFileContent,
  normalizedComfyBaseUrl,
} from './src/domain/comfyProxy'

const blockedProxyHeaders = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const readRequestBody = (request: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })

const configuredProxyBearerToken = async () => {
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

const proxyRequestHeaders = async (request: IncomingMessage, bearerToken: string | undefined) => {
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

const shouldAttachProxyBearer = (request: IncomingMessage, targetUrl: URL) => {
  const accept = String(request.headers.accept ?? '').toLowerCase()
  if (accept.includes('text/html')) return false
  const pathname = targetUrl.pathname.toLowerCase()
  const staticFileExtension = /\.[a-z0-9]{1,8}$/.test(pathname)
  return !staticFileExtension || pathname.endsWith('.json')
}

const proxyCookiePath = (proxyBase: string) => (proxyBase.endsWith('/') ? proxyBase : `${proxyBase}/`)

const rewriteComfyProxySetCookie = (value: string, proxyBase: string) => {
  const parts = value.split(';')
  let hasPath = false
  const rewritten: string[] = []
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

const comfyProxyRequestParts = (rawUrl: string | undefined) => {
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

const websocketOriginFor = (targetUrl: URL) =>
  `${targetUrl.protocol === 'wss:' ? 'https:' : 'http:'}//${targetUrl.host}`

const blockedWebSocketProxyHeaders = new Set([
  'connection',
  'content-length',
  'host',
  'proxy-authenticate',
  'proxy-authorization',
  'sec-websocket-accept',
  'upgrade',
])

const websocketProxyHeaders = (request: IncomingMessage, targetUrl: URL, bearerToken: string | undefined) => {
  const headers: string[] = []
  const seen = new Set<string>()
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

const comfyProxyBridge = (proxyBase: string, targetBase: string, bearerToken?: string) => `<script>
(() => {
  const proxyBase = ${JSON.stringify(proxyBase)};
  const targetBase = ${JSON.stringify(targetBase)};
  const proxyTokenParam = ${JSON.stringify(COMFY_PROXY_TOKEN_PARAM)};
  const proxyBearerToken = ${JSON.stringify(bearerToken ?? '')};
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

const injectComfyProxyBridge = (html: string, proxyBase: string, targetBase: string, bearerToken?: string) => {
  const bridge = comfyProxyBridge(proxyBase, targetBase, bearerToken)
  return html.includes('</head>') ? html.replace('</head>', `${bridge}</head>`) : `${bridge}${html}`
}

const rewriteComfyProxyLocation = (value: string, proxyBase: string, targetBase: string, bearerToken: string | undefined) => {
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

const rewriteComfyProxyResponseHeader = (
  key: string,
  value: string,
  proxyBase: string,
  targetBase: string,
  bearerToken: string | undefined,
) => {
  if (key.toLowerCase() === 'location') return rewriteComfyProxyLocation(value, proxyBase, targetBase, bearerToken)
  if (key.toLowerCase() === 'set-cookie') return rewriteComfyProxySetCookie(value, proxyBase)
  return value
}

const setComfyProxyResponseHeaders = (
  response: ServerResponse,
  headers: Headers,
  proxyBase: string,
  targetBase: string,
  bearerToken: string | undefined,
) => {
  const cookieHeaders = headers as Headers & { getSetCookie?: () => string[] }
  const setCookies =
    typeof cookieHeaders.getSetCookie === 'function'
      ? cookieHeaders.getSetCookie()
      : headers.get('set-cookie')
        ? [headers.get('set-cookie') as string]
        : []

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

async function handleComfyProxy(request: IncomingMessage, response: ServerResponse, next: () => void) {
  if (!request.url?.startsWith(COMFY_PROXY_PREFIX)) {
    next()
    return
  }

  try {
    const parts = comfyProxyRequestParts(request.url)
    if (!parts) {
      next()
      return
    }
    const { requestUrl, targetPath, targetBase, proxyBase } = parts
    const targetUrl = new URL(targetPath, `${targetBase}/`)
    targetUrl.search = requestUrl.search
    targetUrl.searchParams.delete(COMFY_PROXY_TOKEN_PARAM)
    const bearerToken = requestUrl.searchParams.get(COMFY_PROXY_TOKEN_PARAM)?.trim() || (await configuredProxyBearerToken())
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
    const bodyBuffer = hasBody ? await readRequestBody(request) : undefined
    const proxied = await fetch(targetUrl, {
      method: request.method,
      headers: await proxyRequestHeaders(request, shouldAttachProxyBearer(request, targetUrl) ? bearerToken : undefined),
      body: bodyBuffer ? new Blob([new Uint8Array(bodyBuffer)]) : undefined,
      redirect: 'manual',
    })
    const contentType = proxied.headers.get('content-type') ?? ''
    response.statusCode = proxied.status
    setComfyProxyResponseHeaders(response, proxied.headers, proxyBase, targetBase, bearerToken)
    response.setHeader('Access-Control-Allow-Origin', '*')

    if (contentType.includes('text/html')) {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(injectComfyProxyBridge(await proxied.text(), proxyBase, targetBase, bearerToken))
      return
    }

    response.end(Buffer.from(await proxied.arrayBuffer()))
  } catch (err) {
    response.statusCode = 502
    response.setHeader('content-type', 'text/plain; charset=utf-8')
    response.end(err instanceof Error ? err.message : 'ComfyUI proxy failed')
  }
}

const comfyProxyPlugin = (): Plugin => ({
  name: 'infinity-comfyui-proxy',
  configureServer(server: ViteDevServer) {
    server.middlewares.use((request: IncomingMessage, response: ServerResponse, next: () => void) => {
      void handleComfyProxy(request, response, next)
    })
    server.httpServer?.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
      if (!request.url?.startsWith(COMFY_PROXY_PREFIX)) return
      void (async () => {
        const fail = () => {
          if (!socket.destroyed) {
            socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
            socket.destroy()
          }
        }

        try {
          const parts = comfyProxyRequestParts(request.url)
          if (!parts) {
            socket.destroy()
            return
          }
          const { requestUrl, targetPath, targetBase } = parts
          const targetUrl = new URL(targetPath, `${targetBase}/`)
          targetUrl.protocol = targetUrl.protocol === 'https:' ? 'wss:' : 'ws:'
          targetUrl.search = requestUrl.search
          targetUrl.searchParams.delete(COMFY_PROXY_TOKEN_PARAM)
          const bearerToken = requestUrl.searchParams.get(COMFY_PROXY_TOKEN_PARAM)?.trim() || (await configuredProxyBearerToken())
          const port = Number(targetUrl.port || (targetUrl.protocol === 'wss:' ? 443 : 80))
          const connectOptions = { host: targetUrl.hostname, port, servername: targetUrl.hostname }
          const upstream =
            targetUrl.protocol === 'wss:' ? tls.connect(connectOptions, onConnect) : net.connect(connectOptions, onConnect)

          function onConnect() {
            upstream.write(
              `GET ${targetUrl.pathname}${targetUrl.search} HTTP/1.1\r\n${websocketProxyHeaders(
                request,
                targetUrl,
                bearerToken,
              ).join('\r\n')}\r\n\r\n`,
            )
            if (head.length > 0) upstream.write(head)
            upstream.pipe(socket)
            socket.pipe(upstream)
          }

          upstream.on('error', fail)
          socket.on('error', () => upstream.destroy())
        } catch {
          fail()
        }
      })()
    })
  },
})

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), comfyProxyPlugin()],
  build: {
    outDir: 'app-dist',
  },
  server: {
    port: 7930,
  },
  preview: {
    port: 7930,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: './src/test/setup.ts',
    globals: false,
  },
})
