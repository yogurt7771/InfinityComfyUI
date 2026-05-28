import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(resolve(__dirname, 'styles.css'), 'utf8')

const cssBlock = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, 'm').exec(styles)
  return match?.groups?.body ?? ''
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
})
