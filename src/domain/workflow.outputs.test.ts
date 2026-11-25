import { describe, expect, it } from 'vitest'
import { createGenerationFunctionFromWorkflow, repairFallbackComfyOutputs } from './workflow'
import type { ComfyWorkflow, FunctionOutputDef, GenerationFunction } from './types'

const NOW = '2026-05-08T09:00:00.000Z'
const infer = (workflow: ComfyWorkflow) => createGenerationFunctionFromWorkflow('fn_1', 'Test', workflow, NOW)

const LEGACY_FALLBACK: FunctionOutputDef[] = [
  {
    key: 'result',
    label: 'Result',
    type: 'text',
    bind: { nodeTitle: 'Result' },
    extract: { source: 'history', multiple: true },
  },
]

const imageOutput = (key: string, label: string, nodeId: string, nodeTitle: string): FunctionOutputDef => ({
  key,
  label,
  type: 'image',
  bind: { nodeId, nodeTitle },
  extract: { source: 'history', multiple: true },
})

const sampler = { class_type: 'KSampler', _meta: { title: 'Sampler' }, inputs: { seed: 1, steps: 20 } }

describe('ComfyUI image output inference', () => {
  it.each([
    'SaveImage',
    'Image Save',
    'image_save',
    'ImageSave',
    'IMAGE SAVE',
    'easy imageSave',
    'SaveImageExtended',
    'SaveAnimatedWEBP',
    'SaveAnimatedPNG',
  ])('recognizes save class %j as an image output', (classType) => {
    const fn = infer({ '3': sampler, '20': { class_type: classType, _meta: { title: 'Out' }, inputs: {} } })
    expect(fn.outputs).toEqual([imageOutput('image', 'Image', '20', 'Out')])
  })

  it.each(['PreviewImage', 'ImagePreview', 'Preview Image', 'preview_image'])(
    'recognizes preview class %j as an image output when there is no save node',
    (classType) => {
      const fn = infer({ '3': sampler, '20': { class_type: classType, _meta: { title: 'Peek' }, inputs: {} } })
      expect(fn.outputs).toEqual([imageOutput('image', 'Image', '20', 'Peek')])
    },
  )

  it('prefers save nodes over preview nodes', () => {
    const fn = infer({
      preview_a: { class_type: 'PreviewImage', _meta: { title: 'Preview A' }, inputs: {} },
      save_b: { class_type: 'SaveImage', _meta: { title: 'Save B' }, inputs: {} },
      preview_c: { class_type: 'ImagePreview', _meta: { title: 'Preview C' }, inputs: {} },
    })
    expect(fn.outputs).toEqual([imageOutput('image', 'Image', 'save_b', 'Save B')])
  })

  it('never treats websocket nodes as image outputs', () => {
    expect(infer({ '3': sampler, '9': { class_type: 'SaveImageWebsocket', inputs: {} } }).outputs).toEqual(
      LEGACY_FALLBACK,
    )
    expect(
      infer({
        '9': { class_type: 'SaveImageWebsocket', _meta: { title: 'WS' }, inputs: {} },
        '20': { class_type: 'PreviewImage', _meta: { title: 'Peek' }, inputs: {} },
      }).outputs,
    ).toEqual([imageOutput('image', 'Image', '20', 'Peek')])
  })

  it('numbers multiple image outputs in workflow entry order', () => {
    const fn = infer({
      save_c: { class_type: 'SaveImage', _meta: { title: 'C' }, inputs: {} },
      save_a: { class_type: 'Image Save', _meta: { title: 'A' }, inputs: {} },
      save_b: { class_type: 'SaveAnimatedWEBP', _meta: { title: 'B' }, inputs: {} },
    })
    expect(fn.outputs).toEqual([
      imageOutput('image', 'Image', 'save_c', 'C'),
      imageOutput('image_2', 'Image 2', 'save_a', 'A'),
      imageOutput('image_3', 'Image 3', 'save_b', 'B'),
    ])
  })

  it('gives untitled image outputs a non-empty nodeTitle', () => {
    const fn = infer({ '20': { class_type: 'PreviewImage', inputs: {} } })
    expect(fn.outputs).toHaveLength(1)
    expect(fn.outputs[0]).toMatchObject({ key: 'image', type: 'image', bind: { nodeId: '20' } })
    expect(fn.outputs[0]!.bind.nodeTitle).toEqual(expect.any(String))
    expect(fn.outputs[0]!.bind.nodeTitle!.length).toBeGreaterThan(0)
  })

  it('keeps video, audio and text inference and orders outputs image, video, audio, text', () => {
    const fn = infer({
      t: { class_type: 'ShowText', _meta: { title: 'Text Out' }, inputs: {} },
      a: { class_type: 'SaveAudio', _meta: { title: 'Audio Out' }, inputs: {} },
      v: { class_type: 'VHS_VideoCombine', _meta: { title: 'Video Out' }, inputs: {} },
      i: { class_type: 'PreviewImage', _meta: { title: 'Image Out' }, inputs: {} },
    })
    expect(fn.outputs.map((output) => [output.type, output.bind.nodeId])).toEqual([
      ['image', 'i'],
      ['video', 'v'],
      ['audio', 'a'],
      ['text', 't'],
    ])
  })

  it('falls back to the legacy text Result output when nothing is recognized', () => {
    const fn = infer({
      '3': sampler,
      '6': { class_type: 'CLIPTextEncode', _meta: { title: 'Prompt' }, inputs: { text: 'hi' } },
    })
    expect(fn.outputs).toEqual(LEGACY_FALLBACK)
  })

  it('never binds function inputs to image save or preview nodes', () => {
    const fn = infer({
      '10': { class_type: 'LoadImage', _meta: { title: 'Load' }, inputs: { image: 'a.png' } },
      '20': { class_type: 'Image Save', _meta: { title: 'Save' }, inputs: { image: 'b.png', images: ['10', 0] } },
      '30': { class_type: 'PreviewImage', _meta: { title: 'Peek' }, inputs: { image: 'c.png', images: ['10', 0] } },
    })
    const boundNodeIds = fn.inputs.map((input) => input.bind.nodeId)
    expect(boundNodeIds).not.toContain('20')
    expect(boundNodeIds).not.toContain('30')
    expect(fn.inputs).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'image', bind: expect.objectContaining({ nodeId: '10' }) })]),
    )
  })

  it('never binds function inputs to a preview-only image output node', () => {
    const fn = infer({
      '10': { class_type: 'LoadImage', _meta: { title: 'Load' }, inputs: { image: 'a.png' } },
      '30': { class_type: 'ImagePreview', _meta: { title: 'Peek' }, inputs: { image: 'c.png' } },
    })
    expect(fn.outputs).toEqual([imageOutput('image', 'Image', '30', 'Peek')])
    expect(fn.inputs.map((input) => input.bind.nodeId)).not.toContain('30')
    expect(fn.inputs.some((input) => input.type === 'image' && input.bind.nodeId === '10')).toBe(true)
  })
})

describe('repairFallbackComfyOutputs', () => {
  const previewWorkflow = (): ComfyWorkflow => ({
    '3': { ...sampler, inputs: { ...sampler.inputs } },
    '20': { class_type: 'PreviewImage', _meta: { title: 'Preview Image' }, inputs: { images: ['3', 0] } },
  })

  const legacyFunction = (rawJson: ComfyWorkflow = previewWorkflow()): GenerationFunction => ({
    id: 'fn_legacy',
    name: 'Legacy',
    category: 'Generate',
    workflow: { format: 'comfyui_api_json', rawJson, editor: { kind: 'comfyui_embedded', endpointId: 'ep', savedAt: NOW } },
    inputs: [
      {
        key: 'prompt',
        label: 'Prompt',
        type: 'text',
        required: true,
        bind: { nodeId: '6', path: 'inputs.text' },
      },
    ],
    outputs: structuredClone(LEGACY_FALLBACK),
    runtimeDefaults: { runCount: 2, seedPolicy: { mode: 'randomize_all_before_submit' } },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  })

  it('replaces the legacy fallback with inferred image outputs', () => {
    const repaired = repairFallbackComfyOutputs(legacyFunction())
    expect(repaired.outputs).toEqual([imageOutput('image', 'Image', '20', 'Preview Image')])
  })

  it('returns a new object and keeps every other field unchanged', () => {
    const fn = legacyFunction()
    const repaired = repairFallbackComfyOutputs(fn)
    expect(repaired).not.toBe(fn)
    expect({ ...repaired, outputs: fn.outputs }).toEqual(fn)
  })

  it('does not mutate its argument', () => {
    const fn = legacyFunction()
    const snapshot = structuredClone(fn)
    repairFallbackComfyOutputs(fn)
    expect(fn).toEqual(snapshot)
  })

  it('returns the same object when the workflow has no recognizable outputs', () => {
    const fn = legacyFunction({ '3': sampler })
    expect(repairFallbackComfyOutputs(fn)).toBe(fn)
  })

  it('returns the same object when outputs are not the legacy fallback', () => {
    const real = { ...legacyFunction(), outputs: [imageOutput('image', 'Image', '20', 'Preview Image')] }
    expect(repairFallbackComfyOutputs(real)).toBe(real)

    const withNodeId = legacyFunction()
    withNodeId.outputs = [{ ...LEGACY_FALLBACK[0]!, bind: { nodeId: '20', nodeTitle: 'Result' } }]
    expect(repairFallbackComfyOutputs(withNodeId)).toBe(withNodeId)

    const twoOutputs = legacyFunction()
    twoOutputs.outputs = [...LEGACY_FALLBACK, { ...LEGACY_FALLBACK[0]!, key: 'result_2' }]
    expect(repairFallbackComfyOutputs(twoOutputs)).toBe(twoOutputs)
  })

  it('skips workflows with a node titled Result', () => {
    const fn = legacyFunction({
      ...previewWorkflow(),
      '40': { class_type: 'CustomTextNode', _meta: { title: '  Result ' }, inputs: {} },
    })
    expect(repairFallbackComfyOutputs(fn)).toBe(fn)
  })

  it('skips non-ComfyUI formats', () => {
    const base = legacyFunction()
    const fn: GenerationFunction = { ...base, workflow: { ...base.workflow, format: 'http_request' } }
    expect(repairFallbackComfyOutputs(fn)).toBe(fn)
  })

  it('skips when rawJson is not an object', () => {
    const base = legacyFunction()
    const fn: GenerationFunction = {
      ...base,
      workflow: { ...base.workflow, rawJson: null as unknown as ComfyWorkflow },
    }
    expect(repairFallbackComfyOutputs(fn)).toBe(fn)
  })
})
