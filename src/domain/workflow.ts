import type {
  ComfyWorkflow,
  FunctionInputDef,
  FunctionOutputDef,
  GenerationFunction,
  PrimitiveInputValue,
  Resource,
  ResourceRef,
  ResourceType,
  WorkflowNode,
} from './types'

export type ParsedWorkflowNode = {
  id: string
  title: string
  classType: string
  bindableInputPaths: string[]
}

type InputValues = Record<string, PrimitiveInputValue | ResourceRef>

const cloneWorkflow = (workflow: ComfyWorkflow): ComfyWorkflow =>
  structuredClone(workflow) as ComfyWorkflow

const isResourceRef = (value: PrimitiveInputValue | ResourceRef): value is ResourceRef =>
  typeof value === 'object' && value !== null && 'resourceId' in value

const valueForWorkflow = (value: PrimitiveInputValue | ResourceRef, resources: Record<string, Resource>) => {
  if (!isResourceRef(value)) return value

  const resource = resources[value.resourceId]
  if (!resource) {
    throw new Error(`Resource not found: ${value.resourceId}`)
  }

  if (typeof resource.value === 'object' && resource.value !== null && 'url' in resource.value) {
    return resource.value.url
  }

  return resource.value
}

function setByPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.').filter(Boolean)
  if (parts.length === 0) {
    throw new Error('Input bind path cannot be empty')
  }

  let cursor: Record<string, unknown> = target
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part]
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      cursor[part] = {}
    }
    cursor = cursor[part] as Record<string, unknown>
  }

  cursor[parts[parts.length - 1]] = value
}

const normalizedWorkflowKey = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, '')

const matchingWorkflowInputKey = (node: WorkflowNode, input: FunctionInputDef) => {
  const nodeInputs = node.inputs
  if (!nodeInputs) return undefined

  const candidates = [input.key, input.label].filter(Boolean)
  const direct = candidates.find((candidate) => Object.prototype.hasOwnProperty.call(nodeInputs, candidate))
  if (direct) return direct

  const normalizedCandidates = new Set(candidates.map(normalizedWorkflowKey))
  return Object.keys(nodeInputs).find((key) => normalizedCandidates.has(normalizedWorkflowKey(key)))
}

const inputPathTail = (path: string) => path.split('.').filter(Boolean).at(-1) ?? ''

const resolvedWorkflowBindPath = (node: WorkflowNode, input: FunctionInputDef) => {
  const matchedKey = matchingWorkflowInputKey(node, input)
  if (!matchedKey) return input.bind.path

  const configuredKey = inputPathTail(input.bind.path)
  return normalizedWorkflowKey(configuredKey) === normalizedWorkflowKey(matchedKey) ? input.bind.path : `inputs.${matchedKey}`
}

export function parseWorkflowNodes(workflow: ComfyWorkflow): ParsedWorkflowNode[] {
  return Object.entries(workflow).map(([id, node]) => ({
    id,
    title: node._meta?.title?.trim() || id,
    classType: node.class_type ?? 'Unknown',
    bindableInputPaths: Object.keys(node.inputs ?? {}).map((key) => `inputs.${key}`),
  }))
}

const nodeTitle = (id: string, node: WorkflowNode) => node._meta?.title?.trim() || id

const normalized = (value: string) => value.toLowerCase()

const isClipTextNode = (node: WorkflowNode) =>
  node.class_type === 'CLIPTextEncode' && Object.prototype.hasOwnProperty.call(node.inputs ?? {}, 'text')

const isNegativePromptTitle = (title: string) => {
  const value = normalized(title)
  return value.includes('negative') || title.includes('负向') || title.includes('反向')
}

const isPositivePromptTitle = (title: string) => {
  const value = normalized(title)
  return value.includes('positive') || title.includes('正向')
}

const inputDefaultValue = (node: WorkflowNode, key: string) => {
  const value = node.inputs?.[key]
  return typeof value === 'string' || typeof value === 'number' || value === null ? value : undefined
}

const promptInputsForWorkflow = (workflow: ComfyWorkflow): FunctionInputDef[] => {
  const clipTextNodes = Object.entries(workflow).filter(([, node]) => isClipTextNode(node))
  const positiveNode =
    clipTextNodes.find(([id, node]) => isPositivePromptTitle(nodeTitle(id, node))) ??
    clipTextNodes.find(([id, node]) => !isNegativePromptTitle(nodeTitle(id, node)))
  const negativeNode = clipTextNodes.find(([id, node]) => isNegativePromptTitle(nodeTitle(id, node)))
  const inputs: FunctionInputDef[] = []

  if (positiveNode) {
    const [id, node] = positiveNode
    inputs.push({
      key: 'prompt',
      label: 'Prompt',
      type: 'text',
      required: true,
      defaultValue: inputDefaultValue(node, 'text') ?? 'warm interior render',
      bind: { nodeId: id, nodeTitle: nodeTitle(id, node), path: 'inputs.text' },
      upload: { strategy: 'none' },
    })
  }

  if (negativeNode) {
    const [id, node] = negativeNode
    inputs.push({
      key: 'negative_prompt',
      label: 'Negative Prompt',
      type: 'text',
      required: false,
      defaultValue: inputDefaultValue(node, 'text') ?? '',
      bind: { nodeId: id, nodeTitle: nodeTitle(id, node), path: 'inputs.text' },
      upload: { strategy: 'none' },
    })
  }

  return inputs
}

const imageInputsForWorkflow = (workflow: ComfyWorkflow): FunctionInputDef[] =>
  Object.entries(workflow)
    .filter(([, node]) => node.class_type === 'LoadImage' && Object.prototype.hasOwnProperty.call(node.inputs ?? {}, 'image'))
    .map(([id, node], index) => ({
      key: index === 0 ? 'image' : `image_${index + 1}`,
      label: index === 0 ? 'Image' : `Image ${index + 1}`,
      type: 'image',
      required: true,
      bind: { nodeId: id, nodeTitle: nodeTitle(id, node), path: 'inputs.image' },
      upload: { strategy: 'comfy_upload', targetSubfolder: 'infinity-comfyui' },
    }))

const outputNodeMatches = (node: WorkflowNode, type: ResourceType) => {
  const classType = normalized(node.class_type ?? '')
  if (type === 'image') return classType === 'saveimage'
  if (type === 'video') return classType.includes('video') && (classType.includes('save') || classType.includes('combine'))
  if (type === 'audio') return classType.includes('audio') && (classType.includes('save') || classType.includes('preview'))
  if (type === 'text') {
    return (
      classType.includes('text') &&
      (classType.includes('save') || classType.includes('preview') || classType.includes('show') || classType.includes('output'))
    )
  }

  return false
}

const outputsForType = (workflow: ComfyWorkflow, type: ResourceType, label: string): FunctionOutputDef[] =>
  Object.entries(workflow)
    .filter(([, node]) => outputNodeMatches(node, type))
    .map(([id, node], index) => ({
      key: index === 0 ? type : `${type}_${index + 1}`,
      label: index === 0 ? label : `${label} ${index + 1}`,
      type,
      bind: { nodeId: id, nodeTitle: nodeTitle(id, node) },
      extract: { source: type === 'text' ? 'node_output' : 'history', multiple: true },
    }))

const outputsForWorkflow = (workflow: ComfyWorkflow): FunctionOutputDef[] => {
  const outputs = [
    ...outputsForType(workflow, 'image', 'Image'),
    ...outputsForType(workflow, 'video', 'Video'),
    ...outputsForType(workflow, 'audio', 'Audio'),
    ...outputsForType(workflow, 'text', 'Text'),
  ]

  if (outputs.length === 0) {
    return [
      {
        key: 'result',
        label: 'Result',
        type: 'text',
        bind: { nodeTitle: 'Result' },
        extract: { source: 'history', multiple: true },
      },
    ]
  }

  return outputs
}

export function createGenerationFunctionFromWorkflow(
  id: string,
  name: string,
  workflow: ComfyWorkflow,
  now: string,
): GenerationFunction {
  const inputs = [...promptInputsForWorkflow(workflow), ...imageInputsForWorkflow(workflow)]
  const hasImageInput = inputs.some((input) => input.type === 'image')

  return {
    id,
    name,
    description: 'ComfyUI API workflow function',
    category: hasImageInput ? 'Edit' : 'Render',
    workflow: {
      format: 'comfyui_api_json',
      rawJson: workflow,
    },
    inputs,
    outputs: outputsForWorkflow(workflow),
    runtimeDefaults: {
      runCount: 1,
      seedPolicy: { mode: 'randomize_all_before_submit' },
    },
    createdAt: now,
    updatedAt: now,
  }
}

export function injectWorkflowInputs(
  workflow: ComfyWorkflow,
  inputs: FunctionInputDef[],
  inputValues: InputValues,
  resources: Record<string, Resource>,
): ComfyWorkflow {
  const compiled = cloneWorkflow(workflow)

  for (const input of inputs) {
    const rawValue = inputValues[input.key] ?? input.defaultValue ?? null
    if (rawValue === null || rawValue === undefined) {
      if (input.required) throw new Error(`Required input missing: ${input.key}`)
      continue
    }

    const nodeId = input.bind.nodeId
    if (!nodeId || !compiled[nodeId]) {
      throw new Error(`Input ${input.key} is bound to missing node: ${nodeId ?? 'unknown'}`)
    }

    const workflowNode = compiled[nodeId]!
    const bindPath = resolvedWorkflowBindPath(workflowNode, input)
    setByPath(workflowNode as Record<string, unknown>, bindPath, valueForWorkflow(rawValue, resources))
  }

  return compiled
}
