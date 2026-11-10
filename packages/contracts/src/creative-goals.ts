import { z } from "zod";

export const CreativeInitialGoalSchema = z.enum([
  "novel-first",
  "screenplay-first",
]);
export const CreativeInitialMaterialSchema = z.enum([
  "inspiration",
  "source-import",
  "script",
]);
/** Explicit request proof, never inferred from a recommended mode or recovered draft. */
export const ProjectGoalConfirmationInputSchema = z
  .object({
    confirmed: z.literal(true),
    goal: CreativeInitialGoalSchema,
    material: CreativeInitialMaterialSchema,
  })
  .strict();
export type ProjectGoalConfirmationInput = z.infer<
  typeof ProjectGoalConfirmationInputSchema
>;

export const CREATIVE_INITIAL_GOAL_EVENT =
  "workspace.creation-goal-confirmed.v1";
export const CreativeInitialGoalFactSchema = z
  .object({
    eventVersion: z.literal(1),
    projectId: z.string().uuid(),
    // A new actual Workspace project starts at v0. This is not a fabricated goal revision.
    projectVersion: z.literal(0),
    workflowPath: z.enum(["novel", "adaptation"]),
    goal: CreativeInitialGoalSchema,
    material: CreativeInitialMaterialSchema,
    evidenceKind: z.literal("explicit-initial-goal-confirmation"),
    modelEvidence: z.literal("unknown"),
    qualityState: z.literal("unverified"),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.workflowPath !==
      (value.goal === "novel-first" ? "novel" : "adaptation")
    )
      context.addIssue({
        code: "custom",
        message: "Initial goal and workflow path do not match.",
      });
  });
export const CreativeInitialGoalRecordSchema =
  CreativeInitialGoalFactSchema.safeExtend({
    eventId: z.string().uuid(),
    cursor: z.number().int().positive(),
    occurredAt: z.string().datetime(),
  });
export type CreativeInitialGoalFact = z.infer<
  typeof CreativeInitialGoalFactSchema
>;
export type CreativeInitialGoalRecord = z.infer<
  typeof CreativeInitialGoalRecordSchema
>;

export const CreativeInitialGoalSummarySchema = z
  .object({
    historyPolicy: z.literal("recorded-explicit-initial-goals-only"),
    recordedProjects: z.number().int().nonnegative(),
    byWorkflow: z.tuple([
      z
        .object({
          workflowPath: z.literal("novel"),
          total: z.number().int().nonnegative(),
        })
        .strict(),
      z
        .object({
          workflowPath: z.literal("adaptation"),
          total: z.number().int().nonnegative(),
        })
        .strict(),
    ]),
    items: z.array(CreativeInitialGoalRecordSchema).max(20),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.byWorkflow.reduce((total, row) => total + row.total, 0) !==
        value.recordedProjects ||
      value.items.length !== Math.min(value.recordedProjects, 20) ||
      new Set(value.items.map((item) => item.projectId)).size !==
        value.items.length
    )
      context.addIssue({
        code: "custom",
        message: "Initial goal history counts are inconsistent.",
      });
    for (const row of value.byWorkflow) {
      const observed = value.items.filter(
        (item) => item.workflowPath === row.workflowPath,
      ).length;
      if (
        value.recordedProjects <= 20
          ? observed !== row.total
          : observed > row.total
      )
        context.addIssue({
          code: "custom",
          message:
            "Initial goal workflow count disagrees with recorded history.",
        });
    }
  });
