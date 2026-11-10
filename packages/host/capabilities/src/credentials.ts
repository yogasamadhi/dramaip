/**
 * The Desktop credential vault (D2) runs in the Host. Its record key is
 * protected by an owner-only key file in the DramaIP home. Secrets enter
 * through shell-owned capture windows whose result
 * Main hands to the Host; no secret reaches the browser, Remote or a log.
 */

import { randomUUID } from "node:crypto";
import type {
  CredentialCaptureRequest,
  CredentialCaptureResult,
  CredentialStorageStatus,
} from "@dramaip/host-contracts";
import type { ShellBridge } from "@dramaip/host-shell-bridge";
import {
  LocalCredentialVault,
  type CredentialUse,
} from "./local-credential-vault.ts";

/** A capture window stays open for this long. */
const CAPTURE_TTL_MS = 5 * 60_000;

interface CaptureState {
  readonly captureSessionId: string;
  readonly mode: "credential" | "vault-unlock";
  readonly request: CredentialCaptureRequest;
  readonly expiresAt: string;
  status: CredentialCaptureResult["status"];
  credentialRef?: string;
}

/** The vault and the capture sessions that write into it. */
export class HostCredentials {
  readonly vault: LocalCredentialVault;
  private readonly captures = new Map<string, CaptureState>();

  /**
   * @param directory - the vault directory.
   * @param shell - the shell bridge for credential capture windows.
   */
  constructor(
    directory: string,
    private readonly shell: ShellBridge,
  ) {
    this.vault = new LocalCredentialVault(directory);
  }

  /**
   * Serve the capture windows' results.
   * @returns a disposer.
   */
  serve(): () => void {
    return this.shell.serve({
      "credentialCapture.submit": async ({ captureSessionId, secret }) => {
        const state = this.pending(captureSessionId);
        if (state.mode === "vault-unlock") await this.vault.unlock(secret);
        else {
          const stored = await this.vault.store(secret, {
            purpose: state.request.purpose,
            ...(state.request.policyId
              ? { policyId: state.request.policyId }
              : {}),
            ...(state.request.allowedOrigin
              ? { allowedOrigin: state.request.allowedOrigin }
              : {}),
          });
          state.credentialRef = stored.credentialRef;
        }
        state.status = "completed";
        await this.close(state);
        return null;
      },
      "credentialCapture.cancel": async ({ captureSessionId }) => {
        const state = this.captures.get(captureSessionId);
        if (state?.status === "pending") state.status = "canceled";
        return null;
      },
    });
  }

  private pending(captureSessionId: string): CaptureState {
    const state = this.captures.get(captureSessionId);
    if (
      state === undefined ||
      state.status !== "pending" ||
      Date.parse(state.expiresAt) <= Date.now()
    )
      throw new Error("Credential capture session is expired");
    return state;
  }

  private async close(state: CaptureState): Promise<void> {
    await this.shell
      .request("credentialCapture.close", {
        captureSessionId: state.captureSessionId,
      })
      .catch(() => undefined);
  }

  private result(state: CaptureState): CredentialCaptureResult {
    return {
      captureSessionId: state.captureSessionId,
      status: state.status,
      expiresAt: state.expiresAt,
      ...(state.credentialRef ? { credentialRef: state.credentialRef } : {}),
    };
  }

  private async open(
    mode: CaptureState["mode"],
    request: CredentialCaptureRequest,
  ): Promise<CredentialCaptureResult> {
    const state: CaptureState = {
      captureSessionId: randomUUID(),
      mode,
      request,
      status: "pending",
      expiresAt: new Date(Date.now() + CAPTURE_TTL_MS).toISOString(),
    };
    this.captures.set(state.captureSessionId, state);
    await this.shell.request("credentialCapture.open", {
      captureSessionId: state.captureSessionId,
      mode,
      label: request.label ?? request.purpose,
    });
    return this.result(state);
  }

  createCredentialCaptureSession(
    request: CredentialCaptureRequest,
  ): Promise<CredentialCaptureResult> {
    return this.open("credential", request);
  }

  createCredentialVaultUnlockSession(): Promise<CredentialCaptureResult> {
    return this.open("vault-unlock", {
      purpose: "vault-unlock",
      label: "解锁本地凭据保险库",
    });
  }

  async credentialCaptureStatus(
    captureSessionId: string,
  ): Promise<CredentialCaptureResult | undefined> {
    const state = this.captures.get(captureSessionId);
    if (state === undefined) return undefined;
    if (
      state.status === "pending" &&
      Date.parse(state.expiresAt) <= Date.now()
    ) {
      state.status = "expired";
      await this.close(state);
    }
    return this.result(state);
  }

  credentialStorageStatus(): Promise<CredentialStorageStatus> {
    return this.vault.status();
  }

  removeCredential(credentialRef: string): Promise<void> {
    return this.vault.remove(credentialRef);
  }

  resolve(
    credentialRef: string,
    use?: CredentialUse,
  ): Promise<string | undefined> {
    return this.vault.resolve(credentialRef, use);
  }

  /** Close every capture window this Host opened. */
  async dispose(): Promise<void> {
    await Promise.all(
      [...this.captures.values()]
        .filter((state) => state.status === "pending")
        .map((state) => this.close(state)),
    );
    this.captures.clear();
  }
}
