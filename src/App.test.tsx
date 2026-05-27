import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { projectStore } from './store/projectStore'

describe('App', () => {
  const originalCheckComfyEndpointStatuses = projectStore.getState().checkComfyEndpointStatuses

  beforeEach(() => {
    projectStore.setState({
      checkComfyEndpointStatuses: vi.fn().mockResolvedValue(undefined),
    } as Partial<ReturnType<typeof projectStore.getState>>)
  })

  afterEach(() => {
    cleanup()
    projectStore.setState({
      checkComfyEndpointStatuses: originalCheckComfyEndpointStatuses,
    } as Partial<ReturnType<typeof projectStore.getState>>)
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('renders the workstation shell without stale quick-start actions', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Infinity ComfyUI' })).toBeInTheDocument()
    expect(screen.getByText('Assets')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Functions' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'ComfyUI Servers' })).toBeInTheDocument()
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
})
