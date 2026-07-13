import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../domain/types'
import { projectStore } from '../store/projectStore'

type FlowNode = {
  id: string
  type?: string
  selected?: boolean
}

type NodeContextMenuHandler = (
  event: {
    preventDefault: () => void
    stopPropagation: () => void
    clientX: number
    clientY: number
  },
  node: FlowNode,
) => void

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  const React = await import('react')
  return {
    ...actual,
    ReactFlow: (props: { nodes?: FlowNode[]; onNodeContextMenu?: NodeContextMenuHandler }) =>
      React.createElement(
        'div',
        { className: 'react-flow' },
        ...(props.nodes ?? []).map((node) =>
          React.createElement(
            'button',
            {
              key: node.id,
              type: 'button',
              'aria-label': `Canvas node ${node.id}`,
              className: `react-flow__node${node.selected ? ' selected' : ''}`,
              onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => props.onNodeContextMenu?.(event, node),
            },
            node.id,
          ),
        ),
      ),
  }
})

import { CanvasWorkspace } from './CanvasWorkspace'

describe('CanvasWorkspace template naming dialog', () => {
  const initialState = projectStore.getInitialState()
  let promptSpy: ReturnType<typeof vi.spyOn>

  const renderSelectedPair = () => {
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
      templates: {},
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
    fireEvent.contextMenu(screen.getByRole('button', { name: `Canvas node ${firstNodeId}` }), {
      clientX: 240,
      clientY: 180,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Selection as Template' }))
  }

  beforeEach(() => {
    promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null)
  })

  afterEach(() => {
    cleanup()
    projectStore.setState(initialState, true)
    vi.restoreAllMocks()
  })

  it('opens an accessible in-app naming dialog without invoking a blocking browser prompt', () => {
    renderSelectedPair()

    expect(promptSpy).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: /save.*template/i })
    expect(within(dialog).getByRole('textbox', { name: /template name/i })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /^cancel$/i })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /^save$/i })).toBeInTheDocument()
  })

  it('keeps a blank name unsaved and lets Cancel close the dialog', () => {
    renderSelectedPair()
    const dialog = screen.getByRole('dialog', { name: /save.*template/i })
    const nameInput = within(dialog).getByRole('textbox', { name: /template name/i })
    const saveButton = within(dialog).getByRole('button', { name: /^save$/i })

    fireEvent.change(nameInput, { target: { value: '   ' } })
    fireEvent.click(saveButton)

    expect(screen.getByRole('dialog', { name: /save.*template/i })).toBeInTheDocument()
    expect(Object.values(projectStore.getState().project.templates ?? {})).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByRole('dialog', { name: /save.*template/i })).not.toBeInTheDocument()
    expect(Object.values(projectStore.getState().project.templates ?? {})).toHaveLength(0)
  })

  it('saves the entered name and exposes the new template in the Add node menu', async () => {
    renderSelectedPair()
    const dialog = screen.getByRole('dialog', { name: /save.*template/i })

    fireEvent.change(within(dialog).getByRole('textbox', { name: /template name/i }), {
      target: { value: 'Matrix Pair' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /save.*template/i })).not.toBeInTheDocument()
    })
    expect(Object.values(projectStore.getState().project.templates ?? {})).toEqual([
      expect.objectContaining({ name: 'Matrix Pair' }),
    ])

    fireEvent.contextMenu(screen.getByLabelText('Canvas'), { clientX: 700, clientY: 480 })
    const addMenu = screen.getByRole('menu', { name: 'Add node' })
    expect(within(addMenu).getByRole('menuitem', { name: 'Template: Matrix Pair' })).toBeInTheDocument()
  })
})
