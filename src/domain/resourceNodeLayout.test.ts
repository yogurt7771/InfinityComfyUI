import { describe, expect, it } from 'vitest'
import { resourceNodeMinSize } from './resourceNodeLayout'

describe('resourceNodeMinSize', () => {
  it('uses the preview viewport as the minimum for simple media assets', () => {
    expect(resourceNodeMinSize({ resourceType: 'image', title: 'Image', referenceCount: 0 })).toEqual({
      width: 290,
      height: 294,
    })
  })

  it('expands to fit visible status, duration, and source function chrome', () => {
    const simple = resourceNodeMinSize({ resourceType: 'image', title: 'Image', referenceCount: 0 })
    const busy = resourceNodeMinSize({
      resourceType: 'image',
      title: 'Gemini Generate Image Image',
      referenceCount: 0,
      assetStatus: 'queued',
      durationLabel: '8m 30s',
      sourceFunctionName: 'Gemini Generate Image',
    })

    expect(busy.width).toBeGreaterThan(simple.width)
    expect(busy.width).toBe(390)
    expect(busy.height).toBe(294)
  })

  it('uses smaller preview minimums for primitive asset editors', () => {
    expect(resourceNodeMinSize({ resourceType: 'number', title: 'Seed', referenceCount: 0 })).toEqual({
      width: 230,
      height: 182,
    })
  })
})
