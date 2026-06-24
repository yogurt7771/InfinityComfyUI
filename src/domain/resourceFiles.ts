import type { MediaResourceValue, ResourceType } from './types'

export type MediaResourcePayload = Omit<MediaResourceValue, 'assetId'>
export type MediaResourceKind = Extract<ResourceType, 'image' | 'video' | 'audio'>
export type TextResourceFileResult = { type: 'text'; value: string }
export type MediaResourceFileResult = { type: MediaResourceKind; media: MediaResourcePayload }
export type AssetResourceFileResult = TextResourceFileResult | MediaResourceFileResult

const textFileExtensions = new Set(['txt', 'md', 'json', 'csv'])

export const mediaTypeFromMime = (mimeType: string): MediaResourceKind | undefined => {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return undefined
}

const fileExtension = (filename: string) => {
  const extension = filename.split('.').pop()
  return extension && extension !== filename ? extension.toLowerCase() : ''
}

const isTextFile = (file: File) => {
  const mimeType = file.type.toLowerCase().split(';', 1)[0]
  return mimeType.startsWith('text/') || mimeType === 'application/json' || textFileExtensions.has(fileExtension(file.name))
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('File could not be read as a data URL'))
    })
    reader.addEventListener('error', () => reject(reader.error ?? new Error('File read failed')))
    reader.readAsDataURL(file)
  })
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('File could not be read as text'))
    })
    reader.addEventListener('error', () => reject(reader.error ?? new Error('File read failed')))
    reader.readAsText(file)
  })
}

export async function readFileAsMediaResource(file: File) {
  const type = mediaTypeFromMime(file.type)
  if (!type) return undefined

  return {
    type,
    media: {
      url: await readFileAsDataUrl(file),
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    } satisfies MediaResourcePayload,
  }
}

export async function readFileAsAssetResource(file: File): Promise<AssetResourceFileResult | undefined> {
  const mediaResource = await readFileAsMediaResource(file)
  if (mediaResource) return mediaResource
  if (!isTextFile(file)) return undefined

  return {
    type: 'text',
    value: await readFileAsText(file),
  }
}
