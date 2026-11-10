/**
 * The shell-owned secret entry window of a Desktop Host capture session (D2).
 * The Host owns the session and the vault; this window only collects the
 * secret and hands it to the Host over the shell bridge, so the application
 * page never sees it.
 */
import { BrowserWindow, ipcMain } from "electron";
import type {
  BridgeEndpoint,
  HostBridgeActions,
  ShellActions,
} from "@dramaip/host-shell-bridge/protocol";
import {
  CREDENTIAL_CAPTURE_ARG,
  CREDENTIAL_CAPTURE_CANCEL_CHANNEL,
  CREDENTIAL_CAPTURE_SUBMIT_CHANNEL,
} from "./credential-capture-contract";

type Mode = "credential" | "vault-unlock";

function html(label: string, mode: Mode): string {
  const safeLabel = label.replace(/[<>&"']/gu, "");
  const guidance =
    mode === "vault-unlock"
      ? "主密码只会发送给 Desktop Host 并仅在本次启动的内存中用于解锁，不会保存，也不会经过主界面。"
      : "凭据只会发送给 Desktop Host 的本地加密凭据库，不会经过主界面。";
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>安全凭据输入</title><style>
body{margin:0;background:#f7f6f2;color:#252420;font:14px system-ui;padding:28px}h1{font-size:18px;margin:0 0 10px}p{color:#67635b;line-height:1.6}input{box-sizing:border-box;width:100%;padding:11px;border:1px solid #bbb6aa;border-radius:8px;background:white}div{display:flex;gap:10px;justify-content:flex-end;margin-top:18px}button{padding:9px 16px;border:0;border-radius:8px;cursor:pointer}#submit{background:#252420;color:white}#error{color:#a33;min-height:20px}
</style></head><body><h1>${safeLabel || "输入安全凭据"}</h1>
<p>${guidance}</p>
<input id="secret" type="password" autocomplete="off" autofocus aria-label="安全凭据">
<p id="error"></p><div><button id="cancel">取消</button><button id="submit">安全保存</button></div>
<script>
const api=window.dramaipCredentialCapture;const field=document.getElementById('secret');const mode=${JSON.stringify(mode)};
document.getElementById('submit').onclick=async()=>{const value=mode==='vault-unlock'?field.value:field.value.trim();if(!value){document.getElementById('error').textContent='凭据不能为空';return;}document.getElementById('submit').disabled=true;try{await api.submit(value);field.value='';}catch{document.getElementById('error').textContent=mode==='vault-unlock'?'主密码不正确或保险库不可用':'保存失败，请重试';document.getElementById('submit').disabled=false;}};
document.getElementById('cancel').onclick=()=>api.cancel();
field.onkeydown=(event)=>{if(event.key==='Enter')document.getElementById('submit').click();};
</script></body></html>`;
}

/** Open capture windows, by Host capture session. */
export class CredentialCaptureWindows {
  private readonly windows = new Map<string, BrowserWindow>();
  private bridge: BridgeEndpoint<HostBridgeActions, ShellActions> | undefined;

  constructor(
    private readonly preloadPath: string,
    private readonly background: boolean,
    private readonly parent: () => BrowserWindow | undefined,
  ) {
    ipcMain.handle(CREDENTIAL_CAPTURE_SUBMIT_CHANNEL, async (event, value) => {
      const input = value as Record<string, unknown> | null;
      if (
        typeof input?.captureSessionId !== "string" ||
        typeof input.secret !== "string"
      )
        throw new Error("Credential capture payload is invalid");
      const window = this.windows.get(input.captureSessionId);
      if (window?.webContents.id !== event.sender.id || !this.bridge)
        throw new Error("Credential capture session is expired");
      await this.bridge.request("credentialCapture.submit", {
        captureSessionId: input.captureSessionId,
        secret: input.secret,
      });
      return { ok: true };
    });
    ipcMain.handle(CREDENTIAL_CAPTURE_CANCEL_CHANNEL, (event, id: unknown) => {
      if (typeof id !== "string") return;
      if (this.windows.get(id)?.webContents.id !== event.sender.id) return;
      this.close(id);
    });
  }

  /** The Host whose sessions these windows serve; each Host launch rebinds it. */
  bind(
    bridge: BridgeEndpoint<HostBridgeActions, ShellActions> | undefined,
  ): void {
    this.bridge = bridge;
    if (!bridge) this.dispose();
  }

  async open(params: {
    readonly captureSessionId: string;
    readonly mode: Mode;
    readonly label: string;
  }): Promise<void> {
    if (this.windows.has(params.captureSessionId)) return;
    const parent = this.parent();
    const window = new BrowserWindow({
      width: 520,
      height: 350,
      resizable: false,
      minimizable: false,
      maximizable: false,
      show: false,
      ...(this.background ? { focusable: false, skipTaskbar: true } : {}),
      modal: !this.background && parent !== undefined,
      ...(parent ? { parent } : {}),
      webPreferences: {
        preload: this.preloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        ...(this.background ? { backgroundThrottling: false } : {}),
        additionalArguments: [
          `${CREDENTIAL_CAPTURE_ARG}${params.captureSessionId}`,
        ],
      },
    });
    this.windows.set(params.captureSessionId, window);
    window.once("closed", () => {
      if (this.windows.get(params.captureSessionId) !== window) return;
      this.windows.delete(params.captureSessionId);
      // Closing without a submit is a cancel; the Host ignores a finished one.
      void this.bridge
        ?.request("credentialCapture.cancel", {
          captureSessionId: params.captureSessionId,
        })
        .catch(() => undefined);
    });
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html(params.label, params.mode))}`,
    );
    if (!this.background) window.show();
  }

  close(captureSessionId: string): void {
    const window = this.windows.get(captureSessionId);
    if (window && !window.isDestroyed()) window.close();
  }

  dispose(): void {
    for (const window of this.windows.values())
      if (!window.isDestroyed()) window.destroy();
    this.windows.clear();
  }
}
