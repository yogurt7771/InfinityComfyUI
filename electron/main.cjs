const { app, BrowserWindow, ipcMain, shell } = require('electron')
const { createHash, randomBytes } = require('node:crypto')
const http = require('node:http')
const net = require('node:net')
const fs = require('node:fs/promises')
const path = require('node:path')
const tls = require('node:tls')
const { hydrateProjectAssets } = require('./projectAssetStorage.cjs')
const comfyProxyBridgeModule = require('../server/comfyProxyBridge.cjs')

const PROJECTS_FOLDER = 'projects'
const CONFIG_FOLDER = 'config'
const ASSETS_FOLDER = 'assets'
const COMFY_PROXY_SEGMENT = '__comfy_proxy'
const COMFY_PROXY_PREFIX = `/${COMFY_PROXY_SEGMENT}/`
const COMFY_PROXY_AUTH_PREFIX = '/__comfy_proxy/auth/'
const COMFY_PROXY_LEGACY_TOKEN_PARAM = '__infinity_comfy_token'
const COMFY_PROXY_SESSION_COOKIE_PREFIX = '__infinity_comfy_session_'
const COMFY_PROXY_SESSION_TTL_MS = 8 * 60 * 60 * 1000
const COMFY_PROXY_SESSION_CLEANUP_MS = 10 * 60 * 1000
const COMFY_PROXY_MAX_SESSIONS = 256
const comfyProxySessions = new Map()
const comfyProxySessionsByContext = new Map()
const authorizedComfyProxyTargets = new Set()
let localAppServer
let localAppServerUrl

const safeSegment = (value, fallback) => {
  const cleaned = String(value ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 96)

  return cleaned || fallback
}

const portableExecutableDirectory = () => {
  const directory = process.env.PORTABLE_EXECUTABLE_DIR
  return typeof directory === 'string' && directory.trim() ? directory : undefined
}

const appDirectory = () =>
  app.isPackaged ? portableExecutableDirectory() ?? path.dirname(app.getPath('exe')) : path.join(__dirname, '..')

const writableDirectory = async (directory) => {
  await fs.mkdir(directory, { recursive: true })
  const probe = path.join(directory, `.write-test-${process.pid}`)
  await fs.writeFile(probe, 'ok')
  await fs.unlink(probe)
  return directory
}

const projectsRoot = async () => {
  const besideExecutable = path.join(appDirectory(), PROJECTS_FOLDER)
  try {
    return await writableDirectory(besideExecutable)
  } catch {
    return writableDirectory(path.join(app.getPath('userData'), PROJECTS_FOLDER))
  }
}

const writeJson = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.tmp`
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await fs.rename(tempPath, filePath)
}

const readJson = async (filePath) => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch {
    return undefined
  }
}

const projectFolderName = (project) => {
  const name = safeSegment(project?.project?.name, 'Project')
  const id = safeSegment(project?.project?.id, 'project')
  return `${name}__${id}`
}

const dataUrlToBuffer = (url) => {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url)
  if (!match) return undefined
  const body = match[3] ?? ''
  return {
    mimeType: match[1] || 'application/octet-stream',
    buffer: match[2] ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body)),
  }
}

const extensionForMime = (mimeType) => {
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/png') return '.png'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/gif') return '.gif'
  if (mimeType === 'video/mp4') return '.mp4'
  if (mimeType === 'audio/mpeg') return '.mp3'
  if (mimeType === 'audio/wav') return '.wav'
  if (mimeType === 'audio/ogg') return '.ogg'
  return ''
}

const fileExtension = (filename, mimeType) => path.extname(filename || '') || extensionForMime(mimeType)

const appIconPath = () =>
  app.isPackaged ? path.join(process.resourcesPath, 'icon.ico') : path.join(__dirname, '..', 'build', 'icon.ico')

const normalizedComfyBaseUrl = (baseUrl) => {
  const parsed = new URL(baseUrl)
  parsed.hash = ''
  parsed.search = ''
  return parsed.toString().replace(/\/+$/, '')
}

const configuredValueList = (value) => {
  const configured = String(value ?? '').trim()
  if (!configured) return []
  if (!configured.startsWith('[')) return [configured]
  const parsed = JSON.parse(configured)
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new ComfyProxyTargetError('Configured proxy target list is invalid')
  }
  return parsed.map((item) => item.trim()).filter(Boolean)
}

const authorizeConfiguredComfyProxyTargets = () => {
  const candidates = [process.env.COMFY_PROXY_TARGET_BASE, ...configuredValueList(process.env.COMFY_PROXY_TARGET_BASES)]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      authorizedComfyProxyTargets.add(validatedComfyProxyTargetBase(candidate))
    }
  }
}

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

class ComfyProxyTargetError extends Error {}
class RequestBodyTooLargeError extends Error {}
class ComfyProxyAuthenticationError extends Error {}

const readRequestBody = (request, maxBytes = Number.POSITIVE_INFINITY) =>
  new Promise((resolve, reject) => {
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

const comfyProxyTokenFromFileContent = (content) => {
  const token = content.split(/\r?\n/, 1)[0]?.trim()
  return token || undefined
}

const configuredProxyBearerToken = async (targetBase) => {
  const primaryTarget = process.env.COMFY_PROXY_TARGET_BASE?.trim()
  if (!primaryTarget || normalizedComfyBaseUrl(primaryTarget) !== targetBase) return undefined
  const envToken = process.env.COMFY_PROXY_BEARER_TOKEN?.trim()
  if (envToken) return envToken

  const tokenFile = process.env.COMFY_PROXY_TOKEN_FILE?.trim()
  if (!tokenFile) return undefined

  try {
    return comfyProxyTokenFromFileContent(await fs.readFile(tokenFile, 'utf8'))
  } catch {
    return undefined
  }
}

const proxyRequestHeaders = async (
  request,
  bearerToken,
  targetBase,
  allowSessionCredentials,
  sessionUpstreamCookieHeader,
) => {
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

const shouldAttachProxyBearer = (request, targetUrl) => {
  const accept = String(request.headers.accept || '').toLowerCase()
  if (accept.includes('text/html')) return false
  const pathname = targetUrl.pathname.toLowerCase()
  const staticFileExtension = /\.[a-z0-9]{1,8}$/.test(pathname)
  return !staticFileExtension || pathname.endsWith('.json')
}

const requestOrigin = (request) => {
  if (!request.headers.host) return undefined
  try {
    return new URL(`http://${request.headers.host}`).origin
  } catch {
    return undefined
  }
}

const proxyRequestIsSameOrigin = (request, targetBase) => {
  const fetchSite = String(request.headers['sec-fetch-site'] ?? '').trim().toLowerCase()
  const origin = String(request.headers.origin ?? '').trim()
  if (!localAppServerUrl || origin === 'null') return false
  try {
    const trustedOrigin = new URL(localAppServerUrl).origin
    const actualOrigin = requestOrigin(request)
    if (!actualOrigin) return false
    const session = comfyProxySession(request, targetBase)
    const fetchDestination = String(request.headers['sec-fetch-dest'] ?? '').trim().toLowerCase()
    const isolatedFrameNavigation =
      fetchSite === 'cross-site' &&
      session?.frameOrigin === actualOrigin &&
      (request.method === 'GET' || request.method === 'HEAD') &&
      (fetchDestination === 'iframe' || fetchDestination === 'document')
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none' && !isolatedFrameNavigation) return false
    const trustedRequestOrigin =
      actualOrigin === trustedOrigin || session?.frameOrigin === actualOrigin
    if (!trustedRequestOrigin) return false
    if (!origin || origin === 'undefined') return true
    if (new URL(origin).origin !== actualOrigin) return false
    return true
  } catch {
    return false
  }
}

const assertAllowedProxyRequestOrigin = (request, targetBase) => {
  if (!proxyRequestIsSameOrigin(request, targetBase)) {
    throw new ComfyProxyTargetError('Cross-origin ComfyUI proxy requests are not allowed')
  }
}

const comfyProxyTargetHash = (targetBase) => createHash('sha256').update(targetBase).digest('hex').slice(0, 24)

const comfyProxyUpstreamCookiePrefix = (targetBase) =>
  `__infinity_comfy_upstream_${comfyProxyTargetHash(targetBase)}_`

const proxyCookieHeaderForTarget = (value, targetBase) => {
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

const comfyProxySessionCookieHeader = (session) => {
  const value = session ? [...session.upstreamCookies].map(([name, cookieValue]) => `${name}=${cookieValue}`).join('; ') : ''
  return value || undefined
}

const applyComfyProxyUpstreamSetCookies = (session, setCookies, targetBase) => {
  if (!session) return
  for (const value of setCookies) {
    const firstPart = value.split(';', 1)[0] || ''
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

const cookieValue = (request, name) => {
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

const cleanupExpiredComfyProxySessions = (now = Date.now()) => {
  for (const [sessionId, session] of comfyProxySessions) {
    if (session.expiresAt <= now) deleteComfyProxySession(sessionId)
  }
}

const comfyProxySessionCleanupTimer = setInterval(cleanupExpiredComfyProxySessions, COMFY_PROXY_SESSION_CLEANUP_MS)
comfyProxySessionCleanupTimer.unref()

const comfyProxySessionCookieName = (targetBase) =>
  `${COMFY_PROXY_SESSION_COOKIE_PREFIX}${comfyProxyTargetHash(targetBase)}`

const comfyProxySessionContextKey = (targetBase, frameOrigin) => `${targetBase}\u0000${frameOrigin}`

const deleteComfyProxySession = (sessionId) => {
  const session = comfyProxySessions.get(sessionId)
  if (!session) return
  const contextKey = comfyProxySessionContextKey(session.targetBase, session.frameOrigin)
  if (comfyProxySessionsByContext.get(contextKey) === sessionId) comfyProxySessionsByContext.delete(contextKey)
  comfyProxySessions.delete(sessionId)
}

const revokeComfyProxySessionsForContext = (request, targetBase, frameOrigin) => {
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

const createComfyProxySession = (targetBase, bearerToken, parentOrigin, frameOrigin, upstreamCookies = new Map()) => {
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

const comfyProxySession = (request, targetBase) => {
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

const comfyProxySessionCookie = (targetBase, sessionId, isolatedFrame = false) => {
  const attributes = [
    `${comfyProxySessionCookieName(targetBase)}=${sessionId ?? ''}`,
    `Path=${isolatedFrame ? '/' : COMFY_PROXY_PREFIX}`,
    'HttpOnly',
    'SameSite=Strict',
  ]
  if (!sessionId) attributes.push('Max-Age=0')
  return attributes.join('; ')
}

const proxyCookiePath = (proxyBase) => (proxyBase.endsWith('/') ? proxyBase : `${proxyBase}/`)

const rewriteComfyProxySetCookie = (value, proxyBase, targetBase) => {
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

const clearComfyProxyUpstreamCookie = (proxyBase, cookieName) =>
  `${cookieName}=; Path=${proxyCookiePath(proxyBase)}; Max-Age=0; HttpOnly; SameSite=Lax`

const responseSetCookieValues = (headers) => {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const value = headers.get('set-cookie')
  return value ? [value] : []
}

const loginToComfyProxyTarget = async (targetBase, proxyBase, password) => {
  const loginUrl = allowedComfyProxyTargetUrl(targetBase, '/login')
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

const comfyProxyRequestParts = (rawUrl) => {
  const requestUrl = new URL(rawUrl || '/', 'http://127.0.0.1')
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

const comfyProxyRootResourceRedirect = (request) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return undefined
  if (!localAppServerUrl || !request.headers.host || !request.headers.referer) return undefined

  try {
    const requestOrigin = new URL(`http://${request.headers.host}`).origin
    const trustedOrigin = new URL(localAppServerUrl).origin
    const referrerUrl = new URL(String(request.headers.referer))
    if (referrerUrl.origin !== requestOrigin) return undefined

    const referrerParts = comfyProxyRequestParts(`${referrerUrl.pathname}${referrerUrl.search}`)
    if (!referrerParts) return undefined
    const session = comfyProxySession(request, referrerParts.targetBase)
    if (requestOrigin !== trustedOrigin && session?.frameOrigin !== requestOrigin) return undefined
    allowedComfyProxyTargetUrl(referrerParts.targetBase, '/', Boolean(session))

    const requestUrl = new URL(request.url || '/', trustedOrigin)
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

const redirectComfyProxyRootResource = (request, response) => {
  const location = comfyProxyRootResourceRedirect(request)
  if (!location) return false
  response.statusCode = 307
  response.setHeader('cache-control', 'private, no-store')
  response.setHeader('vary', 'referer')
  response.setHeader('location', location)
  response.end()
  return true
}

const validatedComfyProxyTargetBase = (targetBase) => {
  const normalizedTarget = normalizedComfyBaseUrl(targetBase)
  const parsed = new URL(normalizedTarget)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new ComfyProxyTargetError('ComfyUI proxy target is invalid')
  }
  return normalizedTarget
}

const allowedComfyProxyTargetUrl = (targetBase, targetPath, allowUnregistered = false) => {
  const allowedTargetBase = validatedComfyProxyTargetBase(targetBase)
  if (!allowUnregistered && !authorizedComfyProxyTargets.has(allowedTargetBase)) {
    throw new ComfyProxyTargetError('ComfyUI proxy target is not authorized')
  }
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
  const allowedBaseUrl = new URL(`${allowedTargetBase}/`)
  const targetUrl = new URL(targetPath.replace(/^\/+/, ''), allowedBaseUrl)
  const allowedPathPrefix = allowedBaseUrl.pathname
  if (
    targetUrl.origin !== allowedBaseUrl.origin ||
    (targetUrl.pathname !== allowedPathPrefix.slice(0, -1) && !targetUrl.pathname.startsWith(allowedPathPrefix))
  ) {
    throw new ComfyProxyTargetError('ComfyUI proxy path is not allowed')
  }
  return targetUrl
}

const comfyProxyAuthRequestParts = (rawUrl) => {
  const requestUrl = new URL(rawUrl || '/', 'http://127.0.0.1')
  if (!requestUrl.pathname.startsWith(COMFY_PROXY_AUTH_PREFIX)) return undefined
  const encodedBaseUrl = requestUrl.pathname.slice(COMFY_PROXY_AUTH_PREFIX.length).replace(/\/+$/, '')
  if (!encodedBaseUrl || encodedBaseUrl.includes('/') || requestUrl.search) {
    throw new ComfyProxyTargetError('Invalid proxy auth target')
  }
  const targetBase = validatedComfyProxyTargetBase(decodeURIComponent(encodedBaseUrl))
  return {
    targetBase,
    proxyBase: `${COMFY_PROXY_PREFIX}${encodedBaseUrl}/`,
  }
}

const isolatedFrameOriginMatchesParent = (frameOrigin, parentOrigin) => {
  try {
    const frame = new URL(frameOrigin)
    const parent = new URL(parentOrigin)
    return (
      frame.protocol === parent.protocol &&
      frame.port === parent.port &&
      /^frame-[a-f0-9]{32}\.localhost$/.test(frame.hostname.toLowerCase())
    )
  } catch {
    return false
  }
}

const comfyProxyAuthContext = (request) => {
  if (!localAppServerUrl) return undefined
  const fetchSite = String(request.headers['sec-fetch-site'] ?? '').trim().toLowerCase()
  if (fetchSite && !['same-origin', 'same-site', 'cross-site', 'none'].includes(fetchSite)) return undefined
  const frameOrigin = requestOrigin(request)
  const rawOrigin = String(request.headers.origin ?? '').trim()
  if (!frameOrigin || rawOrigin === 'null') return undefined
  try {
    const trustedOrigin = new URL(localAppServerUrl).origin
    const parentOrigin = rawOrigin && rawOrigin !== 'undefined' ? new URL(rawOrigin).origin : frameOrigin
    if (parentOrigin !== trustedOrigin) return undefined
    if (frameOrigin !== parentOrigin && !isolatedFrameOriginMatchesParent(frameOrigin, parentOrigin)) return undefined
    return { frameOrigin, parentOrigin, isolatedFrame: frameOrigin !== parentOrigin }
  } catch {
    return undefined
  }
}

const setComfyProxyAuthCors = (response, context) => {
  if (!context.isolatedFrame) return
  response.setHeader('access-control-allow-origin', context.parentOrigin)
  response.setHeader('access-control-allow-credentials', 'true')
  response.setHeader('access-control-allow-methods', 'POST, OPTIONS')
  response.setHeader('access-control-allow-headers', 'Content-Type')
  response.setHeader('vary', 'Origin')
}

const handleComfyProxyAuth = async (request, response) => {
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
    if (!authorizedComfyProxyTargets.has(parts.targetBase)) {
      throw new ComfyProxyTargetError('ComfyUI proxy target is not authorized')
    }
    const revokedCookieNames = revokeComfyProxySessionsForContext(request, parts.targetBase, authContext.frameOrigin)
    rejectionCookies = [
      comfyProxySessionCookie(parts.targetBase, undefined, authContext.isolatedFrame),
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
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid proxy auth payload')
    const rawToken = payload.bearerToken
    if (rawToken !== undefined && typeof rawToken !== 'string') throw new Error('Invalid proxy bearer token')
    const bearerToken = rawToken?.trim()
    if (bearerToken && (bearerToken.length > 8192 || !/^[\x21-\x7e]+$/.test(bearerToken))) {
      throw new Error('Invalid proxy bearer token')
    }
    const rawPassword = payload.password
    if (rawPassword !== undefined && typeof rawPassword !== 'string') throw new Error('Invalid ComfyUI password')
    const password = rawPassword || undefined
    if (password && (Buffer.byteLength(password, 'utf8') > 4096 || password.includes('\0'))) {
      throw new Error('Invalid ComfyUI password')
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
      comfyProxySessionCookie(parts.targetBase, sessionId, authContext.isolatedFrame),
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

const websocketOriginFor = (targetUrl) => `${targetUrl.protocol === 'wss:' ? 'https:' : 'http:'}//${targetUrl.host}`

const blockedWebSocketProxyHeaders = new Set([
  'connection',
  'content-length',
  'host',
  'proxy-authenticate',
  'proxy-authorization',
  'sec-websocket-accept',
  'upgrade',
])

const websocketProxyHeaders = (
  request,
  targetUrl,
  bearerToken,
  targetBase,
  allowSessionCredentials,
  sessionUpstreamCookieHeader,
) => {
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
    } else {
      headers.push(lower === 'origin' ? `${key}: ${websocketOriginFor(targetUrl)}` : `${key}: ${value}`)
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

const comfyProxyBridge = (proxyBase, targetBase, parentOrigin) =>
  parentOrigin
    ? comfyProxyBridgeModule.comfyProxyBridge(proxyBase, targetBase, COMFY_PROXY_LEGACY_TOKEN_PARAM, parentOrigin)
    : `<script>
(() => {
  const proxyBase = ${JSON.stringify(proxyBase)};
  const targetBase = ${JSON.stringify(targetBase)};
  const legacyTokenParam = ${JSON.stringify(COMFY_PROXY_LEGACY_TOKEN_PARAM)};
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

const injectComfyProxyBridge = (html, proxyBase, targetBase, parentOrigin) => {
  const bridge = comfyProxyBridge(proxyBase, targetBase, parentOrigin)
  return html.includes('</head>') ? html.replace('</head>', `${bridge}</head>`) : `${bridge}${html}`
}

const rewriteComfyProxyLocation = (value, proxyBase, targetBase) => {
  try {
    const allowedBaseUrl = new URL(`${targetBase}/`)
    const parsed = new URL(value, allowedBaseUrl)
    const allowedPathPrefix = allowedBaseUrl.pathname
    if (
      parsed.origin !== allowedBaseUrl.origin ||
      (parsed.pathname !== allowedPathPrefix.slice(0, -1) && !parsed.pathname.startsWith(allowedPathPrefix))
    ) {
      throw new ComfyProxyTargetError('ComfyUI proxy redirect is not allowed')
    }
    parsed.searchParams.delete(COMFY_PROXY_LEGACY_TOKEN_PARAM)
    const relativePath =
      parsed.pathname === allowedPathPrefix.slice(0, -1) ? '' : parsed.pathname.slice(allowedPathPrefix.length)
    return `${proxyBase}${relativePath}${parsed.search}${parsed.hash}`
  } catch {
    throw new ComfyProxyTargetError('ComfyUI proxy redirect is not allowed')
  }
}

const rewriteComfyProxyResponseHeader = (key, value, proxyBase, targetBase) => {
  if (key.toLowerCase() === 'location') return rewriteComfyProxyLocation(value, proxyBase, targetBase)
  if (key.toLowerCase() === 'set-cookie') return rewriteComfyProxySetCookie(value, proxyBase, targetBase)
  return value
}

const setComfyProxyResponseHeaders = (response, headers, proxyBase, targetBase, session) => {
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

const serveComfyProxy = async (request, response, requestUrl) => {
  const parts = comfyProxyRequestParts(requestUrl.pathname + requestUrl.search)
  if (!parts) {
    response.statusCode = 404
    response.end('Not found')
    return
  }
  const { targetPath, targetBase, proxyBase } = parts
  assertAllowedProxyRequestOrigin(request, targetBase)
  const session = comfyProxySession(request, targetBase)
  const targetUrl = allowedComfyProxyTargetUrl(targetBase, targetPath)
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
  const bearerToken = comfyProxySession(request, targetBase)?.bearerToken || (await configuredProxyBearerToken(targetBase))
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const proxied = await fetch(targetUrl, {
    method: request.method,
    headers: await proxyRequestHeaders(
      request,
      shouldAttachProxyBearer(request, targetUrl) ? bearerToken : undefined,
      targetBase,
      Boolean(session),
      comfyProxySessionCookieHeader(session),
    ),
    body: hasBody ? await readRequestBody(request) : undefined,
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
}

const mimeTypeFor = (filePath) => {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.html') return 'text/html; charset=utf-8'
  if (extension === '.js' || extension === '.mjs') return 'text/javascript; charset=utf-8'
  if (extension === '.css') return 'text/css; charset=utf-8'
  if (extension === '.json') return 'application/json; charset=utf-8'
  if (extension === '.svg') return 'image/svg+xml'
  if (extension === '.png') return 'image/png'
  if (extension === '.ico') return 'image/x-icon'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.woff2') return 'font/woff2'
  return 'application/octet-stream'
}

const serveStaticApp = async (response, requestPath) => {
  const distDir = path.join(__dirname, '..', 'app-dist')
  const decodedPath = decodeURIComponent(requestPath)
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '')
  const candidatePath = path.normalize(path.join(distDir, relativePath))
  const safePath = candidatePath.startsWith(distDir) ? candidatePath : path.join(distDir, 'index.html')

  try {
    const content = await fs.readFile(safePath)
    response.setHeader('content-type', mimeTypeFor(safePath))
    response.end(content)
  } catch {
    const html = await fs.readFile(path.join(distDir, 'index.html'))
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(html)
  }
}

const startAppServer = () =>
  new Promise((resolve, reject) => {
    if (localAppServerUrl) {
      resolve(localAppServerUrl)
      return
    }
    authorizeConfiguredComfyProxyTargets()
    localAppServer = http.createServer((request, response) => {
      void (async () => {
        try {
          const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')
          if (requestUrl.pathname.startsWith(COMFY_PROXY_AUTH_PREFIX)) {
            await handleComfyProxyAuth(request, response)
            return
          }
          if (redirectComfyProxyRootResource(request, response)) return
          if (requestUrl.pathname.startsWith(COMFY_PROXY_PREFIX)) {
            await serveComfyProxy(request, response, requestUrl)
            return
          }
          await serveStaticApp(response, requestUrl.pathname)
        } catch (err) {
          response.statusCode = err instanceof ComfyProxyTargetError ? 403 : 502
          response.setHeader('content-type', 'text/plain; charset=utf-8')
          response.end(err instanceof Error ? err.message : 'Infinity app server failed')
        }
      })()
    })
    localAppServer.on('upgrade', (request, socket, head) => {
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
          assertAllowedProxyRequestOrigin(request, targetBase)
          const session = comfyProxySession(request, targetBase)
          const targetUrl = allowedComfyProxyTargetUrl(targetBase, targetPath)
          if (requestUrl.searchParams.has(COMFY_PROXY_LEGACY_TOKEN_PARAM)) {
            throw new ComfyProxyTargetError('Legacy ComfyUI proxy credentials in URLs are not accepted')
          }
          targetUrl.protocol = targetUrl.protocol === 'https:' ? 'wss:' : 'ws:'
          targetUrl.search = requestUrl.search
          const bearerToken = session?.bearerToken || (await configuredProxyBearerToken(targetBase))
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
        } catch {
          fail()
        }
      })()
    })
    localAppServer.on('error', reject)
    localAppServer.listen(0, '127.0.0.1', () => {
      const address = localAppServer.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to start local app server'))
        return
      }
      localAppServerUrl = `http://127.0.0.1:${address.port}/`
      resolve(localAppServerUrl)
    })
  })

const mediaValue = (resource) => {
  const value = resource?.value
  return value && typeof value === 'object' && typeof value.url === 'string' ? value : undefined
}

const comfyFileFromResource = (resource) => {
  const media = mediaValue(resource)
  if (!media) return undefined
  if (media.comfy) return media.comfy
  if (!resource?.metadata?.endpointId) return undefined

  try {
    const parsed = new URL(media.url)
    const filename = parsed.searchParams.get('filename')
    if (!filename) return undefined
    return {
      endpointId: resource.metadata.endpointId,
      filename,
      subfolder: parsed.searchParams.get('subfolder') ?? '',
      type: parsed.searchParams.get('type') ?? 'output',
    }
  } catch {
    return undefined
  }
}

const endpointHeaders = (endpoint) => ({
  ...Object.fromEntries(
    Object.entries(endpoint?.customHeaders ?? {})
      .map(([key, value]) => [key.trim(), String(value)] )
      .filter(([key]) => key),
  ),
  ...(endpoint?.auth?.type === 'token' && endpoint.auth.token ? { Authorization: `Bearer ${endpoint.auth.token}` } : {}),
})

const fetchComfyAsset = async (project, resource) => {
  const file = comfyFileFromResource(resource)
  if (!file || typeof fetch !== 'function') return undefined
  const endpoint = project?.comfy?.endpoints?.find((item) => item.id === file.endpointId)
  if (!endpoint) return undefined

  const search = new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder ?? '',
    type: file.type ?? 'output',
  })
  const response = await fetch(`${String(endpoint.baseUrl).replace(/\/+$/, '')}/view?${search.toString()}`, {
    headers: endpointHeaders(endpoint),
  })
  if (!response.ok) return undefined
  return Buffer.from(await response.arrayBuffer())
}

const writeAssetFile = async (assetsDir, assetId, filename, mimeType, buffer) => {
  if (!buffer || buffer.length === 0) return undefined
  const extension = fileExtension(filename, mimeType)
  const assetFileName = `${safeSegment(assetId, 'asset')}${extension}`
  const assetPath = path.join(assetsDir, assetFileName)

  try {
    const stat = await fs.stat(assetPath)
    if (stat.size > 0) return assetFileName
  } catch {
    // Missing file is the normal path for a new asset.
  }

  await fs.writeFile(assetPath, buffer)
  return assetFileName
}

const writeProjectAssets = async (projectDir, project) => {
  const assetsDir = path.join(projectDir, ASSETS_FOLDER)
  await fs.mkdir(assetsDir, { recursive: true })
  const manifest = []
  const seenAssetIds = new Set()

  for (const asset of Object.values(project.assets ?? {})) {
    const parsed = typeof asset.blobUrl === 'string' ? dataUrlToBuffer(asset.blobUrl) : undefined
    const file = parsed
      ? await writeAssetFile(assetsDir, asset.id, asset.name, parsed.mimeType || asset.mimeType, parsed.buffer)
      : undefined
    seenAssetIds.add(asset.id)
    manifest.push({
      id: asset.id,
      name: asset.name,
      mimeType: parsed?.mimeType ?? asset.mimeType,
      sizeBytes: asset.sizeBytes,
      file,
      source: file ? 'data_url' : 'external_reference',
    })
  }

  for (const resource of Object.values(project.resources ?? {})) {
    const media = mediaValue(resource)
    if (!media || seenAssetIds.has(media.assetId)) continue

    const parsed = dataUrlToBuffer(media.url)
    let file
    let source = 'external_reference'
    if (parsed) {
      file = await writeAssetFile(assetsDir, media.assetId, media.filename, parsed.mimeType || media.mimeType, parsed.buffer)
      source = 'data_url'
    } else {
      const buffer = await fetchComfyAsset(project, resource).catch(() => undefined)
      file = await writeAssetFile(assetsDir, media.assetId, media.filename, media.mimeType, buffer)
      source = file ? 'comfyui' : 'external_reference'
    }

    seenAssetIds.add(media.assetId)
    manifest.push({
      id: media.assetId,
      resourceId: resource.id,
      name: media.filename ?? resource.name,
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes,
      file,
      source,
    })
  }

  await writeJson(path.join(projectDir, CONFIG_FOLDER, 'assets.json'), manifest)
}

const saveProjectLibrary = async (payload) => {
  const root = await projectsRoot()
  const projects = payload?.projects ?? {}

  await writeJson(path.join(root, 'library.json'), payload)
  await writeJson(path.join(root, 'current.json'), {
    currentProjectId: payload?.currentProjectId,
    savedAt: new Date().toISOString(),
  })

  for (const project of Object.values(projects)) {
    const projectDir = path.join(root, projectFolderName(project))
    await fs.mkdir(path.join(projectDir, CONFIG_FOLDER), { recursive: true })
    await writeJson(path.join(projectDir, CONFIG_FOLDER, 'project.json'), project)
    await writeProjectAssets(projectDir, project)
  }

  return { ok: true, rootPath: root }
}

const loadProjectLibrary = async () => {
  const root = await projectsRoot()
  const library = await readJson(path.join(root, 'library.json'))
  const current = await readJson(path.join(root, 'current.json'))
  const projects = {}

  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const projectDir = path.join(root, entry.name)
      const project = await readJson(path.join(projectDir, CONFIG_FOLDER, 'project.json'))
      if (project?.project?.id) {
        projects[project.project.id] = await hydrateProjectAssets(projectDir, project).catch(() => project)
      }
    }
  } catch {
    // Empty project directory is valid on first launch.
  }

  const libraryProjects = library?.projects && typeof library.projects === 'object' ? library.projects : {}
  const loadedProjects = Object.keys(projects).length > 0 ? projects : libraryProjects
  const currentProjectId = current?.currentProjectId ?? library?.currentProjectId ?? Object.keys(loadedProjects)[0]

  return currentProjectId && Object.keys(loadedProjects).length > 0
    ? { currentProjectId, projects: loadedProjects }
    : undefined
}

ipcMain.handle('infinity-storage:load', loadProjectLibrary)
ipcMain.handle('infinity-storage:save', (_event, payload) => saveProjectLibrary(payload))
ipcMain.handle('infinity-comfy:authorize-target', (event, baseUrl) => {
  if (!localAppServerUrl) throw new Error('Infinity app server is not ready')
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('ComfyUI target authorization is only allowed from the main frame')
  }
  const senderOrigin = new URL(event.senderFrame.url).origin
  if (senderOrigin !== new URL(localAppServerUrl).origin) throw new Error('ComfyUI target authorization is not allowed')
  const targetBase = validatedComfyProxyTargetBase(baseUrl)
  authorizedComfyProxyTargets.add(targetBase)
  return { ok: true }
})

async function createWindow() {
  const appUrl = await startAppServer()
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: 'Infinity ComfyUI',
    icon: appIconPath(),
    backgroundColor: '#eef2f3',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') void shell.openExternal(parsed.toString())
    } catch {
      // Invalid or non-web popup targets stay blocked inside the desktop app.
    }
    return { action: 'deny' }
  })

  win.loadURL(appUrl)
}

app.whenReady().then(() => {
  void createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (localAppServer) {
    localAppServer.close()
    localAppServer = undefined
    localAppServerUrl = undefined
  }
  if (process.platform !== 'darwin') app.quit()
})
