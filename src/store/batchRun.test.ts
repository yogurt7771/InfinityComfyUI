import { describe, expect, it, vi } from 'vitest'
import { createProjectSlice } from './projectStore'
import type { FunctionInputDef, FunctionOutputDef, ProjectState } from '../domain/types'

const waitForState = async (
  slice: ReturnType<typeof createProjectSlice>,
  predicate: (state: ProjectState) => boolean,
) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate(slice.getState().project)) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Timed out waiting for project store state')
}

const batchWorkflow = () => ({
  '3': {
    class_type: 'KSampler',
    _meta: { title: 'Sampler' },
    inputs: { seed: 0, steps: 20 },
  },
  '6': {
    class_type: 'CLIPTextEncode',
    _meta: { title: 'Prompt' },
    inputs: { text: 'default prompt' },
  },
  '76': {
    class_type: 'LoadImage',
    _meta: { title: 'Load Image' },
    inputs: { image: 'old.png' },
  },
  '20': {
    class_type: 'SaveImage',
    _meta: { title: 'Result_Image' },
    inputs: { filename_prefix: 'infinity-comfyui' },
  },
})

const batchInputs: FunctionInputDef[] = [
  {
    key: 'prompt',
    label: 'Prompt',
    type: 'text',
    required: true,
    defaultValue: 'default prompt',
    bind: { nodeId: '6', nodeTitle: 'Prompt', path: 'inputs.text' },
    upload: { strategy: 'none' },
  },
  {
    key: 'image',
    label: 'Image',
    type: 'image',
    required: true,
    bind: { nodeId: '76', nodeTitle: 'Load Image', path: 'inputs.image' },
    upload: { strategy: 'none' },
  },
]

const batchOutputs: FunctionOutputDef[] = [
  {
    key: 'image',
    label: 'Result',
    type: 'image',
    bind: { nodeTitle: 'Result_Image' },
    extract: { source: 'history', multiple: true },
  },
]

const templateImageDataUrl = `data:image/png;base64,${btoa('template-image-bytes')}`

const setupBatchSourceTask = async (slice: ReturnType<typeof createProjectSlice>) => {
  const functionId = slice.getState().addFunctionFromWorkflow('Batch Template', batchWorkflow())
  slice.setState((state) => ({
    project: {
      ...state.project,
      functions: {
        ...state.project.functions,
        [functionId]: {
          ...state.project.functions[functionId]!,
          inputs: batchInputs,
          outputs: batchOutputs,
        },
      },
      resources: {
        ...state.project.resources,
        res_template_image: {
          id: 'res_template_image',
          type: 'image',
          name: 'Template Image',
          value: {
            assetId: 'asset_template_image',
            url: templateImageDataUrl,
            filename: 'template.png',
            mimeType: 'image/png',
            sizeBytes: 20,
          },
          source: { kind: 'user_upload' },
          metadata: { createdAt: '2026-05-08T09:00:00.000Z' },
        },
      },
    },
  }))
  slice.getState().addTextResource('Prompt', 'template prompt')
  slice.getState().addFunctionNode(functionId)
  const functionNode = slice
    .getState()
    .project.canvas.nodes.find((node) => node.type === 'function' && node.data.functionId === functionId)!
  const promptResource = Object.values(slice.getState().project.resources).find(
    (resource) => resource.type === 'text' && resource.value === 'template prompt',
  )!
  slice.setState((state) => ({
    project: {
      ...state.project,
      canvas: {
        ...state.project.canvas,
        nodes: state.project.canvas.nodes.map((node) =>
          node.id === functionNode.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  inputValues: {
                    prompt: { resourceId: promptResource.id, type: 'text' },
                    image: { resourceId: 'res_template_image', type: 'image' },
                  },
                },
              }
            : node,
        ),
      },
    },
  }))
  await slice.getState().runFunctionNodeWithComfy(functionNode.id, 1)
  const sourceTask = Object.values(slice.getState().project.tasks).find((task) => !task.batchId)
  if (!sourceTask) throw new Error('Source task was not created')
  return { functionId, sourceTask }
}

const batchGroups = (stems: string[]) =>
  stems.map((stem) => ({
    stem,
    files: {
      image: new File([`image-bytes-${stem}`], `${stem}.png`, { type: 'image/png' }),
      prompt: new File([`prompt ${stem}`], `${stem}.txt`, { type: 'text/plain' }),
    },
  }))

const createBatchClientMocks = (queuedWorkflows: unknown[]) => ({
  uploadImage: vi.fn(async (file: File, _options?: { subfolder?: string; overwrite?: boolean }) => ({ name: file.name, subfolder: 'infinity-comfyui', type: 'input' })),
  queuePrompt: vi.fn(async (workflow: unknown) => {
    queuedWorkflows.push(workflow)
    return { prompt_id: `prompt_${queuedWorkflows.length}`, number: queuedWorkflows.length }
  }),
  getHistory: vi.fn(async (promptId: string) => ({
    [promptId]: {
      outputs: {
        '20': {
          images: [{ filename: `render-${promptId}.png`, subfolder: 'renders', type: 'output' }],
        },
      },
    },
  })),
  viewFile: vi.fn(async (file: { filename: string }) => new Blob([`${file.filename}-bytes`], { type: 'image/png' })),
})

describe('batch run', () => {
  it('enqueues one task per file group with a shared batchId and replaced inputs', async () => {
    const queuedWorkflows: unknown[] = []
    const clientMocks = createBatchClientMocks(queuedWorkflows)
    const slice = createProjectSlice({
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => 42,
      createComfyClient: () => clientMocks,
      comfyRunOptions: { maxPollAttempts: 1, pollIntervalMs: 1 },
    })
    const { sourceTask } = await setupBatchSourceTask(slice)
    const resourceNodeCountBefore = slice
      .getState()
      .project.canvas.nodes.filter((node) => node.type === 'resource').length

    const batchId = await slice
      .getState()
      .startBatchRunFromResult(sourceTask.id, { groups: batchGroups(['a', 'b', 'c']), seedMode: 'random' })
    expect(batchId).toBeDefined()

    await waitForState(slice, (project) => project.batches?.[batchId!]?.status === 'completed')

    const project = slice.getState().project
    const batch = project.batches![batchId!]!
    expect(batch.items.map((item) => item.stem)).toEqual(['a', 'b', 'c'])
    expect(batch.items.every((item) => item.status === 'succeeded')).toBe(true)
    expect(batch.bindings).toEqual([
      { inputKey: 'prompt', kind: 'text' },
      { inputKey: 'image', kind: 'file' },
    ])

    const batchTasks = Object.values(project.tasks).filter((task) => task.batchId === batchId)
    expect(batchTasks).toHaveLength(3)
    for (const task of batchTasks) {
      const snapshot = task.inputValuesSnapshot ?? {}
      expect(snapshot.prompt?.value).toMatch(/^prompt [abc]$/)
      expect(snapshot.image?.source).toBe('resource')
      expect(task.functionSnapshot?.inputs.find((input) => input.key === 'image')?.upload).toEqual({
        strategy: 'comfy_upload',
        targetSubfolder: 'infinity-comfyui',
      })
      expect(task.outputRefs.image).toHaveLength(1)
    }

    // 每组都通过 comfy_upload 上传，且不覆盖同名文件
    expect(clientMocks.uploadImage).toHaveBeenCalledTimes(3)
    for (const call of clientMocks.uploadImage.mock.calls) {
      expect(call[1]).toEqual({ subfolder: 'infinity-comfyui', overwrite: false })
      expect((call[0] as File).name).toMatch(/^[abc]-[0-9a-f]{8}\.png$/)
    }

    const batchQueuedWorkflows = queuedWorkflows.slice(1) as Record<string, { inputs: Record<string, unknown> }>[]
    expect(batchQueuedWorkflows).toHaveLength(3)
    const prompts = batchQueuedWorkflows.map((workflow) => workflow['6']!.inputs.text).sort()
    expect(prompts).toEqual(['prompt a', 'prompt b', 'prompt c'])
    for (const workflow of batchQueuedWorkflows) {
      expect(String(workflow['76']!.inputs.image)).toMatch(/^infinity-comfyui\/[abc]-[0-9a-f]{8}\.png$/)
    }

    // 批量结果不在画布上生成资源节点
    const resourceNodeCountAfter = slice
      .getState()
      .project.canvas.nodes.filter((node) => node.type === 'resource').length
    expect(resourceNodeCountAfter).toBe(resourceNodeCountBefore)

    // 批量结果节点带 batchHidden 标记
    const batchResultNodes = slice
      .getState()
      .project.canvas.nodes.filter((node) => node.type === 'result_group' && node.data.batchId === batchId)
    expect(batchResultNodes).toHaveLength(3)
    expect(batchResultNodes.every((node) => node.data.batchHidden === true)).toBe(true)
  })

  it('lays out batch input and output resources on canvas in rows', async () => {
    const queuedWorkflows: unknown[] = []
    const clientMocks = createBatchClientMocks(queuedWorkflows)
    const slice = createProjectSlice({
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => 42,
      createComfyClient: () => clientMocks,
      comfyRunOptions: { maxPollAttempts: 1, pollIntervalMs: 1 },
    })
    const { sourceTask } = await setupBatchSourceTask(slice)

    const batchId = await slice
      .getState()
      .startBatchRunFromResult(sourceTask.id, { groups: batchGroups(['a', 'b']), seedMode: 'random' })
    await waitForState(slice, (project) => project.batches?.[batchId!]?.status === 'completed')

    const resourceNodeCountBefore = slice
      .getState()
      .project.canvas.nodes.filter((node) => node.type === 'resource').length

    slice.getState().revealBatchOnCanvas(batchId!)

    const project = slice.getState().project
    const batch = project.batches![batchId!]!
    // 每项 1 个输入资源（image；text 绑定直接内联为字符串值，不产生资源）和 1 个输出，共 2 项
    const resourceNodes = project.canvas.nodes.filter((node) => node.type === 'resource')
    expect(resourceNodes).toHaveLength(resourceNodeCountBefore + 4)

    let previousRowY = Number.NEGATIVE_INFINITY
    for (const item of batch.items) {
      const task = project.tasks[item.taskId]!
      const inputResourceIds = Object.values(task.inputRefs)
        .filter((ref) => 'resourceId' in ref)
        .map((ref) => ref.resourceId)
      const inputNodes = resourceNodes.filter((node) => inputResourceIds.includes(String(node.data.resourceId)))
      expect(inputNodes).toHaveLength(1)
      const rowY = Math.min(...inputNodes.map((node) => node.position.y))
      expect(rowY).toBeGreaterThan(previousRowY)
      previousRowY = rowY

      const outputRef = task.outputRefs.image![0]!
      const outputNode = resourceNodes.find((node) => node.data.resourceId === outputRef.resourceId)
      expect(outputNode).toBeDefined()
      // 输出列在输入列右侧，且与输入同行
      expect(outputNode!.position.x).toBeGreaterThan(inputNodes[0]!.position.x)
      expect(outputNode!.position.y).toBe(rowY)
    }

    // 幂等：重复调用不再新增节点
    slice.getState().revealBatchOnCanvas(batchId!)
    expect(
      slice.getState().project.canvas.nodes.filter((node) => node.type === 'resource'),
    ).toHaveLength(resourceNodeCountBefore + 4)
  })

  it('applies one fixed seed to every group when seedMode is fixed', async () => {
    const queuedWorkflows: unknown[] = []
    const clientMocks = createBatchClientMocks(queuedWorkflows)
    let seedCounter = 100
    const slice = createProjectSlice({
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => (seedCounter += 1),
      createComfyClient: () => clientMocks,
      comfyRunOptions: { maxPollAttempts: 1, pollIntervalMs: 1 },
    })
    const { sourceTask } = await setupBatchSourceTask(slice)

    const fixedBatchId = await slice
      .getState()
      .startBatchRunFromResult(sourceTask.id, { groups: batchGroups(['f1', 'f2', 'f3']), seedMode: 'fixed' })
    await waitForState(slice, (project) => project.batches?.[fixedBatchId!]?.status === 'completed')

    const fixedWorkflows = queuedWorkflows.slice(1, 4) as Record<string, { inputs: Record<string, unknown> }>[]
    const fixedSeeds = fixedWorkflows.map((workflow) => workflow['3']!.inputs.seed)
    expect(new Set(fixedSeeds).size).toBe(1)

    const randomBatchId = await slice
      .getState()
      .startBatchRunFromResult(sourceTask.id, { groups: batchGroups(['r1', 'r2', 'r3']), seedMode: 'random' })
    await waitForState(slice, (project) => project.batches?.[randomBatchId!]?.status === 'completed')

    const randomWorkflows = queuedWorkflows.slice(4, 7) as Record<string, { inputs: Record<string, unknown> }>[]
    const randomSeeds = randomWorkflows.map((workflow) => workflow['3']!.inputs.seed)
    expect(new Set(randomSeeds).size).toBe(3)

    const fixedTasks = Object.values(slice.getState().project.tasks).filter((task) => task.batchId === fixedBatchId)
    expect(new Set(fixedTasks.map((task) => task.seedPatchLog.map((patch) => patch.newValue).join(','))).size).toBe(1)
  })

  it('cancels all queued and running batch items', async () => {
    let hangPrompts = false
    let releasePrompt: (() => void) | undefined
    const interrupt = vi.fn(async () => ({}))
    const slice = createProjectSlice({
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => 42,
      createComfyClient: () => ({
        uploadImage: vi.fn(async (file: File, _options?: { subfolder?: string; overwrite?: boolean }) => ({ name: file.name, subfolder: 'infinity-comfyui', type: 'input' })),
        queuePrompt: vi.fn(async () => {
          if (hangPrompts) {
            await new Promise<void>((resolve) => {
              releasePrompt = resolve
            })
          }
          return { prompt_id: 'prompt_x', number: 1 }
        }),
        getHistory: vi.fn(async () => ({})),
        interrupt,
      }),
      comfyRunOptions: { maxPollAttempts: 1, pollIntervalMs: 1 },
    })
    const { sourceTask } = await setupBatchSourceTask(slice)
    hangPrompts = true

    const batchId = await slice
      .getState()
      .startBatchRunFromResult(sourceTask.id, { groups: batchGroups(['a', 'b', 'c']), seedMode: 'random' })
    await waitForState(slice, (project) =>
      Object.values(project.tasks).some((task) => task.batchId === batchId && task.status === 'running'),
    )

    slice.getState().cancelBatchRun(batchId!)

    const project = slice.getState().project
    const batch = project.batches![batchId!]!
    expect(batch.status).toBe('canceled')
    const batchTasks = Object.values(project.tasks).filter((task) => task.batchId === batchId)
    expect(batchTasks).toHaveLength(3)
    expect(batchTasks.every((task) => task.status === 'canceled')).toBe(true)
    expect(batch.items.every((item) => item.status === 'canceled')).toBe(true)
    expect(interrupt).toHaveBeenCalled()

    // 释放挂起的运行，任务状态保持 canceled 不被回写
    releasePrompt?.()
    await new Promise((resolve) => setTimeout(resolve, 20))
    const afterRelease = slice.getState().project
    expect(
      Object.values(afterRelease.tasks)
        .filter((task) => task.batchId === batchId)
        .every((task) => task.status === 'canceled'),
    ).toBe(true)
  })

  it('uploads video and audio inputs with hashed filenames when strategy is comfy_upload', async () => {
    const queuedWorkflows: unknown[] = []
    const uploadImage = vi.fn(async (file: File, _options?: { subfolder?: string; overwrite?: boolean }) => ({ name: file.name, subfolder: 'infinity-comfyui', type: 'input' }))
    const slice = createProjectSlice({
      now: () => '2026-05-08T09:00:00.000Z',
      randomInt: () => 42,
      createComfyClient: () => ({
        uploadImage,
        queuePrompt: vi.fn(async (workflow: unknown) => {
          queuedWorkflows.push(workflow)
          return { prompt_id: 'prompt_1', number: 1 }
        }),
        getHistory: vi.fn(async () => ({
          prompt_1: {
            outputs: {
              '20': { images: [{ filename: 'render.png', subfolder: 'renders', type: 'output' }] },
            },
          },
        })),
        viewFile: vi.fn(async () => new Blob(['render-bytes'], { type: 'image/png' })),
      }),
      comfyRunOptions: { maxPollAttempts: 1, pollIntervalMs: 1 },
    })

    const mediaInputs: FunctionInputDef[] = [
      {
        key: 'video',
        label: 'Video',
        type: 'video',
        required: true,
        bind: { nodeId: '77', nodeTitle: 'Load Video', path: 'inputs.video' },
        upload: { strategy: 'comfy_upload', targetSubfolder: 'infinity-comfyui' },
      },
      {
        key: 'audio',
        label: 'Audio',
        type: 'audio',
        required: true,
        bind: { nodeId: '78', nodeTitle: 'Load Audio', path: 'inputs.audio' },
        upload: { strategy: 'comfy_upload', targetSubfolder: 'infinity-comfyui' },
      },
    ]
    const workflow = {
      ...batchWorkflow(),
      '77': { class_type: 'LoadVideo', _meta: { title: 'Load Video' }, inputs: { video: 'old.mp4' } },
      '78': { class_type: 'LoadAudio', _meta: { title: 'Load Audio' }, inputs: { audio: 'old.wav' } },
    }
    const functionId = slice.getState().addFunctionFromWorkflow('Media Run', workflow)
    slice.setState((state) => ({
      project: {
        ...state.project,
        functions: {
          ...state.project.functions,
          [functionId]: { ...state.project.functions[functionId]!, inputs: mediaInputs, outputs: batchOutputs },
        },
        resources: {
          ...state.project.resources,
          res_video: {
            id: 'res_video',
            type: 'video',
            name: 'Clip',
            value: {
              assetId: 'asset_video',
              url: `data:video/mp4;base64,${btoa('video-bytes')}`,
              filename: 'clip.mp4',
              mimeType: 'video/mp4',
              sizeBytes: 11,
            },
            source: { kind: 'user_upload' },
            metadata: { createdAt: '2026-05-08T09:00:00.000Z' },
          },
          res_audio: {
            id: 'res_audio',
            type: 'audio',
            name: 'Voice',
            value: {
              assetId: 'asset_audio',
              url: `data:audio/wav;base64,${btoa('audio-bytes')}`,
              filename: 'voice.wav',
              mimeType: 'audio/wav',
              sizeBytes: 11,
            },
            source: { kind: 'user_upload' },
            metadata: { createdAt: '2026-05-08T09:00:00.000Z' },
          },
        },
      },
    }))
    slice.getState().addFunctionNode(functionId)
    const functionNode = slice
      .getState()
      .project.canvas.nodes.find((node) => node.type === 'function' && node.data.functionId === functionId)!
    slice.setState((state) => ({
      project: {
        ...state.project,
        canvas: {
          ...state.project.canvas,
          nodes: state.project.canvas.nodes.map((node) =>
            node.id === functionNode.id
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    inputValues: {
                      video: { resourceId: 'res_video', type: 'video' },
                      audio: { resourceId: 'res_audio', type: 'audio' },
                    },
                  },
                }
              : node,
          ),
        },
      },
    }))

    await slice.getState().runFunctionNodeWithComfy(functionNode.id, 1)

    expect(uploadImage).toHaveBeenCalledTimes(2)
    const uploadedNames = uploadImage.mock.calls.map((call) => (call[0] as File).name).sort()
    expect(uploadedNames[0]).toMatch(/^clip-[0-9a-f]{8}\.mp4$/)
    expect(uploadedNames[1]).toMatch(/^voice-[0-9a-f]{8}\.wav$/)
    for (const call of uploadImage.mock.calls) {
      expect(call[1]).toEqual({ subfolder: 'infinity-comfyui', overwrite: false })
    }
    const queued = queuedWorkflows[0] as Record<string, { inputs: Record<string, unknown> }>
    expect(String(queued['77']!.inputs.video)).toMatch(/^infinity-comfyui\/clip-[0-9a-f]{8}\.mp4$/)
    expect(String(queued['78']!.inputs.audio)).toMatch(/^infinity-comfyui\/voice-[0-9a-f]{8}\.wav$/)
  })
})
