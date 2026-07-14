const fs = require('node:fs')
const Module = require('node:module')

const originalLoad = Module._load
const ipcHandlers = new Map()
const openedExternalUrls = []
let windowOpenHandler

const captureCall = async (callback) => {
  try {
    return { ok: true, value: await callback() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const runSecurityProbe = async (appUrl) => {
  const outputFile = process.env.INFINITY_ELECTRON_TEST_PROBE_FILE
  if (!outputFile) return

  const authorizeTarget = ipcHandlers.get('infinity-comfy:authorize-target')
  const mainFrame = { url: appUrl }
  const sender = { mainFrame }
  const target = 'http://127.0.0.1:9'
  const authorization = authorizeTarget
    ? {
        mainFrame: await captureCall(() => authorizeTarget({ sender, senderFrame: mainFrame }, target)),
        sameOriginSubframe: await captureCall(() =>
          authorizeTarget({ sender, senderFrame: { url: appUrl } }, target),
        ),
      }
    : undefined

  const popupUrls = [
    'https://example.com/docs',
    'http://example.com/path?x=1',
    'custom-scheme:payload',
    'javascript:alert(1)',
    'file:///C:/sensitive.txt',
    'http://[::1',
  ]
  const popupResults = windowOpenHandler
    ? await Promise.all(
        popupUrls.map(async (url) => ({
          url,
          outcome: await captureCall(() => windowOpenHandler({ url })),
        })),
      )
    : []

  fs.writeFileSync(
    outputFile,
    JSON.stringify({ authorization, openedExternalUrls, popupResults }),
    'utf8',
  )
}

class BrowserWindowStub {
  static getAllWindows() {
    return []
  }

  constructor() {
    this.webContents = {
      setWindowOpenHandler(handler) {
        windowOpenHandler = handler
      },
    }
  }

  loadURL(url) {
    fs.writeFileSync(process.env.INFINITY_ELECTRON_TEST_URL_FILE, url, 'utf8')
    void runSecurityProbe(url)
  }
}

const electronStub = {
  app: {
    isPackaged: false,
    getPath: () => process.cwd(),
    on() {},
    quit() {},
    whenReady: () => Promise.resolve(),
  },
  BrowserWindow: BrowserWindowStub,
  ipcMain: {
    handle(channel, handler) {
      ipcHandlers.set(channel, handler)
    },
  },
  shell: {
    openExternal: async (url) => {
      openedExternalUrls.push(url)
    },
  },
}

Module._load = function load(request, parent, isMain) {
  return request === 'electron' ? electronStub : originalLoad.call(this, request, parent, isMain)
}
