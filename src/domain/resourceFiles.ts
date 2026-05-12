import type { MediaResourceValue, ResourceType } from './types'

export type MediaResourcePayload = Omit<MediaResourceValue, 'assetId'>
export type MediaResourceKind = Extract<ResourceType, 'image' | 'video' | 'audio'>

export const mediaTypeFromMime = (mimeType: string): MediaResourceKind | undefined => {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return undefined
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
