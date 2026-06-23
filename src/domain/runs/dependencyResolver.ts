import type {
  ExecutionInputSnapshot,
  ExecutionTask,
  InputResourceRef,
  PendingResourceRef,
  PrimitiveInputValue,
  Resource,
  ResourceRef,
} from '../types'

export type RuntimeInputValue = PrimitiveInputValue | InputResourceRef
export type RuntimeInputValues = Record<string, RuntimeInputValue>
export type ResolvedRuntimeInputValue = PrimitiveInputValue | ResourceRef
export type ResolvedRuntimeInputValues = Record<string, ResolvedRuntimeInputValue>

export type DependencyResolution =
  | { status: 'waiting' }
  | { status: 'failed'; code: string; message: string; raw?: unknown }
  | {
      status: 'resolved'
      inputValues: ResolvedRuntimeInputValues
      inputRefs: Record<string, ResourceRef>
      resolvedRefsByPendingKey: Map<string, ResourceRef>
    }

export type PendingDependencyReadyTask = {
  task: ExecutionTask
  inputValues: ResolvedRuntimeInputValues
  inputRefs: Record<string, ResourceRef>
  resolvedRefsByPendingKey: Map<string, ResourceRef>
}

export type PendingDependencyFailedTask = {
  task: ExecutionTask
  code: string
  message: string
  raw?: unknown
}

export type PendingDependencyWaitingTask = {
  task: ExecutionTask
}

export type PendingDependencyResolutionBatch = {
  ready: PendingDependencyReadyTask[]
  failed: PendingDependencyFailedTask[]
  waiting: PendingDependencyWaitingTask[]
}

export const isResourceRef = (value: RuntimeInputValue | undefined): value is ResourceRef =>
  typeof value === 'object' &&
  value !== null &&
  'resourceId' in value &&
  typeof (value as { resourceId?: unknown }).resourceId === 'string'

export const isPendingResourceRef = (value: RuntimeInputValue | undefined): value is PendingResourceRef =>
  typeof value === 'object' &&
  value !== null &&
  'pendingTaskId' in value &&
  typeof (value as { pendingTaskId?: unknown }).pendingTaskId === 'string' &&
  typeof (value as { outputKey?: unknown }).outputKey === 'string'

export const pendingRefKey = (ref: PendingResourceRef) => `${ref.pendingTaskId}:${ref.outputKey}`

export const pendingInputRefs = (inputValues: RuntimeInputValues): PendingResourceRef[] =>
  Object.values(inputValues).filter((value): value is PendingResourceRef => isPendingResourceRef(value))

export const hasPendingInputRefs = (inputValues: RuntimeInputValues): boolean => pendingInputRefs(inputValues).length > 0

const valueFromSnapshot = (snapshot: ExecutionInputSnapshot): RuntimeInputValue | undefined => {
  if (snapshot.source === 'resource' && snapshot.resourceId) return { resourceId: snapshot.resourceId, type: snapshot.type }
  if (snapshot.source === 'pending' && snapshot.pendingTaskId && snapshot.outputKey) {
    return { pendingTaskId: snapshot.pendingTaskId, outputKey: snapshot.outputKey, type: snapshot.type }
  }
  if (snapshot.value === null || typeof snapshot.value === 'string' || typeof snapshot.value === 'number') {
    return snapshot.value
  }
  return undefined
}

export function inputValuesFromTaskSnapshot(task: Pick<ExecutionTask, 'inputRefs' | 'inputValuesSnapshot'>): RuntimeInputValues {
  const values: RuntimeInputValues = {}
  for (const [key, snapshot] of Object.entries(task.inputValuesSnapshot ?? {})) {
    const value = valueFromSnapshot(snapshot)
    if (value !== undefined) values[key] = value
  }
  return { ...values, ...structuredClone(task.inputRefs ?? {}) }
}

export function resourceInputSnapshot(
  inputValues: RuntimeInputValues,
  resources: Record<string, Resource>,
): Record<string, Resource> {
  return Object.fromEntries(
    Object.entries(inputValues)
      .filter((entry): entry is [string, ResourceRef] => isResourceRef(entry[1]))
      .map(([key, value]) => [key, resources[value.resourceId]])
      .filter((entry): entry is [string, Resource] => Boolean(entry[1])),
  )
}

export function inputResourceRefs(inputValues: RuntimeInputValues): Record<string, ResourceRef> {
  return Object.fromEntries(Object.entries(inputValues).filter((entry): entry is [string, ResourceRef] => isResourceRef(entry[1])))
}

export function resolveExecutionTaskDependencies(
  task: ExecutionTask,
  tasks: Record<string, ExecutionTask>,
): DependencyResolution {
  const inputValues = inputValuesFromTaskSnapshot(task)
  const resolvedRefsByPendingKey = new Map<string, ResourceRef>()

  for (const [inputKey, value] of Object.entries(inputValues)) {
    if (!isPendingResourceRef(value)) continue

    const dependencyTask = tasks[value.pendingTaskId]
    if (!dependencyTask) {
      return {
        status: 'failed',
        code: 'dependency_missing',
        message: `Dependency task ${value.pendingTaskId} is missing`,
      }
    }

    if (dependencyTask.status === 'failed' || dependencyTask.status === 'canceled') {
      return {
        status: 'failed',
        code: 'dependency_failed',
        message: `Dependency task ${value.pendingTaskId} ${dependencyTask.status}`,
        raw: dependencyTask.error,
      }
    }

    if (dependencyTask.status !== 'succeeded') return { status: 'waiting' }

    const outputRefs = dependencyTask.outputRefs[value.outputKey] ?? []
    const resolvedRef = outputRefs.find((ref) => ref.type === value.type) ?? outputRefs[0]
    if (!resolvedRef) {
      return {
        status: 'failed',
        code: 'dependency_output_missing',
        message: `Dependency task ${value.pendingTaskId} did not produce ${value.outputKey}`,
      }
    }

    inputValues[inputKey] = resolvedRef
    resolvedRefsByPendingKey.set(pendingRefKey(value), resolvedRef)
  }

  return {
    status: 'resolved',
    inputValues: inputValues as ResolvedRuntimeInputValues,
    inputRefs: inputResourceRefs(inputValues),
    resolvedRefsByPendingKey,
  }
}

export function resolvePendingDependencyTasks(tasks: Record<string, ExecutionTask>): PendingDependencyResolutionBatch {
  const batch: PendingDependencyResolutionBatch = {
    ready: [],
    failed: [],
    waiting: [],
  }

  for (const task of Object.values(tasks)) {
    if (task.status !== 'pending') continue
    const resolution = resolveExecutionTaskDependencies(task, tasks)
    if (resolution.status === 'waiting') {
      batch.waiting.push({ task })
    } else if (resolution.status === 'failed') {
      batch.failed.push({
        task,
        code: resolution.code,
        message: resolution.message,
        raw: resolution.raw,
      })
    } else {
      batch.ready.push({
        task,
        inputValues: resolution.inputValues,
        inputRefs: resolution.inputRefs,
        resolvedRefsByPendingKey: resolution.resolvedRefsByPendingKey,
      })
    }
  }

  return batch
}
