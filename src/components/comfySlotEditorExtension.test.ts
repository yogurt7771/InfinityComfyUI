import { describe, expect, it, vi } from 'vitest'
import { editorSlotState, type EditorSlotState } from '../domain/comfySlotEditor'
import {
  editorNodesFromGraph,
  installComfySlotEditor,
  type ComfySlotEditorApp,
  type ComfySlotEditorController,
} from './comfySlotEditorExtension'

type FakeNode = Record<string, unknown> & { id: number }

const nodeClass = (outputNode?: boolean) => ({ nodeData: outputNode === undefined ? undefined : { output_node: outputNode } })

const makeNode = (id: number, type: string, options: { outputNode?: boolean; inputs?: unknown[]; widgets?: unknown[] } = {}): FakeNode => {
  const node: FakeNode = {
    id,
    type,
    comfyClass: type,
    title: type,
    pos: [100 * id, 200],
    size: [200, 120],
    inputs: options.inputs ?? [],
    widgets: options.widgets ?? [],
  }
  Object.defineProperty(node, 'constructor', { value: nodeClass(options.outputNode) })
  return node
}

const graphNodes = () => [
  makeNode(3, 'KSampler', {
    outputNode: false,
    inputs: [{ name: 'model', type: 'MODEL', link: 1 }],
    widgets: [
      { name: 'seed', value: 42, y: 40 },
      { name: 'control_after_generate', value: 'randomize' },
      { name: 'steps', value: 20, y: 64 },
    ],
  }),
  makeNode(10, 'LoadImage', { outputNode: false, widgets: [{ name: 'image', value: 'reference.png', y: 30 }, { name: 'upload', value: undefined }] }),
  makeNode(9, 'SaveImage', { outputNode: true, inputs: [{ name: 'images', type: 'IMAGE', link: 4 }], widgets: [{ name: 'filename_prefix', value: 'ComfyUI' }] }),
  makeNode(13, 'SaveLatent', { outputNode: true, inputs: [{ name: 'samples', type: 'LATENT', link: 5 }], widgets: [] }),
]

type MenuItem = { content: string; disabled?: boolean; submenu?: { options: MenuItem[] }; callback?: () => void } | null

function setup(options: { modern: boolean; state?: EditorSlotState }) {
  const nodes = graphNodes()
  const graph = { _nodes: nodes }
  for (const node of nodes) node.graph = graph
  class FakeCanvas {
    graph = graph
    setDirty = vi.fn()
    onDrawForeground?: (ctx: CanvasRenderingContext2D, area: unknown) => void
    getNodeMenuOptions(...args: unknown[]): MenuItem[] {
      void args
      return [{ content: 'Title' }]
    }
  }
  const canvas = new FakeCanvas()
  const extensions: Array<{ name: string; getNodeMenuItems?: (node: unknown) => MenuItem[] }> = []
  const app: ComfySlotEditorApp & { canvas: FakeCanvas } = {
    graph,
    canvas,
    ...(options.modern
      ? { registerExtension: (extension: (typeof extensions)[number]) => void extensions.push(extension), collectNodeMenuItems: () => [] }
      : {}),
  } as unknown as ComfySlotEditorApp & { canvas: FakeCanvas }
  let state = options.state ?? editorSlotState()
  const controller: ComfySlotEditorController = { getState: () => state, setState: (next) => void (state = next) }
  const win = { prompt: vi.fn(() => 'Hero shot') } as unknown as Window
  installComfySlotEditor(win, app, controller)
  const menuFor = (id: number): MenuItem[] => {
    const node = nodes.find((item) => item.id === id)!
    return options.modern ? extensions.flatMap((extension) => extension.getNodeMenuItems?.(node) ?? []) : canvas.getNodeMenuOptions.call(canvas, node as never)
  }
  return { app, canvas, extensions, menuFor, getState: () => state, win, controller }
}

const contents = (items: MenuItem[]) => items.filter(Boolean).map((item) => item!.content)

describe('comfySlotEditorExtension', () => {
  it('reads the live graph: connected input types, settable widgets, output-node flag', () => {
    const { app } = setup({ modern: true })
    const nodes = editorNodesFromGraph(app)
    expect(nodes.find((node) => node.nodeId === '9')).toMatchObject({ classType: 'SaveImage', outputNode: true, linkedInputTypes: ['IMAGE'] })
    expect(nodes.find((node) => node.nodeId === '3')?.fields.map((field) => field.name)).toEqual(['seed', 'control_after_generate', 'steps'])
  })

  it('uses the extension menu hook on current frontends and patches getNodeMenuOptions only on old ones', () => {
    const modern = setup({ modern: true })
    expect(modern.extensions.map((extension) => extension.name)).toEqual(['infinity.slotEditor'])
    expect(contents(modern.canvas.getNodeMenuOptions.call(modern.canvas))).toEqual(['Title'])

    const legacy = setup({ modern: false })
    expect(legacy.extensions).toEqual([])
    expect(contents(legacy.menuFor(9))).toEqual(['Title', '✓ Output slot: Image · image (default)', 'Input slots', 'Rename slot'])
  })

  it('offers output slots only on output nodes that return something Infinity can show', () => {
    const { menuFor } = setup({ modern: true, state: editorSlotState({ inputs: [], outputs: [], workflow: { rawJson: { '3': {}, '9': {}, '10': {}, '13': {} } } }) })
    expect(menuFor(9).find((item) => item?.content.startsWith('Use as output'))).toMatchObject({ content: 'Use as output slot (image)' })
    expect(menuFor(3).find((item) => item?.content.startsWith('Output slot'))).toMatchObject({
      content: 'Output slot unavailable: not an output node in ComfyUI',
      disabled: true,
    })
    expect(menuFor(13).find((item) => item?.content.startsWith('Output slot'))).toMatchObject({ disabled: true })
  })

  it('toggles field-level input slots and output slots, and renames through a prompt', async () => {
    const existing = { inputs: [], outputs: [], workflow: { rawJson: { '3': {}, '9': {}, '10': {}, '13': {} } } }
    const { menuFor, getState, win } = setup({ modern: true, state: editorSlotState(existing) })
    const inputs = menuFor(3).find((item) => item?.content === 'Input slots')!
    expect(contents(inputs.submenu!.options)).toEqual(['seed (number)', 'steps (number)'])
    inputs.submenu!.options[0]!.callback!()
    expect(getState().inputs.map((input) => [input.key, input.bind.nodeId, input.bind.path])).toEqual([['seed', '3', 'inputs.seed']])
    expect(contents(menuFor(3).find((item) => item?.content === 'Input slots')!.submenu!.options)[0]).toBe('✓ seed → Seed')

    menuFor(9).find((item) => item?.content.startsWith('Use as output'))!.callback!()
    expect(getState().outputs.map((output) => [output.key, output.bind.nodeId])).toEqual([['image', '9']])

    const rename = menuFor(9).find((item) => item?.content === 'Rename slot')!
    rename.submenu!.options[0]!.callback!()
    await vi.waitFor(() => expect(getState().outputs[0]?.label).toBe('Hero shot'))
    expect(win.prompt).toHaveBeenCalledWith('Slot name shown in Infinity', 'Image')

    menuFor(9).find((item) => item?.content.startsWith('✓ Output slot'))!.callback!()
    expect(getState().outputs).toEqual([])
    expect(getState().removedOutputNodeIds).toEqual(['9'])
  })

  it('draws IN / OUT tags over slot nodes and a bar beside each bound widget', () => {
    const state: EditorSlotState = {
      ...editorSlotState({ inputs: [], outputs: [], workflow: { rawJson: { '3': {}, '9': {}, '10': {}, '13': {} } } }),
      inputs: [
        {
          key: 'seed',
          label: 'Seed',
          type: 'number',
          required: false,
          bind: { nodeId: '3', nodeTitle: 'KSampler', path: 'inputs.seed' },
          upload: { strategy: 'none' },
        },
      ],
      outputs: [
        { key: 'image', label: 'Final', type: 'image', bind: { nodeId: '9', nodeTitle: 'SaveImage' }, extract: { source: 'history', multiple: true } },
      ],
    }
    const { canvas } = setup({ modern: true, state })
    const texts: string[] = []
    const rects: number[][] = []
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      arcTo: (x: number, y: number) => rects.push([x, y]),
      closePath: vi.fn(),
      fill: vi.fn(),
      measureText: (text: string) => ({ width: text.length * 6 }),
      fillText: (text: string) => texts.push(text),
    } as unknown as CanvasRenderingContext2D
    canvas.onDrawForeground?.(ctx, [0, 0, 1000, 1000])
    expect(texts).toEqual(['IN: Seed ← seed', 'OUT: Final · image'])
    // The seed widget row (y 40) of node 3 at (300, 200) gets a bar at its left edge.
    expect(rects.some(([x, y]) => x === 300 - 7 + 5 && y === 200 + 40 + 2)).toBe(true)
  })

  it('swaps the controller for a new editing session without installing twice', () => {
    const first = setup({ modern: true })
    const secondState = editorSlotState()
    installComfySlotEditor(first.win, first.app, { getState: () => secondState, setState: vi.fn() })
    expect(first.extensions).toHaveLength(1)
  })
})
