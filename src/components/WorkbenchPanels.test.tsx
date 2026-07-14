import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComfyWorkflowEditorDialog, LeftPanel, SettingsPage, highlightedJson } from './WorkbenchPanels'
import { projectStore } from '../store/projectStore'
import type { ProjectState } from '../domain/types'
import { createOpenAIImageFunction } from '../domain/openaiImage'
import { comfyProxyUrl } from '../domain/comfyProxy'

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
    expect(within(createDialog).getByRole('button', { name: /save/i })).toBeVisible()
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

    fireEvent.click(within(saveDialog).getByRole('button', { name: /save/i }))

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

  it('creates a workflow function from the embedded ComfyUI editor and selects it after saving', async () => {
    const proxySessionFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
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
    const managerDialog = screen.getByRole('dialog', { name: 'Function Management' })

    fireEvent.click(within(managerDialog).getByRole('button', { name: 'Function' }))
    const createDialog = screen.getByRole('dialog', { name: 'New Function' })

    fireEvent.change(within(createDialog).getByLabelText('Function name'), { target: { value: 'Kitchen Batch Render' } })
    fireEvent.change(within(createDialog).getByLabelText('New function ComfyUI server'), {
      target: { value: 'endpoint_remote' },
    })
    expect(within(createDialog).queryByLabelText('Workflow JSON')).not.toBeInTheDocument()
    expect(within(createDialog).queryByLabelText('New workflow JSON preview')).not.toBeInTheDocument()
    expect(within(createDialog).getByRole('button', { name: 'Save function' })).toBeDisabled()

    fireEvent.click(within(createDialog).getByRole('button', { name: 'Edit in ComfyUI' }))
    const editor = await screen.findByRole('dialog', { name: 'ComfyUI Workflow Editor' })
    const frame = (await within(editor).findByTitle('ComfyUI editor Remote ComfyUI')) as HTMLIFrameElement
    const remoteFrameUrl = new URL(frame.src)
    const [remoteAuthInput, remoteAuthInit] = proxySessionFetch.mock.calls[0] ?? []
    const remoteAuthUrl = new URL(String(remoteAuthInput))
    expect(remoteAuthUrl.origin).toBe(remoteFrameUrl.origin)
    expect(remoteAuthUrl.pathname).toBe('/__comfy_proxy/auth/http%3A%2F%2F127.0.0.1%3A8188')
    expect(remoteAuthInit).toEqual(expect.objectContaining({ method: 'POST', body: '{}', credentials: 'include' }))
    const frameWindow = { postMessage: vi.fn() }
    Object.defineProperty(frame, 'contentWindow', {
      configurable: true,
      value: frameWindow,
    })

    fireEvent.load(frame)
    await waitFor(() => expect(frameWindow.postMessage).toHaveBeenCalled())
    const pingRequest = frameWindow.postMessage.mock.calls
      .map(([message]) => message as { channel?: string; command?: string; id?: string; type?: string })
      .find((message) => message.command === 'ping')
    expect(pingRequest).toEqual(expect.objectContaining({
      channel: 'infinity-comfy-editor-v1',
      type: 'request',
      id: expect.any(String),
    }))
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          channel: 'infinity-comfy-editor-v1',
          type: 'response',
          id: pingRequest!.id,
          payload: { ready: true },
        },
        origin: new URL(frame.src).origin,
        source: frameWindow as unknown as WindowProxy,
      }))
    })
    const saveFromComfyButton = within(editor).getByRole('button', { name: 'Save from ComfyUI' })
    await waitFor(() => expect(saveFromComfyButton).toBeEnabled())
    fireEvent.click(saveFromComfyButton)
    await waitFor(() => {
      expect(frameWindow.postMessage.mock.calls.some(([message]) => (
        message as { command?: string }
      ).command === 'export')).toBe(true)
    })
    const exportRequest = frameWindow.postMessage.mock.calls
      .map(([message]) => message as { command?: string; id?: string })
      .find((message) => message.command === 'export')
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          channel: 'infinity-comfy-editor-v1',
          type: 'response',
          id: exportRequest!.id,
          payload: {
            rawJson: {
              '6': {
                class_type: 'CLIPTextEncode',
                _meta: { title: 'Positive Prompt' },
                inputs: { text: 'warm' },
              },
              '20': {
                class_type: 'SaveImage',
                _meta: { title: 'Result_Image' },
                inputs: { filename_prefix: 'render' },
              },
            },
            uiJson: {
              id: 'created_in_comfy',
              nodes: [{ id: 20, type: 'SaveImage', pos: [100, 120] }],
              links: [],
            },
          },
        },
        origin: new URL(frame.src).origin,
        source: frameWindow as unknown as WindowProxy,
      }))
    })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'ComfyUI Workflow Editor' })).not.toBeInTheDocument())
    expect(within(createDialog).getByLabelText('Captured ComfyUI workflow')).toHaveTextContent('2 API nodes saved')
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Save function' }))

    expect(screen.queryByRole('dialog', { name: 'New Function' })).not.toBeInTheDocument()
    expect(within(managerDialog).getByLabelText('Function name')).toHaveValue('Kitchen Batch Render')
    const listItem = within(within(managerDialog).getByLabelText('Managed function list')).getByRole('button', {
      name: /Kitchen Batch Render/,
    })
    expect(listItem).toHaveClass('selected')
    const createdFunction = Object.values(projectStore.getState().project.functions).find(
      (fn) => fn.name === 'Kitchen Batch Render',
    )
    expect(createdFunction).toMatchObject({
      workflow: {
        rawJson: {
          '20': { class_type: 'SaveImage', _meta: { title: 'Result_Image' } },
        },
        uiJson: {
          id: 'created_in_comfy',
          nodes: [{ id: 20, type: 'SaveImage', pos: [100, 120] }],
        },
      },
    })
    expect(projectStore.getState().project.comfy.endpoints).toEqual([
      expect.objectContaining({
        id: 'endpoint_local',
        capabilities: { supportedFunctions: ['fn_render'] },
      }),
      expect.objectContaining({
        id: 'endpoint_remote',
        capabilities: { supportedFunctions: [createdFunction?.id] },
      }),
    ])
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

  it('keeps ComfyUI workflow creation out of manual JSON editing', () => {
    render(<SettingsPage onClose={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    const dialog = screen.getByRole('dialog', { name: 'Function Management' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Function' }))
    const createDialog = screen.getByRole('dialog', { name: 'New Function' })

    expect(within(createDialog).getByLabelText('No ComfyUI workflow saved')).toHaveTextContent('No workflow saved yet')
    expect(within(createDialog).queryByLabelText('Workflow JSON')).not.toBeInTheDocument()
    expect(within(createDialog).queryByRole('button', { name: 'Format JSON' })).not.toBeInTheDocument()
    expect(within(createDialog).getByRole('button', { name: 'Save function' })).toBeDisabled()
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

  it('saves the selected workflow from an embedded ComfyUI editor with API and UI JSON', async () => {
    const proxySessionFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    const state = panelProject()
    state.comfy.endpoints = [
      {
        ...state.comfy.endpoints[0]!,
        capabilities: { supportedFunctions: [] },
      },
      {
        ...state.comfy.endpoints[0]!,
        id: 'endpoint_remote',
        name: 'Remote ComfyUI',
        baseUrl: 'http://127.0.0.1:8188',
        capabilities: { supportedFunctions: ['fn_render'] },
      },
    ]
    state.functions.fn_render.workflow.rawJson['20']!.inputs = {
      ...state.functions.fn_render.workflow.rawJson['20']!.inputs,
      images: ['6', 0],
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
    expect(within(dialog).getByLabelText('Workflow editor ComfyUI server Flux Render')).toHaveValue('endpoint_remote')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit in ComfyUI' }))

    const editor = await screen.findByRole('dialog', { name: 'ComfyUI Workflow Editor' })
    const frame = (await within(editor).findByTitle('ComfyUI editor Remote ComfyUI')) as HTMLIFrameElement
    const remoteFrameUrl = new URL(frame.src)
    const [remoteAuthInput, remoteAuthInit] = proxySessionFetch.mock.calls[0] ?? []
    const remoteAuthUrl = new URL(String(remoteAuthInput))
    expect(remoteAuthUrl.origin).toBe(remoteFrameUrl.origin)
    expect(remoteAuthUrl.pathname).toBe('/__comfy_proxy/auth/http%3A%2F%2F127.0.0.1%3A8188')
    expect(remoteAuthInit).toEqual(expect.objectContaining({ method: 'POST', body: '{}', credentials: 'include' }))
    const frameWindow = { postMessage: vi.fn() }
    Object.defineProperty(frame, 'contentWindow', {
      configurable: true,
      value: frameWindow,
    })

    fireEvent.load(frame)
    await waitFor(() => expect(frameWindow.postMessage).toHaveBeenCalled())
    const pingRequest = frameWindow.postMessage.mock.calls
      .map(([message]) => message as { channel?: string; command?: string; id?: string; payload?: unknown; type?: string })
      .find((message) => message.command === 'ping')
    expect(pingRequest).toEqual(expect.objectContaining({
      channel: 'infinity-comfy-editor-v1',
      type: 'request',
      id: expect.any(String),
    }))
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          channel: 'infinity-comfy-editor-v1',
          type: 'response',
          id: pingRequest!.id,
          payload: { ready: true },
        },
        origin: new URL(frame.src).origin,
        source: frameWindow as unknown as WindowProxy,
      }))
    })
    await waitFor(() => {
      expect(frameWindow.postMessage.mock.calls.some(([message]) => (
        message as { command?: string }
      ).command === 'load-api')).toBe(true)
    })
    const loadRequest = frameWindow.postMessage.mock.calls
      .map(([message]) => message as { command?: string; id?: string; payload?: unknown })
      .find((message) => message.command === 'load-api')
    expect(loadRequest?.payload).toEqual(state.functions.fn_render.workflow.rawJson)
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          channel: 'infinity-comfy-editor-v1',
          type: 'response',
          id: loadRequest!.id,
          payload: { loaded: true },
        },
        origin: new URL(frame.src).origin,
        source: frameWindow as unknown as WindowProxy,
      }))
    })
    await waitFor(() => expect(within(editor).getByRole('button', { name: 'Save from ComfyUI' })).toBeEnabled())
    fireEvent.click(within(editor).getByRole('button', { name: 'Save from ComfyUI' }))
    await waitFor(() => {
      expect(frameWindow.postMessage.mock.calls.some(([message]) => (
        message as { command?: string }
      ).command === 'export')).toBe(true)
    })
    const exportRequest = frameWindow.postMessage.mock.calls
      .map(([message]) => message as { command?: string; id?: string })
      .find((message) => message.command === 'export')
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          channel: 'infinity-comfy-editor-v1',
          type: 'response',
          id: exportRequest!.id,
          payload: {
            rawJson: {
              '42': {
                class_type: 'SaveImage',
                _meta: { title: 'Edited Result' },
                inputs: { filename_prefix: 'edited', images: ['6', 0] },
              },
            },
            uiJson: {
              id: 'comfy_ui_workflow',
              nodes: [{ id: 42, type: 'SaveImage', pos: [100, 120] }],
              links: [],
            },
          },
        },
        origin: new URL(frame.src).origin,
        source: frameWindow as unknown as WindowProxy,
      }))
    })

    await waitFor(() =>
      expect(projectStore.getState().project.functions.fn_render.workflow.rawJson).toEqual({
        '42': {
          class_type: 'SaveImage',
          _meta: { title: 'Edited Result' },
          inputs: { filename_prefix: 'edited', images: ['6', 0] },
        },
      }),
    )
    expect(projectStore.getState().project.functions.fn_render.workflow.uiJson).toEqual({
      id: 'comfy_ui_workflow',
      nodes: [{ id: 42, type: 'SaveImage', pos: [100, 120] }],
      links: [],
    })
    expect(projectStore.getState().project.functions.fn_render.workflow.editor).toMatchObject({
      kind: 'comfyui_embedded',
      endpointId: 'endpoint_remote',
      baseUrl: 'http://127.0.0.1:8188',
    })
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
    fireEvent.click(within(createDialog).getByRole('button', { name: /save/i }))
    expect(projectStore.getState().project.comfy.endpoints[1]?.capabilities?.supportedFunctions).toEqual(['fn_render'])
  })

  it('saves per-server custom headers from a single ComfyUI server edit form', () => {
    render(<LeftPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'ComfyUI Servers' }))
    const serverList = screen.getByLabelText('ComfyUI server list')
    fireEvent.click(within(serverList).getByRole('button', { name: /edit (server|endpoint) local comfyui/i }))
    const dialog = screen.getByRole('dialog', { name: /edit comfyui server/i })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Header' }))
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
    const proxyBaseUrl = new URL(comfyProxyUrl(state.comfy.endpoints[0]!.baseUrl), window.location.origin).toString()
    expect(fetchMock).toHaveBeenCalledWith(`${proxyBaseUrl}history/prompt_1`, {
      method: 'GET',
      headers: { 'X-Workspace': 'infinity' },
    })
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

describe('ComfyWorkflowEditorDialog', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it.each([
    ['token endpoint', 'fixture-isolated-editor-token'],
    ['no-token endpoint', undefined],
  ] as const)('prepares %s sessions on a credential-free isolated iframe origin', async (_label, token) => {
    const proxySessionFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    const consoleSpies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
    ]
    const endpoint = {
      ...panelProject().comfy.endpoints[0],
      auth: token ? ({ type: 'token', token } as const) : undefined,
    }
    render(<ComfyWorkflowEditorDialog endpoint={endpoint} onClose={vi.fn()} onSave={vi.fn()} />)

    const editor = screen.getByRole('dialog', { name: 'ComfyUI Workflow Editor' })
    const frame = (await within(editor).findByTitle('ComfyUI editor Local ComfyUI')) as HTMLIFrameElement
    const frameUrl = new URL(frame.getAttribute('src') ?? '', window.location.href)
    const [authInput, authInit] = proxySessionFetch.mock.calls[0] ?? []
    const authRequestUrl = new URL(String(authInput), window.location.href)
    const sandboxFlags = new Set((frame.getAttribute('sandbox') ?? '').split(/\s+/).filter(Boolean))

    expect(frameUrl.origin).not.toBe(window.location.origin)
    expect(authRequestUrl.origin).toBe(frameUrl.origin)
    expect(authRequestUrl.pathname).toBe('/__comfy_proxy/auth/http%3A%2F%2F127.0.0.1%3A27707')
    expect(frameUrl.pathname).toBe('/__comfy_proxy/http%3A%2F%2F127.0.0.1%3A27707/')
    expect(sandboxFlags.has('allow-scripts')).toBe(true)
    expect(sandboxFlags.has('allow-same-origin')).toBe(true)
    expect(authInit).toEqual(expect.objectContaining({
      body: JSON.stringify(token ? { bearerToken: token } : {}),
      credentials: 'include',
      method: 'POST',
    }))

    const browserVisibleArtifacts = JSON.stringify({
      authUrl: authRequestUrl.href,
      console: consoleSpies.flatMap((spy) => spy.mock.calls),
      dom: document.documentElement.outerHTML,
      frameUrl: frameUrl.href,
    })
    if (token) expect(browserVisibleArtifacts).not.toContain(token)
  })

  it(
    'enables workflow saving when the embedded editor bridge reports ready',
    async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
      render(
        <ComfyWorkflowEditorDialog
          endpoint={panelProject().comfy.endpoints[0]}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      )

      const editor = screen.getByRole('dialog', { name: 'ComfyUI Workflow Editor' })
      const frame = (await within(editor).findByTitle('ComfyUI editor Local ComfyUI')) as HTMLIFrameElement
      const frameWindow = { postMessage: vi.fn() }
      Object.defineProperty(frame, 'contentWindow', { configurable: true, value: frameWindow })

      fireEvent.load(frame)

      await waitFor(() => expect(frameWindow.postMessage).toHaveBeenCalled())
      const request = frameWindow.postMessage.mock.calls
        .map(([message]) => message as { channel?: string; command?: string; id?: string; type?: string })
        .find((message) => message.channel === 'infinity-comfy-editor-v1' && message.command === 'ping')
      expect(request).toEqual(expect.objectContaining({ type: 'request', id: expect.any(String) }))
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              channel: 'infinity-comfy-editor-v1',
              type: 'response',
              id: request!.id,
              payload: { ready: true },
            },
            origin: new URL(frame.src).origin,
            source: frameWindow as unknown as WindowProxy,
          }),
        )
      })

      await waitFor(() => expect(within(editor).getByRole('button', { name: 'Save from ComfyUI' })).toBeEnabled())
    },
  )

  it('keeps one authenticated iframe session stable while ComfyUI waits for interactive login', async () => {
    const proxySessionFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onClose = vi.fn()

    render(
      <ComfyWorkflowEditorDialog
        endpoint={panelProject().comfy.endpoints[0]}
        onClose={onClose}
        onSave={vi.fn()}
      />,
    )

    const editor = screen.getByRole('dialog', { name: 'ComfyUI Workflow Editor' })
    const frame = (await within(editor).findByTitle('ComfyUI editor Local ComfyUI')) as HTMLIFrameElement
    const initialFrameSrc = frame.src
    const frameWindow = { postMessage: vi.fn() }
    Object.defineProperty(frame, 'contentWindow', { configurable: true, value: frameWindow })

    vi.useFakeTimers()
    fireEvent.load(frame)

    expect(frameWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'infinity-comfy-editor-v1',
        command: 'ping',
        type: 'request',
      }),
      new URL(initialFrameSrc).origin,
    )

    const pingRequest = frameWindow.postMessage.mock.calls
      .map(([message]) => message as { channel?: string; command?: string; id?: string; type?: string })
      .find((message) => message.channel === 'infinity-comfy-editor-v1' && message.command === 'ping')
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          channel: 'infinity-comfy-editor-v1',
          type: 'response',
          id: pingRequest!.id,
          payload: { ready: false, loginRequired: true },
        },
        origin: new URL(initialFrameSrc).origin,
        source: frameWindow as unknown as WindowProxy,
      }))
    })

    expect(within(editor).getByRole('status')).toHaveTextContent(/log in|sign in|登录/i)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000)
    })

    const waitingEditor = screen.getByRole('dialog', { name: 'ComfyUI Workflow Editor' })
    const waitingFrame = within(waitingEditor).getByTitle('ComfyUI editor Local ComfyUI') as HTMLIFrameElement
    expect(proxySessionFetch).toHaveBeenCalledTimes(1)
    expect(waitingFrame).toBe(frame)
    expect(waitingFrame.src).toBe(initialFrameSrc)
    expect(onClose).not.toHaveBeenCalled()
    expect(consoleWarn).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('shows the loading fallback while secure session preparation is pending', async () => {
    const proxySessionFetch = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>(() => undefined))
    render(
      <ComfyWorkflowEditorDialog
        endpoint={panelProject().comfy.endpoints[0]}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    const editor = screen.getByRole('dialog', { name: 'ComfyUI Workflow Editor' })

    expect(within(editor).getByRole('status', { name: 'ComfyUI editor loading' })).toHaveTextContent(
      'Loading ComfyUI editor',
    )
    await waitFor(() => expect(proxySessionFetch).toHaveBeenCalledTimes(1))
    const [authInput, authInit] = proxySessionFetch.mock.calls[0] ?? []
    const authUrl = new URL(String(authInput))
    expect(authUrl.pathname).toBe('/__comfy_proxy/auth/http%3A%2F%2F127.0.0.1%3A27707')
    expect(authInit).toEqual(expect.objectContaining({ method: 'POST', body: '{}', credentials: 'include' }))
    expect(within(editor).queryByTitle('ComfyUI editor Local ComfyUI')).not.toBeInTheDocument()
  })
})
