import { z } from "zod";

// Keep this body-free protocol independent of episode/attribution schemas:
// those schemas already depend on the storyboard request and receipt.
const ref = z
  .object({ id: z.string().uuid(), version: z.number().int().nonnegative() })
  .strict();
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const stableId = z.string().trim().min(1).max(64);
export const StoryboardSourceReviewSchema = z
  .object({
    format: z.literal("explicit-storyboard-source-review-v1"),
    attribution: ref,
    impactHash: sha,
    shots: z
      .array(
        z
          .object({
            sceneId: stableId,
            shotId: stableId,
            record: ref,
            observedState: z.enum([
              "affected",
              "no-observed-change",
              "unassociated",
              "unresolved",
            ]),
            decision: z.enum(["redo", "retain"]),
          })
          .strict(),
      )
      .min(1)
      .max(60000),
    confirmation: z
      .object({
        originalAttributionReviewed: z.literal(true),
        currentImpactReviewed: z.literal(true),
        completeScopeReviewed: z.literal(true),
        unassociatedScopeReviewed: z.literal(true),
        unverifiedSemanticsAcknowledged: z.literal(true),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.shots.map((shot) => shot.shotId)).size !==
        value.shots.length ||
      new Set(value.shots.map((shot) => shot.record.id)).size !==
        value.shots.length ||
      !value.shots.some((shot) => shot.decision === "redo")
    )
      ctx.addIssue({
        code: "custom",
        message: "必须明确全镜头的独立实际身份与决定，不能重复或省略重做范围。",
      });
  });

export const StoryboardSourceReviewReceiptSchema = z
  .object({
    format: z.literal("frozen-storyboard-source-review-v1"),
    projectId: z.string().uuid(),
    episodeId: stableId,
    storyboard: ref,
    review: StoryboardSourceReviewSchema,
    sourceFingerprint: sha,
    associationFingerprint: sha,
    // Covers every field in the actual complete owner observation, not only
    // the affected-link subset. No original text/private rationale is copied.
    impactContentHash: sha,
    scopeHash: sha,
    semanticVerification: z.literal("unverified"),
  })
  .strict();
export type StoryboardSourceReview = z.infer<
  typeof StoryboardSourceReviewSchema
>;
export type StoryboardSourceReviewReceipt = z.infer<
  typeof StoryboardSourceReviewReceiptSchema
>;
