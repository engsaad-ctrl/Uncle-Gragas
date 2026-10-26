const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lolh', {
  getAugments: () => ipcRenderer.invoke('augments:get'),
  listChampions: () => ipcRenderer.invoke('champions:list'),
  championPage: (id, mode, position) => ipcRenderer.invoke('champion:page', id, mode, position),
  listItems: (mode) => ipcRenderer.invoke('items:list', mode),
  tierList: (position) => ipcRenderer.invoke('tierlist:get', position),
  lcuState: () => ipcRenderer.invoke('lcu:state'),
  applyToClient: (id, mode, position) => ipcRenderer.invoke('lcu:apply', id, mode, position),
  suggestions: (position, enemies, taken) => ipcRenderer.invoke('suggest:get', position, enemies, taken),
  onLcuState: (callback) => ipcRenderer.on('lcu:state', (_event, state) => callback(state)),
  exportDiagnostics: () => ipcRenderer.invoke('diagnostics:export'),
});
