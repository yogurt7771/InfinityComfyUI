import type { AssetRecord, MediaResourceValue, ProjectState, Resource } from './types'

export type ProjectAssetFileSource = 'embedded' | 'data_url' | 'comfyui' | 'external_reference'

export type ProjectAssetFileManifestEntry = {
  id: string
  resourceId?: string
  name: string
  mimeType: string
  sizeBytes: number
  file?: string
  source: ProjectAssetFileSource
}

export type ProjectAssetFileEntry = {
  assetId: string
  path: string
  blob: Blob
}

export type CollectedProjectAssetFiles = {
  manifest: ProjectAssetFileManifestEntry[]
  files: ProjectAssetFileEntry[]
}

const mediaValue = (resource: Resource): MediaResourceValue | undefined =>
  typeof resource.value === 'object' && resource.value !== null && 'assetId' in resource.value ? resource.value : undefined

const safePackageSegment = (value: string, fallback: string) => {
  const cleaned = value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 96)

  return cleaned || fallback
}

const extensionForMime = (mimeType: string) => {
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase()
  if (normalized === 'image/jpeg') return '.jpg'
  if (normalized === 'image/png') return '.png'
  if (normalized === 'image/webp') return '.webp'
  if (normalized === 'image/gif') return '.gif'
  if (normalized === 'video/mp4') return '.mp4'
  if (normalized === 'video/webm') return '.webm'
  if (normalized === 'video/quicktime') return '.mov'
  if (normalized === 'audio/mpeg') return '.mp3'
  if (normalized === 'audio/wav') return '.wav'
  if (normalized === 'audio/ogg') return '.ogg'
  return ''
}

const fileExtension = (filename: string | undefined, mimeType: string) => {
  const extension = filename?.match(/\.[^./\\]+$/)?.[0]
  return extension || extensionForMime(mimeType)
}

const assetPackagePath = (assetId: string, filename: string | undefined, mimeType: string) =>
  `assets/${safePackageSegment(assetId, 'asset')}${fileExtension(filename, mimeType)}`

export const dataUrlToBlob = (url: string) => {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url)
  if (!match) return undefined

  const mimeType = match[1] || 'application/octet-stream'
  const payload = match[3] ?? ''
  const binary = match[2] ? atob(payload) : decodeURIComponent(payload)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: mimeType })
}

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

export const blobToDataUrl = async (blob: Blob, fallbackMimeType = 'application/octet-stream') => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return `data:${blob.type || fallbackMimeType};base64,${bytesToBase64(bytes)}`
}

const loadUrlBlob = async (url: string) => {
  const dataBlob = dataUrlToBlob(url)
  if (dataBlob) return dataBlob
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Asset fetch failed: ${response.status}`)
  return response.blob()
}

const resourcesByAssetId = (project: ProjectState) => {
  const resources = new Map<string, Resource[]>()
  for (const resource of Object.values(project.resources)) {
    const media = mediaValue(resource)
    if (!media) continue
    resources.set(media.assetId, [...(resources.get(media.assetId) ?? []), resource])
  }
  return resources
}

const assetRecordForId = (
  assetId: string,
  asset: AssetRecord | undefined,
  resources: Resource[],
): Omit<AssetRecord, 'createdAt'> => {
  const media = resources.map(mediaValue).find(Boolean)
  return {
    id: assetId,
    name: asset?.name ?? media?.filename ?? resources[0]?.name ?? assetId,
    mimeType: asset?.mimeType ?? media?.mimeType ?? 'application/octet-stream',
    sizeBytes: asset?.sizeBytes ?? media?.sizeBytes ?? 0,
    blobUrl: asset?.blobUrl,
  }
}

export async function collectProjectAssetFiles(
  project: ProjectState,
  loadBlob: (url: string) => Promise<Blob> = loadUrlBlob,
): Promise<CollectedProjectAssetFiles> {
  const resourcesByAsset = resourcesByAssetId(project)
  const assetIds = new Set([...Object.keys(project.assets), ...resourcesByAsset.keys()])
  const manifest: ProjectAssetFileManifestEntry[] = []
  const files: ProjectAssetFileEntry[] = []

  for (const assetId of assetIds) {
    const resources = resourcesByAsset.get(assetId) ?? []
    const asset = assetRecordForId(assetId, project.assets[assetId], resources)
    const media = resources.map(mediaValue).find(Boolean)
    const url = asset.blobUrl ?? media?.url
    const baseManifest = {
      id: assetId,
      resourceId: resources[0]?.id,
      name: asset.name,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
    }

    if (!url) {
      manifest.push({ ...baseManifest, source: 'external_reference' })
      continue
    }

    try {
      const blob = await loadBlob(url)
      const mimeType = blob.type || asset.mimeType
      const file = assetPackagePath(assetId, asset.name, mimeType)
      manifest.push({
        ...baseManifest,
        mimeType,
        sizeBytes: blob.size || asset.sizeBytes,
        file,
        source: 'embedded',
      })
      files.push({ assetId, path: file, blob })
    } catch {
      manifest.push({ ...baseManifest, source: 'external_reference' })
    }
  }

  return { manifest, files }
}

export async function hydrateProjectAssetFiles(
  project: ProjectState,
  manifest: ProjectAssetFileManifestEntry[] | undefined,
  loadBlob: (path: string) => Promise<Blob | undefined>,
): Promise<ProjectState> {
  if (!manifest?.length) return project
  const hydrated = structuredClone(project) as ProjectState

  for (const entry of manifest) {
    if (!entry.file) continue
    const blob = await loadBlob(entry.file).catch(() => undefined)
    if (!blob) continue

    const mimeType = blob.type || entry.mimeType || 'application/octet-stream'
    const dataUrl = await blobToDataUrl(blob, mimeType)
    const sizeBytes = blob.size || entry.sizeBytes || 0
    const existingAsset = hydrated.assets[entry.id]
    hydrated.assets[entry.id] = {
      id: entry.id,
      name: existingAsset?.name ?? entry.name ?? entry.id,
      mimeType,
      sizeBytes,
      blobUrl: dataUrl,
      createdAt: existingAsset?.createdAt ?? hydrated.project.createdAt,
    }

    for (const resource of Object.values(hydrated.resources)) {
      const media = mediaValue(resource)
      if (!media || media.assetId !== entry.id) continue
      resource.value = {
        ...media,
        url: dataUrl,
        mimeType,
        sizeBytes,
      }
    }
  }

  return hydrated
}
