import { describe, expect, it } from 'vitest'
import { randomizeWorkflowSeeds } from './seed'

describe('randomizeWorkflowSeeds', () => {
  it('patches every numeric seed-like input and records a patch log without mutating the template', () => {
    const template = {
      '3': {
        class_type: 'KSampler',
        _meta: { title: 'Sampler' },
        inputs: {
          seed: 12,
          noise_seed: '34',
          steps: 20,
        },
      },
      '9': {
        class_type: 'OtherNode',
        _meta: { title: 'Variation' },
        inputs: {
          variationSeed: 99,
          notSeed: 'abc',
        },
      },
    }

    const values = [101, 202, 303]
    const result = randomizeWorkflowSeeds(template, {
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => values.shift() ?? 404,
      range: { min: 0, max: 2147483647 },
    })

    expect(result.workflow).not.toBe(template)
    expect(result.workflow['3']!.inputs!.seed).toBe(101)
    expect(result.workflow['3']!.inputs!.noise_seed).toBe(202)
    expect(result.workflow['9']!.inputs!.variationSeed).toBe(303)
    expect(result.workflow['9']!.inputs!.notSeed).toBe('abc')
    expect(template['3'].inputs.seed).toBe(12)
    expect(result.patchLog).toEqual([
      {
        nodeId: '3',
        nodeTitle: 'Sampler',
        nodeClassType: 'KSampler',
        path: '3.inputs.seed',
        oldValue: 12,
        newValue: 101,
        patchedAt: '2026-05-08T09:00:00.000Z',
      },
      {
        nodeId: '3',
        nodeTitle: 'Sampler',
        nodeClassType: 'KSampler',
        path: '3.inputs.noise_seed',
        oldValue: '34',
        newValue: 202,
        patchedAt: '2026-05-08T09:00:00.000Z',
      },
      {
        nodeId: '9',
        nodeTitle: 'Variation',
        nodeClassType: 'OtherNode',
        path: '9.inputs.variationSeed',
        oldValue: 99,
        newValue: 303,
        patchedAt: '2026-05-08T09:00:00.000Z',
      },
    ])
  })
})
