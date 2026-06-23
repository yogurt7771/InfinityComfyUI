import { isGeminiImageFunction } from '../geminiImage'
import { isGeminiLlmFunction } from '../geminiLlm'
import { isLocalTransformFunction } from '../localTransforms'
import { isOpenAIImageFunction } from '../openaiImage'
import { isOpenAILlmFunction } from '../openaiLlm'
import { isRequestFunction } from '../requestFunction'
import type {
  ComfyWorkflow,
  ExecutionInputSnapshot,
  GenerationFunction,
  InputResourceRef,
  PrimitiveInputValue,
  Resource,
  ResourceRef,
  RunProvider,
  RunSnapshot,
  SeedPatchRecord,
} from '../types'

type CreateRunSnapshotInput = {
  id: string
  functionDef: GenerationFunction
  provider?: RunProvider
  inputRefs: Record<string, InputResourceRef>
  inputValuesSnapshot: Record<string, ExecutionInputSnapshot>
  primitiveParams?: Record<string, PrimitiveInputValue>
  runIndex: number
  runTotal: number
  outputRefs?: Record<string, ResourceRef[]>
  endpointId?: string
  workflowTemplateSnapshot?: ComfyWorkflow
  compiledWorkflowSnapshot?: ComfyWorkflow
  requestSnapshot?: unknown
  seedPatchLog?: SeedPatchRecord[]
  taskIds?: string[]
  status?: RunSnapshot['status']
  error?: RunSnapshot['error']
  now: string
  completedAt?: string
}

export type GeneratedResourceSourceInput = {
  runId: string
  outputKey: string
  parentResourceId?: string
}

const cloneJsonValue = <T>(value: T): T => {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export function runProviderForFunction(functionDef: GenerationFunction): RunProvider {
  if (isOpenAILlmFunction(functionDef)) return 'openai_llm'
  if (isGeminiLlmFunction(functionDef)) return 'gemini_llm'
  if (isOpenAIImageFunction(functionDef)) return 'openai_image'
  if (isGeminiImageFunction(functionDef)) return 'gemini_image'
  if (isRequestFunction(functionDef)) return 'http_request'
  if (isLocalTransformFunction(functionDef)) return 'local_transform'
  return 'comfyui'
}

export function createRunSnapshot(input: CreateRunSnapshotInput): RunSnapshot {
  return {
    id: input.id,
    functionId: input.functionDef.id,
    functionName: input.functionDef.name,
    functionSnapshot: cloneJsonValue(input.functionDef),
    provider: input.provider ?? runProviderForFunction(input.functionDef),
    inputRefs: cloneJsonValue(input.inputRefs),
    inputValuesSnapshot: cloneJsonValue(input.inputValuesSnapshot),
    primitiveParams: cloneJsonValue(input.primitiveParams ?? {}),
    runIndex: input.runIndex,
    runTotal: input.runTotal,
    outputRefs: cloneJsonValue(input.outputRefs ?? {}),
    endpointId: input.endpointId,
    workflowTemplateSnapshot: cloneJsonValue(input.workflowTemplateSnapshot),
    compiledWorkflowSnapshot: cloneJsonValue(input.compiledWorkflowSnapshot),
    requestSnapshot: cloneJsonValue(input.requestSnapshot),
    seedPatchLog: cloneJsonValue(input.seedPatchLog ?? []),
    taskIds: [...(input.taskIds ?? [])],
    status: input.status ?? 'pending',
    error: cloneJsonValue(input.error),
    createdAt: input.now,
    updatedAt: input.now,
    completedAt: input.completedAt,
  }
}

export function generatedResourceSourceForRun(input: GeneratedResourceSourceInput): Resource['source'] {
  return {
    kind: 'function_output',
    runId: input.runId,
    outputKey: input.outputKey,
    parentResourceId: input.parentResourceId,
  }
}

export function isRunGeneratedResource(resource: Resource): boolean {
  return resource.source.kind === 'function_output' && typeof resource.source.runId === 'string'
}
