import { contextBridge, ipcRenderer } from "electron";
import {
  CREDENTIAL_CAPTURE_ARG,
  CREDENTIAL_CAPTURE_CANCEL_CHANNEL,
  CREDENTIAL_CAPTURE_SUBMIT_CHANNEL,
} from "./credential-capture-contract";

// Do not expose or consume the capture session in BrowserWindow's transient
// about:blank document; the sandboxed data: document receives the bridge.
if (globalThis.location.protocol !== "about:") {
  const captureSessionId = process.argv
    .find((argument) => argument.startsWith(CREDENTIAL_CAPTURE_ARG))
    ?.slice(CREDENTIAL_CAPTURE_ARG.length);

  if (!captureSessionId)
    throw new Error("Credential capture session is missing");

  contextBridge.exposeInMainWorld(
    "dramaipCredentialCapture",
    Object.freeze({
      submit: (secret: string) =>
        ipcRenderer.invoke(CREDENTIAL_CAPTURE_SUBMIT_CHANNEL, {
          captureSessionId,
          secret,
        }),
      cancel: () =>
        ipcRenderer.invoke(CREDENTIAL_CAPTURE_CANCEL_CHANNEL, captureSessionId),
    }),
  );
}
