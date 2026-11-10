/**
 * The application window and its origin (baseline §5.2). The window loads the
 * packaged web entry from `dramaip-app://app/` at once; once the Host is ready
 * every other app-origin request is forwarded to it with the shell's cookie,
 * and the window's WebSocket streams to the Host carry that cookie too. The
 * page never holds the cookie, and no other window gets it.
 */
import { BrowserWindow, nativeTheme, protocol, session, shell } from "electron";
import {
  APP_ORIGIN,
  SCHEME,
  SHELL_ORIGIN,
  forwardWebRequest,
  isWebEntryPath,
  originOf,
  serveWebDocument,
} from "./web-document";
import type { TestRoutes } from "./test-routes";

/** Must run before `app` is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        codeCache: true,
      },
    },
  ]);
}

/** The authenticated Host the app origin forwards to, while one is ready. */
export interface HostConnection {
  /** `http://127.0.0.1:<port>` */
  readonly origin: string;
  /** The Host-issued `Cookie` header value. */
  readonly cookie: string;
}

/** What the app origin serves. */
export interface AppOriginOptions {
  /** Directory of the packaged web entry. */
  readonly webRoot: string;
  /** The current Host, or undefined while none is ready. */
  host(): HostConnection | undefined;
  /** Shell-owned documents of `dramaip-app://shell/`, by path. */
  shellDocument(pathname: string): string | undefined;
  /** Isolated E2E only: routes Host traffic the test holds. */
  readonly routes?: TestRoutes;
}

/**
 * Serve `dramaip-app://`.
 * @param options - web root, Host and shell documents.
 */
export function registerAppProtocol(options: AppOriginOptions): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    const origin = originOf(request.url);
    if (origin === SHELL_ORIGIN) {
      const html = options.shellDocument(url.pathname);
      return html === undefined
        ? new Response(null, { status: 404 })
        : new Response(html, {
            headers: { "content-type": "text/html; charset=utf-8" },
          });
    }
    if (origin !== APP_ORIGIN) return new Response(null, { status: 404 });
    if (isWebEntryPath(url.pathname))
      return serveWebDocument(request, options.webRoot);
    const forward = async (outgoing: Request): Promise<Response> => {
      const host = options.host();
      if (host === undefined)
        return new Response("Desktop Host is not ready", { status: 503 });
      try {
        return await forwardWebRequest(outgoing, host.origin, host.cookie);
      } catch (error) {
        if ((error as Error).name === "AbortError") throw error;
        return new Response("Desktop Host is unreachable", { status: 502 });
      }
    };
    return (await options.routes?.handle(request, forward)) ?? forward(request);
  });
}

/**
 * Give the application window's WebSocket streams to the Host the shell's
 * cookie, and present them as same-origin to the Host's connection fence.
 * @param window - the window streams are attached for.
 * @param host - the current Host.
 */
export function attachHostCredentials(
  window: () => BrowserWindow | undefined,
  host: () => HostConnection | undefined,
): void {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const current = host();
    const owner = window();
    if (
      current === undefined ||
      owner === undefined ||
      details.webContentsId !== owner.webContents.id ||
      !details.url.startsWith(current.origin.replace(/^http/u, "ws"))
    ) {
      callback({ requestHeaders: details.requestHeaders });
      return;
    }
    const requestHeaders = { ...details.requestHeaders };
    for (const name of Object.keys(requestHeaders))
      if (/^(cookie|origin)$/iu.test(name)) delete requestHeaders[name];
    requestHeaders.Cookie = current.cookie;
    requestHeaders.Origin = current.origin;
    callback({ requestHeaders });
  });
}

/** How the application window is created. */
export interface MainWindowOptions {
  readonly preloadPath: string;
  /** Background debugging and isolated E2E: never shown, focused or in the taskbar. */
  readonly background: boolean;
  readonly developmentIconPath?: string;
}

/**
 * Create the application window on `dramaip-app://app/`.
 * @param options - preload and run mode.
 * @returns the window.
 */
export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors;
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    ...(options.background ? { focusable: false, skipTaskbar: true } : {}),
    title: "尽意 DramaIP",
    backgroundColor: dark ? "#161616" : "#ffffff",
    ...(options.developmentIconPath
      ? { icon: options.developmentIconPath }
      : {}),
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          // Center the 14px native controls in the 48px application header.
          trafficLightPosition: { x: 16, y: 17 },
        }
      : {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: {
            color: dark ? "#161616" : "#ffffff",
            symbolColor: dark ? "#f1eee9" : "#242320",
            height: 64,
          },
        }),
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      ...(options.background ? { backgroundThrottling: false } : {}),
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/u.test(url))
      void shell.openExternal(url).catch(() => undefined);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(`${APP_ORIGIN}/`)) return;
    event.preventDefault();
    if (/^https?:/u.test(url))
      void shell.openExternal(url).catch(() => undefined);
  });
  void window.loadURL(`${APP_ORIGIN}/`);
  if (!options.background) window.once("ready-to-show", () => window.show());
  return window;
}
