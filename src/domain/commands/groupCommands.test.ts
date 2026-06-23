import { describe, expect, it } from 'vitest'
import type { AssetGraphNode } from '../assetGraph'
import { groupAssetNodesCommand, ungroupAssetNodeCommand, type GroupCommandProject } from './groupCommands'

const now = '2026-06-23T00:00:00.000Z'

const assetNode = (id: string, resourceId: string, x: number, y: number): AssetGraphNode => ({
  id,
  type: 'asset',
  position: { x, y },
  size: { width: 180, height: 140 },
  data: { resourceId },
})

const project = (): GroupCommandProject => ({
  canvas: {
    nodes: [assetNode('node_a', 'res_a', 100, 120), assetNode('node_b', 'res_b', 340, 140)],
    edges: [],
  },
})

describe('groupCommands', () => {
  it('groups selected asset nodes into one group transaction', () => {
    const result = groupAssetNodesCommand(project(), {
      nodeIds: ['node_a', 'node_b'],
      groupId: 'group_1',
      title: 'Pair',
      now,
      transactionId: 'tx_group',
    })

    expect(result.project.canvas.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'group_1',
          type: 'group',
          position: { x: 76, y: 96 },
          data: expect.objectContaining({
            title: 'Pair',
            childNodeIds: ['node_a', 'node_b'],
          }),
        }),
      ]),
    )
    expect(result.transaction).toMatchObject({
      id: 'tx_group',
      type: 'group',
      label: 'Group assets',
      affectedIds: {
        nodeIds: ['group_1', 'node_a', 'node_b'],
        resourceIds: ['res_a', 'res_b'],
        groupIds: ['group_1'],
      },
    })
  })

  it('ungroups one group without deleting child asset nodes', () => {
    const grouped = groupAssetNodesCommand(project(), {
      nodeIds: ['node_a', 'node_b'],
      groupId: 'group_1',
      title: 'Pair',
      now,
      transactionId: 'tx_group',
    }).project

    const result = ungroupAssetNodeCommand(grouped, {
      groupNodeId: 'group_1',
      now,
      transactionId: 'tx_ungroup',
    })

    expect(result.project.canvas.nodes.map((node) => node.id)).toEqual(['node_a', 'node_b'])
    expect(result.transaction).toMatchObject({
      id: 'tx_ungroup',
      type: 'group',
      label: 'Ungroup assets',
      affectedIds: {
        nodeIds: ['group_1', 'node_a', 'node_b'],
        groupIds: ['group_1'],
      },
    })
  })
})
