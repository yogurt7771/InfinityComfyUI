import { describe, expect, it } from 'vitest'
import type { ProjectState } from '../../domain/types'
import { assetCanvasNodeTypes, projectToAssetGraph, selectedResourcesForAssetNodes } from './CanvasWorkspace'

const project = (): ProjectState => ({
  schemaVersion: '1.0.0',
  project: {
    id: 'project_test',
    name: 'Canvas Test',
    createdAt: '2026-06-23T00:00:00.000Z',
    updatedAt: '2026-06-23T00:00:00.000Z',
  },
  canvas: {
    nodes: [
      { id: 'node_prompt', type: 'resource', position: { x: 0, y: 0 }, data: { resourceId: 'res_prompt' } },
      { id: 'node_output', type: 'resource', position: { x: 360, y: 0 }, data: { resourceId: 'res_output' } },
      { id: 'node_fn', type: 'function', position: { x: 180, y: 0 }, data: { functionId: 'fn_edit' } },
      { id: 'node_result', type: 'result_group', position: { x: 520, y: 0 }, data: { taskId: 'task_1' } },
      {
        id: 'group_1',
        type: 'group',
        position: { x: -40, y: -40 },
        data: { title: 'Batch', childNodeIds: ['node_prompt', 'node_fn', 'node_output'] },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  resources: {
    res_prompt: {
      id: 'res_prompt',
      type: 'text',
      name: 'Prompt',
      value: 'make it brighter',
      source: { kind: 'manual_input' },
      metadata: { createdAt: '2026-06-23T00:00:00.000Z' },
    },
    res_output: {
      id: 'res_output',
      type: 'image',
      name: 'Output',
      value: {
        assetId: 'asset_output',
        url: '/output.png',
        filename: 'output.png',
        mimeType: 'image/png',
        sizeBytes: 1,
      },
      source: { kind: 'function_output', runId: 'run_1', outputKey: 'image' },
      metadata: { createdAt: '2026-06-23T00:00:00.000Z' },
    },
  },
  assets: {},
  functions: {},
  runs: {},
  tasks: {
    task_1: {
      id: 'task_1',
      functionNodeId: 'node_fn',
      functionId: 'fn_edit',
      runIndex: 1,
      runTotal: 1,
      status: 'succeeded',
      inputRefs: { prompt: { resourceId: 'res_prompt', type: 'text' } },
      inputSnapshot: {},
      inputValuesSnapshot: {},
      paramsSnapshot: {},
      workflowTemplateSnapshot: {},
      compiledWorkflowSnapshot: {},
      seedPatchLog: [],
      outputRefs: { image: [{ resourceId: 'res_output', type: 'image' }] },
      createdAt: '2026-06-23T00:00:00.000Z',
      updatedAt: '2026-06-23T00:00:00.000Z',
    },
  },
  comfy: {
    endpoints: [],
    scheduler: { strategy: 'least_busy', retry: { maxAttempts: 1, fallbackToOtherEndpoint: true } },
  },
})

describe('asset canvas workspace', () => {
  it('registers only asset and group node views', () => {
    expect(Object.keys(assetCanvasNodeTypes)).toEqual(['asset', 'group'])
    expect(assetCanvasNodeTypes).not.toHaveProperty('function')
    expect(assetCanvasNodeTypes).not.toHaveProperty('result_group')
  })

  it('projects legacy project state into an asset/group-only graph', () => {
    const graph = projectToAssetGraph(project())

    expect(graph.nodes.map((node) => [node.id, node.type])).toEqual([
      ['node_prompt', 'asset'],
      ['node_output', 'asset'],
      ['group_1', 'group'],
    ])
    expect(graph.nodes.find((node) => node.id === 'group_1')).toMatchObject({
      type: 'group',
      data: {
        childNodeIds: ['node_prompt', 'node_output'],
      },
    })
    expect(graph.edges).toEqual([
      {
        id: 'lineage:run_1:prompt:res_prompt:res_output',
        runId: 'run_1',
        inputKey: 'prompt',
        sourceResourceId: 'res_prompt',
        targetResourceId: 'res_output',
      },
    ])
  })

  it('uses selected asset nodes as function command input candidates', () => {
    const sourceProject = project()

    expect(
      selectedResourcesForAssetNodes(sourceProject, [
        { type: 'asset', data: { resourceId: 'res_prompt' } },
        { type: 'group', data: {} },
        { type: 'asset', data: { resourceId: 'missing_resource' } },
      ]).map((resource) => resource.id),
    ).toEqual(['res_prompt'])
  })
})
