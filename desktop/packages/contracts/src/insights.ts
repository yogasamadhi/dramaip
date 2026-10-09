import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";
export * from "./creative-outcomes.js";
export * from "./creative-delivery-coverage.js";
export * from "./creative-delivery-window.js";
export * from "./creative-quality-associations.js";
export * from "./creative-goals.js";
export * from "./creative-sources.js";
export * from "./creative-funnel.js";
export * from "./creative-planning.js";
export * from "./creative-continuation.js";
export * from "./creative-executions.js";
export * from "./creative-execution-statistics.js";
export * from "./creative-funnel-measurement.js";
export * from "./creative-configuration-funnel.js";
export * from "./novel-revision-effort.js";
export * from "./novel-revision-configuration.js";
export * from "./creation-source-conflict.js";

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

const GenerationCostAmountSchema = z.discriminatedUnion("status", [
  z
    .object({ status: z.literal("reported"), value: z.number().nonnegative() })
    .strict(),
  z.object({ status: z.literal("unreported") }).strict(),
  z.object({ status: z.literal("invalid") }).strict(),
]);
const GenerationCostUnitSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("reported"),
      value: z.string().trim().min(1).max(80),
    })
    .strict(),
  z.object({ status: z.literal("unreported") }).strict(),
  z.object({ status: z.literal("invalid") }).strict(),
]);
export const GenerationCostObservationSchema = z
  .object({
    source: z.enum([
      "configured-unit-estimate",
      "human-declared",
      "legacy-unverified",
      "unspecified",
    ]),
    measurementScope: z.enum(["configured-unit", "unspecified"]),
    billingStatus: z.literal("unknown"),
    amount: GenerationCostAmountSchema,
    unit: GenerationCostUnitSchema,
    // Local capture time, never the time of a purchase or provider settlement.
    recordedAt: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.source === "configured-unit-estimate") !==
        (value.measurementScope === "configured-unit") ||
      (value.source !== "legacy-unverified" && !value.recordedAt)
    )
      ctx.addIssue({
        code: "custom",
        message: "Cost scope and local observation source must agree.",
      });
  });
export type GenerationCostObservation = z.infer<
  typeof GenerationCostObservationSchema
>;
export const GenerationCostObservationPageSchema = z
  .object({
    recordId: z.string().uuid(),
    projectId: z.string().uuid(),
    billingStatus: z.literal("unknown"),
    observationCount: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    items: z
      .array(
        z
          .object({
            sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
            observation: GenerationCostObservationSchema,
          })
          .strict(),
      )
      .max(100),
    legacyObservation: GenerationCostObservationSchema.optional(),
    nextCursor: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  })
  .strict();
export type GenerationCostObservationPage = z.infer<
  typeof GenerationCostObservationPageSchema
>;

export const GenerationRecordSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  kind: z.string(),
  title: z.string(),
  status: z.string(),
  summary: z.string(),
  actualCost: z
    .number()
    .nonnegative()
    .optional()
    .describe(
      "Deprecated legacy amount, never certified settlement. Current Runtime omits this field.",
    ),
  currency: z
    .string()
    .describe(
      "Legacy unit field; no billing authority or default currency claim.",
    ),
  costObservation: GenerationCostObservationSchema.optional(),
  costObservationCount: z.number().int().nonnegative().optional(),
  costNote: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const GenerationRecordPatchSchema = z.object({
  actualCost: z
    .number()
    .nonnegative()
    .optional()
    .describe(
      "Compatibility input for an explicitly submitted, unverified human amount declaration.",
    ),
  currency: z.string().trim().min(1).max(12).optional(),
  costNote: z.string().max(2_000).optional(),
});

export type GenerationRecord = z.infer<typeof GenerationRecordSchema>;

export const INSIGHTS_GENERATION_SERVICE =
  defineServiceContract<InsightsGenerationService>({
    id: "insights.generation-ledger.v1",
    owner: "insights",
    major: 1,
    capabilities: ["record"],
    degradable: true,
  });
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
    configuredUnitEstimate?: { amount: number; unit?: string };
  }): GenerationRecord;
}
