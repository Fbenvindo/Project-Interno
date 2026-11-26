import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi } from "../shared/ipc";

const ALLOWED = new Set(["menu:open", "menu:fit", "ifc:pending-available"]);

const api: DesktopApi = {
  openIfc: () => ipcRenderer.invoke("ifc:open"),
  openIfcMany: () => ipcRenderer.invoke("ifc:openMany"),
  readIfcPath: (path) => ipcRenderer.invoke("ifc:readPath", path),
  takePendingIfc: () => ipcRenderer.invoke("ifc:pending"),
  saveFile: (req) => ipcRenderer.invoke("file:save", req),
  openTextFile: (filters) => ipcRenderer.invoke("file:openText", filters),
  savePdf: (req) => ipcRenderer.invoke("file:savePdf", req),
  pdfBytes: (req) => ipcRenderer.invoke("file:pdfBytes", req),
  http: (req) => ipcRenderer.invoke("net:http", req),
  license: {
    activate: (server, key) => ipcRenderer.invoke("license:activate", server, key),
    quit: () => ipcRenderer.send("license:quit"),
  },
  on(channel, cb) {
    if (!ALLOWED.has(channel)) throw new Error(`Canal não permitido: ${channel}`);
    const listener = () => cb();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld("desktop", api);
