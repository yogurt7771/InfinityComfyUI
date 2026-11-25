import { describe, expect, it, vi } from 'vitest'
import { createProjectSlice } from './projectStore'
import { createGenerationFunctionFromWorkflow } from '../domain/workflow'
import type { ComfyWorkflow, GenerationFunction, MediaResourceValue } from '../domain/types'

const NOW = '2026-05-08T09:00:00.000Z'

const previewOnlyWorkflow = (): ComfyWorkflow => ({
  '3': { class_type: 'KSampler', _meta: { title: 'Sampler' }, inputs: { seed: 1, steps: 20 } },
  '20': { class_type: 'PreviewImage', _meta: { title: 'Preview Image' }, inputs: { images: ['3', 0] } },
})

const createSlice = () => {
  let nextId = 0
  const viewFile = vi.fn(async () => new Blob(['preview-bytes'], { type: 'image/png' }))
  const slice = createProjectSlice({
    idFactory: () => `gen_${(nextId += 1)}`,
    now: () => NOW,
    randomInt: () => 42,
    createComfyClient: () => ({
      queuePrompt: async () => ({ prompt_id: 'prompt_1', number: 1 }),
      getHistory: async () => ({
        prompt_1: {
          outputs: { '20': { images: [{ filename: 'ComfyUI_temp_00001_.png', subfolder: '', type: 'temp' }] } },
        },
      }),
      viewFile,
    }),
    comfyRunOptions: { maxPollAttempts: 1, pollIntervalMs: 1 },
  })
  return { slice, viewFile }
}

const withEndpoint = (fn: GenerationFunction, endpointId: string): GenerationFunction => ({
  ...fn,
  workflow: { ...fn.workflow, editor: { kind: 'comfyui_embedded', endpointId, savedAt: NOW } },
})

const runAndExpectImage = async (
  slice: ReturnType<typeof createProjectSlice>,
  fn: GenerationFunction,
) => {
  await slice.getState().runTemporaryFunctionAtPosition(fn, {}, { x: 0, y: 0 }, 1)

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const tasks = Object.values(slice.getState().project.tasks)
    if (tasks.some((task) => task.status === 'succeeded' || task.status === 'failed')) break
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  const { project } = slice.getState()
  expect(Object.values(project.tasks)).toEqual([expect.objectContaining({ status: 'succeeded' })])

  const images = Object.values(project.resources).filter((resource) => resource.type === 'image')
  expect(images).toHaveLength(1)
  expect((images[0]!.value as MediaResourceValue).url).toMatch(/^data:image\//)

  expect(
    project.canvas.nodes.filter((node) => node.type === 'resource' && node.data.resourceType === 'image'),
  ).toHaveLength(1)
}

describe('ComfyUI image outputs at run time', () => {
  it('turns a PreviewImage-only temporary workflow into an image resource', async () => {
    const { slice, viewFile } = createSlice()
    const endpointId = slice.getState().project.comfy.endpoints[0]!.id
    const fn = withEndpoint(
      createGenerationFunctionFromWorkflow('temp_comfy_1', 'Preview Only', previewOnlyWorkflow(), NOW),
      endpointId,
    )

    await runAndExpectImage(slice, fn)
    expect(viewFile).toHaveBeenCalled()
  })

  it('repairs a legacy text-fallback function at run time and produces an image resource', async () => {
    const { slice } = createSlice()
    const endpointId = slice.getState().project.comfy.endpoints[0]!.id
    const built = createGenerationFunctionFromWorkflow('temp_comfy_2', 'Legacy Preview', previewOnlyWorkflow(), NOW)
    const legacy = withEndpoint(
      {
        ...built,
        outputs: [
          {
            key: 'result',
            label: 'Result',
            type: 'text',
            bind: { nodeTitle: 'Result' },
            extract: { source: 'history', multiple: true },
          },
        ],
      },
      endpointId,
    )

    await runAndExpectImage(slice, legacy)
  })
})
