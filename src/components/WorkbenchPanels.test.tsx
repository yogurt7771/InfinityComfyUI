import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LeftPanel, RightPanel, SettingsPage } from './WorkbenchPanels'
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

  it('shows compact previews for text and image assets', () => {
    render(<LeftPanel />)

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

    const assetList = screen.getByLabelText('Asset list')
    expect(within(assetList).getByText(/cinematic modern kitchen/)).toBeVisible()
    expect(within(assetList).getByRole('img', { name: 'Render.png' })).toHaveAttribute(
      'src',
      'http://127.0.0.1:27707/view?filename=render.png&type=output',
    )
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
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }))

    expect(projectStore.getState().project.project.id).not.toBe('project_test')
    expect(screen.queryByText('Edited Panel')).not.toBeInTheDocument()
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

  it('creates a workflow function in a separate dialog and selects it after saving', () => {
    render(<SettingsPage onClose={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    const managerDialog = screen.getByRole('dialog', { name: 'Function Management' })

    fireEvent.click(within(managerDialog).getByRole('button', { name: 'Function' }))
    const createDialog = screen.getByRole('dialog', { name: 'New Function' })

    fireEvent.change(within(createDialog).getByLabelText('Function name'), { target: { value: 'Kitchen Batch Render' } })
    fireEvent.change(within(createDialog).getByLabelText('Workflow JSON'), {
      target: {
        value:
          '{"6":{"class_type":"CLIPTextEncode","_meta":{"title":"Positive Prompt"},"inputs":{"text":"warm"}},"20":{"class_type":"SaveImage","_meta":{"title":"Result_Image"},"inputs":{"filename_prefix":"render"}}}',
      },
    })
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Save function' }))

    expect(screen.queryByRole('dialog', { name: 'New Function' })).not.toBeInTheDocument()
    expect(within(managerDialog).getByLabelText('Function name')).toHaveValue('Kitchen Batch Render')
    const listItem = within(within(managerDialog).getByLabelText('Managed function list')).getByRole('button', {
      name: /Kitchen Batch Render/,
    })
    expect(listItem).toHaveClass('selected')
    expect(Object.values(projectStore.getState().project.functions).some((fn) => fn.name === 'Kitchen Batch Render')).toBe(
      true,
    )
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

  it('formats new workflow JSON and renders a syntax highlighted preview in the create dialog', () => {
    render(<SettingsPage onClose={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    const dialog = screen.getByRole('dialog', { name: 'Function Management' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Function' }))
    const createDialog = screen.getByRole('dialog', { name: 'New Function' })
    const workflowJson = within(createDialog).getByLabelText('Workflow JSON')

    fireEvent.change(workflowJson, {
      target: {
        value: '{"6":{"class_type":"CLIPTextEncode","_meta":{"title":"Positive Prompt"},"inputs":{"text":"warm"}}}',
      },
    })
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Format JSON' }))

    expect((workflowJson as HTMLTextAreaElement).value).toContain('"6"')
    expect((workflowJson as HTMLTextAreaElement).value).toContain('\n    "class_type"')
    const preview = within(createDialog).getByLabelText('New workflow JSON preview')
    expect(within(preview).getByText('"class_type"')).toBeVisible()
    expect(preview.querySelector('.json-key')).not.toBeNull()
    expect(preview.querySelector('.json-string')).not.toBeNull()
  })

  it('edits and previews the selected function workflow JSON', () => {
    render(<SettingsPage onClose={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'Function Management' }))
    const dialog = screen.getByRole('dialog', { name: 'Function Management' })
    const selectedWorkflowJson = within(dialog).getByLabelText('Selected workflow JSON')

    expect((selectedWorkflowJson as HTMLTextAreaElement).value).toContain('"Positive Prompt"')

    fireEvent.change(selectedWorkflowJson, {
      target: {
        value: '{"42":{"class_type":"SaveImage","_meta":{"title":"Edited Result"},"inputs":{"filename_prefix":"edited"}}}',
      },
    })

    expect(projectStore.getState().project.functions.fn_render.workflow.rawJson).toMatchObject({
      '6': { class_type: 'CLIPTextEncode', _meta: { title: 'Positive Prompt' } },
    })
    fireEvent.blur(selectedWorkflowJson)

    expect(projectStore.getState().project.functions.fn_render.workflow.rawJson).toMatchObject({
      '42': { class_type: 'SaveImage', _meta: { title: 'Edited Result' } },
    })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Format selected JSON' }))

    expect((selectedWorkflowJson as HTMLTextAreaElement).value).toContain('\n    "class_type"')
    const selectedPreview = within(dialog).getByLabelText('Selected workflow preview')
    expect(within(selectedPreview).getByText('"Edited Result"')).toBeVisible()
    expect(selectedPreview.querySelector('.json-key')).not.toBeNull()

    fireEvent.change(selectedWorkflowJson, { target: { value: '{"42":' } })
    fireEvent.blur(selectedWorkflowJson)

    expect(selectedWorkflowJson).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByText(/Invalid workflow JSON/)).toBeVisible()
  })

  it('shows ComfyUI server status on the right panel and edits servers in management', () => {
    render(
      <>
        <RightPanel />
        <SettingsPage onClose={() => undefined} />
      </>,
    )

    const serverList = screen.getByLabelText('ComfyUI server list')
    expect(within(serverList).getByText(/online/)).toBeVisible()
    expect(within(serverList).getByText(/queue 1/)).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'ComfyUI Server Management' }))
    const dialog = screen.getByRole('dialog', { name: 'ComfyUI Server Management' })

    const endpointUrl = within(dialog).getByLabelText('Endpoint URL Local ComfyUI')
    fireEvent.change(endpointUrl, {
      target: { value: 'http://127.0.0.1:8188' },
    })
    expect(projectStore.getState().project.comfy.endpoints[0]?.baseUrl).toBe('http://127.0.0.1:27707')
    fireEvent.blur(endpointUrl)

    expect(projectStore.getState().project.comfy.endpoints[0]).toMatchObject({
      baseUrl: 'http://127.0.0.1:8188',
    })
  })

  it('edits per-server custom headers in ComfyUI server management', () => {
    render(<SettingsPage onClose={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'ComfyUI Server Management' }))
    const dialog = screen.getByRole('dialog', { name: 'ComfyUI Server Management' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Header' }))
    const headerName = within(dialog).getByLabelText('Header name Local ComfyUI 1')
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
    expect(projectStore.getState().project.comfy.endpoints[0]?.customHeaders).toEqual({ '': '' })
    fireEvent.blur(headerName)
    const headerValue = within(dialog).getByLabelText('Header value Local ComfyUI 1')
    fireEvent.change(headerValue, {
      target: { value: 'infinity' },
    })
    expect(projectStore.getState().project.comfy.endpoints[0]?.customHeaders).toEqual({
      'X-Workspace': '',
    })
    fireEvent.blur(headerValue)

    expect(projectStore.getState().project.comfy.endpoints[0]?.customHeaders).toEqual({
      'X-Workspace': 'infinity',
    })
  })

  it('shows task error messages in the right panel task list and selected run history', () => {
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

    render(<RightPanel />)

    expect(screen.getAllByText('OpenAI request failed: 401 invalid api key')).toHaveLength(1)
    expect(screen.getByLabelText('Selected node run history')).toBeVisible()
    expect(screen.getAllByText('task_failed')[0]).toBeVisible()
  })

  it('shows selected run execution inputs, workflow, timing, and node navigation in the inspector', () => {
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
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    const { container } = render(<RightPanel />)

    expect(screen.getByRole('heading', { name: 'Run Details' })).toBeVisible()
    expect(screen.getByText('Started')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Run detail Status' }).tagName).toBe('INPUT')
    expect(screen.getByRole('textbox', { name: 'Run detail Started' })).toHaveValue('2026-05-09T00:00:05.000Z')
    expect(screen.getByText('Completed')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Run detail Completed' })).toHaveValue('2026-05-09T00:00:10.000Z')
    expect(screen.getByRole('heading', { name: 'Inputs' })).toBeVisible()
    expect(screen.getByText('Prompt')).toBeVisible()
    expect(screen.getByText('required')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Input value Prompt' })).toHaveValue('sunlit kitchen')
    expect(screen.getByText('Batch Size')).toBeVisible()
    expect(screen.getByText('optional')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Input value Batch Size' })).toHaveValue('2')
    expect(screen.getByRole('heading', { name: 'Final Workflow' })).toBeVisible()
    expect(screen.getByText(/EmptyFlux2LatentImage/)).toBeVisible()
    expect(container.querySelector('.run-workflow-json .json-key')).not.toBeNull()
    expect(container.querySelector('.run-workflow-json .json-string')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Locate Prompt node' }))
    expect(projectStore.getState().selectedNodeId).toBe('node_res_prompt')
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'infinity-focus-node',
      }),
    )
  })

  it('shows project tasks as expandable cards with summary and run details', () => {
    const state = panelProject()
    state.tasks.task_running = {
      ...state.tasks.task_running,
      status: 'succeeded',
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

    render(<RightPanel />)

    const taskCard = screen.getByRole('button', { name: /Flux Render/ })
    expect(within(taskCard).getByText('Flux Render')).toBeVisible()
    expect(within(taskCard).getByText('Local ComfyUI')).toBeVisible()
    expect(within(taskCard).getByText('image')).toBeVisible()
    expect(within(taskCard).getByText('succeeded')).toBeVisible()
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
  })

  it('shows project tasks only when no node is selected', () => {
    const state = panelProject()
    projectStore.setState({ project: state, selectedNodeId: undefined })

    const { rerender } = render(<RightPanel />)

    expect(screen.getByRole('heading', { name: 'Project Tasks' })).toBeVisible()
    expect(screen.getByText('task_running')).toBeVisible()

    const selectedState = {
      ...state,
      canvas: {
        ...state.canvas,
        nodes: [{ id: 'node_text', type: 'resource' as const, position: { x: 0, y: 0 }, data: { resourceId: 'res_text' } }],
      },
    }
    projectStore.setState({ project: selectedState, selectedNodeId: 'node_text' })
    rerender(<RightPanel />)

    expect(screen.getByRole('heading', { name: 'Run Queue' })).toBeVisible()
    expect(screen.getByText('No runs for selected node')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Project Tasks' })).not.toBeInTheDocument()
    expect(screen.queryByText('task_running')).not.toBeInTheDocument()
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

    render(<RightPanel />)

    const queue = screen.getByLabelText('Selected node run history')
    expect(within(queue).getByText('Run 1/2')).toBeVisible()
    fireEvent.click(within(queue).getByRole('button', { name: 'Locate Run 1/2 result node' }))
    expect(projectStore.getState().selectedNodeId).toBe('node_result_1')
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'infinity-focus-node' }))
    fireEvent.click(within(queue).getByRole('button', { name: 'Open ComfyUI history for Run 1/2' }))
    await screen.findByRole('dialog', { name: 'ComfyUI history' })
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:27707/history/prompt_1', {
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
