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

  it('excludes operation history from full project exports', () => {
    const exported = createProjectPackage({
      ...project,
      history: {
        schemaVersion: '1.0.0',
        undoStack: [
          {
            id: 'history_1',
            label: 'Create asset',
            transactionType: 'asset',
            createdAt: '2026-05-08T09:01:00.000Z',
            preview: { title: 'Create asset' },
            affectedIds: { nodeIds: [], assetIds: [], groupIds: [], templateIds: [] },
            before: project,
            after: project,
          },
        ],
        redoStack: [],
      },
    })

    expect(exported.project.history).toBeUndefined()
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

  it('keeps password auth type while omitting password and fallback token from config exports by default', () => {
    const passwordProject = structuredClone(project)
    passwordProject.comfy.endpoints[0]!.auth = {
      type: 'password',
      password: 'fixture-config-password',
      token: 'fixture-config-fallback-token',
      exportSecret: false,
    }

    const exported = createConfigPackage(passwordProject)

    expect(exported.config.comfy.endpoints[0]?.auth).toEqual({
      type: 'password',
      exportSecret: false,
    })
    expect(JSON.stringify(exported)).not.toContain('fixture-config-password')
    expect(JSON.stringify(exported)).not.toContain('fixture-config-fallback-token')
  })

  it('exports the password and fallback API token when config secret export is enabled', () => {
    const passwordProject = structuredClone(project)
    passwordProject.comfy.endpoints[0]!.auth = {
      type: 'password',
      password: 'fixture-exported-config-password',
      token: 'fixture-exported-config-fallback-token',
      exportSecret: true,
    }

    expect(createConfigPackage(passwordProject).config.comfy.endpoints[0]?.auth).toEqual({
      type: 'password',
      password: 'fixture-exported-config-password',
      token: 'fixture-exported-config-fallback-token',
      exportSecret: true,
    })
  })

  it('keeps password auth type while omitting password and fallback token from full-project exports by default', () => {
    const passwordProject = structuredClone(project)
    passwordProject.comfy.endpoints[0]!.auth = {
      type: 'password',
      password: 'fixture-full-project-password',
      token: 'fixture-full-project-fallback-token',
      exportSecret: false,
    }

    const exported = createProjectPackage(passwordProject)

    expect(exported.project.comfy.endpoints[0]?.auth).toEqual({
      type: 'password',
      exportSecret: false,
    })
    expect(JSON.stringify(exported)).not.toContain('fixture-full-project-password')
    expect(JSON.stringify(exported)).not.toContain('fixture-full-project-fallback-token')
  })

  it('exports the password and fallback API token in an explicitly secret-enabled full project', () => {
    const passwordProject = structuredClone(project)
    passwordProject.comfy.endpoints[0]!.auth = {
      type: 'password',
      password: 'fixture-exported-full-project-password',
      token: 'fixture-exported-full-project-fallback-token',
      exportSecret: true,
    }

    expect(createProjectPackage(passwordProject).project.comfy.endpoints[0]?.auth).toEqual({
      type: 'password',
      password: 'fixture-exported-full-project-password',
      token: 'fixture-exported-full-project-fallback-token',
      exportSecret: true,
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
