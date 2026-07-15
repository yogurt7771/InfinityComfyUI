import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LeftPanel, openComfyEditorInBrowser } from './WorkbenchPanels'
import { projectStore } from '../store/projectStore'

const endpointPasswordLabel = /^comfyui password$/i
const endpointTokenLabel = /^comfyui api token$/i

describe('ComfyUI server token-only configuration', () => {
  beforeEach(() => {
    const project = structuredClone(projectStore.getState().project)
    project.comfy.endpoints = [
      {
        id: 'endpoint_password_test',
        name: 'Password Test ComfyUI',
        baseUrl: 'http://127.0.0.1:27707',
        enabled: true,
        maxConcurrentJobs: 2,
        priority: 10,
        timeoutMs: 600000,
        auth: { type: 'token', token: 'fixture-legacy-token' },
        health: { status: 'unknown' },
      },
    ]
    projectStore.setState({
      project,
      projectLibrary: { [project.project.id]: project },
      selectedNodeId: undefined,
      selectedNodeIds: [],
    } as unknown as Partial<ReturnType<typeof projectStore.getState>>)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('normalizes a legacy password entry to API-token-only authentication when saved', () => {
    const project = structuredClone(projectStore.getState().project)
    project.comfy.endpoints[0]!.auth = {
      type: 'password',
      password: 'fixture-existing-password',
      token: 'fixture-existing-token',
    }
    projectStore.setState({
      project,
      projectLibrary: { [project.project.id]: project },
    } as unknown as Partial<ReturnType<typeof projectStore.getState>>)

    render(<LeftPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'ComfyUI Servers' }))
    const popover = screen.getByLabelText('ComfyUI Servers popover')
    const serverList = within(popover).getByLabelText('ComfyUI server list')
    fireEvent.click(within(serverList).getByRole('button', { name: /edit (server|endpoint) password test comfyui/i }))

    const dialog = screen.getByRole('dialog', { name: /edit comfyui server/i })
    const tokenInput = within(dialog).getByLabelText(endpointTokenLabel)
    expect(within(dialog).queryByLabelText(endpointPasswordLabel)).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/api token fallback.*optional/i)).not.toBeInTheDocument()
    expect(tokenInput).toBeVisible()
    expect(tokenInput).toHaveAttribute('type', 'password')
    expect(tokenInput).toHaveValue('fixture-existing-token')

    fireEvent.change(tokenInput, { target: { value: 'fixture-edited-token' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(projectStore.getState().project.comfy.endpoints[0]?.auth).toEqual({
      type: 'token',
      token: 'fixture-edited-token',
    })
  })

  it('keeps an existing API token while exposing no password control', () => {
    render(<LeftPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'ComfyUI Servers' }))
    const popover = screen.getByLabelText('ComfyUI Servers popover')
    const serverList = within(popover).getByLabelText('ComfyUI server list')
    fireEvent.click(within(serverList).getByRole('button', { name: /edit (server|endpoint) password test comfyui/i }))

    const dialog = screen.getByRole('dialog', { name: /edit comfyui server/i })
    const tokenInput = within(dialog).getByLabelText(endpointTokenLabel)
    expect(within(dialog).queryByLabelText(endpointPasswordLabel)).not.toBeInTheDocument()
    expect(tokenInput).toHaveAttribute('type', 'password')
    expect(tokenInput).toHaveValue('fixture-legacy-token')

    fireEvent.change(within(dialog).getByLabelText(/(server|endpoint) name/i), {
      target: { value: 'Password Test Renamed' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: /save/i }))

    expect(projectStore.getState().project.comfy.endpoints[0]?.auth).toEqual({
      type: 'token',
      token: 'fixture-legacy-token',
    })

  })

  it('creates a new ComfyUI server with API-token-only authentication', () => {
    render(<LeftPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'ComfyUI Servers' }))
    const popover = screen.getByLabelText('ComfyUI Servers popover')
    fireEvent.click(within(popover).getByRole('button', { name: /new|新建/i }))
    const dialog = screen.getByRole('dialog', { name: /new comfyui server|create comfyui server/i })

    const tokenInput = within(dialog).getByLabelText(endpointTokenLabel)
    expect(within(dialog).queryByLabelText(endpointPasswordLabel)).not.toBeInTheDocument()
    expect(tokenInput).toBeVisible()
    expect(tokenInput).toHaveAttribute('type', 'password')
    expect(tokenInput).toHaveValue('')
    fireEvent.change(within(dialog).getByLabelText(/(server|endpoint) name/i), {
      target: { value: 'Created Token ComfyUI' },
    })
    fireEvent.change(within(dialog).getByLabelText(/url/i), {
      target: { value: 'http://127.0.0.1:8188' },
    })
    fireEvent.change(tokenInput, { target: { value: 'fixture-created-api-token' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add server' }))

    expect(projectStore.getState().project.comfy.endpoints.at(-1)).toMatchObject({
      name: 'Created Token ComfyUI',
      baseUrl: 'http://127.0.0.1:8188',
      auth: { type: 'token', token: 'fixture-created-api-token' },
    })
  })

  it('never submits a saved password when opening ComfyUI and leaves login to the user', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const popup = {} as WindowProxy
    vi.spyOn(window, 'open').mockReturnValue(popup)
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined)
    const endpoint = {
      ...projectStore.getState().project.comfy.endpoints[0]!,
      auth: {
        type: 'password' as const,
        password: 'fixture-editor-ui-password',
        token: 'fixture-editor-fallback-token',
      },
    }

    const error = openComfyEditorInBrowser(endpoint)
    expect(error).toBeUndefined()
    expect(submitSpy).not.toHaveBeenCalled()
    const openedUrl = new URL(String(vi.mocked(window.open).mock.calls[0]?.[0]))
    expect(openedUrl.href).toBe('http://127.0.0.1:27707/')
    expect(openedUrl.href).not.toContain('fixture-editor-ui-password')
    expect(openedUrl.href).not.toContain('fixture-editor-fallback-token')
    expect(openedUrl.href).not.toContain('/__comfy_proxy/')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(popup.opener).toBeNull()
  })
})
