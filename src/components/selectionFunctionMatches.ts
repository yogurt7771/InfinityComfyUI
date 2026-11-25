import { isBuiltInFunction } from '../domain/builtInFunctions'
import type { GenerationFunction, PrimitiveInputValue, Resource, ResourceRef, ResourceType } from '../domain/types'
import { workflowPrimitiveInputValue } from '../domain/workflow'

export type FunctionRunInputValues = Record<string, PrimitiveInputValue | ResourceRef>

const MEDIA_INPUT_TYPES = new Set<ResourceType>(['image', 'video', 'audio'])

const isResourceRef = (value: unknown): value is ResourceRef =>
  typeof value === 'object' && value !== null && typeof (value as ResourceRef).resourceId === 'string'

/**
 * Fills a function's inputs from candidate resources: each input takes the first unused candidate of its
 * type, in candidate order; primitive inputs without a candidate fall back to their default.
 */
export const buildFunctionRunInputDraft = (
  functionDef: GenerationFunction,
  resourcesById: Record<string, Resource>,
  candidateRefs: ResourceRef[],
) => {
  const usedResourceIds = new Set<string>()
  const inputValues: FunctionRunInputValues = {}

  for (const input of functionDef.inputs) {
    const resourceRef = candidateRefs.find((ref) => {
      if (usedResourceIds.has(ref.resourceId) || ref.type !== input.type) return false
      return Boolean(resourcesById[ref.resourceId])
    })

    if (resourceRef) {
      inputValues[input.key] = resourceRef
      usedResourceIds.add(resourceRef.resourceId)
      continue
    }

    if (input.type === 'text' || input.type === 'number' || input.type === 'boolean') {
      inputValues[input.key] =
        input.defaultValue ??
        workflowPrimitiveInputValue(functionDef, input) ??
        (input.type === 'number' ? 0 : input.type === 'boolean' ? false : '')
    }
  }

  return inputValues
}

export type SelectionFunctionMatch = {
  functionDef: GenerationFunction
  inputValues: FunctionRunInputValues
  /** Selected resources placed into inputs, in the function's input order. */
  usedResourceIds: string[]
}

/**
 * Functions the selected resources can feed. A function matches when the selection (in selection order)
 * fills at least one of its inputs and every required image/video/audio input. Ranked by how many selected
 * resources it uses, then custom before built-in, then name.
 */
export function matchFunctionsForSelection(
  functions: GenerationFunction[],
  resourcesById: Record<string, Resource>,
  selectedRefs: ResourceRef[],
): SelectionFunctionMatch[] {
  const seen = new Set<string>()
  const candidates = selectedRefs.filter((ref) => {
    if (seen.has(ref.resourceId) || !resourcesById[ref.resourceId]) return false
    seen.add(ref.resourceId)
    return true
  })
  if (candidates.length === 0) return []

  const matches = functions.flatMap((functionDef) => {
    const inputValues = buildFunctionRunInputDraft(functionDef, resourcesById, candidates)
    const usedResourceIds = functionDef.inputs.flatMap((input) => {
      const value = inputValues[input.key]
      return isResourceRef(value) ? [value.resourceId] : []
    })
    if (usedResourceIds.length === 0) return []
    const missingRequiredMedia = functionDef.inputs.some(
      (input) => input.required && MEDIA_INPUT_TYPES.has(input.type) && !isResourceRef(inputValues[input.key]),
    )
    return missingRequiredMedia ? [] : [{ functionDef, inputValues, usedResourceIds }]
  })

  return matches.sort(
    (left, right) =>
      right.usedResourceIds.length - left.usedResourceIds.length ||
      Number(isBuiltInFunction(left.functionDef)) - Number(isBuiltInFunction(right.functionDef)) ||
      left.functionDef.name.localeCompare(right.functionDef.name),
  )
}

type PositionedNode = { id: string; position: { x: number; y: number } }

const READING_ROW_TOLERANCE = 48

/** Orders node ids top-to-bottom, then left-to-right within a row (nodes whose tops are within a small band). */
export function readingOrderNodeIds(nodes: PositionedNode[], nodeIds: string[]) {
  const positionsById = new Map(nodes.map((node) => [node.id, node.position]))
  const known = nodeIds.filter((nodeId) => positionsById.has(nodeId))
  const unknown = nodeIds.filter((nodeId) => !positionsById.has(nodeId))
  const byTop = [...known].sort((left, right) => positionsById.get(left)!.y - positionsById.get(right)!.y)
  const rows: string[][] = []
  let rowTop = Number.NEGATIVE_INFINITY
  for (const nodeId of byTop) {
    const top = positionsById.get(nodeId)!.y
    if (rows.length === 0 || top - rowTop > READING_ROW_TOLERANCE) {
      rows.push([nodeId])
      rowTop = top
    } else {
      rows.at(-1)!.push(nodeId)
    }
  }
  return [
    ...rows.flatMap((row) => row.sort((left, right) => positionsById.get(left)!.x - positionsById.get(right)!.x)),
    ...unknown,
  ]
}
