/**
 * ComfyUI's live queue and log answers, read into plain lists.
 * `GET /queue` items are `[number, prompt_id, prompt, extra_data, outputs_to_execute]`; the pending list is a heap copy,
 * so its order is not the run order — `number` is.
 */

export type ComfyQueueItem = {
  promptId: string
  number: number
  state: 'running' | 'pending'
  /** 0 for running items; 1..n for pending items in the order ComfyUI will run them. */
  position: number
  clientId?: string
}

export type ComfyQueueSnapshot = { running: ComfyQueueItem[]; pending: ComfyQueueItem[] }

export type ComfyLogEntry = { time?: string; message: string }

const queueItems = (list: unknown, state: ComfyQueueItem['state']): ComfyQueueItem[] => {
  if (!Array.isArray(list)) return []
  const items: ComfyQueueItem[] = []
  for (const entry of list) {
    if (!Array.isArray(entry)) continue
    const [number, promptId, , extraData] = entry as unknown[]
    if (typeof promptId !== 'string' || typeof number !== 'number') continue
    const clientId =
      extraData && typeof extraData === 'object' ? (extraData as { client_id?: unknown }).client_id : undefined
    items.push({ promptId, number, state, position: 0, ...(typeof clientId === 'string' ? { clientId } : {}) })
  }
  return items
}

export function parseComfyQueue(raw: unknown): ComfyQueueSnapshot {
  if (!raw || typeof raw !== 'object') return { running: [], pending: [] }
  const { queue_running: running, queue_pending: pending } = raw as { queue_running?: unknown; queue_pending?: unknown }
  return {
    running: queueItems(running, 'running'),
    pending: queueItems(pending, 'pending')
      .sort((left, right) => left.number - right.number)
      .map((item, index) => ({ ...item, position: index + 1 })),
  }
}

/** `/internal/logs/raw` gives `{entries: [{t, m}]}`; the older `/internal/logs` gives one string. */
export function parseComfyLogs(raw: unknown): ComfyLogEntry[] {
  if (typeof raw === 'string') {
    const lines = raw.split('\n')
    if (lines.at(-1) === '') lines.pop()
    return lines.map((message) => ({ message }))
  }
  if (!raw || typeof raw !== 'object') return []
  const entries = (raw as { entries?: unknown }).entries
  if (!Array.isArray(entries)) return []
  const logs: ComfyLogEntry[] = []
  for (const entry of entries) {
    const { t, m } = (entry ?? {}) as { t?: unknown; m?: unknown }
    if (typeof m !== 'string') continue
    logs.push({ ...(typeof t === 'string' ? { time: t } : {}), message: m })
  }
  return logs
}
