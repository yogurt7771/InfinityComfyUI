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

  it('packages an Electron preload bridge for project file persistence', () => {
    const packageJson = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8')) as {
      build?: { files?: string[] }
    }
    const main = readFileSync(resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')

    expect(packageJson.build?.files).toContain('electron/**/*')
    expect(main).toContain("preload: path.join(__dirname, 'preload.cjs')")
    expect(main).toContain("ipcMain.handle('infinity-storage:load'")
    expect(main).toContain("ipcMain.handle('infinity-storage:save'")
  })

  it('stores desktop projects beside the executable with per-project config and assets folders', () => {
    const main = readFileSync(resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')

    expect(main).toContain("path.dirname(app.getPath('exe'))")
    expect(main).toContain("'projects'")
    expect(main).toContain("'config'")
    expect(main).toContain("'assets'")
    expect(main).toContain("'project.json'")
    expect(main).toContain("'assets.json'")
  })
})
