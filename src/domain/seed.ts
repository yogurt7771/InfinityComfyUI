import type { ComfyWorkflow, SeedPatchRecord } from './types'

type SeedRandomizeOptions = {
  randomInt?: (min: number, max: number) => number
  now?: () => string
  range?: {
    min: number
    max: number
  }
}

const DEFAULT_RANGE = {
  min: 0,
  max: 2147483647,
}

const cloneWorkflow = (workflow: ComfyWorkflow): ComfyWorkflow =>
  structuredClone(workflow) as ComfyWorkflow

const defaultRandomInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min

const isPatchableSeedValue = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string' && value.trim() !== '') return Number.isFinite(Number(value))
  return false
}

export function randomizeWorkflowSeeds(
  workflow: ComfyWorkflow,
  options: SeedRandomizeOptions = {},
): { workflow: ComfyWorkflow; patchLog: SeedPatchRecord[] } {
  const compiled = cloneWorkflow(workflow)
  const patchLog: SeedPatchRecord[] = []
  const range = options.range ?? DEFAULT_RANGE
  const randomInt = options.randomInt ?? defaultRandomInt
  const now = options.now ?? (() => new Date().toISOString())

  for (const [nodeId, node] of Object.entries(compiled)) {
    if (!node.inputs) continue

    for (const [inputKey, oldValue] of Object.entries(node.inputs)) {
      if (!inputKey.toLowerCase().includes('seed')) continue
      if (!isPatchableSeedValue(oldValue)) continue

      const newValue = randomInt(range.min, range.max)
      node.inputs[inputKey] = newValue
      patchLog.push({
        nodeId,
        nodeTitle: node._meta?.title,
        nodeClassType: node.class_type,
        path: `${nodeId}.inputs.${inputKey}`,
        oldValue,
        newValue,
        patchedAt: now(),
      })
    }
  }

  return { workflow: compiled, patchLog }
}

