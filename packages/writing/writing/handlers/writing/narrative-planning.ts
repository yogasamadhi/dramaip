import { createHash } from "node:crypto";
import {
  NarrativePlanningRequestSchema,
  NarrativePlanningSourceSchema,
  ProductionNarrativeRequestSchema,
  ProductionNarrativeSourceSchema,
  NarrativeSourceBasisSchema,
  narrativeChapterRepresentations,
  narrativePlanningDirectory,
  type NarrativePlanningRequest,
  type NarrativePlanningSource,
  type ProductionNarrativeRequest,
  type ProductionNarrativeSource,
} from "@dramaip/contracts/creation";
import type { Chapter } from "@dramaip/contracts/writing";
import type { AgentContextReference } from "@dramaip/contracts/agent-context";
import type {
  NarrativeIndexDetail,
  NarrativeSummary,
} from "@dramaip/contracts/knowledge";
import { prepareNarrativeSources } from "./narrative-context.js";
import type { StorySourceCompiler } from "./narrative-context.js";

export function planningDirectoryFingerprint(
  chapters: readonly Chapter[],
): string {
  return createHash("sha256")
    .update(JSON.stringify(narrativePlanningDirectory(chapters)))
    .digest("hex");
}

/** Owner-only common source compilation, not a fabricated target or workflow. */
function prepareNarrativeScope(
  projectId: string,
  all: readonly Chapter[],
  request: Pick<NarrativePlanningRequest, "chapterScope" | "context">,
  detail: (id: string) => NarrativeIndexDetail | undefined,
  summary: (id: string) => NarrativeSummary | undefined,
  story?: StorySourceCompiler,
): {
  sourceBasis: NarrativePlanningSource["sourceBasis"];
  coverage: NarrativePlanningSource["coverage"];
  references: AgentContextReference[];
} {
  const directory = all
    .filter((chapter) => chapter.projectId === projectId)
    .sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id));
  const scope = request.chapterScope;
  const selected = directory.filter((chapter) =>
    scope.chapters.some((ref) => ref.id === chapter.id),
  );
  if (
    selected.length !== scope.chapters.length ||
    selected.some(
      (chapter, index) =>
        chapter.id !== scope.chapters[index]?.id ||
        chapter.version !== scope.chapters[index]?.version ||
        !chapter.content.trim(),
    )
  )
    throw new Error(
      "来源须按实际目录明确选择本项目当前非空章节，不能替换版本或猜测范围。",
    );
  if (
    scope.mode === "full" &&
    (scope.directoryFingerprint !== planningDirectoryFingerprint(directory) ||
      selected.length !==
        directory.filter((chapter) => chapter.content.trim()).length)
  )
    throw new Error(
      "完整来源须匹配当前全部非空正文及目录指纹，局部范围不能冒充全书。",
    );
  const compiled = prepareNarrativeSources(
    projectId,
    selected,
    request.context,
    detail,
    summary,
    story,
  );
  if (
    compiled.basis.omitted.length ||
    (selected.length && !compiled.references.length)
  )
    throw new Error(
      "每个已确认来源章节须有明确表达，不能漏章、自动补原文或替换旧摘要。",
    );
  return {
    references: compiled.references,
    sourceBasis: compiled.basis,
    coverage: NarrativePlanningSourceSchema.shape.coverage.parse({
      included: selected.map(({ id, version, title }) => ({
        id,
        version,
        title,
        representations: narrativeChapterRepresentations(compiled.basis, id),
      })),
      excluded: directory
        .filter((chapter) => !selected.some((ref) => ref.id === chapter.id))
        .map(({ id, version, content }) => ({
          id,
          version,
          reason: content.trim() ? "not-selected" : "empty",
        })),
      totalChapterCount: directory.length,
      nonEmptyChapterCount: directory.filter((chapter) =>
        chapter.content.trim(),
      ).length,
    }),
  };
}

export function prepareNarrativePlanning(
  projectId: string,
  all: readonly Chapter[],
  raw: NarrativePlanningRequest,
  detail: (id: string) => NarrativeIndexDetail | undefined,
  summary: (id: string) => NarrativeSummary | undefined,
  story?: StorySourceCompiler,
): { basis: NarrativePlanningSource; references: AgentContextReference[] } {
  const request = NarrativePlanningRequestSchema.parse(raw);
  const compiled = prepareNarrativeScope(
    projectId,
    all,
    request,
    detail,
    summary,
    story,
  );
  return {
    references: compiled.references,
    basis: NarrativePlanningSourceSchema.parse({
      kind: "author-selected-narrative-planning",
      projectId,
      request,
      sourceBasis: compiled.sourceBasis,
      coverage: compiled.coverage,
    }),
  };
}

/** Explicit no-manuscript production does not require a manuscript catalogue. */
export function prepareProductionNarrative(
  projectId: string,
  all: readonly Chapter[],
  raw: ProductionNarrativeRequest,
  detail: (id: string) => NarrativeIndexDetail | undefined,
  summary: (id: string) => NarrativeSummary | undefined,
  story?: StorySourceCompiler,
): { basis: ProductionNarrativeSource; references: AgentContextReference[] } {
  const request = ProductionNarrativeRequestSchema.parse(raw);
  if (request.chapterScope.mode === "none")
    return {
      references: [],
      basis: ProductionNarrativeSourceSchema.parse({
        kind: "author-selected-production-narrative",
        projectId,
        request,
        sourceBasis: NarrativeSourceBasisSchema.parse({
          kind: "author-selected-narrative-sources",
          projectId,
          chapters: [],
          omitted: [],
          references: [],
        }),
        coverage: {
          directoryState: "not-read",
          included: [],
          excluded: [],
          totalChapterCount: null,
          nonEmptyChapterCount: null,
        },
      }),
    };
  const compiled = prepareNarrativeScope(
    projectId,
    all,
    request,
    detail,
    summary,
    story,
  );
  return {
    references: compiled.references,
    basis: ProductionNarrativeSourceSchema.parse({
      kind: "author-selected-production-narrative",
      projectId,
      request,
      sourceBasis: compiled.sourceBasis,
      coverage: { directoryState: "read", ...compiled.coverage },
    }),
  };
}
