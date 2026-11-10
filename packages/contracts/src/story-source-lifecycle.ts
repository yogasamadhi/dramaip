import { z } from "zod";

export const StorySourceRecordSchema = z
  .object({
    kind: z.enum(["node", "edge", "cognition"]),
    id: z.string().uuid(),
    version: z.number().int().nonnegative(),
  })
  .strict();
const transition = z
  .object({
    version: z.number().int().positive(),
    action: z.enum(["withdraw", "replace"]),
    reason: z.string().trim().min(1).max(2000),
    replacementId: z.string().uuid().optional(),
    createdAt: z.string().datetime(),
  })
  .strict();
export const StorySourceLifecycleSchema = z
  .object({
    state: z.enum(["active", "withdrawn", "replaced"]),
    version: z.number().int().nonnegative(),
    record: StorySourceRecordSchema,
    replacementId: z.string().uuid().optional(),
    transitions: z.array(transition).max(2),
  })
  .strict();
export const StorySourceLifecycleSummarySchema =
  StorySourceLifecycleSchema.omit({ transitions: true });
export const StorySourceWithdrawInputSchema = z
  .object({
    lifecycleVersion: z.number().int().nonnegative(),
    record: StorySourceRecordSchema,
    reason: z.string().trim().min(1).max(2000),
    confirmedRetirementReview: z.literal(true),
  })
  .strict();
export const StorySourceReplaceInputSchema =
  StorySourceWithdrawInputSchema.extend({
    replacement: z
      .object({
        id: z.string().uuid(),
        etag: z.string().regex(/^"[a-f0-9]{64}"$/u),
        sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
        confirmedSourceReview: z.literal(true),
        confirmedInterpretationReview: z.literal(true),
      })
      .strict(),
  });
export type StorySourceLifecycle = z.infer<typeof StorySourceLifecycleSchema>;
export type StorySourceWithdrawInput = z.infer<
  typeof StorySourceWithdrawInputSchema
>;
export type StorySourceReplaceInput = z.infer<
  typeof StorySourceReplaceInputSchema
>;
