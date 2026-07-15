import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workspaceRoot = resolve(__dirname, '..')

describe('Docker frontend-only ComfyUI configuration', () => {
  it('does not inject backend ComfyUI proxy settings into the container', () => {
    const compose = readFileSync(join(workspaceRoot, 'docker-compose.yml'), 'utf8')

    expect(compose).not.toMatch(/^\s+COMFY_PROXY_/m)
  })

  it('does not use the ComfyUI login password file as an API Bearer token source', () => {
    const compose = readFileSync(join(workspaceRoot, 'docker-compose.yml'), 'utf8')

    expect(compose).not.toContain('COMFY_PROXY_PASSWORD_FILE')
    expect(compose).not.toMatch(/(?:^|[\\/])PASSWORD(?:["'}:]|$)/m)
  })

  it('binds the published app port to loopback without a host-side proxy target', () => {
    const compose = readFileSync(join(workspaceRoot, 'docker-compose.yml'), 'utf8')

    expect(compose).toMatch(/^\s+-\s*["']?127\.0\.0\.1:7930:7930["']?\s*$/m)
    expect(compose).not.toContain('COMFY_PROXY_TARGET_BASE')
    expect(compose).not.toContain('host.docker.internal')
  })
})
