import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LeftPanel } from './WorkbenchPanels'
import { projectStore } from '../store/projectStore'

const endpointPasswordLabel = /^comfyui password$/i
const endpointTokenLabel = /^comfyui api token$/i

describe('ComfyUI server page-password and API-token configuration', () => {
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
  })

  it('preserves a saved page password while editing its fallback API token', () => {
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
    const tokenInput = within(dialog).getByLabelText(endpointTokenLabel)
    expect(passwordInput).toBeVisible()
    expect(passwordInput).toHaveAttribute('type', 'password')
    expect(passwordInput).toHaveValue('fixture-existing-password')
    expect(tokenInput).toBeVisible()
    expect(tokenInput).toHaveAttribute('type', 'password')
    expect(tokenInput).toHaveValue('fixture-existing-token')

    fireEvent.change(tokenInput, { target: { value: 'fixture-edited-token' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(projectStore.getState().project.comfy.endpoints[0]?.auth).toEqual({
      type: 'password',
      password: 'fixture-existing-password',
      token: 'fixture-edited-token',
    })
  })

  it('keeps token authentication while exposing an optional blank page-password control', () => {
    render(<LeftPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'ComfyUI Servers' }))
    const popover = screen.getByLabelText('ComfyUI Servers popover')
    const serverList = within(popover).getByLabelText('ComfyUI server list')
    fireEvent.click(within(serverList).getByRole('button', { name: /edit (server|endpoint) password test comfyui/i }))

    const dialog = screen.getByRole('dialog', { name: /edit comfyui server/i })
    const passwordInput = within(dialog).getByLabelText(endpointPasswordLabel)
    const tokenInput = within(dialog).getByLabelText(endpointTokenLabel)
    expect(passwordInput).toBeVisible()
    expect(passwordInput).toHaveAttribute('type', 'password')
    expect(passwordInput).toHaveValue('')
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

  it('creates a new ComfyUI server with a page password and fallback API token', () => {
    render(<LeftPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'ComfyUI Servers' }))
    const popover = screen.getByLabelText('ComfyUI Servers popover')
    fireEvent.click(within(popover).getByRole('button', { name: /new|新建/i }))
    const dialog = screen.getByRole('dialog', { name: /new comfyui server|create comfyui server/i })

    const passwordInput = within(dialog).getByLabelText(endpointPasswordLabel)
    const tokenInput = within(dialog).getByLabelText(endpointTokenLabel)
    expect(passwordInput).toBeVisible()
    expect(passwordInput).toHaveAttribute('type', 'password')
    expect(passwordInput).toHaveValue('')
    expect(tokenInput).toBeVisible()
    expect(tokenInput).toHaveAttribute('type', 'password')
    expect(tokenInput).toHaveValue('')
    fireEvent.change(within(dialog).getByLabelText(/(server|endpoint) name/i), {
      target: { value: 'Created Token ComfyUI' },
    })
    fireEvent.change(within(dialog).getByLabelText(/url/i), {
      target: { value: 'http://127.0.0.1:8188' },
    })
    fireEvent.change(passwordInput, { target: { value: 'fixture-created-page-password' } })
    fireEvent.change(tokenInput, { target: { value: 'fixture-created-api-token' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add server' }))

    expect(projectStore.getState().project.comfy.endpoints.at(-1)).toMatchObject({
      name: 'Created Token ComfyUI',
      baseUrl: 'http://127.0.0.1:8188',
      auth: {
        type: 'password',
        password: 'fixture-created-page-password',
        token: 'fixture-created-api-token',
      },
    })
  })

})
