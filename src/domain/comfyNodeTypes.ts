/** What a workflow needs to know about a ComfyUI node class: whether it is an output node and its input types. */
export type ComfyNodeTypeInfo = { outputNode: boolean; inputTypes: Record<string, string[]> }
export type ComfyNodeTypes = Record<string, ComfyNodeTypeInfo>

const plainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const specTypes = (spec: unknown): string[] | undefined => {
  if (!Array.isArray(spec)) return undefined
  const [type] = spec
  if (Array.isArray(type)) return ['COMBO']
  if (typeof type !== 'string') return undefined
  const types = type.split(',').map((item) => item.trim().toUpperCase()).filter(Boolean)
  return types.length ? types : undefined
}

/** Keeps only the small part of ComfyUI's `/object_info` (often tens of MB) that output inference reads. */
export function comfyNodeTypesFromObjectInfo(objectInfo: unknown): ComfyNodeTypes {
  if (!plainObject(objectInfo)) return {}
  const nodeTypes: ComfyNodeTypes = {}
  for (const [classType, info] of Object.entries(objectInfo)) {
    if (!plainObject(info)) continue
    const inputTypes: Record<string, string[]> = {}
    const input = plainObject(info.input) ? info.input : {}
    for (const group of [input.required, input.optional]) {
      if (!plainObject(group)) continue
      for (const [name, spec] of Object.entries(group)) {
        const types = specTypes(spec)
        if (types) inputTypes[name] = types
      }
    }
    nodeTypes[classType] = { outputNode: info.output_node === true, inputTypes }
  }
  return nodeTypes
}
