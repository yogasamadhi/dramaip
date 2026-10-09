import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";
import { ScreenplaySourceDocumentSchema } from "./screenplay-source.js";
export { canonicalImportRequestJSON } from "./import-recovery.js";
export * from "./adaptation-diagnosis.js";
export * from "./adaptation-strategy.js";
export * from "./season-plan.js";
export * from "./episode-development.js";
export * from "./episode-impact.js";
export * from "./production-record-baseline.js";
export * from "./production-record-merge.js";
export * from "./episode-script-revision.js";
export * from "./episode-topology-revision.js";
export * from "./episode-source-receipt.js";
export * from "./episode-source-revision.js";
export * from "./storyboard-package.js";
export * from "./storyboard-attribution.js";
export * from "./storyboard-attribution-impact.js";
export * from "./storyboard-source-review.js";
export * from "./screenplay-intake.js";
export * from "./screenplay-source.js";
export { ScreenplayBlockSchema } from "./screenplay-block.js";
import { ScreenplayBlockSchema } from "./screenplay-block.js";

export const ScreenplayDocumentSchema = z.object({
  id: z.string().uuid(),
  scriptId: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().min(1).max(240),
  sourceFormat: z.enum(["native", "fountain", "fdx", "pdf"]),
  blocks: z.array(ScreenplayBlockSchema),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ScreenplayLossReportSchema = z.object({
  unsupported: z.array(z.string()),
  warnings: z.array(z.string()),
  preserved: z.array(z.string()),
});

export const ScreenplayImportTargetSchema = z.object({
  projectVersion: z.number().int().nonnegative(),
  episodeVersion: z.number().int().nonnegative(),
});
export const ScreenplayImportConfirmationSchema = z.object({
  rightsDeclared: z.literal(true),
  lossReportReviewed: z.literal(true),
});
export const ScreenplayImportReceiptSchema = z.object({
  scriptId: z.string().uuid(),
  scriptVersion: z.number().int().nonnegative(),
  documentId: z.string().uuid(),
  documentVersion: z.number().int().nonnegative(),
  committedAt: z.string().datetime(),
  confirmation: ScreenplayImportConfirmationSchema.optional(),
});

export const ScreenplayImportPreviewInputSchema = z.object({
  projectId: z.string().uuid(),
  parentId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(240),
  grantId: z.string().uuid(),
  target: ScreenplayImportTargetSchema.optional(),
});

export const ScreenplayImportPreviewSchema = z.object({
  previewId: z.string().uuid(),
  projectId: z.string().uuid(),
  parentId: z.string().uuid().optional(),
  title: z.string(),
  sourceName: z.string(),
  sourceFormat: z.enum(["fountain", "fdx", "pdf"]),
  blocks: z.array(ScreenplayBlockSchema),
  lossReport: ScreenplayLossReportSchema,
  etag: z.string(),
  status: z.enum(["pending", "committed", "discarded"]),
  createdAt: z.string().datetime(),
  target: ScreenplayImportTargetSchema.optional(),
  receipt: ScreenplayImportReceiptSchema.optional(),
});

export const ScreenplayImportCommitSchema = z.object({
  previewId: z.string().uuid(),
  confirmation: ScreenplayImportConfirmationSchema.optional(),
});

export const ScreenplayPatchSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  blocks: z.array(ScreenplayBlockSchema),
  version: z.number().int().nonnegative(),
});

export const ScreenplayExportDocumentSchema = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  content: z.string(),
  lossReport: ScreenplayLossReportSchema,
});

export type ScreenplayBlock = z.infer<typeof ScreenplayBlockSchema>;
export type ScreenplayDocument = z.infer<typeof ScreenplayDocumentSchema>;
export type ScreenplayLossReport = z.infer<typeof ScreenplayLossReportSchema>;
export type ScreenplayImportPreview = z.infer<
  typeof ScreenplayImportPreviewSchema
>;

export const SeasonStatusSchema = z.enum([
  "draft",
  "ready",
  "review_required",
  "archived",
]);
export const SeasonSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  adaptationId: z.string().uuid().optional(),
  title: z.string().min(1).max(240),
  outline: z.string(),
  sourceChapterVersion: z.string().optional(),
  status: SeasonStatusSchema,
  orderIndex: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const SeasonInputSchema = z.object({
  projectId: z.string().uuid(),
  adaptationId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(240),
  outline: z.string().optional(),
  sourceChapterVersion: z.string().optional(),
});
export const SeasonPatchSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  outline: z.string().optional(),
  status: SeasonStatusSchema.optional(),
  version: z.number().int().nonnegative(),
});
export const SeasonChapterMappingInputSchema = z.object({
  seasonId: z.string().uuid(),
  chapterId: z.string().uuid(),
  chapterVersion: z.number().int().nonnegative(),
});
export const SeasonChapterMappingSchema =
  SeasonChapterMappingInputSchema.extend({
    id: z.string().uuid(),
    createdAt: z.string().datetime(),
  });
export const SeasonPageSchema = z.object({
  items: z.array(SeasonSchema),
  nextCursor: z.string().optional(),
});
export type Season = z.infer<typeof SeasonSchema>;
export type SeasonPage = z.infer<typeof SeasonPageSchema>;
export type SeasonChapterMapping = z.infer<typeof SeasonChapterMappingSchema>;

export const PRODUCTION_SEASON_SERVICE =
  defineServiceContract<ProductionSeasonService>({
    id: "production.seasons.v1",
    owner: "production",
    major: 1,
    capabilities: ["read", "write"],
    degradable: true,
  });
export interface ProductionSeasonService {
  create(input: z.infer<typeof SeasonInputSchema>): Season;
  get(id: string): Season | undefined;
  list(
    projectId: string,
    options?: { cursor?: string; limit?: number },
  ): { items: readonly Season[]; nextCursor?: string };
  update(
    id: string,
    patch: z.infer<typeof SeasonPatchSchema>,
  ): Season | "conflict" | undefined;
  mapChapter(
    input: z.infer<typeof SeasonChapterMappingInputSchema>,
  ): SeasonChapterMapping;
}

export const ProductionRecordKindSchema = z.enum([
  "adaptations",
  "episodes",
  "scripts",
  "scenes",
  "shots",
]);

export const ProductionRecordSchema = z.object({
  id: z.string().uuid(),
  kind: ProductionRecordKindSchema,
  domain: ProductionRecordKindSchema,
  projectId: z.string().uuid(),
  parentId: z.string().uuid().optional(),
  title: z.string().min(1).max(240),
  payload: z.record(z.string(), z.unknown()),
  orderIndex: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  retirement: z
    .object({
      resultId: z.string().uuid(),
      retiredAt: z.string().datetime(),
      reason: z.enum(["author-scene-shot-plan", "author-scene-topology-plan"]),
    })
    .strict()
    .optional(),
});

export const ProductionRecordInputSchema = ProductionRecordSchema.pick({
  projectId: true,
  parentId: true,
  title: true,
  payload: true,
}).extend({ payload: z.record(z.string(), z.unknown()).optional() });

export const ProductionRecordPatchSchema = z.object({
  title: z.string().min(1).max(240).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  version: z.number().int().nonnegative(),
});

export const ProductionGraphNodeSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  title: z.string(),
  status: z.string(),
});

export const ProductionGraphSchema = z.object({
  projectId: z.string().uuid(),
  nodes: z.array(ProductionGraphNodeSchema),
  edges: z.array(
    z.object({
      sourceId: z.string().uuid(),
      targetId: z.string().uuid(),
      relation: z.string(),
    }),
  ),
  coverage: z.object({
    episodes: z.number().int().nonnegative(),
    scripts: z.number().int().nonnegative(),
    scenes: z.number().int().nonnegative(),
    shots: z.number().int().nonnegative(),
    assets: z.number().int().nonnegative(),
    stills: z.number().int().nonnegative(),
    adoptedStills: z.number().int().nonnegative(),
  }),
});

export const ProjectProgressSchema = z.object({
  projectId: z.string().uuid(),
  scope: z.object({
    kind: z.enum(["project", "episodes"]),
    episodeIds: z.array(z.string().uuid()),
  }),
  sourceVersion: z.number().int().nonnegative(),
  completion: z.number().min(0).max(1),
  steps: z.array(
    z.object({
      id: z.enum(["source", "script", "scenes", "shots", "assets", "review"]),
      label: z.string(),
      current: z.number().int().nonnegative(),
      required: z.number().int().nonnegative(),
      complete: z.boolean(),
      target: z.string(),
    }),
  ),
  blockers: z.array(
    z.object({ code: z.string(), message: z.string(), target: z.string() }),
  ),
  nextAction: z.object({ label: z.string(), target: z.string() }),
});
export type ProjectProgress = z.infer<typeof ProjectProgressSchema>;

export const ProductionImpactInputSchema = z.object({
  projectId: z.string().uuid(),
  sourceId: z.string().uuid(),
});

export const ProductionImpactSchema = z.object({
  sourceId: z.string().uuid(),
  affected: z.array(ProductionGraphNodeSchema),
  summary: z.string(),
});

export const ProductionReorderInputSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      version: z.number().int().nonnegative(),
    }),
  ),
});

export const ProductionReorderResultSchema = z.object({
  records: z.array(ProductionRecordSchema),
});

export type ProductionRecordKind = z.infer<typeof ProductionRecordKindSchema>;
export type ProductionRecord = z.infer<typeof ProductionRecordSchema>;
export type ProductionRecordInput = z.infer<typeof ProductionRecordInputSchema>;

const productionQualityIdentity = {
  projectId: z.string().uuid(),
  id: z.string().uuid(),
  kind: z.enum(["script", "scene"]),
  version: z.number().int().nonnegative(),
  title: z.string().min(1).max(240),
  parentId: z.string().uuid().optional(),
};
export const ProductionQualitySourceSummarySchema = z
  .object({
    ...productionQualityIdentity,
    state: z.enum(["available", "unavailable"]),
  })
  .strict();
export const ProductionQualitySourceSchema = z
  .object({
    ...productionQualityIdentity,
    source: z.discriminatedUnion("state", [
      z
        .object({
          state: z.literal("available"),
          contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
          recordContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
          record: ProductionRecordSchema,
          document: ScreenplaySourceDocumentSchema.optional(),
          documentContentHash: z
            .string()
            .regex(/^[a-f0-9]{64}$/u)
            .optional(),
          ancestors: z
            .array(
              z
                .object({
                  id: z.string().uuid(),
                  kind: z.enum(["adaptations", "episodes", "scripts"]),
                  version: z.number().int().nonnegative(),
                  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
                  document: z
                    .object({
                      id: z.string().uuid(),
                      version: z.number().int().nonnegative(),
                      contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
                    })
                    .strict()
                    .optional(),
                })
                .strict(),
            )
            .max(3),
          policyDependencies: z
            .array(
              z
                .object({
                  sourceId: z.string().min(1),
                  sourceVersion: z.number().int().nonnegative(),
                  fieldPath: z.string().startsWith("/").max(500),
                })
                .strict(),
            )
            .max(2000),
        })
        .strict(),
      z
        .object({
          state: z.literal("unavailable"),
          reason: z.enum([
            "invalid-record",
            "invalid-parent",
            "empty-source",
            "saved-document-missing",
            "invalid-saved-document",
            "lineage-unavailable",
          ]),
        })
        .strict(),
    ]),
  })
  .strict()
  .superRefine((value, check) => {
    if (value.source.state !== "available") return;
    const { record, document, documentContentHash } = value.source;
    if (
      record.id !== value.id ||
      record.projectId !== value.projectId ||
      record.version !== value.version ||
      record.title !== value.title ||
      record.parentId !== value.parentId ||
      record.kind !== (value.kind === "script" ? "scripts" : "scenes") ||
      record.domain !== record.kind ||
      (value.kind === "script"
        ? !document || !documentContentHash
        : Boolean(document || documentContentHash)) ||
      (document &&
        new Set(document.blocks.map((block) => block.id)).size !==
          document.blocks.length) ||
      new Set(value.source.ancestors.map((ancestor) => ancestor.id)).size !==
        value.source.ancestors.length ||
      value.source.ancestors.some(
        (ancestor) =>
          (ancestor.kind === "scripts") !== Boolean(ancestor.document),
      )
    )
      check.addIssue({
        code: "custom",
        message: "实际剧本／场景、保存文档与父级身份无法核对。",
      });
  });
export const ProductionQualitySourcePageSchema = z
  .object({
    projectId: z.string().uuid(),
    items: z.array(ProductionQualitySourceSummarySchema),
    nextCursor: z.string().uuid().optional(),
  })
  .strict();
export type ProductionQualitySource = z.infer<
  typeof ProductionQualitySourceSchema
>;
export type ProductionQualitySourcePage = z.infer<
  typeof ProductionQualitySourcePageSchema
>;
export const PRODUCTION_QUALITY_SOURCE_SERVICE = defineServiceContract<{
  get(projectId: string, id: string): ProductionQualitySource | undefined;
  list(
    projectId: string,
    options?: { cursor?: string; limit?: number },
  ): ProductionQualitySourcePage;
}>({
  id: "production.quality-sources.v1",
  owner: "production",
  major: 1,
  capabilities: ["read"],
  degradable: true,
});

export const PRODUCTION_RECORD_SERVICE =
  defineServiceContract<ProductionRecordService>({
    id: "production.records.v1",
    owner: "production",
    major: 1,
    capabilities: ["read", "write"],
    degradable: true,
  });

export interface ProductionRecordService {
  importBatch(
    input: ProductionImportBatchInput,
  ):
    | { state: "committed"; receipt: ProductionImportBatchReceipt }
    | { state: "conflict" };
  create(
    kind: ProductionRecordKind,
    input: ProductionRecordInput,
  ): ProductionRecord;
  list(
    kind: ProductionRecordKind,
    filter: { projectId?: string; parentId?: string },
  ): readonly ProductionRecord[];
  get(id: string): ProductionRecord | undefined;
  update(
    id: string,
    patch: {
      title?: string;
      payload?: Record<string, unknown>;
      version: number;
    },
  ): ProductionRecord | "conflict" | undefined;
  remove(id: string, expectedVersion?: number): boolean;
}

export const ProductionImportBatchInputSchema = z
  .object({
    importId: z.string().uuid(),
    projectId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    sourceName: z.string(),
    episodes: z
      .array(
        z
          .object({
            sourceKey: z.string().min(1).max(500),
            episodeNumber: z.number().int().positive(),
            title: z.string().trim().min(1).max(230),
            content: z.string(),
            scenes: z.array(z.record(z.string(), z.unknown())).max(2000),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.episodes.map((episode) => episode.sourceKey)).size ===
      value.episodes.length,
  )
  .refine((value) =>
    value.episodes.every((episode) =>
      episode.scenes.every(
        (scene) =>
          typeof scene.title !== "string" || scene.title.trim().length <= 240,
      ),
    ),
  );
export const ProductionImportBatchReceiptSchema = z
  .object({
    importId: z.string().uuid(),
    projectId: z.string().uuid(),
    committedAt: z.string().datetime(),
    adaptationId: z.string().uuid(),
    episodes: z
      .array(
        z
          .object({
            sourceKey: z.string().min(1).max(500),
            episodeId: z.string().uuid(),
            scriptId: z.string().uuid(),
            sceneIds: z.array(z.string().uuid()).max(2000),
            version: z.literal(0),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
  })
  .strict()
  .refine((value) => {
    const ids = [
      value.adaptationId,
      ...value.episodes.flatMap((episode) => [
        episode.episodeId,
        episode.scriptId,
        ...episode.sceneIds,
      ]),
    ];
    return (
      new Set(ids).size === ids.length &&
      new Set(value.episodes.map((episode) => episode.sourceKey)).size ===
        value.episodes.length
    );
  });
export type ProductionImportBatchInput = z.infer<
  typeof ProductionImportBatchInputSchema
>;
export type ProductionImportBatchReceipt = z.infer<
  typeof ProductionImportBatchReceiptSchema
>;
