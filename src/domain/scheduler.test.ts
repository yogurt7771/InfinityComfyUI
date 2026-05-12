import { describe, expect, it } from 'vitest'
import { selectEndpoint } from './scheduler'
import type { ComfyEndpointConfig } from './types'

const endpoint = (overrides: Partial<ComfyEndpointConfig>): ComfyEndpointConfig => ({
  id: overrides.id ?? 'endpoint',
  name: overrides.name ?? 'Endpoint',
  baseUrl: overrides.baseUrl ?? 'http://127.0.0.1:8188',
  enabled: overrides.enabled ?? true,
  maxConcurrentJobs: overrides.maxConcurrentJobs ?? 2,
  priority: overrides.priority ?? 1,
  timeoutMs: overrides.timeoutMs ?? 600000,
  health: overrides.health,
  capabilities: overrides.capabilities,
})

describe('selectEndpoint', () => {
  it('selects the least busy compatible endpoint with available capacity', () => {
    const endpoints = [
      endpoint({ id: 'a', maxConcurrentJobs: 2, priority: 5, capabilities: { supportedFunctions: ['render'] } }),
      endpoint({ id: 'b', maxConcurrentJobs: 2, priority: 1, capabilities: { supportedFunctions: ['render'] } }),
      endpoint({ id: 'c', maxConcurrentJobs: 2, priority: 10, capabilities: { supportedFunctions: ['other'] } }),
      endpoint({ id: 'd', enabled: false }),
    ]

    const selected = selectEndpoint(endpoints, { a: 1, b: 0, c: 0, d: 0 }, 'render')

    expect(selected?.id).toBe('b')
  })

  it('uses priority when eligible endpoints are equally busy', () => {
    const selected = selectEndpoint(
      [
        endpoint({ id: 'a', priority: 1 }),
        endpoint({ id: 'b', priority: 10 }),
      ],
      { a: 0, b: 0 },
    )

    expect(selected?.id).toBe('b')
  })
})

