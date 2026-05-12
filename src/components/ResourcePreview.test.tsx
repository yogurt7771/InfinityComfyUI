import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ResourcePreview } from './ResourcePreview'
import type { Resource } from '../domain/types'

const mediaResource = (type: 'image' | 'video' | 'audio', url: string): Resource => ({
  id: `res_${type}`,
  type,
  name: `${type}.png`,
  value: {
    assetId: `asset_${type}`,
    url,
    filename: `${type}.png`,
    mimeType: type === 'image' ? 'image/png' : `${type}/mp4`,
    sizeBytes: 100,
  },
  source: { kind: 'function_output' },
})

describe('ResourcePreview', () => {
  it('renders image resources directly on the canvas', () => {
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
})
