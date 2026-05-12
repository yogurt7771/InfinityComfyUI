import type { ComfyViewFileParams } from './comfyClient'
import type { ComfyEndpointConfig, Resource } from './types'

export type ComfyServerClient = {
  getHistory?: (promptId: string) => Promise<unknown>
  viewFile?: (params: ComfyViewFileParams) => Promise<Blob>
}

const mediaValue = (resource: Resource) =>
  typeof resource.value === 'object' && resource.value !== null && 'url' in resource.value ? resource.value : undefined

const fileFromUrl = (url: string): ComfyViewFileParams | undefined => {
  try {
    const parsed = new URL(url)
    const filename = parsed.searchParams.get('filename')
    if (!filename) return undefined
    return {
      filename,
      subfolder: parsed.searchParams.get('subfolder') ?? '',
      type: parsed.searchParams.get('type') ?? 'output',
    }
  } catch {
    return undefined
  }
}

export const comfyFileFromResource = (
  resource: Resource,
  endpoint?: Pick<ComfyEndpointConfig, 'id'>,
): ComfyViewFileParams | undefined => {
  const media = mediaValue(resource)
  if (!media) return undefined

  if (media.comfy) {
    if (endpoint && media.comfy.endpointId !== endpoint.id) return undefined
    return {
      filename: media.comfy.filename,
      subfolder: media.comfy.subfolder ?? '',
      type: media.comfy.type,
    }
  }

  if (endpoint && resource.metadata?.endpointId !== endpoint.id) return undefined
  if (!resource.metadata?.endpointId) return undefined
  return fileFromUrl(media.url)
}

export class ComfyServer {
  readonly endpoint: ComfyEndpointConfig
  private readonly client: ComfyServerClient

  constructor(endpoint: ComfyEndpointConfig, client: ComfyServerClient) {
    this.endpoint = endpoint
    this.client = client
  }

  canReadResource(resource: Resource) {
    return Boolean(comfyFileFromResource(resource, this.endpoint))
  }

  async readResourceBlob(resource: Resource) {
    const file = comfyFileFromResource(resource, this.endpoint)
    if (!file) throw new Error(`Resource is not available from ComfyUI endpoint: ${resource.id}`)
    if (!this.client.viewFile) throw new Error(`ComfyUI endpoint cannot fetch files: ${this.endpoint.id}`)
    return this.client.viewFile(file)
  }

  async getHistory(promptId: string) {
    if (!this.client.getHistory) throw new Error(`ComfyUI endpoint cannot fetch history: ${this.endpoint.id}`)
    return this.client.getHistory(promptId)
  }
}
