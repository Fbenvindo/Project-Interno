// Ponte entre o painel do servidor (console.html) e o processo principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cde', {
  state: () => ipcRenderer.invoke('cde:state'),
  openBrowser: () => ipcRenderer.invoke('cde:openBrowser'),
  openFolder: () => ipcRenderer.invoke('cde:openFolder'),
  chooseFolder: () => ipcRenderer.invoke('cde:chooseFolder'),
  setPort: (p) => ipcRenderer.invoke('cde:setPort', p),
  setAutostart: (on) => ipcRenderer.invoke('cde:setAutostart', on),
  restart: () => ipcRenderer.invoke('cde:restart'),
  linkGestao: (url) => ipcRenderer.invoke('cde:linkGestao', url),
  unlinkGestao: () => ipcRenderer.invoke('cde:unlinkGestao'),
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
});
