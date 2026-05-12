import { describe, expect, it } from 'vitest'
import { MarkerType } from '@xyflow/react'
import { buildCanvasFlowEdges } from './canvasEdges'
import type { ProjectState } from './types'

const project = (): ProjectState => ({
  schemaVersion: '1.0.0',
  project: {
    id: 'project_1',
    name: 'Demo',
    createdAt: '2026-05-08T09:00:00.000Z',
    updatedAt: '2026-05-08T09:00:00.000Z',
  },
  canvas: {
    nodes: [
      { id: 'node_prompt', type: 'resource', position: { x: 0, y: 0 }, data: { resourceId: 'res_prompt' } },
      { id: 'node_image', type: 'resource', position: { x: 0, y: 160 }, data: { resourceId: 'res_image' } },
      {
        id: 'node_text_fn',
        type: 'function',
        position: { x: 400, y: 0 },
        data: {
          functionId: 'fn_text',
          inputValues: {
            prompt: { resourceId: 'res_prompt', type: 'text' },
          },
        },
      },
      {
        id: 'node_edit_fn',
        type: 'function',
        position: { x: 400, y: 160 },
        data: {
          functionId: 'fn_edit',
          inputValues: {
            prompt: { resourceId: 'res_prompt', type: 'text' },
            image: { resourceId: 'res_image', type: 'image' },
          },
        },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  resources: {},
  assets: {},
  functions: {},
  tasks: {},
  comfy: {
    endpoints: [],
    scheduler: { strategy: 'least_busy', retry: { maxAttempts: 1, fallbackToOtherEndpoint: true } },
  },
})

describe('buildCanvasFlowEdges', () => {
  it('renders resource input bindings as visible resource-to-function edges', () => {
    expect(buildCanvasFlowEdges(project()).filter((edge) => edge.className === 'input-edge')).toMatchObject([
      {
        id: 'input:node_prompt:node_text_fn:prompt',
        source: 'node_prompt',
        sourceHandle: 'resource:res_prompt',
        target: 'node_text_fn',
        targetHandle: 'input:prompt',
        label: 'prompt',
        type: 'default',
      },
      {
        id: 'input:node_prompt:node_edit_fn:prompt',
        source: 'node_prompt',
        sourceHandle: 'resource:res_prompt',
        target: 'node_edit_fn',
        targetHandle: 'input:prompt',
        label: 'prompt',
        type: 'default',
      },
      {
        id: 'input:node_image:node_edit_fn:image',
        source: 'node_image',
        sourceHandle: 'resource:res_image',
        target: 'node_edit_fn',
        targetHandle: 'input:image',
        label: 'image',
        type: 'default',
      },
    ])
  })

  it('adds arrow markers so every canvas connection has a visible direction', () => {
    expect(buildCanvasFlowEdges(project())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          markerEnd: expect.objectContaining({ type: MarkerType.ArrowClosed }),
        }),
      ]),
    )
  })

  it('does not duplicate an explicit edge for the same function input', () => {
    const state = project()
    state.canvas.edges = [
      {
        id: 'edge_prompt_text',
        source: { nodeId: 'node_prompt', handleId: 'out', resourceId: 'res_prompt' },
        target: { nodeId: 'node_text_fn', inputKey: 'prompt' },
        type: 'resource_to_input',
      },
    ]

    expect(
      buildCanvasFlowEdges(state).filter((edge) => edge.target === 'node_text_fn' && edge.label === 'prompt'),
    ).toHaveLength(1)
  })

  it('uses result groups as sources when their output resources feed another function', () => {
    const state = project()
    state.canvas.nodes = [
      {
        id: 'node_source_fn',
        type: 'function',
        position: { x: 0, y: 0 },
        data: {},
      },
      {
        id: 'node_result',
        type: 'result_group',
        position: { x: 320, y: 0 },
        data: {
          sourceFunctionNodeId: 'node_source_fn',
          resources: [{ resourceId: 'res_image', type: 'image' }],
        },
      },
      {
        id: 'node_edit_fn',
        type: 'function',
        position: { x: 640, y: 0 },
        data: {
          inputValues: {
            image: { resourceId: 'res_image', type: 'image' },
          },
        },
      },
    ]

    expect(buildCanvasFlowEdges(state)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'input:node_result:node_edit_fn:image',
          source: 'node_result',
          sourceHandle: 'result:res_image',
          target: 'node_edit_fn',
          targetHandle: 'input:image',
          className: 'input-edge',
        }),
      ]),
    )
  })

  it('connects function result edges from the declared function output slot', () => {
    const state = project()
    state.functions = {
      fn_text: {
        id: 'fn_text',
        name: 'Flux Render',
        category: 'Render',
        workflow: { format: 'comfyui_api_json', rawJson: {} },
        inputs: [],
        outputs: [
          {
            key: 'image',
            label: 'Image',
            type: 'image',
            bind: { nodeId: '20', nodeTitle: 'Result_Image' },
            extract: { source: 'history', multiple: true },
          },
        ],
        createdAt: '2026-05-09T00:00:00.000Z',
        updatedAt: '2026-05-09T00:00:00.000Z',
      },
    }
    state.canvas.nodes = [
      {
        id: 'node_text_fn',
        type: 'function',
        position: { x: 0, y: 0 },
        data: { functionId: 'fn_text' },
      },
      {
        id: 'node_result',
        type: 'result_group',
        position: { x: 320, y: 0 },
        data: {
          sourceFunctionNodeId: 'node_text_fn',
          resources: [{ resourceId: 'res_image', type: 'image' }],
        },
      },
    ]
    state.resources = {
      res_image: {
        id: 'res_image',
        type: 'image',
        name: 'render.png',
        value: {
          assetId: 'asset_image',
          url: 'http://127.0.0.1:27707/view?filename=render.png&type=output',
          filename: 'render.png',
          mimeType: 'image/png',
          sizeBytes: 100,
        },
        source: { kind: 'function_output', outputKey: 'image' },
      },
    }

    expect(buildCanvasFlowEdges(state)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'node_text_fn-node_result',
          source: 'node_text_fn',
          sourceHandle: 'output:image',
          target: 'node_result',
          targetHandle: 'result-input',
          className: 'result-edge',
        }),
      ]),
    )
  })
})
