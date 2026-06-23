import type { PrimitiveInputValue, Resource, ResourceRef, RunProvider, RunSnapshot, GenerationFunction } from '../types'
import { comfyRunAdapter } from './adapters/comfyRunAdapter'
import { geminiImageRunAdapter } from './adapters/geminiImageRunAdapter'
import { geminiLlmRunAdapter } from './adapters/geminiLlmRunAdapter'
import { httpRequestRunAdapter } from './adapters/httpRequestRunAdapter'
import { localTransformRunAdapter } from './adapters/localTransformRunAdapter'
import { openAiImageRunAdapter } from './adapters/openAiImageRunAdapter'
import { openAiLlmRunAdapter } from './adapters/openAiLlmRunAdapter'

export type RuntimeInputValues = Record<string, PrimitiveInputValue | ResourceRef>

export type ResourceBlobLoader = (resource: Resource) => Promise<Blob>

export type RunPrepareRequest = {
  run: RunSnapshot
  functionDef: GenerationFunction
  inputValues: RuntimeInputValues
  resources: Record<string, Resource>
  loadResourceBlob?: ResourceBlobLoader
}

export type RunPreparedTask<TRequest = unknown> = {
  provider: RunProvider
  runId: string
  functionId: string
  functionDef: GenerationFunction
  outputDefs: GenerationFunction['outputs']
  request: TRequest
}

export type RunExecutionRuntime = {
  loadResourceBlob?: ResourceBlobLoader
  readResourceBlob?: ResourceBlobLoader
  fetch?: typeof fetch
}

export type RunExecutionResult = {
  raw: unknown
  responseText?: string
  responseJson?: unknown
  responseBinary?: unknown
  providerRequestId?: string
}

export type ExtractedRunOutput = {
  key: string
  type: Resource['type']
  values: unknown[]
}

export type FunctionRunAdapter = {
  provider: RunProvider
  canRun: (functionDef: GenerationFunction) => boolean
  prepare: (request: RunPrepareRequest) => Promise<RunPreparedTask>
  execute: (task: RunPreparedTask, runtime?: RunExecutionRuntime) => Promise<RunExecutionResult>
  extractOutputs: (result: RunExecutionResult, task: RunPreparedTask) => Promise<ExtractedRunOutput[]>
}

export const allRunAdapters = [
  comfyRunAdapter,
  openAiLlmRunAdapter,
  geminiLlmRunAdapter,
  openAiImageRunAdapter,
  geminiImageRunAdapter,
  httpRequestRunAdapter,
  localTransformRunAdapter,
] as const satisfies readonly FunctionRunAdapter[]

export function adapterForFunction(functionDef: GenerationFunction): FunctionRunAdapter {
  const adapter = allRunAdapters.find((candidate) => candidate.canRun(functionDef))
  if (!adapter) throw new Error(`No run adapter registered for workflow format: ${functionDef.workflow.format}`)
  return adapter
}

export async function prepareFunctionRun(request: RunPrepareRequest): Promise<RunPreparedTask> {
  return adapterForFunction(request.functionDef).prepare(request)
}
