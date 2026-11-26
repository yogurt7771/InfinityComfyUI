import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { RefreshCw, Square, Trash2, X } from 'lucide-react'
import type { ComfyLogEntry } from '../domain/comfyQueue'
import type { ComfyEndpointConfig } from '../domain/types'
import { projectStore, useProjectStore, type ComfyServerQueue, type ComfyServerQueueItem } from '../store/projectStore'
import { ConfirmationDialog } from './ConfirmationDialog'
import { ModalFrame } from './ModalFrame'

function ServerDialog({ label, wide, onClose, children }: { label: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <ModalFrame label={label} onClose={onClose} dialogClassName={`manager-modal server-tool-modal${wide ? ' is-wide' : ''}`}>
      <div className="manager-header">
        <h3>{label}</h3>
        <button type="button" className="icon-button" aria-label={`Close ${label}`} onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="server-tool-body">{children}</div>
    </ModalFrame>
  )
}

const shortId = (promptId: string) => (promptId.length > 13 ? `${promptId.slice(0, 8)}…${promptId.slice(-4)}` : promptId)

export function ComfyQueueDialog({ endpoint, onClose }: { endpoint: ComfyEndpointConfig; onClose: () => void }) {
  const tasks = useProjectStore((state) => state.project.tasks)
  const functions = useProjectStore((state) => state.project.functions)
  const [queue, setQueue] = useState<ComfyServerQueue>()
  const [error, setError] = useState<string>()
  const [refreshing, setRefreshing] = useState(false)
  const [confirm, setConfirm] = useState<{ kind: 'cancel'; item: ComfyServerQueueItem } | { kind: 'clear' }>()
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      setQueue(await projectStore.getState().fetchComfyServerQueue(endpoint.id))
      setError(undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }, [endpoint.id])

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0)
    const timer = window.setInterval(() => void refresh(), 2000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [refresh])

  const owner = (item: ComfyServerQueueItem) => {
    const task = item.taskId ? tasks[item.taskId] : undefined
    if (!task) return { mine: false, text: 'Another client' }
    const name = task.functionSnapshot?.name ?? functions[task.functionId]?.name ?? task.functionId
    return { mine: true, text: `This project · ${name} · Run ${task.runIndex}` }
  }

  const act = async (action: () => Promise<void>) => {
    setConfirm(undefined)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    await refresh()
  }

  const rows = (items: ComfyServerQueueItem[]) =>
    items.map((item) => {
      const who = owner(item)
      return (
        <li key={item.promptId} className={`server-queue-item is-${item.state}${who.mine ? ' is-mine' : ''}`}>
          <span className="server-queue-position">{item.state === 'running' ? 'Running' : `#${item.position}`}</span>
          <span className="server-queue-copy">
            <code title={item.promptId}>{shortId(item.promptId)}</code>
            <small>{who.text}</small>
          </span>
          <button
            type="button"
            className="danger-button"
            aria-label={`Cancel prompt ${item.promptId}`}
            onClick={() => setConfirm({ kind: 'cancel', item })}
          >
            <Square size={13} />
            {item.state === 'running' ? 'Interrupt' : 'Remove'}
          </button>
        </li>
      )
    })

  const label = `ComfyUI queue · ${endpoint.name}`
  return (
    <ServerDialog label={label} onClose={onClose}>
      <div className="server-tool-toolbar">
        <span className="server-tool-meta">
          {queue ? `${queue.running.length} running · ${queue.pending.length} pending` : 'Loading…'}
          {endpoint.enabled ? null : <em className="server-disabled-badge">Disabled</em>}
        </span>
        <button type="button" aria-label="Refresh queue" onClick={() => void refresh()} disabled={refreshing}>
          <RefreshCw size={14} />
          Refresh
        </button>
        <button
          type="button"
          className="danger-button"
          aria-label="Clear pending prompts"
          disabled={!queue?.pending.length}
          onClick={() => setConfirm({ kind: 'clear' })}
        >
          <Trash2 size={14} />
          Clear pending
        </button>
      </div>
      {error ? <div className="toast-error">{error}</div> : null}
      {queue ? (
        <div className="server-queue-sections">
          <section aria-label="Running prompts">
            <h4>Running</h4>
            {queue.running.length ? <ol className="server-queue-list">{rows(queue.running)}</ol> : <p className="empty-list">Nothing running</p>}
          </section>
          <section aria-label="Pending prompts">
            <h4>Pending</h4>
            {queue.pending.length ? <ol className="server-queue-list">{rows(queue.pending)}</ol> : <p className="empty-list">Queue is empty</p>}
          </section>
        </div>
      ) : null}
      {confirm?.kind === 'cancel' ? (
        <ConfirmationDialog
          label="Cancel prompt confirmation"
          title={confirm.item.state === 'running' ? 'Interrupt the running prompt?' : 'Remove this prompt from the queue?'}
          message={
            <>
              <code>{confirm.item.promptId}</code> · {owner(confirm.item).text}.{' '}
              {owner(confirm.item).mine ? 'Its run here ends as canceled.' : 'It belongs to another client on this server.'}
            </>
          }
          confirmLabel={confirm.item.state === 'running' ? 'Interrupt' : 'Remove'}
          onCancel={() => setConfirm(undefined)}
          onConfirm={() => void act(() => projectStore.getState().cancelComfyQueueItem(endpoint.id, confirm.item.promptId))}
        />
      ) : null}
      {confirm?.kind === 'clear' ? (
        <ConfirmationDialog
          label="Clear pending confirmation"
          title={queue?.pending.length === 1 ? 'Clear 1 pending prompt?' : `Clear ${queue?.pending.length ?? 0} pending prompts?`}
          message="Every waiting prompt on this server is removed, including other clients' prompts. Running prompts keep running; this project's removed runs end as canceled."
          confirmLabel="Clear pending"
          onCancel={() => setConfirm(undefined)}
          onConfirm={() => void act(() => projectStore.getState().clearComfyPendingQueue(endpoint.id))}
        />
      ) : null}
    </ServerDialog>
  )
}

const logTime = (time?: string) => (time && /T\d\d:\d\d:\d\d/.test(time) ? time.slice(11, 19) : time)

export function ComfyLogsDialog({ endpoint, onClose }: { endpoint: ComfyEndpointConfig; onClose: () => void }) {
  const [entries, setEntries] = useState<ComfyLogEntry[]>()
  const [supported, setSupported] = useState(true)
  const [error, setError] = useState<string>()
  const [follow, setFollow] = useState(true)
  const viewRef = useRef<HTMLPreElement | null>(null)

  useEffect(() => {
    let stopped = false
    const load = async () => {
      try {
        const result = await projectStore.getState().fetchComfyServerLogs(endpoint.id)
        if (stopped) return
        setSupported(result.supported)
        if (result.supported) setEntries(result.entries)
        setError(undefined)
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : String(err))
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 2000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [endpoint.id])

  useEffect(() => {
    const view = viewRef.current
    if (follow && view) view.scrollTop = view.scrollHeight
  }, [entries, follow])

  const text = (entries ?? []).map((entry) => `${entry.time ? `${logTime(entry.time)}  ` : ''}${entry.message.replace(/\n$/, '')}`).join('\n')
  return (
    <ServerDialog label={`ComfyUI logs · ${endpoint.name}`} wide onClose={onClose}>
      <div className="server-tool-toolbar">
        <span className="server-tool-meta">{entries ? `${entries.length} entries · refreshes every 2 s` : supported ? 'Loading…' : ''}</span>
        <label className="inline-check server-log-follow">
          <input type="checkbox" aria-label="Follow latest logs" checked={follow} onChange={(event) => setFollow(event.target.checked)} />
          Follow latest
        </label>
      </div>
      {error ? (
        <div className="toast-error">
          {error}
          {entries ? null : (
            <> — if the server is otherwise online, it may be an older ComfyUI without the log API (/internal/logs).</>
          )}
        </div>
      ) : null}
      {supported ? (
        <pre
          ref={viewRef}
          className="server-log-view"
          aria-label="ComfyUI log output"
          tabIndex={0}
          onScroll={(event) => {
            const view = event.currentTarget
            const atBottom = view.scrollHeight - view.scrollTop - view.clientHeight < 8
            if (follow !== atBottom) setFollow(atBottom)
          }}
        >
          {text}
        </pre>
      ) : (
        <p className="dialog-note is-warning" role="note">
          This ComfyUI server has no log API (<code>/internal/logs</code>, added in newer ComfyUI versions). Update ComfyUI,
          or read the log in the console window ComfyUI runs in.
        </p>
      )}
    </ServerDialog>
  )
}
