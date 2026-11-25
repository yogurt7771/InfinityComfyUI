import { describe, expect, it, vi } from 'vitest'
import { createProjectSlice } from './projectStore'
import { comfyNodeTypesFromObjectInfo } from '../domain/comfyNodeTypes'
import { LOCAL_TEXT_TRIM_FUNCTION_ID } from '../domain/localTransforms'
import { createGenerationFunctionFromWorkflow } from '../domain/workflow'
import type {
  ComfyEndpointConfig,
  ComfyUiWorkflow,
  ComfyWorkflow,
  ComfyWorkflowEditorMetadata,
  FunctionOutputDef,
  GenerationFunction,
  MediaResourceValue,
} from '../domain/types'

const NOW = '2026-05-08T09:00:00.000Z'
const DEFAULT_BASE_URL = 'http://127.0.0.1:8188'

const LEGACY_FALLBACK: FunctionOutputDef = {
  key: 'result',
  label: 'Result',
  type: 'text',
  bind: { nodeTitle: 'Result' },
  extract: { source: 'history', multiple: true },
}

/** Synthetic ComfyUI /object_info payload. */
const OBJECT_INFO = {
  KSampler: {
    input: { required: { seed: ['INT', { default: 0 }], steps: ['INT', { default: 20 }] } },
    output: ['LATENT'],
    output_node: false,
  },
  VAEDecode: {
    input: { required: { samples: ['LATENT'], vae: ['VAE'] } },
    output: ['IMAGE'],
    output_node: false,
  },
  SaveImage: {
    input: {
      required: { images: ['IMAGE'], filename_prefix: ['STRING', { default: 'ComfyUI' }] },
      hidden: { prompt: 'PROMPT' },
    },
    output: [],
    output_node: true,
  },
  PreviewImage: {
    input: { required: { images: ['IMAGE'] } },
    output: [],
    output_node: true,
  },
  MyFancySaver: {
    input: { required: { pixels: ['IMAGE'] } },
    output: [],
    output_node: true,
  },
}

const OBJECT_INFO_WITH_NEW_NODE = {
  ...OBJECT_INFO,
  BrandNewNode: { input: { required: { images: ['IMAGE'] } }, output: [], output_node: true },
}

const fancyWorkflow = (): ComfyWorkflow => ({
  '3': { class_type: 'KSampler', _meta: { title: 'Sampler' }, inputs: { seed: 1, steps: 20 } },
  '8': { class_type: 'VAEDecode', _meta: { title: 'Decode' }, inputs: { samples: ['3', 0] } },
  '12': { class_type: 'MyFancySaver', _meta: { title: 'Fancy' }, inputs: { pixels: ['8', 0] } },
})

const previewWorkflow = (): ComfyWorkflow => ({
  '3': { class_type: 'KSampler', _meta: { title: 'Sampler' }, inputs: { seed: 1, steps: 20 } },
  '20': { class_type: 'PreviewImage', _meta: { title: 'Preview Image' }, inputs: { images: ['3', 0] } },
})

type ObjectInfoImpl = (endpoint: ComfyEndpointConfig) => Promise<unknown>

type HarnessOptions = {
  historyOutputs?: Record<string, unknown>
  objectInfo?: ObjectInfoImpl
  withoutObjectInfo?: boolean
}

const blobFor = (filename: string) =>
  /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(filename)
    ? new Blob(['video-bytes'], { type: 'video/mp4' })
    : new Blob(['image-bytes'], { type: 'image/png' })

const createHarness = (options: HarnessOptions = {}) => {
  let nextId = 0
  const historyOutputs = options.historyOutputs ?? {
    '12': { images: [{ filename: 'fancy_00001_.png', subfolder: '', type: 'output' }] },
  }
  const objectInfo = vi.fn<ObjectInfoImpl>(options.objectInfo ?? (async () => structuredClone(OBJECT_INFO)))
  const viewFile = vi.fn(async (params: { filename: string }) => blobFor(params.filename))
  const slice = createProjectSlice({
    idFactory: () => `gen_${(nextId += 1)}`,
    now: () => NOW,
    randomInt: () => 42,
    createComfyClient: (endpoint) => ({
      queuePrompt: async () => ({ prompt_id: 'prompt_1', number: 1 }),
      getHistory: async () => ({ prompt_1: { outputs: historyOutputs } }),
      viewFile,
      ...(options.withoutObjectInfo ? {} : { getObjectInfo: () => objectInfo(endpoint) }),
    }),
    comfyRunOptions: { maxPollAttempts: 1, pollIntervalMs: 1 },
  })
  const calledBaseUrls = () => objectInfo.mock.calls.map(([endpoint]) => endpoint.baseUrl)
  return { slice, objectInfo, viewFile, calledBaseUrls }
}

type Slice = ReturnType<typeof createProjectSlice>

const withEndpoint = (fn: GenerationFunction, endpointId: string): GenerationFunction => ({
  ...fn,
  workflow: { ...fn.workflow, editor: { kind: 'comfyui_embedded', endpointId, savedAt: NOW } },
})

const waitForTasksToSettle = async (slice: Slice) => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const tasks = Object.values(slice.getState().project.tasks)
    if (tasks.length > 0 && tasks.every((task) => ['succeeded', 'failed', 'canceled'].includes(task.status))) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const expectSingleImageResult = (slice: Slice) => {
  const { project } = slice.getState()
  expect(Object.values(project.tasks)).toEqual([expect.objectContaining({ status: 'succeeded' })])
  const images = Object.values(project.resources).filter((resource) => resource.type === 'image')
  expect(images).toHaveLength(1)
  expect((images[0]!.value as MediaResourceValue).url).toMatch(/^data:image\//)
  expect(Object.values(project.resources).filter((resource) => resource.type === 'text')).toEqual([])
  expect(
    project.canvas.nodes.filter((node) => node.type === 'resource' && node.data.resourceType === 'image'),
  ).toHaveLength(1)
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('ComfyUI node types in the store: running', () => {
  it('runs a temporary function built with node types for a custom save class into an image resource', async () => {
    const { slice } = createHarness()
    const nodeTypes = comfyNodeTypesFromObjectInfo(OBJECT_INFO)
    const endpointId = slice.getState().project.comfy.endpoints[0]!.id
    const fn = withEndpoint(
      createGenerationFunctionFromWorkflow('temp_comfy_1', 'Fancy', fancyWorkflow(), NOW, { nodeTypes }),
      endpointId,
    )
    expect(fn.outputs).toEqual([
      expect.objectContaining({ key: 'image', type: 'image', bind: expect.objectContaining({ nodeId: '12' }) }),
    ])

    await slice.getState().runTemporaryFunctionAtPosition(fn, {}, { x: 0, y: 0 }, 1)
    await waitForTasksToSettle(slice)

    expectSingleImageResult(slice)
  })

  it('repairs a legacy-fallback temporary function with node types at run time', async () => {
    const { slice, objectInfo } = createHarness()
    const endpointId = slice.getState().project.comfy.endpoints[0]!.id
    const legacy = withEndpoint(
      createGenerationFunctionFromWorkflow('temp_comfy_2', 'Legacy Fancy', fancyWorkflow(), NOW),
      endpointId,
    )
    // Name rules cannot recognize MyFancySaver, so the function has the legacy fallback.
    expect(legacy.outputs).toEqual([LEGACY_FALLBACK])

    await slice.getState().runTemporaryFunctionAtPosition(legacy, {}, { x: 0, y: 0 }, 1)
    await waitForTasksToSettle(slice)

    expect(objectInfo).toHaveBeenCalled()
    expectSingleImageResult(slice)
  })

  it('repairs a saved legacy-fallback function with node types at run time', async () => {
    const { slice, objectInfo } = createHarness()
    const functionId = slice.getState().addFunctionFromWorkflow('Legacy Fancy', fancyWorkflow())
    expect(slice.getState().project.functions[functionId]!.outputs).toEqual([LEGACY_FALLBACK])

    await slice.getState().runFunctionAtPosition(functionId, {}, { x: 0, y: 0 }, 1)
    await waitForTasksToSettle(slice)

    expect(objectInfo).toHaveBeenCalled()
    expectSingleImageResult(slice)
  })

  it('stores an image-declared output that returns an mp4 under gifs as a video resource', async () => {
    const { slice } = createHarness({
      historyOutputs: { '20': { gifs: [{ filename: 'clip.mp4', subfolder: '', type: 'output' }] } },
    })
    const endpointId = slice.getState().project.comfy.endpoints[0]!.id
    const fn = withEndpoint(
      createGenerationFunctionFromWorkflow('temp_comfy_3', 'Clip', previewWorkflow(), NOW),
      endpointId,
    )
    expect(fn.outputs).toEqual([expect.objectContaining({ type: 'image', bind: expect.objectContaining({ nodeId: '20' }) })])

    await slice.getState().runTemporaryFunctionAtPosition(fn, {}, { x: 0, y: 0 }, 1)
    await waitForTasksToSettle(slice)

    const { project } = slice.getState()
    const tasks = Object.values(project.tasks)
    expect(tasks).toEqual([expect.objectContaining({ status: 'succeeded' })])

    const resources = Object.values(project.resources)
    const videos = resources.filter((resource) => resource.type === 'video')
    expect(videos).toHaveLength(1)
    expect(resources.filter((resource) => resource.type === 'image')).toEqual([])
    const video = videos[0]!

    const videoNodes = project.canvas.nodes.filter((node) => node.type === 'resource' && node.data.resourceId === video.id)
    expect(videoNodes).toHaveLength(1)
    expect(videoNodes[0]!.data.resourceType).toBe('video')
    expect(
      project.canvas.nodes.filter((node) => node.type === 'resource' && node.data.resourceType === 'image'),
    ).toEqual([])

    const refs = Object.values(tasks[0]!.outputRefs).flat()
    expect(refs).toContainEqual({ resourceId: video.id, type: 'video' })
    expect(refs.every((ref) => ref.type === 'video')).toBe(true)
  })
})

describe('ComfyUI node types in the store: addFunctionFromWorkflow', () => {
  it('passes nodeTypes through to output inference', () => {
    const { slice } = createHarness()
    const nodeTypes = comfyNodeTypesFromObjectInfo(OBJECT_INFO)
    const functionId = slice.getState().addFunctionFromWorkflow('Fancy', fancyWorkflow(), { nodeTypes })
    const fn = slice.getState().project.functions[functionId]!
    expect(fn.outputs).toEqual([
      {
        key: 'image',
        label: 'Image',
        type: 'image',
        bind: { nodeId: '12', nodeTitle: 'Fancy' },
        extract: { source: 'history', multiple: true },
      },
    ])
    expect(fn.outputInference).toBe('node_types')
  })

  it("keeps name inference ('node_names') without nodeTypes", () => {
    const { slice } = createHarness()
    const functionId = slice.getState().addFunctionFromWorkflow('Fancy', fancyWorkflow())
    const fn = slice.getState().project.functions[functionId]!
    expect(fn.outputs).toEqual([LEGACY_FALLBACK])
    expect(fn.outputInference).toBe('node_names')
  })
})

describe('ComfyUI node types in the store: loadComfyNodeTypes', () => {
  it('fetches object_info from the first enabled endpoint and converts it', async () => {
    const { slice, objectInfo, calledBaseUrls } = createHarness()
    const result = await slice.getState().loadComfyNodeTypes()
    expect(result).toEqual(comfyNodeTypesFromObjectInfo(OBJECT_INFO))
    expect(objectInfo).toHaveBeenCalledTimes(1)
    expect(calledBaseUrls()).toEqual([DEFAULT_BASE_URL])
  })

  it('caches the result per endpoint', async () => {
    const { slice, objectInfo } = createHarness()
    const first = await slice.getState().loadComfyNodeTypes()
    const second = await slice.getState().loadComfyNodeTypes()
    const third = await slice.getState().loadComfyNodeTypes('endpoint_local')
    expect(second).toEqual(first)
    expect(third).toEqual(first)
    expect(objectInfo).toHaveBeenCalledTimes(1)
  })

  it('shares one request between concurrent calls', async () => {
    const pending = deferred<unknown>()
    const { slice, objectInfo } = createHarness({ objectInfo: () => pending.promise })
    const a = slice.getState().loadComfyNodeTypes()
    const b = slice.getState().loadComfyNodeTypes()
    pending.resolve(structuredClone(OBJECT_INFO))
    const [resultA, resultB] = await Promise.all([a, b])
    expect(resultA).toEqual(comfyNodeTypesFromObjectInfo(OBJECT_INFO))
    expect(resultB).toEqual(comfyNodeTypesFromObjectInfo(OBJECT_INFO))
    expect(objectInfo).toHaveBeenCalledTimes(1)
  })

  it('uses the endpoint named by endpointId and caches each endpoint separately', async () => {
    const { slice, objectInfo, calledBaseUrls } = createHarness({
      objectInfo: async (endpoint) =>
        endpoint.baseUrl === 'http://10.0.0.2:8188' ? structuredClone(OBJECT_INFO_WITH_NEW_NODE) : structuredClone(OBJECT_INFO),
    })
    const remoteId = slice.getState().addEndpoint({ name: 'Remote', baseUrl: 'http://10.0.0.2:8188', enabled: true })

    const remote = await slice.getState().loadComfyNodeTypes(remoteId)
    expect(remote).toEqual(comfyNodeTypesFromObjectInfo(OBJECT_INFO_WITH_NEW_NODE))
    const local = await slice.getState().loadComfyNodeTypes('endpoint_local')
    expect(local).toEqual(comfyNodeTypesFromObjectInfo(OBJECT_INFO))

    await slice.getState().loadComfyNodeTypes(remoteId)
    await slice.getState().loadComfyNodeTypes('endpoint_local')
    expect(objectInfo).toHaveBeenCalledTimes(2)
    expect(calledBaseUrls()).toEqual(['http://10.0.0.2:8188', DEFAULT_BASE_URL])
  })

  it('falls back to the first enabled endpoint for an unknown endpointId', async () => {
    const { slice, calledBaseUrls } = createHarness()
    const result = await slice.getState().loadComfyNodeTypes('no_such_endpoint')
    expect(result).toEqual(comfyNodeTypesFromObjectInfo(OBJECT_INFO))
    expect(calledBaseUrls()).toEqual([DEFAULT_BASE_URL])
  })

  it('skips disabled endpoints when choosing the default', async () => {
    const { slice, calledBaseUrls } = createHarness()
    slice.getState().addEndpoint({ name: 'Second', baseUrl: 'http://10.0.0.3:8188', enabled: true })
    slice.getState().updateEndpoint('endpoint_local', { enabled: false })
    const result = await slice.getState().loadComfyNodeTypes()
    expect(result).toEqual(comfyNodeTypesFromObjectInfo(OBJECT_INFO))
    expect(calledBaseUrls()).toEqual(['http://10.0.0.3:8188'])
  })

  it('uses an explicitly named endpoint even if it is disabled', async () => {
    const { slice, calledBaseUrls } = createHarness()
    const otherId = slice.getState().addEndpoint({ name: 'Off', baseUrl: 'http://10.0.0.4:8188', enabled: false })
    await slice.getState().loadComfyNodeTypes(otherId)
    expect(calledBaseUrls()).toEqual(['http://10.0.0.4:8188'])
  })

  it('returns undefined without calling the server when no endpoint is enabled', async () => {
    const { slice, objectInfo } = createHarness()
    slice.getState().updateEndpoint('endpoint_local', { enabled: false })
    expect(await slice.getState().loadComfyNodeTypes()).toBeUndefined()
    expect(objectInfo).not.toHaveBeenCalled()
  })

  it('refetches when the endpoint baseUrl changes', async () => {
    const { slice, objectInfo, calledBaseUrls } = createHarness()
    await slice.getState().loadComfyNodeTypes('endpoint_local')
    slice.getState().updateEndpoint('endpoint_local', { baseUrl: 'http://127.0.0.1:8189' })
    await slice.getState().loadComfyNodeTypes('endpoint_local')
    expect(objectInfo).toHaveBeenCalledTimes(2)
    expect(calledBaseUrls()).toEqual([DEFAULT_BASE_URL, 'http://127.0.0.1:8189'])
  })

  it('refetches once when a workflow uses a class missing from the cache, then caches the new result', async () => {
    let call = 0
    const { slice, objectInfo } = createHarness({
      objectInfo: async () => {
        call += 1
        return structuredClone(call === 1 ? OBJECT_INFO : OBJECT_INFO_WITH_NEW_NODE)
      },
    })
    const knownWorkflow = fancyWorkflow()
    const newWorkflow: ComfyWorkflow = {
      ...fancyWorkflow(),
      '30': { class_type: 'BrandNewNode', _meta: { title: 'New' }, inputs: { images: ['8', 0] } },
    }

    expect(await slice.getState().loadComfyNodeTypes()).toEqual(comfyNodeTypesFromObjectInfo(OBJECT_INFO))
    expect(await slice.getState().loadComfyNodeTypes(undefined, knownWorkflow)).toEqual(
      comfyNodeTypesFromObjectInfo(OBJECT_INFO),
    )
    expect(objectInfo).toHaveBeenCalledTimes(1)

    expect(await slice.getState().loadComfyNodeTypes(undefined, newWorkflow)).toEqual(
      comfyNodeTypesFromObjectInfo(OBJECT_INFO_WITH_NEW_NODE),
    )
    expect(objectInfo).toHaveBeenCalledTimes(2)

    expect(await slice.getState().loadComfyNodeTypes(undefined, newWorkflow)).toEqual(
      comfyNodeTypesFromObjectInfo(OBJECT_INFO_WITH_NEW_NODE),
    )
    expect(await slice.getState().loadComfyNodeTypes()).toEqual(comfyNodeTypesFromObjectInfo(OBJECT_INFO_WITH_NEW_NODE))
    expect(objectInfo).toHaveBeenCalledTimes(2)
  })

  it('fetches only once on a cold cache even when the workflow is given', async () => {
    const { slice, objectInfo } = createHarness({ objectInfo: async () => structuredClone(OBJECT_INFO_WITH_NEW_NODE) })
    const newWorkflow: ComfyWorkflow = {
      '30': { class_type: 'BrandNewNode', _meta: { title: 'New' }, inputs: { images: ['8', 0] } },
    }
    expect(await slice.getState().loadComfyNodeTypes(undefined, newWorkflow)).toEqual(
      comfyNodeTypesFromObjectInfo(OBJECT_INFO_WITH_NEW_NODE),
    )
    expect(objectInfo).toHaveBeenCalledTimes(1)
  })

  it('returns undefined on a rejected request and does not cache the failure', async () => {
    let call = 0
    const { slice, objectInfo } = createHarness({
      objectInfo: async () => {
        call += 1
        if (call === 1) throw new Error('server down')
        return structuredClone(OBJECT_INFO)
      },
    })
    expect(await slice.getState().loadComfyNodeTypes()).toBeUndefined()
    expect(await slice.getState().loadComfyNodeTypes()).toEqual(comfyNodeTypesFromObjectInfo(OBJECT_INFO))
    expect(objectInfo).toHaveBeenCalledTimes(2)
  })

  it('returns undefined when getObjectInfo throws synchronously, and retries later', async () => {
    let call = 0
    const { slice, objectInfo } = createHarness({
      objectInfo: (() => {
        call += 1
        if (call === 1) throw new Error('boom')
        return Promise.resolve(structuredClone(OBJECT_INFO))
      }) as ObjectInfoImpl,
    })
    expect(await slice.getState().loadComfyNodeTypes()).toBeUndefined()
    expect(await slice.getState().loadComfyNodeTypes()).toEqual(comfyNodeTypesFromObjectInfo(OBJECT_INFO))
    expect(objectInfo).toHaveBeenCalledTimes(2)
  })

  it('returns undefined when the client has no getObjectInfo', async () => {
    const { slice } = createHarness({ withoutObjectInfo: true })
    expect(await slice.getState().loadComfyNodeTypes()).toBeUndefined()
    expect(await slice.getState().loadComfyNodeTypes('endpoint_local')).toBeUndefined()
  })
})

describe('ComfyUI node types in the store: saveFunctionWorkflow', () => {
  const originalWorkflow = (): ComfyWorkflow => ({
    '3': { class_type: 'KSampler', _meta: { title: 'Sampler' }, inputs: { seed: 1, steps: 20 } },
    '8': { class_type: 'VAEDecode', _meta: { title: 'Decode' }, inputs: { samples: ['3', 0] } },
    '9': { class_type: 'SaveImage', _meta: { title: 'Save' }, inputs: { images: ['8', 0], filename_prefix: 'x' } },
  })

  const editedWorkflow = (): ComfyWorkflow => ({
    ...originalWorkflow(),
    '12': { class_type: 'MyFancySaver', _meta: { title: 'Fancy' }, inputs: { pixels: ['8', 0] } },
  })

  const renderOutput: FunctionOutputDef = {
    key: 'render',
    label: 'Render',
    type: 'image',
    bind: { nodeId: '9', nodeTitle: 'Save' },
    extract: { source: 'history', multiple: true },
  }

  const uiJson: ComfyUiWorkflow = { last_node_id: 12, nodes: [], links: [], version: 0.4 }

  const setup = (options: HarnessOptions = {}) => {
    const harness = createHarness(options)
    const functionId = harness.slice.getState().addFunctionFromWorkflow('Edit Me', originalWorkflow())
    harness.slice.getState().updateFunction(functionId, { outputs: [structuredClone(renderOutput)] })
    return { ...harness, functionId }
  }

  it('saves the workflow, merges outputs with typed inference and records the inference', async () => {
    const { slice, functionId, calledBaseUrls } = setup()
    const before = slice.getState().project.functions[functionId]!
    const editor: ComfyWorkflowEditorMetadata = { kind: 'comfyui_embedded', endpointId: 'endpoint_local', savedAt: NOW }

    await slice.getState().saveFunctionWorkflow(functionId, { rawJson: editedWorkflow(), uiJson, editor })

    const after = slice.getState().project.functions[functionId]!
    expect(after.workflow).toEqual({ ...before.workflow, rawJson: editedWorkflow(), uiJson, editor })
    expect(after.outputs).toEqual([
      renderOutput,
      {
        key: 'image_2',
        label: 'Image 2',
        type: 'image',
        bind: { nodeId: '12', nodeTitle: 'Fancy' },
        extract: { source: 'history', multiple: true },
      },
    ])
    expect(after.outputInference).toBe('node_types')
    expect(after.id).toBe(functionId)
    expect(after.name).toBe(before.name)
    expect(calledBaseUrls()).toEqual([DEFAULT_BASE_URL])
  })

  it("loads node types from the editor's endpoint", async () => {
    const { slice, functionId, calledBaseUrls } = setup({
      // The remote server does not know MyFancySaver.
      objectInfo: async (endpoint) => {
        if (endpoint.baseUrl !== 'http://10.0.0.2:8188') return structuredClone(OBJECT_INFO)
        const { MyFancySaver: _omitted, ...rest } = OBJECT_INFO
        void _omitted
        return structuredClone(rest)
      },
    })
    const remoteId = slice.getState().addEndpoint({ name: 'Remote', baseUrl: 'http://10.0.0.2:8188', enabled: true })
    const editor: ComfyWorkflowEditorMetadata = { kind: 'comfyui_browser', endpointId: remoteId, savedAt: NOW }

    await slice.getState().saveFunctionWorkflow(functionId, { rawJson: editedWorkflow(), uiJson, editor })

    // Whether a cold fetch that still lacks a workflow class is retried at once is not pinned by the contract,
    // so only the endpoint choice is checked here.
    expect(calledBaseUrls().length).toBeGreaterThan(0)
    expect(new Set(calledBaseUrls())).toEqual(new Set(['http://10.0.0.2:8188']))
    const after = slice.getState().project.functions[functionId]!
    // MyFancySaver is unknown on that server, so names decide for it and it is not recognized.
    expect(after.outputs).toEqual([renderOutput])
    expect(after.outputInference).toBe('node_names')
  })

  it('falls back to name inference when node types cannot be loaded', async () => {
    const { slice, functionId } = setup({
      objectInfo: async () => {
        throw new Error('offline')
      },
    })
    const editor: ComfyWorkflowEditorMetadata = { kind: 'comfyui_embedded', endpointId: 'endpoint_local', savedAt: NOW }

    await slice.getState().saveFunctionWorkflow(functionId, { rawJson: editedWorkflow(), uiJson, editor })

    const after = slice.getState().project.functions[functionId]!
    expect(after.workflow.rawJson).toEqual(editedWorkflow())
    expect(after.outputs).toEqual([renderOutput])
    expect(after.outputInference).toBe('node_names')
  })

  it('replaces a legacy fallback output with the inferred outputs', async () => {
    const { slice } = createHarness()
    const functionId = slice.getState().addFunctionFromWorkflow('Legacy', fancyWorkflow())
    expect(slice.getState().project.functions[functionId]!.outputs).toEqual([LEGACY_FALLBACK])

    await slice.getState().saveFunctionWorkflow(functionId, {
      rawJson: fancyWorkflow(),
      editor: { kind: 'comfyui_embedded', endpointId: 'endpoint_local', savedAt: NOW },
    })

    const after = slice.getState().project.functions[functionId]!
    expect(after.outputs).toEqual([
      {
        key: 'image',
        label: 'Image',
        type: 'image',
        bind: { nodeId: '12', nodeTitle: 'Fancy' },
        extract: { source: 'history', multiple: true },
      },
    ])
    expect(after.outputInference).toBe('node_types')
  })

  it('is a no-op for an unknown function', async () => {
    const { slice } = createHarness()
    const before = slice.getState().project
    await slice.getState().saveFunctionWorkflow('no_such_function', { rawJson: editedWorkflow() })
    expect(slice.getState().project).toEqual(before)
    expect(slice.getState().project.functions.no_such_function).toBeUndefined()
  })

  it('is a no-op for a built-in function', async () => {
    const { slice } = createHarness()
    const before = slice.getState().project.functions[LOCAL_TEXT_TRIM_FUNCTION_ID]
    await slice.getState().saveFunctionWorkflow(LOCAL_TEXT_TRIM_FUNCTION_ID, { rawJson: editedWorkflow() })
    expect(slice.getState().project.functions[LOCAL_TEXT_TRIM_FUNCTION_ID]).toEqual(before)
  })
})
