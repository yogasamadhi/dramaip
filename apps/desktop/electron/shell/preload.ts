/**
 * Preload of the application and recovery windows (baseline §5.2). It exposes
 * the boot handshake to `dramaip-app://app` and the recovery choice to
 * `dramaip-app://shell`, and nothing to any other document: no business
 * methods, file system, raw IPC or shell access.
 */
import { contextBridge, ipcRenderer } from "electron";
import {
  BOOT_CHANNEL,
  BOOT_FATAL_CHANNEL,
  RECOVERY_CHANNEL,
  type DesktopBootPayload,
  type RecoveryChoice,
} from "./contract";

const origin = globalThis.location.origin;

if (origin === "dramaip-app://app") {
  contextBridge.exposeInMainWorld(
    "dramaipDesktopBoot",
    Object.freeze({
      connect: (): Promise<DesktopBootPayload> =>
        ipcRenderer.invoke(BOOT_CHANNEL) as Promise<DesktopBootPayload>,
      fatal: (message: string): void => {
        ipcRenderer.send(BOOT_FATAL_CHANNEL, String(message).slice(0, 4096));
      },
    }),
  );
} else if (origin === "dramaip-app://shell") {
  contextBridge.exposeInMainWorld(
    "dramaipRecovery",
    Object.freeze({
      choose: (choice: RecoveryChoice): Promise<void> =>
        ipcRenderer.invoke(RECOVERY_CHANNEL, choice) as Promise<void>,
    }),
  );
}
