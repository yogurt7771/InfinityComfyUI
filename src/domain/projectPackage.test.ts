import { describe, expect, it } from 'vitest'
import { createConfigPackage, createProjectPackage } from './projectPackage'
import type { ProjectState } from './types'
import { createOpenAIImageFunction } from './openaiImage'

const project: ProjectState = {
  schemaVersion: '1.0.0',
  project: {
    id: 'project_1',
    name: 'Demo',
    createdAt: '2026-05-08T09:00:00.000Z',
    updatedAt: '2026-05-08T09:00:00.000Z',
  },
  canvas: {
    nodes: [{ id: 'node_1', type: 'resource', position: { x: 0, y: 0 }, data: { resourceId: 'res_1' } }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  resources: {
    res_1: { id: 'res_1', type: 'text', value: 'hello', source: { kind: 'manual_input' } },
  },
  assets: {
    asset_1: {
      id: 'asset_1',
      name: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 100,
      createdAt: '2026-05-08T09:00:00.000Z',
    },
  },
  functions: {},
  tasks: {
    task_1: {
      id: 'task_1',
      functionNodeId: 'fn_node_1',
      functionId: 'fn_1',
      runIndex: 1,
      runTotal: 1,
      status: 'succeeded',
      inputRefs: {},
      inputSnapshot: {},
      paramsSnapshot: {},
      workflowTemplateSnapshot: {},
      compiledWorkflowSnapshot: {},
      seedPatchLog: [],
      outputRefs: {},
      createdAt: '2026-05-08T09:00:00.000Z',
      updatedAt: '2026-05-08T09:00:00.000Z',
    },
  },
  comfy: {
    endpoints: [
      {
        id: 'endpoint_1',
        name: 'Local',
        baseUrl: 'http://127.0.0.1:8188',
        enabled: true,
        maxConcurrentJobs: 2,
        priority: 1,
        timeoutMs: 600000,
        auth: {
          type: 'token',
          token: 'demo',
          exportSecret: false,
        },
      },
    ],
    scheduler: {
      strategy: 'least_busy',
      retry: { maxAttempts: 1, fallbackToOtherEndpoint: true },
    },
  },
}

describe('project package helpers', () => {
  it('keeps complete project data for full project exports', () => {
    const exported = createProjectPackage(project)

    expect(exported.project.canvas.nodes).toHaveLength(1)
    expect(exported.project.resources.res_1.value).toBe('hello')
    expect(exported.project.tasks.task_1.status).toBe('succeeded')
  })

  it('excludes canvas, resources, assets, tasks, and secrets from config exports', () => {
    const exported = createConfigPackage(project)

    expect(exported.config).toEqual({
      schemaVersion: '1.0.0',
      functions: {},
      comfy: {
        endpoints: [
          {
            id: 'endpoint_1',
            name: 'Local',
            baseUrl: 'http://127.0.0.1:8188',
            enabled: true,
            maxConcurrentJobs: 2,
            priority: 1,
            timeoutMs: 600000,
            auth: {
              type: 'token',
              exportSecret: false,
            },
          },
        ],
        scheduler: {
          strategy: 'least_busy',
          retry: { maxAttempts: 1, fallbackToOtherEndpoint: true },
        },
      },
    })
  })

  it('excludes built-in function definitions from project and config exports', () => {
    const builtInFunction = createOpenAIImageFunction('2026-05-09T00:00:00.000Z')
    const projectWithBuiltIn: ProjectState = {
      ...project,
      functions: {
        [builtInFunction.id]: builtInFunction,
        fn_custom: {
          id: 'fn_custom',
          name: 'Custom Render',
          category: 'Render',
          workflow: { format: 'comfyui_api_json', rawJson: {} },
          inputs: [],
          outputs: [],
          createdAt: '2026-05-09T00:00:00.000Z',
          updatedAt: '2026-05-09T00:00:00.000Z',
        },
      },
    }

    expect(createProjectPackage(projectWithBuiltIn).project.functions).toEqual({
      fn_custom: projectWithBuiltIn.functions.fn_custom,
    })
    expect(createConfigPackage(projectWithBuiltIn).config.functions).toEqual({
      fn_custom: projectWithBuiltIn.functions.fn_custom,
    })
  })
})
