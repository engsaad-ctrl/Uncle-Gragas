const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lolh', {
  getAugments: () => ipcRenderer.invoke('augments:get'),
  listChampions: () => ipcRenderer.invoke('champions:list'),
  championPage: (id, mode, position) => ipcRenderer.invoke('champion:page', id, mode, position),
  listItems: (mode) => ipcRenderer.invoke('items:list', mode),
  tierList: (position) => ipcRenderer.invoke('tierlist:get', position),
});
