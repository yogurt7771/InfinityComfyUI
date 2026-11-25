import type { FunctionInputDef, PrimitiveInputValue, Resource, ResourceRef } from '../domain/types'
import { isMediaResourceType } from '../domain/workflow'

export type RunInputPartition = {
  visible: FunctionInputDef[]
  collapsed: FunctionInputDef[]
}

const isFilledMediaInput = (
  value: PrimitiveInputValue | ResourceRef | undefined,
  resourcesById: Record<string, Resource>,
) => typeof value === 'object' && value !== null && 'resourceId' in value && Boolean(resourcesById[value.resourceId])

/**
 * Long optional media input lists (Image 1–10) show what is filled plus one empty slot per media type;
 * the remaining empty optional slots collapse. Required and non-media inputs always stay visible.
 */
export function partitionRunInputs(
  inputs: FunctionInputDef[],
  values: Record<string, PrimitiveInputValue | ResourceRef>,
  resourcesById: Record<string, Resource>,
): RunInputPartition {
  const visible: FunctionInputDef[] = []
  const collapsed: FunctionInputDef[] = []
  const emptySlotShown = new Set<string>()
  for (const input of inputs) {
    if (input.required || !isMediaResourceType(input.type) || isFilledMediaInput(values[input.key], resourcesById)) {
      visible.push(input)
    } else if (!emptySlotShown.has(input.type)) {
      emptySlotShown.add(input.type)
      visible.push(input)
    } else {
      collapsed.push(input)
    }
  }
  // Hiding a single input saves nothing and costs a click.
  if (collapsed.length < 2) return { visible: [...inputs], collapsed: [] }
  return { visible, collapsed }
}
