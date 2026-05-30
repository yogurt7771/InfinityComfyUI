import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
// @ts-expect-error export-dist is a Node ESM script exercised directly by this test.
import { writeReleaseStartScripts } from '../scripts/export-dist.mjs'

function runPowerShell(script: string, cwd: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

describe('Docker release startup scripts', () => {
  it('passes dashed docker arguments through PowerShell wrappers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'infinity-release-'))
    try {
      mkdirSync(join(dir, 'images'))
      writeReleaseStartScripts(dir)
      writeFileSync(join(dir, '.env'), 'INFINITY_COMFYUI_PORT=7930\n', 'utf8')
      writeFileSync(join(dir, 'docker-compose.yaml'), 'services: {}\n', 'utf8')
      writeFileSync(join(dir, 'images', 'image.tar'), 'stub', 'utf8')
      writeFileSync(
        join(dir, 'docker.cmd'),
        `@echo off
echo %*>>"%~dp0docker-args.log"
exit /b 0
`,
        'utf8',
      )

      const result = runPowerShell(join(dir, 'start.ps1'), dir, { PATH: `${dir};${process.env.PATH}` })

      expect(result.status).toBe(0)
      const log = readFileSync(join(dir, 'docker-args.log'), 'utf8')
      expect(log).toContain('load -i')
      expect(log).toContain('compose --env-file')
      expect(log).toContain('-f')
      expect(log).toContain('up -d')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns nonzero when Docker fails in generated PowerShell scripts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'infinity-release-fail-'))
    try {
      mkdirSync(join(dir, 'images'))
      writeReleaseStartScripts(dir)
      writeFileSync(join(dir, 'images', 'image.tar'), 'stub', 'utf8')
      writeFileSync(
        join(dir, 'docker.cmd'),
        `@echo off
echo %*>>"%~dp0docker-args.log"
exit /b 42
`,
        'utf8',
      )

      const result = runPowerShell(join(dir, 'load-images.ps1'), dir, { PATH: `${dir};${process.env.PATH}` })

      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toContain('failed with exit code 42')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
