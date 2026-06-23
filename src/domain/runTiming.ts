import type { ExecutionTask } from './types'

export const formatHistoryTimestamp = (value: string | undefined) => {
  if (!value) return '-'
  const timestamp = value.trim()
  if (!timestamp) return '-'
  return timestamp.replace('T', ' ').replace(/\.\d{3}Z?$/, '').replace(/Z$/, '').slice(0, 19)
}

export const runDurationMs = (task: Pick<ExecutionTask, 'startedAt' | 'updatedAt' | 'completedAt'> | undefined) => {
  if (!task?.startedAt) return undefined
  const start = Date.parse(task.startedAt)
  const end = Date.parse(task.completedAt ?? task.updatedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined
  return end - start
}

export const formatDurationMs = (durationMs: number | undefined) => {
  if (durationMs === undefined) return undefined
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`

  const totalSeconds = durationMs / 1000
  if (totalSeconds < 60) {
    const rounded = Math.round(totalSeconds * 10) / 10
    return Number.isInteger(rounded) ? `${rounded}s` : `${rounded.toFixed(1)}s`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  if (seconds === 0) return `${minutes}m`
  return `${minutes}m ${seconds}s`
}
