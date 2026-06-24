import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowPath = resolve(__dirname, '..', '.github', 'workflows', 'release.yml')
const packageJsonPath = resolve(__dirname, '..', 'package.json')

describe('GitHub release workflow', () => {
  it('builds Windows release artifacts when a version tag is pushed', () => {
    expect(existsSync(workflowPath)).toBe(true)

    const workflow = readFileSync(workflowPath, 'utf8')

    expect(workflow).toMatch(/on:\s*\n\s*push:\s*\n\s*tags:/)
    expect(workflow).toMatch(/-\s+['"]v\*['"]/)
    expect(workflow).toMatch(/runs-on:\s+windows-latest/)
    expect(workflow).toContain('npm ci')
    expect(workflow).toContain('npm run build && npx electron-builder --win --publish never')
    expect(workflow).toContain('softprops/action-gh-release')
    expect(workflow).toMatch(/release\/\*\.exe/)
  })

  it('configures electron-builder to create both portable and installer executables', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>
      build?: { win?: { target?: string[] } }
    }

    expect(packageJson.scripts?.['package:win']).toContain('electron-builder --win')
    expect(packageJson.build?.win?.target).toEqual(expect.arrayContaining(['portable', 'nsis']))
  })
})
