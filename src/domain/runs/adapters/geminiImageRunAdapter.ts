import {
  createGeminiImageGenerationRequest,
  extractGeminiImageGenerationOutputs,
  isGeminiImageFunction,
} from '../../geminiImage'
import type { FunctionRunAdapter, RunExecutionResult } from '../runOrchestrator'

const defaultPrompt = (functionDef: Parameters<FunctionRunAdapter['canRun']>[0]) =>
  functionDef.inputs.find((input) => input.key === 'prompt')?.defaultValue

export const geminiImageRunAdapter: FunctionRunAdapter = {
  provider: 'gemini_image',
  canRun: isGeminiImageFunction,
  async prepare({ run, functionDef, inputValues, resources, loadResourceBlob }) {
    if (!functionDef.geminiImage) throw new Error(`${functionDef.name} is missing Gemini image config`)
    return {
      provider: 'gemini_image',
      runId: run.id,
      functionId: functionDef.id,
      functionDef,
      outputDefs: functionDef.outputs,
      request: await createGeminiImageGenerationRequest(
        functionDef.geminiImage,
        inputValues,
        resources,
        defaultPrompt(functionDef),
        loadResourceBlob,
      ),
    }
  },
  async execute(): Promise<RunExecutionResult> {
    throw new Error('Gemini image execution requires a runtime HTTP client')
  },
  async extractOutputs(result, task) {
    const values = extractGeminiImageGenerationOutputs(result.raw)
    return task.outputDefs
      .filter((output) => output.type === 'image')
      .map((output) => ({ key: output.key, type: output.type, values }))
  },
}
