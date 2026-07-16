const base = require('./electron-builder.base.cjs')

module.exports = {
  ...base,
  appId: 'com.infinitycomfyui.launcher',
  productName: 'Infinity ComfyUI Launcher',
  extraMetadata: {
    main: 'electron/launcher.cjs',
  },
}
