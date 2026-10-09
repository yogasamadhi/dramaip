import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";
import type { CreationAdapter, CreationWorkflow } from "./creation.js";
import {
  NarrativeContextRequestSchema,
  NarrativeSourceBasisSchema,
  NarrativeReviewedSourceSchema,
} from "./narrative-context.js";

const text = z.string().trim().min(1).max(4000);
export const DiagnosisChapterSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().nonnegative(),
  title: z.string(),
  orderIndex: z.number().int().nonnegative(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  // Legacy diagnosis hashes raw body bytes; the shared narrative compiler
  // hashes JSON-encoded strings. Preserve both identities without rewriting history.
  narrativeContentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  characters: z.number().int().positive(),
});
export const DiagnosisTargetSchema = z.object({
  format: z.enum(["short-drama", "motion-comic"]),
  episodeCount: z.number().int().min(1).max(120),
  durationSeconds: z.number().int().min(30).max(1800),
});
export const DiagnosisRequestSchema = z.object({
  scope: z.enum(["whole-book", "selected-chapters"]),
  chapters: z
    .array(DiagnosisChapterSchema.pick({ id: true, version: true }))
    .min(1)
    .max(1000),
  inventoryFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  authorIntent: z.object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
  }),
  baseAdoptedId: z.string().uuid().optional(),
  rightsDeclared: z.literal(true),
  target: DiagnosisTargetSchema,
  context: NarrativeContextRequestSchema.optional(),
});
export const DiagnosisBasisSchema = z.object({
  scope: DiagnosisRequestSchema.shape.scope,
  chapters: z.array(DiagnosisChapterSchema).min(1).max(1000),
  omittedChapters: z.array(DiagnosisChapterSchema),
  rightsDeclared: z.literal(true),
  target: DiagnosisTargetSchema,
  baseAdoptedId: z.string().uuid().optional(),
  sourceBasis: NarrativeSourceBasisSchema.optional(),
});
const evidence = z.object({
  chapterId: z.string().uuid(),
  chapterVersion: z.number().int().nonnegative(),
  quote: z.string().trim().min(1).max(2000),
  source: NarrativeReviewedSourceSchema.extend({
    valuePath: z.enum(["/content", "/summary"]),
  })
    .strict()
    .optional(),
});
export const DiagnosisContentSchema = z.object({
  reviewedSources: z
    .array(NarrativeReviewedSourceSchema)
    .min(1)
    .max(2000)
    .optional(),
  summary: text,
  theme: text,
  emotionalPromise: text,
  sellingPoints: z.array(text).min(1).max(20),
  mainLine: text,
  characterArcs: z.array(text).min(1).max(50),
  relationships: z.array(text).min(1).max(50),
  findings: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        kind: z.enum([
          "hook",
          "conflict",
          "reversal",
          "suspense",
          "adaptation-risk",
        ]),
        claim: text,
        evidence: z.array(evidence).min(1).max(10),
        suggestion: text,
      }),
    )
    .min(1)
    .max(100),
  strategies: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        title: z.string().trim().min(1).max(240),
        rationale: text,
        preserve: z.array(text).min(1).max(50),
        merge: z.array(text).max(50),
        remove: z.array(text).max(50),
        reorder: z.array(text).max(50),
        restructure: z.array(text).max(50),
        rhythm: text,
        findingIds: z.array(z.string().min(1).max(64)).min(1).max(100),
        risks: z.array(text).min(1).max(50),
        productionRisk: z.enum(["low", "medium", "high", "unknown"]),
        productionNotes: text,
      }),
    )
    .min(2)
    .max(3),
});
export const AdaptationDiagnosisSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  workflowId: z.string().uuid(),
  version: z.number().int().positive(),
  stateVersion: z.number().int().nonnegative(),
  status: z.enum(["pending", "adopted", "discarded", "conflicted"]),
  title: z.string(),
  content: DiagnosisContentSchema,
  basis: DiagnosisBasisSchema,
  authorIntent: DiagnosisRequestSchema.shape.authorIntent,
  sourceSnapshotId: z.string().uuid(),
  runIds: z.array(z.string().uuid()),
  model: z.record(z.string(), z.unknown()).optional(),
  assessmentSource: z.literal("model"),
  isCurrent: z.boolean(),
  sourceState: z.enum(["current", "stale"]),
  staleReasons: z.array(z.string()),
  selectedStrategyId: z.string().optional(),
  adoptedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const DiagnosisPageSchema = z.object({
  items: z.array(AdaptationDiagnosisSchema),
  nextCursor: z.string().uuid().optional(),
});
export const DiagnosisSummarySchema = AdaptationDiagnosisSchema.pick({
  id: true,
  projectId: true,
  workflowId: true,
  version: true,
  stateVersion: true,
  status: true,
  isCurrent: true,
  sourceState: true,
  staleReasons: true,
  createdAt: true,
  updatedAt: true,
});
export const DiagnosisSummaryPageSchema = z.object({
  items: z.array(DiagnosisSummarySchema),
  nextCursor: z.string().uuid().optional(),
});
export type DiagnosisSummary = z.infer<typeof DiagnosisSummarySchema>;
export type DiagnosisSummaryPage = z.infer<typeof DiagnosisSummaryPageSchema>;
export const DiagnosisCatalogSchema = z.object({
  projectId: z.string().uuid(),
  chapters: z.array(DiagnosisChapterSchema),
  inventoryFingerprint: DiagnosisRequestSchema.shape.inventoryFingerprint,
  authorIntent: DiagnosisRequestSchema.shape.authorIntent.optional(),
  adoptedDiagnosisId: z.string().uuid().optional(),
});
export const DiagnosisAdoptInputSchema = z.object({
  confirmed: z.literal(true),
  // New main flow adopts narrative diagnosis only, then selects a separately
  // versioned adaptation strategy. A supplied ID preserves the legacy path.
  strategyId: z.string().trim().min(1).max(64).optional(),
});
export type AdaptationDiagnosis = z.infer<typeof AdaptationDiagnosisSchema>;
export type DiagnosisRequest = z.infer<typeof DiagnosisRequestSchema>;
export type DiagnosisBasis = z.infer<typeof DiagnosisBasisSchema>;
export type DiagnosisContent = z.infer<typeof DiagnosisContentSchema>;
export type DiagnosisCatalog = z.infer<typeof DiagnosisCatalogSchema>;
export type DiagnosisPage = z.infer<typeof DiagnosisPageSchema>;
export const PRODUCTION_DIAGNOSIS_SERVICE = defineServiceContract<{
  get(projectId: string, id: string): AdaptationDiagnosis | undefined;
  current(projectId: string): AdaptationDiagnosis | undefined;
  prepare: CreationAdapter["prepare"];
  validate: CreationAdapter["validate"];
  preview(workflow: CreationWorkflow): { diagnosisId: string };
  reviewState(workflow: CreationWorkflow): "adopted" | "discarded" | undefined;
}>({
  id: "production.diagnoses.v1",
  owner: "production",
  major: 1,
  capabilities: ["prepare", "validate", "preview", "read"],
  degradable: true,
});
