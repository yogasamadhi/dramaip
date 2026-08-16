import type {
  EngineCapabilities,
  EngineEvent,
  EngineHealth,
  EngineSession,
} from "@dramaip/contracts";
import type { EngineKind } from "@dramaip/agents";

export interface EngineAdapter {
  health(): Promise<EngineHealth>;
  capabilities(): Promise<EngineCapabilities>;
  call(method: string, payload: any): Promise<unknown>;
  stream(
    method: string,
    payload: any,
    signal: AbortSignal,
  ): AsyncIterable<EngineEvent>;
  stop(): Promise<void>;
}

class UnavailableEngineAdapter implements EngineAdapter {
  constructor(
    private readonly kind: EngineKind,
    private readonly version: string,
  ) {}

  async health(): Promise<EngineHealth> {
    return {
      status: "unavailable",
      version: this.version,
      detail: `${this.kind} runtime has not started`,
    };
  }

  async capabilities(): Promise<EngineCapabilities> {
    return {
      streaming: true,
      interrupt: true,
      resume: true,
      fork: true,
      tools: [],
    };
  }

  async call(method: string): Promise<unknown> {
    if (method === "health") return this.health();
    if (method === "capabilities") return this.capabilities();
    throw new Error(`${this.kind} engine is unavailable`);
  }

  async *stream(): AsyncIterable<EngineEvent> {
    yield* [] as EngineEvent[];
    throw new Error(`${this.kind} engine is unavailable`);
  }

  async stop(): Promise<void> {}
}

const versions: Record<EngineKind, string> = {
  opencode: "1.18.15",
  codex: "0.147.0",
  dsh: "0.1.0-rc.5",
  pi: "0.84.2",
  langgraph: "0.2.43",
};

export class EngineSupervisor {
  private readonly adapters = new Map<EngineKind, EngineAdapter>();
  private readonly streams = new Map<string, AbortController>();
  private configurator:
    | ((kind: EngineKind, payload: unknown) => Promise<unknown>)
    | undefined;
  private credentialRemover:
    | ((credentialRef: string) => Promise<void>)
    | undefined;

  constructor() {
    for (const kind of Object.keys(versions) as EngineKind[]) {
      this.adapters.set(
        kind,
        new UnavailableEngineAdapter(kind, versions[kind]),
      );
    }
  }

  register(kind: EngineKind, adapter: EngineAdapter): void {
    const previous = this.adapters.get(kind);
    this.adapters.set(kind, adapter);
    void previous?.stop();
  }

  adapter(kind: EngineKind): EngineAdapter {
    const adapter = this.adapters.get(kind);
    if (!adapter) throw new Error(`unknown engine ${kind}`);
    return adapter;
  }

  setConfigurator(
    configurator: (kind: EngineKind, payload: unknown) => Promise<unknown>,
  ): void {
    this.configurator = configurator;
  }

  setCredentialRemover(
    credentialRemover: (credentialRef: string) => Promise<void>,
  ): void {
    this.credentialRemover = credentialRemover;
  }

  async handle(
    message: {
      requestId: string;
      kind: EngineKind;
      method: string;
      payload: unknown;
      stream: boolean;
    },
    send: (message: unknown) => void,
  ): Promise<void> {
    const adapter = this.adapters.get(message.kind);
    if (!adapter) {
      send({
        type: message.stream ? "engine-control:end" : "engine-control:response",
        requestId: message.requestId,
        error: `unknown engine ${message.kind}`,
      });
      return;
    }
    if (!message.stream) {
      try {
        const result =
          message.method === "configure" && this.configurator
            ? await this.configurator(message.kind, message.payload)
            : message.method === "credential.remove" && this.credentialRemover
              ? await this.credentialRemover(
                  String(
                    (message.payload as { credentialRef?: unknown })
                      ?.credentialRef ?? "",
                  ),
                )
              : message.method === "health"
                ? await adapter.health()
                : message.method === "capabilities"
                  ? await adapter.capabilities()
                  : await adapter.call(message.method, message.payload);
        send({
          type: "engine-control:response",
          requestId: message.requestId,
          result,
        });
      } catch (error) {
        send({
          type: "engine-control:response",
          requestId: message.requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    const controller = new AbortController();
    this.streams.set(message.requestId, controller);
    try {
      for await (const event of adapter.stream(
        message.method,
        message.payload,
        controller.signal,
      )) {
        if (controller.signal.aborted) break;
        send({
          type: "engine-control:event",
          requestId: message.requestId,
          event,
        });
      }
      send({ type: "engine-control:end", requestId: message.requestId });
    } catch (error) {
      send({
        type: "engine-control:end",
        requestId: message.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.streams.delete(message.requestId);
    }
  }

  cancel(requestId: string): void {
    this.streams.get(requestId)?.abort();
  }

  async stop(): Promise<void> {
    for (const controller of this.streams.values()) controller.abort();
    this.streams.clear();
    await Promise.all(
      [...this.adapters.values()].map((adapter) => adapter.stop()),
    );
  }
}

export class E2eEngineAdapter implements EngineAdapter {
  constructor(private readonly kind: EngineKind) {}
  async health(): Promise<EngineHealth> {
    return { status: "healthy", version: versions[this.kind] };
  }
  async capabilities(): Promise<EngineCapabilities> {
    return {
      streaming: true,
      interrupt: true,
      resume: true,
      fork: true,
      tools: [],
    };
  }
  async call(method: string, _payload: any): Promise<unknown> {
    if (method === "createSession" || method === "fork")
      return {
        sessionId: crypto.randomUUID(),
        engineKind: this.kind,
        createdAt: new Date().toISOString(),
      } satisfies EngineSession;
    if (["interrupt", "dispose"].includes(method)) return;
    throw new Error(`unsupported e2e engine method: ${method}`);
  }
  async *stream(_method: string, payload: any): AsyncIterable<EngineEvent> {
    yield { type: "run.started", runId: payload.runId };
    yield { type: "token.delta", runId: payload.runId, delta: "E2E" };
    yield {
      type: "item.completed",
      runId: payload.runId,
      item: { text: "E2E result" },
    };
    yield {
      type: "run.completed",
      runId: payload.runId,
      usage: { input: 1, output: 1 },
    };
  }
  async stop(): Promise<void> {}
}
