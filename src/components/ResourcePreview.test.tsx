import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResourcePreview } from './ResourcePreview'
import { FullResourcePreviewModal } from './ResourcePreviewModal'
import type { Resource } from '../domain/types'
import { projectStore } from '../store/projectStore'
import { comfyProxyUrl } from '../domain/comfyProxy'

const mediaResource = (type: 'image' | 'video' | 'audio', url: string, endpointId?: string): Resource => ({
  id: `res_${type}`,
  type,
  name: `${type}.png`,
  value: {
    assetId: `asset_${type}`,
    url,
    filename: `${type}.png`,
    mimeType: type === 'image' ? 'image/png' : `${type}/mp4`,
    sizeBytes: 100,
    comfy: endpointId
      ? {
          endpointId,
          filename: `${type}.png`,
          subfolder: 'renders',
          type: 'output',
        }
      : undefined,
  },
  source: { kind: 'function_output' },
  metadata: endpointId ? { endpointId, createdAt: '2026-05-12T00:00:00.000Z' } : undefined,
})

describe('ResourcePreview', () => {
  const originalCreateObjectUrl = URL.createObjectURL
  const originalRevokeObjectUrl = URL.revokeObjectURL
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:preview') as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL
  })

  afterEach(() => {
    cleanup()
    URL.createObjectURL = originalCreateObjectUrl
    URL.revokeObjectURL = originalRevokeObjectUrl
    globalThis.fetch = originalFetch
    projectStore.setState(projectStore.getInitialState(), true)
  })

  it('renders image resources through the ComfyUI server proxy when endpoint headers are configured', async () => {
    const resource = mediaResource('image', 'http://127.0.0.1:27707/view?filename=image.png&subfolder=renders&type=output', 'endpoint_secure')
    projectStore.setState((state) => ({
      ...state,
      project: {
        ...state.project,
        resources: { [resource.id]: resource },
        comfy: {
          ...state.project.comfy,
          endpoints: [
            {
              id: 'endpoint_secure',
              name: 'Secure ComfyUI',
              baseUrl: 'http://127.0.0.1:27707',
              enabled: true,
              maxConcurrentJobs: 1,
              priority: 1,
              timeoutMs: 10000,
              customHeaders: { 'X-Workspace': 'infinity' },
            },
          ],
        },
      },
    }))
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(['image'], { type: 'image/png' }), { status: 200 }))
    globalThis.fetch = fetchMock as typeof fetch

    render(<ResourcePreview resource={resource} />)

    const proxyBaseUrl = new URL(comfyProxyUrl('http://127.0.0.1:27707'), window.location.origin).toString()
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`${proxyBaseUrl}view?filename=image.png&subfolder=renders&type=output`, {
        method: 'GET',
        headers: { 'X-Workspace': 'infinity' },
      }),
    )
    await waitFor(() => expect(screen.getByRole('img', { name: 'image.png' })).toHaveAttribute('src', 'blob:preview'))
  })

  it('renders local image resources directly on the canvas', () => {
    render(<ResourcePreview resource={mediaResource('image', 'http://127.0.0.1:27707/view?filename=a.png')} />)

    expect(screen.getByRole('img', { name: 'image.png' })).toHaveAttribute(
      'src',
      'http://127.0.0.1:27707/view?filename=a.png',
    )
  })

  it('renders text, video, and audio resources inline', () => {
    render(
      <>
        <ResourcePreview
          resource={{
            id: 'res_text',
            type: 'text',
            name: 'Text',
            value: 'Generated caption',
            source: { kind: 'function_output' },
          }}
        />
        <ResourcePreview resource={mediaResource('video', 'http://127.0.0.1:27707/view?filename=v.mp4')} />
        <ResourcePreview resource={mediaResource('audio', 'http://127.0.0.1:27707/view?filename=a.wav')} />
      </>,
    )

    expect(screen.getByText('Generated caption')).toBeVisible()
    expect(screen.getByLabelText('video.png video')).toHaveAttribute(
      'src',
      'http://127.0.0.1:27707/view?filename=v.mp4',
    )
    expect(screen.getByLabelText('audio.png audio')).toHaveAttribute(
      'src',
      'http://127.0.0.1:27707/view?filename=a.wav',
    )
  })

  it('closes the full preview from the backdrop click and Escape without leaking press or context events', () => {
    const onClose = vi.fn()
    const windowPointerDown = vi.fn()
    const windowMouseDown = vi.fn()
    const windowContextMenu = vi.fn()
    window.addEventListener('pointerdown', windowPointerDown)
    window.addEventListener('mousedown', windowMouseDown)
    window.addEventListener('contextmenu', windowContextMenu)

    try {
      render(
        <FullResourcePreviewModal
          resource={mediaResource('image', 'http://127.0.0.1:27707/view?filename=preview.png')}
          onClose={onClose}
        />,
      )

      const backdrop = document.querySelector('.full-preview-backdrop') as HTMLElement
      expect(screen.getByRole('dialog', { name: 'Preview image.png' })).toBeVisible()

      fireEvent.contextMenu(backdrop, { clientX: 100, clientY: 120 })
      expect(windowContextMenu).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()

      fireEvent.pointerDown(backdrop, { clientX: 100, clientY: 120 })
      expect(windowPointerDown).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()

      fireEvent.mouseDown(backdrop, { clientX: 100, clientY: 120 })
      expect(windowMouseDown).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()

      fireEvent.click(backdrop, { clientX: 100, clientY: 120 })
      expect(onClose).toHaveBeenCalledTimes(1)

      onClose.mockClear()
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('pointerdown', windowPointerDown)
      window.removeEventListener('mousedown', windowMouseDown)
      window.removeEventListener('contextmenu', windowContextMenu)
    }
  })
})
