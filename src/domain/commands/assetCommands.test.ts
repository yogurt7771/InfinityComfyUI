import { describe, expect, it } from 'vitest'
import { createAssetLineageEdge, type AssetGraphAssetNode } from '../assetGraph'
import type { Resource } from '../types'
import {
  createAssetNodeCommand,
  deleteAssetNodesCommand,
  moveAssetNodesCommand,
  resizeAssetNodeCommand,
  updateAssetResourceCommand,
  type AssetCommandProject,
} from './assetCommands'

const textResource = (id: string, value: string): Resource => ({
  id,
  type: 'text',
  name: id,
  value,
  source: { kind: 'manual_input' },
  metadata: { createdAt: '2026-06-23T00:00:00.000Z' },
})

const assetNode = (id: string, resourceId: string, x: number): AssetGraphAssetNode => ({
  id,
  type: 'asset',
  position: { x, y: 0 },
  data: { resourceId },
})

const project = (): AssetCommandProject => ({
  canvas: {
    nodes: [assetNode('node_a', 'res_a', 0), assetNode('node_b', 'res_b', 200), assetNode('node_c', 'res_c', 400)],
    edges: [
      createAssetLineageEdge({
        runId: 'run_1',
        inputKey: 'image',
        sourceResourceId: 'res_a',
        targetResourceId: 'res_c',
      }),
      createAssetLineageEdge({
        runId: 'run_2',
        inputKey: 'image',
        sourceResourceId: 'res_b',
        targetResourceId: 'res_c',
      }),
    ],
  },
  resources: {
    res_a: textResource('res_a', 'A'),
    res_b: textResource('res_b', 'B'),
    res_c: textResource('res_c', 'C'),
  },
  assets: {},
})

describe('assetCommands', () => {
  it('creates an asset resource and canvas node with one transaction', () => {
    const result = createAssetNodeCommand(project(), {
      now: '2026-06-23T00:00:00.000Z',
      transactionId: 'tx_1',
      node: assetNode('node_d', 'res_d', 600),
      resource: textResource('res_d', 'D'),
    })

    expect(result.project.canvas.nodes.map((node) => node.id)).toEqual(['node_a', 'node_b', 'node_c', 'node_d'])
    expect(result.project.resources.res_d.value).toBe('D')
    expect(result.transaction).toMatchObject({
      id: 'tx_1',
      type: 'asset',
      label: 'Create asset',
      affectedIds: {
        nodeIds: ['node_d'],
        resourceIds: ['res_d'],
      },
      preview: {
        title: 'Create asset',
        assetIds: [],
        resourceIds: ['res_d'],
        nodeIds: ['node_d'],
      },
    })
  })

  it('deletes multiple asset nodes and touching lineage edges with one transaction', () => {
    const result = deleteAssetNodesCommand(project(), {
      now: '2026-06-23T00:00:00.000Z',
      transactionId: 'tx_1',
      nodeIds: ['node_a', 'node_b'],
    })

    expect(result.project.canvas.nodes.map((node) => node.id)).toEqual(['node_c'])
    expect(result.project.canvas.edges).toEqual([])
    expect(result.project.resources).not.toHaveProperty('res_a')
    expect(result.project.resources).not.toHaveProperty('res_b')
    expect(result.project.resources).toHaveProperty('res_c')
    expect(result.transaction).toMatchObject({
      id: 'tx_1',
      type: 'asset',
      label: 'Delete assets',
      affectedIds: {
        nodeIds: ['node_a', 'node_b'],
        resourceIds: ['res_a', 'res_b'],
      },
      preview: {
        title: 'Delete assets',
        subtitle: '2 assets',
      },
    })
  })

  it('updates an asset resource with one transaction', () => {
    const result = updateAssetResourceCommand(project(), {
      now: '2026-06-23T00:00:00.000Z',
      transactionId: 'tx_1',
      resource: textResource('res_a', 'Updated'),
    })

    expect(result.project.resources.res_a.value).toBe('Updated')
    expect(result.transaction).toMatchObject({
      id: 'tx_1',
      type: 'asset',
      label: 'Update asset',
      affectedIds: {
        nodeIds: ['node_a'],
        resourceIds: ['res_a'],
      },
      preview: {
        title: 'Update asset',
        resourceIds: ['res_a'],
        nodeIds: ['node_a'],
      },
    })
  })

  it('moves multiple asset nodes with one transaction', () => {
    const result = moveAssetNodesCommand(project(), {
      now: '2026-06-23T00:00:00.000Z',
      transactionId: 'tx_1',
      positionsByNodeId: {
        node_a: { x: 50, y: 25 },
        node_b: { x: 250, y: 25 },
      },
    })

    expect(result.project.canvas.nodes.find((node) => node.id === 'node_a')?.position).toEqual({ x: 50, y: 25 })
    expect(result.project.canvas.nodes.find((node) => node.id === 'node_b')?.position).toEqual({ x: 250, y: 25 })
    expect(result.transaction).toMatchObject({
      id: 'tx_1',
      type: 'canvas',
      label: 'Move assets',
      affectedIds: {
        nodeIds: ['node_a', 'node_b'],
        resourceIds: ['res_a', 'res_b'],
      },
      preview: {
        title: 'Move assets',
        subtitle: '2 assets',
      },
    })
  })

  it('resizes an asset node with one transaction', () => {
    const result = resizeAssetNodeCommand(project(), {
      now: '2026-06-23T00:00:00.000Z',
      transactionId: 'tx_1',
      nodeId: 'node_a',
      size: { width: 320, height: 240 },
    })

    expect(result.project.canvas.nodes.find((node) => node.id === 'node_a')?.size).toEqual({ width: 320, height: 240 })
    expect(result.transaction).toMatchObject({
      id: 'tx_1',
      type: 'canvas',
      label: 'Resize asset',
      affectedIds: {
        nodeIds: ['node_a'],
        resourceIds: ['res_a'],
      },
      preview: {
        title: 'Resize asset',
      },
    })
  })
})
