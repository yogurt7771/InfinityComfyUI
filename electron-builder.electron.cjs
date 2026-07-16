const base = require('./electron-builder.base.cjs')

module.exports = {
  ...base,
  appId: 'com.infinitycomfyui.workstation',
  productName: 'Infinity ComfyUI',
  extraMetadata: {
    main: 'electron/main.cjs',
  },
}
