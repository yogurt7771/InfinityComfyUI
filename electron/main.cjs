const { app, BrowserWindow, ipcMain, shell } = require('electron')
const http = require('node:http')
const fs = require('node:fs/promises')
const path = require('node:path')
const { hydrateProjectAssets } = require('./projectAssetStorage.cjs')

const PROJECTS_FOLDER = 'projects'
const CONFIG_FOLDER = 'config'
const ASSETS_FOLDER = 'assets'
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
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return undefined
    throw error
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
  const distDir = path.resolve(__dirname, '..', 'app-dist')
  const decodedPath = decodeURIComponent(requestPath)
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '')
  const candidatePath = path.resolve(distDir, relativePath)
  const safePath = candidatePath.startsWith(`${distDir}${path.sep}`) ? candidatePath : path.join(distDir, 'index.html')

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
          await serveStaticApp(response, requestUrl.pathname)
        } catch (error) {
          response.statusCode = 500
          response.setHeader('content-type', 'text/plain; charset=utf-8')
          response.end(error instanceof Error ? error.message : 'Infinity app server failed')
        }
      })()
    })
    localAppServer.on('upgrade', (_request, socket) => socket.destroy())
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

const writeAssetFile = async (assetsDir, assetId, filename, mimeType, buffer) => {
  if (!buffer || buffer.length === 0) return undefined
  const extension = fileExtension(filename, mimeType)
  const assetFileName = `${safeSegment(assetId, 'asset')}${extension}`
  const assetPath = path.join(assetsDir, assetFileName)
  try {
    const assetStat = await fs.stat(assetPath)
    if (assetStat.size > 0) return assetFileName
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
    const file = parsed
      ? await writeAssetFile(assetsDir, media.assetId, media.filename, parsed.mimeType || media.mimeType, parsed.buffer)
      : undefined
    seenAssetIds.add(media.assetId)
    manifest.push({
      id: media.assetId,
      resourceId: resource.id,
      name: media.filename ?? resource.name,
      mimeType: parsed?.mimeType ?? media.mimeType,
      sizeBytes: media.sizeBytes,
      file,
      source: file ? 'data_url' : 'external_reference',
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
  } catch (error) {
    if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error
  }
  if (library !== undefined && (!library || typeof library !== 'object' || !library.projects || typeof library.projects !== 'object')) {
    throw new Error('Stored Infinity project library is invalid')
  }
  if (current !== undefined && (!current || typeof current !== 'object')) {
    throw new Error('Stored Infinity current-project metadata is invalid')
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
