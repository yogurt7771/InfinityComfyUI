import { describe, expect, it } from 'vitest'
import {
  createGenerationFunctionFromWorkflow,
  inferWorkflowOutputs,
  mergeWorkflowOutputs,
  repairFallbackComfyOutputs,
} from './workflow'
import type { ComfyNodeTypes } from './comfyNodeTypes'
import type { ComfyWorkflow, FunctionOutputDef, GenerationFunction, ResourceType } from './types'

const NOW = '2026-05-08T09:00:00.000Z'

const LEGACY_FALLBACK: FunctionOutputDef = {
  key: 'result',
  label: 'Result',
  type: 'text',
  bind: { nodeTitle: 'Result' },
  extract: { source: 'history', multiple: true },
}

const LABELS: Record<string, string> = { image: 'Image', video: 'Video', audio: 'Audio', text: 'Text' }

/** Expected output definition per contract 2a. `n` is the 1-based index within the type. */
const out = (type: ResourceType, n: number, nodeId: string, nodeTitle: string): FunctionOutputDef => ({
  key: n === 1 ? type : `${type}_${n}`,
  label: n === 1 ? LABELS[type]! : `${LABELS[type]} ${n}`,
  type,
  bind: { nodeId, nodeTitle },
  extract: { source: type === 'text' ? 'node_output' : 'history', multiple: true },
})

const NODE_TYPES: ComfyNodeTypes = {
  CheckpointLoaderSimple: { outputNode: false, inputTypes: { ckpt_name: ['COMBO'] } },
  CLIPTextEncode: { outputNode: false, inputTypes: { text: ['STRING'], clip: ['CLIP'] } },
  KSampler: {
    outputNode: false,
    inputTypes: { model: ['MODEL'], seed: ['INT'], steps: ['INT'], positive: ['CONDITIONING'], latent_image: ['LATENT'] },
  },
  VAEDecode: { outputNode: false, inputTypes: { samples: ['LATENT'], vae: ['VAE'] } },
  LoadImage: { outputNode: false, inputTypes: { image: ['COMBO'] } },
  SaveImage: { outputNode: true, inputTypes: { images: ['IMAGE'], filename_prefix: ['STRING'] } },
  PreviewImage: { outputNode: true, inputTypes: { images: ['IMAGE'] } },
  MyFancySaver: { outputNode: true, inputTypes: { pixels: ['IMAGE'], note: ['STRING'] } },
  MaskPreview: { outputNode: true, inputTypes: { mask: ['MASK'] } },
  ImageOrMaskSink: { outputNode: true, inputTypes: { thing: ['IMAGE', 'MASK'] } },
  SaveVideo: { outputNode: true, inputTypes: { video: ['VIDEO'], filename_prefix: ['STRING'], format: ['COMBO'] } },
  SaveAudio: { outputNode: true, inputTypes: { audio: ['AUDIO'], filename_prefix: ['STRING'] } },
  DisplayAny: { outputNode: true, inputTypes: { value: ['STRING'] } },
  AnySink: { outputNode: true, inputTypes: { anything: ['*'] } },
  LatentSink: { outputNode: true, inputTypes: { samples: ['LATENT'] } },
  MultiSink: {
    outputNode: true,
    inputTypes: { images: ['IMAGE'], video: ['VIDEO'], audio: ['AUDIO'], text: ['STRING'] },
  },
  // Named like a save node, but the server says it is not an output node.
  SaveImageExtended: { outputNode: false, inputTypes: { images: ['IMAGE'] } },
  SaveImageToMemory: { outputNode: false, inputTypes: { images: ['IMAGE'] } },
  // Output node without any media inputs: never an output, but still never bound as an input.
  CustomSink: { outputNode: true, inputTypes: { image: ['COMBO'], label: ['STRING'] } },
}

const ckpt = { class_type: 'CheckpointLoaderSimple', _meta: { title: 'Checkpoint' }, inputs: { ckpt_name: 'model.safetensors' } }
const sampler = { class_type: 'KSampler', _meta: { title: 'Sampler' }, inputs: { model: ['1', 0], seed: 1, steps: 20 } }
const decode = { class_type: 'VAEDecode', _meta: { title: 'Decode' }, inputs: { samples: ['3', 0], vae: ['1', 2] } }

/** A base graph every class of which is known to NODE_TYPES and none of which is an output. */
const baseGraph = (): ComfyWorkflow => ({
  '1': structuredClone(ckpt),
  '3': structuredClone(sampler),
  '8': structuredClone(decode),
})

describe('inferWorkflowOutputs with node types (2a)', () => {
  it('recognizes PreviewImage by its IMAGE link', () => {
    const result = inferWorkflowOutputs(
      { ...baseGraph(), '20': { class_type: 'PreviewImage', _meta: { title: 'Peek' }, inputs: { images: ['8', 0] } } },
      NODE_TYPES,
    )
    expect(result).toEqual({ outputs: [out('image', 1, '20', 'Peek')], inference: 'node_types' })
  })

  it('treats SaveImage as image, not text, despite its STRING filename_prefix widget', () => {
    const result = inferWorkflowOutputs(
      {
        ...baseGraph(),
        '9': {
          class_type: 'SaveImage',
          _meta: { title: 'Save' },
          inputs: { images: ['8', 0], filename_prefix: 'ComfyUI' },
        },
      },
      NODE_TYPES,
    )
    expect(result).toEqual({ outputs: [out('image', 1, '9', 'Save')], inference: 'node_types' })
  })

  it('does not count widget values: a SaveImage with only a filename_prefix widget is not an output', () => {
    const result = inferWorkflowOutputs(
      { ...baseGraph(), '9': { class_type: 'SaveImage', _meta: { title: 'Save' }, inputs: { filename_prefix: 'ComfyUI' } } },
      NODE_TYPES,
    )
    expect(result).toEqual({ outputs: [LEGACY_FALLBACK], inference: 'node_types' })
  })

  it('recognizes a custom save class whose name gives no hint', () => {
    const result = inferWorkflowOutputs(
      { ...baseGraph(), '12': { class_type: 'MyFancySaver', _meta: { title: 'Fancy' }, inputs: { pixels: ['8', 0] } } },
      NODE_TYPES,
    )
    expect(result).toEqual({ outputs: [out('image', 1, '12', 'Fancy')], inference: 'node_types' })
  })

  it('accepts numeric source node ids in links', () => {
    const result = inferWorkflowOutputs(
      { ...baseGraph(), '12': { class_type: 'MyFancySaver', _meta: { title: 'Fancy' }, inputs: { pixels: [8, 0] } } },
      NODE_TYPES,
    )
    expect(result.outputs).toEqual([out('image', 1, '12', 'Fancy')])
  })

  it.each([
    ['a plain string', 'pixels.png'],
    ['a 3-element array', ['8', 0, 1]],
    ['a 1-element array', ['8']],
    ['an array with a string output index', ['8', '0']],
    ['an object', { node: '8', index: 0 }],
  ])('ignores a non-link value (%s) on a typed IMAGE input', (_label, value) => {
    const result = inferWorkflowOutputs(
      { ...baseGraph(), '12': { class_type: 'MyFancySaver', _meta: { title: 'Fancy' }, inputs: { pixels: value } } },
      NODE_TYPES,
    )
    expect(result).toEqual({ outputs: [LEGACY_FALLBACK], inference: 'node_types' })
  })

  it('ignores linked inputs missing from inputTypes', () => {
    const result = inferWorkflowOutputs(
      { ...baseGraph(), '12': { class_type: 'MyFancySaver', _meta: { title: 'Fancy' }, inputs: { extra_image: ['8', 0] } } },
      NODE_TYPES,
    )
    expect(result).toEqual({ outputs: [LEGACY_FALLBACK], inference: 'node_types' })
  })

  it('recognizes VIDEO and AUDIO typed outputs', () => {
    const result = inferWorkflowOutputs(
      {
        ...baseGraph(),
        '30': {
          class_type: 'SaveVideo',
          _meta: { title: 'Video Out' },
          inputs: { video: ['40', 0], filename_prefix: 'video/x', format: 'mp4' },
        },
        '31': { class_type: 'SaveAudio', _meta: { title: 'Audio Out' }, inputs: { audio: ['41', 0], filename_prefix: 'a' } },
      },
      NODE_TYPES,
    )
    expect(result).toEqual({
      outputs: [out('video', 1, '30', 'Video Out'), out('audio', 1, '31', 'Audio Out')],
      inference: 'node_types',
    })
  })

  it('recognizes a STRING-linked output node as text', () => {
    const result = inferWorkflowOutputs(
      { ...baseGraph(), '50': { class_type: 'DisplayAny', _meta: { title: 'Caption' }, inputs: { value: ['6', 0] } } },
      NODE_TYPES,
    )
    expect(result).toEqual({ outputs: [out('text', 1, '50', 'Caption')], inference: 'node_types' })
  })

  it('maps MASK links to image outputs', () => {
    const result = inferWorkflowOutputs(
      {
        ...baseGraph(),
        '60': { class_type: 'MaskPreview', _meta: { title: 'Mask' }, inputs: { mask: ['8', 1] } },
        '61': { class_type: 'ImageOrMaskSink', _meta: { title: 'Either' }, inputs: { thing: ['8', 0] } },
      },
      NODE_TYPES,
    )
    expect(result.outputs).toEqual([out('image', 1, '60', 'Mask'), out('image', 2, '61', 'Either')])
  })

  it('ignores typed output nodes whose links map to no media type', () => {
    const result = inferWorkflowOutputs(
      {
        ...baseGraph(),
        '70': { class_type: 'AnySink', _meta: { title: 'Any' }, inputs: { anything: ['8', 0] } },
        '71': { class_type: 'LatentSink', _meta: { title: 'Latent' }, inputs: { samples: ['3', 0] } },
      },
      NODE_TYPES,
    )
    expect(result).toEqual({ outputs: [LEGACY_FALLBACK], inference: 'node_types' })
  })

  it.each(['SaveImageExtended', 'SaveImageToMemory'])(
    'ignores %s when it is typed outputNode: false, even with an IMAGE link',
    (classType) => {
      const result = inferWorkflowOutputs(
        { ...baseGraph(), '80': { class_type: classType, _meta: { title: 'Not Out' }, inputs: { images: ['8', 0] } } },
        NODE_TYPES,
      )
      expect(result).toEqual({ outputs: [LEGACY_FALLBACK], inference: 'node_types' })
    },
  )

  it('ignores typed non-output nodes with STRING links', () => {
    const result = inferWorkflowOutputs(
      { ...baseGraph(), '6': { class_type: 'CLIPTextEncode', _meta: { title: 'Prompt' }, inputs: { text: ['99', 0], clip: ['1', 1] } } },
      NODE_TYPES,
    )
    expect(result).toEqual({ outputs: [LEGACY_FALLBACK], inference: 'node_types' })
  })

  it.each<[string, Record<string, unknown>, ResourceType]>([
    ['video over image, audio and text', { images: ['8', 0], video: ['40', 0], audio: ['41', 0], text: ['6', 0] }, 'video'],
    ['image over audio and text', { images: ['8', 0], audio: ['41', 0], text: ['6', 0] }, 'image'],
    ['audio over text', { audio: ['41', 0], text: ['6', 0] }, 'audio'],
    ['text alone', { text: ['6', 0] }, 'text'],
    ['video over image regardless of input order', { text: ['6', 0], images: ['8', 0], video: ['40', 0] }, 'video'],
  ])('uses type priority video > image > audio > text: %s', (_label, inputs, expected) => {
    const result = inferWorkflowOutputs(
      { ...baseGraph(), '90': { class_type: 'MultiSink', _meta: { title: 'Multi' }, inputs } },
      NODE_TYPES,
    )
    expect(result.outputs).toEqual([out(expected, 1, '90', 'Multi')])
  })

  it('keeps both SaveImage and PreviewImage when typed (no save-over-preview preference)', () => {
    const result = inferWorkflowOutputs(
      {
        ...baseGraph(),
        '20': { class_type: 'PreviewImage', _meta: { title: 'Peek' }, inputs: { images: ['8', 0] } },
        '9': { class_type: 'SaveImage', _meta: { title: 'Save' }, inputs: { images: ['8', 0], filename_prefix: 'x' } },
      },
      NODE_TYPES,
    )
    // Object.entries order puts integer-like keys in ascending order: '9' before '20'.
    expect(result.outputs).toEqual([out('image', 1, '9', 'Save'), out('image', 2, '20', 'Peek')])
  })

  it('numbers typed image outputs in workflow order', () => {
    const result = inferWorkflowOutputs(
      {
        save_c: { class_type: 'SaveImage', _meta: { title: 'C' }, inputs: { images: ['8', 0] } },
        fancy_a: { class_type: 'MyFancySaver', _meta: { title: 'A' }, inputs: { pixels: ['8', 0] } },
        peek_b: { class_type: 'PreviewImage', _meta: { title: 'B' }, inputs: { images: ['8', 0] } },
      },
      NODE_TYPES,
    )
    expect(result).toEqual({
      outputs: [out('image', 1, 'save_c', 'C'), out('image', 2, 'fancy_a', 'A'), out('image', 3, 'peek_b', 'B')],
      inference: 'node_types',
    })
  })

  it('orders outputs image, video, audio, text and numbers within each type', () => {
    const result = inferWorkflowOutputs(
      {
        t1: { class_type: 'DisplayAny', _meta: { title: 'T1' }, inputs: { value: ['6', 0] } },
        a1: { class_type: 'SaveAudio', _meta: { title: 'A1' }, inputs: { audio: ['41', 0] } },
        v1: { class_type: 'SaveVideo', _meta: { title: 'V1' }, inputs: { video: ['40', 0] } },
        i1: { class_type: 'PreviewImage', _meta: { title: 'I1' }, inputs: { images: ['8', 0] } },
        t2: { class_type: 'DisplayAny', _meta: { title: 'T2' }, inputs: { value: ['6', 0] } },
        v2: { class_type: 'SaveVideo', _meta: { title: 'V2' }, inputs: { video: ['40', 0] } },
      },
      NODE_TYPES,
    )
    expect(result).toEqual({
      outputs: [
        out('image', 1, 'i1', 'I1'),
        out('video', 1, 'v1', 'V1'),
        out('video', 2, 'v2', 'V2'),
        out('audio', 1, 'a1', 'A1'),
        out('text', 1, 't1', 'T1'),
        out('text', 2, 't2', 'T2'),
      ],
      inference: 'node_types',
    })
  })

  it('gives untitled typed outputs a non-empty nodeTitle', () => {
    const result = inferWorkflowOutputs({ '12': { class_type: 'MyFancySaver', inputs: { pixels: ['8', 0] } } }, NODE_TYPES)
    expect(result.outputs).toHaveLength(1)
    expect(result.outputs[0]).toMatchObject({ key: 'image', type: 'image', bind: { nodeId: '12' } })
    expect(result.outputs[0]!.bind.nodeTitle).toEqual(expect.any(String))
    expect(result.outputs[0]!.bind.nodeTitle!.length).toBeGreaterThan(0)
  })

  describe('inference source', () => {
    it("is 'node_types' when every class is known", () => {
      const result = inferWorkflowOutputs(
        { ...baseGraph(), '12': { class_type: 'MyFancySaver', _meta: { title: 'Fancy' }, inputs: { pixels: ['8', 0] } } },
        NODE_TYPES,
      )
      expect(result.inference).toBe('node_types')
    })

    it("is 'node_names' when a class is missing, and that node is judged by its name", () => {
      const result = inferWorkflowOutputs(
        {
          ...baseGraph(),
          '12': { class_type: 'MyFancySaver', _meta: { title: 'Fancy' }, inputs: { pixels: ['8', 0] } },
          '40': { class_type: 'VHS_VideoCombine', _meta: { title: 'Combine' }, inputs: { images: ['8', 0] } },
        },
        NODE_TYPES,
      )
      expect(result).toEqual({
        outputs: [out('image', 1, '12', 'Fancy'), out('video', 1, '40', 'Combine')],
        inference: 'node_names',
      })
    })

    it("is 'node_names' when a missing class is not name-recognized either", () => {
      const result = inferWorkflowOutputs(
        {
          ...baseGraph(),
          '12': { class_type: 'MyFancySaver', _meta: { title: 'Fancy' }, inputs: { pixels: ['8', 0] } },
          '99': { class_type: 'SomethingUnknown', _meta: { title: 'Mystery' }, inputs: { x: ['8', 0] } },
        },
        NODE_TYPES,
      )
      expect(result).toEqual({ outputs: [out('image', 1, '12', 'Fancy')], inference: 'node_names' })
    })

    it("uses name rules and 'node_names' when no nodeTypes are given", () => {
      const workflow: ComfyWorkflow = {
        ...baseGraph(),
        '12': { class_type: 'MyFancySaver', _meta: { title: 'Fancy' }, inputs: { pixels: ['8', 0] } },
        '20': { class_type: 'PreviewImage', _meta: { title: 'Peek' }, inputs: { images: ['8', 0] } },
        '9': { class_type: 'SaveImage', _meta: { title: 'Save' }, inputs: { images: ['8', 0] } },
      }
      // Name rules: MyFancySaver is not recognized; save is preferred over preview.
      expect(inferWorkflowOutputs(workflow)).toEqual({ outputs: [out('image', 1, '9', 'Save')], inference: 'node_names' })
    })

    it("uses name rules and 'node_names' with an empty nodeTypes map", () => {
      const workflow: ComfyWorkflow = {
        '12': { class_type: 'MyFancySaver', _meta: { title: 'Fancy' }, inputs: { pixels: ['8', 0] } },
        '20': { class_type: 'PreviewImage', _meta: { title: 'Peek' }, inputs: { images: ['8', 0] } },
      }
      expect(inferWorkflowOutputs(workflow, {})).toEqual({
        outputs: [out('image', 1, '20', 'Peek')],
        inference: 'node_names',
      })
    })

    it('applies save-over-preview only among untyped image nodes', () => {
      // 'Image Save' and 'Preview Image' are unknown classes; PreviewImage is typed.
      const result = inferWorkflowOutputs(
        {
          typed_peek: { class_type: 'PreviewImage', _meta: { title: 'Typed Peek' }, inputs: { images: ['8', 0] } },
          untyped_peek: { class_type: 'Preview Image', _meta: { title: 'Untyped Peek' }, inputs: { images: ['8', 0] } },
          untyped_save: { class_type: 'Image Save', _meta: { title: 'Untyped Save' }, inputs: { images: ['8', 0] } },
        },
        NODE_TYPES,
      )
      expect(result).toEqual({
        outputs: [out('image', 1, 'typed_peek', 'Typed Peek'), out('image', 2, 'untyped_save', 'Untyped Save')],
        inference: 'node_names',
      })
    })

    it('keeps an untyped preview when the only save node is typed', () => {
      const result = inferWorkflowOutputs(
        {
          save: { class_type: 'SaveImage', _meta: { title: 'Typed Save' }, inputs: { images: ['8', 0] } },
          peek: { class_type: 'ImagePreview', _meta: { title: 'Untyped Peek' }, inputs: { images: ['8', 0] } },
        },
        NODE_TYPES,
      )
      expect(result).toEqual({
        outputs: [out('image', 1, 'save', 'Typed Save'), out('image', 2, 'peek', 'Untyped Peek')],
        inference: 'node_names',
      })
    })

    it('never treats an untyped websocket node as an output', () => {
      const result = inferWorkflowOutputs(
        { ...baseGraph(), '9': { class_type: 'SaveImageWebsocket', _meta: { title: 'WS' }, inputs: { images: ['8', 0] } } },
        NODE_TYPES,
      )
      expect(result).toEqual({ outputs: [LEGACY_FALLBACK], inference: 'node_names' })
    })
  })

  describe('fallback', () => {
    it("returns the legacy fallback with 'node_types' when all classes are known but none is an output", () => {
      expect(inferWorkflowOutputs(baseGraph(), NODE_TYPES)).toEqual({ outputs: [LEGACY_FALLBACK], inference: 'node_types' })
    })

    it("returns the legacy fallback with 'node_names' when nothing is found and a class is unknown", () => {
      expect(
        inferWorkflowOutputs({ ...baseGraph(), '99': { class_type: 'Mystery', inputs: {} } }, NODE_TYPES),
      ).toEqual({ outputs: [LEGACY_FALLBACK], inference: 'node_names' })
    })

    it("returns the legacy fallback with 'node_names' when no nodeTypes are given", () => {
      expect(inferWorkflowOutputs(baseGraph())).toEqual({ outputs: [LEGACY_FALLBACK], inference: 'node_names' })
    })

    it("returns the legacy fallback with 'node_types' for an empty workflow when nodeTypes are given", () => {
      expect(inferWorkflowOutputs({}, NODE_TYPES)).toEqual({ outputs: [LEGACY_FALLBACK], inference: 'node_types' })
    })
  })

  it('does not mutate the workflow or the nodeTypes', () => {
    const workflow: ComfyWorkflow = {
      ...baseGraph(),
      '12': { class_type: 'MyFancySaver', _meta: { title: 'Fancy' }, inputs: { pixels: ['8', 0] } },
    }
    const nodeTypes = structuredClone(NODE_TYPES)
    const workflowSnapshot = structuredClone(workflow)
    inferWorkflowOutputs(workflow, nodeTypes)
    expect(workflow).toEqual(workflowSnapshot)
    expect(nodeTypes).toEqual(NODE_TYPES)
  })
})

describe('createGenerationFunctionFromWorkflow with node types (2b)', () => {
  const create = (workflow: ComfyWorkflow, nodeTypes?: ComfyNodeTypes) =>
    createGenerationFunctionFromWorkflow('fn_1', 'Test', workflow, NOW, nodeTypes ? { nodeTypes } : undefined)

  it('takes outputs and outputInference from inferWorkflowOutputs', () => {
    const workflow: ComfyWorkflow = {
      ...baseGraph(),
      '12': { class_type: 'MyFancySaver', _meta: { title: 'Fancy' }, inputs: { pixels: ['8', 0] } },
      '31': { class_type: 'SaveAudio', _meta: { title: 'Audio Out' }, inputs: { audio: ['41', 0] } },
    }
    const fn = create(workflow, NODE_TYPES)
    expect(fn.outputs).toEqual([out('image', 1, '12', 'Fancy'), out('audio', 1, '31', 'Audio Out')])
    expect(fn.outputInference).toBe('node_types')
    const inferred = inferWorkflowOutputs(workflow, NODE_TYPES)
    expect(fn.outputs).toEqual(inferred.outputs)
    expect(fn.outputInference).toBe(inferred.inference)
  })

  it("sets outputInference 'node_names' without nodeTypes", () => {
    const fn = create({ '20': { class_type: 'PreviewImage', _meta: { title: 'Peek' }, inputs: { images: ['8', 0] } } })
    expect(fn.outputs).toEqual([out('image', 1, '20', 'Peek')])
    expect(fn.outputInference).toBe('node_names')
  })

  it("sets outputInference 'node_names' when some class is missing from nodeTypes", () => {
    const fn = create(
      {
        '12': { class_type: 'MyFancySaver', _meta: { title: 'Fancy' }, inputs: { pixels: ['8', 0] } },
        '99': { class_type: 'Mystery', inputs: {} },
      },
      NODE_TYPES,
    )
    expect(fn.outputs).toEqual([out('image', 1, '12', 'Fancy')])
    expect(fn.outputInference).toBe('node_names')
  })

  it('stores the legacy fallback when typed inference finds nothing', () => {
    const fn = create(baseGraph(), NODE_TYPES)
    expect(fn.outputs).toEqual([LEGACY_FALLBACK])
    expect(fn.outputInference).toBe('node_types')
  })

  it('never binds inputs to typed output nodes, and still binds media inputs elsewhere', () => {
    const fn = create(
      {
        '10': { class_type: 'LoadImage', _meta: { title: 'Load' }, inputs: { image: 'a.png' } },
        '12': {
          class_type: 'MyFancySaver',
          _meta: { title: 'Fancy' },
          inputs: { pixels: ['10', 0], image: 'b.png', note: 'hello there' },
        },
        '9': {
          class_type: 'SaveImage',
          _meta: { title: 'Save' },
          inputs: { images: ['10', 0], image: 'c.png', filename_prefix: 'ComfyUI' },
        },
      },
      NODE_TYPES,
    )
    const boundNodeIds = fn.inputs.map((input) => input.bind.nodeId)
    expect(boundNodeIds).not.toContain('12')
    expect(boundNodeIds).not.toContain('9')
    expect(fn.inputs.some((input) => input.type === 'image' && input.bind.nodeId === '10')).toBe(true)
  })

  it('never binds inputs to a typed outputNode that has no media links (and is therefore not an output)', () => {
    const fn = create(
      {
        '10': { class_type: 'LoadImage', _meta: { title: 'Load' }, inputs: { image: 'a.png' } },
        '15': { class_type: 'CustomSink', _meta: { title: 'Sink' }, inputs: { image: 'z.png', label: 'hello' } },
      },
      NODE_TYPES,
    )
    expect(fn.outputs).toEqual([LEGACY_FALLBACK])
    expect(fn.inputs.map((input) => input.bind.nodeId)).not.toContain('15')
    expect(fn.inputs.some((input) => input.type === 'image' && input.bind.nodeId === '10')).toBe(true)
  })

  it('never binds inputs to untyped name-matched output nodes when nodeTypes miss their class', () => {
    const fn = create(
      {
        '10': { class_type: 'LoadImage', _meta: { title: 'Load' }, inputs: { image: 'a.png' } },
        '20': { class_type: 'Image Save', _meta: { title: 'Save' }, inputs: { image: 'b.png', images: ['10', 0] } },
      },
      NODE_TYPES,
    )
    expect(fn.outputs).toEqual([out('image', 1, '20', 'Save')])
    expect(fn.inputs.map((input) => input.bind.nodeId)).not.toContain('20')
  })
})

describe('repairFallbackComfyOutputs with node types (2c)', () => {
  const fancyWorkflow = (): ComfyWorkflow => ({
    ...baseGraph(),
    '12': { class_type: 'MyFancySaver', _meta: { title: 'Fancy Out' }, inputs: { pixels: ['8', 0] } },
  })

  const legacyFunction = (rawJson: ComfyWorkflow = fancyWorkflow()): GenerationFunction => ({
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
    outputs: [structuredClone(LEGACY_FALLBACK)],
    runtimeDefaults: { runCount: 2, seedPolicy: { mode: 'randomize_all_before_submit' } },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  })

  it('repairs using node types where name rules see nothing', () => {
    const fn = legacyFunction()
    const repaired = repairFallbackComfyOutputs(fn, NODE_TYPES)
    expect(repaired).not.toBe(fn)
    expect(repaired.outputs).toEqual([out('image', 1, '12', 'Fancy Out')])
    expect(repaired.outputInference).toBe('node_types')
  })

  it('keeps every other field unchanged', () => {
    const fn = legacyFunction()
    const repaired = repairFallbackComfyOutputs(fn, NODE_TYPES)
    expect({ ...repaired, outputs: fn.outputs, outputInference: fn.outputInference }).toEqual(fn)
  })

  it('does not mutate its arguments', () => {
    const fn = legacyFunction()
    const snapshot = structuredClone(fn)
    const nodeTypes = structuredClone(NODE_TYPES)
    repairFallbackComfyOutputs(fn, nodeTypes)
    expect(fn).toEqual(snapshot)
    expect(nodeTypes).toEqual(NODE_TYPES)
  })

  it('returns the same object without nodeTypes when names cannot recognize the output', () => {
    const fn = legacyFunction()
    expect(repairFallbackComfyOutputs(fn)).toBe(fn)
  })

  it("sets outputInference 'node_names' when some class is unknown", () => {
    const fn = legacyFunction({ ...fancyWorkflow(), '99': { class_type: 'Mystery', inputs: {} } })
    const repaired = repairFallbackComfyOutputs(fn, NODE_TYPES)
    expect(repaired.outputs).toEqual([out('image', 1, '12', 'Fancy Out')])
    expect(repaired.outputInference).toBe('node_names')
  })

  it('returns the same object when typed inference finds no real output', () => {
    const fn = legacyFunction(baseGraph())
    expect(repairFallbackComfyOutputs(fn, NODE_TYPES)).toBe(fn)
  })

  it('returns the same object when a typed save node is not an output node', () => {
    const fn = legacyFunction({
      ...baseGraph(),
      '80': { class_type: 'SaveImageExtended', _meta: { title: 'Not Out' }, inputs: { images: ['8', 0] } },
    })
    expect(repairFallbackComfyOutputs(fn, NODE_TYPES)).toBe(fn)
  })

  it('returns the same object when outputs are not exactly the legacy fallback', () => {
    const real = { ...legacyFunction(), outputs: [out('image', 1, '12', 'Fancy Out')] }
    expect(repairFallbackComfyOutputs(real, NODE_TYPES)).toBe(real)

    const withNodeId = legacyFunction()
    withNodeId.outputs = [{ ...LEGACY_FALLBACK, bind: { nodeId: '12', nodeTitle: 'Result' } }]
    expect(repairFallbackComfyOutputs(withNodeId, NODE_TYPES)).toBe(withNodeId)

    const twoOutputs = legacyFunction()
    twoOutputs.outputs = [LEGACY_FALLBACK, { ...LEGACY_FALLBACK, key: 'result_2' }]
    expect(repairFallbackComfyOutputs(twoOutputs, NODE_TYPES)).toBe(twoOutputs)
  })

  it('returns the same object when a node is titled Result', () => {
    const fn = legacyFunction({
      ...fancyWorkflow(),
      '40': { class_type: 'DisplayAny', _meta: { title: ' Result  ' }, inputs: { value: ['6', 0] } },
    })
    expect(repairFallbackComfyOutputs(fn, NODE_TYPES)).toBe(fn)
  })

  it('returns the same object for non-ComfyUI formats', () => {
    const base = legacyFunction()
    const fn: GenerationFunction = { ...base, workflow: { ...base.workflow, format: 'http_request' } }
    expect(repairFallbackComfyOutputs(fn, NODE_TYPES)).toBe(fn)
  })

  it('returns the same object when rawJson is not an object', () => {
    const base = legacyFunction()
    const fn: GenerationFunction = { ...base, workflow: { ...base.workflow, rawJson: null as unknown as ComfyWorkflow } }
    expect(repairFallbackComfyOutputs(fn, NODE_TYPES)).toBe(fn)
  })
})

describe('mergeWorkflowOutputs (2d)', () => {
  const custom = (
    key: string,
    label: string,
    type: ResourceType,
    bind: FunctionOutputDef['bind'],
    extract: FunctionOutputDef['extract'] = { source: 'history', multiple: true },
  ): FunctionOutputDef => ({ key, label, type, bind, extract })

  it('drops the legacy fallback and appends the inferred outputs', () => {
    const inferred = [out('image', 1, '12', 'Fancy'), out('text', 1, '50', 'Caption')]
    expect(mergeWorkflowOutputs([structuredClone(LEGACY_FALLBACK)], inferred)).toEqual(inferred)
  })

  it('returns the inferred outputs for an empty current list', () => {
    const inferred = [out('image', 1, '12', 'Fancy'), out('image', 2, '20', 'Peek')]
    expect(mergeWorkflowOutputs([], inferred)).toEqual(inferred)
  })

  it('keeps a current output bound to an inferred nodeId, taking type and extract.source from the inferred one', () => {
    const current = [
      custom('render', 'My Render', 'image', { nodeId: '9', nodeTitle: 'Old Title', field: 'images' }, {
        source: 'history',
        multiple: false,
        index: 2,
      }),
    ]
    const inferred = [out('video', 1, '9', 'New Title')]
    expect(mergeWorkflowOutputs(current, inferred)).toEqual([
      custom('render', 'My Render', 'video', { nodeId: '9', nodeTitle: 'Old Title', field: 'images' }, {
        source: 'history',
        multiple: false,
        index: 2,
      }),
    ])
  })

  it('switches extract.source to node_output when the inferred type is text, and back to history', () => {
    const current = [
      custom('caption', 'Caption', 'image', { nodeId: '50', nodeTitle: 'Cap' }, { source: 'history', multiple: true }),
      custom('pic', 'Pic', 'text', { nodeId: '12', nodeTitle: 'Pic' }, { source: 'node_output', multiple: true }),
    ]
    const inferred = [out('image', 1, '12', 'Pic'), out('text', 1, '50', 'Cap')]
    expect(mergeWorkflowOutputs(current, inferred)).toEqual([
      custom('caption', 'Caption', 'text', { nodeId: '50', nodeTitle: 'Cap' }, { source: 'node_output', multiple: true }),
      custom('pic', 'Pic', 'image', { nodeId: '12', nodeTitle: 'Pic' }, { source: 'history', multiple: true }),
    ])
  })

  it('drops current outputs whose nodeId matches no inferred output', () => {
    const current = [
      custom('gone', 'Gone', 'image', { nodeId: '77', nodeTitle: 'Deleted Node' }),
      custom('render', 'Render', 'image', { nodeId: '12', nodeTitle: 'Fancy' }),
    ]
    const inferred = [out('image', 1, '12', 'Fancy')]
    expect(mergeWorkflowOutputs(current, inferred)).toEqual([
      custom('render', 'Render', 'image', { nodeId: '12', nodeTitle: 'Fancy' }),
    ])
  })

  it('keeps title-bound current outputs unchanged', () => {
    const titleBound = custom('caption', 'Caption', 'text', { nodeTitle: 'My Caption' }, { source: 'node_output' })
    const inferred = [out('image', 1, '12', 'Fancy')]
    expect(mergeWorkflowOutputs([titleBound], inferred)).toEqual([titleBound, out('image', 1, '12', 'Fancy')])
  })

  it('appends uncovered inferred outputs after kept ones, in inferred order', () => {
    const current = [
      custom('second', 'Second', 'image', { nodeId: '20', nodeTitle: 'Peek' }),
      custom('first', 'First', 'image', { nodeId: '9', nodeTitle: 'Save' }),
    ]
    const inferred = [
      out('image', 1, '9', 'Save'),
      out('image', 2, '12', 'Fancy'),
      out('image', 3, '20', 'Peek'),
      out('video', 1, '30', 'Video Out'),
    ]
    expect(mergeWorkflowOutputs(current, inferred)).toEqual([
      custom('second', 'Second', 'image', { nodeId: '20', nodeTitle: 'Peek' }),
      custom('first', 'First', 'image', { nodeId: '9', nodeTitle: 'Save' }),
      out('image', 2, '12', 'Fancy'),
      out('video', 1, '30', 'Video Out'),
    ])
  })

  it('renames an appended output whose key collides with a kept key to the next free <type>_<n>', () => {
    const current = [custom('image', 'Image', 'image', { nodeTitle: 'Some Title' })]
    const inferred = [out('image', 1, '12', 'Fancy')]
    expect(mergeWorkflowOutputs(current, inferred)).toEqual([
      custom('image', 'Image', 'image', { nodeTitle: 'Some Title' }),
      { ...out('image', 1, '12', 'Fancy'), key: 'image_2', label: 'Image 2' },
    ])
  })

  it('skips taken numbers when renaming a colliding key', () => {
    const current = [
      custom('image', 'Image', 'image', { nodeTitle: 'A' }),
      custom('image_2', 'Image 2', 'image', { nodeTitle: 'B' }),
    ]
    const inferred = [out('image', 1, '12', 'Fancy')]
    expect(mergeWorkflowOutputs(current, inferred)).toEqual([
      ...current,
      { ...out('image', 1, '12', 'Fancy'), key: 'image_3', label: 'Image 3' },
    ])
  })

  it('renames a colliding text output with text_<n>', () => {
    const current = [custom('text', 'Text', 'text', { nodeTitle: 'Cap' }, { source: 'node_output', multiple: true })]
    const inferred = [out('text', 1, '51', 'Other Cap')]
    expect(mergeWorkflowOutputs(current, inferred)).toEqual([
      current[0],
      { ...out('text', 1, '51', 'Other Cap'), key: 'text_2', label: 'Text 2' },
    ])
  })

  it('does not mutate its inputs', () => {
    const current = [
      structuredClone(LEGACY_FALLBACK),
      custom('render', 'Render', 'image', { nodeId: '9', nodeTitle: 'Save' }),
      custom('image', 'Image', 'image', { nodeTitle: 'T' }),
    ]
    const inferred = [out('video', 1, '9', 'Save'), out('image', 1, '12', 'Fancy')]
    const currentSnapshot = structuredClone(current)
    const inferredSnapshot = structuredClone(inferred)
    mergeWorkflowOutputs(current, inferred)
    expect(current).toEqual(currentSnapshot)
    expect(inferred).toEqual(inferredSnapshot)
  })
})
