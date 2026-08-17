import { z } from "zod";

export const pluginIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, "plugin id must be a lowercase builtin id");

export interface DramaPluginDescriptor {
  id: string;
  version: string;
  runtime: "server" | "renderer" | "both";
  requires: readonly string[];
  provides: readonly string[];
  critical: boolean;
}

export interface DomainEvent<T = unknown> {
  cursor: number;
  eventId: string;
  type: `${string}.${string}.v${number}`;
  pluginId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  payload: T;
  occurredAt: string;
}

export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string(),
  instance: z.string(),
  code: z.string(),
  requestId: z.string(),
  errors: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export const taskStateSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
  "interrupted",
]);

export type TaskState = z.infer<typeof taskStateSchema>;

export const taskRefSchema = z.object({
  taskId: z.string(),
  state: taskStateSchema,
  href: z.string(),
});

export type TaskRef = z.infer<typeof taskRefSchema>;

export interface EngineHealth {
  status: "healthy" | "degraded" | "unavailable";
  version: string;
  detail?: string;
}

export interface EngineCapabilities {
  streaming: boolean;
  interrupt: boolean;
  resume: boolean;
  fork: boolean;
  tools: readonly string[];
}

export interface SessionInput {
  /** Project scope is optional for global assistant conversations. */
  projectId?: string;
  title?: string;
  model?: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface EngineSession {
  sessionId: string;
  engineKind: AgentEngineProvider["kind"];
  createdAt: string;
}

export interface RunInput {
  runId: string;
  sessionId: string;
  prompt: string;
  checkpointId?: string;
}

export type EngineEvent =
  | { type: "run.started"; runId: string }
  | { type: "token.delta"; runId: string; delta: string }
  | { type: "item.completed"; runId: string; item: unknown }
  | {
      type: "run.completed";
      runId: string;
      usage?: { input: number; output: number };
    }
  | { type: "run.failed"; runId: string; code: string; message: string };

export interface AgentEngineProvider {
  kind: "opencode" | "codex" | "dsh" | "pi" | "langgraph";
  health(): Promise<EngineHealth>;
  capabilities(): Promise<EngineCapabilities>;
  createSession(input: SessionInput): Promise<EngineSession>;
  run(input: RunInput): AsyncIterable<EngineEvent>;
  interrupt(runId: string): Promise<void>;
  resume(runId: string): AsyncIterable<EngineEvent>;
  fork(sessionId: string): Promise<EngineSession>;
  dispose(sessionId: string): Promise<void>;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export const pageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function etag(version: number): `"v${number}"` {
  return `"v${version}"`;
}
