import { contextBridge, ipcRenderer } from "electron";
import type { RuntimeBootstrap } from "@dramaip/contracts";
import { RUNTIME_BOOTSTRAP_CHANNEL } from "./runtime-bootstrap-contract";

// BrowserWindow executes preload once for its initial about:blank document and
// again for the actual renderer URL. The initial document must never consume
// the one-shot nonce.
if (globalThis.location.protocol !== "about:") {
  const prefix = "--dramaip-runtime-bootstrap-nonce=";
  const nonce = process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
  if (!nonce) throw new Error("DramaIP runtime bootstrap nonce is missing");

  const bootstrap = ipcRenderer
    .invoke(RUNTIME_BOOTSTRAP_CHANNEL, nonce)
    // Main validates the one-shot response before it crosses the IPC boundary;
    // keeping preload type-only avoids loading workspace modules in a sandbox.
    .then((value) => Object.freeze(value as RuntimeBootstrap));

  contextBridge.exposeInMainWorld(
    "runtimeBootstrap",
    Object.freeze({ resolve: () => bootstrap }),
  );
}
