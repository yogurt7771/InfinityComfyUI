import { compileRequestFunctionRequest, extractRequestFunctionOutputs, isRequestFunction } from '../../requestFunction'
import type { RequestBinaryOutputValue } from '../../requestFunction'
import type { FunctionRunAdapter, RunExecutionResult } from '../runOrchestrator'

export const httpRequestRunAdapter: FunctionRunAdapter = {
  provider: 'http_request',
  canRun: isRequestFunction,
  async prepare({ run, functionDef, inputValues, resources }) {
    return {
      provider: 'http_request',
      runId: run.id,
      functionId: functionDef.id,
      functionDef,
      outputDefs: functionDef.outputs,
      request: compileRequestFunctionRequest(functionDef, inputValues, resources),
    }
  },
  async execute(): Promise<RunExecutionResult> {
    throw new Error('HTTP request execution requires a runtime fetch client')
  },
  async extractOutputs(result, task) {
    return extractRequestFunctionOutputs(
      result.responseText ?? String(result.raw ?? ''),
      result.responseJson,
      task.outputDefs,
      result.responseBinary as RequestBinaryOutputValue | undefined,
    ).map((output) => ({
      key: output.key,
      type: output.type,
      values: output.values,
    }))
  },
}
