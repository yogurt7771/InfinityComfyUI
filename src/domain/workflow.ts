import type {
  ComfyWorkflow,
  ComfyUiWorkflow,
  ComfyWorkflowEditorMetadata,
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

export type WorkflowInputCandidate = FunctionInputDef

type InputValues = Record<string, PrimitiveInputValue | ResourceRef>

const workflowObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export function assertComfyApiWorkflow(value: unknown): asserts value is ComfyWorkflow {
  if (!workflowObject(value)) {
    throw new TypeError('ComfyUI API workflow must be a JSON object of nodes.')
  }

  const nodes = Object.entries(value)
  if (nodes.length === 0) {
    throw new TypeError('ComfyUI API workflow must contain at least one node.')
  }

  for (const [nodeId, node] of nodes) {
    if (!workflowObject(node)) {
      throw new TypeError(`ComfyUI API workflow node "${nodeId}" must be an object.`)
    }
    if (typeof node.class_type !== 'string' || !node.class_type.trim()) {
      throw new TypeError(`ComfyUI API workflow node "${nodeId}" must include a class_type.`)
    }
    if (!workflowObject(node.inputs)) {
      throw new TypeError(`ComfyUI API workflow node "${nodeId}" must include an inputs object.`)
    }
  }
}

export function parseComfyApiWorkflowJson(source: string): ComfyWorkflow {
  let value: unknown
  try {
    value = JSON.parse(source) as unknown
  } catch (error) {
    throw new TypeError(`Enter valid JSON${error instanceof Error ? `: ${error.message}` : '.'}`, { cause: error })
  }
  assertComfyApiWorkflow(value)
  return value
}

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

const primitiveValueAtPath = (source: unknown, path: string) => {
  if (!source || typeof source !== 'object') return undefined

  let cursor: unknown = source
  for (const segment of path.split('.').filter(Boolean)) {
    if (!cursor || typeof cursor !== 'object' || !(segment in cursor)) return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }

  return typeof cursor === 'string' || typeof cursor === 'number' || typeof cursor === 'boolean' || cursor === null
    ? cursor
    : undefined
}

const hasValueAtPath = (source: unknown, path: string) => {
  if (!source || typeof source !== 'object') return false

  let cursor: unknown = source
  for (const segment of path.split('.').filter(Boolean)) {
    if (!cursor || typeof cursor !== 'object' || !(segment in cursor)) return false
    cursor = (cursor as Record<string, unknown>)[segment]
  }

  return true
}

const resolvedWorkflowBindPath = (node: WorkflowNode, input: FunctionInputDef) => {
  const matchedKey = matchingWorkflowInputKey(node, input)
  if (!matchedKey) return input.bind.path

  const configuredKey = inputPathTail(input.bind.path)
  return normalizedWorkflowKey(configuredKey) === normalizedWorkflowKey(matchedKey) ? input.bind.path : `inputs.${matchedKey}`
}

const resolveWorkflowNodeForInput = (workflow: ComfyWorkflow, input: FunctionInputDef) => {
  if (input.bind.nodeId && workflow[input.bind.nodeId]) {
    return { id: input.bind.nodeId, node: workflow[input.bind.nodeId]! }
  }

  const matched = Object.entries(workflow).find(
    ([, node]) => input.bind.nodeTitle && node._meta?.title === input.bind.nodeTitle,
  )
  return matched ? { id: matched[0], node: matched[1] } : undefined
}

export function workflowPrimitiveInputValue(
  functionDef: GenerationFunction,
  input: FunctionInputDef,
): PrimitiveInputValue | undefined {
  const workflow = functionDef.workflow.rawJson
  const resolved = resolveWorkflowNodeForInput(workflow, input)
  if (!resolved) return undefined

  return primitiveValueAtPath(resolved.node, resolvedWorkflowBindPath(resolved.node, input))
}

export function workflowInputBindingExists(workflow: ComfyWorkflow, input: FunctionInputDef): boolean {
  const resolved = resolveWorkflowNodeForInput(workflow, input)
  if (!resolved) return false

  return hasValueAtPath(resolved.node, resolvedWorkflowBindPath(resolved.node, input))
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

const isGraphLinkValue = (value: unknown) =>
  Array.isArray(value) &&
  value.length >= 2 &&
  (typeof value[0] === 'string' || typeof value[0] === 'number') &&
  typeof value[1] === 'number'

const labelFromInputKey = (key: string) =>
  key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())

const inputKeyFromPath = (key: string) =>
  key
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'input'

const uniqueInputKey = (baseKey: string, usedKeys: Set<string>) => {
  let key = baseKey
  let index = 2
  while (usedKeys.has(key)) {
    key = `${baseKey}_${index}`
    index += 1
  }
  usedKeys.add(key)
  return key
}

const contextForWorkflowInput = (node: WorkflowNode, title: string, key: string) =>
  normalized(`${node.class_type ?? ''} ${title} ${key}`)

const contextHasAny = (context: string, words: string[]) => words.some((word) => context.includes(word))

const valueLooksLikeFile = (value: unknown, extensions: string[]) =>
  typeof value === 'string' && extensions.some((extension) => normalized(value).endsWith(extension))

const isMediaWorkflowInput = (node: WorkflowNode, title: string, key: string, value: unknown, words: string[], extensions: string[]) => {
  const classContext = normalized(node.class_type ?? '')
  const keyContext = normalized(key)
  const titleContext = normalized(title)
  const genericFileKey = contextHasAny(keyContext, ['file', 'filename', 'path', 'input', 'source'])
  const mediaNodeContext = `${classContext} ${titleContext}`

  return (
    contextHasAny(keyContext, words) ||
    valueLooksLikeFile(value, extensions) ||
    (genericFileKey && contextHasAny(mediaNodeContext, words))
  )
}

const inferredInputType = (node: WorkflowNode, title: string, key: string, value: unknown): ResourceType | undefined => {
  if (isGraphLinkValue(value)) return undefined

  const context = contextForWorkflowInput(node, title, key)
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string' || value === null) {
    if (contextHasAny(context, ['text', 'prompt', 'caption', 'string'])) return 'text'
  }
  if (isMediaWorkflowInput(node, title, key, value, ['video', 'vhs', 'frame', 'frames', 'movie', 'mp4', 'webm'], ['.mp4', '.webm', '.mov', '.mkv', '.avi'])) return 'video'
  if (isMediaWorkflowInput(node, title, key, value, ['audio', 'sound', 'voice', 'wav', 'mp3'], ['.wav', '.mp3', '.flac', '.m4a', '.ogg'])) return 'audio'
  if (isMediaWorkflowInput(node, title, key, value, ['image', 'picture', 'photo', 'mask'], ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff'])) return 'image'
  if (typeof value === 'string' || value === null) return 'text'
  return undefined
}

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

const isLikelyOutputNode = (node: WorkflowNode) =>
  (['image', 'video', 'audio', 'text'] as const).some((type) => outputNodeMatches(node, type))

const inputBindKey = (nodeId: string, path: string) => `${nodeId}:${path}`

export const isMediaResourceType = (type: ResourceType) => type === 'image' || type === 'video' || type === 'audio'

export const workflowInputCandidates = (workflow: ComfyWorkflow, existingInputs: FunctionInputDef[] = []): WorkflowInputCandidate[] => {
  const usedKeys = new Set(existingInputs.map((input) => input.key))
  const usedBindings = new Set(
    existingInputs.map((input) => input.bind.nodeId && input.bind.path ? inputBindKey(input.bind.nodeId, input.bind.path) : ''),
  )
  const inputs: WorkflowInputCandidate[] = []

  for (const [id, node] of Object.entries(workflow)) {
    if (isLikelyOutputNode(node)) continue
    const nodeInputs = node.inputs ?? {}
    const title = nodeTitle(id, node)
    for (const [key, value] of Object.entries(nodeInputs)) {
      const path = `inputs.${key}`
      if (usedBindings.has(inputBindKey(id, path))) continue

      const type = inferredInputType(node, title, key, value)
      if (!type) continue

      const baseKey = inputKeyFromPath(key)
      const inputKey = uniqueInputKey(baseKey, usedKeys)
      const mediaInput = isMediaResourceType(type)
      const primitiveDefault =
        !mediaInput && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null)
          ? value
          : undefined

      inputs.push({
        key: inputKey,
        label: labelFromInputKey(key),
        type,
        required: mediaInput,
        ...(primitiveDefault !== undefined ? { defaultValue: primitiveDefault } : {}),
        bind: { nodeId: id, nodeTitle: title, path },
        upload: mediaInput
          ? type === 'image'
            ? { strategy: 'comfy_upload', targetSubfolder: 'infinity-comfyui' }
            : { strategy: 'manual_path' }
          : { strategy: 'none' },
      })
      usedBindings.add(inputBindKey(id, path))
    }
  }

  return inputs
}

const mediaInputsForWorkflow = (workflow: ComfyWorkflow): FunctionInputDef[] =>
  workflowInputCandidates(workflow).filter((input) => isMediaResourceType(input.type))

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
  options: {
    uiJson?: ComfyUiWorkflow
    editor?: ComfyWorkflowEditorMetadata
  } = {},
): GenerationFunction {
  const inputs = mediaInputsForWorkflow(workflow)
  const hasImageInput = inputs.some((input) => input.type === 'image')

  return {
    id,
    name,
    description: 'ComfyUI API workflow function',
    category: hasImageInput ? 'Edit' : 'Render',
    workflow: {
      format: 'comfyui_api_json',
      rawJson: workflow,
      ...(options.uiJson !== undefined ? { uiJson: options.uiJson } : {}),
      ...(options.editor !== undefined ? { editor: options.editor } : {}),
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

    const resolved = resolveWorkflowNodeForInput(compiled, input)
    if (!resolved) {
      throw new Error(`Input ${input.key} is bound to missing node: ${input.bind.nodeId ?? input.bind.nodeTitle ?? 'unknown'}`)
    }

    const workflowNode = resolved.node
    const bindPath = resolvedWorkflowBindPath(workflowNode, input)
    setByPath(workflowNode as Record<string, unknown>, bindPath, valueForWorkflow(rawValue, resources))
  }

  return compiled
}
