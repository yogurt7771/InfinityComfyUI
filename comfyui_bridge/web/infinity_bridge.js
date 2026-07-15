import { app } from "../../scripts/app.js"

const BRIDGE_CHANNEL = "infinity-comfy-editor-v1"
const INSTALL_MARKER = "__infinityComfyWorkflowBridgeInstalled"
const APPROVED_ORIGINS_KEY = "infinity-comfy-editor-approved-origins-v1"
const approvedOriginsInMemory = new Set()

const graphFor = (comfyApp) => comfyApp.graph || comfyApp.rootGraph || comfyApp.rootGraphInternal

const nodeById = (graph, id) =>
  graph?.getNodeById?.(id) ||
  graph?._nodes_by_id?.[String(id)] ||
  graph?._nodes?.find?.((node) => String(node?.id) === String(id))

const restoreApiLinks = (comfyApp, workflow) => {
  const graph = graphFor(comfyApp)
  if (!graph) return

  let restored = false
  for (const [targetId, workflowNode] of Object.entries(workflow || {})) {
    const targetNode = nodeById(graph, targetId)
    if (!targetNode) continue

    for (const [inputName, inputValue] of Object.entries(workflowNode?.inputs || {})) {
      if (!Array.isArray(inputValue) || inputValue.length < 2) continue
      const sourceNode = nodeById(graph, inputValue[0])
      let inputIndex = targetNode.inputs?.findIndex?.((input) => input?.name === inputName) ?? -1
      if (inputIndex === -1) {
        const widget = targetNode.widgets?.find?.((item) => item?.name === inputName)
        if (widget && targetNode.convertWidgetToInput) {
          try {
            targetNode.convertWidgetToInput(widget)
            inputIndex = targetNode.inputs?.findIndex?.((input) => input?.name === inputName) ?? -1
          } catch {
            // Some custom nodes expose converted inputs without a conversion hook.
          }
        }
      }
      if (!sourceNode?.connect || inputIndex === -1 || targetNode.inputs?.[inputIndex]?.link != null) continue
      sourceNode.connect(Number(inputValue[1]) || 0, targetNode, inputIndex)
      restored = true
    }
  }

  if (restored) {
    graph.change?.()
    comfyApp.canvas?.draw?.(true, true)
  }
}

const openWorkflow = async (comfyApp, workflow, filename) => {
  if (comfyApp.handleFile) {
    await comfyApp.handleFile(new File([JSON.stringify(workflow, null, 2)], filename, { type: "application/json" }))
    return
  }
  if (comfyApp.loadGraphData) {
    await comfyApp.loadGraphData(workflow)
    return
  }
  throw new Error("ComfyUI workflow loader is not available")
}

const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

const serializedSubsetMatches = (actual, expected) => {
  if (Object.is(actual, expected)) return true
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((item, index) => serializedSubsetMatches(actual[index], item))
  }
  if (expected && typeof expected === "object") {
    return actual && typeof actual === "object" && Object.entries(expected).every(([key, value]) => serializedSubsetMatches(actual[key], value))
  }
  return false
}

const linkTopology = (link) => {
  if (Array.isArray(link)) return `${link[1]}:${link[2]}->${link[3]}:${link[4]}`
  return `${link?.origin_id}:${link?.origin_slot}->${link?.target_id}:${link?.target_slot}`
}

const assertUiWorkflowLoaded = async (comfyApp, workflow) => {
  if (!Array.isArray(workflow?.nodes)) throw new Error("Editable ComfyUI workflow has no nodes array")
  await nextPaint()
  const serialized = graphFor(comfyApp)?.serialize?.()
  const loadedNodes = Array.isArray(serialized?.nodes) ? serialized.nodes : []
  const loadedById = new Map(loadedNodes.map((node) => [String(node?.id), node]))
  const missing = workflow.nodes.filter((node) => {
    const loaded = loadedById.get(String(node?.id))
    return (
      !loaded ||
      (node?.type && loaded?.type !== node.type) ||
      (Object.hasOwn(node ?? {}, "widgets_values") && !serializedSubsetMatches(loaded?.widgets_values, node.widgets_values)) ||
      (node?.properties && !serializedSubsetMatches(loaded?.properties, node.properties))
    )
  })
  const expectedLinks = (Array.isArray(workflow.links) ? workflow.links : []).map(linkTopology).sort()
  const loadedLinks = (Array.isArray(serialized?.links) ? serialized.links : []).map(linkTopology).sort()
  if (
    missing.length > 0 ||
    loadedNodes.length !== workflow.nodes.length ||
    !serializedSubsetMatches(loadedLinks, expectedLinks)
  ) {
    throw new Error("ComfyUI did not load the editable workflow; falling back to the API workflow is required")
  }
}

const approvedOrigins = () => {
  try {
    const value = JSON.parse(localStorage.getItem(APPROVED_ORIGINS_KEY) || "[]")
    return Array.isArray(value) ? value.filter((origin) => typeof origin === "string") : []
  } catch {
    return []
  }
}

const authorizeParentOrigin = (origin) => {
  let parsed
  try {
    parsed = new URL(origin)
  } catch {
    throw new Error("Infinity workflow bridge rejected an invalid parent origin")
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Infinity workflow bridge only accepts web page origins")
  }
  if (origin === location.origin || approvedOriginsInMemory.has(origin) || approvedOrigins().includes(origin)) return

  const approved = window.confirm(
    `Allow ${origin} to load and save this ComfyUI workflow?\n\nOnly approve the Infinity ComfyUI page you opened.`,
  )
  if (!approved) throw new Error("Infinity workflow bridge authorization was not approved")
  approvedOriginsInMemory.add(origin)
  try {
    localStorage.setItem(APPROVED_ORIGINS_KEY, JSON.stringify([...new Set([...approvedOrigins(), origin])]))
  } catch {
    // The current page remains approved for this request even if storage is unavailable.
  }
}

const handleCommand = async (command, payload) => {
  if (command === "ping") {
    return {
      ready: Boolean(app?.graphToPrompt && graphFor(app)),
      pathname: location.pathname,
      loginRequired: false,
      bridgeVersion: 1,
    }
  }
  if (!app?.graphToPrompt || !graphFor(app)) throw new Error("ComfyUI editor is not ready yet")

  if (command === "load-ui") {
    await openWorkflow(app, payload, "Infinity Workflow.json")
    await assertUiWorkflowLoaded(app, payload)
    return { loaded: true }
  }
  if (command === "load-api") {
    if (app.handleFile) await openWorkflow(app, payload, "Infinity API Workflow.json")
    else if (app.loadApiJson) await app.loadApiJson(payload)
    else throw new Error("ComfyUI API workflow loader is not available")
    restoreApiLinks(app, payload)
    return { loaded: true }
  }
  if (command === "export") {
    const exported = await app.graphToPrompt(graphFor(app))
    if (!exported || typeof exported !== "object" || !exported.output) {
      throw new Error("ComfyUI did not return an API workflow")
    }
    return { rawJson: exported.output, uiJson: exported.workflow }
  }
  throw new Error("Unsupported Infinity ComfyUI editor command")
}

const installBridge = () => {
  if (window[INSTALL_MARKER]) return
  window[INSTALL_MARKER] = true

  window.addEventListener("message", (event) => {
    const message = event.data
    if (
      event.source !== window.parent ||
      message?.channel !== BRIDGE_CHANNEL ||
      message?.type !== "request" ||
      typeof message.id !== "string"
    ) {
      return
    }

    const replyTarget = event.source
    const replyOrigin = event.origin
    Promise.resolve().then(() => {
      authorizeParentOrigin(event.origin)
      return handleCommand(message.command, message.payload)
    }).then(
      (payload) =>
        replyTarget.postMessage({ channel: BRIDGE_CHANNEL, type: "response", id: message.id, payload }, replyOrigin),
      (error) =>
        replyTarget.postMessage(
          {
            channel: BRIDGE_CHANNEL,
            type: "response",
            id: message.id,
            error: error instanceof Error ? error.message : "ComfyUI editor command failed",
          },
          replyOrigin,
        ),
    )
  })
}

app.registerExtension({
  name: "InfinityComfyUI.WorkflowBridge",
  setup() {
    installBridge()
  },
})
