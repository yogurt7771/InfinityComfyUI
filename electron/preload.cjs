const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('infinityComfyUIStorage', {
  loadProjectLibrary: () => ipcRenderer.invoke('infinity-storage:load'),
  saveProjectLibrary: (payload) => ipcRenderer.invoke('infinity-storage:save', payload),
})
