import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasWorkspace, FunctionRunDialog } from './CanvasWorkspace'
import { projectStore } from '../store/projectStore'
import type { GenerationFunction, PrimitiveInputValue, Resource, ResourceRef } from '../domain/types'

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

  const renderFunctionRunDialog = (initialFunction: GenerationFunction) => {
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
})
