import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { MouseEvent, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeChange } from '@xyflow/react'
import type { ProjectState } from '../../domain/types'
import { readFileAsAssetResource } from '../../domain/resourceFiles'
import { projectStore } from '../../store/projectStore'
import { assetCanvasNodeTypes, CanvasWorkspace, projectToAssetGraph, selectedResourcesForAssetNodes } from './CanvasWorkspace'

const reactFlowMock = vi.hoisted(() => ({
  setViewport: vi.fn(),
  viewport: { x: 0, y: 0, zoom: 1 },
}))

vi.mock('@xyflow/react', async () => {
  return {
    Background: () => null,
    Controls: () => <div className="react-flow__controls" data-testid="react-flow-controls" />,
    Handle: () => null,
    MarkerType: { ArrowClosed: 'arrowclosed' },
    Position: { Left: 'left', Right: 'right' },
    ReactFlow: ({
      children,
      nodes = [],
      onNodeClick,
      onNodeContextMenu,
      onNodesChange,
      onPaneContextMenu,
    }: {
      children?: ReactNode
      nodes?: Array<{ id: string; type?: string; data?: Record<string, unknown> }>
      onNodeClick?: (event: MouseEvent<HTMLDivElement>, node: { id: string; type?: string; data?: Record<string, unknown> }) => void
      onNodeContextMenu?: (event: MouseEvent<HTMLDivElement>, node: { id: string; type?: string; data?: Record<string, unknown> }) => void
      onNodesChange?: (changes: NodeChange[]) => void
      onPaneContextMenu?: (event: MouseEvent<HTMLDivElement>) => void
    }) => (
      <div data-testid="react-flow-pane" onContextMenu={onPaneContextMenu}>
        {nodes.map((node) => (
          <div
            className={`react-flow__node react-flow__node-${node.type}`}
            data-resource-id={typeof node.data?.resourceId === 'string' ? node.data.resourceId : undefined}
            data-testid={`react-flow-node-${node.id}`}
            key={node.id}
            onClick={(event) => onNodeClick?.(event, node)}
            onContextMenu={(event) => onNodeContextMenu?.(event, node)}
          >
            <button
              aria-label={`Drag ${node.id}`}
              onClick={() => {
                onNodesChange?.([{ id: node.id, type: 'position', position: { x: 220, y: 260 }, dragging: true }])
                onNodesChange?.([{ id: node.id, type: 'position', position: { x: 340, y: 380 }, dragging: true }])
                onNodesChange?.([{ id: node.id, type: 'position', position: { x: 460, y: 500 }, dragging: false }])
              }}
              type="button"
            >
              Drag
            </button>
            {typeof node.data?.onPreview === 'function' && node.data.resource ? (
              <button
                aria-label={`Preview ${String(node.data.title ?? node.data.resourceId)}`}
                onClick={() => (node.data?.onPreview as (resource: unknown) => void)(node.data?.resource)}
                type="button"
              >
                Preview
              </button>
            ) : (
              node.id
            )}
            {typeof node.data?.runStatus === 'string' ? <span>{node.data.runStatus}</span> : null}
            {typeof node.data?.runDurationLabel === 'string' ? <span>{node.data.runDurationLabel}</span> : null}
            {typeof node.data?.sourceFunctionName === 'string' ? (
              <button
                aria-label={`Edit and run ${node.data.sourceFunctionName}`}
                onClick={() => (node.data?.onEditRun as (resource: unknown) => void)?.(node.data?.resource)}
                type="button"
              >
                {node.data.sourceFunctionName}
              </button>
            ) : null}
            {typeof node.data?.runError === 'string' ? <span role="alert">{node.data.runError}</span> : null}
          </div>
        ))}
        {children}
      </div>
    ),
    ReactFlowProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useReactFlow: () => ({
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x: x - 10, y: y - 20 }),
      setViewport: reactFlowMock.setViewport,
    }),
    useViewport: () => reactFlowMock.viewport,
  }
})

vi.mock('../../domain/resourceFiles', () => ({
  readFileAsAssetResource: vi.fn(async (file: File) => ({
    type: 'image',
    media: {
      url: `data:${file.type};base64,cmVuZGVy`,
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    },
  })),
}))

const readFileAsAssetResourceMock = vi.mocked(readFileAsAssetResource)

const functionDef = (id: string, name: string, inputType: 'image' | 'text') => ({
  id,
  name,
  category: 'Edit',
  workflow: { format: 'comfyui_api_json' as const, rawJson: {} },
  inputs: [{ key: inputType, label: inputType, type: inputType, required: true, bind: { path: `inputs.${inputType}` } }],
  outputs: [{ key: 'output', label: 'Output', type: inputType, bind: {}, extract: { source: 'history' as const } }],
  createdAt: '2026-06-24T00:00:00.000Z',
  updatedAt: '2026-06-24T00:00:00.000Z',
})

beforeEach(() => {
  reactFlowMock.setViewport.mockClear()
  reactFlowMock.viewport = { x: 0, y: 0, zoom: 1 }
  readFileAsAssetResourceMock.mockImplementation(async (file: File) =>
    file.name.endsWith('.txt')
      ? {
          type: 'text',
          value: 'warm kitchen',
        }
      : {
          type: 'image',
          media: {
            url: `data:${file.type};base64,cmVuZGVy`,
            filename: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          },
        },
  )
  projectStore.getState().createProject({ name: `Canvas interaction ${Date.now()}` })
})

afterEach(() => {
  cleanup()
})

const project = (): ProjectState => ({
  schemaVersion: '1.0.0',
  project: {
    id: 'project_test',
    name: 'Canvas Test',
    createdAt: '2026-06-23T00:00:00.000Z',
    updatedAt: '2026-06-23T00:00:00.000Z',
  },
  canvas: {
    nodes: [
      { id: 'node_prompt', type: 'resource', position: { x: 0, y: 0 }, data: { resourceId: 'res_prompt' } },
      { id: 'node_output', type: 'resource', position: { x: 360, y: 0 }, data: { resourceId: 'res_output' } },
      { id: 'node_fn', type: 'function', position: { x: 180, y: 0 }, data: { functionId: 'fn_edit' } },
      { id: 'node_result', type: 'result_group', position: { x: 520, y: 0 }, data: { taskId: 'task_1' } },
      {
        id: 'group_1',
        type: 'group',
        position: { x: -40, y: -40 },
        data: { title: 'Batch', childNodeIds: ['node_prompt', 'node_fn', 'node_output'] },
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
      value: 'make it brighter',
      source: { kind: 'manual_input' },
      metadata: { createdAt: '2026-06-23T00:00:00.000Z' },
    },
    res_output: {
      id: 'res_output',
      type: 'image',
      name: 'Output',
      value: {
        assetId: 'asset_output',
        url: '/output.png',
        filename: 'output.png',
        mimeType: 'image/png',
        sizeBytes: 1,
      },
      source: { kind: 'function_output', runId: 'run_1', outputKey: 'image' },
      metadata: { createdAt: '2026-06-23T00:00:00.000Z' },
    },
  },
  assets: {},
  functions: {},
  runs: {},
  tasks: {
    task_1: {
      id: 'task_1',
      functionNodeId: 'node_fn',
      functionId: 'fn_edit',
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
      outputRefs: { image: [{ resourceId: 'res_output', type: 'image' }] },
      createdAt: '2026-06-23T00:00:00.000Z',
      updatedAt: '2026-06-23T00:00:00.000Z',
    },
  },
  comfy: {
    endpoints: [],
    scheduler: { strategy: 'least_busy', retry: { maxAttempts: 1, fallbackToOtherEndpoint: true } },
  },
})

describe('asset canvas workspace', () => {
  it('registers only asset and group node views', () => {
    expect(Object.keys(assetCanvasNodeTypes)).toEqual(['asset', 'group'])
    expect(assetCanvasNodeTypes).not.toHaveProperty('function')
    expect(assetCanvasNodeTypes).not.toHaveProperty('result_group')
  })

  it('projects legacy project state into an asset/group-only graph', () => {
    const graph = projectToAssetGraph(project())

    expect(graph.nodes.map((node) => [node.id, node.type])).toEqual([
      ['node_prompt', 'asset'],
      ['node_output', 'asset'],
      ['group_1', 'group'],
    ])
    expect(graph.nodes.find((node) => node.id === 'group_1')).toMatchObject({
      type: 'group',
      data: {
        childNodeIds: ['node_prompt', 'node_output'],
      },
    })
    expect(graph.edges).toEqual([
      {
        id: 'lineage:run_1:prompt:res_prompt:res_output',
        runId: 'run_1',
        inputKey: 'prompt',
        sourceResourceId: 'res_prompt',
        targetResourceId: 'res_output',
      },
    ])
  })

  it('projects native asset nodes and canvas lineage edges into the asset graph', () => {
    const sourceProject = project()
    sourceProject.canvas.nodes = [
      {
        id: 'node_source_asset',
        type: 'asset' as never,
        position: { x: 40, y: 80 },
        data: { resourceId: 'res_prompt', title: 'Prompt asset' },
      },
      {
        id: 'node_target_asset',
        type: 'asset' as never,
        position: { x: 360, y: 80 },
        size: { width: 420, height: 260 },
        data: { resourceId: 'res_output', title: 'Output asset' },
      } as never,
    ]
    sourceProject.canvas.edges = [
      {
        id: 'lineage:run_native:image:res_prompt:res_output',
        runId: 'run_native',
        inputKey: 'image',
        sourceResourceId: 'res_prompt',
        targetResourceId: 'res_output',
      } as never,
    ]
    sourceProject.tasks = {}

    const graph = projectToAssetGraph(sourceProject)

    expect(graph.nodes).toEqual([
      {
        id: 'node_source_asset',
        type: 'asset',
        position: { x: 40, y: 80 },
        data: { resourceId: 'res_prompt', title: 'Prompt asset' },
      },
      {
        id: 'node_target_asset',
        type: 'asset',
        position: { x: 360, y: 80 },
        size: { width: 420, height: 260 },
        data: { resourceId: 'res_output', title: 'Output asset' },
      },
    ])
    expect(graph.edges).toEqual([
      {
        id: 'lineage:run_native:image:res_prompt:res_output',
        runId: 'run_native',
        inputKey: 'image',
        sourceResourceId: 'res_prompt',
        targetResourceId: 'res_output',
      },
    ])
  })

  it('uses selected asset nodes as function command input candidates', () => {
    const sourceProject = project()

    expect(
      selectedResourcesForAssetNodes(sourceProject, [
        { type: 'asset', data: { resourceId: 'res_prompt' } },
        { type: 'group', data: {} },
        { type: 'asset', data: { resourceId: 'missing_resource' } },
      ]).map((resource) => resource.id),
    ).toEqual(['res_prompt'])
  })

  it('opens the asset creation menu from a canvas surface context menu', () => {
    render(<CanvasWorkspace />)

    fireEvent.contextMenu(screen.getByLabelText('Asset canvas workspace'), { clientX: 210, clientY: 260 })

    expect(screen.getByRole('menu', { name: 'Asset canvas menu' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Add image asset' })).toBeInTheDocument()
  })

  it('opens the asset creation menu from the React Flow pane context menu', () => {
    render(<CanvasWorkspace />)

    fireEvent.contextMenu(screen.getByTestId('react-flow-pane'), { clientX: 210, clientY: 260 })

    expect(screen.getByRole('menu', { name: 'Asset canvas menu' })).toBeInTheDocument()
  })

  it('does not open the asset creation menu from React Flow controls', () => {
    render(<CanvasWorkspace />)

    fireEvent.contextMenu(screen.getByTestId('react-flow-controls'), { clientX: 210, clientY: 260 })

    expect(screen.queryByRole('menu', { name: 'Asset canvas menu' })).not.toBeInTheDocument()
  })

  it('creates media assets when supported files are dropped on the canvas surface', async () => {
    render(<CanvasWorkspace />)

    const file = new File(['render'], 'render.png', { type: 'image/png' })
    const canvas = screen.getByLabelText('Asset canvas workspace')
    const dropEvent = createEvent.drop(canvas, {
      dataTransfer: { files: [file] },
    })
    Object.defineProperty(dropEvent, 'clientX', { value: 210 })
    Object.defineProperty(dropEvent, 'clientY', { value: 260 })
    fireEvent(canvas, dropEvent)

    await waitFor(() => {
      expect(Object.values(projectStore.getState().project.resources).some((resource) => resource.name === 'render.png')).toBe(true)
    })
    const imageResource = Object.values(projectStore.getState().project.resources).find((resource) => resource.name === 'render.png')
    const imageNode = projectStore.getState().project.canvas.nodes.find((node) => node.data.resourceId === imageResource?.id)

    expect(imageResource).toMatchObject({ type: 'image' })
    expect(imageNode).toMatchObject({ type: 'resource', position: { x: 200, y: 240 } })
  })

  it('ignores dropped media files that fail to read', async () => {
    readFileAsAssetResourceMock.mockRejectedValueOnce(new Error('read failed'))
    render(<CanvasWorkspace />)

    const file = new File(['render'], 'broken.png', { type: 'image/png' })
    const canvas = screen.getByLabelText('Asset canvas workspace')
    const dropEvent = createEvent.drop(canvas, {
      dataTransfer: { files: [file] },
    })
    Object.defineProperty(dropEvent, 'clientX', { value: 210 })
    Object.defineProperty(dropEvent, 'clientY', { value: 260 })
    fireEvent(canvas, dropEvent)

    await waitFor(() => expect(readFileAsAssetResourceMock).toHaveBeenCalledWith(file))

    expect(Object.values(projectStore.getState().project.resources).some((resource) => resource.name === 'broken.png')).toBe(false)
    expect(screen.getByRole('status')).toHaveTextContent('1 file could not be imported')
  })

  it('shows feedback when unsupported dropped files are skipped', async () => {
    readFileAsAssetResourceMock.mockResolvedValueOnce(undefined)
    render(<CanvasWorkspace />)

    const file = new File(['archive'], 'archive.zip', { type: 'application/zip' })
    const canvas = screen.getByLabelText('Asset canvas workspace')
    const dropEvent = createEvent.drop(canvas, {
      dataTransfer: { files: [file] },
    })
    Object.defineProperty(dropEvent, 'clientX', { value: 210 })
    Object.defineProperty(dropEvent, 'clientY', { value: 260 })
    fireEvent(canvas, dropEvent)

    await waitFor(() => expect(readFileAsAssetResourceMock).toHaveBeenCalledWith(file))

    expect(Object.values(projectStore.getState().project.resources)).toEqual([])
    expect(screen.getByRole('status')).toHaveTextContent('1 file could not be imported')
  })

  it('creates multiple dropped files as one vertically arranged asset batch', async () => {
    render(<CanvasWorkspace />)

    const imageFile = new File(['render'], 'render.png', { type: 'image/png' })
    const textFile = new File(['prompt'], 'prompt.txt', { type: 'text/plain' })
    const canvas = screen.getByLabelText('Asset canvas workspace')
    const dropEvent = createEvent.drop(canvas, {
      dataTransfer: { files: [imageFile, textFile] },
    })
    Object.defineProperty(dropEvent, 'clientX', { value: 210 })
    Object.defineProperty(dropEvent, 'clientY', { value: 260 })
    fireEvent(canvas, dropEvent)

    await waitFor(() => expect(Object.values(projectStore.getState().project.resources)).toHaveLength(2))

    const state = projectStore.getState()
    expect(state.project.canvas.nodes.map((node) => node.position)).toEqual([
      { x: 200, y: 240 },
      { x: 200, y: 430 },
    ])
    expect(Object.values(state.project.resources).map((resource) => [resource.name, resource.type])).toEqual([
      ['render.png', 'image'],
      ['prompt.txt', 'text'],
    ])
    expect(state.project.history?.undoStack).toHaveLength(1)
    expect(state.project.history?.undoStack.at(-1)).toEqual(
      expect.objectContaining({
        label: 'Create assets',
        affectedIds: expect.objectContaining({
          assetIds: expect.arrayContaining(Object.keys(state.project.resources)),
        }),
      }),
    )
  })

  it('replaces an existing asset when a file is dropped on its node', async () => {
    projectStore.getState().addEmptyResourceAtPosition('image', { x: 120, y: 160 })
    const resourceId = Object.keys(projectStore.getState().project.resources)[0]!
    const nodeId = projectStore.getState().project.canvas.nodes.find((node) => node.data.resourceId === resourceId)?.id
    render(<CanvasWorkspace />)

    const textFile = new File(['prompt'], 'prompt.txt', { type: 'text/plain' })
    const node = screen.getByTestId(`react-flow-node-${nodeId}`)
    const dropEvent = createEvent.drop(node, {
      dataTransfer: { files: [textFile] },
    })
    Object.defineProperty(dropEvent, 'clientX', { value: 140 })
    Object.defineProperty(dropEvent, 'clientY', { value: 180 })
    fireEvent(node, dropEvent)

    await waitFor(() => expect(projectStore.getState().project.resources[resourceId]?.type).toBe('text'))

    const state = projectStore.getState()
    expect(Object.keys(state.project.resources)).toEqual([resourceId])
    expect(state.project.resources[resourceId]).toMatchObject({
      type: 'text',
      name: 'prompt.txt',
      value: { assetId: `asset_${resourceId}`, kind: 'text' },
    })
    expect(state.project.assets[`asset_${resourceId}`]?.primitiveValue).toBe('warm kitchen')
    expect(state.project.canvas.nodes.find((item) => item.id === nodeId)).toMatchObject({
      position: { x: 120, y: 160 },
      data: expect.objectContaining({ resourceId, resourceType: 'text' }),
    })
    expect(state.project.history?.undoStack.at(-1)).toEqual(expect.objectContaining({ label: 'Replace text asset' }))
  })

  it('opens a compatible function menu from an asset node context menu', () => {
    projectStore.getState().addEmptyResourceAtPosition('image', { x: 120, y: 160 })
    const resourceId = Object.keys(projectStore.getState().project.resources)[0]!
    const nodeId = projectStore.getState().project.canvas.nodes.find((node) => node.data.resourceId === resourceId)?.id
    projectStore.setState((state) => ({
      project: {
        ...state.project,
        functions: {
          fn_image: functionDef('fn_image', 'Image Edit', 'image'),
          fn_text: functionDef('fn_text', 'Text Case', 'text'),
        },
      },
    }))
    render(<CanvasWorkspace />)

    fireEvent.contextMenu(screen.getByTestId(`react-flow-node-${nodeId}`), { clientX: 320, clientY: 340 })

    expect(screen.queryByRole('menuitem', { name: 'Add image asset' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Image Edit' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Text Case' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Image Edit' }))

    expect(screen.queryByRole('menu', { name: 'Asset canvas menu' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Image Edit function command' })).toBeInTheDocument()
    expect(within(screen.getByLabelText('Selected assets')).getAllByText('Image').length).toBeGreaterThan(0)
  })

  it('lets a function popup pick a replacement input asset from the canvas', () => {
    const ids = ['res_image_1', 'asset_image_1', 'res_image_2', 'asset_image_2']
    ids.reverse()
    projectStore.setState((state) => ({
      project: {
        ...state.project,
        functions: {
          fn_image: functionDef('fn_image', 'Image Edit', 'image'),
        },
      },
      idFactory: () => ids.pop() ?? 'fallback',
    }))
    projectStore.getState().addEmptyResourceAtPosition('image', { x: 120, y: 160 })
    projectStore.getState().addEmptyResourceAtPosition('image', { x: 420, y: 160 })
    const firstNodeId = projectStore.getState().project.canvas.nodes[0]!.id
    const secondNodeId = projectStore.getState().project.canvas.nodes[1]!.id
    const secondResourceId = String(projectStore.getState().project.canvas.nodes[1]!.data.resourceId)
    const runFunctionAtPosition = vi.fn(async () => 'run_new')
    projectStore.setState({ runFunctionAtPosition: runFunctionAtPosition as never })
    render(<CanvasWorkspace />)

    fireEvent.contextMenu(screen.getByTestId(`react-flow-node-${firstNodeId}`), { clientX: 320, clientY: 340 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Image Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick image from canvas' }))

    expect(screen.getByRole('status')).toHaveTextContent('Pick image for image')

    fireEvent.click(screen.getByTestId(`react-flow-node-${secondNodeId}`))
    fireEvent.click(screen.getByRole('button', { name: 'Run function' }))

    expect(runFunctionAtPosition).toHaveBeenCalledWith(
      'fn_image',
      { image: { resourceId: secondResourceId, type: 'image' } },
      { x: 310, y: 320 },
      1,
      expect.objectContaining({ id: 'fn_image' }),
    )
  })

  it('opens a full preview from an asset card preview', () => {
    projectStore.getState().addTextResourceAtPosition('Prompt', 'warm kitchen', { x: 120, y: 160 })
    render(<CanvasWorkspace />)

    fireEvent.click(screen.getByRole('button', { name: 'Preview Prompt' }))

    expect(screen.getByRole('dialog', { name: 'Preview Prompt.txt' })).toBeInTheDocument()
    expect(screen.getByText('warm kitchen')).toBeInTheDocument()
  })

  it('records a dragged asset node position as one history entry when the drag ends', () => {
    projectStore.getState().addTextResourceAtPosition('Prompt', 'warm kitchen', { x: 120, y: 160 })
    const nodeId = projectStore.getState().project.canvas.nodes[0]!.id
    const beforeHistoryLength = projectStore.getState().project.history?.undoStack.length ?? 0
    render(<CanvasWorkspace />)

    fireEvent.click(screen.getByRole('button', { name: `Drag ${nodeId}` }))

    const state = projectStore.getState()
    expect(state.project.canvas.nodes[0]).toMatchObject({ position: { x: 460, y: 500 } })
    expect(state.project.history?.undoStack).toHaveLength(beforeHistoryLength + 1)
    expect(state.project.history?.undoStack.at(-1)).toEqual(
      expect.objectContaining({
        label: 'Move node',
        transactionType: 'canvas',
        affectedIds: expect.objectContaining({
          nodeIds: [nodeId],
          assetIds: [state.project.canvas.nodes[0]!.data.resourceId],
        }),
      }),
    )
  })

  it('maps generated asset cards to their run status, source function, and error details', () => {
    const sourceProject = project()
    sourceProject.functions = { fn_edit: functionDef('fn_edit', 'Klein9B Image Edit', 'image') }
    sourceProject.resources.res_output = {
      ...sourceProject.resources.res_output,
      source: { kind: 'function_output', taskId: 'task_1', runId: 'run_1', outputKey: 'image' },
    }
    sourceProject.tasks.task_1 = {
      ...sourceProject.tasks.task_1,
      status: 'failed',
      startedAt: '2026-06-24T00:00:00.000Z',
      updatedAt: '2026-06-24T00:00:03.000Z',
      completedAt: '2026-06-24T00:00:03.000Z',
      error: { code: 'COMFY_FAILED', message: 'Comfy queue failed' },
    }
    projectStore.setState({ project: sourceProject })

    render(<CanvasWorkspace />)

    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByText('3s')).toBeInTheDocument()
    expect(screen.getByText('Klein9B Image Edit')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Comfy queue failed')
  })

  it('opens the saved function command from a generated asset chip and submits the snapshot inputs', () => {
    const sourceProject = project()
    const snapshotFunction = {
      id: 'fn_edit',
      name: 'Snapshot Image Edit',
      category: 'Edit',
      workflow: { format: 'comfyui_api_json' as const, rawJson: {} },
      inputs: [{ key: 'prompt', label: 'Prompt', type: 'text' as const, required: true, bind: { path: 'prompt' } }],
      outputs: [{ key: 'image', label: 'Image', type: 'image' as const, bind: {}, extract: { source: 'history' as const } }],
      createdAt: '2026-06-23T00:00:00.000Z',
      updatedAt: '2026-06-23T00:00:00.000Z',
    }
    sourceProject.functions = {
      fn_edit: { ...snapshotFunction, name: 'Current Image Edit' },
    }
    sourceProject.resources.res_output = {
      ...sourceProject.resources.res_output,
      source: { kind: 'function_output', runId: 'run_1', outputKey: 'image' },
    }
    sourceProject.runs = {
      run_1: {
        id: 'run_1',
        functionId: 'fn_edit',
        functionName: 'Snapshot Image Edit',
        functionSnapshot: snapshotFunction,
        provider: 'comfyui',
        inputRefs: { prompt: { resourceId: 'res_prompt', type: 'text' } },
        inputValuesSnapshot: {
          prompt: {
            key: 'prompt',
            label: 'Prompt',
            type: 'text',
            required: true,
            source: 'resource',
            value: 'make it brighter',
            resourceId: 'res_prompt',
          },
        },
        primitiveParams: {},
        seedPatchLog: [],
        runIndex: 1,
        runTotal: 1,
        outputRefs: { image: [{ resourceId: 'res_output', type: 'image' }] },
        taskIds: ['task_1'],
        status: 'succeeded',
        createdAt: '2026-06-23T00:00:00.000Z',
        updatedAt: '2026-06-23T00:00:00.000Z',
        completedAt: '2026-06-23T00:00:03.000Z',
      },
    }
    const runFunctionAtPosition = vi.fn(async () => 'run_new')
    projectStore.setState({ project: sourceProject, runFunctionAtPosition: runFunctionAtPosition as never })

    render(<CanvasWorkspace />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit and run Snapshot Image Edit' }))

    expect(screen.getByRole('dialog', { name: 'Snapshot Image Edit function command' })).toBeInTheDocument()
    expect(within(screen.getByLabelText('Selected assets')).getByText('Prompt')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Run function' }))

    expect(runFunctionAtPosition).toHaveBeenCalledWith(
      'fn_edit',
      { prompt: { resourceId: 'res_prompt', type: 'text' } },
      { x: 720, y: 0 },
      1,
      expect.objectContaining({ name: 'Snapshot Image Edit' }),
    )
  })

  it('renders a draggable minimap viewport without recording graph history', () => {
    projectStore.getState().addTextResourceAtPosition('Prompt', 'warm kitchen', { x: 120, y: 160 })
    const beforeHistoryLength = projectStore.getState().project.history?.undoStack.length ?? 0
    render(<CanvasWorkspace />)

    const minimap = screen.getByRole('img', { name: 'Canvas minimap viewport' })
    fireEvent.pointerDown(minimap, { clientX: 180, clientY: 120, pointerId: 1 })
    fireEvent.pointerMove(minimap, { clientX: 210, clientY: 140, pointerId: 1 })
    fireEvent.pointerUp(minimap, { clientX: 210, clientY: 140, pointerId: 1 })

    expect(reactFlowMock.setViewport).toHaveBeenCalled()
    expect(projectStore.getState().project.history?.undoStack).toHaveLength(beforeHistoryLength)
  })

  it('keeps generated asset duration ticking while the run is active', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-24T00:00:02.000Z'))
    try {
      const sourceProject = project()
      sourceProject.functions = { fn_edit: functionDef('fn_edit', 'Klein9B Image Edit', 'image') }
      sourceProject.resources.res_output = {
        ...sourceProject.resources.res_output,
        source: { kind: 'function_output', runId: 'run_1', outputKey: 'image' },
      }
      sourceProject.runs = {
        run_1: {
          id: 'run_1',
          functionId: 'fn_edit',
          functionName: 'Klein9B Image Edit',
          functionSnapshot: sourceProject.functions.fn_edit!,
          provider: 'comfyui',
          inputRefs: { prompt: { resourceId: 'res_prompt', type: 'text' } },
          inputValuesSnapshot: {},
          primitiveParams: {},
          seedPatchLog: [],
          runIndex: 1,
          runTotal: 1,
          outputRefs: { image: [{ resourceId: 'res_output', type: 'image' }] },
          taskIds: ['task_1'],
          status: 'running',
          createdAt: '2026-06-24T00:00:00.000Z',
          updatedAt: '2026-06-24T00:00:02.000Z',
        },
      }
      sourceProject.tasks.task_1 = {
        ...sourceProject.tasks.task_1,
        status: 'running',
        startedAt: '2026-06-24T00:00:00.000Z',
        updatedAt: '2026-06-24T00:00:02.000Z',
      }
      projectStore.setState({ project: sourceProject })

      render(<CanvasWorkspace />)

      expect(screen.getByText('running')).toBeInTheDocument()
      expect(screen.getByText('2s')).toBeInTheDocument()

      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      expect(screen.getByText('4s')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
