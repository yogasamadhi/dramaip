import { z } from "zod";

export const CREATIVE_CONTINUATION_EVENTS = {
  request: "automation.creative-continuation-requested.v1",
  started: "automation.creative-continuation-started.v1",
} as const;
export const CreativeContinuationPathSchema = z.enum(["novel", "adaptation"]);
/** Hash this identity in the owner; no titles, bodies or paths enter metrics. */
export const creativeContinuationIdentity = (
  projectId: string,
  path: "novel" | "adaptation",
  targetId: string,
  scope = "",
) =>
  JSON.stringify([
    "creative-continuation-v1",
    projectId,
    path,
    scope,
    targetId,
  ]);
const key = z.string().regex(/^[a-f0-9]{64}$/u);
export const CreativeContinuationTargetSchema = z
  .object({ targetKey: key, position: z.number().int().nonnegative() })
  .strict();
export const CreativeContinuationSourceSchema =
  CreativeContinuationTargetSchema.extend({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    kind: z.enum(["chapter", "episode-script"]),
  }).strict();
// Derived and frozen by the content owner; never accepted in public Creation input.
export const CreativeContinuationBasisSchema = z
  .object({
    workflowPath: CreativeContinuationPathSchema,
    source: CreativeContinuationSourceSchema,
    target: CreativeContinuationTargetSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.source.kind !==
        (value.workflowPath === "novel" ? "chapter" : "episode-script") ||
      value.target.targetKey === value.source.targetKey ||
      value.target.position !== value.source.position + 1 ||
      (value.workflowPath === "adaptation" && value.source.position !== 0)
    )
      ctx.addIssue({
        code: "custom",
        message: "Continuation requires exact next-target owner lineage.",
      });
  });
const common = {
  eventVersion: z.literal(1),
  projectId: z.string().uuid(),
  workflowId: z.string().uuid(),
  workflowVersion: z.number().int().nonnegative(),
  operation: z.enum(["chapter", "episode-outline", "episode-script"]),
  basis: CreativeContinuationBasisSchema,
  requestedAt: z.string().datetime(),
  evidenceKind: z.literal("rule"),
  modelEvidence: z.literal("unknown"),
};
export const CreativeContinuationFactSchema = z
  .discriminatedUnion("kind", [
    z.object({ ...common, kind: z.literal("request") }).strict(),
    z
      .object({
        ...common,
        kind: z.literal("started"),
        runId: z.string().uuid(),
        sessionId: z.string().uuid(),
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    if (
      (value.operation === "chapter") !==
        (value.basis.workflowPath === "novel") ||
      (value.kind === "request"
        ? value.workflowVersion !== 0
        : value.workflowVersion === 0)
    )
      ctx.addIssue({
        code: "custom",
        message: "Continuation operation and actual stage must agree.",
      });
  });
export const CreativeContinuationRecordSchema = z
  .object({
    eventId: z.string().uuid(),
    cursor: z.number().int().positive(),
    occurredAt: z.string().datetime(),
    fact: CreativeContinuationFactSchema,
  })
  .strict();
const baseline = z
  .object({
    eventId: z.string().uuid(),
    objectId: z.string().uuid(),
    version: z.number().int().positive(),
    targetKey: key,
    position: z.number().int().nonnegative(),
    adoptedAt: z.string().datetime(),
    deadline: z.string().datetime(),
  })
  .strict();
const started = z
  .object({
    workflowId: z.string().uuid(),
    runId: z.string().uuid(),
    sessionId: z.string().uuid(),
    targetKey: key,
    startedAt: z.string().datetime(),
    withinWindow: z.boolean(),
  })
  .strict();
export const CreativeContinuationObservationSchema = z
  .object({
    workflowPath: CreativeContinuationPathSchema,
    modelEvidence: z.literal("unknown"),
    state: z.enum([
      "unobserved",
      "pending",
      "continued",
      "not-started",
      "clock-inconsistent",
    ]),
    baseline: baseline.nullable(),
    firstStarted: started.nullable(),
    recordedRequests: z.number().int().nonnegative(),
    successfulStarts: z.number().int().nonnegative(),
    nextAdoptedTargets: z.number().int().nonnegative(),
    unlinkedRequests: z.number().int().nonnegative(),
  })
  .strict();
export const CreativeContinuationSummarySchema = z
  .object({
    unit: z.literal("first-recorded-eligible-result-per-project-path"),
    windowDays: z.literal(7),
    ratePolicy: z.literal("matured-projects-only-not-public-quality"),
    observations: z.array(CreativeContinuationObservationSchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.observations.length !== 2 ||
      new Set(value.observations.map((item) => item.workflowPath)).size !== 2
    )
      ctx.addIssue({
        code: "custom",
        message: "Both independent continuation paths are required once.",
      });
    for (const item of value.observations) {
      if (
        (item.state === "unobserved") !== (item.baseline === null) ||
        item.successfulStarts > item.recordedRequests ||
        item.unlinkedRequests > item.recordedRequests ||
        item.nextAdoptedTargets > item.successfulStarts ||
        (item.workflowPath === "adaptation" &&
          item.baseline &&
          item.baseline.position !== 0) ||
        (item.firstStarted && (!item.baseline || !item.successfulStarts)) ||
        (item.state === "continued" && !item.firstStarted?.withinWindow) ||
        (item.state === "not-started" && item.firstStarted?.withinWindow) ||
        (item.state === "clock-inconsistent" &&
          item.firstStarted?.withinWindow) ||
        (item.firstStarted &&
          item.baseline &&
          (item.firstStarted.targetKey === item.baseline.targetKey ||
            (item.firstStarted.withinWindow &&
              (Date.parse(item.firstStarted.startedAt) <
                Date.parse(item.baseline.adoptedAt) ||
                Date.parse(item.firstStarted.startedAt) >
                  Date.parse(item.baseline.deadline))))) ||
        (item.baseline &&
          Date.parse(item.baseline.deadline) -
            Date.parse(item.baseline.adoptedAt) !==
            7 * 86400000)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Observation state requires its actual owner and clock evidence.",
        });
    }
  });
export const CreativeContinuationGlobalSchema = z
  .object({
    scope: z.literal("all-local-recorded-projects"),
    asOf: z.string().datetime(),
    projection: z
      .object({
        state: z.enum(["healthy", "catching-up", "retrying", "degraded"]),
        checkpoint: z.number().int().nonnegative(),
      })
      .strict(),
    windowDays: z.literal(7),
    ratePolicy: z.literal("matured-projects-only-not-public-quality"),
    measures: z.array(
      z
        .object({
          workflowPath: CreativeContinuationPathSchema,
          modelEvidence: z.literal("unknown"),
          eligibleProjects: z.number().int().nonnegative(),
          maturedProjects: z.number().int().nonnegative(),
          continuedProjects: z.number().int().nonnegative(),
          closedWithoutStart: z.number().int().nonnegative(),
          pendingProjects: z.number().int().nonnegative(),
          clockUnknownProjects: z.number().int().nonnegative(),
          unobservedBaselineProjects: z.number().int().nonnegative(),
          observedEarlyContinuations: z.number().int().nonnegative(),
          continuationRatio: z.number().min(0).max(1).nullable(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.measures.length !== 2 ||
      new Set(value.measures.map((item) => item.workflowPath)).size !== 2
    )
      ctx.addIssue({
        code: "custom",
        message: "Both local project cohorts are required once.",
      });
    for (const item of value.measures)
      if (
        item.continuedProjects + item.closedWithoutStart !==
          item.maturedProjects ||
        item.maturedProjects +
          item.pendingProjects +
          item.clockUnknownProjects !==
          item.eligibleProjects ||
        item.observedEarlyContinuations > item.pendingProjects ||
        item.continuationRatio !==
          (item.maturedProjects
            ? item.continuedProjects / item.maturedProjects
            : null)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Only complete seven-day project windows may enter the ratio.",
        });
  });
export type CreativeContinuationBasis = z.infer<
  typeof CreativeContinuationBasisSchema
>;
export type CreativeContinuationFact = z.infer<
  typeof CreativeContinuationFactSchema
>;
export type CreativeContinuationSummary = z.infer<
  typeof CreativeContinuationSummarySchema
>;
export type CreativeContinuationGlobal = z.infer<
  typeof CreativeContinuationGlobalSchema
>;
