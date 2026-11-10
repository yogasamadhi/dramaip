import { z } from "zod";
import {
  NarrativeQualityDimensionSchema,
  NarrativeQualityTargetSchema,
} from "./narrative-quality.js";

export const CREATIVE_QUALITY_ADOPTION_EVENT =
  "creative-quality.narrative-report-adopted.v1";
const ref = z
  .object({ id: z.string().uuid(), version: z.number().int().nonnegative() })
  .strict();
const representations = z.enum([
  "original",
  "summary",
  "paragraphs",
  "hierarchical-summary",
  "unknown",
]);

/** An explicit report adoption is not an assessment of literary quality. */
export const CreativeQualityAdoptionFactSchema = z
  .object({
    eventVersion: z.literal(1),
    projectId: z.string().uuid(),
    workflowId: z.string().uuid(),
    report: ref.extend({ version: z.number().int().positive() }).strict(),
    target: NarrativeQualityTargetSchema.strict(),
    requestedDimensions: z
      .array(NarrativeQualityDimensionSchema)
      .min(1)
      .max(10),
    chapterScope: z
      .object({
        mode: z.enum(["selection", "full"]),
        included: z
          .array(
            ref
              .extend({
                representations: z.array(representations).min(1).max(4),
              })
              .strict(),
          )
          .min(1)
          .max(2000),
        totalChapterCount: z.number().int().nonnegative(),
        nonEmptyChapterCount: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    evidenceKind: z.literal("explicit-report-adoption"),
    modelEvidence: z.literal("unknown"),
    qualityState: z.literal("unverified"),
    currentValidity: z.literal("unknown"),
  })
  .strict()
  .superRefine((value, ctx) => {
    const scope = value.chapterScope;
    if (
      new Set(value.requestedDimensions).size !==
        value.requestedDimensions.length ||
      (value.target.kind === "chapter-set" &&
        value.target.id !== value.projectId) ||
      (scope &&
        (value.target.kind !== "chapter-set" ||
          new Set(scope.included.map((item) => item.id)).size !==
            scope.included.length ||
          scope.included.some(
            (item) =>
              new Set(item.representations).size !==
              item.representations.length,
          ) ||
          scope.totalChapterCount < scope.nonEmptyChapterCount ||
          scope.nonEmptyChapterCount < scope.included.length ||
          (scope.mode === "full" &&
            scope.nonEmptyChapterCount !== scope.included.length)))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Report adoption must preserve its exact explicit target and scope without upgrading unknown coverage.",
      });
  });
export const CreativeQualityAdoptionRecordSchema =
  CreativeQualityAdoptionFactSchema.safeExtend({
    eventId: z.string().uuid(),
    occurredAt: z.string().datetime(),
    cursor: z.number().int().positive(),
  });
export type CreativeQualityAdoptionFact = z.infer<
  typeof CreativeQualityAdoptionFactSchema
>;
export type CreativeQualityAdoptionRecord = z.infer<
  typeof CreativeQualityAdoptionRecordSchema
>;
