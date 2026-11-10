import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dramaip/agents-agents/remote";
import type {} from "@dramaip/system-system/remote";
import type { SystemCredentialCaptureInput } from "@dramaip/system-system/types";

/** The `agents` Remote namespace. */
export type AgentsRemote = Context["remote"]["agents"];
/** The `system` Remote namespace: the credential vault and external links. */
export type SystemRemote = Context["remote"]["system"];
/** The `workspace` Remote namespace: the project list. */
export type WorkspaceRemote = Context["remote"]["workspace"];

/** A saved model provider; its settings live in the payload's stored keys. */
export interface ProviderRecord {
  id: string;
  title: string;
  version: number;
  payload: Record<string, unknown>;
}

/** An agent engine kind. */
export type EngineKind = "pi";

/** One agent engine and its state. */
export interface EngineRow {
  kind: EngineKind;
  name: string;
  version: string;
  status: "starting" | "available" | "degraded" | "unavailable";
  canRun?: boolean;
  statusMessage?: string;
}

/** A default engine, and optionally the model it runs. */
export interface EngineSettings {
  defaultEngineKind: EngineKind;
  defaultModel?: { modelId: string };
}

/** A connection test's or an activation's verdict. */
export interface ProviderVerdict {
  ok?: boolean;
  message: string;
}

/** The local credential vault's state. */
export interface VaultState {
  available: boolean;
  storage: "local_file" | "os_safe_storage" | "master_password" | "unavailable";
  locked: boolean;
  message?: string;
}

/** A Remote answer: the value, or the failure's message. */
type Answer<T> =
  { ok: true; value: T } | { ok: false; error: { message: string } };

/**
 * The value of a Remote answer, or the failure as an `Error`.
 * @param answer - pending Remote answer.
 * @returns its value, typed as the caller reads it.
 */
export async function value<T>(answer: Promise<Answer<unknown>>): Promise<T> {
  const result = await answer;
  if (!result.ok) throw new Error(result.error.message);
  return result.value as T;
}

/**
 * A failure's message.
 * @param cause - what was thrown.
 */
export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The models a connection test found on the account, stored as one list.
 * @param payload - the provider's payload.
 */
export function providerDiscoveredModels(
  payload: Record<string, unknown>,
): string[] {
  const listed = payload["可用模型"];
  return typeof listed === "string"
    ? listed
        .split("、")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

/** Copy the credential flows report their endings with. */
export interface CredentialCopy {
  /** The user closed the window, or it lapsed early. */
  cancelled: string;
  /** The window lapsed. */
  expired: string;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 250));

/**
 * Open the shell's own capture window and wait for the stored credential's
 * reference. The secret never reaches this page.
 * @param system - the `system` Remote namespace.
 * @param input - purpose, label, policy and allowed origin.
 * @param copy - messages for a cancelled or lapsed window.
 * @returns the stored credential's reference.
 */
export async function captureCredential(
  system: SystemRemote,
  input: SystemCredentialCaptureInput,
  copy: CredentialCopy,
): Promise<string> {
  const session = await value<{
    captureSessionId: string;
    expiresAt: string;
  }>(system.createCredentialCaptureSession(input));
  while (Date.parse(session.expiresAt) > Date.now()) {
    const current = await value<{ status: string; credentialRef?: string }>(
      system.credentialSession(session.captureSessionId),
    );
    if (current.status === "completed" && current.credentialRef)
      return current.credentialRef;
    if (current.status !== "pending") throw new Error(copy.cancelled);
    await pause();
  }
  throw new Error(copy.expired);
}

/**
 * Open the shell's own unlock window for the vault and wait until it closes.
 * @param system - the `system` Remote namespace.
 * @param copy - messages for a cancelled or lapsed window.
 */
export async function unlockVault(
  system: SystemRemote,
  copy: CredentialCopy,
): Promise<void> {
  const session = await value<{ captureSessionId: string; expiresAt: string }>(
    system.createCredentialUnlockSession(),
  );
  while (Date.parse(session.expiresAt) > Date.now()) {
    const current = await value<{ status: string }>(
      system.credentialSession(session.captureSessionId),
    );
    if (current.status === "completed") return;
    if (current.status !== "pending") throw new Error(copy.cancelled);
    await pause();
  }
  throw new Error(copy.expired);
}
