import type { ComfyWorkflow, FunctionInputDef, FunctionOutputDef } from './types'

/**
 * Slots on arbitrary sockets, applied to the copy of the workflow sent to ComfyUI (never to the saved workflow):
 * an output socket gets a preview / save node behind it so its result lands in ComfyUI's history, and an input socket
 * gets its value directly (text, numbers) or through a loader node (files) instead of its connection.
 */

const cloneWorkflow = (workflow: ComfyWorkflow): ComfyWorkflow => structuredClone(workflow)

const outputNodeId = (key: string) => `infinity_out_${key}`
const inputNodeId = (key: string) => `infinity_in_${key}`

export function attachOutputSockets(
  workflow: ComfyWorkflow,
  outputs: FunctionOutputDef[],
): { workflow: ComfyWorkflow; outputs: FunctionOutputDef[] } {
  if (!outputs.some((output) => output.bind.outputIndex !== undefined)) return { workflow, outputs }
  const compiled = cloneWorkflow(workflow)
  const resolved = outputs.map((output) => {
    const { nodeId, outputIndex } = output.bind
    if (outputIndex === undefined || !nodeId || !Object.hasOwn(compiled, nodeId)) return output
    const id = outputNodeId(output.key)
    const title = `Infinity output ${output.label || output.key}`
    const link: [string, number] = [nodeId, outputIndex]
    const socketType = (output.bind.outputType ?? '').toUpperCase()
    let textual = false
    if (socketType === 'IMAGE') {
      compiled[id] = { class_type: 'PreviewImage', inputs: { images: link }, _meta: { title } }
    } else if (socketType === 'MASK') {
      compiled[`${id}_mask`] = { class_type: 'MaskToImage', inputs: { mask: link }, _meta: { title } }
      compiled[id] = { class_type: 'PreviewImage', inputs: { images: [`${id}_mask`, 0] }, _meta: { title } }
    } else if (socketType === 'AUDIO') {
      compiled[id] = { class_type: 'PreviewAudio', inputs: { audio: link }, _meta: { title } }
    } else if (socketType === 'VIDEO') {
      compiled[id] = {
        class_type: 'SaveVideo',
        inputs: { video: link, filename_prefix: 'infinity/slot', format: 'auto', codec: 'auto' },
        _meta: { title },
      }
    } else {
      // Text, numbers and anything else: ComfyUI's PreviewAny reports the value as text.
      compiled[id] = { class_type: 'PreviewAny', inputs: { source: link }, _meta: { title } }
      textual = true
    }
    return {
      ...output,
      bind: { nodeId: id, nodeTitle: title },
      extract: { ...output.extract, source: textual ? ('node_output' as const) : ('history' as const) },
    }
  })
  return { workflow: compiled, outputs: resolved }
}

const isMediaType = (type: FunctionInputDef['type']) => type === 'image' || type === 'video' || type === 'audio'

export function injectSocketInputs(
  workflow: ComfyWorkflow,
  inputs: FunctionInputDef[],
  values: Record<string, unknown>,
): ComfyWorkflow {
  const socketInputs = inputs.filter((input) => {
    const nodeId = input.bind.nodeId
    const value = values[input.key]
    return Boolean(input.bind.socketType && nodeId && Object.hasOwn(workflow, nodeId) && value !== undefined && value !== null)
  })
  if (!socketInputs.length) return workflow
  const compiled = cloneWorkflow(workflow)
  for (const input of socketInputs) {
    const node = compiled[input.bind.nodeId!]!
    const field = input.bind.path.replace(/^inputs\./, '')
    const value = values[input.key]
    node.inputs = { ...(node.inputs ?? {}) }
    if (!isMediaType(input.type)) {
      node.inputs[field] = value
      continue
    }
    const id = inputNodeId(input.key)
    const title = `Infinity input ${input.label || input.key}`
    const socketType = (input.bind.socketType ?? '').toUpperCase()
    compiled[id] =
      socketType === 'MASK'
        ? { class_type: 'LoadImageMask', inputs: { image: value, channel: 'alpha' }, _meta: { title } }
        : socketType === 'VIDEO'
          ? { class_type: 'LoadVideo', inputs: { file: value }, _meta: { title } }
          : socketType === 'AUDIO'
            ? { class_type: 'LoadAudio', inputs: { audio: value }, _meta: { title } }
            : { class_type: 'LoadImage', inputs: { image: value }, _meta: { title } }
    node.inputs[field] = [id, 0]
  }
  return compiled
}
