import { z } from "zod";
import { ProductionRecordBaselineObservationsSchema } from "./production-record-baseline.js";
import { StoryboardAttributionImpactSchema } from "./storyboard-attribution-impact.js";

const version = z.number().int().nonnegative();
export const EpisodeConstraintKindSchema = z.enum([
  "season-plan",
  "adaptation-diagnosis",
  "adaptation-strategy",
  "author-intent",
  "story-bible",
  "episode-outline",
  "episode-script",
  "direct-project",
  "direct-episode",
  "direct-source-script",
]);
const constraintSnapshot = z
  .object({
    id: z.string().uuid(),
    version,
    contentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
    position: version.optional(),
    documentVersion: version.nullable().optional(),
  })
  .strict();
export type EpisodeConstraintSnapshot = z.infer<typeof constraintSnapshot>;
/** Identity/observed-byte comparison only; missing hashes never prove content equality. */
export function episodeConstraintChange(input: {
  frozen: EpisodeConstraintSnapshot | null;
  current: EpisodeConstraintSnapshot | null;
  readState: "available" | "unavailable";
}) {
  if (input.readState === "unavailable") return "unavailable" as const;
  if (!input.frozen)
    return input.current ? ("added" as const) : ("unverified" as const);
  if (!input.current) return "removed" as const;
  if (input.frozen.id !== input.current.id) return "replaced" as const;
  if (
    input.frozen.version !== input.current.version ||
    input.frozen.position !== input.current.position ||
    input.frozen.documentVersion !== input.current.documentVersion ||
    (input.frozen.contentHash !== null &&
      input.current.contentHash !== null &&
      input.frozen.contentHash !== input.current.contentHash)
  )
    return "changed" as const;
  return "same-reference" as const;
}
export const EpisodeUpstreamConstraintSchema = z
  .object({
    kind: EpisodeConstraintKindSchema,
    frozen: constraintSnapshot.nullable(),
    current: constraintSnapshot.nullable(),
    readState: z.enum(["available", "unavailable"]),
    currentSourceState: z.enum(["current", "stale", "unverified"]).nullable(),
    change: z.enum([
      "same-reference",
      "changed",
      "replaced",
      "added",
      "removed",
      "unavailable",
      "unverified",
    ]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.change !== episodeConstraintChange(value) ||
      (value.readState === "unavailable" && value.current !== null) ||
      (value.current === null) !== (value.currentSourceState === null)
    )
      ctx.addIssue({
        code: "custom",
        message: "正式约束的实际读取、身份和变化状态不一致。",
      });
  });
export const EpisodeUpstreamConstraintsSchema = z
  .object({
    format: z.literal("formal-constraint-observations-v1"),
    items: z.array(EpisodeUpstreamConstraintSchema).min(1).max(5000),
    approvedStoryBible: z
      .object({
        frozenCount: version,
        currentCount: version.nullable(),
        readState: z.enum(["available", "unavailable"]),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const bible = value.items.filter((item) => item.kind === "story-bible");
    const ordinary = value.items.filter((item) => item.kind !== "story-bible");
    const frozen = bible.flatMap((item) => (item.frozen ? [item.frozen] : []));
    const current = bible.flatMap((item) =>
      item.current ? [item.current] : [],
    );
    const positions = (items: EpisodeConstraintSnapshot[]) =>
      items.every((item) => item.position !== undefined) &&
      JSON.stringify(
        items.map((item) => item.position).sort((a, b) => a! - b!),
      ) === JSON.stringify(items.map((_, index) => index));
    if (
      new Set(ordinary.map((item) => item.kind)).size !== ordinary.length ||
      new Set(bible.map((item) => item.frozen?.id ?? item.current?.id)).size !==
        bible.length ||
      bible.some(
        (item) =>
          (!item.frozen && !item.current) ||
          (item.frozen && item.current && item.frozen.id !== item.current.id) ||
          item.readState !== value.approvedStoryBible.readState,
      ) ||
      frozen.length !== value.approvedStoryBible.frozenCount ||
      !positions(frozen) ||
      (value.approvedStoryBible.readState === "available"
        ? value.approvedStoryBible.currentCount !== current.length ||
          !positions(current)
        : value.approvedStoryBible.currentCount !== null ||
          current.length !== 0)
    )
      ctx.addIssue({
        code: "custom",
        message: "正式约束身份或批准设定集合范围未核全，不伪造空目录。",
      });
  });
export type EpisodeUpstreamConstraint = z.infer<
  typeof EpisodeUpstreamConstraintSchema
>;
export type EpisodeUpstreamConstraints = z.infer<
  typeof EpisodeUpstreamConstraintsSchema
>;
export const EpisodeImpactReasonSchema = z.enum([
  "source-block-changed",
  "scene-structure-changed",
  "scene-context-changed",
  "scene-record-changed",
  "shot-record-changed",
  "record-unavailable",
  "mapping-unresolved",
  "upstream-not-localized",
]);
const formalRef = z.object({ id: z.string().uuid(), version }).strict();
/** Owner-verified provenance, not approval, semantic safety or automatic redo. */
export const EpisodeConfirmedSourceTransitionSchema = z
  .object({
    format: z.literal("verified-formal-source-transition-v1"),
    originalOutline: formalRef,
    originalScript: formalRef,
    currentOutline: formalRef,
    currentScript: formalRef,
    document: z
      .object({
        id: z.string().uuid(),
        scriptId: z.string().uuid(),
        version,
        contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict(),
    confirmationPreviews: z.array(formalRef).min(1).max(1000),
    completeAuthorReviewRequired: z.literal(true),
    semanticVerification: z.literal("unverified"),
  })
  .strict();
/** Read-only owner comparison. No prose or claims of semantic safety. */
export const EpisodeDevelopmentImpactSchema = z.object({
  result: z.object({ id: z.string().uuid(), version: version }),
  projectId: z.string().uuid(),
  episodeId: z.string(),
  isCurrent: z.boolean(),
  sourceState: z.enum(["current", "stale"]),
  staleReasons: z.array(z.string()),
  // Additive readonly projection. Old reports remain explicit about its absence.
  upstreamConstraints: EpisodeUpstreamConstraintsSchema.optional(),
  recordBaselines: ProductionRecordBaselineObservationsSchema.optional(),
  // Only when explicitly requested; never choose the current/latest association.
  attributionImpact: StoryboardAttributionImpactSchema.optional(),
  confirmedSourceTransition: EpisodeConfirmedSourceTransitionSchema.optional(),
  script: z.object({
    id: z.string().uuid().nullable(),
    result: z.object({ id: z.string().uuid(), version: version }).nullable(),
    frozenDocumentVersion: version.nullable(),
    currentDocumentVersion: version.nullable(),
  }),
  blockChanges: z.array(
    z.object({
      blockId: z.string().uuid(),
      kind: z.enum(["added", "removed", "changed", "reordered"]),
      fields: z.array(z.enum(["type", "text", "sceneNumber", "order"])),
      beforeHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/u)
        .nullable(),
      afterHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/u)
        .nullable(),
    }),
  ),
  shots: z.array(
    z.object({
      sceneId: z.string(),
      shotId: z.string(),
      record: z
        .object({
          id: z.string().uuid(),
          frozenVersion: version,
          currentVersion: version.nullable(),
        })
        .nullable(),
      associationImpact: z.enum([
        "affected",
        "no-observed-change",
        "unresolved",
      ]),
      changedBlockIds: z.array(z.string().uuid()),
      reasonCodes: z.array(EpisodeImpactReasonSchema),
    }),
  ),
  globalReviewReasons: z.array(z.string()),
  comparison: z.literal(
    "frozen-script-to-actual-document-and-record-versions-v1",
  ),
  semanticVerification: z.literal("unverified"),
  automaticRedo: z.literal(false),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
});
export type EpisodeImpactReason = z.infer<typeof EpisodeImpactReasonSchema>;
export type EpisodeDevelopmentImpact = z.infer<
  typeof EpisodeDevelopmentImpactSchema
>;
