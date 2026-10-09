import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";
import type { CreationAdapter } from "./creation.js";
import {
  NarrativeContextRequestSchema,
  NarrativeSourceBasisSchema,
  refineNarrativeSourceSelection,
} from "./narrative-context.js";

const ref = z.object({
  id: z.string().uuid(),
  version: z.number().int().nonnegative(),
});
/** A failed owner commit is retryable; it is not a source/version conflict. */
export class NarrativeQualityCommitError extends Error {
  readonly code = "NARRATIVE_QUALITY_COMMIT_FAILED";
  constructor() {
    super("质量报告采用事务未提交；原候选保留，可重试原操作。");
  }
}
export const NarrativeQualityDimensionSchema = z.enum([
  "author-intent",
  "character-knowledge",
  "relationships",
  "timeline",
  "causality",
  "foreshadowing",
  "repetition",
  "pacing",
  "dialogue",
  "production-risk",
]);
export const NarrativeQualityTargetSchema = ref
  .extend({
    kind: z.enum([
      "chapter",
      "chapter-set",
      "diagnosis",
      "season-plan",
      "episode-result",
      "script",
      "scene",
    ]),
    sourceFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
  })
  .superRefine((value, check) => {
    if (
      (value.kind === "script" || value.kind === "scene") !==
      Boolean(value.sourceFingerprint)
    )
      check.addIssue({
        code: "custom",
        path: ["sourceFingerprint"],
        message:
          "普通剧本／场景须明确冻结实际来源指纹，历史目标不能附加未知指纹。",
      });
  });
export const NarrativeQualityChapterScopeSchema = z
  .object({
    mode: z.enum(["selection", "full"]),
    chapters: z.array(ref).min(1).max(2000),
    directoryFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
  })
  .strict();
export const NarrativeQualityRequestSchema = z
  .object({
    target: NarrativeQualityTargetSchema,
    dimensions: z.array(NarrativeQualityDimensionSchema).min(1).max(10),
    chapterScope: NarrativeQualityChapterScopeSchema.optional(),
    context: NarrativeContextRequestSchema.optional(),
  })
  .strict()
  .superRefine((value, check) => {
    const scope = value.chapterScope;
    if (value.context && value.target.kind !== "chapter-set")
      check.addIssue({
        code: "custom",
        path: ["context"],
        message: "明确混合表达仅用于跨章质量范围，其他目标不能静默附加来源。",
      });
    if ((value.target.kind === "chapter-set") !== Boolean(scope))
      check.addIssue({
        code: "custom",
        path: ["chapterScope"],
        message: "跨章目标必须明确确认章节范围，其他目标不能附加跨章范围。",
      });
    if (
      scope &&
      (new Set(scope.chapters.map((chapter) => chapter.id)).size !==
        scope.chapters.length ||
        (scope.mode === "full") !== Boolean(scope.directoryFingerprint))
    )
      check.addIssue({
        code: "custom",
        path: ["chapterScope"],
        message: "章节不可重复；全书须有完整目录指纹，局部范围不能冒充全书。",
      });
  });
export const NarrativeQualityReferenceSchema = z.object({
  sourceKind: z.enum(["chapter", "author_intent", "production", "knowledge"]),
  sourceId: z.string().uuid(),
  sourceVersion: z.number().int().nonnegative(),
  fieldPath: z.string().startsWith("/"),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
});
const sourceDocumentIdentity = ref
  .extend({
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
export const NarrativeQualityProductionBasisSchema = z
  .object({
    projectId: z.string().uuid(),
    id: z.string().uuid(),
    kind: z.enum(["script", "scene"]),
    version: z.number().int().nonnegative(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    recordContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    document: sourceDocumentIdentity
      .extend({
        blocks: z.array(
          z
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
            .strict(),
        ),
      })
      .optional(),
    ancestors: z
      .array(
        ref
          .extend({
            kind: z.enum(["adaptations", "episodes", "scripts"]),
            contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
            document: sourceDocumentIdentity.optional(),
          })
          .strict(),
      )
      .max(3),
  })
  .strict()
  .superRefine((value, check) => {
    if (
      (value.kind === "script") !== Boolean(value.document) ||
      (value.document &&
        (new Set(value.document.blocks.map((block) => block.id)).size !==
          value.document.blocks.length ||
          value.document.blocks.some(
            (block, index) => block.index !== index,
          ))) ||
      new Set(value.ancestors.map((ancestor) => ancestor.id)).size !==
        value.ancestors.length ||
      value.ancestors.some(
        (ancestor) =>
          (ancestor.kind === "scripts") !== Boolean(ancestor.document),
      )
    )
      check.addIssue({
        code: "custom",
        message: "冻结的实际保存文档／块或父级身份无法核对。",
      });
  });
export const NarrativeQualityBasisSchema = z
  .object({
    request: NarrativeQualityRequestSchema,
    baseReportId: z.string().uuid().nullable(),
    references: z.array(NarrativeQualityReferenceSchema).min(1).max(2000),
    sourceBasis: NarrativeSourceBasisSchema.optional(),
    productionSourceBasis: NarrativeQualityProductionBasisSchema.optional(),
    chapterCoverage: z
      .object({
        mode: z.enum(["selection", "full"]),
        included: z
          .array(
            ref.extend({
              title: z.string(),
              representations: z
                .array(
                  z.enum([
                    "original",
                    "summary",
                    "paragraphs",
                    "hierarchical-summary",
                  ]),
                )
                .min(1)
                .optional(),
            }),
          )
          .min(1)
          .max(2000),
        excluded: z.array(
          ref.extend({ reason: z.enum(["not-selected", "empty"]) }),
        ),
        totalChapterCount: z.number().int().nonnegative(),
        nonEmptyChapterCount: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .superRefine((value, check) => {
    const target = value.request.target;
    const source = value.productionSourceBasis;
    if (value.sourceBasis) {
      if (!value.request.context)
        check.addIssue({
          code: "custom",
          path: ["sourceBasis"],
          message: "质量冻结输入缺少原明确确认，不补造混合来源。",
        });
      else
        refineNarrativeSourceSelection(
          {
            projectId: target.id,
            request: { context: value.request.context },
            sourceBasis: value.sourceBasis,
          },
          check,
        );
    }
    if (
      (target.kind === "script" || target.kind === "scene") !==
        Boolean(source) ||
      (source &&
        (source.id !== target.id ||
          source.kind !== target.kind ||
          source.version !== target.version ||
          source.contentHash !== target.sourceFingerprint ||
          !value.references.some(
            (reference) =>
              reference.sourceKind === "production" &&
              reference.sourceId === source.id &&
              reference.sourceVersion === source.version &&
              reference.fieldPath === `/production/${source.id}`,
          )))
    )
      check.addIssue({
        code: "custom",
        message: "普通质量目标与真实冻结来源基准不一致。",
      });
  });
export const NarrativeQualityEvidenceSchema = z
  .object({
    sourceId: z.string().uuid(),
    sourceVersion: z.number().int().nonnegative(),
    fieldPath: z.string().startsWith("/"),
    // JSON Pointer relative to the referenced value, not a guessed prose location.
    valuePath: z.string().startsWith("/"),
    quote: z.string().trim().min(1).max(4000),
  })
  .strict();
export const NarrativeQualityIssueSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    category: NarrativeQualityDimensionSchema,
    severity: z.enum(["error", "warning", "suggestion"]),
    message: z.string().trim().min(1).max(4000),
    suggestion: z.string().trim().min(1).max(4000),
    source: z.enum(["rule", "model", "human"]),
    evidence: z.array(NarrativeQualityEvidenceSchema).min(1).max(12),
  })
  .strict();
export const NarrativeQualityContentSchema = z
  .object({
    summary: z.string().trim().min(1).max(4000),
    reviewedDimensions: z.array(NarrativeQualityDimensionSchema).min(1).max(10),
    reviewedChapters: z.array(ref).min(1).max(2000).optional(),
    reviewedSources: z
      .array(
        z
          .object({
            sourceId: z.string().uuid(),
            sourceVersion: z.number().int().nonnegative(),
            fieldPath: z.string().startsWith("/"),
          })
          .strict(),
      )
      .min(1)
      .max(2000)
      .optional(),
    issues: z.array(NarrativeQualityIssueSchema).max(100),
  })
  .strict();
export const NarrativeQualityDispositionSchema = z
  .object({
    issueId: z.string().trim().min(1).max(64),
    state: z.enum(["open", "accepted-risk", "resolved"]),
    note: z.string().trim().min(1).max(4000),
    confirmed: z.literal(true),
    recheckReportId: z.string().uuid().optional(),
    version: z.number().int().nonnegative(),
  })
  .strict();
const narrativeQualityReportFields = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  workflowId: z.string().uuid(),
  version: z.number().int().nonnegative(),
  status: z.enum(["awaiting-review", "adopted", "discarded"]),
  basis: NarrativeQualityBasisSchema,
  content: NarrativeQualityContentSchema,
  dispositions: z.array(
    z.object({
      issueId: z.string(),
      state: z.enum(["open", "accepted-risk", "resolved"]),
      source: z.literal("human"),
      note: z.string(),
      recheckReportId: z.string().uuid().optional(),
      decidedAt: z.string().datetime(),
    }),
  ),
  sourceSnapshotId: z.string().uuid(),
  runIds: z.array(z.string().uuid()).min(1),
  engineKind: z.enum(["pi", "codex", "langgraph"]),
  model: z.record(z.string(), z.string()).optional(),
  usage: z.object({ state: z.literal("unknown") }),
  contextBudget: z
    .object({
      source: z.literal("estimate"),
      estimatedTokens: z.number().int().nonnegative(),
      tokenBudget: z.number().int().positive(),
    })
    .optional(),
  isCurrent: z.boolean(),
  sourceState: z.enum(["current", "stale"]),
  staleReasons: z.array(z.string()),
  blockers: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  adoptedAt: z.string().datetime().optional(),
});
export const NarrativeQualityReportSchema =
  narrativeQualityReportFields.superRefine((value, check) => {
    if (
      value.basis.productionSourceBasis &&
      value.basis.productionSourceBasis.projectId !== value.projectId
    )
      check.addIssue({
        code: "custom",
        message: "普通报告的冻结来源不属于本项目。",
      });
  });
export const NarrativeQualityPageSchema = z.object({
  items: z.array(NarrativeQualityReportSchema),
  nextCursor: z.string().uuid().optional(),
});
export const NarrativeQualitySummarySchema = narrativeQualityReportFields
  .pick({
    id: true,
    projectId: true,
    workflowId: true,
    version: true,
    status: true,
    isCurrent: true,
    sourceState: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    request: NarrativeQualityRequestSchema,
    openIssueCount: z.number().int().nonnegative(),
    blockerCount: z.number().int().nonnegative(),
    acceptedRiskCount: z.number().int().nonnegative(),
  });
export const NarrativeQualitySummaryPageSchema = z.object({
  items: z.array(NarrativeQualitySummarySchema),
  nextCursor: z.string().uuid().optional(),
});
export const NarrativeQualityCatalogSchema = z
  .object({
    targets: z.array(
      z
        .object({
          target: NarrativeQualityTargetSchema.strict(),
          title: z.string(),
        })
        .strict(),
    ),
    unavailable: z.array(z.string()),
    chapterSet: z
      .object({
        target: NarrativeQualityTargetSchema,
        chapters: z.array(
          ref.extend({ title: z.string(), hasContent: z.boolean() }),
        ),
        directoryFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .optional(),
  })
  .strict();
export const NarrativeQualityAssessmentSchema = z.object({
  target: NarrativeQualityTargetSchema,
  state: z.enum(["unknown", "blocked", "reviewed", "reviewed-with-risk"]),
  requiredDimensions: z.array(NarrativeQualityDimensionSchema),
  reviewedDimensions: z.array(NarrativeQualityDimensionSchema),
  missingDimensions: z.array(NarrativeQualityDimensionSchema),
  reports: z.array(ref),
  blockers: z.array(
    z.object({
      reportId: z.string().uuid(),
      issueId: z.string(),
      category: NarrativeQualityDimensionSchema,
    }),
  ),
  acceptedRiskCount: z.number().int().nonnegative(),
});
export type NarrativeQualityRequest = z.infer<
  typeof NarrativeQualityRequestSchema
>;
export type NarrativeQualityBasis = z.infer<typeof NarrativeQualityBasisSchema>;
export type NarrativeQualityContent = z.infer<
  typeof NarrativeQualityContentSchema
>;
export type NarrativeQualityReport = z.infer<
  typeof NarrativeQualityReportSchema
>;
export type NarrativeQualityPage = z.infer<typeof NarrativeQualityPageSchema>;
export type NarrativeQualitySummary = z.infer<
  typeof NarrativeQualitySummarySchema
>;
export type NarrativeQualitySummaryPage = z.infer<
  typeof NarrativeQualitySummaryPageSchema
>;
export type NarrativeQualityCatalog = z.infer<
  typeof NarrativeQualityCatalogSchema
>;
export type NarrativeQualityAssessment = z.infer<
  typeof NarrativeQualityAssessmentSchema
>;
export type NarrativeQualityDisposition = z.infer<
  typeof NarrativeQualityDispositionSchema
>;
export const CREATION_NARRATIVE_QUALITY_SERVICE =
  defineServiceContract<CreationAdapter>({
    id: "creative-quality.narrative-creation.v1",
    owner: "creative-quality",
    major: 1,
    capabilities: ["prepare", "validate", "apply"],
    degradable: true,
  });
export const NARRATIVE_QUALITY_SERVICE = defineServiceContract<{
  get(id: string): NarrativeQualityReport | undefined;
  current(
    projectId: string,
    target: NarrativeQualityRequest["target"],
  ): NarrativeQualityReport | undefined;
  assess(
    projectId: string,
    target: NarrativeQualityRequest["target"],
    dimensions: NarrativeQualityRequest["dimensions"],
  ): NarrativeQualityAssessment;
}>({
  id: "creative-quality.narrative-reports.v1",
  owner: "creative-quality",
  major: 1,
  capabilities: ["read"],
  degradable: true,
});
