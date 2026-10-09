import { z } from "zod";
import { NarrativePlanningOperationSchema } from "./narrative-planning.js";
import { CreationSourceConflictSchema } from "./creation-source-conflict.js";
/** Owner transaction failed; this is not a user decision or source conflict. */
export class CreativePlanningCommitError extends Error {
  constructor() {
    super("规划采用事务未提交；原候选与资料保持，可稍后安全重试。");
    this.name = "CreativePlanningCommitError";
  }
}
import {
  CreativeFunnelMeasureSchema,
  CreativeCandidateIdentitySchema,
} from "./creative-funnel.js";
export const CREATIVE_PLANNING_ADOPTION_EVENTS = {
  writing: "writing.planning-batch-adopted.v1",
  knowledge: "knowledge.planning-batch-adopted.v1",
} as const;
const reference = z
  .object({ id: z.string().uuid(), version: z.number().int().nonnegative() })
  .strict();
/** Actual persisted item material, not the prose summary or ephemeral ref. */
export function creativePlanningMaterial(
  items: readonly {
    kind: string;
    title: string;
    data: Record<string, unknown>;
  }[],
) {
  return items.map(({ kind, title, data }) => ({ kind, title, data }));
}
export const CreativePlanningAdoptionFactSchema = z
  .object({
    eventVersion: z.literal(1),
    kind: z.literal("story.planning-batch-adopted"),
    workflowPath: z.literal("story-planning"),
    projectId: z.string().uuid(),
    workflowId: z.string().uuid(),
    operation: NarrativePlanningOperationSchema,
    candidate: CreativeCandidateIdentitySchema,
    records: z
      .array(
        reference
          .extend({
            version: z.literal(0),
            kind: z.enum([
              "characters",
              "outlines",
              "story-arcs",
              "story-bible",
            ]),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
    sourceVersions: z.array(reference),
    evidenceKind: z.literal("human"),
    modelEvidence: z.literal("unknown"),
    qualityState: z.literal("unverified"),
    resultStatus: z.literal("adopted"),
  })
  .strict()
  .superRefine((fact, ctx) => {
    const expected =
      fact.operation === "characters"
        ? "characters"
        : fact.operation === "story-arc"
          ? "story-arcs"
          : fact.operation === "knowledge-plan"
            ? "story-bible"
            : "outlines";
    if (
      fact.candidate.selectionOptions ||
      new Set(fact.records.map((record) => record.id)).size !==
        fact.records.length ||
      fact.records.some((record) => record.kind !== expected)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "A planning adoption must bind its whole actual unique owner batch, not strategy options or a foreign record kind.",
      });
  });
export const CreativePlanningAdoptionRecordSchema = z
  .object({
    eventId: z.string().uuid(),
    cursor: z.number().int().positive(),
    occurredAt: z.string().datetime(),
    owner: z.enum(["writing", "knowledge"]),
    fact: CreativePlanningAdoptionFactSchema,
  })
  .strict()
  .superRefine((record, ctx) => {
    if (
      (record.fact.operation === "knowledge-plan") !==
      (record.owner === "knowledge")
    )
      ctx.addIssue({
        code: "custom",
        message: "Each planning batch has exactly its content owner.",
      });
  });
export const CreativePlanningAdoptionDisplaySchema = z
  .object({
    ...CreativePlanningAdoptionRecordSchema.shape,
    fact: z
      .object({
        ...CreativePlanningAdoptionFactSchema.shape,
        recordDisplay: z.literal("first-five-actual-records"),
        recordCount: z.number().int().positive().max(2000),
        records: z
          .array(
            reference
              .extend({
                version: z.literal(0),
                kind: z.enum([
                  "characters",
                  "outlines",
                  "story-arcs",
                  "story-bible",
                ]),
              })
              .strict(),
          )
          .min(1)
          .max(5),
      })
      .strict(),
  })
  .strict()
  .superRefine((record, ctx) => {
    const fact = record.fact;
    const expected =
      fact.operation === "characters"
        ? "characters"
        : fact.operation === "story-arc"
          ? "story-arcs"
          : fact.operation === "knowledge-plan"
            ? "story-bible"
            : "outlines";
    if (
      fact.records.length !== Math.min(5, fact.recordCount) ||
      new Set(fact.records.map((item) => item.id)).size !==
        fact.records.length ||
      fact.records.some((item) => item.kind !== expected) ||
      fact.candidate.selectionOptions ||
      (fact.operation === "knowledge-plan") !== (record.owner === "knowledge")
    )
      ctx.addIssue({
        code: "custom",
        message:
          "The displayed first five original records must preserve exact owner, count, kind and candidate.",
      });
  });
export const CreativePlanningAdoptionSummarySchema = z
  .object({
    historyPolicy: z.literal("recorded-complete-owner-planning-batches-only"),
    countingUnit: z.literal("adopted-planning-batch-not-individual-records"),
    recordedBatches: z.number().int().nonnegative(),
    counts: z
      .array(
        z
          .object({
            operation: NarrativePlanningOperationSchema,
            batches: z.number().int().nonnegative(),
            actualRecords: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .length(5),
    items: z.array(CreativePlanningAdoptionDisplaySchema).max(20),
  })
  .strict()
  .superRefine((summary, ctx) => {
    if (
      new Set(summary.counts.map((item) => item.operation)).size !== 5 ||
      summary.counts.reduce((sum, item) => sum + item.batches, 0) !==
        summary.recordedBatches ||
      summary.items.length !== Math.min(20, summary.recordedBatches) ||
      new Set(summary.items.map((item) => item.fact.workflowId)).size !==
        summary.items.length
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Batch counts and recent immutable history must agree, not conflate per-record outcomes.",
      });
    for (const count of summary.counts) {
      if (
        count.actualRecords < count.batches ||
        count.actualRecords > count.batches * 2000
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Complete planning counters must remain within the actual nonempty bounded batch unit.",
        });
      const observed = summary.items.filter(
        (item) => item.fact.operation === count.operation,
      );
      const actualRecords = observed.reduce(
        (sum, item) => sum + item.fact.recordCount,
        0,
      );
      if (
        summary.recordedBatches <= 20
          ? count.batches !== observed.length ||
            count.actualRecords !== actualRecords
          : count.batches < observed.length ||
            count.actualRecords < actualRecords
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Complete counters must agree with the shown original batch counts.",
        });
    }
  });
export type CreativePlanningAdoptionFact = z.infer<
  typeof CreativePlanningAdoptionFactSchema
>;
export type CreativePlanningAdoptionRecord = z.infer<
  typeof CreativePlanningAdoptionRecordSchema
>;

export const CREATIVE_PLANNING_FUNNEL_EVENTS = {
  request: "automation.planning-requested.v1",
  candidate: "automation.planning-candidate-ready.v1",
  state: "automation.planning-metric-state.v1",
  sourceConflict: "automation.planning-source-conflict.v1",
} as const;
const planningCommon = {
  eventVersion: z.literal(1),
  projectId: z.string().uuid(),
  workflowId: z.string().uuid(),
  workflowVersion: z.number().int().nonnegative(),
  operation: NarrativePlanningOperationSchema,
  rootWorkflowId: z.string().uuid(),
  targetKey: z.string().regex(/^[a-f0-9]{64}$/u),
  requestedAt: z.string().datetime(),
  evidenceKind: z.literal("rule"),
  modelEvidence: z.literal("unknown"),
};
export const CreativePlanningFunnelFactSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...planningCommon,
        kind: z.literal("request"),
        targetAttempt: z.number().int().positive(),
        requestKind: z.enum(["new-request", "retry", "rebase"]),
        parentWorkflowId: z.string().uuid().optional(),
        sourceVersions: z.array(reference),
      })
      .strict(),
    z
      .object({
        ...planningCommon,
        kind: z.literal("candidate-ready"),
        candidate: CreativeCandidateIdentitySchema,
      })
      .strict(),
    z
      .object({
        ...planningCommon,
        kind: z.literal("state"),
        state: z.enum([
          "failed",
          "canceled",
          "discarded",
          "interrupted",
          "adoption-rejected",
        ]),
      })
      .strict(),
    z
      .object({
        ...planningCommon,
        kind: z.literal("source-conflict"),
        candidate: CreativeCandidateIdentitySchema,
        sourceConflict: CreationSourceConflictSchema,
      })
      .strict(),
  ])
  .superRefine((fact, ctx) => {
    if (
      fact.kind === "request"
        ? fact.workflowVersion !== 0 ||
          (fact.requestKind === "new-request"
            ? fact.targetAttempt !== 1 ||
              fact.rootWorkflowId !== fact.workflowId ||
              Boolean(fact.parentWorkflowId)
            : !fact.parentWorkflowId ||
              fact.parentWorkflowId === fact.workflowId ||
              fact.rootWorkflowId === fact.workflowId ||
              fact.targetAttempt < 2)
        : fact.workflowVersion === 0 ||
          ((fact.kind === "candidate-ready" ||
            fact.kind === "source-conflict") &&
            Boolean(fact.candidate.selectionOptions))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Planning metrics bind actual original request lineage, not fictitious chapter targets, root resets or strategy options.",
      });
    if (
      fact.kind === "source-conflict" &&
      (fact.sourceConflict.projectId !== fact.projectId ||
        fact.sourceConflict.workflowId !== fact.workflowId)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Planning conflict evidence must bind its original project and workflow.",
      });
  });
export const CreativePlanningFunnelRecordSchema = z
  .object({
    fact: CreativePlanningFunnelFactSchema,
    eventId: z.string().uuid(),
    cursor: z.number().int().positive(),
    occurredAt: z.string().datetime(),
  })
  .strict();
export const CreativePlanningFunnelMeasureSchema = z
  .object({
    operation: NarrativePlanningOperationSchema,
    modelEvidence: z.literal("unknown"),
    recordedRequests: z.number().int().nonnegative(),
    requestedTargets: z.number().int().nonnegative(),
    unobservedFirstTargets: z.number().int().nonnegative(),
    firstCandidates: z.number().int().nonnegative(),
    firstAdopted: z.number().int().nonnegative(),
    pendingDecision: z.number().int().nonnegative(),
    closedWithoutFirstAdoption: z.number().int().nonnegative(),
    revisedAdoption: z.number().int().nonnegative(),
    retryCandidates: z.number().int().nonnegative(),
    adoptionRejectedCount: z.number().int().nonnegative(),
    // Missing on older services means unrecorded, not a zero conflict count.
    sourceConflicts: z
      .object({
        candidateCount: z.number().int().nonnegative(),
        last: z
          .object({
            candidate: CreativeCandidateIdentitySchema,
            sourceConflict: CreationSourceConflictSchema,
            eventId: z.string().uuid(),
            cursor: z.number().int().positive(),
            occurredAt: z.string().datetime(),
          })
          .strict()
          .nullable(),
      })
      .strict()
      .optional(),
    firstCandidateAdoptionRatio: z.number().min(0).max(1).nullable(),
    firstAccepted: CreativeFunnelMeasureSchema.shape.firstAccepted,
  })
  .strict()
  .superRefine((measure, ctx) => {
    const at = measure.firstAccepted;
    if (
      measure.sourceConflicts &&
      (measure.sourceConflicts.candidateCount > 0 !==
        Boolean(measure.sourceConflicts.last) ||
        measure.sourceConflicts.candidateCount >
          measure.firstCandidates + measure.retryCandidates ||
        measure.sourceConflicts.candidateCount >
          measure.adoptionRejectedCount ||
        Boolean(measure.sourceConflicts.last?.candidate.selectionOptions))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Planning conflict counts require actual review candidates, rejection facts and exact body-free evidence.",
      });
    if (
      at &&
      (!measure.recordedRequests ||
        (at.clockState === "consistent" &&
          (at.requestToReadyMs === null ||
            at.readyToAdoptMs === null ||
            at.requestToAdoptMs === null ||
            at.requestToReadyMs + at.readyToAdoptMs !== at.requestToAdoptMs)) ||
        (at.clockState === "inconsistent" &&
          at.requestToReadyMs !== null &&
          at.readyToAdoptMs !== null &&
          at.requestToAdoptMs !== null))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Planning durations must preserve their actually recorded clocks.",
      });
    if (
      measure.firstAdopted +
        measure.pendingDecision +
        measure.closedWithoutFirstAdoption +
        measure.revisedAdoption !==
        measure.firstCandidates ||
      measure.requestedTargets > measure.recordedRequests ||
      measure.unobservedFirstTargets > measure.requestedTargets ||
      measure.firstCandidates >
        measure.requestedTargets - measure.unobservedFirstTargets ||
      measure.firstCandidateAdoptionRatio !==
        (measure.firstCandidates
          ? measure.firstAdopted / measure.firstCandidates
          : null) ||
      (measure.firstAccepted &&
        (measure.firstAccepted.adoptionMode === "selected-option" ||
          Boolean(measure.firstAccepted.selectedOption)))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Independent planning candidate counts, ratios and exact owner-batch adoption must agree.",
      });
  });
export const CreativePlanningFunnelSummarySchema = z
  .object({
    historyPolicy: z.literal("actual-planning-request-receipts-only"),
    unit: z.literal("independent-original-planning-request"),
    adoptionBasis: z.literal("complete-matching-owner-batch"),
    ratioPolicy: z.literal("as-of-including-pending-not-public-quality"),
    unmatchedAdoptionBatches: z.number().int().nonnegative(),
    measures: z.array(CreativePlanningFunnelMeasureSchema).length(5),
  })
  .strict()
  .superRefine((summary, ctx) => {
    if (new Set(summary.measures.map((item) => item.operation)).size !== 5)
      ctx.addIssue({
        code: "custom",
        message: "Each independent planning operation must appear once.",
      });
  });
export type CreativePlanningFunnelFact = z.infer<
  typeof CreativePlanningFunnelFactSchema
>;
export type CreativePlanningFunnelRecord = z.infer<
  typeof CreativePlanningFunnelRecordSchema
>;
export type CreativePlanningFunnelSummary = z.infer<
  typeof CreativePlanningFunnelSummarySchema
>;
