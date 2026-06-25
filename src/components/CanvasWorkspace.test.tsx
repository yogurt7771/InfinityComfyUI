import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCanvasNodeZIndexMap, CanvasWorkspace, FunctionRunDialog } from './CanvasWorkspace'
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
    options: { onEditComfyWorkflow?: () => void } = {},
  ) => {
    const onRun = vi.fn()
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
          onClose={vi.fn()}
          onPickInput={vi.fn()}
          onRun={onRun}
          onFunctionDefChange={setFunctionDef}
          onRunCountChange={vi.fn()}
          onValuesChange={setValues}
          onEditComfyWorkflow={options.onEditComfyWorkflow}
        />
      )
    }

    render(<Wrapper />)
    return { onRun }
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
})
