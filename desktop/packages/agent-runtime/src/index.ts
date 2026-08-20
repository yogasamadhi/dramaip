import type {
  AgentEngineCapabilities,
  AgentEngineDescriptor,
  AgentEngineKind,
  JsonValue,
} from "@dramaip/contracts";

export type AgentRuntimeErrorCode =
  | "ENGINE_UNAVAILABLE"
  | "ENGINE_AUTH_REQUIRED"
  | "CAPABILITY_UNAVAILABLE"
  | "UNSUPPORTED_OPERATION"
  | "RUN_INTERRUPTED"
  | "CONTEXT_INVALID"
  | "TOOL_FORBIDDEN"
  | "PROVIDER_REJECTED";

export class AgentRuntimeError extends Error {
  readonly name = "AgentRuntimeError";

  constructor(
    readonly code: AgentRuntimeErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  estimatedCost?: number;
  currency?: string;
}

export type AgentRuntimeEvent =
  | { cursor: number; type: "content.delta"; delta: string }
  | {
      cursor: number;
      type: "tool";
      status: "started" | "completed" | "failed";
      tool: string;
      itemId?: string;
      detail?: JsonValue;
    }
  | { cursor: number; type: "usage"; usage: AgentUsage }
  | { cursor: number; type: "result"; result: JsonValue }
  | {
      cursor: number;
      type: "status";
      status: "running" | "completed" | "failed" | "aborted";
    }
  | {
      cursor: number;
      type: "error";
      code: AgentRuntimeErrorCode;
      message: string;
      retryable: boolean;
    };

export interface AgentSessionInput {
  sessionId: string;
  title: string;
  projectId?: string;
  chapterId?: string;
  model?: { providerId?: string; modelId?: string; profileId?: string };
  /** Opaque, run-scoped capability broker endpoint and token. */
  capabilityGrant?: { endpoint: string; token: string; expiresAt: string };
}

export interface AgentRunInput {
  runId: string;
  prompt: string;
  capabilityGrant?: { endpoint: string; token: string; expiresAt: string };
}

export interface AgentSessionRef {
  sessionId: string;
  engineSessionId: string;
}

export interface AgentRunRef {
  runId: string;
  engineRunId?: string;
}

/**
 * Vendor-neutral engine contract.  It is intentionally free of Electron,
 * SQLite, Hono and vendor SDK types, so the Core Runtime can be tested alone.
 */
export interface AgentRuntime {
  readonly descriptor: AgentEngineDescriptor;
  availability(): Promise<{
    available: boolean;
    authenticated: boolean;
    configured: boolean;
    detail?: string;
  }>;
  createSession(input: AgentSessionInput): Promise<AgentSessionRef>;
  prompt(session: AgentSessionRef, input: AgentRunInput): Promise<AgentRunRef>;
  steer(run: AgentRunRef, prompt: string): Promise<void>;
  abort(run: AgentRunRef): Promise<void>;
  resume(session: AgentSessionRef): Promise<AgentSessionRef>;
  fork(
    session: AgentSessionRef,
    input: { sessionId: string },
  ): Promise<AgentSessionRef>;
  subscribe(
    run: AgentRunRef,
    options?: { cursor?: number; signal?: AbortSignal },
  ): AsyncIterable<AgentRuntimeEvent>;
  dispose(session: AgentSessionRef): Promise<void>;
}

export interface AgentRuntimeRegistry {
  get(kind: AgentEngineKind): AgentRuntime | undefined;
  all(): readonly AgentRuntime[];
}

export function createAgentRuntimeRegistry(
  runtimes: readonly AgentRuntime[],
): AgentRuntimeRegistry {
  const byKind = new Map<AgentEngineKind, AgentRuntime>();
  for (const runtime of runtimes) {
    if (byKind.has(runtime.descriptor.kind))
      throw new Error(`Duplicate agent runtime: ${runtime.descriptor.kind}`);
    byKind.set(runtime.descriptor.kind, runtime);
  }
  return {
    get: (kind) => byKind.get(kind),
    all: () => [...byKind.values()],
  };
}

export function unsupportedOperation(
  capabilities: AgentEngineCapabilities,
  capability: keyof AgentEngineCapabilities,
): never {
  if (capabilities[capability] !== true)
    throw new AgentRuntimeError(
      "UNSUPPORTED_OPERATION",
      `This engine does not support ${capability}`,
    );
  throw new AgentRuntimeError("UNSUPPORTED_OPERATION", "Unsupported operation");
}
