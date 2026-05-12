import { describe, expect, it } from 'vitest'
import {
  createOpenAIImageApiRequest,
  createOpenAIImageGenerationRequest,
  createOpenAIImageFunction,
  extractOpenAIImageGenerationOutputs,
  OPENAI_IMAGE_FUNCTION_ID,
} from './openaiImage'
import type { Resource } from './types'

describe('OpenAI image helpers', () => {
  it('creates an OpenAI image generation function with prompt and 10 optional image inputs', () => {
    const fn = createOpenAIImageFunction('2026-05-09T00:00:00.000Z')
    const imageInputs = fn.inputs.filter((input) => input.type === 'image')

    expect(fn.id).toBe(OPENAI_IMAGE_FUNCTION_ID)
    expect(fn.workflow.format).toBe('openai_image_generation')
    expect(fn.openaiImage).toMatchObject({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-image-2',
      size: 'auto',
      quality: 'auto',
      background: 'auto',
      outputFormat: 'png',
    })
    expect(fn.inputs[0]).toMatchObject({
      key: 'prompt',
      label: 'Prompt',
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
    expect(fn.outputs).toEqual([
      expect.objectContaining({
        key: 'image',
        label: 'Image',
        type: 'image',
      }),
    ])
  })

  it('builds an images generations request from a connected prompt and editable options', () => {
    const resources: Record<string, Resource> = {
      res_prompt: {
        id: 'res_prompt',
        type: 'text',
        name: 'Prompt',
        value: 'warm cinematic kitchen',
        source: { kind: 'manual_input' },
      },
    }

    const request = createOpenAIImageGenerationRequest(
      {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'demo',
        model: 'gpt-image-2',
        size: '1536x1024',
        quality: 'high',
        background: 'opaque',
        outputFormat: 'webp',
        outputCompression: 82,
        user: 'tester',
      },
      { prompt: { resourceId: 'res_prompt', type: 'text' } },
      resources,
      'fallback prompt',
    )

    expect(request).toEqual({
      model: 'gpt-image-2',
      prompt: 'warm cinematic kitchen',
      size: '1536x1024',
      quality: 'high',
      background: 'opaque',
      output_format: 'webp',
      output_compression: 82,
      user: 'tester',
    })
  })

  it('builds a multipart image edit request when image inputs are connected', async () => {
    const resources: Record<string, Resource> = {
      res_prompt: {
        id: 'res_prompt',
        type: 'text',
        name: 'Prompt',
        value: 'make the kitchen dusk blue',
        source: { kind: 'manual_input' },
      },
      res_image: {
        id: 'res_image',
        type: 'image',
        name: 'Reference',
        value: {
          assetId: 'asset_image',
          url: 'data:image/png;base64,cmVmZXJlbmNl',
          filename: 'reference.png',
          mimeType: 'image/png',
          sizeBytes: 9,
        },
        source: { kind: 'user_upload' },
      },
    }

    const request = await createOpenAIImageApiRequest(
      {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'demo',
        model: 'gpt-image-2',
        size: '1024x1024',
        quality: 'high',
        background: 'opaque',
        outputFormat: 'webp',
        outputCompression: 82,
        user: 'tester',
      },
      {
        prompt: { resourceId: 'res_prompt', type: 'text' },
        image_1: { resourceId: 'res_image', type: 'image' },
      },
      resources,
      'fallback prompt',
    )

    expect(request.kind).toBe('edit')
    expect(request.body).toBeInstanceOf(FormData)
    const body = request.body as FormData
    expect(body.get('model')).toBe('gpt-image-2')
    expect(body.get('prompt')).toBe('make the kitchen dusk blue')
    expect(body.get('size')).toBe('1024x1024')
    expect(body.get('quality')).toBe('high')
    expect(body.get('background')).toBe('opaque')
    expect(body.get('output_format')).toBe('webp')
    expect(body.get('output_compression')).toBe('82')
    expect(body.get('user')).toBe('tester')
    expect(body.getAll('image')).toHaveLength(1)
    const image = body.getAll('image')[0]
    expect(image).toBeInstanceOf(File)
    expect((image as File).name).toBe('reference.png')
    expect((image as File).type).toBe('image/png')
    await expect((image as File).text()).resolves.toBe('reference')
  })

  it('extracts base64 image generation outputs as data URLs', () => {
    expect(
      extractOpenAIImageGenerationOutputs(
        {
          data: [
            {
              b64_json: 'aW1hZ2UtYnl0ZXM=',
              output_format: 'jpeg',
            },
          ],
        },
        'png',
      ),
    ).toEqual([
      {
        dataUrl: 'data:image/jpeg;base64,aW1hZ2UtYnl0ZXM=',
        filename: 'openai-image-1.jpeg',
        mimeType: 'image/jpeg',
      },
    ])
  })
})
