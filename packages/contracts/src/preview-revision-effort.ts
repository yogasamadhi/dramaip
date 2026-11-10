import { z } from "zod";

/** Actual saved candidate edits only; never model stages or inferred human effort. */
export const ChapterPreviewRevisionEffortSchema = z
  .object({
    format: z.literal("chapter-preview-revision-effort-v1"),
    projectId: z.string().uuid(),
    previewId: z.string().uuid(),
    chapterId: z.string().uuid(),
    taskId: z.string().uuid().optional(),
    rootPreviewId: z.string().uuid(),
    contentHash: z.string(),
    candidateSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    journalSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    status: z.enum(["pending", "committed", "discarded", "conflicted"]),
    coverage: z.enum(["complete", "partial", "untracked"]),
    observedContentUpdates: z.number().int().nonnegative(),
    observedRebases: z.number().int().nonnegative(),
    observedContentChangingRebases: z.number().int().nonnegative(),
    localRevisionCount: z.number().int().nonnegative().nullable(),
    scope: z.literal("exact-chapter-preview-chain"),
    qualityStatus: z.literal("unverified"),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.observedContentChangingRebases > value.observedRebases ||
      (value.coverage === "complete"
        ? value.localRevisionCount !==
          value.observedContentUpdates + value.observedContentChangingRebases
        : value.localRevisionCount !== null) ||
      (value.coverage === "untracked" &&
        (value.observedContentUpdates !== 0 || value.observedRebases !== 0))
    )
      context.addIssue({
        code: "custom",
        message:
          "Incomplete candidate history cannot establish a revision total.",
      });
  });
export type ChapterPreviewRevisionEffort = z.infer<
  typeof ChapterPreviewRevisionEffortSchema
>;
