import { describe, expect, it } from 'vitest'
import {
  createGenerationFunctionFromWorkflow,
  injectWorkflowInputs,
  parseWorkflowNodes,
  workflowInputBindingExists,
  workflowInputCandidates,
} from './workflow'
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

  it('uses the same title fallback for slot validation and runtime injection when workflow node ids change', () => {
    const workflow = {
      '20': {
        class_type: 'LoadImage',
        _meta: { title: 'Load Image' },
        inputs: { image: 'old.png' },
      },
    }
    const input: FunctionInputDef = {
      key: 'image',
      label: 'Image',
      type: 'image',
      required: true,
      bind: { nodeId: '10', nodeTitle: 'Load Image', path: 'inputs.image' },
      upload: { strategy: 'manual_path' },
    }
    const resources: Record<string, Resource> = {
      res_image: {
        id: 'res_image',
        type: 'image',
        name: 'Reference',
        value: {
          assetId: 'asset_image',
          url: 'input/new.png',
          mimeType: 'image/png',
          sizeBytes: 100,
        },
        source: { kind: 'user_upload' },
      },
    }

    expect(workflowInputBindingExists(workflow, input)).toBe(true)

    const compiled = injectWorkflowInputs(workflow, [input], { image: { resourceId: 'res_image', type: 'image' } }, resources)

    expect(compiled['20']!.inputs!.image).toBe('input/new.png')
  })

  it('injects boolean primitive values into configured workflow paths', () => {
    const workflow = {
      '32': {
        class_type: 'Boolean',
        _meta: { title: 'Enable Detailer' },
        inputs: {
          value: false,
        },
      },
    }
    const inputs: FunctionInputDef[] = [
      {
        key: 'enable_detailer',
        label: 'Enable Detailer',
        type: 'boolean',
        required: false,
        bind: { nodeId: '32', nodeTitle: 'Enable Detailer', path: 'inputs.value' },
      },
    ]

    const compiled = injectWorkflowInputs(workflow, inputs, { enable_detailer: true }, {})

    expect(compiled['32']!.inputs!.value).toBe(true)
    expect(workflow['32'].inputs.value).toBe(false)
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

  it('keeps Flux text prompts as manual candidates while still detecting SaveImage outputs', () => {
    const workflow = {
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
    }
    const fn = createGenerationFunctionFromWorkflow('fn_1', 'Flux Text', workflow, '2026-05-08T09:00:00.000Z')

    expect(fn.inputs).toEqual([])
    expect(workflowInputCandidates(workflow)).toMatchObject([
      {
        key: 'text',
        type: 'text',
        required: false,
        defaultValue: '',
        bind: { nodeId: '75:67', nodeTitle: 'CLIP Text Encode (Negative Prompt)', path: 'inputs.text' },
      },
      {
        key: 'text_2',
        type: 'text',
        required: false,
        defaultValue: 'warm room',
        bind: { nodeId: '75:74', nodeTitle: 'CLIP Text Encode (Positive Prompt)', path: 'inputs.text' },
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
        key: 'image',
        type: 'image',
        required: true,
        bind: { nodeId: '76', nodeTitle: 'Load Image', path: 'inputs.image' },
        upload: { strategy: 'comfy_upload' },
      },
    ])
    expect(fn.category).toBe('Edit')
  })

  it('keeps primitive workflow widget values internal by default', () => {
    const fn = createGenerationFunctionFromWorkflow('fn_1', 'Latent Size', {
      '14': {
        class_type: 'EmptyLatentImage',
        _meta: { title: 'Latent Size' },
        inputs: {
          width: 1024,
          height: 768,
          enable_detailer: true,
          prompt: 'keep internal',
          batch_size: ['11', 0],
        },
      },
      '9': {
        class_type: 'SaveImage',
        _meta: { title: 'Save Image' },
        inputs: { filename_prefix: 'flux', images: ['14', 0] },
      },
    }, '2026-05-08T09:00:00.000Z')

    expect(fn.inputs).toEqual([])
  })

  it('lists primitive and media workflow input candidates for manual slot exposure', () => {
    const candidates = workflowInputCandidates({
      '14': {
        class_type: 'EmptyLatentImage',
        _meta: { title: 'Latent Size' },
        inputs: {
          width: 1024,
          enable_detailer: true,
          note: 'manual note',
          image: ['11', 0],
        },
      },
      '20': {
        class_type: 'LoadVideo',
        _meta: { title: 'Input Video' },
        inputs: {
          video: 'input.mp4',
        },
      },
    })

    expect(candidates).toMatchObject([
      {
        key: 'width',
        label: 'Width',
        type: 'number',
        defaultValue: 1024,
        bind: { nodeId: '14', nodeTitle: 'Latent Size', path: 'inputs.width' },
      },
      {
        key: 'enable_detailer',
        label: 'Enable Detailer',
        type: 'boolean',
        defaultValue: true,
        bind: { nodeId: '14', nodeTitle: 'Latent Size', path: 'inputs.enable_detailer' },
      },
      {
        key: 'note',
        label: 'Note',
        type: 'text',
        defaultValue: 'manual note',
        bind: { nodeId: '14', nodeTitle: 'Latent Size', path: 'inputs.note' },
      },
      {
        key: 'video',
        label: 'Video',
        type: 'video',
        bind: { nodeId: '20', nodeTitle: 'Input Video', path: 'inputs.video' },
      },
    ])
  })

  it('infers video and audio asset inputs from media loader workflow fields', () => {
    const fn = createGenerationFunctionFromWorkflow('fn_1', 'Media Inputs', {
      '20': {
        class_type: 'LoadVideo',
        _meta: { title: 'First Frame Video' },
        inputs: {
          video: 'input.mp4',
          vae: ['4', 0],
        },
      },
      '21': {
        class_type: 'LoadAudio',
        _meta: { title: 'Voice Audio' },
        inputs: {
          audio: 'voice.wav',
          model: ['5', 0],
        },
      },
      '30': {
        class_type: 'SaveVideo',
        _meta: { title: 'Save Video' },
        inputs: { video: ['20', 0] },
      },
    }, '2026-05-08T09:00:00.000Z')

    expect(fn.inputs).toMatchObject([
      {
        key: 'video',
        label: 'Video',
        type: 'video',
        required: true,
        bind: { nodeId: '20', nodeTitle: 'First Frame Video', path: 'inputs.video' },
        upload: { strategy: 'manual_path' },
      },
      {
        key: 'audio',
        label: 'Audio',
        type: 'audio',
        required: true,
        bind: { nodeId: '21', nodeTitle: 'Voice Audio', path: 'inputs.audio' },
        upload: { strategy: 'manual_path' },
      },
    ])
  })

  it('stores ComfyUI UI workflow metadata alongside the runnable API workflow', () => {
    const apiWorkflow = {
      '9': {
        class_type: 'SaveImage',
        _meta: { title: 'Save Image' },
        inputs: { filename_prefix: 'flux' },
      },
    }
    const uiWorkflow = {
      id: 'ui_workflow_1',
      nodes: [{ id: 9, type: 'SaveImage', pos: [120, 80] }],
      links: [],
      version: 0.4,
    }

    const fn = createGenerationFunctionFromWorkflow('fn_1', 'Embedded Comfy', apiWorkflow, '2026-05-08T09:00:00.000Z', {
      uiJson: uiWorkflow,
      editor: {
        kind: 'comfyui_embedded',
        endpointId: 'endpoint_local',
        baseUrl: 'http://127.0.0.1:27707',
        savedAt: '2026-05-08T09:01:00.000Z',
      },
    })

    expect(fn.workflow.rawJson).toEqual(apiWorkflow)
    expect(fn.workflow.uiJson).toEqual(uiWorkflow)
    expect(fn.workflow.editor).toEqual({
      kind: 'comfyui_embedded',
      endpointId: 'endpoint_local',
      baseUrl: 'http://127.0.0.1:27707',
      savedAt: '2026-05-08T09:01:00.000Z',
    })
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
