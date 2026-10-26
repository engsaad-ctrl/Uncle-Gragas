const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lolh', {
  getAugments: () => ipcRenderer.invoke('augments:get'),
  listChampions: () => ipcRenderer.invoke('champions:list'),
  championPage: (id, mode, position) => ipcRenderer.invoke('champion:page', id, mode, position),
});
