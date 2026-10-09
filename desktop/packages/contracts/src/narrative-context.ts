import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";
import type { AgentContextReference } from "./agent-context.js";
import {
  NarrativeStorySelectionsSchema,
  NarrativeStorySourceBasisSchema,
} from "./narrative-story-index.js";
import type {
  NarrativePlanningRequest,
  NarrativePlanningSource,
  NarrativePlanningBasis,
} from "./narrative-planning.js";
import type {
  ProductionNarrativeRequest,
  ProductionNarrativeSource,
  ProductionNarrativeBasis,
} from "./production-narrative.js";

const ref = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().nonnegative(),
  })
  .strict();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const selectedChapter = z.discriminatedUnion("representation", [
  ref.extend({ representation: z.literal("original") }).strict(),
  ref.extend({ representation: z.literal("summary"), record: ref }).strict(),
  ref
    .extend({
      representation: z.literal("paragraphs"),
      paragraphIds: z.array(z.string().min(1)).min(1).max(500),
    })
    .strict(),
]);
export const NarrativeContextRequestSchema = z
  .object({
    format: z.literal("narrative-context-v1"),
    chapters: z.array(selectedChapter).max(2000),
    summaries: z.array(ref).max(100).optional(),
    story: NarrativeStorySelectionsSchema.optional(),
  })
  .strict()
  .superRefine((value, check) => {
    if (
      new Set(value.summaries?.map((summary) => summary.id)).size !==
      (value.summaries?.length ?? 0)
    )
      check.addIssue({
        code: "custom",
        path: ["summaries"],
        message: "高层摘要不能重复。",
      });
    if (
      new Set(value.chapters.map((chapter) => chapter.id)).size !==
      value.chapters.length
    )
      check.addIssue({
        code: "custom",
        path: ["chapters"],
        message: "上下文章节不能重复。",
      });
    value.chapters.forEach((chapter, index) => {
      if (
        chapter.representation === "paragraphs" &&
        new Set(chapter.paragraphIds).size !== chapter.paragraphIds.length
      )
        check.addIssue({
          code: "custom",
          path: ["chapters", index, "paragraphIds"],
          message: "原文段落不能重复。",
        });
    });
  });
const sourceBasis = z.object({
  chapters: z.array(
    z.discriminatedUnion("representation", [
      selectedChapter.options[0].extend({ contentHash: hash }),
      selectedChapter.options[1].extend({ contentHash: hash }),
      selectedChapter.options[2].extend({ contentHash: hash }),
    ]),
  ),
  summaries: z
    .array(
      ref.extend({
        target: ref.extend({ kind: z.enum(["book", "volume", "story-arc"]) }),
        scopeTitle: z.string(),
        scopeFingerprint: hash,
        scopeState: z.enum(["current", "stale"]),
        chapters: z.array(ref.extend({ contentHash: hash })),
      }),
    )
    .optional(),
  story: z.array(NarrativeStorySourceBasisSchema).max(200).optional(),
  omitted: z.array(ref.extend({ reason: z.enum(["not-selected", "empty"]) })),
  references: z.array(
    z.object({
      sourceKind: z.enum(["chapter", "knowledge"]),
      sourceId: z.string(),
      sourceVersion: z.number().int().nonnegative(),
      fieldPath: z.string().startsWith("/"),
      contentHash: hash,
    }),
  ),
});
function refineStoryReferences(
  value: z.infer<typeof sourceBasis>,
  check: z.RefinementCtx,
): void {
  const references = new Map<string, typeof value.references>();
  const key = (id: string, version: number, path: string) =>
    JSON.stringify([id, version, path]);
  for (const reference of value.references) {
    if (!reference.fieldPath.startsWith("/narrative-story-index/")) continue;
    const identity = key(
      reference.sourceId,
      reference.sourceVersion,
      reference.fieldPath,
    );
    const matches = references.get(identity) ?? [];
    matches.push(reference);
    references.set(identity, matches);
  }
  const selected = new Set<string>();
  for (const [index, item] of (value.story ?? []).entries()) {
    const { kind, id, version } = item.selection;
    const identity = JSON.stringify([kind, id]);
    const path = `/narrative-story-index/${kind}s/${id}`;
    const matches = references.get(key(id, version, path)) ?? [];
    if (
      selected.has(identity) ||
      (kind === "declaration"
        ? item.record.kind !== "node"
        : item.record.kind === "node") ||
      matches.length !== 1 ||
      matches[0]?.sourceKind !== "knowledge" ||
      matches[0]?.contentHash !== item.contentHash
    ) {
      check.addIssue({
        code: "custom",
        path: ["story", index],
        message:
          "冻结叙事声明须唯一绑定实际类型、版本及同哈希来源引用，不补造或重绑。",
      });
    }
    selected.add(identity);
    references.delete(key(id, version, path));
  }
  if (references.size)
    check.addIssue({
      code: "custom",
      path: ["references"],
      message: "冻结叙事来源引用缺少对应的实际选中声明。",
    });
}
export const NarrativeSourceBasisSchema = sourceBasis
  .extend({
    kind: z.literal("author-selected-narrative-sources"),
    projectId: z.string().uuid(),
  })
  .superRefine(refineStoryReferences);
export const NarrativeContextBasisSchema = sourceBasis
  .extend({
    kind: z.literal("author-selected-novel-context"),
    target: ref,
    contextBudget: z
      .object({
        source: z.literal("estimate"),
        tokenBudget: z.number().int().positive(),
        estimatedTokens: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .superRefine(refineStoryReferences);
export type NarrativeContextRequest = z.infer<
  typeof NarrativeContextRequestSchema
>;
export type NarrativeContextBasis = z.infer<typeof NarrativeContextBasisSchema>;
export type NarrativeSourceBasis = z.infer<typeof NarrativeSourceBasisSchema>;

/** Bind a confirmed request to its frozen selection; coverage is separate. */
export function refineNarrativeSourceSelection(
  value: {
    projectId: string;
    request: { context: NarrativeContextRequest };
    sourceBasis: NarrativeSourceBasis;
  },
  check: z.RefinementCtx,
): void {
  const selected = value.sourceBasis;
  const request = value.request.context;
  if (
    value.projectId !== selected.projectId ||
    JSON.stringify(request.chapters) !==
      JSON.stringify(
        selected.chapters.map(({ contentHash: _hash, ...chapter }) => chapter),
      ) ||
    JSON.stringify(request.summaries ?? []) !==
      JSON.stringify(
        (selected.summaries ?? []).map(({ id, version }) => ({ id, version })),
      ) ||
    JSON.stringify(request.story ?? []) !==
      JSON.stringify((selected.story ?? []).map((item) => item.selection))
  ) {
    check.addIssue({
      code: "custom",
      path: ["sourceBasis"],
      message:
        "冻结来源与本轮确认的项目、章节表达、摘要及叙事声明不一致，不补最新或漏选。",
    });
  }
}

export const NarrativeReviewedSourceSchema = z
  .object({
    sourceId: z.string().uuid(),
    sourceVersion: z.number().int().nonnegative(),
    fieldPath: z.string().startsWith("/"),
  })
  .strict();

/** Reconstruct only the author's safe selection, never text from a frozen basis. */
export function narrativeSourceSelection(
  basis: NarrativeSourceBasis,
): NarrativeContextRequest {
  const value = NarrativeSourceBasisSchema.parse(basis);
  return NarrativeContextRequestSchema.parse({
    format: "narrative-context-v1",
    chapters: value.chapters.map(
      ({ contentHash: _hash, ...chapter }) => chapter,
    ),
    summaries: value.summaries?.map(({ id, version }) => ({ id, version })),
    story: value.story?.map((item) => item.selection),
  });
}

/** Directory growth may change a higher summary's current scope state, not its original inputs. */
export function narrativeSourceIdentity(basis: NarrativeSourceBasis): string {
  const value = NarrativeSourceBasisSchema.parse(basis);
  return JSON.stringify({
    ...value,
    summaries: value.summaries?.map(
      ({ scopeState: _state, ...summary }) => summary,
    ),
  });
}

export function narrativeChapterRepresentations(
  basis: NarrativeSourceBasis,
  chapterId: string,
): string[] {
  return [
    ...basis.chapters
      .filter((item) => item.id === chapterId)
      .map((item) => item.representation),
    ...(basis.summaries?.some((item) =>
      item.chapters.some((chapter) => chapter.id === chapterId),
    )
      ? ["hierarchical-summary"]
      : []),
  ];
}
// Internal read-only compiler. Consumers supply exact allowed chapter versions;
// Writing verifies ownership/order and never accepts client text or fake targets.
export const WRITING_NARRATIVE_SOURCE_SERVICE = defineServiceContract<{
  assertProductionCurrent(
    projectId: string,
    workflowId: string,
    basis: ProductionNarrativeBasis,
  ): void;
  production(
    projectId: string,
    request: ProductionNarrativeRequest,
  ): { basis: ProductionNarrativeSource; references: AgentContextReference[] };
  assertPlanningCurrent(
    projectId: string,
    workflowId: string,
    basis: NarrativePlanningBasis,
  ): void;
  planning(
    projectId: string,
    request: NarrativePlanningRequest,
  ): { basis: NarrativePlanningSource; references: AgentContextReference[] };
  compile(
    projectId: string,
    scope: readonly { id: string; version: number }[],
    request: NarrativeContextRequest,
  ): { basis: NarrativeSourceBasis; references: AgentContextReference[] };
}>({
  id: "writing.narrative-sources.v1",
  owner: "writing",
  major: 1,
  capabilities: [
    "compile",
    "planning",
    "assertPlanningCurrent",
    "production",
    "assertProductionCurrent",
  ],
  degradable: true,
});
