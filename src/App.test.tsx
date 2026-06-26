import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { projectStore } from './store/projectStore'

describe('App', () => {
  const originalCheckComfyEndpointStatuses = projectStore.getState().checkComfyEndpointStatuses
  const originalProject = projectStore.getState().project
  const originalProjectLibrary = projectStore.getState().projectLibrary

  beforeEach(() => {
    projectStore.setState({
      checkComfyEndpointStatuses: vi.fn().mockResolvedValue(undefined),
    } as Partial<ReturnType<typeof projectStore.getState>>)
  })

  afterEach(() => {
    cleanup()
    projectStore.setState({
      checkComfyEndpointStatuses: originalCheckComfyEndpointStatuses,
      project: originalProject,
      projectLibrary: originalProjectLibrary,
    } as Partial<ReturnType<typeof projectStore.getState>>)
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('renders the workstation shell without stale quick-start actions', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Infinity ComfyUI' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assets' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ComfyUI Servers' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Project Tasks' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Queue' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Functions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Inspector' })).not.toBeInTheDocument()
    expect(screen.queryByText('No selection')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Right tools panel')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /right panel/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run MVP' })).not.toBeInTheDocument()
  })

  it('defaults to the light theme and toggles to dark theme', () => {
    render(<App />)

    expect(screen.getByLabelText('Infinity ComfyUI workbench')).toHaveAttribute('data-theme', 'light')

    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }))

    expect(screen.getByLabelText('Infinity ComfyUI workbench')).toHaveAttribute('data-theme', 'dark')
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument()
  })

  it('checks ComfyUI server statuses every five seconds', () => {
    vi.useFakeTimers()
    const checkComfyEndpointStatuses = vi.fn().mockResolvedValue(undefined)
    projectStore.setState({ checkComfyEndpointStatuses } as Partial<ReturnType<typeof projectStore.getState>>)

    render(<App />)

    expect(checkComfyEndpointStatuses).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(4999)
    })
    expect(checkComfyEndpointStatuses).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(checkComfyEndpointStatuses).toHaveBeenCalledTimes(2)
  })

  it('switches projects from the topbar project selector', () => {
    projectStore.getState().updateProjectMetadata({ name: 'Kitchen Board' })
    const firstProjectId = projectStore.getState().project.project.id
    const secondProjectId = projectStore.getState().createProject({ name: 'Mood Board' })
    projectStore.getState().switchProject(firstProjectId)

    render(<App />)

    const projectSelector = screen.getByRole('combobox', { name: 'Current project' })
    expect(projectSelector).toHaveValue(firstProjectId)
    expect(screen.getByRole('option', { name: 'Kitchen Board' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Mood Board' })).toBeInTheDocument()

    fireEvent.change(projectSelector, { target: { value: secondProjectId } })

    expect(projectSelector).toHaveValue(secondProjectId)
    expect(projectSelector).toHaveDisplayValue('Mood Board')
  })
})
