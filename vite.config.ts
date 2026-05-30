import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, ViteDevServer } from 'vite'
import { COMFY_PROXY_PREFIX, normalizedComfyBaseUrl } from './src/domain/comfyProxy'

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

const proxyRequestHeaders = (request: IncomingMessage) => {
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

const comfyProxyBridge = (proxyBase: string, targetBase: string) => `<script>
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

const injectComfyProxyBridge = (html: string, proxyBase: string, targetBase: string) => {
  const bridge = comfyProxyBridge(proxyBase, targetBase)
  return html.includes('</head>') ? html.replace('</head>', `${bridge}</head>`) : `${bridge}${html}`
}

async function handleComfyProxy(request: IncomingMessage, response: ServerResponse, next: () => void) {
  if (!request.url?.startsWith(COMFY_PROXY_PREFIX)) {
    next()
    return
  }

  try {
    const requestUrl = new URL(request.url, 'http://infinity.local')
    const pathAfterPrefix = requestUrl.pathname.slice(COMFY_PROXY_PREFIX.length)
    const slashIndex = pathAfterPrefix.indexOf('/')
    const encodedBaseUrl = slashIndex === -1 ? pathAfterPrefix : pathAfterPrefix.slice(0, slashIndex)
    const targetPath = slashIndex === -1 ? '/' : pathAfterPrefix.slice(slashIndex) || '/'
    const targetBase = normalizedComfyBaseUrl(decodeURIComponent(encodedBaseUrl))
    const targetUrl = new URL(targetPath, `${targetBase}/`)
    targetUrl.search = requestUrl.search
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
    const bodyBuffer = hasBody ? await readRequestBody(request) : undefined
    const proxied = await fetch(targetUrl, {
      method: request.method,
      headers: proxyRequestHeaders(request),
      body: bodyBuffer ? new Blob([new Uint8Array(bodyBuffer)]) : undefined,
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

const comfyProxyPlugin = (): Plugin => ({
  name: 'infinity-comfyui-proxy',
  configureServer(server: ViteDevServer) {
    server.middlewares.use((request: IncomingMessage, response: ServerResponse, next: () => void) => {
      void handleComfyProxy(request, response, next)
    })
  },
})

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), comfyProxyPlugin()],
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
