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
  inputs: [{ key: 'image', label: 'Image', type: 'image', required: true, bind: { path: 'inputs.image' } }],
  outputs: [],
  createdAt: '2026-06-24T00:00:00.000Z',
  updatedAt: '2026-06-24T00:00:00.000Z',
}

const textFunctionDef: GenerationFunction = {
  ...functionDef,
  id: 'fn_text',
  name: 'Text Case',
  inputs: [{ key: 'prompt', label: 'Prompt', type: 'text', required: true, bind: { path: 'inputs.prompt' } }],
}

const typedFunctionDef = (type: ResourceType): GenerationFunction => ({
  ...functionDef,
  id: `fn_${type}`,
  name: `${type} function`,
  inputs: [{ key: type, label: type, type, required: true, bind: { path: `inputs.${type}` } }],
})

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

  it('shows only functions compatible with the selected asset types in an asset menu', () => {
    render(
      <CanvasContextMenus
        functions={[functionDef, textFunctionDef]}
        mode="asset"
        resourceTypes={['image']}
        position={{ x: 10, y: 20 }}
      />,
    )

    expect(screen.queryByRole('menuitem', { name: 'Add image asset' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Image Edit' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Text Case' })).not.toBeInTheDocument()
  })

  it('filters asset node function actions for every resource type', () => {
    const functions = (['text', 'number', 'image', 'video', 'audio'] satisfies ResourceType[]).map(typedFunctionDef)

    for (const type of ['text', 'number', 'image', 'video', 'audio'] satisfies ResourceType[]) {
      cleanup()
      render(<CanvasContextMenus functions={functions} mode="asset" resourceTypes={[type]} position={{ x: 10, y: 20 }} />)

      expect(screen.getByRole('menuitem', { name: `${type} function` })).toBeInTheDocument()
      for (const otherType of functions.map((item) => item.inputs[0]!.type).filter((item) => item !== type)) {
        expect(screen.queryByRole('menuitem', { name: `${otherType} function` })).not.toBeInTheDocument()
      }
    }
  })
})
