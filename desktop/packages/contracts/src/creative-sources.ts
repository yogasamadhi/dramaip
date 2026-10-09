import { z } from "zod";

export const CREATIVE_SOURCE_CONFIRMATION_EVENTS = {
  workspace: "workspace.creation-source-confirmed.v1",
  production: "production.creation-source-confirmed.v1",
} as const;
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const version = z.number().int().nonnegative();
const binding = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("chapter"),
      sourceIndex: version,
      id: z.string().uuid(),
      version: z.literal(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal("script-record"),
      sourceIndex: version,
      id: z.string().uuid(),
      version: z.literal(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal("script-document"),
      sourceIndex: version,
      previewEntryId: z.string().uuid(),
      id: z.string().uuid(),
      version,
      scriptId: z.string().uuid(),
      scriptVersion: version,
    })
    .strict(),
]);
const source = z
  .object({
    eventVersion: z.literal(1),
    owner: z.enum(["workspace", "production"]),
    sourceId: z.string().uuid(),
    projectId: z.string().uuid(),
    projectVersion: version,
    projectMode: z.enum([
      "series_longform",
      "single_season",
      "personal_theater",
      "creator_channel",
    ]),
    // The actual project path is not a fabricated explicit goal confirmation.
    workflowPath: z.enum(["novel", "adaptation"]).nullable(),
    entry: z.enum(["ordinary-import", "native-screenplay-intake"]),
    sourceFormat: z.enum([
      "txt",
      "markdown",
      "docx",
      "epub",
      "script-json",
      "draft",
      "fountain",
      "fdx",
    ]),
    contentKind: z.enum(["novel", "script", "draft"]),
    scopePolicy: z.literal("confirmed-parsed-entries-not-entire-file"),
    entryCount: z.number().int().min(1).max(2000),
    sceneCount: version,
    bindingFingerprint: digest,
    receiptFingerprint: digest,
    rightsState: z.literal("declared-not-verified"),
    lossReportReviewed: z.literal(true).optional(),
    evidenceKind: z.literal("explicit-source-declaration-and-owner-commit"),
    modelEvidence: z.literal("unknown"),
    qualityState: z.literal("unverified"),
    currentValidity: z.literal("not-assessed"),
  })
  .strict()
  .superRefine((value, ctx) => {
    const path =
      value.projectMode === "series_longform"
        ? "novel"
        : value.projectMode === "single_season"
          ? "adaptation"
          : null;
    if (
      value.workflowPath !== path ||
      (value.owner === "production"
        ? value.entryCount > 1000 ||
          value.entry !== "native-screenplay-intake" ||
          value.projectMode !== "single_season" ||
          value.contentKind !== "script" ||
          !["fountain", "fdx", "script-json"].includes(value.sourceFormat) ||
          value.lossReportReviewed !== true
        : value.entry !== "ordinary-import" ||
          ["fountain", "fdx"].includes(value.sourceFormat) ||
          value.lossReportReviewed !== undefined) ||
      (value.contentKind !== "script" && value.sceneCount !== 0)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Source confirmation must preserve its actual owner, entry, project path and declarations.",
      });
  });
function checkBindings(
  value: {
    owner: "workspace" | "production";
    contentKind: "novel" | "script" | "draft";
    entries: z.infer<typeof binding>[];
  },
  ctx: z.RefinementCtx,
) {
  const expected =
    value.owner === "production"
      ? "script-document"
      : value.contentKind === "script"
        ? "script-record"
        : "chapter";
  const identities = value.entries.flatMap((entry) =>
    entry.kind === "script-document" ? [entry.id, entry.scriptId] : [entry.id],
  );
  const previews = value.entries
    .filter((entry) => entry.kind === "script-document")
    .map((entry) => entry.previewEntryId);
  if (
    value.entries.some(
      (entry, index) => entry.kind !== expected || entry.sourceIndex !== index,
    ) ||
    new Set(identities).size !== identities.length ||
    new Set(previews).size !== previews.length
  )
    ctx.addIssue({
      code: "custom",
      message:
        "Original entry order and actual owner identities must be complete and unique, not title matches.",
    });
}
export const CreativeSourceConfirmationFactSchema = source
  .safeExtend({ entries: z.array(binding).min(1).max(2000) })
  .superRefine((value, ctx) => {
    checkBindings(value, ctx);
    if (value.entries.length !== value.entryCount)
      ctx.addIssue({
        code: "custom",
        message:
          "A committed source fact requires every original entry binding.",
      });
  });
const envelope = {
  eventId: z.string().uuid(),
  cursor: z.number().int().positive(),
  occurredAt: z.string().datetime(),
};
export const CreativeSourceConfirmationRecordSchema =
  CreativeSourceConfirmationFactSchema.safeExtend(envelope);
// Summary only displays the first five ORIGINAL bindings; it never substitutes
// current children. The complete immutable binding remains in the local fact.
export const CreativeSourceConfirmationSummaryItemSchema = source
  .safeExtend({
    ...envelope,
    bindingDisplay: z.literal("first-five-original-bindings"),
    entries: z.array(binding).min(1).max(5),
  })
  .superRefine((value, ctx) => {
    checkBindings(value, ctx);
    if (value.entries.length !== Math.min(value.entryCount, 5))
      ctx.addIssue({
        code: "custom",
        message:
          "Displayed source bindings must be the exact bounded original prefix.",
      });
  });
export const CreativeSourceConfirmationSummarySchema = z
  .object({
    historyPolicy: z.literal("recorded-owner-source-confirmations-only"),
    unit: z.literal("owner-and-original-source-id"),
    recordedConfirmations: version,
    byWorkflow: z.tuple([
      z.object({ workflowPath: z.literal("novel"), total: version }).strict(),
      z
        .object({ workflowPath: z.literal("adaptation"), total: version })
        .strict(),
      z.object({ workflowPath: z.null(), total: version }).strict(),
    ]),
    items: z.array(CreativeSourceConfirmationSummaryItemSchema).max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.byWorkflow.reduce((sum, item) => sum + item.total, 0) !==
        value.recordedConfirmations ||
      value.items.length !== Math.min(value.recordedConfirmations, 20) ||
      new Set(value.items.map((item) => `${item.owner}:${item.sourceId}`))
        .size !== value.items.length ||
      new Set(value.items.map((item) => item.eventId)).size !==
        value.items.length ||
      value.items.some(
        (item, index) =>
          index > 0 && item.cursor >= value.items[index - 1]!.cursor,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Source history count, identity and bounded page must agree.",
      });
    for (const row of value.byWorkflow) {
      const observed = value.items.filter(
        (item) => item.workflowPath === row.workflowPath,
      ).length;
      if (
        value.recordedConfirmations <= 20
          ? observed !== row.total
          : observed > row.total
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Source workflow counts cannot change from displayed history.",
        });
    }
  });
export type CreativeSourceConfirmationFact = z.infer<
  typeof CreativeSourceConfirmationFactSchema
>;
export type CreativeSourceConfirmationRecord = z.infer<
  typeof CreativeSourceConfirmationRecordSchema
>;
