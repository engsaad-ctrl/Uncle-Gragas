const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lolh', { getAugments: () => ipcRenderer.invoke('augments:get') });
