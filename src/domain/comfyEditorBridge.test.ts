import { describe, expect, it, vi } from 'vitest'
import {
  exportApiWorkflowFromComfyEditor,
  exportUiWorkflowFromComfyEditor,
  loadUiWorkflowIntoComfyEditor,
  openApiWorkflowJsonFileInComfyEditor,
  openWorkflowJsonFileInComfyEditor,
  restoreApiWorkflowLinks,
} from './comfyEditorBridge'
import type { ComfyUiWorkflow, ComfyWorkflow } from './types'

describe('ComfyUI editor bridge', () => {
  it('exports UI workflow through the same graphToPrompt workflow payload as ComfyUI Export', async () => {
    const workflow = { id: 'workflow_1', nodes: [{ id: 1, type: 'LoadImage' }], links: [] }
    const rootGraphInternal = { _nodes: [] }
    const app = {
      rootGraphInternal,
      graphToPrompt: vi.fn().mockResolvedValue({
        workflow,
        output: { '1': { class_type: 'LoadImage', inputs: {} } },
      }),
    }

    await expect(exportUiWorkflowFromComfyEditor(app)).resolves.toEqual(workflow)
    expect(app.graphToPrompt).toHaveBeenCalledWith(rootGraphInternal)
  })

  it('exports API workflow through the same graphToPrompt output payload as ComfyUI Export API', async () => {
    const output = { '1': { class_type: 'LoadImage', inputs: { image: 'input.png' } } }
    const app = {
      graphToPrompt: vi.fn().mockResolvedValue({
        workflow: { nodes: [] },
        output,
      }),
    }

    await expect(exportApiWorkflowFromComfyEditor(app)).resolves.toEqual(output)
    expect(app.graphToPrompt).toHaveBeenCalledTimes(1)
  })

  it('exports API workflow by capturing the prompt sent during ComfyUI queuePrompt', async () => {
    const capturedOutput = { '2': { class_type: 'KSampler', inputs: { model: ['1', 0], seed: 123 } } }
    const captureWindow = {
      Request,
      Response,
      fetch: vi.fn().mockRejectedValue(new Error('real prompt submission should be blocked')),
    }
    const originalFetch = captureWindow.fetch
    const app = {
      queuePrompt: vi.fn(async () => {
        const response = await captureWindow.fetch('/prompt', {
          method: 'POST',
          body: JSON.stringify({
            prompt: capturedOutput,
            workflow: { nodes: [] },
            client_id: 'client_test',
          }),
        })
        await response.json()
      }),
      graphToPrompt: vi.fn().mockResolvedValue({
        workflow: { nodes: [] },
        output: { '2': { class_type: 'KSampler', inputs: {} } },
      }),
    }

    await expect(exportApiWorkflowFromComfyEditor(app, captureWindow)).resolves.toEqual(capturedOutput)
    expect(app.queuePrompt).toHaveBeenCalledTimes(1)
    expect(app.graphToPrompt).not.toHaveBeenCalled()
    expect(captureWindow.fetch).toBe(originalFetch)
  })

  it('falls back to Export API output when runtime prompt capture fails', async () => {
    const output = { '3': { class_type: 'SaveImage', inputs: { filename_prefix: 'fallback' } } }
    const app = {
      queuePrompt: vi.fn().mockRejectedValue(new Error('queue capture unavailable')),
      graphToPrompt: vi.fn().mockResolvedValue({
        workflow: { nodes: [] },
        output,
      }),
    }

    await expect(exportApiWorkflowFromComfyEditor(app, { Request, Response, fetch: vi.fn() })).resolves.toEqual(output)
    expect(app.queuePrompt).toHaveBeenCalledTimes(1)
    expect(app.graphToPrompt).toHaveBeenCalledTimes(1)
  })

  it('loads editable workflows through ComfyUI file open handling', async () => {
    const handleFile = vi.fn().mockResolvedValue(undefined)
    const uiWorkflow = {
      id: 'workflow_1',
      nodes: [{ id: 1, type: 'LoadImage' }],
      links: [],
    }

    await openWorkflowJsonFileInComfyEditor({ handleFile }, uiWorkflow, 'Infinity Workflow.json')

    expect(handleFile).toHaveBeenCalledTimes(1)
    const file = handleFile.mock.calls[0]?.[0] as File
    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe('Infinity Workflow.json')
    expect(file.type).toBe('application/json')
    await expect(file.text()).resolves.toBe(JSON.stringify(uiWorkflow, null, 2))
  })

  it('constructs the workflow File inside the editor frame realm when a frame window is given', async () => {
    const handleFile = vi.fn().mockResolvedValue(undefined)
    class FrameFile {
      parts: unknown[]
      name: string
      options?: { type?: string }
      constructor(parts: unknown[], name: string, options?: { type?: string }) {
        this.parts = parts
        this.name = name
        this.options = options
      }
    }

    await openWorkflowJsonFileInComfyEditor(
      { handleFile },
      { nodes: [] },
      'Infinity Workflow.json',
      { File: FrameFile as unknown as typeof File },
    )

    expect(handleFile).toHaveBeenCalledTimes(1)
    const file = handleFile.mock.calls[0]?.[0] as FrameFile
    expect(file).toBeInstanceOf(FrameFile)
    expect(file).not.toBeInstanceOf(File)
    expect(file.name).toBe('Infinity Workflow.json')
    expect(file.options?.type).toBe('application/json')
  })

  it('restores links for numeric API workflow node ids after ComfyUI loadApiJson drops them', () => {
    const source = { id: 1, connect: vi.fn() }
    const target = { id: 2, inputs: [{ name: 'model' }] }
    const graph = {
      getNodeById: vi.fn((id: unknown) => (id === 1 ? source : id === 2 ? target : undefined)),
      change: vi.fn(),
    }
    const canvas = { draw: vi.fn() }
    const workflow: ComfyWorkflow = {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } },
      '2': { class_type: 'KSampler', inputs: { model: ['1', 0] } },
    }

    restoreApiWorkflowLinks({ graph, canvas }, workflow)

    expect(source.connect).toHaveBeenCalledWith(0, target, 0)
    expect(graph.change).toHaveBeenCalled()
    expect(canvas.draw).toHaveBeenCalledWith(true, true)
  })

  it('uses file open and then restores links for API workflow JSON', async () => {
    const source = { id: 1, connect: vi.fn() }
    const target = { id: 2, inputs: [{ name: 'model' }] }
    const app = {
      handleFile: vi.fn().mockResolvedValue(undefined),
      graph: {
        getNodeById: vi.fn((id: unknown) => (id === 1 ? source : id === 2 ? target : undefined)),
        change: vi.fn(),
      },
      canvas: { draw: vi.fn() },
    }
    const workflow: ComfyWorkflow = {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } },
      '2': { class_type: 'KSampler', inputs: { model: ['1', 0] } },
    }

    await openApiWorkflowJsonFileInComfyEditor(app, workflow)

    expect(app.handleFile).toHaveBeenCalledTimes(1)
    expect(source.connect).toHaveBeenCalledWith(0, target, 0)
  })
})

describe('loadUiWorkflowIntoComfyEditor', () => {
  const uiWorkflow = { nodes: [{ id: 1, type: 'KSampler' }] } as ComfyUiWorkflow

  const healthyGraph = () => ({
    _nodes: [{ type: 'KSampler' }],
    serialize: () => ({ nodes: [{ id: 1, type: 'KSampler' }] }),
  })

  it('waits for node definitions before opening the workflow file', async () => {
    vi.useFakeTimers()
    try {
      const registry: Record<string, unknown> = {}
      const frameWindow = { File, LiteGraph: { registered_node_types: registry } }
      const app = { handleFile: vi.fn().mockResolvedValue(undefined), graph: healthyGraph() }
      setTimeout(() => {
        registry.KSampler = {}
      }, 1500)

      const promise = loadUiWorkflowIntoComfyEditor(app, frameWindow, uiWorkflow)
      await vi.advanceTimersByTimeAsync(1000)
      expect(app.handleFile).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1000)
      await expect(promise).resolves.toEqual({ missingNodeTypes: [] })
      expect(app.handleFile).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-injects while loaded nodes have unregistered types, then stops once healthy', async () => {
    vi.useFakeTimers()
    try {
      const frameWindow = { File, LiteGraph: { registered_node_types: { KSampler: {} } } }
      const brokenGraph = {
        _nodes: [{ type: 'MissingPack.Node' }],
        serialize: () => ({ nodes: [{ id: 1 }] }),
      }
      const fixedGraph = healthyGraph()
      let injections = 0
      const app = {
        handleFile: vi.fn(async () => {
          injections += 1
          app.graph = injections === 1 ? brokenGraph : fixedGraph
        }),
        graph: brokenGraph as { _nodes: { type: string }[]; serialize: () => { nodes: unknown[] } },
      }

      const promise = loadUiWorkflowIntoComfyEditor(app, frameWindow, uiWorkflow)
      await vi.advanceTimersByTimeAsync(1500)
      await expect(promise).resolves.toEqual({ missingNodeTypes: [] })
      expect(app.handleFile).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns missing node types after bounded retries instead of looping forever', async () => {
    vi.useFakeTimers()
    try {
      const frameWindow = { File, LiteGraph: { registered_node_types: { KSampler: {} } } }
      const app = {
        handleFile: vi.fn().mockResolvedValue(undefined),
        graph: {
          _nodes: [{ type: 'MissingPack.Node' }],
          serialize: () => ({ nodes: [{ id: 1 }] }),
        },
      }

      const promise = loadUiWorkflowIntoComfyEditor(app, frameWindow, uiWorkflow)
      await vi.advanceTimersByTimeAsync(30000)
      await expect(promise).resolves.toEqual({ missingNodeTypes: ['MissingPack.Node'] })
      expect(app.handleFile).toHaveBeenCalledTimes(6)
    } finally {
      vi.useRealTimers()
    }
  })

  it('throws when ComfyUI does not keep the loaded workflow', async () => {
    vi.useFakeTimers()
    try {
      const frameWindow = { File, LiteGraph: { registered_node_types: { KSampler: {} } } }
      const app = {
        handleFile: vi.fn().mockResolvedValue(undefined),
        graph: { _nodes: [], serialize: () => ({ nodes: [] }) },
      }

      const promise = loadUiWorkflowIntoComfyEditor(app, frameWindow, uiWorkflow)
      const assertion = expect(promise).rejects.toThrow('did not keep it')
      await vi.advanceTimersByTimeAsync(30000)
      await assertion
      expect(app.handleFile).toHaveBeenCalledTimes(6)
    } finally {
      vi.useRealTimers()
    }
  })
})
