/**
 * Main's half of the shell bridge (D8): the native actions the Desktop Host
 * may ask for. Each handler performs one Electron call and returns paths,
 * bytes or nothing; no business state lives here. Background runs never show
 * OS UI, and an isolated E2E run answers file dialogs from its configured
 * stand-ins.
 */
import { existsSync } from "node:fs";
import {
  BrowserWindow,
  Notification,
  dialog,
  nativeImage,
  shell,
} from "electron";
import type {
  ShellActions,
  ShellSafeStorageStatus,
} from "@dramaip/host-shell-bridge/protocol";

type Handlers = {
  [Method in keyof ShellActions]: (
    params: Parameters<ShellActions[Method]>[0],
  ) =>
    | ReturnType<ShellActions[Method]>
    | Promise<ReturnType<ShellActions[Method]>>;
};

/** What the native actions act on. */
export interface NativeActionContext {
  /** Background debugging and isolated E2E: no focus, notifications or OS dialogs. */
  readonly background: boolean;
  /**
   * Present in an isolated E2E run: file-dialog stand-ins by purpose, read on
   * every call so a test can switch them between steps.
   */
  readonly e2e?: {
    sourceImportFile(): string | undefined;
    nleCopyDirectory(): string | undefined;
  };
  /** The application window, when one exists. */
  mainWindow(): BrowserWindow | undefined;
  /** The shell-owned secret entry windows. */
  readonly credentialCapture: {
    open(
      params: Parameters<ShellActions["credentialCapture.open"]>[0],
    ): Promise<void>;
    close(captureSessionId: string): void;
  };
}

function safeStorageStatus(): ShellSafeStorageStatus {
  // Compatibility endpoint only. Even checking Electron safeStorage can
  // initialize an OS keychain, so never call it in DramaIP.
  return {
    available: false,
    secure: false,
    backend: "disabled",
  };
}

/** Only web and mail links leave the application. */
function externalUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:", "mailto:"].includes(url.protocol))
    throw new Error("只能打开网页或邮件链接");
  return url.href;
}

/**
 * The shell-bridge handlers.
 * @param context - windows and run mode.
 * @returns one handler per {@link ShellActions} method.
 */
export function nativeActions(context: NativeActionContext): Handlers {
  const parent = (): BrowserWindow | undefined => {
    const window = context.mainWindow();
    return window && !window.isDestroyed() ? window : undefined;
  };
  const showOpen = async (
    options: Electron.OpenDialogOptions,
  ): Promise<{ paths: string[] }> => {
    const window = parent();
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return { paths: result.canceled ? [] : result.filePaths };
  };
  return {
    async "dialog.open"(params) {
      const standIn =
        params.purpose === "files"
          ? context.e2e?.sourceImportFile()
          : params.purpose === "nle-copy-directory"
            ? context.e2e?.nleCopyDirectory()
            : undefined;
      if (standIn !== undefined && existsSync(standIn))
        return { paths: [standIn] };
      const extensions = params.extensions ?? [];
      return showOpen({
        ...(params.title ? { title: params.title } : {}),
        properties:
          params.purpose === "files"
            ? [
                "openFile",
                ...(params.multiple ? (["multiSelections"] as const) : []),
              ]
            : ["openDirectory"],
        ...(extensions.length > 0
          ? { filters: [{ name: "Files", extensions: [...extensions] }] }
          : {}),
      });
    },
    async "dialog.save"(params) {
      const options: Electron.SaveDialogOptions = {
        title: params.title,
        defaultPath: params.defaultPath,
        ...(params.filters
          ? { filters: params.filters.map((f) => ({ ...f })) }
          : {}),
      };
      const window = parent();
      const result = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options);
      return {
        path: result.canceled || !result.filePath ? null : result.filePath,
      };
    },
    async "shell.openExternal"({ url }) {
      await shell.openExternal(externalUrl(url));
      return null;
    },
    "shell.showItemInFolder"({ path }) {
      shell.showItemInFolder(path);
      return null;
    },
    "image.toPng"({ path }) {
      const image = nativeImage.createFromPath(path);
      if (image.isEmpty()) return null;
      const { width, height } = image.getSize();
      return { pngBase64: image.toPNG().toString("base64"), width, height };
    },
    "safeStorage.status"() {
      return safeStorageStatus();
    },
    "safeStorage.encrypt"() {
      throw new Error("系统钥匙串已停用；凭据保存在 ~/.dramaip 本地配置目录。");
    },
    "safeStorage.decrypt"() {
      throw new Error("系统钥匙串已停用；请在设置中重新保存旧接口密钥。");
    },
    "window.theme"({ theme }) {
      // macOS draws its own traffic lights; the overlay exists elsewhere only.
      if (process.platform === "darwin") return null;
      parent()?.setTitleBarOverlay({
        color: theme === "dark" ? "#161616" : "#ffffff",
        symbolColor: theme === "dark" ? "#f1eee9" : "#242320",
        height: 64,
      });
      return null;
    },
    "window.focus"() {
      if (!context.background) parent()?.focus();
      return null;
    },
    notify({ title, body }) {
      if (!context.background)
        new Notification({ title, ...(body ? { body } : {}) }).show();
      return null;
    },
    async "credentialCapture.open"(params) {
      await context.credentialCapture.open(params);
      return null;
    },
    "credentialCapture.close"({ captureSessionId }) {
      context.credentialCapture.close(captureSessionId);
      return null;
    },
  };
}
