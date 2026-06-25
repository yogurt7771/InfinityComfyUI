import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(resolve(__dirname, 'styles.css'), 'utf8').replace(/\r\n/g, '\n')

const cssBlock = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{(?<body>[^}]*)\\}`, 'm').exec(styles)
  return match?.groups?.body ?? ''
}

const cssNumericValue = (selector: string, property: string) => {
  const block = cssBlock(selector)
  const match = new RegExp(`${property}\\s*:\\s*(\\d+)`).exec(block)
  return match ? Number(match[1]) : undefined
}

describe('preview media CSS', () => {
  it('forces connected and reference media previews to render contained inside their frame', () => {
    const block = cssBlock('.media-preview-contain')

    expect(block).toContain('width: 100% !important')
    expect(block).toContain('height: 100% !important')
    expect(block).toContain('position: absolute')
    expect(block).toContain('inset: 0')
    expect(block).toContain('object-fit: contain !important')
    expect(block).toContain('object-position: center')
  })

  it('uses the app media preview surface instead of black letterboxing', () => {
    const referenceBlock = cssBlock('.node-reference-media-preview')
    const slotBlock = cssBlock('.slot-media-preview')
    const mediaBlock = cssBlock('.media-preview-contain')

    expect(referenceBlock).toContain('var(--media-preview-surface)')
    expect(slotBlock).toContain('var(--media-preview-surface)')
    expect(mediaBlock).toContain('var(--media-preview-surface)')
    expect(`${referenceBlock}\n${slotBlock}\n${mediaBlock}`).not.toContain('#020617')
  })
})

describe('canvas resource UI CSS', () => {
  it('keeps media previews inside resized resource nodes', () => {
    const nodeBlock = cssBlock('.resource-node')
    const triggerBlock = cssBlock('.resource-preview-trigger')
    const triggerMediaBlock = cssBlock('.resource-preview-trigger .resource-preview-image,\n.resource-preview-trigger .resource-preview-video')
    const boundedPlaceholderBlock = cssBlock('.resource-node .resource-empty-media,\n.resource-node .resource-pending-media')

    expect(nodeBlock).toContain('display: grid')
    expect(nodeBlock).toContain('grid-template-rows: auto auto auto minmax(0, 1fr)')
    expect(nodeBlock).toContain('min-height: 0')
    expect(triggerBlock).toContain('position: relative')
    expect(triggerBlock).toContain('width: 100%')
    expect(triggerBlock).toContain('max-width: 100%')
    expect(triggerBlock).toContain('box-sizing: border-box')
    expect(triggerBlock).toContain('min-height: 0')
    expect(triggerBlock).toContain('overflow: hidden')
    expect(triggerMediaBlock).toContain('position: absolute')
    expect(triggerMediaBlock).toContain('inset: 0')
    expect(triggerMediaBlock).toContain('height: 100%')
    expect(triggerMediaBlock).toContain('max-width: 100%')
    expect(triggerMediaBlock).toContain('max-height: 100%')
    expect(triggerMediaBlock).toContain('object-fit: contain')
    expect(triggerMediaBlock).toContain('object-position: center')
    expect(boundedPlaceholderBlock).toContain('height: 100%')
    expect(boundedPlaceholderBlock).toContain('min-height: 0')
  })

  it('keeps long resource metadata labels inside the node chrome', () => {
    const metaBlock = cssBlock('.resource-node-meta')
    const functionChipBlock = cssBlock('.asset-function-chip')

    expect(metaBlock).toContain('overflow: hidden')
    expect(functionChipBlock).toContain('flex: 1 1 auto')
    expect(functionChipBlock).toContain('min-width: 0')
    expect(functionChipBlock).toContain('max-width: 58%')
    expect(functionChipBlock).toContain('text-overflow: ellipsis')
  })

  it('lets text result previews fill the available result card area', () => {
    const block = cssBlock('.result-preview-card .resource-preview-text')

    expect(block).toContain('height: 100%')
    expect(block).toContain('max-height: none')
    expect(block).toContain('overflow: auto')
  })

  it('renders resource quick actions as a compact menu instead of large cards', () => {
    const menuBlock = cssBlock('.resource-quick-actions')
    const buttonBlock = cssBlock('.resource-quick-actions button')

    expect(menuBlock).toContain('gap: 3px')
    expect(menuBlock).toContain('border-radius: 8px')
    expect(buttonBlock).toContain('min-height: 30px')
    expect(buttonBlock).toContain('border-color: transparent')
    expect(buttonBlock).toContain('box-shadow: none')
  })

  it('keeps full resource previews above local action dialogs', () => {
    expect(cssNumericValue('.full-preview-backdrop', 'z-index')).toBeGreaterThan(
      cssNumericValue('.local-action-backdrop', 'z-index') ?? 0,
    )
  })
})
