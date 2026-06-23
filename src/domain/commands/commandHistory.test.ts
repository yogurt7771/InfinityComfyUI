import { describe, expect, it } from 'vitest'
import {
  createCommandTransaction,
  emptyCommandHistory,
  pushCommandTransaction,
  redoCommandHistory,
  undoCommandHistory,
} from './commandHistory'

type TestSnapshot = {
  nodes: string[]
  resources: string[]
}

describe('commandHistory', () => {
  it('records a batch graph command as one transaction', () => {
    const before: TestSnapshot = { nodes: ['node_a', 'node_b', 'node_c'], resources: ['res_a', 'res_b', 'res_c'] }
    const after: TestSnapshot = { nodes: [], resources: [] }
    const transaction = createCommandTransaction({
      id: 'tx_1',
      type: 'canvas',
      label: 'Delete assets',
      createdAt: '2026-06-23T00:00:00.000Z',
      before,
      after,
      affectedIds: {
        nodeIds: ['node_a', 'node_b', 'node_c'],
        resourceIds: ['res_a', 'res_b', 'res_c'],
      },
      preview: {
        title: 'Delete assets',
        subtitle: '3 assets',
      },
    })

    const history = pushCommandTransaction(emptyCommandHistory<TestSnapshot>(), transaction)

    expect(history.undoStack).toHaveLength(1)
    expect(history.redoStack).toHaveLength(0)
    expect(history.undoStack[0]).toMatchObject({
      id: 'tx_1',
      type: 'canvas',
      label: 'Delete assets',
      affectedIds: {
        nodeIds: ['node_a', 'node_b', 'node_c'],
        resourceIds: ['res_a', 'res_b', 'res_c'],
      },
      preview: {
        title: 'Delete assets',
        subtitle: '3 assets',
      },
    })
  })

  it('does not record unchanged snapshots', () => {
    const snapshot: TestSnapshot = { nodes: ['node_a'], resources: ['res_a'] }
    const transaction = createCommandTransaction({
      id: 'tx_1',
      type: 'canvas',
      label: 'No-op',
      createdAt: '2026-06-23T00:00:00.000Z',
      before: snapshot,
      after: { nodes: ['node_a'], resources: ['res_a'] },
      affectedIds: {},
      preview: { title: 'No-op' },
    })

    const history = pushCommandTransaction(emptyCommandHistory<TestSnapshot>(), transaction)

    expect(transaction).toBeUndefined()
    expect(history.undoStack).toHaveLength(0)
  })

  it('moves transactions between undo and redo stacks without mutating snapshots', () => {
    const transaction = createCommandTransaction({
      id: 'tx_1',
      type: 'asset',
      label: 'Create asset',
      createdAt: '2026-06-23T00:00:00.000Z',
      before: { nodes: [], resources: [] },
      after: { nodes: ['node_a'], resources: ['res_a'] },
      affectedIds: { resourceIds: ['res_a'] },
      preview: { title: 'Create asset' },
    })
    const history = pushCommandTransaction(emptyCommandHistory<TestSnapshot>(), transaction)

    const undone = undoCommandHistory(history)
    expect(undone?.snapshot).toEqual({ nodes: [], resources: [] })
    expect(undone?.history.undoStack).toHaveLength(0)
    expect(undone?.history.redoStack).toHaveLength(1)

    const redone = redoCommandHistory(undone!.history)
    expect(redone?.snapshot).toEqual({ nodes: ['node_a'], resources: ['res_a'] })
    expect(redone?.history.undoStack).toHaveLength(1)
    expect(redone?.history.redoStack).toHaveLength(0)
  })

  it('stores compact snapshots and hydrates them when restoring', () => {
    type MediaSnapshot = {
      resources: Record<string, { assetId: string; name: string; url: string }>
      assets: Record<string, { blobUrl?: string }>
    }
    const compactSnapshot = (snapshot: MediaSnapshot): MediaSnapshot => ({
      resources: Object.fromEntries(
        Object.entries(snapshot.resources).map(([resourceId, resource]) => [resourceId, { ...resource, url: '' }]),
      ),
      assets: Object.fromEntries(
        Object.entries(snapshot.assets).map(([assetId]) => [assetId, {}]),
      ),
    })
    const hydrateSnapshot = (snapshot: MediaSnapshot): MediaSnapshot => ({
      ...snapshot,
      resources: Object.fromEntries(
        Object.entries(snapshot.resources).map(([resourceId, resource]) => [
          resourceId,
          {
            ...resource,
            url: snapshot.assets[resource.assetId]?.blobUrl ?? '',
          },
        ]),
      ),
    })
    const before: MediaSnapshot = {
      resources: { res_a: { assetId: 'asset_a', name: 'Before', url: 'data:image/png;base64,before' } },
      assets: { asset_a: { blobUrl: 'data:image/png;base64,before' } },
    }
    const after: MediaSnapshot = {
      resources: { res_a: { assetId: 'asset_a', name: 'After', url: 'data:image/png;base64,after' } },
      assets: { asset_a: { blobUrl: 'data:image/png;base64,after' } },
    }

    const transaction = createCommandTransaction({
      id: 'tx_1',
      type: 'asset',
      label: 'Update asset',
      createdAt: '2026-06-23T00:00:00.000Z',
      before,
      after,
      affectedIds: { resourceIds: ['res_a'] },
      preview: { title: 'Update asset' },
      compactSnapshot,
    })
    const history = pushCommandTransaction(emptyCommandHistory<MediaSnapshot>(), transaction)

    expect(history.undoStack[0].before.resources.res_a.url).toBe('')
    expect(history.undoStack[0].before.assets.asset_a.blobUrl).toBeUndefined()

    const restored = undoCommandHistory(history, (snapshot) =>
      hydrateSnapshot({
        ...snapshot,
        assets: { asset_a: { blobUrl: 'data:image/png;base64,before' } },
      }),
    )

    expect(restored?.snapshot.resources.res_a.url).toBe('data:image/png;base64,before')
  })
})
