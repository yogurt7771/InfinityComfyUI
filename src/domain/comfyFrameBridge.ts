import type { ComfyUiWorkflow, ComfyWorkflow } from './types'

const COMFY_FRAME_BRIDGE_CHANNEL = 'infinity-comfy-editor-v1'

type BridgeResponse<T> = {
  channel?: string
  type?: string
  id?: string
  payload?: T
  error?: string
}

type BridgePing = { ready?: boolean; pathname?: string; loginRequired?: boolean }

export type ComfyFrameExport = {
  rawJson: ComfyWorkflow
  uiJson?: ComfyUiWorkflow
}

export class ComfyFrameLoginRequiredError extends Error {}

const abortError = () => new DOMException('ComfyUI editor request was cancelled', 'AbortError')

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })

export function requestComfyFrame<T>(
  frame: HTMLIFrameElement,
  frameOrigin: string,
  command: string,
  payload?: unknown,
  timeoutMs = 1500,
  signal?: AbortSignal,
) {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const frameWindow = frame.contentWindow
    if (!frameWindow) {
      reject(new Error('ComfyUI editor frame is unavailable'))
      return
    }

    const requestId = crypto.randomUUID()
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('ComfyUI editor bridge timed out'))
    }, timeoutMs)
    const cleanup = () => {
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(abortError())
    }
    const onMessage = (event: MessageEvent<BridgeResponse<T>>) => {
      const message = event.data
      if (
        event.source !== frameWindow ||
        event.origin !== frameOrigin ||
        message?.channel !== COMFY_FRAME_BRIDGE_CHANNEL ||
        message.type !== 'response' ||
        message.id !== requestId
      ) {
        return
      }
      cleanup()
      if (message.error) reject(new Error(message.error))
      else resolve(message.payload as T)
    }
    window.addEventListener('message', onMessage)
    signal?.addEventListener('abort', onAbort, { once: true })
    frameWindow.postMessage(
      { channel: COMFY_FRAME_BRIDGE_CHANNEL, type: 'request', id: requestId, command, payload },
      frameOrigin,
    )
  })
}

export async function waitForComfyFrameBridge(
  frame: HTMLIFrameElement,
  frameOrigin: string,
  signal?: AbortSignal,
) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (signal?.aborted) throw abortError()
    try {
      const result = await requestComfyFrame<BridgePing>(frame, frameOrigin, 'ping', undefined, 350, signal)
      if (result.loginRequired || result.pathname?.includes('/login')) {
        throw new ComfyFrameLoginRequiredError('ComfyUI login page opened')
      }
      if (result.ready) return
    } catch (error) {
      if (error instanceof ComfyFrameLoginRequiredError) throw error
      if (signal?.aborted) throw error
      if (error instanceof Error && error.message.includes('authorization was not approved')) throw error
    }
    await wait(150, signal)
  }
  throw new Error('ComfyUI editor is not ready yet')
}

export const loadUiWorkflowIntoComfyFrame = (
  frame: HTMLIFrameElement,
  frameOrigin: string,
  workflow: ComfyUiWorkflow,
) => requestComfyFrame(frame, frameOrigin, 'load-ui', workflow, 15_000)

export const loadApiWorkflowIntoComfyFrame = (
  frame: HTMLIFrameElement,
  frameOrigin: string,
  workflow: ComfyWorkflow,
) => requestComfyFrame(frame, frameOrigin, 'load-api', workflow, 15_000)

export const exportWorkflowFromComfyFrame = (frame: HTMLIFrameElement, frameOrigin: string) =>
  requestComfyFrame<ComfyFrameExport>(frame, frameOrigin, 'export', undefined, 15_000)
