import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";

export {
  defineServiceContract,
  type ServiceContract,
} from "./service-contract.js";

/** The HTTP wire protocol is deliberately independent from product releases. */
export const DRAMAIP_HTTP_API_VERSION = "2" as const;
/** Public plugin SDK compatibility is independently versioned from HTTP. */
export const DRAMAIP_PLUGIN_API_VERSION = "1" as const;
/** Kept as a source-compatible alias for the HTTP protocol constant. */
export const DRAMAIP_API_VERSION = DRAMAIP_HTTP_API_VERSION;
export const DRAMAIP_RUNTIME_VERSION = "3.0.0-alpha.3" as const;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const ProblemDetailsSchema = z.object({
  type: z.string().url(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string().optional(),
  traceId: z.string().uuid(),
  errors: z.record(z.string(), z.array(z.string())).optional(),
});

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

export const RuntimeBootstrapSchema = z.object({
  baseUrl: z.string().url(),
  accessToken: z.string().min(32),
  appVersion: z.string(),
  apiVersion: z.literal(DRAMAIP_HTTP_API_VERSION),
  runtimeId: z.string().uuid(),
  runtimeGeneration: z.number().int().positive(),
});

export type RuntimeBootstrap = z.infer<typeof RuntimeBootstrapSchema>;

export const PluginIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/u)
  .max(80);

export const PluginDependencySchema = z.object({
  id: PluginIdSchema,
  range: z.string().min(1),
});

export const PluginDescriptorSchema = z.object({
  id: PluginIdSchema,
  version: z.string(),
  kind: z.enum(["built-in", "official"]),
  apiVersion: z.literal(DRAMAIP_PLUGIN_API_VERSION),
  requires: z.array(PluginDependencySchema),
  provides: z.array(z.string().min(1)).default([]),
  critical: z.boolean().default(false),
  runtimeVersion: z.string().min(1),
  pluginApiVersion: z.literal(DRAMAIP_PLUGIN_API_VERSION),
  stability: z.enum(["internal", "experimental", "public"]),
});

export type PluginDescriptor = z.infer<typeof PluginDescriptorSchema>;

export const RuntimeKindSchema = z.enum(["electron-node", "bun"]);
export type RuntimeKind = z.infer<typeof RuntimeKindSchema>;

export const RuntimeModeSchema = z.enum(["desktop", "server", "headless"]);
export type RuntimeMode = z.infer<typeof RuntimeModeSchema>;

/** Product engine identifiers. Archived engine research never crosses a boundary. */
export const AgentEngineKindSchema = z.enum([
  "pi",
  "codex",
  "grok",
  "langgraph",
]);
export type AgentEngineKind = z.infer<typeof AgentEngineKindSchema>;

export const AgentEngineHealthSchema = z
  .object({
    available: z.boolean(),
    healthy: z.boolean().optional(),
    configured: z.boolean().optional(),
    authenticated: z.boolean().optional(),
    generation: z.number().int().nonnegative().optional(),
    statusMessage: z.string().optional(),
    unavailable: z.string().optional(),
  })
  .catchall(JsonValueSchema);
export type AgentEngineHealth = z.infer<typeof AgentEngineHealthSchema>;

export const UiContributionSchema = z.object({
  id: z.string().min(1),
  pluginId: PluginIdSchema,
  kind: z.enum([
    "route",
    "navigation",
    "slot",
    "command",
    "panel",
    "editor",
    "inspector",
    "settings",
    "toolbar",
  ]),
  metadata: JsonValueSchema,
  metadataHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
});
export type UiContributionMetadata = z.infer<typeof UiContributionSchema>;

export const RuntimeInfoSchema = z.object({
  runtimeId: z.string().uuid(),
  runtimeGeneration: z.number().int().positive(),
  graphRevision: z.string().regex(/^[a-f0-9]{64}$/u),
  startedAt: z.string().datetime(),
  runtimeVersion: z.string(),
  apiVersion: z.literal(DRAMAIP_HTTP_API_VERSION),
  pluginApiVersion: z.literal(DRAMAIP_PLUGIN_API_VERSION),
  runtimeKind: RuntimeKindSchema,
  mode: RuntimeModeSchema,
  profile: z.enum(["studio", "server", "safe", "test", "e2e"]),
  bundles: z.array(z.string()),
  plugins: z.array(
    z.object({
      id: PluginIdSchema,
      version: z.string(),
      kind: z.enum(["built-in", "official"]),
      status: z.enum(["active", "failed"]),
    }),
  ),
  capabilities: z.record(z.string(), z.boolean()),
  engineStatus: z.record(z.string(), AgentEngineHealthSchema),
  uiContributions: z.array(UiContributionSchema),
});

export type RuntimeInfo = z.infer<typeof RuntimeInfoSchema>;

export const DomainEventSchema = z.object({
  cursor: z.number().int().nonnegative(),
  eventId: z.string().uuid(),
  type: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.v\d+$/u),
  pluginId: PluginIdSchema,
  aggregateType: z.string().min(1),
  aggregateId: z.string().min(1),
  aggregateVersion: z.number().int().nonnegative(),
  payload: JsonValueSchema,
  occurredAt: z.string().datetime(),
});

export type DomainEvent = z.infer<typeof DomainEventSchema>;

export const RealtimeEventSchema = z.object({
  id: z.string().uuid(),
  type: z.string().min(1),
  payload: JsonValueSchema,
  occurredAt: z.string().datetime(),
});

export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;

export const EventStreamEnvelopeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("domain"),
    cursor: z.number().int().nonnegative(),
    event: DomainEventSchema,
  }),
  z.object({ kind: z.literal("realtime"), event: RealtimeEventSchema }),
]);
export type EventStreamEnvelope = z.infer<typeof EventStreamEnvelopeSchema>;

export const AGENT_TASK_RUNNER_SERVICE =
  defineServiceContract<AgentTaskRunnerService>({
    id: "agents.task-runner.v1",
    owner: "agents",
    major: 1,
    capabilities: ["start"],
    degradable: true,
  });
export interface AgentTaskRunnerService {
  start(input: {
    projectId: string;
    chapterId?: string;
    baseVersion?: number;
    taskType: string;
    engineKind: AgentEngineKind;
    prompt: string;
    model?: Record<string, unknown>;
    selection?: unknown;
  }): Promise<{
    taskId: string;
    sessionId: string;
    runId: string;
  }>;
}

export interface ConfiguredProvider {
  id: string;
  title: string;
  serviceType: string;
  model: string;
  credentialRef: string;
  baseUrl?: string;
  protocol?: string;
  concurrencyLimit?: number;
  estimatedUnitCost?: number;
  currency?: string;
}

export const CONFIGURED_PROVIDER_SERVICE =
  defineServiceContract<ConfiguredProviderService>({
    id: "agents.configured-providers.v1",
    owner: "agents",
    major: 1,
    capabilities: ["read"],
    degradable: true,
  });
export interface ConfiguredProviderService {
  get(id: string): ConfiguredProvider | undefined;
}
/** @deprecated Use AgentEngineKind. Kept as a short transition alias. */
export const EngineKindSchema = AgentEngineKindSchema;
/** @deprecated Use AgentEngineKind. */
export type EngineKind = AgentEngineKind;

export const AgentEngineRoleSchema = z.enum([
  "embedded-default",
  "external-benchmark",
]);
export type AgentEngineRole = z.infer<typeof AgentEngineRoleSchema>;

export const AgentEngineCapabilitiesSchema = z.object({
  prompt: z.literal(true),
  streaming: z.literal(true),
  steer: z.boolean(),
  abort: z.literal(true),
  resume: z.boolean(),
  fork: z.boolean(),
  compaction: z.boolean(),
  readOnlyTools: z.literal(true),
});
export type AgentEngineCapabilities = z.infer<
  typeof AgentEngineCapabilitiesSchema
>;

export const AgentEngineDescriptorSchema = z.object({
  kind: AgentEngineKindSchema,
  role: AgentEngineRoleSchema,
  name: z.string().min(1),
  version: z.string().min(1),
  capabilities: AgentEngineCapabilitiesSchema,
});
export type AgentEngineDescriptor = z.infer<typeof AgentEngineDescriptorSchema>;

export const CursorPageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().optional() });
