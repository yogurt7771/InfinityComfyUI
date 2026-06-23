import { describe, expect, it } from 'vitest'
import { assetGraphNodeKinds, createAssetLineageEdge, isAssetGraphNode } from './assetGraph'

describe('assetGraph', () => {
  it('allows only asset and group canvas node kinds', () => {
    expect(assetGraphNodeKinds).toEqual(['asset', 'group'])
    expect(
      isAssetGraphNode({
        id: 'node_asset',
        type: 'asset',
        position: { x: 0, y: 0 },
        data: { resourceId: 'res_1' },
      }),
    ).toBe(true)
    expect(
      isAssetGraphNode({
        id: 'node_group',
        type: 'group',
        position: { x: 0, y: 0 },
        size: { width: 200, height: 120 },
        data: { title: 'Group', childNodeIds: [] },
      }),
    ).toBe(true)
    expect(isAssetGraphNode({ id: 'node_fn', type: 'function', position: { x: 0, y: 0 }, data: {} })).toBe(false)
    expect(isAssetGraphNode({ id: 'node_result', type: 'result_group', position: { x: 0, y: 0 }, data: {} })).toBe(false)
  })

  it('creates deterministic asset lineage edges between resources', () => {
    expect(
      createAssetLineageEdge({
        runId: 'run_1',
        inputKey: 'image',
        sourceResourceId: 'res_input',
        targetResourceId: 'res_output',
      }),
    ).toEqual({
      id: 'lineage:run_1:image:res_input:res_output',
      runId: 'run_1',
      inputKey: 'image',
      sourceResourceId: 'res_input',
      targetResourceId: 'res_output',
    })
  })
})
