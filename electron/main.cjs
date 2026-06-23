const { app, BrowserWindow, ipcMain, shell } = require('electron')
const http = require('node:http')
const fs = require('node:fs/promises')
const path = require('node:path')
const { hydrateProjectAssets } = require('./projectAssetStorage.cjs')

const PROJECTS_FOLDER = 'projects'
const CONFIG_FOLDER = 'config'
const ASSETS_FOLDER = 'assets'
const COMFY_PROXY_SEGMENT = '__comfy_proxy'
const COMFY_PROXY_PREFIX = `/${COMFY_PROXY_SEGMENT}/`
const COMFY_PROXY_TOKEN_PARAM = '__infinity_comfy_token'
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

const readRequestBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })

const comfyProxyTokenFromFileContent = (content) => {
  const token = content.split(/\r?\n/, 1)[0]?.trim()
  return token || undefined
}

const configuredProxyBearerToken = async () => {
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

const proxyRequestHeaders = async (request, bearerToken) => {
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

const comfyProxyBridge = (proxyBase, targetBase, bearerToken) => `<script>
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

const injectComfyProxyBridge = (html, proxyBase, targetBase, bearerToken) => {
  const bridge = comfyProxyBridge(proxyBase, targetBase, bearerToken)
  return html.includes('</head>') ? html.replace('</head>', `${bridge}</head>`) : `${bridge}${html}`
}

const rewriteComfyProxyLocation = (value, proxyBase, targetBase) => {
  try {
    const targetOrigin = new URL(targetBase).origin
    const parsed = new URL(value, `${targetBase}/`)
    if (parsed.origin !== targetOrigin) return value
    return `${proxyBase}${parsed.pathname.replace(/^\/+/, '')}${parsed.search}${parsed.hash}`
  } catch {
    return value
  }
}

const rewriteComfyProxyResponseHeader = (key, value, proxyBase, targetBase) => {
  if (key.toLowerCase() === 'location') return rewriteComfyProxyLocation(value, proxyBase, targetBase)
  if (key.toLowerCase() === 'set-cookie') return value.replace(/;\s*Path=\/(?=;|$)/i, `; Path=${proxyBase}`)
  return value
}

const serveComfyProxy = async (request, response, requestUrl) => {
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
  const proxied = await fetch(targetUrl, {
    method: request.method,
    headers: await proxyRequestHeaders(request, bearerToken),
    body: hasBody ? await readRequestBody(request) : undefined,
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
    localAppServer = http.createServer((request, response) => {
      void (async () => {
        try {
          const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')
          if (requestUrl.pathname.startsWith(COMFY_PROXY_PREFIX)) {
            await serveComfyProxy(request, response, requestUrl)
            return
          }
          await serveStaticApp(response, requestUrl.pathname)
        } catch (err) {
          response.statusCode = 502
          response.setHeader('content-type', 'text/plain; charset=utf-8')
          response.end(err instanceof Error ? err.message : 'Infinity app server failed')
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
    void shell.openExternal(url)
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
