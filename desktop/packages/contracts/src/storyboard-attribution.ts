import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";
import { EpisodeSceneEvidenceSchema } from "./episode-development.js";

const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const stableId = z.string().trim().min(1).max(64);
const ref = z
  .object({ id: z.string().uuid(), version: z.number().int().nonnegative() })
  .strict();
const frozenResult = ref
  .extend({ contentHash: sha, sourceSnapshotId: z.string().uuid() })
  .strict();
const actualRecord = ref.extend({ contentHash: sha }).strict();
const document = ref
  .extend({
    scriptId: z.string().uuid(),
    scriptVersion: z.number().int().nonnegative(),
    contentHash: sha,
  })
  .strict();
const block = z
  .object({
    id: z.string().uuid(),
    index: z.number().int().nonnegative(),
    type: z.enum([
      "scene_heading",
      "action",
      "character",
      "dialogue",
      "parenthetical",
      "transition",
      "note",
      "page_break",
    ]),
  })
  .strict();

/** Owner observations, not source bodies, semantic proof or a model workflow. */
export const StoryboardAttributionSourceSchema = z
  .object({
    format: z.literal("exact-shot-attribution-source-v1"),
    projectId: z.string().uuid(),
    episodeId: stableId,
    storyboard: frozenResult,
    outline: frozenResult,
    script: frozenResult,
    document,
    // Observed now, never backfilled as a document identity in a historic run.
    originalScriptDocument: document.optional(),
    chapters: z.array(ref.extend({ contentHash: sha }).strict()).max(1000),
    scriptBlocks: z.array(block).min(2).max(10000),
    shots: z
      .array(
        z
          .object({
            sceneId: stableId,
            shotId: stableId,
            sceneRecord: actualRecord,
            shotRecord: actualRecord,
            sourceBlockIds: z.array(z.string().uuid()).min(1).max(10000),
          })
          .strict(),
      )
      .min(1)
      .max(60000),
    evidence: z.array(EpisodeSceneEvidenceSchema).min(1).max(6000),
    sourceFingerprint: sha,
    // Adoption competition is separate: adopting this candidate cannot change its source hash.
    baseAttributionId: z.string().uuid().nullable(),
    semanticVerification: z.literal("unverified"),
  })
  .strict();

export const StoryboardAttributionSelectionSchema = z
  .object({
    sceneId: stableId,
    shotId: stableId,
    blockIds: z.array(z.string().uuid()).min(1).max(10000),
    evidenceId: stableId,
    matchIndex: z.number().int().nonnegative().max(999),
    storyNode: ref.optional(),
    rationale: z.string().trim().min(1).max(4000),
  })
  .strict();
export const StoryboardAttributionCreateSchema = z
  .object({
    storyboard: ref,
    sourceFingerprint: sha,
    baseAttributionId: z.string().uuid().nullable(),
    selections: z.array(StoryboardAttributionSelectionSchema).min(1).max(1000),
  })
  .strict()
  .superRefine((value, ctx) => {
    const keys = value.selections.map(
      ({ sceneId, shotId, evidenceId, matchIndex, storyNode }) =>
        JSON.stringify([
          sceneId,
          shotId,
          evidenceId,
          matchIndex,
          storyNode ?? null,
        ]),
    );
    if (
      new Set(keys).size !== keys.length ||
      value.selections.some(
        (s) => new Set(s.blockIds).size !== s.blockIds.length,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "同一镜头的具体引文位置／节点不能重复，实际剧本块也不能重复。",
      });
  });
const nodeBinding = z
  .object({
    node: ref,
    declaration: ref,
    referenceHash: sha,
    linkKind: z.enum([
      "chapter-position",
      "screenplay-block",
      "adopted-fact-record-not-original-quote-position",
    ]),
    semanticVerification: z.literal("unverified"),
  })
  .strict();
export const StoryboardAttributionLinkSchema = z
  .object({
    sceneId: stableId,
    shotId: stableId,
    blockIds: z.array(z.string().uuid()).min(1).max(10000),
    evidenceId: stableId,
    matchIndex: z.number().int().nonnegative().max(999),
    evidence: EpisodeSceneEvidenceSchema.omit({ matches: true })
      .extend({
        match: EpisodeSceneEvidenceSchema.shape.matches.element,
      })
      .strict(),
    storyNode: nodeBinding.optional(),
    attribution: z.literal("human-declared"),
    matchVerification: z.literal("rule"),
    semanticVerification: z.literal("unverified"),
  })
  .strict();
export const StoryboardAttributionCoverageSchema = z
  .object({
    totalShots: z.number().int().positive(),
    associatedShots: z.number().int().positive(),
    nodeAssociatedShots: z.number().int().nonnegative(),
    associatedBlockCount: z.number().int().positive(),
    unassociatedShotIds: z.array(stableId).max(60000),
  })
  .strict();
export const StoryboardAttributionSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    version: z.number().int().nonnegative(),
    status: z.enum(["pending", "adopted", "discarded"]),
    origin: z.literal("human-declared"),
    input: StoryboardAttributionCreateSchema,
    source: StoryboardAttributionSourceSchema,
    links: z.array(StoryboardAttributionLinkSchema).min(1).max(1000),
    coverage: StoryboardAttributionCoverageSchema,
    associationFingerprint: sha,
    isCurrent: z.boolean(),
    sourceState: z.enum(["current", "stale", "unavailable"]),
    sourceReasons: z.array(z.string()),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    adoptedAt: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.projectId !== value.source.projectId ||
      value.input.storyboard.id !== value.source.storyboard.id ||
      value.input.storyboard.version !== value.source.storyboard.version ||
      value.input.sourceFingerprint !== value.source.sourceFingerprint ||
      value.input.baseAttributionId !== value.source.baseAttributionId ||
      value.input.selections.length !== value.links.length ||
      (value.status === "adopted") !== Boolean(value.adoptedAt) ||
      (value.isCurrent && value.status !== "adopted")
    )
      ctx.addIssue({
        code: "custom",
        message:
          "独立人工关联必须保留原输入、来源与实际采用身份，不补造模型运行。",
      });
    const associated = new Set(value.links.map((link) => link.shotId));
    const nodeAssociated = new Set(
      value.links.filter((link) => link.storyNode).map((link) => link.shotId),
    );
    const blocks = new Set(value.links.flatMap((link) => link.blockIds));
    const unassociated = value.source.shots
      .filter((shot) => !associated.has(shot.shotId))
      .map((shot) => shot.shotId);
    if (
      value.coverage.totalShots !== value.source.shots.length ||
      value.coverage.associatedShots !== associated.size ||
      value.coverage.nodeAssociatedShots !== nodeAssociated.size ||
      value.coverage.associatedBlockCount !== blocks.size ||
      JSON.stringify(value.coverage.unassociatedShotIds) !==
        JSON.stringify(unassociated)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "实际关联／未关联覆盖必须来自原镜头集合，不将场景继承算作全部镜头通过。",
      });
    value.links.forEach((link, index) => {
      const selection = value.input.selections[index];
      const shot = value.source.shots.find(
        (shot) => shot.sceneId === link.sceneId && shot.shotId === link.shotId,
      );
      const evidence = value.source.evidence.find(
        (evidence) =>
          evidence.sceneId === link.sceneId &&
          evidence.evidenceId === link.evidenceId,
      );
      const match = evidence?.matches[link.matchIndex];
      const { matches: _matches, ...identity } = evidence ?? {};
      if (
        !selection ||
        !shot ||
        !evidence ||
        !match ||
        selection.sceneId !== link.sceneId ||
        selection.shotId !== link.shotId ||
        selection.evidenceId !== link.evidenceId ||
        selection.matchIndex !== link.matchIndex ||
        JSON.stringify(selection.blockIds) !== JSON.stringify(link.blockIds) ||
        link.blockIds.some((id) => !shot.sourceBlockIds.includes(id)) ||
        JSON.stringify({ ...identity, match }) !==
          JSON.stringify(link.evidence) ||
        JSON.stringify(selection.storyNode ?? null) !==
          JSON.stringify(link.storyNode?.node ?? null)
      )
        ctx.addIssue({
          code: "custom",
          path: ["links", index],
          message:
            "关联回执须保持明确镜头／稳定块／具体引文位置与实际节点，不能换成场景级证据。",
        });
    });
  });
export const StoryboardAttributionDecisionSchema = z
  .object({
    version: z.number().int().nonnegative(),
    sourceFingerprint: sha,
    associationFingerprint: sha,
    action: z.enum(["adopt", "discard"]),
    actualSourcesReviewed: z.literal(true),
    exactShotLinksReviewed: z.literal(true),
    unverifiedSemanticsAcknowledged: z.literal(true),
  })
  .strict();
export const StoryboardAttributionPageSchema = z
  .object({
    projectId: z.string().uuid(),
    items: z.array(StoryboardAttributionSchema).max(100),
    nextCursor: z.string().uuid().optional(),
  })
  .strict();
/** Navigation and optional-package selection must not read private review bodies. */
export const StoryboardAttributionSummarySchema = z
  .object({
    id: ref.shape.id,
    projectId: z.string().uuid(),
    episodeId: stableId,
    version: ref.shape.version,
    status: StoryboardAttributionSchema.shape.status,
    storyboard: ref,
    outline: ref,
    script: ref,
    coverage: StoryboardAttributionCoverageSchema,
    sourceFingerprint: sha,
    associationFingerprint: sha,
    isCurrent: z.boolean(),
    sourceState: StoryboardAttributionSchema.shape.sourceState,
    sourceReasons: z.array(z.string()),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const StoryboardAttributionSummaryPageSchema = z
  .object({
    projectId: z.string().uuid(),
    items: z.array(StoryboardAttributionSummarySchema).max(100),
    nextCursor: z.string().uuid().optional(),
  })
  .strict();
export type StoryboardAttributionSummary = z.infer<
  typeof StoryboardAttributionSummarySchema
>;
/** Whitelist for an explicitly selected adopted version. No input/rationale,
 * source prose, declaration statement, prompt or invented model provenance. */
export const StoryboardAttributionExportSchema = z
  .object({
    format: z.literal("confirmed-shot-attributions-v1"),
    projectId: z.string().uuid(),
    episodeId: stableId,
    attribution: ref,
    storyboard: ref,
    outline: ref,
    script: ref,
    sourceFingerprint: sha,
    associationFingerprint: sha,
    coverage: StoryboardAttributionCoverageSchema,
    links: z.array(StoryboardAttributionLinkSchema).min(1).max(1000),
    origin: z.literal("human-declared"),
    textIncluded: z.literal(false),
    semanticVerification: z.literal("unverified"),
  })
  .strict();
export type StoryboardAttributionExport = z.infer<
  typeof StoryboardAttributionExportSchema
>;
export type StoryboardAttributionSource = z.infer<
  typeof StoryboardAttributionSourceSchema
>;
export type StoryboardAttributionSelection = z.infer<
  typeof StoryboardAttributionSelectionSchema
>;
export type StoryboardAttributionCreate = z.infer<
  typeof StoryboardAttributionCreateSchema
>;
export type StoryboardAttributionLink = z.infer<
  typeof StoryboardAttributionLinkSchema
>;
export type StoryboardAttribution = z.infer<typeof StoryboardAttributionSchema>;
export type StoryboardAttributionDecision = z.infer<
  typeof StoryboardAttributionDecisionSchema
>;
export const PRODUCTION_STORYBOARD_ATTRIBUTION_SERVICE = defineServiceContract<{
  get(projectId: string, id: string): StoryboardAttribution | undefined;
}>({
  id: "production.storyboard-attributions.v1",
  owner: "production",
  major: 1,
  capabilities: ["read"],
  degradable: true,
});
