import { describe, expect, it } from 'vitest'
import {
  createGenerationFunctionFromWorkflow,
  inferWorkflowOutputs,
  mergeWorkflowOutputs,
  repairFallbackComfyOutputs,
  workflowOutputCandidates,
  workflowOutputNodes,
} from './workflow'
import type { WorkflowOutputNode } from './workflow'
import type { ComfyNodeTypes } from './comfyNodeTypes'
import type { ComfyWorkflow, FunctionOutputDef, GenerationFunction, ResourceType } from './types'

// Black-box tests for contract v3 (user-settable ComfyUI output slots), sections 1a-1e.

const NOW = '2026-05-08T09:00:00.000Z'

const LEGACY_FALLBACK: FunctionOutputDef = {
  key: 'result',
  label: 'Result',
  type: 'text',
  bind: { nodeTitle: 'Result' },
  extract: { source: 'history', multiple: true },
}

const LABELS: Record<string, string> = { image: 'Image', video: 'Video', audio: 'Audio', text: 'Text' }

/** Expected output definition. `n` is the 1-based number used in the key/label (`image`, `image_2`, ...). */
const out = (type: ResourceType, n: number, nodeId: string, nodeTitle: string): FunctionOutputDef => ({
  key: n === 1 ? type : `${type}_${n}`,
  label: n === 1 ? LABELS[type]! : `${LABELS[type]} ${n}`,
  type,
  bind: { nodeId, nodeTitle },
  extract: { source: type === 'text' ? 'node_output' : 'history', multiple: true },
})

const custom = (
  key: string,
  label: string,
  type: ResourceType,
  bind: FunctionOutputDef['bind'],
  extract: FunctionOutputDef['extract'] = { source: 'history', multiple: true },
): FunctionOutputDef => ({ key, label, type, bind, extract })

const NODE_TYPES: ComfyNodeTypes = {
  CheckpointLoaderSimple: { outputNode: false, inputTypes: { ckpt_name: ['COMBO'] } },
  KSampler: {
    outputNode: false,
    inputTypes: { model: ['MODEL'], seed: ['INT'], steps: ['INT'], latent_image: ['LATENT'] },
  },
  VAEDecode: { outputNode: false, inputTypes: { samples: ['LATENT'], vae: ['VAE'] } },
  SaveImage: { outputNode: true, inputTypes: { images: ['IMAGE'], filename_prefix: ['STRING'] } },
  PreviewImage: { outputNode: true, inputTypes: { images: ['IMAGE'] } },
  MyFancySaver: { outputNode: true, inputTypes: { pixels: ['IMAGE'] } },
  SaveVideo: { outputNode: true, inputTypes: { video: ['VIDEO'], filename_prefix: ['STRING'] } },
  SaveAudio: { outputNode: true, inputTypes: { audio: ['AUDIO'] } },
  DisplayAny: { outputNode: true, inputTypes: { value: ['STRING'] } },
  AnySink: { outputNode: true, inputTypes: { anything: ['*'] } },
  LatentSink: { outputNode: true, inputTypes: { samples: ['LATENT'] } },
  // Output node with only widget inputs: listed, but no type can be read.
  CustomSink: { outputNode: true, inputTypes: { image: ['COMBO'], label: ['STRING'] } },
  // Named like a save node, but the server says it is not an output node.
  SaveImageExtended: { outputNode: false, inputTypes: { images: ['IMAGE'] } },
}

/** Non-output graph whose classes are all in NODE_TYPES. */
const baseGraph = (): ComfyWorkflow => ({
  '1': { class_type: 'CheckpointLoaderSimple', _meta: { title: 'Checkpoint' }, inputs: { ckpt_name: 'm.safetensors' } },
  '3': { class_type: 'KSampler', _meta: { title: 'Sampler' }, inputs: { model: ['1', 0], seed: 1, steps: 20 } },
  '8': { class_type: 'VAEDecode', _meta: { title: 'Decode' }, inputs: { samples: ['3', 0], vae: ['1', 2] } },
})

const saveNode = (title = 'Save') => ({
  class_type: 'SaveImage',
  _meta: { title },
  inputs: { images: ['8', 0], filename_prefix: 'ComfyUI' },
})
const previewNode = (title = 'Preview') => ({ class_type: 'PreviewImage', _meta: { title }, inputs: { images: ['8', 0] } })
const anySinkNode = (title = 'Any') => ({ class_type: 'AnySink', _meta: { title }, inputs: { anything: ['8', 0] } })

/** SaveImage (9) + PreviewImage (12) on top of the base graph. */
const savePreviewGraph = (): ComfyWorkflow => ({ ...baseGraph(), '9': saveNode(), '12': previewNode() })

const node = (
  nodeId: string,
  nodeTitle: string,
  classType: string,
  type: ResourceType | undefined,
  typedBy: WorkflowOutputNode['typedBy'],
): WorkflowOutputNode => ({ nodeId, nodeTitle, classType, ...(type ? { type } : {}), typedBy })

// ---------------------------------------------------------------------------------------------------------------
describe('workflowOutputNodes (1a)', () => {
  it('lists typed SaveImage and PreviewImage both as image outputs', () => {
    expect(workflowOutputNodes(savePreviewGraph(), NODE_TYPES)).toEqual([
      node('9', 'Save', 'SaveImage', 'image', 'node_types'),
      node('12', 'Preview', 'PreviewImage', 'image', 'node_types'),
    ])
  })

  it('lists name-matched SaveImage and PreviewImage both (no save-over-preview preference)', () => {
    expect(workflowOutputNodes(savePreviewGraph())).toEqual([
      node('9', 'Save', 'SaveImage', 'image', 'node_names'),
      node('12', 'Preview', 'PreviewImage', 'image', 'node_names'),
    ])
  })

  it('lists a typed output node with no readable type, with type undefined', () => {
    const result = workflowOutputNodes({ ...baseGraph(), '70': anySinkNode() }, NODE_TYPES)
    expect(result).toEqual([node('70', 'Any', 'AnySink', undefined, 'node_types')])
    expect(result[0]!.type).toBeUndefined()
  })

  it('lists typed output nodes with only LATENT links or only widget values, with type undefined', () => {
    const result = workflowOutputNodes(
      {
        ...baseGraph(),
        '71': { class_type: 'LatentSink', _meta: { title: 'Latent' }, inputs: { samples: ['3', 0] } },
        '72': { class_type: 'CustomSink', _meta: { title: 'Sink' }, inputs: { image: 'z.png', label: 'hello' } },
        '73': { class_type: 'SaveImage', _meta: { title: 'No Link' }, inputs: { filename_prefix: 'ComfyUI' } },
      },
      NODE_TYPES,
    )
    expect(result).toEqual([
      node('71', 'Latent', 'LatentSink', undefined, 'node_types'),
      node('72', 'Sink', 'CustomSink', undefined, 'node_types'),
      node('73', 'No Link', 'SaveImage', undefined, 'node_types'),
    ])
  })

  it.each([
    ['a plain string', 'pixels.png'],
    ['a 3-element array', ['8', 0, 1]],
    ['a 1-element array', ['8']],
    ['an array with a string output index', ['8', '0']],
  ])('does not read a type from a non-link value (%s), but still lists the typed output node', (_label, value) => {
    const result = workflowOutputNodes(
      { '12': { class_type: 'MyFancySaver', _meta: { title: 'Fancy' }, inputs: { pixels: value } } },
      NODE_TYPES,
    )
    expect(result).toEqual([node('12', 'Fancy', 'MyFancySaver', undefined, 'node_types')])
  })

  it('accepts numeric source node ids in links', () => {
    const result = workflowOutputNodes(
      { '12': { class_type: 'MyFancySaver', _meta: { title: 'Fancy' }, inputs: { pixels: [8, 0] } } },
      NODE_TYPES,
    )
    expect(result).toEqual([node('12', 'Fancy', 'MyFancySaver', 'image', 'node_types')])
  })

  it('excludes typed nodes that are not output nodes, even with IMAGE links and save-like names', () => {
    const result = workflowOutputNodes(
      {
        ...baseGraph(),
        '80': { class_type: 'SaveImageExtended', _meta: { title: 'Not Out' }, inputs: { images: ['8', 0] } },
      },
      NODE_TYPES,
    )
    expect(result).toEqual([])
  })

  it('reads typed video, audio and text outputs', () => {
    const result = workflowOutputNodes(
      {
        v: { class_type: 'SaveVideo', _meta: { title: 'V' }, inputs: { video: ['40', 0], filename_prefix: 'x' } },
        a: { class_type: 'SaveAudio', _meta: { title: 'A' }, inputs: { audio: ['41', 0] } },
        t: { class_type: 'DisplayAny', _meta: { title: 'T' }, inputs: { value: ['6', 0] } },
      },
      NODE_TYPES,
    )
    expect(result).toEqual([
      node('v', 'V', 'SaveVideo', 'video', 'node_types'),
      node('a', 'A', 'SaveAudio', 'audio', 'node_types'),
      node('t', 'T', 'DisplayAny', 'text', 'node_types'),
    ])
  })

  it('keeps Object.entries order (not grouped by type)', () => {
    const result = workflowOutputNodes(
      {
        t1: { class_type: 'DisplayAny', _meta: { title: 'T1' }, inputs: { value: ['6', 0] } },
        any: anySinkNode('Any'),
        i1: previewNode('I1'),
        v1: { class_type: 'SaveVideo', _meta: { title: 'V1' }, inputs: { video: ['40', 0] } },
      },
      NODE_TYPES,
    )
    expect(result.map((entry) => entry.nodeId)).toEqual(['t1', 'any', 'i1', 'v1'])
  })

  it('uses node_names for nodes whose class is missing from nodeTypes, and node_types for the others', () => {
    const result = workflowOutputNodes(
      {
        ...baseGraph(),
        '9': saveNode(),
        '40': { class_type: 'VHS_VideoCombine', _meta: { title: 'Combine' }, inputs: { images: ['8', 0] } },
        '41': { class_type: 'Image Preview', _meta: { title: 'Peek' }, inputs: { images: ['8', 0] } },
        '99': { class_type: 'SomethingUnknown', _meta: { title: 'Mystery' }, inputs: { x: ['8', 0] } },
      },
      NODE_TYPES,
    )
    expect(result).toEqual([
      node('9', 'Save', 'SaveImage', 'image', 'node_types'),
      node('40', 'Combine', 'VHS_VideoCombine', 'video', 'node_names'),
      node('41', 'Peek', 'Image Preview', 'image', 'node_names'),
    ])
  })

  it('applies the name rules to untyped nodes (image, video, audio, text) and skips unrecognized ones', () => {
    const result = workflowOutputNodes({
      a: { class_type: 'SaveAnimatedWEBP', _meta: { title: 'Anim' }, inputs: { images: ['8', 0] } },
      b: { class_type: 'VHS_VideoCombine', _meta: { title: 'Combine' }, inputs: { images: ['8', 0] } },
      c: { class_type: 'PreviewAudio', _meta: { title: 'Hear' }, inputs: { audio: ['5', 0] } },
      d: { class_type: 'ShowText|pysssss', _meta: { title: 'Show' }, inputs: { text: ['6', 0] } },
      e: { class_type: 'MyFancySaver', _meta: { title: 'Fancy' }, inputs: { pixels: ['8', 0] } },
      f: { class_type: 'KSampler', _meta: { title: 'Sampler' }, inputs: { seed: 1 } },
    })
    expect(result).toEqual([
      node('a', 'Anim', 'SaveAnimatedWEBP', 'image', 'node_names'),
      node('b', 'Combine', 'VHS_VideoCombine', 'video', 'node_names'),
      node('c', 'Hear', 'PreviewAudio', 'audio', 'node_names'),
      node('d', 'Show', 'ShowText|pysssss', 'text', 'node_names'),
    ])
  })

  it('never lists an untyped websocket node', () => {
    expect(
      workflowOutputNodes({ '9': { class_type: 'SaveImageWebsocket', _meta: { title: 'WS' }, inputs: { images: ['8', 0] } } }),
    ).toEqual([])
  })

  it('treats an empty nodeTypes map as untyped', () => {
    expect(workflowOutputNodes(savePreviewGraph(), {})).toEqual([
      node('9', 'Save', 'SaveImage', 'image', 'node_names'),
      node('12', 'Preview', 'PreviewImage', 'image', 'node_names'),
    ])
  })

  it('trims _meta.title and falls back to the node id when there is no title', () => {
    const result = workflowOutputNodes(
      {
        '9': { class_type: 'SaveImage', _meta: { title: '  Padded Save  ' }, inputs: { images: ['8', 0] } },
        '12': { class_type: 'PreviewImage', inputs: { images: ['8', 0] } },
      },
      NODE_TYPES,
    )
    expect(result).toEqual([
      node('9', 'Padded Save', 'SaveImage', 'image', 'node_types'),
      node('12', '12', 'PreviewImage', 'image', 'node_types'),
    ])
  })

  it('returns [] for a workflow without output nodes', () => {
    expect(workflowOutputNodes(baseGraph(), NODE_TYPES)).toEqual([])
    expect(workflowOutputNodes({})).toEqual([])
  })

  it('does not mutate the workflow or the nodeTypes', () => {
    const workflow = { ...savePreviewGraph(), '70': anySinkNode() }
    const workflowSnapshot = structuredClone(workflow)
    const nodeTypes = structuredClone(NODE_TYPES)
    workflowOutputNodes(workflow, nodeTypes)
    expect(workflow).toEqual(workflowSnapshot)
    expect(nodeTypes).toEqual(NODE_TYPES)
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('inferWorkflowOutputs default selection (1b)', () => {
  it('enables both typed SaveImage and PreviewImage by default', () => {
    expect(inferWorkflowOutputs(savePreviewGraph(), NODE_TYPES)).toEqual({
      outputs: [out('image', 1, '9', 'Save'), out('image', 2, '12', 'Preview')],
      inference: 'node_types',
    })
  })

  it('enables both name-matched SaveImage and PreviewImage by default', () => {
    expect(inferWorkflowOutputs(savePreviewGraph())).toEqual({
      outputs: [out('image', 1, '9', 'Save'), out('image', 2, '12', 'Preview')],
      inference: 'node_names',
    })
  })

  it('keeps a name-matched preview next to a name-matched save in a partially typed workflow', () => {
    const result = inferWorkflowOutputs(
      {
        ...baseGraph(),
        '20': { class_type: 'Image Save', _meta: { title: 'Untyped Save' }, inputs: { images: ['8', 0] } },
        '21': { class_type: 'Preview Image', _meta: { title: 'Untyped Peek' }, inputs: { images: ['8', 0] } },
      },
      NODE_TYPES,
    )
    expect(result).toEqual({
      outputs: [out('image', 1, '20', 'Untyped Save'), out('image', 2, '21', 'Untyped Peek')],
      inference: 'node_names',
    })
  })

  it('does not enable typed output nodes without a type', () => {
    const result = inferWorkflowOutputs({ ...savePreviewGraph(), '70': anySinkNode() }, NODE_TYPES)
    expect(result).toEqual({
      outputs: [out('image', 1, '9', 'Save'), out('image', 2, '12', 'Preview')],
      inference: 'node_types',
    })
  })

  it('returns the legacy fallback when the only output nodes have no type', () => {
    expect(inferWorkflowOutputs({ ...baseGraph(), '70': anySinkNode() }, NODE_TYPES)).toEqual({
      outputs: [LEGACY_FALLBACK],
      inference: 'node_types',
    })
  })

  it('orders image, video, audio, text and numbers within each type in workflow order', () => {
    const result = inferWorkflowOutputs(
      {
        t1: { class_type: 'DisplayAny', _meta: { title: 'T1' }, inputs: { value: ['6', 0] } },
        p1: previewNode('P1'),
        v1: { class_type: 'SaveVideo', _meta: { title: 'V1' }, inputs: { video: ['40', 0] } },
        s1: saveNode('S1'),
        any: anySinkNode(),
      },
      NODE_TYPES,
    )
    expect(result).toEqual({
      outputs: [out('image', 1, 'p1', 'P1'), out('image', 2, 's1', 'S1'), out('video', 1, 'v1', 'V1'), out('text', 1, 't1', 'T1')],
      inference: 'node_types',
    })
  })

  it('selects exactly the typed nodes of workflowOutputNodes', () => {
    const workflow: ComfyWorkflow = {
      ...savePreviewGraph(),
      '70': anySinkNode(),
      '30': { class_type: 'SaveVideo', _meta: { title: 'Vid' }, inputs: { video: ['40', 0] } },
    }
    const typedIds = workflowOutputNodes(workflow, NODE_TYPES)
      .filter((entry) => entry.type !== undefined)
      .map((entry) => entry.nodeId)
      .sort()
    const outputIds = inferWorkflowOutputs(workflow, NODE_TYPES)
      .outputs.map((output) => output.bind.nodeId)
      .sort()
    expect(outputIds).toEqual(typedIds)
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('createGenerationFunctionFromWorkflow and repairFallbackComfyOutputs follow 1b (1e)', () => {
  it('creates a function with both SaveImage and PreviewImage outputs (typed)', () => {
    const fn = createGenerationFunctionFromWorkflow('fn_1', 'Test', savePreviewGraph(), NOW, { nodeTypes: NODE_TYPES })
    expect(fn.outputs).toEqual([out('image', 1, '9', 'Save'), out('image', 2, '12', 'Preview')])
    expect(fn.outputInference).toBe('node_types')
  })

  it('creates a function with both SaveImage and PreviewImage outputs (name-only)', () => {
    const fn = createGenerationFunctionFromWorkflow('fn_1', 'Test', savePreviewGraph(), NOW)
    expect(fn.outputs).toEqual([out('image', 1, '9', 'Save'), out('image', 2, '12', 'Preview')])
    expect(fn.outputInference).toBe('node_names')
  })

  it('does not enable a typed output node without a type when creating a function', () => {
    const fn = createGenerationFunctionFromWorkflow('fn_1', 'Test', { ...savePreviewGraph(), '70': anySinkNode() }, NOW, {
      nodeTypes: NODE_TYPES,
    })
    expect(fn.outputs.map((output) => output.bind.nodeId)).toEqual(['9', '12'])
  })

  const legacyFunction = (rawJson: ComfyWorkflow): GenerationFunction => ({
    id: 'fn_legacy',
    name: 'Legacy',
    category: 'Generate',
    workflow: { format: 'comfyui_api_json', rawJson, editor: { kind: 'comfyui_embedded', endpointId: 'ep', savedAt: NOW } },
    inputs: [],
    outputs: [structuredClone(LEGACY_FALLBACK)],
    runtimeDefaults: { runCount: 1, seedPolicy: { mode: 'randomize_all_before_submit' } },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  })

  it('repairs a legacy fallback into both SaveImage and PreviewImage outputs (typed)', () => {
    const fn = legacyFunction(savePreviewGraph())
    const repaired = repairFallbackComfyOutputs(fn, NODE_TYPES)
    expect(repaired).not.toBe(fn)
    expect(repaired.outputs).toEqual([out('image', 1, '9', 'Save'), out('image', 2, '12', 'Preview')])
    expect(repaired.outputInference).toBe('node_types')
  })

  it('repairs a legacy fallback into both SaveImage and PreviewImage outputs (name-only)', () => {
    const fn = legacyFunction(savePreviewGraph())
    const repaired = repairFallbackComfyOutputs(fn)
    expect(repaired.outputs).toEqual([out('image', 1, '9', 'Save'), out('image', 2, '12', 'Preview')])
    expect(repaired.outputInference).toBe('node_names')
  })

  it('does not repair when the only output node has no type', () => {
    const fn = legacyFunction({ ...baseGraph(), '70': anySinkNode() })
    expect(repairFallbackComfyOutputs(fn, NODE_TYPES)).toBe(fn)
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('workflowOutputCandidates (1c)', () => {
  it('offers nothing when all typed outputs are enabled and there is no untyped output node', () => {
    const workflow = savePreviewGraph()
    const enabled = inferWorkflowOutputs(workflow, NODE_TYPES).outputs
    expect(workflowOutputCandidates(workflow, enabled, NODE_TYPES)).toEqual([])
  })

  it('offers a disabled PreviewImage, numbering its key after the existing image key', () => {
    const workflow = savePreviewGraph()
    const existing = [out('image', 1, '9', 'Save')]
    expect(workflowOutputCandidates(workflow, existing, NODE_TYPES)).toEqual([out('image', 2, '12', 'Preview')])
  })

  it('offers a typed output node without a readable type as a text candidate', () => {
    const workflow = { ...savePreviewGraph(), '70': anySinkNode() }
    const enabled = inferWorkflowOutputs(workflow, NODE_TYPES).outputs
    expect(workflowOutputCandidates(workflow, enabled, NODE_TYPES)).toEqual([
      {
        key: 'text',
        label: 'Text',
        type: 'text',
        bind: { nodeId: '70', nodeTitle: 'Any' },
        extract: { source: 'node_output', multiple: true },
      },
    ])
  })

  it('lists every output node in workflow order when nothing is enabled, numbering keys per type', () => {
    const workflow: ComfyWorkflow = {
      peek: previewNode('Peek'),
      any: anySinkNode('Any'),
      save: saveNode('Save'),
      vid: { class_type: 'SaveVideo', _meta: { title: 'Vid' }, inputs: { video: ['40', 0] } },
      cap: { class_type: 'DisplayAny', _meta: { title: 'Cap' }, inputs: { value: ['6', 0] } },
      other: { class_type: 'KSampler', _meta: { title: 'Sampler' }, inputs: { seed: 1 } },
    }
    expect(workflowOutputCandidates(workflow, [], NODE_TYPES)).toEqual([
      out('image', 1, 'peek', 'Peek'),
      out('text', 1, 'any', 'Any'),
      out('image', 2, 'save', 'Save'),
      out('video', 1, 'vid', 'Vid'),
      out('text', 2, 'cap', 'Cap'),
    ])
  })

  it('treats the legacy fallback (no nodeId) as excluding nothing, but its key is still taken', () => {
    const workflow = savePreviewGraph()
    expect(workflowOutputCandidates(workflow, [LEGACY_FALLBACK], NODE_TYPES)).toEqual([
      out('image', 1, '9', 'Save'),
      out('image', 2, '12', 'Preview'),
    ])
  })

  it('excludes nodes bound by any existing output, whatever its type or key', () => {
    const workflow = { ...savePreviewGraph(), '70': anySinkNode() }
    const existing = [
      custom('render', 'Render', 'video', { nodeId: '9', nodeTitle: 'Save' }),
      custom('notes', 'Notes', 'image', { nodeId: '70', nodeTitle: 'Any' }),
    ]
    expect(workflowOutputCandidates(workflow, existing, NODE_TYPES)).toEqual([out('image', 1, '12', 'Preview')])
  })

  it('does not exclude a node matched only by an existing output bound by title', () => {
    const workflow = savePreviewGraph()
    const existing = [custom('render', 'Render', 'image', { nodeTitle: 'Preview' })]
    expect(workflowOutputCandidates(workflow, existing, NODE_TYPES)).toEqual([
      out('image', 1, '9', 'Save'),
      out('image', 2, '12', 'Preview'),
    ])
  })

  it('skips keys used by existing outputs (of any type) and by earlier candidates', () => {
    const workflow: ComfyWorkflow = {
      a: previewNode('A'),
      b: saveNode('B'),
      c: anySinkNode('C'),
      d: previewNode('D'),
    }
    const existing = [
      custom('image', 'Mine', 'image', { nodeTitle: 'Title Bound' }),
      custom('image_3', 'Third', 'image', { nodeId: 'elsewhere', nodeTitle: 'X' }),
      // A key that looks like a text key, on an image output: still blocks the bare text key.
      custom('text', 'Picture', 'image', { nodeId: 'gone', nodeTitle: 'Y' }),
    ]
    expect(workflowOutputCandidates(workflow, existing, NODE_TYPES)).toEqual([
      out('image', 2, 'a', 'A'),
      out('image', 4, 'b', 'B'),
      out('text', 2, 'c', 'C'),
      out('image', 5, 'd', 'D'),
    ])
  })

  it('offers name-matched nodes without nodeTypes', () => {
    const workflow: ComfyWorkflow = {
      ...savePreviewGraph(),
      '40': { class_type: 'VHS_VideoCombine', _meta: { title: 'Combine' }, inputs: { images: ['8', 0] } },
      '41': { class_type: 'MyFancySaver', _meta: { title: 'Fancy' }, inputs: { pixels: ['8', 0] } },
    }
    const existing = [out('image', 1, '9', 'Save')]
    expect(workflowOutputCandidates(workflow, existing)).toEqual([
      out('image', 2, '12', 'Preview'),
      out('video', 1, '40', 'Combine'),
    ])
  })

  it('uses the trimmed title or the node id as nodeTitle', () => {
    const workflow: ComfyWorkflow = {
      '9': { class_type: 'SaveImage', _meta: { title: '  Padded  ' }, inputs: { images: ['8', 0] } },
      '12': { class_type: 'PreviewImage', inputs: { images: ['8', 0] } },
    }
    expect(workflowOutputCandidates(workflow, [], NODE_TYPES)).toEqual([
      out('image', 1, '9', 'Padded'),
      out('image', 2, '12', '12'),
    ])
  })

  it('returns [] for a workflow without output nodes', () => {
    expect(workflowOutputCandidates(baseGraph(), [], NODE_TYPES)).toEqual([])
  })

  it('does not mutate its arguments', () => {
    const workflow = { ...savePreviewGraph(), '70': anySinkNode() }
    const existing = [out('image', 1, '9', 'Save')]
    const nodeTypes = structuredClone(NODE_TYPES)
    const workflowSnapshot = structuredClone(workflow)
    const existingSnapshot = structuredClone(existing)
    workflowOutputCandidates(workflow, existing, nodeTypes)
    expect(workflow).toEqual(workflowSnapshot)
    expect(existing).toEqual(existingSnapshot)
    expect(nodeTypes).toEqual(NODE_TYPES)
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('mergeWorkflowOutputs (1d)', () => {
  const previous = (): ComfyWorkflow => savePreviewGraph()
  const next = (): ComfyWorkflow => ({ ...savePreviewGraph(), '15': saveNode('New Save') })
  const nextInferred = () => inferWorkflowOutputs(next(), NODE_TYPES).outputs

  it('returns inferred for an empty current list (with or without previousWorkflow)', () => {
    const inferred = nextInferred()
    expect(mergeWorkflowOutputs([], inferred, next(), previous())).toEqual(inferred)
    expect(mergeWorkflowOutputs([], inferred, next())).toEqual(inferred)
  })

  it('returns inferred when current is exactly the legacy fallback', () => {
    const inferred = nextInferred()
    expect(mergeWorkflowOutputs([structuredClone(LEGACY_FALLBACK)], inferred, next(), previous())).toEqual(inferred)
    expect(mergeWorkflowOutputs([structuredClone(LEGACY_FALLBACK)], inferred, next())).toEqual(inferred)
  })

  it('keeps a user-edited output unchanged even when inference says another type', () => {
    const userOutput = custom(
      'render',
      'My Render',
      'video',
      { nodeId: '9', nodeTitle: 'Old Title', field: 'images' },
      { source: 'node_output', multiple: false, index: 2 },
    )
    const result = mergeWorkflowOutputs([userOutput], [out('image', 1, '9', 'Save')], savePreviewGraph(), savePreviewGraph())
    expect(result).toEqual([userOutput])
  })

  it('keeps an output bound to a node that is no longer an output node, as long as the node exists', () => {
    const userOutput = custom('decoded', 'Decoded', 'image', { nodeId: '8', nodeTitle: 'Decode' })
    const result = mergeWorkflowOutputs([userOutput], [], baseGraph(), baseGraph())
    expect(result).toEqual([userOutput])
  })

  it('drops outputs whose node was deleted from nextWorkflow', () => {
    const current = [custom('render', 'Render', 'image', { nodeId: '9', nodeTitle: 'Save' }), out('image', 2, '12', 'Preview')]
    const nextWorkflow: ComfyWorkflow = { ...baseGraph(), '12': previewNode() }
    const inferred = inferWorkflowOutputs(nextWorkflow, NODE_TYPES).outputs
    expect(mergeWorkflowOutputs(current, inferred, nextWorkflow, previous())).toEqual([out('image', 2, '12', 'Preview')])
  })

  it('can drop every output when all bound nodes were deleted and nothing is new', () => {
    const current = [custom('render', 'Render', 'image', { nodeId: '9', nodeTitle: 'Save' })]
    const nextWorkflow: ComfyWorkflow = { ...baseGraph(), '12': previewNode() }
    const inferred = inferWorkflowOutputs(nextWorkflow, NODE_TYPES).outputs
    expect(mergeWorkflowOutputs(current, inferred, nextWorkflow, previous())).toEqual([])
  })

  it('keeps title-bound outputs unchanged', () => {
    const titleBound = custom('caption', 'Caption', 'text', { nodeTitle: 'My Caption' }, { source: 'node_output' })
    const result = mergeWorkflowOutputs([titleBound], nextInferred(), next(), next())
    expect(result).toEqual([titleBound])
  })

  it('appends only output nodes that are new compared with previousWorkflow (a disabled node stays disabled)', () => {
    const userOutput = custom('render', 'Render', 'video', { nodeId: '9', nodeTitle: 'Save' })
    const inferred = nextInferred() // 9 image, 12 image_2, 15 image_3
    expect(inferred.map((output) => output.bind.nodeId)).toEqual(['9', '12', '15'])
    expect(mergeWorkflowOutputs([userOutput], inferred, next(), previous())).toEqual([userOutput, inferred[2]])
  })

  it('appends every uncovered inferred output when no previousWorkflow is given', () => {
    const userOutput = custom('render', 'Render', 'video', { nodeId: '9', nodeTitle: 'Save' })
    const inferred = nextInferred()
    expect(mergeWorkflowOutputs([userOutput], inferred, next())).toEqual([userOutput, inferred[1], inferred[2]])
  })

  it('appends nothing when the workflow gained no new nodes', () => {
    const userOutput = custom('render', 'Render', 'image', { nodeId: '9', nodeTitle: 'Save' })
    const inferred = inferWorkflowOutputs(previous(), NODE_TYPES).outputs
    expect(mergeWorkflowOutputs([userOutput], inferred, previous(), previous())).toEqual([userOutput])
  })

  it('does not append an inferred output whose node is already bound by a kept output', () => {
    const userOutput = custom('render', 'Render', 'video', { nodeId: '15', nodeTitle: 'New Save' })
    const inferred = nextInferred()
    // Node 15 is new vs previous, but already bound by the user output.
    expect(mergeWorkflowOutputs([userOutput], inferred, next(), previous())).toEqual([userOutput])
  })

  it('appends in inferred order after the kept outputs in their original order', () => {
    const nextWorkflow: ComfyWorkflow = {
      ...savePreviewGraph(),
      v: { class_type: 'SaveVideo', _meta: { title: 'Vid' }, inputs: { video: ['40', 0] } },
      s: saveNode('New Save'),
    }
    const inferred = inferWorkflowOutputs(nextWorkflow, NODE_TYPES).outputs // images 9, 12, s; video v
    const current = [
      custom('second', 'Second', 'image', { nodeId: '12', nodeTitle: 'Preview' }),
      custom('first', 'First', 'image', { nodeId: '9', nodeTitle: 'Save' }),
    ]
    expect(mergeWorkflowOutputs(current, inferred, nextWorkflow, savePreviewGraph())).toEqual([
      current[0],
      current[1],
      out('image', 3, 's', 'New Save'),
      out('video', 1, 'v', 'Vid'),
    ])
  })

  it('renames appended keys that collide with kept keys (and earlier appended ones) to the next free <type>_<n>', () => {
    const current = [
      custom('image', 'Image', 'image', { nodeTitle: 'Title A' }),
      custom('image_2', 'Image 2', 'image', { nodeTitle: 'Title B' }),
    ]
    const nextWorkflow: ComfyWorkflow = { ...baseGraph(), '15': saveNode('S15'), '16': saveNode('S16') }
    const inferred = [out('image', 1, '15', 'S15'), out('image', 2, '16', 'S16')]
    expect(mergeWorkflowOutputs(current, inferred, nextWorkflow, baseGraph())).toEqual([
      ...current,
      { ...out('image', 1, '15', 'S15'), key: 'image_3', label: 'Image 3' },
      { ...out('image', 2, '16', 'S16'), key: 'image_4', label: 'Image 4' },
    ])
  })

  it('renames a colliding text key to text_<n>', () => {
    const current = [custom('text', 'Text', 'text', { nodeTitle: 'Cap' }, { source: 'node_output', multiple: true })]
    const nextWorkflow: ComfyWorkflow = {
      '51': { class_type: 'DisplayAny', _meta: { title: 'Other Cap' }, inputs: { value: ['6', 0] } },
    }
    const inferred = [out('text', 1, '51', 'Other Cap')]
    expect(mergeWorkflowOutputs(current, inferred, nextWorkflow, {})).toEqual([
      current[0],
      { ...out('text', 1, '51', 'Other Cap'), key: 'text_2', label: 'Text 2' },
    ])
  })

  it('keeps a non-colliding appended key as inferred', () => {
    const userOutput = custom('render', 'Render', 'image', { nodeId: '9', nodeTitle: 'Save' })
    const inferred = nextInferred()
    const result = mergeWorkflowOutputs([userOutput], inferred, next(), previous())
    expect(result[1]).toEqual(out('image', 3, '15', 'New Save'))
  })

  it('does not mutate its arguments', () => {
    const current = [
      custom('render', 'Render', 'video', { nodeId: '9', nodeTitle: 'Save' }),
      custom('image_3', 'Image 3', 'image', { nodeTitle: 'T' }),
      custom('gone', 'Gone', 'image', { nodeId: '77', nodeTitle: 'Deleted' }),
    ]
    const inferred = nextInferred()
    const nextWorkflow = next()
    const previousWorkflow = previous()
    const snapshots = structuredClone({ current, inferred, nextWorkflow, previousWorkflow })
    mergeWorkflowOutputs(current, inferred, nextWorkflow, previousWorkflow)
    expect({ current, inferred, nextWorkflow, previousWorkflow }).toEqual(snapshots)
  })
})
