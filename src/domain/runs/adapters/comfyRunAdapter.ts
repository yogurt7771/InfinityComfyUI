import { extractComfyOutputs } from '../../comfyOutputs'
import type { ComfyWorkflow } from '../../types'
import type { FunctionRunAdapter, RunExecutionResult, RunPreparedTask } from '../runOrchestrator'

type ComfyPreparedRequest = {
  workflow: ComfyWorkflow
}

export const comfyRunAdapter: FunctionRunAdapter = {
  provider: 'comfyui',
  canRun: (functionDef) => functionDef.workflow.format === 'comfyui_api_json',
  async prepare({ run, functionDef }) {
    return {
      provider: 'comfyui',
      runId: run.id,
      functionId: functionDef.id,
      functionDef,
      outputDefs: functionDef.outputs,
      request: {
        workflow: run.compiledWorkflowSnapshot ?? run.workflowTemplateSnapshot ?? functionDef.workflow.rawJson,
      },
    }
  },
  async execute(): Promise<RunExecutionResult> {
    throw new Error('ComfyUI execution requires a runtime ComfyPromptClient')
  },
  async extractOutputs(result: RunExecutionResult, task: RunPreparedTask) {
    const request = task.request as ComfyPreparedRequest
    return extractComfyOutputs(result.raw, request.workflow, task.outputDefs).map((output) => ({
      key: output.key,
      type: output.type,
      values: [...output.files, ...(output.texts ?? [])],
    }))
  },
}
