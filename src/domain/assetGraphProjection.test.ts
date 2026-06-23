import { MarkerType } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { createAssetLineageEdge, type AssetGraphNode } from './assetGraph'
import { buildAssetGraphProjection } from './assetGraphProjection'

const nodes: AssetGraphNode[] = [
  {
    id: 'node_prompt',
    type: 'asset',
    position: { x: 0, y: 0 },
    data: { resourceId: 'res_prompt', title: 'Prompt' },
  },
  {
    id: 'node_image',
    type: 'asset',
    position: { x: 320, y: 0 },
    size: { width: 280, height: 220 },
    data: { resourceId: 'res_image', title: 'Image' },
  },
  {
    id: 'group_1',
    type: 'group',
    position: { x: -40, y: -40 },
    size: { width: 720, height: 360 },
    data: { title: 'Group', childNodeIds: ['node_prompt', 'node_image'] },
  },
]

describe('assetGraphProjection', () => {
  it('projects only asset and group React Flow node types', () => {
    const projection = buildAssetGraphProjection({
      nodes,
      edges: [],
    })

    expect(projection.nodes.map((node) => node.type)).toEqual(['asset', 'asset', 'group'])
    expect(projection.nodes.map((node) => node.type)).not.toContain('function')
    expect(projection.nodes.map((node) => node.type)).not.toContain('result_group')
  })

  it('projects asset lineage edges with hidden technical handles', () => {
    const projection = buildAssetGraphProjection({
      nodes,
      edges: [
        createAssetLineageEdge({
          runId: 'run_1',
          inputKey: 'prompt',
          sourceResourceId: 'res_prompt',
          targetResourceId: 'res_image',
        }),
      ],
    })

    expect(projection.nodes[0]).toMatchObject({
      id: 'node_prompt',
      type: 'asset',
      position: { x: 0, y: 0 },
      data: {
        resourceId: 'res_prompt',
        title: 'Prompt',
        handles: {
          source: 'asset-source:res_prompt',
          target: 'asset-target:res_prompt',
        },
      },
    })
    expect(projection.nodes[1]).toMatchObject({
      id: 'node_image',
      style: { width: 280, height: 220 },
    })
    expect(projection.edges).toEqual([
      expect.objectContaining({
        id: 'lineage:run_1:prompt:res_prompt:res_image',
        source: 'node_prompt',
        sourceHandle: 'asset-source:res_prompt',
        target: 'node_image',
        targetHandle: 'asset-target:res_image',
        label: 'prompt',
        className: 'asset-lineage-edge',
        markerEnd: expect.objectContaining({ type: MarkerType.ArrowClosed }),
      }),
    ])
  })

  it('skips lineage edges whose asset endpoints are not visible nodes', () => {
    const projection = buildAssetGraphProjection({
      nodes,
      edges: [
        createAssetLineageEdge({
          runId: 'run_missing',
          inputKey: 'image',
          sourceResourceId: 'res_missing',
          targetResourceId: 'res_image',
        }),
      ],
    })

    expect(projection.edges).toEqual([])
  })
})
