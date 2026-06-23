import { executeLocalTransformFunction, isLocalTransformFunction } from '../../localTransforms'
import type { Resource } from '../../types'
import type { FunctionRunAdapter, RuntimeInputValues } from '../runOrchestrator'

type LocalTransformPreparedRequest = {
  inputValues: RuntimeInputValues
  resources: Record<string, Resource>
}

export const localTransformRunAdapter: FunctionRunAdapter = {
  provider: 'local_transform',
  canRun: isLocalTransformFunction,
  async prepare({ run, functionDef, inputValues, resources }) {
    return {
      provider: 'local_transform',
      runId: run.id,
      functionId: functionDef.id,
      functionDef,
      outputDefs: functionDef.outputs,
      request: { inputValues, resources },
    }
  },
  async execute(task, runtime) {
    const request = task.request as LocalTransformPreparedRequest
    const readResourceBlob = runtime?.readResourceBlob ?? runtime?.loadResourceBlob
    if (!readResourceBlob) throw new Error('Local transform execution requires a resource blob loader')
    return {
      raw: await executeLocalTransformFunction(task.functionDef, request.inputValues, request.resources, readResourceBlob),
    }
  },
  async extractOutputs(result) {
    if (!Array.isArray(result.raw)) return []
    return result.raw.map((output) => ({
      key: output.key,
      type: output.type,
      values: output.values,
    }))
  },
}
