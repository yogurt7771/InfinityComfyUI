import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workspaceRoot = resolve(__dirname, '..')

describe('supported distribution entry points', () => {
  it('ships Docker and static web-server distribution files', () => {
    const distributionPaths = ['.dockerignore', 'Dockerfile', 'docker-compose.yml', 'server/serve.mjs']

    expect(distributionPaths.filter((path) => !existsSync(resolve(workspaceRoot, path)))).toEqual([])
  })

  it('exposes web, Docker, browser launcher, and Electron entry points', () => {
    const packageJson = JSON.parse(readFileSync(resolve(workspaceRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
      devDependencies?: Record<string, string>
    }

    expect(packageJson.scripts?.serve).toMatch(/server[\\/]serve\.mjs/i)
    expect(packageJson.scripts?.['docker:build']).toMatch(/docker build/i)
    expect(packageJson.scripts?.['docker:up']).toMatch(/docker compose up/i)
    expect(packageJson.scripts?.dev).toMatch(/launcher/i)
    expect(packageJson.scripts?.launcher).toMatch(/electron[\\/]launcher\.cjs/i)
    expect(packageJson.scripts?.electron).toMatch(/electron/i)
    expect(packageJson.scripts?.['package:launcher']).toMatch(/electron-builder.*launcher/i)
    expect(packageJson.scripts?.['package:electron']).toMatch(/electron-builder.*electron/i)
    expect(packageJson.scripts?.['package:win']).toMatch(/electron-builder --win/i)
  })

  it('does not require users to install an Infinity custom node into ComfyUI', () => {
    const readme = readFileSync(resolve(workspaceRoot, 'README.md'), 'utf8')

    expect(existsSync(resolve(workspaceRoot, 'comfyui_bridge', '__init__.py'))).toBe(false)
    expect(existsSync(resolve(workspaceRoot, 'comfyui_bridge', 'web', 'infinity_bridge.js'))).toBe(false)
    expect(existsSync(resolve(workspaceRoot, 'comfyui_bridge', 'web', 'storage-access.html'))).toBe(false)
    expect(readme).not.toMatch(/custom_nodes[\\/]infinity_comfy_bridge/i)
  })
})
