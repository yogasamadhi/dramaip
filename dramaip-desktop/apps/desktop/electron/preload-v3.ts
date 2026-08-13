import { contextBridge, ipcRenderer } from "electron";

export type DesktopApi = {
  awaitInitialization(): Promise<{
    url: string;
    username: string;
    password: string;
    version: string;
  }>;
  retryInitialization(): Promise<{
    url: string;
    username: string;
    password: string;
    version: string;
  }>;
  pickFiles(options?: {
    multiple?: boolean;
    extensions?: string[];
  }): Promise<Array<{ token: string; name: string }> | null>;
  saveTextFile(input: {
    suggestedName: string;
    content: string;
  }): Promise<{ saved: boolean }>;
  openExternal(url: string): Promise<void>;
  revealPath(path: string): Promise<void>;
  storeCredential(secret: string): Promise<{ credentialRef: string }>;
  removeCredential(credentialRef: string): Promise<void>;
  getCredentialStorageStatus(): Promise<{
    available: boolean;
    storage: "local_encrypted_file";
    message?: string;
  }>;
  setWindowTheme(theme: "light" | "dark"): Promise<void>;
};

const api: DesktopApi = {
  awaitInitialization: () => ipcRenderer.invoke("desktop:awaitInitialization"),
  retryInitialization: () => ipcRenderer.invoke("desktop:retryInitialization"),
  pickFiles: (options) => ipcRenderer.invoke("desktop:pickFiles", options),
  saveTextFile: (input) => ipcRenderer.invoke("desktop:saveTextFile", input),
  openExternal: (url) => ipcRenderer.invoke("desktop:openExternal", url),
  revealPath: (path) => ipcRenderer.invoke("desktop:revealPath", path),
  storeCredential: (secret) =>
    ipcRenderer.invoke("desktop:storeCredential", secret),
  removeCredential: (credentialRef) =>
    ipcRenderer.invoke("desktop:removeCredential", credentialRef),
  getCredentialStorageStatus: () =>
    ipcRenderer.invoke("desktop:getCredentialStorageStatus"),
  setWindowTheme: (theme) =>
    ipcRenderer.invoke("desktop:setWindowTheme", theme),
};

contextBridge.exposeInMainWorld("desktop", api);
