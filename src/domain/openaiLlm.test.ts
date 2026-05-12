import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createOpenAIChatCompletionRequest,
  createOpenAILlmFunction,
  extractOpenAIChatCompletionText,
  OPENAI_LLM_FUNCTION_ID,
} from './openaiLlm'
import type { Resource } from './types'

describe('OpenAI LLM helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates an OpenAI LLM function with six optional image inputs and text output', () => {
    const fn = createOpenAILlmFunction('2026-05-09T00:00:00.000Z')

    expect(fn.id).toBe(OPENAI_LLM_FUNCTION_ID)
    expect(fn.workflow.format).toBe('openai_chat_completions')
    expect(fn.openai?.messages).toMatchObject([
      { role: 'system', content: [{ type: 'text' }] },
      {
        role: 'user',
        content: [
          { type: 'text' },
          { type: 'image_url', content: 'image_1' },
          { type: 'image_url', content: 'image_2' },
          { type: 'image_url', content: 'image_3' },
          { type: 'image_url', content: 'image_4' },
          { type: 'image_url', content: 'image_5' },
          { type: 'image_url', content: 'image_6' },
        ],
      },
    ])
    expect(fn.inputs).toHaveLength(6)
    expect(fn.inputs.every((input) => input.type === 'image' && input.required === false)).toBe(true)
    expect(fn.outputs).toEqual([
      expect.objectContaining({
        key: 'text',
        label: 'Text',
        type: 'text',
      }),
    ])
  })

  it('builds a Chat Completions request from editable messages and connected image slots', async () => {
    const resources: Record<string, Resource> = {
      res_image: {
        id: 'res_image',
        type: 'image',
        name: 'Reference',
        value: {
          assetId: 'asset_image',
          url: 'data:image/png;base64,cmVm',
          filename: 'reference.png',
          mimeType: 'image/png',
          sizeBytes: 3,
        },
        source: { kind: 'user_upload' },
      },
    }

    const request = await createOpenAIChatCompletionRequest(
      {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'demo',
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content: [{ type: 'text', content: 'Return concise text.' }],
          },
          {
            role: 'user',
            content: [
              { type: 'text', content: 'Describe the image.' },
              { type: 'image_url', content: 'image_1', detail: 'low' },
              { type: 'image_url', content: 'image_2', detail: 'high' },
            ],
          },
        ],
      },
      { image_1: { resourceId: 'res_image', type: 'image' } },
      resources,
    )

    expect(request).toEqual({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'Return concise text.' }] },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe the image.' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,cmVm', detail: 'low' },
            },
          ],
        },
      ],
    })
  })

  it('encodes fetched image URLs as base64 data URLs before sending to Chat Completions', async () => {
    const sourceUrl = 'http://127.0.0.1:27707/view?filename=reference.png&type=output'
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('reference-bytes', {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = await createOpenAIChatCompletionRequest(
      {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'demo',
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'user',
            content: [{ type: 'image_url', content: 'image_1', detail: 'low' }],
          },
        ],
      },
      { image_1: { resourceId: 'res_image', type: 'image' } },
      {
        res_image: {
          id: 'res_image',
          type: 'image',
          name: 'Reference',
          value: {
            assetId: 'asset_image',
            url: sourceUrl,
            filename: 'reference.png',
            mimeType: 'image/png',
            sizeBytes: 15,
          },
          source: { kind: 'function_output' },
        },
      },
    )

    expect(fetchMock).toHaveBeenCalledWith(sourceUrl)
    expect(request.messages[0]?.content).toEqual([
      {
        type: 'image_url',
        image_url: {
          url: 'data:image/png;base64,cmVmZXJlbmNlLWJ5dGVz',
          detail: 'low',
        },
      },
    ])
  })

  it('extracts text from Chat Completions output shapes', () => {
    expect(
      extractOpenAIChatCompletionText({
        choices: [
          {
            message: { content: 'direct text' },
          },
        ],
      }),
    ).toBe('direct text')
    expect(
      extractOpenAIChatCompletionText({
        choices: [
          {
            message: {
              content: [
                { type: 'text', text: 'nested text' },
                { type: 'refusal', refusal: 'no' },
              ],
            },
          },
        ],
      }),
    ).toBe('nested text')
  })
})
