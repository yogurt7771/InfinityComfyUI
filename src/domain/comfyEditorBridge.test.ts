import { describe, expect, it, vi } from 'vitest'
import { restoreApiWorkflowLinks } from './comfyEditorBridge'
import type { ComfyWorkflow } from './types'

describe('ComfyUI editor bridge', () => {
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
})
