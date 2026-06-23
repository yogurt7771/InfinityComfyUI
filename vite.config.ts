import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
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
  const appendComfyToken = (targetUrl) => {
    const token = proxyAuthParams.get(proxyTokenParam);
    if (token && !targetUrl.searchParams.has('token')) targetUrl.searchParams.set('token', token);
    targetUrl.searchParams.delete(proxyTokenParam);
    return targetUrl;
  };
  const route = (value) => {
    const raw = String(value);
    if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
    if (raw.startsWith(proxyBase)) return withProxyAuth(raw);
    if (raw.startsWith('/')) return withProxyAuth(proxyBase + raw.slice(1));
    try {
      const parsed = new URL(raw, location.href);
      if (parsed.origin === location.origin && parsed.pathname.startsWith(proxyBase)) {
        return withProxyAuth(parsed.pathname + parsed.search + parsed.hash);
      }
      if (parsed.origin === location.origin && !parsed.pathname.startsWith(proxyBase)) {
        return withProxyAuth(proxyBase + parsed.pathname.replace(/^\\//, '') + parsed.search + parsed.hash);
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
      const parsed = new URL(route(next), location.href);
      const targetBaseUrl = new URL(targetBase);
      if ((parsed.protocol === 'ws:' || parsed.protocol === 'wss:') && parsed.host === targetBaseUrl.host) {
        next = appendComfyToken(parsed).toString();
      } else if (parsed.origin === location.origin && parsed.pathname.startsWith(proxyBase)) {
        const target = new URL(targetBase);
        target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
        target.pathname = '/' + parsed.pathname.slice(proxyBase.length).replace(/^\\/+/, '');
        target.search = parsed.search;
        next = appendComfyToken(target).toString();
      } else if ((parsed.protocol === 'ws:' || parsed.protocol === 'wss:') && parsed.host === location.host) {
        const target = new URL(targetBase);
        target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
        target.pathname = parsed.pathname;
        target.search = parsed.search;
        next = appendComfyToken(target).toString();
      }
    } catch {}
    return protocols === undefined ? new NativeWebSocket(next) : new NativeWebSocket(next, protocols);
  };
  window.WebSocket.prototype = NativeWebSocket.prototype;
})();
</script>`

const injectComfyProxyBridge = (html: string, proxyBase: string, targetBase: string, bearerToken?: string) => {
  const bridge = comfyProxyBridge(proxyBase, targetBase, bearerToken)
  return html.includes('</head>') ? html.replace('</head>', `${bridge}</head>`) : `${bridge}${html}`
}

const rewriteComfyProxyLocation = (value: string, proxyBase: string, targetBase: string) => {
  try {
    const targetOrigin = new URL(targetBase).origin
    const parsed = new URL(value, `${targetBase}/`)
    if (parsed.origin !== targetOrigin) return value
    return `${proxyBase}${parsed.pathname.replace(/^\/+/, '')}${parsed.search}${parsed.hash}`
  } catch {
    return value
  }
}

const rewriteComfyProxyResponseHeader = (key: string, value: string, proxyBase: string, targetBase: string) => {
  if (key.toLowerCase() === 'location') return rewriteComfyProxyLocation(value, proxyBase, targetBase)
  if (key.toLowerCase() === 'set-cookie') return value.replace(/;\s*Path=\/(?=;|$)/i, `; Path=${proxyBase}`)
  return value
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
    targetUrl.searchParams.delete(COMFY_PROXY_TOKEN_PARAM)
    const proxyBase = `${COMFY_PROXY_PREFIX}${encodedBaseUrl}/`
    const bearerToken = requestUrl.searchParams.get(COMFY_PROXY_TOKEN_PARAM)?.trim() || (await configuredProxyBearerToken())
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
    const bodyBuffer = hasBody ? await readRequestBody(request) : undefined
    const proxied = await fetch(targetUrl, {
      method: request.method,
      headers: await proxyRequestHeaders(request, bearerToken),
      body: bodyBuffer ? new Blob([new Uint8Array(bodyBuffer)]) : undefined,
      redirect: 'manual',
    })
    const contentType = proxied.headers.get('content-type') ?? ''
    response.statusCode = proxied.status
    proxied.headers.forEach((value, key) => {
      if (!blockedProxyHeaders.has(key.toLowerCase())) {
        response.setHeader(key, rewriteComfyProxyResponseHeader(key, value, proxyBase, targetBase))
      }
    })
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
