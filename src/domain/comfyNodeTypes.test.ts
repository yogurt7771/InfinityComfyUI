import { describe, expect, it } from 'vitest'
import { comfyNodeTypesFromObjectInfo } from './comfyNodeTypes'

describe('comfyNodeTypesFromObjectInfo', () => {
  it('reads output_node and required/optional input types, ignoring hidden inputs', () => {
    const objectInfo = {
      SaveImage: {
        input: {
          required: {
            images: ['IMAGE'],
            filename_prefix: ['STRING', { default: 'ComfyUI' }],
          },
          hidden: { prompt: 'PROMPT', extra_pnginfo: 'EXTRA_PNGINFO' },
        },
        output: [],
        output_node: true,
        category: 'image',
      },
      KSampler: {
        input: {
          required: {
            model: ['MODEL'],
            seed: ['INT', { default: 0, min: 0 }],
            sampler_name: [['euler', 'dpmpp_2m'], {}],
          },
          optional: { latent_image: ['LATENT'] },
        },
        output: ['LATENT'],
        output_node: false,
      },
    }

    expect(comfyNodeTypesFromObjectInfo(objectInfo)).toEqual({
      SaveImage: {
        outputNode: true,
        inputTypes: { images: ['IMAGE'], filename_prefix: ['STRING'] },
      },
      KSampler: {
        outputNode: false,
        inputTypes: {
          model: ['MODEL'],
          seed: ['INT'],
          sampler_name: ['COMBO'],
          latent_image: ['LATENT'],
        },
      },
    })
  })

  it.each([
    ['missing', undefined],
    ['false', false],
    ['the string "true"', 'true'],
    ['the number 1', 1],
    ['null', null],
  ])('treats output_node %s as not an output node', (_label, outputNode) => {
    const info: Record<string, unknown> = { input: { required: { images: ['IMAGE'] } } }
    if (outputNode !== undefined) info.output_node = outputNode
    expect(comfyNodeTypesFromObjectInfo({ Node: info })).toEqual({
      Node: { outputNode: false, inputTypes: { images: ['IMAGE'] } },
    })
  })

  it('splits comma-separated types, trims and upper-cases them', () => {
    const result = comfyNodeTypesFromObjectInfo({
      Multi: {
        input: {
          required: { a: ['image, mask'], b: ['IMAGE,MASK'], c: ['  video '] },
          optional: { d: ['*'], e: ['Audio'] },
        },
        output_node: true,
      },
    })
    expect(result).toEqual({
      Multi: {
        outputNode: true,
        inputTypes: {
          a: ['IMAGE', 'MASK'],
          b: ['IMAGE', 'MASK'],
          c: ['VIDEO'],
          d: ['*'],
          e: ['AUDIO'],
        },
      },
    })
  })

  it('maps combo choice arrays to COMBO', () => {
    expect(
      comfyNodeTypesFromObjectInfo({
        LoadImage: { input: { required: { image: [['a.png', 'b.png'], { image_upload: true }] } } },
        EmptyCombo: { input: { optional: { choice: [[]] } } },
      }),
    ).toEqual({
      LoadImage: { outputNode: false, inputTypes: { image: ['COMBO'] } },
      EmptyCombo: { outputNode: false, inputTypes: { choice: ['COMBO'] } },
    })
  })

  it('skips specs that are not arrays or have no usable first element', () => {
    expect(
      comfyNodeTypesFromObjectInfo({
        Weird: {
          input: {
            required: {
              notArray: 'IMAGE',
              object: { type: 'IMAGE' },
              empty: [],
              nullFirst: [null],
              numberFirst: [42],
              ok: ['STRING'],
            },
            optional: { missing: undefined, alsoOk: ['VIDEO'] },
          },
          output_node: true,
        },
      }),
    ).toEqual({
      Weird: { outputNode: true, inputTypes: { ok: ['STRING'], alsoOk: ['VIDEO'] } },
    })
  })

  it('gives an empty inputTypes for classes without usable input sections', () => {
    expect(
      comfyNodeTypesFromObjectInfo({
        NoInput: { output_node: true },
        NullInput: { input: null },
        EmptyInput: { input: {} },
        HiddenOnly: { input: { hidden: { unique_id: 'UNIQUE_ID' } } },
      }),
    ).toEqual({
      NoInput: { outputNode: true, inputTypes: {} },
      NullInput: { outputNode: false, inputTypes: {} },
      EmptyInput: { outputNode: false, inputTypes: {} },
      HiddenOnly: { outputNode: false, inputTypes: {} },
    })
  })

  it('skips classes whose value is not an object', () => {
    expect(
      comfyNodeTypesFromObjectInfo({
        Good: { input: { required: { images: ['IMAGE'] } }, output_node: true },
        Null: null,
        Str: 'SaveImage',
        Num: 5,
        Bool: true,
      }),
    ).toEqual({
      Good: { outputNode: true, inputTypes: { images: ['IMAGE'] } },
    })
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'object_info'],
    ['a number', 42],
    ['a boolean', true],
  ])('returns {} for %s object_info', (_label, objectInfo) => {
    expect(comfyNodeTypesFromObjectInfo(objectInfo)).toEqual({})
  })

  it('returns {} for an empty object_info', () => {
    expect(comfyNodeTypesFromObjectInfo({})).toEqual({})
  })
})
