import { describe, expect, it } from 'vitest'
import { readFileAsAssetResource, readFileAsMediaResource } from './resourceFiles'

describe('resource file readers', () => {
  it('reads media files as compatible media resource payloads', async () => {
    const file = new File(['image bytes'], 'render.png', { type: 'image/png' })

    const assetResource = await readFileAsAssetResource(file)
    const mediaResource = await readFileAsMediaResource(file)

    expect(assetResource).toEqual(mediaResource)
    expect(assetResource).toMatchObject({
      type: 'image',
      media: {
        filename: 'render.png',
        mimeType: 'image/png',
        sizeBytes: file.size,
      },
    })
    expect(assetResource?.type === 'image' ? assetResource.media.url : undefined).toMatch(
      /^data:image\/png;base64,/,
    )
  })

  it('detects image, video, and audio drops as typed media assets', async () => {
    const image = await readFileAsAssetResource(new File(['image'], 'render.webp', { type: 'image/webp' }))
    const video = await readFileAsAssetResource(new File(['video'], 'clip.mp4', { type: 'video/mp4' }))
    const audio = await readFileAsAssetResource(new File(['audio'], 'voice.wav', { type: 'audio/wav' }))

    expect(image).toMatchObject({
      type: 'image',
      media: { filename: 'render.webp', mimeType: 'image/webp' },
    })
    expect(video).toMatchObject({
      type: 'video',
      media: { filename: 'clip.mp4', mimeType: 'video/mp4' },
    })
    expect(audio).toMatchObject({
      type: 'audio',
      media: { filename: 'voice.wav', mimeType: 'audio/wav' },
    })
  })

  it('reads text file types as text asset resource values', async () => {
    const file = new File(['prompt,line\nwarm kitchen,cinematic'], 'prompts.csv', {
      type: 'application/octet-stream',
    })

    await expect(readFileAsAssetResource(file)).resolves.toEqual({
      type: 'text',
      value: 'prompt,line\nwarm kitchen,cinematic',
    })
  })

  it('returns undefined for unsupported files', async () => {
    const file = new File(['binary'], 'archive.zip', { type: 'application/zip' })

    await expect(readFileAsAssetResource(file)).resolves.toBeUndefined()
  })
})
