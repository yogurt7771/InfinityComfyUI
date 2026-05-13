import type { GenerationFunction } from './types'
import { GEMINI_LLM_FUNCTION_ID } from './geminiLlm'
import { GEMINI_IMAGE_FUNCTION_ID } from './geminiImage'
import { OPENAI_LLM_FUNCTION_ID } from './openaiLlm'
import { OPENAI_IMAGE_FUNCTION_ID } from './openaiImage'
import { REQUEST_FUNCTION_ID } from './requestFunction'

const builtInFunctionIds = new Set([
  OPENAI_LLM_FUNCTION_ID,
  GEMINI_LLM_FUNCTION_ID,
  OPENAI_IMAGE_FUNCTION_ID,
  GEMINI_IMAGE_FUNCTION_ID,
  REQUEST_FUNCTION_ID,
])

export const isBuiltInFunction = (fn: GenerationFunction) => builtInFunctionIds.has(fn.id)

export const withoutBuiltInFunctions = (functions: Record<string, GenerationFunction>) =>
  Object.fromEntries(Object.entries(functions).filter(([, fn]) => !isBuiltInFunction(fn)))

export const withoutBuiltInProjectFunctions = <T extends { functions: Record<string, GenerationFunction> }>(project: T): T => ({
  ...project,
  functions: withoutBuiltInFunctions(project.functions),
})
