import type { FunctionInputDef, GenerationFunction, PrimitiveInputValue, ProjectState, ResourceRef, ResourceType } from './types'

const isPrimitiveInputValue = (value: unknown): value is PrimitiveInputValue =>
  typeof value === 'string' || typeof value === 'number' || value === null

const isResourceRef = (value: unknown): value is ResourceRef =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { resourceId?: unknown }).resourceId === 'string' &&
  typeof (value as { type?: unknown }).type === 'string'

const primitiveInputDefault = (type: ResourceType) => {
  if (type === 'number') return 0
  if (type === 'text') return ''
  return undefined
}

const primitiveFromPath = (source: unknown, path: string | undefined) => {
  if (!source || typeof source !== 'object' || !path) return undefined

  let cursor: unknown = source
  for (const segment of path.split('.').filter(Boolean)) {
    if (!cursor || typeof cursor !== 'object' || !(segment in cursor)) return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }

  return isPrimitiveInputValue(cursor) ? cursor : undefined
}

const workflowPrimitiveInputValue = (functionDef: GenerationFunction, input: FunctionInputDef) => {
  const workflow = functionDef.workflow.rawJson
  const workflowNode =
    (input.bind.nodeId ? workflow[input.bind.nodeId] : undefined) ??
    Object.values(workflow).find((node) => input.bind.nodeTitle && node._meta?.title === input.bind.nodeTitle)

  return primitiveFromPath(workflowNode, input.bind.path)
}

const normalizedPrimitiveValue = (type: ResourceType, value: PrimitiveInputValue | undefined) => {
  if (value === undefined || value === null) return primitiveInputDefault(type)
  if (type === 'number') {
    const numericValue = Number(value)
    return Number.isFinite(numericValue) ? numericValue : 0
  }
  if (type === 'text') return String(value)
  return undefined
}

export function targetInputInitialResourceValue(
  project: ProjectState,
  targetNodeId: string,
  targetInputKey: string,
): string | number | undefined {
  const targetNode = project.canvas.nodes.find((node) => node.id === targetNodeId && node.type === 'function')
  const functionId = typeof targetNode?.data.functionId === 'string' ? targetNode.data.functionId : undefined
  const functionDef = functionId ? project.functions[functionId] : undefined
  const input = functionDef?.inputs.find((item) => item.key === targetInputKey)

  if (!targetNode || !functionDef || !input || (input.type !== 'text' && input.type !== 'number')) return undefined

  const inputValues = (targetNode.data.inputValues ?? {}) as Record<string, unknown>
  const localValue = inputValues[targetInputKey]
  if (isPrimitiveInputValue(localValue)) {
    return normalizedPrimitiveValue(input.type, localValue)
  }
  if (isResourceRef(localValue)) {
    const resourceValue = project.resources[localValue.resourceId]?.value
    if (isPrimitiveInputValue(resourceValue)) {
      return normalizedPrimitiveValue(input.type, resourceValue)
    }
  }

  const workflowValue = workflowPrimitiveInputValue(functionDef, input)
  if (workflowValue !== undefined) {
    return normalizedPrimitiveValue(input.type, workflowValue)
  }

  return normalizedPrimitiveValue(input.type, input.defaultValue)
}
