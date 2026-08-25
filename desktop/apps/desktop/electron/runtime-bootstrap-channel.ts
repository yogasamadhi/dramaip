import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import {
  RuntimeBootstrapSchema,
  type RuntimeBootstrap,
} from "@dramaip/contracts";
import { RUNTIME_BOOTSTRAP_CHANNEL } from "./runtime-bootstrap-contract";

interface PendingBootstrap {
  readonly bootstrap: RuntimeBootstrap;
  readonly expiresAt: number;
  webContentsId?: number;
}

const pending = new Map<string, PendingBootstrap>();
const establishedByWebContents = new Map<number, RuntimeBootstrap>();
let registered = false;

export function registerRuntimeBootstrapExchange(): void {
  if (registered) return;
  registered = true;
  ipcMain.handle(RUNTIME_BOOTSTRAP_CHANNEL, (event, value: unknown) => {
    if (typeof value !== "string")
      throw new Error("Runtime bootstrap nonce is invalid");
    const entry = pending.get(value);
    if (!entry) {
      const established = establishedByWebContents.get(event.sender.id);
      if (established) return RuntimeBootstrapSchema.parse(established);
      throw new Error("Runtime bootstrap nonce is missing or consumed");
    }
    pending.delete(value);
    if (entry.expiresAt < Date.now())
      throw new Error("Runtime bootstrap nonce is expired");
    if (entry.webContentsId !== event.sender.id)
      throw new Error("Runtime bootstrap nonce sender is not authorised");
    const bootstrap = RuntimeBootstrapSchema.parse(entry.bootstrap);
    // The nonce authenticates exactly once. A reload of the same, still-bound
    // webContents reuses its established in-memory session without reviving the
    // nonce; destroying the window revokes both.
    establishedByWebContents.set(event.sender.id, bootstrap);
    return bootstrap;
  });
}

export function issueRuntimeBootstrap(bootstrap: RuntimeBootstrap): string {
  const nonce = randomUUID();
  pending.set(nonce, {
    bootstrap: RuntimeBootstrapSchema.parse(bootstrap),
    expiresAt: Date.now() + 30_000,
  });
  return nonce;
}

export function bindRuntimeBootstrap(
  nonce: string,
  webContentsId: number,
): void {
  const entry = pending.get(nonce);
  if (!entry) throw new Error("Runtime bootstrap nonce is missing");
  entry.webContentsId = webContentsId;
}

export function revokeRuntimeBootstrap(
  nonce: string,
  webContentsId?: number,
): void {
  pending.delete(nonce);
  if (webContentsId !== undefined)
    establishedByWebContents.delete(webContentsId);
}
