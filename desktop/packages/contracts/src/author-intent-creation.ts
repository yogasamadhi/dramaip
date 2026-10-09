import { z } from "zod";
import type { AgentContextReference } from "./agent-context.js";
import { defineServiceContract } from "./service-contract.js";
import {
  NarrativeContextRequestSchema,
  NarrativeSourceBasisSchema,
  refineNarrativeSourceSelection,
} from "./narrative-context.js";

const identity = {
  id: z.string().uuid(),
  version: z.number().int().nonnegative(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
};
export const AuthorIntentCreationSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chapter"), ...identity }).strict(),
  z
    .object({
      kind: z.literal("script"),
      ...identity,
      // null freezes the absence of a saved document, never initializes one.
      documentVersion: z.number().int().nonnegative().nullable(),
    })
    .strict(),
]);
export const AuthorIntentCreationRequestSchema = z
  .object({
    projectVersion: z.number().int().nonnegative(),
    baseAdoptedId: z.string().uuid().optional(),
    // Brief-only is a valid independent entry; no implicit chapters or scripts.
    sources: z.array(AuthorIntentCreationSourceSchema).max(2000),
    // Absent preserves the original complete-source protocol. Present freezes
    // expressions in an explicitly selected allowed chapter scope, not a book directory.
    context: NarrativeContextRequestSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const chapters = value.sources.filter(
      (source) => source.kind === "chapter",
    );
    if (
      (!value.context && value.sources.length > 100) ||
      value.sources.filter((source) => source.kind === "script").length > 100
    )
      ctx.addIssue({
        code: "custom",
        path: ["sources"],
        message:
          "旧完整来源及剧本最多 100 份；明确混合章节范围最多 2000 章，不裁剪来源。",
      });
    if (value.context) {
      if (!chapters.length)
        ctx.addIssue({
          code: "custom",
          path: ["context"],
          message: "混合表达须有明确允许章节范围；简报独立入口不附假正文。",
        });
      for (const selected of value.context.chapters)
        if (
          !chapters.some(
            (source) =>
              source.id === selected.id && source.version === selected.version,
          )
        )
          ctx.addIssue({
            code: "custom",
            path: ["context"],
            message: "表达必须对应原确认允许章节及版本，不能追加未选正文。",
          });
      const count =
        value.context.chapters.reduce(
          (sum, item) =>
            sum +
            (item.representation === "paragraphs"
              ? item.paragraphIds.length
              : 1),
          0,
        ) +
        (value.context.summaries?.length ?? 0) +
        (value.context.story?.length ?? 0);
      if (count > 10000)
        ctx.addIssue({
          code: "custom",
          path: ["context"],
          message: "明确表达最多 10000 项，不能自动截断。",
        });
    }
    if (
      new Set(value.sources.map((source) => source.id)).size !==
      value.sources.length
    )
      ctx.addIssue({
        code: "custom",
        message: "来源不能重复。",
        path: ["sources"],
      });
  });
export const AuthorIntentCreationBasisSchema = z
  .object({
    request: AuthorIntentCreationRequestSchema,
    sourceBasis: NarrativeSourceBasisSchema.optional(),
    chapters: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            version: z.number().int().nonnegative(),
            title: z.string(),
          })
          .strict(),
      )
      .max(2000)
      .optional(),
    references: z
      .array(
        z
          .object({
            sourceKind: z.enum([
              "project",
              "author_intent",
              "chapter",
              "production",
              "knowledge",
            ]),
            sourceId: z.string().uuid(),
            sourceVersion: z.number().int().nonnegative(),
            fieldPath: z.string(),
            contentHash: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(1)
      .max(10102),
  })
  .strict()
  .superRefine((value, check) => {
    if (!value.request.context) {
      if (value.sourceBasis || value.chapters || value.references.length > 102)
        check.addIssue({
          code: "custom",
          path: ["sourceBasis"],
          message: "旧完整来源协议不能补造混合表达或升级历史覆盖。",
        });
      return;
    }
    if (!value.sourceBasis || !value.chapters) {
      check.addIssue({
        code: "custom",
        path: ["sourceBasis"],
        message:
          "明确混合输入必须保存原冻结表达与允许章节，不能内部确认代替实际来源。",
      });
      return;
    }
    refineNarrativeSourceSelection(
      {
        projectId: value.sourceBasis.projectId,
        request: { context: value.request.context },
        sourceBasis: value.sourceBasis,
      },
      check,
    );
    const allowed = value.request.sources
      .filter((source) => source.kind === "chapter")
      .map(({ id, version }) => ({ id, version }));
    if (
      value.sourceBasis.omitted.length ||
      JSON.stringify(allowed) !==
        JSON.stringify(
          value.chapters.map(({ id, version }) => ({ id, version })),
        )
    )
      check.addIssue({
        code: "custom",
        path: ["chapters"],
        message: "原确认允许范围须有完整明确表达；未知目录不补造全书覆盖。",
      });
    for (const reference of value.sourceBasis.references)
      if (
        !value.references.some(
          (item) =>
            item.sourceKind === reference.sourceKind &&
            item.sourceId === reference.sourceId &&
            item.sourceVersion === reference.sourceVersion &&
            item.fieldPath === reference.fieldPath &&
            item.contentHash === reference.contentHash,
        )
      )
        check.addIssue({
          code: "custom",
          path: ["references"],
          message: "冻结表达的原引用不能漏掉或换成整章／最新来源。",
        });
  });
export const AuthorIntentCreationProvenanceSchema = z
  .object({
    workflowId: z.string().uuid(),
    sourceSnapshotId: z.string().uuid(),
    runIds: z.array(z.string().uuid()).min(1),
    engineKind: z.enum(["codex", "pi", "langgraph"]),
    basis: AuthorIntentCreationBasisSchema,
  })
  .strict();
export const AuthorIntentSourceCatalogSchema = z
  .object({
    projectVersion: z.number().int().nonnegative(),
    baseAdoptedId: z.string().uuid().optional(),
    chapterAvailable: z.boolean(),
    scriptAvailable: z.boolean(),
    // Metadata only. Bodies are resolved by their authoritative owners locally.
    items: z.array(
      z
        .object({
          title: z.string(),
          source: AuthorIntentCreationSourceSchema,
        })
        .strict(),
    ),
  })
  .strict();
export type AuthorIntentCreationRequest = z.infer<
  typeof AuthorIntentCreationRequestSchema
>;
export type AuthorIntentCreationBasis = z.infer<
  typeof AuthorIntentCreationBasisSchema
>;
export type AuthorIntentCreationSource = z.infer<
  typeof AuthorIntentCreationSourceSchema
>;
export type AuthorIntentSourceCatalog = z.infer<
  typeof AuthorIntentSourceCatalogSchema
>;
export function sameAuthorIntentCreationSource(
  a: AuthorIntentCreationSource,
  b: AuthorIntentCreationSource,
): boolean {
  return (
    a.kind === b.kind &&
    a.id === b.id &&
    a.version === b.version &&
    a.contentHash === b.contentHash &&
    (a.kind !== "script" ||
      (b.kind === "script" && a.documentVersion === b.documentVersion))
  );
}

export interface ProductionAuthorIntentSource {
  title: string;
  source: Extract<AuthorIntentCreationSource, { kind: "script" }>;
  reference: AgentContextReference;
}
export const PRODUCTION_AUTHOR_INTENT_SOURCE_SERVICE = defineServiceContract<{
  get(projectId: string, id: string): ProductionAuthorIntentSource | undefined;
  list(projectId: string): ProductionAuthorIntentSource[];
}>({
  id: "production.author-intent-sources.v1",
  owner: "production",
  major: 1,
  capabilities: ["read"],
  degradable: true,
});
