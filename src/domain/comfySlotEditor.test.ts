import { describe, expect, it } from 'vitest'
import {
  applyEditorSlots,
  editorNodeInputFields,
  editorNodeOutputType,
  editorSlotState,
  effectiveEditorSlots,
  renameEditorSlot,
  toggleEditorInput,
  toggleEditorOutput,
} from './comfySlotEditor'
import type { EditorNode, EditorSlotState } from './comfySlotEditor'
import type { ComfyWorkflow, FunctionInputDef, FunctionOutputDef, ResourceType } from './types'

// Black-box tests for contract v5: setting input / output slots inside the embedded ComfyUI editor.

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LABELS: Record<string, string> = { image: 'Image', video: 'Video', audio: 'Audio', text: 'Text' }

const LEGACY_FALLBACK: FunctionOutputDef = {
  key: 'result',
  label: 'Result',
  type: 'text',
  bind: { nodeTitle: 'Result' },
  extract: { source: 'history', multiple: true },
}

/** Output slot as the editor builds it. `n` is the 1-based number used in key/label (`image`, `image_2`, ...). */
const out = (type: ResourceType, n: number, nodeId: string, nodeTitle: string): FunctionOutputDef => ({
  key: n === 1 ? type : `${type}_${n}`,
  label: n === 1 ? LABELS[type]! : `${LABELS[type]} ${n}`,
  type,
  bind: { nodeId, nodeTitle },
  extract: { source: type === 'text' ? 'node_output' : 'history', multiple: true },
})

const IMAGE_UPLOAD = { strategy: 'comfy_upload', targetSubfolder: 'infinity-comfyui' } as const

const mediaIn = (key: string, label: string, type: ResourceType, nodeId: string, nodeTitle: string, field: string): FunctionInputDef => ({
  key,
  label,
  type,
  required: true,
  bind: { nodeId, nodeTitle, path: `inputs.${field}` },
  upload: type === 'image' ? { ...IMAGE_UPLOAD } : { strategy: 'manual_path' },
})

const valueIn = (
  key: string,
  label: string,
  type: ResourceType,
  nodeId: string,
  nodeTitle: string,
  field: string,
  defaultValue?: string | number | boolean,
): FunctionInputDef => ({
  key,
  label,
  type,
  required: false,
  ...(defaultValue !== undefined ? { defaultValue } : {}),
  bind: { nodeId, nodeTitle, path: `inputs.${field}` },
  upload: { strategy: 'none' },
})

const auto = <T extends object>(slot: T) => ({ ...slot, auto: true })
const explicit = <T extends object>(slot: T) => ({ ...slot, auto: false })

const editorNode = (
  nodeId: string,
  title: string,
  classType: string,
  outputNode: boolean | undefined,
  linkedInputTypes: string[],
  fields: Array<{ name: string; value: unknown }>,
): EditorNode => ({
  nodeId,
  title,
  classType,
  ...(outputNode !== undefined ? { outputNode } : {}),
  linkedInputTypes,
  fields,
})

const checkpoint = () =>
  editorNode('4', 'Load Checkpoint', 'CheckpointLoaderSimple', false, [], [{ name: 'ckpt_name', value: 'sd15.safetensors' }])
const ksampler = () =>
  editorNode('3', 'KSampler', 'KSampler', false, ['MODEL', 'CONDITIONING', 'CONDITIONING', 'LATENT'], [
    { name: 'seed', value: 42 },
    { name: 'control_after_generate', value: 'randomize' },
    { name: 'steps', value: 20 },
    { name: 'cfg', value: 7 },
    { name: 'sampler_name', value: 'euler' },
  ])
const clipText = () => editorNode('6', 'Positive Prompt', 'CLIPTextEncode', false, ['CLIP'], [{ name: 'text', value: 'a fox' }])
const vaeDecode = () =>
  editorNode('8', 'VAE Decode', 'VAEDecode', false, ['LATENT', 'VAE'], [
    { name: 'samples', value: ['3', 0] },
    { name: 'vae', value: ['4', 2] },
  ])
const saveImage = (nodeId = '9', title = 'Save Image', prefix = 'ComfyUI') =>
  editorNode(nodeId, title, 'SaveImage', true, ['IMAGE'], [{ name: 'filename_prefix', value: prefix }])
const loadImage = (nodeId = '10', title = 'Load Image', file = 'reference.png') =>
  editorNode(nodeId, title, 'LoadImage', false, [], [
    { name: 'image', value: file },
    { name: 'upload', value: undefined },
  ])
const previewImage = () => editorNode('12', 'Preview Image', 'PreviewImage', true, ['IMAGE'], [])
const saveLatent = () =>
  editorNode('13', 'Save Latent', 'SaveLatent', true, ['LATENT'], [{ name: 'filename_prefix', value: 'latents/ComfyUI' }])
const namedImageSave = () => editorNode('14', 'Image Save', 'Image Save', undefined, ['IMAGE'], [])

/** Editor nodes of the workflow an existing function was saved with (baseline 3, 4, 6, 8, 9, 10, 12). */
const baselineNodes = (): EditorNode[] => [ksampler(), checkpoint(), clipText(), vaeDecode(), saveImage(), loadImage(), previewImage()]

/** All kinds of nodes, as a fresh graph in the editor. */
const allNodes = (): EditorNode[] => [
  ksampler(),
  clipText(),
  vaeDecode(),
  saveImage(),
  loadImage(),
  previewImage(),
  saveLatent(),
  namedImageSave(),
]

const baselineRawJson = (): ComfyWorkflow => ({
  '3': {
    class_type: 'KSampler',
    _meta: { title: 'KSampler' },
    inputs: { seed: 42, control_after_generate: 'randomize', steps: 20, cfg: 7, sampler_name: 'euler', model: ['4', 0] },
  },
  '4': { class_type: 'CheckpointLoaderSimple', _meta: { title: 'Load Checkpoint' }, inputs: { ckpt_name: 'sd15.safetensors' } },
  '6': { class_type: 'CLIPTextEncode', _meta: { title: 'Positive Prompt' }, inputs: { text: 'a fox', clip: ['4', 1] } },
  '8': { class_type: 'VAEDecode', _meta: { title: 'VAE Decode' }, inputs: { samples: ['3', 0], vae: ['4', 2] } },
  '9': { class_type: 'SaveImage', _meta: { title: 'Save Image' }, inputs: { images: ['8', 0], filename_prefix: 'ComfyUI' } },
  '10': { class_type: 'LoadImage', _meta: { title: 'Load Image' }, inputs: { image: 'reference.png' } },
  '12': { class_type: 'PreviewImage', _meta: { title: 'Preview Image' }, inputs: { images: ['8', 0] } },
})

const imageInput10 = () => mediaIn('image', 'Image', 'image', '10', 'Load Image', 'image')
const promptInput6 = () => valueIn('prompt', 'Prompt', 'text', '6', 'Positive Prompt', 'text', 'a fox')

/** A function created earlier from `baselineRawJson`: LoadImage + prompt inputs, SaveImage + PreviewImage outputs. */
const existingFunction = () => ({
  inputs: [imageInput10(), promptInput6()],
  outputs: [out('image', 1, '9', 'Save Image'), out('image', 2, '12', 'Preview Image')],
  workflow: { rawJson: baselineRawJson() },
})

const emptyState = (): EditorSlotState => ({
  inputs: [],
  outputs: [],
  removedInputs: [],
  removedOutputNodeIds: [],
  baselineNodeIds: undefined,
})

const clone = <T>(value: T): T => structuredClone(value)

/**
 * Contract v5 does not exclude output nodes from `editorNodeInputFields`, and the shared inference types a
 * `filename_prefix` string on a node whose class/title mentions "image" as `image` (generic file key + media node
 * context). Whether SaveImage's filename_prefix should then become an auto media input is checked in ONE dedicated test
 * (see "SaveImage filename_prefix"); everywhere else inputs bound to SaveImage nodes are ignored so the remaining
 * assertions do not depend on that point.
 */
const SAVE_IMAGE_IDS = new Set(['9', '15'])
const withoutSaveImageInputs = <T extends { bind: { nodeId?: string } }>(inputs: T[]) =>
  inputs.filter((input) => !input.bind.nodeId || !SAVE_IMAGE_IDS.has(input.bind.nodeId))

// ---------------------------------------------------------------------------
// editorSlotState
// ---------------------------------------------------------------------------

describe('editorSlotState', () => {
  it('starts an empty session for a new function', () => {
    expect(editorSlotState()).toEqual(emptyState())
    expect(editorSlotState().baselineNodeIds).toBeUndefined()
  })

  it('copies the slots of an existing function and records the baseline node ids', () => {
    const def = existingFunction()
    const state = editorSlotState(def)
    expect(state.inputs).toEqual(def.inputs)
    expect(state.outputs).toEqual(def.outputs)
    expect(state.removedInputs).toEqual([])
    expect(state.removedOutputNodeIds).toEqual([])
    expect(state.baselineNodeIds).toEqual(Object.keys(def.workflow.rawJson))
  })

  it('returns copies, never the definition arrays, and does not mutate the definition', () => {
    const def = existingFunction()
    const before = clone(def)
    const state = editorSlotState(def)
    expect(state.inputs).not.toBe(def.inputs)
    expect(state.outputs).not.toBe(def.outputs)
    state.inputs.push(valueIn('x', 'X', 'text', '6', 'Positive Prompt', 'text'))
    state.outputs.pop()
    expect(def).toEqual(before)
  })

  it('drops the legacy fallback output but keeps other outputs', () => {
    const custom: FunctionOutputDef = {
      key: 'notes',
      label: 'Notes',
      type: 'text',
      bind: { nodeTitle: 'Notes' },
      extract: { source: 'node_output', multiple: true },
    }
    const state = editorSlotState({
      inputs: [],
      outputs: [LEGACY_FALLBACK, out('image', 1, '9', 'Save Image'), custom],
      workflow: { rawJson: baselineRawJson() },
    })
    expect(state.outputs).toEqual([out('image', 1, '9', 'Save Image'), custom])
  })

  it('a function whose only output is the legacy fallback starts with no outputs', () => {
    const state = editorSlotState({ inputs: [], outputs: [LEGACY_FALLBACK], workflow: { rawJson: baselineRawJson() } })
    expect(state.outputs).toEqual([])
  })

  it('has no baseline when the function has no workflow, no rawJson, or an empty rawJson', () => {
    expect(editorSlotState({ inputs: [], outputs: [] }).baselineNodeIds).toBeUndefined()
    expect(editorSlotState({ inputs: [], outputs: [], workflow: {} }).baselineNodeIds).toBeUndefined()
    expect(editorSlotState({ inputs: [], outputs: [], workflow: { rawJson: {} } }).baselineNodeIds).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// editorNodeOutputType
// ---------------------------------------------------------------------------

describe('editorNodeOutputType', () => {
  it('reports non-output nodes', () => {
    expect(editorNodeOutputType(loadImage())).toEqual({ reason: 'not_output_node' })
    expect(editorNodeOutputType(vaeDecode())).toEqual({ reason: 'not_output_node' })
    expect(editorNodeOutputType(ksampler())).toEqual({ reason: 'not_output_node' })
  })

  it('types output nodes from their linked inputs', () => {
    expect(editorNodeOutputType(saveImage())).toEqual({ type: 'image' })
    expect(editorNodeOutputType(previewImage())).toEqual({ type: 'image' })
    expect(editorNodeOutputType(editorNode('30', 'Mask', 'SaveMask', true, ['MASK'], []))).toEqual({ type: 'image' })
    expect(editorNodeOutputType(editorNode('31', 'Video', 'SaveVideo', true, ['VIDEO'], []))).toEqual({ type: 'video' })
    expect(editorNodeOutputType(editorNode('32', 'Audio', 'SaveAudio', true, ['AUDIO'], []))).toEqual({ type: 'audio' })
    expect(editorNodeOutputType(editorNode('33', 'Show', 'ShowAnything', true, ['STRING'], []))).toEqual({ type: 'text' })
  })

  it('upper-cases linked types before mapping', () => {
    expect(editorNodeOutputType(editorNode('34', 'Custom', 'MyFancySaver', true, ['image'], []))).toEqual({ type: 'image' })
  })

  it('picks by priority video, image, audio, text', () => {
    expect(editorNodeOutputType(editorNode('35', 'X', 'Mixed', true, ['IMAGE', 'VIDEO'], []))).toEqual({ type: 'video' })
    expect(editorNodeOutputType(editorNode('36', 'X', 'Mixed', true, ['STRING', 'AUDIO', 'IMAGE'], []))).toEqual({ type: 'image' })
    expect(editorNodeOutputType(editorNode('37', 'X', 'Mixed', true, ['STRING', 'AUDIO'], []))).toEqual({ type: 'audio' })
    expect(editorNodeOutputType(editorNode('38', 'X', 'Mixed', true, ['LATENT', 'STRING'], []))).toEqual({ type: 'text' })
  })

  it('reports output nodes without a supported linked type', () => {
    expect(editorNodeOutputType(saveLatent())).toEqual({ reason: 'no_supported_output' })
    expect(editorNodeOutputType(editorNode('39', 'Any', 'AnySink', true, ['*'], []))).toEqual({ reason: 'no_supported_output' })
    expect(editorNodeOutputType(editorNode('40', 'Nothing', 'Sink', true, [], []))).toEqual({ reason: 'no_supported_output' })
  })

  it('falls back to the class-name rules when the editor has no definition', () => {
    expect(editorNodeOutputType(namedImageSave())).toEqual({ type: 'image' })
    expect(editorNodeOutputType(editorNode('41', 'P', 'PreviewImage', undefined, [], []))).toEqual({ type: 'image' })
    expect(editorNodeOutputType(editorNode('42', 'V', 'VHS_VideoCombine', undefined, [], []))).toEqual({ type: 'video' })
    expect(editorNodeOutputType(editorNode('43', 'A', 'SaveAudio', undefined, [], []))).toEqual({ type: 'audio' })
    expect(editorNodeOutputType(editorNode('44', 'T', 'ShowText', undefined, [], []))).toEqual({ type: 'text' })
  })

  it('treats unknown nodes that match no name rule as non-output nodes', () => {
    expect(editorNodeOutputType(editorNode('45', 'Sampler', 'KSamplerAdvanced', undefined, ['LATENT'], []))).toEqual({
      reason: 'not_output_node',
    })
    expect(editorNodeOutputType(editorNode('46', 'WS', 'SaveImageWebsocket', undefined, ['IMAGE'], []))).toEqual({
      reason: 'not_output_node',
    })
  })

  it('does not use the name rules when the definition says it is not an output node', () => {
    expect(editorNodeOutputType(editorNode('47', 'Save', 'SaveImageExtended', false, ['IMAGE'], []))).toEqual({
      reason: 'not_output_node',
    })
  })
})

// ---------------------------------------------------------------------------
// editorNodeInputFields
// ---------------------------------------------------------------------------

describe('editorNodeInputFields', () => {
  it('keeps typed widget fields in order and drops control_after_generate', () => {
    expect(editorNodeInputFields(ksampler())).toEqual([
      { field: 'seed', type: 'number' },
      { field: 'steps', type: 'number' },
      { field: 'cfg', type: 'number' },
      { field: 'sampler_name', type: 'text' },
    ])
  })

  it('drops control_before_generate too', () => {
    const node = editorNode('50', 'Seed', 'Seed (rgthree)', false, [], [
      { name: 'control_before_generate', value: 'fixed' },
      { name: 'seed', value: 7 },
    ])
    expect(editorNodeInputFields(node)).toEqual([{ field: 'seed', type: 'number' }])
  })

  it('types LoadImage.image as image and drops the upload button (undefined value)', () => {
    expect(editorNodeInputFields(loadImage())).toEqual([{ field: 'image', type: 'image' }])
  })

  it('types CLIPTextEncode.text as text', () => {
    expect(editorNodeInputFields(clipText())).toEqual([{ field: 'text', type: 'text' }])
  })

  it('drops link values (string or numeric node id)', () => {
    expect(editorNodeInputFields(vaeDecode())).toEqual([])
    const node = editorNode('51', 'Mix', 'ImageBlend', false, ['IMAGE'], [
      { name: 'image1', value: [8, 0] },
      { name: 'blend_factor', value: 0.5 },
    ])
    expect(editorNodeInputFields(node)).toEqual([{ field: 'blend_factor', type: 'number' }])
  })

  it('types booleans, nulls, other strings, and media files', () => {
    const node = editorNode('52', 'Misc', 'MiscNode', false, [], [
      { name: 'enabled', value: true },
      { name: 'note', value: null },
      { name: 'mode', value: 'fast' },
      { name: 'clip', value: 'walk.mp4' },
      { name: 'sound', value: 'voice.wav' },
      { name: 'settings', value: { a: 1 } },
    ])
    expect(editorNodeInputFields(node)).toEqual([
      { field: 'enabled', type: 'boolean' },
      { field: 'note', type: 'text' },
      { field: 'mode', type: 'text' },
      { field: 'clip', type: 'video' },
      { field: 'sound', type: 'audio' },
    ])
  })

  it("types an output node's fields from their own name and value (SaveImage filename_prefix is text)", () => {
    // The class name of an output node says what it produces, not what its fields hold.
    expect(editorNodeInputFields(saveImage())).toEqual([{ field: 'filename_prefix', type: 'text' }])
    // On SaveLatent there is no media word, so it is a plain text field.
    expect(editorNodeInputFields(saveLatent())).toEqual([{ field: 'filename_prefix', type: 'text' }])
  })
})

// ---------------------------------------------------------------------------
// effectiveEditorSlots
// ---------------------------------------------------------------------------

describe('effectiveEditorSlots — new function', () => {
  it('auto-enables every typed output node and the media inputs', () => {
    const { inputs, outputs } = effectiveEditorSlots(editorSlotState(), allNodes())
    expect(outputs).toEqual([
      auto(out('image', 1, '9', 'Save Image')),
      auto(out('image', 2, '12', 'Preview Image')),
      auto(out('image', 3, '14', 'Image Save')),
    ])
    expect(withoutSaveImageInputs(inputs)).toEqual([auto(imageInput10())])
  })

  it('lists explicit slots first and numbers auto keys against them', () => {
    const state: EditorSlotState = {
      ...emptyState(),
      outputs: [{ ...out('image', 1, '12', 'Preview Image'), label: 'Preview' }],
    }
    const { outputs } = effectiveEditorSlots(state, allNodes())
    expect(outputs).toEqual([
      explicit({ ...out('image', 1, '12', 'Preview Image'), label: 'Preview' }),
      auto(out('image', 2, '9', 'Save Image')),
      auto(out('image', 3, '14', 'Image Save')),
    ])
  })

  it('adds auto outputs grouped by type image, video, audio, text, each in node order', () => {
    const nodes = [
      editorNode('20', 'Video Out', 'SaveVideo', true, ['VIDEO'], []),
      editorNode('21', 'Show Text', 'ShowText', true, ['STRING'], []),
      saveImage(),
      editorNode('22', 'Audio Out', 'SaveAudio', true, ['AUDIO'], []),
      editorNode('23', 'Second Video', 'SaveVideo', true, ['VIDEO'], []),
    ]
    const { outputs } = effectiveEditorSlots(editorSlotState(), nodes)
    expect(outputs).toEqual([
      auto(out('image', 1, '9', 'Save Image')),
      auto(out('video', 1, '20', 'Video Out')),
      auto(out('video', 2, '23', 'Second Video')),
      auto(out('audio', 1, '22', 'Audio Out')),
      auto(out('text', 1, '21', 'Show Text')),
    ])
  })

  it('skips output nodes the user turned off and nodes already bound by an explicit output', () => {
    const state: EditorSlotState = {
      ...emptyState(),
      outputs: [out('image', 1, '9', 'Save Image')],
      removedOutputNodeIds: ['12'],
    }
    const { outputs } = effectiveEditorSlots(state, allNodes())
    expect(outputs).toEqual([explicit(out('image', 1, '9', 'Save Image')), auto(out('image', 2, '14', 'Image Save'))])
  })

  it('skips media inputs the user turned off', () => {
    const state: EditorSlotState = { ...emptyState(), removedInputs: ['10:inputs.image'] }
    const { inputs } = effectiveEditorSlots(state, allNodes())
    expect(withoutSaveImageInputs(inputs)).toEqual([])
  })

  it('does not auto-add non-media fields', () => {
    const { inputs } = effectiveEditorSlots(editorSlotState(), [ksampler(), clipText(), checkpoint()])
    expect(inputs).toEqual([])
  })

  it('makes auto input keys unique against keys listed so far and derives key/label from the field name', () => {
    const state: EditorSlotState = {
      ...emptyState(),
      inputs: [valueIn('image', 'Image Prompt', 'text', '6', 'Positive Prompt', 'text', 'a fox')],
    }
    const nodes = [
      clipText(),
      loadImage(),
      loadImage('16', 'Load Mask', 'mask.png'),
      editorNode('17', 'Load Video', 'LoadVideo', false, [], [{ name: 'videoFile', value: 'clip.mp4' }]),
      editorNode('18', 'Load Audio', 'LoadAudio', false, [], [{ name: 'audio', value: 'voice.wav' }]),
    ]
    const { inputs } = effectiveEditorSlots(state, nodes)
    expect(inputs).toEqual([
      explicit(valueIn('image', 'Image Prompt', 'text', '6', 'Positive Prompt', 'text', 'a fox')),
      auto(mediaIn('image_2', 'Image', 'image', '10', 'Load Image', 'image')),
      auto(mediaIn('image_3', 'Image', 'image', '16', 'Load Mask', 'image')),
      auto(mediaIn('video_file', 'Video File', 'video', '17', 'Load Video', 'videoFile')),
      auto(mediaIn('audio', 'Audio', 'audio', '18', 'Load Audio', 'audio')),
    ])
  })

  it('drops explicit slots whose node or field is no longer in the editor, keeps unbound ones', () => {
    const unboundOutput: FunctionOutputDef = {
      key: 'notes',
      label: 'Notes',
      type: 'text',
      bind: { nodeTitle: 'Notes' },
      extract: { source: 'node_output', multiple: true },
    }
    const unboundInput: FunctionInputDef = {
      key: 'token',
      label: 'Token',
      type: 'text',
      required: false,
      bind: { path: 'headers.token' },
    }
    const state: EditorSlotState = {
      ...emptyState(),
      inputs: [
        mediaIn('mask', 'Mask', 'image', '99', 'Gone', 'image'),
        valueIn('denoise', 'Denoise', 'number', '3', 'KSampler', 'denoise', 1),
        unboundInput,
        valueIn('seed', 'Seed', 'number', '3', 'KSampler', 'seed', 42),
      ],
      outputs: [out('image', 1, '99', 'Gone'), unboundOutput, out('image', 2, '12', 'Preview Image')],
      removedOutputNodeIds: ['9', '14'],
      removedInputs: ['10:inputs.image'],
    }
    const { inputs, outputs } = effectiveEditorSlots(state, allNodes())
    expect(withoutSaveImageInputs(inputs)).toEqual([
      explicit(unboundInput),
      explicit(valueIn('seed', 'Seed', 'number', '3', 'KSampler', 'seed', 42)),
    ])
    expect(outputs).toEqual([explicit(unboundOutput), explicit(out('image', 2, '12', 'Preview Image'))])
  })

  it('gives a new SaveImage node no default input (its filename_prefix is text, not media)', () => {
    const { inputs } = effectiveEditorSlots(editorSlotState(), [saveImage(), loadImage()])
    expect(inputs).toEqual([auto(imageInput10())])
  })
})

describe('effectiveEditorSlots — existing function', () => {
  it('shows the saved slots and does not auto-add baseline nodes', () => {
    const def = existingFunction()
    def.outputs = [out('image', 1, '9', 'Save Image')] // PreviewImage was disabled earlier
    def.inputs = [promptInput6()] // LoadImage.image was disabled earlier
    const { inputs, outputs } = effectiveEditorSlots(editorSlotState(def), baselineNodes())
    expect(outputs).toEqual([explicit(out('image', 1, '9', 'Save Image'))])
    expect(inputs).toEqual([explicit(promptInput6())])
  })

  it('auto-adds output and media input slots for nodes that are not in the baseline', () => {
    const nodes = [...baselineNodes(), saveLatent(), namedImageSave(), loadImage('16', 'Load Mask', 'mask.png')]
    const { inputs, outputs } = effectiveEditorSlots(editorSlotState(existingFunction()), nodes)
    expect(outputs).toEqual([
      explicit(out('image', 1, '9', 'Save Image')),
      explicit(out('image', 2, '12', 'Preview Image')),
      auto(out('image', 3, '14', 'Image Save')),
    ])
    expect(inputs).toEqual([
      explicit(imageInput10()),
      explicit(promptInput6()),
      auto(mediaIn('image_2', 'Image', 'image', '16', 'Load Mask', 'image')),
    ])
  })
})

// ---------------------------------------------------------------------------
// toggleEditorOutput
// ---------------------------------------------------------------------------

describe('toggleEditorOutput', () => {
  it('turns off an explicit output and records it as removed', () => {
    const state = editorSlotState(existingFunction())
    const before = clone(state)
    const next = toggleEditorOutput(state, baselineNodes(), '12')
    expect(next.outputs).toEqual([out('image', 1, '9', 'Save Image')])
    expect(next.removedOutputNodeIds).toEqual(['12'])
    expect(next.inputs).toEqual([imageInput10(), promptInput6()])
    expect(next.baselineNodeIds).toEqual(state.baselineNodeIds)
    expect(state).toEqual(before)
  })

  it('turns an output back on with the first free key and clears it from removed', () => {
    const off = toggleEditorOutput(editorSlotState(existingFunction()), baselineNodes(), '12')
    const on = toggleEditorOutput(off, baselineNodes(), '12')
    expect(on.outputs).toEqual([out('image', 1, '9', 'Save Image'), out('image', 2, '12', 'Preview Image')])
    expect(on.removedOutputNodeIds).toEqual([])
  })

  it('turns on a baseline output node that was never a slot', () => {
    const def = existingFunction()
    def.outputs = [out('image', 2, '12', 'Preview Image')]
    const next = toggleEditorOutput(editorSlotState(def), baselineNodes(), '9')
    expect(next.outputs).toEqual([out('image', 2, '12', 'Preview Image'), out('image', 1, '9', 'Save Image')])
  })

  it('records a removed node only once', () => {
    const state: EditorSlotState = {
      ...emptyState(),
      outputs: [out('image', 2, '12', 'Preview Image')],
      removedOutputNodeIds: ['12'],
      baselineNodeIds: Object.keys(baselineRawJson()),
    }
    const next = toggleEditorOutput(state, baselineNodes(), '12')
    expect(next.outputs).toEqual([])
    expect(next.removedOutputNodeIds).toEqual(['12'])
  })

  it('materializes auto slots (without the auto flag) before turning one off', () => {
    const state = editorSlotState()
    const next = toggleEditorOutput(state, allNodes(), '12')
    expect(next.outputs).toEqual([out('image', 1, '9', 'Save Image'), out('image', 3, '14', 'Image Save')])
    expect(withoutSaveImageInputs(next.inputs)).toEqual([imageInput10()])
    for (const slot of [...next.inputs, ...next.outputs]) expect(slot).not.toHaveProperty('auto')
    expect(next.removedOutputNodeIds).toEqual(['12'])
    expect(next.baselineNodeIds).toBeUndefined()
    expect(state).toEqual(emptyState())
  })

  it('turns off an auto output of a node new to an existing function', () => {
    const nodes = [...baselineNodes(), namedImageSave()]
    const next = toggleEditorOutput(editorSlotState(existingFunction()), nodes, '14')
    expect(next.outputs).toEqual([out('image', 1, '9', 'Save Image'), out('image', 2, '12', 'Preview Image')])
    expect(next.removedOutputNodeIds).toEqual(['14'])
    expect(effectiveEditorSlots(next, nodes).outputs.map((slot) => slot.bind.nodeId)).toEqual(['9', '12'])
  })

  it('changes nothing (no materialization) for non-output, untyped or unknown nodes', () => {
    const state = editorSlotState()
    for (const nodeId of ['3', '10', '13', '99']) {
      expect(toggleEditorOutput(state, allNodes(), nodeId)).toEqual(state)
    }
    const existing = editorSlotState(existingFunction())
    expect(toggleEditorOutput(existing, [...baselineNodes(), saveLatent()], '13')).toEqual(existing)
  })
})

// ---------------------------------------------------------------------------
// toggleEditorInput
// ---------------------------------------------------------------------------

describe('toggleEditorInput', () => {
  it('turns on a number widget with its value as default and no upload', () => {
    const state = editorSlotState(existingFunction())
    const before = clone(state)
    const next = toggleEditorInput(state, baselineNodes(), '3', 'seed')
    expect(next.inputs).toEqual([imageInput10(), promptInput6(), valueIn('seed', 'Seed', 'number', '3', 'KSampler', 'seed', 42)])
    expect(next.inputs[2]!.required).toBe(false)
    expect(next.outputs).toEqual(state.outputs)
    expect(state).toEqual(before)
  })

  it('turns on a text widget and a camelCase / snake_case field with derived key and label', () => {
    const latent = editorNode('5', 'Empty Latent', 'EmptyLatentImage', false, [], [
      { name: 'width', value: 512 },
      { name: 'batchSize', value: 1 },
    ])
    const nodes = [...baselineNodes(), latent, saveLatent()]
    let state = editorSlotState(existingFunction())
    state = toggleEditorInput(state, nodes, '3', 'sampler_name')
    state = toggleEditorInput(state, nodes, '5', 'batchSize')
    state = toggleEditorInput(state, nodes, '13', 'filename_prefix')
    expect(state.inputs.slice(2)).toEqual([
      valueIn('sampler_name', 'Sampler Name', 'text', '3', 'KSampler', 'sampler_name', 'euler'),
      valueIn('batch_size', 'Batch Size', 'number', '5', 'Empty Latent', 'batchSize', 1),
      valueIn('filename_prefix', 'Filename Prefix', 'text', '13', 'Save Latent', 'filename_prefix', 'latents/ComfyUI'),
    ])
  })

  it('turns on a boolean widget with its value as default', () => {
    const node = editorNode('60', 'Upscale', 'Upscaler', false, [], [{ name: 'tile_enabled', value: false }])
    const next = toggleEditorInput(editorSlotState(), [node], '60', 'tile_enabled')
    expect(next.inputs).toEqual([valueIn('tile_enabled', 'Tile Enabled', 'boolean', '60', 'Upscale', 'tile_enabled', false)])
  })

  it('makes the new key unique', () => {
    const state: EditorSlotState = {
      ...emptyState(),
      inputs: [valueIn('seed', 'Seed', 'number', '30', 'Other Sampler', 'seed', 1)],
    }
    const nodes = [editorNode('30', 'Other Sampler', 'KSampler', false, [], [{ name: 'seed', value: 1 }]), ksampler()]
    const next = toggleEditorInput(state, nodes, '3', 'seed')
    expect(next.inputs).toEqual([
      valueIn('seed', 'Seed', 'number', '30', 'Other Sampler', 'seed', 1),
      valueIn('seed_2', 'Seed', 'number', '3', 'KSampler', 'seed', 42),
    ])
  })

  it('turns a media input off and back on (required, upload, no default)', () => {
    const off = toggleEditorInput(editorSlotState(existingFunction()), baselineNodes(), '10', 'image')
    expect(off.inputs).toEqual([promptInput6()])
    expect(off.removedInputs).toEqual(['10:inputs.image'])
    const on = toggleEditorInput(off, baselineNodes(), '10', 'image')
    expect(on.inputs).toEqual([promptInput6(), imageInput10()])
    expect(on.inputs[1]).not.toHaveProperty('defaultValue')
    expect(on.removedInputs).toEqual([])
  })

  it('turns off a non-media input', () => {
    const next = toggleEditorInput(editorSlotState(existingFunction()), baselineNodes(), '6', 'text')
    expect(next.inputs).toEqual([imageInput10()])
    expect(next.removedInputs).toEqual(['6:inputs.text'])
  })

  it('records a removed input only once', () => {
    const state: EditorSlotState = { ...emptyState(), inputs: [imageInput10()], removedInputs: ['10:inputs.image'] }
    const next = toggleEditorInput(state, [loadImage()], '10', 'image')
    expect(next.inputs).toEqual([])
    expect(next.removedInputs).toEqual(['10:inputs.image'])
  })

  it('materializes auto slots before applying the change', () => {
    const next = toggleEditorInput(editorSlotState(), allNodes(), '3', 'seed')
    expect(withoutSaveImageInputs(next.inputs)).toEqual([
      imageInput10(),
      valueIn('seed', 'Seed', 'number', '3', 'KSampler', 'seed', 42),
    ])
    expect(next.outputs).toEqual([
      out('image', 1, '9', 'Save Image'),
      out('image', 2, '12', 'Preview Image'),
      out('image', 3, '14', 'Image Save'),
    ])
    for (const slot of [...next.inputs, ...next.outputs]) expect(slot).not.toHaveProperty('auto')
  })

  it('turning off an auto media input of a new node removes it and records it', () => {
    const nodes = [...baselineNodes(), loadImage('16', 'Load Mask', 'mask.png')]
    const next = toggleEditorInput(editorSlotState(existingFunction()), nodes, '16', 'image')
    expect(next.inputs).toEqual([imageInput10(), promptInput6()])
    expect(next.removedInputs).toEqual(['16:inputs.image'])
  })

  it('changes nothing for control widgets, links, untyped fields, unknown fields and unknown nodes', () => {
    const state = editorSlotState()
    const nodes = allNodes()
    const cases: Array<[string, string]> = [
      ['3', 'control_after_generate'],
      ['8', 'samples'],
      ['10', 'upload'],
      ['3', 'denoise'],
      ['99', 'seed'],
    ]
    for (const [nodeId, field] of cases) {
      expect(toggleEditorInput(state, nodes, nodeId, field)).toEqual(state)
    }
  })
})

// ---------------------------------------------------------------------------
// renameEditorSlot
// ---------------------------------------------------------------------------

describe('renameEditorSlot', () => {
  it('renames an output by key with a trimmed label', () => {
    const state = editorSlotState(existingFunction())
    const before = clone(state)
    const next = renameEditorSlot(state, baselineNodes(), 'output', 'image', '  Final  ')
    expect(next.outputs).toEqual([{ ...out('image', 1, '9', 'Save Image'), label: 'Final' }, out('image', 2, '12', 'Preview Image')])
    expect(next.inputs).toEqual(state.inputs)
    expect(state).toEqual(before)
  })

  it('renames only the slot of the given kind when inputs and outputs share a key', () => {
    const state = editorSlotState(existingFunction())
    const next = renameEditorSlot(state, baselineNodes(), 'input', 'image', 'Reference')
    expect(next.inputs).toEqual([{ ...imageInput10(), label: 'Reference' }, promptInput6()])
    expect(next.outputs).toEqual(state.outputs)
  })

  it('changes nothing for an empty label or an unknown key', () => {
    const state = editorSlotState()
    const nodes = allNodes()
    expect(renameEditorSlot(state, nodes, 'output', 'image', '')).toEqual(state)
    expect(renameEditorSlot(state, nodes, 'output', 'image', '   ')).toEqual(state)
    expect(renameEditorSlot(state, nodes, 'output', 'video', 'Clip')).toEqual(state)
    expect(renameEditorSlot(state, nodes, 'input', 'seed', 'Seed value')).toEqual(state)
  })

  it('renaming an auto slot materializes the session', () => {
    const next = renameEditorSlot(editorSlotState(), allNodes(), 'output', 'image_3', 'Gallery')
    expect(next.outputs).toEqual([
      out('image', 1, '9', 'Save Image'),
      out('image', 2, '12', 'Preview Image'),
      { ...out('image', 3, '14', 'Image Save'), label: 'Gallery' },
    ])
    expect(withoutSaveImageInputs(next.inputs)).toEqual([imageInput10()])
    for (const slot of [...next.inputs, ...next.outputs]) expect(slot).not.toHaveProperty('auto')
  })

  it('renaming an auto input materializes it with the new label', () => {
    const nodes = [...baselineNodes(), loadImage('16', 'Load Mask', 'mask.png')]
    const next = renameEditorSlot(editorSlotState(existingFunction()), nodes, 'input', 'image_2', 'Mask')
    expect(next.inputs).toEqual([
      imageInput10(),
      promptInput6(),
      { ...mediaIn('image_2', 'Image', 'image', '16', 'Load Mask', 'image'), label: 'Mask' },
    ])
  })
})

// ---------------------------------------------------------------------------
// applyEditorSlots
// ---------------------------------------------------------------------------

const generatedForBaseline = () => ({
  inputs: [imageInput10()],
  outputs: [out('image', 1, '9', 'Save Image'), out('image', 2, '12', 'Preview Image')],
})

describe('applyEditorSlots', () => {
  it('keeps the session slots when the workflow is unchanged and does not re-add baseline nodes', () => {
    const def = existingFunction()
    def.outputs = [out('image', 1, '9', 'Save Image')]
    def.inputs = [promptInput6()]
    const result = applyEditorSlots(editorSlotState(def), baselineRawJson(), generatedForBaseline())
    expect(result).toEqual({ inputs: [promptInput6()], outputs: [out('image', 1, '9', 'Save Image')] })
  })

  it('drops slots whose node was deleted', () => {
    const raw = baselineRawJson()
    delete raw['12']
    delete raw['10']
    const result = applyEditorSlots(editorSlotState(existingFunction()), raw, {
      inputs: [],
      outputs: [out('image', 1, '9', 'Save Image')],
    })
    expect(result).toEqual({ inputs: [promptInput6()], outputs: [out('image', 1, '9', 'Save Image')] })
  })

  it('drops inputs whose field was removed from the node', () => {
    const raw = baselineRawJson()
    raw['6'] = { class_type: 'CLIPTextEncode', _meta: { title: 'Positive Prompt' }, inputs: { clip: ['4', 1] } }
    const result = applyEditorSlots(editorSlotState(existingFunction()), raw, generatedForBaseline())
    expect(result.inputs).toEqual([imageInput10()])
  })

  it('keeps slots without a node id', () => {
    const unboundInput: FunctionInputDef = { key: 'token', label: 'Token', type: 'text', required: false, bind: { path: 'headers.token' } }
    const unboundOutput: FunctionOutputDef = {
      key: 'notes',
      label: 'Notes',
      type: 'text',
      bind: { nodeTitle: 'Notes' },
      extract: { source: 'node_output', multiple: true },
    }
    const state: EditorSlotState = { ...emptyState(), inputs: [unboundInput], outputs: [unboundOutput], baselineNodeIds: ['9'] }
    const result = applyEditorSlots(state, baselineRawJson(), { inputs: [], outputs: [] })
    expect(result).toEqual({ inputs: [unboundInput], outputs: [unboundOutput] })
  })

  it('appends generated slots of nodes that are new to the function', () => {
    const raw: ComfyWorkflow = {
      ...baselineRawJson(),
      '15': { class_type: 'SaveImage', _meta: { title: 'Save Final' }, inputs: { images: ['8', 0], filename_prefix: 'final' } },
      '16': { class_type: 'LoadImage', _meta: { title: 'Load Mask' }, inputs: { image: 'mask.png' } },
    }
    const generated = {
      inputs: [imageInput10(), mediaIn('image_2', 'Image', 'image', '16', 'Load Mask', 'image')],
      outputs: [out('image', 1, '9', 'Save Image'), out('image', 2, '12', 'Preview Image'), out('image', 3, '15', 'Save Final')],
    }
    const result = applyEditorSlots(editorSlotState(existingFunction()), raw, generated)
    expect(result).toEqual({
      inputs: [imageInput10(), promptInput6(), mediaIn('image_2', 'Image', 'image', '16', 'Load Mask', 'image')],
      outputs: [out('image', 1, '9', 'Save Image'), out('image', 2, '12', 'Preview Image'), out('image', 3, '15', 'Save Final')],
    })
  })

  it('appends all generated slots for a new function, skipping bound and removed ones', () => {
    const state: EditorSlotState = {
      ...emptyState(),
      inputs: [{ ...imageInput10(), label: 'Reference' }],
      outputs: [{ ...out('image', 1, '9', 'Save Image'), label: 'Final' }],
      removedOutputNodeIds: ['12'],
    }
    const result = applyEditorSlots(state, baselineRawJson(), generatedForBaseline())
    expect(result).toEqual({
      inputs: [{ ...imageInput10(), label: 'Reference' }],
      outputs: [{ ...out('image', 1, '9', 'Save Image'), label: 'Final' }],
    })
  })

  it('does not append generated inputs the user turned off', () => {
    const state: EditorSlotState = { ...emptyState(), removedInputs: ['10:inputs.image'] }
    const result = applyEditorSlots(state, baselineRawJson(), generatedForBaseline())
    expect(result.inputs).toEqual([])
    expect(result.outputs).toEqual(generatedForBaseline().outputs)
  })

  it('renumbers colliding output keys to the next free <type>_<n> with label <Label> <n>', () => {
    const state: EditorSlotState = { ...emptyState(), outputs: [out('image', 1, '12', 'Preview Image')] }
    const raw: ComfyWorkflow = {
      ...baselineRawJson(),
      '20': { class_type: 'SaveVideo', _meta: { title: 'Video Out' }, inputs: { video: ['8', 0] } },
    }
    const generated = {
      inputs: [],
      outputs: [out('image', 1, '9', 'Save Image'), out('image', 2, '12', 'Preview Image'), out('video', 1, '20', 'Video Out')],
    }
    const result = applyEditorSlots(state, raw, generated)
    expect(result.outputs).toEqual([
      out('image', 1, '12', 'Preview Image'),
      out('image', 2, '9', 'Save Image'),
      out('video', 1, '20', 'Video Out'),
    ])
  })

  it('makes colliding input keys unique with _2, _3', () => {
    const state: EditorSlotState = {
      ...emptyState(),
      inputs: [
        valueIn('image', 'Image Prompt', 'text', '6', 'Positive Prompt', 'text', 'a fox'),
        valueIn('image_2', 'Steps', 'number', '3', 'KSampler', 'steps', 20),
      ],
    }
    const result = applyEditorSlots(state, baselineRawJson(), { inputs: [imageInput10()], outputs: [] })
    expect(result.inputs).toEqual([
      valueIn('image', 'Image Prompt', 'text', '6', 'Positive Prompt', 'text', 'a fox'),
      valueIn('image_2', 'Steps', 'number', '3', 'KSampler', 'steps', 20),
      { ...imageInput10(), key: 'image_3' },
    ])
  })

  it('never appends the legacy fallback output; an empty result is allowed', () => {
    const raw: ComfyWorkflow = {
      '3': { class_type: 'KSampler', _meta: { title: 'KSampler' }, inputs: { seed: 1 } },
    }
    const result = applyEditorSlots(editorSlotState(), raw, { inputs: [], outputs: [LEGACY_FALLBACK] })
    expect(result).toEqual({ inputs: [], outputs: [] })
  })

  it('may return no outputs when the user turned every output off', () => {
    const state: EditorSlotState = { ...emptyState(), removedOutputNodeIds: ['9', '12'] }
    const result = applyEditorSlots(state, baselineRawJson(), generatedForBaseline())
    expect(result.outputs).toEqual([])
  })

  it('does not mutate its arguments', () => {
    const state = editorSlotState(existingFunction())
    const raw: ComfyWorkflow = {
      ...baselineRawJson(),
      '15': { class_type: 'SaveImage', _meta: { title: 'Save Final' }, inputs: { images: ['8', 0], filename_prefix: 'final' } },
    }
    const generated = {
      inputs: [imageInput10()],
      outputs: [out('image', 1, '9', 'Save Image'), out('image', 2, '12', 'Preview Image'), out('image', 2, '15', 'Save Final')],
    }
    const before = clone({ state, raw, generated })
    applyEditorSlots(state, raw, generated)
    expect({ state, raw, generated }).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// End-to-end editing session
// ---------------------------------------------------------------------------

describe('editing session end to end', () => {
  it('existing function: turn off Preview, turn on seed, rename the Save output, add a new SaveImage, then save', () => {
    const def = existingFunction()
    const defBefore = clone(def)
    let nodes = baselineNodes()

    let state = editorSlotState(def)
    state = toggleEditorOutput(state, nodes, '12')
    state = toggleEditorInput(state, nodes, '3', 'seed')
    state = renameEditorSlot(state, nodes, 'output', 'image', 'Final')

    nodes = [...nodes, saveImage('15', 'Save Image', 'final')]

    const shown = effectiveEditorSlots(state, nodes)
    expect(shown.outputs).toEqual([
      explicit({ ...out('image', 1, '9', 'Save Image'), label: 'Final' }),
      auto(out('image', 2, '15', 'Save Image')),
    ])
    expect(withoutSaveImageInputs(shown.inputs)).toEqual([
      explicit(imageInput10()),
      explicit(promptInput6()),
      explicit(valueIn('seed', 'Seed', 'number', '3', 'KSampler', 'seed', 42)),
    ])

    const rawJson: ComfyWorkflow = {
      ...baselineRawJson(),
      '15': { class_type: 'SaveImage', _meta: { title: 'Save Image' }, inputs: { images: ['8', 0], filename_prefix: 'final' } },
    }
    // What the saved workflow would give without the editor: media inputs of non-output nodes + every typed output.
    const generated = {
      inputs: [imageInput10()],
      outputs: [out('image', 1, '9', 'Save Image'), out('image', 2, '12', 'Preview Image'), out('image', 3, '15', 'Save Image')],
    }
    const result = applyEditorSlots(state, rawJson, generated)
    expect(result).toEqual({
      inputs: [imageInput10(), promptInput6(), valueIn('seed', 'Seed', 'number', '3', 'KSampler', 'seed', 42)],
      // The new node keeps the key the editor showed for it (first free key), not the generated numbering.
      outputs: [{ ...out('image', 1, '9', 'Save Image'), label: 'Final' }, out('image', 2, '15', 'Save Image')],
    })
    expect(def).toEqual(defBefore)
  })
})
