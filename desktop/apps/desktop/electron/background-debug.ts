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
