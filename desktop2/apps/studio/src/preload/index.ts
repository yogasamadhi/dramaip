import { contextBridge, ipcRenderer } from "electron";

import type { StudioBridge } from "../shared/bridge.ts";

const bridge: StudioBridge = {
  init: () => ipcRenderer.invoke("studio:init"),
  retryInit: () => ipcRenderer.invoke("studio:retry-init"),
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    setTheme: (theme) => ipcRenderer.invoke("window:set-theme", theme),
  },
  files: {
    select: (options) => ipcRenderer.invoke("file:select", options),
    selectMany: (options) => ipcRenderer.invoke("file:select-many", options),
    saveTarget: (options) => ipcRenderer.invoke("file:save-target", options),
    reveal: (capability) => ipcRenderer.invoke("file:reveal", capability),
  },
  credentials: {
    store: (secret) => ipcRenderer.invoke("credential:store", secret),
    remove: (credentialRef) =>
      ipcRenderer.invoke("credential:remove", credentialRef),
    status: (credentialRef) =>
      ipcRenderer.invoke("credential:status", credentialRef),
  },
  system: {
    openExternal: (url) => ipcRenderer.invoke("system:open-external", url),
  },
};

contextBridge.exposeInMainWorld("dramaip", Object.freeze(bridge));
