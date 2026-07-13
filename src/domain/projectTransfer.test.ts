import { describe, expect, it, vi } from 'vitest'
import { createConfigPackage, type FullProjectPackage } from './projectPackage'
import { downloadConfigPackage, downloadProjectPackage } from './projectTransfer'
import type { ProjectState } from './types'

const exportedAt = '2026-05-08T09:00:00.000Z'

const scheduler = {
  strategy: 'least_busy',
  retry: { maxAttempts: 1, fallbackToOtherEndpoint: true },
} satisfies ProjectState['comfy']['scheduler']

const projectState = (name: string): ProjectState => ({
  schemaVersion: '1.0.0',
  project: {
    id: 'project_1',
    name,
    createdAt: exportedAt,
    updatedAt: exportedAt,
  },
  canvas: {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  resources: {},
  assets: {},
  functions: {},
  tasks: {},
  comfy: {
    endpoints: [],
    scheduler,
  },
})

const projectPackage = (name: string): FullProjectPackage => ({
  manifest: {
    kind: 'aicanvas_project',
    exportedAt,
    schemaVersion: '1.0.0',
  },
  project: projectState(name),
})

const configPackage = (projectName: string) => createConfigPackage(projectState(projectName), exportedAt)

const unsafeFilenamePunctuation = /[<>:"/\\|?*#%&]/
const containsControlCharacter = (value: string) =>
  Array.from(value).some((character) => character.charCodeAt(0) <= 31)
const containsUnsafeFilenameCharacter = (value: string) =>
  unsafeFilenamePunctuation.test(value) || containsControlCharacter(value)

const captureDownloadFilename = async (download: () => Promise<void>) => {
  const createObjectUrl = URL.createObjectURL
  const revokeObjectUrl = URL.revokeObjectURL
  URL.createObjectURL = vi.fn(() => 'blob:test-package') as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL

  let filename: string | undefined
  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    filename = this.download
  })

  try {
    await download()
    return filename
  } finally {
    URL.createObjectURL = createObjectUrl
    URL.revokeObjectURL = revokeObjectUrl
    clickSpy.mockRestore()
  }
}

describe('project transfer downloads', () => {
  it('names project package downloads from the sanitized project name and keeps the project extension', async () => {
    const filename = await captureDownloadFilename(() => downloadProjectPackage(projectPackage('Client: Mood/Board? #1%')))

    expect(filename).toBeDefined()
    expect(filename).not.toBe('project.aicanvas')
    expect(filename).toMatch(/\.aicanvas$/)
    expect(filename).toContain('Client')
    expect(filename).toContain('Mood')
    expect(filename).toContain('Board')
    expect(containsUnsafeFilenameCharacter(filename ?? '')).toBe(false)
  })

  it('names config package downloads from the sanitized project name and keeps the config extension', async () => {
    const filename = await captureDownloadFilename(() => downloadConfigPackage(configPackage('Client: Mood/Board? #1%')))

    expect(filename).toBeDefined()
    expect(filename).not.toBe('config.aicanvas-config')
    expect(filename).toMatch(/\.aicanvas-config$/)
    expect(filename).toContain('Client')
    expect(filename).toContain('Mood')
    expect(filename).toContain('Board')
    expect(containsUnsafeFilenameCharacter(filename ?? '')).toBe(false)
  })

  it('uses stable fallback names when project names are blank', async () => {
    const projectFilename = await captureDownloadFilename(() => downloadProjectPackage(projectPackage('   ')))
    const configFilename = await captureDownloadFilename(() => downloadConfigPackage(configPackage('')))

    expect(projectFilename).toBeDefined()
    expect(configFilename).toBeDefined()
    expect(projectFilename).toMatch(/^[^<>:"/\\|?*#%&]+\.aicanvas$/)
    expect(configFilename).toMatch(/^[^<>:"/\\|?*#%&]+\.aicanvas-config$/)
    expect(containsControlCharacter(projectFilename ?? '')).toBe(false)
    expect(containsControlCharacter(configFilename ?? '')).toBe(false)
  })
})
