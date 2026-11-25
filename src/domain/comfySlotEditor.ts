import type { ComfyWorkflow, FunctionInputDef, FunctionOutputDef, ResourceType } from './types'
import {
  inputSlotKeyForField,
  inputSlotLabelForField,
  isLegacyFallbackOutput,
  isMediaResourceType,
  isWorkflowLinkValue,
  nextFreeOutputKey,
  outputTypeForClassName,
  outputTypeForComfyTypes,
  uniqueInputKey,
  workflowFieldInputType,
} from './workflow'

/** One node of the live ComfyUI graph, as the slot settings need it. */
export type EditorNode = {
  nodeId: string
  title: string
  classType: string
  /** From the editor's node definition; undefined when it has none for this class. */
  outputNode?: boolean
  /** ComfyUI types of the node's connected inputs. */
  linkedInputTypes: string[]
  /** Widget values: what the API prompt stores at inputs.<name>. */
  fields: Array<{ name: string; value: unknown }>
}

/** One editing session's slot settings; written back to the function's inputs / outputs on save. */
export type EditorSlotState = {
  inputs: FunctionInputDef[]
  outputs: FunctionOutputDef[]
  /** `${nodeId}:inputs.${field}` turned off in this session (so they are not added back by default). */
  removedInputs: string[]
  removedOutputNodeIds: string[]
  /** Node ids the function's workflow had when editing started; undefined for a new function. */
  baselineNodeIds?: string[]
}

export type EditorSlot<T> = T & { auto: boolean }

const CONTROL_FIELDS = new Set(['control_after_generate', 'control_before_generate'])
const inputId = (nodeId: string, path: string) => `${nodeId}:${path}`
const fieldOfPath = (path: string | undefined) => (path?.startsWith('inputs.') ? path.slice('inputs.'.length) : undefined)

export function editorSlotState(functionDef?: {
  inputs: FunctionInputDef[]
  outputs: FunctionOutputDef[]
  workflow?: { rawJson?: ComfyWorkflow }
}): EditorSlotState {
  if (!functionDef) return { inputs: [], outputs: [], removedInputs: [], removedOutputNodeIds: [], baselineNodeIds: undefined }
  const nodeIds = Object.keys(functionDef.workflow?.rawJson ?? {})
  return {
    inputs: structuredClone(functionDef.inputs),
    outputs: structuredClone(functionDef.outputs.filter((output) => !isLegacyFallbackOutput(output))),
    removedInputs: [],
    removedOutputNodeIds: [],
    baselineNodeIds: nodeIds.length ? nodeIds : undefined,
  }
}

export function editorNodeOutputType(node: EditorNode): { type?: ResourceType; reason?: 'not_output_node' | 'no_supported_output' } {
  if (node.outputNode === false) return { reason: 'not_output_node' }
  if (node.outputNode === true) {
    const type = outputTypeForComfyTypes(node.linkedInputTypes)
    return type ? { type } : { reason: 'no_supported_output' }
  }
  const type = outputTypeForClassName(node.classType)
  return type ? { type } : { reason: 'not_output_node' }
}

export function editorNodeInputFields(node: EditorNode): Array<{ field: string; type: ResourceType }> {
  const fields: Array<{ field: string; type: ResourceType }> = []
  // On an output node the class name ("SaveImage") says what it produces, not what its fields are: SaveImage's
  // filename_prefix is a plain string, so type its fields from their own name and value only.
  const outputNode = node.outputNode === true || editorNodeOutputType(node).type !== undefined
  for (const { name, value } of node.fields) {
    if (CONTROL_FIELDS.has(name) || isWorkflowLinkValue(value)) continue
    const type = outputNode
      ? workflowFieldInputType('', '', name, value)
      : workflowFieldInputType(node.classType, node.title, name, value)
    if (type) fields.push({ field: name, type })
  }
  return fields
}

const inBaseline = (state: EditorSlotState, nodeId: string) => Boolean(state.baselineNodeIds?.includes(nodeId))

const outputSlot = (node: EditorNode, type: ResourceType, usedKeys: Set<string>): FunctionOutputDef => {
  const { key, label } = nextFreeOutputKey(type, usedKeys)
  usedKeys.add(key)
  return {
    key,
    label,
    type,
    bind: { nodeId: node.nodeId, nodeTitle: node.title },
    extract: { source: type === 'text' ? 'node_output' : 'history', multiple: true },
  }
}

const inputSlot = (
  node: EditorNode,
  field: string,
  type: ResourceType,
  value: unknown,
  usedKeys: Set<string>,
): FunctionInputDef => {
  const media = isMediaResourceType(type)
  const defaultValue =
    !media && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') ? value : undefined
  return {
    key: uniqueInputKey(inputSlotKeyForField(field), usedKeys),
    label: inputSlotLabelForField(field),
    type,
    required: media,
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    bind: { nodeId: node.nodeId, nodeTitle: node.title, path: `inputs.${field}` },
    upload: media
      ? type === 'image'
        ? { strategy: 'comfy_upload', targetSubfolder: 'infinity-comfyui' }
        : { strategy: 'manual_path' }
      : { strategy: 'none' },
  }
}

/** The slots a save would produce right now: the session's explicit ones plus what is enabled by default. */
export function effectiveEditorSlots(
  state: EditorSlotState,
  nodes: EditorNode[],
): { inputs: EditorSlot<FunctionInputDef>[]; outputs: EditorSlot<FunctionOutputDef>[] } {
  const nodesById = new Map(nodes.map((node) => [node.nodeId, node]))

  const outputs: EditorSlot<FunctionOutputDef>[] = state.outputs
    .filter((output) => !output.bind.nodeId || nodesById.has(output.bind.nodeId))
    .map((output) => ({ ...output, auto: false }))
  const outputKeys = new Set(outputs.map((output) => output.key))
  const boundOutputNodes = new Set(outputs.map((output) => output.bind.nodeId).filter(Boolean))
  for (const type of ['image', 'video', 'audio', 'text'] as const) {
    for (const node of nodes) {
      if (editorNodeOutputType(node).type !== type) continue
      if (boundOutputNodes.has(node.nodeId) || state.removedOutputNodeIds.includes(node.nodeId) || inBaseline(state, node.nodeId)) continue
      outputs.push({ ...outputSlot(node, type, outputKeys), auto: true })
      boundOutputNodes.add(node.nodeId)
    }
  }

  const inputs: EditorSlot<FunctionInputDef>[] = state.inputs
    .filter((input) => {
      if (!input.bind.nodeId) return true
      const node = nodesById.get(input.bind.nodeId)
      const field = fieldOfPath(input.bind.path)
      return Boolean(node && field && node.fields.some((item) => item.name === field))
    })
    .map((input) => ({ ...input, auto: false }))
  const inputKeys = new Set(inputs.map((input) => input.key))
  const boundInputs = new Set(inputs.map((input) => (input.bind.nodeId ? inputId(input.bind.nodeId, input.bind.path ?? '') : '')))
  for (const node of nodes) {
    if (inBaseline(state, node.nodeId)) continue
    for (const { field, type } of editorNodeInputFields(node)) {
      if (!isMediaResourceType(type)) continue
      const id = inputId(node.nodeId, `inputs.${field}`)
      if (boundInputs.has(id) || state.removedInputs.includes(id)) continue
      const value = node.fields.find((item) => item.name === field)?.value
      inputs.push({ ...inputSlot(node, field, type, value, inputKeys), auto: true })
      boundInputs.add(id)
    }
  }

  return { inputs, outputs }
}

const strip = <T extends { auto: boolean }>(slot: T): Omit<T, 'auto'> => {
  const rest: Partial<T> = { ...slot }
  delete rest.auto
  return rest as Omit<T, 'auto'>
}

/** Turns the default slots into explicit ones, so a change never shifts the keys of slots the user can see. */
const materialize = (state: EditorSlotState, nodes: EditorNode[]): EditorSlotState => {
  const effective = effectiveEditorSlots(state, nodes)
  return {
    ...state,
    inputs: effective.inputs.map((input) => strip(input) as FunctionInputDef),
    outputs: effective.outputs.map((output) => strip(output) as FunctionOutputDef),
    removedInputs: [...state.removedInputs],
    removedOutputNodeIds: [...state.removedOutputNodeIds],
    baselineNodeIds: state.baselineNodeIds ? [...state.baselineNodeIds] : undefined,
  }
}

export function toggleEditorOutput(state: EditorSlotState, nodes: EditorNode[], nodeId: string): EditorSlotState {
  const node = nodes.find((item) => item.nodeId === nodeId)
  const effective = effectiveEditorSlots(state, nodes)
  const bound = effective.outputs.some((output) => output.bind.nodeId === nodeId)
  const type = node ? editorNodeOutputType(node).type : undefined
  if (!bound && (!node || !type)) return state
  const next = materialize(state, nodes)
  if (bound) {
    next.outputs = next.outputs.filter((output) => output.bind.nodeId !== nodeId)
    if (!next.removedOutputNodeIds.includes(nodeId)) next.removedOutputNodeIds.push(nodeId)
    return next
  }
  next.outputs.push(outputSlot(node!, type!, new Set(next.outputs.map((output) => output.key))))
  next.removedOutputNodeIds = next.removedOutputNodeIds.filter((id) => id !== nodeId)
  return next
}

export function toggleEditorInput(state: EditorSlotState, nodes: EditorNode[], nodeId: string, field: string): EditorSlotState {
  const node = nodes.find((item) => item.nodeId === nodeId)
  const id = inputId(nodeId, `inputs.${field}`)
  const effective = effectiveEditorSlots(state, nodes)
  const bound = effective.inputs.some((input) => input.bind.nodeId === nodeId && input.bind.path === `inputs.${field}`)
  const fieldType = node ? editorNodeInputFields(node).find((item) => item.field === field)?.type : undefined
  if (!bound && !fieldType) return state
  const next = materialize(state, nodes)
  if (bound) {
    next.inputs = next.inputs.filter((input) => !(input.bind.nodeId === nodeId && input.bind.path === `inputs.${field}`))
    if (!next.removedInputs.includes(id)) next.removedInputs.push(id)
    return next
  }
  const value = node!.fields.find((item) => item.name === field)?.value
  next.inputs.push(inputSlot(node!, field, fieldType!, value, new Set(next.inputs.map((input) => input.key))))
  next.removedInputs = next.removedInputs.filter((item) => item !== id)
  return next
}

export function renameEditorSlot(
  state: EditorSlotState,
  nodes: EditorNode[],
  kind: 'input' | 'output',
  key: string,
  label: string,
): EditorSlotState {
  const trimmed = label.trim()
  const effective = effectiveEditorSlots(state, nodes)
  const exists = (kind === 'input' ? effective.inputs : effective.outputs).some((slot) => slot.key === key)
  if (!trimmed || !exists) return state
  const next = materialize(state, nodes)
  if (kind === 'input') next.inputs = next.inputs.map((input) => (input.key === key ? { ...input, label: trimmed } : input))
  else next.outputs = next.outputs.map((output) => (output.key === key ? { ...output, label: trimmed } : output))
  return next
}

/**
 * The session written back on save: slots of deleted nodes (or vanished fields) go, and slots the plain workflow
 * would add are added only for nodes that are new since editing started and that the user did not turn off.
 */
export function applyEditorSlots(
  state: EditorSlotState,
  rawJson: ComfyWorkflow,
  generated: { inputs: FunctionInputDef[]; outputs: FunctionOutputDef[] },
): { inputs: FunctionInputDef[]; outputs: FunctionOutputDef[] } {
  const isNewNode = (nodeId: string) => !inBaseline(state, nodeId)

  const inputs = structuredClone(
    state.inputs.filter((input) => {
      if (!input.bind.nodeId) return true
      const field = fieldOfPath(input.bind.path)
      const nodeInputs = rawJson[input.bind.nodeId]?.inputs
      return Boolean(field && nodeInputs && Object.hasOwn(nodeInputs, field))
    }),
  )
  const inputKeys = new Set(inputs.map((input) => input.key))
  const boundInputs = new Set(inputs.map((input) => (input.bind.nodeId ? inputId(input.bind.nodeId, input.bind.path ?? '') : '')))
  for (const input of generated.inputs) {
    const nodeId = input.bind.nodeId
    if (!nodeId) continue
    const id = inputId(nodeId, input.bind.path ?? '')
    if (boundInputs.has(id) || state.removedInputs.includes(id) || !isNewNode(nodeId)) continue
    inputs.push({ ...structuredClone(input), key: uniqueInputKey(input.key, inputKeys) })
    boundInputs.add(id)
  }

  const outputs = structuredClone(state.outputs.filter((output) => !output.bind.nodeId || Object.hasOwn(rawJson, output.bind.nodeId)))
  const outputKeys = new Set(outputs.map((output) => output.key))
  const boundOutputs = new Set(outputs.map((output) => output.bind.nodeId).filter(Boolean))
  for (const output of generated.outputs) {
    const nodeId = output.bind.nodeId
    if (!nodeId || boundOutputs.has(nodeId) || state.removedOutputNodeIds.includes(nodeId) || !isNewNode(nodeId)) continue
    // Same numbering as the editor's default tags, so the slot saved is the one the user saw.
    const { key, label } = nextFreeOutputKey(output.type, outputKeys)
    outputKeys.add(key)
    boundOutputs.add(nodeId)
    outputs.push({ ...structuredClone(output), key, label })
  }

  return { inputs, outputs }
}
