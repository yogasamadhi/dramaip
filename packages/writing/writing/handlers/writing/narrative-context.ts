import { createHash } from "node:crypto";
import {
  creationReference,
  NarrativeContextRequestSchema,
  type NarrativeContextBasis,
  type NarrativeSourceBasis,
  type NarrativeContextRequest,
} from "@dramaip/contracts/creation";
import type { AgentContextReference } from "@dramaip/contracts/agent-context";
import type { Chapter } from "@dramaip/contracts/writing";
import type {
  NarrativeIndexDetail,
  NarrativeSummary,
  NarrativeStorySelection,
  NarrativeStorySourceBasis,
} from "@dramaip/contracts/knowledge";
import { NarrativeStorySourceBasisSchema } from "@dramaip/contracts/knowledge";

export type StorySourceCompiler = (
  selections: readonly NarrativeStorySelection[],
) => {
  basis: NarrativeStorySourceBasis[];
  references: AgentContextReference[];
};

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const original = ({ id, version, title, orderIndex, content }: Chapter) =>
  creationReference("chapter", { id, version, title, orderIndex, content });

/** Compile only explicitly selected representations. The local index validates
 * receipts; no client-supplied summary, quote, offset or prompt is trusted. */
export function prepareNarrativeSources(
  projectId: string,
  chapters: readonly Chapter[],
  raw: NarrativeContextRequest | undefined,
  detail: (id: string) => NarrativeIndexDetail | undefined,
  summarySource?: (id: string) => NarrativeSummary | undefined,
  storySource?: StorySourceCompiler,
): { basis: NarrativeSourceBasis; references: AgentContextReference[] } {
  const request = NarrativeContextRequestSchema.parse(
    raw ?? { format: "narrative-context-v1", chapters: [] },
  );
  const previous = chapters
    .filter((chapter) => chapter.projectId === projectId)
    .sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id));
  const selected = request.chapters.map((selection) => {
    const chapter = previous.find((item) => item.id === selection.id);
    if (
      !chapter ||
      chapter.version !== selection.version ||
      !chapter.content.trim()
    )
      throw new Error(
        "上下文须明确选择本项目当前已确认范围内章节；旧版本、空章或范围外章节不会自动替换。",
      );
    return { selection, chapter };
  });
  const order = selected.map(({ chapter }) => previous.indexOf(chapter));
  if (order.some((value, index) => index > 0 && value <= order[index - 1]!))
    throw new Error("所选上下文顺序与当前章节目录不符，请重新确认。");
  const references: AgentContextReference[] = [];
  const basisChapters: NarrativeSourceBasis["chapters"] = [];
  const basisSummaries: NonNullable<NarrativeSourceBasis["summaries"]> = [];
  let basisStory: NonNullable<NarrativeSourceBasis["story"]> = [];
  if (request.story?.length) {
    if (!storySource)
      throw new Error("叙事来源索引未启用，不能用候选或未核对声明代替。");
    const compiled = storySource(request.story);
    if (
      compiled.basis.length !== request.story.length ||
      compiled.references.length !== request.story.length
    )
      throw new Error("叙事来源未完整读取，不截断所选声明。");
    for (const [position, rawSource] of compiled.basis.entries()) {
      const source = NarrativeStorySourceBasisSchema.parse(rawSource);
      const selection = request.story[position]!;
      const reference = compiled.references[position]!;
      const value = reference.value as Record<string, unknown> | null;
      const ownerPath =
        selection.kind === "declaration"
          ? "story-declarations"
          : "story-assertions";
      const recordPath =
        source.record.kind === "node"
          ? "nodes"
          : source.record.kind === "edge"
            ? "edges"
            : "cognition";
      const dependencies = [
        {
          sourceId: selection.id,
          sourceVersion: selection.version,
          fieldPath: `/${ownerPath}/${selection.id}`,
        },
        {
          sourceId: source.record.id,
          sourceVersion: source.record.version,
          fieldPath: `/story-declarations/${recordPath}/${source.record.id}`,
        },
        ...source.sourceChapters.map(({ id, version }) => ({
          sourceId: id,
          sourceVersion: version,
          fieldPath: `/chapters/${id}`,
        })),
      ];
      if (
        source.selection.kind !== selection.kind ||
        source.selection.id !== selection.id ||
        source.selection.version !== selection.version ||
        reference.sourceKind !== "knowledge" ||
        reference.sourceId !== selection.id ||
        reference.sourceVersion !== selection.version ||
        reference.fieldPath !==
          `/narrative-story-index/${selection.kind}s/${selection.id}` ||
        !value ||
        value.projectId !== projectId ||
        value.representation !== "source-anchored-story-interpretation" ||
        value.sourceFingerprint !== source.sourceFingerprint ||
        JSON.stringify(value.record) !== JSON.stringify(source.record) ||
        JSON.stringify(value.sourceChapters) !==
          JSON.stringify(source.sourceChapters) ||
        JSON.stringify(value.sourceScripts) !==
          JSON.stringify(source.sourceScripts) ||
        dependencies.some(
          (dependency) =>
            !reference.policyDependencies?.some(
              (actual) =>
                actual.sourceId === dependency.sourceId &&
                actual.sourceVersion === dependency.sourceVersion &&
                actual.fieldPath === dependency.fieldPath,
            ),
        ) ||
        hash(reference.value) !== source.contentHash ||
        source.sourceScripts.length ||
        !source.sourceChapters.length ||
        source.sourceChapters.some(
          (ref) =>
            !previous.some(
              (chapter) =>
                chapter.id === ref.id &&
                chapter.version === ref.version &&
                chapter.content.trim(),
            ),
        )
      )
        throw new Error(
          "叙事声明须完整来自本轮允许的章节版本；不截掉后文、跨范围来源或自动纳入剧本。",
        );
    }
    basisStory = compiled.basis;
    references.push(...compiled.references);
  }
  const summaryCovered = new Set<string>();
  for (const selection of request.summaries ?? []) {
    const summary = summarySource?.(selection.id);
    if (
      !summary ||
      summary.projectId !== projectId ||
      summary.id !== selection.id ||
      summary.version !== selection.version ||
      summary.status !== "adopted" ||
      !summary.isHead ||
      summary.contextEligibility.state !== "eligible"
    )
      throw new Error(
        "所选高层摘要不是来源有效的精确采用头；不能使用候选、旧头或自动替换最新摘要。",
      );
    const covered = summary.content.coveredChapters.map((source) => {
      const chapter = previous.find((item) => item.id === source.id);
      const recorded = summary.basis.directory.find(
        (item) => item.id === source.id,
      );
      if (
        !chapter ||
        !chapter.content.trim() ||
        !recorded?.hasContent ||
        chapter.version !== source.version ||
        recorded.version !== source.version ||
        hash(chapter.content) !== recorded.contentHash
      )
        throw new Error(
          "高层摘要只能引用当前版本的完整已确认范围；包含范围外章节或旧源时不能截取部分摘要冒充有效来源。",
        );
      summaryCovered.add(chapter.id);
      return {
        id: chapter.id,
        version: chapter.version,
        contentHash: recorded.contentHash,
      };
    });
    if (
      !covered.length ||
      covered.some(
        (source, position) =>
          position > 0 &&
          previous.findIndex((item) => item.id === source.id) <=
            previous.findIndex((item) => item.id === covered[position - 1]!.id),
      )
    )
      throw new Error("高层摘要的原覆盖范围与当前目录顺序不符。");
    const dependencies = new Map<
      string,
      { sourceId: string; sourceVersion: number; fieldPath: string }
    >();
    for (const source of [
      ...covered.map((chapter) => ({
        sourceId: chapter.id,
        sourceVersion: chapter.version,
        fieldPath: `/chapters/${chapter.id}`,
      })),
      ...summary.basis.references.map(
        ({ sourceId, sourceVersion, fieldPath }) => ({
          sourceId,
          sourceVersion,
          fieldPath,
        }),
      ),
    ])
      dependencies.set(source.fieldPath, source);
    references.push({
      sourceKind: "knowledge",
      sourceId: summary.id,
      sourceVersion: summary.version,
      fieldPath: `/narrative-summaries/${summary.id}`,
      sensitivity: "project",
      policyDependencies: [...dependencies.values()],
      value: {
        id: summary.id,
        version: summary.version,
        title: `${summary.basis.scopeTitle} · 已采用冻结范围摘要`,
        representation: "hierarchical-summary",
        sourceWorkflowId: summary.workflowId,
        sourceScope: summary.basis.request.target,
        scopeFingerprint: summary.basis.request.scopeFingerprint,
        coveredChapters: summary.content.coveredChapters,
        summary: summary.content.summary,
      },
    });
    basisSummaries.push({
      ...selection,
      target: summary.basis.request.target,
      scopeTitle: summary.basis.scopeTitle,
      scopeFingerprint: summary.basis.request.scopeFingerprint,
      scopeState: summary.sourceState,
      chapters: covered,
    });
  }
  for (const { selection, chapter } of selected) {
    const dependency = {
      sourceId: chapter.id,
      sourceVersion: chapter.version,
      fieldPath: `/chapters/${chapter.id}`,
    };
    if (selection.representation === "original")
      references.push(original(chapter));
    else {
      const index = detail(chapter.id);
      if (
        !index ||
        index.projectId !== projectId ||
        index.chapter.id !== chapter.id ||
        index.chapter.version !== chapter.version ||
        index.chapter.contentHash !== hash(chapter.content)
      )
        throw new Error("章节来源索引与当前正文不符，请重新读取后选择。");
      if (selection.representation === "summary") {
        const summary = index.summaries.find(
          (item) =>
            item.id === selection.record.id &&
            item.version === selection.record.version,
        );
        if (!summary)
          throw new Error(
            "所选摘要缺少当前有效的精确采用来源，不会用旧摘要字段或最新记录替代。",
          );
        references.push({
          sourceKind: "knowledge",
          sourceId: summary.id,
          sourceVersion: summary.version,
          fieldPath: `/knowledge/${summary.id}`,
          sensitivity: "project",
          policyDependencies: [dependency],
          value: {
            id: summary.id,
            version: summary.version,
            title: `${chapter.title} · 已采用派生摘要`,
            representation: "summary",
            sourceChapter: { id: chapter.id, version: chapter.version },
            sourceWorkflowId: summary.sourceWorkflowId,
            summary: summary.text,
          },
        });
      } else {
        const paragraphs = selection.paragraphIds.map((id) => {
          const paragraph = index.paragraphs.find((item) => item.id === id);
          if (
            !paragraph ||
            paragraph.start >= paragraph.end ||
            paragraph.end > chapter.content.length ||
            hash(chapter.content.slice(paragraph.start, paragraph.end)) !==
              paragraph.contentHash
          )
            throw new Error("所选原文段落已失效，不会按旧位置截取新正文。");
          return paragraph;
        });
        if (
          paragraphs.some(
            (paragraph, index) =>
              index > 0 && paragraph.start <= paragraphs[index - 1]!.start,
          )
        )
          throw new Error("原文段落须按实际正文顺序明确选择。");
        for (const paragraph of paragraphs)
          references.push({
            sourceKind: "chapter",
            sourceId: chapter.id,
            sourceVersion: chapter.version,
            fieldPath: `/chapters/${chapter.id}/paragraphs/${paragraph.contentHash}`,
            sensitivity: "project",
            policyDependencies: [dependency],
            value: {
              title: `${chapter.title} · 所选原文段落`,
              representation: "paragraphs",
              chapterId: chapter.id,
              version: chapter.version,
              paragraphId: paragraph.id,
              start: paragraph.start,
              end: paragraph.end,
              content: chapter.content.slice(paragraph.start, paragraph.end),
            },
          });
      }
    }
    basisChapters.push({ ...selection, contentHash: hash(chapter.content) });
  }
  // Matching repeated paragraphs have the same content hash; use their actual
  // version-bound IDs in paths so distinct selections never share a reference.
  for (const reference of references) {
    const value = reference.value as { paragraphId?: string };
    if (value.paragraphId)
      reference.fieldPath = `/chapters/${reference.sourceId}/paragraphs/${encodeURIComponent(value.paragraphId)}`;
  }
  return {
    references,
    basis: {
      kind: "author-selected-narrative-sources",
      projectId,
      chapters: basisChapters,
      ...(basisSummaries.length ? { summaries: basisSummaries } : {}),
      ...(basisStory.length ? { story: basisStory } : {}),
      omitted: previous
        .filter(
          (chapter) =>
            !summaryCovered.has(chapter.id) &&
            !selected.some((item) => item.chapter.id === chapter.id),
        )
        .map((chapter) => ({
          id: chapter.id,
          version: chapter.version,
          reason: chapter.content.trim() ? "not-selected" : "empty",
        })),
      references: references.map((reference) => ({
        sourceKind: reference.sourceKind as "chapter" | "knowledge",
        sourceId: reference.sourceId,
        sourceVersion: reference.sourceVersion,
        fieldPath: reference.fieldPath,
        contentHash: hash(reference.value),
      })),
    },
  };
}

/** Novel continuation additionally freezes the actual target and permits only prior chapters. */
export function prepareNovelContext(
  target: Chapter,
  chapters: readonly Chapter[],
  raw: NarrativeContextRequest | undefined,
  detail: (id: string) => NarrativeIndexDetail | undefined,
  summarySource?: (id: string) => NarrativeSummary | undefined,
  storySource?: StorySourceCompiler,
): { basis: NarrativeContextBasis; references: AgentContextReference[] } {
  const prepared = prepareNarrativeSources(
    target.projectId,
    chapters.filter((chapter) => chapter.orderIndex < target.orderIndex),
    raw,
    detail,
    summarySource,
    storySource,
  );
  const { kind: _kind, projectId: _projectId, ...sources } = prepared.basis;
  const targetReference = original(target);
  return {
    references: [targetReference, ...prepared.references],
    basis: {
      ...sources,
      kind: "author-selected-novel-context",
      target: { id: target.id, version: target.version },
      references: [
        {
          sourceKind: "chapter",
          sourceId: target.id,
          sourceVersion: target.version,
          fieldPath: targetReference.fieldPath,
          contentHash: hash(targetReference.value),
        },
        ...sources.references,
      ],
    },
  };
}
