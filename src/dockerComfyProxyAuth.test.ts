import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workspaceRoot = resolve(__dirname, '..')

describe('Electron-only distribution boundary', () => {
  it('does not ship Docker or static web-server distribution files', () => {
    const retiredPaths = [
      '.dockerignore',
      'Dockerfile',
      'docker-compose.yml',
      'packaging/release.env',
      'scripts/export-dist.mjs',
      'server/serve.mjs',
      'playwright.config.ts',
    ]

    expect(retiredPaths.filter((path) => existsSync(resolve(workspaceRoot, path)))).toEqual([])
  })

  it('exposes only desktop build, run, and packaging entry points', () => {
    const packageJson = JSON.parse(readFileSync(resolve(workspaceRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
      devDependencies?: Record<string, string>
    }

    expect(packageJson.scripts).not.toHaveProperty('export:dist')
    expect(packageJson.scripts).not.toHaveProperty('serve')
    expect(packageJson.scripts).not.toHaveProperty('preview')
    expect(packageJson.scripts).not.toHaveProperty('browser:smoke')
    expect(packageJson.scripts?.dev).toMatch(/electron/i)
    expect(packageJson.scripts?.electron).toMatch(/electron/i)
    expect(packageJson.scripts?.['package:win']).toMatch(/electron-builder --win/i)
    expect(packageJson.devDependencies).not.toHaveProperty('@playwright/test')
  })

  it('does not require users to install an Infinity custom node into ComfyUI', () => {
    const readme = readFileSync(resolve(workspaceRoot, 'README.md'), 'utf8')

    expect(existsSync(resolve(workspaceRoot, 'comfyui_bridge', '__init__.py'))).toBe(false)
    expect(existsSync(resolve(workspaceRoot, 'comfyui_bridge', 'web', 'infinity_bridge.js'))).toBe(false)
    expect(existsSync(resolve(workspaceRoot, 'comfyui_bridge', 'web', 'storage-access.html'))).toBe(false)
    expect(readme).not.toMatch(/custom_nodes[\\/]infinity_comfy_bridge/i)
    expect(readme).not.toMatch(/docker(?:file|[- ]compose|\s+(?:build|run))/i)
  })
})
