import {
  DRAMAIP_HTTP_API_VERSION,
  DRAMAIP_PLUGIN_API_VERSION,
  RuntimeInfoSchema,
  type RuntimeInfo,
} from "@dramaip/contracts";

export type ConnectionState =
  | "idle"
  | "discovering"
  | "attaching"
  | "authenticating"
  | "negotiating"
  | "ready"
  | "reconnecting"
  | "degraded"
  | "disconnected"
  | "incompatible";

export interface RuntimeDescriptor {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly source: "attached" | "spawned";
  readonly runtimeId?: string;
  readonly runtimeGeneration?: number;
}

export interface RuntimeConnection {
  readonly descriptor: RuntimeDescriptor;
  readonly runtime: RuntimeInfo;
}

export interface RuntimeTransport {
  readonly baseUrl: string;
  readonly runtimeId: string;
  readonly runtimeGeneration: number;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  openEventStream(cursor: number, signal: AbortSignal): Promise<Response>;
}

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ConnectionManagerOptions {
  readonly fetch?: FetchLike;
  readonly onStateChange?: (state: ConnectionState) => void;
  readonly expectedApiVersion?: typeof DRAMAIP_HTTP_API_VERSION;
  readonly expectedPluginApiVersion?: typeof DRAMAIP_PLUGIN_API_VERSION;
}

export class RuntimeConnectionError extends Error {
  constructor(
    message: string,
    readonly state: ConnectionState,
  ) {
    super(message);
    this.name = "RuntimeConnectionError";
  }
}

/**
 * Shared by Electron, web and CLI. It never retries a caller's mutation: only
 * the SSE transport is reconnectable, which keeps non-idempotent writes safe.
 */
export class ServerConnectionManager {
  private readonly request: FetchLike;
  private readonly expectedApiVersion: string;
  private readonly expectedPluginApiVersion: string;
  private _state: ConnectionState = "idle";
  private connection: RuntimeConnection | undefined;
  private readonly listeners = new Set<(state: ConnectionState) => void>();

  constructor(private readonly options: ConnectionManagerOptions = {}) {
    this.request = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.expectedApiVersion =
      options.expectedApiVersion ?? DRAMAIP_HTTP_API_VERSION;
    this.expectedPluginApiVersion =
      options.expectedPluginApiVersion ?? DRAMAIP_PLUGIN_API_VERSION;
  }

  get state(): ConnectionState {
    return this._state;
  }

  get current(): RuntimeConnection | undefined {
    return this.connection;
  }

  subscribe(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener);
    listener(this._state);
    return () => this.listeners.delete(listener);
  }

  async discover(baseUrl: string): Promise<{ healthy: true }> {
    this.transition("discovering");
    try {
      const response = await this.request(new URL("/health", baseUrl), {
        signal: AbortSignal.timeout(2_000),
      });
      const body = (await response.json().catch(() => undefined)) as
        { healthy?: unknown; apiVersion?: unknown } | undefined;
      if (
        !response.ok ||
        body?.healthy !== true ||
        body.apiVersion !== this.expectedApiVersion
      )
        throw new RuntimeConnectionError(
          "Runtime health endpoint is incompatible",
          "incompatible",
        );
      return { healthy: true };
    } catch (error) {
      const state =
        error instanceof RuntimeConnectionError
          ? error.state
          : ("degraded" as const);
      this.transition(state);
      throw new RuntimeConnectionError(
        error instanceof Error ? error.message : String(error),
        state,
      );
    }
  }

  async attach(descriptor: RuntimeDescriptor): Promise<RuntimeConnection> {
    this.transition("attaching");
    await this.discover(descriptor.baseUrl);
    this.transition("authenticating");
    const runtime = await this.authenticatedJson(descriptor, "/api/v2/runtime");
    this.transition("negotiating");
    const parsed = RuntimeInfoSchema.safeParse(runtime);
    if (!parsed.success) {
      this.transition("degraded");
      throw new RuntimeConnectionError(
        "Runtime metadata is invalid",
        "degraded",
      );
    }
    if (
      parsed.data.apiVersion !== this.expectedApiVersion ||
      parsed.data.pluginApiVersion !== this.expectedPluginApiVersion
    ) {
      this.transition("incompatible");
      throw new RuntimeConnectionError(
        "Runtime protocol is incompatible",
        "incompatible",
      );
    }
    if (
      descriptor.runtimeId !== undefined &&
      descriptor.runtimeId !== parsed.data.runtimeId
    ) {
      this.transition("disconnected");
      throw new RuntimeConnectionError(
        "Runtime identity changed during bootstrap",
        "disconnected",
      );
    }
    if (
      descriptor.runtimeGeneration !== undefined &&
      descriptor.runtimeGeneration !== parsed.data.runtimeGeneration
    ) {
      this.transition("disconnected");
      throw new RuntimeConnectionError(
        "Runtime generation changed during bootstrap",
        "disconnected",
      );
    }
    const connection = { descriptor, runtime: parsed.data };
    this.connection = connection;
    this.transition("ready");
    return connection;
  }

  async spawnLocal(
    spawn: () => Promise<Omit<RuntimeDescriptor, "source">>,
  ): Promise<RuntimeConnection> {
    const spawned = await spawn();
    return this.attach({ ...spawned, source: "spawned" });
  }

  async reconnect(): Promise<RuntimeConnection | undefined> {
    if (!this.connection) return undefined;
    this.transition("reconnecting");
    return this.attach(this.connection.descriptor);
  }

  disconnect(): void {
    this.connection = undefined;
    this.transition("disconnected");
  }

  createTransport(): RuntimeTransport {
    const connection = this.connection;
    if (!connection || this._state !== "ready")
      throw new RuntimeConnectionError(
        "Runtime transport is not ready",
        this._state,
      );
    return Object.freeze({
      baseUrl: connection.descriptor.baseUrl,
      runtimeId: connection.runtime.runtimeId,
      runtimeGeneration: connection.runtime.runtimeGeneration,
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        this.transportFetch(input, init),
      openEventStream: (cursor: number, signal: AbortSignal) => {
        const url = new URL(
          `/api/v2/events${cursor > 0 ? `?cursor=${cursor}` : ""}`,
          connection.descriptor.baseUrl,
        );
        return this.transportFetch(url, {
          headers: {
            Accept: "text/event-stream",
            ...(cursor > 0 ? { "Last-Event-ID": String(cursor) } : {}),
          },
          signal,
        });
      },
    });
  }

  private async transportFetch(
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> {
    const current = this.connection;
    if (!current)
      throw new RuntimeConnectionError(
        "Runtime is disconnected",
        "disconnected",
      );
    const request = new Request(input, init);
    const method = request.method.toUpperCase();
    const safe = method === "GET" || method === "HEAD";
    const execute = (descriptor: RuntimeDescriptor) => {
      const headers = new Headers(request.headers);
      headers.set("Authorization", `Bearer ${descriptor.accessToken}`);
      return this.request(
        new Request(request, {
          headers,
          signal: request.signal,
        }),
      );
    };
    try {
      const response = await execute(current.descriptor);
      if (!safe || response.status !== 401) return response;
    } catch (error) {
      if (!safe || request.signal.aborted) throw error;
    }
    const reconnected = await this.reconnect();
    if (!reconnected)
      throw new RuntimeConnectionError(
        "Runtime reconnect failed",
        "disconnected",
      );
    return execute(reconnected.descriptor);
  }

  private async authenticatedJson(
    descriptor: RuntimeDescriptor,
    path: string,
  ): Promise<unknown> {
    const response = await this.request(new URL(path, descriptor.baseUrl), {
      headers: { Authorization: `Bearer ${descriptor.accessToken}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok)
      throw new RuntimeConnectionError(
        `Runtime authentication failed (${response.status})`,
        "authenticating",
      );
    return response.json();
  }

  private transition(state: ConnectionState): void {
    this._state = state;
    this.options.onStateChange?.(state);
    for (const listener of this.listeners) listener(state);
  }
}
