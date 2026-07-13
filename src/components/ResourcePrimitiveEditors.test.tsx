import { ReactFlowProvider } from '@xyflow/react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Resource } from '../domain/types'
import { ResourceNodeView } from './NodeViews'

type TextDisplayMode =
  | 'plaintext'
  | 'markdown'
  | 'html'
  | 'json'
  | 'yaml'
  | 'render markdown'
  | 'render html'

type DisplayableTextResource = Resource & { displayMode?: TextDisplayMode }

const baseNodeData = {
  resourcesById: {},
  functionsById: {},
  onRunFunction: vi.fn(),
  onRerunResultNode: vi.fn(),
  onCancelResultRun: vi.fn(),
  onUpdateFunctionRunCount: vi.fn(),
  onUpdateOpenAiConfig: vi.fn(),
  onUpdateGeminiConfig: vi.fn(),
  onUpdateOpenAiImageConfig: vi.fn(),
  onUpdateGeminiImageConfig: vi.fn(),
  onUpdateRequestConfig: vi.fn(),
  onUpdateRequestOutputs: vi.fn(),
  onDeleteNode: vi.fn(),
  onRenameNode: vi.fn(),
  onUpdateFunctionInputValue: vi.fn(),
  onUpdateTextResourceValue: vi.fn(),
  onUpdateTextResourceDisplayMode: vi.fn(),
  onUpdateNumberResourceValue: vi.fn(),
  onUpdateBooleanResourceValue: vi.fn(),
  onReplaceResourceMedia: vi.fn(),
}

const textResource = (value: string, displayMode?: TextDisplayMode): DisplayableTextResource => ({
  id: 'res_text',
  type: 'text',
  name: 'Prompt',
  value,
  source: { kind: 'manual_input' },
  ...(displayMode ? { displayMode } : {}),
})

const renderTextNode = (resource: DisplayableTextResource, overrides: Record<string, unknown> = {}) => {
  const props = {
    id: 'node_text',
    selected: false,
    data: {
      ...baseNodeData,
      ...overrides,
      resourcesById: { [resource.id]: resource },
      resourceId: resource.id,
      title: resource.name,
    },
  } as unknown as ComponentProps<typeof ResourceNodeView>

  return render(
    <ReactFlowProvider>
      <ResourceNodeView {...props} />
    </ReactFlowProvider>,
  )
}

describe('primitive resource editors', () => {
  afterEach(() => cleanup())

  it('defaults legacy text resources to plaintext and offers exactly the seven display modes', () => {
    renderTextNode(textResource('legacy text'))

    const displayMode = screen.getByRole('combobox', { name: 'Prompt display mode' })
    expect(displayMode).toHaveValue('plaintext')
    expect(within(displayMode).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'plaintext',
      'markdown',
      'html',
      'json',
      'yaml',
      'render markdown',
      'render html',
    ])
  })

  it.each([
    ['plaintext', 'plain text'],
    ['markdown', '# Heading\n\n**bold**'],
    ['html', '<section><strong>bold</strong></section>'],
    ['json', '{ invalid json'],
    ['yaml', 'name: [invalid yaml'],
  ] satisfies Array<[TextDisplayMode, string]>)('keeps %s source highlighted and editable without requiring valid syntax', (mode, value) => {
    const onUpdateTextResourceValue = vi.fn()
    renderTextNode(textResource(value, mode), { onUpdateTextResourceValue })

    const source = screen.getByRole('textbox', { name: 'Prompt source' })
    expect(source).toHaveValue(value)
    expect(screen.getByLabelText(`Prompt ${mode} syntax highlight`).textContent).toBe(value)

    fireEvent.change(source, { target: { value: `${value}\nedited` } })
    fireEvent.blur(source)

    expect(onUpdateTextResourceValue).toHaveBeenCalledWith('res_text', `${value}\nedited`)
  })

  it('switches display modes through an accessible control that remains available from rendered markdown', () => {
    const onUpdateTextResourceDisplayMode = vi.fn()
    renderTextNode(textResource('# Safe heading', 'render markdown'), { onUpdateTextResourceDisplayMode })

    const displayMode = screen.getByRole('combobox', { name: 'Prompt display mode' })
    expect(displayMode).toHaveValue('render markdown')
    expect(screen.getByRole('region', { name: 'Prompt rendered markdown' })).toBeVisible()

    fireEvent.change(displayMode, { target: { value: 'plaintext' } })
    expect(onUpdateTextResourceDisplayMode).toHaveBeenCalledWith('res_text', 'plaintext')
  })

  it.each([
    ['render markdown', '# Safe heading\n\n<a href="javascript:alert(1)" onclick="alert(1)">bad</a><script>alert(1)</script>'],
    ['render html', '<h1>Safe heading</h1><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">bad</a><script>alert(1)</script>'],
  ] satisfies Array<[TextDisplayMode, string]>)('renders and sanitizes %s content', (mode, value) => {
    const { container } = renderTextNode(textResource(value, mode))
    const rendered = screen.getByRole('region', { name: `Prompt rendered ${mode.replace('render ', '')}` })

    expect(within(rendered).getByRole('heading', { name: 'Safe heading' })).toBeVisible()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('[onclick], [onerror]')).toBeNull()
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
  })

  it.each([
    [
      'render markdown',
      '# Safe heading\n\n<section class="remote" id="remote" tabindex="0" draggable="true"><p>Safe paragraph</p><img src="http://127.0.0.1:65535/image.png"><video src="https://example.invalid/video.mp4" poster="http://localhost/poster.jpg"><source src="http://localhost/video.webm"><track src="http://localhost/captions.vtt"></video><audio src="http://localhost/audio.mp3"><source src="https://example.invalid/audio.ogg"></audio><picture><source srcset="http://localhost/picture.webp"><img src="https://example.invalid/picture.png"></picture><table background="http://localhost/background.png"><tbody><tr><td>Safe table cell</td></tr></tbody></table></section>',
    ],
    [
      'render html',
      '<h1>Safe heading</h1><section class="remote" id="remote" tabindex="0" draggable="true"><p>Safe paragraph</p><img src="http://127.0.0.1:65535/image.png"><video src="https://example.invalid/video.mp4" poster="http://localhost/poster.jpg"><source src="http://localhost/video.webm"><track src="http://localhost/captions.vtt"></video><audio src="http://localhost/audio.mp3"><source src="https://example.invalid/audio.ogg"></audio><picture><source srcset="http://localhost/picture.webp"><img src="https://example.invalid/picture.png"></picture><table background="http://localhost/background.png"><tbody><tr><td>Safe table cell</td></tr></tbody></table></section>',
    ],
  ] satisfies Array<[TextDisplayMode, string]>)('removes remote-loading media and interactive attributes from %s while preserving safe structure', (mode, value) => {
    renderTextNode(textResource(value, mode))
    const rendered = screen.getByRole('region', { name: `Prompt rendered ${mode.replace('render ', '')}` })

    expect(within(rendered).getByRole('heading', { name: 'Safe heading' })).toBeVisible()
    expect(within(rendered).getByText('Safe paragraph')).toBeVisible()
    expect(within(rendered).getByText('Safe table cell')).toBeVisible()
    expect(
      rendered.querySelectorAll(
        'img[src], video[src], video[poster], audio[src], picture, source, track, table[background]',
      ),
    ).toHaveLength(0)
    expect(rendered.querySelector('[class], [id], [tabindex], [draggable]')).toBeNull()
  })

  it('edits boolean resources through an accessible checkbox while keeping copy and download actions', () => {
    const onUpdateBooleanResourceValue = vi.fn()
    const resource: Resource = {
      id: 'res_boolean',
      type: 'boolean',
      name: 'Enabled',
      value: false,
      source: { kind: 'manual_input' },
    }
    const props = {
      id: 'node_boolean',
      selected: false,
      data: {
        ...baseNodeData,
        onUpdateBooleanResourceValue,
        resourcesById: { [resource.id]: resource },
        resourceId: resource.id,
        title: resource.name,
      },
    } as unknown as ComponentProps<typeof ResourceNodeView>

    const { container } = render(
      <ReactFlowProvider>
        <ResourceNodeView {...props} />
      </ReactFlowProvider>,
    )

    const checkbox = within(container).getByRole('checkbox', { name: 'Enabled value' })
    expect(checkbox).not.toBeChecked()
    expect(within(container).getByRole('button', { name: 'Copy asset' })).toBeVisible()
    expect(within(container).getByRole('button', { name: 'Download asset' })).toBeVisible()

    fireEvent.click(checkbox)
    expect(onUpdateBooleanResourceValue).toHaveBeenCalledWith('res_boolean', true)
  })
})
