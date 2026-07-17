import { existsSync, readFileSync } from 'node:fs'
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

    expect(packageJson.build?.files).toContain('app-dist/**/*')
    expect(packageJson.build?.files).toContain('electron/**/*')
    expect(main).toContain("preload: path.join(__dirname, 'preload.cjs')")
    expect(main).toContain("ipcMain.handle('infinity-storage:load'")
    expect(main).toContain("ipcMain.handle('infinity-storage:save'")
  })

  it('serves the packaged renderer over a local HTTP server for Electron and launcher modes', () => {
    const main = readFileSync(resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
    const launcher = readFileSync(resolve(__dirname, '..', 'electron', 'launcher.cjs'), 'utf8')

    expect(main).toContain("require('node:http')")
    expect(main).toContain('startAppServer')
    expect(main).toContain('serveStaticApp')
    expect(main).toContain("path.join(__dirname, '..', 'app-dist')")
    expect(main).toContain("path.join(distDir, 'index.html')")
    expect(main).toContain('INFINITY_DEV_SERVER_URL')
    expect(main).toContain('win.loadURL')
    expect(main).toContain('shell.openExternal(appUrl)')
    expect(launcher).toContain("process.env.INFINITY_APP_MODE = 'launcher'")
    expect(launcher).toContain("require('./main.cjs')")
  })

  it('routes the embedded ComfyUI editor through the local proxy with automatic password login support', () => {
    const main = readFileSync(resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
    expect(main).toContain('contextIsolation: true')
    expect(main).toContain('nodeIntegration: false')
    expect(main).toContain("const COMFY_PROXY_SEGMENT = '__comfy_proxy'")
    expect(main).toContain("type: 'infinity-comfy-login-ready'")
    expect(main).toContain("event.data?.type !== 'infinity-comfy-login'")
    expect(main).toContain('passwordInput.value = password')
    expect(main).toContain('form.requestSubmit()')
    expect(main).not.toContain('infinity_comfy_bridge')
    expect(existsSync(resolve(__dirname, 'domain', 'comfyFrameBridge.ts'))).toBe(false)
  })

  it('uses the custom generated icon for browser, portable, and installer builds', () => {
    const packageJson = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8')) as {
      build?: {
        directories?: { buildResources?: string }
        extraResources?: { from?: string; to?: string }[]
        win?: { icon?: string }
      }
    }
    const main = readFileSync(resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')

    expect(existsSync(resolve(__dirname, '..', 'build', 'icon.svg'))).toBe(true)
    expect(existsSync(resolve(__dirname, '..', 'build', 'icon.png'))).toBe(true)
    expect(existsSync(resolve(__dirname, '..', 'build', 'icon.ico'))).toBe(true)
    expect(packageJson.build?.directories?.buildResources).toBe('build')
    expect(packageJson.build?.win?.icon).toBe('build/icon.ico')
    expect(packageJson.build?.extraResources).toContainEqual({ from: 'build/icon.ico', to: 'icon.ico' })
    expect(main).toContain("process.resourcesPath, 'icon.ico'")
    expect(main).toContain('icon: appIconPath()')
  })

  it('stores desktop projects beside the executable with per-project config and assets folders', () => {
    const main = readFileSync(resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')

    expect(main).toContain('PORTABLE_EXECUTABLE_DIR')
    expect(main).toContain("path.dirname(app.getPath('exe'))")
    expect(main).toContain("'projects'")
    expect(main).toContain("'config'")
    expect(main).toContain("'assets'")
    expect(main).toContain("'project.json'")
    expect(main).toContain("'assets.json'")
    expect(main).toContain("error.code === 'ENOENT'")
    expect(main).toContain('throw error')
  })
})
