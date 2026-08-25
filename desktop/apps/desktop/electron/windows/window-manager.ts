import { BrowserWindow, nativeTheme, net, protocol, shell } from "electron";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RuntimeBootstrap } from "@dramaip/contracts";
import {
  bindRuntimeBootstrap,
  issueRuntimeBootstrap,
  revokeRuntimeBootstrap,
} from "../runtime-bootstrap-channel";

const rendererProtocol = "dramaip";
const rendererHost = "renderer";
export const RENDERER_ORIGIN = `${rendererProtocol}://${rendererHost}`;

export function registerRendererScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: rendererProtocol,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

export function registerRendererProtocol(rendererRoot: string): void {
  if (protocol.isProtocolHandled(rendererProtocol)) return;
  protocol.handle(rendererProtocol, async (request) => {
    const url = new URL(request.url);
    if (url.host !== rendererHost)
      return new Response("Not found", { status: 404 });
    const target = resolve(
      rendererRoot,
      `.${decodeURIComponent(url.pathname)}`,
    );
    if (relative(rendererRoot, target).startsWith("..") || !existsSync(target))
      return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(target).toString());
  });
}

export function createMainWindow(input: {
  bootstrap: RuntimeBootstrap;
  preloadPath: string;
  developmentIconPath?: string;
  developmentUrl?: string;
}): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors;
  const nonce = issueRuntimeBootstrap(input.bootstrap);
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    title: "DramaIP Studio",
    backgroundColor: dark ? "#191a19" : "#f8f7f4",
    ...(input.developmentIconPath ? { icon: input.developmentIconPath } : {}),
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 16, y: 25 },
        }
      : {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: {
            color: dark ? "#191a19" : "#f8f7f4",
            symbolColor: dark ? "#f1eee9" : "#242320",
            height: 64,
          },
        }),
    webPreferences: {
      preload: input.preloadPath,
      additionalArguments: [`--dramaip-runtime-bootstrap-nonce=${nonce}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  const webContentsId = window.webContents.id;
  bindRuntimeBootstrap(nonce, webContentsId);
  window.webContents.once("destroyed", () =>
    revokeRuntimeBootstrap(nonce, webContentsId),
  );
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (
      !url.startsWith(`${rendererProtocol}://`) &&
      !url.startsWith(input.developmentUrl ?? "http://localhost:5177")
    ) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  if (input.developmentUrl) void window.loadURL(input.developmentUrl);
  else void window.loadURL(`${rendererProtocol}://${rendererHost}/index.html`);
  window.once("ready-to-show", () => window.show());
  return window;
}

export function destroyMainWindows(): void {
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
}

export function hasMainWindow(): boolean {
  return BrowserWindow.getAllWindows().length > 0;
}
