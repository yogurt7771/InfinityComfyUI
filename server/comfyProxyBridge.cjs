const scriptSafeJson = (value) =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

const comfyProxyBridge = (proxyBase, targetBase, legacyTokenParam, parentOrigin, serviceWorkerProxyBase) => `<script>
(() => {
  const proxyBase = ${scriptSafeJson(proxyBase)};
  const serviceWorkerProxyBase = ${scriptSafeJson(serviceWorkerProxyBase)};
  const targetBase = ${scriptSafeJson(targetBase)};
  const legacyTokenParam = ${scriptSafeJson(legacyTokenParam)};
  const parentOrigin = ${scriptSafeJson(parentOrigin)};
  const bridgeChannel = 'infinity-comfy-editor-v1';
  const targetPathPrefix = new URL(targetBase).pathname.replace(/\\/*$/, '/');
  const currentUrl = new URL(location.href);
  if (currentUrl.searchParams.delete(legacyTokenParam)) {
    history.replaceState(history.state, '', currentUrl.pathname + currentUrl.search + currentUrl.hash);
  }
  const comfyApp = () => {
    const legacyApp = window.app;
    if (legacyApp?.graphToPrompt) return legacyApp;
    const modernApp = window.comfyAPI?.app?.app;
    if (modernApp?.graphToPrompt) {
      window.app = modernApp;
      return modernApp;
    }
    return undefined;
  };
  const withinProxy = (value) => {
    try {
      const parsed = new URL(value, location.href);
      if (parsed.origin !== location.origin || !parsed.pathname.startsWith(proxyBase)) return value;
      parsed.searchParams.delete(legacyTokenParam);
      return parsed.pathname + parsed.search + parsed.hash;
    } catch {
      return value;
    }
  };
  const targetRelativePath = (pathname) => {
    const normalized = '/' + String(pathname || '/').replace(/^\\/+/, '');
    const targetRoot = targetPathPrefix.slice(0, -1);
    if (normalized === targetRoot) return '';
    if (normalized.startsWith(targetPathPrefix)) return normalized.slice(targetPathPrefix.length);
    return normalized.slice(1);
  };
  const proxiedPath = (pathname, search = '', hash = '') =>
    withinProxy(proxyBase + targetRelativePath(pathname) + search + hash);
  const proxiedWebSocketUrl = (pathname, search = '', hash = '') => {
    const routed = new URL(proxiedPath(pathname, search, hash), location.href);
    routed.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return routed.toString();
  };
  const route = (value) => {
    const raw = String(value);
    if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
    if (raw.startsWith(proxyBase)) return withinProxy(raw);
    if (raw.startsWith('//')) {
      try {
        const parsed = new URL(raw, location.href);
        const target = new URL(targetBase);
        if (parsed.origin === location.origin || parsed.origin === target.origin) {
          return proxiedPath(parsed.pathname, parsed.search, parsed.hash);
        }
      } catch {}
      return raw;
    }
    if (raw.startsWith('/')) return proxiedPath(raw);
    try {
      const parsed = new URL(raw, location.href);
      const target = new URL(targetBase);
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin === target.origin) {
        return proxiedPath(parsed.pathname, parsed.search, parsed.hash);
      }
      if (parsed.origin === location.origin && parsed.pathname.startsWith(proxyBase)) {
        return withinProxy(parsed.pathname + parsed.search + parsed.hash);
      }
      if (parsed.origin === location.origin && !parsed.pathname.startsWith(proxyBase)) {
        return proxiedPath(parsed.pathname, parsed.search, parsed.hash);
      }
    } catch {}
    return raw;
  };
  const routeWebSocket = (value) => {
    const raw = String(value);
    try {
      const parsed = new URL(raw, location.href);
      const target = new URL(targetBase);
      if (parsed.host === location.host && parsed.pathname.startsWith(proxyBase)) {
        const routed = new URL(withinProxy(parsed.pathname + parsed.search + parsed.hash), location.href);
        routed.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        return routed.toString();
      }
      if ((parsed.protocol === 'ws:' || parsed.protocol === 'wss:') && parsed.host === target.host) {
        return proxiedWebSocketUrl(parsed.pathname, parsed.search, parsed.hash);
      }
      if ((parsed.protocol === 'ws:' || parsed.protocol === 'wss:') && parsed.host === location.host) {
        return proxiedWebSocketUrl(parsed.pathname, parsed.search, parsed.hash);
      }
      if (parsed.origin === location.origin && !parsed.pathname.startsWith(proxyBase)) {
        return proxiedWebSocketUrl(parsed.pathname, parsed.search, parsed.hash);
      }
    } catch {}
    return raw;
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === 'string' || input instanceof URL) return nativeFetch(route(input), init);
    if (input instanceof Request) {
      const next = route(input.url);
      return nativeFetch(next === input.url ? input : new Request(next, input), init);
    }
    return nativeFetch(input, init);
  };
  const NativeXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function XMLHttpRequest() {
    const xhr = new NativeXHR();
    const open = xhr.open;
    xhr.open = function(method, url, ...rest) {
      return open.call(xhr, method, route(url), ...rest);
    };
    return xhr;
  };
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = function WebSocket(url, protocols) {
    const next = routeWebSocket(url);
    return protocols === undefined ? new NativeWebSocket(next) : new NativeWebSocket(next, protocols);
  };
  window.WebSocket.prototype = NativeWebSocket.prototype;
  if (window.EventSource) {
    const NativeEventSource = window.EventSource;
    window.EventSource = function EventSource(url, init) {
      return new NativeEventSource(route(url), init);
    };
    window.EventSource.prototype = NativeEventSource.prototype;
  }
  if (navigator.sendBeacon) {
    const nativeSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => nativeSendBeacon(route(url), data);
  }
  if (window.Worker) {
    const NativeWorker = window.Worker;
    window.Worker = function Worker(url, options) {
      return new NativeWorker(route(url), options);
    };
    window.Worker.prototype = NativeWorker.prototype;
  }
  if (window.SharedWorker) {
    const NativeSharedWorker = window.SharedWorker;
    window.SharedWorker = function SharedWorker(url, options) {
      return new NativeSharedWorker(route(url), options);
    };
    window.SharedWorker.prototype = NativeSharedWorker.prototype;
  }
  const withinServiceWorkerProxy = (value) => {
    try {
      const parsed = new URL(value, location.href);
      if (parsed.origin !== location.origin || !parsed.pathname.startsWith(serviceWorkerProxyBase)) return value;
      parsed.searchParams.delete(legacyTokenParam);
      return parsed.pathname + parsed.search + parsed.hash;
    } catch {
      return value;
    }
  };
  const routeServiceWorker = (value) => {
    const raw = String(value);
    try {
      const parsed = new URL(raw, location.href);
      if (parsed.origin === location.origin && parsed.pathname.startsWith(serviceWorkerProxyBase)) {
        return withinServiceWorkerProxy(parsed.pathname + parsed.search + parsed.hash);
      }
    } catch {}
    const routed = route(raw);
    try {
      const parsed = new URL(routed, location.href);
      if (parsed.origin === location.origin && parsed.pathname.startsWith(proxyBase)) {
        return withinServiceWorkerProxy(
          serviceWorkerProxyBase + parsed.pathname.slice(proxyBase.length) + parsed.search + parsed.hash,
        );
      }
    } catch {}
    return routed;
  };
  if (navigator.serviceWorker?.register) {
    const serviceWorker = navigator.serviceWorker;
    const nativeServiceWorkerRegister = serviceWorker.register.bind(serviceWorker);
    serviceWorker.register = (scriptURL, options) => {
      const routedScriptURL = routeServiceWorker(scriptURL);
      const routedScope = options?.scope === undefined ? undefined : routeServiceWorker(options.scope);
      return nativeServiceWorkerRegister(
        routedScriptURL,
        routedScope === undefined ? options : { ...options, scope: routedScope },
      );
    };
  }
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const action = form.getAttribute('action');
    if (!action) return;
    const routed = route(action);
    if (routed !== action) form.action = new URL(routed, location.href).toString();
  }, true);
  document.addEventListener('click', (event) => {
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor || anchor.target || anchor.download || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const href = anchor.getAttribute('href');
    if (!href) return;
    const routed = route(href);
    if (routed === href) return;
    event.preventDefault();
    location.href = routed;
  }, true);

  const graphFor = (app) => app.graph || app.rootGraph || app.rootGraphInternal;
  const nodeById = (graph, id) => graph?.getNodeById?.(id) || graph?._nodes_by_id?.[String(id)] ||
    graph?._nodes?.find?.((node) => String(node?.id) === String(id));
  const restoreApiLinks = (app, workflow) => {
    const graph = graphFor(app);
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
      app.canvas?.draw?.(true, true);
    }
  };
  const openWorkflow = async (app, workflow, filename) => {
    if (app.handleFile) {
      await app.handleFile(new File([JSON.stringify(workflow, null, 2)], filename, { type: 'application/json' }));
      return;
    }
    if (app.loadGraphData) {
      await app.loadGraphData(workflow);
      return;
    }
    throw new Error('ComfyUI workflow loader is not available');
  };
  const handleBridgeCommand = async (command, payload) => {
    const app = comfyApp();
    if (command === 'ping') {
      return {
        ready: Boolean(app),
        pathname: location.pathname,
        loginRequired: Boolean(document.querySelector('input[type="password"]')),
      };
    }
    if (!app) throw new Error('ComfyUI editor is not ready yet');
    if (command === 'load-ui') {
      await openWorkflow(app, payload, 'Infinity Workflow.json');
      return { loaded: true };
    }
    if (command === 'load-api') {
      if (app.handleFile) await openWorkflow(app, payload, 'Infinity API Workflow.json');
      else if (app.loadApiJson) await app.loadApiJson(payload);
      else throw new Error('ComfyUI API workflow loader is not available');
      restoreApiLinks(app, payload);
      return { loaded: true };
    }
    if (command === 'export') {
      const exported = await app.graphToPrompt(graphFor(app));
      if (!exported || typeof exported !== 'object' || !exported.output) {
        throw new Error('ComfyUI Export did not return workflow data');
      }
      return { rawJson: exported.output, uiJson: exported.workflow };
    }
    throw new Error('Unsupported ComfyUI editor command');
  };
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (event.source !== window.parent || event.origin !== parentOrigin || message?.channel !== bridgeChannel ||
      message?.type !== 'request' || typeof message.id !== 'string') return;
    Promise.resolve(handleBridgeCommand(message.command, message.payload)).then(
      (payload) => event.source.postMessage({ channel: bridgeChannel, type: 'response', id: message.id, payload }, parentOrigin),
      (error) => event.source.postMessage({
        channel: bridgeChannel,
        type: 'response',
        id: message.id,
        error: error instanceof Error ? error.message : 'ComfyUI editor command failed',
      }, parentOrigin),
    );
  });
})();
</script>`

module.exports = { comfyProxyBridge }
