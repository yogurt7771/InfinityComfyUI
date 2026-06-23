import { describe, expect, it } from 'vitest'
import { createGeminiImageFunction } from '../geminiImage'
import { createGeminiLlmFunction } from '../geminiLlm'
import { createLocalTransformFunctions, LOCAL_TEXT_TRIM_FUNCTION_ID } from '../localTransforms'
import { createOpenAIImageFunction } from '../openaiImage'
import { createOpenAILlmFunction } from '../openaiLlm'
import { createRequestFunction } from '../requestFunction'
import type { GenerationFunction, Resource } from '../types'
import { createRunSnapshot } from './runSnapshot'
import { adapterForFunction, allRunAdapters, prepareFunctionRun } from './runOrchestrator'

const now = '2026-06-23T00:00:00.000Z'

const textResource = (id: string, value: string): Resource => ({
  id,
  type: 'text',
  value,
  source: { kind: 'manual_input' },
  metadata: { createdAt: now },
})

const comfyFunction = (): GenerationFunction => ({
  id: 'fn_comfy',
  name: 'Comfy Image',
  workflow: {
    format: 'comfyui_api_json',
    rawJson: {
      '1': {
        class_type: 'SaveImage',
        inputs: {},
      },
    },
  },
  inputs: [],
  outputs: [
    {
      key: 'image',
      label: 'Image',
      type: 'image',
      bind: { nodeId: '1', path: 'images' },
      extract: { source: 'history' },
    },
  ],
  createdAt: now,
  updatedAt: now,
})

const runFor = (functionDef: GenerationFunction) =>
  createRunSnapshot({
    id: `run_${functionDef.id}`,
    functionDef,
    inputRefs: {},
    inputValuesSnapshot: {},
    runIndex: 1,
    runTotal: 1,
    now,
  })

describe('runOrchestrator adapters', () => {
  it('registers one adapter for every run provider', () => {
    expect(allRunAdapters.map((adapter) => adapter.provider)).toEqual([
      'comfyui',
      'openai_llm',
      'gemini_llm',
      'openai_image',
      'gemini_image',
      'http_request',
      'local_transform',
    ])
  })

  it('selects the matching adapter for each function kind', () => {
    const localFunction = createLocalTransformFunctions(now).find((fn) => fn.id === LOCAL_TEXT_TRIM_FUNCTION_ID)!

    expect(adapterForFunction(comfyFunction()).provider).toBe('comfyui')
    expect(adapterForFunction(createOpenAILlmFunction(now)).provider).toBe('openai_llm')
    expect(adapterForFunction(createGeminiLlmFunction(now)).provider).toBe('gemini_llm')
    expect(adapterForFunction(createOpenAIImageFunction(now)).provider).toBe('openai_image')
    expect(adapterForFunction(createGeminiImageFunction(now)).provider).toBe('gemini_image')
    expect(adapterForFunction(createRequestFunction('fn_request', 'Webhook', now)).provider).toBe('http_request')
    expect(adapterForFunction(localFunction).provider).toBe('local_transform')
  })

  it('prepares a ComfyUI task from the run compiled workflow snapshot', async () => {
    const functionDef = comfyFunction()
    const run = createRunSnapshot({
      ...runFor(functionDef),
      functionDef,
      compiledWorkflowSnapshot: {
        '2': {
          class_type: 'PreviewImage',
          inputs: {},
        },
      },
      now,
    })

    const prepared = await prepareFunctionRun({
      run,
      functionDef,
      inputValues: {},
      resources: {},
    })

    expect(prepared).toMatchObject({
      provider: 'comfyui',
      runId: run.id,
      functionId: functionDef.id,
      outputDefs: functionDef.outputs,
      request: {
        workflow: {
          '2': {
            class_type: 'PreviewImage',
          },
        },
      },
    })
  })

  it('prepares an HTTP request through the request adapter', async () => {
    const functionDef = createRequestFunction('fn_request', 'Webhook', now)
    functionDef.request = {
      url: 'https://api.example.com/search',
      method: 'GET',
      headers: {},
      body: '',
      responseParse: 'json',
      responseEncoding: 'utf-8',
    }
    functionDef.inputs = [
      {
        key: 'q',
        label: 'Query',
        type: 'text',
        required: true,
        bind: { path: 'q', requestTarget: 'url_param' },
      },
    ]

    const prepared = await prepareFunctionRun({
      run: runFor(functionDef),
      functionDef,
      inputValues: { q: { resourceId: 'res_prompt', type: 'text' } },
      resources: { res_prompt: textResource('res_prompt', 'kitchen') },
    })

    expect(prepared.provider).toBe('http_request')
    expect(prepared.request).toMatchObject({
      url: 'https://api.example.com/search?q=kitchen',
      responseParse: 'json',
    })
  })

  it('prepares OpenAI image and local transform tasks behind the same interface', async () => {
    const imageFunction = createOpenAIImageFunction(now)
    const imagePrepared = await prepareFunctionRun({
      run: runFor(imageFunction),
      functionDef: imageFunction,
      inputValues: { prompt: 'a clean product photo' },
      resources: {},
    })

    expect(imagePrepared).toMatchObject({
      provider: 'openai_image',
      request: {
        kind: 'generation',
        body: {
          prompt: 'a clean product photo',
        },
      },
    })

    const localFunction = createLocalTransformFunctions(now).find((fn) => fn.id === LOCAL_TEXT_TRIM_FUNCTION_ID)!
    const localPrepared = await prepareFunctionRun({
      run: runFor(localFunction),
      functionDef: localFunction,
      inputValues: { text: '  hello  ' },
      resources: {},
    })

    expect(localPrepared).toMatchObject({
      provider: 'local_transform',
      request: {
        inputValues: { text: '  hello  ' },
      },
    })
  })
})
