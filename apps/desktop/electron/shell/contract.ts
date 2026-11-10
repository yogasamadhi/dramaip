/**
 * IPC channels between the shell's preload and Main. The preload exposes
 * these to shell-served documents only; none carries a business method.
 */

/** `dramaip-app://app` asks for the Host's injections once the Host is ready. */
export const BOOT_CHANNEL = "dramaip:boot:connect" as const;

/** `dramaip-app://app` reports a fatal client start failure. */
export const BOOT_FATAL_CHANNEL = "dramaip:boot:fatal" as const;

/** `dramaip-app://shell/recovery` answers with the user's recovery choice. */
export const RECOVERY_CHANNEL = "dramaip:recovery:choose" as const;

/** What the application page receives before its client boots. */
export interface DesktopBootPayload {
  /** The Host's index injection rows, applied in order. */
  readonly injections: readonly unknown[];
  /** Base URL of the Host, for the page's WebSocket streams. */
  readonly streamBaseUrl: string;
}

/** The recovery document's choices (baseline §5.4). */
export type RecoveryChoice = "restart" | "safe" | "backup" | "quit";

export const RECOVERY_CHOICES: readonly RecoveryChoice[] = [
  "restart",
  "safe",
  "backup",
  "quit",
];
