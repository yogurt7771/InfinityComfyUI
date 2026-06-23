import { describe, expect, it } from 'vitest'
import { targetInputInitialResourceValue } from '../domain/inputInitialValue'
import { buildNodeReferenceMap } from '../domain/nodeReferences'
import type { ProjectState } from '../domain/types'
import {
  buildComfyMinimapLayout,
  flowNodeStyle,
  buildFunctionRunInputDraft,
  functionRunFloatingMenuReset,
  pickableResourceRefsForInput,
  visibleCanvasNodes,
  minimapPointToFlowPosition,
  sameFlowEdgesForSync,
} from './CanvasWorkspace'

const projectWithOptionalInput = (inputValues: Record<string, unknown> = {}): ProjectState => ({
  schemaVersion: '1.0.0',
  project: {
    id: 'project_test',
    name: 'Canvas Test',
    createdAt: '2026-05-09T00:00:00.000Z',
    updatedAt: '2026-05-09T00:00:00.000Z',
  },
  canvas: {
    nodes: [
      {
        id: 'node_fn',
        type: 'function',
        position: { x: 0, y: 0 },
        data: {
          functionId: 'fn_render',
          inputValues,
        },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  resources: {},
  assets: {},
  functions: {
    fn_render: {
      id: 'fn_render',
      name: 'Render',
      category: 'Render',
      workflow: {
        format: 'comfyui_api_json',
        rawJson: {
          '7': { class_type: 'CLIPTextEncode', _meta: { title: 'Negative Prompt' }, inputs: { text: 'low quality' } },
          '3': { class_type: 'KSampler', _meta: { title: 'Sampler' }, inputs: { cfg: 7 } },
        },
      },
      inputs: [
        {
          key: 'negative_prompt',
          label: 'Negative Prompt',
          type: 'text',
          required: false,
          bind: { nodeId: '7', nodeTitle: 'Negative Prompt', path: 'inputs.text' },
          upload: { strategy: 'none' },
        },
        {
          key: 'scale_by',
          label: 'Scale By',
          type: 'number',
          required: false,
          bind: { nodeId: '3', nodeTitle: 'Sampler', path: 'inputs.cfg' },
          upload: { strategy: 'none' },
        },
      ],
      outputs: [],
      runtimeDefaults: { runCount: 1, seedPolicy: { mode: 'randomize_all_before_submit' } },
      createdAt: '2026-05-09T00:00:00.000Z',
      updatedAt: '2026-05-09T00:00:00.000Z',
    },
  },
  tasks: {},
  comfy: {
    endpoints: [],
    scheduler: {
      strategy: 'least_busy',
      retry: { maxAttempts: 1, fallbackToOtherEndpoint: true },
    },
  },
})

describe('CanvasWorkspace helpers', () => {
  it('does not resync React Flow edges when derived edge fields are unchanged', () => {
    const previous = [
      {
        id: 'edge_1',
        source: 'node_text',
        sourceHandle: 'resource:res_text',
        target: 'node_fn',
        targetHandle: 'input:prompt',
        animated: true,
        label: 'prompt',
        type: 'default',
        className: 'input-edge',
        selected: false,
      },
    ]
    const next = previous.map((edge) => ({ ...edge }))

    expect(sameFlowEdgesForSync(previous, next)).toBe(true)
    expect(sameFlowEdgesForSync(previous, [{ ...next[0], selected: true }])).toBe(false)
  })

  it('keeps function and run nodes out of the visible canvas surface', () => {
    const nodes: ProjectState['canvas']['nodes'] = [
      { id: 'asset_1', type: 'resource', position: { x: 0, y: 0 }, data: { resourceId: 'res_1' } },
      { id: 'node_fn', type: 'function', position: { x: 260, y: 0 }, data: { functionId: 'fn_render' } },
      { id: 'node_run', type: 'result_group', position: { x: 520, y: 0 }, data: { taskId: 'task_1' } },
      { id: 'group_1', type: 'group', position: { x: -40, y: -40 }, data: { childNodeIds: ['asset_1'] } },
    ]

    expect(visibleCanvasNodes(nodes).map((node) => node.id)).toEqual(['asset_1', 'group_1'])
  })

  it('gives resource nodes a default height so media previews have a viewport before resizing', () => {
    const style = flowNodeStyle(
      { id: 'asset_1', type: 'resource', position: { x: 0, y: 0 }, data: { resourceId: 'res_1' } },
      {},
    )

    expect(style).toEqual({ width: 360, height: 280 })
  })

  it('clamps stored resource node sizes to the minimum usable asset card size', () => {
    const style = flowNodeStyle(
      {
        id: 'asset_1',
        type: 'resource',
        position: { x: 0, y: 0 },
        data: { resourceId: 'res_1', size: { width: 220, height: 140 } },
      },
      {},
    )

    expect(style).toEqual({ width: 360, height: 280 })
  })

  it('prefills function popup inputs from selected assets in function input order', () => {
    const project = projectWithOptionalInput()
    project.functions.fn_render.inputs.push({
      key: 'image',
      label: 'Image',
      type: 'image',
      required: true,
      bind: { nodeId: '12', nodeTitle: 'Load Image', path: 'inputs.image' },
      upload: { strategy: 'comfy_upload' },
    })
    project.resources = {
      res_image: {
        id: 'res_image',
        type: 'image',
        name: 'input.png',
        value: {
          assetId: 'asset_image',
          url: 'data:image/png;base64,abc',
          filename: 'input.png',
          mimeType: 'image/png',
          sizeBytes: 3,
        },
        source: { kind: 'manual_input' },
      },
      res_text: {
        id: 'res_text',
        type: 'text',
        name: 'Prompt',
        value: '  trim this  ',
        source: { kind: 'manual_input' },
      },
    }

    const draft = buildFunctionRunInputDraft(project.functions.fn_render, project.resources, [
      { resourceId: 'res_image', type: 'image' },
      { resourceId: 'res_text', type: 'text' },
    ])

    expect(draft).toEqual({
      negative_prompt: { resourceId: 'res_text', type: 'text' },
      scale_by: 7,
      image: { resourceId: 'res_image', type: 'image' },
    })
  })

  it('closes every floating menu when opening a function run dialog', () => {
    expect(functionRunFloatingMenuReset()).toEqual({
      addMenu: null,
      quickToolbar: undefined,
      functionNodeMenu: undefined,
      groupNodeMenu: undefined,
      inputPickMode: undefined,
    })
  })

  it('lists only compatible canvas assets for a function input picker', () => {
    const project = projectWithOptionalInput()
    project.resources = {
      res_image: {
        id: 'res_image',
        type: 'image',
        name: 'input.png',
        value: {
          assetId: 'asset_image',
          url: 'data:image/png;base64,abc',
          filename: 'input.png',
          mimeType: 'image/png',
          sizeBytes: 3,
        },
        source: { kind: 'manual_input' },
      },
      res_text: {
        id: 'res_text',
        type: 'text',
        name: 'Prompt',
        value: 'hello',
        source: { kind: 'manual_input' },
      },
      res_hidden: {
        id: 'res_hidden',
        type: 'image',
        name: 'not on canvas.png',
        value: {
          assetId: 'asset_hidden',
          url: 'data:image/png;base64,hidden',
          filename: 'hidden.png',
          mimeType: 'image/png',
          sizeBytes: 6,
        },
        source: { kind: 'manual_input' },
      },
    }
    project.canvas.nodes.push(
      { id: 'node_image', type: 'resource', position: { x: 0, y: 0 }, data: { resourceId: 'res_image' } },
      { id: 'node_text', type: 'resource', position: { x: 260, y: 0 }, data: { resourceId: 'res_text' } },
      { id: 'group_1', type: 'group', position: { x: -40, y: -40 }, data: { childNodeIds: ['node_image'] } },
    )

    expect(pickableResourceRefsForInput(project, 'image')).toEqual([
      { nodeId: 'node_image', resourceId: 'res_image', type: 'image' },
    ])
  })

  it('builds incoming and outgoing node reference summaries from canvas edges', () => {
    const project = projectWithOptionalInput()
    project.canvas.nodes.push({
      id: 'node_text',
      type: 'resource',
      position: { x: 100, y: 0 },
      data: { resourceId: 'res_text' },
    })
    project.resources.res_text = {
      id: 'res_text',
      type: 'text',
      name: 'Prompt',
      value: 'hello',
      source: { kind: 'manual_input' },
      metadata: { createdAt: '2026-05-09T00:00:00.000Z' },
    }
    project.canvas.edges = [
      {
        id: 'edge_1',
        source: { nodeId: 'node_text', handleId: 'resource:res_text', resourceId: 'res_text' },
        target: { nodeId: 'node_fn', inputKey: 'negative_prompt' },
        type: 'resource_to_input',
      },
    ]

    const references = buildNodeReferenceMap(project)

    expect(references.node_text).toEqual([
      { nodeId: 'node_fn', title: 'Render', type: 'function', direction: 'outgoing', resourceId: 'res_text' },
    ])
    expect(references.node_fn).toEqual([
      { nodeId: 'node_text', title: 'Prompt', type: 'resource', direction: 'incoming', resourceId: 'res_text' },
    ])
  })

  it('uses edited optional primitive values when creating assets from dangling input connections', () => {
    const project = projectWithOptionalInput({
      negative_prompt: 'avoid blur',
      scale_by: 1.5,
    })

    expect(targetInputInitialResourceValue(project, 'node_fn', 'negative_prompt')).toBe('avoid blur')
    expect(targetInputInitialResourceValue(project, 'node_fn', 'scale_by')).toBe(1.5)
  })

  it('uses connected primitive resource values before falling back to workflow defaults', () => {
    const project = projectWithOptionalInput({
      negative_prompt: { resourceId: 'res_text', type: 'text' },
      scale_by: { resourceId: 'res_number', type: 'number' },
    })
    project.resources = {
      res_text: {
        id: 'res_text',
        type: 'text',
        name: 'Negative',
        value: 'connected negative',
        source: { kind: 'manual_input' },
        metadata: { createdAt: '2026-05-09T00:00:00.000Z' },
      },
      res_number: {
        id: 'res_number',
        type: 'number',
        name: 'Scale',
        value: 2.5,
        source: { kind: 'manual_input' },
        metadata: { createdAt: '2026-05-09T00:00:00.000Z' },
      },
    }

    expect(targetInputInitialResourceValue(project, 'node_fn', 'negative_prompt')).toBe('connected negative')
    expect(targetInputInitialResourceValue(project, 'node_fn', 'scale_by')).toBe(2.5)
  })

  it('falls back to workflow primitive values for optional inputs without local edits', () => {
    const project = projectWithOptionalInput()

    expect(targetInputInitialResourceValue(project, 'node_fn', 'negative_prompt')).toBe('low quality')
    expect(targetInputInitialResourceValue(project, 'node_fn', 'scale_by')).toBe(7)
  })

  it('fits distant nodes into the Comfy-style minimap bounds', () => {
    const layout = buildComfyMinimapLayout(
      [
        { id: 'left', position: { x: -1200, y: -400 }, style: { width: 240, height: 180 } },
        { id: 'right', position: { x: 1600, y: 900 }, style: { width: 360, height: 260 } },
      ],
      [],
      { x: 0, y: 0, zoom: 1 },
      { width: 1280, height: 720 },
    )

    expect(layout.nodeRects).toHaveLength(2)
    for (const rect of layout.nodeRects) {
      expect(rect.x).toBeGreaterThanOrEqual(layout.padding - 0.01)
      expect(rect.y).toBeGreaterThanOrEqual(layout.padding - 0.01)
      expect(rect.x + rect.width).toBeLessThanOrEqual(layout.width - layout.padding + 0.01)
      expect(rect.y + rect.height).toBeLessThanOrEqual(layout.height - layout.padding + 0.01)
    }
    expect(layout.scale).toBeGreaterThan(0)
  })

  it('maps the current React Flow viewport into a minimap viewport frame', () => {
    const layout = buildComfyMinimapLayout(
      [{ id: 'node', position: { x: 0, y: 0 }, style: { width: 400, height: 300 } }],
      [],
      { x: -200, y: -100, zoom: 2 },
      { width: 1000, height: 600 },
    )

    expect(layout.viewportRect.width).toBeCloseTo((1000 / 2) * layout.scale, 3)
    expect(layout.viewportRect.height).toBeCloseTo((600 / 2) * layout.scale, 3)
    expect(layout.viewportRect.x).toBeCloseTo(layout.offsetX + (100 - layout.content.x) * layout.scale, 3)
    expect(layout.viewportRect.y).toBeCloseTo(layout.offsetY + (50 - layout.content.y) * layout.scale, 3)
  })

  it('converts minimap drag coordinates back to flow coordinates', () => {
    const layout = buildComfyMinimapLayout(
      [{ id: 'node', position: { x: 100, y: 200 }, style: { width: 300, height: 180 } }],
      [],
      { x: 0, y: 0, zoom: 1 },
      { width: 1000, height: 600 },
    )
    const point = minimapPointToFlowPosition(
      { x: layout.offsetX + 250 * layout.scale, y: layout.offsetY + 290 * layout.scale },
      layout,
    )

    expect(point.x).toBeCloseTo(layout.content.x + 250, 3)
    expect(point.y).toBeCloseTo(layout.content.y + 290, 3)
  })
})
