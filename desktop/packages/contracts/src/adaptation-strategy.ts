import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";
import type { CreationAdapter, CreationWorkflow } from "./creation.js";
import {
  DiagnosisBasisSchema,
  DiagnosisContentSchema,
  DiagnosisRequestSchema,
} from "./adaptation-diagnosis.js";

const reference = z
  .object({ id: z.string().uuid(), version: z.number().int().positive() })
  .strict();
export const AdaptationStrategyReferenceSchema = reference
  .extend({ optionId: z.string().trim().min(1).max(64) })
  .strict();
export const AdaptationStrategyRequestSchema = z
  .object({
    diagnosis: reference,
    baseAdoptedId: z.string().uuid().optional(),
  })
  .strict();
export const AdaptationStrategyBasisSchema = DiagnosisBasisSchema.omit({
  baseAdoptedId: true,
})
  .extend({
    diagnosis: reference,
    diagnosisContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    authorIntent: DiagnosisRequestSchema.shape.authorIntent,
    baseAdoptedId: z.string().uuid().optional(),
  })
  .strict();
export const AdaptationStrategyOptionSchema =
  DiagnosisContentSchema.shape.strategies.element.strict();
export const AdaptationStrategyContentSchema = z
  .object({
    reviewedSources: DiagnosisContentSchema.shape.reviewedSources,
    summary: z.string().trim().min(1).max(4000),
    options: z.array(AdaptationStrategyOptionSchema).min(2).max(3),
  })
  .strict();
export const AdaptationStrategySchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    workflowId: z.string().uuid(),
    version: z.number().int().positive(),
    stateVersion: z.number().int().nonnegative(),
    status: z.enum(["pending", "adopted", "discarded", "conflicted"]),
    content: AdaptationStrategyContentSchema,
    basis: AdaptationStrategyBasisSchema,
    selectedOptionId: z.string().optional(),
    sourceSnapshotId: z.string().uuid(),
    runIds: z.array(z.string().uuid()).min(1),
    engineKind: z.enum(["codex", "pi", "langgraph"]),
    model: z.record(z.string(), z.unknown()).optional(),
    isCurrent: z.boolean(),
    sourceState: z.enum(["current", "stale"]),
    staleReasons: z.array(z.string()),
    adoptedAt: z.string().datetime().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const AdaptationStrategySummarySchema = AdaptationStrategySchema.pick({
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
export const AdaptationStrategyPageSchema = z.object({
  items: z.array(AdaptationStrategySchema),
  nextCursor: z.string().uuid().optional(),
});
export const AdaptationStrategySummaryPageSchema = z.object({
  items: z.array(AdaptationStrategySummarySchema),
  nextCursor: z.string().uuid().optional(),
});
export const AdaptationStrategyCatalogSchema = z.object({
  projectId: z.string().uuid(),
  diagnosis: reference.optional(),
  adoptedStrategyId: z.string().uuid().optional(),
});
export const AdaptationStrategyAdoptSchema = z
  .object({
    confirmed: z.literal(true),
    optionId: z.string().trim().min(1).max(64),
  })
  .strict();
export type AdaptationStrategy = z.infer<typeof AdaptationStrategySchema>;
export type AdaptationStrategyRequest = z.infer<
  typeof AdaptationStrategyRequestSchema
>;
export type AdaptationStrategyBasis = z.infer<
  typeof AdaptationStrategyBasisSchema
>;
export type AdaptationStrategyContent = z.infer<
  typeof AdaptationStrategyContentSchema
>;
export type AdaptationStrategySummary = z.infer<
  typeof AdaptationStrategySummarySchema
>;
export type AdaptationStrategyCatalog = z.infer<
  typeof AdaptationStrategyCatalogSchema
>;
export type AdaptationStrategyReference = z.infer<
  typeof AdaptationStrategyReferenceSchema
>;
export const PRODUCTION_ADAPTATION_STRATEGY_SERVICE = defineServiceContract<{
  get(projectId: string, id: string): AdaptationStrategy | undefined;
  current(projectId: string): AdaptationStrategy | undefined;
  prepare: CreationAdapter["prepare"];
  validate: CreationAdapter["validate"];
  preview(workflow: CreationWorkflow): { adaptationStrategyId: string };
  reviewState(workflow: CreationWorkflow): "adopted" | "discarded" | undefined;
  discard(workflow: CreationWorkflow): void;
}>({
  id: "production.adaptation-strategies.v1",
  owner: "production",
  major: 1,
  capabilities: ["prepare", "validate", "preview", "read"],
  degradable: true,
});
