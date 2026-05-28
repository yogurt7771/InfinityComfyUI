import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import type { ProjectState } from './domain/types'

const require = createRequire(import.meta.url)
const { hydrateProjectAssets } = require('../electron/projectAssetStorage.cjs') as {
  hydrateProjectAssets: (projectDir: string, project: ProjectState) => Promise<ProjectState>
}

const projectWithStoredAsset = (): ProjectState => ({
  schemaVersion: '1.0.0',
  project: {
    id: 'project_1',
    name: 'Demo',
    createdAt: '2026-05-08T09:00:00.000Z',
    updatedAt: '2026-05-08T09:00:00.000Z',
  },
  canvas: {
    nodes: [{ id: 'node_image', type: 'resource', position: { x: 0, y: 0 }, data: { resourceId: 'res_image' } }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  resources: {
    res_image: {
      id: 'res_image',
      type: 'image',
      name: 'cat.png',
      value: {
        assetId: 'asset_image',
        url: 'http://127.0.0.1:8188/view?filename=cat.png&type=output&subfolder=',
        filename: 'cat.png',
        mimeType: 'image/png',
        sizeBytes: 3,
      },
      source: { kind: 'function_output' },
      metadata: { createdAt: '2026-05-08T09:00:00.000Z' },
    },
  },
  assets: {
    asset_image: {
      id: 'asset_image',
      name: 'cat.png',
      mimeType: 'image/png',
      sizeBytes: 3,
      createdAt: '2026-05-08T09:00:00.000Z',
    },
  },
  functions: {},
  tasks: {},
  comfy: {
    endpoints: [],
    scheduler: { strategy: 'least_busy', retry: { maxAttempts: 1, fallbackToOtherEndpoint: true } },
  },
})

describe('Electron project asset storage', () => {
  it('hydrates desktop project asset files from the per-project assets folder', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'infinity-project-'))
    await mkdir(join(projectDir, 'config'), { recursive: true })
    await mkdir(join(projectDir, 'assets'), { recursive: true })
    await writeFile(join(projectDir, 'assets', 'asset_image.png'), Buffer.from('abc'))
    await writeFile(
      join(projectDir, 'config', 'assets.json'),
      JSON.stringify([
        {
          id: 'asset_image',
          name: 'cat.png',
          mimeType: 'image/png',
          sizeBytes: 3,
          file: 'asset_image.png',
          source: 'data_url',
        },
      ]),
    )

    const hydrated = await hydrateProjectAssets(projectDir, projectWithStoredAsset())
    const media = hydrated.resources.res_image.value

    expect(hydrated.assets.asset_image.blobUrl).toBe('data:image/png;base64,YWJj')
    expect(typeof media === 'object' && media !== null && 'url' in media ? media.url : undefined).toBe(
      'data:image/png;base64,YWJj',
    )
  })
})
