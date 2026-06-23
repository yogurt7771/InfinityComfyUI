import { createOpenAIChatCompletionRequest, extractOpenAIChatCompletionText, isOpenAILlmFunction } from '../../openaiLlm'
import type { FunctionRunAdapter, RunExecutionResult } from '../runOrchestrator'

export const openAiLlmRunAdapter: FunctionRunAdapter = {
  provider: 'openai_llm',
  canRun: isOpenAILlmFunction,
  async prepare({ run, functionDef, inputValues, resources, loadResourceBlob }) {
    if (!functionDef.openai) throw new Error(`${functionDef.name} is missing OpenAI LLM config`)
    return {
      provider: 'openai_llm',
      runId: run.id,
      functionId: functionDef.id,
      functionDef,
      outputDefs: functionDef.outputs,
      request: await createOpenAIChatCompletionRequest(functionDef.openai, inputValues, resources, loadResourceBlob),
    }
  },
  async execute(): Promise<RunExecutionResult> {
    throw new Error('OpenAI LLM execution requires a runtime HTTP client')
  },
  async extractOutputs(result, task) {
    const text = extractOpenAIChatCompletionText(result.raw)
    return task.outputDefs
      .filter((output) => output.type === 'text')
      .map((output) => ({ key: output.key, type: output.type, values: text ? [text] : [] }))
  },
}
