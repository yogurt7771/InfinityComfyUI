import { ReactFlowProvider } from '@xyflow/react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentProps, ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmptyNodeView, FunctionNodeView, GroupNodeView, ResourceNodeView, ResultGroupNodeView } from './NodeViews'
import type {
  GeminiImageConfig,
  GeminiLlmConfig,
  GenerationFunction,
  OpenAIImageConfig,
  OpenAILlmConfig,
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

    fireEvent.change(editor, { target: { value: 'edited prompt\nsecond line' } })

    expect(onUpdateTextResourceValue).toHaveBeenCalledWith('res_text', 'edited prompt\nsecond line')
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
    expect(onUpdateFunctionInputValue).toHaveBeenCalledWith('node_fn', 'negative_prompt', 'avoid blur')

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
    fireEvent.change(screen.getByLabelText('OpenAI base URL'), { target: { value: 'https://proxy.local/v1' } })
    expect(onUpdateOpenAiConfig).toHaveBeenCalledWith(
      'node_openai',
      expect.objectContaining({ baseUrl: 'https://proxy.local/v1' }),
    )

    expect(screen.queryByLabelText('OpenAI message role 1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit messages' }))
    const dialog = screen.getByRole('dialog', { name: 'OpenAI Messages' })
    expect(within(dialog).getAllByText('system')[0]).toBeVisible()
    expect(within(dialog).getAllByText('user')[0]).toBeVisible()
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
    fireEvent.change(screen.getByLabelText('Gemini model'), { target: { value: 'gemini-3-flash-preview' } })
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
    fireEvent.change(screen.getByLabelText('OpenAI image model'), { target: { value: 'gpt-image-2-2026-04-21' } })
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

  it('asks before rerunning a succeeded result node so outputs are intentionally overwritten', () => {
    const onRerunResultNode = vi.fn()
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
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

    expect(confirm).toHaveBeenCalledWith('This run already succeeded. Rerun and overwrite its outputs?')
    expect(onRerunResultNode).toHaveBeenCalledWith('node_result')
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

    fireEvent.click(within(container).getByRole('button', { name: 'Copy asset' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:27707/view?filename=render.png&type=output'))
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0]?.[0][0]).toMatchObject({
      items: {
        'image/png': clipboardBlob,
      },
    })
    expect(writeText).not.toHaveBeenCalled()
  })
})
