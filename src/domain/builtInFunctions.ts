import type { GenerationFunction } from './types'

const builtInFunctionFormats = new Set<GenerationFunction['workflow']['format']>([
  'openai_chat_completions',
  'openai_responses',
  'gemini_generate_content',
  'openai_image_generation',
  'gemini_image_generation',
])

export const isBuiltInFunction = (fn: GenerationFunction) => builtInFunctionFormats.has(fn.workflow.format)

export const withoutBuiltInFunctions = (functions: Record<string, GenerationFunction>) =>
  Object.fromEntries(Object.entries(functions).filter(([, fn]) => !isBuiltInFunction(fn)))

export const withoutBuiltInProjectFunctions = <T extends { functions: Record<string, GenerationFunction> }>(project: T): T => ({
  ...project,
  functions: withoutBuiltInFunctions(project.functions),
})
