import { describe, expect, it } from 'vitest'
import { isBuiltInFunction, withoutBuiltInFunctions } from './builtInFunctions'
import { createOpenAILlmFunction } from './openaiLlm'

describe('built-in function detection', () => {
  it('uses reserved built-in ids instead of provider workflow formats', () => {
    const now = '2026-05-13T00:00:00.000Z'
    const builtInOpenAi = createOpenAILlmFunction(now)
    const customOpenAi = {
      ...createOpenAILlmFunction(now),
      id: 'fn_custom_openai_llm',
      name: 'Client OpenAI LLM',
    }

    expect(isBuiltInFunction(builtInOpenAi)).toBe(true)
    expect(isBuiltInFunction(customOpenAi)).toBe(false)
    expect(withoutBuiltInFunctions({ [builtInOpenAi.id]: builtInOpenAi, [customOpenAi.id]: customOpenAi })).toEqual({
      [customOpenAi.id]: customOpenAi,
    })
  })
})
