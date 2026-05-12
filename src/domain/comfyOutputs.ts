import type { ComfyWorkflow, FunctionOutputDef, ResourceType } from './types'

export type ComfyFileRef = {
  filename: string
  subfolder?: string
  type: string
}

export type ExtractedComfyOutput = {
  key: string
  type: ResourceType
  files: ComfyFileRef[]
  texts?: string[]
}

type HistoryNodeOutput = {
  images?: ComfyFileRef[]
  videos?: ComfyFileRef[]
  gifs?: ComfyFileRef[]
  animated?: unknown
  audio?: ComfyFileRef[]
  audios?: ComfyFileRef[]
  text?: unknown
  texts?: unknown
  string?: unknown
  strings?: unknown
  output?: unknown
  outputs?: unknown
  result?: unknown
}

type PromptHistory = {
  outputs?: Record<string, HistoryNodeOutput>
}

const firstPromptHistory = (history: unknown): PromptHistory => {
  if (!history || typeof history !== 'object') throw new Error('ComfyUI history is empty')
  const first = Object.values(history as Record<string, unknown>)[0]
  if (!first || typeof first !== 'object') throw new Error('ComfyUI prompt history is empty')
  return first as PromptHistory
}

const findNodeId = (workflow: ComfyWorkflow, output: FunctionOutputDef) => {
  if (output.bind.nodeId) return output.bind.nodeId
  const targetTitle = output.bind.nodeTitle?.trim()
  if (!targetTitle) return undefined

  return Object.entries(workflow).find(([, node]) => node._meta?.title?.trim() === targetTitle)?.[0]
}

const videoFileExtensions = new Set(['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'])

const fileExtension = (filename: string) => filename.split('.').pop()?.toLowerCase() ?? ''

const imageFieldVideoFiles = (nodeOutput: HistoryNodeOutput) =>
  (nodeOutput.images ?? []).filter((file) => videoFileExtensions.has(fileExtension(file.filename)))

const filesForType = (nodeOutput: HistoryNodeOutput | undefined, type: ResourceType): ComfyFileRef[] => {
  if (!nodeOutput) return []
  if (type === 'image') return nodeOutput.images ?? []
  if (type === 'video') return nodeOutput.videos ?? nodeOutput.gifs ?? imageFieldVideoFiles(nodeOutput)
  if (type === 'audio') return nodeOutput.audios ?? nodeOutput.audio ?? []
  return []
}

const collectStrings = (value: unknown): string[] => {
  if (typeof value === 'string') return value ? [value] : []
  if (typeof value === 'number') return [String(value)]
  if (Array.isArray(value)) return value.flatMap(collectStrings)
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectStrings)
  return []
}

const textsForOutput = (nodeOutput: HistoryNodeOutput | undefined) => {
  if (!nodeOutput) return []

  const values = [
    nodeOutput.text,
    nodeOutput.texts,
    nodeOutput.string,
    nodeOutput.strings,
    nodeOutput.output,
    nodeOutput.outputs,
    nodeOutput.result,
  ].flatMap(collectStrings)

  return [...new Set(values)]
}

export function extractComfyOutputs(
  history: unknown,
  workflow: ComfyWorkflow,
  outputDefs: FunctionOutputDef[],
): ExtractedComfyOutput[] {
  const promptHistory = firstPromptHistory(history)
  const historyOutputs = promptHistory.outputs
  if (!historyOutputs) throw new Error('ComfyUI history missing outputs')

  return outputDefs.map((output) => {
    const nodeId = findNodeId(workflow, output)
    if (!nodeId) throw new Error(`Output node not found: ${output.key}`)

    const extracted = {
      key: output.key,
      type: output.type,
      files: filesForType(historyOutputs[nodeId], output.type),
    }

    if (output.type === 'text') {
      return {
        ...extracted,
        texts: textsForOutput(historyOutputs[nodeId]),
      }
    }

    return extracted
  })
}
