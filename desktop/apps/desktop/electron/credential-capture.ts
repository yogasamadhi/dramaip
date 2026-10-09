import { BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import type { LocalCredentialVault } from "./local-credential-vault";
import {
  CREDENTIAL_CAPTURE_ARG,
  CREDENTIAL_CAPTURE_CANCEL_CHANNEL,
  CREDENTIAL_CAPTURE_SUBMIT_CHANNEL,
} from "./credential-capture-contract";

export interface CredentialCaptureRequest {
  purpose: string;
  label?: string;
  policyId?: string;
  allowedOrigin?: string;
}

export interface CredentialCaptureResult {
  captureSessionId: string;
  status: "pending" | "completed" | "canceled" | "expired";
  credentialRef?: string;
  expiresAt: string;
}

interface CaptureState extends CredentialCaptureResult {
  mode: "credential" | "vault-unlock";
  request: CredentialCaptureRequest;
  webContentsId: number;
  window: BrowserWindow;
}

function html(label: string, mode: CaptureState["mode"]): string {
  const safeLabel = label.replace(/[<>&"']/gu, "");
  const guidance =
    mode === "vault-unlock"
      ? "主密码只会发送给 Desktop Host 并仅在本次启动的内存中用于解锁，不会保存，也不会经过主界面或 Core Runtime。"
      : "凭据只会发送给 Desktop Host 的本地加密凭据库，不会经过主界面或 Core Runtime。";
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

export class CredentialCaptureManager {
  private readonly sessions = new Map<string, CaptureState>();
  private registered = false;

  constructor(
    private readonly vault: LocalCredentialVault,
    private readonly preloadPath: string,
    private readonly background = false,
  ) {}

  register(): void {
    if (this.registered) return;
    this.registered = true;
    ipcMain.handle(CREDENTIAL_CAPTURE_SUBMIT_CHANNEL, async (event, value) => {
      if (!value || typeof value !== "object")
        throw new Error("Credential capture payload is invalid");
      const input = value as Record<string, unknown>;
      if (
        typeof input.captureSessionId !== "string" ||
        typeof input.secret !== "string"
      )
        throw new Error("Credential capture payload is invalid");
      const state = this.sessions.get(input.captureSessionId);
      if (
        !state ||
        state.status !== "pending" ||
        state.webContentsId !== event.sender.id ||
        Date.parse(state.expiresAt) <= Date.now()
      )
        throw new Error("Credential capture session is expired");
      const stored =
        state.mode === "vault-unlock"
          ? (await this.vault.unlock(input.secret), undefined)
          : await this.vault.store(input.secret, {
              purpose: state.request.purpose,
              ...(state.request.policyId
                ? { policyId: state.request.policyId }
                : {}),
              ...(state.request.allowedOrigin
                ? { allowedOrigin: state.request.allowedOrigin }
                : {}),
            });
      state.status = "completed";
      if (stored) state.credentialRef = stored.credentialRef;
      state.window.close();
      return { ok: true };
    });
    ipcMain.handle(CREDENTIAL_CAPTURE_CANCEL_CHANNEL, (event, id: unknown) => {
      if (typeof id !== "string") return;
      const state = this.sessions.get(id);
      if (state?.webContentsId !== event.sender.id) return;
      state.status = "canceled";
      state.window.close();
    });
  }

  async create(
    request: CredentialCaptureRequest,
    parent?: BrowserWindow,
  ): Promise<CredentialCaptureResult> {
    return this.createSession("credential", request, parent);
  }

  async createVaultUnlock(
    parent?: BrowserWindow,
  ): Promise<CredentialCaptureResult> {
    return this.createSession(
      "vault-unlock",
      { purpose: "vault-unlock", label: "解锁本地凭据保险库" },
      parent,
    );
  }

  private async createSession(
    mode: CaptureState["mode"],
    request: CredentialCaptureRequest,
    parent?: BrowserWindow,
  ): Promise<CredentialCaptureResult> {
    if (!this.registered) throw new Error("Credential capture is not ready");
    const captureSessionId = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const window = new BrowserWindow({
      width: 520,
      height: 350,
      resizable: false,
      minimizable: false,
      maximizable: false,
      show: false,
      ...(this.background ? { focusable: false, skipTaskbar: true } : {}),
      modal: !this.background && Boolean(parent),
      ...(parent ? { parent } : {}),
      webPreferences: {
        preload: this.preloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        ...(this.background ? { backgroundThrottling: false } : {}),
        additionalArguments: [`${CREDENTIAL_CAPTURE_ARG}${captureSessionId}`],
      },
    });
    const state: CaptureState = {
      captureSessionId,
      mode,
      request,
      status: "pending",
      expiresAt,
      webContentsId: window.webContents.id,
      window,
    };
    this.sessions.set(captureSessionId, state);
    window.once("closed", () => {
      if (state.status === "pending") state.status = "canceled";
    });
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html(request.label ?? request.purpose, mode))}`,
    );
    if (!this.background) window.show();
    return this.result(state);
  }

  status(captureSessionId: string): CredentialCaptureResult | undefined {
    const state = this.sessions.get(captureSessionId);
    if (!state) return undefined;
    if (
      state.status === "pending" &&
      Date.parse(state.expiresAt) <= Date.now()
    ) {
      state.status = "expired";
      if (!state.window.isDestroyed()) state.window.close();
    }
    return this.result(state);
  }

  dispose(): void {
    for (const state of this.sessions.values())
      if (!state.window.isDestroyed()) state.window.close();
    this.sessions.clear();
  }

  private result(state: CaptureState): CredentialCaptureResult {
    return {
      captureSessionId: state.captureSessionId,
      status: state.status,
      expiresAt: state.expiresAt,
      ...(state.credentialRef ? { credentialRef: state.credentialRef } : {}),
    };
  }
}
