import { describe, expect, it } from 'vitest'
import { createGenerationFunctionFromWorkflow, injectWorkflowInputs, parseWorkflowNodes } from './workflow'
import type { FunctionInputDef, Resource } from './types'

describe('workflow helpers', () => {
  it('parses ComfyUI API workflow nodes into bindable input paths', () => {
    const nodes = parseWorkflowNodes({
      '6': {
        class_type: 'CLIPTextEncode',
        _meta: { title: 'Positive Prompt' },
        inputs: { text: 'old prompt', clip: ['4', 1] },
      },
      '10': {
        class_type: 'LoadImage',
        inputs: { image: 'input.png' },
      },
    })

    expect(nodes).toEqual([
      {
        id: '6',
        title: 'Positive Prompt',
        classType: 'CLIPTextEncode',
        bindableInputPaths: ['inputs.text', 'inputs.clip'],
      },
      {
        id: '10',
        title: '10',
        classType: 'LoadImage',
        bindableInputPaths: ['inputs.image'],
      },
    ])
  })

  it('injects primitive and resource values into configured workflow paths without mutating the template', () => {
    const workflow = {
      '6': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'old prompt' },
      },
      '10': {
        class_type: 'LoadImage',
        inputs: { image: 'old.png' },
      },
    }
    const inputs: FunctionInputDef[] = [
      {
        key: 'prompt',
        label: 'Prompt',
        type: 'text',
        required: true,
        bind: { nodeId: '6', path: 'inputs.text' },
      },
      {
        key: 'reference',
        label: 'Reference',
        type: 'image',
        required: true,
        bind: { nodeId: '10', path: 'inputs.image' },
        upload: { strategy: 'manual_path' },
      },
    ]
    const resources: Record<string, Resource> = {
      img_1: {
        id: 'img_1',
        type: 'image',
        value: {
          assetId: 'asset_1',
          url: 'input/kitchen.png',
          mimeType: 'image/png',
          sizeBytes: 100,
        },
        source: { kind: 'user_upload' },
      },
    }

    const compiled = injectWorkflowInputs(workflow, inputs, {
      prompt: 'bright studio',
      reference: { resourceId: 'img_1', type: 'image' },
    }, resources)

    expect(compiled).not.toBe(workflow)
    expect(compiled['6']!.inputs!.text).toBe('bright studio')
    expect(compiled['10']!.inputs!.image).toBe('input/kitchen.png')
    expect(workflow['6'].inputs.text).toBe('old prompt')
  })

  it('injects optional primitive values into matching workflow input keys when a legacy bind path is stale', () => {
    const workflow = {
      '75:66': {
        class_type: 'EmptyFlux2LatentImage',
        _meta: { title: 'Empty Flux 2 Latent' },
        inputs: {
          width: ['75:68', 0],
          height: ['75:69', 0],
          batch_size: 1,
          text: 'unrelated legacy field',
        },
      },
    }
    const inputs: FunctionInputDef[] = [
      {
        key: 'batch_size',
        label: 'Batch Size',
        type: 'number',
        required: false,
        bind: { nodeId: '75:66', nodeTitle: 'Empty Flux 2 Latent', path: 'inputs.text' },
      },
    ]

    const compiled = injectWorkflowInputs(workflow, inputs, { batch_size: 2 }, {})

    expect(compiled['75:66']!.inputs!.batch_size).toBe(2)
    expect(compiled['75:66']!.inputs!.text).toBe('unrelated legacy field')
    expect(workflow['75:66'].inputs.batch_size).toBe(1)
  })

  it('injects connected number resources into matching workflow input keys when a legacy bind path is stale', () => {
    const workflow = {
      '75:66': {
        class_type: 'EmptyFlux2LatentImage',
        _meta: { title: 'Empty Flux 2 Latent' },
        inputs: {
          batch_size: 1,
          text: 'unrelated legacy field',
        },
      },
    }
    const inputs: FunctionInputDef[] = [
      {
        key: 'batch_size',
        label: 'Batch Size',
        type: 'number',
        required: false,
        bind: { nodeId: '75:66', nodeTitle: 'Empty Flux 2 Latent', path: 'inputs.text' },
      },
    ]
    const resources: Record<string, Resource> = {
      res_batch_size: {
        id: 'res_batch_size',
        type: 'number',
        name: 'Batch Size',
        value: 2,
        source: { kind: 'manual_input' },
      },
    }

    const compiled = injectWorkflowInputs(
      workflow,
      inputs,
      { batch_size: { resourceId: 'res_batch_size', type: 'number' } },
      resources,
    )

    expect(compiled['75:66']!.inputs!.batch_size).toBe(2)
    expect(compiled['75:66']!.inputs!.text).toBe('unrelated legacy field')
  })

  it.each([
    ['image', 'input/kitchen.png', 'image/png'],
    ['video', 'input/clip.mp4', 'video/mp4'],
    ['audio', 'input/voice.wav', 'audio/wav'],
  ] as const)('injects connected %s resources into matching workflow input keys when a legacy bind path is stale', (type, url, mimeType) => {
    const workflow = {
      '76': {
        class_type: 'LoadMedia',
        _meta: { title: 'Load Media' },
        inputs: {
          [type]: 'reference',
          text: 'unrelated legacy field',
        },
      },
    }
    const inputs: FunctionInputDef[] = [
      {
        key: type,
        label: type,
        type,
        required: true,
        bind: { nodeId: '76', nodeTitle: 'Load Media', path: 'inputs.text' },
        upload: { strategy: 'manual_path' },
      },
    ]
    const resources: Record<string, Resource> = {
      res_media: {
        id: 'res_media',
        type,
        name: 'Reference',
        value: {
          assetId: 'asset_media',
          url,
          mimeType,
          sizeBytes: 100,
        },
        source: { kind: 'user_upload' },
      },
    }

    const compiled = injectWorkflowInputs(workflow, inputs, { [type]: { resourceId: 'res_media', type } }, resources)

    expect(compiled['76']!.inputs![type]).toBe(url)
    expect(compiled['76']!.inputs!.text).toBe('unrelated legacy field')
  })

  it('infers Flux text-to-image prompt and SaveImage bindings from workflow node metadata', () => {
    const fn = createGenerationFunctionFromWorkflow('fn_1', 'Flux Text', {
      '9': {
        class_type: 'SaveImage',
        _meta: { title: 'Save Image' },
        inputs: { filename_prefix: 'flux', images: ['75:65', 0] },
      },
      '75:67': {
        class_type: 'CLIPTextEncode',
        _meta: { title: 'CLIP Text Encode (Negative Prompt)' },
        inputs: { text: '', clip: ['75:71', 0] },
      },
      '75:74': {
        class_type: 'CLIPTextEncode',
        _meta: { title: 'CLIP Text Encode (Positive Prompt)' },
        inputs: { text: 'warm room', clip: ['75:71', 0] },
      },
    }, '2026-05-08T09:00:00.000Z')

    expect(fn.inputs).toMatchObject([
      {
        key: 'prompt',
        type: 'text',
        required: true,
        bind: { nodeId: '75:74', nodeTitle: 'CLIP Text Encode (Positive Prompt)', path: 'inputs.text' },
      },
      {
        key: 'negative_prompt',
        type: 'text',
        required: false,
        bind: { nodeId: '75:67', nodeTitle: 'CLIP Text Encode (Negative Prompt)', path: 'inputs.text' },
      },
    ])
    expect(fn.outputs).toEqual([
      {
        key: 'image',
        label: 'Image',
        type: 'image',
        bind: { nodeId: '9', nodeTitle: 'Save Image' },
        extract: { source: 'history', multiple: true },
      },
    ])
  })

  it('infers ComfyUI image upload inputs for image-edit workflows', () => {
    const fn = createGenerationFunctionFromWorkflow('fn_1', 'Flux Edit', {
      '9': {
        class_type: 'SaveImage',
        _meta: { title: 'Save Image' },
        inputs: { filename_prefix: 'flux', images: ['75:65', 0] },
      },
      '76': {
        class_type: 'LoadImage',
        _meta: { title: 'Load Image' },
        inputs: { image: 'reference.png' },
      },
      '75:74': {
        class_type: 'CLIPTextEncode',
        _meta: { title: 'CLIP Text Encode (Positive Prompt)' },
        inputs: { text: 'edit the image', clip: ['75:71', 0] },
      },
    }, '2026-05-08T09:00:00.000Z')

    expect(fn.inputs).toMatchObject([
      {
        key: 'prompt',
        type: 'text',
        bind: { nodeId: '75:74', path: 'inputs.text' },
      },
      {
        key: 'image',
        type: 'image',
        required: true,
        bind: { nodeId: '76', nodeTitle: 'Load Image', path: 'inputs.image' },
        upload: { strategy: 'comfy_upload' },
      },
    ])
    expect(fn.category).toBe('Edit')
  })

  it('infers image, video, audio, and text output bindings from common output nodes', () => {
    const fn = createGenerationFunctionFromWorkflow('fn_1', 'Mixed Outputs', {
      '9': { class_type: 'SaveImage', _meta: { title: 'Save Image' }, inputs: {} },
      '21': { class_type: 'SaveVideo', _meta: { title: 'Save Video' }, inputs: {} },
      '22': { class_type: 'SaveAudio', _meta: { title: 'Save Audio' }, inputs: {} },
      '23': { class_type: 'PreviewText', _meta: { title: 'Preview Text' }, inputs: {} },
    }, '2026-05-08T09:00:00.000Z')

    expect(fn.outputs).toEqual([
      {
        key: 'image',
        label: 'Image',
        type: 'image',
        bind: { nodeId: '9', nodeTitle: 'Save Image' },
        extract: { source: 'history', multiple: true },
      },
      {
        key: 'video',
        label: 'Video',
        type: 'video',
        bind: { nodeId: '21', nodeTitle: 'Save Video' },
        extract: { source: 'history', multiple: true },
      },
      {
        key: 'audio',
        label: 'Audio',
        type: 'audio',
        bind: { nodeId: '22', nodeTitle: 'Save Audio' },
        extract: { source: 'history', multiple: true },
      },
      {
        key: 'text',
        label: 'Text',
        type: 'text',
        bind: { nodeId: '23', nodeTitle: 'Preview Text' },
        extract: { source: 'node_output', multiple: true },
      },
    ])
  })
})
