import type {
  AgentEngineCapabilities,
  AgentEngineKind,
  AgentItem,
  AgentModelSelection,
  AgentRun,
  AgentSession,
  AgentSessionInput,
  AgentTaskType,
} from "@sdns/schema";
import type { AgentTaskDefinition } from "./task-catalog";

export * from "./task-catalog";
export type {
  AgentEngineCapabilities,
  AgentEngineKind,
  AgentItem,
  AgentModelSelection,
  AgentRun,
  AgentSession,
  AgentSessionInput,
  AgentTaskType,
} from "@sdns/schema";

export interface EngineHealth {
  available: boolean;
  version: string;
  detail?: string;
}

export interface AgentContextSnapshot {
  id: string;
  projectId: string;
  chapterId?: string;
  taskType: AgentTaskType;
  promptVersion: string;
  schemaVersion: string;
  toolPolicyVersion: string;
  contentHash: string;
  payload: unknown;
  createdAt: string;
}

export interface AgentRunInput {
  runId: string;
  session: AgentSession;
  task: AgentTaskDefinition;
  snapshot: AgentContextSnapshot;
  prompt?: string;
  model?: AgentModelSelection;
  mcp?: {
    url: string;
    bearerToken: string;
  };
}

export type AgentEvent =
  | {
      type: "session.status";
      sessionId: string;
      status: AgentSession["status"];
      occurredAt: string;
    }
  | {
      type: "run.started";
      run: AgentRun;
      occurredAt: string;
    }
  | {
      type: "run.completed";
      runId: string;
      output?: unknown;
      occurredAt: string;
    }
  | {
      type: "run.failed";
      runId: string;
      code: string;
      message: string;
      occurredAt: string;
    }
  | {
      type: "run.interrupted";
      runId: string;
      occurredAt: string;
    }
  | {
      type: "item.started" | "item.delta" | "item.completed";
      item: AgentItem;
      delta?: string;
      occurredAt: string;
    }
  | {
      type: "usage.updated";
      runId: string;
      inputTokens?: number;
      outputTokens?: number;
      cachedTokens?: number;
      estimatedCost?: number;
      currency?: string;
      occurredAt: string;
    };

/** 引擎只负责会话和生成；持久化、权限、任务与正式写入全部由 Server 拥有。 */
export interface AgentEngine {
  readonly kind: AgentEngineKind;
  health(): Promise<EngineHealth>;
  capabilities(): Promise<AgentEngineCapabilities>;
  createSession(input: AgentSessionInput): Promise<AgentSession>;
  run(input: AgentRunInput): AsyncIterable<AgentEvent>;
  interrupt(runId: string): Promise<void>;
  resume(runId: string): AsyncIterable<AgentEvent>;
  fork(sessionId: string): Promise<AgentSession>;
  dispose(sessionId: string): Promise<void>;
}

export class EngineUnavailableError extends Error {
  readonly code = "ENGINE_UNAVAILABLE" as const;
  constructor(
    readonly engineKind: AgentEngineKind,
    message?: string,
  ) {
    super(message ?? `智能引擎 ${engineKind} 当前不可用`);
    this.name = "EngineUnavailableError";
  }
}

/** 显式路由，不实施自动回退。 */
export class AgentEngineRouter {
  readonly #engines = new Map<AgentEngineKind, AgentEngine>();

  register(engine: AgentEngine): void {
    this.#engines.set(engine.kind, engine);
  }

  unregister(kind: AgentEngineKind): void {
    this.#engines.delete(kind);
  }

  list(): readonly AgentEngine[] {
    return [...this.#engines.values()];
  }

  async resolve(kind: AgentEngineKind): Promise<AgentEngine> {
    const engine = this.#engines.get(kind);
    if (!engine) throw new EngineUnavailableError(kind);
    const health = await engine.health();
    if (!health.available)
      throw new EngineUnavailableError(kind, health.detail);
    return engine;
  }
}
