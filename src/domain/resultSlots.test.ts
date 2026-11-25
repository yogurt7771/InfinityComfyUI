import { describe, expect, it } from 'vitest'
import { compareImagePair, describeResultSlot, resultSlotText, type ResultSlotInfo } from './resultSlots'
import type {
  CanvasNode,
  ExecutionTask,
  FunctionOutputDef,
  GenerationFunction,
  MediaResourceValue,
  Resource,
  ResourceType,
} from './types'

// Black-box tests for contract v4 section 1 (`src/domain/resultSlots.ts`). Synthetic data only.

const NOW = '2026-05-08T09:00:00.000Z'

const output = (key: string, label: string, type: ResourceType = 'image', nodeId = key): FunctionOutputDef => ({
  key,
  label,
  type,
  bind: { nodeId, nodeTitle: label },
  extract: { source: type === 'text' ? 'node_output' : 'history', multiple: true },
})

const fnWith = (outputs: FunctionOutputDef[], id = 'fn_1'): GenerationFunction => ({
  id,
  name: 'Synthetic',
  workflow: { format: 'comfyui_api_json', rawJson: {} },
  inputs: [],
  outputs,
  createdAt: NOW,
  updatedAt: NOW,
})

const media = (name: string, url = `data:image/png;base64,${name}`): MediaResourceValue => ({
  assetId: `asset_${name}`,
  url,
  filename: `${name}.png`,
  mimeType: 'image/png',
  sizeBytes: 1,
})

type ResourceOptions = {
  type?: ResourceType
  outputKey?: string
  kind?: Resource['source']['kind']
  taskId?: string
  snapshot?: GenerationFunction
  value?: Resource['value']
}

const resource = (id: string, options: ResourceOptions = {}): Resource => ({
  id,
  type: options.type ?? 'image',
  value: options.value ?? media(id),
  source: {
    kind: options.kind ?? 'function_output',
    taskId: options.taskId ?? 'task_1',
    ...(options.outputKey === undefined ? {} : { outputKey: options.outputKey }),
  },
  metadata: { createdAt: NOW, ...(options.snapshot ? { functionSnapshot: options.snapshot } : {}) },
})

const task = (outputRefs: ExecutionTask['outputRefs'], functionSnapshot?: GenerationFunction): ExecutionTask => ({
  id: 'task_1',
  functionNodeId: 'task_1',
  functionId: 'fn_1',
  runIndex: 1,
  runTotal: 1,
  status: 'succeeded',
  inputRefs: {},
  inputSnapshot: {},
  paramsSnapshot: {},
  ...(functionSnapshot ? { functionSnapshot } : {}),
  workflowTemplateSnapshot: {},
  compiledWorkflowSnapshot: {},
  seedPatchLog: [],
  outputRefs,
  createdAt: NOW,
  updatedAt: NOW,
})

const refs = (...ids: string[]) => ids.map((resourceId) => ({ resourceId, type: 'image' as const }))

const info = (patch: Partial<ResultSlotInfo>): ResultSlotInfo => ({
  outputKey: 'image',
  label: 'Final',
  removed: false,
  index: 1,
  count: 1,
  slotCount: 1,
  ...patch,
})

// ---------------------------------------------------------------------------------------------------------------
describe('describeResultSlot: applicability', () => {
  it('returns undefined for a resource that is not a function output', () => {
    for (const kind of ['user_upload', 'manual_input', 'imported', 'duplicated'] as const) {
      expect(describeResultSlot(resource('r', { kind, outputKey: 'image' }))).toBeUndefined()
    }
  })

  it('returns undefined for a function output without an output key or with an empty one', () => {
    expect(describeResultSlot(resource('r'))).toBeUndefined()
    expect(describeResultSlot(resource('r', { outputKey: '' }))).toBeUndefined()
    expect(describeResultSlot(resource('r', { outputKey: '' }), task({ '': refs('r') }), fnWith([output('', 'X')]))).toBeUndefined()
  })

  it('describes a function output with only the resource given (key as label, 1/1, one slot)', () => {
    expect(describeResultSlot(resource('r', { outputKey: 'image_2' }))).toEqual({
      outputKey: 'image_2',
      label: 'image_2',
      removed: false,
      index: 1,
      count: 1,
      slotCount: 1,
    })
  })
})

describe('describeResultSlot: label', () => {
  const runFn = fnWith([output('image', 'Final'), output('image_2', 'Mask')])

  it('uses the label of the current definition when it has the key (a renamed slot relabels old results)', () => {
    const current = fnWith([output('image', 'Final'), output('image_2', 'Alpha Mask')])
    const r = resource('r', { outputKey: 'image_2', snapshot: runFn })
    expect(describeResultSlot(r, task({ image_2: refs('r') }), current)?.label).toBe('Alpha Mask')
  })

  it('falls back to the key when the current definition has the key with an empty label', () => {
    const current = fnWith([output('image', 'Final'), output('image_2', '')])
    const r = resource('r', { outputKey: 'image_2', snapshot: runFn })
    expect(describeResultSlot(r, undefined, current)?.label).toBe('image_2')
  })

  it('uses the run definition label (metadata.functionSnapshot) when the current definition lacks the key', () => {
    const current = fnWith([output('image', 'Final')])
    const r = resource('r', { outputKey: 'image_2', snapshot: runFn })
    const described = describeResultSlot(r, task({ image_2: refs('r') }), current)
    expect(described?.label).toBe('Mask')
    expect(described?.removed).toBe(true)
  })

  it('uses the run definition label when no current definition is given', () => {
    const r = resource('r', { outputKey: 'image_2', snapshot: runFn })
    expect(describeResultSlot(r)?.label).toBe('Mask')
  })

  it('prefers metadata.functionSnapshot over task.functionSnapshot', () => {
    const taskFn = fnWith([output('image_2', 'From Task')])
    const r = resource('r', { outputKey: 'image_2', snapshot: runFn })
    expect(describeResultSlot(r, task({ image_2: refs('r') }, taskFn))?.label).toBe('Mask')
  })

  it('uses task.functionSnapshot when the resource has no snapshot', () => {
    const taskFn = fnWith([output('image', 'One'), output('image_2', 'From Task'), output('text', 'Caption', 'text')])
    const r = resource('r', { outputKey: 'image_2' })
    const described = describeResultSlot(r, task({ image_2: refs('r') }, taskFn))
    expect(described?.label).toBe('From Task')
    expect(described?.slotCount).toBe(3)
  })

  it('falls back to the key when the run definition has the key with an empty label', () => {
    const r = resource('r', { outputKey: 'image_2', snapshot: fnWith([output('image_2', '')]) })
    expect(describeResultSlot(r)?.label).toBe('image_2')
  })

  it('falls back to the key when neither definition has the key', () => {
    const r = resource('r', { outputKey: 'video', snapshot: runFn })
    expect(describeResultSlot(r, undefined, fnWith([output('image', 'Final')]))?.label).toBe('video')
  })
})

describe('describeResultSlot: removed', () => {
  const runFn = fnWith([output('image', 'Final'), output('image_2', 'Mask')])
  const r = resource('r', { outputKey: 'image_2', snapshot: runFn })

  it('is false without a current definition, even if the slot no longer exists anywhere', () => {
    expect(describeResultSlot(r)?.removed).toBe(false)
    expect(describeResultSlot(resource('x', { outputKey: 'gone' }))?.removed).toBe(false)
  })

  it('is false when the current definition still has the key', () => {
    expect(describeResultSlot(r, undefined, runFn)?.removed).toBe(false)
  })

  it('is true when the current definition no longer has the key (slot disabled)', () => {
    expect(describeResultSlot(r, undefined, fnWith([output('image', 'Final')]))?.removed).toBe(true)
    expect(describeResultSlot(r, undefined, fnWith([]))?.removed).toBe(true)
  })
})

describe('describeResultSlot: index and count', () => {
  it('is the 1-based position of the resource among the task refs for its slot', () => {
    const t = task({ image: refs('a', 'b', 'c'), image_2: refs('m') })
    expect(describeResultSlot(resource('a', { outputKey: 'image' }), t)).toMatchObject({ index: 1, count: 3 })
    expect(describeResultSlot(resource('b', { outputKey: 'image' }), t)).toMatchObject({ index: 2, count: 3 })
    expect(describeResultSlot(resource('c', { outputKey: 'image' }), t)).toMatchObject({ index: 3, count: 3 })
    expect(describeResultSlot(resource('m', { outputKey: 'image_2' }), t)).toMatchObject({ index: 1, count: 1 })
  })

  it('is 1/1 when the task is missing', () => {
    expect(describeResultSlot(resource('b', { outputKey: 'image' }))).toMatchObject({ index: 1, count: 1 })
  })

  it('is 1/1 when the task has no refs for the key', () => {
    const t = task({ image_2: refs('a', 'b') })
    expect(describeResultSlot(resource('b', { outputKey: 'image' }), t)).toMatchObject({ index: 1, count: 1 })
  })

  it('is 1/1 when the resource id is not in the slot list', () => {
    const t = task({ image: refs('a', 'b', 'c') })
    expect(describeResultSlot(resource('zzz', { outputKey: 'image' }), t)).toMatchObject({ index: 1, count: 1 })
  })
})

describe('describeResultSlot: slotCount', () => {
  it('is the run definition outputs length when there is a run definition', () => {
    const runFn = fnWith([output('image', 'A'), output('image_2', 'B'), output('video', 'C', 'video')])
    // The task refs only have one key, but the run definition decides.
    const t = task({ image: refs('a') })
    expect(describeResultSlot(resource('a', { outputKey: 'image', snapshot: runFn }), t)?.slotCount).toBe(3)
  })

  it('ignores the current definition for slotCount', () => {
    const runFn = fnWith([output('image', 'A'), output('image_2', 'B')])
    const current = fnWith([output('image', 'A')])
    expect(describeResultSlot(resource('a', { outputKey: 'image', snapshot: runFn }), undefined, current)?.slotCount).toBe(2)
  })

  it('is the number of task.outputRefs keys when there is no run definition', () => {
    const t = task({ image: refs('a', 'b', 'c'), image_2: refs('m') })
    expect(describeResultSlot(resource('a', { outputKey: 'image' }), t)?.slotCount).toBe(2)
  })

  it('is 1 without a run definition or task', () => {
    expect(describeResultSlot(resource('a', { outputKey: 'image' }))?.slotCount).toBe(1)
  })

  it('is never below 1', () => {
    expect(describeResultSlot(resource('a', { outputKey: 'image', snapshot: fnWith([]) }))?.slotCount).toBe(1)
    expect(describeResultSlot(resource('a', { outputKey: 'image' }), task({}))?.slotCount).toBe(1)
  })
})

describe('describeResultSlot: same-type, mixed-type and batch scenarios', () => {
  it('tells two same-type slots apart', () => {
    const runFn = fnWith([output('image', 'Final', 'image', '9'), output('image_2', 'Mask', 'image', '12')])
    const t = task({ image: refs('a'), image_2: refs('m') }, runFn)
    const a = describeResultSlot(resource('a', { outputKey: 'image', snapshot: runFn }), t, runFn)
    const m = describeResultSlot(resource('m', { outputKey: 'image_2', snapshot: runFn }), t, runFn)
    expect(a).toEqual({ outputKey: 'image', label: 'Final', removed: false, index: 1, count: 1, slotCount: 2 })
    expect(m).toEqual({ outputKey: 'image_2', label: 'Mask', removed: false, index: 1, count: 1, slotCount: 2 })
    expect(resultSlotText(a)).toBe('Final')
    expect(resultSlotText(m)).toBe('Mask')
  })

  it('labels each slot of a mixed-type run', () => {
    const runFn = fnWith([
      output('image', 'Final', 'image', '9'),
      output('video', 'Clip', 'video', '15'),
      output('audio', 'Voice', 'audio', '17'),
      output('text', 'Caption', 'text', '20'),
    ])
    const t = task({
      image: refs('i'),
      video: [{ resourceId: 'v', type: 'video' }],
      audio: [{ resourceId: 'au', type: 'audio' }],
      text: [{ resourceId: 'tx', type: 'text' }],
    })
    const texts = [
      ['i', 'image', 'image'],
      ['v', 'video', 'video'],
      ['au', 'audio', 'audio'],
      ['tx', 'text', 'text'],
    ].map(([id, key, type]) =>
      resultSlotText(describeResultSlot(resource(id!, { outputKey: key, type: type as ResourceType, snapshot: runFn }), t, runFn)),
    )
    expect(texts).toEqual(['Final', 'Clip', 'Voice', 'Caption'])
  })

  it('a single slot returning several images (batch) is numbered but not tagged as multi-slot', () => {
    const runFn = fnWith([output('image', 'Final', 'image', '9')])
    const t = task({ image: refs('a', 'b', 'c') }, runFn)
    const described = ['a', 'b', 'c'].map((id) =>
      describeResultSlot(resource(id, { outputKey: 'image', snapshot: runFn }), t, runFn),
    )
    expect(described.map((d) => d?.slotCount)).toEqual([1, 1, 1])
    expect(described.map((d) => [d?.index, d?.count])).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
    expect(described.map(resultSlotText)).toEqual(['Final · 1/3', 'Final · 2/3', 'Final · 3/3'])
  })

  it('a single-slot single-result run needs no slot tag', () => {
    const runFn = fnWith([output('image', 'Final', 'image', '9')])
    const t = task({ image: refs('a') }, runFn)
    expect(resultSlotText(describeResultSlot(resource('a', { outputKey: 'image', snapshot: runFn }), t, runFn))).toBeUndefined()
  })

  it('a disabled slot keeps the label it had and is marked removed', () => {
    const runFn = fnWith([output('image', 'Final', 'image', '9'), output('image_2', 'Mask', 'image', '12')])
    const current = fnWith([output('image', 'Final', 'image', '9')])
    const t = task({ image: refs('a'), image_2: refs('m') }, runFn)
    expect(resultSlotText(describeResultSlot(resource('m', { outputKey: 'image_2', snapshot: runFn }), t, current))).toBe(
      'Mask (removed)',
    )
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('resultSlotText', () => {
  it('is undefined for undefined', () => {
    expect(resultSlotText(undefined)).toBeUndefined()
  })

  it('is undefined for a single-slot, single-result, not-removed result', () => {
    expect(resultSlotText(info({}))).toBeUndefined()
    expect(resultSlotText(info({ index: 1, count: 1, slotCount: 1, label: 'Anything' }))).toBeUndefined()
  })

  it('is the label alone for one result in a multi-slot run', () => {
    expect(resultSlotText(info({ slotCount: 2 }))).toBe('Final')
    expect(resultSlotText(info({ slotCount: 4, label: 'Caption', outputKey: 'text' }))).toBe('Caption')
  })

  it('adds index/count when the slot has several results', () => {
    expect(resultSlotText(info({ index: 2, count: 3 }))).toBe('Final · 2/3')
    expect(resultSlotText(info({ index: 1, count: 2, slotCount: 3 }))).toBe('Final · 1/2')
  })

  it('adds (removed) when the slot was removed, even for a single-slot single result', () => {
    expect(resultSlotText(info({ removed: true }))).toBe('Final (removed)')
    expect(resultSlotText(info({ removed: true, slotCount: 2 }))).toBe('Final (removed)')
  })

  it('puts index/count before (removed)', () => {
    expect(resultSlotText(info({ removed: true, index: 2, count: 3, slotCount: 2 }))).toBe('Final · 2/3 (removed)')
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('compareImagePair', () => {
  const resourceNode = (id: string, resourceId: string): CanvasNode => ({
    id,
    type: 'resource',
    position: { x: 0, y: 0 },
    data: { resourceId },
  })
  const groupNode = (id: string, resourceIds: string[]): CanvasNode => ({
    id,
    type: 'result_group',
    position: { x: 0, y: 0 },
    data: { resources: resourceIds.map((resourceId) => ({ resourceId })) },
  })
  const img = (id: string, outputKey?: string) => resource(id, { outputKey, type: 'image' })
  const byId = (...list: Resource[]) => Object.fromEntries(list.map((r) => [r.id, r]))

  it('pairs two resource nodes holding images', () => {
    const a = img('a', 'image')
    const b = img('b', 'image_2')
    const pair = compareImagePair(resourceNode('n_a', 'a'), resourceNode('n_b', 'b'), byId(a, b))
    expect(pair?.left.id).toBe('a')
    expect(pair?.right.id).toBe('b')
  })

  it('is undefined when either node is missing', () => {
    const a = img('a', 'image')
    expect(compareImagePair(undefined, resourceNode('n_a', 'a'), byId(a))).toBeUndefined()
    expect(compareImagePair(resourceNode('n_a', 'a'), undefined, byId(a))).toBeUndefined()
    expect(compareImagePair(undefined, undefined, byId(a))).toBeUndefined()
  })

  it('is undefined when a side has no image candidate', () => {
    const a = img('a', 'image')
    const text = resource('t', { type: 'text', value: 'hello', outputKey: 'text' })
    const video: Resource = {
      ...resource('v', { type: 'video', outputKey: 'video' }),
      value: { ...media('v', 'data:video/mp4;base64,v'), mimeType: 'video/mp4' },
    }
    const noUrl: Resource = { ...img('nourl', 'image'), value: { ...media('nourl'), url: '' } }
    const resources = byId(a, text, video, noUrl)
    expect(compareImagePair(resourceNode('n_a', 'a'), resourceNode('n_t', 't'), resources)).toBeUndefined()
    expect(compareImagePair(resourceNode('n_v', 'v'), resourceNode('n_a', 'a'), resources)).toBeUndefined()
    expect(compareImagePair(resourceNode('n_a', 'a'), resourceNode('n_nourl', 'nourl'), resources)).toBeUndefined()
    expect(compareImagePair(resourceNode('n_a', 'a'), resourceNode('n_missing', 'missing'), resources)).toBeUndefined()
    expect(compareImagePair(resourceNode('n_a', 'a'), groupNode('g_empty', []), resources)).toBeUndefined()
    expect(compareImagePair(resourceNode('n_a', 'a'), groupNode('g_bad', ['t', 'v', 'nourl', 'missing']), resources)).toBeUndefined()
  })

  it('has no candidates for nodes that are neither resource nor result_group', () => {
    const a = img('a', 'image')
    const fnNode: CanvasNode = { id: 'f', type: 'function', position: { x: 0, y: 0 }, data: { resourceId: 'a' } }
    const group: CanvasNode = { id: 'g', type: 'group', position: { x: 0, y: 0 }, data: { resources: [{ resourceId: 'a' }] } }
    expect(compareImagePair(fnNode, resourceNode('n_a', 'a'), byId(a))).toBeUndefined()
    expect(compareImagePair(resourceNode('n_a', 'a'), group, byId(a))).toBeUndefined()
  })

  it('picks the same slot on the other side (resource node vs result group)', () => {
    const left = img('l_mask', 'image_2')
    const r1 = img('r_final', 'image')
    const r2 = img('r_mask', 'image_2')
    const pair = compareImagePair(resourceNode('n_l', 'l_mask'), groupNode('g', ['r_final', 'r_mask']), byId(left, r1, r2))
    expect(pair?.left.id).toBe('l_mask')
    expect(pair?.right.id).toBe('r_mask')
  })

  it('picks the same slot on the other side (result group vs resource node)', () => {
    const l1 = img('l_final', 'image')
    const l2 = img('l_mask', 'image_2')
    const right = img('r_mask', 'image_2')
    const pair = compareImagePair(groupNode('g', ['l_final', 'l_mask']), resourceNode('n_r', 'r_mask'), byId(l1, l2, right))
    expect(pair?.left.id).toBe('l_mask')
    expect(pair?.right.id).toBe('r_mask')
  })

  it('between two groups, the first left candidate with a matching key pairs with the first right one of that key', () => {
    const resources = byId(
      img('l_x', 'only_left'),
      img('l_mask', 'image_2'),
      img('l_final', 'image'),
      img('r_final_1', 'image'),
      img('r_mask_1', 'image_2'),
      img('r_mask_2', 'image_2'),
    )
    const pair = compareImagePair(
      groupNode('gl', ['l_x', 'l_mask', 'l_final']),
      groupNode('gr', ['r_final_1', 'r_mask_1', 'r_mask_2']),
      resources,
    )
    // l_x has no match; l_mask is the first left candidate whose key exists on the right.
    expect(pair?.left.id).toBe('l_mask')
    expect(pair?.right.id).toBe('r_mask_1')
  })

  it('falls back to the first candidate of each side when no output keys match', () => {
    const resources = byId(img('l1', 'image'), img('l2', 'image_2'), img('r1', 'image_3'), img('r2', 'image_4'))
    const pair = compareImagePair(groupNode('gl', ['l1', 'l2']), groupNode('gr', ['r1', 'r2']), resources)
    expect(pair?.left.id).toBe('l1')
    expect(pair?.right.id).toBe('r1')
  })

  it('falls back to the first candidates when resources have no output key at all', () => {
    const resources = byId(
      resource('u1', { kind: 'user_upload' }),
      resource('u2', { kind: 'user_upload' }),
      resource('u3', { kind: 'user_upload' }),
    )
    const pair = compareImagePair(resourceNode('n1', 'u1'), groupNode('g', ['u2', 'u3']), resources)
    expect(pair?.left.id).toBe('u1')
    expect(pair?.right.id).toBe('u2')
  })

  it('skips non-image, url-less and missing resources inside a group, keeping order', () => {
    const resources = byId(
      resource('t', { type: 'text', value: 'x', outputKey: 'text' }),
      { ...img('nourl', 'image'), value: { ...media('nourl'), url: '' } },
      img('ok_final', 'image'),
      img('ok_mask', 'image_2'),
      img('left', 'zzz'),
    )
    const pair = compareImagePair(resourceNode('n', 'left'), groupNode('g', ['t', 'missing', 'nourl', 'ok_final', 'ok_mask']), resources)
    expect(pair?.right.id).toBe('ok_final')
    // A url-less image in the group is not a candidate even though its key would match.
    const matchKey = compareImagePair(resourceNode('n2', 'ok_final'), groupNode('g2', ['nourl', 'ok_mask', 'ok_final']), resources)
    expect(matchKey?.right.id).toBe('ok_final')
  })

  it('returns the resources themselves from resourcesById', () => {
    const a = img('a', 'image')
    const b = img('b', 'image')
    const pair = compareImagePair(resourceNode('n_a', 'a'), resourceNode('n_b', 'b'), byId(a, b))
    expect(pair).toEqual({ left: a, right: b })
  })
})
