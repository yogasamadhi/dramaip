/**
 * The Host half of the shell bridge (D8): native actions the Host asks the
 * Electron shell for over the Host process's Node IPC channel, and the
 * shell-owned windows' results the shell hands back. The bridge carries shell
 * actions only; no business method crosses it.
 * @module @dramaip/host-shell-bridge
 */

import type { Context } from "@deepseek-ai/cordis";
import {
  BridgeEndpoint,
  isBridgeMessage,
  type HostBridgeActions,
  type ShellActions,
} from "./protocol.ts";

export type * from "./protocol.ts";

/** Cordis plugin name. */
export const name = "host-shell-bridge";

/** The `shellBridge` service. */
export type ShellBridge = BridgeEndpoint<ShellActions, HostBridgeActions>;

declare module "@deepseek-ai/cordis" {
  interface Context {
    shellBridge: ShellBridge;
  }
}

/**
 * Provide `shellBridge` over this process's IPC channel.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const channel = process;
  if (channel.send === undefined)
    throw new Error(
      "host-shell-bridge: this process has no IPC channel to the Electron shell",
    );
  const bridge: ShellBridge = new BridgeEndpoint(
    (message) =>
      new Promise((resolve, reject) => {
        if (!channel.connected) {
          reject(new Error("shell bridge: the Electron shell disconnected"));
          return;
        }
        channel.send!(message, (error: Error | null) => {
          if (error === null) resolve();
          else reject(error);
        });
      }),
  );
  const onMessage = (message: unknown): void => {
    if (isBridgeMessage(message)) bridge.receive(message);
  };
  const onDisconnect = (): void => {
    bridge.close(new Error("shell bridge: the Electron shell disconnected"));
  };
  ctx.effect(() => {
    channel.on("message", onMessage);
    channel.on("disconnect", onDisconnect);
    return () => {
      channel.off("message", onMessage);
      channel.off("disconnect", onDisconnect);
      bridge.close(new Error("shell bridge: disposed"));
    };
  }, "host-shell-bridge: IPC channel");
  ctx.provide("shellBridge", bridge);
}
