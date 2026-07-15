declare const comfyProxyBridgeModule: {
  comfyProxyBridge: (
    proxyBase: string,
    targetBase: string,
    legacyTokenParam: string,
    parentOrigin: string,
    serviceWorkerProxyBase: string,
  ) => string
}

export = comfyProxyBridgeModule
