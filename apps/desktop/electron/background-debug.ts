import type { Dialog, Shell } from "electron";

/** Explicit debugging and isolated E2E stay hidden, including packaged apps. */
export function isBackgroundDebugMode(env: NodeJS.ProcessEnv): boolean {
  return (
    env.DRAMAIP_DEBUG_BACKGROUND === "1" || Boolean(env.DRAMAIP_E2E_USER_DATA)
  );
}

/** Test selectors can replace these guards; unmocked OS UI must never appear. */
export function installBackgroundNativeGuards(
  dialogs: Pick<Dialog, "showOpenDialog" | "showSaveDialog" | "showErrorBox">,
  external: Pick<Shell, "openExternal" | "showItemInFolder">,
): void {
  const blocked = () => {
    throw new Error(
      "后台调试禁止弹出系统窗口或打开外部应用；请使用受控测试选择器，前台调试须先获得用户同意。",
    );
  };
  dialogs.showOpenDialog = async () => blocked();
  dialogs.showSaveDialog = async () => blocked();
  dialogs.showErrorBox = (title, content) => console.error(title, content);
  external.openExternal = async () => blocked();
  external.showItemInFolder = blocked;
}

interface UncaughtErrorSource {
  on(event: "uncaughtException", listener: (error: Error) => void): unknown;
  on(event: "unhandledRejection", listener: (reason: unknown) => void): unknown;
  exit(code: number): unknown;
}

/**
 * Nobody reads a native error box during a background run, so an error that
 * escapes the main process is written to stderr and ends the run instead.
 */
export function exitOnUncaughtError(
  source: UncaughtErrorSource,
  log: (message: string) => void = (message) => console.error(message),
): void {
  const fail = (error: unknown) => {
    const detail =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    log(`后台调试中主进程出现未捕获的错误，已退出：${detail}`);
    source.exit(1);
  };
  source.on("uncaughtException", fail);
  source.on("unhandledRejection", fail);
}
