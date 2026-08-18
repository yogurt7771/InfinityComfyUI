import type { ComfyUiWorkflow, ComfyWorkflow } from './types'

export type ComfyEditorGraph = {
  getNodeById?: (id: unknown) => unknown
  _nodes?: unknown[]
  _nodes_by_id?: Record<string, unknown>
  change?: () => void
  serialize?: () => unknown
}

export type ComfyEditorAppLike = {
  graph?: ComfyEditorGraph
  rootGraph?: ComfyEditorGraph
  rootGraphInternal?: ComfyEditorGraph
  graphToPrompt?: (graph?: ComfyEditorGraph) => Promise<{ output?: unknown; workflow?: unknown }> | { output?: unknown; workflow?: unknown }
  queuePrompt?: (...args: unknown[]) => Promise<unknown> | unknown
  handleFile?: (file: File, openSource?: unknown, options?: unknown) => Promise<unknown> | unknown
  loadApiJson?: (workflow: ComfyWorkflow) => Promise<unknown> | unknown
  canvas?: {
    draw?: (forceCanvas?: boolean, forceBgCanvas?: boolean) => void
  }
}

export type ComfyPromptCaptureWindow = {
  fetch: typeof fetch
  Request?: typeof Request
  Response: typeof Response
}

const plainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type GraphToPromptApp = Pick<ComfyEditorAppLike, 'graphToPrompt' | 'graph' | 'rootGraph' | 'rootGraphInternal'>

async function graphToPromptExport(app: GraphToPromptApp) {
  const exported = await app.graphToPrompt?.(graphForApp(app))
  if (!plainObject(exported)) throw new Error('ComfyUI export did not return workflow data')
  return exported
}

export async function exportUiWorkflowFromComfyEditor(app: GraphToPromptApp) {
  const exported = await graphToPromptExport(app)
  if (!plainObject(exported.workflow)) throw new Error('ComfyUI Export did not return a UI workflow')
  return exported.workflow as ComfyUiWorkflow
}

type QueuePromptCaptureApp = GraphToPromptApp & Pick<ComfyEditorAppLike, 'queuePrompt'>

const fetchInputUrl = (input: Parameters<typeof fetch>[0]) => {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  if (typeof input === 'object' && input !== null && 'url' in input && typeof input.url === 'string') return input.url
  return String(input)
}

const isPromptRequest = (input: Parameters<typeof fetch>[0]) => {
  const rawUrl = fetchInputUrl(input)
  try {
    const parsed = new URL(rawUrl, 'http://infinity.local')
    return parsed.pathname === '/prompt' || parsed.pathname.endsWith('/prompt')
  } catch {
    return rawUrl === '/prompt' || rawUrl.endsWith('/prompt')
  }
}

async function requestBodyText(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) {
  const body = init?.body
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  if (body instanceof Blob) return body.text()
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body)
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body)

  if (typeof input === 'object' && input !== null && 'clone' in input) {
    const clone = input.clone
    if (typeof clone === 'function') return clone.call(input).text()
  }
  return undefined
}

function workflowFromPromptBody(bodyText?: string) {
  if (!bodyText) return undefined
  const parsed = JSON.parse(bodyText) as unknown
  if (!plainObject(parsed)) return undefined
  return plainObject(parsed.prompt) ? (parsed.prompt as ComfyWorkflow) : undefined
}

async function captureApiWorkflowFromQueuePrompt(app: QueuePromptCaptureApp, captureWindow: ComfyPromptCaptureWindow) {
  if (!app.queuePrompt) throw new Error('ComfyUI queuePrompt is not available')

  let captured: ComfyWorkflow | undefined
  let queueError: unknown
  const originalFetch = captureWindow.fetch

  captureWindow.fetch = (async (input, init) => {
    if (isPromptRequest(input)) {
      captured = workflowFromPromptBody(await requestBodyText(input, init))
      return new captureWindow.Response(
        JSON.stringify({ prompt_id: 'infinity-comfyui-capture', number: 0, node_errors: {} }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    return originalFetch.call(captureWindow, input, init)
  }) as typeof fetch

  try {
    await app.queuePrompt()
  } catch (err) {
    queueError = err
  } finally {
    captureWindow.fetch = originalFetch
  }

  if (captured) return captured
  if (queueError instanceof Error) throw queueError
  throw new Error('ComfyUI queuePrompt did not submit an API prompt')
}

export async function exportApiWorkflowFromComfyEditor(app: QueuePromptCaptureApp, captureWindow?: ComfyPromptCaptureWindow) {
  if (captureWindow && app.queuePrompt) {
    try {
      return await captureApiWorkflowFromQueuePrompt(app, captureWindow)
    } catch {
      // Fall back to ComfyUI Export (API) for servers or extensions that cannot be captured at runtime.
    }
  }

  const exported = await graphToPromptExport(app)
  if (!plainObject(exported.output)) throw new Error('ComfyUI Export API did not return an API workflow')
  return exported.output as ComfyWorkflow
}

export async function openWorkflowJsonFileInComfyEditor(
  app: Pick<ComfyEditorAppLike, 'handleFile'>,
  workflow: ComfyWorkflow | ComfyUiWorkflow,
  filename = 'Infinity Workflow.json',
  fileWindow?: { File: typeof File },
) {
  if (!app.handleFile) throw new Error('ComfyUI file open handler is not available')
  const FileConstructor = fileWindow?.File ?? File
  const file = new FileConstructor([JSON.stringify(workflow, null, 2)], filename, { type: 'application/json' })
  await app.handleFile(file)
}

export async function openApiWorkflowJsonFileInComfyEditor(
  app: ComfyEditorAppLike,
  workflow: ComfyWorkflow,
  filename = 'Infinity API Workflow.json',
  fileWindow?: { File: typeof File },
) {
  await openWorkflowJsonFileInComfyEditor(app, workflow, filename, fileWindow)
  restoreApiWorkflowLinks(app, workflow)
}

export type ComfyEditorLiteGraphWindow = {
  LiteGraph?: { registered_node_types?: Record<string, unknown> }
}

const uiWorkflowNodeCount = (workflow: ComfyUiWorkflow) => {
  const nodes = (workflow as { nodes?: unknown[] }).nodes
  return Array.isArray(nodes) ? nodes.length : undefined
}

const serializedGraphNodeCount = (graph?: ComfyEditorGraph) => {
  const serialized = graph?.serialize?.() as { nodes?: unknown[] } | undefined
  return Array.isArray(serialized?.nodes) ? serialized.nodes.length : undefined
}

// 加载后仍不在注册表里的图节点类型 = ComfyUI 里显示为红色的未知节点
//（通常是 /api/object_info 尚未就绪或加载失败——该接口可能有大几十 MB、需要十几秒）。
const unregisteredGraphNodeTypes = (
  frameWindow: ComfyEditorLiteGraphWindow | null | undefined,
  graph?: ComfyEditorGraph,
) => {
  const registry = frameWindow?.LiteGraph?.registered_node_types
  if (!registry) return [] as string[]
  const nodes = graph?._nodes
  if (!Array.isArray(nodes)) return [] as string[]
  const missing = new Set<string>()
  for (const node of nodes) {
    const type = (node as { type?: unknown } | undefined)?.type
    if (typeof type === 'string' && type.length > 0 && !(type in registry)) missing.add(type)
  }
  return [...missing]
}

export type ComfyUiWorkflowLoadResult = { missingNodeTypes: string[] }

const editorBridgeWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function loadUiWorkflowIntoComfyEditor(
  app: Pick<ComfyEditorAppLike, 'handleFile'> & {
    graph?: ComfyEditorGraph
    rootGraph?: ComfyEditorGraph
    rootGraphInternal?: ComfyEditorGraph
  },
  frameWindow: (ComfyEditorLiteGraphWindow & { File: typeof File }) | null | undefined,
  workflow: ComfyUiWorkflow,
): Promise<ComfyUiWorkflowLoadResult> {
  const expectedNodeCount = uiWorkflowNodeCount(workflow)
  // 先等 node defs（object_info）就绪，避免注入出一整片未注册的红节点；
  // 拿不到 LiteGraph 全局时无法判断，保持直接注入。
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const registry = frameWindow?.LiteGraph?.registered_node_types
    if (!registry || Object.keys(registry).length > 0) break
    await editorBridgeWait(500)
  }
  const retryDelays = [1000, 2000, 3000, 5000, 5000]
  for (let attempt = 0; ; attempt += 1) {
    await openWorkflowJsonFileInComfyEditor(app, workflow, 'Infinity Workflow.json', frameWindow ?? undefined)
    const graph = app.graph ?? app.rootGraph ?? app.rootGraphInternal
    const missingNodeTypes = unregisteredGraphNodeTypes(frameWindow, graph)
    const countMatches = expectedNodeCount === undefined || serializedGraphNodeCount(graph) === expectedNodeCount
    if (countMatches && missingNodeTypes.length === 0) return { missingNodeTypes: [] }
    if (attempt >= retryDelays.length) {
      if (!countMatches) {
        throw new Error('ComfyUI loaded the workflow but did not keep it. Retry once the editor has finished restoring.')
      }
      // 节点数量对但类型未注册：图已载入（红节点可见），把缺失类型交给调用方提示。
      return { missingNodeTypes }
    }
    await editorBridgeWait(retryDelays[attempt]!)
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
