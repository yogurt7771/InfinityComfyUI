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

export type ComfyUploadImageResult = {
  name: string
  subfolder?: string
  type: string
}

export class ComfyClient {
  private readonly baseUrl: string
  private readonly clientId: string
  private readonly token?: string
  private readonly headers: Record<string, string>
  private readonly fetchImpl: FetchLike

  constructor(options: ComfyClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.clientId = options.clientId
    this.token = options.token
    this.headers = Object.fromEntries(
      Object.entries(options.headers ?? {})
        .map(([key, value]) => [key.trim(), value] as const)
        .filter(([key]) => key),
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
    const response = await this.fetchImpl(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: {
        ...this.requestHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: workflow, client_id: this.clientId }),
    })

    return this.readJson(response)
  }

  async getHistory(promptId: string): Promise<unknown> {
    return this.getJson(`/history/${encodeURIComponent(promptId)}`)
  }

  async interrupt() {
    const response = await this.fetchImpl(`${this.baseUrl}/interrupt`, {
      method: 'POST',
      headers: this.requestHeaders(),
    })

    if (!response.ok) throw new Error(`ComfyUI request failed: ${response.status}`)
    return response
  }

  async viewFile(params: ComfyViewFileParams): Promise<Blob> {
    const search = new URLSearchParams({
      filename: params.filename,
      subfolder: params.subfolder ?? '',
      type: params.type,
    })
    const response = await this.fetchImpl(`${this.baseUrl}/view?${search.toString()}`, {
      method: 'GET',
      headers: this.requestHeaders(),
    })

    if (!response.ok) throw new Error(`ComfyUI request failed: ${response.status}`)
    return response.blob()
  }

  async uploadImage(file: File, options: ComfyUploadImageOptions = {}): Promise<ComfyUploadImageResult> {
    const formData = new FormData()
    formData.set('image', file)
    if (options.subfolder) formData.set('subfolder', options.subfolder)
    formData.set('overwrite', options.overwrite ? 'true' : 'false')

    const response = await this.fetchImpl(`${this.baseUrl}/upload/image`, {
      method: 'POST',
      headers: this.requestHeaders(),
      body: formData,
    })

    return this.readJson(response)
  }

  createWebSocketUrl() {
    const url = new URL(this.baseUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = '/ws'
    url.search = new URLSearchParams({ clientId: this.clientId }).toString()
    return url.toString()
  }

  private async getJson(path: string) {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.requestHeaders(),
    })

    return this.readJson(response)
  }

  private async readJson(response: Response) {
    if (!response.ok) throw new Error(`ComfyUI request failed: ${response.status}`)
    return response.json()
  }

  private requestHeaders(): Record<string, string> {
    return {
      ...this.headers,
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    }
  }
}
