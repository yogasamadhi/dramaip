import { z } from "zod";
import { AgentContextEntrySchema } from "./agent-context.js";
import { defineServiceContract } from "./service-contract.js";
import {
  NarrativeQualityBasisSchema,
  NarrativeQualityContentSchema,
  NarrativeQualityDimensionSchema,
  NarrativeQualityIssueSchema,
  NarrativeQualityRequestSchema,
  NarrativeQualityTargetSchema,
} from "./narrative-quality.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const identity = z
  .object({ id: z.string().uuid(), version: z.number().int().nonnegative() })
  .strict();
const { baseReportId: _modelHead, ...sourceFields } =
  NarrativeQualityBasisSchema.shape;
export const NarrativeLocalQualityBasisSchema = z
  .object(sourceFields)
  .strict()
  .superRefine((value, check) => {
    const parsed = NarrativeQualityBasisSchema.safeParse({
      ...value,
      baseReportId: null,
    });
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        check.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        });
  });
export const NarrativeLocalQualityReferenceSchema =
  AgentContextEntrySchema.omit({
    mode: true,
    included: true,
    reason: true,
    estimatedTokens: true,
  })
    .extend({
      value: z
        .unknown()
        .describe("完整冻结 JSON 值；实际解析仍校验 JSON 类型，不截断正文。"),
    })
    .strict()
    .superRefine((value, check) => {
      if (!AgentContextEntrySchema.shape.value.safeParse(value.value).success)
        check.addIssue({
          code: "custom",
          path: ["value"],
          message: "本地来源必须包含实际完整 JSON 值。",
        });
    });
export const NarrativeLocalQualitySourceSchema = z
  .object({
    format: z.literal("narrative-local-review-source-v1"),
    projectId: z.string().uuid(),
    sourceFingerprint: digest,
    baseReviewId: z.string().uuid().nullable(),
    basis: NarrativeLocalQualityBasisSchema,
    references: z.array(NarrativeLocalQualityReferenceSchema).min(1).max(2000),
  })
  .strict()
  .superRefine((value, check) => {
    const identity = (entry: {
      sourceKind: string;
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }) =>
      JSON.stringify([
        entry.sourceKind,
        entry.sourceId,
        entry.sourceVersion,
        entry.fieldPath,
      ]);
    if (
      (value.basis.productionSourceBasis &&
        value.basis.productionSourceBasis.projectId !== value.projectId) ||
      value.references.length !== value.basis.references.length ||
      new Set(value.references.map(identity)).size !==
        value.references.length ||
      new Set(value.basis.references.map(identity)).size !==
        value.basis.references.length ||
      value.basis.references.some(
        (source) =>
          !value.references.some(
            (entry) =>
              entry.sourceKind === source.sourceKind &&
              entry.sourceId === source.sourceId &&
              entry.sourceVersion === source.sourceVersion &&
              entry.fieldPath === source.fieldPath,
          ),
      )
    )
      check.addIssue({
        code: "custom",
        message: "本地评议来源必须对应实际项目和完整冻结引用。",
      });
  });
export const NarrativeLocalHumanContentSchema =
  NarrativeQualityContentSchema.superRefine((value, check) => {
    if (value.issues.some((issue) => issue.source !== "human"))
      check.addIssue({
        code: "custom",
        message: "人工入口只能记录作者声明，不能伪造模型或程序规则意见。",
      });
  });
export const NarrativeLocalRuleFindingSchema =
  NarrativeQualityIssueSchema.extend({
    source: z.literal("rule"),
    ruleId: z.literal("literal-repeated-passage-v1"),
    category: z.literal("repetition"),
    severity: z.literal("suggestion"),
  });
export const NarrativeLocalRuleContentSchema = z
  .object({
    summary: z.string().min(1).max(4000),
    checkedRules: z.array(z.literal("literal-repeated-passage-v1")).length(1),
    semanticCoverage: z.literal("not-assessed"),
    findings: z.array(NarrativeLocalRuleFindingSchema).max(100),
  })
  .strict();
const createFields = {
  request: NarrativeQualityRequestSchema,
  sourceFingerprint: digest,
  confirmed: z.literal(true),
  baseReviewId: z.string().uuid().nullable(),
};
export const NarrativeLocalQualityCreateSchema = z.discriminatedUnion(
  "origin",
  [
    z
      .object({
        ...createFields,
        origin: z.literal("human-declared"),
        content: NarrativeLocalHumanContentSchema,
      })
      .strict(),
    z
      .object({
        ...createFields,
        origin: z.literal("rule"),
        ruleId: z.literal("literal-repeated-passage-v1"),
      })
      .strict(),
  ],
);
export const NarrativeLocalQualityDecisionSchema = z
  .object({
    action: z.enum(["adopt", "discard"]),
    version: z.number().int().nonnegative(),
    confirmed: z.literal(true),
  })
  .strict();
export const NarrativeLocalQualityDispositionSchema = z
  .object({
    issueId: z.string().trim().min(1).max(64),
    state: z.enum(["open", "accepted-risk", "resolved"]),
    note: z.string().trim().min(1).max(4000),
    confirmed: z.literal(true),
    recheckReviewId: z.string().uuid().optional(),
    version: z.number().int().nonnegative(),
  })
  .strict();
const reviewFields = {
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  version: z.number().int().nonnegative(),
  status: z.enum(["awaiting-review", "adopted", "discarded"]),
  source: NarrativeLocalQualitySourceSchema,
  dispositions: z.array(
    z
      .object({
        issueId: z.string(),
        state: z.enum(["open", "accepted-risk", "resolved"]),
        source: z.literal("human-declared"),
        note: z.string(),
        recheckReviewId: z.string().uuid().optional(),
        decidedAt: z.string().datetime(),
      })
      .strict(),
  ),
  qualityState: z.literal("unverified"),
  isCurrent: z.boolean(),
  sourceState: z.enum(["current", "stale", "unverified"]),
  sourceReasons: z.array(z.string()),
  blockers: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  adoptedAt: z.string().datetime().optional(),
};
export const NarrativeLocalQualityReviewSchema = z
  .discriminatedUnion("origin", [
    z
      .object({
        ...reviewFields,
        origin: z.literal("human-declared"),
        content: NarrativeLocalHumanContentSchema,
      })
      .strict(),
    z
      .object({
        ...reviewFields,
        origin: z.literal("rule"),
        content: NarrativeLocalRuleContentSchema,
      })
      .strict(),
  ])
  .superRefine((value, check) => {
    if (value.projectId !== value.source.projectId)
      check.addIssue({
        code: "custom",
        message: "本地评议的原冻结来源不属于本项目。",
      });
  });
export const NarrativeLocalQualityPageSchema = z
  .object({
    items: z.array(NarrativeLocalQualityReviewSchema),
    nextCursor: z.string().uuid().optional(),
  })
  .strict();
/** Owner metadata only; no source values, opinions, quotes, notes or model identity. */
export const NarrativeLocalQualitySummarySchema = z
  .object({
    id: reviewFields.id,
    projectId: reviewFields.projectId,
    version: reviewFields.version,
    origin: z.enum(["human-declared", "rule"]),
    status: reviewFields.status,
    request: NarrativeQualityRequestSchema,
    sourceFingerprint: digest,
    qualityState: z.literal("unverified"),
    isCurrent: z.boolean(),
    sourceState: reviewFields.sourceState,
    sourceReasonCount: z.number().int().nonnegative(),
    issueCount: z.number().int().nonnegative(),
    openIssueCount: z.number().int().nonnegative(),
    blockerCount: z.number().int().nonnegative(),
    acceptedRiskCount: z.number().int().nonnegative(),
    resolvedIssueCount: z.number().int().nonnegative(),
    createdAt: reviewFields.createdAt,
    updatedAt: reviewFields.updatedAt,
  })
  .strict()
  .superRefine((value, check) => {
    if (
      value.issueCount !==
        value.openIssueCount +
          value.acceptedRiskCount +
          value.resolvedIssueCount ||
      value.blockerCount > value.openIssueCount ||
      (value.isCurrent && value.status !== "adopted")
    )
      check.addIssue({
        code: "custom",
        message: "本地评议摘要的实际问题计数或采用位置不一致。",
      });
  });
export const NarrativeLocalQualitySummaryPageSchema = z
  .object({
    projectId: z.string().uuid(),
    items: z.array(NarrativeLocalQualitySummarySchema).max(100),
    nextCursor: z.string().uuid().optional(),
  })
  .strict();
export const NarrativeLocalQualityAssessmentSchema = z
  .object({
    target: NarrativeQualityTargetSchema,
    state: z.enum(["unknown", "blocked", "reviewed", "reviewed-with-risk"]),
    qualityState: z.literal("unverified"),
    requiredDimensions: z.array(NarrativeQualityDimensionSchema),
    reviewedDimensions: z.array(NarrativeQualityDimensionSchema),
    missingDimensions: z.array(NarrativeQualityDimensionSchema),
    reviews: z.array(
      identity.extend({ origin: z.enum(["human-declared", "rule"]) }),
    ),
    blockers: z.array(
      z
        .object({
          reviewId: z.string().uuid(),
          issueId: z.string(),
          category: NarrativeQualityDimensionSchema,
        })
        .strict(),
    ),
    acceptedRiskCount: z.number().int().nonnegative(),
  })
  .strict();
export type NarrativeLocalQualitySource = z.infer<
  typeof NarrativeLocalQualitySourceSchema
>;
export type NarrativeLocalQualityReview = z.infer<
  typeof NarrativeLocalQualityReviewSchema
>;
export type NarrativeLocalQualityCreate = z.infer<
  typeof NarrativeLocalQualityCreateSchema
>;
export type NarrativeLocalQualitySummary = z.infer<
  typeof NarrativeLocalQualitySummarySchema
>;
export type NarrativeLocalQualitySummaryPage = z.infer<
  typeof NarrativeLocalQualitySummaryPageSchema
>;
export type NarrativeLocalQualityAssessment = z.infer<
  typeof NarrativeLocalQualityAssessmentSchema
>;
export const NARRATIVE_LOCAL_QUALITY_SERVICE = defineServiceContract<{
  get(id: string): NarrativeLocalQualityReview | undefined;
  assess(
    projectId: string,
    target: z.infer<typeof NarrativeQualityTargetSchema>,
    dimensions: z.infer<typeof NarrativeQualityDimensionSchema>[],
  ): NarrativeLocalQualityAssessment;
}>({
  id: "creative-quality.local-reviews.v1",
  owner: "creative-quality",
  major: 1,
  capabilities: ["read"],
  degradable: true,
});
