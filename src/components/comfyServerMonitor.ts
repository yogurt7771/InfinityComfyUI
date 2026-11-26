import { useEffect, useState } from 'react'
import type { ComfyEndpointConfig } from '../domain/types'
import { projectStore } from '../store/projectStore'

/** What ComfyUI itself reports for a server right now (not this project's own task counts). */
export type ComfyServerLiveState = {
  state: 'checking' | 'online' | 'offline'
  running: number
  pending: number
  /** The status websocket is connected, so changes arrive as they happen. */
  live: boolean
  error?: string
}

const INITIAL_LIVE_STATE: ComfyServerLiveState = { state: 'checking', running: 0, pending: 0, live: false }
const POLL_MS = 3000
const POLL_WITH_SOCKET_MS = 10000
const SOCKET_EVENTS = new Set(['status', 'execution_start', 'execution_success', 'execution_error', 'execution_interrupted', 'executing'])

/**
 * Watches each server's queue while `active`: ComfyUI's status websocket when it connects (a refresh on every queue or
 * execution event), polling `/queue` as the fallback and as a slow safety net.
 */
export function useComfyServerMonitor(endpoints: ComfyEndpointConfig[], active: boolean) {
  const [states, setStates] = useState<Record<string, ComfyServerLiveState>>({})
  const endpointKey = endpoints.map((endpoint) => `${endpoint.id}|${endpoint.baseUrl}`).join('\n')

  useEffect(() => {
    if (!active) return
    const ids = endpointKey ? endpointKey.split('\n').map((line) => line.split('|')[0]!) : []
    const stops = ids.map((endpointId) => {
      let stopped = false
      let live = false
      let timer: number | undefined
      let socket: WebSocket | undefined
      const update = (patch: Partial<ComfyServerLiveState>) =>
        setStates((current) => ({
          ...current,
          [endpointId]: { ...INITIAL_LIVE_STATE, ...current[endpointId], ...patch },
        }))
      const schedule = (ms: number) => {
        window.clearTimeout(timer)
        if (!stopped) timer = window.setTimeout(() => void refresh(), ms)
      }
      const refresh = async () => {
        window.clearTimeout(timer)
        try {
          const queue = await projectStore.getState().fetchComfyServerQueue(endpointId)
          if (stopped) return
          update({ state: 'online', running: queue.running.length, pending: queue.pending.length, live, error: undefined })
        } catch (err) {
          if (stopped) return
          update({ state: 'offline', running: 0, pending: 0, live, error: err instanceof Error ? err.message : String(err) })
        }
        schedule(live ? POLL_WITH_SOCKET_MS : POLL_MS)
      }

      update({ state: 'checking' })
      void refresh()
      try {
        const url = projectStore.getState().comfyServerWebSocketUrl(endpointId)
        if (url) {
          socket = new WebSocket(url)
          socket.onopen = () => {
            live = true
            update({ live })
          }
          socket.onclose = () => {
            live = false
            if (!stopped) update({ live })
          }
          socket.onmessage = (event) => {
            if (typeof event.data !== 'string') return
            try {
              const message = JSON.parse(event.data) as { type?: string }
              if (message.type && SOCKET_EVENTS.has(message.type)) schedule(150)
            } catch {
              // Not a JSON event: nothing to refresh for.
            }
          }
        }
      } catch {
        // No websocket (bad URL, blocked): polling alone keeps the view current.
      }
      return () => {
        stopped = true
        window.clearTimeout(timer)
        socket?.close()
      }
    })
    return () => stops.forEach((stop) => stop())
  }, [active, endpointKey])

  return states
}

export function serverLiveSummary(state: ComfyServerLiveState | undefined) {
  if (!state || state.state === 'checking') return 'Checking…'
  if (state.state === 'offline') return 'Offline'
  if (state.running > 0) return `Running · ${state.pending} pending`
  return state.pending > 0 ? `Online · ${state.pending} pending` : 'Online · idle'
}
