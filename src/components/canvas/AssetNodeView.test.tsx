import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssetNodeView } from './AssetNodeView'

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
}))

describe('AssetNodeView', () => {
  it('renders generated asset run status, duration, source function, and error details', () => {
    const props = {
      selected: false,
      data: {
        resourceId: 'res_output',
        runStatus: 'failed',
        runDurationLabel: '8m 30s',
        runError: 'Comfy queue failed',
        sourceFunctionName: 'Klein9B Image Edit',
        resource: {
          id: 'res_output',
          type: 'image',
          name: 'Output',
          value: {
            assetId: 'asset_output',
            url: '/output.png',
            filename: 'output.png',
            mimeType: 'image/png',
            sizeBytes: 1,
          },
          source: { kind: 'function_output', runId: 'run_1', outputKey: 'image' },
          metadata: { createdAt: '2026-06-24T00:00:00.000Z' },
        },
      },
    } as unknown as Parameters<typeof AssetNodeView>[0]
    render(<AssetNodeView {...props} />)

    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByText('8m 30s')).toBeInTheDocument()
    expect(screen.getByText('Klein9B Image Edit')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Comfy queue failed')
  })

  it('shows all typed reference previews, opens preview on click, and closes on blur', () => {
    const onPreview = vi.fn()
    const references = [
      {
        id: 'ref_text',
        title: 'Prompt',
        direction: 'incoming' as const,
        inputKey: 'prompt',
        resource: {
          id: 'res_text',
          type: 'text' as const,
          name: 'Prompt',
          value: 'caption',
          source: { kind: 'manual_input' as const },
        },
      },
      {
        id: 'ref_number',
        title: 'Seed',
        direction: 'incoming' as const,
        inputKey: 'seed',
        resource: {
          id: 'res_number',
          type: 'number' as const,
          name: 'Seed',
          value: 12,
          source: { kind: 'manual_input' as const },
        },
      },
      {
        id: 'ref_image',
        title: 'Image',
        direction: 'outgoing' as const,
        inputKey: 'image',
        resource: {
          id: 'res_image',
          type: 'image' as const,
          name: 'Image.png',
          value: { assetId: 'asset_image', url: '/image.png', filename: 'Image.png', mimeType: 'image/png', sizeBytes: 1 },
          source: { kind: 'manual_input' as const },
        },
      },
      {
        id: 'ref_video',
        title: 'Video',
        direction: 'outgoing' as const,
        inputKey: 'video',
        resource: {
          id: 'res_video',
          type: 'video' as const,
          name: 'Video.mp4',
          value: { assetId: 'asset_video', url: '/video.mp4', filename: 'Video.mp4', mimeType: 'video/mp4', sizeBytes: 1 },
          source: { kind: 'manual_input' as const },
        },
      },
      {
        id: 'ref_audio',
        title: 'Audio',
        direction: 'outgoing' as const,
        inputKey: 'audio',
        resource: {
          id: 'res_audio',
          type: 'audio' as const,
          name: 'Audio.wav',
          value: { assetId: 'asset_audio', url: '/audio.wav', filename: 'Audio.wav', mimeType: 'audio/wav', sizeBytes: 1 },
          source: { kind: 'manual_input' as const },
        },
      },
    ]
    const props = {
      selected: false,
      data: {
        resourceId: 'res_output',
        references,
        onPreview,
        resource: {
          id: 'res_output',
          type: 'image',
          name: 'Output',
          value: { assetId: 'asset_output', url: '/output.png', filename: 'output.png', mimeType: 'image/png', sizeBytes: 1 },
          source: { kind: 'function_output' },
        },
      },
    } as unknown as Parameters<typeof AssetNodeView>[0]
    render(<AssetNodeView {...props} />)

    fireEvent.click(screen.getByRole('button', { name: '5 refs' }))

    const listbox = screen.getByRole('listbox', { name: 'Asset references' })
    expect(within(listbox).getByText('caption')).toBeVisible()
    expect(within(listbox).getByText('12')).toBeVisible()
    expect(within(listbox).getByRole('img', { name: 'Image.png' })).toBeVisible()
    expect(within(listbox).getByLabelText('Video.mp4 video')).toBeVisible()
    expect(within(listbox).getByLabelText('Audio.wav audio')).toBeVisible()

    fireEvent.click(within(listbox).getByRole('img', { name: 'Image.png' }).closest('button')!)
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: 'res_image' }))

    fireEvent.blur(screen.getByRole('button', { name: '5 refs' }), { relatedTarget: null })
    expect(screen.queryByRole('listbox', { name: 'Asset references' })).not.toBeInTheDocument()
  })
})
