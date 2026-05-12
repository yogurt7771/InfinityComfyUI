import { describe, expect, it, vi } from 'vitest'
import { runComfyPrompt } from './comfyRunner'

describe('runComfyPrompt', () => {
  it('queues a workflow and polls history until outputs are available', async () => {
    const client = {
      queuePrompt: vi.fn().mockResolvedValue({ prompt_id: 'prompt_1', number: 1 }),
      getHistory: vi
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ prompt_1: { outputs: { '20': { images: [] } } } }),
    }
    const wait = vi.fn().mockResolvedValue(undefined)

    const result = await runComfyPrompt(client, { '3': { inputs: { seed: 1 } } }, {
      maxPollAttempts: 3,
      pollIntervalMs: 10,
      wait,
    })

    expect(result.promptId).toBe('prompt_1')
    expect(result.history).toEqual({ prompt_1: { outputs: { '20': { images: [] } } } })
    expect(client.getHistory).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledWith(10)
  })

  it('throws when outputs do not arrive before the poll limit', async () => {
    const client = {
      queuePrompt: vi.fn().mockResolvedValue({ prompt_id: 'prompt_1', number: 1 }),
      getHistory: vi.fn().mockResolvedValue({}),
    }

    await expect(
      runComfyPrompt(client, {}, {
        maxPollAttempts: 2,
        pollIntervalMs: 1,
        wait: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toThrow('ComfyUI generation timed out')
  })
})

