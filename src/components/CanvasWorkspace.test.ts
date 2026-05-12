import { describe, expect, it } from 'vitest'
import { targetInputInitialResourceValue } from '../domain/inputInitialValue'
import type { ProjectState } from '../domain/types'

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
})
