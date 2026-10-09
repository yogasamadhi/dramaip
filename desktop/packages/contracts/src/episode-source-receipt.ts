import { z } from "zod";

const ref = z
  .object({ id: z.string().uuid(), version: z.number().int().positive() })
  .strict();
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
export const EpisodeSourceRevisionConfirmationSchema = z
  .object({
    currentSourcesReviewed: z.literal(true),
    outlineReviewed: z.literal(true),
    actualDocumentReviewed: z.literal(true),
    sceneMappingReviewed: z.literal(true),
    retainedManuscriptReviewed: z.literal(true),
  })
  .strict();

/** A new actual source basis, never a mutation of an old adoption or a model run. */
export const EpisodeSourceRevisionReceiptSchema = z
  .object({
    previewId: z.string().uuid(),
    sourceScript: ref,
    sourceOutline: ref,
    document: z
      .object({
        id: z.string().uuid(),
        scriptId: z.string().uuid(),
        version: z.number().int().nonnegative(),
      })
      .strict(),
    scriptRecordVersion: z.number().int().nonnegative(),
    scriptRecordHash: sha,
    outlineContentHash: sha,
    scriptContentHash: sha,
    sourceBasisHash: sha,
    sourceSnapshotId: z.string().uuid(),
    sourceManifestHash: sha,
    sourcePromptHash: sha,
    policyDependencies: z
      .array(
        z
          .object({
            sourceId: z.string().min(1),
            sourceVersion: z.number().int().nonnegative(),
            fieldPath: z.string().startsWith("/").max(500),
          })
          .strict(),
      )
      .max(2000),
    results: z.object({ outline: ref, script: ref }).strict(),
    humanReview: EpisodeSourceRevisionConfirmationSchema,
    semanticVerification: z.literal(
      "human-declared-not-independently-verified",
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set([
        value.sourceScript.id,
        value.sourceOutline.id,
        value.results.outline.id,
        value.results.script.id,
      ]).size !== 4
    )
      ctx.addIssue({
        code: "custom",
        message: "来源确认须保留四个独立原／新正式身份。",
      });
  });
