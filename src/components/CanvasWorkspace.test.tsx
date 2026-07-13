import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Edge } from '@xyflow/react'
import {
  AssetInspectorDialog,
  buildCanvasNodeZIndexMap,
  CanvasWorkspace,
  FunctionRunDialog,
  sameFlowEdgesForSync,
} from './CanvasWorkspace'
import { projectStore } from '../store/projectStore'
import type { CanvasNode, GenerationFunction, PrimitiveInputValue, ProjectState, Resource, ResourceRef } from '../domain/types'

describe('CanvasWorkspace', () => {
  const originalProject = projectStore.getState().project
  const originalProjectLibrary = projectStore.getState().projectLibrary
  const originalRunTemporaryFunctionAtPosition = projectStore.getState().runTemporaryFunctionAtPosition

  beforeEach(() => {
    projectStore.setState({
      project: originalProject,
      projectLibrary: originalProjectLibrary,
      selectedNodeId: undefined,
      selectedNodeIds: [],
      runTemporaryFunctionAtPosition: originalRunTemporaryFunctionAtPosition,
    } as Partial<ReturnType<typeof projectStore.getState>>)
  })

  afterEach(() => {
    cleanup()
    projectStore.setState({
      project: originalProject,
      projectLibrary: originalProjectLibrary,
      selectedNodeId: undefined,
      selectedNodeIds: [],
      runTemporaryFunctionAtPosition: originalRunTemporaryFunctionAtPosition,
    } as Partial<ReturnType<typeof projectStore.getState>>)
    vi.restoreAllMocks()
  })

  const openAddMenu = () => {
    render(<CanvasWorkspace />)
    fireEvent.contextMenu(screen.getByLabelText('Canvas'), { clientX: 180, clientY: 160 })
    return screen.getByRole('menu', { name: 'Add node' })
  }

  const imageResource: Resource = {
    id: 'res_image',
    type: 'image',
    name: 'reference.png',
    value: {
      assetId: 'asset_image',
      url: 'data:image/png;base64,abc',
      filename: 'reference.png',
      mimeType: 'image/png',
      sizeBytes: 12,
    },
    source: { kind: 'user_upload' },
  }

  const renderFunctionRunDialog = (
    initialFunction: GenerationFunction,
    options: { onEditComfyWorkflow?: () => void; canReplaceCurrent?: boolean } = {},
  ) => {
    const onRun = vi.fn()
    const onClose = vi.fn()
    const Wrapper = () => {
      const [functionDef, setFunctionDef] = useState(initialFunction)
      const [values, setValues] = useState<Record<string, PrimitiveInputValue | ResourceRef>>({
        image: { resourceId: 'res_image', type: 'image' },
      })
      return (
        <FunctionRunDialog
          functionDef={functionDef}
          values={values}
          runCount={1}
          resourcesById={{ res_image: imageResource }}
          onClose={onClose}
          onPickInput={vi.fn()}
          onRun={onRun}
          canReplaceCurrent={options.canReplaceCurrent}
          onFunctionDefChange={setFunctionDef}
          onRunCountChange={vi.fn()}
          onValuesChange={setValues}
          onEditComfyWorkflow={options.onEditComfyWorkflow}
        />
      )
    }

    render(<Wrapper />)
    return { onClose, onRun }
  }

  it('separates built-in runners from saved function templates in the add menu', () => {
    projectStore.getState().addFunctionFromWorkflow('Custom Workflow', {
      '9': {
        class_type: 'SaveImage',
        _meta: { title: 'Save Image' },
        inputs: { filename_prefix: 'custom' },
      },
    })

    const menu = openAddMenu()

    expect(within(menu).getByText('Built-in')).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'ComfyUI Workflow' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Request' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'OpenAI LLM' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Gemini LLM' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'OpenAI Image' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Gemini Image' })).toBeInTheDocument()
    expect(within(menu).getByText('Functions')).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Custom Workflow' })).toBeInTheDocument()
  })

  it('runs built-in Request through the temporary runner path without adding a function template', () => {
    const runTemporaryFunctionAtPosition = vi.fn().mockResolvedValue('task_1')
    projectStore.setState({
      runTemporaryFunctionAtPosition,
    } as Partial<ReturnType<typeof projectStore.getState>>)
    const initialFunctionIds = Object.keys(projectStore.getState().project.functions).sort()

    const menu = openAddMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Request' }))
    const dialog = screen.getByRole('dialog', { name: 'Run Request' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Request Authorization header' }), {
      target: { value: 'Bearer test-token' },
    })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Request response parse' }), {
      target: { value: 'binary' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run function from popup' }))

    expect(runTemporaryFunctionAtPosition).toHaveBeenCalledTimes(1)
    expect(runTemporaryFunctionAtPosition.mock.calls[0]?.[0]).toMatchObject({
      id: expect.stringMatching(/^temp_fn_request_/),
      name: 'Request',
      request: {
        headers: {
          Authorization: 'Bearer test-token',
        },
        responseParse: 'binary',
      },
      outputs: [expect.objectContaining({ type: 'image', extract: { source: 'response_binary' } })],
    })
    expect(Object.keys(projectStore.getState().project.functions).sort()).toEqual(initialFunctionIds)
  })

  it('shows provider settings for the built-in OpenAI runner', () => {
    const menu = openAddMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'OpenAI LLM' }))
    const dialog = screen.getByRole('dialog', { name: 'Run OpenAI LLM' })
    expect(within(dialog).getByRole('textbox', { name: 'OpenAI base URL' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('OpenAI API key')).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: 'OpenAI prompt' })).toBeInTheDocument()
  })

  it('shows provider settings for the built-in Gemini runner', () => {
    const menu = openAddMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Gemini LLM' }))
    const dialog = screen.getByRole('dialog', { name: 'Run Gemini LLM' })
    expect(within(dialog).getByRole('textbox', { name: 'Gemini base URL' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Gemini API key')).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: 'Gemini prompt' })).toBeInTheDocument()
  })

  it('opens the one-off ComfyUI workflow runner from the built-in menu', () => {
    const menu = openAddMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'ComfyUI Workflow' }))

    const dialog = screen.getByRole('dialog', { name: 'ComfyUI workflow runner' })
    expect(within(dialog).getByRole('combobox', { name: 'ComfyUI server for temporary workflow' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Edit temporary workflow in ComfyUI' })).toBeInTheDocument()
    expect(screen.queryByRole('menu', { name: 'Add node' })).not.toBeInTheDocument()
  })

  it('shows media input previews inside the function run slots', () => {
    renderFunctionRunDialog({
      id: 'temp_comfy',
      name: 'ComfyUI Workflow',
      category: 'Render',
      workflow: {
        format: 'comfyui_api_json',
        rawJson: {
          '10': { class_type: 'LoadImage', _meta: { title: 'Load Image' }, inputs: { image: 'reference.png' } },
        },
      },
      inputs: [
        {
          key: 'image',
          label: 'Image',
          type: 'image',
          required: true,
          bind: { nodeId: '10', nodeTitle: 'Load Image', path: 'inputs.image' },
          upload: { strategy: 'comfy_upload' },
        },
      ],
      outputs: [],
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z',
    })

    const field = screen.getByText('Image').closest('.function-run-field') as HTMLElement
    expect(within(field).getByRole('img', { name: 'reference.png' })).toBeInTheDocument()
  })

  it('keeps the function runner open when Escape first closes an input resource preview', () => {
    const { onClose } = renderFunctionRunDialog({
      id: 'temp_comfy',
      name: 'ComfyUI Workflow',
      category: 'Render',
      workflow: {
        format: 'comfyui_api_json',
        rawJson: {
          '10': { class_type: 'LoadImage', _meta: { title: 'Load Image' }, inputs: { image: 'reference.png' } },
        },
      },
      inputs: [
        {
          key: 'image',
          label: 'Image',
          type: 'image',
          required: true,
          bind: { nodeId: '10', nodeTitle: 'Load Image', path: 'inputs.image' },
          upload: { strategy: 'comfy_upload' },
        },
      ],
      outputs: [],
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z',
    })

    const dialog = screen.getByRole('dialog', { name: 'Run ComfyUI Workflow' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Preview Image input' }))

    expect(screen.getByRole('dialog', { name: /Preview reference\.png/ })).toBeVisible()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: /Preview reference\.png/ })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Run ComfyUI Workflow' })).toBeVisible()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not let an input preview backdrop click also close the function runner backdrop', () => {
    const { onClose } = renderFunctionRunDialog({
      id: 'temp_comfy',
      name: 'ComfyUI Workflow',
      category: 'Render',
      workflow: {
        format: 'comfyui_api_json',
        rawJson: {
          '10': { class_type: 'LoadImage', _meta: { title: 'Load Image' }, inputs: { image: 'reference.png' } },
        },
      },
      inputs: [
        {
          key: 'image',
          label: 'Image',
          type: 'image',
          required: true,
          bind: { nodeId: '10', nodeTitle: 'Load Image', path: 'inputs.image' },
          upload: { strategy: 'comfy_upload' },
        },
      ],
      outputs: [],
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z',
    })

    const dialog = screen.getByRole('dialog', { name: 'Run ComfyUI Workflow' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Preview Image input' }))
    expect(screen.getByRole('dialog', { name: /Preview reference\.png/ })).toBeVisible()

    const previewBackdrop = document.querySelector('.full-preview-backdrop') as HTMLElement
    fireEvent.click(previewBackdrop, { clientX: 240, clientY: 180 })

    expect(screen.queryByRole('dialog', { name: /Preview reference\.png/ })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Run ComfyUI Workflow' })).toBeVisible()
    expect(onClose).not.toHaveBeenCalled()

    const functionRunnerBackdrop = document.querySelector('.local-action-backdrop') as HTMLElement
    fireEvent.click(functionRunnerBackdrop, { clientX: 240, clientY: 180 })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('runs either by replacing the current output or by creating a new node', () => {
    const { onRun } = renderFunctionRunDialog(
      {
        id: 'temp_comfy',
        name: 'ComfyUI Workflow',
        category: 'Render',
        workflow: {
          format: 'comfyui_api_json',
          rawJson: {
            '10': { class_type: 'LoadImage', _meta: { title: 'Load Image' }, inputs: { image: 'reference.png' } },
          },
        },
        inputs: [
          {
            key: 'image',
            label: 'Image',
            type: 'image',
            required: true,
            bind: { nodeId: '10', nodeTitle: 'Load Image', path: 'inputs.image' },
            upload: { strategy: 'comfy_upload' },
          },
        ],
        outputs: [{ key: 'image', label: 'Image', type: 'image', bind: { nodeId: '20' } }],
        createdAt: '2026-06-25T00:00:00.000Z',
        updatedAt: '2026-06-25T00:00:00.000Z',
      },
      { canReplaceCurrent: true },
    )

    const dialog = screen.getByRole('dialog', { name: 'Run ComfyUI Workflow' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run and replace current output' }))
    expect(onRun).toHaveBeenLastCalledWith(expect.any(Object), 1, 'replace')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Run and create new output node' }))
    expect(onRun).toHaveBeenLastCalledWith(expect.any(Object), 1, 'new')
  })

  it('allows temporary ComfyUI runners to expose and remove workflow input slots', () => {
    renderFunctionRunDialog({
      id: 'temp_comfy',
      name: 'ComfyUI Workflow',
      category: 'Render',
      workflow: {
        format: 'comfyui_api_json',
        rawJson: {
          '10': { class_type: 'LoadImage', _meta: { title: 'Load Image' }, inputs: { image: 'reference.png' } },
          '20': {
            class_type: 'Boolean',
            _meta: { title: 'Enable Detailer' },
            inputs: { value: true },
          },
        },
      },
      inputs: [
        {
          key: 'image',
          label: 'Image',
          type: 'image',
          required: true,
          bind: { nodeId: '10', nodeTitle: 'Load Image', path: 'inputs.image' },
          upload: { strategy: 'comfy_upload' },
        },
      ],
      outputs: [],
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z',
    })

    const dialog = screen.getByRole('dialog', { name: 'Run ComfyUI Workflow' })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Workflow input slot' }), {
      target: { value: '20\u001Finputs.value' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add input slot' }))

    expect(within(dialog).getByLabelText('Manual input Value')).toHaveAttribute('type', 'checkbox')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete input slot value' }))

    expect(within(dialog).queryByLabelText('Manual input Value')).not.toBeInTheDocument()
  })

  it('keeps saved temporary ComfyUI workflows editable from the runner dialog', () => {
    const onEditComfyWorkflow = vi.fn()
    renderFunctionRunDialog(
      {
        id: 'temp_comfy',
        name: 'ComfyUI Workflow',
        category: 'Render',
        workflow: {
          format: 'comfyui_api_json',
          rawJson: {
            '10': { class_type: 'LoadImage', _meta: { title: 'Load Image' }, inputs: { image: 'reference.png' } },
          },
          uiJson: { nodes: [], links: [] },
        },
        inputs: [
          {
            key: 'image',
            label: 'Image',
            type: 'image',
            required: true,
            bind: { nodeId: '10', nodeTitle: 'Load Image', path: 'inputs.image' },
            upload: { strategy: 'comfy_upload' },
          },
        ],
        outputs: [],
        createdAt: '2026-06-25T00:00:00.000Z',
        updatedAt: '2026-06-25T00:00:00.000Z',
      },
      { onEditComfyWorkflow },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit workflow in ComfyUI' }))

    expect(onEditComfyWorkflow).toHaveBeenCalledTimes(1)
  })

  it('keeps missing ComfyUI workflow slots visible with an invalid warning after workflow edits', () => {
    renderFunctionRunDialog({
      id: 'temp_comfy',
      name: 'ComfyUI Workflow',
      category: 'Render',
      workflow: {
        format: 'comfyui_api_json',
        rawJson: {
          '20': { class_type: 'Boolean', _meta: { title: 'Enable Detailer' }, inputs: { value: true } },
        },
      },
      inputs: [
        {
          key: 'image',
          label: 'Image',
          type: 'image',
          required: true,
          bind: { nodeId: '10', nodeTitle: 'Load Image', path: 'inputs.image' },
          upload: { strategy: 'comfy_upload' },
        },
      ],
      outputs: [],
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z',
    })

    const field = screen.getByText('Image').closest('.function-run-field') as HTMLElement

    expect(field).toHaveClass('function-run-field-invalid')
    expect(within(field).getByText('Workflow slot no longer exists')).toBeInTheDocument()
  })

  it('blocks canvas context menus while a local action dialog is open', () => {
    const menu = openAddMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'ComfyUI Workflow' }))

    const backdrop = document.querySelector('.local-action-backdrop') as HTMLElement
    fireEvent.contextMenu(backdrop, { clientX: 220, clientY: 180 })

    expect(screen.queryByRole('menu', { name: 'Add node' })).not.toBeInTheDocument()
  })

  it('closes function runner dialogs from the backdrop click without leaking press or context events', () => {
    const onShellPointerDown = vi.fn()
    const onShellMouseDown = vi.fn()
    const onShellContextMenu = vi.fn()
    const { onClose } = renderFunctionRunDialog({
      id: 'temp_comfy',
      name: 'ComfyUI Workflow',
      category: 'Render',
      workflow: { format: 'comfyui_api_json', rawJson: {} },
      inputs: [],
      outputs: [],
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z',
    })

    document.body.addEventListener('pointerdown', onShellPointerDown)
    document.body.addEventListener('mousedown', onShellMouseDown)
    document.body.addEventListener('contextmenu', onShellContextMenu)
    try {
      const backdrop = document.querySelector('.local-action-backdrop') as HTMLElement
      expect(screen.getByRole('dialog', { name: 'Run ComfyUI Workflow' })).toBeVisible()

      fireEvent.contextMenu(backdrop, { clientX: 220, clientY: 180 })
      expect(onShellContextMenu).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()

      fireEvent.pointerDown(backdrop, { clientX: 220, clientY: 180 })
      expect(onShellPointerDown).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()

      fireEvent.mouseDown(backdrop, { clientX: 220, clientY: 180 })
      expect(onShellMouseDown).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()

      fireEvent.click(backdrop, { clientX: 220, clientY: 180 })
      expect(onClose).toHaveBeenCalledTimes(1)
    } finally {
      document.body.removeEventListener('pointerdown', onShellPointerDown)
      document.body.removeEventListener('mousedown', onShellMouseDown)
      document.body.removeEventListener('contextmenu', onShellContextMenu)
    }
  })

  it('opens an inspector dialog from an asset node context menu', async () => {
    const inspectProject: ProjectState = {
      ...originalProject,
      project: { ...originalProject.project, id: 'project_asset_inspector' },
      canvas: {
        nodes: [
          {
            id: 'node_asset_inspect',
            type: 'resource',
            position: { x: 0, y: 0 },
            data: { resourceId: 'res_inspect', resourceType: 'image', title: 'Inspector Reference' },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      resources: {
        res_inspect: {
          id: 'res_inspect',
          type: 'image',
          name: 'Inspector Reference',
          value: {
            assetId: 'asset_inspect',
            url: 'data:image/png;base64,abc',
            filename: 'inspect.png',
            mimeType: 'image/png',
            sizeBytes: 123,
          },
          source: { kind: 'user_upload' },
          metadata: { createdAt: '2026-06-25T00:00:00.000Z' },
        },
      },
      functions: {},
      tasks: {},
    }
    projectStore.setState({
      project: inspectProject,
      selectedNodeId: undefined,
      selectedNodeIds: [],
    } as Partial<ReturnType<typeof projectStore.getState>>)

    const { container } = render(<CanvasWorkspace />)
    const assetNode = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('.react-flow__node[data-id="node_asset_inspect"]')
      expect(element).not.toBeNull()
      return element!
    })

    fireEvent.contextMenu(assetNode, { clientX: 220, clientY: 160 })
    fireEvent.click(screen.getByRole('button', { name: /Inspect|查看/ }))

    const dialog = screen.getByRole('dialog', { name: /Inspector|查看/ })
    expect(within(dialog).getByText('node_asset_inspect')).toBeVisible()
    expect(dialog).toHaveTextContent('res_inspect')
    expect(within(dialog).getByText('image')).toBeVisible()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Open Inspector Reference preview' }))
    expect(screen.getByRole('dialog', { name: /Preview inspect\.png/ })).toBeVisible()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: /Preview inspect\.png/ })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: /Inspector|查看/ })).toBeVisible()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: /Inspector|查看/ })).not.toBeInTheDocument()

    fireEvent.contextMenu(assetNode, { clientX: 220, clientY: 160 })
    fireEvent.click(screen.getByRole('button', { name: /Inspect|查看/ }))
    const reopenedDialog = screen.getByRole('dialog', { name: /Inspector|查看/ })
    fireEvent.click(within(reopenedDialog).getByRole('button', { name: 'Open Inspector Reference preview' }))
    expect(screen.getByRole('dialog', { name: /Preview inspect\.png/ })).toBeVisible()

    const previewBackdrop = document.querySelector('.full-preview-backdrop') as HTMLElement
    fireEvent.click(previewBackdrop, { clientX: 240, clientY: 180 })
    expect(screen.queryByRole('dialog', { name: /Preview inspect\.png/ })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: /Inspector|查看/ })).toBeVisible()

    const inspectorBackdrop = document.querySelector('.asset-inspector-backdrop') as HTMLElement
    fireEvent.click(inspectorBackdrop, { clientX: 240, clientY: 180 })
    expect(screen.queryByRole('dialog', { name: /Inspector|查看/ })).not.toBeInTheDocument()
  })

  it('shows run details and navigation from a generated asset inspector', async () => {
    const runProject: ProjectState = {
      ...originalProject,
      project: { ...originalProject.project, id: 'project_result_asset_inspector' },
      canvas: {
        nodes: [
          { id: 'node_prompt', type: 'resource', position: { x: 0, y: 0 }, data: { resourceId: 'res_prompt', title: 'Prompt' } },
          {
            id: 'node_result_inspect',
            type: 'resource',
            position: { x: 320, y: 0 },
            data: {
              resourceId: 'res_result',
              resourceType: 'text',
              title: 'Generated Result',
            },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      resources: {
        res_prompt: {
          id: 'res_prompt',
          type: 'text',
          name: 'Prompt',
          value: 'sunlit kitchen',
          source: { kind: 'manual_input' },
          metadata: { createdAt: '2026-06-25T00:00:00.000Z' },
        },
        res_result: {
          id: 'res_result',
          type: 'text',
          name: 'Generated Result',
          value: 'rendered text',
          source: {
            kind: 'function_output',
            taskId: 'task_result_inspect',
            functionNodeId: 'node_function',
            outputKey: 'text',
          },
          metadata: { createdAt: '2026-06-25T00:00:10.000Z' },
        },
      },
      tasks: {
        task_result_inspect: {
          id: 'task_result_inspect',
          functionNodeId: 'node_function',
          functionId: 'fn_render',
          runIndex: 1,
          runTotal: 1,
          status: 'succeeded',
          inputRefs: {},
          inputSnapshot: {},
          inputValuesSnapshot: {
            prompt: {
              key: 'prompt',
              label: 'Prompt',
              type: 'text',
              required: true,
              source: 'resource',
              resourceId: 'res_prompt',
              resourceName: 'Prompt',
              value: 'sunlit kitchen',
            },
          },
          paramsSnapshot: {},
          workflowTemplateSnapshot: {},
          compiledWorkflowSnapshot: {
            '6': {
              class_type: 'CLIPTextEncode',
              inputs: { text: 'sunlit kitchen' },
            },
          },
          seedPatchLog: [],
          outputRefs: {},
          createdAt: '2026-06-25T00:00:01.000Z',
          startedAt: '2026-06-25T00:00:02.000Z',
          updatedAt: '2026-06-25T00:00:11.000Z',
          completedAt: '2026-06-25T00:00:11.000Z',
        },
      },
      functions: {
        fn_render: {
          id: 'fn_render',
          name: 'Render',
          type: 'comfyui',
          description: '',
          workflow: { format: 'comfyui_api_json', rawJson: {} },
          inputs: [],
          outputs: [],
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z',
        },
      },
    }
    projectStore.setState({
      project: runProject,
      selectedNodeId: undefined,
      selectedNodeIds: [],
    } as Partial<ReturnType<typeof projectStore.getState>>)
    const onFocusNode = vi.fn()
    const resultNode = runProject.canvas.nodes.find((node) => node.id === 'node_result_inspect')
    expect(resultNode).toBeDefined()

    render(
      <AssetInspectorDialog
        project={runProject}
        inspectedNode={resultNode!}
        inspectedResources={[runProject.resources.res_result!]}
        inspectedTask={runProject.tasks.task_result_inspect}
        previewResource={undefined}
        onPreviewResourceChange={vi.fn()}
        onClose={vi.fn()}
        onFocusNode={onFocusNode}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: /Inspector|查看/ })
    expect(within(dialog).getByRole('heading', { name: 'Run Details' })).toBeVisible()
    expect(within(dialog).getByRole('heading', { name: 'Inputs' })).toBeVisible()
    expect(within(dialog).getByRole('textbox', { name: 'Input value Prompt' })).toHaveValue('sunlit kitchen')
    expect(within(dialog).getByRole('heading', { name: 'Final Workflow' })).toBeVisible()
    expect(within(dialog).getByText(/CLIPTextEncode/)).toBeVisible()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Locate Prompt node' }))
    expect(onFocusNode).toHaveBeenCalledWith('node_prompt')
  })

  it('keeps group nodes below assets and orders assets by selection recency before creation time', () => {
    const nodes: CanvasNode[] = [
      { id: 'node_old', type: 'resource', position: { x: 0, y: 0 }, data: { resourceId: 'res_old' } },
      { id: 'node_new', type: 'resource', position: { x: 20, y: 20 }, data: { resourceId: 'res_new' } },
      {
        id: 'node_group',
        type: 'group',
        position: { x: -20, y: -20 },
        data: { childNodeIds: ['node_old', 'node_new'], createdAt: '2026-06-25T00:00:03.000Z' },
      },
    ]
    const resources: Record<string, Resource> = {
      res_old: {
        id: 'res_old',
        type: 'image',
        value: 'old',
        source: { kind: 'manual_input' },
        metadata: { createdAt: '2026-06-25T00:00:01.000Z' },
      },
      res_new: {
        id: 'res_new',
        type: 'image',
        value: 'new',
        source: { kind: 'manual_input' },
        metadata: { createdAt: '2026-06-25T00:00:02.000Z' },
      },
    }

    const createdOrderZIndexById = buildCanvasNodeZIndexMap(nodes, resources)

    expect(createdOrderZIndexById.get('node_new')).toBeGreaterThan(createdOrderZIndexById.get('node_old') ?? 0)

    const zIndexById = buildCanvasNodeZIndexMap(nodes, resources, { node_old: 1 })

    expect(zIndexById.get('node_group')).toBeLessThan(zIndexById.get('node_new') ?? 0)
    expect(zIndexById.get('node_new')).toBeGreaterThan(zIndexById.get('node_group') ?? 0)
    expect(zIndexById.get('node_old')).toBeGreaterThan(zIndexById.get('node_new') ?? 0)
  })

  it('treats edge selection changes as non-structural when deciding whether to resync flow edges', () => {
    const structuralEdges: Edge[] = [
      {
        id: 'input:node_prompt:node_render:prompt',
        source: 'node_prompt',
        sourceHandle: 'resource:res_prompt',
        target: 'node_render',
        targetHandle: 'input:prompt',
        label: 'prompt',
        type: 'default',
        className: 'input-edge',
      },
    ]
    const selectedOnlyEdges: Edge[] = structuralEdges.map((edge) => ({ ...edge, selected: true }))

    expect(sameFlowEdgesForSync(structuralEdges, selectedOnlyEdges)).toBe(true)
  })

  it('highlights group children as related nodes and expands their graph chain from a group double click', async () => {
    const groupedProject: ProjectState = {
      ...originalProject,
      project: { ...originalProject.project, id: 'project_group_highlight' },
      canvas: {
        nodes: [
          { id: 'node_prompt', type: 'resource', position: { x: 0, y: 0 }, data: { resourceId: 'res_prompt', title: 'Prompt' } },
          { id: 'node_result', type: 'resource', position: { x: 320, y: 0 }, data: { resourceId: 'res_result', title: 'Result' } },
          { id: 'node_external', type: 'resource', position: { x: 640, y: 0 }, data: { resourceId: 'res_external', title: 'External' } },
          {
            id: 'node_group',
            type: 'group',
            position: { x: -40, y: -40 },
            data: {
              title: 'Render Group',
              childNodeIds: ['node_prompt', 'node_result'],
              size: { width: 620, height: 260 },
              color: '#14b8a6',
            },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      resources: {
        res_prompt: { id: 'res_prompt', type: 'text', name: 'Prompt', value: 'warm interior', source: { kind: 'manual_input' } },
        res_result: {
          id: 'res_result',
          type: 'image',
          name: 'Result',
          value: {
            assetId: 'asset_result',
            url: 'data:image/png;base64,result',
            filename: 'result.png',
            mimeType: 'image/png',
            sizeBytes: 24,
          },
          source: { kind: 'function_output', taskId: 'task_render', outputKey: 'image' },
        },
        res_external: {
          id: 'res_external',
          type: 'image',
          name: 'External',
          value: {
            assetId: 'asset_external',
            url: 'data:image/png;base64,external',
            filename: 'external.png',
            mimeType: 'image/png',
            sizeBytes: 32,
          },
          source: { kind: 'function_output', taskId: 'task_upscale', outputKey: 'image' },
        },
      },
      assets: {
        asset_result: {
          id: 'asset_result',
          name: 'result.png',
          mimeType: 'image/png',
          sizeBytes: 24,
          blobUrl: 'data:image/png;base64,result',
          createdAt: '2026-06-25T00:00:00.000Z',
        },
        asset_external: {
          id: 'asset_external',
          name: 'external.png',
          mimeType: 'image/png',
          sizeBytes: 32,
          blobUrl: 'data:image/png;base64,external',
          createdAt: '2026-06-25T00:00:01.000Z',
        },
      },
      tasks: {
        task_render: {
          id: 'task_render',
          functionNodeId: 'node_render_hidden',
          functionId: 'fn_render',
          runIndex: 1,
          runTotal: 1,
          status: 'succeeded',
          inputRefs: { prompt: { resourceId: 'res_prompt', type: 'text' } },
          inputSnapshot: {},
          inputValuesSnapshot: {},
          paramsSnapshot: {},
          workflowTemplateSnapshot: {},
          compiledWorkflowSnapshot: {},
          seedPatchLog: [],
          outputRefs: { image: [{ resourceId: 'res_result', type: 'image' }] },
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z',
          completedAt: '2026-06-25T00:00:00.000Z',
        },
        task_upscale: {
          id: 'task_upscale',
          functionNodeId: 'node_upscale_hidden',
          functionId: 'fn_upscale',
          runIndex: 1,
          runTotal: 1,
          status: 'succeeded',
          inputRefs: { image: { resourceId: 'res_result', type: 'image' } },
          inputSnapshot: {},
          inputValuesSnapshot: {},
          paramsSnapshot: {},
          workflowTemplateSnapshot: {},
          compiledWorkflowSnapshot: {},
          seedPatchLog: [],
          outputRefs: { image: [{ resourceId: 'res_external', type: 'image' }] },
          createdAt: '2026-06-25T00:00:01.000Z',
          updatedAt: '2026-06-25T00:00:01.000Z',
          completedAt: '2026-06-25T00:00:01.000Z',
        },
      },
      functions: {},
    }
    projectStore.setState({
      project: groupedProject,
      selectedNodeId: undefined,
      selectedNodeIds: [],
    } as Partial<ReturnType<typeof projectStore.getState>>)

    const { container } = render(<CanvasWorkspace />)
    const groupNode = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('.react-flow__node[data-id="node_group"]')
      expect(element).not.toBeNull()
      return element!
    })
    const promptNode = container.querySelector<HTMLElement>('.react-flow__node[data-id="node_prompt"]')!
    const resultNode = container.querySelector<HTMLElement>('.react-flow__node[data-id="node_result"]')!
    const externalNode = container.querySelector<HTMLElement>('.react-flow__node[data-id="node_external"]')!

    fireEvent.click(groupNode)

    await waitFor(() => expect(groupNode).toHaveClass('selection-primary'))
    expect(promptNode).toHaveClass('selection-related')
    expect(resultNode).toHaveClass('selection-related')
    expect(externalNode).toHaveClass('selection-dimmed')

    fireEvent.doubleClick(groupNode)

    await waitFor(() => expect(externalNode).toHaveClass('selection-related'))
    expect(promptNode).toHaveClass('selection-related')
    expect(resultNode).toHaveClass('selection-related')
  })

  it('groups the active node selection with Ctrl+G', async () => {
    const shortcutProject: ProjectState = {
      ...originalProject,
      project: { ...originalProject.project, id: 'project_group_shortcut' },
      canvas: {
        nodes: [
          { id: 'node_prompt', type: 'resource', position: { x: 0, y: 0 }, data: { resourceId: 'res_prompt', title: 'Prompt' } },
          { id: 'node_result', type: 'resource', position: { x: 360, y: 0 }, data: { resourceId: 'res_result', title: 'Result' } },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      resources: {
        res_prompt: { id: 'res_prompt', type: 'text', name: 'Prompt', value: 'warm interior', source: { kind: 'manual_input' } },
        res_result: { id: 'res_result', type: 'text', name: 'Result', value: 'rendered', source: { kind: 'manual_input' } },
      },
      tasks: {},
      functions: {},
    }
    projectStore.setState({
      project: shortcutProject,
      selectedNodeId: 'node_result',
      selectedNodeIds: ['node_prompt', 'node_result'],
    } as Partial<ReturnType<typeof projectStore.getState>>)

    const { container } = render(<CanvasWorkspace />)
    await waitFor(() => {
      expect(container.querySelector('.react-flow__node[data-id="node_prompt"]')).not.toBeNull()
      expect(container.querySelector('.react-flow__node[data-id="node_result"]')).not.toBeNull()
    })

    fireEvent.keyDown(window, { key: 'g', code: 'KeyG', ctrlKey: true })

    const groupNode = await waitFor(() => {
      const node = projectStore.getState().project.canvas.nodes.find((item) => item.type === 'group')
      expect(node).toBeDefined()
      return node!
    })
    expect(groupNode.data.childNodeIds).toEqual(['node_prompt', 'node_result'])
    expect(projectStore.getState().selectedNodeIds).toEqual([groupNode.id])

    await waitFor(() => {
      const groupElement = container.querySelector<HTMLElement>(`.react-flow__node[data-id="${groupNode.id}"]`)
      expect(groupElement).not.toBeNull()
      expect(groupElement).toHaveClass('selected')
    })
    expect(container.querySelector('.react-flow__node[data-id="node_prompt"]')).not.toHaveClass('selected')
    expect(container.querySelector('.react-flow__node[data-id="node_result"]')).not.toHaveClass('selected')
  })

  it('clears a selected group from an empty click inside the group body without reselecting it', async () => {
    const groupedProject: ProjectState = {
      ...originalProject,
      project: { ...originalProject.project, id: 'project_group_empty_click_clear' },
      canvas: {
        nodes: [
          { id: 'node_prompt', type: 'resource', position: { x: 0, y: 0 }, data: { resourceId: 'res_prompt', title: 'Prompt' } },
          { id: 'node_result', type: 'resource', position: { x: 320, y: 0 }, data: { resourceId: 'res_result', title: 'Result' } },
          {
            id: 'node_group',
            type: 'group',
            position: { x: -40, y: -40 },
            data: {
              title: 'Render Group',
              childNodeIds: ['node_prompt', 'node_result'],
              size: { width: 620, height: 260 },
              color: '#14b8a6',
            },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      resources: {
        res_prompt: { id: 'res_prompt', type: 'text', name: 'Prompt', value: 'warm interior', source: { kind: 'manual_input' } },
        res_result: {
          id: 'res_result',
          type: 'image',
          name: 'Result',
          value: {
            assetId: 'asset_result',
            url: 'data:image/png;base64,result',
            filename: 'result.png',
            mimeType: 'image/png',
            sizeBytes: 24,
          },
          source: { kind: 'function_output', taskId: 'task_render', outputKey: 'image' },
        },
      },
      assets: {
        asset_result: {
          id: 'asset_result',
          name: 'result.png',
          mimeType: 'image/png',
          sizeBytes: 24,
          blobUrl: 'data:image/png;base64,result',
          createdAt: '2026-06-25T00:00:00.000Z',
        },
      },
      tasks: {},
      functions: {},
    }
    projectStore.setState({
      project: groupedProject,
      selectedNodeId: undefined,
      selectedNodeIds: [],
    } as Partial<ReturnType<typeof projectStore.getState>>)

    const { container } = render(<CanvasWorkspace />)
    const groupNode = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('.react-flow__node[data-id="node_group"]')
      expect(element).not.toBeNull()
      return element!
    })
    const promptNode = container.querySelector<HTMLElement>('.react-flow__node[data-id="node_prompt"]')!
    const resultNode = container.querySelector<HTMLElement>('.react-flow__node[data-id="node_result"]')!

    fireEvent.click(groupNode)

    await waitFor(() => expect(groupNode).toHaveClass('selection-primary'))
    expect(promptNode).toHaveClass('selection-related')
    expect(resultNode).toHaveClass('selection-related')

    fireEvent.click(groupNode, { clientX: 120, clientY: 220 })

    await waitFor(() => expect(groupNode).not.toHaveClass('selection-primary'))
    expect(promptNode).not.toHaveClass('selection-related')
    expect(resultNode).not.toHaveClass('selection-related')
    expect(projectStore.getState().selectedNodeId).toBeUndefined()
    expect(projectStore.getState().selectedNodeIds).toEqual([])
  })

  it('highlights direct graph relations first, expands the full chain, and clears it from an empty canvas click', async () => {
    const chainedProject: ProjectState = {
      ...originalProject,
      project: { ...originalProject.project, id: 'project_selection_highlight' },
      canvas: {
        nodes: [
          { id: 'node_a', type: 'resource', position: { x: 0, y: 0 }, data: { resourceId: 'res_a', title: 'A' } },
          { id: 'node_b', type: 'resource', position: { x: 320, y: 0 }, data: { resourceId: 'res_b', title: 'B' } },
          { id: 'node_c', type: 'resource', position: { x: 640, y: 0 }, data: { resourceId: 'res_c', title: 'C' } },
          { id: 'node_d', type: 'resource', position: { x: 960, y: 0 }, data: { resourceId: 'res_d', title: 'D' } },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      resources: {
        res_a: { id: 'res_a', type: 'text', name: 'A', value: 'a', source: { kind: 'manual_input' } },
        res_b: { id: 'res_b', type: 'text', name: 'B', value: 'b', source: { kind: 'function_output', taskId: 'task_ab', outputKey: 'text' } },
        res_c: { id: 'res_c', type: 'text', name: 'C', value: 'c', source: { kind: 'function_output', taskId: 'task_bc', outputKey: 'text' } },
        res_d: { id: 'res_d', type: 'text', name: 'D', value: 'd', source: { kind: 'function_output', taskId: 'task_cd', outputKey: 'text' } },
      },
      tasks: {
        task_ab: {
          id: 'task_ab',
          functionNodeId: 'fn_hidden_ab',
          functionId: 'fn_text',
          runIndex: 1,
          runTotal: 1,
          status: 'succeeded',
          inputRefs: { text: { resourceId: 'res_a', type: 'text' } },
          inputSnapshot: {},
          inputValuesSnapshot: {},
          paramsSnapshot: {},
          workflowTemplateSnapshot: {},
          compiledWorkflowSnapshot: {},
          seedPatchLog: [],
          outputRefs: { text: [{ resourceId: 'res_b', type: 'text' }] },
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z',
        },
        task_bc: {
          id: 'task_bc',
          functionNodeId: 'fn_hidden_bc',
          functionId: 'fn_text',
          runIndex: 1,
          runTotal: 1,
          status: 'succeeded',
          inputRefs: { text: { resourceId: 'res_b', type: 'text' } },
          inputSnapshot: {},
          inputValuesSnapshot: {},
          paramsSnapshot: {},
          workflowTemplateSnapshot: {},
          compiledWorkflowSnapshot: {},
          seedPatchLog: [],
          outputRefs: { text: [{ resourceId: 'res_c', type: 'text' }] },
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z',
        },
        task_cd: {
          id: 'task_cd',
          functionNodeId: 'fn_hidden_cd',
          functionId: 'fn_text',
          runIndex: 1,
          runTotal: 1,
          status: 'succeeded',
          inputRefs: { text: { resourceId: 'res_c', type: 'text' } },
          inputSnapshot: {},
          inputValuesSnapshot: {},
          paramsSnapshot: {},
          workflowTemplateSnapshot: {},
          compiledWorkflowSnapshot: {},
          seedPatchLog: [],
          outputRefs: { text: [{ resourceId: 'res_d', type: 'text' }] },
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z',
        },
      },
    }
    projectStore.setState({
      project: chainedProject,
      selectedNodeId: undefined,
      selectedNodeIds: [],
    } as Partial<ReturnType<typeof projectStore.getState>>)

    const { container } = render(<CanvasWorkspace />)

    const nodeB = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('.react-flow__node[data-id="node_b"]')
      expect(element).not.toBeNull()
      return element!
    })
    const nodeA = container.querySelector<HTMLElement>('.react-flow__node[data-id="node_a"]')!
    const nodeC = container.querySelector<HTMLElement>('.react-flow__node[data-id="node_c"]')!
    const nodeD = container.querySelector<HTMLElement>('.react-flow__node[data-id="node_d"]')!

    fireEvent.click(nodeB)

    await waitFor(() => expect(nodeB).toHaveClass('selection-primary'))
    expect(nodeA).toHaveClass('selection-related')
    expect(nodeC).toHaveClass('selection-related')
    expect(nodeD).toHaveClass('selection-dimmed')

    fireEvent.doubleClick(nodeB)

    await waitFor(() => expect(nodeD).toHaveClass('selection-related'))
    expect(nodeB).toHaveClass('selection-primary')

    const pane = container.querySelector<HTMLElement>('.react-flow__pane')
    expect(pane).not.toBeNull()
    fireEvent.click(pane!)

    await waitFor(() => expect(nodeB).not.toHaveClass('selection-primary'))
    expect(nodeA).not.toHaveClass('selection-related')
    expect(nodeC).not.toHaveClass('selection-related')
    expect(nodeD).not.toHaveClass('selection-related')
    expect(projectStore.getState().selectedNodeId).toBeUndefined()
    expect(projectStore.getState().selectedNodeIds).toEqual([])
  })

  it('clears expanded graph highlights as soon as an empty canvas press starts', async () => {
    const chainedProject: ProjectState = {
      ...originalProject,
      project: { ...originalProject.project, id: 'project_selection_mousedown_clear' },
      canvas: {
        nodes: [
          { id: 'node_a', type: 'resource', position: { x: 0, y: 0 }, data: { resourceId: 'res_a', title: 'A' } },
          { id: 'node_b', type: 'resource', position: { x: 320, y: 0 }, data: { resourceId: 'res_b', title: 'B' } },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      resources: {
        res_a: { id: 'res_a', type: 'text', name: 'A', value: 'a', source: { kind: 'manual_input' } },
        res_b: { id: 'res_b', type: 'text', name: 'B', value: 'b', source: { kind: 'function_output', taskId: 'task_ab', outputKey: 'text' } },
      },
      tasks: {
        task_ab: {
          id: 'task_ab',
          functionNodeId: 'fn_hidden_ab',
          functionId: 'fn_text',
          runIndex: 1,
          runTotal: 1,
          status: 'succeeded',
          inputRefs: { text: { resourceId: 'res_a', type: 'text' } },
          inputSnapshot: {},
          inputValuesSnapshot: {},
          paramsSnapshot: {},
          workflowTemplateSnapshot: {},
          compiledWorkflowSnapshot: {},
          seedPatchLog: [],
          outputRefs: { text: [{ resourceId: 'res_b', type: 'text' }] },
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z',
        },
      },
    }
    projectStore.setState({
      project: chainedProject,
      selectedNodeId: undefined,
      selectedNodeIds: [],
    } as Partial<ReturnType<typeof projectStore.getState>>)

    const { container } = render(<CanvasWorkspace />)
    const nodeB = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('.react-flow__node[data-id="node_b"]')
      expect(element).not.toBeNull()
      return element!
    })

    fireEvent.click(nodeB)
    fireEvent.doubleClick(nodeB)
    await waitFor(() => expect(nodeB).toHaveClass('selection-primary'))

    fireEvent.mouseDown(screen.getByLabelText('Canvas'))

    await waitFor(() => expect(nodeB).not.toHaveClass('selection-primary'))
    expect(projectStore.getState().selectedNodeId).toBeUndefined()
    expect(projectStore.getState().selectedNodeIds).toEqual([])
  })

  it('persists ordinary mouse clicks on a boolean resource checkbox and records undoable history', async () => {
    const nodeId = projectStore.getState().addEmptyResourceAtPosition('boolean', { x: 120, y: 160 }, false)
    expect(nodeId).toBeDefined()
    const resourceId = String(
      projectStore.getState().project.canvas.nodes.find((node) => node.id === nodeId)?.data.resourceId ?? '',
    )
    expect(resourceId).not.toBe('')
    const initialHistoryLength = projectStore.getState().project.history?.undoStack.length ?? 0
    projectStore.setState({ selectedNodeId: undefined, selectedNodeIds: [] })

    const { container } = render(<CanvasWorkspace />)
    const booleanNode = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(`.react-flow__node[data-id="${nodeId}"]`)
      expect(element).not.toBeNull()
      return element!
    })
    booleanNode.style.visibility = 'visible'
    const checkbox = within(booleanNode).getByRole('checkbox', { name: 'Boolean value' })
    const clickWithPrimaryMouse = () => {
      fireEvent.pointerDown(checkbox, { button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse' })
      fireEvent.mouseDown(checkbox, { button: 0, buttons: 1 })
      checkbox.focus()
      fireEvent.pointerUp(checkbox, { button: 0, buttons: 0, pointerId: 1, pointerType: 'mouse' })
      fireEvent.mouseUp(checkbox, { button: 0, buttons: 0 })
      fireEvent.click(checkbox, { button: 0 })
    }

    expect(checkbox).not.toBeChecked()
    expect(within(booleanNode).getByText('false')).toBeVisible()

    clickWithPrimaryMouse()

    await waitFor(() => {
      expect(checkbox).toBeChecked()
      expect(within(booleanNode).getByText('true')).toBeVisible()
      expect(projectStore.getState().project.resources[resourceId]?.value).toBe(true)
      expect(projectStore.getState().selectedNodeId).toBeUndefined()
      expect(projectStore.getState().selectedNodeIds).toEqual([])
      expect(projectStore.getState().project.history?.undoStack).toHaveLength(initialHistoryLength + 1)
    })

    clickWithPrimaryMouse()

    await waitFor(() => {
      expect(checkbox).not.toBeChecked()
      expect(within(booleanNode).getByText('false')).toBeVisible()
      expect(projectStore.getState().project.resources[resourceId]?.value).toBe(false)
      expect(projectStore.getState().project.history?.undoStack).toHaveLength(initialHistoryLength + 2)
    })

    projectStore.getState().undoLastProjectChange()
    await waitFor(() => expect(projectStore.getState().project.resources[resourceId]?.value).toBe(true))
    projectStore.getState().undoLastProjectChange()
    await waitFor(() => expect(projectStore.getState().project.resources[resourceId]?.value).toBe(false))
  })

  it('keeps text display controls isolated from canvas selection while their interactions still succeed', async () => {
    const nodeId = projectStore.getState().addTextResourceAtPosition('Prompt', '# Initial heading', { x: 160, y: 180 })
    const resourceId = String(
      projectStore.getState().project.canvas.nodes.find((node) => node.id === nodeId)?.data.resourceId ?? '',
    )
    expect(resourceId).not.toBe('')
    projectStore.setState({ selectedNodeId: undefined, selectedNodeIds: [] })

    const { container } = render(<CanvasWorkspace />)
    const textNode = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(`.react-flow__node[data-id="${nodeId}"]`)
      expect(element).not.toBeNull()
      return element!
    })
    const showTextNode = () => {
      textNode.style.visibility = 'visible'
      return within(textNode)
    }
    const expectCanvasSelectionUnchanged = () => {
      expect.soft(projectStore.getState().selectedNodeId).toBeUndefined()
      expect.soft(projectStore.getState().selectedNodeIds).toEqual([])
      projectStore.setState({ selectedNodeId: undefined, selectedNodeIds: [] })
    }
    const clickWithPrimaryMouse = (target: HTMLElement) => {
      fireEvent.pointerDown(target, { button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse' })
      fireEvent.mouseDown(target, { button: 0, buttons: 1 })
      target.focus()
      fireEvent.pointerUp(target, { button: 0, buttons: 0, pointerId: 1, pointerType: 'mouse' })
      fireEvent.mouseUp(target, { button: 0, buttons: 0 })
      fireEvent.click(target, { button: 0, detail: 1 })
    }
    const chooseDisplayMode = (select: HTMLSelectElement, value: string) => {
      const option = within(select).getByRole('option', { name: value })
      clickWithPrimaryMouse(select)
      fireEvent.pointerDown(option, { button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse' })
      fireEvent.mouseDown(option, { button: 0, buttons: 1 })
      fireEvent.input(select, { target: { value } })
      fireEvent.change(select, { target: { value } })
      fireEvent.mouseUp(option, { button: 0, buttons: 0 })
      fireEvent.click(option, { button: 0, detail: 1 })
    }

    const displayMode = showTextNode().getByRole('combobox', { name: 'Prompt display mode' }) as HTMLSelectElement
    clickWithPrimaryMouse(displayMode)
    expectCanvasSelectionUnchanged()

    chooseDisplayMode(displayMode, 'markdown')
    await waitFor(() => {
      expect(displayMode).toHaveValue('markdown')
      expect(projectStore.getState().project.resources[resourceId]).toMatchObject({ displayMode: 'markdown' })
      expectCanvasSelectionUnchanged()
    })

    const source = showTextNode().getByRole('textbox', { name: 'Prompt source' }) as HTMLTextAreaElement
    clickWithPrimaryMouse(source)
    expectCanvasSelectionUnchanged()
    fireEvent.keyDown(source, { key: 'a', code: 'KeyA', ctrlKey: true })
    fireEvent.input(source, { target: { value: '# Updated heading' } })
    fireEvent.keyUp(source, { key: 'a', code: 'KeyA', ctrlKey: true })
    fireEvent.blur(source)
    await waitFor(() => {
      expect(projectStore.getState().project.resources[resourceId]?.value).toBe('# Updated heading')
      expect(showTextNode().getByRole('textbox', { name: 'Prompt source' })).toHaveValue('# Updated heading')
      expectCanvasSelectionUnchanged()
    })

    chooseDisplayMode(displayMode, 'render markdown')
    const rendered = await waitFor(() => {
      const region = showTextNode().getByRole('region', { name: 'Prompt rendered markdown' })
      expect(within(region).getByRole('heading', { name: 'Updated heading' })).toBeVisible()
      return region
    })
    clickWithPrimaryMouse(rendered)
    expectCanvasSelectionUnchanged()

    const editSource = showTextNode().getByRole('button', { name: 'Edit source' })
    clickWithPrimaryMouse(editSource)
    await waitFor(() => {
      expect(showTextNode().getByRole('combobox', { name: 'Prompt display mode' })).toHaveValue('markdown')
      expect(showTextNode().getByRole('textbox', { name: 'Prompt source' })).toHaveValue('# Updated heading')
      expectCanvasSelectionUnchanged()
    })
  })
})
