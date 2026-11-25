import type { CanvasNode, ExecutionTask, GenerationFunction, Resource } from './types'

/** Which output slot a result came from, and where it sits among that slot's results for its run. */
export type ResultSlotInfo = {
  outputKey: string
  label: string
  /** The slot is no longer in the function's current definition (disabled after the run). */
  removed: boolean
  /** 1-based position among the run's results for this slot (several when one slot returned a batch). */
  index: number
  count: number
  /** How many output slots the run had. */
  slotCount: number
}

const outputLabel = (functionDef: GenerationFunction | undefined, outputKey: string) => {
  const output = functionDef?.outputs.find((item) => item.key === outputKey)
  return output ? output.label || output.key : undefined
}

export function describeResultSlot(
  resource: Resource,
  task?: ExecutionTask,
  currentFunction?: GenerationFunction,
): ResultSlotInfo | undefined {
  const outputKey = resource.source.kind === 'function_output' ? resource.source.outputKey : undefined
  if (typeof outputKey !== 'string' || !outputKey) return undefined
  const runFunction = resource.metadata?.functionSnapshot ?? task?.functionSnapshot
  // A renamed slot relabels its old results; a disabled one keeps the name it had when they were made.
  const label = outputLabel(currentFunction, outputKey) ?? outputLabel(runFunction, outputKey) ?? outputKey
  const refs = task?.outputRefs?.[outputKey] ?? []
  const position = refs.findIndex((ref) => ref.resourceId === resource.id)
  const slotCount = runFunction ? runFunction.outputs.length : task?.outputRefs ? Object.keys(task.outputRefs).length : 1
  return {
    outputKey,
    label,
    removed: Boolean(currentFunction) && !currentFunction!.outputs.some((output) => output.key === outputKey),
    index: position >= 0 ? position + 1 : 1,
    count: position >= 0 ? refs.length : 1,
    slotCount: Math.max(1, slotCount),
  }
}

/** The tag a result node shows: only when the run had several slots, the slot returned a batch, or it was removed. */
export function resultSlotText(info: ResultSlotInfo | undefined): string | undefined {
  if (!info || (info.slotCount === 1 && info.count === 1 && !info.removed)) return undefined
  // ' · 2/3' marks a position in one slot's batch, so it can't be misread as a slot label such as 'Image 2'.
  return `${info.label}${info.count > 1 ? ` · ${info.index}/${info.count}` : ''}${info.removed ? ' (removed)' : ''}`
}

const imageUrl = (resource: Resource | undefined) => {
  const value = resource?.value
  return resource?.type === 'image' && typeof value === 'object' && value !== null && 'url' in value && typeof value.url === 'string'
    ? value.url
    : ''
}

const compareCandidates = (node: CanvasNode | undefined, resourcesById: Record<string, Resource>): Resource[] => {
  if (!node) return []
  if (node.type === 'resource') {
    const resource = resourcesById[String(node.data.resourceId)]
    return imageUrl(resource) ? [resource!] : []
  }
  if (node.type !== 'result_group' || !Array.isArray(node.data.resources)) return []
  return node.data.resources
    .map((ref) =>
      typeof ref === 'object' && ref !== null && 'resourceId' in ref
        ? resourcesById[String((ref as { resourceId: unknown }).resourceId)]
        : undefined,
    )
    .filter((resource): resource is Resource => Boolean(imageUrl(resource)))
}

const outputKeyOf = (resource: Resource) =>
  resource.source.kind === 'function_output' ? resource.source.outputKey : undefined

/** Two selected results to compare; when both come from multi-slot runs, the same slot is compared with itself. */
export function compareImagePair(
  left: CanvasNode | undefined,
  right: CanvasNode | undefined,
  resourcesById: Record<string, Resource>,
): { left: Resource; right: Resource } | undefined {
  const leftCandidates = compareCandidates(left, resourcesById)
  const rightCandidates = compareCandidates(right, resourcesById)
  if (!leftCandidates.length || !rightCandidates.length) return undefined
  for (const candidate of leftCandidates) {
    const key = outputKeyOf(candidate)
    const match = key ? rightCandidates.find((item) => outputKeyOf(item) === key) : undefined
    if (match) return { left: candidate, right: match }
  }
  return { left: leftCandidates[0]!, right: rightCandidates[0]! }
}
