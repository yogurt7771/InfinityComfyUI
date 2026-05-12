import { describe, expect, it } from 'vitest'
import { extractComfyOutputs } from './comfyOutputs'
import type { ComfyWorkflow, FunctionOutputDef } from './types'

describe('extractComfyOutputs', () => {
  it('extracts image file references from history by output node title', () => {
    const workflow: ComfyWorkflow = {
      '20': {
        class_type: 'SaveImage',
        _meta: { title: 'Result_Image' },
        inputs: {},
      },
    }
    const outputs: FunctionOutputDef[] = [
      {
        key: 'result',
        label: 'Result',
        type: 'image',
        bind: { nodeTitle: 'Result_Image' },
        extract: { source: 'history', multiple: true },
      },
    ]
    const history = {
      prompt_1: {
        outputs: {
          '20': {
            images: [
              { filename: 'a.png', subfolder: 'renders', type: 'output' },
              { filename: 'b.png', subfolder: '', type: 'output' },
            ],
          },
        },
      },
    }

    expect(extractComfyOutputs(history, workflow, outputs)).toEqual([
      {
        key: 'result',
        type: 'image',
        files: [
          { filename: 'a.png', subfolder: 'renders', type: 'output' },
          { filename: 'b.png', subfolder: '', type: 'output' },
        ],
      },
    ])
  })

  it('reports missing configured output nodes', () => {
    expect(() =>
      extractComfyOutputs(
        { prompt_1: { outputs: {} } },
        {},
        [
          {
            key: 'result',
            label: 'Result',
            type: 'image',
            bind: { nodeTitle: 'Result_Image' },
            extract: { source: 'history' },
          },
        ],
        ),
      ).toThrow('Output node not found')
  })

  it('extracts video, audio, and text outputs from configured history nodes', () => {
    const workflow: ComfyWorkflow = {
      '21': { class_type: 'SaveVideo', _meta: { title: 'Result_Video' }, inputs: {} },
      '22': { class_type: 'SaveAudio', _meta: { title: 'Result_Audio' }, inputs: {} },
      '23': { class_type: 'PreviewText', _meta: { title: 'Result_Text' }, inputs: {} },
    }
    const outputs: FunctionOutputDef[] = [
      {
        key: 'video',
        label: 'Video',
        type: 'video',
        bind: { nodeTitle: 'Result_Video' },
        extract: { source: 'history', multiple: true },
      },
      {
        key: 'audio',
        label: 'Audio',
        type: 'audio',
        bind: { nodeTitle: 'Result_Audio' },
        extract: { source: 'history', multiple: true },
      },
      {
        key: 'caption',
        label: 'Caption',
        type: 'text',
        bind: { nodeTitle: 'Result_Text' },
        extract: { source: 'node_output' },
      },
    ]
    const history = {
      prompt_1: {
        outputs: {
          '21': { videos: [{ filename: 'clip.mp4', subfolder: 'renders', type: 'output' }] },
          '22': { audio: [{ filename: 'ace_step1.5_xl_base_00001_.mp3', subfolder: 'audio', type: 'output' }] },
          '23': { text: ['Generated caption'] },
        },
      },
    }

    expect(extractComfyOutputs(history, workflow, outputs)).toEqual([
      {
        key: 'video',
        type: 'video',
        files: [{ filename: 'clip.mp4', subfolder: 'renders', type: 'output' }],
      },
      {
        key: 'audio',
        type: 'audio',
        files: [{ filename: 'ace_step1.5_xl_base_00001_.mp3', subfolder: 'audio', type: 'output' }],
      },
      {
        key: 'caption',
        type: 'text',
        files: [],
        texts: ['Generated caption'],
      },
    ])
  })

  it('extracts ComfyUI video outputs stored under gifs history fields', () => {
    const workflow: ComfyWorkflow = {
      '75': { class_type: 'SaveVideo', _meta: { title: 'Save Video' }, inputs: {} },
    }
    const outputs: FunctionOutputDef[] = [
      {
        key: 'video',
        label: 'Video',
        type: 'video',
        bind: { nodeId: '75', nodeTitle: 'Save Video' },
        extract: { source: 'history', multiple: true },
      },
    ]
    const history = {
      prompt_1: {
        outputs: {
          '75': {
            gifs: [{ filename: 'ltx_00001.mp4', subfolder: 'video', type: 'output' }],
          },
        },
      },
    }

    expect(extractComfyOutputs(history, workflow, outputs)).toEqual([
      {
        key: 'video',
        type: 'video',
        files: [{ filename: 'ltx_00001.mp4', subfolder: 'video', type: 'output' }],
      },
    ])
  })

  it('extracts animated video files when ComfyUI stores mp4 references under images', () => {
    const workflow: ComfyWorkflow = {
      '75': { class_type: 'SaveVideo', _meta: { title: 'Save Video' }, inputs: {} },
    }
    const outputs: FunctionOutputDef[] = [
      {
        key: 'video',
        label: 'Video',
        type: 'video',
        bind: { nodeId: '75', nodeTitle: 'Save Video' },
        extract: { source: 'history', multiple: true },
      },
    ]
    const history = {
      prompt_1: {
        outputs: {
          '75': {
            images: [{ filename: 'LTX_2.3_t2v_00002_.mp4', subfolder: 'video', type: 'output' }],
            animated: [true],
          },
        },
      },
    }

    expect(extractComfyOutputs(history, workflow, outputs)).toEqual([
      {
        key: 'video',
        type: 'video',
        files: [{ filename: 'LTX_2.3_t2v_00002_.mp4', subfolder: 'video', type: 'output' }],
      },
    ])
  })
})
