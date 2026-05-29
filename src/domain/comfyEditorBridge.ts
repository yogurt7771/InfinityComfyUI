import type { ComfyWorkflow } from './types'

export type ComfyEditorGraph = {
  getNodeById?: (id: unknown) => unknown
  _nodes?: unknown[]
  _nodes_by_id?: Record<string, unknown>
  change?: () => void
}

export type ComfyEditorAppLike = {
  graph?: ComfyEditorGraph
  rootGraph?: ComfyEditorGraph
  rootGraphInternal?: ComfyEditorGraph
  loadApiJson?: (workflow: ComfyWorkflow) => Promise<unknown> | unknown
  canvas?: {
    draw?: (forceCanvas?: boolean, forceBgCanvas?: boolean) => void
  }
}

type ComfyEditorNode = {
  id?: string | number
  inputs?: { name?: string; link?: unknown }[]
  widgets?: { name?: string }[]
  convertWidgetToInput?: (widget: { name?: string }) => unknown
  connect?: (outputIndex: number, targetNode: ComfyEditorNode, targetInputIndex: number) => unknown
}

const isEditorNode = (value: unknown): value is ComfyEditorNode =>
  typeof value === 'object' && value !== null

const graphForApp = (app: ComfyEditorAppLike) => app.graph ?? app.rootGraph ?? app.rootGraphInternal

const nodeById = (graph: ComfyEditorGraph, id: unknown) => {
  const direct = graph.getNodeById?.(id)
  if (isEditorNode(direct)) return direct

  const numericId = typeof id === 'string' && id.trim() !== '' && !Number.isNaN(Number(id)) ? Number(id) : undefined
  if (numericId !== undefined) {
    const numeric = graph.getNodeById?.(numericId)
    if (isEditorNode(numeric)) return numeric
  }

  const lookup = graph._nodes_by_id
  const indexed = lookup?.[String(id)] ?? (numericId !== undefined ? lookup?.[String(numericId)] : undefined)
  if (isEditorNode(indexed)) return indexed

  const fromList = graph._nodes?.find((node) => isEditorNode(node) && String(node.id) === String(id))
  return isEditorNode(fromList) ? fromList : undefined
}

const inputIndexForName = (node: ComfyEditorNode, inputName: string) => {
  let inputIndex = node.inputs?.findIndex((input) => input.name === inputName) ?? -1
  if (inputIndex !== -1) return inputIndex

  const widget = node.widgets?.find((item) => item.name === inputName)
  if (widget && node.convertWidgetToInput) {
    try {
      node.convertWidgetToInput(widget)
      inputIndex = node.inputs?.findIndex((input) => input.name === inputName) ?? -1
    } catch {
      return -1
    }
  }
  return inputIndex
}

export function restoreApiWorkflowLinks(app: ComfyEditorAppLike, workflow: ComfyWorkflow) {
  const graph = graphForApp(app)
  if (!graph) return

  let restored = false
  for (const [targetId, workflowNode] of Object.entries(workflow)) {
    const targetNode = nodeById(graph, targetId)
    if (!targetNode) continue

    for (const [inputName, inputValue] of Object.entries(workflowNode.inputs ?? {})) {
      if (!Array.isArray(inputValue) || inputValue.length < 2) continue
      const [sourceId, outputIndex] = inputValue
      const sourceNode = nodeById(graph, sourceId)
      const targetInputIndex = inputIndexForName(targetNode, inputName)
      if (!sourceNode?.connect || targetInputIndex === -1) continue
      if (targetNode.inputs?.[targetInputIndex]?.link !== undefined && targetNode.inputs[targetInputIndex]?.link !== null) continue

      sourceNode.connect(Number(outputIndex) || 0, targetNode, targetInputIndex)
      restored = true
    }
  }

  if (restored) {
    graph.change?.()
    app.canvas?.draw?.(true, true)
  }
}

export async function loadApiWorkflowIntoComfyEditor(app: ComfyEditorAppLike, workflow: ComfyWorkflow) {
  await app.loadApiJson?.(workflow)
  restoreApiWorkflowLinks(app, workflow)
}
