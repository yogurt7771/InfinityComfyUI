import { parseComfyLogs, parseComfyQueue, type ComfyLogEntry, type ComfyQueueSnapshot } from './comfyQueue'
import type { ComfyWorkflow } from './types'

type FetchLike = typeof fetch

export type ComfyClientOptions = {
  baseUrl: string
  clientId: string
  token?: string
  headers?: Record<string, string>
  fetchImpl?: FetchLike
}

export type ComfyViewFileParams = {
  filename: string
  subfolder?: string
  type: string
}

export type ComfyUploadImageOptions = {
  subfolder?: string
  overwrite?: boolean
}

export type ComfyLogsResult = { supported: true; entries: ComfyLogEntry[] } | { supported: false }

export type ComfyUploadImageResult = {
  name: string
  subfolder?: string
  type: string
}

const MAX_ERROR_BODY_LENGTH = 8000

type ComfyErrorItem = { type?: unknown; message?: unknown; details?: unknown }

const errorItemText = (item: ComfyErrorItem) =>
  [item.message, item.details].filter((part) => typeof part === 'string' && part.trim()).join(': ')

/**
 * The readable part of ComfyUI's error body. `/prompt` answers a failed validation with
 * `{error: {type, message, details}, node_errors: {[nodeId]: {class_type, errors: [{message, details}]}}}`.
 */
const comfyErrorSummary = (body: string) => {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []
  const { error, node_errors: nodeErrors } = parsed as { error?: unknown; node_errors?: unknown }
  const lines: string[] = []
  if (typeof error === 'string') lines.push(error)
  else if (error && typeof error === 'object' && typeof (error as ComfyErrorItem).message === 'string') {
    lines.push(String((error as ComfyErrorItem).message))
  }
  if (nodeErrors && typeof nodeErrors === 'object') {
    for (const [nodeId, entry] of Object.entries(nodeErrors as Record<string, unknown>)) {
      const { class_type: classType, errors } = (entry ?? {}) as { class_type?: unknown; errors?: unknown }
      const node = `${typeof classType === 'string' ? classType : 'Node'} #${nodeId}`
      for (const item of Array.isArray(errors) ? errors : []) {
        const text = errorItemText((item ?? {}) as ComfyErrorItem)
        if (text) lines.push(`${node}: ${text}`)
      }
    }
  }
  return lines
}

/** A non-2xx answer from ComfyUI, with the response body as ComfyUI sent it. */
export class ComfyRequestError extends Error {
  readonly status: number
  readonly body: string

  constructor(method: string, path: string, status: number, body: string) {
    const shownBody =
      body.length > MAX_ERROR_BODY_LENGTH
        ? `${body.slice(0, MAX_ERROR_BODY_LENGTH)}… (${body.length - MAX_ERROR_BODY_LENGTH} more characters)`
        : body
    super(
      [
        `ComfyUI request failed: ${status} (${method} ${path})`,
        ...comfyErrorSummary(body),
        ...(shownBody.trim() ? [`Response body: ${shownBody}`] : []),
      ].join('\n'),
    )
    this.name = 'ComfyRequestError'
    this.status = status
    this.body = body
  }
}

const requestPath = (url: string) => {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

const failedRequest = async (method: string, url: string, response: Response) => {
  let body = ''
  try {
    body = await response.text()
  } catch {
    // The status alone still says what failed.
  }
  return new ComfyRequestError(method, requestPath(url), response.status, body)
}

export class ComfyClient {
  private readonly baseUrl: string
  private readonly clientId: string
  private readonly token?: string
  private readonly headers: Record<string, string>
  private readonly fetchImpl: FetchLike

  constructor(options: ComfyClientOptions) {
    const baseUrl = new URL(options.baseUrl)
    baseUrl.search = ''
    baseUrl.hash = ''
    this.baseUrl = baseUrl.toString().replace(/\/+$/, '')
    this.clientId = options.clientId
    this.token = options.token
    this.headers = Object.fromEntries(
      Object.entries(options.headers ?? {})
        .map(([key, value]) => [key.trim(), value] as const)
        .filter(([key]) => key && (!this.token || key.toLowerCase() !== 'authorization')),
    )
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  async testConnection() {
    return this.getJson('/system_stats')
  }

  async getObjectInfo() {
    return this.getJson('/object_info')
  }

  async getSystemStats() {
    return this.getJson('/system_stats')
  }

  async queuePrompt(workflow: ComfyWorkflow): Promise<{ prompt_id: string; number: number }> {
    return this.postJson('/prompt', { prompt: workflow, client_id: this.clientId })
  }

  async getHistory(promptId: string): Promise<unknown> {
    return this.getJson(`/history/${encodeURIComponent(promptId)}`)
  }

  /** With a prompt id ComfyUI interrupts only that prompt, and only while it runs; without one, whatever runs. */
  async interrupt(promptId?: string) {
    const url = `${this.baseUrl}/interrupt`
    const response = await this.fetchImpl(
      url,
      promptId
        ? {
            method: 'POST',
            headers: { ...this.requestHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_id: promptId }),
          }
        : { method: 'POST', headers: this.requestHeaders() },
    )

    if (!response.ok) throw await failedRequest('POST', url, response)
    return response
  }

  async getQueue(): Promise<ComfyQueueSnapshot> {
    return parseComfyQueue(await this.getJson('/queue'))
  }

  /** Removes pending prompts; running ones are left alone (see `interrupt`). */
  async deleteQueueItems(promptIds: string[]) {
    await this.post('/queue', { delete: promptIds })
  }

  /** Removes every pending prompt, from any client. */
  async clearPendingQueue() {
    await this.post('/queue', { clear: true })
  }

  /** ComfyUI's log buffer. `/internal/*` is meant for its own frontend and older versions lack it. */
  async getLogs(): Promise<ComfyLogsResult> {
    for (const path of ['/internal/logs/raw', '/internal/logs']) {
      const url = `${this.baseUrl}${path}`
      const response = await this.fetchImpl(url, { method: 'GET', headers: this.requestHeaders() })
      if (response.status === 404) continue
      return { supported: true, entries: parseComfyLogs(await this.readJson('GET', url, response)) }
    }
    return { supported: false }
  }

  async viewFile(params: ComfyViewFileParams): Promise<Blob> {
    const search = new URLSearchParams({
      filename: params.filename,
      subfolder: params.subfolder ?? '',
      type: params.type,
    })
    const url = `${this.baseUrl}/view?${search.toString()}`
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: this.requestHeaders(),
    })

    if (!response.ok) throw await failedRequest('GET', url, response)
    return response.blob()
  }

  async uploadImage(file: File, options: ComfyUploadImageOptions = {}): Promise<ComfyUploadImageResult> {
    const formData = new FormData()
    formData.set('image', file)
    if (options.subfolder) formData.set('subfolder', options.subfolder)
    formData.set('overwrite', options.overwrite ? 'true' : 'false')

    const url = `${this.baseUrl}/upload/image`
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: this.requestHeaders(),
      body: formData,
    })

    return this.readJson('POST', url, response)
  }

  createWebSocketUrl() {
    const url = new URL(this.baseUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/ws`
    url.search = new URLSearchParams({
      clientId: this.clientId,
      ...(this.token ? { token: this.token } : {}),
    }).toString()
    return url.toString()
  }

  private async getJson(path: string) {
    const url = `${this.baseUrl}${path}`
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: this.requestHeaders(),
    })

    return this.readJson('GET', url, response)
  }

  private async post(path: string, body: unknown) {
    const url = `${this.baseUrl}${path}`
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        ...this.requestHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw await failedRequest('POST', url, response)
    return response
  }

  private async postJson(path: string, body: unknown) {
    const response = await this.post(path, body)
    return response.json()
  }

  private async readJson(method: string, url: string, response: Response) {
    if (!response.ok) throw await failedRequest(method, url, response)
    return response.json()
  }

  private requestHeaders(): Record<string, string> {
    return {
      ...this.headers,
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    }
  }
}
