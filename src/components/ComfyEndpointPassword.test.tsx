import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LeftPanel, openComfyEditorInBrowser } from './WorkbenchPanels'
import { projectStore } from '../store/projectStore'

const endpointPasswordLabel = /^comfyui password$/i
const endpointTokenLabel = /^comfyui api token$/i

describe('ComfyUI server password configuration', () => {
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

  it('shows and saves password and API token together without expanding advanced controls', () => {
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
    const passwordInput = within(dialog).getByLabelText(endpointPasswordLabel)
    const tokenInput = within(dialog).queryByLabelText(endpointTokenLabel)
    expect.soft(within(dialog).queryByText(/api token fallback.*optional/i)).not.toBeInTheDocument()
    expect(tokenInput).not.toBeNull()
    if (!(tokenInput instanceof HTMLInputElement)) return

    expect(passwordInput).not.toBe(tokenInput)
    expect(passwordInput).toBeVisible()
    expect(passwordInput).toHaveAttribute('type', 'password')
    expect(passwordInput).toHaveValue('fixture-existing-password')
    expect(tokenInput).toBeVisible()
    expect(tokenInput).toHaveAttribute('type', 'password')
    expect(tokenInput).toHaveValue('fixture-existing-token')

    fireEvent.change(passwordInput, { target: { value: 'fixture-edited-password' } })
    fireEvent.change(tokenInput, { target: { value: 'fixture-edited-token' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(projectStore.getState().project.comfy.endpoints[0]?.auth).toEqual({
      type: 'password',
      password: 'fixture-edited-password',
      token: 'fixture-edited-token',
    })
  })

  it('keeps an existing legacy token when a password is saved', () => {
    render(<LeftPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'ComfyUI Servers' }))
    const popover = screen.getByLabelText('ComfyUI Servers popover')
    const serverList = within(popover).getByLabelText('ComfyUI server list')
    fireEvent.click(within(serverList).getByRole('button', { name: /edit (server|endpoint) password test comfyui/i }))

    let dialog = screen.getByRole('dialog', { name: /edit comfyui server/i })
    const passwordInput = within(dialog).getByLabelText(endpointPasswordLabel)
    const tokenFallbackInput = within(dialog).getByLabelText(endpointTokenLabel)
    expect(passwordInput).toHaveAttribute('type', 'password')
    expect(passwordInput).toHaveValue('')
    expect(tokenFallbackInput).toHaveAttribute('type', 'password')
    expect(tokenFallbackInput).toHaveValue('fixture-legacy-token')

    fireEvent.change(within(dialog).getByLabelText(/(server|endpoint) name/i), {
      target: { value: 'Password Test Renamed' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: /save/i }))

    expect(projectStore.getState().project.comfy.endpoints[0]?.auth).toEqual({
      type: 'token',
      token: 'fixture-legacy-token',
    })

    fireEvent.click(within(serverList).getByRole('button', { name: /edit (server|endpoint) password test renamed/i }))
    dialog = screen.getByRole('dialog', { name: /edit comfyui server/i })
    fireEvent.change(within(dialog).getByLabelText(endpointPasswordLabel), {
      target: { value: 'fixture-saved-ui-password' },
    })
    expect(projectStore.getState().project.comfy.endpoints[0]?.auth).toEqual({
      type: 'token',
      token: 'fixture-legacy-token',
    })

    fireEvent.click(within(dialog).getByRole('button', { name: /save/i }))

    expect(projectStore.getState().project.comfy.endpoints[0]?.auth).toEqual({
      type: 'password',
      password: 'fixture-saved-ui-password',
      token: 'fixture-legacy-token',
    })
  })

  it('stores a password authentication entry when creating a new ComfyUI server', () => {
    render(<LeftPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'ComfyUI Servers' }))
    const popover = screen.getByLabelText('ComfyUI Servers popover')
    fireEvent.click(within(popover).getByRole('button', { name: /new|新建/i }))
    const dialog = screen.getByRole('dialog', { name: /new comfyui server|create comfyui server/i })

    const tokenInput = within(dialog).getByLabelText(endpointTokenLabel)
    expect(tokenInput).toBeVisible()
    expect(tokenInput).toHaveAttribute('type', 'password')
    expect(tokenInput).toHaveValue('')
    fireEvent.change(within(dialog).getByLabelText(/(server|endpoint) name/i), {
      target: { value: 'Created Password ComfyUI' },
    })
    fireEvent.change(within(dialog).getByLabelText(/url/i), {
      target: { value: 'http://127.0.0.1:8188' },
    })
    fireEvent.change(within(dialog).getByLabelText(endpointPasswordLabel), {
      target: { value: 'fixture-created-ui-password' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add server' }))

    expect(projectStore.getState().project.comfy.endpoints.at(-1)).toMatchObject({
      name: 'Created Password ComfyUI',
      baseUrl: 'http://127.0.0.1:8188',
      auth: { type: 'password', password: 'fixture-created-ui-password' },
    })
  })

  it('submits a saved password directly to the ComfyUI login route without exposing its bearer fallback', () => {
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
    const submittedForm = submitSpy.mock.contexts[0] as HTMLFormElement | undefined

    expect(error).toBeUndefined()
    expect(submittedForm?.method.toLowerCase()).toBe('post')
    expect(submittedForm?.action).toBe('http://127.0.0.1:27707/login')
    const body = new FormData(submittedForm)
    expect(body.get('password')).toBe('fixture-editor-ui-password')
    expect(body.get('token')).toBeNull()
    expect(submittedForm?.action).not.toContain('fixture-editor-fallback-token')
    expect(submittedForm?.outerHTML).not.toContain('/__comfy_proxy/')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(popup.opener).toBeNull()
  })
})
