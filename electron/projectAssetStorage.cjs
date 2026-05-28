const fs = require('node:fs/promises')
const path = require('node:path')

const CONFIG_FOLDER = 'config'
const ASSETS_FOLDER = 'assets'

const readJson = async (filePath) => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch {
    return undefined
  }
}

const mediaValue = (resource) => {
  const value = resource?.value
  return value && typeof value === 'object' && typeof value.assetId === 'string' ? value : undefined
}

const bufferToDataUrl = (buffer, mimeType) => `data:${mimeType || 'application/octet-stream'};base64,${buffer.toString('base64')}`

const hydrateProjectAssets = async (projectDir, project) => {
  const manifest = await readJson(path.join(projectDir, CONFIG_FOLDER, 'assets.json'))
  if (!Array.isArray(manifest) || manifest.length === 0) return project

  const hydrated = structuredClone(project)
  hydrated.assets = hydrated.assets ?? {}
  hydrated.resources = hydrated.resources ?? {}

  for (const entry of manifest) {
    if (!entry?.id || !entry.file) continue
    const assetFilePath = path.join(projectDir, ASSETS_FOLDER, path.basename(entry.file))
    let buffer
    try {
      buffer = await fs.readFile(assetFilePath)
    } catch {
      continue
    }

    const mimeType = entry.mimeType || hydrated.assets[entry.id]?.mimeType || 'application/octet-stream'
    const dataUrl = bufferToDataUrl(buffer, mimeType)
    const existingAsset = hydrated.assets[entry.id]
    hydrated.assets[entry.id] = {
      id: entry.id,
      name: existingAsset?.name ?? entry.name ?? entry.id,
      mimeType,
      sizeBytes: buffer.length || entry.sizeBytes || 0,
      blobUrl: dataUrl,
      createdAt: existingAsset?.createdAt ?? hydrated.project?.createdAt ?? new Date().toISOString(),
    }

    for (const resource of Object.values(hydrated.resources)) {
      const media = mediaValue(resource)
      if (!media || media.assetId !== entry.id) continue
      resource.value = {
        ...media,
        url: dataUrl,
        mimeType,
        sizeBytes: buffer.length || entry.sizeBytes || 0,
      }
    }
  }

  return hydrated
}

module.exports = {
  ASSETS_FOLDER,
  CONFIG_FOLDER,
  hydrateProjectAssets,
}
