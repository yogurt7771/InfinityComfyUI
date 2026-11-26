import type { ComfyEndpointConfig } from './types'

export type ComfyRunAvailability =
  | { ok: true; endpointIds: string[] }
  | { ok: false; reason: 'no_servers' | 'none_allowed' | 'all_disabled' | 'none_online'; message: string }

const names = (endpoints: ComfyEndpointConfig[]) => endpoints.map((endpoint) => endpoint.name || endpoint.id).join(', ')

/** Which servers the scheduler may send a saved ComfyUI function to, and if none, why — in words the user can act on. */
export function comfyRunAvailability(
  endpoints: ComfyEndpointConfig[],
  functionId: string,
  functionName: string,
): ComfyRunAvailability {
  const allowed = endpoints.filter((endpoint) => {
    const supported = endpoint.capabilities?.supportedFunctions
    return supported === undefined || supported.includes(functionId)
  })
  const enabled = allowed.filter((endpoint) => endpoint.enabled)
  const eligible = enabled.filter((endpoint) => {
    const status = endpoint.health?.status ?? 'unknown'
    return status === 'unknown' || status === 'online'
  })
  if (eligible.length) return { ok: true, endpointIds: eligible.map((endpoint) => endpoint.id) }

  const name = `"${functionName}"`
  if (!endpoints.length) {
    return { ok: false, reason: 'no_servers', message: `No ComfyUI server is set up to run ${name}. Add one in ComfyUI Servers.` }
  }
  if (!allowed.length) {
    return {
      ok: false,
      reason: 'none_allowed',
      message: `No ComfyUI server is allowed to run ${name}. Allow one in Function Management.`,
    }
  }
  if (!enabled.length) {
    return {
      ok: false,
      reason: 'all_disabled',
      message: `Every ComfyUI server allowed to run ${name} is disabled (${names(allowed)}). Enable one in ComfyUI Servers, then run again.`,
    }
  }
  return {
    ok: false,
    reason: 'none_online',
    message: `No ComfyUI server allowed to run ${name} is online (${enabled
      .map((endpoint) => `${endpoint.name || endpoint.id}: ${endpoint.health?.status ?? 'unknown'}`)
      .join(', ')}). Check the servers in ComfyUI Servers, then run again.`,
  }
}
