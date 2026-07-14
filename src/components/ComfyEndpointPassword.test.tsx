import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComfyWorkflowEditorDialog, LeftPanel } from './WorkbenchPanels'
import { projectStore } from '../store/projectStore'

const endpointPasswordLabel = /comfyui password/i
const endpointTokenFallbackLabel = /comfyui api token fallback/i

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

  it('keeps an existing legacy token as an optional masked fallback when a password is saved', () => {
    render(<LeftPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'ComfyUI Servers' }))
    const popover = screen.getByLabelText('ComfyUI Servers popover')
    const serverList = within(popover).getByLabelText('ComfyUI server list')
    fireEvent.click(within(serverList).getByRole('button', { name: /edit (server|endpoint) password test comfyui/i }))

    let dialog = screen.getByRole('dialog', { name: /edit comfyui server/i })
    const passwordInput = within(dialog).getByLabelText(endpointPasswordLabel)
    const tokenFallbackInput = within(dialog).getByLabelText(endpointTokenFallbackLabel)
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

    expect(within(dialog).getByLabelText(endpointTokenFallbackLabel)).toHaveValue('')
    fireEvent.change(within(dialog).getByLabelText(/(server|endpoint) name/i), {
      target: { value: 'Created Password ComfyUI' },
    })
    fireEvent.change(within(dialog).getByLabelText(/url/i), {
      target: { value: 'http://127.0.0.1:8188' },
    })
    fireEvent.change(within(dialog).getByLabelText(endpointPasswordLabel), {
      target: { value: 'fixture-created-ui-password' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: /save/i }))

    expect(projectStore.getState().project.comfy.endpoints.at(-1)).toMatchObject({
      name: 'Created Password ComfyUI',
      baseUrl: 'http://127.0.0.1:8188',
      auth: { type: 'password', password: 'fixture-created-ui-password' },
    })
  })

  it('bootstraps the isolated ComfyUI editor with a saved password and optional bearer fallback', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    const endpoint = {
      ...projectStore.getState().project.comfy.endpoints[0]!,
      auth: {
        type: 'password' as const,
        password: 'fixture-editor-ui-password',
        token: 'fixture-editor-fallback-token',
      },
    }

    render(<ComfyWorkflowEditorDialog endpoint={endpoint} onClose={vi.fn()} onSave={vi.fn()} />)

    await screen.findByTitle('ComfyUI editor Password Test ComfyUI')
    const [authInput, authInit] = fetchMock.mock.calls[0] ?? []
    expect(authInit).toEqual(expect.objectContaining({
      body: JSON.stringify({
        bearerToken: 'fixture-editor-fallback-token',
        password: 'fixture-editor-ui-password',
      }),
      credentials: 'include',
      method: 'POST',
    }))
    const visibleArtifacts = JSON.stringify({
      authUrl: String(authInput),
      dom: document.documentElement.outerHTML,
      localStorage: Object.fromEntries(Object.entries(window.localStorage)),
      sessionStorage: Object.fromEntries(Object.entries(window.sessionStorage)),
    })
    expect(visibleArtifacts).not.toContain('fixture-editor-ui-password')
    expect(visibleArtifacts).not.toContain('fixture-editor-fallback-token')
  })
})
