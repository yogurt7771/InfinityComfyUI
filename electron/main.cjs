const { app, BrowserWindow, ipcMain, shell } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')

const PROJECTS_FOLDER = 'projects'
const CONFIG_FOLDER = 'config'
const ASSETS_FOLDER = 'assets'

const safeSegment = (value, fallback) => {
  const cleaned = String(value ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 96)

  return cleaned || fallback
}

const appDirectory = () => (app.isPackaged ? path.dirname(app.getPath('exe')) : path.join(__dirname, '..'))

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
      const project = await readJson(path.join(root, entry.name, CONFIG_FOLDER, 'project.json'))
      if (project?.project?.id) projects[project.project.id] = project
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

function createWindow() {
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

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
