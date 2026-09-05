import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";

const AgentContextJsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(AgentContextJsonValueSchema),
    z.record(z.string(), AgentContextJsonValueSchema),
  ]),
);

export const AgentContextPolicyModeSchema = z.enum(["auto", "always", "never"]);
export type AgentContextPolicyMode = z.infer<
  typeof AgentContextPolicyModeSchema
>;

export const AgentContextDestinationSchema = z.object({
  kind: z.enum(["local", "cloud"]),
  provider: z.string().min(1).max(120),
  model: z.string().min(1).max(240).optional(),
});

export const AgentContextPolicySchema = z.object({
  projectId: z.string().uuid(),
  fieldPath: z.string().startsWith("/").max(500),
  mode: AgentContextPolicyModeSchema,
  version: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});

export const AgentContextPolicyInputSchema = z.object({
  policies: z
    .array(
      z.object({
        fieldPath: z.string().startsWith("/").max(500),
        mode: AgentContextPolicyModeSchema,
      }),
    )
    .max(2_000),
  version: z.number().int().nonnegative(),
});

export const AgentContextEntrySchema = z.object({
  sourceKind: z.enum([
    "intent",
    "project",
    "chapter",
    "selection",
    "story_bible",
    "writing_resource",
  ]),
  sourceId: z.string().min(1),
  sourceVersion: z.number().int().nonnegative(),
  fieldPath: z.string().startsWith("/"),
  value: AgentContextJsonValueSchema,
  mode: AgentContextPolicyModeSchema,
  included: z.boolean(),
  reason: z.string(),
  estimatedTokens: z.number().int().nonnegative(),
  sensitivity: z.enum(["project", "personal", "public"]),
});

export const AgentContextPreviewInputSchema = z.object({
  projectId: z.string().uuid().optional(),
  chapterId: z.string().uuid().optional(),
  runIntent: z.string().trim().min(1).max(2_000),
  basePrompt: z.string().min(1).max(200_000),
  selection: AgentContextJsonValueSchema.optional(),
  tokenBudget: z.number().int().min(128).max(1_000_000),
  destination: AgentContextDestinationSchema,
  temporaryOverrides: z
    .array(
      z.object({
        fieldPath: z.string().startsWith("/").max(500),
        mode: AgentContextPolicyModeSchema,
      }),
    )
    .max(2_000)
    .default([]),
});

export const AgentContextPreviewPatchSchema = z.object({
  temporaryOverrides: AgentContextPreviewInputSchema.shape.temporaryOverrides,
});

export const AgentContextPreviewSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  entries: z.array(AgentContextEntrySchema),
  tokenBudget: z.number().int().positive(),
  estimatedTokens: z.number().int().nonnegative(),
  destination: AgentContextDestinationSchema,
  finalPromptPreview: z.string(),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  version: z.number().int().nonnegative(),
  status: z.enum(["pending", "frozen", "expired"]),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const AgentContextSnapshotSchema = z.object({
  id: z.string().uuid(),
  previewId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  entries: z.array(AgentContextEntrySchema),
  tokenBudget: z.number().int().positive(),
  estimatedTokens: z.number().int().nonnegative(),
  destination: AgentContextDestinationSchema,
  finalPrompt: z.string(),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  finalPromptSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  createdAt: z.string().datetime(),
});

export type AgentContextPolicy = z.infer<typeof AgentContextPolicySchema>;
export type AgentContextEntry = z.infer<typeof AgentContextEntrySchema>;
export type AgentContextPreviewInput = z.infer<
  typeof AgentContextPreviewInputSchema
>;
export type AgentContextPreview = z.infer<typeof AgentContextPreviewSchema>;
export type AgentContextSnapshot = z.infer<typeof AgentContextSnapshotSchema>;

export const AGENT_CONTEXT_SERVICE = defineServiceContract<AgentContextService>(
  {
    id: "agents.context.v1",
    owner: "agents",
    major: 1,
    capabilities: ["preview", "freeze", "read"],
    degradable: true,
  },
);

export interface AgentContextService {
  createPreview(input: AgentContextPreviewInput): AgentContextPreview;
  updatePreview(
    id: string,
    expectedVersion: number,
    temporaryOverrides: readonly {
      fieldPath: string;
      mode: AgentContextPolicyMode;
    }[],
  ): AgentContextPreview | "conflict" | undefined;
  freeze(id: string, expectedVersion: number): AgentContextSnapshot | undefined;
  getSnapshot(id: string): AgentContextSnapshot | undefined;
  bindRun(snapshotId: string, runId: string): void;
}
