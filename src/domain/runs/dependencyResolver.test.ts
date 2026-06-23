import { describe, expect, it } from 'vitest'
import type { ExecutionTask, PendingResourceRef, ResourceRef } from '../types'
import { pendingRefKey, resolveExecutionTaskDependencies, resolvePendingDependencyTasks } from './dependencyResolver'

const now = '2026-06-23T00:00:00.000Z'

const task = (id: string, overrides: Partial<ExecutionTask>): ExecutionTask => ({
  id,
  functionNodeId: `node_${id}`,
  functionId: 'fn_test',
  runIndex: 1,
  runTotal: 1,
  status: 'pending',
  inputRefs: {},
  inputSnapshot: {},
  inputValuesSnapshot: {},
  paramsSnapshot: {},
  workflowTemplateSnapshot: {},
  compiledWorkflowSnapshot: {},
  seedPatchLog: [],
  outputRefs: {},
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

const pendingImage = (pendingTaskId: string): PendingResourceRef => ({
  pendingTaskId,
  outputKey: 'image',
  type: 'image',
})

const imageRef = (resourceId: string): ResourceRef => ({ resourceId, type: 'image' })

describe('dependencyResolver', () => {
  it('uses stable keys for pending output refs', () => {
    expect(pendingRefKey({ pendingTaskId: 'task_1', outputKey: 'image', type: 'image' })).toBe('task_1:image')
  })

  it('resolves a deep pending dependency chain one ready layer at a time', () => {
    const tasks: Record<string, ExecutionTask> = {
      task_root: task('task_root', {
        status: 'succeeded',
        outputRefs: { image: [imageRef('res_root')] },
      }),
      task_middle: task('task_middle', {
        inputRefs: { image: pendingImage('task_root') },
      }),
      task_leaf: task('task_leaf', {
        inputRefs: { image: pendingImage('task_middle') },
      }),
    }

    const firstPass = resolvePendingDependencyTasks(tasks)

    expect(firstPass.ready.map((item) => item.task.id)).toEqual(['task_middle'])
    expect(firstPass.ready[0]?.inputRefs).toEqual({ image: imageRef('res_root') })
    expect(firstPass.waiting.map((item) => item.task.id)).toEqual(['task_leaf'])

    const secondPass = resolvePendingDependencyTasks({
      ...tasks,
      task_middle: {
        ...tasks.task_middle,
        status: 'succeeded',
        outputRefs: { image: [imageRef('res_middle')] },
      },
    })

    expect(secondPass.ready.map((item) => item.task.id)).toEqual(['task_leaf'])
    expect(secondPass.ready[0]?.inputRefs).toEqual({ image: imageRef('res_middle') })
  })

  it('fails a pending task immediately when an upstream dependency failed', () => {
    const upstreamError = { code: 'upstream_failed', message: 'upstream failed' }
    const result = resolveExecutionTaskDependencies(
      task('task_downstream', {
        inputRefs: { image: pendingImage('task_upstream') },
      }),
      {
        task_upstream: task('task_upstream', {
          status: 'failed',
          error: upstreamError,
        }),
      },
    )

    expect(result).toEqual({
      status: 'failed',
      code: 'dependency_failed',
      message: 'Dependency task task_upstream failed',
      raw: upstreamError,
    })
  })

  it('fails a pending task when a succeeded upstream task did not produce the requested output', () => {
    const result = resolveExecutionTaskDependencies(
      task('task_downstream', {
        inputRefs: { image: pendingImage('task_upstream') },
      }),
      {
        task_upstream: task('task_upstream', {
          status: 'succeeded',
          outputRefs: {},
        }),
      },
    )

    expect(result).toEqual({
      status: 'failed',
      code: 'dependency_output_missing',
      message: 'Dependency task task_upstream did not produce image',
    })
  })
})
