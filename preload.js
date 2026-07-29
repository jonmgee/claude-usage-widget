const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onUsage: (cb) => ipcRenderer.on('usage', (_e, d) => cb(d)),
  onPin: (cb) => ipcRenderer.on('pin', (_e, v) => cb(v)),
  refresh: () => ipcRenderer.invoke('refresh'),
  getConfig: () => ipcRenderer.invoke('getConfig'),
  setConfig: (patch) => ipcRenderer.invoke('setConfig', patch),
  togglePin: () => ipcRenderer.send('togglePin'),
  dock: () => ipcRenderer.send('dock'),
  close: () => ipcRenderer.send('close'),
  pingNow: () => ipcRenderer.invoke('pingNow'),
  fitHeight: (h) => ipcRenderer.send('fitHeight', h),
});
