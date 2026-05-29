import { describe, expect, it, vi } from 'vitest'
import { openApiWorkflowJsonFileInComfyEditor, openWorkflowJsonFileInComfyEditor, restoreApiWorkflowLinks } from './comfyEditorBridge'
import type { ComfyWorkflow } from './types'

describe('ComfyUI editor bridge', () => {
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
