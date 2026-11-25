import { describe, expect, it } from 'vitest'
import { LOCAL_IMAGE_INFO_FUNCTION_ID } from '../domain/localTransforms'
import type { FunctionInputDef, GenerationFunction, Resource, ResourceRef, ResourceType } from '../domain/types'
import { workflowPrimitiveInputValue } from '../domain/workflow'
import { buildFunctionRunInputDraft, matchFunctionsForSelection, readingOrderNodeIds } from './selectionFunctionMatches'

const input = (
  key: string,
  type: ResourceType,
  required = true,
  extra: Partial<FunctionInputDef> = {},
): FunctionInputDef => ({ key, label: key, type, required, bind: { path: 'x' }, ...extra }) as FunctionInputDef

const fn = (
  id: string,
  inputs: FunctionInputDef[],
  name = id,
  rawJson: Record<string, unknown> = {},
): GenerationFunction =>
  ({
    id,
    name,
    workflow: { format: 'comfyui_api_json', rawJson },
    inputs,
    outputs: [],
    createdAt: '',
    updatedAt: '',
  }) as unknown as GenerationFunction

const res = (id: string, type: ResourceType): Resource =>
  ({ id, type, value: '', source: { kind: 'user_upload' }, metadata: { createdAt: '' } }) as Resource

const ref = (resourceId: string, type: ResourceType): ResourceRef => ({ resourceId, type })

const byId = (resources: Resource[]): Record<string, Resource> =>
  Object.fromEntries(resources.map((resource) => [resource.id, resource]))

const resources = byId([
  res('img1', 'image'),
  res('img2', 'image'),
  res('img3', 'image'),
  res('vid1', 'video'),
  res('aud1', 'audio'),
  res('txt1', 'text'),
])

const ids = (matches: ReturnType<typeof matchFunctionsForSelection>) => matches.map((match) => match.functionDef.id)

describe('buildFunctionRunInputDraft', () => {
  it('assigns the first matching candidate of the same type to each input in input order', () => {
    const def = fn('f', [input('a', 'image'), input('v', 'video'), input('b', 'image')])
    const candidates = [ref('vid1', 'video'), ref('img2', 'image'), ref('img1', 'image')]
    const draft = buildFunctionRunInputDraft(def, resources, candidates)
    expect(draft).toEqual({ a: ref('img2', 'image'), v: ref('vid1', 'video'), b: ref('img1', 'image') })
  })

  it('stores the candidate ref object itself', () => {
    const candidate = ref('img1', 'image')
    const draft = buildFunctionRunInputDraft(fn('f', [input('a', 'image')]), resources, [candidate])
    expect(draft.a).toBe(candidate)
  })

  it('does not reuse a candidate already used by an earlier input', () => {
    const def = fn('f', [input('a', 'image'), input('b', 'image')])
    const draft = buildFunctionRunInputDraft(def, resources, [ref('img1', 'image')])
    expect(draft).toEqual({ a: ref('img1', 'image') })
    expect('b' in draft).toBe(false)
  })

  it('skips candidates whose resourceId is missing from resourcesById', () => {
    const def = fn('f', [input('a', 'image')])
    const draft = buildFunctionRunInputDraft(def, resources, [ref('ghost', 'image'), ref('img3', 'image')])
    expect(draft).toEqual({ a: ref('img3', 'image') })
  })

  it('does not match a candidate whose type differs from the input type', () => {
    const def = fn('f', [input('a', 'image')])
    const draft = buildFunctionRunInputDraft(def, resources, [ref('vid1', 'video')])
    expect(draft).toEqual({})
  })

  it('gives media inputs without a candidate no key', () => {
    const def = fn('f', [input('a', 'image'), input('v', 'video'), input('s', 'audio')])
    const draft = buildFunctionRunInputDraft(def, resources, [])
    expect(Object.keys(draft)).toEqual([])
  })

  it('uses a text candidate for a text input when one is available', () => {
    const def = fn('f', [input('t', 'text', true, { defaultValue: 'dflt' })])
    const draft = buildFunctionRunInputDraft(def, resources, [ref('txt1', 'text')])
    expect(draft).toEqual({ t: ref('txt1', 'text') })
  })

  it('uses input.defaultValue for primitive inputs without a candidate', () => {
    const def = fn('f', [
      input('t', 'text', true, { defaultValue: 'hello' }),
      input('n', 'number', true, { defaultValue: 7 }),
      input('b', 'boolean', true, { defaultValue: true }),
    ])
    const draft = buildFunctionRunInputDraft(def, resources, [])
    expect(draft).toEqual({ t: 'hello', n: 7, b: true })
  })

  it('falls back to the workflow primitive value when there is no defaultValue', () => {
    const rawJson = { '1': { class_type: 'Prompt', inputs: { text: 'from workflow', steps: 30, flag: true } } }
    const def = fn(
      'f',
      [
        input('t', 'text', true, { bind: { nodeId: '1', path: 'inputs.text' } }),
        input('n', 'number', true, { bind: { nodeId: '1', path: 'inputs.steps' } }),
        input('b', 'boolean', true, { bind: { nodeId: '1', path: 'inputs.flag' } }),
      ],
      'f',
      rawJson,
    )
    // Sanity: the fixture is something workflowPrimitiveInputValue resolves.
    expect(def.inputs.map((item) => workflowPrimitiveInputValue(def, item))).toEqual(['from workflow', 30, true])
    const draft = buildFunctionRunInputDraft(def, resources, [])
    expect(draft).toEqual({ t: 'from workflow', n: 30, b: true })
  })

  it('prefers defaultValue over the workflow primitive value', () => {
    const rawJson = { '1': { class_type: 'Prompt', inputs: { text: 'from workflow' } } }
    const def = fn(
      'f',
      [input('t', 'text', true, { defaultValue: 'default', bind: { nodeId: '1', path: 'inputs.text' } })],
      'f',
      rawJson,
    )
    expect(buildFunctionRunInputDraft(def, resources, [])).toEqual({ t: 'default' })
  })

  it("falls back to '' / 0 / false when there is neither a defaultValue nor a workflow value", () => {
    const def = fn('f', [input('t', 'text'), input('n', 'number'), input('b', 'boolean')])
    expect(buildFunctionRunInputDraft(def, resources, [])).toEqual({ t: '', n: 0, b: false })
  })
})

describe('matchFunctionsForSelection', () => {
  it('returns [] when nothing is selected', () => {
    expect(matchFunctionsForSelection([fn('f', [input('a', 'image')])], resources, [])).toEqual([])
  })

  it('returns [] when every selected ref is missing from resourcesById', () => {
    const functions = [fn('f', [input('a', 'image')])]
    expect(matchFunctionsForSelection(functions, resources, [ref('ghost', 'image')])).toEqual([])
  })

  it('returns inputValues from the draft and usedResourceIds in input order', () => {
    const def = fn('f', [input('v', 'video'), input('a', 'image'), input('t', 'text', false, { defaultValue: 'x' })])
    const matches = matchFunctionsForSelection([def], resources, [ref('img1', 'image'), ref('vid1', 'video')])
    expect(matches).toHaveLength(1)
    expect(matches[0].functionDef).toBe(def)
    expect(matches[0].inputValues).toEqual({ v: ref('vid1', 'video'), a: ref('img1', 'image'), t: 'x' })
    expect(matches[0].usedResourceIds).toEqual(['vid1', 'img1'])
  })

  it('inputValues equals buildFunctionRunInputDraft over the remaining refs', () => {
    const def = fn('f', [input('a', 'image'), input('b', 'image'), input('n', 'number')])
    const selected = [ref('img2', 'image'), ref('ghost', 'image'), ref('img2', 'image'), ref('img1', 'image')]
    const remaining = [ref('img2', 'image'), ref('img1', 'image')]
    const [match] = matchFunctionsForSelection([def], resources, selected)
    expect(match.inputValues).toEqual(buildFunctionRunInputDraft(def, resources, remaining))
    expect(match.usedResourceIds).toEqual(['img2', 'img1'])
  })

  it('drops duplicate resourceIds, keeping the first occurrence', () => {
    const def = fn('f', [input('a', 'image'), input('b', 'image', false)])
    const matches = matchFunctionsForSelection([def], resources, [ref('img1', 'image'), ref('img1', 'image')])
    expect(matches).toHaveLength(1)
    expect(matches[0].usedResourceIds).toEqual(['img1'])
    expect(matches[0].inputValues).toEqual({ a: ref('img1', 'image') })
  })

  it('is selection-order sensitive: nth selected image goes to nth image input', () => {
    const def = fn('f', [input('first', 'image'), input('second', 'image')])
    const forward = matchFunctionsForSelection([def], resources, [ref('img1', 'image'), ref('img2', 'image')])
    const reversed = matchFunctionsForSelection([def], resources, [ref('img2', 'image'), ref('img1', 'image')])
    expect(forward[0].inputValues).toEqual({ first: ref('img1', 'image'), second: ref('img2', 'image') })
    expect(reversed[0].inputValues).toEqual({ first: ref('img2', 'image'), second: ref('img1', 'image') })
  })

  it('excludes functions that use no selected resource', () => {
    const imageFn = fn('img', [input('a', 'image')])
    const audioFn = fn('aud', [input('s', 'audio', false)])
    const textOnly = fn('txt', [input('t', 'text', true)])
    const matches = matchFunctionsForSelection([imageFn, audioFn, textOnly], resources, [ref('img1', 'image')])
    expect(ids(matches)).toEqual(['img'])
  })

  it('excludes functions with an unfilled required media input', () => {
    const needsVideo = fn('needsVideo', [input('a', 'image'), input('v', 'video', true)])
    const needsAudio = fn('needsAudio', [input('a', 'image'), input('s', 'audio', true)])
    const needsTwoImages = fn('needsTwo', [input('a', 'image', true), input('b', 'image', true)])
    const matches = matchFunctionsForSelection([needsVideo, needsAudio, needsTwoImages], resources, [
      ref('img1', 'image'),
    ])
    expect(matches).toEqual([])
  })

  it('includes functions whose unfilled media inputs are optional', () => {
    const def = fn('f', [input('a', 'image', true), input('v', 'video', false), input('b', 'image', false)])
    const matches = matchFunctionsForSelection([def], resources, [ref('img1', 'image')])
    expect(ids(matches)).toEqual(['f'])
    expect(matches[0].usedResourceIds).toEqual(['img1'])
  })

  it('never excludes a function for an unfilled required text/number/boolean input', () => {
    const def = fn('f', [input('a', 'image'), input('t', 'text', true), input('n', 'number', true), input('b', 'boolean', true)])
    const matches = matchFunctionsForSelection([def], resources, [ref('img1', 'image')])
    expect(ids(matches)).toEqual(['f'])
    expect(matches[0].inputValues).toEqual({ a: ref('img1', 'image'), t: '', n: 0, b: false })
  })

  it('counts a text ref placed into a text input as a used resource', () => {
    const def = fn('f', [input('t', 'text', true)])
    const matches = matchFunctionsForSelection([def], resources, [ref('txt1', 'text')])
    expect(ids(matches)).toEqual(['f'])
    expect(matches[0].usedResourceIds).toEqual(['txt1'])
  })

  it('sorts by number of used resources, most first', () => {
    const one = fn('one', [input('a', 'image')], 'A')
    const two = fn('two', [input('a', 'image'), input('b', 'image')], 'B')
    const three = fn('three', [input('a', 'image'), input('b', 'image'), input('v', 'video')], 'C')
    const selected = [ref('img1', 'image'), ref('img2', 'image'), ref('vid1', 'video'), ref('aud1', 'audio')]
    expect(ids(matchFunctionsForSelection([one, two, three], resources, selected))).toEqual(['three', 'two', 'one'])
  })

  it('functions that used all remaining refs sort ahead, and ties fall through to name', () => {
    // "Used all" is equivalent to count === remaining.length (remaining is shared), so it cannot split an
    // equal-count tie; this checks it does not disturb later tiebreakers after dedupe/missing-id filtering.
    const a = fn('a', [input('x', 'image')], 'Zeta')
    const b = fn('b', [input('x', 'image')], 'Alpha')
    const matches = matchFunctionsForSelection([a, b], resources, [ref('img1', 'image'), ref('ghost', 'image'), ref('img1', 'image')])
    expect(ids(matches)).toEqual(['b', 'a'])
    expect(matches.every((match) => match.usedResourceIds.length === 1)).toBe(true)
  })

  it('on equal count and coverage, puts custom functions before built-in ones', () => {
    const builtIn = fn(LOCAL_IMAGE_INFO_FUNCTION_ID, [input('image', 'image')], 'Aaa built-in')
    const custom = fn('custom', [input('image', 'image')], 'Zzz custom')
    const matches = matchFunctionsForSelection([builtIn, custom], resources, [ref('img1', 'image')])
    expect(ids(matches)).toEqual(['custom', LOCAL_IMAGE_INFO_FUNCTION_ID])
  })

  it('a built-in function with more used resources still ranks above a custom one', () => {
    const builtIn = fn(LOCAL_IMAGE_INFO_FUNCTION_ID, [input('a', 'image'), input('b', 'image')], 'Built-in')
    const custom = fn('custom', [input('a', 'image')], 'Custom')
    const matches = matchFunctionsForSelection([custom, builtIn], resources, [ref('img1', 'image'), ref('img2', 'image')])
    expect(ids(matches)).toEqual([LOCAL_IMAGE_INFO_FUNCTION_ID, 'custom'])
  })

  it('finally sorts by name with localeCompare', () => {
    const names = ['banana', 'Apple', 'cherry', 'apple pie']
    const functions = names.map((name, index) => fn(`f${index}`, [input('a', 'image')], name))
    const matches = matchFunctionsForSelection(functions, resources, [ref('img1', 'image')])
    expect(matches.map((match) => match.functionDef.name)).toEqual([...names].sort((x, y) => x.localeCompare(y)))
  })

  it('does not exclude functions merely because some selected refs were left unused', () => {
    const def = fn('f', [input('a', 'image')])
    const matches = matchFunctionsForSelection([def], resources, [ref('img1', 'image'), ref('vid1', 'video')])
    expect(ids(matches)).toEqual(['f'])
    expect(matches[0].usedResourceIds).toEqual(['img1'])
  })
})

describe('readingOrderNodeIds', () => {
  const node = (id: string, x: number, y: number) => ({ id, position: { x, y } })

  it('orders nodes top-to-bottom, then left-to-right within a row', () => {
    const nodes = [node('br', 300, 200), node('tl', 0, 0), node('bl', 0, 210), node('tr', 300, 10)]
    expect(readingOrderNodeIds(nodes, ['br', 'tl', 'bl', 'tr'])).toEqual(['tl', 'tr', 'bl', 'br'])
  })

  it('a node exactly 48 below the row start joins the row; 49 starts a new row', () => {
    const nodes = [node('a', 100, 0), node('b', 0, 48), node('c', 50, 49)]
    expect(readingOrderNodeIds(nodes, ['c', 'b', 'a'])).toEqual(['b', 'a', 'c'])
  })

  it("measures row membership from the row's first (smallest) y, not the previous node", () => {
    // y: 0, 40, 80 — 80 is within 48 of 40 but not of 0, so it starts a new row.
    const nodes = [node('a', 200, 0), node('b', 100, 40), node('c', 0, 80)]
    expect(readingOrderNodeIds(nodes, ['a', 'b', 'c'])).toEqual(['b', 'a', 'c'])
  })

  it('a new row starts its own threshold from its first y', () => {
    // rows: [0, 30] and [60, 100]; 100 - 60 = 40 <= 48.
    const nodes = [node('r1b', 0, 30), node('r1a', 10, 0), node('r2a', 50, 60), node('r2b', 5, 100)]
    expect(readingOrderNodeIds(nodes, ['r1a', 'r1b', 'r2a', 'r2b'])).toEqual(['r1b', 'r1a', 'r2b', 'r2a'])
  })

  it('appends ids not present in nodes at the end, in their given order', () => {
    const nodes = [node('b', 0, 100), node('a', 0, 0)]
    expect(readingOrderNodeIds(nodes, ['missing2', 'b', 'missing1', 'a'])).toEqual(['a', 'b', 'missing2', 'missing1'])
  })

  it('returns only the requested ids and ignores nodes not listed', () => {
    const nodes = [node('a', 0, 0), node('skip', 10, 0), node('b', 20, 0), node('c', 0, 300)]
    expect(readingOrderNodeIds(nodes, ['c', 'b', 'a'])).toEqual(['a', 'b', 'c'])
  })

  it('ignores unlisted nodes when grouping rows', () => {
    // If the unlisted node at y=0 anchored the row, 'b' (y=40) and 'a' (y=80) would split; listed-only they share a row.
    const nodes = [node('unlisted', 0, 0), node('a', 0, 80), node('b', 100, 40)]
    expect(readingOrderNodeIds(nodes, ['b', 'a'])).toEqual(['a', 'b'])
  })

  it('returns [] for no ids', () => {
    expect(readingOrderNodeIds([node('a', 0, 0)], [])).toEqual([])
  })
})
