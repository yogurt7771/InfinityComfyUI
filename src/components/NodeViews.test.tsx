import { ReactFlowProvider } from '@xyflow/react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentProps, ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmptyNodeView, FunctionNodeView, GroupNodeView, ResourceNodeView, ResultGroupNodeView } from './NodeViews'
import { projectStore } from '../store/projectStore'
import { createRequestFunction, REQUEST_FUNCTION_ID } from '../domain/requestFunction'
import { createOpenAILlmFunction } from '../domain/openaiLlm'
import type {
  FunctionOutputDef,
  GeminiImageConfig,
  GeminiLlmConfig,
  GenerationFunction,
  MediaResourceValue,
  OpenAIImageConfig,
  OpenAILlmConfig,
  RequestFunctionConfig,
  Resource,
} from '../domain/types'

const renderFunction: GenerationFunction = {
  id: 'fn_render',
  name: 'Flux2 Text To Image',
  category: 'Render',
  workflow: {
    format: 'comfyui_api_json',
    rawJson: {},
  },
  inputs: [
    {
      key: 'prompt',
      label: 'Prompt',
      type: 'text',
      required: true,
      bind: { nodeId: '6', nodeTitle: 'Positive Prompt', path: 'inputs.text' },
      upload: { strategy: 'none' },
    },
  ],
  outputs: [
    {
      key: 'image',
      label: 'Image',
      type: 'image',
      bind: { nodeId: '20', nodeTitle: 'Result_Image' },
      extract: { source: 'history', multiple: true },
    },
  ],
  createdAt: '2026-05-09T00:00:00.000Z',
  updatedAt: '2026-05-09T00:00:00.000Z',
}

const outputResource: Resource = {
  id: 'res_image',
  type: 'image',
  name: 'render.png',
  value: {
    assetId: 'asset_image',
    url: 'http://127.0.0.1:27707/view?filename=render.png&type=output',
    filename: 'render.png',
    mimeType: 'image/png',
    sizeBytes: 100,
  },
  source: {
    kind: 'function_output',
    outputKey: 'image',
    functionNodeId: 'node_fn',
    resultGroupNodeId: 'node_result',
  },
}

const textResource: Resource = {
  id: 'res_text',
  type: 'text',
  name: 'Prompt',
  value: 'new text resource',
  source: { kind: 'manual_input' },
}

const baseNodeData = {
  resourcesById: {},
  functionsById: { fn_render: renderFunction },
  onRunFunction: vi.fn(),
  onRerunResultNode: vi.fn(),
  onCancelResultRun: vi.fn(),
  onUpdateOpenAiConfig: vi.fn(),
  onUpdateGeminiConfig: vi.fn(),
  onUpdateOpenAiImageConfig: vi.fn(),
  onUpdateGeminiImageConfig: vi.fn(),
  onUpdateRequestConfig: vi.fn(),
  onUpdateRequestOutputs: vi.fn(),
  onDeleteNode: vi.fn(),
  onRenameNode: vi.fn(),
  onUpdateTextResourceValue: vi.fn(),
  onUpdateNumberResourceValue: vi.fn(),
  onUpdateFunctionInputValue: vi.fn(),
  onReplaceResourceMedia: vi.fn(),
}

describe('NodeViews', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    projectStore.setState(projectStore.getInitialState(), true)
  })

  it('renders text resources as editable multiline canvas text', () => {
    const onUpdateTextResourceValue = vi.fn()
    const props = {
      id: 'node_text',
      selected: false,
      data: {
        ...baseNodeData,
        resourcesById: { res_text: textResource },
        resourceId: 'res_text',
        title: 'Prompt',
      },
    } as unknown as ComponentProps<typeof ResourceNodeView>

    render(
      <ReactFlowProvider>
        <ResourceNodeView {...props} data={{ ...props.data, onUpdateTextResourceValue }} />
      </ReactFlowProvider>,
    )

    const editor = screen.getByLabelText('Prompt text')
    expect(editor).toHaveValue('new text resource')

    editor.focus()
    fireEvent.compositionStart(editor)
    fireEvent.change(editor, { target: { value: 'bianji' } })
    fireEvent.compositionEnd(editor)
    fireEvent.change(editor, { target: { value: '编辑 prompt\nsecond line' } })

    expect(document.activeElement).toBe(editor)
    expect(editor).toHaveValue('编辑 prompt\nsecond line')
    expect(onUpdateTextResourceValue).not.toHaveBeenCalled()

    fireEvent.blur(editor)
    expect(onUpdateTextResourceValue).toHaveBeenCalledWith('res_text', '编辑 prompt\nsecond line')
  })

  it('renders resource nodes without a left-side target slot', () => {
    const props = {
      id: 'node_image',
      selected: false,
      data: {
        ...baseNodeData,
        resourcesById: { res_image: outputResource },
        resourceId: 'res_image',
        title: 'Reference Image',
      },
    } as unknown as ComponentProps<typeof ResourceNodeView>

    const { container } = render(
      <ReactFlowProvider>
        <ResourceNodeView {...props} />
      </ReactFlowProvider>,
    )

    const hiddenLineageAnchor = container.querySelector('[data-handleid="resource-target:res_image"]')

    expect(container.querySelector('.asset-lineage-target-handle')).toBeNull()
    expect(hiddenLineageAnchor).not.toBeNull()
    expect(hiddenLineageAnchor).toHaveClass('asset-lineage-anchor-handle')
    expect(hiddenLineageAnchor).not.toHaveAttribute('data-slot-handle')
    expect(container.querySelector('[data-handleid="resource:res_image"]')).not.toBeNull()
  })

  it('shows running state on pending function output asset nodes', () => {
    const pendingOutput: Resource = {
      id: 'res_pending_image',
      type: 'image',
      name: 'Klein9B Image',
      value: {
        assetId: 'pending_res_pending_image',
        url: '',
        filename: 'image.png',
        mimeType: 'image/*',
        sizeBytes: 0,
      },
      source: {
        kind: 'function_output',
        outputKey: 'image',
        functionNodeId: 'task_running',
        taskId: 'task_running',
      },
      metadata: { workflowFunctionId: 'fn_render', createdAt: '2026-01-01T00:00:00.000Z' },
    }
    const props = {
      id: 'node_pending_image',
      selected: false,
      data: {
        ...baseNodeData,
        resourcesById: { res_pending_image: pendingOutput },
        resourceId: 'res_pending_image',
        resourceType: 'image',
        title: 'Klein9B Image',
        status: 'running',
        taskId: 'task_running',
        tasksById: {
          task_running: {
            id: 'task_running',
            functionNodeId: 'task_running',
            functionId: 'fn_render',
            runIndex: 1,
            runTotal: 1,
            status: 'running',
            inputRefs: {},
            inputSnapshot: {},
            paramsSnapshot: {},
            workflowTemplateSnapshot: {},
            compiledWorkflowSnapshot: {},
            seedPatchLog: [],
            outputRefs: { image: [{ resourceId: 'res_pending_image', type: 'image' }] },
            createdAt: '2026-05-09T00:00:00.000Z',
            updatedAt: '2026-05-09T00:00:00.000Z',
          },
        },
      },
    } as unknown as ComponentProps<typeof ResourceNodeView>

    const { container } = render(
      <ReactFlowProvider>
        <ResourceNodeView {...props} />
      </ReactFlowProvider>,
    )

    const resourceNode = container.querySelector('.resource-node')
    expect(resourceNode).toHaveClass('resource-node-running')
    expect(within(resourceNode as HTMLElement).getByLabelText('Asset status running')).toBeVisible()
    expect(within(resourceNode as HTMLElement).getByText('running')).toBeVisible()
    expect(within(resourceNode as HTMLElement).getByText('Generating image')).toBeVisible()
  })

  it('keeps increasing the run duration while a function output asset is running', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-05-09T00:00:01.000Z'))
      const runningOutput: Resource = {
        id: 'res_running_image',
        type: 'image',
        name: 'Klein9B Image',
        value: {
          assetId: 'pending_res_running_image',
          url: '',
          filename: 'image.png',
          mimeType: 'image/*',
          sizeBytes: 0,
        },
        source: {
          kind: 'function_output',
          outputKey: 'image',
          functionNodeId: 'task_running',
          taskId: 'task_running',
        },
        metadata: { workflowFunctionId: 'fn_render', createdAt: '2026-05-09T00:00:00.000Z' },
      }
      const props = {
        id: 'node_running_image',
        selected: false,
        data: {
          ...baseNodeData,
          resourcesById: { res_running_image: runningOutput },
          resourceId: 'res_running_image',
          resourceType: 'image',
          title: 'Klein9B Image',
          tasksById: {
            task_running: {
              id: 'task_running',
              functionNodeId: 'task_running',
              functionId: 'fn_render',
              runIndex: 1,
              runTotal: 1,
              status: 'running',
              inputRefs: {},
              inputSnapshot: {},
              paramsSnapshot: {},
              workflowTemplateSnapshot: {},
              compiledWorkflowSnapshot: {},
              seedPatchLog: [],
              outputRefs: { image: [{ resourceId: 'res_running_image', type: 'image' }] },
              createdAt: '2026-05-09T00:00:00.000Z',
              startedAt: '2026-05-09T00:00:00.000Z',
              updatedAt: '2026-05-09T00:00:00.000Z',
            },
          },
        },
      } as unknown as ComponentProps<typeof ResourceNodeView>

      const { container } = render(
        <ReactFlowProvider>
          <ResourceNodeView {...props} />
        </ReactFlowProvider>,
      )

      const resourceNode = container.querySelector('.resource-node')
      expect(within(resourceNode as HTMLElement).getByLabelText('Run duration 1s')).toBeVisible()

      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      expect(within(resourceNode as HTMLElement).getByLabelText('Run duration 3s')).toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the completed run duration on function output asset nodes', () => {
    const completedOutput: Resource = {
      ...outputResource,
      source: {
        ...outputResource.source,
        taskId: 'task_done',
      },
      metadata: { workflowFunctionId: 'fn_render', createdAt: '2026-05-09T00:00:04.500Z' },
    }
    const props = {
      id: 'node_image',
      selected: false,
      data: {
        ...baseNodeData,
        resourcesById: { res_image: completedOutput },
        resourceId: 'res_image',
        resourceType: 'image',
        title: 'Render Image',
        tasksById: {
          task_done: {
            id: 'task_done',
            functionNodeId: 'node_fn',
            functionId: 'fn_render',
            runIndex: 1,
            runTotal: 1,
            status: 'succeeded',
            inputRefs: {},
            inputSnapshot: {},
            paramsSnapshot: {},
            workflowTemplateSnapshot: {},
            compiledWorkflowSnapshot: {},
            seedPatchLog: [],
            outputRefs: { image: [{ resourceId: 'res_image', type: 'image' }] },
            createdAt: '2026-05-09T00:00:00.000Z',
            startedAt: '2026-05-09T00:00:00.000Z',
            updatedAt: '2026-05-09T00:00:04.500Z',
            completedAt: '2026-05-09T00:00:04.500Z',
          },
        },
      },
    } as unknown as ComponentProps<typeof ResourceNodeView>

    const { container } = render(
      <ReactFlowProvider>
        <ResourceNodeView {...props} />
      </ReactFlowProvider>,
    )

    const resourceNode = container.querySelector('.resource-node')
    expect(within(resourceNode as HTMLElement).getByLabelText('Run duration 4.5s')).toBeVisible()
  })

  it('exposes a generated asset source as a function or workflow view instead of a replacement runner', () => {
    const onOpenFunctionRunForResource = vi.fn()
    const linkedOutput: Resource = {
      ...outputResource,
      source: {
        ...outputResource.source,
        taskId: 'task_source_function',
      },
    }
    const props = {
      id: 'node_source_image',
      selected: false,
      data: {
        ...baseNodeData,
        resourcesById: { res_image: linkedOutput },
        resourceId: 'res_image',
        resourceType: 'image',
        title: 'Render Image',
        tasksById: {
          task_source_function: {
            id: 'task_source_function',
            functionNodeId: 'node_fn',
            functionId: 'fn_render',
            runIndex: 1,
            runTotal: 1,
            status: 'succeeded',
            inputRefs: {},
            inputSnapshot: {},
            paramsSnapshot: {},
            workflowTemplateSnapshot: renderFunction.workflow.rawJson,
            compiledWorkflowSnapshot: renderFunction.workflow.rawJson,
            seedPatchLog: [],
            outputRefs: { image: [{ resourceId: 'res_image', type: 'image' }] },
            createdAt: '2026-05-09T00:00:00.000Z',
            updatedAt: '2026-05-09T00:00:04.500Z',
            completedAt: '2026-05-09T00:00:04.500Z',
          },
        },
        onOpenFunctionRunForResource,
      },
    } as unknown as ComponentProps<typeof ResourceNodeView>

    const { container } = render(
      <ReactFlowProvider>
        <ResourceNodeView {...props} />
      </ReactFlowProvider>,
    )

    const sourceLink = within(container).getByRole('button', {
      name: /view.*(?:function|workflow).*Flux2 Text To Image/i,
    })
    expect(within(container).queryByRole('button', { name: 'Edit and run Flux2 Text To Image' })).not.toBeInTheDocument()

    fireEvent.click(sourceLink)

    expect(onOpenFunctionRunForResource).toHaveBeenCalledWith('res_image')
  })

  it.each([
    createRequestFunction('fn_request_source', 'Historical Request', '2026-05-09T00:00:00.000Z'),
    createOpenAILlmFunction('2026-05-09T00:00:00.000Z', {
      id: 'fn_openai_source',
      name: 'Historical OpenAI',
    }),
  ])('keeps Edit and run behavior for non-Comfy source function $name', (sourceFunction) => {
    const onOpenFunctionRunForResource = vi.fn()
    const linkedOutput: Resource = {
      ...outputResource,
      metadata: {
        workflowFunctionId: sourceFunction.id,
        createdAt: '2026-05-09T00:00:04.500Z',
      },
    }
    const props = {
      id: `node_${sourceFunction.id}`,
      selected: false,
      data: {
        ...baseNodeData,
        resourcesById: { res_image: linkedOutput },
        functionsById: { [sourceFunction.id]: sourceFunction },
        resourceId: 'res_image',
        resourceType: 'image',
        title: 'Historical Output',
        onOpenFunctionRunForResource,
      },
    } as unknown as ComponentProps<typeof ResourceNodeView>

    const { container } = render(
      <ReactFlowProvider>
        <ResourceNodeView {...props} />
      </ReactFlowProvider>,
    )

    const sourceLink = within(container).getByRole('button', { name: `Edit and run ${sourceFunction.name}` })
    fireEvent.click(sourceLink)

    expect(onOpenFunctionRunForResource).toHaveBeenCalledWith('res_image')
  })

  it('shows node reference counts and locates referenced nodes from the popover', () => {
    const onFocusReferenceNode = vi.fn()
    const props = {
      id: 'node_text',
      selected: false,
      data: {
        ...baseNodeData,
        resourcesById: { res_text: textResource },
        resourceId: 'res_text',
        title: 'Prompt',
        nodeReferences: [
          { nodeId: 'node_fn', title: 'Flux Render', type: 'function', direction: 'outgoing' },
          { nodeId: 'node_result', title: 'Run 1', type: 'result_group', direction: 'incoming' },
        ],
        onFocusReferenceNode,
      },
    } as unknown as ComponentProps<typeof ResourceNodeView>

    render(
      <ReactFlowProvider>
        <ResourceNodeView {...props} />
      </ReactFlowProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show 2 node references' }))

    expect(screen.getByText('Flux Render')).toBeVisible()
    expect(screen.getByText('Run 1')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Locate referenced node Flux Render' }))
    expect(onFocusReferenceNode).toHaveBeenCalledWith('node_fn')
  })

  it('closes node reference popovers when focus moves outside the refs control', () => {
    const props = {
      id: 'node_text',
      selected: false,
      data: {
        ...baseNodeData,
        resourcesById: { res_text: textResource },
        resourceId: 'res_text',
        title: 'Prompt',
        nodeReferences: [
          { nodeId: 'node_fn', title: 'Flux Render', type: 'function', direction: 'outgoing' },
        ],
      },
    } as unknown as ComponentProps<typeof ResourceNodeView>

    render(
      <ReactFlowProvider>
        <ResourceNodeView {...props} />
        <button type="button">Outside target</button>
      </ReactFlowProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show 1 node references' }))
    expect(screen.getByRole('dialog', { name: 'Node references' })).toBeVisible()

    fireEvent.focusIn(screen.getByRole('button', { name: 'Outside target' }))

    expect(screen.queryByRole('dialog', { name: 'Node references' })).not.toBeInTheDocument()
  })

  it('shows compact previews for every resource type in node reference popovers', () => {
    const numberResource: Resource = {
      id: 'res_number',
      type: 'number',
      name: 'Scale',
      value: 1.5,
      source: { kind: 'manual_input' },
    }
    const videoResource: Resource = {
      id: 'res_video',
      type: 'video',
      name: 'motion.mp4',
      value: {
        assetId: 'asset_video',
        url: 'data:video/mp4;base64,AAAA',
        filename: 'motion.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 4,
      },
      source: { kind: 'manual_input' },
    }
    const audioResource: Resource = {
      id: 'res_audio',
      type: 'audio',
      name: 'voice.wav',
      value: {
        assetId: 'asset_audio',
        url: 'data:audio/wav;base64,AAAA',
        filename: 'voice.wav',
        mimeType: 'audio/wav',
        sizeBytes: 4,
      },
      source: { kind: 'manual_input' },
    }
    const props = {
      id: 'node_fn',
      selected: false,
      data: {
        ...baseNodeData,
        resourcesById: {
          res_text: textResource,
          res_number: numberResource,
          res_image: outputResource,
          res_video: videoResource,
          res_audio: audioResource,
        },
        functionId: 'fn_render',
        title: 'Flux Render',
        nodeReferences: [
          { nodeId: 'node_text', title: 'Prompt', type: 'resource', direction: 'incoming', resourceId: 'res_text' },
          { nodeId: 'node_number', title: 'Scale', type: 'resource', direction: 'incoming', resourceId: 'res_number' },
          { nodeId: 'node_image', title: 'Reference Image', type: 'resource', direction: 'incoming', resourceId: 'res_image' },
          { nodeId: 'node_video', title: 'Reference Video', type: 'resource', direction: 'incoming', resourceId: 'res_video' },
          { nodeId: 'node_audio', title: 'Reference Audio', type: 'resource', direction: 'incoming', resourceId: 'res_audio' },
        ],
      },
    } as unknown as ComponentProps<typeof FunctionNodeView>

    render(
      <ReactFlowProvider>
        <FunctionNodeView {...props} />
      </ReactFlowProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show 5 node references' }))

    expect(screen.getByLabelText('Prompt reference text preview')).toHaveTextContent('new text resource')
    expect(screen.getByLabelText('Scale reference number preview')).toHaveTextContent('1.5')
    expect(screen.getByRole('img', { name: 'Reference Image reference image preview' })).toHaveClass('media-preview-contain')
    expect(screen.getByLabelText('Reference Video reference video preview')).toHaveAttribute('controls')
    expect(screen.getByLabelText('Reference Video reference video preview')).toHaveClass('media-preview-contain')
    expect(screen.getByLabelText('Reference Audio reference audio preview')).toHaveAttribute('controls')
  })

  it('adds upload, download, and drop replacement controls to media resources', async () => {
    const onReplaceResourceMedia = vi.fn()
    const props = {
      id: 'node_image',
      selected: false,
      data: {
        ...baseNodeData,
        resourcesById: { res_image: outputResource },
        resourceId: 'res_image',
        title: 'Reference Image',
        onReplaceResourceMedia,
      },
    } as unknown as ComponentProps<typeof ResourceNodeView>
    const replacement = new File(['replacement image'], 'replacement.png', { type: 'image/png' })

    const { container } = render(
      <ReactFlowProvider>
        <ResourceNodeView {...props} />
      </ReactFlowProvider>,
    )

    expect(within(container).getByRole('button', { name: 'Upload asset' })).toBeVisible()
    expect(within(container).getByRole('button', { name: 'Download asset' })).toBeVisible()

    const fileInput = container.querySelector('input[type="file"]')
    expect(fileInput).not.toBeNull()
    fireEvent.change(fileInput!, { target: { files: [replacement] } })

    await waitFor(() =>
      expect(onReplaceResourceMedia).toHaveBeenCalledWith(
        'res_image',
        'image',
        expect.objectContaining({
          filename: 'replacement.png',
          mimeType: 'image/png',
          sizeBytes: replacement.size,
          url: expect.stringMatching(/^data:image\/png;base64,/),
        }),
      ),
    )

    const dropped = new File(['drop image'], 'drop.png', { type: 'image/png' })
    fireEvent.drop(container.querySelector('.resource-node')!, { dataTransfer: { files: [dropped] } })

    await waitFor(() =>
      expect(onReplaceResourceMedia).toHaveBeenLastCalledWith(
        'res_image',
        'image',
        expect.objectContaining({
          filename: 'drop.png',
          mimeType: 'image/png',
          sizeBytes: dropped.size,
        }),
      ),
    )
  })

  it('opens media resource nodes from the central preview area', () => {
    const props = {
      id: 'node_image',
      selected: false,
      data: {
        ...baseNodeData,
        resourcesById: { res_image: outputResource },
        resourceId: 'res_image',
        title: 'Reference Image',
      },
    } as unknown as ComponentProps<typeof ResourceNodeView>

    render(
      <ReactFlowProvider>
        <ResourceNodeView {...props} />
      </ReactFlowProvider>,
    )

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Open Reference Image resource preview' }))

    expect(screen.getByRole('dialog', { name: 'Preview render.png' })).toBeVisible()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Preview render.png' })).not.toBeInTheDocument()
  })

  it('shows generated function output previews, opens them, locates their result nodes, and scrolls to new outputs', async () => {
    const latestOutput: Resource = {
      ...outputResource,
      id: 'res_image_latest',
      name: 'render-latest.png',
      value: {
        ...(outputResource.value as MediaResourceValue),
        assetId: 'asset_image_latest',
        url: 'data:image/png;base64,BBBB',
        filename: 'render-latest.png',
      },
      source: {
        ...outputResource.source,
        resultGroupNodeId: 'node_result_latest',
      },
      metadata: { createdAt: '2026-05-09T00:00:05.000Z' },
    }
    const scrollTo = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo })
    const onFocusReferenceNode = vi.fn()
    const baseProps = {
      id: 'node_fn',
      selected: false,
      data: {
        ...baseNodeData,
        resourcesById: { res_image: outputResource },
        functionsById: { fn_render: renderFunction },
        functionId: 'fn_render',
        title: 'Flux2 Text To Image',
        onFocusReferenceNode,
      },
    } as unknown as ComponentProps<typeof FunctionNodeView>

    const { rerender } = render(
      <ReactFlowProvider>
        <FunctionNodeView {...baseProps} />
      </ReactFlowProvider>,
    )

    const strip = screen.getByLabelText('Function output resources')
    expect(within(strip).getByRole('button', { name: 'Open render.png output preview' })).toBeVisible()
    fireEvent.click(within(strip).getByRole('button', { name: 'Open render.png output preview' }))
    expect(screen.getByRole('dialog', { name: 'Preview render.png' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Close full preview' }))
    scrollTo.mockClear()

    rerender(
      <ReactFlowProvider>
        <FunctionNodeView
          {...baseProps}
          data={{
            ...baseProps.data,
            resourcesById: { res_image: outputResource, res_image_latest: latestOutput },
          }}
        />
      </ReactFlowProvider>,
    )

    await waitFor(() => expect(scrollTo).toHaveBeenCalled())
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Open render-latest.png output preview' }))
    expect(onFocusReferenceNode).toHaveBeenCalledWith('node_result_latest')
  })

  it('renders one connectable slot per function input and output definition', () => {
    const functionWithOptionalInput: GenerationFunction = {
      ...renderFunction,
      inputs: [
        renderFunction.inputs[0]!,
        {
          key: 'negative_prompt',
          label: 'Negative Prompt',
          type: 'text',
          required: false,
          bind: { nodeId: '7', nodeTitle: 'Negative Prompt', path: 'inputs.text' },
          upload: { strategy: 'none' },
        },
      ],
    }
    const onRunFunction = vi.fn()
    const onUpdateFunctionRunCount = vi.fn()
    const props = {
      id: 'node_fn',
      selected: false,
      data: {
        ...baseNodeData,
        functionsById: { fn_render: functionWithOptionalInput },
        functionId: 'fn_render',
        title: 'Flux2 Text To Image',
        runtime: { runCount: 3 },
        onRunFunction,
        onUpdateFunctionRunCount,
      },
    } as unknown as ComponentProps<typeof FunctionNodeView>

    const { container } = render(
      <ReactFlowProvider>
        <FunctionNodeView {...props} />
      </ReactFlowProvider>,
    )

    const inputSlot = screen.getByTestId('function-input-slot-prompt')
    expect(within(inputSlot).getByText('Prompt')).toBeVisible()
    expect(within(inputSlot).getByText('text')).toBeVisible()
    expect(inputSlot).toHaveClass('required-slot')
    expect(within(inputSlot).getByText('Required')).toBeVisible()
    expect(container.querySelector('[data-slot-handle="input:prompt"]')).not.toBeNull()

    const optionalInputSlot = screen.getByTestId('function-input-slot-negative_prompt')
    expect(optionalInputSlot).toHaveClass('optional-slot')
    expect(within(optionalInputSlot).getByText('Optional')).toBeVisible()

    const outputSlot = screen.getByTestId('function-output-slot-image')
    expect(within(outputSlot).getByText('Image')).toBeVisible()
    expect(within(outputSlot).getByText('image')).toBeVisible()
    expect(container.querySelector('[data-slot-handle="output:image"]')).not.toBeNull()
    expect(container.querySelectorAll('.input-column .slot-spacer')).toHaveLength(0)
    expect(container.querySelectorAll('.output-column .slot-spacer')).toHaveLength(1)

    const runCountInput = screen.getByRole('spinbutton', { name: 'Run count' })
    expect(runCountInput).toHaveValue(3)
    fireEvent.change(runCountInput, { target: { value: '2' } })
    expect(onUpdateFunctionRunCount).toHaveBeenCalledWith('node_fn', 2)
    fireEvent.click(screen.getByRole('button', { name: 'Run function' }))
    expect(onRunFunction).toHaveBeenCalledWith('node_fn')
  })

  it('renders inline controls for optional primitive function inputs', () => {
    const onUpdateFunctionInputValue = vi.fn()
    const functionWithOptionalPrimitives: GenerationFunction = {
      ...renderFunction,
      workflow: {
        ...renderFunction.workflow,
        rawJson: {
          '7': {
            class_type: 'CLIPTextEncode',
            _meta: { title: 'Negative Prompt' },
            inputs: { text: 'workflow negative' },
          },
          '8': {
            class_type: 'UpscaleImageBy',
            _meta: { title: 'Scale' },
            inputs: { scale_by: 2.25, batch_size: 1 },
          },
        },
      },
      inputs: [
        renderFunction.inputs[0]!,
        {
          key: 'negative_prompt',
          label: 'Negative Prompt',
          type: 'text',
          required: false,
          bind: { nodeId: '7', nodeTitle: 'Negative Prompt', path: 'inputs.text' },
          upload: { strategy: 'none' },
        },
        {
          key: 'scale_by',
          label: 'Scale By',
          type: 'number',
          required: false,
          bind: { nodeId: '8', nodeTitle: 'Scale', path: 'inputs.scale_by' },
          upload: { strategy: 'none' },
        },
        {
          key: 'batch_size',
          label: 'Batch Size',
          type: 'number',
          required: false,
          bind: { nodeId: '8', nodeTitle: 'Scale', path: 'inputs.text' },
          upload: { strategy: 'none' },
        },
      ],
    }
    const { rerender } = render(
      <ReactFlowProvider>
        <FunctionNodeView
          {...({
            id: 'node_fn',
            selected: false,
            data: {
              ...baseNodeData,
              functionsById: { fn_render: functionWithOptionalPrimitives },
              functionId: 'fn_render',
              title: 'Flux2 Text To Image',
              inputValues: { scale_by: 1.25 },
              onUpdateFunctionInputValue,
            },
          } as unknown as ComponentProps<typeof FunctionNodeView>)}
        />
      </ReactFlowProvider>,
    )

    const textInput = screen.getByRole('textbox', { name: 'Negative Prompt inline value' })
    expect(textInput.tagName).toBe('TEXTAREA')
    expect(textInput).toHaveAttribute('rows', '5')
    expect(textInput).toHaveValue('workflow negative')
    expect(screen.getByTestId('function-input-slot-negative_prompt')).toHaveClass('text-primitive-slot')
    fireEvent.change(textInput, { target: { value: 'avoid blur' } })
    expect(onUpdateFunctionInputValue).not.toHaveBeenCalledWith('node_fn', 'negative_prompt', 'avoid blur')
    expect(textInput).toHaveValue('avoid blur')
    fireEvent.blur(textInput)
    expect(onUpdateFunctionInputValue).toHaveBeenCalledWith('node_fn', 'negative_prompt', 'avoid blur')
    onUpdateFunctionInputValue.mockClear()

    const numberInput = screen.getByRole('spinbutton', { name: 'Scale By inline value' })
    expect(numberInput).toHaveValue(1.25)
    fireEvent.change(numberInput, { target: { value: '1.5' } })
    expect(onUpdateFunctionInputValue).toHaveBeenCalledWith('node_fn', 'scale_by', 1.5)

    expect(screen.getByRole('spinbutton', { name: 'Batch Size inline value' })).toHaveValue(1)

    rerender(
      <ReactFlowProvider>
        <FunctionNodeView
          {...({
            id: 'node_fn',
            selected: false,
            data: {
              ...baseNodeData,
              resourcesById: { res_text: textResource },
              functionsById: { fn_render: functionWithOptionalPrimitives },
              functionId: 'fn_render',
              title: 'Flux2 Text To Image',
              inputValues: { negative_prompt: { resourceId: 'res_text', type: 'text' } },
              onUpdateFunctionInputValue,
            },
          } as unknown as ComponentProps<typeof FunctionNodeView>)}
        />
      </ReactFlowProvider>,
    )

    expect(screen.queryByRole('textbox', { name: 'Negative Prompt inline value' })).not.toBeInTheDocument()
    expect(screen.getByTestId('function-input-slot-negative_prompt')).toHaveTextContent('new text resource')
  })

  it('renders compact previews for connected media function inputs and hides them when disconnected', () => {
    const mediaFunction: GenerationFunction = {
      ...renderFunction,
      inputs: [
        {
          key: 'image_input',
          label: 'Image Input',
          type: 'image',
          required: true,
          bind: { path: 'inputs.image' },
          upload: { strategy: 'none' },
        },
        {
          key: 'video_input',
          label: 'Video Input',
          type: 'video',
          required: false,
          bind: { path: 'inputs.video' },
          upload: { strategy: 'none' },
        },
        {
          key: 'audio_input',
          label: 'Audio Input',
          type: 'audio',
          required: false,
          bind: { path: 'inputs.audio' },
          upload: { strategy: 'none' },
        },
      ],
      outputs: [],
    }
    const videoResource: Resource = {
      id: 'res_video',
      type: 'video',
      name: 'motion.mp4',
      value: {
        assetId: 'asset_video',
        url: 'data:video/mp4;base64,AAAA',
        filename: 'motion.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 4,
      },
      source: { kind: 'manual_input' },
    }
    const audioResource: Resource = {
      id: 'res_audio',
      type: 'audio',
      name: 'voice.wav',
      value: {
        assetId: 'asset_audio',
        url: 'data:audio/wav;base64,AAAA',
        filename: 'voice.wav',
        mimeType: 'audio/wav',
        sizeBytes: 4,
      },
      source: { kind: 'manual_input' },
    }
    const connectedData = {
      ...baseNodeData,
      resourcesById: {
        res_image: outputResource,
        res_video: videoResource,
        res_audio: audioResource,
      },
      functionsById: { fn_media: mediaFunction },
      functionId: 'fn_media',
      title: 'Media Function',
      inputValues: {
        image_input: { resourceId: 'res_image', type: 'image' },
        video_input: { resourceId: 'res_video', type: 'video' },
        audio_input: { resourceId: 'res_audio', type: 'audio' },
      },
    }
    const { rerender } = render(
      <ReactFlowProvider>
        <FunctionNodeView
          {...({
            id: 'node_fn',
            selected: false,
            data: connectedData,
          } as unknown as ComponentProps<typeof FunctionNodeView>)}
        />
      </ReactFlowProvider>,
    )

    expect(screen.getByRole('img', { name: 'Image Input connected image preview' })).toHaveClass('media-preview-contain')
    expect(screen.getByLabelText('Video Input connected video preview')).toHaveAttribute('controls')
    expect(screen.getByLabelText('Video Input connected video preview')).toHaveClass('media-preview-contain')
    expect(screen.getByLabelText('Audio Input connected audio preview')).toHaveAttribute('controls')

    rerender(
      <ReactFlowProvider>
        <FunctionNodeView
          {...({
            id: 'node_fn',
            selected: false,
            data: {
              ...connectedData,
              inputValues: {},
            },
          } as unknown as ComponentProps<typeof FunctionNodeView>)}
        />
      </ReactFlowProvider>,
    )

    expect(screen.queryByRole('img', { name: 'Image Input connected image preview' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Video Input connected video preview')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Audio Input connected audio preview')).not.toBeInTheDocument()
  })

  it('keeps optional text edits local while Chinese IME composition is active', () => {
    const onUpdateFunctionInputValue = vi.fn()
    const functionWithOptionalPrompt: GenerationFunction = {
      ...renderFunction,
      inputs: [
        renderFunction.inputs[0]!,
        {
          key: 'negative_prompt',
          label: 'Negative Prompt',
          type: 'text',
          required: false,
          defaultValue: '',
          bind: { nodeId: '7', nodeTitle: 'Negative Prompt', path: 'inputs.text' },
          upload: { strategy: 'none' },
        },
      ],
    }
    render(
      <ReactFlowProvider>
        <FunctionNodeView
          {...({
            id: 'node_fn',
            selected: false,
            data: {
              ...baseNodeData,
              functionsById: { fn_render: functionWithOptionalPrompt },
              functionId: 'fn_render',
              title: 'LTX 2.3 I2V',
              inputValues: { negative_prompt: '' },
              onUpdateFunctionInputValue,
            },
          } as unknown as ComponentProps<typeof FunctionNodeView>)}
        />
      </ReactFlowProvider>,
    )

    const textInput = screen.getByRole('textbox', { name: 'Negative Prompt inline value' })
    textInput.focus()
    fireEvent.compositionStart(textInput)
    fireEvent.change(textInput, { target: { value: 'n' } })
    fireEvent.change(textInput, { target: { value: 'nv' } })
    fireEvent.compositionEnd(textInput)
    fireEvent.change(textInput, { target: { value: '女孩' } })

    expect(document.activeElement).toBe(textInput)
    expect(textInput).toHaveValue('女孩')
    expect(onUpdateFunctionInputValue).not.toHaveBeenCalled()

    fireEvent.blur(textInput)
    expect(onUpdateFunctionInputValue).toHaveBeenCalledWith('node_fn', 'negative_prompt', '女孩')
  })

  it('renders selected function nodes with a resize handle', () => {
    const props = {
      id: 'node_fn',
      selected: true,
      data: {
        ...baseNodeData,
        functionId: 'fn_render',
        title: 'Flux2 Text To Image',
      },
    } as unknown as ComponentProps<typeof FunctionNodeView>

    render(
      <ReactFlowProvider>
        <FunctionNodeView {...props} />
      </ReactFlowProvider>,
    )

    expect(document.querySelector('.node-resize-handle')).not.toBeNull()
  })

  it('renders selected resource, result, group, and empty nodes with resize handles', () => {
    const renderSelected = (node: ReactElement) => {
      const { unmount } = render(<ReactFlowProvider>{node}</ReactFlowProvider>)
      expect(document.querySelector('.node-resize-handle')).not.toBeNull()
      unmount()
    }

    renderSelected(
      <ResourceNodeView
        {...({
          id: 'node_resource',
          selected: true,
          data: {
            ...baseNodeData,
            resourceId: 'res_text',
            resourcesById: { res_text: textResource },
            title: 'Prompt',
          },
        } as unknown as ComponentProps<typeof ResourceNodeView>)}
      />,
    )

    renderSelected(
      <ResultGroupNodeView
        {...({
          id: 'node_result',
          selected: true,
          data: {
            ...baseNodeData,
            resourcesById: { res_image: outputResource },
            resources: [{ resourceId: 'res_image', type: 'image' }],
            title: 'Run 1',
            status: 'succeeded',
          },
        } as unknown as ComponentProps<typeof ResultGroupNodeView>)}
      />,
    )

    renderSelected(<GroupNodeView {...({ id: 'node_group', selected: true, data: baseNodeData } as unknown as ComponentProps<typeof GroupNodeView>)} />)

    renderSelected(<EmptyNodeView {...({ id: 'node_empty', selected: true, data: baseNodeData } as unknown as ComponentProps<typeof EmptyNodeView>)} />)
  })

  it('keeps a selected failed resource resize control to one compact bottom-right handle without an active top strip', () => {
    const failedOutput: Resource = {
      ...outputResource,
      id: 'res_failed_resize',
      value: {
        ...(outputResource.value as MediaResourceValue),
        assetId: 'pending_res_failed_resize',
        url: '',
      },
      source: {
        ...outputResource.source,
        taskId: 'task_failed_resize',
      },
    }
    const props = {
      id: 'node_failed_resize',
      selected: true,
      data: {
        ...baseNodeData,
        resourcesById: { res_failed_resize: failedOutput },
        resourceId: 'res_failed_resize',
        resourceType: 'image',
        title: 'Failed image',
        status: 'failed',
        taskId: 'task_failed_resize',
        tasksById: {
          task_failed_resize: {
            id: 'task_failed_resize',
            functionNodeId: 'node_fn',
            functionId: 'fn_render',
            runIndex: 1,
            runTotal: 1,
            status: 'failed',
            inputRefs: {},
            inputSnapshot: {},
            paramsSnapshot: {},
            workflowTemplateSnapshot: {},
            compiledWorkflowSnapshot: {},
            seedPatchLog: [],
            outputRefs: { image: [{ resourceId: 'res_failed_resize', type: 'image' }] },
            error: { code: 'generation_failed', message: 'Sampler rejected the prompt' },
            createdAt: '2026-05-09T00:00:00.000Z',
            updatedAt: '2026-05-09T00:00:01.000Z',
          },
        },
      },
    } as unknown as ComponentProps<typeof ResourceNodeView>

    const { container } = render(
      <ReactFlowProvider>
        <ResourceNodeView {...props} />
      </ReactFlowProvider>,
    )

    const resizeControls = container.querySelectorAll('.react-flow__resize-control')
    expect(resizeControls).toHaveLength(1)
    expect(resizeControls[0]).toHaveClass('handle')
    expect(resizeControls[0]).toHaveClass('bottom', 'right')
    expect(resizeControls[0]).not.toHaveClass('line')
    expect(container.querySelector('.resource-node')).not.toHaveClass('resource-node-active')
  })

  it('marks missing required function inputs in red', () => {
    const props = {
      id: 'node_fn',
      selected: false,
      data: {
        ...baseNodeData,
        functionsById: { fn_render: renderFunction },
        functionId: 'fn_render',
        title: 'Flux2 Text To Image',
        missingInputKeys: ['prompt'],
      },
    } as unknown as ComponentProps<typeof FunctionNodeView>

    render(
      <ReactFlowProvider>
        <FunctionNodeView {...props} />
      </ReactFlowProvider>,
    )

    const inputSlot = screen.getByTestId('function-input-slot-prompt')
    expect(inputSlot).toHaveClass('missing-slot')
    expect(inputSlot).toHaveAttribute('aria-invalid', 'true')
    expect(within(inputSlot).getByText('Missing')).toBeVisible()
  })

  it('renders editable OpenAI LLM settings and six optional image inputs', () => {
    const openAiConfig: OpenAILlmConfig = {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: [{ type: 'text', content: 'Return concise text.' }] },
        {
          role: 'user',
          content: [
            { type: 'text', content: 'Describe the images.' },
            { type: 'image_url', content: 'image_1', detail: 'auto' },
          ],
        },
      ],
    }
    const openAiFunction: GenerationFunction = {
      id: 'fn_openai_llm',
      name: 'OpenAI LLM',
      category: 'LLM',
      workflow: {
        format: 'openai_chat_completions',
        rawJson: {},
      },
      openai: openAiConfig,
      inputs: Array.from({ length: 6 }, (_, index) => ({
        key: `image_${index + 1}`,
        label: `Image ${index + 1}`,
        type: 'image' as const,
        required: false,
        bind: { path: `openai.images.${index + 1}` },
        upload: { strategy: 'none' as const },
      })),
      outputs: [
        {
          key: 'text',
          label: 'Text',
          type: 'text',
          bind: { path: 'output_text' },
          extract: { source: 'node_output' },
        },
      ],
      runtimeDefaults: {
        runCount: 1,
        seedPolicy: { mode: 'randomize_all_before_submit' },
      },
      createdAt: '2026-05-09T00:00:00.000Z',
      updatedAt: '2026-05-09T00:00:00.000Z',
    }
    const onUpdateOpenAiConfig = vi.fn()
    const props = {
      id: 'node_openai',
      selected: false,
      data: {
        ...baseNodeData,
        functionsById: { fn_openai_llm: openAiFunction },
        functionId: 'fn_openai_llm',
        title: 'OpenAI LLM',
        openaiConfig: openAiConfig,
        onUpdateOpenAiConfig,
      },
    } as unknown as ComponentProps<typeof FunctionNodeView>

    const { container } = render(
      <ReactFlowProvider>
        <FunctionNodeView {...props} />
      </ReactFlowProvider>,
    )

    expect(screen.getAllByTestId(/^function-input-slot-image_/)).toHaveLength(6)
    expect(screen.getByTestId('function-output-slot-text')).toBeVisible()
    expect(container.querySelectorAll('.output-column .slot-spacer')).toHaveLength(5)
    expect(container.querySelector('.output-column .slot-spacer')).toHaveAttribute('aria-hidden', 'true')
    const openAiBaseUrl = screen.getByLabelText('OpenAI base URL')
    fireEvent.change(openAiBaseUrl, { target: { value: 'https://proxy.local/v1' } })
    expect(onUpdateOpenAiConfig).toHaveBeenCalledWith(
      'node_openai',
      expect.objectContaining({ baseUrl: 'https://proxy.local/v1' }),
    )
    onUpdateOpenAiConfig.mockClear()

    expect(screen.queryByLabelText('OpenAI message role 1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit messages' }))
    const dialog = screen.getByRole('dialog', { name: 'OpenAI Messages' })
    expect(within(dialog).getAllByText('system')[0]).toBeVisible()
    expect(within(dialog).getAllByText('user')[0]).toBeVisible()
    const messageContent = within(dialog).getByLabelText('OpenAI content 2.1')
    fireEvent.change(messageContent, { target: { value: '描述这些图片' } })
    expect(onUpdateOpenAiConfig).toHaveBeenLastCalledWith(
      'node_openai',
      expect.objectContaining({
        messages: [
          expect.any(Object),
          expect.objectContaining({
            content: [
              expect.objectContaining({ type: 'text', content: '描述这些图片' }),
              expect.any(Object),
            ],
          }),
        ],
      }),
    )
    onUpdateOpenAiConfig.mockClear()
    fireEvent.change(within(dialog).getByLabelText('OpenAI message role 1'), { target: { value: 'developer' } })
    expect(onUpdateOpenAiConfig).toHaveBeenLastCalledWith(
      'node_openai',
      expect.objectContaining({
        messages: [expect.objectContaining({ role: 'developer' }), expect.any(Object)],
      }),
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add content to OpenAI message 2' }))
    expect(onUpdateOpenAiConfig).toHaveBeenLastCalledWith(
      'node_openai',
      expect.objectContaining({
        messages: [
          expect.any(Object),
          expect.objectContaining({
            content: [
              expect.any(Object),
              expect.any(Object),
              expect.objectContaining({ type: 'text', content: '' }),
            ],
          }),
        ],
      }),
    )
    expect(container.querySelector('.openai-node-editor')).not.toBeNull()
  })

  it('closes message editor dialogs from the backdrop and Escape without leaking mouse or context events', () => {
    const openAiConfig: OpenAILlmConfig = {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: [{ type: 'text', content: 'Describe the image.' }] }],
    }
    const openAiFunction: GenerationFunction = {
      id: 'fn_openai_llm',
      name: 'OpenAI LLM',
      category: 'LLM',
      workflow: { format: 'openai_chat_completions', rawJson: {} },
      openai: openAiConfig,
      inputs: [],
      outputs: [{ key: 'text', label: 'Text', type: 'text', bind: { path: 'output_text' }, extract: { source: 'node_output' } }],
      createdAt: '2026-05-09T00:00:00.000Z',
      updatedAt: '2026-05-09T00:00:00.000Z',
    }
    const onShellMouseDown = vi.fn()
    const onShellContextMenu = vi.fn()
    const onShellPointerDown = vi.fn()
    const props = {
      id: 'node_openai',
      selected: false,
      data: {
        ...baseNodeData,
        functionsById: { fn_openai_llm: openAiFunction },
        functionId: 'fn_openai_llm',
        title: 'OpenAI LLM',
        openaiConfig: openAiConfig,
        onUpdateOpenAiConfig: vi.fn(),
      },
    } as unknown as ComponentProps<typeof FunctionNodeView>

    render(
      <div onMouseDown={onShellMouseDown} onContextMenu={onShellContextMenu} onPointerDown={onShellPointerDown}>
        <ReactFlowProvider>
          <FunctionNodeView {...props} />
        </ReactFlowProvider>
      </div>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit messages' }))
    expect(screen.getByRole('dialog', { name: 'OpenAI Messages' })).toBeVisible()

    const backdrop = document.querySelector('.node-modal-backdrop') as HTMLElement
    fireEvent.contextMenu(backdrop, { clientX: 80, clientY: 90 })
    expect(onShellContextMenu).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'OpenAI Messages' })).toBeVisible()

    fireEvent.pointerDown(backdrop, { clientX: 80, clientY: 90 })
    expect(onShellPointerDown).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'OpenAI Messages' })).toBeVisible()

    fireEvent.mouseDown(backdrop, { clientX: 80, clientY: 90 })
    expect(onShellMouseDown).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'OpenAI Messages' })).toBeVisible()

    fireEvent.click(backdrop)
    expect(screen.queryByRole('dialog', { name: 'OpenAI Messages' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit messages' }))
    expect(screen.getByRole('dialog', { name: 'OpenAI Messages' })).toBeVisible()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'OpenAI Messages' })).not.toBeInTheDocument()
  })

  it('renders an editable one-off binary request node with media output type choices', () => {
    const requestFunction = createRequestFunction(REQUEST_FUNCTION_ID, 'Request', '2026-05-13T00:00:00.000Z')
    const requestConfig: RequestFunctionConfig = {
      url: 'https://api.example.com/render',
      method: 'POST',
      headers: { Authorization: 'Bearer test' },
      body: '{"prompt":"hello"}',
      responseParse: 'binary',
      responseEncoding: 'utf-8',
    }
    const requestOutputs: FunctionOutputDef[] = [
      {
        key: 'image',
        label: 'Image',
        type: 'image',
        bind: {},
        extract: { source: 'response_binary' },
      },
    ]
    const onUpdateRequestConfig = vi.fn()
    const onUpdateRequestOutputs = vi.fn()

    render(
      <ReactFlowProvider>
        <FunctionNodeView
          {...({
            id: 'node_request',
            selected: false,
            data: {
              ...baseNodeData,
              functionsById: { [REQUEST_FUNCTION_ID]: requestFunction },
              functionId: REQUEST_FUNCTION_ID,
              title: 'Request',
              requestConfig,
              requestOutputs,
              onUpdateRequestConfig,
              onUpdateRequestOutputs,
            },
          } as unknown as ComponentProps<typeof FunctionNodeView>)}
        />
      </ReactFlowProvider>,
    )

    expect(screen.getByLabelText('Request settings')).toBeVisible()
    fireEvent.change(screen.getByLabelText('Request URL'), { target: { value: 'https://api.example.com/new' } })
    expect(onUpdateRequestConfig).toHaveBeenCalledWith('node_request', { url: 'https://api.example.com/new' })

    const outputType = screen.getByLabelText('Request output type image')
    expect(outputType).toHaveValue('image')
    expect(within(outputType).getByRole('option', { name: 'image' })).toBeVisible()
    expect(within(outputType).getByRole('option', { name: 'video' })).toBeVisible()
    expect(within(outputType).getByRole('option', { name: 'audio' })).toBeVisible()
    expect(screen.queryByLabelText('Response encoding')).not.toBeInTheDocument()

    fireEvent.change(outputType, { target: { value: 'video' } })
    expect(onUpdateRequestOutputs).toHaveBeenCalledWith('node_request', [
      expect.objectContaining({ key: 'image', type: 'video' }),
    ])
  })

  it('renders json request parsing with encoding and primitive-only output types', () => {
    const requestFunction = createRequestFunction(REQUEST_FUNCTION_ID, 'Request', '2026-05-13T00:00:00.000Z')
    const requestConfig: RequestFunctionConfig = {
      url: 'https://api.example.com/render',
      method: 'POST',
      headers: {},
      body: '',
      responseParse: 'json',
      responseEncoding: 'utf-8',
    }
    const requestOutputs: FunctionOutputDef[] = [
      {
        key: 'result',
        label: 'Result',
        type: 'text',
        bind: {},
        extract: { source: 'response_json_path', path: '$.result' },
      },
    ]

    render(
      <ReactFlowProvider>
        <FunctionNodeView
          {...({
            id: 'node_request',
            selected: false,
            data: {
              ...baseNodeData,
              functionsById: { [REQUEST_FUNCTION_ID]: requestFunction },
              functionId: REQUEST_FUNCTION_ID,
              title: 'Request',
              requestConfig,
              requestOutputs,
              onUpdateRequestConfig: vi.fn(),
              onUpdateRequestOutputs: vi.fn(),
            },
          } as unknown as ComponentProps<typeof FunctionNodeView>)}
        />
      </ReactFlowProvider>,
    )

    expect(screen.getByLabelText('Response encoding')).toHaveValue('utf-8')
    const outputType = screen.getByLabelText('Request output type result')
    expect(within(outputType).getByRole('option', { name: 'text' })).toBeVisible()
    expect(within(outputType).getByRole('option', { name: 'number' })).toBeVisible()
    expect(within(outputType).queryByRole('option', { name: 'image' })).not.toBeInTheDocument()
    expect(within(outputType).queryByRole('option', { name: 'video' })).not.toBeInTheDocument()
    expect(within(outputType).queryByRole('option', { name: 'audio' })).not.toBeInTheDocument()
  })

  it('renders editable Gemini LLM settings with Gemini message roles', () => {
    const geminiConfig: GeminiLlmConfig = {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: '',
      model: 'gemini-2.5-flash',
      messages: [
        { role: 'system', content: [{ type: 'text', content: 'Return concise text.' }] },
        {
          role: 'user',
          content: [
            { type: 'text', content: 'Describe the images.' },
            { type: 'image_url', content: 'image_1' },
          ],
        },
      ],
    }
    const geminiFunction: GenerationFunction = {
      id: 'fn_gemini_llm',
      name: 'Gemini LLM',
      category: 'LLM',
      workflow: {
        format: 'gemini_generate_content',
        rawJson: {},
      },
      gemini: geminiConfig,
      inputs: Array.from({ length: 6 }, (_, index) => ({
        key: `image_${index + 1}`,
        label: `Image ${index + 1}`,
        type: 'image' as const,
        required: false,
        bind: { path: `gemini.images.${index + 1}` },
        upload: { strategy: 'none' as const },
      })),
      outputs: [
        {
          key: 'text',
          label: 'Text',
          type: 'text',
          bind: { path: 'candidates.0.content.parts.0.text' },
          extract: { source: 'node_output' },
        },
      ],
      runtimeDefaults: {
        runCount: 1,
        seedPolicy: { mode: 'randomize_all_before_submit' },
      },
      createdAt: '2026-05-09T00:00:00.000Z',
      updatedAt: '2026-05-09T00:00:00.000Z',
    }
    const onUpdateGeminiConfig = vi.fn()
    const props = {
      id: 'node_gemini',
      selected: false,
      data: {
        ...baseNodeData,
        functionsById: { fn_gemini_llm: geminiFunction },
        functionId: 'fn_gemini_llm',
        title: 'Gemini LLM',
        geminiConfig,
        onUpdateGeminiConfig,
      },
    } as unknown as ComponentProps<typeof FunctionNodeView>

    render(
      <ReactFlowProvider>
        <FunctionNodeView {...props} />
      </ReactFlowProvider>,
    )

    expect(screen.getAllByTestId(/^function-input-slot-image_/)).toHaveLength(6)
    expect(screen.getByTestId('function-output-slot-text')).toBeVisible()
    const geminiModel = screen.getByLabelText('Gemini model')
    fireEvent.change(geminiModel, { target: { value: 'gemini-3-flash-preview' } })
    expect(onUpdateGeminiConfig).toHaveBeenCalledWith(
      'node_gemini',
      expect.objectContaining({ model: 'gemini-3-flash-preview' }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit messages' }))
    const dialog = screen.getByRole('dialog', { name: 'Gemini Messages' })
    expect(within(dialog).getAllByText('system')[0]).toBeVisible()
    expect(within(dialog).getAllByText('user')[0]).toBeVisible()
    expect(within(dialog).queryByRole('option', { name: 'developer' })).toBeNull()
    expect(within(dialog).getAllByRole('option', { name: 'model' })[0]).toBeVisible()
    fireEvent.change(within(dialog).getByLabelText('Gemini message role 2'), { target: { value: 'model' } })
    expect(onUpdateGeminiConfig).toHaveBeenLastCalledWith(
      'node_gemini',
      expect.objectContaining({
        messages: [expect.any(Object), expect.objectContaining({ role: 'model' })],
      }),
    )
  })

  it('renders editable OpenAI image generation settings', () => {
    const openaiImageConfig: OpenAIImageConfig = {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-image-2',
      size: 'auto',
      quality: 'auto',
      background: 'auto',
      outputFormat: 'png',
      outputCompression: 100,
      user: '',
    }
    const imageFunction: GenerationFunction = {
      id: 'fn_openai_image',
      name: 'OpenAI Generate Image',
      category: 'Image',
      workflow: { format: 'openai_image_generation', rawJson: {} },
      openaiImage: openaiImageConfig,
      inputs: [
        {
          key: 'prompt',
          label: 'Prompt',
          type: 'text',
          required: true,
          defaultValue: 'A studio product render',
          bind: { path: 'prompt' },
          upload: { strategy: 'none' },
        },
        ...Array.from({ length: 10 }, (_, index) => ({
          key: `image_${index + 1}`,
          label: `Image ${index + 1}`,
          type: 'image' as const,
          required: false,
          bind: { path: `openai.images.${index + 1}` },
          upload: { strategy: 'none' as const },
        })),
      ],
      outputs: [
        {
          key: 'image',
          label: 'Image',
          type: 'image',
          bind: { path: 'data.0.b64_json' },
          extract: { source: 'node_output' },
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
      updatedAt: '2026-05-09T00:00:00.000Z',
    }
    const onUpdateOpenAiImageConfig = vi.fn()
    const props = {
      id: 'node_openai_image',
      selected: false,
      data: {
        ...baseNodeData,
        functionsById: { fn_openai_image: imageFunction },
        functionId: 'fn_openai_image',
        title: 'OpenAI Generate Image',
        openaiImageConfig,
        onUpdateOpenAiImageConfig,
      },
    } as unknown as ComponentProps<typeof FunctionNodeView>

    render(
      <ReactFlowProvider>
        <FunctionNodeView {...props} />
      </ReactFlowProvider>,
    )

    expect(screen.getByTestId('function-input-slot-prompt')).toBeVisible()
    expect(screen.getAllByTestId(/^function-input-slot-image_/)).toHaveLength(10)
    expect(screen.getByTestId('function-output-slot-image')).toBeVisible()
    const openAiImageModel = screen.getByLabelText('OpenAI image model')
    fireEvent.change(openAiImageModel, { target: { value: 'gpt-image-2-2026-04-21' } })
    expect(onUpdateOpenAiImageConfig).toHaveBeenCalledWith(
      'node_openai_image',
      expect.objectContaining({ model: 'gpt-image-2-2026-04-21' }),
    )
    fireEvent.change(screen.getByLabelText('OpenAI image output format'), { target: { value: 'webp' } })
    expect(onUpdateOpenAiImageConfig).toHaveBeenLastCalledWith(
      'node_openai_image',
      expect.objectContaining({ outputFormat: 'webp' }),
    )
  })

  it('renders editable Gemini image generation settings', () => {
    const geminiImageConfig: GeminiImageConfig = {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: '',
      model: 'gemini-3.1-flash-image-preview',
      responseModalities: 'IMAGE',
      aspectRatio: 'auto',
      imageSize: 'auto',
    }
    const imageFunction: GenerationFunction = {
      id: 'fn_gemini_image',
      name: 'Gemini Generate Image',
      category: 'Image',
      workflow: { format: 'gemini_image_generation', rawJson: {} },
      geminiImage: geminiImageConfig,
      inputs: [
        {
          key: 'prompt',
          label: 'Prompt',
          type: 'text',
          required: true,
          defaultValue: 'A studio product render',
          bind: { path: 'prompt' },
          upload: { strategy: 'none' },
        },
        ...Array.from({ length: 10 }, (_, index) => ({
          key: `image_${index + 1}`,
          label: `Image ${index + 1}`,
          type: 'image' as const,
          required: false,
          bind: { path: `gemini.images.${index + 1}` },
          upload: { strategy: 'none' as const },
        })),
      ],
      outputs: [
        {
          key: 'image',
          label: 'Image',
          type: 'image',
          bind: { path: 'candidates.0.content.parts' },
          extract: { source: 'node_output' },
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
      updatedAt: '2026-05-09T00:00:00.000Z',
    }
    const onUpdateGeminiImageConfig = vi.fn()
    const props = {
      id: 'node_gemini_image',
      selected: false,
      data: {
        ...baseNodeData,
        functionsById: { fn_gemini_image: imageFunction },
        functionId: 'fn_gemini_image',
        title: 'Gemini Generate Image',
        geminiImageConfig,
        onUpdateGeminiImageConfig,
      },
    } as unknown as ComponentProps<typeof FunctionNodeView>

    const { container } = render(
      <ReactFlowProvider>
        <FunctionNodeView {...props} />
      </ReactFlowProvider>,
    )

    expect(screen.getByTestId('function-input-slot-prompt')).toBeVisible()
    expect(screen.getAllByTestId(/^function-input-slot-image_/)).toHaveLength(10)
    expect(screen.getByTestId('function-output-slot-image')).toBeVisible()
    expect(container.querySelectorAll('.image-generation-node .output-column .slot-spacer')).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('Gemini image aspect ratio'), { target: { value: '16:9' } })
    expect(onUpdateGeminiImageConfig).toHaveBeenCalledWith(
      'node_gemini_image',
      expect.objectContaining({ aspectRatio: '16:9' }),
    )
    fireEvent.change(screen.getByLabelText('Gemini image size'), { target: { value: '2K' } })
    expect(onUpdateGeminiImageConfig).toHaveBeenLastCalledWith(
      'node_gemini_image',
      expect.objectContaining({ imageSize: '2K' }),
    )
  })

  it('renders result resources as output slots that can feed downstream functions', () => {
    const props = {
      id: 'node_result',
      selected: false,
      data: {
        ...baseNodeData,
        resourcesById: { res_image: outputResource },
        resources: [{ resourceId: 'res_image', type: 'image' }],
        title: 'Run 1',
        status: 'succeeded',
        endpointId: 'endpoint_local',
      },
    } as unknown as ComponentProps<typeof ResultGroupNodeView>

    const { container } = render(
      <ReactFlowProvider>
        <ResultGroupNodeView {...props} />
      </ReactFlowProvider>,
    )

    const outputSlot = screen.getByTestId('result-output-slot-res_image')
    expect(within(outputSlot).getByText('image')).toBeVisible()
    expect(within(outputSlot).getByText('render.png')).toBeVisible()
    expect(container.querySelector('[data-slot-handle="result:res_image"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Copy result' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Download result' })).toBeVisible()
  })

  it('renders multi-resource results in a grid and opens full previews for every resource type', () => {
    const secondImageResource: Resource = {
      ...outputResource,
      id: 'res_image_2',
      name: 'render-alt.png',
      value: {
        assetId: 'asset_image_2',
        url: 'http://127.0.0.1:27707/view?filename=render-alt.png&type=output',
        filename: 'render-alt.png',
        mimeType: 'image/png',
        sizeBytes: 120,
      },
    }
    const videoResource: Resource = {
      id: 'res_video',
      type: 'video',
      name: 'clip.mp4',
      value: {
        assetId: 'asset_video',
        url: 'data:video/mp4;base64,AAAA',
        filename: 'clip.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 4,
      },
      source: {
        kind: 'function_output',
        outputKey: 'video',
        functionNodeId: 'node_fn',
        resultGroupNodeId: 'node_result',
      },
    }
    const audioResource: Resource = {
      id: 'res_audio',
      type: 'audio',
      name: 'voice.wav',
      value: {
        assetId: 'asset_audio',
        url: 'data:audio/wav;base64,AAAA',
        filename: 'voice.wav',
        mimeType: 'audio/wav',
        sizeBytes: 4,
      },
      source: {
        kind: 'function_output',
        outputKey: 'audio',
        functionNodeId: 'node_fn',
        resultGroupNodeId: 'node_result',
      },
    }
    const longTextResource: Resource = {
      id: 'res_output_text',
      type: 'text',
      name: 'full-answer.txt',
      value: 'First line of a long answer.\nSecond line with the complete result.',
      source: {
        kind: 'function_output',
        outputKey: 'text',
        functionNodeId: 'node_fn',
        resultGroupNodeId: 'node_result',
      },
    }
    const props = {
      id: 'node_result',
      selected: false,
      data: {
        ...baseNodeData,
        resourcesById: {
          res_image: outputResource,
          res_image_2: secondImageResource,
          res_video: videoResource,
          res_audio: audioResource,
          res_output_text: longTextResource,
        },
        resources: [
          { resourceId: 'res_image', type: 'image' },
          { resourceId: 'res_image_2', type: 'image' },
          { resourceId: 'res_video', type: 'video' },
          { resourceId: 'res_audio', type: 'audio' },
          { resourceId: 'res_output_text', type: 'text' },
        ],
        title: 'Run 1',
        status: 'succeeded',
        endpointId: 'endpoint_local',
      },
    } as unknown as ComponentProps<typeof ResultGroupNodeView>

    render(
      <ReactFlowProvider>
        <ResultGroupNodeView {...props} />
      </ReactFlowProvider>,
    )

    expect(screen.getByTestId('result-resource-grid')).toHaveClass('result-list')
    expect(screen.getAllByRole('button', { name: 'View full result' })).toHaveLength(5)
    expect(screen.getAllByTestId(/^result-output-slot-/)).toHaveLength(5)
    const audioCard = screen.getByLabelText('Result preview voice.wav')
    expect(audioCard).toHaveClass('result-preview-card-audio')
    expect(within(audioCard).getByRole('group', { name: 'Result actions voice.wav' })).toBeVisible()

    fireEvent.click(screen.getAllByRole('button', { name: 'View full result' })[0]!)
    let dialog = screen.getByRole('dialog', { name: 'Preview render.png' })
    expect(within(dialog).getByRole('img', { name: 'render.png' })).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close full preview' }))

    fireEvent.click(screen.getAllByRole('button', { name: 'View full result' })[2]!)
    dialog = screen.getByRole('dialog', { name: 'Preview clip.mp4' })
    expect(within(dialog).getByLabelText('clip.mp4 full preview')).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close full preview' }))

    fireEvent.click(screen.getAllByRole('button', { name: 'View full result' })[3]!)
    dialog = screen.getByRole('dialog', { name: 'Preview voice.wav' })
    expect(within(dialog).getByLabelText('voice.wav full preview')).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close full preview' }))

    fireEvent.click(screen.getAllByRole('button', { name: 'View full result' })[4]!)
    dialog = screen.getByRole('dialog', { name: 'Preview full-answer.txt' })
    expect(within(dialog).getByText(/Second line with the complete result\./)).toBeVisible()
  })

  it('switches full previews across same-type outputs from the same function node', () => {
    const nextImageResource: Resource = {
      ...outputResource,
      id: 'res_image_next',
      name: 'render-next.png',
      value: {
        assetId: 'asset_image_next',
        url: 'http://127.0.0.1:27707/view?filename=render-next.png&type=output',
        filename: 'render-next.png',
        mimeType: 'image/png',
        sizeBytes: 120,
      },
      source: {
        kind: 'function_output',
        outputKey: 'image',
        functionNodeId: 'node_fn',
        resultGroupNodeId: 'node_result_2',
      },
    }
    const otherFunctionImageResource: Resource = {
      ...nextImageResource,
      id: 'res_other_function_image',
      name: 'other-function.png',
      source: {
        kind: 'function_output',
        outputKey: 'image',
        functionNodeId: 'node_other_fn',
        resultGroupNodeId: 'node_other_result',
      },
    }
    const sameFunctionOtherNodeImageResource: Resource = {
      ...nextImageResource,
      id: 'res_same_function_other_node_image',
      name: 'same-function-copy.png',
      source: {
        kind: 'function_output',
        outputKey: 'image',
        functionNodeId: 'node_same_function_copy',
        resultGroupNodeId: 'node_same_function_copy_result',
      },
      metadata: {
        workflowFunctionId: 'fn_render',
        createdAt: '2026-05-09T00:00:00.000Z',
      },
    }
    const textOutputResource: Resource = {
      id: 'res_output_text',
      type: 'text',
      name: 'answer.txt',
      value: 'Different type output',
      source: {
        kind: 'function_output',
        outputKey: 'text',
        functionNodeId: 'node_fn',
        resultGroupNodeId: 'node_result_3',
      },
    }
    const props = {
      id: 'node_result',
      selected: false,
      data: {
        ...baseNodeData,
        resourcesById: {
          res_image: outputResource,
          res_image_next: nextImageResource,
          res_same_function_other_node_image: sameFunctionOtherNodeImageResource,
          res_other_function_image: otherFunctionImageResource,
          res_output_text: textOutputResource,
        },
        resources: [{ resourceId: 'res_image', type: 'image' }],
        title: 'Run 1',
        status: 'succeeded',
        endpointId: 'endpoint_local',
        functionId: 'fn_render',
        sourceFunctionNodeId: 'node_fn',
      },
    } as unknown as ComponentProps<typeof ResultGroupNodeView>

    render(
      <ReactFlowProvider>
        <ResultGroupNodeView {...props} />
      </ReactFlowProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'View full result' }))

    let dialog = screen.getByRole('dialog', { name: 'Preview render.png' })
    expect(within(dialog).getByText('1 / 3')).toBeVisible()
    expect(within(dialog).queryByText('other-function.png')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next result' }))

    dialog = screen.getByRole('dialog', { name: 'Preview render-next.png' })
    expect(within(dialog).getByRole('img', { name: 'render-next.png' })).toBeVisible()
    expect(within(dialog).getByText('2 / 3')).toBeVisible()

    fireEvent.keyDown(window, { key: 'ArrowLeft' })

    dialog = screen.getByRole('dialog', { name: 'Preview render.png' })
    expect(within(dialog).getByRole('img', { name: 'render.png' })).toBeVisible()
  })

  it('marks active result nodes with running visual state and a terminate control', () => {
    const onCancelResultRun = vi.fn()
    const props = {
      id: 'node_result',
      selected: false,
      data: {
        ...baseNodeData,
        onCancelResultRun,
        resourcesById: {},
        resources: [],
        title: 'Run 1',
        status: 'running',
        endpointId: 'endpoint_local',
        functionId: 'fn_render',
      },
    } as unknown as ComponentProps<typeof ResultGroupNodeView>

    const { container } = render(
      <ReactFlowProvider>
        <ResultGroupNodeView {...props} />
      </ReactFlowProvider>,
    )

    const resultNode = container.querySelector('.result-node')
    expect(resultNode).toHaveClass('result-node-active')
    expect(resultNode).toHaveClass('result-node-running')
    expect(within(resultNode as HTMLElement).getByText('running')).toBeVisible()
    expect(within(resultNode as HTMLElement).getByLabelText('Run status running')).toBeVisible()
    expect(within(resultNode as HTMLElement).queryByRole('button', { name: 'Rerun result' })).toBeNull()
    fireEvent.click(within(resultNode as HTMLElement).getByRole('button', { name: 'Terminate run' }))
    expect(onCancelResultRun).toHaveBeenCalledWith('node_result')
  })

  it('shows failed result nodes in an error state with the failure message', () => {
    const onRerunResultNode = vi.fn()
    const props = {
      id: 'node_result',
      selected: false,
      data: {
        ...baseNodeData,
        onRerunResultNode,
        resourcesById: {},
        resources: [],
        title: 'Run 1',
        status: 'failed',
        endpointId: 'openai',
        functionId: 'fn_render',
        taskId: 'task_failed',
        tasksById: {
          task_failed: {
            id: 'task_failed',
            functionNodeId: 'node_fn',
            functionId: 'fn_render',
            runIndex: 1,
            runTotal: 1,
            status: 'failed',
            inputRefs: {},
            inputSnapshot: {},
            paramsSnapshot: {},
            workflowTemplateSnapshot: {},
            compiledWorkflowSnapshot: {},
            seedPatchLog: [],
            outputRefs: {},
            error: {
              code: 'openai_execution_failed',
              message: 'OpenAI request failed: 401 invalid api key',
            },
            createdAt: '2026-05-09T00:00:00.000Z',
            updatedAt: '2026-05-09T00:00:00.000Z',
          },
        },
      },
    } as unknown as ComponentProps<typeof ResultGroupNodeView>

    const { container } = render(
      <ReactFlowProvider>
        <ResultGroupNodeView {...props} />
      </ReactFlowProvider>,
    )

    const resultNode = container.querySelector('.result-node')
    expect(resultNode).toHaveClass('result-node-failed')
    expect(within(resultNode as HTMLElement).getByText('OpenAI request failed: 401 invalid api key')).toBeVisible()
    expect(within(resultNode as HTMLElement).getByRole('alert')).toBeVisible()
    fireEvent.click(within(resultNode as HTMLElement).getByRole('button', { name: 'Rerun result' }))
    expect(onRerunResultNode).toHaveBeenCalledWith('node_result')
  })

  it('shows the associated task error and a copy action inside failed function-output media resources', () => {
    const failedOutput: Resource = {
      ...outputResource,
      id: 'res_failed_image',
      value: {
        ...(outputResource.value as MediaResourceValue),
        assetId: 'pending_res_failed_image',
        url: '',
      },
      source: {
        ...outputResource.source,
        taskId: 'task_failed_image',
      },
    }
    const props = {
      id: 'node_failed_image',
      selected: false,
      data: {
        ...baseNodeData,
        resourcesById: { res_failed_image: failedOutput },
        resourceId: 'res_failed_image',
        resourceType: 'image',
        title: 'Failed image',
        status: 'failed',
        taskId: 'task_failed_image',
        tasksById: {
          task_failed_image: {
            id: 'task_failed_image',
            functionNodeId: 'node_fn',
            functionId: 'fn_render',
            runIndex: 1,
            runTotal: 1,
            status: 'failed',
            inputRefs: {},
            inputSnapshot: {},
            paramsSnapshot: {},
            workflowTemplateSnapshot: {},
            compiledWorkflowSnapshot: {},
            seedPatchLog: [],
            outputRefs: { image: [{ resourceId: 'res_failed_image', type: 'image' }] },
            error: {
              code: 'comfy_execution_failed',
              message: 'ComfyUI rejected node 6: prompt input is invalid',
            },
            createdAt: '2026-05-09T00:00:00.000Z',
            updatedAt: '2026-05-09T00:00:01.000Z',
          },
        },
      },
    } as unknown as ComponentProps<typeof ResourceNodeView>

    const { container } = render(
      <ReactFlowProvider>
        <ResourceNodeView {...props} />
      </ReactFlowProvider>,
    )

    const resourceNode = container.querySelector('.resource-node') as HTMLElement
    const alert = within(resourceNode).getByRole('alert')
    expect(alert).toHaveTextContent('ComfyUI rejected node 6: prompt input is invalid')
    expect(within(resourceNode).getByRole('button', { name: 'Copy error' })).toBeVisible()
    expect(within(resourceNode).getByText('Failed to generate image')).toBeVisible()
  })

  it('shows an actionable fallback error inside failed function-output media resources without task details', () => {
    const failedOutput: Resource = {
      ...outputResource,
      id: 'res_failed_without_details',
      value: {
        ...(outputResource.value as MediaResourceValue),
        assetId: 'pending_res_failed_without_details',
        url: '',
      },
      source: {
        ...outputResource.source,
        taskId: 'task_failed_without_details',
      },
    }
    const props = {
      id: 'node_failed_without_details',
      selected: false,
      data: {
        ...baseNodeData,
        resourcesById: { res_failed_without_details: failedOutput },
        resourceId: 'res_failed_without_details',
        resourceType: 'image',
        title: 'Failed image without details',
        status: 'failed',
        taskId: 'task_failed_without_details',
        tasksById: {
          task_failed_without_details: {
            id: 'task_failed_without_details',
            functionNodeId: 'node_fn',
            functionId: 'fn_render',
            runIndex: 1,
            runTotal: 1,
            status: 'failed',
            inputRefs: {},
            inputSnapshot: {},
            paramsSnapshot: {},
            workflowTemplateSnapshot: {},
            compiledWorkflowSnapshot: {},
            seedPatchLog: [],
            outputRefs: { image: [{ resourceId: 'res_failed_without_details', type: 'image' }] },
            createdAt: '2026-05-09T00:00:00.000Z',
            updatedAt: '2026-05-09T00:00:01.000Z',
          },
        },
      },
    } as unknown as ComponentProps<typeof ResourceNodeView>

    const { container } = render(
      <ReactFlowProvider>
        <ResourceNodeView {...props} />
      </ReactFlowProvider>,
    )

    const resourceNode = container.querySelector('.resource-node') as HTMLElement
    const alert = within(resourceNode).getByRole('alert')
    expect(alert).not.toHaveTextContent(/^\s*$/)
    expect(alert).not.toHaveTextContent(/^\s*Failed to generate image\s*$/)
    expect(alert).toHaveTextContent(/run queue/i)
    expect(within(resourceNode).getByText('Failed to generate image')).toBeVisible()
  })

  it.each([
    ['text', ''],
    ['number', 0],
    ['boolean', false],
  ] as const)('shows the true associated task error and copy action inside failed function-output %s resources', (resourceType, value) => {
    const taskId = `task_failed_${resourceType}`
    const resourceId = `res_failed_${resourceType}`
    const failedOutput = {
      id: resourceId,
      type: resourceType,
      name: `Failed ${resourceType}`,
      value,
      source: {
        kind: 'function_output',
        outputKey: 'value',
        functionNodeId: 'node_fn',
        taskId,
      },
    } as Resource
    const props = {
      id: `node_failed_${resourceType}`,
      selected: false,
      data: {
        ...baseNodeData,
        resourcesById: { [resourceId]: failedOutput },
        resourceId,
        resourceType,
        title: `Failed ${resourceType}`,
        status: 'failed',
        taskId,
        error: {
          code: 'stale_node_error',
          message: 'Stale canvas error that must not be shown',
        },
        tasksById: {
          [taskId]: {
            id: taskId,
            functionNodeId: 'node_fn',
            functionId: 'fn_render',
            runIndex: 1,
            runTotal: 1,
            status: 'failed',
            inputRefs: {},
            inputSnapshot: {},
            paramsSnapshot: {},
            workflowTemplateSnapshot: {},
            compiledWorkflowSnapshot: {},
            seedPatchLog: [],
            outputRefs: { value: [{ resourceId, type: resourceType }] },
            error: {
              code: 'true_task_error',
              message: `True ${resourceType} task failure`,
            },
            createdAt: '2026-05-09T00:00:00.000Z',
            updatedAt: '2026-05-09T00:00:01.000Z',
          },
        },
      },
    } as unknown as ComponentProps<typeof ResourceNodeView>

    const { container } = render(
      <ReactFlowProvider>
        <ResourceNodeView {...props} />
      </ReactFlowProvider>,
    )

    const resourceNode = container.querySelector('.resource-node') as HTMLElement
    const alert = within(resourceNode).getByRole('alert')
    expect(alert).toHaveTextContent(`True ${resourceType} task failure`)
    expect(alert).not.toHaveTextContent('Stale canvas error that must not be shown')
    expect(within(resourceNode).getByRole('button', { name: 'Copy error' })).toBeVisible()
  })

  it('confirms a succeeded-result rerun in an accessible in-app dialog without invoking browser confirm', () => {
    const onRerunResultNode = vi.fn()
    const nativeConfirm = vi.fn(() => false)
    vi.stubGlobal('confirm', nativeConfirm)
    const props = {
      id: 'node_result',
      selected: false,
      data: {
        ...baseNodeData,
        onRerunResultNode,
        resourcesById: { res_image: outputResource },
        resources: [{ resourceId: 'res_image', type: 'image' }],
        title: 'Run 1',
        status: 'succeeded',
        endpointId: 'endpoint_local',
      },
    } as unknown as ComponentProps<typeof ResultGroupNodeView>

    const { container } = render(
      <ReactFlowProvider>
        <ResultGroupNodeView {...props} />
      </ReactFlowProvider>,
    )

    fireEvent.click(within(container).getByRole('button', { name: 'Rerun result' }))

    let dialog = screen.getByRole('dialog', { name: /rerun|overwrite/i })
    expect(within(dialog).getByRole('heading', { name: /rerun|overwrite/i })).toBeVisible()
    expect(dialog).toHaveTextContent(/already succeeded|completed/i)
    expect(dialog).toHaveTextContent(/overwrite|replace.*outputs/i)
    expect(nativeConfirm).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }))

    expect(onRerunResultNode).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: /rerun|overwrite/i })).not.toBeInTheDocument()

    fireEvent.click(within(container).getByRole('button', { name: 'Rerun result' }))
    dialog = screen.getByRole('dialog', { name: /rerun|overwrite/i })
    fireEvent.click(within(dialog).getByRole('button', { name: /rerun|overwrite/i }))

    expect(onRerunResultNode).toHaveBeenCalledWith('node_result')
    expect(screen.queryByRole('dialog', { name: /rerun|overwrite/i })).not.toBeInTheDocument()
    expect(nativeConfirm).not.toHaveBeenCalled()
  })

  it('adds copy and download controls to text input resources', () => {
    const props = {
      id: 'node_text',
      selected: false,
      data: {
        ...baseNodeData,
        resourcesById: { res_text: textResource },
        resourceId: 'res_text',
        title: 'Prompt',
      },
    } as unknown as ComponentProps<typeof ResourceNodeView>

    const { container } = render(
      <ReactFlowProvider>
        <ResourceNodeView {...props} />
      </ReactFlowProvider>,
    )

    expect(within(container).getByRole('button', { name: 'Copy asset' })).toBeVisible()
    expect(within(container).getByRole('button', { name: 'Download asset' })).toBeVisible()
  })

  it('copies text resource content to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const write = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write, writeText },
    })
    const props = {
      id: 'node_text',
      selected: false,
      data: {
        ...baseNodeData,
        resourcesById: { res_text: textResource },
        resourceId: 'res_text',
        title: 'Prompt',
      },
    } as unknown as ComponentProps<typeof ResourceNodeView>

    const { container } = render(
      <ReactFlowProvider>
        <ResourceNodeView {...props} />
      </ReactFlowProvider>,
    )

    fireEvent.click(within(container).getByRole('button', { name: 'Copy asset' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('new text resource'))
    expect(write).not.toHaveBeenCalled()
  })

  it('copies media resource bytes instead of the media URL', async () => {
    const secureResource: Resource = {
      ...outputResource,
      value: {
        ...(outputResource.value as MediaResourceValue),
        comfy: {
          endpointId: 'endpoint_secure',
          filename: 'render.png',
          subfolder: '',
          type: 'output',
        },
      },
      metadata: { endpointId: 'endpoint_secure', createdAt: '2026-05-12T00:00:00.000Z' },
    }
    projectStore.setState((state) => ({
      ...state,
      project: {
        ...state.project,
        resources: { [secureResource.id]: secureResource },
        comfy: {
          ...state.project.comfy,
          endpoints: [
            {
              id: 'endpoint_secure',
              name: 'Secure ComfyUI',
              baseUrl: 'http://127.0.0.1:27707',
              enabled: true,
              maxConcurrentJobs: 1,
              priority: 1,
              timeoutMs: 10000,
              customHeaders: { 'X-Workspace': 'infinity' },
            },
          ],
        },
      },
    }))
    const clipboardBlob = new Blob(['image-bytes'], { type: 'image/png' })
    const write = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => clipboardBlob,
    } as Response)
    class ClipboardItemMock {
      readonly items: Record<string, Blob>

      constructor(items: Record<string, Blob>) {
        this.items = items
      }
    }
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('ClipboardItem', ClipboardItemMock)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write, writeText },
    })
    const props = {
      id: 'node_image',
      selected: false,
      data: {
        ...baseNodeData,
        resourcesById: { res_image: secureResource },
        resourceId: 'res_image',
        title: 'Reference Image',
      },
    } as unknown as ComponentProps<typeof ResourceNodeView>

    const { container } = render(
      <ReactFlowProvider>
        <ResourceNodeView {...props} />
      </ReactFlowProvider>,
    )

    fireEvent.click(within(container).getByRole('button', { name: 'Copy asset' }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:27707/view?filename=render.png&subfolder=&type=output', {
        method: 'GET',
        headers: { 'X-Workspace': 'infinity' },
      }),
    )
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes('/__comfy_proxy/'))).toBe(false)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0]?.[0][0]).toMatchObject({
      items: {
        'image/png': clipboardBlob,
      },
    })
    expect(writeText).not.toHaveBeenCalled()
  })
})
