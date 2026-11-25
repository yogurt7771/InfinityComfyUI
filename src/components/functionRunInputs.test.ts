import { describe, expect, it } from 'vitest'
import type { FunctionInputDef, PrimitiveInputValue, Resource, ResourceRef, ResourceType } from '../domain/types'
import { partitionRunInputs } from './functionRunInputs'

type Values = Record<string, PrimitiveInputValue | ResourceRef>

const input = (
  key: string,
  type: ResourceType,
  required = false,
  extra: Partial<FunctionInputDef> = {},
): FunctionInputDef => ({ key, label: key, type, required, bind: { path: 'x' }, ...extra }) as FunctionInputDef

const res = (id: string, type: ResourceType): Resource =>
  ({ id, type, value: '', source: { kind: 'user_upload' }, metadata: { createdAt: '' } }) as Resource

const ref = (resourceId: string, type: ResourceType): ResourceRef => ({ resourceId, type })

const byId = (resources: Resource[]): Record<string, Resource> =>
  Object.fromEntries(resources.map((resource) => [resource.id, resource]))

const resources = byId([
  ...Array.from({ length: 10 }, (_, index) => res(`img${index + 1}`, 'image')),
  res('vid1', 'video'),
  res('vid2', 'video'),
  res('aud1', 'audio'),
])

const keys = (items: FunctionInputDef[]) => items.map((item) => item.key)

// Gemini-like: required text prompt + optional Image 1..10.
const gemini = () => [
  input('prompt', 'text', true),
  ...Array.from({ length: 10 }, (_, index) => input(`image${index + 1}`, 'image', false, { label: `Image ${index + 1}` })),
]

const fillImages = (count: number): Values =>
  Object.fromEntries(Array.from({ length: count }, (_, index) => [`image${index + 1}`, ref(`img${index + 1}`, 'image')]))

const expectPartitionOf = (result: { visible: FunctionInputDef[]; collapsed: FunctionInputDef[] }, inputs: FunctionInputDef[]) => {
  // Every input exactly once, by reference, and each side is an order-preserving subsequence.
  const all = [...result.visible, ...result.collapsed]
  expect(all).toHaveLength(inputs.length)
  for (const item of inputs) expect(all.filter((other) => other === item)).toHaveLength(1)
  const indexOf = (item: FunctionInputDef) => inputs.indexOf(item)
  for (const side of [result.visible, result.collapsed]) {
    const indices = side.map(indexOf)
    expect(indices.every((index) => index >= 0)).toBe(true)
    expect(indices).toEqual([...indices].sort((a, b) => a - b))
  }
}

describe('partitionRunInputs', () => {
  it('returns empty visible and collapsed for an empty input list', () => {
    expect(partitionRunInputs([], {}, resources)).toEqual({ visible: [], collapsed: [] })
  })

  describe('Gemini-like prompt + Image 1..10', () => {
    it('with 0 images filled shows prompt and Image 1, collapses Image 2..10', () => {
      const inputs = gemini()
      const result = partitionRunInputs(inputs, { prompt: 'hello' }, resources)
      expect(keys(result.visible)).toEqual(['prompt', 'image1'])
      expect(keys(result.collapsed)).toEqual(['image2', 'image3', 'image4', 'image5', 'image6', 'image7', 'image8', 'image9', 'image10'])
      expectPartitionOf(result, inputs)
    })

    it('with 0 images filled and no values at all behaves the same', () => {
      const inputs = gemini()
      const result = partitionRunInputs(inputs, {}, resources)
      expect(keys(result.visible)).toEqual(['prompt', 'image1'])
      expect(result.collapsed).toHaveLength(9)
    })

    it('with 2 images filled shows the filled ones plus the next empty slot', () => {
      const inputs = gemini()
      const result = partitionRunInputs(inputs, { prompt: 'p', ...fillImages(2) }, resources)
      expect(keys(result.visible)).toEqual(['prompt', 'image1', 'image2', 'image3'])
      expect(keys(result.collapsed)).toEqual(['image4', 'image5', 'image6', 'image7', 'image8', 'image9', 'image10'])
      expectPartitionOf(result, inputs)
    })

    it('with 8 images filled only one slot would collapse, so nothing collapses', () => {
      const inputs = gemini()
      const result = partitionRunInputs(inputs, { prompt: 'p', ...fillImages(8) }, resources)
      expect(result.visible).toEqual(inputs)
      expect(result.collapsed).toEqual([])
    })

    it('with 9 images filled everything is visible', () => {
      const inputs = gemini()
      const result = partitionRunInputs(inputs, { prompt: 'p', ...fillImages(9) }, resources)
      expect(keys(result.visible)).toEqual(keys(inputs))
      expect(result.collapsed).toEqual([])
    })

    it('with all 10 images filled everything is visible', () => {
      const inputs = gemini()
      const result = partitionRunInputs(inputs, { prompt: 'p', ...fillImages(10) }, resources)
      expect(keys(result.visible)).toEqual(keys(inputs))
      expect(result.collapsed).toEqual([])
    })
  })

  describe('collapse threshold (fewer than 2 collapsed means none)', () => {
    const images = (count: number) => Array.from({ length: count }, (_, index) => input(`i${index + 1}`, 'image'))

    it('1 optional empty image: visible, nothing collapsed', () => {
      const inputs = images(1)
      expect(partitionRunInputs(inputs, {}, resources)).toEqual({ visible: inputs, collapsed: [] })
    })

    it('2 optional empty images: exactly 1 would collapse, so nothing collapses', () => {
      const inputs = images(2)
      const result = partitionRunInputs(inputs, {}, resources)
      expect(keys(result.visible)).toEqual(['i1', 'i2'])
      expect(result.collapsed).toEqual([])
    })

    it('3 optional empty images: 2 collapse', () => {
      const inputs = images(3)
      const result = partitionRunInputs(inputs, {}, resources)
      expect(keys(result.visible)).toEqual(['i1'])
      expect(keys(result.collapsed)).toEqual(['i2', 'i3'])
    })

    it('4 optional empty images: 3 collapse', () => {
      const inputs = images(4)
      const result = partitionRunInputs(inputs, {}, resources)
      expect(keys(result.visible)).toEqual(['i1'])
      expect(keys(result.collapsed)).toEqual(['i2', 'i3', 'i4'])
    })

    it('the "nothing collapsed" result keeps all inputs in original order by reference', () => {
      const inputs = [input('t', 'text', true), input('a', 'image'), input('b', 'image')]
      const result = partitionRunInputs(inputs, {}, resources)
      expect(result.visible).toHaveLength(3)
      result.visible.forEach((item, index) => expect(item).toBe(inputs[index]))
      expect(result.collapsed).toEqual([])
    })
  })

  it('a filled slot after an empty one stays visible; later empties collapse', () => {
    const inputs = ['i1', 'i2', 'i3', 'i4', 'i5'].map((key) => input(key, 'image'))
    const result = partitionRunInputs(inputs, { i2: ref('img2', 'image') }, resources)
    expect(keys(result.visible)).toEqual(['i1', 'i2'])
    expect(keys(result.collapsed)).toEqual(['i3', 'i4', 'i5'])
    expectPartitionOf(result, inputs)
  })

  it('a ResourceRef whose resource is missing counts as empty', () => {
    const inputs = ['i1', 'i2', 'i3', 'i4'].map((key) => input(key, 'image'))
    const values: Values = { i1: ref('img1', 'image'), i2: ref('ghost', 'image') }
    const result = partitionRunInputs(inputs, values, resources)
    // i2 is the first empty slot; if the dangling ref counted as filled, only i4 would collapse (=> none).
    expect(keys(result.visible)).toEqual(['i1', 'i2'])
    expect(keys(result.collapsed)).toEqual(['i3', 'i4'])
  })

  it('a dangling ref on every slot leaves only the first visible', () => {
    const inputs = ['i1', 'i2', 'i3'].map((key) => input(key, 'image'))
    const values: Values = { i1: ref('ghost1', 'image'), i2: ref('ghost2', 'image'), i3: ref('ghost3', 'image') }
    const result = partitionRunInputs(inputs, values, {})
    expect(keys(result.visible)).toEqual(['i1'])
    expect(keys(result.collapsed)).toEqual(['i2', 'i3'])
  })

  it.each<[string, PrimitiveInputValue]>([
    ['string', 'C:/some/path.png'],
    ['resource id string', 'img2'],
    ['number', 42],
    ['boolean', true],
    ['null', null],
  ])('a %s primitive value on a media input counts as empty', (_label, value) => {
    const inputs = ['i1', 'i2', 'i3', 'i4'].map((key) => input(key, 'image'))
    const values: Values = { i1: ref('img1', 'image'), i2: value }
    const result = partitionRunInputs(inputs, values, resources)
    expect(keys(result.visible)).toEqual(['i1', 'i2'])
    expect(keys(result.collapsed)).toEqual(['i3', 'i4'])
  })

  describe('mixed media types', () => {
    it('counts image and video empty slots independently (interleaved)', () => {
      const inputs = [
        input('img1', 'image'),
        input('vid1', 'video'),
        input('img2', 'image'),
        input('vid2', 'video'),
        input('img3', 'image'),
        input('vid3', 'video'),
      ]
      const result = partitionRunInputs(inputs, {}, resources)
      expect(keys(result.visible)).toEqual(['img1', 'vid1'])
      expect(keys(result.collapsed)).toEqual(['img2', 'vid2', 'img3', 'vid3'])
      expectPartitionOf(result, inputs)
    })

    it('one extra image and one extra video together reach the threshold of 2', () => {
      const inputs = [input('i1', 'image'), input('i2', 'image'), input('v1', 'video'), input('v2', 'video')]
      const result = partitionRunInputs(inputs, {}, resources)
      expect(keys(result.visible)).toEqual(['i1', 'v1'])
      expect(keys(result.collapsed)).toEqual(['i2', 'v2'])
    })

    it('two images and one video: only one would collapse, so nothing collapses', () => {
      const inputs = [input('i1', 'image'), input('v1', 'video'), input('i2', 'image')]
      const result = partitionRunInputs(inputs, {}, resources)
      expect(result.visible).toEqual(inputs)
      expect(result.collapsed).toEqual([])
    })

    it('audio is a media type with its own first visible empty slot', () => {
      const inputs = [input('a1', 'audio'), input('a2', 'audio'), input('a3', 'audio'), input('i1', 'image')]
      const result = partitionRunInputs(inputs, {}, resources)
      expect(keys(result.visible)).toEqual(['a1', 'i1'])
      expect(keys(result.collapsed)).toEqual(['a2', 'a3'])
    })

    it('a filled video does not consume the visible empty video slot', () => {
      const inputs = [input('v1', 'video'), input('v2', 'video'), input('v3', 'video'), input('v4', 'video')]
      const result = partitionRunInputs(inputs, { v1: ref('vid1', 'video') }, resources)
      expect(keys(result.visible)).toEqual(['v1', 'v2'])
      expect(keys(result.collapsed)).toEqual(['v3', 'v4'])
    })
  })

  it('required empty media inputs are never collapsed and are not empty slots', () => {
    const inputs = [
      input('r1', 'image', true),
      input('r2', 'image', true),
      input('r3', 'image', true),
      input('o1', 'image'),
      input('o2', 'image'),
      input('o3', 'image'),
    ]
    const result = partitionRunInputs(inputs, {}, resources)
    expect(keys(result.visible)).toEqual(['r1', 'r2', 'r3', 'o1'])
    expect(keys(result.collapsed)).toEqual(['o2', 'o3'])
  })

  it('required empty media inputs alone never collapse', () => {
    const inputs = ['r1', 'r2', 'r3', 'r4'].map((key) => input(key, 'video', true))
    const result = partitionRunInputs(inputs, {}, resources)
    expect(result.visible).toEqual(inputs)
    expect(result.collapsed).toEqual([])
  })

  it('optional non-media inputs are never collapsed, even when empty', () => {
    const inputs = [
      input('t1', 'text'),
      input('t2', 'text'),
      input('n1', 'number'),
      input('n2', 'number'),
      input('b1', 'boolean'),
      input('b2', 'boolean'),
    ]
    const result = partitionRunInputs(inputs, {}, resources)
    expect(result.visible).toEqual(inputs)
    expect(result.collapsed).toEqual([])
  })

  it('optional non-media inputs stay visible alongside collapsed media', () => {
    const inputs = [
      input('t1', 'text'),
      input('i1', 'image'),
      input('n1', 'number'),
      input('i2', 'image'),
      input('b1', 'boolean'),
      input('i3', 'image'),
      input('t2', 'text'),
    ]
    const result = partitionRunInputs(inputs, {}, resources)
    expect(keys(result.visible)).toEqual(['t1', 'i1', 'n1', 'b1', 't2'])
    expect(keys(result.collapsed)).toEqual(['i2', 'i3'])
    expectPartitionOf(result, inputs)
  })

  it('preserves original order and returns the same input objects', () => {
    const inputs = [
      input('i1', 'image'),
      input('t', 'text', true),
      input('i2', 'image'),
      input('v1', 'video'),
      input('i3', 'image'),
      input('v2', 'video'),
      input('i4', 'image'),
    ]
    const result = partitionRunInputs(inputs, { i3: ref('img3', 'image') }, resources)
    expect(keys(result.visible)).toEqual(['i1', 't', 'v1', 'i3'])
    expect(keys(result.collapsed)).toEqual(['i2', 'v2', 'i4'])
    expect(result.visible[0]).toBe(inputs[0])
    expect(result.visible[1]).toBe(inputs[1])
    expect(result.visible[2]).toBe(inputs[3])
    expect(result.visible[3]).toBe(inputs[4])
    expect(result.collapsed[0]).toBe(inputs[2])
    expect(result.collapsed[1]).toBe(inputs[5])
    expect(result.collapsed[2]).toBe(inputs[6])
    expectPartitionOf(result, inputs)
  })

  it('does not mutate its arguments', () => {
    const inputs = gemini()
    const values: Values = { prompt: 'p', image1: ref('img1', 'image'), image2: ref('ghost', 'image'), image3: 'x' }
    const localResources = byId([res('img1', 'image'), res('img2', 'image')])
    const snapshot = structuredClone({ inputs, values, localResources })
    const inputRefs = [...inputs]

    const deepFreeze = <T>(value: T): T => {
      if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value)
        for (const child of Object.values(value)) deepFreeze(child)
      }
      return value
    }
    deepFreeze(inputs)
    deepFreeze(values)
    deepFreeze(localResources)

    const result = partitionRunInputs(inputs, values, localResources)
    expect(keys(result.visible)).toEqual(['prompt', 'image1', 'image2'])
    expect(keys(result.collapsed)).toHaveLength(8)
    expect({ inputs, values, localResources }).toEqual(snapshot)
    inputs.forEach((item, index) => expect(item).toBe(inputRefs[index]))
  })
})
