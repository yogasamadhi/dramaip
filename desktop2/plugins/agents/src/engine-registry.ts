import { Service, type Context } from "@deepseek-ai/cordis";

import type {
  AgentEngineProvider,
  EngineCapabilities,
  EngineEvent,
  EngineHealth,
  EngineSession,
  RunInput,
  SessionInput,
} from "@dramaip/contracts";

export type EngineKind = AgentEngineProvider["kind"];
export type EngineTokenMap = Readonly<Record<EngineKind, string>>;

export interface EngineControlBridge {
  call<T>(kind: EngineKind, method: string, payload: unknown): Promise<T>;
  stream(
    kind: EngineKind,
    method: string,
    payload: unknown,
  ): AsyncIterable<EngineEvent>;
}

export interface AgentEngineRegistry {
  register(provider: AgentEngineProvider): () => Promise<void>;
  get(kind: EngineKind): AgentEngineProvider;
  list(): readonly AgentEngineProvider[];
}

export class AgentEngineRegistryService
  extends Service
  implements AgentEngineRegistry
{
  static provide = "engineRegistry";
  private readonly providers = new Map<EngineKind, AgentEngineProvider>();

  constructor(ctx: Context) {
    super(ctx, "engineRegistry");
  }

  register(provider: AgentEngineProvider): () => Promise<void> {
    if (this.providers.has(provider.kind))
      throw new Error(`duplicate engine provider: ${provider.kind}`);
    this.providers.set(provider.kind, provider);
    let disposed = false;
    const dispose = async () => {
      if (disposed) return;
      disposed = true;
      this.providers.delete(provider.kind);
    };
    this.ctx.effect(() => dispose, `engine-provider:${provider.kind}`);
    return dispose;
  }

  get(kind: EngineKind): AgentEngineProvider {
    const provider = this.providers.get(kind);
    if (!provider) throw new Error(`engine provider is unavailable: ${kind}`);
    return provider;
  }

  list(): readonly AgentEngineProvider[] {
    return [...this.providers.values()].sort((left, right) =>
      left.kind.localeCompare(right.kind),
    );
  }
}

export class BridgeEngineProvider implements AgentEngineProvider {
  constructor(
    readonly kind: EngineKind,
    private readonly bridge: EngineControlBridge,
    private readonly lockedVersion: string,
  ) {}

  async health(): Promise<EngineHealth> {
    const health = await this.bridge.call<EngineHealth>(
      this.kind,
      "health",
      {},
    );
    return { ...health, version: this.lockedVersion };
  }

  capabilities(): Promise<EngineCapabilities> {
    return this.bridge.call(this.kind, "capabilities", {});
  }

  createSession(input: SessionInput): Promise<EngineSession> {
    return this.bridge.call(this.kind, "createSession", input);
  }

  run(input: RunInput): AsyncIterable<EngineEvent> {
    return this.bridge.stream(this.kind, "run", input);
  }

  interrupt(runId: string): Promise<void> {
    return this.bridge.call(this.kind, "interrupt", { runId });
  }

  resume(runId: string): AsyncIterable<EngineEvent> {
    return this.bridge.stream(this.kind, "resume", { runId });
  }

  fork(sessionId: string): Promise<EngineSession> {
    return this.bridge.call(this.kind, "fork", { sessionId });
  }

  dispose(sessionId: string): Promise<void> {
    return this.bridge.call(this.kind, "dispose", { sessionId });
  }
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    engineRegistry: AgentEngineRegistry;
  }
}
