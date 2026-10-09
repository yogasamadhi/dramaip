import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";
import {
  NarrativeQualityRequestSchema,
  NarrativeQualityDimensionSchema,
  NarrativeQualityProductionBasisSchema,
} from "./narrative-quality.js";
const uuid = z.string().uuid(),
  version = z.number().int().nonnegative(),
  hash = z.string().regex(/^[a-f0-9]{64}$/u),
  opaque = z
    .string()
    .max(64)
    .regex(/^[\p{L}\p{N}][\p{L}\p{N}._:-]*$/u);
const field = z.union([
  z
    .string()
    .max(1000)
    .regex(
      /^\/(?:project|projects|chapters|characters|outlines|story-arcs|writing-resources|intent|selection|production|scripts|screenplays|knowledge|author-intents|narrative-summaries|narrative-story-index|story-declarations|story-assertions|story-bible|review|delivery|creator-content|preferences|profile)(?:\/[^\p{Cc}\\:%]*)?$/u,
    )
    .refine((value) => !value.includes("..") && !value.includes("//")),
  z
    .string()
    .regex(
      /^\/chapters\/([a-f0-9-]{36})\/paragraphs\/\1%40\d+%3A\d+-\d+%3A[a-f0-9]{12}$/u,
    ),
]);
const request = NarrativeQualityRequestSchema.superRefine((value, check) => {
  for (const chapter of value.context?.chapters ?? [])
    if (chapter.representation === "paragraphs")
      for (const id of chapter.paragraphIds)
        if (
          !new RegExp(
            "^" +
              chapter.id +
              "@" +
              chapter.version +
              ":\\d+-\\d+:[a-f0-9]{12}$",
            "u",
          ).test(id)
        )
          check.addIssue({
            code: "custom",
            message: "质量原段落身份须绑定原章节版本。",
          });
});
const reference = z
  .object({
    sourceKind: z.enum(["chapter", "author_intent", "production", "knowledge"]),
    sourceId: uuid,
    sourceVersion: version,
    fieldPath: field,
    contentHash: hash,
  })
  .strict();
const evidence = z
  .object({
    sourceId: uuid,
    sourceVersion: version,
    fieldPath: field,
    valuePath: z
      .string()
      .max(1000)
      .regex(/^\/(?:[^\p{Cc}\\:]*)$/u)
      .refine((value) => !value.includes("..") && !value.includes("//")),
    quoteHash: hash,
    quoteCharacters: z.number().int().positive(),
  })
  .strict();
const issue = z
  .object({
    id: opaque,
    category: NarrativeQualityDimensionSchema,
    severity: z.enum(["error", "warning", "suggestion"]),
    source: z.enum(["model", "human", "rule"]),
    ruleId: z.literal("literal-repeated-passage-v1").optional(),
    evidence: z.array(evidence).min(1).max(12),
  })
  .strict();
const disposition = z
  .object({
    issueId: opaque,
    state: z.enum(["open", "accepted-risk", "resolved"]),
    source: z.enum(["human", "human-declared"]),
    recheckReportId: uuid.optional(),
    recheckReviewId: uuid.optional(),
    decidedAt: z.string().datetime(),
  })
  .strict();
const coverage = z
  .object({
    mode: z.enum(["selection", "full"]),
    included: z.array(
      z
        .object({
          id: uuid,
          version,
          representations: z
            .array(
              z.enum([
                "original",
                "summary",
                "paragraphs",
                "hierarchical-summary",
              ]),
            )
            .optional(),
        })
        .strict(),
    ),
    excluded: z.array(
      z
        .object({
          id: uuid,
          version,
          reason: z.enum(["not-selected", "empty"]),
        })
        .strict(),
    ),
    totalChapterCount: version,
    nonEmptyChapterCount: version,
  })
  .strict();
const basis = z
  .object({
    request,
    references: z.array(reference).min(1),
    chapterCoverage: coverage.optional(),
    productionSourceBasis: NarrativeQualityProductionBasisSchema.optional(),
  })
  .strict();
const common = {
  id: uuid,
  projectId: uuid,
  version,
  status: z.enum(["awaiting-review", "adopted", "discarded"]),
  basis,
  reviewedDimensions: z
    .array(NarrativeQualityDimensionSchema)
    .min(1)
    .optional(),
  checkedRules: z
    .array(z.literal("literal-repeated-passage-v1"))
    .length(1)
    .optional(),
  semanticCoverage: z.literal("not-assessed").optional(),
  reviewedChapters: z
    .array(z.object({ id: uuid, version }).strict())
    .optional(),
  reviewedSources: z
    .array(reference.omit({ sourceKind: true, contentHash: true }).strict())
    .optional(),
  issues: z.array(issue),
  dispositions: z.array(disposition),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  adoptedAt: z.string().datetime().optional(),
  fingerprint: z
    .object({
      format: z.literal("derived-original-quality-value-json-bytes-v1"),
      sha256: hash,
    })
    .strict(),
  observation: z.literal("saved-quality-owner-row-not-full-state-history"),
  semanticVerification: z.literal("unverified"),
};
export const QualityProjectLineageItemSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...common,
        kind: z.literal("model-report"),
        workflowId: uuid,
        baseReportId: uuid.nullable(),
        sourceSnapshotId: uuid,
        runIds: z.array(uuid).min(1),
        engineKind: z.enum(["codex", "pi", "langgraph"]),
        usage: z.object({ state: z.literal("unknown") }).strict(),
        contextBudget: z
          .object({
            source: z.literal("estimate"),
            estimatedTokens: version,
            tokenBudget: z.number().int().positive(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    z
      .object({
        ...common,
        kind: z.literal("local-review"),
        origin: z.enum(["human-declared", "rule"]),
        sourceFingerprint: hash,
        baseReviewId: uuid.nullable(),
        qualityState: z.literal("unverified"),
      })
      .strict(),
  ])
  .superRefine((value, check) => {
    const rule = value.kind === "local-review" && value.origin === "rule";
    if (
      rule
        ? !value.checkedRules ||
          !value.semanticCoverage ||
          !!value.reviewedDimensions
        : !value.reviewedDimensions ||
          !!value.checkedRules ||
          !!value.semanticCoverage
    )
      check.addIssue({
        code: "custom",
        message: "字面规则不能补造语义维度，人工／模型评议声明须原样区分。",
      });
    if (
      (value.basis.request.target.kind === "chapter-set" &&
        value.basis.request.target.id !== value.projectId) ||
      (value.basis.productionSourceBasis &&
        value.basis.productionSourceBasis.projectId !== value.projectId)
    )
      check.addIssue({ code: "custom", message: "质量目标与原项目须一致。" });
    const keys = value.basis.references.map((ref) =>
      JSON.stringify([
        ref.sourceKind,
        ref.sourceId,
        ref.sourceVersion,
        ref.fieldPath,
      ]),
    );
    if (new Set(keys).size !== keys.length)
      check.addIssue({ code: "custom", message: "原质量引用不能重复。" });
    const ids = new Set(value.issues.map((item) => item.id));
    if (
      ids.size !== value.issues.length ||
      new Set(value.dispositions.map((item) => item.issueId)).size !==
        value.dispositions.length ||
      value.dispositions.some((item) => !ids.has(item.issueId))
    )
      check.addIssue({
        code: "custom",
        message: "质量问题／原决定须独立绑定。",
      });
    for (const item of value.issues)
      for (const ref of item.evidence)
        if (
          !value.basis.references.some(
            (source) =>
              source.sourceId === ref.sourceId &&
              source.sourceVersion === ref.sourceVersion &&
              source.fieldPath === ref.fieldPath,
          )
        )
          check.addIssue({
            code: "custom",
            message: "原问题证据不能换源或缺失。",
          });
  });
export type QualityProjectLineageItem = z.infer<
  typeof QualityProjectLineageItemSchema
>;
export const QualityProjectLineageCategorySchema = z.enum([
  "reports",
  "localReviews",
]);
export type QualityProjectLineageCategory = z.infer<
  typeof QualityProjectLineageCategorySchema
>;
export const QualityProjectLineagePageSchema = z
  .object({
    category: QualityProjectLineageCategorySchema,
    items: z.array(QualityProjectLineageItemSchema),
    nextCursor: uuid.optional(),
  })
  .strict();
export const QUALITY_PROJECT_LINEAGE_SERVICE = defineServiceContract<{
  list(
    projectId: string,
    category: QualityProjectLineageCategory,
    options: { cursor?: string; limit: number },
  ): z.infer<typeof QualityProjectLineagePageSchema>;
}>({
  id: "creative-quality.project-lineage.v1",
  owner: "creative-quality",
  major: 1,
  capabilities: ["read"],
  degradable: true,
});
export const QualityProjectPackageLineageSchema = z.discriminatedUnion(
  "state",
  [
    z
      .object({
        state: z.literal("available"),
        coverage: z.literal("recorded-quality-model-and-local-owner-rows-only"),
        reports: z.array(QualityProjectLineageItemSchema),
        localReviews: z.array(QualityProjectLineageItemSchema),
      })
      .strict(),
    z.object({ state: z.literal("unavailable") }).strict(),
  ],
);
