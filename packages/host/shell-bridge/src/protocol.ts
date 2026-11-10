/**
 * Node IPC messages between the Electron shell and the Desktop Host (baseline
 * §5.1). Each message type has exactly one sending side; the shell validates
 * every message it receives before acting on it.
 * @module @dramaip/host-shell-bridge/protocol
 */

/** The Host's web application is listening; `url` carries the one-time launch token. */
export interface HostReady {
  readonly type: "ready";
  readonly url: string;
  /** Index injections the shell's page applies before the client boots. */
  readonly injections: readonly unknown[];
}

/** Startup or runtime failure, with the inspected error for the crash report. */
export interface HostFatal {
  readonly type: "fatal";
  readonly message: string;
  readonly diagnostic?: string;
}

/** The Host disposed its tree after a `shutdown` request. */
export interface HostShutdownComplete {
  readonly type: "shutdown-complete";
}

/**
 * One shell-bridge call (D8): the Host asks Main for a native action, or Main
 * hands the Host what a shell-owned window collected. Either side may send
 * one; `id` is unique per sending side.
 */
export interface BridgeRequest {
  readonly type: "bridge-request";
  readonly id: number;
  readonly method: string;
  readonly params: unknown;
}

/** The answer to the {@link BridgeRequest} with the same `id`. */
export type BridgeResponse =
  | {
      readonly type: "bridge-response";
      readonly id: number;
      readonly ok: true;
      readonly result: unknown;
    }
  | {
      readonly type: "bridge-response";
      readonly id: number;
      readonly ok: false;
      readonly message: string;
    };

/** Messages the Host sends to the shell. */
export type HostMessage =
  HostReady | HostFatal | HostShutdownComplete | BridgeRequest | BridgeResponse;

/** Messages the shell sends to the Host. */
export type ShellMessage =
  { readonly type: "shutdown" } | BridgeRequest | BridgeResponse;

/**
 * Whether `message` is a well-formed bridge request or response.
 * @param message - value received over IPC.
 * @returns true for either bridge message with valid fields.
 */
export function isBridgeMessage(
  message: unknown,
): message is BridgeRequest | BridgeResponse {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Record<string, unknown>;
  if (!Number.isSafeInteger(candidate.id)) return false;
  if (candidate.type === "bridge-request")
    return typeof candidate.method === "string";
  if (candidate.type !== "bridge-response") return false;
  return candidate.ok === true || typeof candidate.message === "string";
}

/**
 * Whether `message` is a well-formed Host message.
 * @param message - value received over IPC.
 * @returns true for a message of a known type with valid fields.
 */
export function isHostMessage(message: unknown): message is HostMessage {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Record<string, unknown>;
  switch (candidate.type) {
    case "ready":
      return (
        typeof candidate.url === "string" && Array.isArray(candidate.injections)
      );
    case "fatal":
      return (
        typeof candidate.message === "string" &&
        (candidate.diagnostic === undefined ||
          typeof candidate.diagnostic === "string")
      );
    case "shutdown-complete":
      return true;
    case "bridge-request":
    case "bridge-response":
      return isBridgeMessage(message);
    default:
      return false;
  }
}

/** File-system selection a native dialog returned; an empty list is a cancel. */
export interface ShellDialogSelection {
  readonly paths: readonly string[];
}

/** What the OS secret store offers for wrapping the credential vault key (D2). */
export interface ShellSafeStorageStatus {
  readonly available: boolean;
  readonly secure: boolean;
  readonly backend: string;
}

/**
 * The native actions the Host may ask Main for (D8). Main performs exactly
 * these, carries no business state, and returns paths or bytes to the Host.
 */
export interface ShellActions {
  /** Open dialog. `purpose` selects the E2E stand-in an isolated test run configures. */
  "dialog.open"(params: {
    readonly purpose: "files" | "directory" | "nle-copy-directory";
    readonly title?: string;
    readonly multiple?: boolean;
    readonly extensions?: readonly string[];
  }): ShellDialogSelection;
  "dialog.save"(params: {
    readonly title: string;
    readonly defaultPath: string;
    readonly filters?: readonly { name: string; extensions: string[] }[];
  }): { readonly path: string | null };
  "shell.openExternal"(params: { readonly url: string }): null;
  "shell.showItemInFolder"(params: { readonly path: string }): null;
  /** Decode an image and re-encode it as PNG, dropping EXIF and the original bytes. */
  "image.toPng"(params: { readonly path: string }): {
    readonly pngBase64: string;
    readonly width: number;
    readonly height: number;
  } | null;
  "safeStorage.status"(params: null): ShellSafeStorageStatus;
  "safeStorage.encrypt"(params: { readonly base64: string }): string;
  "safeStorage.decrypt"(params: { readonly base64: string }): string;
  "window.theme"(params: { readonly theme: "light" | "dark" }): null;
  "window.focus"(params: null): null;
  notify(params: { readonly title: string; readonly body?: string }): null;
  /** Show the shell-owned secret entry window of one Host capture session. */
  "credentialCapture.open"(params: {
    readonly captureSessionId: string;
    readonly mode: "credential" | "vault-unlock";
    readonly label: string;
  }): null;
  "credentialCapture.close"(params: {
    readonly captureSessionId: string;
  }): null;
}

/** What Main hands the Host from shell-owned windows. */
export interface HostBridgeActions {
  /** The secret one capture window collected; the Host stores it and never returns it. */
  "credentialCapture.submit"(params: {
    readonly captureSessionId: string;
    readonly secret: string;
  }): null;
  "credentialCapture.cancel"(params: {
    readonly captureSessionId: string;
  }): null;
}

type Handlers<Actions> = {
  [Method in keyof Actions]: Actions[Method] extends (
    params: infer P,
  ) => infer R
    ? (params: P) => R | Promise<R>
    : never;
};

/**
 * One side of the bridge: correlates its own requests with responses and
 * dispatches the other side's requests to registered handlers.
 * @typeParam Outgoing - methods this side calls.
 * @typeParam Incoming - methods this side serves.
 */
export class BridgeEndpoint<Outgoing, Incoming> {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  private readonly handlers = new Map<string, (params: unknown) => unknown>();

  /** @param post - delivers one message to the other side; rejects when it cannot. */
  constructor(
    private readonly post: (
      message: BridgeRequest | BridgeResponse,
    ) => Promise<void>,
  ) {}

  /**
   * Call one method on the other side.
   * @param method - method name.
   * @param params - its parameters.
   * @returns the other side's result.
   */
  request<Method extends keyof Outgoing & string>(
    method: Method,
    params: Outgoing[Method] extends (params: infer P) => unknown ? P : never,
  ): Promise<
    Outgoing[Method] extends (params: never) => infer R ? Awaited<R> : never
  > {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.post({ type: "bridge-request", id, method, params }).catch(
        (error: unknown) => {
          this.pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  /**
   * Serve this side's methods.
   * @param handlers - one handler per method.
   * @returns a disposer removing them.
   */
  serve(handlers: Partial<Handlers<Incoming>>): () => void {
    const names = Object.keys(handlers);
    for (const name of names)
      this.handlers.set(
        name,
        (handlers as Record<string, (params: unknown) => unknown>)[name]!,
      );
    return () => {
      for (const name of names) this.handlers.delete(name);
    };
  }

  /**
   * Feed one received bridge message.
   * @param message - a validated bridge request or response.
   */
  receive(message: BridgeRequest | BridgeResponse): void {
    if (message.type === "bridge-response") {
      const pending = this.pending.get(message.id);
      if (pending === undefined) return;
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.message));
      return;
    }
    const handler = this.handlers.get(message.method);
    const respond = (response: BridgeResponse): void => {
      this.post(response).catch(() => undefined);
    };
    if (handler === undefined) {
      respond({
        type: "bridge-response",
        id: message.id,
        ok: false,
        message: `shell bridge: unknown method ${message.method}`,
      });
      return;
    }
    void (async () => {
      try {
        const result = (await handler(message.params)) ?? null;
        respond({ type: "bridge-response", id: message.id, ok: true, result });
      } catch (error) {
        respond({
          type: "bridge-response",
          id: message.id,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }

  /**
   * Fail every request still waiting for the other side.
   * @param error - the reason, usually that the channel closed.
   */
  close(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
