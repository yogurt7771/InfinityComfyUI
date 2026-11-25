import { describe, expect, it, vi } from 'vitest'
import { createProjectSlice } from './projectStore'
import { comfyNodeTypesFromObjectInfo } from '../domain/comfyNodeTypes'
import type {
  ComfyWorkflow,
  ComfyWorkflowEditorMetadata,
  FunctionOutputDef,
  MediaResourceValue,
} from '../domain/types'

// Black-box tests for contract v3 sections 2-3: the store uses exactly `functionDef.outputs` when running, and
// saveFunctionWorkflow merges with the previous rawJson so only new output nodes are added.

const NOW = '2026-05-08T09:00:00.000Z'

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
    input: { required: { images: ['IMAGE'], filename_prefix: ['STRING', { default: 'ComfyUI' }] } },
    output: [],
    output_node: true,
  },
  PreviewImage: {
    input: { required: { images: ['IMAGE'] } },
    output: [],
    output_node: true,
  },
}

const SAVE_FILE = 'save_00001_.png'
const PREVIEW_FILE = 'preview_00001_.png'
const NEW_SAVE_FILE = 'new_save_00001_.png'

const HISTORY_BOTH = {
  '9': { images: [{ filename: SAVE_FILE, subfolder: '', type: 'output' }] },
  '12': { images: [{ filename: PREVIEW_FILE, subfolder: '', type: 'temp' }] },
}

const imageOutput = (key: string, label: string, nodeId: string, nodeTitle: string): FunctionOutputDef => ({
  key,
  label,
  type: 'image',
  bind: { nodeId, nodeTitle },
  extract: { source: 'history', multiple: true },
})

/** SaveImage (9) + PreviewImage (12). */
const savePreviewWorkflow = (): ComfyWorkflow => ({
  '3': { class_type: 'KSampler', _meta: { title: 'Sampler' }, inputs: { seed: 1, steps: 20 } },
  '8': { class_type: 'VAEDecode', _meta: { title: 'Decode' }, inputs: { samples: ['3', 0] } },
  '9': { class_type: 'SaveImage', _meta: { title: 'Save' }, inputs: { images: ['8', 0], filename_prefix: 'x' } },
  '12': { class_type: 'PreviewImage', _meta: { title: 'Preview' }, inputs: { images: ['8', 0] } },
})

/** Same as above plus a new SaveImage (15). */
const withNewSave = (): ComfyWorkflow => ({
  ...savePreviewWorkflow(),
  '15': { class_type: 'SaveImage', _meta: { title: 'New Save' }, inputs: { images: ['8', 0], filename_prefix: 'y' } },
})

/** Node 9 deleted. */
const withoutSave = (): ComfyWorkflow => {
  const { '9': _deleted, ...rest } = savePreviewWorkflow()
  void _deleted
  return rest
}

const blobFor = () => new Blob(['image-bytes'], { type: 'image/png' })

const createHarness = (initialHistory: Record<string, unknown> = HISTORY_BOTH) => {
  let nextId = 0
  let historyOutputs = initialHistory
  const setHistory = (next: Record<string, unknown>) => {
    historyOutputs = next
  }
  const objectInfo = vi.fn(async () => structuredClone(OBJECT_INFO))
  const viewFile = vi.fn(async () => blobFor())
  const slice = createProjectSlice({
    idFactory: () => `gen_${(nextId += 1)}`,
    now: () => NOW,
    randomInt: () => 42,
    createComfyClient: () => ({
      queuePrompt: async () => ({ prompt_id: 'prompt_1', number: 1 }),
      getHistory: async () => ({ prompt_1: { outputs: historyOutputs } }),
      viewFile,
      getObjectInfo: () => objectInfo(),
    }),
    comfyRunOptions: { maxPollAttempts: 1, pollIntervalMs: 1 },
  })
  return { slice, objectInfo, viewFile, setHistory }
}

type Slice = ReturnType<typeof createProjectSlice>

const waitForTasksToSettle = async (slice: Slice) => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const tasks = Object.values(slice.getState().project.tasks)
    if (tasks.length > 0 && tasks.every((task) => ['succeeded', 'failed', 'canceled'].includes(task.status))) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const mediaFilename = (value: unknown) => {
  const media = value as MediaResourceValue
  return media.comfy?.filename ?? media.filename
}

const editorFor = (): ComfyWorkflowEditorMetadata => ({ kind: 'comfyui_embedded', endpointId: 'endpoint_local', savedAt: NOW })

const createSavePreviewFunction = (slice: Slice) =>
  slice.getState().addFunctionFromWorkflow('Save + Preview', savePreviewWorkflow(), {
    nodeTypes: comfyNodeTypesFromObjectInfo(OBJECT_INFO),
  })

// ---------------------------------------------------------------------------------------------------------------
describe('output slots in the store: default selection', () => {
  it('enables both SaveImage (9) and PreviewImage (12) for a new function built with node types', () => {
    const { slice } = createHarness()
    const functionId = createSavePreviewFunction(slice)
    const fn = slice.getState().project.functions[functionId]!
    expect(fn.outputs).toEqual([imageOutput('image', 'Image', '9', 'Save'), imageOutput('image_2', 'Image 2', '12', 'Preview')])
    expect(fn.outputInference).toBe('node_types')
  })

  it('enables both SaveImage and PreviewImage for a new function built from names only', () => {
    const { slice } = createHarness()
    const functionId = slice.getState().addFunctionFromWorkflow('Save + Preview', savePreviewWorkflow())
    const fn = slice.getState().project.functions[functionId]!
    expect(fn.outputs).toEqual([imageOutput('image', 'Image', '9', 'Save'), imageOutput('image_2', 'Image 2', '12', 'Preview')])
    expect(fn.outputInference).toBe('node_names')
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('output slots in the store: running uses exactly functionDef.outputs (2, 3)', () => {
  it('produces one image resource per enabled output when both are enabled', async () => {
    const { slice } = createHarness()
    const functionId = createSavePreviewFunction(slice)

    await slice.getState().runFunctionAtPosition(functionId, {}, { x: 0, y: 0 }, 1)
    await waitForTasksToSettle(slice)

    const { project } = slice.getState()
    expect(Object.values(project.tasks)).toEqual([expect.objectContaining({ status: 'succeeded' })])
    const images = Object.values(project.resources).filter((resource) => resource.type === 'image')
    expect(images.map((resource) => mediaFilename(resource.value)).sort()).toEqual([PREVIEW_FILE, SAVE_FILE].sort())
  })

  it('produces no resource and no canvas node for a disabled output node, even when history has files for it', async () => {
    const { slice } = createHarness()
    const functionId = createSavePreviewFunction(slice)
    const saveOutput = slice.getState().project.functions[functionId]!.outputs.find((output) => output.bind.nodeId === '9')!
    slice.getState().updateFunction(functionId, { outputs: [structuredClone(saveOutput)] })
    expect(slice.getState().project.functions[functionId]!.outputs).toEqual([saveOutput])

    await slice.getState().runFunctionAtPosition(functionId, {}, { x: 0, y: 0 }, 1)
    await waitForTasksToSettle(slice)

    const { project } = slice.getState()
    const tasks = Object.values(project.tasks)
    expect(tasks).toEqual([expect.objectContaining({ status: 'succeeded' })])

    const resources = Object.values(project.resources)
    expect(resources.filter((resource) => resource.source.kind === 'function_output')).toHaveLength(1)
    const images = resources.filter((resource) => resource.type === 'image')
    expect(images).toHaveLength(1)
    expect(mediaFilename(images[0]!.value)).toBe(SAVE_FILE)
    expect(images[0]!.source.outputKey).toBe(saveOutput.key)
    expect(resources.some((resource) => resource.type !== 'image' && resource.source.kind === 'function_output')).toBe(false)

    const resourceNodes = project.canvas.nodes.filter((canvasNode) => canvasNode.type === 'resource')
    expect(resourceNodes).toHaveLength(1)
    expect(resourceNodes[0]!.data.resourceId).toBe(images[0]!.id)

    const refs = Object.values(tasks[0]!.outputRefs).flat()
    expect(refs).toEqual([{ resourceId: images[0]!.id, type: 'image' }])
  })

  it('does the same for a temporary function whose outputs leave the preview out', async () => {
    const { slice } = createHarness()
    const functionId = createSavePreviewFunction(slice)
    const saved = slice.getState().project.functions[functionId]!
    const temporary = {
      ...saved,
      id: 'temp_slots_1',
      outputs: saved.outputs.filter((output) => output.bind.nodeId === '9'),
      workflow: { ...saved.workflow, editor: editorFor() },
    }

    await slice.getState().runTemporaryFunctionAtPosition(temporary, {}, { x: 0, y: 0 }, 1)
    await waitForTasksToSettle(slice)

    const images = Object.values(slice.getState().project.resources).filter((resource) => resource.type === 'image')
    expect(images.map((resource) => mediaFilename(resource.value))).toEqual([SAVE_FILE])
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('output slots in the store: saveFunctionWorkflow (2, 3)', () => {
  /** Function from save+preview, then the user disables 12 and relabels/retypes 9. */
  const userEdited9: FunctionOutputDef = {
    key: 'render',
    label: 'My Render',
    type: 'video',
    bind: { nodeId: '9', nodeTitle: 'Save' },
    extract: { source: 'history', multiple: false, index: 0 },
  }

  const setupEdited = () => {
    const harness = createHarness()
    const functionId = createSavePreviewFunction(harness.slice)
    harness.slice.getState().updateFunction(functionId, { outputs: [structuredClone(userEdited9)] })
    return { ...harness, functionId }
  }

  it("keeps the user's output unchanged, leaves 12 disabled and adds the new SaveImage 15", async () => {
    const { slice, functionId } = setupEdited()

    await slice.getState().saveFunctionWorkflow(functionId, { rawJson: withNewSave(), editor: editorFor() })

    const after = slice.getState().project.functions[functionId]!
    expect(after.workflow.rawJson).toEqual(withNewSave())
    expect(after.outputs).toEqual([
      userEdited9,
      // Inferred for the new workflow: 9 image, 12 image_2, 15 image_3; 15's key does not collide, so it is kept.
      imageOutput('image_3', 'Image 3', '15', 'New Save'),
    ])
    expect(after.outputs.some((output) => output.bind.nodeId === '12')).toBe(false)
    expect(after.outputInference).toBe('node_types')
  })

  it('adds nothing when the saved workflow has no new nodes', async () => {
    const { slice, functionId } = setupEdited()

    await slice.getState().saveFunctionWorkflow(functionId, { rawJson: savePreviewWorkflow(), editor: editorFor() })

    expect(slice.getState().project.functions[functionId]!.outputs).toEqual([userEdited9])
  })

  it('drops the output of a deleted node', async () => {
    const { slice } = createHarness()
    const functionId = createSavePreviewFunction(slice)
    const before = slice.getState().project.functions[functionId]!.outputs
    const previewOutput = before.find((output) => output.bind.nodeId === '12')!

    await slice.getState().saveFunctionWorkflow(functionId, { rawJson: withoutSave(), editor: editorFor() })

    const after = slice.getState().project.functions[functionId]!
    expect(after.outputs).toEqual([previewOutput])
    expect(after.outputs.some((output) => output.bind.nodeId === '9')).toBe(false)
  })

  it("drops the user's retyped output when its node is deleted, and still adds a new node", async () => {
    const { slice, functionId } = setupEdited()
    const { '9': _deleted, ...rest } = withNewSave()
    void _deleted

    await slice.getState().saveFunctionWorkflow(functionId, { rawJson: rest, editor: editorFor() })

    expect(slice.getState().project.functions[functionId]!.outputs).toEqual([
      imageOutput('image_2', 'Image 2', '15', 'New Save'),
    ])
  })

  it('compares against the rawJson from the most recent save, so an output disabled after a save stays disabled', async () => {
    const { slice, functionId } = setupEdited()
    await slice.getState().saveFunctionWorkflow(functionId, { rawJson: withNewSave(), editor: editorFor() })
    // The user now disables the newly added 15 again.
    slice.getState().updateFunction(functionId, { outputs: [structuredClone(userEdited9)] })

    await slice.getState().saveFunctionWorkflow(functionId, { rawJson: withNewSave(), editor: editorFor() })

    expect(slice.getState().project.functions[functionId]!.outputs).toEqual([userEdited9])
  })

  it('replaces the legacy fallback with the inferred default selection (both save and preview)', async () => {
    const { slice } = createHarness()
    const functionId = slice.getState().addFunctionFromWorkflow('Legacy', savePreviewWorkflow())
    slice.getState().updateFunction(functionId, { outputs: [structuredClone(LEGACY_FALLBACK)] })

    await slice.getState().saveFunctionWorkflow(functionId, { rawJson: savePreviewWorkflow(), editor: editorFor() })

    const after = slice.getState().project.functions[functionId]!
    expect(after.outputs).toEqual([imageOutput('image', 'Image', '9', 'Save'), imageOutput('image_2', 'Image 2', '12', 'Preview')])
    expect(after.outputInference).toBe('node_types')
  })

  it('replaces an empty output list with the inferred default selection', async () => {
    const { slice } = createHarness()
    const functionId = createSavePreviewFunction(slice)
    slice.getState().updateFunction(functionId, { outputs: [] })

    await slice.getState().saveFunctionWorkflow(functionId, { rawJson: withNewSave(), editor: editorFor() })

    expect(slice.getState().project.functions[functionId]!.outputs).toEqual([
      imageOutput('image', 'Image', '9', 'Save'),
      imageOutput('image_2', 'Image 2', '12', 'Preview'),
      imageOutput('image_3', 'Image 3', '15', 'New Save'),
    ])
  })

  it('runs only the merged outputs after a save', async () => {
    const { slice, functionId, setHistory } = setupEdited()
    // Make the user's 9 output an image again so the run is easy to read.
    slice.getState().updateFunction(functionId, { outputs: [imageOutput('render', 'Render', '9', 'Save')] })
    await slice.getState().saveFunctionWorkflow(functionId, { rawJson: withNewSave(), editor: editorFor() })
    expect(slice.getState().project.functions[functionId]!.outputs.map((output) => output.bind.nodeId)).toEqual(['9', '15'])

    setHistory({
      ...HISTORY_BOTH,
      '15': { images: [{ filename: NEW_SAVE_FILE, subfolder: '', type: 'output' }] },
    })
    await slice.getState().runFunctionAtPosition(functionId, {}, { x: 0, y: 0 }, 1)
    await waitForTasksToSettle(slice)

    const images = Object.values(slice.getState().project.resources).filter((resource) => resource.type === 'image')
    expect(images.map((resource) => mediaFilename(resource.value)).sort()).toEqual([NEW_SAVE_FILE, SAVE_FILE].sort())
  })
})
