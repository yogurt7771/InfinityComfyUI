import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { createProjectSlice } from './projectStore'
import { createOpenAILlmFunction, OPENAI_LLM_FUNCTION_ID } from '../domain/openaiLlm'
import { GEMINI_LLM_FUNCTION_ID } from '../domain/geminiLlm'
import { OPENAI_IMAGE_FUNCTION_ID } from '../domain/openaiImage'
import { GEMINI_IMAGE_FUNCTION_ID } from '../domain/geminiImage'
import { REQUEST_FUNCTION_ID } from '../domain/requestFunction'
import type { GenerationFunction } from '../domain/types'

describe('project store actions', () => {
  const flushPromises = async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  }

  const testComfyWorkflow = () => ({
    '6': {
      class_type: 'CLIPTextEncode',
      _meta: { title: 'Positive Prompt' },
      inputs: {
        text: 'warm interior render',
      },
    },
    '3': {
      class_type: 'KSampler',
      _meta: { title: 'Sampler' },
      inputs: {
        seed: 0,
        steps: 24,
        cfg: 7,
      },
    },
    '20': {
      class_type: 'SaveImage',
      _meta: { title: 'Result_Image' },
      inputs: {
        filename_prefix: 'infinity-comfyui',
      },
    },
  })

  const addTestWorkflowFunction = (slice: ReturnType<typeof createProjectSlice>) => {
    slice.getState().addFunctionFromWorkflow('Interior Render Workflow', testComfyWorkflow())
  }

  it('creates, switches, edits, and deletes local projects', () => {
    const ids = ['project_second']
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback_id',
      now: () => '2026-05-09T00:00:00.000Z',
      randomInt: () => 1,
    })
    const firstProjectId = slice.getState().project.project.id
    const state = slice.getState() as unknown as {
      projectLibrary: Record<string, unknown>
      createProject: (options?: { name?: string; description?: string }) => string
      switchProject: (projectId: string) => void
      updateProjectMetadata: (patch: { name?: string; description?: string }) => void
      deleteProject: (projectId: string) => void
    }

    state.updateProjectMetadata({ name: 'Kitchen Board', description: 'Client-facing renders' })
    const secondProjectId = state.createProject({ name: 'Mood Board' })

    expect(secondProjectId).toBe('project_second')
    expect(slice.getState().project.project).toMatchObject({ id: 'project_second', name: 'Mood Board' })
    expect(slice.getState().project.canvas.nodes).toEqual([])
    expect((slice.getState() as unknown as { projectLibrary: Record<string, unknown> }).projectLibrary[firstProjectId]).toMatchObject({
      project: { id: firstProjectId, name: 'Kitchen Board', description: 'Client-facing renders' },
    })

    state.switchProject(firstProjectId)
    expect(slice.getState().project.project.name).toBe('Kitchen Board')

    state.switchProject(secondProjectId)
    state.deleteProject(secondProjectId)

    expect(slice.getState().project.project.id).toBe(firstProjectId)
    expect((slice.getState() as unknown as { projectLibrary: Record<string, unknown> }).projectLibrary[secondProjectId]).toBeUndefined()
  })

  it('refreshes enabled ComfyUI endpoint health through configured clients', async () => {
    const createComfyClient = vi.fn((endpoint: { id: string }) => ({
      queuePrompt: vi.fn(),
      getHistory: vi.fn(),
      testConnection:
        endpoint.id === 'endpoint_local'
          ? vi.fn().mockResolvedValue({ system: { comfyui_version: 'test' } })
          : vi.fn().mockRejectedValue(new Error('connection refused')),
    }))
    const slice = createProjectSlice({
      now: () => '2026-05-09T00:00:00.000Z',
      createComfyClient,
    })

    slice.setState((state) => ({
      project: {
        ...state.project,
        comfy: {
          ...state.project.comfy,
          endpoints: [
            state.project.comfy.endpoints[0]!,
            {
              ...state.project.comfy.endpoints[0]!,
              id: 'endpoint_remote',
              name: 'Remote ComfyUI',
              baseUrl: 'http://127.0.0.1:27707',
            },
            {
              ...state.project.comfy.endpoints[0]!,
              id: 'endpoint_disabled',
              name: 'Disabled ComfyUI',
              enabled: false,
            },
          ],
        },
      },
    }))

    await slice.getState().checkComfyEndpointStatuses()

    expect(createComfyClient).toHaveBeenCalledTimes(2)
    expect(slice.getState().project.comfy.endpoints).toEqual([
      expect.objectContaining({ id: 'endpoint_local', health: expect.objectContaining({ status: 'online' }) }),
      expect.objectContaining({
        id: 'endpoint_remote',
        health: expect.objectContaining({ status: 'offline', message: 'connection refused' }),
      }),
      expect.objectContaining({ id: 'endpoint_disabled', health: expect.objectContaining({ status: 'unknown' }) }),
    ])
  })

  it('runs the built-in OpenAI LLM node with optional image inputs and creates text output', async () => {
    const ids = ['node_openai', 'task_1', 'node_result_1', 'res_text_1']
    const createComfyClient = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'The image shows a warm interior.' } }] }),
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock as typeof fetch
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-09T00:00:00.000Z',
      randomInt: () => 1,
      createComfyClient,
    })

    try {
      slice.setState((state) => ({
        project: {
          ...state.project,
          resources: {
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
              metadata: { createdAt: '2026-05-09T00:00:00.000Z' },
            },
          },
        },
      }))
      slice.getState().addFunctionNode(OPENAI_LLM_FUNCTION_ID)
      slice.setState((state) => ({
        project: {
          ...state.project,
          canvas: {
            ...state.project.canvas,
            nodes: state.project.canvas.nodes.map((node) =>
              node.id === 'node_openai'
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      inputValues: { image_1: { resourceId: 'res_image', type: 'image' } },
                      openaiConfig: {
                        baseUrl: 'https://api.openai.com/v1',
                        apiKey: 'demo',
                        model: 'gpt-4.1-mini',
                        messages: [
                          {
                            role: 'user',
                            content: [
                              { type: 'text', content: 'Describe it.' },
                              { type: 'image_url', content: 'image_1', detail: 'low' },
                            ],
                          },
                        ],
                      },
                    },
                  }
                : node,
            ),
          },
        },
      }))

      await slice.getState().runFunctionNodeWithComfy('node_openai', 1)

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer demo',
          }),
          body: JSON.stringify({
            model: 'gpt-4.1-mini',
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'Describe it.' },
                  {
                    type: 'image_url',
                    image_url: { url: 'data:image/png;base64,cmVm', detail: 'low' },
                  },
                ],
              },
            ],
          }),
        }),
      )
      expect(createComfyClient).not.toHaveBeenCalled()
      expect(slice.getState().project.tasks.task_1.status).toBe('succeeded')
      expect(slice.getState().project.resources.res_text_1).toMatchObject({
        type: 'text',
        value: 'The image shows a warm interior.',
        source: {
          kind: 'function_output',
          functionNodeId: 'node_openai',
          resultGroupNodeId: 'node_result_1',
          outputKey: 'text',
        },
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('runs the built-in Gemini LLM node directly and creates text output', async () => {
    const ids = ['node_gemini', 'task_1', 'node_result_1', 'res_text_1']
    const createComfyClient = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Gemini text result' }] } }],
      }),
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock as typeof fetch
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-09T00:00:00.000Z',
      randomInt: () => 1,
      createComfyClient,
    })

    try {
      slice.getState().addFunctionNode(GEMINI_LLM_FUNCTION_ID)
      slice.setState((state) => ({
        project: {
          ...state.project,
          canvas: {
            ...state.project.canvas,
            nodes: state.project.canvas.nodes.map((node) =>
              node.id === 'node_gemini'
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      geminiConfig: {
                        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
                        apiKey: 'gemini-test',
                        model: 'gemini-2.5-flash',
                        messages: [
                          { role: 'system', content: [{ type: 'text', content: 'Return concise text.' }] },
                          { role: 'user', content: [{ type: 'text', content: 'Describe it.' }] },
                        ],
                      },
                    },
                  }
                : node,
            ),
          },
        },
      }))

      await slice.getState().runFunctionNodeWithComfy('node_gemini', 1)

      expect(fetchMock).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-goog-api-key': 'gemini-test',
          }),
          body: JSON.stringify({
            system_instruction: {
              parts: [{ text: 'Return concise text.' }],
            },
            contents: [{ role: 'user', parts: [{ text: 'Describe it.' }] }],
          }),
        }),
      )
      expect(createComfyClient).not.toHaveBeenCalled()
      expect(slice.getState().project.tasks.task_1).toMatchObject({
        status: 'succeeded',
        endpointId: 'gemini',
      })
      expect(slice.getState().project.resources.res_text_1).toMatchObject({
        type: 'text',
        value: 'Gemini text result',
        source: {
          kind: 'function_output',
          functionNodeId: 'node_gemini',
          resultGroupNodeId: 'node_result_1',
          outputKey: 'text',
        },
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('runs the built-in OpenAI image node directly and creates all image outputs from one response', async () => {
    const ids = [
      'res_prompt',
      'node_openai_image',
      'task_1',
      'node_result_1',
      'asset_1',
      'res_image_1',
      'asset_2',
      'res_image_2',
    ]
    const createComfyClient = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { b64_json: 'aW1hZ2Ux', output_format: 'webp' },
          { b64_json: 'aW1hZ2Uy', output_format: 'webp' },
        ],
      }),
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock as typeof fetch
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-09T00:00:00.000Z',
      randomInt: () => 1,
      createComfyClient,
    })

    try {
      slice.getState().addTextResourceAtPosition('Prompt', 'warm kitchen', { x: 80, y: 100 })
      slice.getState().addFunctionNode(OPENAI_IMAGE_FUNCTION_ID)
      slice.setState((state) => ({
        project: {
          ...state.project,
          canvas: {
            ...state.project.canvas,
            nodes: state.project.canvas.nodes.map((node) =>
              node.id === 'node_openai_image'
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      inputValues: { prompt: { resourceId: 'res_prompt', type: 'text' } },
                      openaiImageConfig: {
                        baseUrl: 'https://api.openai.com/v1',
                        apiKey: 'demo',
                        model: 'gpt-image-2',
                        size: '1024x1536',
                        quality: 'high',
                        background: 'opaque',
                        outputFormat: 'webp',
                        outputCompression: 90,
                        user: '',
                      },
                    },
                  }
                : node,
            ),
          },
        },
      }))

      await slice.getState().runFunctionNodeWithComfy('node_openai_image', 1)

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.openai.com/v1/images/generations',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer demo',
          }),
          body: JSON.stringify({
            model: 'gpt-image-2',
            prompt: 'warm kitchen',
            size: '1024x1536',
            quality: 'high',
            background: 'opaque',
            output_format: 'webp',
            output_compression: 90,
          }),
        }),
      )
      expect(createComfyClient).not.toHaveBeenCalled()
      expect(slice.getState().project.tasks.task_1.outputRefs.image).toEqual([
        { resourceId: 'res_image_1', type: 'image' },
        { resourceId: 'res_image_2', type: 'image' },
      ])
      expect(slice.getState().project.canvas.nodes.find((node) => node.id === 'node_result_1')?.data.resources).toEqual([
        { resourceId: 'res_image_1', type: 'image' },
        { resourceId: 'res_image_2', type: 'image' },
      ])
      expect(slice.getState().project.resources.res_image_1).toMatchObject({
        type: 'image',
        value: {
          assetId: 'asset_1',
          url: 'data:image/webp;base64,aW1hZ2Ux',
          filename: 'openai-image-1.webp',
          mimeType: 'image/webp',
        },
      })
      expect(slice.getState().project.resources.res_image_2).toMatchObject({
        type: 'image',
        value: {
          assetId: 'asset_2',
          url: 'data:image/webp;base64,aW1hZ2Uy',
          filename: 'openai-image-2.webp',
          mimeType: 'image/webp',
        },
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('runs the built-in Gemini image node directly and creates all image outputs from one response', async () => {
    const ids = [
      'res_prompt',
      'node_gemini_image',
      'task_1',
      'node_result_1',
      'asset_1',
      'res_image_1',
      'asset_2',
      'res_image_2',
    ]
    const createComfyClient = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                { inlineData: { mimeType: 'image/png', data: 'Z2VtaW5pMQ==' } },
                { inlineData: { mimeType: 'image/png', data: 'Z2VtaW5pMg==' } },
              ],
            },
          },
        ],
      }),
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock as typeof fetch
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-09T00:00:00.000Z',
      randomInt: () => 1,
      createComfyClient,
    })

    try {
      slice.getState().addTextResourceAtPosition('Prompt', 'banana product photo', { x: 80, y: 100 })
      slice.getState().addFunctionNode(GEMINI_IMAGE_FUNCTION_ID)
      slice.setState((state) => ({
        project: {
          ...state.project,
          canvas: {
            ...state.project.canvas,
            nodes: state.project.canvas.nodes.map((node) =>
              node.id === 'node_gemini_image'
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      inputValues: { prompt: { resourceId: 'res_prompt', type: 'text' } },
                      geminiImageConfig: {
                        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
                        apiKey: 'gemini-test',
                        model: 'gemini-3.1-flash-image-preview',
                        responseModalities: 'IMAGE',
                        aspectRatio: '16:9',
                        imageSize: '2K',
                      },
                    },
                  }
                : node,
            ),
          },
        },
      }))

      await slice.getState().runFunctionNodeWithComfy('node_gemini_image', 1)

      expect(fetchMock).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-goog-api-key': 'gemini-test',
          }),
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'banana product photo' }] }],
            generationConfig: {
              responseModalities: ['IMAGE'],
              responseFormat: {
                image: {
                  aspectRatio: '16:9',
                  imageSize: '2K',
                },
              },
            },
          }),
        }),
      )
      expect(createComfyClient).not.toHaveBeenCalled()
      expect(slice.getState().project.tasks.task_1.outputRefs.image).toEqual([
        { resourceId: 'res_image_1', type: 'image' },
        { resourceId: 'res_image_2', type: 'image' },
      ])
      expect(slice.getState().project.canvas.nodes.find((node) => node.id === 'node_result_1')?.data.resources).toEqual([
        { resourceId: 'res_image_1', type: 'image' },
        { resourceId: 'res_image_2', type: 'image' },
      ])
      expect(slice.getState().project.resources.res_image_1).toMatchObject({
        type: 'image',
        value: {
          assetId: 'asset_1',
          url: 'data:image/png;base64,Z2VtaW5pMQ==',
          filename: 'gemini-image-1.png',
          mimeType: 'image/png',
        },
      })
      expect(slice.getState().project.resources.res_image_2).toMatchObject({
        type: 'image',
        value: {
          assetId: 'asset_2',
          url: 'data:image/png;base64,Z2VtaW5pMg==',
          filename: 'gemini-image-2.png',
          mimeType: 'image/png',
        },
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('does not auto-bind directly created OpenAI and Gemini image nodes to existing text resources', () => {
    const ids = ['res_prompt', 'node_openai_image', 'node_gemini_image']
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-09T00:00:00.000Z',
      randomInt: () => 1,
    })

    slice.getState().addTextResourceAtPosition('Prompt', 'existing text should stay unconnected', { x: 80, y: 100 })
    slice.getState().addFunctionNode(OPENAI_IMAGE_FUNCTION_ID)
    slice.getState().addFunctionNode(GEMINI_IMAGE_FUNCTION_ID)

    expect(slice.getState().project.canvas.nodes.find((node) => node.id === 'node_openai_image')?.data.inputValues).toEqual(
      {},
    )
    expect(slice.getState().project.canvas.nodes.find((node) => node.id === 'node_gemini_image')?.data.inputValues).toEqual(
      {},
    )
    expect(slice.getState().project.canvas.edges).toEqual([])
  })

  it('upgrades persisted built-in image functions to include optional image inputs', () => {
    const slice = createProjectSlice({
      now: () => '2026-05-09T00:00:00.000Z',
    })
    const savedProject = slice.getState().project
    const oldPromptOnlyOpenAiImage = {
      ...savedProject.functions[OPENAI_IMAGE_FUNCTION_ID]!,
      openaiImage: {
        ...savedProject.functions[OPENAI_IMAGE_FUNCTION_ID]!.openaiImage!,
        baseUrl: 'https://image-proxy.local/v1',
      },
      inputs: [savedProject.functions[OPENAI_IMAGE_FUNCTION_ID]!.inputs[0]!],
    }
    const oldPromptOnlyGeminiImage = {
      ...savedProject.functions[GEMINI_IMAGE_FUNCTION_ID]!,
      geminiImage: {
        ...savedProject.functions[GEMINI_IMAGE_FUNCTION_ID]!.geminiImage!,
        baseUrl: 'https://gemini-proxy.local/v1beta',
      },
      inputs: [savedProject.functions[GEMINI_IMAGE_FUNCTION_ID]!.inputs[0]!],
    }

    slice.getState().importProject({
      project: {
        ...savedProject,
        functions: {
          ...savedProject.functions,
          [OPENAI_IMAGE_FUNCTION_ID]: oldPromptOnlyOpenAiImage,
          [GEMINI_IMAGE_FUNCTION_ID]: oldPromptOnlyGeminiImage,
        },
      },
    })

    const openAiImageFunction = slice.getState().project.functions[OPENAI_IMAGE_FUNCTION_ID]!
    const geminiImageFunction = slice.getState().project.functions[GEMINI_IMAGE_FUNCTION_ID]!
    expect(openAiImageFunction.inputs.map((input) => input.key)).toEqual([
      'prompt',
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
    expect(geminiImageFunction.inputs.map((input) => input.key)).toEqual([
      'prompt',
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
    expect(openAiImageFunction.openaiImage?.baseUrl).toBe('https://image-proxy.local/v1')
    expect(geminiImageFunction.geminiImage?.baseUrl).toBe('https://gemini-proxy.local/v1beta')
  })

  it('does not update or delete built-in functions through function management actions', () => {
    const slice = createProjectSlice({
      now: () => '2026-05-09T00:00:00.000Z',
    })
    const originalFunction = slice.getState().project.functions[OPENAI_IMAGE_FUNCTION_ID]!

    slice.getState().updateFunction(OPENAI_IMAGE_FUNCTION_ID, { name: 'Edited Built In' })
    expect(slice.getState().project.functions[OPENAI_IMAGE_FUNCTION_ID]).toEqual(originalFunction)

    slice.getState().deleteFunction(OPENAI_IMAGE_FUNCTION_ID)
    expect(slice.getState().project.functions[OPENAI_IMAGE_FUNCTION_ID]).toEqual(originalFunction)
  })

  it('flags missing required inputs without creating implicit bindings or tasks', async () => {
    const ids = ['res_prompt', 'fn_1', 'node_fn_1']
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-09T00:00:00.000Z',
      randomInt: () => 1,
    })

    slice.getState().addTextResource('Prompt', 'existing prompt should not be auto-filled')
    addTestWorkflowFunction(slice)
    slice.getState().addFunctionNode('fn_1')

    await slice.getState().runFunctionNodeWithComfy('node_fn_1', 1)

    const functionNode = slice.getState().project.canvas.nodes.find((node) => node.id === 'node_fn_1')
    expect(functionNode?.data.inputValues).toEqual({})
    expect(functionNode?.data.missingInputKeys).toEqual(['prompt'])
    expect(slice.getState().project.canvas.edges).toEqual([])
    expect(slice.getState().project.tasks).toEqual({})

    slice.getState().connectNodes('node_res_prompt', 'node_fn_1')

    expect(slice.getState().project.canvas.nodes.find((node) => node.id === 'node_fn_1')?.data.missingInputKeys).toEqual([])
    expect(slice.getState().project.canvas.nodes.find((node) => node.id === 'node_fn_1')?.data.inputValues).toEqual({
      prompt: { resourceId: 'res_prompt', type: 'text' },
    })
  })

  it('stores optional primitive function inputs and lets resource connections override them', () => {
    const ids = ['fn_1', 'node_fn_1', 'res_scale']
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-09T00:00:00.000Z',
      randomInt: () => 1,
    })

    addTestWorkflowFunction(slice)
    slice.setState((state) => {
      const fn = state.project.functions.fn_1!
      return {
        project: {
          ...state.project,
          functions: {
            ...state.project.functions,
            fn_1: {
              ...fn,
              inputs: [
                ...fn.inputs,
                {
                  key: 'scale_by',
                  label: 'Scale By',
                  type: 'number' as const,
                  required: false,
                  defaultValue: 1,
                  bind: { nodeId: '3', nodeTitle: 'Sampler', path: 'inputs.cfg' },
                  upload: { strategy: 'none' as const },
                },
              ],
            },
          },
        },
      }
    })
    slice.getState().addFunctionNode('fn_1')

    slice.getState().updateFunctionNodeInputValue('node_fn_1', 'scale_by', 1.5)
    expect(slice.getState().project.canvas.nodes.find((node) => node.id === 'node_fn_1')?.data.inputValues).toEqual({
      scale_by: 1.5,
    })

    slice.getState().addEmptyResourceAtPosition('number', { x: 80, y: 160 })
    slice.getState().updateNumberResourceValue('res_scale', 2)
    slice.getState().connectNodes('node_res_scale', 'node_fn_1', { targetInputKey: 'scale_by' })

    expect(slice.getState().project.canvas.nodes.find((node) => node.id === 'node_fn_1')?.data.inputValues).toEqual({
      scale_by: { resourceId: 'res_scale', type: 'number' },
    })
  })

  it('stores custom node sizes for resized function nodes', () => {
    const ids = ['fn_1', 'node_fn_1']
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-09T00:00:00.000Z',
      randomInt: () => 1,
    })

    addTestWorkflowFunction(slice)
    slice.getState().addFunctionNode('fn_1')
    slice.getState().updateNodeSize('node_fn_1', { width: 520, height: 380 })

    expect(slice.getState().project.canvas.nodes.find((node) => node.id === 'node_fn_1')?.data.size).toEqual({
      width: 520,
      height: 380,
    })
  })

  it('creates empty text assets with an empty string by default and accepts explicit primitive initial values', () => {
    const ids = ['res_text_default', 'res_text_initial', 'res_number_initial']
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-09T00:00:00.000Z',
      randomInt: () => 1,
    })

    slice.getState().addEmptyResourceAtPosition('text', { x: 80, y: 160 })
    slice.getState().addEmptyResourceAtPosition('text', { x: 120, y: 160 }, 'low quality')
    slice.getState().addEmptyResourceAtPosition('number', { x: 160, y: 160 }, 1.5)

    expect(slice.getState().project.resources.res_text_default).toMatchObject({
      type: 'text',
      value: '',
    })
    expect(slice.getState().project.resources.res_text_initial).toMatchObject({
      type: 'text',
      value: 'low quality',
    })
    expect(slice.getState().project.resources.res_number_initial).toMatchObject({
      type: 'number',
      value: 1.5,
    })
  })

  it('uses the OpenAI image edit endpoint when an image input is connected', async () => {
    const ids = ['node_openai_image', 'task_1', 'node_result_1', 'asset_1', 'res_image_1']
    const createComfyClient = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'ZWRpdGVk', output_format: 'png' }] }),
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock as typeof fetch
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-09T00:00:00.000Z',
      randomInt: () => 1,
      createComfyClient,
    })

    try {
      slice.setState((state) => ({
        project: {
          ...state.project,
          resources: {
            res_prompt: {
              id: 'res_prompt',
              type: 'text',
              name: 'Prompt',
              value: 'make the reference brighter',
              source: { kind: 'manual_input' },
              metadata: { createdAt: '2026-05-09T00:00:00.000Z' },
            },
            res_reference: {
              id: 'res_reference',
              type: 'image',
              name: 'Reference',
              value: {
                assetId: 'asset_reference',
                url: 'data:image/png;base64,cmVm',
                filename: 'reference.png',
                mimeType: 'image/png',
                sizeBytes: 3,
              },
              source: { kind: 'user_upload' },
              metadata: { createdAt: '2026-05-09T00:00:00.000Z' },
            },
          },
        },
      }))
      slice.getState().addFunctionNode(OPENAI_IMAGE_FUNCTION_ID)
      slice.setState((state) => ({
        project: {
          ...state.project,
          canvas: {
            ...state.project.canvas,
            nodes: state.project.canvas.nodes.map((node) =>
              node.id === 'node_openai_image'
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      inputValues: {
                        prompt: { resourceId: 'res_prompt', type: 'text' },
                        image_1: { resourceId: 'res_reference', type: 'image' },
                      },
                      openaiImageConfig: {
                        baseUrl: 'https://api.openai.com/v1',
                        apiKey: 'demo',
                        model: 'gpt-image-2',
                        size: '1024x1024',
                        quality: 'high',
                        background: 'auto',
                        outputFormat: 'png',
                        outputCompression: 100,
                        user: '',
                      },
                    },
                  }
                : node,
            ),
          },
        },
      }))

      await slice.getState().runFunctionNodeWithComfy('node_openai_image', 1)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toBe('https://api.openai.com/v1/images/edits')
      const requestInit = init as RequestInit
      expect(requestInit.headers).toMatchObject({
        Authorization: 'Bearer demo',
      })
      expect(requestInit.headers).not.toHaveProperty('Content-Type')
      expect(requestInit.body).toBeInstanceOf(FormData)
      const body = requestInit.body as FormData
      expect(body.get('model')).toBe('gpt-image-2')
      expect(body.get('prompt')).toBe('make the reference brighter')
      expect(body.get('size')).toBe('1024x1024')
      expect(body.get('quality')).toBe('high')
      expect(body.getAll('image')).toHaveLength(1)
      const image = body.getAll('image')[0] as File
      expect(image.name).toBe('reference.png')
      await expect(image.text()).resolves.toBe('ref')
      expect(createComfyClient).not.toHaveBeenCalled()
      expect(slice.getState().project.resources.res_image_1.value).toMatchObject({
        url: 'data:image/png;base64,ZWRpdGVk',
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('loads ComfyUI image resources through endpoint headers before OpenAI image edits', async () => {
    const ids = ['node_openai_image', 'task_1', 'node_result_1', 'asset_1', 'res_image_1']
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(['secure-ref'], { type: 'image/png' }),
      })
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ b64_json: 'ZWRpdGVk', output_format: 'png' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock as typeof fetch
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-09T00:00:00.000Z',
      randomInt: () => 1,
    })

    try {
      slice.setState((state) => ({
        project: {
          ...state.project,
          comfy: {
            ...state.project.comfy,
            endpoints: [
              {
                ...state.project.comfy.endpoints[0]!,
                id: 'endpoint_secure',
                baseUrl: 'http://127.0.0.1:27707',
                customHeaders: { 'X-Workspace': 'infinity' },
              },
            ],
          },
          resources: {
            res_prompt: {
              id: 'res_prompt',
              type: 'text',
              name: 'Prompt',
              value: 'make the reference brighter',
              source: { kind: 'manual_input' },
              metadata: { createdAt: '2026-05-09T00:00:00.000Z' },
            },
            res_reference: {
              id: 'res_reference',
              type: 'image',
              name: 'Reference',
              value: {
                assetId: 'asset_reference',
                url: 'http://127.0.0.1:27707/view?filename=reference.png&subfolder=renders&type=output',
                filename: 'reference.png',
                mimeType: 'image/png',
                sizeBytes: 3,
                comfy: {
                  endpointId: 'endpoint_secure',
                  filename: 'reference.png',
                  subfolder: 'renders',
                  type: 'output',
                },
              },
              source: { kind: 'function_output' },
              metadata: { endpointId: 'endpoint_secure', createdAt: '2026-05-09T00:00:00.000Z' },
            },
          },
        },
      }))
      slice.getState().addFunctionNode(OPENAI_IMAGE_FUNCTION_ID)
      slice.setState((state) => ({
        project: {
          ...state.project,
          canvas: {
            ...state.project.canvas,
            nodes: state.project.canvas.nodes.map((node) =>
              node.id === 'node_openai_image'
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      inputValues: {
                        prompt: { resourceId: 'res_prompt', type: 'text' },
                        image_1: { resourceId: 'res_reference', type: 'image' },
                      },
                      openaiImageConfig: {
                        baseUrl: 'https://api.openai.com/v1',
                        apiKey: 'demo',
                        model: 'gpt-image-2',
                        size: 'auto',
                        quality: 'auto',
                        background: 'auto',
                        outputFormat: 'png',
                        outputCompression: 100,
                        user: '',
                      },
                    },
                  }
                : node,
            ),
          },
        },
      }))

      await slice.getState().runFunctionNodeWithComfy('node_openai_image', 1)

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'http://127.0.0.1:27707/view?filename=reference.png&subfolder=renders&type=output',
        {
          method: 'GET',
          headers: { 'X-Workspace': 'infinity' },
        },
      )
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://api.openai.com/v1/images/edits',
        expect.objectContaining({ method: 'POST' }),
      )
      const body = fetchMock.mock.calls[1]?.[1]?.body as FormData
      const image = body.getAll('image')[0] as File
      await expect(image.text()).resolves.toBe('secure-ref')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('sends connected Gemini image inputs as inline data parts', async () => {
    const ids = ['node_gemini_image', 'task_1', 'node_result_1', 'asset_1', 'res_image_1']
    const createComfyClient = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'Z2VtaW5p' } }] } }],
      }),
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock as typeof fetch
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-09T00:00:00.000Z',
      randomInt: () => 1,
      createComfyClient,
    })

    try {
      slice.setState((state) => ({
        project: {
          ...state.project,
          resources: {
            res_prompt: {
              id: 'res_prompt',
              type: 'text',
              name: 'Prompt',
              value: 'turn it into a dusk interior',
              source: { kind: 'manual_input' },
              metadata: { createdAt: '2026-05-09T00:00:00.000Z' },
            },
            res_reference: {
              id: 'res_reference',
              type: 'image',
              name: 'Reference',
              value: {
                assetId: 'asset_reference',
                url: 'data:image/jpeg;base64,cmVm',
                filename: 'reference.jpg',
                mimeType: 'image/jpeg',
                sizeBytes: 3,
              },
              source: { kind: 'user_upload' },
              metadata: { createdAt: '2026-05-09T00:00:00.000Z' },
            },
          },
        },
      }))
      slice.getState().addFunctionNode(GEMINI_IMAGE_FUNCTION_ID)
      slice.setState((state) => ({
        project: {
          ...state.project,
          canvas: {
            ...state.project.canvas,
            nodes: state.project.canvas.nodes.map((node) =>
              node.id === 'node_gemini_image'
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      inputValues: {
                        prompt: { resourceId: 'res_prompt', type: 'text' },
                        image_1: { resourceId: 'res_reference', type: 'image' },
                      },
                      geminiImageConfig: {
                        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
                        apiKey: 'gemini-test',
                        model: 'gemini-3.1-flash-image-preview',
                        responseModalities: 'TEXT_IMAGE',
                        aspectRatio: 'auto',
                        imageSize: 'auto',
                      },
                    },
                  }
                : node,
            ),
          },
        },
      }))

      await slice.getState().runFunctionNodeWithComfy('node_gemini_image', 1)

      expect(fetchMock).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-goog-api-key': 'gemini-test',
          }),
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    inline_data: {
                      mime_type: 'image/jpeg',
                      data: 'cmVm',
                    },
                  },
                  { text: 'turn it into a dusk interior' },
                ],
              },
            ],
            generationConfig: {
              responseModalities: ['TEXT', 'IMAGE'],
            },
          }),
        }),
      )
      expect(createComfyClient).not.toHaveBeenCalled()
      expect(slice.getState().project.resources.res_image_1.value).toMatchObject({
        url: 'data:image/png;base64,Z2VtaW5p',
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('stores OpenAI run errors on the task and result node for inspection', async () => {
    const ids = ['node_openai', 'task_1', 'node_result_1']
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'invalid api key',
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock as typeof fetch
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-09T00:00:00.000Z',
      randomInt: () => 1,
    })

    try {
      slice.getState().addFunctionNode(OPENAI_LLM_FUNCTION_ID)
      slice.setState((state) => ({
        project: {
          ...state.project,
          canvas: {
            ...state.project.canvas,
            nodes: state.project.canvas.nodes.map((node) =>
              node.id === 'node_openai'
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      openaiConfig: {
                        baseUrl: 'https://api.openai.com/v1',
                        apiKey: 'demo',
                        model: 'gpt-4.1-mini',
                        messages: [{ role: 'user', content: [{ type: 'text', content: 'Describe it.' }] }],
                      },
                    },
                  }
                : node,
            ),
          },
        },
      }))

      await slice.getState().runFunctionNodeWithComfy('node_openai', 1)

      expect(slice.getState().project.tasks.task_1).toMatchObject({
        status: 'failed',
        error: {
          code: 'openai_execution_failed',
          message: 'OpenAI request failed: 401 invalid api key',
        },
      })
      expect(slice.getState().project.canvas.nodes.find((node) => node.id === 'node_result_1')?.data).toMatchObject({
        status: 'failed',
        error: {
          code: 'openai_execution_failed',
          message: 'OpenAI request failed: 401 invalid api key',
        },
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('creates resources, function nodes, tasks, and independent result groups for runCount', () => {
    const slice = createProjectSlice({
      idFactory: (() => {
        const ids = [
          'res_1',
          'fn_1',
          'node_fn_1',
          'task_1',
          'res_out_1',
          'node_result_1',
          'task_2',
          'res_out_2',
          'node_result_2',
        ]
        return () => ids.shift() ?? 'fallback'
      })(),
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => 42,
    })

    slice.getState().addTextResource('Prompt', 'warm kitchen')
    addTestWorkflowFunction(slice)
    slice.getState().addFunctionNode('fn_1')
    slice.getState().connectNodes('node_res_1', 'node_fn_1')
    slice.getState().runFunctionNode('node_fn_1', 2)

    const state = slice.getState()
    expect(Object.keys(state.project.tasks)).toEqual(['task_1', 'task_2'])
    expect(state.project.canvas.nodes.filter((node) => node.type === 'result_group')).toHaveLength(2)
    expect(state.project.resources.res_out_1.source.kind).toBe('function_output')
    expect(state.project.resources.res_out_1.source.outputKey).toBe('image')
    expect(state.project.tasks.task_1.outputRefs).toEqual({
      image: [{ resourceId: 'res_out_1', type: 'text' }],
    })
    expect(state.project.tasks.task_1.seedPatchLog[0].newValue).toBe(42)
  })

  it('uses the function node run count and appends result nodes to the right', () => {
    const slice = createProjectSlice({
      idFactory: (() => {
        const ids = [
          'res_1',
          'fn_1',
          'node_fn_1',
          'task_1',
          'res_out_1',
          'node_result_1',
          'task_2',
          'res_out_2',
          'node_result_2',
          'task_3',
          'res_out_3',
          'node_result_3',
        ]
        return () => ids.shift() ?? 'fallback'
      })(),
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: (() => {
        let seed = 100
        return () => seed++
      })(),
    })

    slice.getState().addTextResourceAtPosition('Prompt', 'warm kitchen', { x: 120, y: 220 })
    addTestWorkflowFunction(slice)
    slice.getState().addFunctionNodeAtPosition('fn_1', { x: 420, y: 260 })
    slice.getState().connectNodes('node_res_1', 'node_fn_1')
    slice.getState().updateFunctionNodeRunCount('node_fn_1', 2)
    slice.getState().runFunctionNode('node_fn_1')

    let resultNodes = slice.getState().project.canvas.nodes.filter((node) => node.type === 'result_group')
    expect(Object.keys(slice.getState().project.tasks)).toEqual(['task_1', 'task_2'])
    expect(slice.getState().project.tasks.task_1.seedPatchLog[0].newValue).toBe(100)
    expect(slice.getState().project.tasks.task_2.seedPatchLog[0].newValue).toBe(101)
    expect(resultNodes.map((node) => node.data.title)).toEqual(['Run 1', 'Run 2'])
    expect(resultNodes.map((node) => node.data.runTotal)).toEqual([2, 2])
    expect(resultNodes[0].position.x).toBeGreaterThan(420)
    expect(resultNodes[1].position.x).toBeGreaterThan(resultNodes[0].position.x)
    expect(resultNodes[0].position.y).toBe(260)
    expect(resultNodes[1].position.y).toBe(260)

    slice.getState().runFunctionNode('node_fn_1', 1)

    resultNodes = slice.getState().project.canvas.nodes.filter((node) => node.type === 'result_group')
    expect(resultNodes).toHaveLength(3)
    expect(slice.getState().project.tasks.task_3.seedPatchLog[0].newValue).toBe(102)
    expect(resultNodes.map((node) => node.data.title)).toEqual(['Run 1', 'Run 2', 'Run 3'])
    expect(resultNodes.map((node) => node.data.runTotal)).toEqual([3, 3, 3])
    expect(Object.values(slice.getState().project.tasks).map((task) => task.runTotal)).toEqual([3, 3, 3])
    expect(resultNodes[2].position.x).toBeGreaterThan(resultNodes[1].position.x)
    expect(resultNodes[2].position.y).toBe(260)
  })

  it('places the first OpenAI result after the full OpenAI function node bounds', async () => {
    const ids = ['node_openai', 'task_1', 'node_result_1']
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-09T00:00:00.000Z',
      randomInt: () => 1,
    })

    slice.getState().addFunctionNodeAtPosition(OPENAI_LLM_FUNCTION_ID, { x: 100, y: 200 })
    await slice.getState().runFunctionNodeWithComfy('node_openai', 1)

    const functionNode = slice.getState().project.canvas.nodes.find((node) => node.id === 'node_openai')
    const resultNode = slice.getState().project.canvas.nodes.find((node) => node.id === 'node_result_1')

    expect(resultNode?.position.x).toBeGreaterThan((functionNode?.position.x ?? 0) + 430)
    expect(resultNode?.position.y).toBe(functionNode?.position.y)
  })

  it('exports config without canvas resources or tasks', () => {
    const slice = createProjectSlice({ idFactory: () => 'id', now: () => 'now', randomInt: () => 1 })
    const exported = slice.getState().exportConfig()

    expect(exported.config).not.toHaveProperty('canvas')
    expect(exported.config).not.toHaveProperty('resources')
    expect(exported.config).not.toHaveProperty('tasks')
  })

  it('persists canvas node positions after drag', () => {
    const slice = createProjectSlice({
      idFactory: () => 'res_1',
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => 1,
    })

    slice.getState().addTextResource('Prompt', 'warm kitchen')
    slice.getState().updateNodePosition('node_res_1', { x: 320, y: 180 })

    expect(slice.getState().project.canvas.nodes[0].position).toEqual({ x: 320, y: 180 })
  })

  it('can create resources and function nodes at a requested canvas position', () => {
    const ids = ['res_1', 'fn_1', 'node_fn_1']
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => 1,
    })

    slice.getState().addTextResourceAtPosition('Prompt', 'from menu', { x: 640, y: 320 })
    addTestWorkflowFunction(slice)
    const functionNodeId = slice.getState().addFunctionNodeAtPosition('fn_1', { x: 820, y: 360 })

    expect(functionNodeId).toBe('node_fn_1')
    expect(slice.getState().project.canvas.nodes).toMatchObject([
      { id: 'node_res_1', type: 'resource', position: { x: 640, y: 320 } },
      { id: 'node_fn_1', type: 'function', position: { x: 820, y: 360 } },
    ])
  })

  it('creates placeholder and dropped media asset nodes and replaces media values', () => {
    const ids = ['res_image', 'asset_image', 'asset_replacement']
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-09T00:00:00.000Z',
      randomInt: () => 1,
    })

    slice.getState().addEmptyResourceAtPosition('image', { x: 120, y: 160 })

    expect(slice.getState().project.resources.res_image).toMatchObject({
      id: 'res_image',
      type: 'image',
      name: 'Image',
      value: {
        filename: 'Image',
        mimeType: 'image/*',
        sizeBytes: 0,
        url: '',
      },
    })
    expect(slice.getState().project.canvas.nodes[0]).toMatchObject({
      id: 'node_res_image',
      type: 'resource',
      position: { x: 120, y: 160 },
      data: { resourceId: 'res_image', resourceType: 'image' },
    })

    slice.getState().replaceResourceMedia('res_image', 'image', {
      url: 'data:image/png;base64,cmVuZGVy',
      filename: 'render.png',
      mimeType: 'image/png',
      sizeBytes: 6,
    })

    expect(slice.getState().project.assets.asset_replacement).toMatchObject({
      id: 'asset_replacement',
      name: 'render.png',
      mimeType: 'image/png',
      blobUrl: 'data:image/png;base64,cmVuZGVy',
    })
    expect(slice.getState().project.resources.res_image).toMatchObject({
      type: 'image',
      name: 'render.png',
      value: {
        assetId: 'asset_replacement',
        url: 'data:image/png;base64,cmVuZGVy',
        filename: 'render.png',
        mimeType: 'image/png',
        sizeBytes: 6,
      },
    })
  })

  it('does not auto-bind direct-created Comfy function inputs', () => {
    const ids = ['res_1', 'fn_1', 'node_fn_1']
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => 1,
    })

    slice.getState().addTextResource('Prompt', 'warm kitchen')
    slice.getState().addFunctionFromWorkflow('Flux Text', {
      '9': { class_type: 'SaveImage', _meta: { title: 'Save Image' }, inputs: { images: ['75:65', 0] } },
      '75:67': {
        class_type: 'CLIPTextEncode',
        _meta: { title: 'CLIP Text Encode (Negative Prompt)' },
        inputs: { text: '' },
      },
      '75:74': {
        class_type: 'CLIPTextEncode',
        _meta: { title: 'CLIP Text Encode (Positive Prompt)' },
        inputs: { text: 'old prompt' },
      },
    })
    slice.getState().addFunctionNode('fn_1')

    expect(slice.getState().project.canvas.nodes[1].data.inputValues).toEqual({})
  })

  it('keeps direct-created function nodes unbound even when matching resources exist', () => {
    const ids = ['res_old', 'res_new', 'fn_1', 'node_fn_1']
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => 1,
    })

    slice.getState().addTextResource('Old Prompt', 'old prompt')
    slice.getState().addTextResource('New Prompt', 'new prompt')
    addTestWorkflowFunction(slice)
    slice.getState().addFunctionNode('fn_1')

    expect(slice.getState().project.canvas.nodes[2].data.inputValues).toEqual({})
  })

  it('can create a function node without auto-binding unrelated required inputs', () => {
    const ids = ['res_text', 'res_image', 'asset_image', 'fn_edit', 'node_edit']
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-09T00:00:00.000Z',
      randomInt: () => 1,
    })

    slice.getState().addTextResource('Prompt', 'existing prompt')
    slice.getState().addEmptyResourceAtPosition('image', { x: 120, y: 160 })
    slice.getState().addFunctionFromWorkflow('Image Edit', {
      '9': { class_type: 'SaveImage', _meta: { title: 'Save Image' }, inputs: { images: ['75:65', 0] } },
      '76': { class_type: 'LoadImage', _meta: { title: 'Load Image' }, inputs: { image: 'reference.png' } },
      '75:74': {
        class_type: 'CLIPTextEncode',
        _meta: { title: 'CLIP Text Encode (Positive Prompt)' },
        inputs: { text: 'edit the image' },
      },
    })

    const functionNodeId = slice
      .getState()
      .addFunctionNodeAtPosition('fn_edit', { x: 420, y: 180 }, { autoBindRequiredInputs: false })

    expect(functionNodeId).toBe('node_edit')
    expect(slice.getState().project.canvas.nodes.find((node) => node.id === 'node_edit')?.data.inputValues).toEqual({})
  })

  it('does not fill missing required image inputs from existing resources before Comfy execution', async () => {
    const ids = ['res_prompt', 'fn_edit', 'node_edit', 'task_1', 'node_result_1', 'asset_1', 'res_out_1']
    const queuedWorkflows: unknown[] = []
    const uploadImage = vi.fn().mockResolvedValue({
      name: 'reference.png',
      subfolder: 'infinity-comfyui',
      type: 'input',
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['image-bytes'], { type: 'image/png' }),
    } as Response)
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => 42,
      createComfyClient: () => ({
        uploadImage,
        queuePrompt: async (workflow) => {
          queuedWorkflows.push(workflow)
          return { prompt_id: 'prompt_1', number: 1 }
        },
        getHistory: async () => ({
          prompt_1: {
            outputs: {
              '9': {
                images: [{ filename: 'edited.png', subfolder: 'renders', type: 'output' }],
              },
            },
          },
        }),
      }),
      comfyRunOptions: {
        maxPollAttempts: 1,
        pollIntervalMs: 1,
      },
    })

    try {
      slice.getState().addTextResource('Prompt', 'make it brighter')
      slice.getState().addFunctionFromWorkflow('Image Edit', {
        '9': { class_type: 'SaveImage', _meta: { title: 'Save Image' }, inputs: { images: ['75:65', 0] } },
        '76': { class_type: 'LoadImage', _meta: { title: 'Load Image' }, inputs: { image: '0.jpg' } },
        '75:74': {
          class_type: 'CLIPTextEncode',
          _meta: { title: 'CLIP Text Encode (Positive Prompt)' },
          inputs: { text: 'edit the image' },
        },
      })
      slice.getState().addFunctionNode('fn_edit')
      expect(slice.getState().project.canvas.nodes[1].data.inputValues).toEqual({})
      slice.setState((state) => ({
        project: {
          ...state.project,
          resources: {
            ...state.project.resources,
            image_1: {
              id: 'image_1',
              type: 'image',
              name: 'Reference',
              value: {
                assetId: 'asset_ref',
                url: 'http://127.0.0.1:27707/view?filename=reference.png&subfolder=&type=output',
                filename: 'reference.png',
                mimeType: 'image/png',
                sizeBytes: 100,
              },
              source: { kind: 'function_output' },
              metadata: { createdAt: '2026-05-08T09:01:00.000Z' },
            },
          },
        },
      }))

      await slice.getState().runFunctionNodeWithComfy('node_edit', 1)

      expect(slice.getState().project.canvas.nodes[1].data.inputValues).toEqual({})
      expect(slice.getState().project.canvas.nodes[1].data.missingInputKeys).toEqual(['prompt', 'image'])
      expect(uploadImage).not.toHaveBeenCalled()
      expect(queuedWorkflows).toEqual([])
      expect(slice.getState().project.tasks).toEqual({})
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('persists a manual resource-to-function connection as an input binding and edge', () => {
    const ids = ['res_1', 'fn_1', 'node_fn_1']
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => 1,
    })

    slice.getState().addTextResource('Prompt', 'warm kitchen')
    addTestWorkflowFunction(slice)
    slice.getState().addFunctionNode('fn_1')
    slice.getState().connectNodes('node_res_1', 'node_fn_1')

    const state = slice.getState()
    expect(state.project.canvas.edges).toEqual([
      {
        id: 'edge_node_res_1_node_fn_1_prompt',
        source: { nodeId: 'node_res_1', handleId: 'resource:res_1', resourceId: 'res_1' },
        target: { nodeId: 'node_fn_1', inputKey: 'prompt' },
        type: 'resource_to_input',
      },
    ])
    expect(state.project.canvas.nodes[1].data.inputValues).toEqual({
      prompt: { resourceId: 'res_1', type: 'text' },
    })
  })

  it('persists a manual result-to-function connection using the matching output resource', () => {
    const ids = ['res_prompt', 'fn_text', 'node_text_fn', 'task_1', 'res_image', 'node_result', 'fn_edit', 'node_edit_fn']
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => 1,
    })

    slice.getState().addTextResource('Prompt', 'warm kitchen')
    addTestWorkflowFunction(slice)
    slice.getState().addFunctionNode('fn_text')
    slice.getState().connectNodes('node_res_prompt', 'node_text_fn')
    slice.getState().runFunctionNode('node_text_fn', 1)
    slice.getState().addFunctionFromWorkflow('Image Edit', {
      '9': { class_type: 'SaveImage', _meta: { title: 'Save Image' }, inputs: { images: ['75:65', 0] } },
      '76': { class_type: 'LoadImage', _meta: { title: 'Load Image' }, inputs: { image: 'reference.png' } },
      '75:74': {
        class_type: 'CLIPTextEncode',
        _meta: { title: 'CLIP Text Encode (Positive Prompt)' },
        inputs: { text: 'edit the image' },
      },
    })
    slice.setState((state) => ({
      project: {
        ...state.project,
        resources: {
          ...state.project.resources,
          res_image: {
            ...state.project.resources.res_image!,
            type: 'image',
            value: {
              assetId: 'asset_1',
              url: 'http://127.0.0.1:27707/view?filename=render.png&subfolder=&type=output',
              filename: 'render.png',
              mimeType: 'image/png',
              sizeBytes: 0,
            },
          },
        },
        canvas: {
          ...state.project.canvas,
          nodes: state.project.canvas.nodes.map((node) =>
            node.id === 'node_result'
              ? { ...node, data: { ...node.data, resources: [{ resourceId: 'res_image', type: 'image' }] } }
              : node,
          ),
        },
      },
    }))
    slice.getState().addFunctionNode('fn_edit')
    slice.getState().connectNodes('node_result', 'node_edit_fn')

    const editNode = slice.getState().project.canvas.nodes.find((node) => node.id === 'node_edit_fn')
    expect(editNode?.data.inputValues).toMatchObject({
      image: { resourceId: 'res_image', type: 'image' },
    })
    expect(slice.getState().project.canvas.edges).toEqual(
      expect.arrayContaining([
        {
          id: 'edge_node_result_node_edit_fn_image',
          source: { nodeId: 'node_result', handleId: 'result:res_image', resourceId: 'res_image' },
          target: { nodeId: 'node_edit_fn', inputKey: 'image' },
          type: 'resource_to_input',
        },
      ]),
    )
  })

  it('deletes selected input edges and clears the function input binding', () => {
    const ids = ['res_1', 'fn_1', 'node_fn_1']
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-09T00:00:00.000Z',
      randomInt: () => 1,
    })

    slice.getState().addTextResource('Prompt', 'warm kitchen')
    addTestWorkflowFunction(slice)
    slice.getState().addFunctionNode('fn_1')
    slice.getState().connectNodes('node_res_1', 'node_fn_1')
    slice.getState().deleteEdges(['edge_node_res_1_node_fn_1_prompt'])

    const functionNode = slice.getState().project.canvas.nodes.find((node) => node.id === 'node_fn_1')
    expect(functionNode?.data.inputValues).toEqual({})
    expect(slice.getState().project.canvas.edges).toEqual([])
  })

  it('undoes deleted input edges and source nodes with their bindings restored', () => {
    const ids = ['res_1', 'fn_1', 'node_fn_1']
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-09T00:00:00.000Z',
      randomInt: () => 1,
    })

    slice.getState().addTextResource('Prompt', 'warm kitchen')
    addTestWorkflowFunction(slice)
    slice.getState().addFunctionNode('fn_1')
    slice.getState().connectNodes('node_res_1', 'node_fn_1')

    slice.getState().deleteEdges(['edge_node_res_1_node_fn_1_prompt'])
    expect(slice.getState().project.canvas.edges).toEqual([])

    slice.getState().undoLastProjectChange()
    expect(slice.getState().project.canvas.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'edge_node_res_1_node_fn_1_prompt',
          target: { nodeId: 'node_fn_1', inputKey: 'prompt' },
        }),
      ]),
    )
    expect(slice.getState().project.canvas.nodes.find((node) => node.id === 'node_fn_1')?.data.inputValues).toMatchObject({
      prompt: { resourceId: 'res_1', type: 'text' },
    })

    slice.getState().deleteNode('node_res_1')
    expect(slice.getState().project.canvas.nodes.some((node) => node.id === 'node_res_1')).toBe(false)

    slice.getState().undoLastProjectChange()
    expect(slice.getState().project.resources).toHaveProperty('res_1')
    expect(slice.getState().project.canvas.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(['node_res_1', 'node_fn_1']),
    )
    expect(slice.getState().project.canvas.edges).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'edge_node_res_1_node_fn_1_prompt' })]),
    )
  })

  it('clears function resource bindings when deleting the source resource node', () => {
    const ids = ['res_1', 'fn_1', 'node_fn_1']
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-09T00:00:00.000Z',
      randomInt: () => 1,
    })

    slice.getState().addTextResource('Prompt', 'warm kitchen')
    addTestWorkflowFunction(slice)
    slice.getState().addFunctionNode('fn_1')
    slice.getState().connectNodes('node_res_1', 'node_fn_1')
    slice.getState().deleteNode('node_res_1')

    const functionNode = slice.getState().project.canvas.nodes.find((node) => node.id === 'node_fn_1')
    expect(functionNode?.data.inputValues).toEqual({})
    expect(slice.getState().project.canvas.edges).toEqual([])
  })

  it('deletes selected nodes and clears related resources, tasks, and selection', () => {
    const ids = [
      'res_1',
      'fn_1',
      'node_fn_1',
      'task_1',
      'res_out_1',
      'node_result_1',
    ]
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => 7,
    })

    slice.getState().addTextResource('Prompt', 'warm kitchen')
    addTestWorkflowFunction(slice)
    slice.getState().addFunctionNode('fn_1')
    slice.getState().runFunctionNode('node_fn_1', 1)
    slice.getState().selectNode('node_fn_1')
    slice.getState().deleteSelectedNode()

    const state = slice.getState()
    expect(state.selectedNodeId).toBeUndefined()
    expect(state.project.canvas.nodes.map((node) => node.id)).toEqual(['node_res_1'])
    expect(state.project.tasks).toEqual({})
    expect(state.project.resources).not.toHaveProperty('res_out_1')
  })

  it('supports additive, subtractive, and batch selected node operations', () => {
    const ids = ['res_1', 'res_2']
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-09T00:00:00.000Z',
      randomInt: () => 1,
    })

    slice.getState().addTextResourceAtPosition('Prompt 1', 'first', { x: 100, y: 120 })
    slice.getState().addTextResourceAtPosition('Prompt 2', 'second', { x: 320, y: 120 })

    slice.getState().selectNode('node_res_1')
    slice.getState().selectNode('node_res_2', 'add')
    expect(slice.getState().selectedNodeIds).toEqual(['node_res_1', 'node_res_2'])

    slice.getState().selectNode('node_res_2', 'remove')
    expect(slice.getState().selectedNodeIds).toEqual(['node_res_1'])

    slice.getState().selectNodes(['node_res_1', 'node_res_2'])
    slice.getState().updateNodePositions({
      node_res_1: { x: 140, y: 160 },
      node_res_2: { x: 360, y: 180 },
    })

    expect(slice.getState().project.canvas.nodes).toMatchObject([
      { id: 'node_res_1', position: { x: 140, y: 160 } },
      { id: 'node_res_2', position: { x: 360, y: 180 } },
    ])

    slice.getState().deleteSelectedNode()

    expect(slice.getState().selectedNodeId).toBeUndefined()
    expect(slice.getState().selectedNodeIds).toEqual([])
    expect(slice.getState().project.canvas.nodes).toEqual([])
    expect(slice.getState().project.resources).not.toHaveProperty('res_1')
    expect(slice.getState().project.resources).not.toHaveProperty('res_2')
  })

  it('renames node titles and duplicates the selected node with offset position', () => {
    const ids = ['res_1', 'res_copy_1']
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => 1,
    })

    slice.getState().addTextResourceAtPosition('Prompt', 'warm kitchen', { x: 100, y: 120 })
    slice.getState().renameNode('node_res_1', 'Hero Prompt')
    slice.getState().selectNode('node_res_1')
    slice.getState().duplicateSelectedNode()

    const state = slice.getState()
    expect(state.project.resources.res_1.name).toBe('Hero Prompt')
    expect(state.project.resources.res_copy_1).toMatchObject({
      id: 'res_copy_1',
      name: 'Hero Prompt Copy',
      value: 'warm kitchen',
      source: { kind: 'duplicated', parentResourceId: 'res_1' },
    })
    expect(state.project.canvas.nodes).toMatchObject([
      { id: 'node_res_1', position: { x: 100, y: 120 } },
      { id: 'node_res_copy_1', position: { x: 140, y: 160 } },
    ])
    expect(state.selectedNodeId).toBe('node_res_copy_1')
  })

  it('duplicates multiple selected nodes without copying edges', () => {
    const ids = ['res_1', 'fn_1', 'node_fn_1', 'res_copy_1', 'node_fn_copy_1']
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-09T00:00:00.000Z',
      randomInt: () => 1,
    })

    slice.getState().addTextResourceAtPosition('Prompt', 'warm kitchen', { x: 100, y: 120 })
    addTestWorkflowFunction(slice)
    slice.getState().addFunctionNodeAtPosition('fn_1', { x: 400, y: 120 })
    slice.getState().connectNodes('node_res_1', 'node_fn_1')
    slice.getState().duplicateNodes(['node_res_1', 'node_fn_1'])

    expect(slice.getState().project.canvas.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'node_res_copy_1', position: { x: 148, y: 168 } }),
        expect.objectContaining({ id: 'node_fn_copy_1', position: { x: 448, y: 168 } }),
      ]),
    )
    expect(slice.getState().project.resources.res_copy_1).toMatchObject({
      name: 'Prompt Copy',
      value: 'warm kitchen',
      source: { kind: 'duplicated', parentResourceId: 'res_1' },
    })
    expect(slice.getState().project.canvas.edges).toEqual([
      expect.objectContaining({ id: 'edge_node_res_1_node_fn_1_prompt' }),
    ])
    expect(
      slice.getState().project.canvas.nodes.find((node) => node.id === 'node_fn_copy_1')?.data.inputValues,
    ).toEqual({})
    expect(slice.getState().selectedNodeIds).toEqual(['node_res_copy_1', 'node_fn_copy_1'])
  })

  it('updates and deletes managed functions with their canvas nodes and edges', () => {
    const ids = ['res_1', 'fn_1', 'node_fn_1']
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => 1,
    })

    slice.getState().addTextResource('Prompt', 'warm kitchen')
    addTestWorkflowFunction(slice)
    slice.getState().addFunctionNode('fn_1')
    slice.getState().connectNodes('node_res_1', 'node_fn_1')

    slice.getState().updateFunction('fn_1', {
      name: 'Edited Render',
      inputs: [
        {
          ...slice.getState().project.functions.fn_1.inputs[0]!,
          type: 'image',
          bind: { nodeId: '42', path: 'inputs.image' },
        },
      ],
    })

    expect(slice.getState().project.functions.fn_1.name).toBe('Edited Render')
    expect(slice.getState().project.functions.fn_1.inputs[0]).toMatchObject({
      type: 'image',
      bind: { nodeId: '42', path: 'inputs.image' },
    })
    expect(
      slice.getState().project.canvas.nodes.find((node) => node.id === 'node_fn_1')?.data.inputValues,
    ).toEqual({})

    slice.getState().deleteFunction('fn_1')

    expect(slice.getState().project.functions.fn_1).toBeUndefined()
    expect(slice.getState().project.canvas.nodes.some((node) => node.id === 'node_fn_1')).toBe(false)
    expect(slice.getState().project.canvas.edges).toEqual([])
  })

  it('deletes managed ComfyUI endpoints', () => {
    const slice = createProjectSlice({
      idFactory: () => 'endpoint_2',
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => 1,
    })

    slice.getState().addEndpoint()
    slice.getState().updateEndpoint('endpoint_2', { name: 'GPU Box', baseUrl: 'http://127.0.0.1:27707' })
    slice.getState().deleteEndpoint('endpoint_local')

    expect(slice.getState().project.comfy.endpoints).toEqual([
      expect.objectContaining({
        id: 'endpoint_2',
        name: 'GPU Box',
        baseUrl: 'http://127.0.0.1:27707',
      }),
    ])
  })

  it('runs a function node through a ComfyUI client and stores returned file references', async () => {
    const ids = [
      'res_1',
      'fn_1',
      'node_fn_1',
      'task_1',
      'node_result_1',
      'asset_1',
      'res_img_1',
      'asset_2',
      'res_video_1',
      'asset_3',
      'res_audio_1',
      'res_text_1',
    ]
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => 42,
      createComfyClient: () => ({
        queuePrompt: async () => ({ prompt_id: 'prompt_1', number: 1 }),
        getHistory: async () => ({
          prompt_1: {
            outputs: {
              '20': {
                images: [{ filename: 'render.png', subfolder: 'renders', type: 'output' }],
              },
              '21': {
                images: [{ filename: 'clip.mp4', subfolder: 'renders', type: 'output' }],
                animated: [true],
              },
              '22': {
                audio: [{ filename: 'voice.wav', subfolder: '', type: 'output' }],
              },
              '23': {
                text: ['Generated caption'],
              },
            },
          },
        }),
      }),
      comfyRunOptions: {
        maxPollAttempts: 1,
        pollIntervalMs: 1,
      },
    })

    slice.getState().addTextResource('Prompt', 'warm kitchen')
    addTestWorkflowFunction(slice)
    slice.setState((state) => ({
      project: {
        ...state.project,
        functions: {
          ...state.project.functions,
          fn_1: {
            ...state.project.functions.fn_1!,
            outputs: [
              {
                key: 'image',
                label: 'Result',
                type: 'image',
                bind: { nodeTitle: 'Result_Image' },
                extract: { source: 'history', multiple: true },
              },
              {
                key: 'video',
                label: 'Video',
                type: 'video',
                bind: { nodeId: '21' },
                extract: { source: 'history', multiple: true },
              },
              {
                key: 'audio',
                label: 'Audio',
                type: 'audio',
                bind: { nodeId: '22' },
                extract: { source: 'history', multiple: true },
              },
              {
                key: 'caption',
                label: 'Caption',
                type: 'text',
                bind: { nodeId: '23' },
                extract: { source: 'node_output' },
              },
            ],
          },
        },
      },
    }))
    slice.getState().addFunctionNode('fn_1')
    slice.getState().connectNodes('node_res_1', 'node_fn_1')
    await slice.getState().runFunctionNodeWithComfy('node_fn_1', 1)

    const state = slice.getState()
    expect(state.project.tasks.task_1.comfyPromptId).toBe('prompt_1')
    expect(state.project.resources.res_img_1.type).toBe('image')
    expect(state.project.resources.res_img_1.value).toMatchObject({
      assetId: 'asset_1',
      url: 'http://127.0.0.1:8188/view?filename=render.png&subfolder=renders&type=output',
      comfy: {
        endpointId: 'endpoint_local',
        filename: 'render.png',
        subfolder: 'renders',
        type: 'output',
      },
    })
    expect(state.project.resources.res_video_1).toMatchObject({
      type: 'video',
      value: {
        assetId: 'asset_2',
        url: 'http://127.0.0.1:8188/view?filename=clip.mp4&subfolder=renders&type=output',
        comfy: {
          endpointId: 'endpoint_local',
          filename: 'clip.mp4',
          subfolder: 'renders',
          type: 'output',
        },
      },
    })
    expect(state.project.resources.res_audio_1).toMatchObject({
      type: 'audio',
      value: {
        assetId: 'asset_3',
        url: 'http://127.0.0.1:8188/view?filename=voice.wav&subfolder=&type=output',
        comfy: {
          endpointId: 'endpoint_local',
          filename: 'voice.wav',
          subfolder: '',
          type: 'output',
        },
      },
    })
    expect(state.project.resources.res_text_1).toMatchObject({
      type: 'text',
      value: 'Generated caption',
    })
    expect(state.project.tasks.task_1.outputRefs).toEqual({
      image: [{ resourceId: 'res_img_1', type: 'image' }],
      video: [{ resourceId: 'res_video_1', type: 'video' }],
      audio: [{ resourceId: 'res_audio_1', type: 'audio' }],
      caption: [{ resourceId: 'res_text_1', type: 'text' }],
    })
    expect(state.project.canvas.nodes.find((node) => node.id === 'node_result_1')?.data.resources).toEqual([
      { resourceId: 'res_img_1', type: 'image' },
      { resourceId: 'res_video_1', type: 'video' },
      { resourceId: 'res_audio_1', type: 'audio' },
      { resourceId: 'res_text_1', type: 'text' },
    ])
  })

  it('updates the initial Comfy result node instead of appending a second node when outputs arrive', async () => {
    const ids = ['res_1', 'fn_1', 'node_fn_1', 'task_1', 'node_result_1', 'asset_1', 'res_img_1']
    let resolveHistory: (history: unknown) => void = () => undefined
    const historyPromise = new Promise<unknown>((resolve) => {
      resolveHistory = resolve
    })
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => 42,
      createComfyClient: () => ({
        queuePrompt: async () => ({ prompt_id: 'prompt_1', number: 1 }),
        getHistory: async () => historyPromise,
      }),
      comfyRunOptions: {
        maxPollAttempts: 1,
        pollIntervalMs: 1,
      },
    })

    slice.getState().addTextResource('Prompt', 'warm kitchen')
    addTestWorkflowFunction(slice)
    slice.setState((state) => ({
      project: {
        ...state.project,
        functions: {
          ...state.project.functions,
          fn_1: {
            ...state.project.functions.fn_1!,
            outputs: [
              {
                key: 'image',
                label: 'Image',
                type: 'image',
                bind: { nodeTitle: 'Result_Image' },
                extract: { source: 'history', multiple: true },
              },
            ],
          },
        },
      },
    }))
    slice.getState().addFunctionNode('fn_1')
    slice.getState().connectNodes('node_res_1', 'node_fn_1')

    const running = slice.getState().runFunctionNodeWithComfy('node_fn_1', 1)
    await flushPromises()

    let state = slice.getState()
    expect(state.project.canvas.nodes.filter((node) => node.type === 'result_group')).toEqual([
      expect.objectContaining({
        id: 'node_result_1',
        data: expect.objectContaining({
          taskId: 'task_1',
          status: 'running',
          resources: [],
        }),
      }),
    ])

    resolveHistory({
      prompt_1: {
        outputs: {
          '20': {
            images: [{ filename: 'render.png', subfolder: 'renders', type: 'output' }],
          },
        },
      },
    })
    await running

    state = slice.getState()
    expect(state.project.canvas.nodes.filter((node) => node.type === 'result_group')).toEqual([
      expect.objectContaining({
        id: 'node_result_1',
        data: expect.objectContaining({
          status: 'succeeded',
          resources: [{ resourceId: 'res_img_1', type: 'image' }],
        }),
      }),
    ])
    expect(state.project.tasks.task_1.outputRefs).toEqual({
      image: [{ resourceId: 'res_img_1', type: 'image' }],
    })
  })

  it('creates all Comfy result nodes immediately and selects the least busy endpoint per run', async () => {
    const ids = [
      'res_1',
      'fn_1',
      'node_fn_1',
      'task_1',
      'node_result_1',
      'task_2',
      'node_result_2',
      'asset_1',
      'res_img_1',
      'asset_2',
      'res_img_2',
    ]
    let queuedCount = 0
    const historyResolvers: Record<string, (history: unknown) => void> = {}
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: (() => {
        let seed = 100
        return () => seed++
      })(),
      createComfyClient: () => ({
        queuePrompt: async () => {
          queuedCount += 1
          return { prompt_id: `prompt_${queuedCount}`, number: queuedCount }
        },
        getHistory: async (promptId) =>
          new Promise<unknown>((resolve) => {
            historyResolvers[promptId] = resolve
          }),
      }),
      comfyRunOptions: {
        maxPollAttempts: 1,
        pollIntervalMs: 1,
      },
    })

    slice.getState().addTextResource('Prompt', 'warm kitchen')
    addTestWorkflowFunction(slice)
    slice.setState((state) => ({
      project: {
        ...state.project,
        comfy: {
          ...state.project.comfy,
          endpoints: [
            {
              ...state.project.comfy.endpoints[0]!,
              id: 'endpoint_a',
              name: 'A',
              maxConcurrentJobs: 10,
              priority: 10,
            },
            {
              ...state.project.comfy.endpoints[0]!,
              id: 'endpoint_b',
              name: 'B',
              maxConcurrentJobs: 10,
              priority: 10,
            },
          ],
        },
        functions: {
          ...state.project.functions,
          fn_1: {
            ...state.project.functions.fn_1!,
            outputs: [
              {
                key: 'image',
                label: 'Image',
                type: 'image',
                bind: { nodeTitle: 'Result_Image' },
                extract: { source: 'history', multiple: true },
              },
            ],
          },
        },
      },
    }))
    slice.getState().addFunctionNode('fn_1')
    slice.getState().connectNodes('node_res_1', 'node_fn_1')

    const running = slice.getState().runFunctionNodeWithComfy('node_fn_1', 2)
    await flushPromises()

    let state = slice.getState()
    expect(queuedCount).toBe(2)
    expect(state.project.canvas.nodes.filter((node) => node.type === 'result_group')).toEqual([
      expect.objectContaining({ id: 'node_result_1', data: expect.objectContaining({ status: 'running' }) }),
      expect.objectContaining({ id: 'node_result_2', data: expect.objectContaining({ status: 'running' }) }),
    ])
    expect(state.project.tasks.task_1.endpointId).toBe('endpoint_a')
    expect(state.project.tasks.task_2.endpointId).toBe('endpoint_b')

    historyResolvers.prompt_1?.({
      prompt_1: {
        outputs: {
          '20': {
            images: [{ filename: 'run1.png', subfolder: 'renders', type: 'output' }],
          },
        },
      },
    })
    historyResolvers.prompt_2?.({
      prompt_2: {
        outputs: {
          '20': {
            images: [{ filename: 'run2.png', subfolder: 'renders', type: 'output' }],
          },
        },
      },
    })
    await running

    state = slice.getState()
    expect(state.project.canvas.nodes.filter((node) => node.type === 'result_group')).toEqual([
      expect.objectContaining({
        id: 'node_result_1',
        data: expect.objectContaining({
          status: 'succeeded',
          resources: [{ resourceId: 'res_img_1', type: 'image' }],
        }),
      }),
      expect.objectContaining({
        id: 'node_result_2',
        data: expect.objectContaining({
          status: 'succeeded',
          resources: [{ resourceId: 'res_img_2', type: 'image' }],
        }),
      }),
    ])
  })

  it('uploads selected image resources before running image-edit ComfyUI workflows', async () => {
    const ids = ['res_prompt', 'fn_1', 'node_fn_1', 'task_1', 'node_result_1', 'asset_1', 'res_img_1']
    const queuedWorkflows: unknown[] = []
    const uploadImage = vi.fn().mockResolvedValue({
      name: 'reference.png',
      subfolder: 'infinity-comfyui',
      type: 'input',
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['image-bytes'], { type: 'image/png' }),
    } as Response)

    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => 42,
      createComfyClient: () => ({
        uploadImage,
        queuePrompt: async (workflow) => {
          queuedWorkflows.push(workflow)
          return { prompt_id: 'prompt_1', number: 1 }
        },
        getHistory: async () => ({
          prompt_1: {
            outputs: {
              '9': {
                images: [{ filename: 'edited.png', subfolder: 'renders', type: 'output' }],
              },
            },
          },
        }),
      }),
      comfyRunOptions: {
        maxPollAttempts: 1,
        pollIntervalMs: 1,
      },
    })

    try {
      slice.getState().addTextResource('Prompt', 'make it brighter')
      slice.setState((state) => ({
        project: {
          ...state.project,
          resources: {
            ...state.project.resources,
            image_1: {
              id: 'image_1',
              type: 'image',
              name: 'Reference',
              value: {
                assetId: 'asset_ref',
                url: 'http://127.0.0.1:8188/view?filename=reference.png&subfolder=&type=output',
                filename: 'reference.png',
                mimeType: 'image/png',
                sizeBytes: 100,
              },
              source: { kind: 'function_output' },
              metadata: { createdAt: '2026-05-08T09:00:00.000Z' },
            },
          },
        },
      }))
      slice.getState().addFunctionFromWorkflow('Image Edit', {
        '9': { class_type: 'SaveImage', _meta: { title: 'Save Image' }, inputs: { images: ['75:65', 0] } },
        '76': { class_type: 'LoadImage', _meta: { title: 'Load Image' }, inputs: { image: 'old.png' } },
        '75:74': {
          class_type: 'CLIPTextEncode',
          _meta: { title: 'CLIP Text Encode (Positive Prompt)' },
          inputs: { text: 'old prompt' },
        },
      })
      slice.getState().addFunctionNode('fn_1')
      slice.setState((state) => ({
        project: {
          ...state.project,
          canvas: {
            ...state.project.canvas,
            nodes: state.project.canvas.nodes.map((node) =>
              node.id === 'node_fn_1'
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      inputValues: {
                        prompt: { resourceId: 'res_prompt', type: 'text' },
                        image: { resourceId: 'image_1', type: 'image' },
                      },
                    },
                  }
                : node,
            ),
          },
        },
      }))
      await slice.getState().runFunctionNodeWithComfy('node_fn_1', 1)

      expect(uploadImage).toHaveBeenCalledWith(expect.any(File), {
        subfolder: 'infinity-comfyui',
        overwrite: true,
      })
      expect(queuedWorkflows[0]).toMatchObject({
        '76': { inputs: { image: 'infinity-comfyui/reference.png' } },
        '75:74': { inputs: { text: 'make it brighter' } },
      })
      expect(slice.getState().project.tasks.task_1.status).toBe('succeeded')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('queues Comfy workflows with optional primitive overrides resolved by workflow input key', async () => {
    const ids = ['fn_1', 'node_fn_1', 'task_1', 'node_result_1', 'asset_1', 'res_img_1']
    const queuedWorkflows: unknown[] = []
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => 42,
      createComfyClient: () => ({
        queuePrompt: async (workflow) => {
          queuedWorkflows.push(workflow)
          return { prompt_id: 'prompt_1', number: 1 }
        },
        getHistory: async () => ({
          prompt_1: {
            outputs: {
              '9': {
                images: [{ filename: 'render.png', subfolder: 'renders', type: 'output' }],
              },
            },
          },
        }),
      }),
      comfyRunOptions: {
        maxPollAttempts: 1,
        pollIntervalMs: 1,
      },
    })

    slice.getState().addFunctionFromWorkflow('Batch Render', {
      '9': { class_type: 'SaveImage', _meta: { title: 'Save Image' }, inputs: { images: ['75:65', 0] } },
      '75:66': {
        class_type: 'EmptyFlux2LatentImage',
        _meta: { title: 'Empty Flux 2 Latent' },
        inputs: { batch_size: 1, text: 'legacy field' },
      },
    })
    slice.setState((state) => ({
      project: {
        ...state.project,
        functions: {
          ...state.project.functions,
          fn_1: {
            ...state.project.functions.fn_1!,
            inputs: [
              {
                key: 'batch_size',
                label: 'Batch Size',
                type: 'number',
                required: false,
                bind: { nodeId: '75:66', nodeTitle: 'Empty Flux 2 Latent', path: 'inputs.text' },
                upload: { strategy: 'none' },
              },
            ],
          },
        },
      },
    }))
    slice.getState().addFunctionNode('fn_1')
    slice.getState().updateFunctionNodeInputValue('node_fn_1', 'batch_size', 2)

    await slice.getState().runFunctionNodeWithComfy('node_fn_1', 1)

    expect(queuedWorkflows[0]).toMatchObject({
      '75:66': {
        inputs: {
          batch_size: 2,
          text: 'legacy field',
        },
      },
    })
  })

  it('stores complete run input snapshots, final workflow, and timing metadata', async () => {
    const ids = ['fn_1', 'res_prompt', 'node_fn_1', 'task_1', 'node_result_1', 'asset_1', 'res_img_1']
    let tick = 0
    const baseTime = Date.parse('2026-05-08T09:00:00.000Z')
    const queuedWorkflows: unknown[] = []
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => new Date(baseTime + tick++ * 1000).toISOString(),
      randomInt: () => 42,
      createComfyClient: () => ({
        queuePrompt: async (workflow) => {
          queuedWorkflows.push(workflow)
          return { prompt_id: 'prompt_1', number: 1 }
        },
        getHistory: async () => ({
          prompt_1: {
            outputs: {
              '9': {
                images: [{ filename: 'render.png', subfolder: 'renders', type: 'output' }],
              },
            },
          },
        }),
      }),
      comfyRunOptions: {
        maxPollAttempts: 1,
        pollIntervalMs: 1,
      },
    })

    slice.getState().addFunctionFromWorkflow('Audited Render', {
      '6': { class_type: 'CLIPTextEncode', _meta: { title: 'Positive Prompt' }, inputs: { text: 'old prompt' } },
      '7': { class_type: 'CLIPTextEncode', _meta: { title: 'Negative Prompt' }, inputs: { text: 'old negative' } },
      '75:66': {
        class_type: 'EmptyFlux2LatentImage',
        _meta: { title: 'Empty Flux 2 Latent' },
        inputs: { batch_size: 1 },
      },
      '9': { class_type: 'SaveImage', _meta: { title: 'Save Image' }, inputs: { images: ['75:65', 0] } },
    })
    slice.getState().addTextResource('Prompt', 'sunlit kitchen')
    slice.setState((state) => ({
      project: {
        ...state.project,
        functions: {
          ...state.project.functions,
          fn_1: {
            ...state.project.functions.fn_1!,
            inputs: [
              {
                key: 'prompt',
                label: 'Prompt',
                type: 'text',
                required: true,
                bind: { nodeId: '6', nodeTitle: 'Positive Prompt', path: 'inputs.text' },
                upload: { strategy: 'none' },
              },
              {
                key: 'negative_prompt',
                label: 'Negative Prompt',
                type: 'text',
                required: false,
                defaultValue: '',
                bind: { nodeId: '7', nodeTitle: 'Negative Prompt', path: 'inputs.text' },
                upload: { strategy: 'none' },
              },
              {
                key: 'batch_size',
                label: 'Batch Size',
                type: 'number',
                required: false,
                defaultValue: 1,
                bind: { nodeId: '75:66', nodeTitle: 'Empty Flux 2 Latent', path: 'inputs.batch_size' },
                upload: { strategy: 'none' },
              },
            ],
          },
        },
      },
    }))
    slice.getState().addFunctionNode('fn_1')
    slice.getState().connectNodes('node_res_prompt', 'node_fn_1', { targetInputKey: 'prompt' })
    slice.getState().updateFunctionNodeInputValue('node_fn_1', 'negative_prompt', 'low quality')
    slice.getState().updateFunctionNodeInputValue('node_fn_1', 'batch_size', 2)

    await slice.getState().runFunctionNodeWithComfy('node_fn_1', 1)

    const task = Object.values(slice.getState().project.tasks)[0]
    expect(task).toBeDefined()
    expect(task).toMatchObject({
      status: 'succeeded',
      startedAt: expect.any(String),
      completedAt: expect.any(String),
      inputValuesSnapshot: {
        prompt: {
          key: 'prompt',
          label: 'Prompt',
          type: 'text',
          required: true,
          source: 'resource',
          resourceId: 'res_prompt',
          resourceName: 'Prompt',
          value: 'sunlit kitchen',
        },
        negative_prompt: {
          key: 'negative_prompt',
          label: 'Negative Prompt',
          type: 'text',
          required: false,
          source: 'inline',
          value: 'low quality',
        },
        batch_size: {
          key: 'batch_size',
          label: 'Batch Size',
          type: 'number',
          required: false,
          source: 'inline',
          value: 2,
        },
      },
      compiledWorkflowSnapshot: {
        '6': { inputs: { text: 'sunlit kitchen' } },
        '7': { inputs: { text: 'low quality' } },
        '75:66': { inputs: { batch_size: 2 } },
      },
    })
    expect(task.startedAt).not.toBe(task.completedAt)
    expect(queuedWorkflows[0]).toEqual(task.compiledWorkflowSnapshot)
  })

  it('captures unedited optional primitive workflow values in run snapshots', async () => {
    const ids = ['fn_1', 'node_fn_1', 'task_1', 'node_result_1', 'asset_1', 'res_video_1']
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => 42,
      createComfyClient: () => ({
        queuePrompt: async () => ({ prompt_id: 'prompt_1', number: 1 }),
        getHistory: async () => ({
          prompt_1: {
            outputs: {
              '75': {
                images: [{ filename: 'clip.mp4', subfolder: 'video', type: 'output' }],
                animated: [true],
              },
            },
          },
        }),
      }),
      comfyRunOptions: {
        maxPollAttempts: 1,
        pollIntervalMs: 1,
      },
    })

    slice.getState().addFunctionFromWorkflow('Video Render', {
      '75': {
        class_type: 'SaveVideo',
        _meta: { title: 'Save Video' },
        inputs: {
          frame_rate: 25,
          duration: 5,
        },
      },
    })
    slice.setState((state) => ({
      project: {
        ...state.project,
        functions: {
          ...state.project.functions,
          fn_1: {
            ...state.project.functions.fn_1!,
            inputs: [
              {
                key: 'fps',
                label: 'Fps',
                type: 'number',
                required: false,
                bind: { nodeId: '75', nodeTitle: 'Save Video', path: 'inputs.frame_rate' },
                upload: { strategy: 'none' },
              },
              {
                key: 'duration',
                label: 'Duration',
                type: 'number',
                required: false,
                bind: { nodeId: '75', nodeTitle: 'Save Video', path: 'inputs.duration' },
                upload: { strategy: 'none' },
              },
            ],
            outputs: [
              {
                key: 'video',
                label: 'Video',
                type: 'video',
                bind: { nodeId: '75', nodeTitle: 'Save Video' },
                extract: { source: 'history', multiple: true },
              },
            ],
          },
        },
      },
    }))
    slice.getState().addFunctionNode('fn_1')

    await slice.getState().runFunctionNodeWithComfy('node_fn_1', 1)

    expect(slice.getState().project.tasks.task_1.inputValuesSnapshot).toMatchObject({
      fps: {
        label: 'Fps',
        source: 'default',
        value: 25,
      },
      duration: {
        label: 'Duration',
        source: 'default',
        value: 5,
      },
    })
  })

  it('queues Comfy workflows with connected number overrides resolved by workflow input key', async () => {
    const ids = ['fn_1', 'res_batch_size', 'node_fn_1', 'task_1', 'node_result_1', 'asset_1', 'res_img_1']
    const queuedWorkflows: unknown[] = []
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => 42,
      createComfyClient: () => ({
        queuePrompt: async (workflow) => {
          queuedWorkflows.push(workflow)
          return { prompt_id: 'prompt_1', number: 1 }
        },
        getHistory: async () => ({
          prompt_1: {
            outputs: {
              '9': {
                images: [{ filename: 'render.png', subfolder: 'renders', type: 'output' }],
              },
            },
          },
        }),
      }),
      comfyRunOptions: {
        maxPollAttempts: 1,
        pollIntervalMs: 1,
      },
    })

    slice.getState().addFunctionFromWorkflow('Batch Render', {
      '9': { class_type: 'SaveImage', _meta: { title: 'Save Image' }, inputs: { images: ['75:65', 0] } },
      '75:66': {
        class_type: 'EmptyFlux2LatentImage',
        _meta: { title: 'Empty Flux 2 Latent' },
        inputs: { batch_size: 1, text: 'legacy field' },
      },
    })
    slice.getState().addEmptyResourceAtPosition('number', { x: 80, y: 160 })
    slice.getState().updateNumberResourceValue('res_batch_size', 2)
    slice.setState((state) => ({
      project: {
        ...state.project,
        functions: {
          ...state.project.functions,
          fn_1: {
            ...state.project.functions.fn_1!,
            inputs: [
              {
                key: 'batch_size',
                label: 'Batch Size',
                type: 'number',
                required: false,
                bind: { nodeId: '75:66', nodeTitle: 'Empty Flux 2 Latent', path: 'inputs.text' },
                upload: { strategy: 'none' },
              },
            ],
          },
        },
      },
    }))
    slice.getState().addFunctionNode('fn_1')
    slice.getState().connectNodes('node_res_batch_size', 'node_fn_1')

    await slice.getState().runFunctionNodeWithComfy('node_fn_1', 1)

    expect(queuedWorkflows[0]).toMatchObject({
      '75:66': {
        inputs: {
          batch_size: 2,
          text: 'legacy field',
        },
      },
    })
  })

  it('reruns a failed Comfy result in place with the same compiled workflow and seed values', async () => {
    const ids = ['asset_new', 'res_new']
    const queuedWorkflows: unknown[] = []
    const randomInt = vi.fn(() => 999)
    const compiledWorkflow = {
      '3': {
        class_type: 'KSampler',
        _meta: { title: 'Sampler' },
        inputs: { seed: 123, steps: 24 },
      },
      '20': {
        class_type: 'SaveImage',
        _meta: { title: 'Result_Image' },
        inputs: { filename_prefix: 'infinity-comfyui' },
      },
    }
    const seedPatchLog = [
      {
        nodeId: '3',
        nodeTitle: 'Sampler',
        nodeClassType: 'KSampler',
        path: 'inputs.seed',
        oldValue: 0,
        newValue: 123,
        patchedAt: '2026-05-08T09:00:00.000Z',
      },
    ]
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt,
      createComfyClient: () => ({
        queuePrompt: async (workflow) => {
          queuedWorkflows.push(workflow)
          return { prompt_id: 'prompt_retry', number: 1 }
        },
        getHistory: async () => ({
          prompt_retry: {
            outputs: {
              '20': {
                images: [{ filename: 'retry.png', subfolder: 'renders', type: 'output' }],
              },
            },
          },
        }),
      }),
      comfyRunOptions: {
        maxPollAttempts: 1,
        pollIntervalMs: 1,
      },
    })

    slice.setState((state) => ({
      project: {
        ...state.project,
        resources: {
          stale_resource: {
            id: 'stale_resource',
            type: 'image',
            name: 'stale.png',
            value: {
              assetId: 'stale_asset',
              url: 'http://127.0.0.1:8188/view?filename=stale.png&subfolder=&type=output',
              filename: 'stale.png',
              mimeType: 'image/png',
              sizeBytes: 0,
            },
            source: {
              kind: 'function_output',
              functionNodeId: 'node_fn_1',
              resultGroupNodeId: 'node_result_1',
              taskId: 'task_1',
              outputKey: 'image',
            },
          },
        },
        assets: {
          stale_asset: {
            id: 'stale_asset',
            name: 'stale.png',
            mimeType: 'image/png',
            sizeBytes: 0,
            blobUrl: 'http://127.0.0.1:8188/view?filename=stale.png&subfolder=&type=output',
            createdAt: '2026-05-08T09:00:00.000Z',
          },
        },
        functions: {
          ...state.project.functions,
          fn_1: {
            id: 'fn_1',
            name: 'Interior Render',
            category: 'Render',
            workflow: { format: 'comfyui_api_json', rawJson: compiledWorkflow },
            inputs: [],
            outputs: [
              {
                key: 'image',
                label: 'Image',
                type: 'image',
                bind: { nodeTitle: 'Result_Image' },
                extract: { source: 'history', multiple: true },
              },
            ],
            createdAt: '2026-05-08T09:00:00.000Z',
            updatedAt: '2026-05-08T09:00:00.000Z',
          },
        },
        tasks: {
          task_1: {
            id: 'task_1',
            functionNodeId: 'node_fn_1',
            functionId: 'fn_1',
            runIndex: 1,
            runTotal: 1,
            status: 'failed',
            inputRefs: {},
            inputSnapshot: {},
            paramsSnapshot: { runCount: 1, mode: 'comfy' },
            workflowTemplateSnapshot: compiledWorkflow,
            compiledWorkflowSnapshot: compiledWorkflow,
            seedPatchLog,
            endpointId: 'endpoint_local',
            outputRefs: { image: [{ resourceId: 'stale_resource', type: 'image' }] },
            error: { code: 'comfy_execution_failed', message: 'First run failed' },
            createdAt: '2026-05-08T09:00:00.000Z',
            updatedAt: '2026-05-08T09:00:00.000Z',
            completedAt: '2026-05-08T09:00:00.000Z',
          },
        },
        canvas: {
          ...state.project.canvas,
          nodes: [
            {
              id: 'node_fn_1',
              type: 'function',
              position: { x: 100, y: 100 },
              data: { functionId: 'fn_1', title: 'Interior Render' },
            },
            {
              id: 'node_result_1',
              type: 'result_group',
              position: { x: 450, y: 100 },
              data: {
                sourceFunctionNodeId: 'node_fn_1',
                functionId: 'fn_1',
                taskId: 'task_1',
                runIndex: 1,
                runTotal: 1,
                title: 'Run 1',
                endpointId: 'endpoint_local',
                resources: [{ resourceId: 'stale_resource', type: 'image' }],
                status: 'failed',
                error: { code: 'comfy_execution_failed', message: 'First run failed' },
                seedPatchLog,
              },
            },
          ],
        },
      },
    }))

    await slice.getState().rerunResultNode('node_result_1')

    const state = slice.getState()
    expect(queuedWorkflows).toEqual([compiledWorkflow])
    expect(randomInt).not.toHaveBeenCalled()
    expect(state.project.canvas.nodes.filter((node) => node.type === 'result_group')).toHaveLength(1)
    expect(state.project.resources.stale_resource).toBeUndefined()
    expect(state.project.assets.stale_asset).toBeUndefined()
    expect(state.project.tasks.task_1).toMatchObject({
      status: 'succeeded',
      comfyPromptId: 'prompt_retry',
      seedPatchLog,
      outputRefs: { image: [{ resourceId: 'res_new', type: 'image' }] },
    })
    expect(state.project.canvas.nodes.find((node) => node.id === 'node_result_1')?.data).toMatchObject({
      status: 'succeeded',
      error: undefined,
      resources: [{ resourceId: 'res_new', type: 'image' }],
    })
  })

  it('cancels an active result run from its result node', () => {
    const slice = createProjectSlice({
      now: () => '2026-05-08T09:00:00.000Z',
    })

    slice.setState((state) => ({
      project: {
        ...state.project,
        tasks: {
          task_1: {
            id: 'task_1',
            functionNodeId: 'node_fn_1',
            functionId: 'fn_1',
            runIndex: 1,
            runTotal: 1,
            status: 'queued',
            inputRefs: {},
            inputSnapshot: {},
            paramsSnapshot: { runCount: 1, mode: 'comfy' },
            workflowTemplateSnapshot: {},
            compiledWorkflowSnapshot: {},
            seedPatchLog: [],
            outputRefs: {},
            createdAt: '2026-05-08T09:00:00.000Z',
            updatedAt: '2026-05-08T09:00:00.000Z',
          },
        },
        canvas: {
          ...state.project.canvas,
          nodes: [
            {
              id: 'node_result_1',
              type: 'result_group',
              position: { x: 450, y: 100 },
              data: {
                sourceFunctionNodeId: 'node_fn_1',
                functionId: 'fn_1',
                taskId: 'task_1',
                runIndex: 1,
                runTotal: 1,
                resources: [],
                status: 'queued',
              },
            },
          ],
        },
      },
    }))

    slice.getState().cancelResultRun('node_result_1')

    expect(slice.getState().project.tasks.task_1).toMatchObject({
      status: 'canceled',
      completedAt: '2026-05-08T09:00:00.000Z',
    })
    expect(slice.getState().project.canvas.nodes.find((node) => node.id === 'node_result_1')?.data).toMatchObject({
      status: 'canceled',
    })
  })

  it('interrupts running ComfyUI result runs but only cancels queued runs locally', () => {
    const interrupt = vi.fn().mockResolvedValue(undefined)
    const createComfyClient = vi.fn(() => ({
      queuePrompt: vi.fn(),
      getHistory: vi.fn(),
      interrupt,
    }))
    const slice = createProjectSlice({
      now: () => '2026-05-08T09:00:00.000Z',
      createComfyClient,
    })

    slice.setState((state) => ({
      project: {
        ...state.project,
        tasks: {
          task_running: {
            id: 'task_running',
            functionNodeId: 'node_fn_1',
            functionId: 'fn_1',
            runIndex: 1,
            runTotal: 2,
            status: 'running',
            inputRefs: {},
            inputSnapshot: {},
            paramsSnapshot: { runCount: 2, mode: 'comfy' },
            workflowTemplateSnapshot: {},
            compiledWorkflowSnapshot: {},
            seedPatchLog: [],
            endpointId: 'endpoint_local',
            outputRefs: {},
            createdAt: '2026-05-08T09:00:00.000Z',
            updatedAt: '2026-05-08T09:00:00.000Z',
          },
          task_queued: {
            id: 'task_queued',
            functionNodeId: 'node_fn_1',
            functionId: 'fn_1',
            runIndex: 2,
            runTotal: 2,
            status: 'queued',
            inputRefs: {},
            inputSnapshot: {},
            paramsSnapshot: { runCount: 2, mode: 'comfy' },
            workflowTemplateSnapshot: {},
            compiledWorkflowSnapshot: {},
            seedPatchLog: [],
            endpointId: 'endpoint_local',
            outputRefs: {},
            createdAt: '2026-05-08T09:00:00.000Z',
            updatedAt: '2026-05-08T09:00:00.000Z',
          },
        },
        canvas: {
          ...state.project.canvas,
          nodes: [
            {
              id: 'node_result_running',
              type: 'result_group',
              position: { x: 450, y: 100 },
              data: {
                sourceFunctionNodeId: 'node_fn_1',
                functionId: 'fn_1',
                taskId: 'task_running',
                runIndex: 1,
                runTotal: 2,
                resources: [],
                endpointId: 'endpoint_local',
                status: 'running',
              },
            },
            {
              id: 'node_result_queued',
              type: 'result_group',
              position: { x: 820, y: 100 },
              data: {
                sourceFunctionNodeId: 'node_fn_1',
                functionId: 'fn_1',
                taskId: 'task_queued',
                runIndex: 2,
                runTotal: 2,
                resources: [],
                endpointId: 'endpoint_local',
                status: 'queued',
              },
            },
          ],
        },
      },
    }))

    slice.getState().cancelResultRun('node_result_running')
    expect(createComfyClient).toHaveBeenCalledWith(expect.objectContaining({ id: 'endpoint_local' }))
    expect(interrupt).toHaveBeenCalledTimes(1)

    slice.getState().cancelResultRun('node_result_queued')
    expect(interrupt).toHaveBeenCalledTimes(1)
    expect(slice.getState().project.tasks.task_queued).toMatchObject({ status: 'canceled' })
  })

  it('runs request functions by compiling URL, headers, body, and response extractors', async () => {
    const fetchCalls: { input: RequestInfo | URL; init?: RequestInit }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ input, init })
        return new Response(JSON.stringify({ result: { text: 'ok from request' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    const ids = ['node_request', 'task_request', 'result_request', 'resource_request']
    const now = () => '2026-05-13T00:00:00.000Z'
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback',
      now,
    })
    const requestFunction: GenerationFunction = {
      id: 'fn_request',
      name: 'Request Lookup',
      category: 'Request',
      description: 'Generic request function',
      workflow: { format: 'http_request', rawJson: {} },
      request: {
        url: 'https://api.example.com/render',
        method: 'POST',
        headers: { 'X-App': 'Infinity' },
        body: '{"prompt":""}',
        responseParse: 'json',
      },
      inputs: [
        {
          key: 'prompt',
          label: 'Prompt',
          type: 'text',
          required: true,
          bind: { path: '$.prompt', requestTarget: 'body' },
          upload: { strategy: 'none' },
        },
      ],
      outputs: [
        {
          key: 'text',
          label: 'Text',
          type: 'text',
          bind: {},
          extract: { source: 'response_json_path', path: '$.result.text' },
        },
      ],
      runtimeDefaults: { runCount: 1, seedPolicy: { mode: 'randomize_all_before_submit' } },
      createdAt: now(),
      updatedAt: now(),
    }

    slice.setState((state) => ({
      project: {
        ...state.project,
        functions: { [requestFunction.id]: requestFunction },
      },
    }))
    slice.getState().addFunctionNodeAtPosition('fn_request', { x: 100, y: 100 }, { autoBindRequiredInputs: false })
    slice.getState().updateFunctionNodeInputValue('node_request', 'prompt', 'sunny kitchen')

    await slice.getState().runFunctionNodeWithComfy('node_request', 1)

    expect(fetchCalls).toHaveLength(1)
    expect(String(fetchCalls[0]?.input)).toBe('https://api.example.com/render')
    expect(fetchCalls[0]?.init).toMatchObject({
      method: 'POST',
      headers: { 'X-App': 'Infinity' },
      body: '{"prompt":"sunny kitchen"}',
    })
    const state = slice.getState().project
    expect(state.tasks.task_request).toMatchObject({
      status: 'succeeded',
      requestSnapshot: expect.objectContaining({
        url: 'https://api.example.com/render',
      }),
      outputRefs: { text: [{ resourceId: 'resource_request', type: 'text' }] },
    })
    expect(state.resources.resource_request).toMatchObject({
      type: 'text',
      value: 'ok from request',
    })
  })

  it('keeps custom OpenAI and Gemini functions editable even when they use provider formats', () => {
    const ids = ['fn_client_openai', 'fn_client_gemini']
    const now = () => '2026-05-13T00:00:00.000Z'
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback_id',
      now,
    })

    const openAiId = slice.getState().addOpenAILlmFunction('Client OpenAI', {
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'sk-client',
      model: 'gpt-client',
    })
    const geminiId = slice.getState().addGeminiLlmFunction('Client Gemini', {
      baseUrl: 'https://proxy.example.com/gemini/v1beta',
      apiKey: 'gemini-client',
      model: 'gemini-client',
    })

    expect(openAiId).toBe('fn_client_openai')
    expect(geminiId).toBe('fn_client_gemini')
    expect(slice.getState().project.functions[openAiId]).toMatchObject({
      id: 'fn_client_openai',
      name: 'Client OpenAI',
      workflow: { format: 'openai_chat_completions' },
      openai: {
        baseUrl: 'https://proxy.example.com/v1',
        apiKey: 'sk-client',
        model: 'gpt-client',
      },
    })
    expect(slice.getState().project.functions[geminiId]).toMatchObject({
      id: 'fn_client_gemini',
      name: 'Client Gemini',
      workflow: { format: 'gemini_generate_content' },
      gemini: {
        baseUrl: 'https://proxy.example.com/gemini/v1beta',
        apiKey: 'gemini-client',
        model: 'gemini-client',
      },
    })

    slice.getState().updateFunction(openAiId, { name: 'Renamed Client OpenAI' })
    expect(slice.getState().project.functions[openAiId]?.name).toBe('Renamed Client OpenAI')

    const builtInOpenAi = slice.getState().project.functions[OPENAI_LLM_FUNCTION_ID] ?? createOpenAILlmFunction(now())
    slice.getState().updateFunction(OPENAI_LLM_FUNCTION_ID, { name: 'Blocked Built In Rename' })
    expect(slice.getState().project.functions[OPENAI_LLM_FUNCTION_ID]).toEqual(builtInOpenAi)
  })

  it('runs one-off request nodes with node-level config and media output definitions', async () => {
    const originalFetch = globalThis.fetch
    const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ input, init })
        return new Response(
          JSON.stringify({
            image: 'https://cdn.example.com/result.png',
            video: 'https://cdn.example.com/result.mp4',
            audio: 'https://cdn.example.com/result.mp3',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        )
      }),
    )
    const ids = [
      'node_request_builtin',
      'task_request_builtin',
      'result_request_builtin',
      'resource_image',
      'asset_image',
      'resource_video',
      'asset_video',
      'resource_audio',
      'asset_audio',
    ]
    const slice = createProjectSlice({
      idFactory: () => ids.shift() ?? 'fallback_id',
      now: () => '2026-05-13T00:00:00.000Z',
    })

    const nodeId = slice
      .getState()
      .addFunctionNodeAtPosition(REQUEST_FUNCTION_ID, { x: 100, y: 100 }, { autoBindRequiredInputs: false })
    expect(nodeId).toBe('node_request_builtin')
    slice.getState().updateFunctionNodeRequestConfig(nodeId!, {
      url: 'https://api.example.com/media',
      method: 'POST',
      headers: { 'X-Request': 'canvas' },
      body: '{"mode":"once"}',
      responseParse: 'json',
    })
    slice.getState().updateFunctionNodeRequestOutputs(nodeId!, [
      {
        key: 'image',
        label: 'Image',
        type: 'image',
        bind: {},
        extract: { source: 'response_json_path', path: '$.image' },
      },
      {
        key: 'video',
        label: 'Video',
        type: 'video',
        bind: {},
        extract: { source: 'response_json_path', path: '$.video' },
      },
      {
        key: 'audio',
        label: 'Audio',
        type: 'audio',
        bind: {},
        extract: { source: 'response_json_path', path: '$.audio' },
      },
    ])

    await slice.getState().runFunctionNodeWithComfy(nodeId!, 1)

    expect(fetchCalls).toHaveLength(1)
    expect(String(fetchCalls[0]?.input)).toBe('https://api.example.com/media')
    expect(fetchCalls[0]?.init).toMatchObject({
      method: 'POST',
      headers: { 'X-Request': 'canvas' },
      body: '{"mode":"once"}',
    })
    const state = slice.getState().project
    expect(state.tasks.task_request_builtin.outputRefs).toEqual({
      image: [{ resourceId: 'resource_image', type: 'image' }],
      video: [{ resourceId: 'resource_video', type: 'video' }],
      audio: [{ resourceId: 'resource_audio', type: 'audio' }],
    })
    expect(state.resources.resource_image).toMatchObject({
      type: 'image',
      name: 'result.png',
      value: { url: 'https://cdn.example.com/result.png', mimeType: 'image/png' },
    })
    expect(state.resources.resource_video).toMatchObject({
      type: 'video',
      name: 'result.mp4',
      value: { url: 'https://cdn.example.com/result.mp4', mimeType: 'video/mp4' },
    })
    expect(state.resources.resource_audio).toMatchObject({
      type: 'audio',
      name: 'result.mp3',
      value: { url: 'https://cdn.example.com/result.mp3', mimeType: 'audio/mpeg' },
    })
    globalThis.fetch = originalFetch
  })
})
