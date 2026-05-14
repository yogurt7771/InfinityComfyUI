import type { GenerationFunction } from './types'
import { GEMINI_LLM_FUNCTION_ID } from './geminiLlm'
import { GEMINI_IMAGE_FUNCTION_ID } from './geminiImage'
import { OPENAI_LLM_FUNCTION_ID } from './openaiLlm'
import { OPENAI_IMAGE_FUNCTION_ID } from './openaiImage'
import { REQUEST_FUNCTION_ID } from './requestFunction'
import {
  LOCAL_AUDIO_INFO_FUNCTION_ID,
  LOCAL_IMAGE_BLUR_FUNCTION_ID,
  LOCAL_IMAGE_GRID_SPLIT_FUNCTION_ID,
  LOCAL_IMAGE_INFO_FUNCTION_ID,
  LOCAL_IMAGE_RESIZE_FUNCTION_ID,
  LOCAL_TEXT_CASE_FUNCTION_ID,
  LOCAL_TEXT_TRIM_FUNCTION_ID,
  LOCAL_VIDEO_INFO_FUNCTION_ID,
} from './localTransforms'

const builtInFunctionIds = new Set([
  OPENAI_LLM_FUNCTION_ID,
  GEMINI_LLM_FUNCTION_ID,
  OPENAI_IMAGE_FUNCTION_ID,
  GEMINI_IMAGE_FUNCTION_ID,
  REQUEST_FUNCTION_ID,
  LOCAL_IMAGE_RESIZE_FUNCTION_ID,
  LOCAL_IMAGE_BLUR_FUNCTION_ID,
  LOCAL_IMAGE_GRID_SPLIT_FUNCTION_ID,
  LOCAL_IMAGE_INFO_FUNCTION_ID,
  LOCAL_TEXT_TRIM_FUNCTION_ID,
  LOCAL_TEXT_CASE_FUNCTION_ID,
  LOCAL_VIDEO_INFO_FUNCTION_ID,
  LOCAL_AUDIO_INFO_FUNCTION_ID,
])

export const isBuiltInFunction = (fn: GenerationFunction) => builtInFunctionIds.has(fn.id)

export const withoutBuiltInFunctions = (functions: Record<string, GenerationFunction>) =>
  Object.fromEntries(Object.entries(functions).filter(([, fn]) => !isBuiltInFunction(fn)))

export const withoutBuiltInProjectFunctions = <T extends { functions: Record<string, GenerationFunction> }>(project: T): T => ({
  ...project,
  functions: withoutBuiltInFunctions(project.functions),
})
