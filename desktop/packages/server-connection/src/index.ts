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
  | "disconnected";

export interface RuntimeDescriptor {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly source: "attached" | "spawned";
}

export interface RuntimeConnection {
  readonly descriptor: RuntimeDescriptor;
  readonly runtime: RuntimeInfo;
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

  constructor(private readonly options: ConnectionManagerOptions = {}) {
    this.request = options.fetch ?? globalThis.fetch;
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
        throw new Error("Runtime health endpoint is incompatible");
      return { healthy: true };
    } catch (error) {
      this.transition("degraded");
      throw new RuntimeConnectionError(
        error instanceof Error ? error.message : String(error),
        "degraded",
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
      this.transition("degraded");
      throw new RuntimeConnectionError(
        "Runtime protocol is incompatible",
        "degraded",
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
  }
}
