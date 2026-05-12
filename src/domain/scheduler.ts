import type { ComfyEndpointConfig } from './types'

const isHealthyEnough = (endpoint: ComfyEndpointConfig) => {
  const status = endpoint.health?.status ?? 'unknown'
  return status === 'unknown' || status === 'online'
}

const supportsFunction = (endpoint: ComfyEndpointConfig, functionId?: string) => {
  if (!functionId) return true
  const supported = endpoint.capabilities?.supportedFunctions
  return !supported || supported.length === 0 || supported.includes(functionId)
}

export function selectEndpoint(
  endpoints: ComfyEndpointConfig[],
  activeJobsByEndpointId: Record<string, number>,
  functionId?: string,
): ComfyEndpointConfig | null {
  const eligible = endpoints
    .filter((endpoint) => endpoint.enabled)
    .filter(isHealthyEnough)
    .filter((endpoint) => supportsFunction(endpoint, functionId))
    .filter((endpoint) => (activeJobsByEndpointId[endpoint.id] ?? 0) < endpoint.maxConcurrentJobs)

  if (eligible.length === 0) return null

  return [...eligible].sort((left, right) => {
    const leftBusy = activeJobsByEndpointId[left.id] ?? 0
    const rightBusy = activeJobsByEndpointId[right.id] ?? 0
    if (leftBusy !== rightBusy) return leftBusy - rightBusy
    return right.priority - left.priority
  })[0]
}

