import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import viteConfig from '../vite.config'

describe('Electron packaging configuration', () => {
  it('uses relative built asset paths for file protocol packaged windows', () => {
    expect(viteConfig.base).toBe('./')
  })

  it('sets the packaged window document title to the product name', () => {
    const html = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf8')

    expect(html).toContain('<title>Infinity ComfyUI</title>')
  })
})
