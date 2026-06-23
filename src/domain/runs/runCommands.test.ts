import { describe, expect, it } from 'vitest'
import type { FunctionOutputDef, GenerationFunction } from '../types'
import { createRunSnapshot } from './runSnapshot'
import { createPendingOutputAssetsForRun, pendingOutputResourceValue, type RunCommandProject } from './runCommands'

const now = '2026-06-23T00:00:00.000Z'

const functionDef: GenerationFunction = {
  id: 'fn_image',
  name: 'Image Function',
  workflow: {
    format: 'comfyui_api_json',
    rawJson: {},
  },
  inputs: [
    {
      key: 'prompt',
      label: 'Prompt',
      type: 'text',
      required: true,
      bind: { path: 'prompt' },
    },
    {
      key: 'image',
      label: 'Image',
      type: 'image',
      required: false,
      bind: { path: 'image' },
    },
  ],
  outputs: [],
  createdAt: now,
  updatedAt: now,
}

const output = (key: string, type: FunctionOutputDef['type']): FunctionOutputDef => ({
  key,
  label: key,
  type,
  bind: { path: key },
  extract: { source: 'node_output' },
})

const project = (): RunCommandProject => ({
  canvas: {
    nodes: [],
    edges: [],
  },
  resources: {
    res_prompt: {
      id: 'res_prompt',
      type: 'text',
      value: 'make it brighter',
      source: { kind: 'manual_input' },
      metadata: { createdAt: now },
    },
    res_image: {
      id: 'res_image',
      type: 'image',
      value: {
        assetId: 'asset_image',
        url: '/assets/image.png',
        filename: 'image.png',
        mimeType: 'image/png',
        sizeBytes: 1024,
      },
      source: { kind: 'user_upload' },
      metadata: { createdAt: now },
    },
  },
  runs: {},
})

describe('runCommands', () => {
  it('creates pending output values for primitive and media resource types', () => {
    expect(pendingOutputResourceValue('text', 'res_text')).toBe('')
    expect(pendingOutputResourceValue('number', 'res_number')).toBe(0)
    expect(pendingOutputResourceValue('image', 'res_image')).toEqual({
      assetId: 'pending_res_image',
      url: '',
      filename: 'Image',
      mimeType: 'image/*',
      sizeBytes: 0,
    })
    expect(pendingOutputResourceValue('video', 'res_video')).toEqual({
      assetId: 'pending_res_video',
      url: '',
      filename: 'Video',
      mimeType: 'video/*',
      sizeBytes: 0,
    })
    expect(pendingOutputResourceValue('audio', 'res_audio')).toEqual({
      assetId: 'pending_res_audio',
      url: '',
      filename: 'Audio',
      mimeType: 'audio/*',
      sizeBytes: 0,
    })
  })

  it('creates pending output assets immediately and records refs on the run', () => {
    const run = createRunSnapshot({
      id: 'run_1',
      functionDef,
      inputRefs: {
        prompt: { resourceId: 'res_prompt', type: 'text' },
        image: { resourceId: 'res_image', type: 'image' },
      },
      inputValuesSnapshot: {},
      runIndex: 1,
      runTotal: 1,
      now,
    })

    const result = createPendingOutputAssetsForRun(project(), {
      run,
      outputs: [output('image', 'image'), output('text', 'text')],
      basePosition: { x: 500, y: 120 },
      now,
    })

    expect(Object.keys(result.resources)).toEqual(['resource_run_1_image', 'resource_run_1_text'])
    expect(result.outputRefs).toEqual({
      image: [{ resourceId: 'resource_run_1_image', type: 'image' }],
      text: [{ resourceId: 'resource_run_1_text', type: 'text' }],
    })
    expect(result.project.runs.run_1.outputRefs).toEqual(result.outputRefs)
    expect(result.project.runs.run_1.updatedAt).toBe(now)

    expect(result.project.resources.resource_run_1_image).toMatchObject({
      id: 'resource_run_1_image',
      type: 'image',
      name: 'Image Function Image',
      value: {
        assetId: 'pending_resource_run_1_image',
        url: '',
        filename: 'Image',
        mimeType: 'image/*',
        sizeBytes: 0,
      },
      source: {
        kind: 'function_output',
        runId: 'run_1',
        outputKey: 'image',
      },
      metadata: {
        workflowFunctionId: 'fn_image',
        createdAt: now,
      },
    })
    expect(result.project.resources.resource_run_1_text.value).toBe('')

    expect(result.project.canvas.nodes).toEqual([
      {
        id: 'node_resource_run_1_image',
        type: 'asset',
        position: { x: 500, y: 120 },
        data: { resourceId: 'resource_run_1_image', title: 'Image Function Image' },
      },
      {
        id: 'node_resource_run_1_text',
        type: 'asset',
        position: { x: 780, y: 120 },
        data: { resourceId: 'resource_run_1_text', title: 'Image Function Text' },
      },
    ])
  })

  it('connects every concrete input asset to every pending output asset', () => {
    const run = createRunSnapshot({
      id: 'run_1',
      functionDef,
      inputRefs: {
        prompt: { resourceId: 'res_prompt', type: 'text' },
        image: { resourceId: 'res_image', type: 'image' },
      },
      inputValuesSnapshot: {},
      runIndex: 1,
      runTotal: 1,
      now,
    })

    const result = createPendingOutputAssetsForRun(project(), {
      run,
      outputs: [output('image', 'image'), output('text', 'text')],
      basePosition: { x: 500, y: 120 },
      now,
    })

    expect(result.project.canvas.edges.map((edge) => edge.id)).toEqual([
      'lineage:run_1:prompt:res_prompt:resource_run_1_image',
      'lineage:run_1:prompt:res_prompt:resource_run_1_text',
      'lineage:run_1:image:res_image:resource_run_1_image',
      'lineage:run_1:image:res_image:resource_run_1_text',
    ])
  })
})
