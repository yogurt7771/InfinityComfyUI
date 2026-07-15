import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import tls from 'node:tls'
import { fileURLToPath } from 'node:url'
import comfyProxyBridgeModule from './comfyProxyBridge.cjs'

const COMFY_PROXY_PREFIX = '/__comfy_proxy/'
const COMFY_PROXY_AUTH_PREFIX = '/__comfy_proxy/auth/'
const COMFY_PROXY_SERVICE_WORKER_PREFIX = '/__comfy_proxy_sw/'
const COMFY_PROXY_LEGACY_TOKEN_PARAM = '__infinity_comfy_token'
const COMFY_PROXY_SESSION_COOKIE_PREFIX = '__infinity_comfy_session_'
const COMFY_PROXY_SESSION_TTL_MS = 8 * 60 * 60 * 1000
const COMFY_PROXY_SESSION_CLEANUP_MS = 10 * 60 * 1000
const COMFY_PROXY_MAX_SESSIONS = 256
const comfyProxySessions = new Map()
const comfyProxySessionsByContext = new Map()
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
class RequestBodyTooLargeError extends Error {}
class ComfyProxyAuthenticationError extends Error {}

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

function requestOrigin(request) {
  if (!request.headers.host) return undefined
  try {
    const protocol = requestUsesSecureTransport(request) ? 'https:' : 'http:'
    return new URL(`${protocol}//${request.headers.host}`).origin
  } catch {
    return undefined
  }
}

function proxyRequestComesFromAllowedOrigin(request, targetBase) {
  const fetchSite = String(request.headers['sec-fetch-site'] ?? '').trim().toLowerCase()
  const origin = String(request.headers.origin ?? '').trim()
  const actualOrigin = requestOrigin(request)
  if (!actualOrigin || origin === 'null') return false
  const session = targetBase ? comfyProxySession(request, targetBase) : undefined
  const fetchDestination = String(request.headers['sec-fetch-dest'] ?? '').trim().toLowerCase()
  const isolatedFrameNavigation =
    fetchSite === 'cross-site' &&
    session?.frameOrigin === actualOrigin &&
    (request.method === 'GET' || request.method === 'HEAD') &&
    (fetchDestination === 'iframe' || fetchDestination === 'document')
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none' && !isolatedFrameNavigation) return false

  try {
    const parsedOrigin = origin && origin !== 'undefined' ? new URL(origin).origin : undefined
    if (parsedOrigin && parsedOrigin !== actualOrigin) return false
    if (configuredComfyProxyAppOrigins().has(actualOrigin)) return true
    return session?.frameOrigin === actualOrigin
  } catch {
    return false
  }
}

function assertAllowedProxyRequestOrigin(request, targetBase) {
  if (!proxyRequestComesFromAllowedOrigin(request, targetBase)) {
    throw new ComfyProxyTargetError('Cross-origin ComfyUI proxy requests are not allowed')
  }
}

function isolatedFrameOriginMatchesParent(frameOrigin, parentOrigin) {
  try {
    const frame = new URL(frameOrigin)
    const parent = new URL(parentOrigin)
    if (frame.protocol !== parent.protocol || frame.port !== parent.port) return false
    const parentHost = parent.hostname.toLowerCase()
    const frameHost = frame.hostname.toLowerCase()
    if (['localhost', '127.0.0.1', '[::1]'].includes(parentHost) || parentHost.endsWith('.localhost')) {
      return /^frame-[a-f0-9]{32}\.localhost$/.test(frameHost)
    }
    return new RegExp(`^frame-[a-f0-9]{32}\\.comfy-proxy\\.${parentHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`).test(
      frameHost,
    )
  } catch {
    return false
  }
}

function comfyProxyAuthContext(request) {
  const fetchSite = String(request.headers['sec-fetch-site'] ?? '').trim().toLowerCase()
  if (fetchSite && !['same-origin', 'same-site', 'cross-site', 'none'].includes(fetchSite)) return undefined
  const frameOrigin = requestOrigin(request)
  const rawOrigin = String(request.headers.origin ?? '').trim()
  if (!frameOrigin || rawOrigin === 'null') return undefined
  try {
    const parentOrigin = rawOrigin && rawOrigin !== 'undefined' ? new URL(rawOrigin).origin : frameOrigin
    if (!configuredComfyProxyAppOrigins().has(parentOrigin)) return undefined
    if (frameOrigin !== parentOrigin && !isolatedFrameOriginMatchesParent(frameOrigin, parentOrigin)) return undefined
    return { frameOrigin, parentOrigin, isolatedFrame: frameOrigin !== parentOrigin }
  } catch {
    return undefined
  }
}

function setComfyProxyAuthCors(response, context) {
  if (!context?.isolatedFrame) return
  response.setHeader('access-control-allow-origin', context.parentOrigin)
  response.setHeader('access-control-allow-credentials', 'true')
  response.setHeader('access-control-allow-methods', 'POST, OPTIONS')
  response.setHeader('access-control-allow-headers', 'Content-Type')
  response.setHeader('vary', 'Origin')
}

function readRequestBody(request, maxBytes = Number.POSITIVE_INFINITY) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let totalBytes = 0
    let rejected = false
    request.on('data', (chunk) => {
      if (rejected) return
      const buffer = Buffer.from(chunk)
      totalBytes += buffer.length
      if (totalBytes > maxBytes) {
        rejected = true
        chunks.length = 0
        reject(new RequestBodyTooLargeError('Request body is too large'))
        return
      }
      chunks.push(buffer)
    })
    request.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks))
    })
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

async function upstreamProxyBearerToken(targetBase, sessionBearerToken) {
  const token = sessionBearerToken || (await configuredProxyBearerToken(targetBase))
  if (!token || !/^[\x21-\x7e]+$/.test(token)) return undefined
  return token
}

async function proxyRequestHeaders(
  request,
  bearerToken,
  targetBase,
  allowSessionCredentials,
  sessionUpstreamCookieHeader,
) {
  const headers = new Headers()
  let browserUpstreamCookieHeader
  for (const [key, value] of Object.entries(request.headers)) {
    const lower = key.toLowerCase()
    if (blockedProxyHeaders.has(lower)) continue
    if (lower === 'cookie') {
      if (!allowSessionCredentials) continue
      const cookieHeader = proxyCookieHeaderForTarget(value, targetBase)
      if (cookieHeader) browserUpstreamCookieHeader = cookieHeader
      continue
    }
    if (lower === 'authorization' && !allowSessionCredentials) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else if (value !== undefined) {
      headers.set(key, value)
    }
  }
  const upstreamCookieHeader = sessionUpstreamCookieHeader || browserUpstreamCookieHeader
  if (upstreamCookieHeader) headers.set('Cookie', upstreamCookieHeader)
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

function comfyProxyTargetHash(targetBase) {
  return createHash('sha256').update(targetBase).digest('hex').slice(0, 24)
}

function comfyProxyUpstreamCookiePrefix(targetBase) {
  return `__infinity_comfy_upstream_${comfyProxyTargetHash(targetBase)}_`
}

function proxyCookieHeaderForTarget(value, targetBase) {
  const prefix = comfyProxyUpstreamCookiePrefix(targetBase)
  return String(value ?? '')
    .split(';')
    .map((part) => part.trim())
    .map((part) => {
      const separator = part.indexOf('=')
      if (separator === -1) return undefined
      const name = part.slice(0, separator)
      return name.startsWith(prefix) ? `${name.slice(prefix.length)}${part.slice(separator)}` : undefined
    })
    .filter(Boolean)
    .join('; ')
}

function comfyProxySessionCookieHeader(session) {
  if (!session?.upstreamCookies) return undefined
  const value = [...session.upstreamCookies].map(([name, cookieValue]) => `${name}=${cookieValue}`).join('; ')
  return value || undefined
}

function applyComfyProxyUpstreamSetCookies(session, setCookies, targetBase) {
  if (!session) return
  for (const value of setCookies) {
    const firstPart = value.split(';', 1)[0] ?? ''
    const separator = firstPart.indexOf('=')
    if (separator <= 0) continue
    const name = firstPart.slice(0, separator).trim()
    const cookieValue = firstPart.slice(separator + 1)
    const deleted = /(?:^|;)\s*max-age=0(?:;|$)/i.test(value) || cookieValue === ''
    if (deleted) session.upstreamCookies.delete(name)
    else session.upstreamCookies.set(name, cookieValue)
    session.upstreamCookieNames.add(`${comfyProxyUpstreamCookiePrefix(targetBase)}${name}`)
  }
}

function cookieValue(request, name) {
  for (const part of String(request.headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1 || part.slice(0, separator).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(separator + 1).trim())
    } catch {
      return undefined
    }
  }
  return undefined
}

function cleanupExpiredComfyProxySessions(now = Date.now()) {
  for (const [sessionId, session] of comfyProxySessions) {
    if (session.expiresAt <= now) deleteComfyProxySession(sessionId)
  }
}

const comfyProxySessionCleanupTimer = setInterval(cleanupExpiredComfyProxySessions, COMFY_PROXY_SESSION_CLEANUP_MS)
comfyProxySessionCleanupTimer.unref()

function comfyProxySessionCookieName(targetBase) {
  return `${COMFY_PROXY_SESSION_COOKIE_PREFIX}${comfyProxyTargetHash(targetBase)}`
}

function comfyProxySessionContextKey(targetBase, frameOrigin) {
  return `${targetBase}\u0000${frameOrigin}`
}

function deleteComfyProxySession(sessionId) {
  const session = comfyProxySessions.get(sessionId)
  if (!session) return
  const contextKey = comfyProxySessionContextKey(session.targetBase, session.frameOrigin)
  if (comfyProxySessionsByContext.get(contextKey) === sessionId) comfyProxySessionsByContext.delete(contextKey)
  comfyProxySessions.delete(sessionId)
}

function revokeComfyProxySessionsForContext(request, targetBase, frameOrigin) {
  cleanupExpiredComfyProxySessions()
  const upstreamCookieNames = new Set()
  const presentedSessionId = cookieValue(request, comfyProxySessionCookieName(targetBase))
  for (const [sessionId, session] of comfyProxySessions) {
    const matchesContext = session.targetBase === targetBase && session.frameOrigin === frameOrigin
    const matchesPresented = sessionId === presentedSessionId && session.targetBase === targetBase
    if (!matchesContext && !matchesPresented) continue
    for (const cookieName of session.upstreamCookieNames ?? []) upstreamCookieNames.add(cookieName)
    deleteComfyProxySession(sessionId)
  }
  return [...upstreamCookieNames]
}

function createComfyProxySession(targetBase, bearerToken, parentOrigin, frameOrigin, upstreamCookies = new Map()) {
  cleanupExpiredComfyProxySessions()
  const contextKey = comfyProxySessionContextKey(targetBase, frameOrigin)
  const previousSessionId = comfyProxySessionsByContext.get(contextKey)
  if (previousSessionId) deleteComfyProxySession(previousSessionId)
  while (comfyProxySessions.size >= COMFY_PROXY_MAX_SESSIONS) {
    const oldestSessionId = comfyProxySessions.keys().next().value
    if (!oldestSessionId) break
    deleteComfyProxySession(oldestSessionId)
  }
  const sessionId = randomBytes(32).toString('base64url')
  comfyProxySessions.set(sessionId, {
    targetBase,
    bearerToken,
    parentOrigin,
    frameOrigin,
    upstreamCookies,
    upstreamCookieNames: new Set(
      [...upstreamCookies.keys()].map((name) => `${comfyProxyUpstreamCookiePrefix(targetBase)}${name}`),
    ),
    expiresAt: Date.now() + COMFY_PROXY_SESSION_TTL_MS,
  })
  comfyProxySessionsByContext.set(contextKey, sessionId)
  return sessionId
}

function comfyProxySession(request, targetBase) {
  cleanupExpiredComfyProxySessions()
  const sessionId = cookieValue(request, comfyProxySessionCookieName(targetBase))
  const actualOrigin = requestOrigin(request)
  const cookieSession = sessionId ? comfyProxySessions.get(sessionId) : undefined
  if (cookieSession?.targetBase === targetBase && cookieSession.frameOrigin === actualOrigin) return cookieSession
  const contextSessionId = actualOrigin
    ? comfyProxySessionsByContext.get(comfyProxySessionContextKey(targetBase, actualOrigin))
    : undefined
  const contextSession = contextSessionId ? comfyProxySessions.get(contextSessionId) : undefined
  if (contextSession && contextSession.frameOrigin !== contextSession.parentOrigin) return contextSession
  return undefined
}

function comfyProxySessionBearerToken(request, targetBase) {
  return comfyProxySession(request, targetBase)?.bearerToken
}

function requestUsesSecureTransport(request) {
  const forwardedProtocol = String(request.headers['x-forwarded-proto'] ?? '').split(',', 1)[0]?.trim().toLowerCase()
  return Boolean(request.socket?.encrypted) || forwardedProtocol === 'https'
}

function comfyProxySessionCookie(request, targetBase, sessionId, isolatedFrame = false) {
  const attributes = [
    `${comfyProxySessionCookieName(targetBase)}=${sessionId ?? ''}`,
    `Path=${isolatedFrame ? '/' : COMFY_PROXY_PREFIX}`,
    'HttpOnly',
    'SameSite=Strict',
  ]
  if (!sessionId) attributes.push('Max-Age=0')
  if (requestUsesSecureTransport(request)) attributes.push('Secure')
  return attributes.join('; ')
}

function rewriteComfyProxySetCookie(value, proxyBase, targetBase) {
  const parts = value.split(';')
  const firstSeparator = parts[0]?.indexOf('=') ?? -1
  if (firstSeparator <= 0) return undefined
  parts[0] = `${comfyProxyUpstreamCookiePrefix(targetBase)}${parts[0]}`
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

function clearComfyProxyUpstreamCookie(proxyBase, cookieName) {
  return `${cookieName}=; Path=${proxyCookiePath(proxyBase)}; Max-Age=0; HttpOnly; SameSite=Lax`
}

function responseSetCookieValues(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const value = headers.get('set-cookie')
  return value ? [value] : []
}

async function loginToComfyProxyTarget(targetBase, proxyBase, password) {
  const loginUrl = proxiedTargetUrl(allowedComfyProxyTargetUrl(targetBase, '/login'))
  const upstreamResponse = await fetch(loginUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      accept: 'text/html',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ password }).toString(),
  })
  const location = upstreamResponse.headers.get('location')
  const rejected = location ? new URL(location, loginUrl).searchParams.has('wrong_password') : false
  if (upstreamResponse.status < 300 || upstreamResponse.status >= 400 || rejected) {
    throw new ComfyProxyAuthenticationError('ComfyUI password was rejected')
  }
  const rawCookies = responseSetCookieValues(upstreamResponse.headers)
  const responseCookies = rawCookies
    .map((value) => rewriteComfyProxySetCookie(value, proxyBase, targetBase))
    .filter(Boolean)
  if (responseCookies.length === 0) throw new ComfyProxyAuthenticationError('ComfyUI login did not establish a session')
  const cookieSession = { upstreamCookies: new Map(), upstreamCookieNames: new Set() }
  applyComfyProxyUpstreamSetCookies(cookieSession, rawCookies, targetBase)
  return { responseCookies, upstreamCookies: cookieSession.upstreamCookies }
}

function proxiedTargetUrl(targetUrl) {
  const parsed = new URL(targetUrl)
  const isLoopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname)
  if (loopbackProxyHost && isLoopback) parsed.hostname = loopbackProxyHost
  return parsed
}

function comfyProxyServiceWorkerTargetId(targetBase) {
  return Buffer.from(normalizedComfyBaseUrl(targetBase), 'utf8').toString('base64url')
}

function comfyProxyServiceWorkerBase(targetBase) {
  return `${COMFY_PROXY_SERVICE_WORKER_PREFIX}${comfyProxyServiceWorkerTargetId(targetBase)}/`
}

function comfyProxyRequestParts(rawUrl) {
  const requestUrl = new URL(rawUrl ?? '/', 'http://infinity.local')
  const serviceWorkerRoute = requestUrl.pathname.startsWith(COMFY_PROXY_SERVICE_WORKER_PREFIX)
  const prefix = serviceWorkerRoute ? COMFY_PROXY_SERVICE_WORKER_PREFIX : COMFY_PROXY_PREFIX
  if (!requestUrl.pathname.startsWith(prefix)) return undefined

  const pathAfterPrefix = requestUrl.pathname.slice(prefix.length)
  const slashIndex = pathAfterPrefix.indexOf('/')
  const encodedBaseUrl = slashIndex === -1 ? pathAfterPrefix : pathAfterPrefix.slice(0, slashIndex)
  const targetPath = slashIndex === -1 ? '/' : pathAfterPrefix.slice(slashIndex) || '/'
  if (serviceWorkerRoute && !/^[A-Za-z0-9_-]+$/.test(encodedBaseUrl)) {
    throw new ComfyProxyTargetError('ComfyUI Service Worker proxy target is invalid')
  }
  const decodedBaseUrl = serviceWorkerRoute
    ? Buffer.from(encodedBaseUrl, 'base64url').toString('utf8')
    : decodeURIComponent(encodedBaseUrl)
  const targetBase = normalizedComfyBaseUrl(decodedBaseUrl)
  if (serviceWorkerRoute && comfyProxyServiceWorkerTargetId(targetBase) !== encodedBaseUrl) {
    throw new ComfyProxyTargetError('ComfyUI Service Worker proxy target is invalid')
  }
  return {
    requestUrl,
    encodedBaseUrl,
    targetBase,
    targetPath,
    proxyBase: `${prefix}${encodedBaseUrl}/`,
  }
}

function comfyProxyRootResourceRedirect(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return undefined
  if (!request.headers.host || !request.headers.referer) return undefined

  try {
    const protocol = requestUsesSecureTransport(request) ? 'https:' : 'http:'
    const requestOrigin = new URL(`${protocol}//${request.headers.host}`).origin
    const referrerUrl = new URL(String(request.headers.referer))
    if (referrerUrl.origin !== requestOrigin) return undefined

    const referrerParts = comfyProxyRequestParts(`${referrerUrl.pathname}${referrerUrl.search}`)
    if (!referrerParts) return undefined
    allowedComfyProxyTargetUrl(referrerParts.targetBase, '/')
    const session = comfyProxySession(request, referrerParts.targetBase)
    if (!configuredComfyProxyAppOrigins().has(requestOrigin) && session?.frameOrigin !== requestOrigin) return undefined

    const requestUrl = new URL(request.url ?? '/', requestOrigin)
    if (requestUrl.pathname.startsWith(COMFY_PROXY_SERVICE_WORKER_PREFIX)) return undefined
    if (requestUrl.pathname.startsWith(referrerParts.proxyBase)) return undefined

    let relativePath
    if (requestUrl.pathname.startsWith(COMFY_PROXY_PREFIX)) {
      if (!session) return undefined
      try {
        if (comfyProxyRequestParts(`${requestUrl.pathname}${requestUrl.search}`)) return undefined
      } catch {
        // Deep relative imports can escape the encoded target segment; repair them below.
      }
      relativePath = requestUrl.pathname.slice(COMFY_PROXY_PREFIX.length).replace(/^\/+/, '')
    } else {
      const targetBasePath = new URL(`${referrerParts.targetBase}/`).pathname
      relativePath = requestUrl.pathname.startsWith(targetBasePath)
        ? requestUrl.pathname.slice(targetBasePath.length)
        : requestUrl.pathname.replace(/^\/+/, '')
    }
    if (!relativePath) return undefined
    requestUrl.searchParams.delete(COMFY_PROXY_LEGACY_TOKEN_PARAM)
    return `${referrerParts.proxyBase}${relativePath}${requestUrl.search}`
  } catch {
    return undefined
  }
}

function redirectComfyProxyRootResource(request, response) {
  const location = comfyProxyRootResourceRedirect(request)
  if (!location) return false
  response.statusCode = 307
  response.setHeader('cache-control', 'private, no-store')
  response.setHeader('vary', 'referer')
  response.setHeader('location', location)
  response.end()
  return true
}

function comfyProxyAuthRequestParts(rawUrl) {
  const requestUrl = new URL(rawUrl ?? '/', 'http://infinity.local')
  if (!requestUrl.pathname.startsWith(COMFY_PROXY_AUTH_PREFIX)) return undefined

  const encodedBaseUrl = requestUrl.pathname.slice(COMFY_PROXY_AUTH_PREFIX.length).replace(/\/+$/, '')
  if (!encodedBaseUrl || encodedBaseUrl.includes('/') || requestUrl.search) {
    throw new ComfyProxyTargetError('ComfyUI proxy auth target is invalid')
  }
  const targetBase = normalizedComfyBaseUrl(decodeURIComponent(encodedBaseUrl))
  allowedComfyProxyTargetUrl(targetBase, '/')
  return {
    targetBase,
    proxyBase: `${COMFY_PROXY_PREFIX}${encodedBaseUrl}/`,
  }
}

async function handleComfyProxyAuth(request, response) {
  response.setHeader('cache-control', 'no-store')
  response.setHeader('pragma', 'no-cache')
  let rejectionCookies = []
  let rejectionContext
  try {
    const authContext = comfyProxyAuthContext(request)
    if (!authContext) throw new ComfyProxyTargetError('Cross-origin proxy auth requests are not allowed')
    setComfyProxyAuthCors(response, authContext)
    if (request.method === 'OPTIONS') {
      response.statusCode = 204
      response.end()
      return
    }
    if (request.method !== 'POST') {
      response.statusCode = 405
      response.setHeader('allow', 'POST, OPTIONS')
      response.end('Method not allowed')
      return
    }
    const parts = comfyProxyAuthRequestParts(request.url)
    if (!parts) {
      response.statusCode = 404
      response.end('Not found')
      return
    }
    const revokedCookieNames = revokeComfyProxySessionsForContext(
      request,
      parts.targetBase,
      authContext.frameOrigin,
    )
    rejectionCookies = [
      comfyProxySessionCookie(request, parts.targetBase, undefined, authContext.isolatedFrame),
      ...revokedCookieNames.map((name) => clearComfyProxyUpstreamCookie(parts.proxyBase, name)),
    ]
    rejectionContext = { parts, authContext }
    if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      response.statusCode = 415
      response.setHeader('set-cookie', rejectionCookies)
      response.end('Expected application/json')
      return
    }
    const body = await readRequestBody(request, 16 * 1024)

    const payload = JSON.parse(body.toString('utf8') || '{}')
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('Invalid proxy auth payload')
    const rawToken = payload.bearerToken
    if (rawToken !== undefined && typeof rawToken !== 'string') throw new TypeError('Invalid proxy bearer token')
    const bearerToken = rawToken?.trim()
    if (bearerToken && (bearerToken.length > 8192 || !/^[\x21-\x7e]+$/.test(bearerToken))) {
      throw new TypeError('Invalid proxy bearer token')
    }
    const rawPassword = payload.password
    if (rawPassword !== undefined && typeof rawPassword !== 'string') throw new TypeError('Invalid ComfyUI password')
    const password = rawPassword || undefined
    if (password && (Buffer.byteLength(password, 'utf8') > 4096 || password.includes('\0'))) {
      throw new TypeError('Invalid ComfyUI password')
    }

    const upstreamLogin = password
      ? await loginToComfyProxyTarget(parts.targetBase, parts.proxyBase, password)
      : { responseCookies: [], upstreamCookies: new Map() }

    const sessionId = createComfyProxySession(
      parts.targetBase,
      bearerToken,
      authContext.parentOrigin,
      authContext.frameOrigin,
      upstreamLogin.upstreamCookies,
    )
    response.statusCode = 204
    response.setHeader('set-cookie', [
      comfyProxySessionCookie(request, parts.targetBase, sessionId, authContext.isolatedFrame),
      ...rejectionCookies.slice(1),
      ...upstreamLogin.responseCookies,
    ])
    response.end()
  } catch (error) {
    if (rejectionContext) {
      const extraCookieNames = revokeComfyProxySessionsForContext(
        request,
        rejectionContext.parts.targetBase,
        rejectionContext.authContext.frameOrigin,
      )
      rejectionCookies.push(
        ...extraCookieNames.map((name) => clearComfyProxyUpstreamCookie(rejectionContext.parts.proxyBase, name)),
      )
    }
    if (rejectionCookies.length > 0) response.setHeader('set-cookie', rejectionCookies)
    response.statusCode =
      error instanceof ComfyProxyTargetError
        ? 403
        : error instanceof ComfyProxyAuthenticationError
          ? 401
          : error instanceof RequestBodyTooLargeError
            ? 413
            : 400
    response.setHeader('content-type', 'text/plain; charset=utf-8')
    response.end(
      error instanceof ComfyProxyTargetError
        ? error.message
        : error instanceof ComfyProxyAuthenticationError
          ? error.message
        : error instanceof RequestBodyTooLargeError
          ? 'Proxy auth payload is too large'
          : 'Invalid ComfyUI proxy auth request',
    )
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

function websocketProxyHeaders(
  request,
  targetUrl,
  bearerToken,
  targetBase,
  allowSessionCredentials,
  sessionUpstreamCookieHeader,
) {
  const headers = []
  const seen = new Set()
  let browserUpstreamCookieHeader
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const key = request.rawHeaders[index]
    const value = request.rawHeaders[index + 1]
    const lower = key.toLowerCase()
    if (blockedWebSocketProxyHeaders.has(lower)) continue
    if (lower === 'cookie') {
      if (!allowSessionCredentials) continue
      const cookieHeader = proxyCookieHeaderForTarget(value, targetBase)
      if (cookieHeader) browserUpstreamCookieHeader = cookieHeader
    } else if (lower === 'authorization' && !allowSessionCredentials) {
      continue
    } else if (lower === 'origin') {
      headers.push(`${key}: ${websocketOriginFor(targetUrl)}`)
    } else {
      headers.push(`${key}: ${value}`)
    }
    seen.add(lower)
  }

  headers.unshift(`Host: ${targetUrl.host}`, 'Connection: Upgrade', 'Upgrade: websocket')
  const upstreamCookieHeader = sessionUpstreamCookieHeader || browserUpstreamCookieHeader
  if (upstreamCookieHeader) headers.push(`Cookie: ${upstreamCookieHeader}`)
  if (!seen.has('origin')) headers.push(`Origin: ${websocketOriginFor(targetUrl)}`)
  if (bearerToken && !seen.has('authorization')) headers.push(`Authorization: Bearer ${bearerToken}`)
  return headers
}

function scriptSafeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

function comfyProxyBridge(proxyBase, targetBase, parentOrigin) {
  const serviceWorkerProxyBase = comfyProxyServiceWorkerBase(targetBase)
  if (parentOrigin) {
    return comfyProxyBridgeModule.comfyProxyBridge(
      proxyBase,
      targetBase,
      COMFY_PROXY_LEGACY_TOKEN_PARAM,
      parentOrigin,
      serviceWorkerProxyBase,
    )
  }
  return `<script>
(() => {
  const proxyBase = ${scriptSafeJson(proxyBase)};
  const serviceWorkerProxyBase = ${scriptSafeJson(serviceWorkerProxyBase)};
  const targetBase = ${scriptSafeJson(targetBase)};
  const legacyTokenParam = ${scriptSafeJson(COMFY_PROXY_LEGACY_TOKEN_PARAM)};
  const currentUrl = new URL(location.href);
  if (currentUrl.searchParams.delete(legacyTokenParam)) {
    history.replaceState(history.state, '', currentUrl.pathname + currentUrl.search + currentUrl.hash);
  }
  const exposeModernComfyApp = () => {
    const modernApp = window.comfyAPI?.app?.app;
    if (!window.app && modernApp?.graphToPrompt) window.app = modernApp;
    return Boolean(window.app?.graphToPrompt);
  };
  if (!exposeModernComfyApp()) {
    const appCompatibilityTimer = window.setInterval(() => {
      if (exposeModernComfyApp()) window.clearInterval(appCompatibilityTimer);
    }, 100);
    window.setTimeout(() => window.clearInterval(appCompatibilityTimer), 120000);
  }
  const withinProxy = (value) => {
    try {
      const parsed = new URL(value, location.href);
      if (parsed.origin !== location.origin || !parsed.pathname.startsWith(proxyBase)) return value;
      parsed.searchParams.delete(legacyTokenParam);
      return parsed.pathname + parsed.search + parsed.hash;
    } catch {
      return value;
    }
  };
  const proxiedPath = (pathname, search = '', hash = '') =>
    withinProxy(proxyBase + String(pathname || '/').replace(/^\\/+/, '') + search + hash);
  const proxiedWebSocketUrl = (pathname, search = '', hash = '') => {
    const routed = new URL(proxiedPath(pathname, search, hash), location.href);
    routed.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return routed.toString();
  };
  const route = (value) => {
    const raw = String(value);
    if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
    if (raw.startsWith(proxyBase)) return withinProxy(raw);
    if (raw.startsWith('//')) {
      try {
        const parsed = new URL(raw, location.href);
        const target = new URL(targetBase);
        if (parsed.origin === location.origin || parsed.origin === target.origin) {
          return proxiedPath(parsed.pathname, parsed.search, parsed.hash);
        }
      } catch {}
      return raw;
    }
    if (raw.startsWith('/')) return withinProxy(proxyBase + raw.slice(1));
    try {
      const parsed = new URL(raw, location.href);
      const target = new URL(targetBase);
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin === target.origin) {
        return proxiedPath(parsed.pathname, parsed.search, parsed.hash);
      }
      if (parsed.origin === location.origin && parsed.pathname.startsWith(proxyBase)) {
        return withinProxy(parsed.pathname + parsed.search + parsed.hash);
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
        const routed = new URL(withinProxy(parsed.pathname + parsed.search + parsed.hash), location.href);
        routed.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        return routed.toString();
      }
      if (parsed.origin === location.origin && parsed.pathname.startsWith(proxyBase)) {
        const routed = new URL(withinProxy(parsed.pathname + parsed.search + parsed.hash), location.href);
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
  const withinServiceWorkerProxy = (value) => {
    try {
      const parsed = new URL(value, location.href);
      if (parsed.origin !== location.origin || !parsed.pathname.startsWith(serviceWorkerProxyBase)) return value;
      parsed.searchParams.delete(legacyTokenParam);
      return parsed.pathname + parsed.search + parsed.hash;
    } catch {
      return value;
    }
  };
  const routeServiceWorker = (value) => {
    const raw = String(value);
    try {
      const parsed = new URL(raw, location.href);
      if (parsed.origin === location.origin && parsed.pathname.startsWith(serviceWorkerProxyBase)) {
        return withinServiceWorkerProxy(parsed.pathname + parsed.search + parsed.hash);
      }
    } catch {}
    const routed = route(raw);
    try {
      const parsed = new URL(routed, location.href);
      if (parsed.origin === location.origin && parsed.pathname.startsWith(proxyBase)) {
        return withinServiceWorkerProxy(
          serviceWorkerProxyBase + parsed.pathname.slice(proxyBase.length) + parsed.search + parsed.hash,
        );
      }
    } catch {}
    return routed;
  };
  if (navigator.serviceWorker?.register) {
    const serviceWorker = navigator.serviceWorker;
    const nativeServiceWorkerRegister = serviceWorker.register.bind(serviceWorker);
    serviceWorker.register = (scriptURL, options) => {
      const routedScriptURL = routeServiceWorker(scriptURL);
      const routedScope = options?.scope === undefined ? undefined : routeServiceWorker(options.scope);
      return nativeServiceWorkerRegister(
        routedScriptURL,
        routedScope === undefined ? options : { ...options, scope: routedScope },
      );
    };
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

function injectComfyProxyBridge(html, proxyBase, targetBase, parentOrigin) {
  const bridge = comfyProxyBridge(proxyBase, targetBase, parentOrigin)
  return html.includes('</head>') ? html.replace('</head>', `${bridge}</head>`) : `${bridge}${html}`
}

function rewriteComfyProxyLocation(value, proxyBase, targetBase) {
  try {
    const allowedBaseUrl = new URL(`${targetBase}/`)
    const parsed = new URL(value, allowedBaseUrl)
    const allowedPathPrefix = allowedBaseUrl.pathname
    const targetStaysInAllowedBase =
      parsed.origin === allowedBaseUrl.origin &&
      (parsed.pathname === allowedPathPrefix.slice(0, -1) || parsed.pathname.startsWith(allowedPathPrefix))
    if (!targetStaysInAllowedBase) throw new ComfyProxyTargetError('ComfyUI proxy redirect is not allowed')
    parsed.searchParams.delete(COMFY_PROXY_LEGACY_TOKEN_PARAM)
    const relativePath =
      parsed.pathname === allowedPathPrefix.slice(0, -1) ? '' : parsed.pathname.slice(allowedPathPrefix.length)
    return `${proxyBase}${relativePath}${parsed.search}${parsed.hash}`
  } catch {
    throw new ComfyProxyTargetError('ComfyUI proxy redirect is not allowed')
  }
}

function rewriteComfyProxyResponseHeader(key, value, proxyBase, targetBase) {
  if (key.toLowerCase() === 'location') return rewriteComfyProxyLocation(value, proxyBase, targetBase)
  if (key.toLowerCase() === 'set-cookie') return rewriteComfyProxySetCookie(value, proxyBase, targetBase)
  return value
}

function setComfyProxyResponseHeaders(response, headers, proxyBase, targetBase, session) {
  const setCookies =
    typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : headers.get('set-cookie') ? [headers.get('set-cookie')] : []
  headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (lower === 'set-cookie' || blockedProxyHeaders.has(lower)) return
    response.setHeader(key, rewriteComfyProxyResponseHeader(key, value, proxyBase, targetBase))
  })
  if (setCookies.length > 0) {
    applyComfyProxyUpstreamSetCookies(session, setCookies, targetBase)
    response.setHeader(
      'set-cookie',
      setCookies.map((value) => rewriteComfyProxySetCookie(value, proxyBase, targetBase)).filter(Boolean),
    )
  }
}

async function handleComfyProxy(request, response) {
  try {
    const parts = comfyProxyRequestParts(request.url)
    if (!parts) {
      response.statusCode = 404
      response.end('Not found')
      return
    }
    const { requestUrl, targetPath, targetBase, proxyBase } = parts
    assertAllowedProxyRequestOrigin(request, targetBase)
    const session = comfyProxySession(request, targetBase)
    const targetUrl = proxiedTargetUrl(allowedComfyProxyTargetUrl(targetBase, targetPath))
    if (requestUrl.searchParams.has(COMFY_PROXY_LEGACY_TOKEN_PARAM)) {
      response.setHeader('cache-control', 'no-store')
      response.setHeader('referrer-policy', 'no-referrer')
      const accept = String(request.headers.accept ?? '').toLowerCase()
      if ((request.method === 'GET' || request.method === 'HEAD') && accept.includes('text/html')) {
        const cleanUrl = new URL(requestUrl)
        cleanUrl.searchParams.delete(COMFY_PROXY_LEGACY_TOKEN_PARAM)
        response.statusCode = 302
        response.setHeader('location', `${cleanUrl.pathname}${cleanUrl.search}`)
        response.end()
      } else {
        response.statusCode = 400
        response.setHeader('content-type', 'text/plain; charset=utf-8')
        response.end('Legacy ComfyUI proxy credentials in URLs are not accepted')
      }
      return
    }
    targetUrl.search = requestUrl.search
    const upstreamBearerToken = await upstreamProxyBearerToken(
      targetBase,
      session?.bearerToken,
    )

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
    const bodyBuffer = hasBody ? await readRequestBody(request) : undefined
    const proxied = await fetch(targetUrl, {
      method: request.method,
      headers: await proxyRequestHeaders(
        request,
        shouldAttachProxyBearer(request, targetUrl) ? upstreamBearerToken : undefined,
        targetBase,
        Boolean(session),
        comfyProxySessionCookieHeader(session),
      ),
      body: bodyBuffer,
      redirect: 'manual',
    })
    const contentType = proxied.headers.get('content-type') ?? ''
    response.statusCode = proxied.status
    setComfyProxyResponseHeaders(response, proxied.headers, proxyBase, targetBase, session)
    if (contentType.includes('text/html')) {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(
        injectComfyProxyBridge(
          await proxied.text(),
          proxyBase,
          targetBase,
          session?.parentOrigin ?? requestOrigin(request),
        ),
      )
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
  if (request.url?.startsWith(COMFY_PROXY_AUTH_PREFIX)) {
    void handleComfyProxyAuth(request, response)
    return
  }
  if (redirectComfyProxyRootResource(request, response)) return
  if (
    request.url?.startsWith(COMFY_PROXY_PREFIX) ||
    request.url?.startsWith(COMFY_PROXY_SERVICE_WORKER_PREFIX)
  ) {
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
      const parts = comfyProxyRequestParts(request.url)
      if (!parts) {
        socket.destroy()
        return
      }
      const { requestUrl, targetPath, targetBase } = parts
      assertAllowedProxyRequestOrigin(request, targetBase)
      const session = comfyProxySession(request, targetBase)
      const targetUrl = proxiedTargetUrl(allowedComfyProxyTargetUrl(targetBase, targetPath))
      if (requestUrl.searchParams.has(COMFY_PROXY_LEGACY_TOKEN_PARAM)) {
        throw new ComfyProxyTargetError('Legacy ComfyUI proxy credentials in URLs are not accepted')
      }
      targetUrl.protocol = targetUrl.protocol === 'https:' ? 'wss:' : 'ws:'
      targetUrl.search = requestUrl.search
      const upstreamBearerToken = await upstreamProxyBearerToken(
        targetBase,
        session?.bearerToken,
      )
      const portNumber = Number(targetUrl.port || (targetUrl.protocol === 'wss:' ? 443 : 80))
      const connectOptions = { host: targetUrl.hostname, port: portNumber, servername: targetUrl.hostname }
      const upstream =
        targetUrl.protocol === 'wss:' ? tls.connect(connectOptions, onConnect) : net.connect(connectOptions, onConnect)

      function onConnect() {
        const pathAndSearch = `${targetUrl.pathname}${targetUrl.search}`
        upstream.write(
          `GET ${pathAndSearch} HTTP/1.1\r\n${websocketProxyHeaders(
            request,
            targetUrl,
                upstreamBearerToken,
                targetBase,
                Boolean(session),
                comfyProxySessionCookieHeader(session),
          ).join('\r\n')}\r\n\r\n`,
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
