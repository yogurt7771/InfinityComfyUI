import { describe, expect, it } from 'vitest'
import { extractComfyOutputs } from './comfyOutputs'
import type { ComfyWorkflow, FunctionOutputDef, ResourceType } from './types'

const NODE_ID = '20'

const workflow: ComfyWorkflow = {
  [NODE_ID]: { class_type: 'MyFancySaver', _meta: { title: 'Out' }, inputs: {} },
}

const outputDef = (type: ResourceType, key = 'out'): FunctionOutputDef => ({
  key,
  label: 'Out',
  type,
  bind: { nodeId: NODE_ID, nodeTitle: 'Out' },
  extract: { source: type === 'text' ? 'node_output' : 'history', multiple: true },
})

const file = (filename: string) => ({ filename, subfolder: 'sub', type: 'output' })

const extractOne = (type: ResourceType, nodeOutput: Record<string, unknown>) => {
  const history = { prompt_1: { outputs: { [NODE_ID]: nodeOutput } } }
  const result = extractComfyOutputs(history, workflow, [outputDef(type)])
  expect(result).toHaveLength(1)
  return result[0]!
}

describe('extractComfyOutputs runtime type correction', () => {
  describe('declared type has files: unchanged', () => {
    it('keeps an image output with images', () => {
      expect(extractOne('image', { images: [file('a.png')] })).toEqual({
        key: 'out',
        type: 'image',
        files: [file('a.png')],
      })
    })

    it('keeps a video output with videos even when images are also present', () => {
      expect(extractOne('video', { videos: [file('a.mp4')], images: [file('poster.png')] })).toEqual({
        key: 'out',
        type: 'video',
        files: [file('a.mp4')],
      })
    })

    it('keeps an audio output with audio', () => {
      expect(extractOne('audio', { audio: [file('a.mp3')], images: [file('cover.png')] })).toEqual({
        key: 'out',
        type: 'audio',
        files: [file('a.mp3')],
      })
    })

    it('keeps an image output with images even when gifs are also present', () => {
      expect(extractOne('image', { images: [file('a.png')], gifs: [file('b.mp4')] })).toEqual({
        key: 'out',
        type: 'image',
        files: [file('a.png')],
      })
    })
  })

  describe('declared type has no files but another media kind does', () => {
    it('turns an image output with gifs mp4 into a video entry', () => {
      expect(extractOne('image', { gifs: [file('clip.mp4')] })).toStrictEqual({
        key: 'out',
        type: 'video',
        files: [file('clip.mp4')],
      })
    })

    it('turns an image output with videos into a video entry', () => {
      expect(extractOne('image', { videos: [file('clip.webm')] })).toStrictEqual({
        key: 'out',
        type: 'video',
        files: [file('clip.webm')],
      })
    })

    it('turns an image output with an empty images list and gifs into a video entry', () => {
      expect(extractOne('image', { images: [], gifs: [file('clip.mp4')] })).toStrictEqual({
        key: 'out',
        type: 'video',
        files: [file('clip.mp4')],
      })
    })

    it.each(['audios', 'audio'])('turns an image output with %s into an audio entry', (field) => {
      expect(extractOne('image', { [field]: [file('song.flac')] })).toStrictEqual({
        key: 'out',
        type: 'audio',
        files: [file('song.flac')],
      })
    })

    it('turns a video output with only still images into an image entry', () => {
      expect(extractOne('video', { images: [file('frame.png')] })).toStrictEqual({
        key: 'out',
        type: 'image',
        files: [file('frame.png')],
      })
    })

    it('turns a video output with audio into an audio entry', () => {
      expect(extractOne('video', { audio: [file('a.wav')] })).toStrictEqual({
        key: 'out',
        type: 'audio',
        files: [file('a.wav')],
      })
    })

    it('turns an audio output with images into an image entry', () => {
      expect(extractOne('audio', { images: [file('a.png')] })).toStrictEqual({
        key: 'out',
        type: 'image',
        files: [file('a.png')],
      })
    })

    it('turns an audio output with videos into a video entry', () => {
      expect(extractOne('audio', { videos: [file('a.mp4')] })).toStrictEqual({
        key: 'out',
        type: 'video',
        files: [file('a.mp4')],
      })
    })

    it.each(['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'])(
      'treats .%s files under images as video, not image',
      (ext) => {
        expect(extractOne('audio', { images: [file(`clip.${ext}`)] })).toStrictEqual({
          key: 'out',
          type: 'video',
          files: [file(`clip.${ext}`)],
        })
      },
    )

    it('checks image before video before audio', () => {
      expect(
        extractOne('audio', { images: [file('a.png')], videos: [file('b.mp4')], audios: [] }),
      ).toStrictEqual({ key: 'out', type: 'image', files: [file('a.png')] })

      expect(extractOne('image', { gifs: [file('b.mp4')], audio: [file('c.mp3')] })).toStrictEqual({
        key: 'out',
        type: 'video',
        files: [file('b.mp4')],
      })
    })

    it('ignores video-extension files when looking for image media', () => {
      expect(extractOne('text', { images: [file('a.mkv')], audios: [file('b.mp3')] })).toStrictEqual({
        key: 'out',
        type: 'video',
        files: [file('a.mkv')],
      })
    })
  })

  describe('text outputs', () => {
    it('keeps a text output with texts as text', () => {
      expect(extractOne('text', { text: ['caption'], images: [file('a.png')] })).toMatchObject({
        key: 'out',
        type: 'text',
        texts: ['caption'],
      })
    })

    it('turns a text output without texts but with images into an image entry without texts', () => {
      const entry = extractOne('text', { images: [file('a.png')] })
      expect(entry).toStrictEqual({ key: 'out', type: 'image', files: [file('a.png')] })
      expect(Object.keys(entry)).not.toContain('texts')
    })

    it('turns a text output with an empty text list and gifs into a video entry', () => {
      expect(extractOne('text', { text: [], gifs: [file('clip.mp4')] })).toStrictEqual({
        key: 'out',
        type: 'video',
        files: [file('clip.mp4')],
      })
    })

    it('turns a text output with only audio into an audio entry', () => {
      expect(extractOne('text', { audio: [file('a.mp3')] })).toStrictEqual({
        key: 'out',
        type: 'audio',
        files: [file('a.mp3')],
      })
    })
  })

  describe('nothing at all', () => {
    it.each<ResourceType>(['image', 'video', 'audio'])('leaves a %s output with no media unchanged', (type) => {
      expect(extractOne(type, {})).toMatchObject({ key: 'out', type, files: [] })
    })

    it('leaves a text output with no texts and no media as text', () => {
      expect(extractOne('text', {})).toMatchObject({ key: 'out', type: 'text', files: [] })
    })
  })

  it('corrects each output independently and keeps their keys', () => {
    const history = {
      prompt_1: {
        outputs: {
          '20': { gifs: [file('clip.mp4')] },
          '21': { images: [file('still.png')] },
        },
      },
    }
    const wf: ComfyWorkflow = {
      '20': { class_type: 'A', _meta: { title: 'A' }, inputs: {} },
      '21': { class_type: 'B', _meta: { title: 'B' }, inputs: {} },
    }
    const outputs: FunctionOutputDef[] = [
      { ...outputDef('image', 'first'), bind: { nodeId: '20', nodeTitle: 'A' } },
      { ...outputDef('image', 'second'), bind: { nodeId: '21', nodeTitle: 'B' } },
    ]
    expect(extractComfyOutputs(history, wf, outputs)).toEqual([
      { key: 'first', type: 'video', files: [file('clip.mp4')] },
      { key: 'second', type: 'image', files: [file('still.png')] },
    ])
  })
})
