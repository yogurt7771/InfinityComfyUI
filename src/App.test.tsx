import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  it('keeps portaled function runner dialogs under the active theme scope', () => {
    render(<App />)

    const workbench = screen.getByLabelText('Infinity ComfyUI workbench')
    expect(workbench).toHaveAttribute('data-theme', 'light')

    fireEvent.contextMenu(screen.getByLabelText('Canvas'), { clientX: 180, clientY: 160 })
    fireEvent.click(within(screen.getByRole('menu', { name: 'Add node' })).getByRole('menuitem', { name: 'OpenAI LLM' }))

    const dialog = screen.getByRole('dialog', { name: 'Run OpenAI LLM' })
    expect(dialog).toHaveClass('function-run-dialog')
    expect(dialog.closest('[data-theme="light"]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }))

    expect(workbench).toHaveAttribute('data-theme', 'dark')
    expect(dialog.closest('[data-theme="dark"]')).not.toBeNull()
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

    const projectSelector = screen.getByRole('button', { name: 'Current project' })
    expect(projectSelector).toHaveTextContent('Kitchen Board')
    expect(projectSelector).toHaveAttribute('aria-haspopup', 'listbox')
    expect(projectSelector).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(projectSelector)

    expect(projectSelector).toHaveAttribute('aria-expanded', 'true')
    const projectList = screen.getByRole('listbox', { name: 'Project list' })
    expect(within(projectList).getByRole('option', { name: /Kitchen Board/ })).toHaveAttribute('aria-selected', 'true')
    const moodBoardOption = within(projectList).getByRole('option', { name: /Mood Board/ })
    expect(moodBoardOption).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(moodBoardOption)

    expect(projectStore.getState().project.project.id).toBe(secondProjectId)
    expect(projectSelector).toHaveTextContent('Mood Board')
    expect(projectSelector).toHaveAttribute('aria-expanded', 'false')
  })

  it('moves project import, export, and metadata editing into the topbar', async () => {
    projectStore.getState().updateProjectMetadata({
      name: 'Kitchen Board',
      description: 'Original project brief',
    })
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:project-download')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    render(<App />)

    const topbar = screen.getByRole('banner')
    expect(within(topbar).queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument()
    expect(within(topbar).getByRole('button', { name: 'New project' })).toBeVisible()
    expect(within(topbar).getByRole('button', { name: 'Edit project information' })).toBeVisible()
    const exportProjectButton = within(topbar).getByRole('button', { name: 'Export Project' })
    const exportConfigButton = within(topbar).getByRole('button', { name: 'Export Config' })
    const importProjectButton = within(topbar).getByRole('button', { name: 'Import Project' })
    expect(exportProjectButton).toBeVisible()
    expect(exportConfigButton).toBeVisible()
    expect(importProjectButton).toBeVisible()

    fireEvent.click(exportProjectButton)
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1))
    expect(anchorClick).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:project-download')

    fireEvent.click(exportConfigButton)
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2))
    expect(anchorClick).toHaveBeenCalledTimes(2)

    const importInput = topbar.querySelector('input[type="file"]') as HTMLInputElement
    const importInputClick = vi.spyOn(importInput, 'click').mockImplementation(() => undefined)
    fireEvent.click(importProjectButton)
    expect(importInputClick).toHaveBeenCalledTimes(1)

    const projectSelector = within(topbar).getByRole('button', { name: 'Current project' })
    expect(projectSelector).toHaveTextContent('Kitchen Board')

    fireEvent.click(within(topbar).getByRole('button', { name: 'Edit project information' }))

    const dialog = screen.getByRole('dialog', { name: 'Project information' })
    fireEvent.change(within(dialog).getByLabelText('Project name'), { target: { value: 'Renamed Kitchen Board' } })
    fireEvent.change(within(dialog).getByLabelText('Project description'), {
      target: { value: 'Updated project brief' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: /save/i }))

    expect(projectStore.getState().project.project).toMatchObject({
      name: 'Renamed Kitchen Board',
      description: 'Updated project brief',
    })
    expect(projectSelector).toHaveTextContent('Renamed Kitchen Board')
    expect(screen.queryByRole('dialog', { name: 'Project information' })).not.toBeInTheDocument()
  })
})
