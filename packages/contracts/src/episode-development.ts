import { z } from "zod";
import { EpisodeSourceRevisionReceiptSchema } from "./episode-source-receipt.js";
import { StoryboardSourceReviewSchema } from "./storyboard-source-review.js";
import type {
  ProductionRecordMergeComparison,
  ProductionRecordMergeRequest,
  ProductionRecordMergeSource,
} from "./production-record-merge.js";
import {
  AgentContextIntegritySchema,
  type AgentContextReference,
} from "./agent-context.js";
import { defineServiceContract } from "./service-contract.js";
import {
  SeasonPlanEpisodeSchema,
  SeasonPlanBasisSchema,
} from "./season-plan.js";
import { ScreenplayBlockSchema } from "./screenplay-block.js";
import {
  StoryboardPackageContentSchema,
  StoryboardRedoSelectionSchema,
  StoryboardRedoReceiptSchema,
  StoryboardShotPlanRequestSchema,
  StoryboardTopologyPlanRequestSchema,
} from "./storyboard-package.js";
import type {
  CreationAdapter,
  CreationWorkflow,
  CreationContent,
} from "./creation.js";
import { DiagnosisChapterSchema } from "./adaptation-diagnosis.js";
import {
  NarrativeSourceBasisSchema,
  NarrativeContextRequestSchema,
} from "./narrative-context.js";

const text = z.string().trim().min(1).max(4000);
const stableId = z.string().trim().min(1).max(64);
const ref = z.object({
  id: z.string().uuid(),
  version: z.number().int().nonnegative(),
});
export const DirectScriptSourceSchema = z
  .object({
    entryPath: z.enum(["inspiration", "script"]),
    project: ref,
    authorIntent: ref,
    episode: ref,
    sourceScript: ref
      .extend({ documentVersion: z.number().int().nonnegative().nullable() })
      .optional(),
    durationSeconds: z.number().int().min(30).max(1800),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.entryPath === "script" && !value.sourceScript)
      ctx.addIssue({
        code: "custom",
        message: "已有剧本路径须明确绑定实际原剧本版本。",
      });
  });
export const DirectScriptEpisodeSchema = z
  .object({
    sourcePath: z.literal("direct-script"),
    id: z.string().uuid(),
    version: z.number().int().nonnegative(),
    title: z.string(),
    orderIndex: z.number().int().nonnegative(),
    durationSeconds: z.number().int().min(30).max(1800),
  })
  .strict();
export const EpisodeDevelopmentRequestSchema = z
  .object({
    seasonPlan: ref.optional(),
    inheritSeasonNarrative: z.literal(true).optional(),
    episodeNarrativeContext: NarrativeContextRequestSchema.optional(),
    sourceEvidenceFormat: z.literal("exact-expression-quotes-v1").optional(),
    direct: DirectScriptSourceSchema.optional(),
    episodeId: stableId,
    outline: ref.optional(),
    baseOutlineId: z.string().uuid().optional(),
    baseScriptId: z.string().uuid().optional(),
    baseScriptDocumentVersion: z.number().int().nonnegative().optional(),
    script: ref.optional(),
    baseStoryboardId: z.string().uuid().optional(),
    redoShots: StoryboardRedoSelectionSchema.optional(),
    redoSourceReview: StoryboardSourceReviewSchema.optional(),
    redoMode: z
      .enum([
        "confirmed-block-structure",
        "scene-shot-plan",
        "scene-topology-plan",
      ])
      .optional(),
    redoShotPlan: StoryboardShotPlanRequestSchema.optional(),
    redoTopologyPlan: StoryboardTopologyPlanRequestSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.redoSourceReview &&
      (!value.redoShots ||
        !value.baseStoryboardId ||
        !value.script ||
        !value.outline)
    )
      ctx.addIssue({
        code: "custom",
        message: "来源影响审阅必须绑定实际原分镜、正式双头与明确镜头重做选择。",
      });
    if (
      value.redoMode &&
      (!value.redoShots ||
        !value.baseStoryboardId ||
        !value.script ||
        !value.outline)
    )
      ctx.addIssue({
        code: "custom",
        message: "结构重做必须明确原镜头选择、原分镜包与正式大纲／剧本基准。",
      });
    if ((value.redoMode === "scene-shot-plan") !== Boolean(value.redoShotPlan))
      ctx.addIssue({
        code: "custom",
        message: "场景镜头计划须明确选择专用协议，其他重做模式不得忽略新计划。",
      });
    if (
      (value.redoMode === "scene-topology-plan") !==
      Boolean(value.redoTopologyPlan)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "场景拓扑计划只能使用专用双正式确认协议，其他模式不得忽略计划。",
      });
    if (Boolean(value.seasonPlan) === Boolean(value.direct))
      ctx.addIssue({
        code: "custom",
        message: "须明确选择正式季纲或直写来源之一，不能混用或缺省。",
      });
    if (value.direct && value.episodeId !== value.direct.episode.id)
      ctx.addIssue({
        code: "custom",
        message: "直写分集必须是所确认实际分集。",
      });
    if (
      (value.direct &&
        (value.inheritSeasonNarrative || value.episodeNarrativeContext)) ||
      (value.inheritSeasonNarrative && value.episodeNarrativeContext)
    )
      ctx.addIssue({
        code: "custom",
        message: "整季继承、本集独立重选与直写来源不能混用。",
      });
    if (
      value.episodeNarrativeContext &&
      !value.episodeNarrativeContext.chapters.length &&
      !value.episodeNarrativeContext.summaries?.length
    )
      ctx.addIssue({
        code: "custom",
        message: "本集独立重选必须明确实际表达，不以空选择补入原文。",
      });
  });
export const EpisodeFrozenReferenceSchema = z.object({
  sourceKind: z.enum([
    "author_intent",
    "production",
    "chapter",
    "knowledge",
    "project",
  ]),
  sourceId: z.string().uuid(),
  sourceVersion: z.number().int().nonnegative(),
  fieldPath: z.string().startsWith("/"),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
});
const storyReference = EpisodeFrozenReferenceSchema.omit({ contentHash: true })
  .extend({
    sourceKind: z.enum(["chapter", "knowledge", "project", "production"]),
  })
  .strict();
/** Declared attribution; the owner verifies exact quotes, not meaning. */
export const EpisodeSceneQuoteSchema = z
  .object({
    id: stableId,
    source: storyReference,
    valuePath: z.string().startsWith("/").max(500),
    quote: z.string().min(1).max(2000),
    rationale: text,
  })
  .strict();
/** Body-free evidence derived only by Production from the frozen snapshot. */
export const EpisodeSceneEvidenceSchema = z
  .object({
    sceneId: stableId,
    evidenceId: stableId,
    source: EpisodeFrozenReferenceSchema,
    valuePath: z.string().startsWith("/").max(500),
    quoteHash: z.string().regex(/^[a-f0-9]{64}$/u),
    quoteCharacters: z.number().int().positive(),
    offsetUnit: z.literal("utf16-code-unit"),
    matches: z
      .array(
        z
          .object({
            start: z.number().int().nonnegative(),
            end: z.number().int().positive(),
            chapterStart: z.number().int().nonnegative().optional(),
            chapterEnd: z.number().int().positive().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
    paragraphId: z.string().min(1).optional(),
    sourceBlockId: z.string().uuid().optional(),
    attribution: z.enum(["model-declared", "human-declared"]),
    matchVerification: z.literal("rule"),
    semanticVerification: z.literal("unverified"),
  })
  .strict();
export const EpisodeDevelopmentBasisSchema = z
  .object({
    request: EpisodeDevelopmentRequestSchema,
    diagnosis: SeasonPlanBasisSchema.shape.diagnosis.optional(),
    strategy: SeasonPlanBasisSchema.shape.strategy,
    authorIntent: SeasonPlanBasisSchema.shape.authorIntent,
    episode: z.union([SeasonPlanEpisodeSchema, DirectScriptEpisodeSchema]),
    chapters: z.array(DiagnosisChapterSchema).max(1000),
    sourceBasis: NarrativeSourceBasisSchema.optional(),
    contextChapters: z
      .array(DiagnosisChapterSchema)
      .min(1)
      .max(1000)
      .optional(),
    references: z.array(EpisodeFrozenReferenceSchema).min(4).max(2000),
    storyboardRedo: StoryboardRedoReceiptSchema.optional(),
    baseStoryboardRecords: z
      .array(
        z.object({
          id: z.string().uuid(),
          version: z.number().int().nonnegative().nullable(),
        }),
      )
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (
      JSON.stringify(value.request.redoSourceReview ?? null) !==
        JSON.stringify(value.storyboardRedo?.sourceReview?.review ?? null) ||
      (value.storyboardRedo?.sourceReview &&
        (value.storyboardRedo.sourceReview.storyboard.id !==
          value.storyboardRedo.base.id ||
          value.storyboardRedo.sourceReview.storyboard.version !==
            value.storyboardRedo.base.version ||
          value.storyboardRedo.sourceReview.episodeId !== value.episode.id))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "来源影响审阅回执必须保留完整原输入、原分镜和分集，不自动重绑。",
      });
    if (value.request.direct) {
      if (
        value.diagnosis ||
        value.strategy ||
        value.chapters.length ||
        value.sourceBasis ||
        value.contextChapters ||
        !("sourcePath" in value.episode) ||
        value.episode.id !== value.request.direct.episode.id ||
        value.episode.version !== value.request.direct.episode.version ||
        value.episode.durationSeconds !==
          value.request.direct.durationSeconds ||
        value.authorIntent.id !== value.request.direct.authorIntent.id ||
        value.authorIntent.version !== value.request.direct.authorIntent.version
      )
        ctx.addIssue({
          code: "custom",
          message: "直写基准不可补造诊断、季纲或章节，必须绑定实际来源。",
        });
    } else if (
      !value.diagnosis ||
      !value.chapters.length ||
      "sourcePath" in value.episode
    ) {
      ctx.addIssue({
        code: "custom",
        message: "季纲路径必须保留诊断和真实章节，不可升级为直写。",
      });
    }
    if (value.sourceBasis) {
      const covered = new Map(
        [
          ...value.sourceBasis.chapters,
          ...(value.sourceBasis.summaries ?? []).flatMap(
            (item) => item.chapters,
          ),
        ].map((item) => [item.id, item.version]),
      );
      if (
        (!value.request.inheritSeasonNarrative &&
          !value.request.episodeNarrativeContext) ||
        !value.contextChapters ||
        (value.request.inheritSeasonNarrative &&
          value.sourceBasis.omitted.length > 0) ||
        covered.size !== value.contextChapters.length ||
        value.contextChapters.some(
          (item) => covered.get(item.id) !== item.version,
        ) ||
        value.chapters.some((item) => covered.get(item.id) !== item.version)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "单集实际表达须明确继承或独立选择、完整覆盖真实本集映射；映射不等于输入范围。",
        });
      if (
        value.request.episodeNarrativeContext &&
        (JSON.stringify(value.request.episodeNarrativeContext.chapters) !==
          JSON.stringify(
            value.sourceBasis.chapters.map(
              ({ contentHash: _hash, ...chapter }) => chapter,
            ),
          ) ||
          JSON.stringify(
            value.request.episodeNarrativeContext.summaries ?? [],
          ) !==
            JSON.stringify(
              (value.sourceBasis.summaries ?? []).map(({ id, version }) => ({
                id,
                version,
              })),
            ) ||
          JSON.stringify(value.request.episodeNarrativeContext.story ?? []) !==
            JSON.stringify(
              (value.sourceBasis.story ?? []).map((item) => item.selection),
            ))
      )
        ctx.addIssue({
          code: "custom",
          message: "本集冻结实际表达与所确认独立选择不一致，不补最新或漏选。",
        });
    } else if (
      value.request.inheritSeasonNarrative ||
      value.request.episodeNarrativeContext ||
      value.contextChapters
    ) {
      ctx.addIssue({
        code: "custom",
        message: "没有混合来源时不可自报整季表达继承。",
      });
    }
  });
export const EpisodeOutlineContentSchema = z.object({
  title: z.string().trim().min(1).max(240),
  logline: text,
  goal: text,
  mainConflict: text,
  turningPoint: text,
  endingHook: text,
  scenes: z
    .array(
      z
        .object({
          id: stableId,
          orderIndex: z.number().int().nonnegative(),
          location: text,
          timeOfDay: text,
          goal: text,
          conflict: text,
          outcome: text,
          characters: z.array(text).min(1).max(100),
          durationSeconds: z.number().int().min(1).max(1800),
          sourceChapters: z.array(ref).max(1000),
          sourceReferences: z
            .array(EpisodeFrozenReferenceSchema.omit({ contentHash: true }))
            .min(1)
            .max(1000)
            .optional(),
          sourceEvidence: z
            .array(EpisodeSceneQuoteSchema)
            .min(1)
            .max(50)
            .optional(),
          beats: z
            .array(z.object({ id: stableId, action: text, causalLink: text }))
            .min(1)
            .max(100),
        })
        .superRefine((scene, ctx) => {
          if (
            Boolean(scene.sourceChapters.length) ===
            Boolean(scene.sourceReferences?.length)
          )
            ctx.addIssue({
              code: "custom",
              message: "场景必须绑定实际章节或直写故事来源之一，不混用或缺失。",
            });
        }),
    )
    .min(1)
    .max(120),
});
export const EpisodeScriptContentSchema = z.object({
  blocks: z.array(ScreenplayBlockSchema).min(2).max(10000),
  sceneLinks: z
    .array(
      z.object({
        sceneId: stableId,
        blockIds: z.array(z.string().uuid()).min(2).max(10000),
      }),
    )
    .min(1)
    .max(120),
});
export const EpisodeDevelopmentOperationSchema = z.enum([
  "episode-outline",
  "episode-script",
  "storyboard-package",
]);
export type EpisodeDevelopmentOperation = z.infer<
  typeof EpisodeDevelopmentOperationSchema
>;
export const EpisodeScriptRevisionReceiptSchema = z
  .object({
    previewId: z.string().uuid(),
    sourceResult: ref,
    document: ref.extend({ scriptId: z.string().uuid() }),
    scriptRecordVersion: z.number().int().nonnegative(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    humanReview: z
      .object({
        actualDocumentReviewed: z.literal(true),
        sceneMappingReviewed: z.literal(true),
        authorIntentAndSourcesRetained: z.literal(true),
      })
      .strict(),
    semanticVerification: z.literal(
      "human-declared-not-independently-verified",
    ),
  })
  .strict();
/** A real author-confirmed pair, never an engine run or an invented workflow. */
export const EpisodeTopologyRevisionReceiptSchema = z
  .object({
    previewId: z.string().uuid(),
    sourceScript: ref,
    sourceOutline: ref,
    document: ref.extend({ scriptId: z.string().uuid() }).strict(),
    scriptRecordVersion: z.number().int().nonnegative(),
    scriptRecordHash: z.string().regex(/^[a-f0-9]{64}$/u),
    outlineContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    scriptContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    inheritedSnapshots: z
      .object({ outline: z.string().uuid(), script: z.string().uuid() })
      .strict(),
    results: z.object({ outline: ref, script: ref }).strict(),
    humanReview: z
      .object({
        actualDocumentReviewed: z.literal(true),
        outlineTopologyReviewed: z.literal(true),
        sceneMappingReviewed: z.literal(true),
        authorIntentAndSourcesRetained: z.literal(true),
      })
      .strict(),
    semanticVerification: z.literal(
      "human-declared-not-independently-verified",
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = [
      value.sourceScript.id,
      value.sourceOutline.id,
      value.results.outline.id,
      value.results.script.id,
    ];
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: "custom",
        message: "双正式确认的原／新大纲与剧本身份必须分别保留。",
      });
  });
export const EpisodeDevelopmentResultSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    workflowId: z.string().uuid().optional(),
    origin: z
      .enum([
        "model",
        "human-script-revision",
        "human-topology-revision",
        "human-source-revision",
      ])
      .optional(),
    scriptRevision: EpisodeScriptRevisionReceiptSchema.optional(),
    topologyRevision: EpisodeTopologyRevisionReceiptSchema.optional(),
    sourceRevision: EpisodeSourceRevisionReceiptSchema.optional(),
    storyboardRedo: StoryboardRedoReceiptSchema.optional(),
    episodeId: stableId,
    operation: EpisodeDevelopmentOperationSchema,
    version: z.number().int().positive(),
    basis: EpisodeDevelopmentBasisSchema,
    content: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("episode-outline"),
        value: EpisodeOutlineContentSchema,
      }),
      z.object({
        kind: z.literal("episode-script"),
        value: EpisodeScriptContentSchema,
      }),
      z.object({
        kind: z.literal("storyboard-package"),
        value: StoryboardPackageContentSchema,
      }),
    ]),
    sourceSnapshotId: z.string().uuid(),
    sourceContextIntegrity: AgentContextIntegritySchema.optional(),
    sourceEvidence: z
      .array(EpisodeSceneEvidenceSchema)
      .min(1)
      .max(6000)
      .optional(),
    runIds: z.array(z.string().uuid()),
    model: z.record(z.string(), z.string()).optional(),
    scriptId: z.string().uuid().optional(),
    episodeRecordId: z.string().uuid().optional(),
    scriptDocumentVersion: z.number().int().nonnegative().optional(),
    productionRecords: z
      .array(
        z.object({
          id: z.string().uuid(),
          stableId: z.string().min(1),
          kind: z.enum(["scenes", "shots"]),
          version: z.number().int().nonnegative(),
        }),
      )
      .optional(),
    adoptedAt: z.string().datetime(),
    isCurrent: z.boolean(),
    sourceState: z.enum(["current", "stale"]),
    staleReasons: z.array(z.string()),
  })
  .superRefine((value, ctx) => {
    if (
      value.sourceContextIntegrity &&
      value.sourceContextIntegrity.snapshotId !== value.sourceSnapshotId
    )
      ctx.addIssue({
        code: "custom",
        message: "正式上下文摘要必须绑定原实际快照，不补最新或其他快照。",
      });
    if (value.origin === "human-source-revision") {
      const receipt = value.sourceRevision;
      const result =
        receipt?.results[
          value.operation === "episode-outline" ? "outline" : "script"
        ];
      if (
        !receipt ||
        value.operation === "storyboard-package" ||
        value.content.kind !== value.operation ||
        value.workflowId ||
        value.model ||
        value.runIds.length ||
        value.scriptRevision ||
        value.topologyRevision ||
        result?.id !== value.id ||
        result.version !== value.version ||
        value.sourceSnapshotId !== receipt.sourceSnapshotId ||
        (value.operation === "episode-script" &&
          (value.scriptId !== receipt.document.scriptId ||
            value.scriptDocumentVersion !== receipt.document.version))
      )
        ctx.addIssue({
          code: "custom",
          message:
            "新来源正式版本须有实际独立确认回执，不假造模型或继承旧来源快照。",
        });
    } else if (value.origin === "human-topology-revision") {
      const receipt = value.topologyRevision;
      const result =
        receipt?.results[
          value.operation === "episode-outline" ? "outline" : "script"
        ];
      if (
        !receipt ||
        value.operation === "storyboard-package" ||
        value.content.kind !== value.operation ||
        value.workflowId ||
        value.model ||
        value.runIds.length ||
        value.scriptRevision ||
        value.sourceRevision ||
        result?.id !== value.id ||
        result.version !== value.version ||
        (value.operation === "episode-script" &&
          (value.scriptId !== receipt.document.scriptId ||
            value.scriptDocumentVersion !== receipt.document.version))
      )
        ctx.addIssue({
          code: "custom",
          message:
            "场景拓扑正式版本必须绑定真实双头确认回执，不可补造模型运行。",
        });
    } else if (value.origin === "human-script-revision") {
      if (
        value.operation !== "episode-script" ||
        value.content.kind !== "episode-script" ||
        !value.scriptRevision ||
        value.topologyRevision ||
        value.sourceRevision ||
        value.workflowId ||
        value.model ||
        value.runIds.length ||
        value.scriptId !== value.scriptRevision.document.scriptId ||
        value.scriptDocumentVersion !== value.scriptRevision.document.version
      )
        ctx.addIssue({
          code: "custom",
          message:
            "人工剧本正式版本必须有实际确认回执，不可补造模型工作流或运行。",
        });
    } else if (
      !value.workflowId ||
      value.scriptRevision ||
      value.topologyRevision ||
      value.sourceRevision
    ) {
      ctx.addIssue({
        code: "custom",
        message: "模型正式版本必须保留实际工作流；不能伪装人工确认。",
      });
    }
  });
export const EpisodeDevelopmentPageSchema = z.object({
  items: z.array(EpisodeDevelopmentResultSchema),
  nextCursor: z.string().uuid().optional(),
});
// Only adoption/source metadata is exposed to global attention aggregation.
// Human confirmations retain their real origin without invented workflow IDs.
export const EpisodeDevelopmentSummarySchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    workflowId: z.string().uuid().optional(),
    origin: z.enum([
      "model",
      "human-script-revision",
      "human-topology-revision",
      "human-source-revision",
    ]),
    episodeId: stableId,
    operation: EpisodeDevelopmentOperationSchema,
    version: z.number().int().positive(),
    adoptedAt: z.string().datetime(),
    isCurrent: z.boolean(),
    sourceState: z.enum(["current", "stale"]),
    staleReasonCount: z.number().int().nonnegative(),
  })
  .strict();
export const EpisodeDevelopmentSummaryPageSchema = z
  .object({
    items: z.array(EpisodeDevelopmentSummarySchema),
    nextCursor: z.string().uuid().optional(),
  })
  .strict();
export type EpisodeDevelopmentSummary = z.infer<
  typeof EpisodeDevelopmentSummarySchema
>;
export type EpisodeDevelopmentSummaryPage = z.infer<
  typeof EpisodeDevelopmentSummaryPageSchema
>;
export const EpisodeDevelopmentCatalogSchema = z.object({
  projectId: z.string().uuid(),
  seasonPlan: ref.optional(),
  narrativeSourceScope: z
    .array(DiagnosisChapterSchema)
    .min(1)
    .max(1000)
    .optional(),
  narrativeSources: z
    .object({
      basis: NarrativeSourceBasisSchema,
      chapters: z.array(DiagnosisChapterSchema).min(1).max(1000),
    })
    .optional(),
  episodes: z.array(SeasonPlanEpisodeSchema),
  storyBibleCount: z.number().int().nonnegative(),
  currentResults: z.array(EpisodeDevelopmentResultSchema),
  direct: z
    .object({
      entryPath: DirectScriptSourceSchema.shape.entryPath,
      project: ref,
      authorIntent: ref.optional(),
      episodes: z.array(
        z.object({
          id: z.string().uuid(),
          version: z.number().int().nonnegative(),
          title: z.string(),
          orderIndex: z.number().int().nonnegative(),
          scripts: z.array(
            ref.extend({
              title: z.string(),
              documentVersion: z.number().int().nonnegative().nullable(),
            }),
          ),
        }),
      ),
    })
    .optional(),
});
export type DirectScriptSource = z.infer<typeof DirectScriptSourceSchema>;
export type EpisodeDevelopmentRequest = z.infer<
  typeof EpisodeDevelopmentRequestSchema
>;
export type EpisodeDevelopmentBasis = z.infer<
  typeof EpisodeDevelopmentBasisSchema
>;
export type EpisodeOutlineContent = z.infer<typeof EpisodeOutlineContentSchema>;
export type EpisodeSceneEvidence = z.infer<typeof EpisodeSceneEvidenceSchema>;
export type EpisodeScriptContent = z.infer<typeof EpisodeScriptContentSchema>;
export type EpisodeDevelopmentResult = z.infer<
  typeof EpisodeDevelopmentResultSchema
>;
export type EpisodeDevelopmentCatalog = z.infer<
  typeof EpisodeDevelopmentCatalogSchema
>;
export type EpisodeDevelopmentPage = z.infer<
  typeof EpisodeDevelopmentPageSchema
>;
const storyboardFormalSourceFrame = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    episodeKey: stableId,
    episodeRecordId: z.string().uuid(),
    sourceState: z.enum(["current", "stale"]),
  })
  .strict();
/** Body-free owner observation of an actual shot, not an editable stable-key claim. */
export const StoryboardShotSourceObservationSchema = z.discriminatedUnion(
  "state",
  [
    z
      .object({
        state: z.literal("current"),
        formal: storyboardFormalSourceFrame.extend({
          sourceState: z.literal("current"),
        }),
      })
      .strict(),
    z
      .object({
        state: z.literal("stale"),
        reasonCode: z.enum([
          "actual-record-retired",
          "not-in-current-formal",
          "formal-source-stale",
          "actual-shot-version-changed",
        ]),
        formal: storyboardFormalSourceFrame.optional(),
      })
      .strict(),
    z.object({ state: z.literal("unbound") }).strict(),
    z
      .object({
        state: z.literal("unavailable"),
        reasonCode: z.literal("formal-source-unavailable"),
      })
      .strict(),
  ],
);
export type StoryboardShotSourceObservation = z.infer<
  typeof StoryboardShotSourceObservationSchema
>;
export const PRODUCTION_EPISODE_DEVELOPMENT_SERVICE = defineServiceContract<
  Pick<CreationAdapter, "prepare" | "validate" | "apply"> & {
    compareRecords(workflow: CreationWorkflow): ProductionRecordMergeComparison;
    mergeRecords(
      workflow: CreationWorkflow,
      request: ProductionRecordMergeRequest,
    ): {
      source: ProductionRecordMergeSource;
      output: CreationContent;
      references: AgentContextReference[];
    };
    result(workflowId: string): string | undefined;
    get(id: string): EpisodeDevelopmentResult | undefined;
    observeStoryboardShot(
      projectId: string,
      shotRecordId: string,
    ): StoryboardShotSourceObservation;
    current(
      projectId: string,
      episodeId: string,
      operation: EpisodeDevelopmentOperation,
    ): EpisodeDevelopmentResult | undefined;
  }
>({
  id: "production.episode-development.v1",
  owner: "production",
  major: 1,
  capabilities: ["prepare", "validate", "apply", "read", "merge"],
  degradable: true,
});
