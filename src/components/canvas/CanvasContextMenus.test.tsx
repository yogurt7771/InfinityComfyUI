import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GenerationFunction, ResourceType } from '../../domain/types'
import { CanvasContextMenus } from './CanvasContextMenus'

afterEach(() => cleanup())

const functionDef: GenerationFunction = {
  id: 'fn_edit',
  name: 'Image Edit',
  category: 'Edit',
  workflow: { format: 'comfyui_api_json', rawJson: {} },
  inputs: [],
  outputs: [],
  createdAt: '2026-06-24T00:00:00.000Z',
  updatedAt: '2026-06-24T00:00:00.000Z',
}

describe('CanvasContextMenus', () => {
  it('shows asset creation actions even when no functions are available', () => {
    const onCreateAsset = vi.fn()

    render(<CanvasContextMenus functions={[]} position={{ x: 10, y: 20 }} onCreateAsset={onCreateAsset} />)

    for (const type of ['text', 'number', 'image', 'video', 'audio'] satisfies ResourceType[]) {
      fireEvent.click(screen.getByRole('menuitem', { name: `Add ${type} asset` }))
      expect(onCreateAsset).toHaveBeenLastCalledWith(type)
    }
  })

  it('keeps function run actions next to asset creation actions', () => {
    const onRunFunction = vi.fn()

    render(
      <CanvasContextMenus
        functions={[functionDef]}
        position={{ x: 10, y: 20 }}
        onCreateAsset={() => undefined}
        onRunFunction={onRunFunction}
      />,
    )

    fireEvent.click(screen.getByRole('menuitem', { name: 'Image Edit' }))

    expect(screen.getByRole('menuitem', { name: 'Add image asset' })).toBeInTheDocument()
    expect(onRunFunction).toHaveBeenCalledWith('fn_edit')
  })
})
