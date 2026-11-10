import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";
import type { CreationAdapter, CreationWorkflow } from "./creation.js";
import { NarrativeReviewedSourceSchema } from "./narrative-context.js";
import { AdaptationStrategyReferenceSchema } from "./adaptation-strategy.js";
import {
  DiagnosisBasisSchema,
  DiagnosisRequestSchema,
} from "./adaptation-diagnosis.js";

const text = z.string().trim().min(1).max(4000);
const reference = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
});
const chapter = z.object({
  id: z.string().uuid(),
  version: z.number().int().nonnegative(),
});
const episodeId = z.string().trim().min(1).max(64);

// The adaptation path inherits an explicitly adopted diagnosis and its one
// chosen strategy. This is not the legacy Season directory or an episode tree.
// Original/story-script entry paths remain independent; this new path must not
// synthesize a diagnosis, novel or adopted plan for them.
export const SeasonPlanRequestSchema = z.object({
  diagnosis: reference.extend({ strategyId: episodeId }),
  strategy: AdaptationStrategyReferenceSchema.optional(),
  baseAdoptedId: z.string().uuid().optional(),
});
export const SeasonPlanBasisSchema = DiagnosisBasisSchema.omit({
  baseAdoptedId: true,
}).extend({
  diagnosis: SeasonPlanRequestSchema.shape.diagnosis,
  diagnosisContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  strategy: AdaptationStrategyReferenceSchema.optional(),
  strategyContentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  authorIntent: DiagnosisRequestSchema.shape.authorIntent,
  baseAdoptedId: z.string().uuid().optional(),
});
export const SeasonPlanEpisodeSchema = z.object({
  id: episodeId,
  orderIndex: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(240),
  logline: text,
  goal: text,
  mainConflict: text,
  turningPoint: text,
  endingHook: text,
  sourceChapters: z
    .array(
      chapter.extend({
        adaptationAction: z.enum([
          "preserve",
          "merge",
          "reorder",
          "restructure",
        ]),
        rationale: text,
      }),
    )
    .min(1)
    .max(1000),
  characterProgress: z
    .array(
      z.object({
        character: text,
        before: text,
        after: text,
        relationshipChange: text,
      }),
    )
    .min(1)
    .max(100),
  plantedForeshadowing: z.array(text).max(100),
  paidOffForeshadowing: z.array(text).max(100),
  estimatedScenes: z.number().int().min(1).max(120),
  estimatedCharacters: z.number().int().min(1).max(100),
  durationSeconds: z.number().int().min(30).max(1800),
  productionRisk: z.enum(["low", "medium", "high", "unknown"]),
  productionNotes: text,
});
export const SeasonPlanContentSchema = z.object({
  reviewedSources: z
    .array(NarrativeReviewedSourceSchema)
    .min(1)
    .max(2000)
    .optional(),
  theme: text,
  mainConflict: text,
  emotionalPromise: text,
  episodes: z.array(SeasonPlanEpisodeSchema).min(1).max(120),
  omittedSources: z.array(chapter.extend({ reason: text })).max(1000),
  risks: z.array(text).max(100),
});
export const SeasonPlanCoverageSchema = z.object({
  chapterId: z.string().uuid(),
  chapterVersion: z.number().int().nonnegative(),
  episodeIds: z.array(episodeId),
  disposition: z.enum(["used", "omitted", "unaccounted"]),
  omissionReason: text.optional(),
});
export const SeasonPlanOrderInputSchema = z.object({
  episodeIds: z.array(episodeId).min(1).max(120),
});
export const SeasonPlanSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  workflowId: z.string().uuid(),
  version: z.number().int().positive(),
  stateVersion: z.number().int().nonnegative(),
  status: z.enum(["pending", "adopted", "discarded", "conflicted"]),
  // An order edit must create a new immutable content version, not silently
  // mutate the model candidate or change stable episode identifiers.
  sourcePlanId: z.string().uuid().optional(),
  origin: z.enum(["model", "human-reorder"]),
  content: SeasonPlanContentSchema,
  basis: SeasonPlanBasisSchema,
  coverage: z.array(SeasonPlanCoverageSchema),
  sourceSnapshotId: z.string().uuid(),
  runIds: z.array(z.string().uuid()),
  model: z.record(z.string(), z.unknown()).optional(),
  isCurrent: z.boolean(),
  sourceState: z.enum(["current", "stale"]),
  staleReasons: z.array(z.string()),
  adoptedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const SeasonPlanPageSchema = z.object({
  items: z.array(SeasonPlanSchema),
  nextCursor: z.string().uuid().optional(),
});
export const SeasonPlanSummarySchema = SeasonPlanSchema.pick({
  id: true,
  projectId: true,
  workflowId: true,
  version: true,
  stateVersion: true,
  status: true,
  sourcePlanId: true,
  origin: true,
  isCurrent: true,
  sourceState: true,
  staleReasons: true,
  createdAt: true,
  updatedAt: true,
});
export const SeasonPlanSummaryPageSchema = z.object({
  items: z.array(SeasonPlanSummarySchema),
  nextCursor: z.string().uuid().optional(),
});
export const SeasonPlanCatalogSchema = z.object({
  projectId: z.string().uuid(),
  diagnosis: SeasonPlanRequestSchema.shape.diagnosis.optional(),
  strategy: AdaptationStrategyReferenceSchema.optional(),
  strategyPath: z.enum(["independent", "legacy-diagnosis"]).optional(),
  adoptedPlanId: z.string().uuid().optional(),
});
export const SeasonPlanAdoptInputSchema = z.object({
  confirmed: z.literal(true),
});
export const SeasonPlanReorderInputSchema = SeasonPlanOrderInputSchema.extend({
  confirmed: z.literal(true),
});
export type SeasonPlanRequest = z.infer<typeof SeasonPlanRequestSchema>;
export type SeasonPlanBasis = z.infer<typeof SeasonPlanBasisSchema>;
export type SeasonPlanEpisode = z.infer<typeof SeasonPlanEpisodeSchema>;
export type SeasonPlanContent = z.infer<typeof SeasonPlanContentSchema>;
export type SeasonPlanCoverage = z.infer<typeof SeasonPlanCoverageSchema>;
export type SeasonPlan = z.infer<typeof SeasonPlanSchema>;
export type SeasonPlanPage = z.infer<typeof SeasonPlanPageSchema>;
export type SeasonPlanSummary = z.infer<typeof SeasonPlanSummarySchema>;
export type SeasonPlanSummaryPage = z.infer<typeof SeasonPlanSummaryPageSchema>;
export type SeasonPlanCatalog = z.infer<typeof SeasonPlanCatalogSchema>;
export const PRODUCTION_SEASON_PLAN_SERVICE = defineServiceContract<{
  get(projectId: string, id: string): SeasonPlan | undefined;
  current(projectId: string): SeasonPlan | undefined;
  prepare: CreationAdapter["prepare"];
  validate: CreationAdapter["validate"];
  preview(workflow: CreationWorkflow): { seasonPlanId: string };
  reviewState(workflow: CreationWorkflow): "adopted" | "discarded" | undefined;
}>({
  id: "production.season-plans.v1",
  owner: "production",
  major: 1,
  capabilities: ["prepare", "validate", "preview", "read"],
  degradable: true,
});
