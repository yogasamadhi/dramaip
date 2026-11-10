/**
 * The Electron shell (baseline §5): single instance, the application window
 * and its origin, one Desktop Host child, native recovery. Main owns no
 * business routes, engines, credentials or media; the Host does.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { BrowserWindow, app, dialog, ipcMain, type Tray } from "electron";
import type { HostReady } from "@dramaip/host-shell-bridge/protocol";
import { isBackgroundDebugMode } from "../background-debug";
import {
  attachHostCredentials,
  createMainWindow,
  registerAppProtocol,
  registerAppScheme,
  type HostConnection,
} from "./app-window";
import {
  BOOT_CHANNEL,
  BOOT_FATAL_CHANNEL,
  RECOVERY_CHANNEL,
  RECOVERY_CHOICES,
  type DesktopBootPayload,
  type RecoveryChoice,
} from "./contract";
import { CredentialCaptureWindows } from "./credential-capture";
import { DesktopHostProcess, type HostFailure } from "./host-process";
import { nativeActions } from "./native-actions";
import { copyElectronPreferences } from "./profile-storage";
import { createStatusTray } from "./status-tray";
import { TestRoutes } from "./test-routes";
import {
  backupProfilePatch,
  recoveryDocument,
  writeCrashReport,
} from "./recovery";
import {
  APP_ORIGIN,
  SHELL_ORIGIN,
  authenticateHost,
  originOf,
} from "./web-document";

const require = createRequire(import.meta.url);

// Capture the old location before routing Electron's own profile to the
// shared config home, so first-launch migration still sees the original data.
const previousUserData = app.getPath("userData");
const isolatedTestUserData = process.env.DRAMAIP_E2E_USER_DATA;
// background-entry.ts has already installed the background guards.
const background = isBackgroundDebugMode(process.env);
const developmentIconPath = join(import.meta.dirname, "../../build/icon.png");
const preloadPath = join(import.meta.dirname, "../preload/index.cjs");

/** The DramaIP home the Host runs in; an isolated E2E run keeps it in its user data. */
const dramaipHome =
  isolatedTestUserData ??
  (process.env.DRAMAIP_HOME?.trim() || undefined) ??
  join(homedir(), ".dramaip");

const electronData =
  isolatedTestUserData ?? join(dramaipHome, "desktop", "electron");
const electronLogs = join(dramaipHome, "logs", "electron");
mkdirSync(dramaipHome, { recursive: true, mode: 0o700 });
chmodSync(dramaipHome, 0o700);
mkdirSync(electronData, { recursive: true, mode: 0o700 });
mkdirSync(electronLogs, { recursive: true, mode: 0o700 });
if (!isolatedTestUserData)
  copyElectronPreferences(previousUserData, electronData);
app.setPath("userData", electronData);
app.setPath("sessionData", electronData);
app.setPath("logs", electronLogs);

registerAppScheme();

/**
 * Directory of apps/desktop: the workspace package in development (the
 * compiled main entry sits two levels below it), the app bundle otherwise.
 */
function desktopRoot(): string {
  const candidates = [join(import.meta.dirname, "..", ".."), app.getAppPath()];
  return (
    candidates.find((candidate) =>
      existsSync(join(candidate, "package.json")),
    ) ?? candidates[0]!
  );
}

/**
 * Where the engine runtimes this installation ships live. The engine bundles
 * fall back to their own development defaults for anything left out.
 */
function engineResources(): Record<string, string> {
  const root = app.isPackaged
    ? process.resourcesPath
    : join(desktopRoot(), "build");
  const resources: Record<string, string> = {};
  const pi = app.isPackaged
    ? join(root, "pi", "runtime", "runtime.mjs")
    : join(root, "pi", "runtime.mjs");
  if (!process.env.DRAMAIP_PI_RUNTIME_MODULE)
    resources.DRAMAIP_PI_RUNTIME_MODULE = pi;
  return resources;
}

/**
 * The pre-refactor userData the Host migrates from on first launch (D9): this
 * app's own userData, where 3.0.0-alpha.3 kept its database and vault. An
 * isolated E2E run migrates only from the copy it names.
 */
function legacyUserData(): Record<string, string> {
  const source = isolatedTestUserData
    ? process.env.DRAMAIP_E2E_LEGACY_USER_DATA
    : previousUserData;
  return source ? { DRAMAIP_LEGACY_USER_DATA: source } : {};
}

/** The compiled Desktop Host an installation ships. */
interface InstalledRuntime {
  readonly entry: string;
  readonly safeOverlay: string;
}

let installed: InstalledRuntime | undefined;

/**
 * Where the compiled Host runtime lives: an installation's resources, or the
 * `build/runtime` closure that E2E and measurements name, so they run what an
 * installer ships. Development (`electron-vite dev`) runs the sources.
 */
function runtimeRoot(): string | undefined {
  if (app.isPackaged) return join(process.resourcesPath, "runtime");
  return process.env.DRAMAIP_DESKTOP_RUNTIME || undefined;
}

/**
 * The compiled Host runtime, from the desktop-runtime.json the runtime build
 * wrote; undefined when the Host runs the workspace sources.
 * @throws when the manifest is missing or belongs to another version.
 */
function installedRuntime(): InstalledRuntime | undefined {
  if (installed) return installed;
  const root = runtimeRoot();
  if (!root) return undefined;
  const manifest = JSON.parse(
    readFileSync(join(root, "desktop-runtime.json"), "utf8"),
  ) as { version?: unknown; entry?: unknown; safeOverlay?: unknown };
  // Electron started on a built script reports its own version, not the app's.
  const version = app.isPackaged
    ? app.getVersion()
    : (
        JSON.parse(
          readFileSync(join(desktopRoot(), "package.json"), "utf8"),
        ) as { version: string }
      ).version;
  if (manifest.version !== version)
    throw new Error(
      `the Desktop Host runtime is ${String(manifest.version)}, not ${version}`,
    );
  if (
    typeof manifest.entry !== "string" ||
    typeof manifest.safeOverlay !== "string"
  )
    throw new Error("desktop-runtime.json names no Host entry");
  installed = {
    entry: join(root, manifest.entry),
    safeOverlay: join(root, manifest.safeOverlay),
  };
  return installed;
}

/** The packaged web entry the window loads. */
function webRoot(): string {
  if (app.isPackaged) return join(process.resourcesPath, "web");
  return join(dirname(require.resolve("@dramaip/web/package.json")), "dist");
}

/** The safe launch overlay the Host package ships. */
function safeOverlay(): string {
  const runtime = installedRuntime();
  if (runtime) return runtime.safeOverlay;
  return require.resolve("@dramaip/desktop-host-process/overlays/safe.yml");
}

let mainWindow: BrowserWindow | undefined;
// Retain the Tray for the entire application lifetime, including hidden windows.
let statusTray: Tray | undefined;
let recoveryWindow: BrowserWindow | undefined;
let host: DesktopHostProcess | undefined;
let connection: HostConnection | undefined;
let ready: Promise<HostReady> | undefined;
let failure: { failure: HostFailure; report?: string } | undefined;
let quitting = false;

const window = (): BrowserWindow | undefined =>
  mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;

function showMainWindow(): void {
  const current = window();
  if (!current || background) return;
  if (current.isMinimized()) current.restore();
  current.show();
  current.focus();
}

const credentialCapture = new CredentialCaptureWindows(
  join(import.meta.dirname, "../preload/credential-capture.cjs"),
  background,
  window,
);

/**
 * Start one Host and bind the bridge and origin to it.
 * @param patches - overlay patches for this launch.
 */
function launchHost(patches: readonly string[]): void {
  connection = undefined;
  failure = undefined;
  const runtime = installedRuntime();
  const current = new DesktopHostProcess({
    ...(runtime ? { entry: runtime.entry } : {}),
    env: {
      DRAMAIP_HOME: dramaipHome,
      ...legacyUserData(),
      ...engineResources(),
    },
    patches,
  });
  host = current;
  current.bridge.serve(
    nativeActions({
      background,
      ...(isolatedTestUserData
        ? {
            e2e: {
              sourceImportFile: () =>
                process.env.DRAMAIP_E2E_SOURCE_IMPORT_FILE,
              nleCopyDirectory: () =>
                process.env.DRAMAIP_E2E_NLE_COPY_DIRECTORY,
            },
          }
        : {}),
      mainWindow: window,
      credentialCapture: {
        open: (params) => credentialCapture.open(params),
        close: (id) => credentialCapture.close(id),
      },
    }),
  );
  credentialCapture.bind(current.bridge);
  current.onFailure((reason) => {
    if (host !== current || quitting) return;
    void recover(reason);
  });
  ready = current.ready.then(async (message) => {
    const cookie = await authenticateHost(message.url);
    if (host === current)
      connection = { origin: new URL(message.url).origin, cookie };
    return message;
  });
  ready.catch(() => undefined);
}

/** Show the recovery window once per failure; the crash report comes first. */
async function recover(reason: HostFailure): Promise<void> {
  if (failure) return;
  failure = { failure: reason };
  connection = undefined;
  credentialCapture.bind(undefined);
  console.error(`Desktop Host failed: ${reason.message}`);
  try {
    failure.report = await writeCrashReport(app.getPath("logs"), reason);
  } catch {
    // The recovery window still offers every choice without a report.
  }
  if (recoveryWindow && !recoveryWindow.isDestroyed()) {
    void recoveryWindow.loadURL(`${SHELL_ORIGIN}/recovery`);
    return;
  }
  recoveryWindow = new BrowserWindow({
    width: 620,
    height: 460,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    title: "尽意 DramaIP 恢复",
    ...(background ? { focusable: false, skipTaskbar: true } : {}),
    ...(window() ? { parent: window()! } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...(background ? { backgroundThrottling: false } : {}),
    },
  });
  recoveryWindow.once("closed", () => {
    recoveryWindow = undefined;
  });
  await recoveryWindow.loadURL(`${SHELL_ORIGIN}/recovery`);
  if (!background) recoveryWindow.show();
}

/**
 * Carry out one recovery choice.
 * @param choice - what the user chose.
 */
async function choose(choice: RecoveryChoice): Promise<void> {
  if (choice === "quit") {
    app.quit();
    return;
  }
  const previous = host;
  host = undefined;
  await previous?.shutdown();
  if (choice === "backup") await backupProfilePatch(dramaipHome);
  launchHost(choice === "safe" ? [safeOverlay()] : []);
  recoveryWindow?.destroy();
  window()?.reload();
}

function shellDocument(pathname: string): string | undefined {
  if (pathname === "/recovery" && failure)
    return recoveryDocument(failure.failure, failure.report);
  return undefined;
}

function registerChannels(): void {
  ipcMain.handle(BOOT_CHANNEL, async (event): Promise<DesktopBootPayload> => {
    if (
      event.sender !== window()?.webContents ||
      originOf(event.senderFrame?.url ?? "about:blank") !== APP_ORIGIN
    )
      throw new Error("boot handshake is only for the application window");
    const message = await ready!;
    return {
      injections: message.injections,
      streamBaseUrl: `${new URL(message.url).origin}/`,
    };
  });
  ipcMain.on(BOOT_FATAL_CHANNEL, (event, message: unknown) => {
    if (event.sender !== window()?.webContents) return;
    console.error(`Application page failed to start: ${String(message)}`);
  });
  ipcMain.handle(RECOVERY_CHANNEL, async (event, choice: unknown) => {
    if (
      event.sender !== recoveryWindow?.webContents ||
      !RECOVERY_CHOICES.includes(choice as RecoveryChoice)
    )
      return;
    await choose(choice as RecoveryChoice);
  });
}

/** Host traffic an isolated E2E run routes, through the hook below. */
const testRoutes = isolatedTestUserData ? new TestRoutes() : undefined;

/** E2E observes processes and drives the recovery path through this hook. */
function exposeTestHooks(): void {
  if (!isolatedTestUserData) return;
  (globalThis as { __DRAMAIP_E2E_SHELL__?: unknown }).__DRAMAIP_E2E_SHELL__ = {
    hostPid: () => host?.pid,
    crashHost: () => host?.kill(),
    connection: () => connection,
    ready: () => ready?.then(() => undefined),
    hasStatusTray: () => Boolean(statusTray && !statusTray.isDestroyed()),
    routes: testRoutes,
  };
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);

  app
    .whenReady()
    .then(() => {
      if (process.platform === "darwin" && !app.isPackaged && !background)
        app.dock?.setIcon(developmentIconPath);
      registerAppProtocol({
        webRoot: webRoot(),
        host: () => connection,
        shellDocument,
        ...(testRoutes ? { routes: testRoutes } : {}),
      });
      attachHostCredentials(window, () => connection);
      registerChannels();
      exposeTestHooks();
      launchHost([]);
      mainWindow = createMainWindow({
        preloadPath,
        background,
        ...(!app.isPackaged ? { developmentIconPath } : {}),
      });
      statusTray = createStatusTray({
        background,
        iconPath: join(
          app.isPackaged ? process.resourcesPath : join(desktopRoot(), "build"),
          "tray",
          "iconTemplate.png",
        ),
        showWindow: showMainWindow,
        quit: () => app.quit(),
      });
      // Closing the window on macOS only hides it; the page and Host keep running.
      mainWindow.on("close", (event) => {
        if (quitting || process.platform !== "darwin") return;
        event.preventDefault();
        mainWindow?.hide();
      });
      app.on("activate", showMainWindow);
    })
    .catch((error: unknown) => {
      console.error("DramaIP shell failed to start", error);
      // An installation has no terminal; say why before quitting.
      if (app.isPackaged)
        dialog.showErrorBox("尽意 DramaIP 无法启动", String(error));
      app.quit();
    });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  let stopped = false;
  let stopping: Promise<void> | undefined;
  app.on("before-quit", (event) => {
    quitting = true;
    if (stopped) return;
    event.preventDefault();
    stopping ??= (async () => {
      statusTray?.destroy();
      statusTray = undefined;
      credentialCapture.dispose();
      // The page goes first, so it never watches its Host disappear.
      recoveryWindow?.destroy();
      window()?.destroy();
      await host?.shutdown().catch(() => undefined);
      stopped = true;
      app.quit();
    })();
  });
}
