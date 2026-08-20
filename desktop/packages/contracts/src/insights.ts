import { z } from "zod";

export const FeedbackKindSchema = z.enum(["metrics", "comments"]);
export const FeedbackPreviewInputSchema = z.object({
  projectId: z.string().uuid(),
  kind: FeedbackKindSchema,
  capabilityToken: z.string().min(1),
});
export const FeedbackPreviewSchema = z.object({
  importId: z.string().uuid(),
  projectId: z.string().uuid(),
  kind: FeedbackKindSchema,
  sourceName: z.string(),
  validCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
  sample: z.array(z.unknown()),
  expiresAt: z.string().datetime(),
});
export const FeedbackCommitInputSchema = z.object({
  projectId: z.string().uuid(),
});
export const FeedbackBatchSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  kind: FeedbackKindSchema,
  sourceName: z.string(),
  rowCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export const FeedbackMetricSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().uuid(),
  name: z.string(),
  value: z.number(),
  occurredAt: z.string().datetime().optional(),
  dimensions: z.unknown(),
  createdAt: z.string().datetime(),
});
export const FeedbackCommentSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().uuid(),
  content: z.string(),
  author: z.string().optional(),
  occurredAt: z.string().datetime().optional(),
  category: z.string(),
  createdAt: z.string().datetime(),
});
export const FeedbackClusterSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  batchId: z.string().uuid(),
  title: z.string(),
  summary: z.string(),
  commentCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export const FeedbackDashboardSchema = z.object({
  batches: z.array(FeedbackBatchSchema),
  metrics: z.array(FeedbackMetricSchema),
  comments: z.array(FeedbackCommentSchema),
  clusters: z.array(FeedbackClusterSchema),
});
export const FeedbackClusterInputSchema = z.object({
  projectId: z.string().uuid(),
  batchId: z.string().uuid(),
});

export const GenerationRecordSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  kind: z.string(),
  title: z.string(),
  status: z.string(),
  summary: z.string(),
  actualCost: z.number().nonnegative().optional(),
  currency: z.string(),
  costNote: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const GenerationRecordPatchSchema = z.object({
  actualCost: z.number().nonnegative().optional(),
  currency: z.string().min(1).max(12).optional(),
  costNote: z.string().max(2_000).optional(),
});

export type GenerationRecord = z.infer<typeof GenerationRecordSchema>;

export const INSIGHTS_GENERATION_SERVICE =
  "insights.generation-ledger.v1" as const;
export interface InsightsGenerationService {
  record(input: {
    projectId: string;
    taskId?: string;
    kind: string;
    title: string;
    status: string;
    summary: string;
    actualCost?: number;
    currency?: string;
  }): GenerationRecord;
}
