import { z } from "@hono/zod-openapi";

import { taskRefSchema, taskStateSchema } from "@dramaip/contracts";

export const engineKindSchema = z.enum([
  "opencode",
  "codex",
  "dsh",
  "pi",
  "langgraph",
]);

export const providerSchema = z.object({
  kind: engineKindSchema,
  version: z.string(),
  status: z.enum(["healthy", "degraded", "unavailable"]),
  capabilities: z.object({
    streaming: z.boolean(),
    interrupt: z.boolean(),
    resume: z.boolean(),
    fork: z.boolean(),
    tools: z.array(z.string()),
  }),
  configured: z.boolean(),
});

export const providerPageSchema = z.object({ items: z.array(providerSchema) });

export const providerConfigurationInputSchema = z.object({
  providerKind: z.enum(["openai", "anthropic", "google"]),
  providerAdapter: z.enum([
    "openai",
    "openai-compatible",
    "anthropic",
    "google",
  ]),
  model: z.string().trim().min(1).max(300),
  baseUrl: z.url().max(2_000).optional(),
  protocol: z.enum(["responses", "chat_completions"]).optional(),
  credentialRef: z.uuid(),
});

export const providerConfigurationSchema = z.object({
  kind: engineKindSchema,
  providerKind: z.enum(["openai", "anthropic", "google"]),
  providerAdapter: z.enum([
    "openai",
    "openai-compatible",
    "anthropic",
    "google",
  ]),
  model: z.string(),
  baseUrl: z.string().nullable(),
  protocol: z.enum(["responses", "chat_completions"]).nullable(),
  configured: z.boolean(),
  version: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
});

export const agentSessionSchema = z.object({
  id: z.uuid(),
  engineSessionId: z.string(),
  projectId: z.uuid().nullable(),
  engineKind: engineKindSchema,
  title: z.string(),
  state: z.enum(["active", "disposed"]),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const createAgentSessionSchema = z.object({
  projectId: z.uuid(),
  engineKind: engineKindSchema.default("opencode"),
  title: z.string().trim().min(1).max(300),
  model: z.string().optional(),
});

export const forkAgentSessionSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
});

export const agentRunSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  engineRunId: z.string(),
  state: taskStateSchema,
  prompt: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costMicros: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const createRunSchema = z.object({
  prompt: z.string().min(1).max(1_000_000),
  checkpointId: z.string().optional(),
});

export const agentItemSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  sequence: z.number().int().nonnegative(),
  type: z.string(),
  payload: z.unknown(),
  createdAt: z.iso.datetime(),
});

export const agentCheckpointSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  engineCheckpointId: z.string(),
  payload: z.unknown(),
  createdAt: z.iso.datetime(),
});

export const mcpClaimSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  sessionId: z.uuid(),
  runId: z.uuid().nullable(),
  readOnly: z.literal(true),
  maxResults: z.number().int().min(1).max(200),
  expiresAt: z.iso.datetime(),
});

export const assistantConversationSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid().nullable(),
  sessionId: z.uuid().nullable(),
  title: z.string(),
  engineKind: engineKindSchema,
  model: z.string().nullable(),
  status: z.enum(["active", "archived"]),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const assistantTurnSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  runId: z.uuid().nullable(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  taskType: z.string().nullable(),
  contextSnapshotId: z.uuid().nullable(),
  changePreviewId: z.uuid().nullable(),
  intentConfidence: z.number().min(0).max(1).nullable(),
  createdAt: z.iso.datetime(),
});

export const createAssistantConversationSchema = z
  .object({
    projectId: z.uuid().nullable().optional(),
    title: z.string().trim().min(1).max(300).default("新对话"),
    engineKind: engineKindSchema.default("opencode"),
    model: z.string().trim().max(300).nullable().optional(),
  })
  .strict();

export const updateAssistantConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    engineKind: engineKindSchema.optional(),
    model: z.string().trim().max(300).nullable().optional(),
  })
  .strict();

export const assistantMessageInputSchema = z
  .object({
    content: z.string().trim().min(1).max(1_000_000),
    taskType: z.string().trim().max(100).optional(),
    chapterId: z.uuid().optional(),
    selection: z.string().max(1_000_000).optional(),
    pinned: z.array(z.string().max(500)).max(1_000).optional(),
    excluded: z.array(z.string().max(500)).max(1_000).optional(),
    tokenBudget: z.number().int().min(1_000).max(200_000).optional(),
  })
  .strict();

export const assistantMessageResultSchema = z.object({
  userTurn: assistantTurnSchema,
  assistantTurn: assistantTurnSchema,
  clarification: z.boolean(),
  run: taskRefSchema.optional(),
});

export const continueChapterSchema = z
  .object({
    conversationId: z.uuid(),
    chapterId: z.uuid(),
    instruction: z
      .string()
      .trim()
      .min(1)
      .max(1_000_000)
      .default("请续写当前章节，保持既有风格与人物一致性。"),
    selection: z.string().max(1_000_000).optional(),
  })
  .strict();

export const taskDefinitionSchema = z.object({
  id: z.string(),
  label: z.string(),
  category: z.enum(["chat", "chapter", "knowledge", "quality"]),
  write: z.boolean(),
  requiresProject: z.boolean(),
  requiresChapter: z.boolean(),
  simple: z.boolean(),
});

export const agentTaskSettingsSchema = z.object({
  scope: z.enum(["global", "project"]),
  projectId: z.uuid().nullable(),
  engineKind: engineKindSchema,
  model: z.string().nullable(),
  advancedMode: z.boolean(),
  version: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
});

export const updateAgentTaskSettingsSchema = z
  .object({
    engineKind: engineKindSchema.optional(),
    model: z.string().trim().max(300).nullable().optional(),
    advancedMode: z.boolean().optional(),
  })
  .strict();

export const experimentCandidateSchema = z.object({
  id: z.uuid(),
  ordinal: z.number().int().nonnegative(),
  runId: z.uuid().nullable(),
  state: taskStateSchema,
  output: z.string(),
  engineKind: engineKindSchema.nullable(),
});

export const agentExperimentSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  prompt: z.string(),
  taskType: z.string(),
  status: z.enum(["running", "ready", "reviewed", "failed"]),
  revealed: z.boolean(),
  selectedCandidateId: z.uuid().nullable(),
  candidates: z.array(experimentCandidateSchema),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const createAgentExperimentSchema = z
  .object({
    projectId: z.uuid(),
    chapterId: z.uuid().optional(),
    taskType: z.string().trim().min(1).max(100),
    prompt: z.string().trim().min(1).max(1_000_000),
    engines: z.array(engineKindSchema).min(2).max(5),
  })
  .strict();

export const reviewAgentExperimentSchema = z
  .object({
    selectedCandidateId: z.uuid(),
    scores: z.record(z.uuid(), z.number().min(0).max(10)).optional(),
    notes: z.string().max(20_000).default(""),
  })
  .strict();
