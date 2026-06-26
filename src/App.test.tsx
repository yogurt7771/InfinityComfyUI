import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

  it('moves project import, export, and metadata editing into the topbar', () => {
    projectStore.getState().updateProjectMetadata({
      name: 'Kitchen Board',
      description: 'Original project brief',
    })

    render(<App />)

    const topbar = screen.getByRole('banner')
    expect(within(topbar).queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument()
    expect(within(topbar).getByRole('button', { name: /export project/i })).toBeVisible()
    expect(within(topbar).getByRole('button', { name: /import project/i })).toBeVisible()

    const projectSelector = within(topbar).getByRole('combobox', { name: 'Current project' })
    expect(projectSelector).toHaveDisplayValue('Kitchen Board')

    fireEvent.click(within(topbar).getByRole('button', { name: /edit project (information|details|metadata)/i }))

    const dialog = screen.getByRole('dialog', { name: /project (information|details|metadata)/i })
    fireEvent.change(within(dialog).getByLabelText('Project name'), { target: { value: 'Renamed Kitchen Board' } })
    fireEvent.change(within(dialog).getByLabelText('Project description'), {
      target: { value: 'Updated project brief' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: /save/i }))

    expect(projectStore.getState().project.project).toMatchObject({
      name: 'Renamed Kitchen Board',
      description: 'Updated project brief',
    })
    expect(projectSelector).toHaveDisplayValue('Renamed Kitchen Board')
    expect(screen.queryByRole('dialog', { name: /project (information|details|metadata)/i })).not.toBeInTheDocument()
  })
})
