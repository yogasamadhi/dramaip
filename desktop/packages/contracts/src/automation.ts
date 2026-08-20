import { z } from "zod";
import { AgentEngineKindSchema } from "./index.js";

export const TaskStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
  "interrupted",
]);

export const TaskSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  status: TaskStatusSchema,
  title: z.string(),
  progress: z.number().nonnegative(),
  projectId: z.string().uuid().optional(),
  parentTaskId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  assistantTurnId: z.string().uuid().optional(),
  stage: z.string().optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const TaskInputSchema = z.object({
  kind: z.string().min(1).max(160),
  title: z.string().min(1).max(160),
  projectId: z.string().uuid().optional(),
  payload: z.unknown().optional(),
});

export const TaskRetryInputSchema = z.object({
  engineKind: AgentEngineKindSchema,
});

export const RevisionPreviewSchema = z.object({
  id: z.string().uuid(),
  chapterId: z.string().uuid(),
  baseVersion: z.number().int().nonnegative(),
  proposedContent: z.string(),
  rationale: z.string(),
  status: z.enum(["pending", "committed", "discarded", "conflicted"]),
  createdAt: z.string().datetime(),
  committedAt: z.string().datetime().optional(),
});

export const RevisionInputSchema = z.object({
  chapterId: z.string().uuid(),
  proposedContent: z.string().min(1),
  rationale: z.string().optional(),
});

export type Task = z.infer<typeof TaskSchema>;
export type TaskInput = z.infer<typeof TaskInputSchema>;
export type RevisionPreview = z.infer<typeof RevisionPreviewSchema>;

export const AUTOMATION_TASK_SERVICE = "automation.tasks.v1" as const;
export interface AutomationTaskService {
  start(input: {
    kind: string;
    title: string;
    projectId?: string;
    result?: unknown;
  }): Task;
  update(
    id: string,
    patch: {
      status?: z.infer<typeof TaskStatusSchema>;
      progress?: number;
      result?: unknown;
      error?: string;
    },
  ): Task | undefined;
  complete(input: {
    kind: string;
    title: string;
    projectId?: string;
    result?: unknown;
  }): Task;
  fail(input: {
    kind: string;
    title: string;
    projectId?: string;
    error: string;
  }): Task;
}

export const ChangeTargetKindSchema = z.enum([
  "project",
  "chapter",
  "character",
  "outline",
  "story_bible",
  "episode",
  "script",
  "scene",
  "shot",
]);
export const ChangePreviewTargetSchema = z.object({
  kind: ChangeTargetKindSchema,
  id: z.string().uuid(),
  baseVersion: z.number().int().nonnegative(),
  patch: z.record(z.string(), z.unknown()),
  displayDiff: z.unknown().optional(),
});
export const ChangePreviewSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
  runId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  engineKind: AgentEngineKindSchema.optional(),
  taskType: z.string().optional(),
  targets: z.array(ChangePreviewTargetSchema).min(1),
  rationale: z.string(),
  status: z.enum(["pending", "committed", "discarded", "conflicted"]),
  contentHash: z.string(),
  createdAt: z.string().datetime(),
  committedAt: z.string().datetime().optional(),
});
export const ChangePreviewContentInputSchema = z.object({
  content: z.string().min(1),
});
export type ChangePreview = z.infer<typeof ChangePreviewSchema>;

export const ProviderActionKindSchema = z.enum([
  "image",
  "audio",
  "video",
  "remote_render",
]);
export const ProviderActionPreviewSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
  runId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  kind: ProviderActionKindSchema,
  providerId: z.string().uuid(),
  modelId: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()),
  estimatedCost: z.number().nonnegative().optional(),
  currency: z.string().optional(),
  status: z.enum(["pending", "executed", "discarded", "expired"]),
  createdAt: z.string().datetime(),
  executedAt: z.string().datetime().optional(),
});
export type ProviderActionPreview = z.infer<typeof ProviderActionPreviewSchema>;

export const TemplateRunInputSchema = z.object({
  projectId: z.string().uuid().optional(),
  variables: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
});
export const TemplateRunResultSchema = z.object({
  runId: z.string().uuid(),
  rendered: z.string(),
  variables: z.array(z.string()),
  missing: z.array(z.string()),
  createdAt: z.string().datetime(),
});

export const EpisodeWorkflowKindSchema = z.enum([
  "quality-check",
  "compliance-check",
  "delivery-preflight",
  "render-preflight",
  "animatic-draft",
  "minimal-redo-plan",
  "review-package",
]);
export const EpisodeWorkflowInputSchema = z.object({
  projectId: z.string().uuid(),
  episodeId: z.string().uuid(),
  kind: EpisodeWorkflowKindSchema,
});
export const EpisodeWorkflowResultSchema = z.object({
  task: TaskSchema,
  recordId: z.string().uuid().optional(),
  recordOwner: z.string().optional(),
  summary: z.string(),
});

export const AUTOMATION_PREVIEW_SERVICE = "automation.previews.v1" as const;
export interface AutomationPreviewService {
  createChange(input: {
    projectId: string;
    sessionId?: string;
    runId?: string;
    taskId?: string;
    engineKind?: z.infer<typeof AgentEngineKindSchema>;
    taskType?: string;
    targets: z.infer<typeof ChangePreviewTargetSchema>[];
    rationale: string;
  }): ChangePreview;
  createProviderAction(input: {
    projectId: string;
    sessionId?: string;
    runId?: string;
    taskId?: string;
    kind: z.infer<typeof ProviderActionKindSchema>;
    providerId: string;
    modelId?: string;
    parameters: Record<string, unknown>;
    estimatedCost?: number;
    currency?: string;
  }): ProviderActionPreview;
}

export const PROVIDER_ACTION_EXECUTOR_SERVICE =
  "media.provider-action-executor.v1" as const;
export interface ProviderActionExecutorService {
  execute(input: ProviderActionPreview): { taskId: string };
}

export const PilotPlanSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  chapterIds: z.array(z.string().uuid()),
  episodeCount: z.number().int().min(1).max(3),
  status: z.enum(["draft", "active", "stale", "ready-for-review", "canceled"]),
  stage: z.enum([
    "confirm-source",
    "script",
    "scenes",
    "shots",
    "assets",
    "review",
  ]),
  sourceConfirmed: z.boolean(),
  adaptationId: z.string().uuid().optional(),
  episodeIds: z.array(z.string().uuid()),
  coverage: z.object({
    episodes: z.number().int().nonnegative(),
    scripts: z.number().int().nonnegative(),
    scenes: z.number().int().nonnegative(),
    shots: z.number().int().nonnegative(),
    assets: z.number().int().nonnegative(),
  }),
  blocker: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const PilotPlanCreateInputSchema = z.object({
  projectId: z.string().uuid(),
  chapterIds: z.array(z.string().uuid()).min(1).max(3),
  episodeCount: z.number().int().min(1).max(3),
});

export const PilotPlanActionInputSchema = z.object({
  action: z.enum(["confirm-source", "return-source", "cancel", "resume"]),
});

export type PilotPlan = z.infer<typeof PilotPlanSchema>;
