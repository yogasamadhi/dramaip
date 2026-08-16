import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join, normalize, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  net,
  protocol,
  shell,
  utilityProcess,
  type UtilityProcess,
} from "electron";

import type { EngineKind, EngineTokenMap } from "@dramaip/agents";

import { CredentialVault } from "./credential-vault.ts";
import { E2eEngineAdapter, EngineSupervisor } from "./engine-supervisor.ts";
import { startProductionEngines } from "./production-engines.ts";
import type { StudioInit } from "../shared/bridge.ts";

const protocolName = "dramaip";
const protocolHost = "app";
const e2e = process.env.DRAMAIP_E2E === "1";
const userData =
  e2e && process.env.DRAMAIP_E2E_USER_DATA
    ? resolve(process.env.DRAMAIP_E2E_USER_DATA)
    : !app.isPackaged && process.env.DRAMAIP_NEXT_DEV_USER_DATA
      ? resolve(process.env.DRAMAIP_NEXT_DEV_USER_DATA)
      : join(app.getPath("appData"), "DramaIP Studio Next");
app.setPath("userData", userData);

protocol.registerSchemesAsPrivileged([
  {
    scheme: protocolName,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
    },
  },
]);

interface FileCapability {
  path: string;
  name: string;
  expiresAt: number;
  operation: "read" | "write" | "reveal";
}

let studioWindow: BrowserWindow | undefined;
let serverProcess: UtilityProcess | undefined;
let serverPort: number | undefined;
const username = "launch";
const password = randomUUID();
const credentials = new CredentialVault(join(userData, "credentials"));
const fileCapabilities = new Map<string, FileCapability>();
const engines = new EngineSupervisor();
const engineTokens: EngineTokenMap = {
  opencode: randomUUID(),
  codex: randomUUID(),
  dsh: randomUUID(),
  pi: randomUUID(),
  langgraph: randomUUID(),
};

if (e2e) {
  for (const kind of [
    "opencode",
    "codex",
    "dsh",
    "pi",
    "langgraph",
  ] as EngineKind[]) {
    engines.register(kind, new E2eEngineAdapter(kind));
  }
}

function rendererOrigin(): string {
  return process.env.ELECTRON_RENDERER_URL
    ? new URL(process.env.ELECTRON_RENDERER_URL).origin
    : `${protocolName}://${protocolHost}`;
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url;
  if (!url || !url.startsWith(`${rendererOrigin()}/`))
    throw new Error("untrusted IPC sender");
}

async function startServer(): Promise<number> {
  if (serverPort) return serverPort;
  const child = utilityProcess.fork(join(__dirname, "studio-server.js"), [], {
    serviceName: "DramaIP Studio Next Server",
    stdio: "pipe",
  });
  serverProcess = child;
  return new Promise<number>((resolve, reject) => {
    let settled = false;
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-2_000);
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error("local server did not become ready within 30 seconds"));
    }, 30_000);
    child.on("message", (raw: unknown) => {
      const message = raw as any;
      if (message.type === "server:ready" && !settled) {
        settled = true;
        clearTimeout(timer);
        serverPort = message.port;
        resolve(message.port);
        return;
      }
      if (message.type === "server:fatal") {
        dialog.showErrorBox(
          "DramaIP Server",
          String(message.error ?? "local server failed"),
        );
        return;
      }
      if (message.type === "engine-control:request") {
        void engines.handle(message, (response) => child.postMessage(response));
        return;
      }
      if (message.type === "engine-control:cancel") {
        engines.cancel(String(message.requestId));
        return;
      }
      if (message.type === "capability:resolve") {
        const capability = fileCapabilities.get(String(message.token));
        const valid = capability && capability.expiresAt > Date.now();
        if (capability) fileCapabilities.delete(String(message.token));
        child.postMessage({
          type: "capability:resolved",
          requestId: message.requestId,
          capability: valid
            ? { path: capability.path, name: capability.name }
            : undefined,
        });
      }
    });
    child.once("exit", (code) => {
      serverProcess = undefined;
      serverPort = undefined;
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(
          new Error(
            `local server exited before ready (${code})${stderr ? `: ${stderr}` : ""}`,
          ),
        );
      }
    });
    child.postMessage({
      type: "server:bootstrap",
      userData,
      username,
      password,
      allowedOrigins: [rendererOrigin()],
      e2e,
      engineTokens,
    });
  });
}

async function registerRendererProtocol(): Promise<void> {
  const rendererRoot = normalize(join(__dirname, "../renderer"));
  protocol.handle(protocolName, async (request) => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    const assetIndex = pathname.indexOf("/assets/");
    if (assetIndex >= 0) pathname = pathname.slice(assetIndex);
    if (pathname === "/" || !pathname.includes(".")) pathname = "/index.html";
    const target = normalize(join(rendererRoot, pathname));
    if (relative(rendererRoot, target).startsWith(".."))
      return new Response("Forbidden", { status: 403 });
    if (!existsSync(target)) return new Response("Not Found", { status: 404 });
    return net.fetch(pathToFileURL(target).href);
  });
}

async function createWindow(): Promise<void> {
  const dark = nativeTheme.shouldUseDarkColors;
  studioWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: dark ? "#191a19" : "#f8f7f4",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 16, y: 25 } }
      : {
          titleBarOverlay: {
            color: dark ? "#191a19" : "#f8f7f4",
            symbolColor: dark ? "#f1eee9" : "#242320",
            height: 64,
          },
        }),
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  studioWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  studioWindow.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(rendererOrigin())) event.preventDefault();
  });
  studioWindow.once("ready-to-show", () => studioWindow?.show());
  if (process.env.ELECTRON_RENDERER_URL)
    await studioWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await studioWindow.loadURL(`${protocolName}://${protocolHost}/`);
}

function registerIpc(): void {
  ipcMain.handle("studio:init", async (event): Promise<StudioInit> => {
    assertTrustedSender(event);
    const port = await startServer();
    return {
      apiBaseUrl: `http://127.0.0.1:${port}`,
      username,
      password,
      profile: e2e ? "e2e" : "studio",
      platform: process.platform,
    };
  });
  ipcMain.handle("studio:retry-init", async (event): Promise<StudioInit> => {
    assertTrustedSender(event);
    if (serverProcess && !serverPort) serverProcess.kill();
    serverProcess = undefined;
    serverPort = undefined;
    const port = await startServer();
    return {
      apiBaseUrl: `http://127.0.0.1:${port}`,
      username,
      password,
      profile: e2e ? "e2e" : "studio",
      platform: process.platform,
    };
  });
  ipcMain.handle("window:minimize", (event) => {
    assertTrustedSender(event);
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.handle("window:toggle-maximize", (event) => {
    assertTrustedSender(event);
    const target = BrowserWindow.fromWebContents(event.sender);
    if (!target) return false;
    if (target.isMaximized()) target.unmaximize();
    else target.maximize();
    return target.isMaximized();
  });
  ipcMain.handle("window:close", (event) => {
    assertTrustedSender(event);
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  ipcMain.handle("window:set-theme", (event, theme: "light" | "dark") => {
    assertTrustedSender(event);
    if (theme !== "light" && theme !== "dark")
      throw new Error("invalid window theme");
    const target = BrowserWindow.fromWebContents(event.sender);
    if (!target) return;
    nativeTheme.themeSource = theme;
    const dark = theme === "dark";
    target.setBackgroundColor(dark ? "#191a19" : "#f8f7f4");
    if (process.platform !== "darwin") {
      target.setTitleBarOverlay({
        color: dark ? "#191a19" : "#f8f7f4",
        symbolColor: dark ? "#f1eee9" : "#242320",
        height: 64,
      });
    }
  });
  ipcMain.handle(
    "file:select",
    async (event, options?: { extensions?: string[] }) => {
      assertTrustedSender(event);
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner) throw new Error("window is unavailable");
      const result = await dialog.showOpenDialog(owner, {
        properties: ["openFile"],
        filters: options?.extensions?.length
          ? [{ name: "Supported files", extensions: options.extensions }]
          : undefined,
      });
      const selected = result.filePaths[0];
      if (result.canceled || !selected) return;
      const token = randomUUID();
      const name = selected.split(/[\\/]/).at(-1) ?? "file";
      fileCapabilities.set(token, {
        path: selected,
        name,
        expiresAt: Date.now() + 5 * 60_000,
        operation: "read",
      });
      return { capability: token, name };
    },
  );
  ipcMain.handle(
    "file:select-many",
    async (event, options?: { extensions?: string[] }) => {
      assertTrustedSender(event);
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner) throw new Error("window is unavailable");
      const result = await dialog.showOpenDialog(owner, {
        properties: ["openFile", "multiSelections"],
        filters: options?.extensions?.length
          ? [{ name: "Supported files", extensions: options.extensions }]
          : undefined,
      });
      if (result.canceled) return [];
      return result.filePaths.map((path) => {
        const token = randomUUID();
        const name = path.split(/[\\/]/).at(-1) ?? "file";
        fileCapabilities.set(token, {
          path,
          name,
          expiresAt: Date.now() + 5 * 60_000,
          operation: "read",
        });
        return { capability: token, name };
      });
    },
  );
  ipcMain.handle(
    "file:save-target",
    async (
      event,
      options: { suggestedName: string; extensions?: string[] },
    ) => {
      assertTrustedSender(event);
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner) throw new Error("window is unavailable");
      const result = await dialog.showSaveDialog(owner, {
        defaultPath: options.suggestedName,
        filters: options.extensions?.length
          ? [{ name: "Export file", extensions: options.extensions }]
          : undefined,
      });
      if (result.canceled || !result.filePath) return;
      const token = randomUUID();
      const revealToken = randomUUID();
      const name =
        result.filePath.split(/[\\/]/).at(-1) ?? options.suggestedName;
      fileCapabilities.set(token, {
        path: result.filePath,
        name,
        expiresAt: Date.now() + 5 * 60_000,
        operation: "write",
      });
      fileCapabilities.set(revealToken, {
        path: result.filePath,
        name,
        expiresAt: Date.now() + 30 * 60_000,
        operation: "reveal",
      });
      return { capability: token, revealCapability: revealToken, name };
    },
  );
  ipcMain.handle("file:reveal", async (event, token: string) => {
    assertTrustedSender(event);
    const capability = fileCapabilities.get(token);
    fileCapabilities.delete(token);
    if (
      !capability ||
      capability.operation !== "reveal" ||
      capability.expiresAt <= Date.now()
    )
      throw new Error("file capability is invalid or expired");
    shell.showItemInFolder(capability.path);
  });
  ipcMain.handle("credential:store", async (event, secret: string) => {
    assertTrustedSender(event);
    return credentials.store(secret);
  });
  ipcMain.handle("credential:remove", async (event, credentialRef: string) => {
    assertTrustedSender(event);
    await credentials.remove(credentialRef);
  });
  ipcMain.handle("credential:status", async (event, credentialRef?: string) => {
    assertTrustedSender(event);
    if (!credentialRef) return { available: true, configured: false };
    return {
      available: true,
      configured: Boolean(await credentials.resolve(credentialRef)),
    };
  });
  ipcMain.handle("system:open-external", async (event, value: string) => {
    assertTrustedSender(event);
    const url = new URL(value);
    if (url.protocol !== "https:")
      throw new Error("only HTTPS external URLs are allowed");
    await shell.openExternal(url.href);
  });
}

app.whenReady().then(async () => {
  registerIpc();
  if (!process.env.ELECTRON_RENDERER_URL) await registerRendererProtocol();
  const port = await startServer();
  if (!e2e)
    await startProductionEngines({
      supervisor: engines,
      userData,
      serverPort: port,
      engineTokens,
      resolveCredential: (credentialRef) => credentials.resolve(credentialRef),
      removeCredential: (credentialRef) => credentials.remove(credentialRef),
    });
  serverProcess?.postMessage({ type: "server:engines-ready" });
  await createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (!BrowserWindow.getAllWindows().length) void createWindow();
});
app.on("before-quit", () => {
  serverProcess?.postMessage({ type: "server:stop" });
  void engines.stop();
});
