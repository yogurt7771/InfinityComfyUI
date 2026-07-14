declare const comfyProxyBridgeModule: {
  comfyProxyBridge: (proxyBase: string, targetBase: string, legacyTokenParam: string, parentOrigin: string) => string
}

export = comfyProxyBridgeModule
