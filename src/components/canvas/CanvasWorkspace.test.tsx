import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { MouseEvent, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../../domain/types'
import { readFileAsMediaResource } from '../../domain/resourceFiles'
import { projectStore } from '../../store/projectStore'
import { assetCanvasNodeTypes, CanvasWorkspace, projectToAssetGraph, selectedResourcesForAssetNodes } from './CanvasWorkspace'

vi.mock('@xyflow/react', async () => {
  return {
    Background: () => null,
    Controls: () => <div className="react-flow__controls" data-testid="react-flow-controls" />,
    Handle: () => null,
    MarkerType: { ArrowClosed: 'arrowclosed' },
    Position: { Left: 'left', Right: 'right' },
    ReactFlow: ({
      children,
      onPaneContextMenu,
    }: {
      children?: ReactNode
      onPaneContextMenu?: (event: MouseEvent<HTMLDivElement>) => void
    }) => (
      <div data-testid="react-flow-pane" onContextMenu={onPaneContextMenu}>
        {children}
      </div>
    ),
    ReactFlowProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useReactFlow: () => ({
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x: x - 10, y: y - 20 }),
    }),
  }
})

vi.mock('../../domain/resourceFiles', () => ({
  readFileAsMediaResource: vi.fn(async (file: File) => ({
    type: 'image',
    media: {
      url: `data:${file.type};base64,cmVuZGVy`,
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    },
  })),
}))

const readFileAsMediaResourceMock = vi.mocked(readFileAsMediaResource)

beforeEach(() => {
  readFileAsMediaResourceMock.mockImplementation(async (file: File) => ({
    type: 'image',
    media: {
      url: `data:${file.type};base64,cmVuZGVy`,
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    },
  }))
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
    readFileAsMediaResourceMock.mockRejectedValueOnce(new Error('read failed'))
    render(<CanvasWorkspace />)

    const file = new File(['render'], 'broken.png', { type: 'image/png' })
    const canvas = screen.getByLabelText('Asset canvas workspace')
    const dropEvent = createEvent.drop(canvas, {
      dataTransfer: { files: [file] },
    })
    Object.defineProperty(dropEvent, 'clientX', { value: 210 })
    Object.defineProperty(dropEvent, 'clientY', { value: 260 })
    fireEvent(canvas, dropEvent)

    await waitFor(() => expect(readFileAsMediaResourceMock).toHaveBeenCalledWith(file))

    expect(Object.values(projectStore.getState().project.resources).some((resource) => resource.name === 'broken.png')).toBe(false)
  })
})
