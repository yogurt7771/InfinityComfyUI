import { describe, expect, it } from 'vitest'
import {
  collectProjectAssetFiles,
  hydrateProjectAssetFiles,
  type ProjectAssetFileManifestEntry,
} from './projectAssets'
import type { ProjectState } from './types'

const mediaProject = (): ProjectState => ({
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
        url: 'data:image/png;base64,YWJj',
        filename: 'cat.png',
        mimeType: 'image/png',
        sizeBytes: 3,
      },
      source: { kind: 'manual_input' },
      metadata: { createdAt: '2026-05-08T09:00:00.000Z' },
    },
  },
  assets: {
    asset_image: {
      id: 'asset_image',
      name: 'cat.png',
      mimeType: 'image/png',
      sizeBytes: 3,
      blobUrl: 'data:image/png;base64,YWJj',
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

describe('project asset files', () => {
  it('collects project media assets as package files for full exports', async () => {
    const collected = await collectProjectAssetFiles(mediaProject())

    expect(collected.manifest).toEqual([
      {
        id: 'asset_image',
        resourceId: 'res_image',
        name: 'cat.png',
        mimeType: 'image/png',
        sizeBytes: 3,
        file: 'assets/asset_image.png',
        source: 'embedded',
      },
    ])
    expect(collected.files).toHaveLength(1)
    expect(collected.files[0]).toMatchObject({ path: 'assets/asset_image.png', assetId: 'asset_image' })
    expect(await collected.files[0]!.blob.text()).toBe('abc')
  })

  it('hydrates imported asset files back into project assets and media resources', async () => {
    const project = mediaProject()
    project.assets.asset_image = {
      ...project.assets.asset_image,
      blobUrl: undefined,
    }
    project.resources.res_image.value = {
      ...(project.resources.res_image.value as object),
      url: 'http://127.0.0.1:8188/view?filename=cat.png&type=output&subfolder=',
    } as ProjectState['resources'][string]['value']
    const manifest: ProjectAssetFileManifestEntry[] = [
      {
        id: 'asset_image',
        name: 'cat.png',
        mimeType: 'image/png',
        sizeBytes: 3,
        file: 'assets/asset_image.png',
        source: 'embedded',
      },
    ]

    const hydrated = await hydrateProjectAssetFiles(project, manifest, async () => new Blob(['abc'], { type: 'image/png' }))
    const media = hydrated.resources.res_image.value

    expect(hydrated.assets.asset_image.blobUrl).toBe('data:image/png;base64,YWJj')
    expect(typeof media === 'object' && media !== null && 'url' in media ? media.url : undefined).toBe(
      'data:image/png;base64,YWJj',
    )
  })
})
