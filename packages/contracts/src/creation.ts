import {
  AgentContextIntegritySchema,
  type AgentContextReference,
} from "./agent-context.js";
import { z } from "zod";
import { AgentRunExecutionSchema } from "./agent-run-execution.js";
import { assertCreationSourceVersionCurrent } from "./creation-source-conflict.js";
export * from "./creation-source-conflict.js";
import { ProductionRecordMergeSourceSchema } from "./production-record-merge.js";
import {
  CreativeContinuationBasisSchema,
  type CreativeContinuationBasis,
} from "./creative-continuation.js";
import { AgentEngineKindSchema } from "./index.js";
import { defineServiceContract } from "./service-contract.js";
import type { AuthorIntent } from "./workspace.js";
import {
  AuthorIntentCreationRequestSchema,
  AuthorIntentCreationBasisSchema,
} from "./author-intent-creation.js";
import type { Chapter } from "./writing.js";
import {
  NarrativeQualityRequestSchema,
  NarrativeQualityBasisSchema,
} from "./narrative-quality.js";
import {
  EpisodeDevelopmentRequestSchema,
  EpisodeDevelopmentBasisSchema,
} from "./episode-development.js";
import {
  DiagnosisRequestSchema,
  DiagnosisBasisSchema,
} from "./adaptation-diagnosis.js";
import {
  SeasonPlanRequestSchema,
  SeasonPlanBasisSchema,
} from "./season-plan.js";
import {
  AdaptationStrategyRequestSchema,
  AdaptationStrategyBasisSchema,
} from "./adaptation-strategy.js";
import {
  NarrativeContextRequestSchema,
  NarrativeContextBasisSchema,
} from "./narrative-context.js";
export * from "./narrative-context.js";
export * from "./narrative-planning.js";
export * from "./narrative-source-scope.js";
export * from "./production-narrative.js";
import {
  ProductionNarrativeRequestSchema,
  ProductionNarrativeBasisSchema,
  ProductionNarrativeOperationSchema,
} from "./production-narrative.js";
import {
  NarrativePlanningRequestSchema,
  NarrativePlanningBasisSchema,
} from "./narrative-planning.js";
import {
  NarrativeSummaryRequestSchema,
  NarrativeSummaryBasisSchema,
} from "./narrative-summary.js";

// Absence is frozen too: adopting the first intent invalidates earlier runs.
// Optional only for historical workflows, never synthesized from project text.
export const CreationAuthorIntentSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("none"), projectId: z.string().uuid() }),
  z.object({
    state: z.literal("adopted"),
    projectId: z.string().uuid(),
    id: z.string().uuid(),
    version: z.number().int().positive(),
  }),
]);
export type CreationAuthorIntent = z.infer<typeof CreationAuthorIntentSchema>;
export const AUTHOR_INTENT_CONTEXT_PATH = "/author-intents/current";
export const AUTHOR_INTENT_CREATION_PROMPT =
  "冻结引用中的正式作者意图是主题、情绪承诺、受众、文风、保留/可改/禁改及结局的权威约束，优先于项目旧自由文本中的方向或风格。它不是已经发生的故事事实；不把小说强制短剧化，也不把规划当作已发生的情节。";

export const CreationOperationSchema = z.enum([
  "author-intent",
  "chapter",
  "characters",
  "book-outline",
  "chapter-outline",
  "story-arc",
  "episode",
  "adaptation-diagnosis",
  "adaptation-strategy",
  "quality-review",
  "season-plan",
  "episode-outline",
  "episode-script",
  "storyboard-package",
  "script-revision",
  "review-check",
  "shot-prompt",
  "delivery-copy",
  "localization",
  "creator-content",
  "chapter-memory",
  "knowledge-plan",
  "narrative-summary",
]);
export type CreationOperation = z.infer<typeof CreationOperationSchema>;
export const CreationInputSchema = z
  .object({
    projectId: z.string().uuid(),
    operation: CreationOperationSchema,
    targetId: z.string().uuid().optional(),
    conversationId: z.string().uuid().optional(),
    baseVersion: z.number().int().nonnegative().optional(),
    instruction: z.string().trim().min(1).max(100_000),
    engineKind: AgentEngineKindSchema,
    model: z.record(z.string(), z.unknown()).optional(),
    wordGoal: z.number().int().positive().max(100_000).optional(),
    sourceIds: z.array(z.string().uuid()).max(100).default([]),
    language: z.string().max(100).optional(),
    reviewPackageId: z.string().uuid().optional(),
    feedbackClusterId: z.string().uuid().optional(),
    diagnosisRequest: DiagnosisRequestSchema.optional(),
    adaptationStrategyRequest: AdaptationStrategyRequestSchema.optional(),
    seasonPlanRequest: SeasonPlanRequestSchema.optional(),
    episodeDevelopmentRequest: EpisodeDevelopmentRequestSchema.optional(),
    qualityReviewRequest: NarrativeQualityRequestSchema.optional(),
    narrativeContextRequest: NarrativeContextRequestSchema.optional(),
    narrativePlanningRequest: NarrativePlanningRequestSchema.optional(),
    productionNarrativeRequest: ProductionNarrativeRequestSchema.optional(),
    narrativeSummaryRequest: NarrativeSummaryRequestSchema.optional(),
    authorIntentRequest: AuthorIntentCreationRequestSchema.optional(),
  })
  .superRefine((input, check) => {
    if (
      input.productionNarrativeRequest &&
      (!ProductionNarrativeOperationSchema.safeParse(input.operation).success ||
        input.sourceIds.length ||
        [
          input.authorIntentRequest,
          input.diagnosisRequest,
          input.adaptationStrategyRequest,
          input.seasonPlanRequest,
          input.episodeDevelopmentRequest,
          input.qualityReviewRequest,
          input.narrativeContextRequest,
          input.narrativePlanningRequest,
          input.narrativeSummaryRequest,
        ].some(Boolean))
    )
      check.addIssue({
        code: "custom",
        path: ["productionNarrativeRequest"],
        message:
          "制作来源只用于旧制作四操作，不能混入兼容整章或其他专用来源协议。",
      });
  });
/** Exact candidate string matches only; this does not verify the model's interpretation. */
export const CreationCandidateEvidenceSchema = z
  .object({
    candidateSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    matches: z
      .array(
        z
          .object({
            valuePath: z.string().startsWith("/").max(4096),
            start: z.number().int().nonnegative(),
            end: z.number().int().positive(),
          })
          .strict()
          .refine((value) => value.end > value.start),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const CreationIssueSchema = z.object({
  severity: z.enum(["error", "warning", "suggestion"]),
  message: z.string().min(1),
  evidence: z.string(),
  location: z.string(),
  suggestion: z.string(),
  source: z.enum(["rule", "model"]),
  // Absent on historical issues and structural rules. Never backfill from a
  // later candidate, a frozen source, or a model-supplied location.
  candidateEvidence: CreationCandidateEvidenceSchema.optional(),
});
export const CreationCheckSchema = z.object({
  issues: z.array(CreationIssueSchema).max(100),
});
const modelCheckText = z
  .string()
  .min(1)
  .max(10_000)
  .refine((value) => value.trim().length > 0);
/** New model checkpoints only: keep historical workflow parsing compatible. */
export const CreationModelCheckSchema = z
  .object({
    issues: z
      .array(
        CreationIssueSchema.omit({ candidateEvidence: true })
          .extend({
            message: modelCheckText,
            evidence: modelCheckText,
            location: modelCheckText,
            suggestion: modelCheckText,
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const CreationContentSchema = z.object({
  title: z.string().default(""),
  brief: z.string().optional(),
  content: z.string().default(""),
  items: z
    .array(
      z.object({
        ref: z.string().min(1),
        parentRef: z.string().optional(),
        kind: z.string().min(1),
        title: z.string().min(1),
        data: z.record(z.string(), z.unknown()),
      }),
    )
    .max(1000)
    .default([]),
});
export const CreationStageSchema = z.enum([
  "preparing",
  "generating",
  "checking",
  "revising",
  "rechecking",
  "awaiting-review",
  "applied",
  "discarded",
  "failed",
  "canceled",
  "interrupted",
]);
export const CreationExecutionReceiptSchema = z
  .object({
    format: z.literal("creation-execution-receipt-v1"),
    workflowId: z.string().uuid(),
    projectId: z.string().uuid(),
    version: z.number().int().nonnegative(),
    operation: CreationOperationSchema,
    sourceWorkflowId: z.string().uuid().optional(),
    runs: z
      .array(
        z.discriminatedUnion("state", [
          z
            .object({
              state: z.literal("recorded"),
              runId: z.string().uuid(),
              phase: z.enum([
                "generating",
                "checking",
                "revising",
                "rechecking",
              ]),
              execution: AgentRunExecutionSchema,
            })
            .strict(),
          z
            .object({ state: z.literal("missing"), runId: z.string().uuid() })
            .strict(),
        ]),
      )
      .max(4),
    coverage: z.literal("exact-workflow-attempt"),
    billingStatus: z.literal("unknown"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.runs.map((run) => run.runId)).size !== value.runs.length)
      ctx.addIssue({
        code: "custom",
        path: ["runs"],
        message: "原工作流运行身份不能重复。",
      });
    let last = -1;
    for (const run of value.runs) {
      if (run.state !== "recorded") continue;
      const ordinal = [
        "generating",
        "checking",
        "revising",
        "rechecking",
      ].indexOf(run.phase);
      if (
        run.execution.runId !== run.runId ||
        run.execution.projectId !== value.projectId ||
        run.execution.taskType !== `creation_${run.phase}` ||
        ordinal <= last
      )
        ctx.addIssue({
          code: "custom",
          path: ["runs"],
          message:
            "阶段记录须绑定原运行、项目和实际阶段顺序，不换最新或重复修订。",
        });
      last = ordinal;
    }
  });
export type CreationExecutionReceipt = z.infer<
  typeof CreationExecutionReceiptSchema
>;
const mergeBlockOrder = z.array(z.string().uuid()).max(100000);
export const CreationScriptMergeBasisSchema = z
  .object({
    format: z.literal("stable-screenplay-merge-v1"),
    projectId: z.string().uuid(),
    workflowId: z.string().uuid(),
    baseBlocksHash: z.string().regex(/^[a-f0-9]{64}$/u),
    candidateHash: z.string().regex(/^[a-f0-9]{64}$/u),
    contextHash: z.string().regex(/^[a-f0-9]{64}$/u),
    target: z
      .object({
        scriptId: z.string().uuid(),
        version: z.number().int().nonnegative(),
        documentId: z.string().uuid(),
        documentVersion: z.number().int().nonnegative(),
        blocksHash: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict(),
  })
  .strict();
const rebaseFields = {
  baseVersion: z.number().int().nonnegative(),
  choices: z.record(z.string(), z.enum(["main", "branch"])),
  basis: CreationScriptMergeBasisSchema.optional(),
  blockOrder: mergeBlockOrder.optional(),
};
export const CreationRebaseRequestSchema = z
  .object(rebaseFields)
  .strict()
  .superRefine((value, ctx) => {
    if (value.blockOrder && !value.basis)
      ctx.addIssue({
        code: "custom",
        message: "明确块顺序须绑定实际合并比较基准。",
      });
    if (
      value.blockOrder &&
      new Set(value.blockOrder).size !== value.blockOrder.length
    )
      ctx.addIssue({
        code: "custom",
        message: "明确块顺序的稳定身份不能重复。",
      });
  });
export type CreationScriptMergeBasis = z.infer<
  typeof CreationScriptMergeBasisSchema
>;
export type CreationRebaseRequest = z.infer<typeof CreationRebaseRequestSchema>;
export const CreationWorkflowSchema = z
  .object({
    // Original typed start input is hashed before resolving the execution model.
    // Historical workflows without this receipt remain historical, not upgraded.
    creationRequestReceipt: z
      .object({
        format: z.literal("creation-request-receipt-v1"),
        key: z.string().min(1),
        requestHash: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict()
      .optional(),
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    input: CreationInputSchema,
    stage: CreationStageSchema,
    version: z.number().int().nonnegative(),
    recordMergeSource: ProductionRecordMergeSourceSchema.optional(),
    rebaseSource: z
      .object({
        id: z.string().uuid(),
        ...rebaseFields,
      })
      .strict()
      .optional(),
    sourceWorkflowId: z.string().uuid().optional(),
    continuationBasis: CreativeContinuationBasisSchema.optional(),
    authorIntent: CreationAuthorIntentSchema.optional(),
    authorIntentBasis: AuthorIntentCreationBasisSchema.optional(),
    authorIntentId: z.string().uuid().optional(),
    diagnosisBasis: DiagnosisBasisSchema.optional(),
    diagnosisId: z.string().uuid().optional(),
    adaptationStrategyBasis: AdaptationStrategyBasisSchema.optional(),
    adaptationStrategyId: z.string().uuid().optional(),
    seasonPlanBasis: SeasonPlanBasisSchema.optional(),
    seasonPlanId: z.string().uuid().optional(),
    episodeDevelopmentBasis: EpisodeDevelopmentBasisSchema.optional(),
    episodeResultId: z.string().uuid().optional(),
    narrativeQualityBasis: NarrativeQualityBasisSchema.optional(),
    narrativeContextBasis: NarrativeContextBasisSchema.optional(),
    narrativePlanningBasis: NarrativePlanningBasisSchema.optional(),
    productionNarrativeBasis: ProductionNarrativeBasisSchema.optional(),
    narrativeReportId: z.string().uuid().optional(),
    narrativeSummaryBasis: NarrativeSummaryBasisSchema.optional(),
    narrativeSummaryId: z.string().uuid().optional(),
    runId: z.string().uuid().optional(),
    sessionId: z.string().uuid().optional(),
    runIds: z.array(z.string().uuid()),
    contextSnapshotIds: z.array(z.string().uuid()),
    referenceVersions: z
      .array(
        z.object({
          sourceId: z.string(),
          sourceVersion: z.number(),
          fieldPath: z.string(),
        }),
      )
      .default([]),
    sources: z.array(
      z.object({ kind: z.string(), id: z.string(), version: z.number() }),
    ),
    preparedPrompt: z.string(),
    baseText: z.string().optional(),
    baseBlocks: z.array(z.record(z.string(), z.unknown())).optional(),
    sourceSnapshotId: z.string().uuid().optional(),
    sourceContextIntegrity: AgentContextIntegritySchema.optional(),
    contextEntries: z
      .array(
        z.object({
          title: z.string(),
          included: z.boolean(),
          reason: z.string(),
          estimatedTokens: z.number().int().nonnegative().optional(),
          fieldPath: z.string().optional(),
          sourceId: z.string().optional(),
          sourceVersion: z.number().int().nonnegative().optional(),
        }),
      )
      .default([]),
    output: CreationContentSchema.optional(),
    issues: z.array(CreationIssueSchema),
    previewId: z.string().uuid().optional(),
    error: z.string().optional(),
    adoptionCheckId: z.string().uuid().optional(),
    adoptionCheckError: z.string().optional(),
    memoryState: z
      .enum(["running", "synced", "review-required", "failed"])
      .optional(),
    memoryWorkflowId: z.string().uuid().optional(),
    memoryError: z.string().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((value, ctx) => {
    const novel = value.narrativeContextBasis;
    const confirmed = value.input.narrativeContextRequest;
    if (
      value.authorIntentBasis &&
      (JSON.stringify(value.authorIntentBasis.request) !==
        JSON.stringify(value.input.authorIntentRequest) ||
        (value.authorIntentBasis.sourceBasis &&
          value.authorIntentBasis.sourceBasis.projectId !==
            value.input.projectId))
    )
      ctx.addIssue({
        code: "custom",
        path: ["authorIntentBasis"],
        message: "意图原冻结输入必须绑定原确认请求及项目，不升级历史或切最新。",
      });
    // Historical absence stays absence. A target-only explicit rebase may keep
    // an older target version, but cannot replace the confirmed input selection.
    if (
      novel &&
      (JSON.stringify(confirmed?.story ?? []) !==
        JSON.stringify((novel.story ?? []).map((item) => item.selection)) ||
        (confirmed &&
          (JSON.stringify(confirmed.chapters) !==
            JSON.stringify(
              novel.chapters.map(
                ({ contentHash: _hash, ...chapter }) => chapter,
              ),
            ) ||
            JSON.stringify(confirmed.summaries ?? []) !==
              JSON.stringify(
                (novel.summaries ?? []).map(({ id, version }) => ({
                  id,
                  version,
                })),
              ))))
    )
      ctx.addIssue({
        code: "custom",
        path: ["narrativeContextBasis"],
        message: "小说冻结输入须对应原明确选择，不漏选、换版本或重绑声明。",
      });
    if (
      value.narrativePlanningBasis &&
      JSON.stringify(value.narrativePlanningBasis.request) !==
        JSON.stringify(value.input.narrativePlanningRequest)
    )
      ctx.addIssue({
        code: "custom",
        path: ["narrativePlanningBasis"],
        message: "规划冻结输入须对应原确认请求，内部自洽不能替代作者确认。",
      });
    if (
      value.productionNarrativeBasis &&
      JSON.stringify(value.productionNarrativeBasis.request) !==
        JSON.stringify(value.input.productionNarrativeRequest)
    )
      ctx.addIssue({
        code: "custom",
        path: ["productionNarrativeBasis"],
        message: "制作冻结输入须对应原确认请求，内部自洽不能替代作者确认。",
      });
    if (
      value.narrativeQualityBasis &&
      JSON.stringify(value.narrativeQualityBasis.request) !==
        JSON.stringify(value.input.qualityReviewRequest)
    )
      ctx.addIssue({
        code: "custom",
        path: ["narrativeQualityBasis"],
        message: "质量冻结目标、维度与表达须对应原确认请求，不补造或替换确认。",
      });
    if (
      value.sourceContextIntegrity &&
      value.sourceContextIntegrity.snapshotId !== value.sourceSnapshotId
    )
      ctx.addIssue({
        code: "custom",
        message: "创建上下文摘要须绑定原实际快照，不补最新或其他快照。",
      });
  });
export const CreationActionSchema = z.object({
  action: z.enum(["cancel", "retry", "continue"]),
});
export type CreationInput = z.infer<typeof CreationInputSchema>;
export type CreationContent = z.infer<typeof CreationContentSchema>;
export type CreationIssue = z.infer<typeof CreationIssueSchema>;
export type CreationWorkflow = z.infer<typeof CreationWorkflowSchema>;
export const CreationMergeSchema = z
  .object({
    currentVersion: z.number().int(),
    units: z.array(
      z.object({
        id: z.string(),
        current: z.string(),
        candidate: z.string(),
        conflict: z.boolean(),
        choice: z.enum(["main", "branch"]),
        kind: z
          .enum([
            "unchanged",
            "added",
            "deleted",
            "modified",
            "moved",
            "conflict",
          ])
          .optional(),
        currentPresent: z.boolean().optional(),
        candidatePresent: z.boolean().optional(),
      }),
    ),
    output: CreationContentSchema.optional(),
    basis: CreationScriptMergeBasisSchema.optional(),
    blockOrder: z
      .object({
        format: z.literal("stable-block-order-v1"),
        base: mergeBlockOrder,
        current: mergeBlockOrder,
        candidate: mergeBlockOrder,
        proposed: mergeBlockOrder,
        conflict: z.boolean(),
        reason: z
          .enum(["divergent-order", "ambiguous-insertion", "missing-position"])
          .optional(),
      })
      .strict()
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (Boolean(value.basis) !== Boolean(value.blockOrder))
      ctx.addIssue({
        code: "custom",
        message: "新合并协议须同时提供比较基准与块顺序。",
      });
    if (!value.blockOrder || !value.basis) return;
    const order = value.blockOrder;
    const ids = new Set(value.units.map((unit) => unit.id));
    const current = new Set(order.current);
    const candidate = new Set(order.candidate);
    if (
      ids.size !== value.units.length ||
      value.units.some(
        (unit) =>
          !z.string().uuid().safeParse(unit.id).success ||
          !unit.kind ||
          unit.currentPresent !== current.has(unit.id) ||
          unit.candidatePresent !== candidate.has(unit.id),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "稳定块身份与实际存在信息不完整或不一致。",
      });
    for (const sequence of [
      order.base,
      order.current,
      order.candidate,
      order.proposed,
    ])
      if (
        new Set(sequence).size !== sequence.length ||
        sequence.some((id) => !ids.has(id))
      )
        ctx.addIssue({
          code: "custom",
          message: "块顺序含重复或不属于比较的身份。",
        });
    if (
      value.currentVersion !== value.basis.target.version ||
      order.conflict !== Boolean(order.reason)
    )
      ctx.addIssue({
        code: "custom",
        message: "合并版本或排序冲突说明不一致。",
      });
  });
export type CreationMerge = z.infer<typeof CreationMergeSchema>;
// Runtime-internal preparation only, never part of the public Creation input.
// Writing may validate a not-yet-persisted empty continuation target.
export interface CreationPrepareOptions {
  prospectiveChapter?: Chapter;
}
export interface CreationAdapter {
  approvedStoryBible?(projectId: string): AgentContextReference[];
  merge?(
    workflow: CreationWorkflow,
    choices?: Record<string, "main" | "branch">,
    options?: Pick<CreationRebaseRequest, "basis" | "blockOrder">,
  ): CreationMerge;
  mergeText?(
    base: string,
    current: string,
    candidate: string,
  ): Array<{
    id: string;
    base: string;
    current: string;
    candidate: string;
    conflict: boolean;
    content: string;
  }>;
  references?(
    projectId: string,
    chapterId?: string,
  ): {
    prompt: string;
    sources: CreationWorkflow["sources"];
    references?: AgentContextReference[];
  };
  prepare(
    input: CreationInput,
    options?: CreationPrepareOptions,
  ): {
    prompt: string;
    authorIntent?: CreationAuthorIntent;
    authorIntentBasis?: z.infer<typeof AuthorIntentCreationBasisSchema>;
    continuationBasis?: CreativeContinuationBasis;
    diagnosisBasis?: z.infer<typeof DiagnosisBasisSchema>;
    adaptationStrategyBasis?: z.infer<typeof AdaptationStrategyBasisSchema>;
    seasonPlanBasis?: z.infer<typeof SeasonPlanBasisSchema>;
    episodeDevelopmentBasis?: z.infer<typeof EpisodeDevelopmentBasisSchema>;
    narrativeQualityBasis?: z.infer<typeof NarrativeQualityBasisSchema>;
    narrativeContextBasis?: z.infer<typeof NarrativeContextBasisSchema>;
    narrativePlanningBasis?: z.infer<typeof NarrativePlanningBasisSchema>;
    productionNarrativeBasis?: z.infer<typeof ProductionNarrativeBasisSchema>;
    narrativeSummaryBasis?: z.infer<typeof NarrativeSummaryBasisSchema>;
    baseBlocks?: Array<Record<string, unknown>>;
    checkContent?: CreationContent;
    sources: CreationWorkflow["sources"];
    references?: AgentContextReference[];
  };
  assertSourcesCurrent?(workflow: CreationWorkflow): void;
  validate(
    input: CreationInput,
    content: CreationContent,
    workflow?: CreationWorkflow,
  ): CreationIssue[];
  review?(workflow: CreationWorkflow): {
    authorIntentId?: string;
    diagnosisId?: string;
    adaptationStrategyId?: string;
    seasonPlanId?: string;
    episodeResultId?: string;
    narrativeReportId?: string;
    narrativeSummaryId?: string;
  };
  reviewState?(workflow: CreationWorkflow): "adopted" | "discarded" | undefined;
  discard?(workflow: CreationWorkflow): void;
  apply(workflow: CreationWorkflow): void;
}
export const CREATION_WRITING_SERVICE = defineServiceContract<CreationAdapter>({
  id: "writing.creation.v1",
  owner: "writing",
  major: 1,
  capabilities: ["prepare", "validate", "apply"],
  degradable: true,
});
export const CREATION_AUTHOR_INTENT_SERVICE =
  defineServiceContract<CreationAdapter>({
    id: "workspace.author-intent-creation.v1",
    owner: "workspace",
    major: 1,
    capabilities: ["prepare", "validate", "apply"],
    degradable: true,
  });
export const CREATION_PRODUCTION_SERVICE =
  defineServiceContract<CreationAdapter>({
    id: "production.creation.v1",
    owner: "production",
    major: 1,
    capabilities: ["prepare", "validate", "apply"],
    degradable: true,
  });
export const CREATION_DELIVERY_SERVICE = defineServiceContract<CreationAdapter>(
  {
    id: "delivery.creation.v1",
    owner: "delivery",
    major: 1,
    capabilities: ["prepare", "validate", "apply"],
    degradable: true,
  },
);
export const CREATION_KNOWLEDGE_SERVICE =
  defineServiceContract<CreationAdapter>({
    id: "knowledge.creation.v1",
    owner: "knowledge",
    major: 1,
    capabilities: ["prepare", "validate", "apply"],
    degradable: true,
  });
export const CREATION_WORKFLOW_SERVICE = defineServiceContract<{
  preflight(input: CreationInput, options?: CreationPrepareOptions): void;
  start(
    input: CreationInput,
    key: string,
    sourceWorkflowId?: string,
    rebaseSource?: CreationWorkflow["rebaseSource"],
  ): CreationWorkflow;
  get(id: string): CreationWorkflow | undefined;
  /** Read before a consumer's own UoW; only original persisted run metadata, never workflow bodies. */
  execution?(
    id: string,
    projectId: string,
  ): CreationExecutionReceipt | undefined;
  syncReview(id: string): CreationWorkflow | undefined;
  launch(id: string): Promise<CreationWorkflow>;
  action(
    id: string,
    action: "cancel" | "retry" | "continue",
    key: string,
  ): Promise<CreationWorkflow>;
  apply(
    id: string,
    chapterPatch?: {
      previewId: string;
      id: string;
      version: number;
      content: string;
    },
  ): "updated" | "conflict" | "unsupported" | "unavailable" | "quality-blocked";
}>({
  id: "automation.creation.v1",
  owner: "automation",
  major: 1,
  capabilities: ["preflight", "start", "read", "execution", "apply"],
  degradable: true,
});

export function parseCreationContent(text: string): CreationContent {
  const body =
    text.match(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/u)?.[1] ?? text;
  try {
    const value = JSON.parse(body);
    // Models commonly express omitted optional strings as null. Normalize only
    // these envelope fields; business data and required fields remain strict.
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (value.brief === null) delete value.brief;
      if (Array.isArray(value.items))
        for (const item of value.items)
          if (item && typeof item === "object" && item.parentRef === null)
            delete item.parentRef;
    }
    return CreationContentSchema.parse(value);
  } catch {
    throw new Error("AI 返回的候选格式不完整，已保留返回内容，请重试。");
  }
}

export function creationReference(
  kind: string,
  value: { id: string; version: number; [key: string]: unknown },
): AgentContextReference {
  const sourceKind =
    kind === "author-intent"
      ? "author_intent"
      : kind === "project"
        ? "project"
        : kind === "chapter"
          ? "chapter"
          : ["characters", "outlines", "story-arcs"].includes(kind)
            ? "writing_resource"
            : kind === "knowledge"
              ? "knowledge"
              : "production";
  const fieldPath =
    sourceKind === "author_intent"
      ? AUTHOR_INTENT_CONTEXT_PATH
      : sourceKind === "project"
        ? "/project"
        : sourceKind === "chapter"
          ? `/chapters/${value.id}`
          : sourceKind === "writing_resource"
            ? `/writing-resources/${kind}/${value.id}`
            : `/${sourceKind}/${value.id}`;
  const planning =
    value.payload &&
    typeof value.payload === "object" &&
    "narrativePlanningBasis" in value.payload
      ? NarrativePlanningBasisSchema.parse(value.payload.narrativePlanningBasis)
      : undefined;
  return {
    sourceKind,
    sourceId: value.id,
    sourceVersion: value.version,
    fieldPath,
    value: JSON.parse(JSON.stringify(value)),
    sensitivity: "project",
    ...(planning
      ? {
          policyDependencies: [
            ...new Map(
              planning.references
                .flatMap((reference) => [
                  {
                    sourceId: reference.sourceId,
                    sourceVersion: reference.sourceVersion,
                    fieldPath: reference.fieldPath,
                  },
                  ...(reference.policyDependencies ?? []),
                ])
                .map((reference) => [reference.fieldPath, reference]),
            ).values(),
          ],
        }
      : {}),
  };
}

/** Only a current explicit adoption becomes a creation constraint. */
export function creationAuthorIntent(
  projectId: string,
  intent: AuthorIntent | undefined,
): {
  authorIntent: CreationAuthorIntent;
  references: AgentContextReference[];
  sources: CreationWorkflow["sources"];
} {
  if (!intent)
    return {
      authorIntent: { state: "none", projectId },
      references: [],
      sources: [],
    };
  if (
    intent.projectId !== projectId ||
    intent.status !== "adopted" ||
    !intent.isCurrent
  )
    throw new Error("正式作者意图归属或采用状态无效。");
  return {
    authorIntent: {
      state: "adopted",
      projectId,
      id: intent.id,
      version: intent.version,
    },
    references: [
      creationReference("author-intent", {
        id: intent.id,
        projectId,
        version: intent.version,
        title: "正式作者意图",
        content: intent.content,
      }),
    ],
    sources: [
      { kind: "author-intent", id: intent.id, version: intent.version },
    ],
  };
}

export function assertCreationAuthorIntentCurrent(
  workflow: CreationWorkflow,
  current: CreationAuthorIntent,
): void {
  const frozen = workflow.authorIntent;
  if (
    frozen?.state === "adopted" &&
    current.state === "adopted" &&
    frozen.projectId === workflow.input.projectId &&
    current.projectId === workflow.input.projectId
  )
    assertCreationSourceVersionCurrent(
      workflow,
      "author_intent",
      frozen,
      current,
      "正式作者意图已变化或旧候选未引用该版本，请重新生成候选。",
    );
  if (
    current.projectId !== workflow.input.projectId ||
    (frozen && frozen.projectId !== workflow.input.projectId) ||
    (!frozen && current.state !== "none") ||
    (frozen && frozen.state !== current.state) ||
    (frozen?.state === "adopted" &&
      (current.state !== "adopted" ||
        frozen.id !== current.id ||
        frozen.version !== current.version))
  )
    throw new Error("正式作者意图已变化或旧候选未引用该版本，请重新生成候选。");
}

export const CREATION_QUALITY_SERVICE = defineServiceContract<{
  prompt: string;
  promptFor(operation: CreationOperation): string;
  collect(
    raw: string,
    rules: CreationIssue[],
    candidate: CreationContent,
  ): CreationIssue[];
}>({
  id: "creative-quality.creation.v1",
  owner: "creative-quality",
  major: 1,
  capabilities: ["check"],
  degradable: true,
});

export interface CreationFeedbackService {
  references(
    projectId: string,
    id: string,
    targetId: string,
  ): import("./agent-context.js").AgentContextReference[];
}
export const CREATION_REVIEW_SERVICE =
  defineServiceContract<CreationFeedbackService>({
    id: "review.creation-feedback.v1",
    owner: "review",
    major: 1,
    capabilities: ["read"],
    degradable: true,
  });
export const CREATION_INSIGHTS_SERVICE =
  defineServiceContract<CreationFeedbackService>({
    id: "insights.creation-feedback.v1",
    owner: "insights",
    major: 1,
    capabilities: ["read"],
    degradable: true,
  });

export function creationOperationForTask(
  task: string,
): CreationInput["operation"] | undefined {
  const map: Record<string, CreationInput["operation"]> = {
    generate_characters: "characters",
    generate_book_outline: "book-outline",
    generate_chapter_outline: "chapter-outline",
    generate_story_arc_outline: "story-arc",
    chapter_revision: "chapter",
    generate_chapter: "chapter",
    expand_chapter: "chapter",
    enhance_conflict: "chapter",
    enhance_highlight: "chapter",
    enhance_ai_drama_feel: "chapter",
    enhance_author_style: "chapter",
    enhance_hook: "chapter",
    enhance_reversal: "chapter",
    enhance_cliffhanger: "chapter",
    continue_chapter: "chapter",
    rewrite_chapter: "chapter",
    polish_chapter: "chapter",
    rewrite_as_ai_drama_novel: "chapter",
    generate_ai_drama_script: "episode",
    rewrite_episode_outline: "episode",
    rewrite_ai_drama_script: "script-revision",
    enhance_dialogue_conflict: "script-revision",
    enhance_episode_cliffhanger: "script-revision",
    enhance_script_dialogue_voice: "script-revision",
    enhance_script_visuality: "script-revision",
    generate_character_visual_profile: "knowledge-plan",
    generate_visual_setting: "knowledge-plan",
    propose_story_bible_changes: "knowledge-plan",
    generate_shot_prompt: "shot-prompt",
    optimize_prompt_for_video_platform: "shot-prompt",
    generate_negative_prompt: "shot-prompt",
    rewrite_shot_prompt: "shot-prompt",
  };
  return map[task];
}

/** Verify only references actually disclosed to this frozen run. */
export function assertCreationReferencesCurrent(
  workflow: CreationWorkflow,
  references: AgentContextReference[],
): void {
  for (const source of workflow.referenceVersions) {
    const current = references.find(
      (entry) =>
        entry.sourceId === source.sourceId &&
        entry.fieldPath === source.fieldPath,
    );
    if (
      current &&
      [
        "author_intent",
        "project",
        "chapter",
        "writing_resource",
        "production",
        "knowledge",
        "story_bible",
      ].includes(current.sourceKind)
    )
      assertCreationSourceVersionCurrent(
        workflow,
        current.sourceKind as import("./creation-source-conflict.js").CreationSourceChange["sourceKind"],
        { id: source.sourceId, version: source.sourceVersion },
        { id: current.sourceId, version: current.sourceVersion },
        "本轮引用的资料已更新或失效，请按当前资料重新生成候选。",
      );
    if (!current || current.sourceVersion !== source.sourceVersion)
      throw new Error("本轮引用的资料已更新或失效，请按当前资料重新生成候选。");
  }
}
