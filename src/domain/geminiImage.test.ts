import { describe, expect, it } from 'vitest'
import {
  createGeminiImageFunction,
  createGeminiImageGenerationRequest,
  extractGeminiImageGenerationOutputs,
  GEMINI_IMAGE_FUNCTION_ID,
} from './geminiImage'
import type { Resource } from './types'

describe('Gemini image helpers', () => {
  it('creates a Gemini image generation function defaulting to Nano Banana 2 with 10 optional image inputs', () => {
    const fn = createGeminiImageFunction('2026-05-09T00:00:00.000Z')
    const imageInputs = fn.inputs.filter((input) => input.type === 'image')

    expect(fn.id).toBe(GEMINI_IMAGE_FUNCTION_ID)
    expect(fn.workflow.format).toBe('gemini_image_generation')
    expect(fn.geminiImage).toMatchObject({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-3.1-flash-image-preview',
      responseModalities: 'IMAGE',
      aspectRatio: 'auto',
      imageSize: 'auto',
    })
    expect(fn.inputs[0]).toMatchObject({
      key: 'prompt',
      type: 'text',
      required: true,
    })
    expect(imageInputs.map((input) => input.key)).toEqual([
      'image_1',
      'image_2',
      'image_3',
      'image_4',
      'image_5',
      'image_6',
      'image_7',
      'image_8',
      'image_9',
      'image_10',
    ])
    expect(imageInputs.every((input) => !input.required)).toBe(true)
    expect(fn.outputs[0]).toMatchObject({
      key: 'image',
      type: 'image',
    })
  })

  it('builds a generateContent request with response image options', async () => {
    const resources: Record<string, Resource> = {
      res_prompt: {
        id: 'res_prompt',
        type: 'text',
        name: 'Prompt',
        value: 'nano banana product photo',
        source: { kind: 'manual_input' },
      },
    }

    const request = await createGeminiImageGenerationRequest(
      {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'gemini-test',
        model: 'gemini-3.1-flash-image-preview',
        responseModalities: 'IMAGE',
        aspectRatio: '16:9',
        imageSize: '2K',
      },
      { prompt: { resourceId: 'res_prompt', type: 'text' } },
      resources,
      'fallback prompt',
    )

    expect(request).toEqual({
      contents: [
        {
          parts: [{ text: 'nano banana product photo' }],
        },
      ],
      generationConfig: {
        responseModalities: ['IMAGE'],
        responseFormat: {
          image: {
            aspectRatio: '16:9',
            imageSize: '2K',
          },
        },
      },
    })
  })

  it('adds connected images as inline data parts in the same generateContent request', async () => {
    const resources: Record<string, Resource> = {
      res_prompt: {
        id: 'res_prompt',
        type: 'text',
        name: 'Prompt',
        value: 'turn this into an evening storefront',
        source: { kind: 'manual_input' },
      },
      res_image: {
        id: 'res_image',
        type: 'image',
        name: 'Reference',
        value: {
          assetId: 'asset_image',
          url: 'data:image/jpeg;base64,anBn',
          filename: 'reference.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 3,
        },
        source: { kind: 'user_upload' },
      },
    }

    const request = await createGeminiImageGenerationRequest(
      {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'gemini-test',
        model: 'gemini-3.1-flash-image-preview',
        responseModalities: 'TEXT_IMAGE',
        aspectRatio: 'auto',
        imageSize: 'auto',
      },
      {
        prompt: { resourceId: 'res_prompt', type: 'text' },
        image_1: { resourceId: 'res_image', type: 'image' },
      },
      resources,
      'fallback prompt',
    )

    expect(request).toEqual({
      contents: [
        {
          parts: [
            {
              inline_data: {
                mime_type: 'image/jpeg',
                data: 'anBn',
              },
            },
            { text: 'turn this into an evening storefront' },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    })
  })

  it('extracts inline image data from generateContent responses', () => {
    expect(
      extractGeminiImageGenerationOutputs({
        candidates: [
          {
            content: {
              parts: [
                { text: 'done' },
                { inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } },
                { inline_data: { mime_type: 'image/jpeg', data: 'anBlZw==' } },
              ],
            },
          },
        ],
      }),
    ).toEqual([
      {
        dataUrl: 'data:image/png;base64,aW1hZ2U=',
        filename: 'gemini-image-1.png',
        mimeType: 'image/png',
      },
      {
        dataUrl: 'data:image/jpeg;base64,anBlZw==',
        filename: 'gemini-image-2.jpeg',
        mimeType: 'image/jpeg',
      },
    ])
  })
})
