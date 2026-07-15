import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LeftPanel, SettingsPage, highlightedJson } from './WorkbenchPanels'
import { projectStore } from '../store/projectStore'
import type { ProjectState } from '../domain/types'
import { createOpenAIImageFunction } from '../domain/openaiImage'

const panelProject = (): ProjectState => ({
  schemaVersion: '1.0.0',
  project: {
    id: 'project_test',
    name: 'Panel Test',
    createdAt: '2026-05-09T00:00:00.000Z',
    updatedAt: '2026-05-09T00:00:00.000Z',
  },
  canvas: {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  resources: {
    res_text: {
      id: 'res_text',
      type: 'text',
      name: 'Prompt',
      value: 'cinematic modern kitchen with warm daylight and clean cabinetry',
      source: { kind: 'manual_input' },
      metadata: { createdAt: '2026-05-09T00:00:00.000Z' },
    },
    res_image: {
      id: 'res_image',
      type: 'image',
      name: 'Render.png',
      value: {
        assetId: 'asset_image',
        url: 'http://127.0.0.1:27707/view?filename=render.png&type=output',
        filename: 'render.png',
        mimeType: 'image/png',
        sizeBytes: 100,
      },
      source: { kind: 'function_output' },
      metadata: { createdAt: '2026-05-09T00:00:00.000Z' },
    },
  },
  assets: {},
  functions: {
    fn_render: {
      id: 'fn_render',
      name: 'Flux Render',
      description: 'Render workflow',
      category: 'Render',
      workflow: {
        format: 'comfyui_api_json',
        rawJson: {
          '6': { class_type: 'CLIPTextEncode', _meta: { title: 'Positive Prompt' }, inputs: { text: 'warm' } },
          '7': { class_type: 'CLIPTextEncode', _meta: { title: 'Negative Prompt' }, inputs: { text: 'low quality' } },
          '20': { class_type: 'SaveImage', _meta: { title: 'Result_Image' }, inputs: { filename_prefix: 'render' } },
        },
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
      runtimeDefaults: {
        runCount: 1,
        seedPolicy: { mode: 'randomize_all_before_submit' },
      },
      createdAt: '2026-05-09T00:00:00.000Z',
      updatedAt: '2026-05-09T00:00:00.000Z',
    },
  },
  tasks: {
    task_running: {
      id: 'task_running',
      functionNodeId: 'node_fn_render',
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
      endpointId: 'endpoint_local',
      outputRefs: {},
      createdAt: '2026-05-09T00:00:00.000Z',
      updatedAt: '2026-05-09T00:00:00.000Z',
    },
  },
  comfy: {
    endpoints: [
      {
        id: 'endpoint_local',
        name: 'Local ComfyUI',
        baseUrl: 'http://127.0.0.1:27707',
        enabled: true,
        maxConcurrentJobs: 2,
        priority: 10,
        timeoutMs: 600000,
        auth: { type: 'none' },
        health: { status: 'online' },
      },
    ],
    scheduler: {
      strategy: 'least_busy',
      retry: { maxAttempts: 1, fallbackToOtherEndpoint: true },
    },
  },
})

const replacementApiWorkflow = {
  '30': { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 768, batch_size: 1 } },
  '40': { class_type: 'SaveImage', inputs: { images: ['30', 0], filename_prefix: 'replacement' } },
}

const openCancelledExistingWorkflowImport = () => {
  const state = panelProject()
  state.functions.fn_render.workflow = {
    ...structuredClone(state.functions.fn_render.workflow),
    uiJson: { nodes: [{ id: 6, type: 'CLIPTextEncode' }], links: [] },
    editor: {
      kind: 'comfyui_browser',
      endpointId: 'endpoint_local',
      baseUrl: 'http://127.0.0.1:27707',
      savedAt: '2026-05-09T00:00:00.000Z',
    },
  }
  const savedWorkflow = structuredClone(state.functions.fn_render.workflow)
  projectStore.setState({
    project: state,
    projectLibrary: { [state.project.id]: state },
    selectedNodeId: undefined,
    selectedNodeIds: [],
  } as unknown as Partial<ReturnType<typeof projectStore.getState>>)

  render(<SettingsPage onClose={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
  const managerDialog = screen.getByRole('dialog', { name: 'Function Management' })
  fireEvent.click(within(managerDialog).getByRole('button', { name: 'Import workflow JSON' }))
  const importDialog = screen.getByRole('dialog', { name: 'Import ComfyUI API workflow JSON' })
  fireEvent.change(within(importDialog).getByRole('textbox', { name: 'ComfyUI API workflow JSON' }), {
    target: { value: JSON.stringify(replacementApiWorkflow) },
  })
  fireEvent.click(within(importDialog).getByRole('button', { name: 'Cancel' }))

  expect(screen.queryByRole('dialog', { name: 'Import ComfyUI API workflow JSON' })).not.toBeInTheDocument()
  return { managerDialog, savedWorkflow }
}

const readBlobText = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')))
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Failed to read Blob')))
    reader.readAsText(blob)
  })

describe('LeftPanel', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    const project = panelProject()
    projectStore.setState({
      project,
      projectLibrary: { [project.project.id]: project },
      selectedNodeId: undefined,
      selectedNodeIds: [],
    } as unknown as Partial<ReturnType<typeof projectStore.getState>>)
  })

  it('wraps highlighted JSON text fragments so React does not warn about missing keys', () => {
    const parts = highlightedJson('{\n  "prompt": "sunlit kitchen",\n  "steps": 20\n}')

    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((part) => typeof part !== 'string')).toBe(true)
  })

  it('shows compact previews for text and image assets', () => {
    render(<LeftPanel />)

    expect(screen.getByRole('button', { name: 'Assets' })).toBeVisible()
    expect(screen.queryByLabelText('Asset list')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Text' })).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('warm kitchen with soft daylight')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Function Management' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ComfyUI Server Management' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Functions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'ComfyUI Servers' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Function list')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('ComfyUI server list')).not.toBeInTheDocument()
    expect(screen.queryByText('Tasks 1')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Packages' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Assets' }))
    const assetList = screen.getByLabelText('Asset list')
    expect(within(assetList).getByText(/cinematic modern kitchen/)).toBeVisible()
    expect(within(assetList).getByRole('img', { name: 'Render.png' })).toHaveAttribute(
      'src',
      'http://127.0.0.1:27707/view?filename=render.png&type=output',
    )
  })

  it('manages functions from the left dock list', () => {
    render(<LeftPanel />)

    expect(screen.getByRole('button', { name: 'Assets' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'History' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Project Tasks' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Run Queue' })).toBeVisible()

    const functionsToggle = screen.getByRole('button', { name: 'Functions' })
    expect(functionsToggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(functionsToggle)

    expect(functionsToggle).toHaveAttribute('aria-expanded', 'true')
    const functionsPopover = screen.getByLabelText('Functions popover')
    expect(within(functionsPopover).getByRole('heading', { name: 'Functions' })).toBeVisible()
    expect(within(functionsPopover).getByRole('button', { name: /new|新建/i })).toBeVisible()

    const functionList = within(functionsPopover).getByLabelText('Function list')
    expect(within(functionList).getByText('Flux Render')).toBeVisible()
    expect(within(functionList).getByRole('button', { name: /edit function flux render/i })).toBeVisible()
    expect(within(functionList).getByRole('button', { name: /delete function flux render/i })).toBeVisible()
    expect(screen.queryByRole('dialog', { name: 'Function Management' })).not.toBeInTheDocument()

    fireEvent.click(within(functionsPopover).getByRole('button', { name: /new|新建/i }))
    const createDialog = screen.getByRole('dialog', { name: /new function/i })
    fireEvent.change(within(createDialog).getByLabelText('Function type'), { target: { value: 'request' } })
    fireEvent.change(within(createDialog).getByLabelText('Function name'), { target: { value: 'Sidebar Request' } })
    fireEvent.change(within(createDialog).getByLabelText('Request URL'), {
      target: { value: 'https://api.example.com/sidebar' },
    })
    fireEvent.change(within(createDialog).getByLabelText('Response parse mode'), { target: { value: 'json' } })
    fireEvent.click(within(createDialog).getByRole('button', { name: /save function/i }))

    expect(within(functionList).getByText('Sidebar Request')).toBeVisible()
    expect(Object.values(projectStore.getState().project.functions).some((fn) => fn.name === 'Sidebar Request')).toBe(true)

    fireEvent.click(within(functionList).getByRole('button', { name: /edit function sidebar request/i }))
    const functionName = screen.getByLabelText('Function name')
    fireEvent.change(functionName, { target: { value: 'Sidebar Request Edited' } })
    fireEvent.blur(functionName)

    expect(Object.values(projectStore.getState().project.functions).some((fn) => fn.name === 'Sidebar Request Edited')).toBe(true)
    expect(within(functionList).getByText('Sidebar Request Edited')).toBeVisible()

    fireEvent.click(within(functionList).getByRole('button', { name: /delete function sidebar request edited/i }))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: /delete function/i })).getByRole('button', {
        name: /^delete( function)?$/i,
      }),
    )

    expect(Object.values(projectStore.getState().project.functions).some((fn) => fn.name === 'Sidebar Request Edited')).toBe(false)
    expect(within(functionList).queryByText('Sidebar Request Edited')).not.toBeInTheDocument()
  })

  it('confirms function deletion in an accessible in-app dialog without invoking browser confirm', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<LeftPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Functions' }))
    const functionList = screen.getByLabelText('Function list')
    const deleteFunction = () => fireEvent.click(
      within(functionList).getByRole('button', { name: /delete function flux render/i }),
    )

    deleteFunction()

    let dialog = screen.getByRole('dialog', { name: /delete function/i })
    expect(within(dialog).getByRole('heading', { name: /delete function/i })).toBeVisible()
    expect(dialog).toHaveTextContent('Flux Render')
    expect(dialog).toHaveTextContent(/delete|remove|cannot be undone/i)
    expect(nativeConfirm).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }))

    expect(projectStore.getState().project.functions.fn_render).toBeDefined()
    expect(screen.queryByRole('dialog', { name: /delete function/i })).not.toBeInTheDocument()

    deleteFunction()
    dialog = screen.getByRole('dialog', { name: /delete function/i })
    fireEvent.click(within(dialog).getByRole('button', { name: /^delete( function)?$/i }))

    expect(projectStore.getState().project.functions.fn_render).toBeUndefined()
    expect(screen.queryByRole('dialog', { name: /delete function/i })).not.toBeInTheDocument()
    expect(nativeConfirm).not.toHaveBeenCalled()
    const newFunction = within(screen.getByLabelText('Functions popover')).getByRole('button', { name: /new|新建/i })
    expect(newFunction).toBeVisible()
    await waitFor(() => expect(newFunction).toHaveFocus())
    expect(document.activeElement).not.toBe(document.body)
  })

  it('opens a single ComfyUI server creation form from the left dock list and only creates on save', () => {
    render(<LeftPanel />)

    const serversToggle = screen.getByRole('button', { name: 'ComfyUI Servers' })
    expect(serversToggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(serversToggle)

    expect(serversToggle).toHaveAttribute('aria-expanded', 'true')
    const serversPopover = screen.getByLabelText('ComfyUI Servers popover')
    expect(within(serversPopover).getByRole('heading', { name: 'ComfyUI Servers' })).toBeVisible()
    expect(within(serversPopover).getByRole('button', { name: /new|新建/i })).toBeVisible()

    const serverList = within(serversPopover).getByLabelText('ComfyUI server list')
    expect(within(serverList).getByText('Local ComfyUI')).toBeVisible()
    expect(within(serverList).getByRole('button', { name: /edit (server|endpoint) local comfyui/i })).toBeVisible()
    expect(within(serverList).getByRole('button', { name: /delete (server|endpoint) local comfyui/i })).toBeVisible()
    expect(screen.queryByRole('dialog', { name: 'ComfyUI Server Management' })).not.toBeInTheDocument()

    fireEvent.click(within(serversPopover).getByRole('button', { name: /new|新建/i }))
    const createDialog = screen.getByRole('dialog', { name: /new comfyui server|create comfyui server/i })

    expect(within(createDialog).queryByLabelText('ComfyUI server list')).not.toBeInTheDocument()
    expect(within(createDialog).getByRole('button', { name: /cancel/i })).toBeVisible()
    expect(within(createDialog).getByRole('button', { name: 'Add server' })).toBeVisible()
    expect(projectStore.getState().project.comfy.endpoints).toHaveLength(1)

    fireEvent.change(within(createDialog).getByLabelText(/(server|endpoint) name/i), {
      target: { value: 'Cancelled ComfyUI' },
    })
    fireEvent.click(within(createDialog).getByRole('button', { name: /cancel/i }))

    expect(screen.queryByRole('dialog', { name: /new comfyui server|create comfyui server/i })).not.toBeInTheDocument()
    expect(projectStore.getState().project.comfy.endpoints).toHaveLength(1)
    expect(within(serverList).queryByText('Cancelled ComfyUI')).not.toBeInTheDocument()

    fireEvent.click(within(serversPopover).getByRole('button', { name: /new|新建/i }))
    const saveDialog = screen.getByRole('dialog', { name: /new comfyui server|create comfyui server/i })
    fireEvent.change(within(saveDialog).getByLabelText(/(server|endpoint) name/i), {
      target: { value: 'Sidebar ComfyUI' },
    })
    fireEvent.change(within(saveDialog).getByLabelText(/url/i), {
      target: { value: 'http://127.0.0.1:8188' },
    })
    expect(projectStore.getState().project.comfy.endpoints).toHaveLength(1)

    fireEvent.click(within(saveDialog).getByRole('button', { name: 'Add server' }))

    expect(projectStore.getState().project.comfy.endpoints).toHaveLength(2)
    expect(projectStore.getState().project.comfy.endpoints[1]).toMatchObject({
      name: 'Sidebar ComfyUI',
      baseUrl: 'http://127.0.0.1:8188',
    })
    expect(within(serverList).getByText('Sidebar ComfyUI')).toBeVisible()

    fireEvent.click(within(serverList).getByRole('button', { name: /delete (server|endpoint) sidebar comfyui/i }))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: /delete comfyui server/i })).getByRole('button', {
        name: /^delete( server)?$/i,
      }),
    )

    expect(projectStore.getState().project.comfy.endpoints).toHaveLength(1)
    expect(within(serverList).queryByText('Sidebar ComfyUI')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assets' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'History' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Project Tasks' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Run Queue' })).toBeVisible()
  })

  it('confirms ComfyUI server deletion in an accessible in-app dialog without invoking browser confirm', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const state = panelProject()
    state.comfy.endpoints.push({
      ...state.comfy.endpoints[0]!,
      id: 'endpoint_remote',
      name: 'Remote ComfyUI',
      baseUrl: 'http://127.0.0.1:8188',
    })
    projectStore.setState({
      project: state,
      projectLibrary: { [state.project.id]: state },
      selectedNodeId: undefined,
      selectedNodeIds: [],
    } as unknown as Partial<ReturnType<typeof projectStore.getState>>)
    render(<LeftPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'ComfyUI Servers' }))
    const serverList = screen.getByLabelText('ComfyUI server list')
    const deleteServer = () => fireEvent.click(
      within(serverList).getByRole('button', { name: /delete (server|endpoint) remote comfyui/i }),
    )

    deleteServer()

    let dialog = screen.getByRole('dialog', { name: /delete comfyui server/i })
    expect(within(dialog).getByRole('heading', { name: /delete comfyui server/i })).toBeVisible()
    expect(dialog).toHaveTextContent('Remote ComfyUI')
    expect(dialog).toHaveTextContent(/delete|remove|cannot be undone/i)
    expect(nativeConfirm).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }))

    expect(projectStore.getState().project.comfy.endpoints).toHaveLength(2)
    expect(screen.queryByRole('dialog', { name: /delete comfyui server/i })).not.toBeInTheDocument()

    deleteServer()
    dialog = screen.getByRole('dialog', { name: /delete comfyui server/i })
    fireEvent.click(within(dialog).getByRole('button', { name: /^delete( server)?$/i }))

    expect(projectStore.getState().project.comfy.endpoints).toHaveLength(1)
    expect(projectStore.getState().project.comfy.endpoints.some((endpoint) => endpoint.id === 'endpoint_remote')).toBe(false)
    expect(screen.queryByRole('dialog', { name: /delete comfyui server/i })).not.toBeInTheDocument()
    expect(nativeConfirm).not.toHaveBeenCalled()
    const newServer = within(screen.getByLabelText('ComfyUI Servers popover')).getByRole('button', { name: /new|新建/i })
    expect(newServer).toBeVisible()
    await waitFor(() => expect(newServer).toHaveFocus())
    expect(document.activeElement).not.toBe(document.body)
  })

  it('refuses ComfyUI server deletion when a task becomes active after the confirmation opens', () => {
    const state = panelProject()
    state.comfy.endpoints.push({
      ...state.comfy.endpoints[0]!,
      id: 'endpoint_remote',
      name: 'Remote ComfyUI',
      baseUrl: 'http://127.0.0.1:8188',
    })
    projectStore.setState({
      project: state,
      projectLibrary: { [state.project.id]: state },
      selectedNodeId: undefined,
      selectedNodeIds: [],
    } as unknown as Partial<ReturnType<typeof projectStore.getState>>)
    render(<LeftPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'ComfyUI Servers' }))
    const serverList = screen.getByLabelText('ComfyUI server list')
    fireEvent.click(
      within(serverList).getByRole('button', { name: /delete (server|endpoint) remote comfyui/i }),
    )
    const dialog = screen.getByRole('dialog', { name: /delete comfyui server/i })

    act(() => {
      const currentProject = projectStore.getState().project
      const nextProject: ProjectState = {
        ...currentProject,
        tasks: {
          ...currentProject.tasks,
          task_remote_race: {
            ...currentProject.tasks.task_running!,
            id: 'task_remote_race',
            endpointId: 'endpoint_remote',
            status: 'running',
            updatedAt: '2026-05-09T00:01:00.000Z',
          },
        },
      }
      projectStore.setState({
        project: nextProject,
        projectLibrary: {
          ...projectStore.getState().projectLibrary,
          [nextProject.project.id]: nextProject,
        },
      } as unknown as Partial<ReturnType<typeof projectStore.getState>>)
    })

    fireEvent.click(within(dialog).getByRole('button', { name: /^delete( server)?$/i }))

    expect(projectStore.getState().project.comfy.endpoints.some((endpoint) => endpoint.id === 'endpoint_remote')).toBe(true)
    expect(within(serverList).getByText('Remote ComfyUI')).toBeVisible()
    expect(document.body).toHaveTextContent(/active task/i)
    expect(document.body).toHaveTextContent(/cannot delete|can't delete|unable to delete|in use/i)
  })

  it('opens a single ComfyUI server edit form from the left dock list and only updates on save', () => {
    const state = panelProject()
    state.comfy.endpoints = [
      state.comfy.endpoints[0]!,
      {
        ...state.comfy.endpoints[0]!,
        id: 'endpoint_remote',
        name: 'Remote ComfyUI',
        baseUrl: 'http://127.0.0.1:8188',
      },
    ]
    projectStore.setState({
      project: state,
      projectLibrary: { [state.project.id]: state },
      selectedNodeId: undefined,
      selectedNodeIds: [],
    } as unknown as Partial<ReturnType<typeof projectStore.getState>>)

    render(<LeftPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'ComfyUI Servers' }))
    const serversPopover = screen.getByLabelText('ComfyUI Servers popover')
    const serverList = within(serversPopover).getByLabelText('ComfyUI server list')

    fireEvent.click(within(serverList).getByRole('button', { name: /edit (server|endpoint) local comfyui/i }))
    const cancelDialog = screen.getByRole('dialog', { name: /edit comfyui server/i })

    expect(within(cancelDialog).queryByLabelText('ComfyUI server list')).not.toBeInTheDocument()
    expect(within(cancelDialog).getByDisplayValue('Local ComfyUI')).toBeVisible()
    expect(within(cancelDialog).queryByText('Remote ComfyUI')).not.toBeInTheDocument()
    expect(within(cancelDialog).getByRole('button', { name: /cancel/i })).toBeVisible()
    expect(within(cancelDialog).getByRole('button', { name: /save/i })).toBeVisible()

    fireEvent.change(within(cancelDialog).getByLabelText(/(server|endpoint) name/i), {
      target: { value: 'Cancelled Local ComfyUI' },
    })
    fireEvent.change(within(cancelDialog).getByLabelText(/url/i), {
      target: { value: 'http://127.0.0.1:9999' },
    })
    fireEvent.click(within(cancelDialog).getByRole('button', { name: /cancel/i }))

    expect(projectStore.getState().project.comfy.endpoints[0]).toMatchObject({
      name: 'Local ComfyUI',
      baseUrl: 'http://127.0.0.1:27707',
    })

    fireEvent.click(within(serverList).getByRole('button', { name: /edit (server|endpoint) local comfyui/i }))
    const saveDialog = screen.getByRole('dialog', { name: /edit comfyui server/i })
    fireEvent.change(within(saveDialog).getByLabelText(/(server|endpoint) name/i), {
      target: { value: 'Saved Local ComfyUI' },
    })
    fireEvent.change(within(saveDialog).getByLabelText(/url/i), {
      target: { value: 'http://127.0.0.1:8189' },
    })
    expect(projectStore.getState().project.comfy.endpoints[0]).toMatchObject({
      name: 'Local ComfyUI',
      baseUrl: 'http://127.0.0.1:27707',
    })

    fireEvent.click(within(saveDialog).getByRole('button', { name: /save/i }))

    expect(projectStore.getState().project.comfy.endpoints[0]).toMatchObject({
      name: 'Saved Local ComfyUI',
      baseUrl: 'http://127.0.0.1:8189',
    })
    expect(within(serverList).getByText('Saved Local ComfyUI')).toBeVisible()
  })

  it('collapses the asset list popover when the pointer leaves the assets dock', () => {
    render(<LeftPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Assets' }))
    expect(screen.getByLabelText('Asset list')).toBeVisible()

    fireEvent.mouseLeave(screen.getByRole('complementary', { name: 'Assets panel' }))

    expect(screen.queryByLabelText('Asset list')).not.toBeInTheDocument()
  })

  it('shows visual operation history with asset previews and undo/redo actions', () => {
    const project = panelProject()
    project.resources.res_image = {
      ...project.resources.res_image,
      source: {
        ...project.resources.res_image.source,
        taskId: 'task_done',
      },
    }
    project.tasks.task_done = {
      id: 'task_done',
      functionNodeId: 'node_fn_render',
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
      endpointId: 'endpoint_local',
      outputRefs: { image: [{ resourceId: 'res_image', type: 'image' }] },
      createdAt: '2026-05-09T00:00:00.000Z',
      startedAt: '2026-05-09T00:00:00.000Z',
      updatedAt: '2026-05-09T00:00:04.500Z',
      completedAt: '2026-05-09T00:00:04.500Z',
    }
    const projectSnapshot = structuredClone(project)
    delete projectSnapshot.history
    project.history = {
      schemaVersion: '1.0.0',
      undoStack: [
        {
          id: 'history_1',
          label: 'Create image asset',
          transactionType: 'asset',
          createdAt: '2026-05-09T00:00:05.000Z',
          affectedIds: { assetIds: ['res_image'], nodeIds: ['node_image_asset'] },
          preview: {
            title: 'Create image asset',
            subtitle: 'Render.png',
            assetIds: ['res_image'],
            nodeIds: ['node_image_asset'],
          },
          before: projectSnapshot,
          after: projectSnapshot,
        },
      ],
      redoStack: [],
    }
    projectStore.setState({
      project,
      projectLibrary: { [project.project.id]: project },
      selectedNodeId: undefined,
      selectedNodeIds: [],
    } as unknown as Partial<ReturnType<typeof projectStore.getState>>)

    const undoSpy = vi.spyOn(projectStore.getState(), 'undoLastProjectChange')
    const redoSpy = vi.spyOn(projectStore.getState(), 'redoProjectChange')

    render(<LeftPanel />)

    expect(screen.getByRole('button', { name: 'History' })).toBeVisible()
    expect(screen.queryByLabelText('Operation history list')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'History' }))

    const historyList = screen.getByLabelText('Operation history list')
    expect(within(historyList).getByText('Create image asset')).toBeVisible()
    expect(within(historyList).getByText('Render.png')).toBeVisible()
    expect(within(historyList).getByText('#1')).toBeVisible()
    expect(within(historyList).getByText('2026-05-09 00:00:05')).toBeVisible()
    expect(within(historyList).getByText('4.5s')).toBeVisible()
    expect(within(historyList).getByRole('img', { name: 'Render.png' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Undo last operation' }))
    expect(undoSpy).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Redo last operation' }))
    expect(redoSpy).toHaveBeenCalled()
  })

  it('refreshes the open operation history list after an idle delay', () => {
    vi.useFakeTimers()
    try {
      const project = panelProject()
      const projectSnapshot = structuredClone(project)
      delete projectSnapshot.history
      project.history = {
        schemaVersion: '1.0.0',
        undoStack: [
          {
            id: 'history_1',
            label: 'Create first asset',
            transactionType: 'asset',
            createdAt: '2026-05-09T00:00:00.000Z',
            affectedIds: { assetIds: ['res_image'], nodeIds: [] },
            preview: { title: 'Create first asset', subtitle: 'Render.png', assetIds: ['res_image'] },
            before: projectSnapshot,
            after: projectSnapshot,
          },
        ],
        redoStack: [],
      }
      projectStore.setState({
        project,
        projectLibrary: { [project.project.id]: project },
        selectedNodeId: undefined,
        selectedNodeIds: [],
      } as unknown as Partial<ReturnType<typeof projectStore.getState>>)

      render(<LeftPanel />)
      fireEvent.click(screen.getByRole('button', { name: 'History' }))

      expect(screen.getByText('Create first asset')).toBeVisible()

      const nextProject = structuredClone(project)
      nextProject.history?.undoStack.push({
        id: 'history_2',
        label: 'Create second asset',
        transactionType: 'asset',
        createdAt: '2026-05-09T00:00:05.000Z',
        affectedIds: { assetIds: ['res_text'], nodeIds: [] },
        preview: { title: 'Create second asset', subtitle: 'Prompt', assetIds: ['res_text'] },
        before: projectSnapshot,
        after: projectSnapshot,
      })
      act(() => {
        projectStore.setState({
          project: nextProject,
          projectLibrary: { [nextProject.project.id]: nextProject },
        } as unknown as Partial<ReturnType<typeof projectStore.getState>>)
      })

      expect(screen.queryByText('Create second asset')).not.toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(5000)
      })

      expect(screen.getByText('Create second asset')).toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens asset list resources in a preview modal', () => {
    vi.useFakeTimers()
    try {
      render(<LeftPanel />)

      fireEvent.click(screen.getByRole('button', { name: 'Assets' }))
      fireEvent.click(screen.getByRole('button', { name: /Render\.png/ }))
      act(() => {
        vi.advanceTimersByTime(180)
      })

      expect(screen.getByRole('dialog', { name: 'Preview render.png' })).toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })

  it('double-clicks asset list resources to locate their canvas node without opening the preview modal', () => {
    vi.useFakeTimers()
    try {
      const state = panelProject()
      state.canvas.nodes = [
        {
          id: 'node_result_1',
          type: 'result_group',
          position: { x: 420, y: 0 },
          data: { resources: [{ resourceId: 'res_image', type: 'image' }] },
        },
        {
          id: 'node_image_asset',
          type: 'resource',
          position: { x: 0, y: 0 },
          data: { resourceId: 'res_image' },
        },
      ]
      state.resources.res_image.source = {
        ...state.resources.res_image.source,
        resultGroupNodeId: 'node_result_1',
        functionNodeId: 'node_fn_render',
      }
      projectStore.setState({
        project: state,
        projectLibrary: { [state.project.id]: state },
        selectedNodeId: undefined,
        selectedNodeIds: [],
      } as unknown as Partial<ReturnType<typeof projectStore.getState>>)
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

      render(<LeftPanel />)

      fireEvent.click(screen.getByRole('button', { name: 'Assets' }))
      const assetItem = screen.getByRole('button', { name: /Render\.png/ })
      fireEvent.click(assetItem)
      expect(screen.queryByRole('dialog', { name: 'Preview render.png' })).not.toBeInTheDocument()
      fireEvent.click(assetItem)
      fireEvent.doubleClick(assetItem)

      act(() => {
        vi.runOnlyPendingTimers()
      })

      expect(projectStore.getState().selectedNodeId).toBe('node_result_1')
      expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'infinity-focus-node' }))
      expect(screen.queryByRole('dialog', { name: 'Preview render.png' })).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('manages projects from settings', () => {
    render(<SettingsPage onClose={() => undefined} />)

    const activeProjectSelect = screen.getByRole('combobox', { name: 'Active project' })
    expect(activeProjectSelect).toHaveDisplayValue('Panel Test')

    const projectName = screen.getByLabelText('Project name')
    const projectDescription = screen.getByLabelText('Project description')
    projectName.focus()
    fireEvent.compositionStart(projectName)
    fireEvent.change(projectName, { target: { value: 'bianji' } })
    fireEvent.compositionEnd(projectName)
    fireEvent.change(projectName, { target: { value: 'Edited Panel' } })
    fireEvent.change(projectDescription, { target: { value: 'A renamed project' } })

    expect(document.activeElement).toBe(projectName)

    expect(projectStore.getState().project.project).toMatchObject({
      id: 'project_test',
      name: 'Edited Panel',
      description: 'A renamed project',
    })

    fireEvent.click(screen.getByRole('button', { name: 'New project' }))
    const secondProjectName = screen.getByLabelText('Project name')
    fireEvent.change(secondProjectName, { target: { value: 'Second Board' } })

    expect(projectStore.getState().project.project.name).toBe('Second Board')
    expect(screen.getByRole('combobox', { name: 'Active project' })).toHaveDisplayValue('Second Board')

    fireEvent.change(screen.getByRole('combobox', { name: 'Active project' }), { target: { value: 'project_test' } })

    expect(projectStore.getState().project.project.name).toBe('Edited Panel')
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: /delete project/i })).getByRole('button', {
        name: /^delete( project)?$/i,
      }),
    )

    expect(projectStore.getState().project.project.id).not.toBe('project_test')
    expect(screen.queryByText('Edited Panel')).not.toBeInTheDocument()
  })

  it('confirms Settings project deletion in an accessible in-app dialog without invoking browser confirm', () => {
    const nativeConfirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const projectId = projectStore.getState().project.project.id
    projectStore.getState().createProject({ name: 'Spare Board' })
    projectStore.getState().switchProject(projectId)
    render(<SettingsPage onClose={() => undefined} />)

    const deleteProject = () => fireEvent.click(screen.getByRole('button', { name: 'Delete project' }))
    deleteProject()

    let dialog = screen.getByRole('dialog', { name: /delete project/i })
    expect(within(dialog).getByRole('heading', { name: /delete project/i })).toBeVisible()
    expect(dialog).toHaveTextContent('Panel Test')
    expect(dialog).toHaveTextContent(/delete|remove|cannot be undone/i)
    expect(nativeConfirm).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }))

    expect(projectStore.getState().projectLibrary[projectId]).toBeDefined()
    expect(projectStore.getState().project.project.id).toBe(projectId)
    expect(screen.queryByRole('dialog', { name: /delete project/i })).not.toBeInTheDocument()

    deleteProject()
    dialog = screen.getByRole('dialog', { name: /delete project/i })
    fireEvent.click(within(dialog).getByRole('button', { name: /^delete( project)?$/i }))

    expect(projectStore.getState().projectLibrary[projectId]).toBeUndefined()
    expect(projectStore.getState().project.project.id).not.toBe(projectId)
    expect(screen.queryByRole('dialog', { name: /delete project/i })).not.toBeInTheDocument()
    expect(nativeConfirm).not.toHaveBeenCalled()
  })

  it('opens function management and edits combined searchable workflow bindings without remounting the input', () => {
    render(<SettingsPage onClose={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    const dialog = screen.getByRole('dialog', { name: 'Function Management' })

    expect(within(dialog).queryByRole('button', { name: 'Demo' })).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText('New workflow name')).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText('New workflow JSON')).not.toBeInTheDocument()

    const functionName = within(dialog).getByLabelText('Function name')
    functionName.focus()
    fireEvent.compositionStart(functionName)
    fireEvent.change(functionName, { target: { value: 'xuanran' } })
    fireEvent.compositionEnd(functionName)
    fireEvent.change(functionName, { target: { value: 'Flux Render Edited' } })
    expect(document.activeElement).toBe(functionName)
    expect(projectStore.getState().project.functions.fn_render.name).toBe('Flux Render')
    fireEvent.blur(functionName)
    const inputWorkflowCombo = within(dialog).getByRole('combobox', { name: 'Input workflow field prompt' })
    inputWorkflowCombo.focus()
    fireEvent.change(inputWorkflowCombo, { target: { value: '7 · Negative Prompt / inputs.text' } })
    expect(document.activeElement).toBe(inputWorkflowCombo)
    expect(projectStore.getState().project.functions.fn_render.inputs[0]?.bind.nodeId).toBe('6')
    fireEvent.blur(inputWorkflowCombo)
    fireEvent.change(within(dialog).getByLabelText('Input type prompt'), { target: { value: 'image' } })
    const outputWorkflowCombo = within(dialog).getByRole('combobox', { name: 'Output workflow node image' })
    outputWorkflowCombo.focus()
    fireEvent.change(outputWorkflowCombo, { target: { value: '6 · Positive Prompt' } })
    expect(document.activeElement).toBe(outputWorkflowCombo)
    fireEvent.blur(outputWorkflowCombo)
    fireEvent.change(within(dialog).getByLabelText('Output type image'), { target: { value: 'video' } })

    expect(projectStore.getState().project.functions.fn_render).toMatchObject({
      name: 'Flux Render Edited',
      inputs: [
        expect.objectContaining({
          key: 'prompt',
          type: 'image',
          bind: expect.objectContaining({ nodeId: '7', path: 'inputs.text' }),
        }),
      ],
      outputs: [
        expect.objectContaining({
          key: 'image',
          type: 'video',
          bind: expect.objectContaining({ nodeId: '6', nodeTitle: 'Positive Prompt' }),
        }),
      ],
    })
  })

  it('keeps workflow creation blocked while the embedded ComfyUI editor has not exported a workflow', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as WindowProxy)
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined)
    const state = panelProject()
    state.comfy.endpoints = [
      state.comfy.endpoints[0]!,
      {
        ...state.comfy.endpoints[0]!,
        id: 'endpoint_remote',
        name: 'Remote ComfyUI',
        baseUrl: 'http://127.0.0.1:8188/custom/ui?theme=dark',
        auth: { type: 'password', password: 'remote-editor-password', token: 'remote-editor-token' },
        capabilities: { supportedFunctions: [] },
      },
    ]
    projectStore.setState({
      project: state,
      projectLibrary: { [state.project.id]: state },
      selectedNodeId: undefined,
      selectedNodeIds: [],
    } as unknown as Partial<ReturnType<typeof projectStore.getState>>)

    render(<SettingsPage onClose={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    const managerDialog = screen.getByRole('dialog', { name: 'Function Management' })
    fireEvent.click(within(managerDialog).getByRole('button', { name: 'Function' }))
    const createDialog = screen.getByRole('dialog', { name: 'New Function' })
    fireEvent.change(within(createDialog).getByLabelText('Function name'), { target: { value: 'Kitchen Batch Render' } })
    fireEvent.change(within(createDialog).getByLabelText('New function ComfyUI server'), {
      target: { value: 'endpoint_remote' },
    })
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Edit in ComfyUI' }))

    const editorDialog = screen.getByRole('dialog', { name: 'ComfyUI Workflow Editor' })
    const frameUrl = new URL((within(editorDialog).getByTitle(/^ComfyUI editor\b/) as HTMLIFrameElement).src)
    const targetUrl = new URL(String(frameUrl.searchParams.get('target')))
    expect(frameUrl.origin).toBe('http://127.0.0.1:8188')
    expect(frameUrl.pathname).toBe('/custom/ui/extensions/infinity_comfy_bridge/storage-access.html')
    expect(targetUrl.pathname).toBe('/custom/ui')
    expect(targetUrl.searchParams.get('theme')).toBe('dark')
    expect(targetUrl.searchParams.has('token')).toBe(false)
    expect(frameUrl.href).not.toContain('/__comfy_proxy/')
    expect(frameUrl.href).not.toContain('remote-editor-password')
    expect(openSpy).not.toHaveBeenCalled()
    expect(submitSpy).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(within(createDialog).getByRole('button', { name: 'Save function' })).toBeDisabled()
    expect(Object.values(projectStore.getState().project.functions).some((fn) => fn.name === 'Kitchen Batch Render')).toBe(false)
  })
  it('creates a request function in the new function dialog and edits request bindings', () => {
    render(<SettingsPage onClose={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    const managerDialog = screen.getByRole('dialog', { name: 'Function Management' })

    fireEvent.click(within(managerDialog).getByRole('button', { name: 'Function' }))
    const createDialog = screen.getByRole('dialog', { name: 'New Function' })

    fireEvent.change(within(createDialog).getByLabelText('Function type'), { target: { value: 'request' } })
    fireEvent.change(within(createDialog).getByLabelText('Function name'), { target: { value: 'JSON Request' } })
    fireEvent.change(within(createDialog).getByLabelText('Request URL'), { target: { value: 'https://api.example.com/run' } })
    fireEvent.change(within(createDialog).getByLabelText('Response parse mode'), { target: { value: 'json' } })
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Save function' }))

    expect(screen.queryByRole('dialog', { name: 'New Function' })).not.toBeInTheDocument()
    expect(within(managerDialog).getByLabelText('Function name')).toHaveValue('JSON Request')
    expect(within(managerDialog).getByLabelText('Request URL')).toHaveValue('https://api.example.com/run')
    expect(within(managerDialog).getByLabelText('Request method')).toHaveValue('GET')
    expect(within(managerDialog).getByLabelText('Response parse mode')).toHaveValue('json')
    expect(within(managerDialog).getByLabelText('Response encoding')).toHaveValue('utf-8')

    fireEvent.click(within(managerDialog).getByRole('button', { name: 'Input' }))
    fireEvent.change(within(managerDialog).getByLabelText('Input request target input_1'), {
      target: { value: 'header' },
    })
    const requestKeyInput = within(managerDialog).getByLabelText('Input request key input_1')
    fireEvent.change(requestKeyInput, {
      target: { value: 'Authorization' },
    })
    fireEvent.blur(requestKeyInput)
    fireEvent.click(within(managerDialog).getByRole('button', { name: 'Output' }))
    fireEvent.change(within(managerDialog).getByLabelText('Output extractor output_2'), {
      target: { value: 'response_json_path' },
    })
    const outputExpressionInput = within(managerDialog).getByLabelText('Output expression output_2')
    fireEvent.change(outputExpressionInput, {
      target: { value: '$.data.text' },
    })
    fireEvent.blur(outputExpressionInput)

    const requestFunction = Object.values(projectStore.getState().project.functions).find((fn) => fn.name === 'JSON Request')
    expect(requestFunction).toMatchObject({
      workflow: { format: 'http_request' },
      request: {
        url: 'https://api.example.com/run',
        method: 'GET',
        responseParse: 'json',
        responseEncoding: 'utf-8',
      },
      inputs: [expect.objectContaining({ bind: expect.objectContaining({ requestTarget: 'header', path: 'Authorization' }) })],
      outputs: expect.arrayContaining([
        expect.objectContaining({ extract: expect.objectContaining({ source: 'response_json_path', path: '$.data.text' }) }),
      ]),
    })
  })

  it('closes manager dialogs from the backdrop click and Escape without leaking press or context events', () => {
    const onShellPointerDown = vi.fn()
    const onShellMouseDown = vi.fn()
    const onShellContextMenu = vi.fn()
    render(
      <div onPointerDown={onShellPointerDown} onMouseDown={onShellMouseDown} onContextMenu={onShellContextMenu}>
        <SettingsPage onClose={() => undefined} />
      </div>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    expect(screen.getByRole('dialog', { name: 'Function Management' })).toBeVisible()

    const visibleBackdrops = document.querySelectorAll<HTMLElement>('.modal-backdrop:not(.modal-backdrop-hidden)')
    const backdrop = visibleBackdrops[visibleBackdrops.length - 1]!
    fireEvent.contextMenu(backdrop, { clientX: 80, clientY: 90 })
    expect(onShellContextMenu).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Function Management' })).toBeVisible()

    fireEvent.pointerDown(backdrop, { clientX: 80, clientY: 90 })
    expect(onShellPointerDown).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Function Management' })).toBeVisible()

    fireEvent.mouseDown(backdrop, { clientX: 80, clientY: 90 })
    expect(onShellMouseDown).not.toHaveBeenCalled()

    fireEvent.click(backdrop, { clientX: 80, clientY: 90 })
    expect(screen.queryByRole('dialog', { name: 'Function Management' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    expect(screen.getByRole('dialog', { name: 'Function Management' })).toBeVisible()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Function Management' })).not.toBeInTheDocument()
  })

  it('limits request function media outputs to binary response parsing', () => {
    render(<SettingsPage onClose={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    const managerDialog = screen.getByRole('dialog', { name: 'Function Management' })

    fireEvent.click(within(managerDialog).getByRole('button', { name: 'Function' }))
    const createDialog = screen.getByRole('dialog', { name: 'New Function' })
    fireEvent.change(within(createDialog).getByLabelText('Function type'), { target: { value: 'request' } })
    fireEvent.change(within(createDialog).getByLabelText('Function name'), { target: { value: 'Binary Image Request' } })
    fireEvent.change(within(createDialog).getByLabelText('Response parse mode'), { target: { value: 'binary' } })
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Save function' }))

    expect(within(managerDialog).getByLabelText('Response parse mode')).toHaveValue('binary')
    expect(within(managerDialog).queryByLabelText('Response encoding')).not.toBeInTheDocument()
    const outputType = within(managerDialog).getByLabelText('Output type result')
    expect(within(outputType).getByRole('option', { name: 'image' })).toBeVisible()
    expect(within(outputType).getByRole('option', { name: 'video' })).toBeVisible()
    expect(within(outputType).getByRole('option', { name: 'audio' })).toBeVisible()
    expect(within(outputType).queryByRole('option', { name: 'text' })).not.toBeInTheDocument()
    expect(within(managerDialog).getByLabelText('Output extractor result')).toHaveValue('response_binary')
  })

  it('keeps built-in nodes out of function management', () => {
    const state = panelProject()
    const builtInFunction = createOpenAIImageFunction('2026-05-09T00:00:00.000Z')
    state.functions = {
      [builtInFunction.id]: builtInFunction,
      ...state.functions,
    }
    projectStore.setState({ project: state, selectedNodeId: undefined })

    render(
      <>
        <SettingsPage onClose={() => undefined} />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    const dialog = screen.getByRole('dialog', { name: 'Function Management' })
    const managedList = within(dialog).getByLabelText('Managed function list')

    expect(within(dialog).queryByText('OpenAI Generate Image')).not.toBeInTheDocument()
    expect(within(managedList).getByRole('button', { name: /Flux Render/ })).toBeVisible()
    expect(within(dialog).getByLabelText('Function name')).toHaveValue('Flux Render')
  })

  it('resolves workflow node id and title bindings while keeping invalid edits editable', () => {
    render(<SettingsPage onClose={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    const dialog = screen.getByRole('dialog', { name: 'Function Management' })

    const inputWorkflowCombo = within(dialog).getByRole('combobox', { name: 'Input workflow field prompt' })
    fireEvent.change(inputWorkflowCombo, { target: { value: '20 · Result_Image / inputs.filename_prefix' } })
    fireEvent.blur(inputWorkflowCombo)
    expect(inputWorkflowCombo).toHaveValue('20 · Result_Image / inputs.filename_prefix')
    expect(projectStore.getState().project.functions.fn_render.inputs[0]?.bind).toMatchObject({
      nodeId: '20',
      nodeTitle: 'Result_Image',
      path: 'inputs.filename_prefix',
    })

    const outputWorkflowCombo = within(dialog).getByRole('combobox', { name: 'Output workflow node image' })
    fireEvent.change(outputWorkflowCombo, {
      target: { value: '6 · Positive Prompt' },
    })
    fireEvent.blur(outputWorkflowCombo)
    expect(outputWorkflowCombo).toHaveValue('6 · Positive Prompt')
    expect(projectStore.getState().project.functions.fn_render.outputs[0]?.bind).toMatchObject({
      nodeId: '6',
      nodeTitle: 'Positive Prompt',
    })
    expect(projectStore.getState().project.functions.fn_render.outputs[0]?.bind.path).toBeUndefined()

    fireEvent.change(outputWorkflowCombo, {
      target: { value: 'Missing Output Node' },
    })
    expect(outputWorkflowCombo).toHaveValue('Missing Output Node')
    fireEvent.blur(outputWorkflowCombo)
    expect(outputWorkflowCombo).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByText('Workflow node not found')).toBeVisible()
  })

  it('validates workflow bindings by node id when duplicate node titles exist', () => {
    const state = panelProject()
    state.functions.fn_render = {
      ...state.functions.fn_render,
      workflow: {
        ...state.functions.fn_render.workflow,
        rawJson: {
          '129:127': {
            class_type: 'CLIPTextEncode',
            _meta: { title: 'CLIP Text Encode (Prompt)' },
            inputs: { text: 'wrong prompt' },
          },
          '129:128': {
            class_type: 'CLIPTextEncode',
            _meta: { title: 'CLIP Text Encode (Prompt)' },
            inputs: { text: 'right prompt' },
          },
          '68': {
            class_type: 'SaveVideo',
            _meta: { title: 'Save Video' },
            inputs: { filename_prefix: 'first' },
          },
          '129:122': {
            class_type: 'SaveVideo',
            _meta: { title: 'Save Video' },
            inputs: { filename_prefix: 'second' },
          },
        },
      },
      inputs: [
        {
          key: 'prompt',
          label: 'Prompt',
          type: 'text',
          required: true,
          bind: { nodeId: '129:128', nodeTitle: 'CLIP Text Encode (Prompt)', path: 'inputs.text' },
          upload: { strategy: 'none' },
        },
      ],
      outputs: [
        {
          key: 'video',
          label: 'Video',
          type: 'video',
          bind: { nodeId: '129:122', nodeTitle: 'Save Video' },
          extract: { source: 'history', multiple: true },
        },
      ],
    }
    projectStore.setState({ project: state, selectedNodeId: undefined })

    render(<SettingsPage onClose={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    const dialog = screen.getByRole('dialog', { name: 'Function Management' })
    expect(within(dialog).getByLabelText('Input workflow field prompt')).toHaveValue(
      '129:128 · CLIP Text Encode (Prompt) / inputs.text',
    )
    expect(within(dialog).getByLabelText('Output workflow node video')).toHaveValue('129:122 · Save Video')
    expect(within(dialog).queryByText('Workflow node not found')).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText('Input workflow field prompt')).not.toHaveAttribute('aria-invalid')
    expect(within(dialog).getByLabelText('Output workflow node video')).not.toHaveAttribute('aria-invalid')
  })

  it('creates a ComfyUI function from pasted API workflow JSON', () => {
    render(<SettingsPage onClose={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    const dialog = screen.getByRole('dialog', { name: 'Function Management' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Function' }))
    const createDialog = screen.getByRole('dialog', { name: 'New Function' })
    const apiWorkflow = {
      '10': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
      '20': { class_type: 'SaveImage', inputs: { images: ['10', 0], filename_prefix: 'pasted' } },
    }

    expect(within(createDialog).getByLabelText('No ComfyUI workflow saved')).toHaveTextContent('No workflow saved yet')
    expect(within(createDialog).getByRole('button', { name: 'Save function' })).toBeDisabled()
    fireEvent.change(within(createDialog).getByLabelText('Function name'), { target: { value: 'Pasted API Workflow' } })
    fireEvent.change(within(createDialog).getByRole('textbox', { name: 'New function ComfyUI API workflow JSON' }), {
      target: { value: JSON.stringify(apiWorkflow) },
    })

    expect(within(createDialog).getByRole('button', { name: 'Save function' })).toBeEnabled()
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Save function' }))

    expect(screen.queryByRole('dialog', { name: 'New Function' })).not.toBeInTheDocument()
    const createdFunction = Object.values(projectStore.getState().project.functions).find(
      (functionDef) => functionDef.name === 'Pasted API Workflow',
    )
    expect(createdFunction?.workflow).toMatchObject({ format: 'comfyui_api_json', rawJson: apiWorkflow })
  })

  it.each([
    ['invalid JSON', '{not-json', /valid JSON/i],
    ['an empty workflow', '{}', /at least one|non-empty|node/i],
    ['a ComfyUI UI workflow', '{"nodes":[],"links":[]}', /API workflow|node mapping/i],
  ])('keeps New Function open with an accessible error for %s', (_label, value, message) => {
    render(<SettingsPage onClose={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    const managerDialog = screen.getByRole('dialog', { name: 'Function Management' })
    fireEvent.click(within(managerDialog).getByRole('button', { name: 'Function' }))
    const createDialog = screen.getByRole('dialog', { name: 'New Function' })
    const initialFunctionIds = Object.keys(projectStore.getState().project.functions).sort()

    fireEvent.change(within(createDialog).getByLabelText('Function name'), { target: { value: 'Rejected Workflow' } })
    fireEvent.change(within(createDialog).getByRole('textbox', { name: 'New function ComfyUI API workflow JSON' }), {
      target: { value },
    })
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Save function' }))

    expect(within(createDialog).getByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('dialog', { name: 'New Function' })).toBeVisible()
    expect(Object.keys(projectStore.getState().project.functions).sort()).toEqual(initialFunctionIds)
  })

  it('imports pasted API workflow JSON into the selected ComfyUI function', () => {
    const state = panelProject()
    state.functions.fn_render.workflow = {
      ...structuredClone(state.functions.fn_render.workflow),
      uiJson: { nodes: [{ id: 6, type: 'CLIPTextEncode' }], links: [] },
      editor: {
        kind: 'comfyui_browser',
        endpointId: 'endpoint_local',
        baseUrl: 'http://127.0.0.1:27707',
        savedAt: '2026-05-09T00:00:00.000Z',
      },
    }
    projectStore.setState({
      project: state,
      projectLibrary: { [state.project.id]: state },
    } as unknown as Partial<ReturnType<typeof projectStore.getState>>)
    render(<SettingsPage onClose={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    const managerDialog = screen.getByRole('dialog', { name: 'Function Management' })

    fireEvent.click(within(managerDialog).getByRole('button', { name: 'Import workflow JSON' }))
    const importDialog = screen.getByRole('dialog', { name: 'Import ComfyUI API workflow JSON' })
    fireEvent.change(within(importDialog).getByRole('textbox', { name: 'ComfyUI API workflow JSON' }), {
      target: { value: JSON.stringify(replacementApiWorkflow) },
    })
    fireEvent.click(within(importDialog).getByRole('button', { name: 'Use workflow JSON' }))

    expect(screen.queryByRole('dialog', { name: 'Import ComfyUI API workflow JSON' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Function Management' })).toBeVisible()
    const importedWorkflow = projectStore.getState().project.functions.fn_render.workflow
    expect(importedWorkflow.rawJson).toEqual(replacementApiWorkflow)
    expect(importedWorkflow.uiJson).toBeUndefined()
    expect(importedWorkflow.editor).toMatchObject({
      kind: 'comfyui_browser',
      endpointId: 'endpoint_local',
      baseUrl: 'http://127.0.0.1:27707',
    })
    expect(importedWorkflow.editor?.savedAt).not.toBe('2026-05-09T00:00:00.000Z')
  })

  it('keeps existing workflow import open when pasted JSON is not an API node mapping', () => {
    const originalWorkflow = structuredClone(projectStore.getState().project.functions.fn_render.workflow)
    render(<SettingsPage onClose={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    const managerDialog = screen.getByRole('dialog', { name: 'Function Management' })
    fireEvent.click(within(managerDialog).getByRole('button', { name: 'Import workflow JSON' }))
    const importDialog = screen.getByRole('dialog', { name: 'Import ComfyUI API workflow JSON' })

    fireEvent.change(within(importDialog).getByRole('textbox', { name: 'ComfyUI API workflow JSON' }), {
      target: { value: '{"10":{"inputs":{}}}' },
    })
    fireEvent.click(within(importDialog).getByRole('button', { name: 'Use workflow JSON' }))

    expect(within(importDialog).getByRole('alert')).toHaveTextContent(/class_type/i)
    expect(screen.getByRole('dialog', { name: 'Import ComfyUI API workflow JSON' })).toBeVisible()
    expect(projectStore.getState().project.functions.fn_render.workflow).toEqual(originalWorkflow)
  })

  it('copies the saved workflow after a replacement import draft is cancelled', async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    try {
      const { managerDialog, savedWorkflow } = openCancelledExistingWorkflowImport()

      fireEvent.click(within(managerDialog).getByRole('button', { name: 'Copy workflow JSON' }))

      await waitFor(() => expect(writeText).toHaveBeenCalledWith(JSON.stringify(savedWorkflow.rawJson, null, 2)))
      expect(projectStore.getState().project.functions.fn_render.workflow).toEqual(savedWorkflow)
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  it('downloads the saved workflow after a replacement import draft is cancelled', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:saved-workflow-json')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const { managerDialog, savedWorkflow } = openCancelledExistingWorkflowImport()

    fireEvent.click(within(managerDialog).getByRole('button', { name: 'Download workflow JSON' }))

    await waitFor(() => expect(createObjectUrl).toHaveBeenCalledTimes(1))
    const workflowBlob = createObjectUrl.mock.calls[0]?.[0]
    expect(workflowBlob).toBeInstanceOf(Blob)
    if (!(workflowBlob instanceof Blob)) throw new Error('Expected workflow download to use a Blob')
    await expect(readBlobText(workflowBlob)).resolves.toBe(JSON.stringify(savedWorkflow.rawJson, null, 2))
    expect(projectStore.getState().project.functions.fn_render.workflow).toEqual(savedWorkflow)
  })

  it('formats only the saved raw JSON after a replacement import draft is cancelled', () => {
    const { managerDialog, savedWorkflow } = openCancelledExistingWorkflowImport()

    fireEvent.click(within(managerDialog).getByRole('button', { name: 'Format selected JSON' }))

    expect(projectStore.getState().project.functions.fn_render.workflow).toEqual(savedWorkflow)
    expect(projectStore.getState().project.functions.fn_render.workflow.uiJson).toEqual(savedWorkflow.uiJson)
    expect(projectStore.getState().project.functions.fn_render.workflow.editor).toEqual(savedWorkflow.editor)
  })

  it('copies the selected ComfyUI API workflow JSON', async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    try {
      render(<SettingsPage onClose={() => undefined} />)
      fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
      const managerDialog = screen.getByRole('dialog', { name: 'Function Management' })

      fireEvent.click(within(managerDialog).getByRole('button', { name: 'Copy workflow JSON' }))

      await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith(
          JSON.stringify(projectStore.getState().project.functions.fn_render.workflow.rawJson, null, 2),
        ),
      )
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  it('downloads the selected ComfyUI API workflow as a JSON file', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:workflow-json')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<SettingsPage onClose={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    const managerDialog = screen.getByRole('dialog', { name: 'Function Management' })

    fireEvent.click(within(managerDialog).getByRole('button', { name: 'Download workflow JSON' }))

    await waitFor(() => expect(createObjectUrl).toHaveBeenCalledTimes(1))
    const workflowBlob = createObjectUrl.mock.calls[0]?.[0]
    const downloadAnchor = anchorClick.mock.contexts[0] as HTMLAnchorElement | undefined
    expect(workflowBlob).toBeInstanceOf(Blob)
    if (!(workflowBlob instanceof Blob)) throw new Error('Expected workflow download to use a Blob')
    expect(workflowBlob.type).toBe('application/json')
    expect(workflowBlob.size).toBeGreaterThan(0)
    expect(downloadAnchor?.download).toMatch(/\.json$/)
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:workflow-json')
  })

  it('renders the selected function workflow JSON only as a syntax highlighted view', () => {
    render(<SettingsPage onClose={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    const dialog = screen.getByRole('dialog', { name: 'Function Management' })
    const selectedWorkflowJson = within(dialog).getByLabelText('Selected workflow JSON')

    expect(selectedWorkflowJson.tagName).toBe('PRE')
    expect(selectedWorkflowJson).toHaveClass('selected-workflow-preview')
    expect(dialog.querySelector('.workflow-editor-grid textarea')).toBeNull()
    expect(within(selectedWorkflowJson).getByText('"Positive Prompt"')).toBeVisible()
    expect(selectedWorkflowJson.querySelector('.json-key')).not.toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Format selected JSON' }))

    expect(projectStore.getState().project.functions.fn_render.workflow.rawJson).toMatchObject({
      '6': { class_type: 'CLIPTextEncode', _meta: { title: 'Positive Prompt' } },
    })
  })

  it('keeps a selected workflow unchanged while its embedded ComfyUI editor is open', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as WindowProxy)
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined)
    const state = panelProject()
    state.comfy.endpoints = [
      state.comfy.endpoints[0]!,
      {
        ...state.comfy.endpoints[0]!,
        id: 'endpoint_remote',
        name: 'Remote ComfyUI',
        baseUrl: 'http://127.0.0.1:8188',
        auth: { type: 'token', token: 'selected-workflow-token' },
        capabilities: { supportedFunctions: ['fn_render'] },
      },
    ]
    const originalWorkflow = structuredClone(state.functions.fn_render.workflow)
    projectStore.setState({
      project: state,
      projectLibrary: { [state.project.id]: state },
      selectedNodeId: undefined,
      selectedNodeIds: [],
    } as unknown as Partial<ReturnType<typeof projectStore.getState>>)

    render(<SettingsPage onClose={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    const dialog = screen.getByRole('dialog', { name: 'Function Management' })
    fireEvent.change(within(dialog).getByLabelText('Workflow editor ComfyUI server Flux Render'), {
      target: { value: 'endpoint_remote' },
    })
    expect(within(dialog).getByLabelText('Workflow editor ComfyUI server Flux Render')).toHaveValue('endpoint_remote')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit in ComfyUI' }))

    const editorDialog = screen.getByRole('dialog', { name: 'ComfyUI Workflow Editor' })
    const frameUrl = new URL((within(editorDialog).getByTitle(/^ComfyUI editor\b/) as HTMLIFrameElement).src)
    expect(frameUrl.pathname).toBe('/extensions/infinity_comfy_bridge/storage-access.html')
    expect(frameUrl.searchParams.get('target')).toBe('http://127.0.0.1:8188/')
    expect(openSpy).not.toHaveBeenCalled()
    expect(submitSpy).not.toHaveBeenCalled()
    expect(projectStore.getState().project.functions.fn_render.workflow).toEqual(originalWorkflow)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('resets the workflow editor ComfyUI selection when switching functions', () => {
    const state = panelProject()
    state.comfy.endpoints = [
      state.comfy.endpoints[0]!,
      {
        ...state.comfy.endpoints[0]!,
        id: 'endpoint_remote',
        name: 'Remote ComfyUI',
        baseUrl: 'http://127.0.0.1:8188',
      },
    ]
    state.functions.fn_render.workflow.editor = {
      kind: 'comfyui_embedded',
      endpointId: 'endpoint_local',
      baseUrl: 'http://127.0.0.1:27707',
      savedAt: '2026-05-09T00:00:00.000Z',
    }
    state.functions.fn_second = {
      ...structuredClone(state.functions.fn_render),
      id: 'fn_second',
      name: 'Second Render',
      workflow: {
        ...structuredClone(state.functions.fn_render.workflow),
        editor: {
          kind: 'comfyui_embedded',
          endpointId: 'endpoint_remote',
          baseUrl: 'http://127.0.0.1:8188',
          savedAt: '2026-05-09T00:00:00.000Z',
        },
      },
      createdAt: '2026-05-09T00:00:00.000Z',
      updatedAt: '2026-05-09T00:00:00.000Z',
    }
    projectStore.setState({
      project: state,
      projectLibrary: { [state.project.id]: state },
      selectedNodeId: undefined,
      selectedNodeIds: [],
    } as unknown as Partial<ReturnType<typeof projectStore.getState>>)

    render(<SettingsPage onClose={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    const dialog = screen.getByRole('dialog', { name: 'Function Management' })
    const firstEditorServer = within(dialog).getByLabelText('Workflow editor ComfyUI server Flux Render')
    expect(firstEditorServer).toHaveValue('endpoint_local')

    fireEvent.click(within(within(dialog).getByLabelText('Managed function list')).getByRole('button', { name: /Second Render/ }))

    expect(within(dialog).getByLabelText('Workflow editor ComfyUI server Second Render')).toHaveValue('endpoint_remote')

    fireEvent.click(within(within(dialog).getByLabelText('Managed function list')).getByRole('button', { name: /Flux Render/ }))

    expect(within(dialog).getByLabelText('Workflow editor ComfyUI server Flux Render')).toHaveValue('endpoint_local')
  })

  it('shows ComfyUI server status from a left dock popover', () => {
    render(<LeftPanel />)

    expect(screen.queryByLabelText('ComfyUI server list')).not.toBeInTheDocument()

    const serverToggle = screen.getByRole('button', { name: 'ComfyUI Servers' })
    expect(serverToggle).toBeVisible()
    expect(serverToggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(serverToggle)

    expect(serverToggle).toHaveAttribute('aria-expanded', 'true')
    const serverList = screen.getByLabelText('ComfyUI server list')
    expect(within(serverList).getByText(/online/)).toBeVisible()
    expect(within(serverList).getByText(/queue 1/)).toBeVisible()
  })

  it('does not save ComfyUI server field edits until the single edit form is saved', () => {
    render(<LeftPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'ComfyUI Servers' }))
    const serverList = screen.getByLabelText('ComfyUI server list')
    fireEvent.click(within(serverList).getByRole('button', { name: /edit (server|endpoint) local comfyui/i }))
    const dialog = screen.getByRole('dialog', { name: /edit comfyui server/i })

    const endpointUrl = within(dialog).getByLabelText(/url/i)
    fireEvent.change(endpointUrl, {
      target: { value: 'http://127.0.0.1:8188' },
    })
    expect(projectStore.getState().project.comfy.endpoints[0]?.baseUrl).toBe('http://127.0.0.1:27707')

    fireEvent.click(within(dialog).getByRole('button', { name: /save/i }))

    expect(projectStore.getState().project.comfy.endpoints[0]).toMatchObject({
      baseUrl: 'http://127.0.0.1:8188',
    })
  })

  it('saves an HTTPS ComfyUI server URL', () => {
    render(<LeftPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'ComfyUI Servers' }))
    const serverList = screen.getByLabelText('ComfyUI server list')
    fireEvent.click(within(serverList).getByRole('button', { name: /edit (server|endpoint) local comfyui/i }))
    const dialog = screen.getByRole('dialog', { name: /edit comfyui server/i })

    fireEvent.change(within(dialog).getByLabelText(/url/i), {
      target: { value: 'https://comfyui.example.test:8443/ui' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: /save/i }))

    expect(projectStore.getState().project.comfy.endpoints[0]?.baseUrl).toBe('https://comfyui.example.test:8443/ui')
  })

  it.each([
    ['javascript:alert(1)', /https?|protocol/i],
    ['data:text/html,fixture', /https?|protocol/i],
    ['file:///C:/fixture/comfyui.html', /https?|protocol/i],
    ['https://user:secret@comfyui.example.test:8443/', /credentials|username|password|userinfo/i],
  ])('rejects unsafe ComfyUI server URL %s when saving', (baseUrl, message) => {
    const originalEndpoint = structuredClone(projectStore.getState().project.comfy.endpoints[0])
    render(<LeftPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'ComfyUI Servers' }))
    const serverList = screen.getByLabelText('ComfyUI server list')
    fireEvent.click(within(serverList).getByRole('button', { name: /edit (server|endpoint) local comfyui/i }))
    const dialog = screen.getByRole('dialog', { name: /edit comfyui server/i })
    const urlInput = within(dialog).getByLabelText(/url/i)

    fireEvent.change(urlInput, { target: { value: baseUrl } })
    fireEvent.click(within(dialog).getByRole('button', { name: /save/i }))

    expect(urlInput).toHaveAttribute('aria-invalid', 'true')
    expect(dialog).toHaveTextContent(message)
    expect(screen.getByRole('dialog', { name: /edit comfyui server/i })).toBeVisible()
    expect(projectStore.getState().project.comfy.endpoints[0]).toEqual(originalEndpoint)
  })

  it('binds a workflow function to specific ComfyUI servers from function management', () => {
    const state = panelProject()
    state.comfy.endpoints = [
      state.comfy.endpoints[0]!,
      {
        ...state.comfy.endpoints[0]!,
        id: 'endpoint_remote',
        name: 'Remote ComfyUI',
        baseUrl: 'http://127.0.0.1:8188',
        capabilities: { supportedFunctions: [] },
      },
    ]
    projectStore.setState({
      project: state,
      projectLibrary: { [state.project.id]: state },
      selectedNodeId: undefined,
      selectedNodeIds: [],
    } as unknown as Partial<ReturnType<typeof projectStore.getState>>)

    render(<SettingsPage onClose={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    const dialog = screen.getByRole('dialog', { name: 'Function Management' })
    const localToggle = within(dialog).getByLabelText('Function Flux Render available on Local ComfyUI')
    const remoteToggle = within(dialog).getByLabelText('Function Flux Render available on Remote ComfyUI')

    expect(localToggle).toBeChecked()
    expect(remoteToggle).not.toBeChecked()

    fireEvent.click(localToggle)
    fireEvent.click(remoteToggle)

    expect(projectStore.getState().project.comfy.endpoints).toEqual([
      expect.objectContaining({
        id: 'endpoint_local',
        capabilities: { supportedFunctions: [] },
      }),
      expect.objectContaining({
        id: 'endpoint_remote',
        capabilities: { supportedFunctions: ['fn_render'] },
      }),
    ])
  })

  it('saves supported workflow function choices from single ComfyUI server forms', () => {
    render(<LeftPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'ComfyUI Servers' }))
    const serverList = screen.getByLabelText('ComfyUI server list')
    fireEvent.click(within(serverList).getByRole('button', { name: /edit (server|endpoint) local comfyui/i }))
    const editDialog = screen.getByRole('dialog', { name: /edit comfyui server/i })

    const allLocal = within(editDialog).getByLabelText(/supports all functions/i)
    const localFunction = within(editDialog).getByLabelText(/supports flux render/i)
    expect(allLocal).toBeChecked()
    expect(localFunction).toBeChecked()
    expect(localFunction).toBeDisabled()

    fireEvent.click(allLocal)
    expect(localFunction).not.toBeDisabled()

    fireEvent.click(localFunction)
    expect(projectStore.getState().project.comfy.endpoints[0]?.capabilities?.supportedFunctions).toBeUndefined()
    fireEvent.click(within(editDialog).getByRole('button', { name: /save/i }))
    expect(projectStore.getState().project.comfy.endpoints[0]?.capabilities?.supportedFunctions).toEqual([])

    fireEvent.click(within(screen.getByLabelText('ComfyUI Servers popover')).getByRole('button', { name: /new|新建/i }))
    const createDialog = screen.getByRole('dialog', { name: /new comfyui server|create comfyui server/i })
    const newEndpointFunction = within(createDialog).getByLabelText(/supports flux render/i)
    expect(within(createDialog).getByLabelText(/supports all functions/i)).not.toBeChecked()
    expect(newEndpointFunction).toBeChecked()
    expect(projectStore.getState().project.comfy.endpoints).toHaveLength(1)
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Add server' }))
    expect(projectStore.getState().project.comfy.endpoints[1]?.capabilities?.supportedFunctions).toEqual(['fn_render'])
  })

  it('saves per-server custom headers from a single ComfyUI server edit form', () => {
    render(<LeftPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'ComfyUI Servers' }))
    const serverList = screen.getByLabelText('ComfyUI server list')
    fireEvent.click(within(serverList).getByRole('button', { name: /edit (server|endpoint) local comfyui/i }))
    const dialog = screen.getByRole('dialog', { name: /edit comfyui server/i })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Add header' }))
    const headerName = within(dialog).getByLabelText(/header name/i)
    headerName.focus()
    fireEvent.compositionStart(headerName)
    fireEvent.change(headerName, {
      target: { value: 'X-Gongzuoqu' },
    })
    fireEvent.compositionEnd(headerName)
    fireEvent.change(headerName, {
      target: { value: 'X-Workspace' },
    })
    expect(document.activeElement).toBe(headerName)
    expect(projectStore.getState().project.comfy.endpoints[0]?.customHeaders).toBeUndefined()
    fireEvent.blur(headerName)
    const headerValue = within(dialog).getByLabelText(/header value/i)
    fireEvent.change(headerValue, {
      target: { value: 'infinity' },
    })
    fireEvent.blur(headerValue)
    expect(projectStore.getState().project.comfy.endpoints[0]?.customHeaders).toBeUndefined()

    fireEvent.click(within(dialog).getByRole('button', { name: /save/i }))

    expect(projectStore.getState().project.comfy.endpoints[0]?.customHeaders).toEqual({
      'X-Workspace': 'infinity',
    })
  })

  it('shows task error messages from the left dock run queue popover', () => {
    const state = panelProject()
    state.canvas.nodes = [
      { id: 'node_openai', type: 'function', position: { x: 0, y: 0 }, data: { functionId: 'fn_openai_llm' } },
      {
        id: 'node_result_failed',
        type: 'result_group',
        position: { x: 320, y: 0 },
        data: { taskId: 'task_failed', sourceFunctionNodeId: 'node_openai', status: 'failed' },
      },
    ]
    state.tasks = {
      task_failed: {
        id: 'task_failed',
        functionNodeId: 'node_openai',
        functionId: 'fn_openai_llm',
        runIndex: 1,
        runTotal: 1,
        status: 'failed',
        inputRefs: {},
        inputSnapshot: {},
        paramsSnapshot: {},
        workflowTemplateSnapshot: {},
        compiledWorkflowSnapshot: {},
        seedPatchLog: [],
        endpointId: 'openai',
        outputRefs: {},
        error: {
          code: 'openai_execution_failed',
          message: 'OpenAI request failed: 401 invalid api key',
        },
        createdAt: '2026-05-09T00:00:00.000Z',
        updatedAt: '2026-05-09T00:00:00.000Z',
      },
    }
    projectStore.setState({ project: state, selectedNodeId: 'node_result_failed' })

    render(<LeftPanel />)

    expect(screen.queryByLabelText('Run queue list')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Run Queue' }))
    expect(screen.getAllByText('OpenAI request failed: 401 invalid api key')).toHaveLength(1)
    expect(screen.getByLabelText('Run queue list')).toBeVisible()
    expect(screen.getAllByText('task_failed')[0]).toBeVisible()
  })

  it('opens selected run queue from the left dock without showing static inspector details', () => {
    const state = panelProject()
    state.resources.res_prompt = {
      id: 'res_prompt',
      type: 'text',
      name: 'Prompt',
      value: 'sunlit kitchen',
      source: { kind: 'manual_input' },
      metadata: { createdAt: '2026-05-09T00:00:00.000Z' },
    }
    state.canvas.nodes = [
      {
        id: 'node_fn_1',
        type: 'function',
        position: { x: 0, y: 0 },
        data: { functionId: 'fn_render' },
      },
      {
        id: 'node_res_prompt',
        type: 'resource',
        position: { x: -320, y: 0 },
        data: { resourceId: 'res_prompt', resourceType: 'text' },
      },
      {
        id: 'node_result_1',
        type: 'result_group',
        position: { x: 320, y: 0 },
        data: { taskId: 'task_audit', sourceFunctionNodeId: 'node_fn_1', status: 'succeeded' },
      },
    ]
    state.tasks = {
      task_audit: {
        id: 'task_audit',
        functionNodeId: 'node_fn_1',
        functionId: 'fn_render',
        runIndex: 1,
        runTotal: 1,
        status: 'succeeded',
        inputRefs: { prompt: { resourceId: 'res_prompt', type: 'text' } },
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
          batch_size: {
            key: 'batch_size',
            label: 'Batch Size',
            type: 'number',
            required: false,
            source: 'inline',
            value: 2,
          },
        },
        paramsSnapshot: { runCount: 1, mode: 'comfy' },
        workflowTemplateSnapshot: {},
        compiledWorkflowSnapshot: {
          '6': { class_type: 'CLIPTextEncode', inputs: { text: 'sunlit kitchen' } },
          '75:66': { class_type: 'EmptyFlux2LatentImage', inputs: { batch_size: 2 } },
        },
        seedPatchLog: [],
        endpointId: 'endpoint_local',
        comfyPromptId: 'prompt_1',
        outputRefs: {},
        createdAt: '2026-05-09T00:00:00.000Z',
        startedAt: '2026-05-09T00:00:05.000Z',
        updatedAt: '2026-05-09T00:00:10.000Z',
        completedAt: '2026-05-09T00:00:10.000Z',
      },
    }
    projectStore.setState({ project: state, selectedNodeId: 'node_result_1' })

    render(<LeftPanel />)

    expect(screen.queryByRole('heading', { name: 'Inspector' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Run Details' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Inputs' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Final Workflow' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Run queue list')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Run Queue' }))
    expect(screen.getByRole('heading', { name: 'Runs' })).toBeVisible()
    const queue = screen.getByLabelText('Run queue list')
    expect(within(queue).getByText('task_audit')).toBeVisible()
    expect(within(queue).getByText('Local ComfyUI')).toBeVisible()
  })

  it('shows project tasks from a task dock popover with expandable cards and run details', () => {
    const state = panelProject()
    state.tasks.task_running = {
      ...state.tasks.task_running,
      status: 'running',
      inputValuesSnapshot: {
        prompt: {
          key: 'prompt',
          label: 'Prompt',
          type: 'text',
          required: true,
          source: 'resource',
          resourceId: 'res_text',
          resourceName: 'Prompt',
          value: 'sunlit kitchen',
        },
        negative_prompt: {
          key: 'negative_prompt',
          label: 'Negative Prompt',
          type: 'text',
          required: false,
          source: 'inline',
          value: 'low quality',
        },
      },
      compiledWorkflowSnapshot: {
        '6': { class_type: 'CLIPTextEncode', inputs: { text: 'sunlit kitchen' } },
      },
      startedAt: '2026-05-09T00:00:05.000Z',
      completedAt: '2026-05-09T00:00:10.000Z',
    }
    projectStore.setState({ project: state, selectedNodeId: undefined })

    render(<LeftPanel />)

    const taskToggle = screen.getByRole('button', { name: 'Project Tasks' })
    expect(taskToggle).toBeVisible()
    expect(taskToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('Project task list')).not.toBeInTheDocument()

    fireEvent.click(taskToggle)

    expect(taskToggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('heading', { name: 'Active Runs' })).toBeVisible()
    const taskList = screen.getByLabelText('Project task list')
    const taskCard = within(taskList).getByRole('button', { name: /Flux Render/ })
    expect(within(taskCard).getByText('Flux Render')).toBeVisible()
    expect(within(taskCard).getByText('Local ComfyUI')).toBeVisible()
    expect(within(taskCard).getByText('image')).toBeVisible()
    expect(within(taskCard).getByText('running')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Run Details' })).not.toBeInTheDocument()

    fireEvent.click(taskCard)

    expect(screen.getByRole('heading', { name: 'Run Details' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Run detail Started' })).toHaveValue('2026-05-09T00:00:05.000Z')
    expect(screen.getByRole('textbox', { name: 'Run detail Completed' })).toHaveValue('2026-05-09T00:00:10.000Z')
    expect(screen.getByRole('heading', { name: 'Inputs' })).toBeVisible()
    expect(screen.getByText('sunlit kitchen')).toBeVisible()
    expect(screen.getByText('low quality')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Final Workflow' })).toBeVisible()
    expect(screen.getByText(/CLIPTextEncode/)).toBeVisible()

    fireEvent.keyDown(screen.getByLabelText('Project Tasks popover'), { key: 'Escape' })
    expect(screen.queryByLabelText('Project task list')).not.toBeInTheDocument()
  })

  it('keeps legacy task cards renderable when output refs are missing', () => {
    const state = panelProject()
    delete (state.tasks.task_running as { outputRefs?: unknown }).outputRefs
    projectStore.setState({ project: state, selectedNodeId: undefined })

    render(<LeftPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Project Tasks' }))

    const taskCard = within(screen.getByLabelText('Project task list')).getByRole('button', { name: /Flux Render/ })
    expect(within(taskCard).getByText('Flux Render')).toBeVisible()
    expect(within(taskCard).getByText('image')).toBeVisible()
  })

  it('keeps project task dock available from the left icon bar when a node is selected', () => {
    const state = panelProject()
    projectStore.setState({ project: state, selectedNodeId: undefined })

    render(<LeftPanel />)

    expect(screen.getByRole('button', { name: 'Project Tasks' })).toBeVisible()
    expect(screen.queryByText('task_running')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Project Tasks' }))
    expect(screen.getByText('task_running')).toBeVisible()

    const selectedState = {
      ...state,
      canvas: {
        ...state.canvas,
        nodes: [{ id: 'node_text', type: 'resource' as const, position: { x: 0, y: 0 }, data: { resourceId: 'res_text' } }],
      },
    }
    projectStore.setState({ project: selectedState, selectedNodeId: 'node_text' })
    cleanup()
    render(<LeftPanel />)

    expect(screen.getByRole('button', { name: 'Project Tasks' })).toBeVisible()
    expect(screen.queryByText('task_running')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Project Tasks' }))
    expect(screen.getByText('task_running')).toBeVisible()
  })

  it('filters the left dock run queue by current selection and sorts newest runs first', () => {
    const state = panelProject()
    state.canvas.nodes = [
      { id: 'node_fn_render', type: 'function', position: { x: 0, y: 0 }, data: { functionId: 'fn_render' } },
      { id: 'node_fn_second', type: 'function', position: { x: 240, y: 0 }, data: { functionId: 'fn_render' } },
      { id: 'node_fn_other', type: 'function', position: { x: 480, y: 0 }, data: { functionId: 'fn_render' } },
    ]
    state.tasks = {
      task_old_selected: {
        ...state.tasks.task_running,
        id: 'task_old_selected',
        functionNodeId: 'node_fn_render',
        runIndex: 1,
        runTotal: 1,
        status: 'succeeded',
        createdAt: '2026-05-09T00:00:00.000Z',
        updatedAt: '2026-05-09T00:00:00.000Z',
      },
      task_middle_unselected: {
        ...state.tasks.task_running,
        id: 'task_middle_unselected',
        functionNodeId: 'node_fn_other',
        runIndex: 1,
        runTotal: 1,
        status: 'running',
        createdAt: '2026-05-09T00:01:00.000Z',
        updatedAt: '2026-05-09T00:01:00.000Z',
      },
      task_new_selected: {
        ...state.tasks.task_running,
        id: 'task_new_selected',
        functionNodeId: 'node_fn_second',
        runIndex: 1,
        runTotal: 1,
        status: 'queued',
        createdAt: '2026-05-09T00:02:00.000Z',
        updatedAt: '2026-05-09T00:02:00.000Z',
      },
    }
    projectStore.setState({
      project: state,
      selectedNodeId: undefined,
      selectedNodeIds: [],
    } as unknown as Partial<ReturnType<typeof projectStore.getState>>)

    render(<LeftPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Run Queue' }))
    let queueText = screen.getByLabelText('Run queue list').textContent ?? ''
    expect(queueText).toContain('task_new_selected')
    expect(queueText).toContain('task_middle_unselected')
    expect(queueText).toContain('task_old_selected')
    expect(queueText.indexOf('task_new_selected')).toBeLessThan(queueText.indexOf('task_middle_unselected'))
    expect(queueText.indexOf('task_middle_unselected')).toBeLessThan(queueText.indexOf('task_old_selected'))

    cleanup()
    projectStore.setState({
      project: state,
      selectedNodeId: 'node_fn_second',
      selectedNodeIds: ['node_fn_render', 'node_fn_second'],
    } as unknown as Partial<ReturnType<typeof projectStore.getState>>)
    render(<LeftPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Run Queue' }))
    queueText = screen.getByLabelText('Run queue list').textContent ?? ''
    expect(queueText).toContain('task_new_selected')
    expect(queueText).toContain('task_old_selected')
    expect(queueText).not.toContain('task_middle_unselected')
    expect(queueText.indexOf('task_new_selected')).toBeLessThan(queueText.indexOf('task_old_selected'))
  })

  it('shows selected node run queue cards with locate and proxied ComfyUI history actions', async () => {
    const state = panelProject()
    state.comfy.endpoints[0] = {
      ...state.comfy.endpoints[0]!,
      id: 'endpoint_local',
      customHeaders: { 'X-Workspace': 'infinity' },
    }
    state.canvas.nodes = [
      { id: 'node_fn_render', type: 'function', position: { x: 0, y: 0 }, data: { functionId: 'fn_render' } },
      { id: 'node_result_1', type: 'result_group', position: { x: 240, y: 0 }, data: { taskId: 'task_running' } },
    ]
    state.tasks.task_running = {
      ...state.tasks.task_running,
      runTotal: 2,
      comfyPromptId: 'prompt_1',
      status: 'succeeded',
      endpointId: 'endpoint_local',
    }
    projectStore.setState({ project: state, selectedNodeId: 'node_fn_render' })
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ prompt_1: { outputs: {} } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<LeftPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Run Queue' }))
    const queue = screen.getByLabelText('Run queue list')
    expect(within(queue).getByText(/Run 1\/2/)).toBeVisible()
    fireEvent.click(within(queue).getByRole('button', { name: 'Locate Run 1/2 result node' }))
    expect(projectStore.getState().selectedNodeId).toBe('node_result_1')
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'infinity-focus-node' }))
    fireEvent.click(within(queue).getByRole('button', { name: 'Open ComfyUI history for Run 1/2' }))
    await screen.findByRole('dialog', { name: 'ComfyUI history' })
    expect(fetchMock).toHaveBeenCalledWith(`${state.comfy.endpoints[0]!.baseUrl}/history/prompt_1`, {
      method: 'GET',
      headers: { 'X-Workspace': 'infinity' },
    })
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/__comfy_proxy/'))).toBe(false)
    expect(screen.getByText(/"prompt_1"/)).toBeVisible()
  })

  it('creates custom OpenAI and Gemini LLM functions with provider settings', () => {
    render(<SettingsPage onClose={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    const managerDialog = screen.getByRole('dialog', { name: 'Function Management' })

    fireEvent.click(within(managerDialog).getByRole('button', { name: 'Function' }))
    let createDialog = screen.getByRole('dialog', { name: 'New Function' })
    fireEvent.change(within(createDialog).getByLabelText('Function type'), { target: { value: 'openai' } })
    fireEvent.change(within(createDialog).getByLabelText('Function name'), { target: { value: 'Client OpenAI LLM' } })
    fireEvent.change(within(createDialog).getByLabelText('OpenAI base URL'), {
      target: { value: 'https://proxy.example.com/openai/v1' },
    })
    fireEvent.change(within(createDialog).getByLabelText('OpenAI API key'), { target: { value: 'sk-test' } })
    fireEvent.change(within(createDialog).getByLabelText('OpenAI model'), { target: { value: 'gpt-custom' } })
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Save function' }))

    const functionList = within(managerDialog).getByLabelText('Managed function list')
    expect(within(functionList).getByRole('button', { name: /Client OpenAI LLM/ })).toHaveClass('selected')
    expect(within(managerDialog).getByLabelText('OpenAI base URL')).toHaveValue('https://proxy.example.com/openai/v1')
    expect(within(managerDialog).getByLabelText('OpenAI API key')).toHaveValue('sk-test')
    expect(within(managerDialog).getByLabelText('OpenAI model')).toHaveValue('gpt-custom')
    expect((within(managerDialog).getByLabelText('OpenAI messages JSON') as HTMLTextAreaElement).value).toContain('"role"')

    fireEvent.click(within(managerDialog).getByRole('button', { name: 'Function' }))
    createDialog = screen.getByRole('dialog', { name: 'New Function' })
    fireEvent.change(within(createDialog).getByLabelText('Function type'), { target: { value: 'gemini' } })
    fireEvent.change(within(createDialog).getByLabelText('Function name'), { target: { value: 'Client Gemini LLM' } })
    fireEvent.change(within(createDialog).getByLabelText('Gemini base URL'), {
      target: { value: 'https://proxy.example.com/gemini/v1beta' },
    })
    fireEvent.change(within(createDialog).getByLabelText('Gemini API key'), { target: { value: 'gemini-test' } })
    fireEvent.change(within(createDialog).getByLabelText('Gemini model'), { target: { value: 'gemini-custom' } })
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Save function' }))

    expect(within(functionList).getByRole('button', { name: /Client Gemini LLM/ })).toHaveClass('selected')
    expect(within(managerDialog).getByLabelText('Gemini base URL')).toHaveValue('https://proxy.example.com/gemini/v1beta')
    expect(within(managerDialog).getByLabelText('Gemini API key')).toHaveValue('gemini-test')
    expect(within(managerDialog).getByLabelText('Gemini model')).toHaveValue('gemini-custom')
    expect((within(managerDialog).getByLabelText('Gemini messages JSON') as HTMLTextAreaElement).value).toContain('"role"')
  })
})

describe('embedded ComfyUI workflow editor launch', () => {
  beforeEach(() => {
    const project = panelProject()
    projectStore.setState({
      project,
      projectLibrary: { [project.project.id]: project },
      selectedNodeId: undefined,
      selectedNodeIds: [],
    } as unknown as Partial<ReturnType<typeof projectStore.getState>>)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  const openFunctionManager = () => {
    render(<SettingsPage onClose={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    return screen.getByRole('dialog', { name: 'Function Management' })
  }

  it('opens a token-configured endpoint in an iframe without putting the token in its URL', () => {
    const state = projectStore.getState().project
    const endpoint = {
      ...state.comfy.endpoints[0]!,
      baseUrl: 'https://comfyui.example.test:8443/custom/ui?theme=dark',
      auth: { type: 'token' as const, token: 'fixture-editor-token' },
    }
    projectStore.setState((current) => ({
      project: { ...current.project, comfy: { ...current.project.comfy, endpoints: [endpoint] } },
    }))
    const originalWorkflow = structuredClone(projectStore.getState().project.functions.fn_render.workflow)
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as WindowProxy)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const manager = openFunctionManager()

    fireEvent.click(within(manager).getByRole('button', { name: 'Edit in ComfyUI' }))

    const editorDialog = screen.getByRole('dialog', { name: 'ComfyUI Workflow Editor' })
    const frameUrl = new URL((within(editorDialog).getByTitle(/^ComfyUI editor\b/) as HTMLIFrameElement).src)
    const targetUrl = new URL(String(frameUrl.searchParams.get('target')))
    expect(frameUrl.origin).toBe('https://comfyui.example.test:8443')
    expect(frameUrl.pathname).toBe('/custom/ui/extensions/infinity_comfy_bridge/storage-access.html')
    expect(targetUrl.pathname).toBe('/custom/ui')
    expect(targetUrl.searchParams.get('theme')).toBe('dark')
    expect(targetUrl.searchParams.has('token')).toBe(false)
    expect(frameUrl.href).not.toContain('/__comfy_proxy/')
    expect(openSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(projectStore.getState().project.functions.fn_render.workflow).toEqual(originalWorkflow)
  })

  it('leaves password login to the user inside the endpoint iframe', () => {
    const state = projectStore.getState().project
    const endpoint = {
      ...state.comfy.endpoints[0]!,
      baseUrl: 'https://comfyui.example.test:8443',
      auth: { type: 'password' as const, password: 'fixture-ui-password', token: 'fixture-fallback-token' },
    }
    projectStore.setState((current) => ({
      project: { ...current.project, comfy: { ...current.project.comfy, endpoints: [endpoint] } },
    }))
    const originalWorkflow = structuredClone(projectStore.getState().project.functions.fn_render.workflow)
    vi.spyOn(window, 'open').mockReturnValue({} as WindowProxy)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined)
    const manager = openFunctionManager()

    fireEvent.click(within(manager).getByRole('button', { name: 'Edit in ComfyUI' }))

    const editorDialog = screen.getByRole('dialog', { name: 'ComfyUI Workflow Editor' })
    const frame = within(editorDialog).getByTitle(/^ComfyUI editor\b/) as HTMLIFrameElement
    const frameUrl = new URL(frame.src)
    expect(frameUrl.pathname).toBe('/extensions/infinity_comfy_bridge/storage-access.html')
    expect(frameUrl.searchParams.get('target')).toBe('https://comfyui.example.test:8443/')
    expect(frame.src).not.toContain('fixture-ui-password')
    expect(frame.src).not.toContain('fixture-fallback-token')
    expect(submitSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(within(editorDialog).getByRole('status')).toHaveTextContent(/sign in|login|connecting|bridge/i)
    expect(projectStore.getState().project.functions.fn_render.workflow).toEqual(originalWorkflow)
  })

  it('opens an endpoint with no password directly in the embedded editor', () => {
    const state = projectStore.getState().project
    const endpoint = {
      ...state.comfy.endpoints[0]!,
      baseUrl: 'https://comfyui.example.test:8443/custom/ui',
      auth: { type: 'none' as const },
    }
    projectStore.setState((current) => ({
      project: { ...current.project, comfy: { ...current.project.comfy, endpoints: [endpoint] } },
    }))
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as WindowProxy)
    const manager = openFunctionManager()

    fireEvent.click(within(manager).getByRole('button', { name: 'Edit in ComfyUI' }))

    const editorDialog = screen.getByRole('dialog', { name: 'ComfyUI Workflow Editor' })
    const frameUrl = new URL((within(editorDialog).getByTitle(/^ComfyUI editor\b/) as HTMLIFrameElement).src)
    expect(frameUrl.pathname).toBe('/custom/ui/extensions/infinity_comfy_bridge/storage-access.html')
    expect(frameUrl.searchParams.get('target')).toBe(endpoint.baseUrl)
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('does not depend on popup availability for the primary editor path', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    const manager = openFunctionManager()

    fireEvent.click(within(manager).getByRole('button', { name: 'Edit in ComfyUI' }))

    expect(screen.getByRole('dialog', { name: 'ComfyUI Workflow Editor' })).toBeInTheDocument()
    expect(openSpy).not.toHaveBeenCalled()
  })
})

describe('embedded ComfyUI workflow editor contract', () => {
  beforeEach(() => {
    const project = panelProject()
    projectStore.setState({
      project,
      projectLibrary: { [project.project.id]: project },
      selectedNodeId: undefined,
      selectedNodeIds: [],
    } as unknown as Partial<ReturnType<typeof projectStore.getState>>)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  const openEditor = () => {
    render(<SettingsPage onClose={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    const manager = screen.getByRole('dialog', { name: 'Function Management' })
    fireEvent.click(within(manager).getByRole('button', { name: 'Edit in ComfyUI' }))
    return screen.getByRole('dialog', { name: 'ComfyUI Workflow Editor' })
  }

  it('uses a sanitized direct endpoint page iframe and never submits saved credentials', () => {
    const state = projectStore.getState().project
    state.comfy.endpoints = [
      {
        ...state.comfy.endpoints[0]!,
        baseUrl: 'https://comfyui.example.test:8443/custom/ui/?theme=dark&token=url-token#canvas',
        auth: {
          type: 'password',
          password: 'fixture-editor-password',
          token: 'fixture-editor-api-token',
        },
      },
    ]
    projectStore.setState({ project: state } as Partial<ReturnType<typeof projectStore.getState>>)
    const openSpy = vi.spyOn(window, 'open')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined)
    const initialFormCount = document.forms.length

    const editorDialog = openEditor()

    const frame = within(editorDialog).getByTitle(/^ComfyUI editor\b/) as HTMLIFrameElement
    const frameUrl = new URL(frame.src)
    const targetUrl = new URL(String(frameUrl.searchParams.get('target')))
    expect(frameUrl.origin).toBe('https://comfyui.example.test:8443')
    expect(frameUrl.pathname).toBe('/custom/ui/extensions/infinity_comfy_bridge/storage-access.html')
    expect(targetUrl.pathname).toBe('/custom/ui/')
    expect(targetUrl.searchParams.get('theme')).toBe('dark')
    expect([...targetUrl.searchParams.keys()].some((key) => key.toLowerCase() === 'token')).toBe(false)
    expect(targetUrl.hash).toBe('')
    expect(frame.src).not.toContain('/__comfy_proxy/')
    expect(frame.src).not.toContain('fixture-editor-password')
    expect(frame.src).not.toContain('fixture-editor-api-token')
    expect(within(editorDialog).getByRole('button', { name: 'Save from ComfyUI' })).toBeDisabled()
    expect(within(editorDialog).getByRole('status')).toHaveTextContent(/sign in|login|waiting|connect|loading/i)
    expect(openSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(submitSpy).not.toHaveBeenCalled()
    expect(document.forms).toHaveLength(initialFormCount)
  })

  it('loads UI workflow first and saves bridge exports with embedded metadata', async () => {
    const state = projectStore.getState().project
    const initialUiJson = { nodes: [{ id: 6, type: 'CLIPTextEncode' }], links: [] }
    state.functions.fn_render.workflow = { ...state.functions.fn_render.workflow, uiJson: initialUiJson }
    projectStore.setState({ project: state } as Partial<ReturnType<typeof projectStore.getState>>)
    const editorDialog = openEditor()
    const frame = within(editorDialog).getByTitle(/^ComfyUI editor\b/) as HTMLIFrameElement
    const frameWindow = frame.contentWindow
    expect(frameWindow).not.toBeNull()
    const requests: Array<Record<string, unknown>> = []
    const exportedRawJson = {
      '30': { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 768, batch_size: 1 } },
      '40': { class_type: 'SaveImage', inputs: { images: ['30', 0] } },
    }
    const exportedUiJson = { nodes: [{ id: 30, type: 'EmptyLatentImage' }], links: [] }
    vi.spyOn(frameWindow!, 'postMessage').mockImplementation((message, targetOrigin) => {
      const request = message as Record<string, unknown>
      requests.push(request)
      const payload =
        request.command === 'export'
          ? { rawJson: exportedRawJson, uiJson: exportedUiJson }
          : request.command === 'ping'
            ? { ready: true }
            : { ok: true }
      queueMicrotask(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            origin: String(targetOrigin),
            source: frameWindow,
            data: {
              channel: 'infinity-comfy-editor-v1',
              type: 'response',
              id: request.id,
              payload,
            },
          }),
        )
      })
    })

    fireEvent.load(frame)

    await waitFor(() => expect(requests.some((request) => request.command === 'load-ui')).toBe(true))
    expect(requests.some((request) => request.command === 'load-api')).toBe(false)
    expect(requests.find((request) => request.command === 'load-ui')?.payload).toEqual(initialUiJson)
    const saveButton = within(editorDialog).getByRole('button', { name: 'Save from ComfyUI' })
    await waitFor(() => expect(saveButton).toBeEnabled())
    fireEvent.click(saveButton)

    await waitFor(() =>
      expect(projectStore.getState().project.functions.fn_render.workflow).toMatchObject({
        rawJson: exportedRawJson,
        uiJson: exportedUiJson,
        editor: {
          kind: 'comfyui_embedded',
          endpointId: 'endpoint_local',
          baseUrl: 'http://127.0.0.1:27707',
        },
      }),
    )
  })

  it('retries bridge readiness after iframe reload and falls back to the API workflow', async () => {
    const editorDialog = openEditor()
    const frame = within(editorDialog).getByTitle(/^ComfyUI editor\b/) as HTMLIFrameElement
    const frameWindow = frame.contentWindow
    const requests: Array<Record<string, unknown>> = []
    const mockBridgeRequests = (sourceWindow: Window) => {
      vi.spyOn(sourceWindow, 'postMessage').mockImplementation((message, targetOrigin) => {
        const request = message as Record<string, unknown>
        requests.push(request)
        if (request.command === 'ping' && requests.filter((item) => item.command === 'ping').length < 2) return
        queueMicrotask(() => {
          window.dispatchEvent(
            new MessageEvent('message', {
              origin: String(targetOrigin),
              source: sourceWindow,
              data: {
                channel: 'infinity-comfy-editor-v1',
                type: 'response',
                id: request.id,
                payload: request.command === 'ping' ? { ready: true } : { ok: true },
              },
            }),
          )
        })
      })
    }
    mockBridgeRequests(frameWindow!)

    expect(within(editorDialog).getByRole('button', { name: 'Save from ComfyUI' })).toBeDisabled()
    expect(within(editorDialog).getByRole('button', { name: /retry/i })).toBeEnabled()
    fireEvent.load(frame)
    fireEvent.load(frame)

    await waitFor(() => expect(requests.filter((request) => request.command === 'ping')).toHaveLength(1))
    fireEvent.click(within(editorDialog).getByRole('button', { name: /retry/i }))
    const reloadedFrame = within(editorDialog).getByTitle(/^ComfyUI editor\b/) as HTMLIFrameElement
    expect(reloadedFrame).not.toBe(frame)
    mockBridgeRequests(reloadedFrame.contentWindow!)
    fireEvent.load(reloadedFrame)
    await waitFor(() => expect(requests.filter((request) => request.command === 'ping')).toHaveLength(2))
    await waitFor(() => expect(requests.some((request) => request.command === 'load-api')).toBe(true))
    await waitFor(() => expect(within(editorDialog).getByRole('button', { name: 'Save from ComfyUI' })).toBeEnabled())
  })
})
