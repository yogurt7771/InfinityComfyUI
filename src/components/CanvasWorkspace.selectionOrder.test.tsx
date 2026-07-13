import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../domain/types'
import { projectStore } from '../store/projectStore'

type SelectionPayload = {
  nodes: Array<{ id: string }>
  edges: Array<{ id: string }>
}

type SelectionNodeChange = {
  id: string
  type: 'select'
  selected: boolean
}

type NodeClickEvent = {
  target: EventTarget
  currentTarget: EventTarget
  detail: number
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  clientX: number
  clientY: number
  preventDefault: () => void
  stopPropagation: () => void
}

const selectionHarness = vi.hoisted(() => ({
  onSelectionChange: undefined as ((payload: SelectionPayload) => void) | undefined,
  onNodesChange: undefined as ((changes: SelectionNodeChange[]) => void) | undefined,
  onNodeClick: undefined as ((event: NodeClickEvent, node: { id: string; type?: string }) => void) | undefined,
  nodes: [] as Array<{ id: string; type?: string; selected?: boolean }>,
  renderCount: 0,
}))

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  const React = await import('react')
  return {
    ...actual,
    ReactFlow: (props: {
      nodes?: Array<{ id: string; type?: string; selected?: boolean }>
      onSelectionChange?: (payload: SelectionPayload) => void
      onNodesChange?: (changes: SelectionNodeChange[]) => void
      onNodeClick?: (event: NodeClickEvent, node: { id: string; type?: string }) => void
    }) => {
      selectionHarness.renderCount += 1
      selectionHarness.onSelectionChange = props.onSelectionChange
      selectionHarness.onNodesChange = props.onNodesChange
      selectionHarness.onNodeClick = props.onNodeClick
      selectionHarness.nodes = props.nodes ?? []
      return React.createElement('div', { 'data-testid': 'react-flow-selection-harness' })
    },
  }
})

import { CanvasWorkspace } from './CanvasWorkspace'

describe('CanvasWorkspace selection ordering', () => {
  const initialState = projectStore.getInitialState()

  afterEach(() => {
    cleanup()
    projectStore.setState(initialState, true)
    selectionHarness.onSelectionChange = undefined
    selectionHarness.onNodesChange = undefined
    selectionHarness.onNodeClick = undefined
    selectionHarness.nodes = []
    selectionHarness.renderCount = 0
    vi.restoreAllMocks()
  })

  it('treats reordered React Flow selection callbacks as the same selected node set', () => {
    const emptyProject: ProjectState = {
      ...initialState.project,
      canvas: {
        ...initialState.project.canvas,
        nodes: [],
        edges: [],
      },
      resources: {},
      assets: {},
      tasks: {},
    }
    projectStore.setState({
      project: emptyProject,
      selectedNodeId: undefined,
      selectedNodeIds: [],
    })
    const firstNodeId = projectStore.getState().addTextResourceAtPosition('A', 'first', { x: 100, y: 120 })
    const secondNodeId = projectStore.getState().addTextResourceAtPosition('B', 'second', { x: 420, y: 120 })
    projectStore.setState({
      selectedNodeId: secondNodeId,
      selectedNodeIds: [firstNodeId, secondNodeId],
    })

    render(<CanvasWorkspace />)
    expect(screen.getByTestId('react-flow-selection-harness')).toBeInTheDocument()
    expect(selectionHarness.onSelectionChange).toBeTypeOf('function')
    const baselineRenderCount = selectionHarness.renderCount
    let selectionUpdateCount = 0
    const unsubscribe = projectStore.subscribe((state, previous) => {
      if (state.selectedNodeIds !== previous.selectedNodeIds) selectionUpdateCount += 1
    })

    try {
      const callbackOrders = [
        [secondNodeId, firstNodeId],
        [firstNodeId, secondNodeId],
        [secondNodeId, firstNodeId],
      ]
      for (const nodeIds of callbackOrders) {
        act(() => {
          selectionHarness.onSelectionChange?.({
            nodes: nodeIds.map((id) => ({ id })),
            edges: [],
          })
        })
      }

      expect.soft(
        projectStore.getState().selectedNodeIds,
        'the store selection should stay stable when React Flow reports the same node set in a different order',
      ).toEqual([firstNodeId, secondNodeId])
      expect
        .soft(selectionUpdateCount, 'reordered selection callbacks should not create redundant store updates')
        .toBe(0)
      expect
        .soft(selectionHarness.renderCount, 'reordered selection callbacks should not re-enter React Flow rendering')
        .toBe(baselineRenderCount)
      expect(screen.getByTestId('react-flow-selection-harness')).toBeInTheDocument()
    } finally {
      unsubscribe()
    }
  })

  it('keeps Ctrl-add selection stable across interleaved React Flow callbacks', () => {
    const emptyProject: ProjectState = {
      ...initialState.project,
      canvas: {
        ...initialState.project.canvas,
        nodes: [],
        edges: [],
      },
      resources: {},
      assets: {},
      tasks: {},
    }
    projectStore.setState({
      project: emptyProject,
      selectedNodeId: undefined,
      selectedNodeIds: [],
    })
    const firstNodeId = projectStore.getState().addTextResourceAtPosition('A', 'first', { x: 100, y: 120 })
    const secondNodeId = projectStore.getState().addTextResourceAtPosition('B', 'second', { x: 420, y: 120 })
    projectStore.setState({ selectedNodeId: undefined, selectedNodeIds: [] })

    render(<CanvasWorkspace />)
    expect(selectionHarness.onSelectionChange).toBeTypeOf('function')
    expect(selectionHarness.onNodesChange).toBeTypeOf('function')
    expect(selectionHarness.onNodeClick).toBeTypeOf('function')
    const flowNode = (nodeId: string) => {
      const node = selectionHarness.nodes.find((candidate) => candidate.id === nodeId)
      expect(node).toBeDefined()
      return { id: node!.id, type: node!.type }
    }
    const titleTarget = document.createElement('span')
    titleTarget.className = 'node-title'
    const nodeTarget = document.createElement('div')
    nodeTarget.append(titleTarget)
    const nodeClickEvent = (ctrlKey: boolean): NodeClickEvent => ({
      target: titleTarget,
      currentTarget: nodeTarget,
      detail: 1,
      altKey: false,
      ctrlKey,
      metaKey: false,
      shiftKey: false,
      clientX: 0,
      clientY: 0,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    })
    const emitSelection = (nodeIds: string[]) => {
      act(() => {
        selectionHarness.onSelectionChange?.({ nodes: nodeIds.map((id) => ({ id })), edges: [] })
      })
    }

    act(() => {
      selectionHarness.onNodesChange?.([{ id: firstNodeId, type: 'select', selected: true }])
    })
    emitSelection([firstNodeId])
    act(() => {
      selectionHarness.onNodeClick?.(nodeClickEvent(false), flowNode(firstNodeId))
    })
    expect(projectStore.getState().selectedNodeIds).toEqual([firstNodeId])

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true }))
      selectionHarness.onNodesChange?.([
        { id: firstNodeId, type: 'select', selected: false },
        { id: secondNodeId, type: 'select', selected: true },
      ])
    })
    emitSelection([secondNodeId, firstNodeId])
    act(() => {
      selectionHarness.onNodeClick?.(nodeClickEvent(true), flowNode(secondNodeId))
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft' }))
    })
    expect(projectStore.getState().selectedNodeIds).toEqual(expect.arrayContaining([firstNodeId, secondNodeId]))
    expect(projectStore.getState().selectedNodeIds).toHaveLength(2)

    const stableSelection = [...projectStore.getState().selectedNodeIds]
    const baselineRenderCount = selectionHarness.renderCount
    let selectionUpdateCount = 0
    const unsubscribe = projectStore.subscribe((state, previous) => {
      if (state.selectedNodeIds !== previous.selectedNodeIds) selectionUpdateCount += 1
    })

    try {
      emitSelection([secondNodeId])
      emitSelection([secondNodeId, firstNodeId])
      emitSelection([secondNodeId])
      emitSelection([firstNodeId, secondNodeId])
      emitSelection([secondNodeId])

      expect.soft(projectStore.getState().selectedNodeIds, 'interleaved callbacks must preserve the Ctrl-added selection').toEqual(
        stableSelection,
      )
      expect.soft(selectionUpdateCount, 'interleaved callbacks must not oscillate the store selection').toBe(0)
      expect
        .soft(selectionHarness.renderCount, 'interleaved callbacks must not re-enter React Flow rendering')
        .toBe(baselineRenderCount)
      expect(screen.getByTestId('react-flow-selection-harness')).toBeInTheDocument()
    } finally {
      unsubscribe()
    }
  })
})
