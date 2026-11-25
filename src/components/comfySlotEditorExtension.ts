import {
  editorNodeInputs,
  editorNodeOutputs,
  editorNodeOutputType,
  effectiveEditorSlots,
  outputSlotId,
  renameEditorSlot,
  toggleEditorInput,
  toggleEditorOutputSlot,
  type EditorNode,
  type EditorSlotState,
} from '../domain/comfySlotEditor'
import { comfyNodeTypesFromObjectInfo } from '../domain/comfyNodeTypes'

/**
 * Lets the embedded ComfyUI editor (iframe or separate window) set a function's input / output slots: a node's
 * right-click menu toggles and renames slots, and slot nodes carry IN / OUT tags while editing. The slot state itself
 * stays with the dialog that opened the editor (one source of truth); this only reads and updates it.
 */
export type ComfySlotEditorController = {
  getState: () => EditorSlotState
  setState: (next: EditorSlotState) => void
}

type LiteWidget = {
  name?: string
  value?: unknown
  type?: string
  serialize?: boolean
  options?: { serialize?: boolean }
  y?: number
  last_y?: number
  computedHeight?: number
}
type LiteInput = { name?: string; type?: unknown; link?: number | null; widget?: { name?: string } }
type LiteNode = {
  id: number | string
  title?: string
  type?: string
  comfyClass?: string
  pos: ArrayLike<number>
  size: ArrayLike<number>
  graph?: unknown
  inputs?: LiteInput[]
  outputs?: Array<{ name?: string; type?: unknown }>
  widgets?: LiteWidget[]
  isInputConnected?: (slot: number) => boolean
  constructor: { nodeData?: { output_node?: boolean; input?: unknown }; comfyClass?: string }
}
type LiteGraphLike = { _nodes?: LiteNode[]; getNodeById?: (id: number | string) => LiteNode | null | undefined }
type MenuItem = {
  content: string
  disabled?: boolean
  has_submenu?: boolean
  submenu?: { options: Array<MenuItem | null> }
  callback?: (...args: unknown[]) => void
}
type LiteCanvasLike = {
  graph?: unknown
  ds?: { scale?: number }
  onDrawForeground?: (ctx: CanvasRenderingContext2D, area: unknown) => void
  setDirty?: (foreground: boolean, background?: boolean) => void
  getNodeMenuOptions?: (node: LiteNode, ...rest: unknown[]) => Array<MenuItem | null>
}
export type ComfySlotEditorApp = {
  graph?: LiteGraphLike
  rootGraph?: LiteGraphLike
  canvas?: LiteCanvasLike
  registerExtension?: (extension: { name: string; getNodeMenuItems?: (node: LiteNode) => Array<MenuItem | null> }) => void
  collectNodeMenuItems?: (node: LiteNode) => unknown
  extensionManager?: { dialog?: { prompt?: (options: { title: string; message: string; defaultValue?: string }) => Promise<string | null | undefined> } }
}
type SlotEditorWindow = Window & {
  __infinitySlotEditor?: ComfySlotEditorController
  prompt: (message?: string, defaultValue?: string) => string | null
}

const INSTALLED = Symbol.for('infinity.comfySlotEditor.installed')
const EXTENSION_NAME = 'infinity.slotEditor'

const rootGraphOf = (app: ComfySlotEditorApp) => app.rootGraph ?? app.graph
const graphNodes = (graph: LiteGraphLike | undefined) => graph?._nodes ?? []

const isConnected = (node: LiteNode, index: number, input: LiteInput) =>
  typeof node.isInputConnected === 'function' ? node.isInputConnected(index) : input.link !== null && input.link !== undefined

/** The live graph as the slot settings see it (top-level nodes only: their ids are the API prompt's node ids). */
export function editorNodesFromGraph(app: ComfySlotEditorApp): EditorNode[] {
  return graphNodes(rootGraphOf(app)).map((node) => {
    const inputs = node.inputs ?? []
    const linkedWidgetNames = new Set(
      inputs.flatMap((input, index) => (input.widget?.name && isConnected(node, index, input) ? [input.widget.name] : [])),
    )
    const outputNode = node.constructor?.nodeData?.output_node
    const classType = node.comfyClass ?? node.constructor?.comfyClass ?? node.type ?? ''
    // The node definition's input types (INT, COMBO, IMAGE…) type each field and socket without guessing.
    const definition = comfyNodeTypesFromObjectInfo({ [classType]: node.constructor?.nodeData ?? {} })[classType]
    const inputTypes = Object.fromEntries(
      Object.entries(definition?.inputTypes ?? {}).map(([name, types]) => [name, types[0] ?? '']),
    )
    return {
      nodeId: String(node.id),
      title: node.title ?? node.type ?? String(node.id),
      classType,
      outputNode: typeof outputNode === 'boolean' ? outputNode : undefined,
      linkedInputTypes: inputs.flatMap((input, index) =>
        isConnected(node, index, input) && !input.widget ? [String(input.type ?? '')] : [],
      ),
      // Sockets: plain inputs, plus widgets turned into a connected input (their value comes from the link).
      inputSockets: inputs.flatMap((input, index) => {
        const linked = isConnected(node, index, input)
        if (!input.name || (input.widget && !linked)) return []
        return [{ name: input.name, type: String(input.type ?? ''), linked }]
      }),
      outputSockets: (node.outputs ?? []).map((output, index) => ({
        index,
        name: output.name ?? String(output.type ?? index),
        type: String(output.type ?? ''),
      })),
      inputTypes,
      fields: (node.widgets ?? [])
        .filter(
          (widget) =>
            widget.name &&
            widget.serialize !== false &&
            widget.options?.serialize !== false &&
            !linkedWidgetNames.has(widget.name),
        )
        .map((widget) => ({ name: widget.name!, value: widget.value })),
    }
  })
}

const outputReason = {
  not_output_node: 'not an output node in ComfyUI',
  no_supported_output: 'its output is not an image, video, audio or text',
} as const

async function askLabel(win: SlotEditorWindow, app: ComfySlotEditorApp, current: string): Promise<string | undefined> {
  const prompt = app.extensionManager?.dialog?.prompt
  const answer = prompt
    ? await prompt({ title: 'Rename slot', message: 'Slot name shown in Infinity', defaultValue: current })
    : win.prompt('Slot name shown in Infinity', current)
  return typeof answer === 'string' ? answer : undefined
}

/** Menu entries for one node (shared by the new extension hook and the legacy menu patch). */
export function slotMenuItems(win: SlotEditorWindow, app: ComfySlotEditorApp, node: LiteNode): Array<MenuItem | null> {
  const controller = win.__infinitySlotEditor
  if (!controller) return []
  if (node.graph && node.graph !== rootGraphOf(app)) {
    return [null, { content: 'Infinity slot: open the subgraph node at the top level to set slots', disabled: true }]
  }
  const nodes = editorNodesFromGraph(app)
  const nodeId = String(node.id)
  const editorNode = nodes.find((item) => item.nodeId === nodeId)
  if (!editorNode) return []
  const effective = effectiveEditorSlots(controller.getState(), nodes)
  const update = (next: EditorSlotState) => {
    controller.setState(next)
    app.canvas?.setDirty?.(true, true)
  }

  const nodeOutputs = effective.outputs.filter((slot) => slot.bind.nodeId === nodeId)
  const outputCandidates = editorNodeOutputs(editorNode)
  const outputOptions: MenuItem[] = outputCandidates.map((candidate) => {
    const slot = nodeOutputs.find((item) => outputSlotId(item.bind) === candidate.slotId)
    const what = candidate.outputIndex === undefined ? 'Node result' : `${candidate.outputName} #${candidate.outputIndex}`
    return {
      content: slot
        ? `✓ ${what} → ${slot.label} · ${slot.type}${slot.auto ? ' (default)' : ''}`
        : `${what} (${candidate.type})`,
      callback: () => update(toggleEditorOutputSlot(controller.getState(), editorNodesFromGraph(app), candidate.slotId)),
    }
  })
  const outputItem: MenuItem = outputOptions.length
    ? { content: 'Output slots', has_submenu: true, submenu: { options: outputOptions } }
    : {
        content: `Output slots unavailable: ${
          (editorNode.outputSockets ?? []).length
            ? `outputs are ${[...new Set((editorNode.outputSockets ?? []).map((socket) => socket.type))].join(', ')} (not image, video, audio or text)`
            : outputReason[editorNodeOutputType(editorNode).reason ?? 'not_output_node']
        }`,
        disabled: true,
      }

  const inputCandidates = editorNodeInputs(editorNode)
  const inputOptions: MenuItem[] = inputCandidates.map(({ field, type, socketType, linked }) => {
    const slot = effective.inputs.find((input) => input.bind.nodeId === nodeId && input.bind.path === `inputs.${field}`)
    const what = socketType ? `${field} ⟵ ${socketType}${linked ? ', connected' : ''}` : field
    return {
      content: slot ? `✓ ${what} → ${slot.label}${slot.auto ? ' (default)' : ''}` : `${what} (${type})`,
      callback: () => update(toggleEditorInput(controller.getState(), editorNodesFromGraph(app), nodeId, field)),
    }
  })
  const inputItem: MenuItem = inputOptions.length
    ? { content: 'Input slots', has_submenu: true, submenu: { options: inputOptions } }
    : { content: 'Input slots: no settable fields on this node', disabled: true }

  const nodeSlots = [
    ...effective.inputs
      .filter((input) => input.bind.nodeId === nodeId)
      .map((input) => ({ kind: 'input' as const, key: input.key, label: input.label, detail: input.bind.path?.replace(/^inputs\./, '') })),
    ...nodeOutputs.map((slot) => ({
      kind: 'output' as const,
      key: slot.key,
      label: slot.label,
      detail: slot.bind.outputIndex === undefined ? undefined : slot.bind.outputName,
    })),
  ]
  const renameItem: MenuItem | undefined = nodeSlots.length
    ? {
        content: 'Rename slot',
        has_submenu: true,
        submenu: {
          options: nodeSlots.map((slot) => ({
            content: `${slot.kind === 'input' ? 'IN' : 'OUT'} ${slot.label}${slot.detail ? ` (${slot.detail})` : ''}…`,
            callback: () => {
              void askLabel(win, app, slot.label).then((label) => {
                if (label === undefined) return
                update(renameEditorSlot(controller.getState(), editorNodesFromGraph(app), slot.kind, slot.key, label))
              })
            },
          })),
        },
      }
    : undefined

  return [null, outputItem, inputItem, ...(renameItem ? [renameItem] : [])]
}

const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) => {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
}

const TITLE_HEIGHT = 30
const TAG_HEIGHT = 20
const IN_COLOR = '#14b8a6'
const OUT_COLOR = '#f59e0b'

/** IN / OUT tags stacked above each slot node's title, plus a bar beside each bound widget. */
function drawSlotTags(ctx: CanvasRenderingContext2D, app: ComfySlotEditorApp, controller: ComfySlotEditorController) {
  const graph = rootGraphOf(app)
  if (!graph || (app.canvas?.graph && app.canvas.graph !== graph)) return
  const nodes = editorNodesFromGraph(app)
  const effective = effectiveEditorSlots(controller.getState(), nodes)
  type Tag = { text: string; short: string; color: string; auto: boolean }
  const tagsByNode = new Map<string, Tag[]>()
  const push = (nodeId: string, tag: Tag) => tagsByNode.set(nodeId, [...(tagsByNode.get(nodeId) ?? []), tag])
  for (const input of effective.inputs) {
    if (!input.bind.nodeId) continue
    const field = input.bind.path?.replace(/^inputs\./, '') ?? ''
    push(input.bind.nodeId, {
      text: `IN: ${input.label} ← ${field}${input.auto ? ' (default)' : ''}`,
      short: `IN: ${input.label}`,
      color: IN_COLOR,
      auto: input.auto,
    })
  }
  for (const output of effective.outputs) {
    if (!output.bind.nodeId) continue
    const socket = output.bind.outputIndex === undefined ? '' : ` ← ${output.bind.outputName ?? `#${output.bind.outputIndex}`}`
    push(output.bind.nodeId, {
      text: `OUT: ${output.label} · ${output.type}${socket}${output.auto ? ' (default)' : ''}`,
      short: `OUT: ${output.label}${socket}`,
      color: OUT_COLOR,
      auto: output.auto,
    })
  }
  if (!tagsByNode.size) return

  // Tags are drawn in graph space; keep them readable when zoomed out (up to 2x their graph size).
  const scale = app.canvas?.ds?.scale ?? 1
  const k = Math.min(2, 1 / Math.max(scale, 0.5))
  const tagHeight = TAG_HEIGHT * k
  ctx.save()
  ctx.font = `600 ${Math.round(12 * k)}px Inter, Arial, sans-serif`
  ctx.textBaseline = 'middle'
  for (const [nodeId, tags] of tagsByNode) {
    const node = graphNodes(graph).find((item) => String(item.id) === nodeId)
    if (!node) continue
    const [x, y] = [node.pos[0]!, node.pos[1]!]
    // Keep each tag over its own node: full text if it fits, else the short form, else cut with an ellipsis.
    const maxText = Math.max(Number(node.size[0]) || 0, 120) - 16 * k
    const fit = (tag: Tag) => {
      if (ctx.measureText(tag.text).width <= maxText) return tag.text
      if (ctx.measureText(tag.short).width <= maxText) return tag.short
      let text = tag.short
      while (text.length > 1 && ctx.measureText(`${text}…`).width > maxText) text = text.slice(0, -1)
      return `${text}…`
    }
    tags.forEach((tag, index) => {
      const text = fit(tag)
      const width = ctx.measureText(text).width + 16 * k
      const top = y - TITLE_HEIGHT - 6 - (tags.length - index) * (tagHeight + 4 * k)
      ctx.globalAlpha = tag.auto ? 0.6 : 1
      ctx.fillStyle = tag.color
      roundRect(ctx, x, top, width, tagHeight, 6 * k)
      ctx.fill()
      ctx.fillStyle = '#111827'
      ctx.fillText(text, x + 8 * k, top + tagHeight / 2 + 0.5)
    })
    // Mark the bound widgets themselves (classic canvas rendering exposes each widget's row position).
    for (const input of effective.inputs) {
      if (input.bind.nodeId !== nodeId) continue
      const field = input.bind.path?.replace(/^inputs\./, '')
      const widget = node.widgets?.find((item) => item.name === field)
      const rowY = typeof widget?.y === 'number' ? widget.y : typeof widget?.last_y === 'number' ? widget.last_y : undefined
      if (rowY === undefined) continue
      ctx.globalAlpha = input.auto ? 0.6 : 1
      ctx.fillStyle = IN_COLOR
      roundRect(ctx, x - 7, y + rowY + 2, 5, (widget?.computedHeight ?? 20) - 4, 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/**
 * Installs (once per ComfyUI app) the slot menu and tags, and points them at `controller`. Calling it again for a new
 * editing session only swaps the controller.
 */
export function installComfySlotEditor(win: Window, app: ComfySlotEditorApp, controller: ComfySlotEditorController) {
  const slotWindow = win as SlotEditorWindow
  slotWindow.__infinitySlotEditor = controller
  const marked = app as ComfySlotEditorApp & { [INSTALLED]?: boolean }
  if (!marked[INSTALLED]) {
    marked[INSTALLED] = true
    if (typeof app.collectNodeMenuItems === 'function' && typeof app.registerExtension === 'function') {
      // Current frontends collect extension menu items; patching getNodeMenuOptions as well would list them twice.
      app.registerExtension({ name: EXTENSION_NAME, getNodeMenuItems: (node) => slotMenuItems(slotWindow, app, node) })
    } else if (app.canvas) {
      const prototype = Object.getPrototypeOf(app.canvas) as LiteCanvasLike
      const original = prototype.getNodeMenuOptions
      if (typeof original === 'function') {
        prototype.getNodeMenuOptions = function (this: LiteCanvasLike, node: LiteNode, ...rest: unknown[]) {
          const items = original.call(this, node, ...rest)
          return [...items, ...slotMenuItems(slotWindow, app, node)]
        }
      }
    }
    if (app.canvas) {
      const canvas = app.canvas
      const previous = canvas.onDrawForeground
      canvas.onDrawForeground = function (this: LiteCanvasLike, ctx, area) {
        previous?.call(this, ctx, area)
        const current = slotWindow.__infinitySlotEditor
        if (current) drawSlotTags(ctx, app, current)
      }
    }
  }
  app.canvas?.setDirty?.(true, true)
}
