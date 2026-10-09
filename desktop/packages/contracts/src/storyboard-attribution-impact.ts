import { z } from "zod";
import { StoryNodeObservationSchema } from "./story-node-observation.js";
import {
  StoryboardAttributionCoverageSchema,
  StoryboardAttributionLinkSchema,
} from "./storyboard-attribution.js";

const ref = z
  .object({ id: z.string().uuid(), version: z.number().int().nonnegative() })
  .strict();
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
export const StoryboardAttributionImpactSelectionSchema = ref;
export const StoryboardAttributionImpactQuerySchema = z
  .object({
    attributionId: ref.shape.id.optional(),
    attributionVersion: z
      .string()
      .regex(/^(0|[1-9]\d*)$/u)
      .transform(Number)
      .pipe(ref.shape.version.max(Number.MAX_SAFE_INTEGER))
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.attributionId === undefined) !==
      (value.attributionVersion === undefined)
    )
      ctx.addIssue({
        code: "custom",
        message: "影响观察须明确原关联 ID 和版本，不默认最新。",
      });
  });
const block = z
  .object({
    id: z.string().uuid(),
    index: z.number().int().nonnegative(),
    type: z.string().min(1),
    contentHash: sha,
  })
  .strict();
const record = ref.extend({ contentHash: sha, retired: z.boolean() }).strict();
const recordObservation = z
  .object({
    frozen: ref.extend({ contentHash: sha }).strict(),
    current: record.nullable(),
    readState: z.enum(["available", "unavailable"]),
    change: z.enum([
      "same-reference",
      "changed",
      "missing",
      "retired",
      "unavailable",
    ]),
  })
  .strict()
  .superRefine((v, ctx) => {
    const change =
      v.readState === "unavailable"
        ? "unavailable"
        : !v.current
          ? "missing"
          : v.current.retired
            ? "retired"
            : v.current.version !== v.frozen.version ||
                v.current.contentHash !== v.frozen.contentHash
              ? "changed"
              : "same-reference";
    if (
      v.change !== change ||
      (v.current && v.current.id !== v.frozen.id) ||
      (v.readState === "unavailable" && v.current)
    )
      ctx.addIssue({ code: "custom", message: "原场景／镜头实际观察不一致。" });
  });
export const StoryboardAttributionImpactReasonSchema = z.enum([
  "original-source-unverified",
  "source-read-unavailable",
  "source-missing",
  "source-expression-unverified",
  "source-version-changed",
  "quote-position-changed",
  "source-block-missing",
  "source-block-reordered",
  "source-block-type-changed",
  "source-paragraph-missing",
  "source-paragraph-position-changed",
  "script-block-unavailable",
  "script-block-missing",
  "script-block-changed",
  "script-block-reordered",
  "scene-record-unavailable",
  "scene-record-missing",
  "scene-record-changed",
  "scene-record-retired",
  "shot-record-unavailable",
  "shot-record-missing",
  "shot-record-changed",
  "shot-record-retired",
  "story-node-unavailable",
  "story-node-reference-changed",
  ...StoryNodeObservationSchema.shape.reasonCodes.element.options,
]);
const unknownReasons = new Set<
  z.infer<typeof StoryboardAttributionImpactReasonSchema>
>([
  "original-source-unverified",
  "source-read-unavailable",
  "source-expression-unverified",
  "script-block-unavailable",
  "scene-record-unavailable",
  "shot-record-unavailable",
  "story-node-unavailable",
  "declaration-source-unavailable",
]);
export function attributionImpactState(
  reasons: readonly z.infer<typeof StoryboardAttributionImpactReasonSchema>[],
) {
  return reasons.some((reason) => unknownReasons.has(reason))
    ? ("unresolved" as const)
    : reasons.length
      ? ("affected" as const)
      : ("no-observed-change" as const);
}
export const StoryboardAttributionImpactLinkSchema = z
  .object({
    index: z.number().int().nonnegative(),
    original: StoryboardAttributionLinkSchema,
    quote: z
      .object({
        frozenVerified: z.boolean(),
        readState: z.enum([
          "available",
          "missing",
          "unavailable",
          "unverified",
        ]),
        currentSourceVersion: z.number().int().nonnegative().nullable(),
        expressionHash: sha.nullable(),
        currentSliceHash: sha.nullable(),
        comparison: z.enum([
          "same-position-match",
          "position-changed",
          "missing",
          "unavailable",
          "unverified",
        ]),
        sourceBlock: z
          .object({
            id: z.string().uuid(),
            index: z.number().int().nonnegative(),
            type: z.string().min(1),
          })
          .strict()
          .nullable(),
        paragraph: z
          .object({
            id: z.string().min(1),
            present: z.boolean(),
            start: z.number().int().nonnegative().nullable(),
            end: z.number().int().positive().nullable(),
          })
          .strict()
          .nullable(),
      })
      .strict(),
    blocks: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            frozen: block.nullable(),
            current: block.nullable(),
            readState: z.enum(["available", "unavailable"]),
            change: z.enum([
              "same-reference",
              "changed",
              "reordered",
              "missing",
              "unavailable",
            ]),
          })
          .strict(),
      )
      .min(1)
      .max(10000),
    records: z
      .object({ scene: recordObservation, shot: recordObservation })
      .strict(),
    node: z
      .object({
        readState: z.enum(["available", "unavailable"]),
        observation: StoryNodeObservationSchema.nullable(),
        referenceComparison: z.enum([
          "same-reference",
          "changed",
          "unavailable",
        ]),
      })
      .strict()
      .nullable(),
    reasonCodes: z.array(StoryboardAttributionImpactReasonSchema).max(1000),
    associationImpact: z.enum(["affected", "no-observed-change", "unresolved"]),
  })
  .strict()
  .superRefine((link, ctx) => {
    const q = link.quote,
      evidence = link.original.evidence;
    const comparison = !q.frozenVerified
      ? "unverified"
      : q.readState === "unavailable"
        ? "unavailable"
        : q.readState === "missing"
          ? "missing"
          : q.readState !== "available" || !q.expressionHash
            ? "unverified"
            : q.currentSliceHash === evidence.quoteHash
              ? "same-position-match"
              : "position-changed";
    let invalid =
      q.comparison !== comparison ||
      (q.readState !== "available" &&
        (q.expressionHash !== null || q.currentSliceHash !== null)) ||
      (q.readState === "available" && q.currentSourceVersion === null) ||
      (q.readState === "available" &&
        evidence.sourceBlockId &&
        !q.sourceBlock) ||
      (q.readState === "available" && evidence.paragraphId && !q.paragraph) ||
      (q.sourceBlock && q.sourceBlock.id !== evidence.sourceBlockId) ||
      (q.paragraph &&
        (q.paragraph.id !== evidence.paragraphId ||
          (q.paragraph.start !== null &&
            q.paragraph.end !== null &&
            q.paragraph.end <= q.paragraph.start) ||
          q.paragraph.present !==
            (q.paragraph.start !== null && q.paragraph.end !== null))) ||
      link.associationImpact !== attributionImpactState(link.reasonCodes);
    const needs = (
      code: z.infer<typeof StoryboardAttributionImpactReasonSchema>,
      required: boolean,
    ) => {
      if (required && !link.reasonCodes.includes(code)) invalid = true;
    };
    needs("original-source-unverified", !q.frozenVerified);
    needs("source-read-unavailable", q.readState === "unavailable");
    needs("source-missing", q.readState === "missing");
    needs(
      "source-expression-unverified",
      q.readState === "unverified" ||
        (q.readState === "available" && !q.expressionHash),
    );
    needs(
      "source-block-missing",
      Boolean(evidence.sourceBlockId && q.readState === "missing"),
    );
    needs(
      "source-block-type-changed",
      Boolean(
        q.sourceBlock && !["action", "dialogue"].includes(q.sourceBlock.type),
      ),
    );
    const originalBlockIndex = /^\/blocks\/(0|[1-9]\d*)\/text$/u.exec(
      evidence.valuePath,
    );
    needs(
      "source-block-reordered",
      Boolean(
        q.sourceBlock &&
        originalBlockIndex &&
        q.sourceBlock.index !== Number(originalBlockIndex[1]),
      ),
    );
    needs(
      "source-paragraph-missing",
      Boolean(q.paragraph && !q.paragraph.present),
    );
    needs(
      "source-paragraph-position-changed",
      Boolean(
        q.paragraph?.present &&
        q.paragraph.start !==
          evidence.match.chapterStart! - evidence.match.start,
      ),
    );
    needs(
      "source-version-changed",
      q.currentSourceVersion !== null &&
        q.currentSourceVersion !== evidence.source.sourceVersion,
    );
    needs(
      "quote-position-changed",
      q.frozenVerified &&
        q.readState === "available" &&
        q.currentSliceHash !== evidence.quoteHash,
    );
    link.blocks.forEach((b) => {
      const change =
        b.readState === "unavailable" || !b.frozen
          ? "unavailable"
          : !b.current
            ? "missing"
            : b.frozen.contentHash !== b.current.contentHash
              ? "changed"
              : b.frozen.index !== b.current.index
                ? "reordered"
                : "same-reference";
      if (
        b.change !== change ||
        (b.current && b.current.id !== b.id) ||
        (b.frozen && b.frozen.id !== b.id) ||
        (b.readState === "unavailable" && b.current)
      )
        invalid = true;
      if (change !== "same-reference") needs(`script-block-${change}`, true);
      needs(
        "script-block-reordered",
        Boolean(b.frozen && b.current && b.frozen.index !== b.current.index),
      );
    });
    for (const name of ["scene", "shot"] as const) {
      const change = link.records[name].change;
      if (change !== "same-reference") needs(`${name}-record-${change}`, true);
    }
    needs("story-node-unavailable", link.node?.readState === "unavailable");
    needs(
      "story-node-reference-changed",
      link.node?.referenceComparison === "changed",
    );
    for (const code of link.node?.observation?.reasonCodes ?? [])
      needs(code, true);
    if (invalid)
      ctx.addIssue({
        code: "custom",
        message:
          "实际读取、原位置、稳定块和未核全状态必须一致，不能伪称未变化。",
      });
  });
/** Original adopted version only. No text, private rationale, replacement binding or semantic assurance. */
export const StoryboardAttributionImpactSchema = z
  .object({
    format: z.literal("exact-shot-attribution-impact-v1"),
    projectId: z.string().uuid(),
    episodeId: z.string().min(1).max(64),
    attribution: ref,
    storyboard: ref,
    isCurrent: z.boolean(),
    sourceFingerprint: sha,
    associationFingerprint: sha,
    coverage: StoryboardAttributionCoverageSchema,
    links: z.array(StoryboardAttributionImpactLinkSchema).min(1).max(1000),
    textIncluded: z.literal(false),
    semanticVerification: z.literal("unverified"),
    automaticRedo: z.literal(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    const associated = new Set(value.links.map((link) => link.original.shotId));
    const nodeAssociated = new Set(
      value.links
        .filter((link) => link.original.storyNode)
        .map((link) => link.original.shotId),
    );
    const blocks = new Set(
      value.links.flatMap((link) => link.original.blockIds),
    );
    if (
      value.coverage.associatedShots !== associated.size ||
      value.coverage.nodeAssociatedShots !== nodeAssociated.size ||
      value.coverage.associatedBlockCount !== blocks.size ||
      value.coverage.totalShots !==
        associated.size + value.coverage.unassociatedShotIds.length ||
      new Set(value.coverage.unassociatedShotIds).size !==
        value.coverage.unassociatedShotIds.length ||
      value.coverage.unassociatedShotIds.some((id) => associated.has(id))
    )
      ctx.addIssue({
        code: "custom",
        message: "原关联覆盖须保留明确链接与未关联镜头，不补造全量覆盖。",
      });
    value.links.forEach((link, index) => {
      const node = link.original.storyNode;
      if (
        link.index !== index ||
        JSON.stringify(link.blocks.map((b) => b.id)) !==
          JSON.stringify(link.original.blockIds) ||
        Boolean(node) !== Boolean(link.node) ||
        new Set(link.reasonCodes).size !== link.reasonCodes.length ||
        (link.node?.observation &&
          (link.node.observation.projectId !== value.projectId ||
            JSON.stringify(link.node.observation.requested) !==
              JSON.stringify({
                declaration: node!.declaration,
                node: node!.node,
              }))) ||
        (link.node?.readState === "unavailable" &&
          (link.node.observation ||
            link.node.referenceComparison !== "unavailable")) ||
        (link.node?.readState === "available" &&
          (!link.node.observation ||
            link.node.referenceComparison !==
              (link.node.observation.referenceHash === node!.referenceHash
                ? "same-reference"
                : "changed")))
      )
        ctx.addIssue({
          code: "custom",
          path: ["links", index],
          message: "影响观察必须保持原链接与原节点绑定，不取最新或缓存。",
        });
    });
  });
export type StoryboardAttributionImpactSelection = z.infer<
  typeof StoryboardAttributionImpactSelectionSchema
>;
export type StoryboardAttributionImpact = z.infer<
  typeof StoryboardAttributionImpactSchema
>;
export type StoryboardAttributionImpactLink = z.infer<
  typeof StoryboardAttributionImpactLinkSchema
>;
export type StoryboardAttributionImpactReason = z.infer<
  typeof StoryboardAttributionImpactReasonSchema
>;
