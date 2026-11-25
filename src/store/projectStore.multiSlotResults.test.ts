import { describe, expect, it, vi } from 'vitest'
import { createProjectSlice } from './projectStore'
import { comfyNodeTypesFromObjectInfo } from '../domain/comfyNodeTypes'
import { describeResultSlot, resultSlotText } from '../domain/resultSlots'
import { createGenerationFunctionFromWorkflow } from '../domain/workflow'
import type {
  ComfyWorkflow,
  FunctionOutputDef,
  GenerationFunction,
  MediaResourceValue,
  Resource,
  ResourceType,
} from '../domain/types'

// Black-box tests for contract v4 section 2: ComfyUI runs with several output slots (runFunctionAtPosition /
// runTemporaryFunctionAtPosition), including reruns in replace mode. Injected fake client, synthetic data only.

const NOW = '2026-05-08T09:00:00.000Z'

const LEGACY_FALLBACK: FunctionOutputDef = {
  key: 'result',
  label: 'Result',
  type: 'text',
  bind: { nodeTitle: 'Result' },
  extract: { source: 'history', multiple: true },
}

/** Synthetic ComfyUI /object_info payload. */
const OBJECT_INFO = {
  KSampler: {
    input: { required: { seed: ['INT', { default: 0 }], steps: ['INT', { default: 20 }] } },
    output: ['LATENT'],
    output_node: false,
  },
  VAEDecode: {
    input: { required: { samples: ['LATENT'], vae: ['VAE'] } },
    output: ['IMAGE'],
    output_node: false,
  },
  SaveImage: {
    input: { required: { images: ['IMAGE'], filename_prefix: ['STRING', { default: 'ComfyUI' }] } },
    output: [],
    output_node: true,
  },
  PreviewImage: {
    input: { required: { images: ['IMAGE'] } },
    output: [],
    output_node: true,
  },
  MyFancySaver: {
    input: { required: { pixels: ['IMAGE'] } },
    output: [],
    output_node: true,
  },
}

const out = (key: string, label: string, type: ResourceType, nodeId: string): FunctionOutputDef => ({
  key,
  label,
  type,
  bind: { nodeId, nodeTitle: label },
  extract: { source: type === 'text' ? 'node_output' : 'history', multiple: true },
})

const file = (filename: string, type = 'output') => ({ filename, subfolder: '', type })

const blobFor = (filename: string) => {
  if (/\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(filename)) return new Blob(['video-bytes'], { type: 'video/mp4' })
  if (/\.(flac|mp3|wav|ogg)$/i.test(filename)) return new Blob(['audio-bytes'], { type: 'audio/flac' })
  return new Blob(['image-bytes'], { type: 'image/png' })
}

type HarnessOptions = {
  /** When set, getObjectInfo rejects for the first `failObjectInfoTimes` calls. */
  failObjectInfoTimes?: number
}

const createHarness = (initialHistory: Record<string, unknown>, options: HarnessOptions = {}) => {
  let nextId = 0
  let promptCounter = 0
  let historyOutputs = initialHistory
  let objectInfoFailuresLeft = options.failObjectInfoTimes ?? 0
  const setHistory = (next: Record<string, unknown>) => {
    historyOutputs = next
  }
  const objectInfo = vi.fn(async () => {
    if (objectInfoFailuresLeft > 0) {
      objectInfoFailuresLeft -= 1
      throw new Error('object_info unavailable (synthetic)')
    }
    return structuredClone(OBJECT_INFO)
  })
  const viewFile = vi.fn(async (params: { filename: string }) => blobFor(params.filename))
  const slice = createProjectSlice({
    idFactory: () => `gen_${(nextId += 1)}`,
    now: () => NOW,
    randomInt: () => 42,
    createComfyClient: () => ({
      queuePrompt: async () => {
        promptCounter += 1
        return { prompt_id: `prompt_${promptCounter}`, number: promptCounter }
      },
      getHistory: async (promptId?: string) => {
        const id = promptId ?? `prompt_${promptCounter}`
        return { [id]: { outputs: structuredClone(historyOutputs) } }
      },
      viewFile,
      getObjectInfo: () => objectInfo(),
    }),
    comfyRunOptions: { maxPollAttempts: 1, pollIntervalMs: 1 },
  })
  return { slice, setHistory, objectInfo }
}

type Slice = ReturnType<typeof createProjectSlice>

const waitForTasksToSettle = async (slice: Slice) => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const tasks = Object.values(slice.getState().project.tasks)
    if (tasks.length > 0 && tasks.every((task) => ['succeeded', 'failed', 'canceled'].includes(task.status))) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const mediaFilename = (value: unknown) => {
  const media = value as MediaResourceValue
  return media.comfy?.filename ?? media.filename
}

const endpointIdOf = (slice: Slice) => slice.getState().project.comfy.endpoints[0]!.id

/** A temporary ComfyUI function with the given slots, bound to the first endpoint. */
const temporaryFunction = (slice: Slice, outputs: FunctionOutputDef[], id = 'temp_multi'): GenerationFunction => ({
  id,
  name: 'Multi slot',
  workflow: {
    format: 'comfyui_api_json',
    rawJson: {
      '3': { class_type: 'KSampler', _meta: { title: 'Sampler' }, inputs: { seed: 1, steps: 20 } },
      '8': { class_type: 'VAEDecode', _meta: { title: 'Decode' }, inputs: { samples: ['3', 0] } },
      '9': { class_type: 'SaveImage', _meta: { title: 'Save' }, inputs: { images: ['8', 0], filename_prefix: 'x' } },
      '12': { class_type: 'PreviewImage', _meta: { title: 'Preview' }, inputs: { images: ['8', 0] } },
      '14': { class_type: 'SaveImage', _meta: { title: 'Save B' }, inputs: { images: ['8', 0], filename_prefix: 'y' } },
      '15': { class_type: 'VHS_VideoCombine', _meta: { title: 'Video' }, inputs: {} },
      '17': { class_type: 'SaveAudio', _meta: { title: 'Audio' }, inputs: {} },
      '20': { class_type: 'ShowText', _meta: { title: 'Text' }, inputs: {} },
    },
    editor: { kind: 'comfyui_embedded', endpointId: endpointIdOf(slice), savedAt: NOW },
  },
  inputs: [],
  outputs,
  createdAt: NOW,
  updatedAt: NOW,
})

/** SaveImage (9) + PreviewImage (12) saved function; outputs `image` (9) and `image_2` (12). */
const savePreviewWorkflow = (): ComfyWorkflow => ({
  '3': { class_type: 'KSampler', _meta: { title: 'Sampler' }, inputs: { seed: 1, steps: 20 } },
  '8': { class_type: 'VAEDecode', _meta: { title: 'Decode' }, inputs: { samples: ['3', 0] } },
  '9': { class_type: 'SaveImage', _meta: { title: 'Save' }, inputs: { images: ['8', 0], filename_prefix: 'x' } },
  '12': { class_type: 'PreviewImage', _meta: { title: 'Preview' }, inputs: { images: ['8', 0] } },
})

const addSavePreviewFunction = (slice: Slice) => {
  const functionId = slice.getState().addFunctionFromWorkflow('Save + Preview', savePreviewWorkflow(), {
    nodeTypes: comfyNodeTypesFromObjectInfo(OBJECT_INFO),
  })
  const fn = slice.getState().project.functions[functionId]!
  expect(fn.outputs.map((output) => [output.key, output.bind.nodeId])).toEqual([
    ['image', '9'],
    ['image_2', '12'],
  ])
  return functionId
}

/** Helpers to read one run. */
const runView = (slice: Slice, taskId: string) => {
  const { project } = slice.getState()
  const task = project.tasks[taskId]!
  const resources = Object.values(project.resources).filter(
    (resource) => resource.source.kind === 'function_output' && resource.source.taskId === taskId,
  )
  const nodeOf = (resourceId: string) =>
    project.canvas.nodes.find((node) => node.type === 'resource' && node.data.resourceId === resourceId)
  const ofKey = (key: string) => resources.filter((resource) => resource.source.outputKey === key)
  return { project, task, resources, nodeOf, ofKey }
}

const runOnce = async (
  slice: Slice,
  run: () => Promise<unknown>,
): Promise<{ taskId: string }> => {
  const before = new Set(Object.keys(slice.getState().project.tasks))
  await run()
  await waitForTasksToSettle(slice)
  const created = Object.keys(slice.getState().project.tasks).filter((id) => !before.has(id))
  expect(created).toHaveLength(1)
  return { taskId: created[0]! }
}

const resourceNodes = (slice: Slice) => slice.getState().project.canvas.nodes.filter((node) => node.type === 'resource')

// ---------------------------------------------------------------------------------------------------------------
describe('multi-slot ComfyUI runs: mixed types', () => {
  const MIXED_OUTPUTS = [
    out('image', 'Final', 'image', '9'),
    out('video', 'Clip', 'video', '15'),
    out('audio', 'Voice', 'audio', '17'),
    out('text', 'Caption', 'text', '20'),
  ]
  const MIXED_HISTORY = {
    '9': { images: [file('final_00001_.png')] },
    '15': { gifs: [file('clip_00001_.mp4')] },
    '17': { audio: [file('voice_00001_.flac')] },
    '20': { text: ['a synthetic caption'] },
  }

  it('creates one resource per slot with that slot type, outputKey and its own canvas node', async () => {
    const { slice } = createHarness(MIXED_HISTORY)
    const fn = temporaryFunction(slice, MIXED_OUTPUTS)
    const { taskId } = await runOnce(slice, () => slice.getState().runTemporaryFunctionAtPosition(fn, {}, { x: 0, y: 0 }, 1))
    const view = runView(slice, taskId)

    expect(view.task.status).toBe('succeeded')
    expect(view.resources).toHaveLength(4)
    const expected: [string, ResourceType][] = [
      ['image', 'image'],
      ['video', 'video'],
      ['audio', 'audio'],
      ['text', 'text'],
    ]
    const nodeIds = new Set<string>()
    for (const [key, type] of expected) {
      const list = view.ofKey(key)
      expect(list, `slot ${key}`).toHaveLength(1)
      const resource = list[0]!
      expect(resource.type, `slot ${key} type`).toBe(type)
      const node = view.nodeOf(resource.id)
      expect(node, `slot ${key} node`).toBeDefined()
      expect(node!.data.resourceType).toBe(type)
      expect(node!.data.outputKey).toBe(key)
      nodeIds.add(node!.id)
      expect(view.task.outputRefs[key]).toEqual([{ resourceId: resource.id, type }])
    }
    expect(nodeIds.size).toBe(4)
    expect(Object.keys(view.task.outputRefs).sort()).toEqual(['audio', 'image', 'text', 'video'])

    expect(mediaFilename(view.ofKey('image')[0]!.value)).toBe('final_00001_.png')
    expect(mediaFilename(view.ofKey('video')[0]!.value)).toBe('clip_00001_.mp4')
    expect(mediaFilename(view.ofKey('audio')[0]!.value)).toBe('voice_00001_.flac')
    expect(view.ofKey('text')[0]!.value).toBe('a synthetic caption')
  })

  it('records the run definition on each result so its slot can be described', async () => {
    const { slice } = createHarness(MIXED_HISTORY)
    const fn = temporaryFunction(slice, MIXED_OUTPUTS)
    const { taskId } = await runOnce(slice, () => slice.getState().runTemporaryFunctionAtPosition(fn, {}, { x: 0, y: 0 }, 1))
    const view = runView(slice, taskId)

    for (const resource of view.resources) {
      expect(resource.metadata?.functionSnapshot?.outputs.map((output) => output.key)).toEqual(['image', 'video', 'audio', 'text'])
    }
    const texts = ['image', 'video', 'audio', 'text'].map((key) =>
      resultSlotText(describeResultSlot(view.ofKey(key)[0]!, view.task)),
    )
    expect(texts).toEqual(['Final', 'Clip', 'Voice', 'Caption'])
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('multi-slot ComfyUI runs: slot order', () => {
  it('lays out a run left-to-right in the outputs order, whatever order history lists the nodes in', async () => {
    // History lists 20, 17, 15, 9 — the reverse of the outputs order.
    const history = {
      '20': { text: ['caption'] },
      '17': { audio: [file('voice.flac')] },
      '15': { gifs: [file('clip.mp4')] },
      '9': { images: [file('final.png')] },
    }
    const { slice } = createHarness(history)
    const fn = temporaryFunction(slice, [
      out('image', 'Final', 'image', '9'),
      out('video', 'Clip', 'video', '15'),
      out('audio', 'Voice', 'audio', '17'),
      out('text', 'Caption', 'text', '20'),
    ])
    const { taskId } = await runOnce(slice, () => slice.getState().runTemporaryFunctionAtPosition(fn, {}, { x: 100, y: 50 }, 1))
    const view = runView(slice, taskId)

    const xs = ['image', 'video', 'audio', 'text'].map((key) => view.nodeOf(view.ofKey(key)[0]!.id)!.position.x)
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]!, `x of slot ${i}`).toBeGreaterThan(xs[i - 1]!)
  })

  it('also orders same-type slots by outputs order, not history order', async () => {
    const history = {
      '14': { images: [file('c.png')] },
      '12': { images: [file('b.png')] },
      '9': { images: [file('a.png')] },
    }
    const { slice } = createHarness(history)
    const fn = temporaryFunction(slice, [
      out('image_2', 'Second', 'image', '12'),
      out('image', 'First', 'image', '9'),
      out('image_3', 'Third', 'image', '14'),
    ])
    const { taskId } = await runOnce(slice, () => slice.getState().runTemporaryFunctionAtPosition(fn, {}, { x: 0, y: 0 }, 1))
    const view = runView(slice, taskId)

    const xs = ['image_2', 'image', 'image_3'].map((key) => view.nodeOf(view.ofKey(key)[0]!.id)!.position.x)
    expect(xs[1]!).toBeGreaterThan(xs[0]!)
    expect(xs[2]!).toBeGreaterThan(xs[1]!)
    expect(mediaFilename(view.ofKey('image_2')[0]!.value)).toBe('b.png')
    expect(mediaFilename(view.ofKey('image')[0]!.value)).toBe('a.png')
    expect(mediaFilename(view.ofKey('image_3')[0]!.value)).toBe('c.png')
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('multi-slot ComfyUI runs: same type', () => {
  it('two image slots (Final 9, Mask 12) give two image resources keyed image and image_2', async () => {
    const { slice } = createHarness({
      '12': { images: [file('mask.png', 'temp')] },
      '9': { images: [file('final.png')] },
    })
    const fn = temporaryFunction(slice, [out('image', 'Final', 'image', '9'), out('image_2', 'Mask', 'image', '12')])
    const { taskId } = await runOnce(slice, () => slice.getState().runTemporaryFunctionAtPosition(fn, {}, { x: 0, y: 0 }, 1))
    const view = runView(slice, taskId)

    expect(view.task.status).toBe('succeeded')
    expect(Object.keys(view.task.outputRefs).sort()).toEqual(['image', 'image_2'])
    expect(view.task.outputRefs.image).toHaveLength(1)
    expect(view.task.outputRefs.image_2).toHaveLength(1)
    const final = view.ofKey('image')
    const mask = view.ofKey('image_2')
    expect(final).toHaveLength(1)
    expect(mask).toHaveLength(1)
    expect(final[0]!.type).toBe('image')
    expect(mask[0]!.type).toBe('image')
    expect(mediaFilename(final[0]!.value)).toBe('final.png')
    expect(mediaFilename(mask[0]!.value)).toBe('mask.png')
    expect(view.task.outputRefs.image).toEqual([{ resourceId: final[0]!.id, type: 'image' }])
    expect(view.task.outputRefs.image_2).toEqual([{ resourceId: mask[0]!.id, type: 'image' }])
    expect(view.nodeOf(final[0]!.id)!.id).not.toBe(view.nodeOf(mask[0]!.id)!.id)

    expect(resultSlotText(describeResultSlot(final[0]!, view.task, fn))).toBe('Final')
    expect(resultSlotText(describeResultSlot(mask[0]!, view.task, fn))).toBe('Mask')
  })

  it('works the same for a saved function built from a workflow with SaveImage and PreviewImage', async () => {
    const { slice } = createHarness({
      '9': { images: [file('final.png')] },
      '12': { images: [file('preview.png', 'temp')] },
    })
    const functionId = addSavePreviewFunction(slice)
    const { taskId } = await runOnce(slice, () => slice.getState().runFunctionAtPosition(functionId, {}, { x: 0, y: 0 }, 1))
    const view = runView(slice, taskId)

    expect(Object.keys(view.task.outputRefs).sort()).toEqual(['image', 'image_2'])
    expect(mediaFilename(view.ofKey('image')[0]!.value)).toBe('final.png')
    expect(mediaFilename(view.ofKey('image_2')[0]!.value)).toBe('preview.png')
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('multi-slot ComfyUI runs: batch in one slot vs several slots', () => {
  it('three images from node 9 stay in slot image, in history order, stacked under that slot', async () => {
    const { slice } = createHarness({
      '9': { images: [file('final_1.png'), file('final_2.png'), file('final_3.png')] },
      '12': { images: [file('mask.png', 'temp')] },
    })
    const fn = temporaryFunction(slice, [out('image', 'Final', 'image', '9'), out('image_2', 'Mask', 'image', '12')])
    const { taskId } = await runOnce(slice, () => slice.getState().runTemporaryFunctionAtPosition(fn, {}, { x: 0, y: 0 }, 1))
    const view = runView(slice, taskId)

    const refs = view.task.outputRefs.image!
    expect(refs).toHaveLength(3)
    expect(refs.every((ref) => ref.type === 'image')).toBe(true)
    const batch = refs.map((ref) => view.project.resources[ref.resourceId]!)
    expect(batch.map((resource) => mediaFilename(resource.value))).toEqual(['final_1.png', 'final_2.png', 'final_3.png'])
    expect(batch.every((resource) => resource.type === 'image' && resource.source.outputKey === 'image')).toBe(true)
    expect(view.task.outputRefs.image_2).toHaveLength(1)

    const nodes = batch.map((resource) => view.nodeOf(resource.id)!)
    expect(new Set(nodes.map((node) => node.id)).size).toBe(3)
    expect(nodes[1]!.position.x).toBe(nodes[0]!.position.x)
    expect(nodes[2]!.position.x).toBe(nodes[0]!.position.x)
    expect(nodes[1]!.position.y).toBeGreaterThan(nodes[0]!.position.y)
    expect(nodes[2]!.position.y).toBeGreaterThan(nodes[1]!.position.y)

    // Not in the other slot's column.
    const maskNode = view.nodeOf(view.ofKey('image_2')[0]!.id)!
    expect(maskNode.position.x).toBeGreaterThan(nodes[0]!.position.x)

    expect(batch.map((resource) => resultSlotText(describeResultSlot(resource, view.task, fn)))).toEqual([
      'Final 1/3',
      'Final 2/3',
      'Final 3/3',
    ])
  })

  it('a batch in a single-slot function is still all slot image and numbered 1/3..3/3', async () => {
    const { slice } = createHarness({ '9': { images: [file('a.png'), file('b.png'), file('c.png')] } })
    const fn = temporaryFunction(slice, [out('image', 'Final', 'image', '9')])
    const { taskId } = await runOnce(slice, () => slice.getState().runTemporaryFunctionAtPosition(fn, {}, { x: 0, y: 0 }, 1))
    const view = runView(slice, taskId)

    expect(Object.keys(view.task.outputRefs)).toEqual(['image'])
    const batch = view.task.outputRefs.image!.map((ref) => view.project.resources[ref.resourceId]!)
    expect(batch.map((resource) => mediaFilename(resource.value))).toEqual(['a.png', 'b.png', 'c.png'])
    expect(batch.map((resource) => resultSlotText(describeResultSlot(resource, view.task, fn)))).toEqual([
      'Final 1/3',
      'Final 2/3',
      'Final 3/3',
    ])
  })

  it('three slots with one image each give three keys in three columns', async () => {
    const { slice } = createHarness({
      '9': { images: [file('a.png')] },
      '12': { images: [file('b.png', 'temp')] },
      '14': { images: [file('c.png')] },
    })
    const fn = temporaryFunction(slice, [
      out('image', 'A', 'image', '9'),
      out('image_2', 'B', 'image', '12'),
      out('image_3', 'C', 'image', '14'),
    ])
    const { taskId } = await runOnce(slice, () => slice.getState().runTemporaryFunctionAtPosition(fn, {}, { x: 0, y: 0 }, 1))
    const view = runView(slice, taskId)

    expect(Object.keys(view.task.outputRefs).sort()).toEqual(['image', 'image_2', 'image_3'])
    for (const key of ['image', 'image_2', 'image_3']) expect(view.task.outputRefs[key]).toHaveLength(1)
    const xs = ['image', 'image_2', 'image_3'].map((key) => view.nodeOf(view.ofKey(key)[0]!.id)!.position.x)
    expect(new Set(xs).size).toBe(3)
    expect(
      ['image', 'image_2', 'image_3'].map((key) => resultSlotText(describeResultSlot(view.ofKey(key)[0]!, view.task, fn))),
    ).toEqual(['A', 'B', 'C'])
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('multi-slot ComfyUI runs: text result name', () => {
  it('names a text slot result after the slot label, not the key', async () => {
    const { slice } = createHarness({
      '9': { images: [file('final.png')] },
      '20': { text: ['caption text'] },
    })
    const fn = temporaryFunction(slice, [out('image', 'Final', 'image', '9'), out('text', 'Caption', 'text', '20')])
    const { taskId } = await runOnce(slice, () => slice.getState().runTemporaryFunctionAtPosition(fn, {}, { x: 0, y: 0 }, 1))
    const text = runView(slice, taskId).ofKey('text')
    expect(text).toHaveLength(1)
    expect(text[0]!.type).toBe('text')
    expect(text[0]!.value).toBe('caption text')
    expect(text[0]!.name).toBe('Caption')
  })

  it('falls back to the key when the text slot label is empty', async () => {
    const { slice } = createHarness({ '20': { text: ['caption text'] }, '9': { images: [file('final.png')] } })
    const fn = temporaryFunction(slice, [out('image', 'Final', 'image', '9'), out('text_2', '', 'text', '20')])
    const { taskId } = await runOnce(slice, () => slice.getState().runTemporaryFunctionAtPosition(fn, {}, { x: 0, y: 0 }, 1))
    const text = runView(slice, taskId).ofKey('text_2')
    expect(text).toHaveLength(1)
    expect(text[0]!.name).toBe('text_2')
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('multi-slot ComfyUI runs: empty slot', () => {
  it('keeps the empty slot resource and node marked failed with the slot label, while the task and other slots succeed', async () => {
    const { slice } = createHarness({ '9': { images: [file('final.png')] } })
    const fn = temporaryFunction(slice, [out('image', 'Final', 'image', '9'), out('image_2', 'Alpha Mask', 'image', '12')])
    const { taskId } = await runOnce(slice, () => slice.getState().runTemporaryFunctionAtPosition(fn, {}, { x: 0, y: 0 }, 1))
    const view = runView(slice, taskId)

    expect(view.task.status).toBe('succeeded')

    const final = view.ofKey('image')
    expect(final).toHaveLength(1)
    expect(mediaFilename(final[0]!.value)).toBe('final.png')
    expect((final[0]!.value as MediaResourceValue).url).toMatch(/^data:image\//)
    const finalNode = view.nodeOf(final[0]!.id)!
    expect(finalNode.data.status).not.toBe('failed')
    expect(finalNode.data.error).toBeUndefined()

    const empty = view.ofKey('image_2')
    expect(empty).toHaveLength(1)
    const emptyNode = view.nodeOf(empty[0]!.id)
    expect(emptyNode).toBeDefined()
    expect(emptyNode!.data.outputKey).toBe('image_2')
    expect(emptyNode!.data.status).toBe('failed')
    const error = emptyNode!.data.error as { message?: unknown } | undefined
    expect(typeof error?.message).toBe('string')
    expect(String(error!.message)).toContain('Alpha Mask')
  })

  it('uses the key in the message when the empty slot has no label', async () => {
    const { slice } = createHarness({ '9': { images: [file('final.png')] } })
    const fn = temporaryFunction(slice, [out('image', 'Final', 'image', '9'), out('image_2', '', 'image', '12')])
    const { taskId } = await runOnce(slice, () => slice.getState().runTemporaryFunctionAtPosition(fn, {}, { x: 0, y: 0 }, 1))
    const view = runView(slice, taskId)
    expect(view.task.status).toBe('succeeded')
    const emptyNode = view.nodeOf(view.ofKey('image_2')[0]!.id)!
    expect(emptyNode.data.status).toBe('failed')
    expect(String((emptyNode.data.error as { message?: unknown } | undefined)?.message)).toContain('image_2')
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('multi-slot ComfyUI runs: rerun in place (replace)', () => {
  const HISTORY_1 = {
    '9': { images: [file('final_run1.png')] },
    '12': { images: [file('mask_run1.png', 'temp')] },
  }
  const HISTORY_2 = {
    '9': { images: [file('final_run2.png')] },
    '12': { images: [file('mask_run2.png', 'temp')] },
  }

  const snapshotResource = (resource: Resource) => structuredClone(resource)

  it('saved function: renaming a slot keeps its key, so a rerun of its result replaces in place', async () => {
    const { slice, setHistory } = createHarness(HISTORY_1)
    const functionId = addSavePreviewFunction(slice)
    const first = await runOnce(slice, () => slice.getState().runFunctionAtPosition(functionId, {}, { x: 0, y: 0 }, 1))
    const view1 = runView(slice, first.taskId)
    const oldMask = view1.ofKey('image_2')[0]!
    const oldMaskNodeId = view1.nodeOf(oldMask.id)!.id
    const oldFinal = snapshotResource(view1.ofKey('image')[0]!)

    // Rename image_2 (label only).
    const fn = slice.getState().project.functions[functionId]!
    slice.getState().updateFunction(functionId, {
      outputs: fn.outputs.map((output) => (output.key === 'image_2' ? { ...output, label: 'Renamed Mask' } : output)),
    })
    expect(slice.getState().project.functions[functionId]!.outputs.map((output) => output.key)).toEqual(['image', 'image_2'])

    setHistory(HISTORY_2)
    const second = await runOnce(slice, () =>
      slice.getState().runFunctionAtPosition(functionId, {}, { x: 0, y: 0 }, 1, {
        replace: { resourceId: oldMask.id, outputKey: 'image_2' },
      }),
    )

    const { project } = slice.getState()
    expect(project.tasks[second.taskId]!.status).toBe('succeeded')
    const replaced = project.resources[oldMask.id]!
    expect(replaced).toBeDefined()
    expect(replaced.type).toBe('image')
    expect(mediaFilename(replaced.value)).toBe('mask_run2.png')
    expect(replaced.source.outputKey).toBe('image_2')
    const nodesForReplaced = resourceNodes(slice).filter((node) => node.data.resourceId === oldMask.id)
    expect(nodesForReplaced.map((node) => node.id)).toEqual([oldMaskNodeId])
    expect(project.tasks[second.taskId]!.outputRefs.image_2).toEqual([{ resourceId: oldMask.id, type: 'image' }])
    // No second mask resource was made for this run.
    expect(
      Object.values(project.resources).filter(
        (resource) => resource.source.outputKey === 'image_2' && resource.id !== oldMask.id,
      ),
    ).toEqual([])
    // The other first-run result is untouched.
    expect(project.resources[oldFinal.id]).toEqual(oldFinal)

    // The renamed label shows on the result.
    const current = project.functions[functionId]!
    expect(describeResultSlot(replaced, project.tasks[second.taskId], current)?.label).toBe('Renamed Mask')
  })

  it('saved function: an old result of a renamed slot is relabelled by the current definition', async () => {
    const { slice } = createHarness(HISTORY_1)
    const functionId = addSavePreviewFunction(slice)
    const first = await runOnce(slice, () => slice.getState().runFunctionAtPosition(functionId, {}, { x: 0, y: 0 }, 1))
    const fn = slice.getState().project.functions[functionId]!
    slice.getState().updateFunction(functionId, {
      outputs: fn.outputs.map((output) => (output.key === 'image_2' ? { ...output, label: 'Renamed Mask' } : output)),
    })
    const { project } = slice.getState()
    const oldMask = runView(slice, first.taskId).ofKey('image_2')[0]!
    const described = describeResultSlot(oldMask, project.tasks[first.taskId], project.functions[functionId])
    expect(described).toMatchObject({ outputKey: 'image_2', label: 'Renamed Mask', removed: false, slotCount: 2 })
    expect(resultSlotText(described)).toBe('Renamed Mask')
  })

  it('temporary function: rerun with a renamed slot (same id) replaces in place', async () => {
    const { slice, setHistory } = createHarness(HISTORY_1)
    const fn = temporaryFunction(slice, [out('image', 'Final', 'image', '9'), out('image_2', 'Mask', 'image', '12')])
    const first = await runOnce(slice, () => slice.getState().runTemporaryFunctionAtPosition(fn, {}, { x: 0, y: 0 }, 1))
    const view1 = runView(slice, first.taskId)
    const oldFinal = view1.ofKey('image')[0]!
    const oldFinalNodeId = view1.nodeOf(oldFinal.id)!.id
    const oldMask = snapshotResource(view1.ofKey('image_2')[0]!)

    const renamed: GenerationFunction = {
      ...fn,
      outputs: fn.outputs.map((output) => (output.key === 'image' ? { ...output, label: 'Hero' } : output)),
    }
    setHistory(HISTORY_2)
    const second = await runOnce(slice, () =>
      slice.getState().runTemporaryFunctionAtPosition(renamed, {}, { x: 0, y: 0 }, 1, {
        replace: { resourceId: oldFinal.id, outputKey: 'image' },
      }),
    )

    const { project } = slice.getState()
    const replaced = project.resources[oldFinal.id]!
    expect(replaced.type).toBe('image')
    expect(mediaFilename(replaced.value)).toBe('final_run2.png')
    expect(replaced.source.outputKey).toBe('image')
    expect(resourceNodes(slice).filter((node) => node.data.resourceId === oldFinal.id).map((node) => node.id)).toEqual([
      oldFinalNodeId,
    ])
    expect(project.tasks[second.taskId]!.outputRefs.image).toEqual([{ resourceId: oldFinal.id, type: 'image' }])
    expect(project.resources[oldMask.id]).toEqual(oldMask)
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('multi-slot ComfyUI runs: rerun after the slot was disabled', () => {
  const HISTORY_1 = {
    '9': { images: [file('final_run1.png')] },
    '12': { images: [file('mask_run1.png', 'temp')] },
  }
  const HISTORY_2 = {
    '9': { images: [file('final_run2.png')] },
    '12': { images: [file('mask_run2.png', 'temp')] },
  }

  it('saved function: nothing is replaced; the old result is intact and new results are made for current slots', async () => {
    const { slice, setHistory } = createHarness(HISTORY_1)
    const functionId = addSavePreviewFunction(slice)
    const first = await runOnce(slice, () => slice.getState().runFunctionAtPosition(functionId, {}, { x: 0, y: 0 }, 1))
    const view1 = runView(slice, first.taskId)
    const oldMask = structuredClone(view1.ofKey('image_2')[0]!)
    const oldMaskNode = structuredClone(view1.nodeOf(oldMask.id)!)
    const oldFinal = structuredClone(view1.ofKey('image')[0]!)

    // Disable image_2 (12).
    const fn = slice.getState().project.functions[functionId]!
    slice.getState().updateFunction(functionId, { outputs: fn.outputs.filter((output) => output.key !== 'image_2') })

    setHistory(HISTORY_2)
    const second = await runOnce(slice, () =>
      slice.getState().runFunctionAtPosition(functionId, {}, { x: 0, y: 0 }, 1, {
        replace: { resourceId: oldMask.id, outputKey: 'image_2' },
      }),
    )

    const { project } = slice.getState()
    expect(project.tasks[second.taskId]!.status).toBe('succeeded')
    const keptMask = project.resources[oldMask.id]!
    expect(keptMask.id).toBe(oldMask.id)
    expect(keptMask.type).toBe(oldMask.type)
    expect(keptMask.value).toEqual(oldMask.value)
    expect(mediaFilename(keptMask.value)).toBe('mask_run1.png')
    const keptNode = resourceNodes(slice).find((node) => node.id === oldMaskNode.id)
    expect(keptNode?.data.resourceId).toBe(oldMask.id)
    expect(project.resources[oldFinal.id]!.value).toEqual(oldFinal.value)

    const view2 = runView(slice, second.taskId)
    const newFinal = view2.ofKey('image')
    expect(newFinal).toHaveLength(1)
    expect(newFinal[0]!.id).not.toBe(oldMask.id)
    expect(newFinal[0]!.id).not.toBe(oldFinal.id)
    expect(mediaFilename(newFinal[0]!.value)).toBe('final_run2.png')
    const newNode = view2.nodeOf(newFinal[0]!.id)
    expect(newNode).toBeDefined()
    expect(newNode!.id).not.toBe(oldMaskNode.id)
    expect(view2.ofKey('image_2')).toEqual([])
    expect(Object.keys(view2.task.outputRefs)).toEqual(['image'])
    expect(view2.task.outputRefs.image).toEqual([{ resourceId: newFinal[0]!.id, type: 'image' }])

    // The old result keeps the label it had and is marked removed.
    const described = describeResultSlot(keptMask, project.tasks[first.taskId], project.functions[functionId])
    expect(described).toMatchObject({ outputKey: 'image_2', label: 'Image 2', removed: true })
    expect(resultSlotText(described)).toBe('Image 2 (removed)')
  })

  it('temporary function: disabling the video slot and rerunning its result keeps it a video', async () => {
    const history = {
      '9': { images: [file('final_run1.png')] },
      '15': { gifs: [file('clip_run1.mp4')] },
    }
    const { slice, setHistory } = createHarness(history)
    const fn = temporaryFunction(slice, [out('image', 'Final', 'image', '9'), out('video', 'Clip', 'video', '15')])
    const first = await runOnce(slice, () => slice.getState().runTemporaryFunctionAtPosition(fn, {}, { x: 0, y: 0 }, 1))
    const view1 = runView(slice, first.taskId)
    const oldClip = structuredClone(view1.ofKey('video')[0]!)
    const oldClipNodeId = view1.nodeOf(oldClip.id)!.id
    expect(oldClip.type).toBe('video')

    const disabled: GenerationFunction = { ...fn, outputs: fn.outputs.filter((output) => output.key !== 'video') }
    setHistory({ '9': { images: [file('final_run2.png')] }, '15': { gifs: [file('clip_run2.mp4')] } })
    const second = await runOnce(slice, () =>
      slice.getState().runTemporaryFunctionAtPosition(disabled, {}, { x: 0, y: 0 }, 1, {
        replace: { resourceId: oldClip.id, outputKey: 'video' },
      }),
    )

    const { project } = slice.getState()
    const kept = project.resources[oldClip.id]!
    expect(kept.type).toBe('video')
    expect(kept.value).toEqual(oldClip.value)
    expect(resourceNodes(slice).find((node) => node.id === oldClipNodeId)?.data.resourceId).toBe(oldClip.id)
    expect(resourceNodes(slice).find((node) => node.id === oldClipNodeId)?.data.resourceType).toBe('video')

    const view2 = runView(slice, second.taskId)
    expect(view2.ofKey('image')).toHaveLength(1)
    expect(mediaFilename(view2.ofKey('image')[0]!.value)).toBe('final_run2.png')
    expect(view2.ofKey('image')[0]!.id).not.toBe(oldClip.id)
    expect(view2.ofKey('video')).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('multi-slot ComfyUI runs: legacy fallback exception', () => {
  const fancyWorkflow = (): ComfyWorkflow => ({
    '3': { class_type: 'KSampler', _meta: { title: 'Sampler' }, inputs: { seed: 1, steps: 20 } },
    '8': { class_type: 'VAEDecode', _meta: { title: 'Decode' }, inputs: { samples: ['3', 0] } },
    '12': { class_type: 'MyFancySaver', _meta: { title: 'Fancy' }, inputs: { pixels: ['8', 0] } },
  })

  it('a repaired legacy-fallback run replaces the old `result` resource with the first repaired output', async () => {
    // The first run cannot load node types, so the legacy fallback runs unrepaired and leaves a `result` resource.
    const { slice, setHistory } = createHarness(
      { '12': { images: [file('fancy_run1.png')] } },
      { failObjectInfoTimes: 1 },
    )
    const base = createGenerationFunctionFromWorkflow('temp_legacy', 'Legacy Fancy', fancyWorkflow(), NOW)
    const legacy: GenerationFunction = {
      ...base,
      workflow: { ...base.workflow, editor: { kind: 'comfyui_embedded', endpointId: endpointIdOf(slice), savedAt: NOW } },
    }
    expect(legacy.outputs).toEqual([LEGACY_FALLBACK])

    const first = await runOnce(slice, () => slice.getState().runTemporaryFunctionAtPosition(legacy, {}, { x: 0, y: 0 }, 1))
    const oldResults = runView(slice, first.taskId).ofKey('result')
    // Precondition for the exception: the unrepaired run left a `result` resource on the canvas.
    expect(oldResults).toHaveLength(1)
    const old = oldResults[0]!
    const oldNode = runView(slice, first.taskId).nodeOf(old.id)!
    expect(oldNode).toBeDefined()

    // Second run: node types load, the definition is repaired to an image output for node 12.
    setHistory({ '12': { images: [file('fancy_run2.png')] } })
    const second = await runOnce(slice, () =>
      slice.getState().runTemporaryFunctionAtPosition(legacy, {}, { x: 0, y: 0 }, 1, {
        replace: { resourceId: old.id, outputKey: 'result' },
      }),
    )

    const { project } = slice.getState()
    expect(project.tasks[second.taskId]!.status).toBe('succeeded')
    const replaced = project.resources[old.id]!
    expect(replaced.type).toBe('image')
    expect(mediaFilename(replaced.value)).toBe('fancy_run2.png')
    expect(resourceNodes(slice).filter((node) => node.data.resourceId === old.id).map((node) => node.id)).toEqual([oldNode.id])
    // The repaired output went into the old resource, not a new one.
    const images = Object.values(project.resources).filter((resource) => resource.type === 'image')
    expect(images.map((resource) => resource.id)).toEqual([old.id])
  })
})
