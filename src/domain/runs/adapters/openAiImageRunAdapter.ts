import {
  createOpenAIImageApiRequest,
  extractOpenAIImageGenerationOutputs,
  isOpenAIImageFunction,
} from '../../openaiImage'
import type { FunctionRunAdapter, RunExecutionResult } from '../runOrchestrator'

const defaultPrompt = (functionDef: Parameters<FunctionRunAdapter['canRun']>[0]) =>
  functionDef.inputs.find((input) => input.key === 'prompt')?.defaultValue

export const openAiImageRunAdapter: FunctionRunAdapter = {
  provider: 'openai_image',
  canRun: isOpenAIImageFunction,
  async prepare({ run, functionDef, inputValues, resources, loadResourceBlob }) {
    if (!functionDef.openaiImage) throw new Error(`${functionDef.name} is missing OpenAI image config`)
    return {
      provider: 'openai_image',
      runId: run.id,
      functionId: functionDef.id,
      functionDef,
      outputDefs: functionDef.outputs,
      request: await createOpenAIImageApiRequest(
        functionDef.openaiImage,
        inputValues,
        resources,
        defaultPrompt(functionDef),
        loadResourceBlob,
      ),
    }
  },
  async execute(): Promise<RunExecutionResult> {
    throw new Error('OpenAI image execution requires a runtime HTTP client')
  },
  async extractOutputs(result, task) {
    const values = extractOpenAIImageGenerationOutputs(result.raw, task.functionDef.openaiImage?.outputFormat)
    return task.outputDefs
      .filter((output) => output.type === 'image')
      .map((output) => ({ key: output.key, type: output.type, values }))
  },
}
