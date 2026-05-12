import type { ComfyWorkflow } from './types'

export type ComfyPromptClient = {
  queuePrompt: (workflow: ComfyWorkflow) => Promise<{ prompt_id: string; number: number }>
  getHistory: (promptId: string) => Promise<unknown>
}

type RunComfyPromptOptions = {
  maxPollAttempts?: number
  pollIntervalMs?: number
  wait?: (ms: number) => Promise<void>
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

function hasOutputs(history: unknown, promptId: string) {
  if (!history || typeof history !== 'object') return false
  const promptHistory = (history as Record<string, unknown>)[promptId]
  if (!promptHistory || typeof promptHistory !== 'object') return false
  return 'outputs' in promptHistory
}

export async function runComfyPrompt(
  client: ComfyPromptClient,
  workflow: ComfyWorkflow,
  options: RunComfyPromptOptions = {},
): Promise<{ promptId: string; history: unknown }> {
  const maxPollAttempts = options.maxPollAttempts ?? 600
  const pollIntervalMs = options.pollIntervalMs ?? 1000
  const wait = options.wait ?? sleep
  const queued = await client.queuePrompt(workflow)
  const promptId = queued.prompt_id

  for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
    const history = await client.getHistory(promptId)
    if (hasOutputs(history, promptId)) {
      return { promptId, history }
    }
    if (attempt < maxPollAttempts - 1) await wait(pollIntervalMs)
  }

  throw new Error(`ComfyUI generation timed out for prompt_id=${promptId}`)
}
