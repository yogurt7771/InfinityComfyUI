import type { ComfyUiWorkflow, ComfyWorkflow } from './types'

const DESKTOP_BRIDGE_KEY = '__infinityComfyDesktopWorkflowBridge'
const DESKTOP_BRIDGE_VERSION = 2

export type ComfyWebviewElement = HTMLElement & {
  executeJavaScript: <T = unknown>(code: string, userGesture?: boolean) => Promise<T>
  getURL: () => string
  reload: () => void
}

type BridgePing = { ready?: boolean; pathname?: string; bridgeVersion?: number }

export type ComfyFrameExport = {
  rawJson: ComfyWorkflow
  uiJson: ComfyUiWorkflow
}

const abortError = () => new DOMException('ComfyUI editor request was cancelled', 'AbortError')

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })

const bridgeInstallerSource = String.raw`
(async () => {
  const bridgeKey = ${JSON.stringify(DESKTOP_BRIDGE_KEY)};
  const bridgeVersion = ${DESKTOP_BRIDGE_VERSION};
  if (window[bridgeKey]?.bridgeVersion === bridgeVersion) {
    return { ready: true, bridgeVersion };
  }

  const appModuleUrl = new URL('scripts/app.js', document.baseURI).href;
  const { app } = await import(appModuleUrl);
  const graphFor = (comfyApp) => comfyApp.graph || comfyApp.rootGraph || comfyApp.rootGraphInternal;
  const nodeById = (graph, id) =>
    graph?.getNodeById?.(id) ||
    graph?._nodes_by_id?.[String(id)] ||
    graph?._nodes?.find?.((node) => String(node?.id) === String(id));

  const restoreApiLinks = (comfyApp, workflow) => {
    const graph = graphFor(comfyApp);
    if (!graph) return;
    let restored = false;
    for (const [targetId, workflowNode] of Object.entries(workflow || {})) {
      const targetNode = nodeById(graph, targetId);
      if (!targetNode) continue;
      for (const [inputName, inputValue] of Object.entries(workflowNode?.inputs || {})) {
        if (!Array.isArray(inputValue) || inputValue.length < 2) continue;
        const sourceNode = nodeById(graph, inputValue[0]);
        let inputIndex = targetNode.inputs?.findIndex?.((input) => input?.name === inputName) ?? -1;
        if (inputIndex === -1) {
          const widget = targetNode.widgets?.find?.((item) => item?.name === inputName);
          if (widget && targetNode.convertWidgetToInput) {
            try {
              targetNode.convertWidgetToInput(widget);
              inputIndex = targetNode.inputs?.findIndex?.((input) => input?.name === inputName) ?? -1;
            } catch {}
          }
        }
        if (!sourceNode?.connect || inputIndex === -1 || targetNode.inputs?.[inputIndex]?.link != null) continue;
        sourceNode.connect(Number(inputValue[1]) || 0, targetNode, inputIndex);
        restored = true;
      }
    }
    if (restored) {
      graph.change?.();
      comfyApp.canvas?.draw?.(true, true);
    }
  };

  const openWorkflow = async (comfyApp, workflow, filename) => {
    if (comfyApp.handleFile) {
      await comfyApp.handleFile(new File([JSON.stringify(workflow, null, 2)], filename, { type: 'application/json' }));
      return;
    }
    if (comfyApp.loadGraphData) {
      await comfyApp.loadGraphData(workflow);
      return;
    }
    throw new Error('ComfyUI workflow loader is not available');
  };

  const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const serializedSubsetMatches = (actual, expected) => {
    if (Object.is(actual, expected)) return true;
    if (Array.isArray(expected)) {
      return Array.isArray(actual) && actual.length === expected.length &&
        expected.every((item, index) => serializedSubsetMatches(actual[index], item));
    }
    if (expected && typeof expected === 'object') {
      return actual && typeof actual === 'object' &&
        Object.entries(expected).every(([key, value]) => serializedSubsetMatches(actual[key], value));
    }
    return false;
  };
  const linkTopology = (link) => Array.isArray(link)
    ? link[1] + ':' + link[2] + '->' + link[3] + ':' + link[4]
    : link?.origin_id + ':' + link?.origin_slot + '->' + link?.target_id + ':' + link?.target_slot;
  const assertUiWorkflowLoaded = async (comfyApp, workflow) => {
    if (!Array.isArray(workflow?.nodes)) throw new Error('Editable ComfyUI workflow has no nodes array');
    await nextPaint();
    const serialized = graphFor(comfyApp)?.serialize?.();
    const loadedNodes = Array.isArray(serialized?.nodes) ? serialized.nodes : [];
    const loadedById = new Map(loadedNodes.map((node) => [String(node?.id), node]));
    const missing = workflow.nodes.filter((node) => {
      const loaded = loadedById.get(String(node?.id));
      return !loaded ||
        (node?.type && loaded?.type !== node.type) ||
        (Object.hasOwn(node ?? {}, 'widgets_values') && !serializedSubsetMatches(loaded?.widgets_values, node.widgets_values)) ||
        (node?.properties && !serializedSubsetMatches(loaded?.properties, node.properties));
    });
    const expectedLinks = (Array.isArray(workflow.links) ? workflow.links : []).map(linkTopology).sort();
    const loadedLinks = (Array.isArray(serialized?.links) ? serialized.links : []).map(linkTopology).sort();
    if (missing.length > 0 || loadedNodes.length !== workflow.nodes.length ||
      !serializedSubsetMatches(loadedLinks, expectedLinks)) {
      throw new Error('ComfyUI did not load the editable workflow; falling back to the API workflow is required');
    }
  };

  const handle = async (command, payload) => {
    if (command === 'ping') {
      return {
        ready: Boolean(app?.graphToPrompt && graphFor(app)),
        pathname: location.pathname,
        bridgeVersion,
      };
    }
    if (!app?.graphToPrompt || !graphFor(app)) throw new Error('ComfyUI editor is not ready yet');
    if (command === 'load-ui') {
      await openWorkflow(app, payload, 'Infinity Workflow.json');
      await assertUiWorkflowLoaded(app, payload);
      return { loaded: true };
    }
    if (command === 'load-api') {
      if (app.handleFile) await openWorkflow(app, payload, 'Infinity API Workflow.json');
      else if (app.loadApiJson) await app.loadApiJson(payload);
      else throw new Error('ComfyUI API workflow loader is not available');
      restoreApiLinks(app, payload);
      return { loaded: true };
    }
    if (command === 'resume') {
      window.dispatchEvent(new Event('resize'));
      app.canvas?.resize?.();
      app.canvas?.setDirty?.(true, true);
      app.canvas?.draw?.(true, true);
      await nextPaint();
      return { resumed: true };
    }
    if (command === 'export') {
      const graph = graphFor(app);
      const exported = await app.graphToPrompt(graph);
      if (!exported || typeof exported !== 'object' || !exported.output) {
        throw new Error('ComfyUI did not return an API workflow');
      }
      const uiWorkflow = Array.isArray(exported.workflow?.nodes) ? exported.workflow : graph?.serialize?.();
      if (!uiWorkflow || typeof uiWorkflow !== 'object' || !Array.isArray(uiWorkflow.nodes)) {
        throw new Error('ComfyUI did not return an editable UI workflow');
      }
      return { rawJson: exported.output, uiJson: uiWorkflow };
    }
    throw new Error('Unsupported Infinity ComfyUI editor command');
  };

  Object.defineProperty(window, bridgeKey, {
    configurable: true,
    value: { bridgeVersion, handle },
  });
  return { ready: Boolean(app?.graphToPrompt && graphFor(app)), bridgeVersion };
})()
`

const payloadSource = (payload: unknown) =>
  payload === undefined ? 'undefined' : `JSON.parse(${JSON.stringify(JSON.stringify(payload))})`

const executeWithTimeout = <T>(
  webview: ComfyWebviewElement,
  source: string,
  timeoutMs: number,
  signal?: AbortSignal,
) =>
  new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('ComfyUI desktop bridge timed out'))
    }, timeoutMs)
    const cleanup = () => {
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    webview.executeJavaScript<T>(source).then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })

const installDesktopBridge = (webview: ComfyWebviewElement, signal?: AbortSignal) =>
  executeWithTimeout<BridgePing>(webview, bridgeInstallerSource, 2_000, signal)

export const requestComfyFrame = async <T>(
  webview: ComfyWebviewElement,
  command: string,
  payload?: unknown,
  timeoutMs = 15_000,
  signal?: AbortSignal,
) => {
  await installDesktopBridge(webview, signal)
  const source = `window[${JSON.stringify(DESKTOP_BRIDGE_KEY)}].handle(${JSON.stringify(command)}, ${payloadSource(payload)})`
  return executeWithTimeout<T>(webview, source, timeoutMs, signal)
}

export async function waitForComfyFrameBridge(webview: ComfyWebviewElement, signal?: AbortSignal) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (signal?.aborted) throw abortError()
    try {
      const result = await requestComfyFrame<BridgePing>(webview, 'ping', undefined, 2_500, signal)
      if (result.ready) return
    } catch (error) {
      if (signal?.aborted) throw error
    }
    await wait(250, signal)
  }
  throw new Error('ComfyUI editor is not ready yet')
}

export const loadUiWorkflowIntoComfyFrame = (
  webview: ComfyWebviewElement,
  workflow: ComfyUiWorkflow,
) => requestComfyFrame(webview, 'load-ui', workflow)

export const loadApiWorkflowIntoComfyFrame = (
  webview: ComfyWebviewElement,
  workflow: ComfyWorkflow,
) => requestComfyFrame(webview, 'load-api', workflow)

export const resumeComfyFrame = (webview: ComfyWebviewElement) =>
  requestComfyFrame(webview, 'resume', undefined, 5_000)

export const exportWorkflowFromComfyFrame = (webview: ComfyWebviewElement) =>
  requestComfyFrame<ComfyFrameExport>(webview, 'export')
