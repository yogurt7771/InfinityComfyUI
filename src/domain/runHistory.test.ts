import { describe, expect, it } from 'vitest'
import { getNodeRunHistory } from './runHistory'
import type { ExecutionTask, ProjectState } from './types'

const task = (overrides: Partial<ExecutionTask>): ExecutionTask => ({
  id: overrides.id ?? 'task_1',
  functionNodeId: overrides.functionNodeId ?? 'node_fn_1',
  functionId: overrides.functionId ?? 'fn_1',
  runIndex: overrides.runIndex ?? 1,
  runTotal: overrides.runTotal ?? 1,
  status: overrides.status ?? 'succeeded',
  inputRefs: {},
  inputSnapshot: {},
  paramsSnapshot: {},
  workflowTemplateSnapshot: {},
  compiledWorkflowSnapshot: {},
  seedPatchLog: [],
  endpointId: overrides.endpointId,
  comfyPromptId: overrides.comfyPromptId,
  outputRefs: overrides.outputRefs ?? {},
  error: overrides.error,
  createdAt: overrides.createdAt ?? '2026-05-08T09:00:00.000Z',
  updatedAt: overrides.updatedAt ?? '2026-05-08T09:00:00.000Z',
})

const project = (tasks: Record<string, ExecutionTask>): ProjectState => ({
  schemaVersion: '1.0.0',
  project: {
    id: 'project_1',
    name: 'Demo',
    createdAt: '2026-05-08T09:00:00.000Z',
    updatedAt: '2026-05-08T09:00:00.000Z',
  },
  canvas: {
    nodes: [
      { id: 'node_fn_1', type: 'function', position: { x: 0, y: 0 }, data: { functionId: 'fn_1' } },
      { id: 'node_result_1', type: 'result_group', position: { x: 0, y: 0 }, data: { taskId: 'task_2' } },
      { id: 'node_res_1', type: 'resource', position: { x: 0, y: 0 }, data: { resourceId: 'res_1' } },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  resources: {
    res_1: {
      id: 'res_1',
      type: 'image',
      value: { assetId: 'asset_1', url: 'local.png', mimeType: 'image/png', sizeBytes: 0 },
      source: { kind: 'function_output', taskId: 'task_2', functionNodeId: 'node_fn_1' },
    },
  },
  assets: {},
  functions: {},
  tasks,
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
      },
    ],
    scheduler: { strategy: 'least_busy', retry: { maxAttempts: 1, fallbackToOtherEndpoint: true } },
  },
})

describe('getNodeRunHistory', () => {
  it('returns all tasks for a selected function node with ComfyUI history paths', () => {
    const history = getNodeRunHistory(
      project({
        task_2: task({ id: 'task_2', runIndex: 2, runTotal: 2, endpointId: 'endpoint_1', comfyPromptId: 'prompt_2' }),
        task_1: task({ id: 'task_1', runIndex: 1, runTotal: 2, endpointId: 'endpoint_1', comfyPromptId: 'prompt_1' }),
      }),
      'node_fn_1',
    )

    expect(history).toEqual([
      {
        taskId: 'task_1',
        status: 'succeeded',
        runLabel: 'Run 1/2',
        endpointName: 'Local',
        comfyPromptId: 'prompt_1',
        resultNodeId: undefined,
        historyPath: '/history/prompt_1',
        historyUrl: 'http://127.0.0.1:8188/history/prompt_1',
      },
      {
        taskId: 'task_2',
        status: 'succeeded',
        runLabel: 'Run 2/2',
        endpointName: 'Local',
        comfyPromptId: 'prompt_2',
        resultNodeId: 'node_result_1',
        historyPath: '/history/prompt_2',
        historyUrl: 'http://127.0.0.1:8188/history/prompt_2',
      },
    ])
  })

  it('returns the matching task for a selected result group or output resource node', () => {
    const state = project({
      task_1: task({ id: 'task_1', runIndex: 1 }),
      task_2: task({ id: 'task_2', runIndex: 2, comfyPromptId: 'prompt_2' }),
    })

    expect(getNodeRunHistory(state, 'node_result_1').map((item) => item.taskId)).toEqual(['task_2'])
    expect(getNodeRunHistory(state, 'node_res_1').map((item) => item.taskId)).toEqual(['task_2'])
  })

  it('includes task error messages for failed selected runs', () => {
    const history = getNodeRunHistory(
      project({
        task_2: task({
          id: 'task_2',
          status: 'failed',
          error: {
            code: 'openai_execution_failed',
            message: 'OpenAI request failed: 401 invalid api key',
          },
        }),
      }),
      'node_result_1',
    )

    expect(history[0]).toMatchObject({
      status: 'failed',
      errorMessage: 'OpenAI request failed: 401 invalid api key',
    })
  })
})
