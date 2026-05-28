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
})
