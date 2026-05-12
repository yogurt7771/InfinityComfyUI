import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createGeminiGenerateContentRequest,
  createGeminiLlmFunction,
  extractGeminiGenerateContentText,
  GEMINI_LLM_FUNCTION_ID,
} from './geminiLlm'
import type { Resource } from './types'

describe('Gemini LLM helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates a Gemini LLM function with six optional image inputs and text output', () => {
    const fn = createGeminiLlmFunction('2026-05-09T00:00:00.000Z')

    expect(fn.id).toBe(GEMINI_LLM_FUNCTION_ID)
    expect(fn.workflow.format).toBe('gemini_generate_content')
    expect(fn.gemini?.messages).toMatchObject([
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

  it('builds a generateContent request with system instruction and inline image data', async () => {
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

    const request = await createGeminiGenerateContentRequest(
      {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'gemini-test',
        model: 'gemini-2.5-flash',
        messages: [
          { role: 'system', content: [{ type: 'text', content: 'Return concise text.' }] },
          {
            role: 'user',
            content: [
              { type: 'text', content: 'Describe the image.' },
              { type: 'image_url', content: 'image_1' },
              { type: 'image_url', content: 'image_2' },
            ],
          },
        ],
      },
      { image_1: { resourceId: 'res_image', type: 'image' } },
      resources,
    )

    expect(request).toEqual({
      system_instruction: {
        parts: [{ text: 'Return concise text.' }],
      },
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'Describe the image.' },
            {
              inline_data: {
                mime_type: 'image/png',
                data: 'cmVm',
              },
            },
          ],
        },
      ],
    })
  })

  it('encodes fetched image URLs as Gemini inline base64 data', async () => {
    const sourceUrl = 'http://127.0.0.1:27707/view?filename=reference.png&type=output'
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('reference-bytes', {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = await createGeminiGenerateContentRequest(
      {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'gemini-test',
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: [{ type: 'image_url', content: 'image_1' }] }],
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
    expect(request.contents[0]?.parts).toEqual([
      {
        inline_data: {
          mime_type: 'image/png',
          data: 'cmVmZXJlbmNlLWJ5dGVz',
        },
      },
    ])
  })

  it('extracts text from generateContent response candidates', () => {
    expect(
      extractGeminiGenerateContentText({
        candidates: [
          {
            content: {
              parts: [{ text: 'Gemini output text' }],
            },
          },
        ],
      }),
    ).toBe('Gemini output text')
  })
})
