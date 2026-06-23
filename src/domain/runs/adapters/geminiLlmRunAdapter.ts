import { createGeminiGenerateContentRequest, extractGeminiGenerateContentText, isGeminiLlmFunction } from '../../geminiLlm'
import type { FunctionRunAdapter, RunExecutionResult } from '../runOrchestrator'

export const geminiLlmRunAdapter: FunctionRunAdapter = {
  provider: 'gemini_llm',
  canRun: isGeminiLlmFunction,
  async prepare({ run, functionDef, inputValues, resources, loadResourceBlob }) {
    if (!functionDef.gemini) throw new Error(`${functionDef.name} is missing Gemini LLM config`)
    return {
      provider: 'gemini_llm',
      runId: run.id,
      functionId: functionDef.id,
      functionDef,
      outputDefs: functionDef.outputs,
      request: await createGeminiGenerateContentRequest(functionDef.gemini, inputValues, resources, loadResourceBlob),
    }
  },
  async execute(): Promise<RunExecutionResult> {
    throw new Error('Gemini LLM execution requires a runtime HTTP client')
  },
  async extractOutputs(result, task) {
    const text = extractGeminiGenerateContentText(result.raw)
    return task.outputDefs
      .filter((output) => output.type === 'text')
      .map((output) => ({ key: output.key, type: output.type, values: text ? [text] : [] }))
  },
}
