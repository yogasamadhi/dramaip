import { QualityProjectPackageLineageSchema } from "./quality-project-lineage.js";
export * from "./quality-project-lineage.js";
import { WorkspaceProjectPackageLineageSchema } from "./workspace-project-lineage.js";
export * from "./workspace-project-lineage.js";
import {
  KnowledgeProjectPackageLineageSchema,
  knowledgeProjectLineageIdentity,
} from "./knowledge-project-lineage.js";
export * from "./knowledge-project-lineage.js";
import { ProductionRecordMergeFieldSchema } from "./production-record-merge.js";
import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";
import {
  CreationOperationSchema,
  CreationStageSchema,
  CreationScriptMergeBasisSchema,
} from "./creation.js";
import { AgentContextIntegritySchema } from "./agent-context.js";
import { CreativeContinuationBasisSchema } from "./creative-continuation.js";

const uuid = z.string().uuid();
const version = z.number().int().nonnegative();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
// These are business identities/JSON field selectors, not host filesystem paths.
const opaque = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,499}$/u);
const field = z.union([
  z
    .string()
    .max(1000)
    .regex(
      /^\/(?:project|projects|chapters|characters|outlines|story-arcs|writing-resources|intent|selection|production|scripts|knowledge|author-intents|narrative-summaries|narrative-story-index|story-declarations|story-assertions|story-bible|review|delivery|creator-content|preferences|profile)(?:\/[^\p{Cc}\\:%]*)?$/u,
    )
    .refine((value) => !value.includes("..") && !value.includes("//")),
  // Existing persisted selectors encode the actual paragraph identity. Keep
  // those exact bytes; accepting this protocol is not accepting arbitrary URL
  // encoding, filesystem paths, or rewriting the original into a newer hash path.
  z
    .string()
    .regex(
      /^\/chapters\/([a-f0-9-]{36})\/paragraphs\/\1%40\d+%3A\d+-\d+%3A[a-f0-9]{12}$/u,
    ),
]);
const ref = z.object({ id: uuid, version }).strict();
const frozenRef = z
  .object({
    sourceKind: opaque.optional(),
    sourceId: opaque,
    sourceVersion: version,
    fieldPath: field,
    contentHash: hash.optional(),
  })
  .strict();
const origin = z.enum([
  "author-intent",
  "novel-context",
  "novel-planning",
  "production-narrative",
  "quality",
  "diagnosis",
  "strategy",
  "season-plan",
  "episode-development",
  "narrative-summary",
]);
const selection = z.discriminatedUnion("representation", [
  ref
    .extend({ representation: z.literal("original"), contentHash: hash })
    .strict(),
  ref
    .extend({
      representation: z.literal("summary"),
      record: ref,
      contentHash: hash,
    })
    .strict(),
  ref
    .extend({
      representation: z.literal("paragraphs"),
      paragraphIds: z.array(
        z.string().regex(/^[a-f0-9-]{36}@\d+:\d+-\d+:[a-f0-9]{12}$/u),
      ),
      contentHash: hash,
    })
    .strict(),
]);
const source = z
  .object({
    origin,
    chapters: z.array(selection),
    summaries: z
      .array(
        ref
          .extend({
            target: ref
              .extend({ kind: z.enum(["book", "volume", "story-arc"]) })
              .strict(),
            scopeFingerprint: hash,
            scopeState: z.enum(["current", "stale"]),
            chapters: z.array(ref.extend({ contentHash: hash }).strict()),
          })
          .strict(),
      )
      .optional(),
    story: z
      .array(
        z
          .object({
            selection: ref
              .extend({ kind: z.enum(["declaration", "assertion"]) })
              .strict(),
            record: ref
              .extend({ kind: z.enum(["node", "edge", "cognition"]) })
              .strict(),
            sourceFingerprint: hash,
            sourceChapters: z.array(ref),
            sourceScripts: z.array(ref),
            contentHash: hash,
          })
          .strict(),
      )
      .optional(),
    omitted: z.array(
      ref.extend({ reason: z.enum(["not-selected", "empty"]) }).strict(),
    ),
    references: z.array(frozenRef),
  })
  .strict();

const mergeChoiceValue = z
  .object({ state: z.enum(["text", "absent", "unsupported"]), hash })
  .strict();
const mergeLineage = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("creation-rebase"),
      sourceWorkflowId: uuid,
      baseVersion: version,
      comparisonBasis: CreationScriptMergeBasisSchema.optional(),
      blockOrder: z
        .array(uuid)
        .refine((ids) => new Set(ids).size === ids.length)
        .optional(),
      choiceFingerprint: z
        .object({
          format: z.literal("derived-from-persisted-choice-map-v1"),
          count: version,
          sha256: hash,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("storyboard-record-merge"),
      sourceProjectId: uuid,
      format: z.enum([
        "storyboard-record-field-merge-v1",
        "storyboard-record-field-merge-v2",
        "storyboard-record-field-merge-v3",
        "storyboard-record-field-merge-v4",
      ]),
      workflow: ref,
      base: ref,
      episodeId: opaque,
      comparisonHash: hash,
      candidateHash: hash,
      frozenBasisHash: hash,
      contextHash: hash,
      outputHash: hash,
      structure: z
        .object({
          hash,
          script: ref,
          scriptRecordId: uuid,
          documentVersion: version,
        })
        .strict()
        .optional(),
      records: z.array(
        z
          .object({
            id: uuid,
            kind: z.enum(["scenes", "shots"]),
            stableId: opaque,
            frozenVersion: version,
            currentVersion: version,
            frozenHash: hash,
            currentHash: hash,
            parentId: uuid,
            orderIndex: version,
            editable: z.boolean(),
          })
          .strict(),
      ),
      choices: z.array(
        z
          .object({
            recordId: uuid,
            kind: z.enum(["scenes", "shots"]),
            field: ProductionRecordMergeFieldSchema,
            choice: z.enum(["main", "branch"]),
            base: mergeChoiceValue,
            current: mergeChoiceValue,
            candidate: mergeChoiceValue,
          })
          .strict(),
      ),
    })
    .strict(),
]);

export const CreationProjectLineageReceiptSchema = z
  .object({
    id: uuid,
    projectId: uuid,
    taskId: uuid,
    version,
    operation: CreationOperationSchema,
    stage: CreationStageSchema,
    targetId: uuid.optional(),
    baseVersion: version.optional(),
    requestHash: hash.optional(),
    sourceWorkflowId: uuid.optional(),
    mergeLineage: mergeLineage.optional(),
    continuationBasis: CreativeContinuationBasisSchema.optional(),
    sourceSnapshotId: uuid.optional(),
    sourceContextIntegrity: AgentContextIntegritySchema.optional(),
    runIds: z.array(uuid),
    contextSnapshotIds: z.array(uuid),
    sourceVersions: z.array(
      z.object({ kind: opaque, id: opaque, version }).strict(),
    ),
    referenceVersions: z.array(
      frozenRef.omit({ sourceKind: true, contentHash: true }),
    ),
    contextEntries: z
      .array(
        z
          .object({
            included: z.boolean(),
            estimatedTokens: version.optional(),
            fieldPath: field.optional(),
            sourceId: opaque.optional(),
            sourceVersion: version.optional(),
          })
          .strict(),
      )
      .optional(),
    authorIntent: z
      .discriminatedUnion("state", [
        z.object({ state: z.literal("none"), projectId: uuid }).strict(),
        z
          .object({
            state: z.literal("adopted"),
            projectId: uuid,
            id: uuid,
            version,
          })
          .strict(),
      ])
      .optional(),
    outputs: z
      .object({
        authorIntentId: uuid.optional(),
        diagnosisId: uuid.optional(),
        adaptationStrategyId: uuid.optional(),
        seasonPlanId: uuid.optional(),
        episodeResultId: uuid.optional(),
        narrativeReportId: uuid.optional(),
        narrativeSummaryId: uuid.optional(),
        previewId: uuid.optional(),
        memoryWorkflowId: uuid.optional(),
        adoptionCheckId: uuid.optional(),
      })
      .strict(),
    frozenReferences: z.array(
      z.object({ origin, references: z.array(frozenRef) }).strict(),
    ),
    narrativeSelections: z.array(source),
    chapterScopes: z.array(
      z
        .object({
          origin,
          included: z.array(
            ref
              .extend({
                contentHash: hash.optional(),
                narrativeContentHash: hash.optional(),
              })
              .strict(),
          ),
          omitted: z
            .array(
              ref
                .extend({
                  contentHash: hash.optional(),
                  narrativeContentHash: hash.optional(),
                })
                .strict(),
            )
            .optional(),
        })
        .strict(),
    ),
    contextBudgets: z.array(
      z
        .object({
          origin,
          source: z.literal("estimate"),
          tokenBudget: z.number().int().positive(),
          estimatedTokens: version,
        })
        .strict(),
    ),
    upstream: z.array(
      z
        .object({
          origin,
          kind: z.enum([
            "author-intent",
            "diagnosis",
            "strategy",
            "base-adopted",
          ]),
          id: uuid,
          version: version.optional(),
          contentHash: hash.optional(),
        })
        .strict(),
    ),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((value, check) => {
    if (
      value.mergeLineage?.kind === "creation-rebase" &&
      value.mergeLineage.comparisonBasis &&
      (value.mergeLineage.comparisonBasis.projectId !== value.projectId ||
        value.mergeLineage.comparisonBasis.workflowId !==
          value.mergeLineage.sourceWorkflowId)
    )
      check.addIssue({
        code: "custom",
        message: "原合并基准项目与源工作流不可替换。",
      });
    if (
      value.mergeLineage?.kind === "storyboard-record-merge" &&
      value.mergeLineage.sourceProjectId !== value.projectId
    )
      check.addIssue({
        code: "custom",
        message: "原字段合并来源项目不可替换。",
      });
    if (
      (value.authorIntent &&
        value.authorIntent.projectId !== value.projectId) ||
      (value.sourceContextIntegrity &&
        value.sourceContextIntegrity.snapshotId !== value.sourceSnapshotId)
    )
      check.addIssue({
        code: "custom",
        message: "谱系必须绑定原项目意图及实际原快照，不补造或替换身份。",
      });
  });
export type CreationProjectLineageReceipt = z.infer<
  typeof CreationProjectLineageReceiptSchema
>;
export const CreationProjectLineagePageSchema = z
  .object({
    items: z.array(CreationProjectLineageReceiptSchema),
    nextCursor: z.string().optional(),
  })
  .strict();
export type CreationProjectLineagePage = z.infer<
  typeof CreationProjectLineagePageSchema
>;
export const CREATION_PROJECT_LINEAGE_SERVICE = defineServiceContract<{
  list(
    projectId: string,
    options: { cursor?: string; limit: number },
  ): CreationProjectLineagePage;
}>({
  id: "automation.creation-project-lineage.v1",
  owner: "automation",
  major: 1,
  capabilities: ["read"],
  degradable: true,
});

const blockIdentity = z
  .object({
    id: uuid,
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
    index: version,
  })
  .strict();
const productionKind = z.enum([
  "adaptations",
  "episodes",
  "scripts",
  "scenes",
  "shots",
]);
const pointer = z
  .string()
  .max(500)
  .regex(
    /^\/(?:content|summary|outline|payload|synopsis|title|goal|storyline)(?:\/[^\p{Cc}\\:%]*)?$/u,
  )
  .refine((value) => !value.includes("..") && !value.includes("//"));
const position = z
  .object({
    start: version,
    end: z.number().int().positive(),
    chapterStart: version.optional(),
    chapterEnd: z.number().int().positive().optional(),
  })
  .strict();
const evidence = z
  .object({
    sceneId: opaque,
    evidenceId: opaque,
    source: frozenRef,
    valuePath: pointer,
    quoteHash: hash,
    quoteCharacters: z.number().int().positive(),
    offsetUnit: z.literal("utf16-code-unit"),
    matches: z.array(position),
    paragraphId: z
      .string()
      .regex(/^[a-f0-9-]{36}@\d+:\d+-\d+:[a-f0-9]{12}$/u)
      .optional(),
    sourceBlockId: uuid.optional(),
    attribution: z.enum(["model-declared", "human-declared"]),
    matchVerification: z.literal("rule"),
    semanticVerification: z.literal("unverified"),
  })
  .strict();
const savedDocument = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("available"),
      id: uuid,
      version,
      sourceFormat: z.enum(["native", "fountain", "fdx", "pdf"]),
      blocks: z.array(blockIdentity),
      fingerprint: z
        .object({
          format: z.literal("derived-current-saved-document-v1"),
          sha256: hash,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      state: z.literal("unavailable"),
      reason: z.enum(["saved-document-missing", "invalid-saved-document"]),
    })
    .strict(),
]);
const productionRecord = z
  .object({
    kind: z.literal("record"),
    id: uuid,
    projectId: uuid,
    recordKind: productionKind,
    version,
    orderIndex: version,
    observation: z.literal("current-saved-row-not-historical-proof"),
    parent: z.discriminatedUnion("state", [
      z.object({ state: z.literal("none") }).strict(),
      z
        .object({
          state: z.literal("available"),
          id: uuid,
          kind: productionKind,
          version,
        })
        .strict(),
      z.object({ state: z.literal("unresolved"), id: uuid }).strict(),
    ]),
    retirement: z
      .object({
        resultId: uuid,
        retiredAt: z.string().datetime(),
        reason: z
          .enum(["author-scene-shot-plan", "author-scene-topology-plan"])
          .optional(),
      })
      .strict()
      .optional(),
    document: savedDocument.optional(),
  })
  .strict();
const formalResult = z
  .object({
    kind: z.literal("formal-result"),
    id: uuid,
    projectId: uuid,
    version,
    episodeId: opaque,
    operation: z.enum([
      "episode-outline",
      "episode-script",
      "storyboard-package",
    ]),
    origin: z
      .enum([
        "model",
        "human-script-revision",
        "human-topology-revision",
        "human-source-revision",
      ])
      .optional(),
    workflowId: uuid.optional(),
    adoptedAt: z.string().datetime(),
    sourceSnapshotId: uuid,
    sourceContextIntegrity: AgentContextIntegritySchema.optional(),
    runIds: z.array(uuid),
    scriptId: uuid.optional(),
    episodeRecordId: uuid.optional(),
    scriptDocumentVersion: version.optional(),
    references: z.array(frozenRef),
    productionRecords: z
      .array(
        ref
          .extend({ stableId: opaque, kind: z.enum(["scenes", "shots"]) })
          .strict(),
      )
      .optional(),
    parents: z
      .object({
        outline: ref.optional(),
        script: ref.optional(),
        seasonPlan: ref.optional(),
        baseOutlineId: uuid.optional(),
        baseScriptId: uuid.optional(),
        baseScriptDocumentVersion: version.optional(),
        baseStoryboardId: uuid.optional(),
        direct: z
          .object({
            entryPath: z.enum(["inspiration", "script"]),
            project: ref,
            authorIntent: ref,
            episode: ref,
            sourceScript: ref
              .extend({ documentVersion: version.nullable() })
              .strict()
              .optional(),
            durationSeconds: z.number().int().positive(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    authorConfirmation: z
      .object({
        kind: z.enum([
          "human-script-revision",
          "human-topology-revision",
          "human-source-revision",
        ]),
        previewId: uuid,
        sourceResult: ref.optional(),
        sourceScript: ref.optional(),
        sourceOutline: ref.optional(),
        document: ref.extend({ scriptId: uuid }).strict(),
        results: z.object({ outline: ref, script: ref }).strict().optional(),
        semanticVerification: z.literal(
          "human-declared-not-independently-verified",
        ),
      })
      .strict()
      .optional(),
    sceneBlocks: z
      .array(z.object({ sceneId: opaque, blockIds: z.array(uuid) }).strict())
      .optional(),
    shotBlocks: z
      .array(
        z
          .object({ sceneId: opaque, shotId: opaque, blockIds: z.array(uuid) })
          .strict(),
      )
      .optional(),
    evidence: z.array(evidence).optional(),
    semanticVerification: z.literal("unverified"),
  })
  .strict();
const attribution = z
  .object({
    kind: z.literal("shot-attribution"),
    id: uuid,
    projectId: uuid,
    version,
    status: z.enum(["pending", "adopted", "discarded"]),
    origin: z.literal("human-declared"),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    adoptedAt: z.string().datetime().optional(),
    storyboard: ref,
    outline: ref,
    script: ref,
    document: ref
      .extend({ scriptId: uuid, scriptVersion: version, contentHash: hash })
      .strict(),
    sourceFingerprint: hash,
    associationFingerprint: hash,
    links: z.array(
      z
        .object({
          sceneId: opaque,
          shotId: opaque,
          blockIds: z.array(uuid),
          evidence: evidence,
          storyNode: z
            .object({
              node: ref,
              declaration: ref,
              referenceHash: hash,
              linkKind: z.enum([
                "chapter-position",
                "screenplay-block",
                "adopted-fact-record-not-original-quote-position",
              ]),
              semanticVerification: z.literal("unverified"),
            })
            .strict()
            .optional(),
        })
        .strict(),
    ),
    coverage: z
      .object({
        totalShots: z.number().int().positive(),
        associatedShots: z.number().int().positive(),
        nodeAssociatedShots: version,
        associatedBlockCount: z.number().int().positive(),
        unassociatedShotIds: z.array(opaque),
      })
      .strict(),
    semanticVerification: z.literal("unverified"),
  })
  .strict();
export const ProductionProjectLineageItemSchema = z.discriminatedUnion("kind", [
  productionRecord,
  formalResult,
  attribution,
]);
export type ProductionProjectLineageItem = z.infer<
  typeof ProductionProjectLineageItemSchema
>;
export const ProductionProjectLineagePageSchema = z
  .object({
    category: z.enum(["records", "results", "attributions"]),
    items: z.array(ProductionProjectLineageItemSchema),
    nextCursor: uuid.optional(),
  })
  .strict();
export const PRODUCTION_PROJECT_LINEAGE_SERVICE = defineServiceContract<{
  list(
    projectId: string,
    category: "records" | "results" | "attributions",
    options: { cursor?: string; limit: number },
  ): z.infer<typeof ProductionProjectLineagePageSchema>;
}>({
  id: "production.project-lineage.v1",
  owner: "production",
  major: 1,
  capabilities: ["read"],
  degradable: true,
});
const productionLineage = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("available"),
      coverage: z.literal("recorded-production-owner-rows-only"),
      records: z.array(productionRecord),
      results: z.array(formalResult),
      attributions: z.array(attribution),
    })
    .strict(),
  z.object({ state: z.literal("unavailable") }).strict(),
]);

export const ProjectPackageLineageSchema = z
  .object({
    format: z.literal("project-package-lineage-v1"),
    quality: QualityProjectPackageLineageSchema.optional(),
    workspace: WorkspaceProjectPackageLineageSchema.optional(),
    production: productionLineage.optional(),
    knowledge: KnowledgeProjectPackageLineageSchema.optional(),
    sourceProject: ref,
    coverage: z.literal("recorded-workflows-only-not-all-owner-history"),
    workflows: z.discriminatedUnion("state", [
      z
        .object({
          state: z.literal("available"),
          items: z.array(CreationProjectLineageReceiptSchema),
        })
        .strict(),
      z.object({ state: z.literal("unavailable") }).strict(),
    ]),
  })
  .strict()
  .superRefine((value, check) => {
    if (value.quality?.state === "available") {
      for (const [category, items] of [
        ["reports", value.quality.reports],
        ["localReviews", value.quality.localReviews],
      ] as const) {
        const ids = new Set<string>();
        for (const item of items) {
          if (
            item.projectId !== value.sourceProject.id ||
            item.kind !==
              (category === "reports" ? "model-report" : "local-review") ||
            ids.has(item.id)
          )
            check.addIssue({
              code: "custom",
              message: "质量谱系必须属于原项目、原类别且身份唯一。",
            });
          ids.add(item.id);
        }
      }
    }
    if (value.workspace?.state === "available") {
      const ids = new Set<string>();
      for (const item of value.workspace.authorIntents) {
        if (item.projectId !== value.sourceProject.id || ids.has(item.id))
          check.addIssue({
            code: "custom",
            message: "意图谱系必须属于原项目且身份唯一。",
          });
        ids.add(item.id);
      }
    }
    if (value.knowledge?.state === "available") {
      for (const items of [
        value.knowledge.declarations,
        value.knowledge.assertions,
        value.knowledge.summaries,
        value.knowledge.transitions,
      ]) {
        const ids = new Set<string>();
        for (const item of items) {
          const id = knowledgeProjectLineageIdentity(item);
          if (item.projectId !== value.sourceProject.id || ids.has(id))
            check.addIssue({
              code: "custom",
              message: "知识谱系必须属于原项目且身份唯一。",
            });
          ids.add(id);
        }
      }
    }
    if (value.production?.state === "available") {
      for (const items of [
        value.production.records,
        value.production.results,
        value.production.attributions,
      ]) {
        const ids = new Set<string>();
        for (const item of items) {
          if (item.projectId !== value.sourceProject.id || ids.has(item.id))
            check.addIssue({
              code: "custom",
              message: "制作谱系必须属于原项目且身份唯一。",
            });
          ids.add(item.id);
        }
      }
    }
    if (value.workflows.state !== "available") return;
    const ids = new Set<string>();
    for (const item of value.workflows.items) {
      if (item.projectId !== value.sourceProject.id || ids.has(item.id))
        check.addIssue({
          code: "custom",
          message: "谱系必须属于原项目且身份唯一。",
        });
      ids.add(item.id);
    }
  });

export const ImportedProjectLineageClaimSchema = z
  .object({
    format: z.literal("project-package-imported-lineage-v1"),
    sourcePackageSchemaVersion: z.literal(5),
    sourceExportedAt: z.string().datetime(),
    trust: z.literal("imported-claim-not-local-workflow-or-authority"),
    lineage: ProjectPackageLineageSchema,
  })
  .strict();
export const ImportedProjectLineageArchiveSchema =
  ImportedProjectLineageClaimSchema.extend({
    fingerprint: z
      .object({
        format: z.literal("derived-canonical-imported-claim-v1"),
        sha256: hash,
      })
      .strict(),
  }).strict();
export type ImportedProjectLineageArchive = z.infer<
  typeof ImportedProjectLineageArchiveSchema
>;
export const ImportedProjectLineageArchivesSchema = z
  .array(ImportedProjectLineageArchiveSchema)
  .max(10000)
  .refine(
    (items) =>
      new Set(items.map((item) => item.fingerprint.sha256)).size ===
      items.length,
    "导入归档身份不可重复。",
  );
