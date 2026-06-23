import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FunctionInputDef, GenerationFunction, Resource } from '../../domain/types'
import { FunctionCommandModal } from './FunctionCommandModal'
import { autoAssignFunctionInputs } from './SlotMapping'

const now = '2026-06-23T00:00:00.000Z'

afterEach(() => cleanup())

const resource = (id: string, type: Resource['type'], value: Resource['value'], name = id): Resource => ({
  id,
  type,
  name,
  value,
  source: { kind: 'manual_input' },
  metadata: { createdAt: now },
})

const input = (key: string, type: FunctionInputDef['type'], required = true, defaultValue?: string | number | null): FunctionInputDef => ({
  key,
  label: key,
  type,
  required,
  defaultValue,
  bind: { path: key },
})

const functionDef = (): GenerationFunction => ({
  id: 'fn_edit',
  name: 'Image Edit',
  workflow: {
    format: 'comfyui_api_json',
    rawJson: {},
  },
  inputs: [input('prompt', 'text'), input('image', 'image'), input('strength', 'number', false, 0.5)],
  outputs: [
    {
      key: 'image',
      label: 'Image',
      type: 'image',
      bind: { path: 'image' },
      extract: { source: 'history' },
    },
  ],
  createdAt: now,
  updatedAt: now,
})

describe('FunctionCommandModal', () => {
  it('auto assigns selected resources to compatible slots without reusing assets', () => {
    expect(
      autoAssignFunctionInputs(
        [input('first_image', 'image'), input('second_image', 'image'), input('prompt', 'text')],
        [
          resource('res_image_1', 'image', {
            assetId: 'asset_1',
            url: '/image-1.png',
            filename: 'image-1.png',
            mimeType: 'image/png',
            sizeBytes: 1,
          }),
          resource('res_text', 'text', 'hello'),
          resource('res_image_2', 'image', {
            assetId: 'asset_2',
            url: '/image-2.png',
            filename: 'image-2.png',
            mimeType: 'image/png',
            sizeBytes: 1,
          }),
        ],
      ),
    ).toEqual({
      first_image: { resourceId: 'res_image_1', type: 'image' },
      second_image: { resourceId: 'res_image_2', type: 'image' },
      prompt: { resourceId: 'res_text', type: 'text' },
    })
  })

  it('submits mapped assets and inline primitive parameters through one run action', () => {
    const onRun = vi.fn()
    render(
      <FunctionCommandModal
        functionDef={functionDef()}
        candidateResources={[
          resource('res_image', 'image', {
            assetId: 'asset_image',
            url: '/image.png',
            filename: 'image.png',
            mimeType: 'image/png',
            sizeBytes: 1,
          }),
        ]}
        onClose={() => undefined}
        onRun={onRun}
      />,
    )

    fireEvent.change(screen.getByLabelText('prompt input'), { target: { value: 'make it brighter' } })
    fireEvent.change(screen.getByLabelText('strength input'), { target: { value: '0.75' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run function' }))

    expect(onRun).toHaveBeenCalledWith({
      functionId: 'fn_edit',
      functionName: 'Image Edit',
      inputValues: {
        prompt: 'make it brighter',
        image: { resourceId: 'res_image', type: 'image' },
        strength: 0.75,
      },
      outputKeys: ['image'],
    })
  })

  it('exposes pick mode actions and output previews in the modal shell', () => {
    const onPickSlot = vi.fn()
    render(
      <FunctionCommandModal
        functionDef={functionDef()}
        candidateResources={[]}
        onClose={() => undefined}
        onPickSlot={onPickSlot}
        onRun={() => undefined}
      />,
    )

    const imageSlot = screen.getByTestId('slot-row-image')
    fireEvent.click(within(imageSlot).getByRole('button', { name: 'Pick image from canvas' }))

    expect(onPickSlot).toHaveBeenCalledWith('image')
    expect(screen.getByText('Expected outputs')).toBeInTheDocument()
    expect(screen.getByTestId('expected-output-image')).toHaveTextContent('image')
  })

  it('assigns a picked canvas resource to the requested slot', () => {
    const onRun = vi.fn()
    const picked = resource('res_picked_image', 'image', {
      assetId: 'asset_picked',
      url: '/picked.png',
      filename: 'picked.png',
      mimeType: 'image/png',
      sizeBytes: 1,
    })

    render(
      <FunctionCommandModal
        functionDef={functionDef()}
        candidateResources={[]}
        pickedResource={{ pickId: 'pick_1', inputKey: 'image', resource: picked }}
        onClose={() => undefined}
        onRun={onRun}
      />,
    )

    fireEvent.change(screen.getByLabelText('prompt input'), { target: { value: 'use picked image' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run function' }))

    expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({
        inputValues: expect.objectContaining({
          image: { resourceId: 'res_picked_image', type: 'image' },
          prompt: 'use picked image',
        }),
      }),
    )
  })
})
