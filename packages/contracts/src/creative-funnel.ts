import { z } from "zod";
import {
  CreationSourceChangeSchema,
  CreationSourceConflictSchema,
} from "./creation-source-conflict.js";

export const CREATIVE_FUNNEL_EVENTS = {
  request: "automation.creative-requested.v1",
  candidate: "automation.creative-candidate-ready.v1",
  state: "automation.creative-metric-state.v1",
  sourceConflict: "automation.creative-source-conflict.v1",
} as const;
export const CREATIVE_OWNER_REJECTION_EVENT =
  "production.creative-adoption-rejected.v1";
export const CreativeFunnelMetricSchema = z.enum([
  "novel.chapter",
  "adaptation.diagnosis",
  "adaptation.strategy",
  "adaptation.season-plan",
  "adaptation.script",
]);
export const CreativeSelectionOptionSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    contentFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
export const CreativeCandidateIdentitySchema = z
  .object({
    id: z.string().uuid(),
    contentFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    selectionOptions: z
      .array(CreativeSelectionOptionSchema)
      .min(2)
      .max(3)
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.selectionOptions &&
      new Set(value.selectionOptions.map((option) => option.id)).size !==
        value.selectionOptions.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Candidate option identities must be unique.",
      });
  });
const common = {
  eventVersion: z.literal(1),
  projectId: z.string().uuid(),
  workflowId: z.string().uuid(),
  workflowVersion: z.number().int().nonnegative(),
  workflowPath: z.enum(["novel", "adaptation"]),
  metric: CreativeFunnelMetricSchema,
  targetKey: z.string().regex(/^[a-f0-9]{64}$/u),
  requestedAt: z.string().datetime(),
  evidenceKind: z.literal("rule"),
  modelEvidence: z.literal("unknown"),
};
export const CreativeFunnelFactSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...common,
        kind: z.literal("request"),
        targetAttempt: z.number().int().positive(),
        requestKind: z.enum(["new-request", "retry", "rebase"]),
        parentWorkflowId: z.string().uuid().optional(),
        sourceVersions: z.array(
          z
            .object({
              id: z.string().uuid(),
              version: z.number().int().nonnegative(),
            })
            .strict(),
        ),
      })
      .strict(),
    z
      .object({
        ...common,
        kind: z.literal("candidate-ready"),
        candidate: CreativeCandidateIdentitySchema,
      })
      .strict(),
    z
      .object({
        ...common,
        kind: z.literal("source-conflict"),
        candidate: CreativeCandidateIdentitySchema,
        sourceConflict: CreationSourceConflictSchema,
      })
      .strict(),
    z
      .object({
        ...common,
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
  ])
  .superRefine((value, ctx) => {
    if (
      value.kind === "source-conflict" &&
      (value.sourceConflict.projectId !== value.projectId ||
        value.sourceConflict.workflowId !== value.workflowId)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Observed source changes must belong to the exact candidate workflow and project.",
      });
    if (
      (value.kind === "candidate-ready" || value.kind === "source-conflict") &&
      Boolean(value.candidate.selectionOptions) !==
        (value.metric === "adaptation.strategy")
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Only independent strategy candidates require their complete option fingerprints.",
      });
    if (
      value.workflowPath !== value.metric.split(".")[0] ||
      (value.kind === "request"
        ? value.workflowVersion !== 0
        : value.workflowVersion === 0) ||
      (value.kind === "request" &&
        (Boolean(value.parentWorkflowId) !==
          (value.requestKind !== "new-request") ||
          value.parentWorkflowId === value.workflowId))
    )
      ctx.addIssue({
        code: "custom",
        message: "Creative metric path and actual request lineage must agree.",
      });
  });
/** A set change, not a fabricated directory/object version or a failed get. */
export const CreativeChapterCollectionChangeSchema = z
  .object({
    scope: z.literal("whole-book"),
    inventory: z.literal("nonempty-chapters"),
    inventoryOwner: z.literal("writing"),
    completeness: z.literal("complete-owner-inventory"),
    frozenIds: z.array(z.string().uuid()).min(1).max(1000),
    currentIds: z.array(z.string().uuid()).max(2000),
  })
  .strict()
  .superRefine((value, ctx) => {
    const frozen = new Set(value.frozenIds);
    const current = new Set(value.currentIds);
    if (
      frozen.size !== value.frozenIds.length ||
      current.size !== value.currentIds.length ||
      (frozen.size === current.size &&
        value.frozenIds.every((id) => current.has(id)))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Whole-book collection evidence requires unique identities and an actual membership difference, not ordering or a read failure.",
      });
  });
export type CreativeChapterCollectionChange = z.infer<
  typeof CreativeChapterCollectionChangeSchema
>;
export const CreativeOwnerSourceConflictSchema = z
  .object({
    projectId: z.string().uuid(),
    workflowId: z.string().uuid(),
    changes: z.array(CreationSourceChangeSchema).max(2000),
    chapterCollection: CreativeChapterCollectionChangeSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (!value.changes.length && !value.chapterCollection) ||
      new Set(
        value.changes.map(
          (change) => `${change.sourceKind}:${change.frozen.id}`,
        ),
      ).size !== value.changes.length
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Owner source evidence requires a real version or complete collection difference, with unique frozen sources.",
      });
  });
export type CreativeOwnerSourceConflict = z.infer<
  typeof CreativeOwnerSourceConflictSchema
>;
export const CreativeOwnerRejectionReceiptSchema = z
  .object({
    owner: z.literal("production"),
    aggregateType: z.enum([
      "adaptation-diagnosis",
      "adaptation-strategy",
      "season-plan",
    ]),
    stateVersion: z.number().int().positive(),
  })
  .strict();
export const CreativeOwnerRejectionFactSchema = z
  .object({
    eventVersion: z.literal(1),
    kind: z.literal("owner-rejection"),
    projectId: z.string().uuid(),
    workflowId: z.string().uuid(),
    workflowPath: z.literal("adaptation"),
    metric: z.enum([
      "adaptation.diagnosis",
      "adaptation.strategy",
      "adaptation.season-plan",
    ]),
    candidate: CreativeCandidateIdentitySchema,
    ownerRejection: CreativeOwnerRejectionReceiptSchema,
    sourceConflict: CreativeOwnerSourceConflictSchema.optional(),
    evidenceKind: z.literal("rule"),
    modelEvidence: z.literal("unknown"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.ownerRejection.aggregateType !==
        {
          "adaptation.diagnosis": "adaptation-diagnosis",
          "adaptation.strategy": "adaptation-strategy",
          "adaptation.season-plan": "season-plan",
        }[value.metric] ||
      Boolean(value.candidate.selectionOptions) !==
        (value.metric === "adaptation.strategy") ||
      (value.sourceConflict &&
        (value.sourceConflict.projectId !== value.projectId ||
          value.sourceConflict.workflowId !== value.workflowId ||
          value.sourceConflict.changes.some(
            (change) =>
              !["author_intent", "chapter", "production"].includes(
                change.sourceKind,
              ),
          )))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Native rejection must preserve its exact owner, candidate options and observed source scope.",
      });
  });
export const CreativeFunnelRecordSchema = z
  .object({
    eventId: z.string().uuid(),
    cursor: z.number().int().positive(),
    occurredAt: z.string().datetime(),
    fact: z.union([CreativeFunnelFactSchema, CreativeOwnerRejectionFactSchema]),
  })
  .strict();
export const CreativeFunnelMeasureSchema = z
  .object({
    metric: CreativeFunnelMetricSchema,
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
    sourceConflictCandidateCount: z.number().int().nonnegative(),
    lastSourceConflict: z
      .object({
        occurredAt: z.string().datetime(),
        candidate: CreativeCandidateIdentitySchema,
        sourceConflict: z.union([
          CreationSourceConflictSchema,
          CreativeOwnerSourceConflictSchema,
        ]),
        ownerRejection: CreativeOwnerRejectionReceiptSchema.optional(),
      })
      .strict()
      .nullable(),
    firstCandidateAdoptionRatio: z.number().min(0).max(1).nullable(),
    firstAccepted: z
      .object({
        workflowId: z.string().uuid(),
        candidateId: z.string().uuid(),
        adoptedEventId: z.string().uuid(),
        adoptionMode: z.enum([
          "exact-candidate",
          "edited-candidate",
          "selected-option",
        ]),
        selectedOption: CreativeSelectionOptionSchema.optional(),
        requestToReadyMs: z.number().int().nonnegative().nullable(),
        readyToAdoptMs: z.number().int().nonnegative().nullable(),
        requestToAdoptMs: z.number().int().nonnegative().nullable(),
        clockState: z.enum(["consistent", "inconsistent"]),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const CreativeFunnelSummarySchema = z
  .object({
    unit: z.literal("first-recorded-target-request"),
    adoptionBasis: z.literal("exact-candidate-owner-fact"),
    ratioPolicy: z.literal("as-of-including-pending-not-public-quality"),
    measures: z.array(CreativeFunnelMeasureSchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.measures.length !== CreativeFunnelMetricSchema.options.length ||
      new Set(value.measures.map((item) => item.metric)).size !==
        CreativeFunnelMetricSchema.options.length
    )
      ctx.addIssue({
        code: "custom",
        message: "All independent creative metrics are required exactly once.",
      });
    for (const measure of value.measures) {
      if (
        measure.lastSourceConflict &&
        !(
          measure.lastSourceConflict.ownerRejection
            ? CreativeOwnerSourceConflictSchema
            : CreationSourceConflictSchema
        ).safeParse(measure.lastSourceConflict.sourceConflict).success
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Complete collection observations belong only to a committed native owner rejection; ordinary version evidence stays unchanged.",
        });
      if (
        measure.lastSourceConflict &&
        (Boolean(measure.lastSourceConflict.candidate.selectionOptions) !==
          (measure.metric === "adaptation.strategy") ||
          (measure.lastSourceConflict.ownerRejection &&
            (measure.lastSourceConflict.sourceConflict.changes.some(
              (change) =>
                !["author_intent", "chapter", "production"].includes(
                  change.sourceKind,
                ),
            ) ||
              measure.lastSourceConflict.ownerRejection.aggregateType !==
                {
                  "adaptation.diagnosis": "adaptation-diagnosis",
                  "adaptation.strategy": "adaptation-strategy",
                  "adaptation.season-plan": "season-plan",
                  "novel.chapter": undefined,
                  "adaptation.script": undefined,
                }[measure.metric])))
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Conflict evidence must preserve the exact strategy candidate option set only for strategy metrics.",
        });
      if (
        measure.sourceConflictCandidateCount > 0 !==
        Boolean(measure.lastSourceConflict)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Observed conflict candidates and their latest body-free evidence must agree.",
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
            : null)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Candidate accounting and the explicit denominator must agree.",
        });
      if (measure.firstAccepted) {
        const at = measure.firstAccepted;
        if (
          (at.adoptionMode === "selected-option") !==
            (measure.metric === "adaptation.strategy") ||
          Boolean(at.selectedOption) !== (at.adoptionMode === "selected-option")
        )
          ctx.addIssue({
            code: "custom",
            message:
              "Strategy adoption must remain an explicit option selection, not whole-candidate adoption.",
          });
        if (
          !measure.recordedRequests ||
          (at.clockState === "consistent" &&
            (at.requestToReadyMs === null ||
              at.readyToAdoptMs === null ||
              at.requestToAdoptMs === null ||
              at.requestToReadyMs + at.readyToAdoptMs !==
                at.requestToAdoptMs)) ||
          (at.clockState === "inconsistent" &&
            at.requestToReadyMs !== null &&
            at.readyToAdoptMs !== null &&
            at.requestToAdoptMs !== null)
        )
          ctx.addIssue({
            code: "custom",
            message:
              "Elapsed time must match its recorded request/review/adoption clock evidence.",
          });
      }
    }
  });

/** Local fingerprint material only. Never send content or its digest to telemetry. */
export function canonicalCreativeMetricJSON(value: unknown): string {
  const canonical = (entry: unknown): unknown =>
    Array.isArray(entry)
      ? entry.map(canonical)
      : entry && typeof entry === "object"
        ? Object.fromEntries(
            Object.entries(entry)
              .filter(([, child]) => child !== undefined)
              .sort(([left], [right]) =>
                left < right ? -1 : left > right ? 1 : 0,
              )
              .map(([key, child]) => [key, canonical(child)]),
          )
        : entry;
  return JSON.stringify(canonical(value));
}
export type CreativeFunnelFact = z.infer<typeof CreativeFunnelFactSchema>;
export type CreativeFunnelRecord = z.infer<typeof CreativeFunnelRecordSchema>;
export type CreativeFunnelSummary = z.infer<typeof CreativeFunnelSummarySchema>;
export type CreativeOwnerRejectionFact = z.infer<
  typeof CreativeOwnerRejectionFactSchema
>;
