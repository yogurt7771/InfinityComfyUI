import { describe, expect, it } from 'vitest'
import { createAssetLineageEdge, type AssetGraphNode } from '../assetGraph'
import type { Resource } from '../types'
import { instantiateAssetTemplateCommand, saveAssetTemplateCommand, type TemplateCommandProject } from './templateCommands'

const now = '2026-06-23T00:00:00.000Z'

const assetNode = (id: string, resourceId: string, x: number, y: number): AssetGraphNode => ({
  id,
  type: 'asset',
  position: { x, y },
  size: { width: 180, height: 140 },
  data: { resourceId },
})

const resource = (id: string, value: string): Resource => ({
  id,
  type: 'text',
  name: id,
  value,
  source: { kind: 'manual_input' },
  metadata: { createdAt: now },
})

const project = (): TemplateCommandProject => ({
  canvas: {
    nodes: [assetNode('node_a', 'res_a', 100, 120), assetNode('node_b', 'res_b', 340, 120)],
    edges: [
      createAssetLineageEdge({
        runId: 'run_1',
        inputKey: 'prompt',
        sourceResourceId: 'res_a',
        targetResourceId: 'res_b',
      }),
    ],
  },
  resources: {
    res_a: resource('res_a', 'first'),
    res_b: resource('res_b', 'second'),
  },
  assets: {},
  templates: {},
})

describe('templateCommands', () => {
  it('saves selected asset subgraph resources and lineage as one template transaction', () => {
    const result = saveAssetTemplateCommand(project(), {
      nodeIds: ['node_a', 'node_b'],
      templateId: 'template_1',
      name: 'Prompt Pair',
      now,
      transactionId: 'tx_template',
    })

    expect(result.project.templates.template_1).toMatchObject({
      id: 'template_1',
      name: 'Prompt Pair',
      inputResourceIds: ['res_a', 'res_b'],
      outputResourceIds: ['res_a', 'res_b'],
    })
    expect(result.project.templates.template_1.nodes.map((node) => node.id)).toEqual(['node_a', 'node_b'])
    expect(result.project.templates.template_1.edges).toHaveLength(1)
    expect(result.transaction).toMatchObject({
      id: 'tx_template',
      type: 'template',
      label: 'Save template',
      affectedIds: {
        templateIds: ['template_1'],
        resourceIds: ['res_a', 'res_b'],
        nodeIds: ['node_a', 'node_b'],
      },
    })
  })

  it('instantiates a template as cloned assets inside a new group', () => {
    const saved = saveAssetTemplateCommand(project(), {
      nodeIds: ['node_a', 'node_b'],
      templateId: 'template_1',
      name: 'Prompt Pair',
      now,
      transactionId: 'tx_template',
    }).project
    const ids = ['res_c', 'res_d', 'group_1']

    const result = instantiateAssetTemplateCommand(saved, {
      templateId: 'template_1',
      position: { x: 600, y: 300 },
      idFactory: () => ids.shift() ?? 'fallback',
      now,
      transactionId: 'tx_instance',
    })

    expect(result.groupNodeId).toBe('group_1')
    expect(result.project.resources.res_c).toMatchObject({
      name: 'res_a Copy',
      value: 'first',
      source: { kind: 'duplicated', parentResourceId: 'res_a' },
    })
    expect(result.project.canvas.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'node_res_c', type: 'asset', position: { x: 600, y: 300 } }),
        expect.objectContaining({ id: 'node_res_d', type: 'asset', position: { x: 840, y: 300 } }),
        expect.objectContaining({
          id: 'group_1',
          type: 'group',
          data: expect.objectContaining({ title: 'Prompt Pair', childNodeIds: ['node_res_c', 'node_res_d'] }),
        }),
      ]),
    )
    expect(result.transaction).toMatchObject({
      id: 'tx_instance',
      type: 'template',
      label: 'Create template instance',
      affectedIds: {
        templateIds: ['template_1'],
        resourceIds: ['res_c', 'res_d'],
        groupIds: ['group_1'],
      },
    })
  })
})
