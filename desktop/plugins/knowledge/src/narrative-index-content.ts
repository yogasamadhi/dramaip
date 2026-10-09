import { createHash } from "node:crypto";
import {
  NarrativeArcScopeSchema,
  type NarrativeIndexCatalog,
  type NarrativeIndexDetail,
} from "@dramaip/contracts/knowledge";
import type {
  Chapter,
  WritingResource,
  WritingVolume,
} from "@dramaip/contracts/writing";
import type { CreationWorkflow } from "@dramaip/contracts/creation";

export type IndexRecord = {
  id: string;
  version: number;
  projectId: string;
  parentId?: string;
  kind: string;
  title: string;
  payload: Record<string, unknown>;
  adopted: boolean;
};
export const indexHash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const estimated = (value: string) =>
  Math.ceil(Buffer.byteLength(value, "utf8") / 4);
const fields: Record<string, string> = {
  "chapter-memories": "章节摘要",
  "character-states": "当前状态",
  "story-events": "事件描述",
  foreshadowings: "伏笔说明",
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
/** Version-bound UTF-16 offsets into the authoritative content string. Never
 * guess a semantic paragraph, nor promise stable IDs across text revisions. */
export function indexParagraphs(
  chapter: Pick<Chapter, "id" | "version" | "content">,
): NarrativeIndexDetail["paragraphs"] {
  const result: NarrativeIndexDetail["paragraphs"] = [];
  const append = (from: number, to: number) => {
    const part = chapter.content.slice(from, to);
    const text = part.trim();
    if (!text) return;
    const start = from + part.indexOf(text),
      end = start + text.length;
    const contentHash = indexHash(text);
    result.push({
      id: `${chapter.id}@${chapter.version}:${start}-${end}:${contentHash.slice(0, 12)}`,
      start,
      end,
      contentHash,
    });
  };
  let cursor = 0;
  for (const match of chapter.content.matchAll(/\r?\n[ \t]*\r?\n/gu)) {
    append(cursor, match.index);
    cursor = match.index + match[0].length;
  }
  append(cursor, chapter.content.length);
  return result;
}
function evidenceMatches(
  chapter: Chapter,
  quote: string,
  paragraphs: NarrativeIndexDetail["paragraphs"],
): NarrativeIndexDetail["summaries"][number]["evidence"]["matches"] {
  const result: NarrativeIndexDetail["summaries"][number]["evidence"]["matches"] =
    [];
  for (let cursor = 0; cursor < chapter.content.length;) {
    const start = chapter.content.indexOf(quote, cursor);
    if (start < 0) break;
    const end = start + quote.length;
    const paragraphIds = paragraphs
      .filter((paragraph) => paragraph.start < end && paragraph.end > start)
      .map((paragraph) => paragraph.id);
    if (paragraphIds.length) result.push({ start, end, paragraphIds });
    cursor = start + 1;
  }
  return result;
}
function chapterDetail(
  projectId: string,
  chapter: Chapter,
  records: IndexRecord[],
  workflows: Map<string, CreationWorkflow | undefined>,
): NarrativeIndexDetail {
  const paragraphs = indexParagraphs(chapter);
  const summaries: NarrativeIndexDetail["summaries"] = [],
    facts: NarrativeIndexDetail["facts"] = [],
    excluded: NarrativeIndexDetail["excluded"] = [];
  let staleSummary = false;
  for (const record of records
    .filter(
      (entry) =>
        entry.projectId === projectId &&
        (entry.parentId === chapter.id ||
          entry.payload.sourceChapterId === chapter.id),
    )
    .sort((a, b) => a.id.localeCompare(b.id))) {
    const payload = record.payload;
    const sourceWorkflowId =
      typeof payload.sourceWorkflowId === "string"
        ? payload.sourceWorkflowId
        : "";
    const workflow = workflows.get(sourceWorkflowId);
    let reason: NarrativeIndexDetail["excluded"][number]["reason"] | undefined;
    if (
      !record.adopted ||
      !workflow ||
      workflow.stage !== "applied" ||
      workflow.input.operation !== "chapter-memory" ||
      workflow.input.projectId !== projectId ||
      workflow.input.targetId !== chapter.id ||
      workflow.input.baseVersion !== payload.sourceVersion
    )
      reason = "unverified-adoption";
    else if (
      payload.sourceChapterId !== chapter.id ||
      payload.sourceVersion !== chapter.version ||
      (record.parentId && record.parentId !== chapter.id)
    ) {
      reason = "source-stale";
      if (record.kind === "chapter-memories") staleSummary = true;
    } else {
      const original = Object.fromEntries(
        Object.entries(payload).filter(
          ([key]) =>
            !["sourceChapterId", "sourceVersion", "sourceWorkflowId"].includes(
              key,
            ),
        ),
      );
      if (
        record.version !== 0 ||
        !workflow.output?.items.some(
          (item) =>
            item.kind === record.kind &&
            item.title === record.title &&
            canonical(item.data) === canonical(original),
        )
      )
        reason = "modified-record";
      else if (
        typeof payload.evidence !== "string" ||
        !payload.evidence.trim() ||
        !chapter.content.includes(payload.evidence)
      )
        reason = "invalid-evidence";
      else if (
        typeof payload[fields[record.kind]!] !== "string" ||
        !(payload[fields[record.kind]!] as string).trim()
      )
        reason = "missing-summary";
    }
    if (reason) {
      excluded.push({ id: record.id, version: record.version, reason });
      continue;
    }
    const quote = payload.evidence as string;
    const matches = evidenceMatches(chapter, quote, paragraphs);
    if (!matches.length) {
      excluded.push({
        id: record.id,
        version: record.version,
        reason: "invalid-evidence",
      });
      continue;
    }
    const item = {
      id: record.id,
      version: record.version,
      sourceWorkflowId,
      text: payload[fields[record.kind]!] as string,
      evidence: { quote, matches },
    };
    if (record.kind === "chapter-memories") summaries.push(item);
    else if (
      ["character-states", "story-events", "foreshadowings"].includes(
        record.kind,
      )
    )
      facts.push({
        ...item,
        title: record.title,
        kind: record.kind as NarrativeIndexDetail["facts"][number]["kind"],
      });
  }
  return {
    projectId,
    fingerprint: "0".repeat(64),
    paragraphs,
    summaries,
    facts,
    excluded,
    chapter: {
      id: chapter.id,
      version: chapter.version,
      title: chapter.title,
      orderIndex: chapter.orderIndex,
      contentHash: indexHash(chapter.content),
      hasContent: Boolean(chapter.content.trim()),
      paragraphCount: paragraphs.length,
      summaryState: !chapter.content.trim()
        ? "empty"
        : summaries.length
          ? "current"
          : staleSummary
            ? "stale"
            : "missing",
      summaryCount: summaries.length,
      factCount: facts.length,
      excludedRecordCount: excluded.length,
      originalEstimatedTokens: estimated(chapter.content),
      summaryEstimatedTokens: summaries.reduce(
        (sum, item) => sum + estimated(item.text),
        0,
      ),
    },
  };
}
export function buildNarrativeIndex(input: {
  project: { id: string; version: number; title: string };
  chapters: readonly Chapter[];
  volumes: readonly WritingVolume[];
  arcs: readonly WritingResource[];
  records: IndexRecord[];
  workflows: Map<string, CreationWorkflow | undefined>;
  unavailable: string[];
}): { catalog: NarrativeIndexCatalog; details: NarrativeIndexDetail[] } {
  const { project } = input;
  const chapters = input.chapters
    .filter((chapter) => chapter.projectId === project.id)
    .sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id));
  const details = chapters.map((chapter) =>
    chapterDetail(project.id, chapter, input.records, input.workflows),
  );
  const summaries = details.map((detail) => detail.chapter);
  const coverage = (
    ids: string[],
  ): NarrativeIndexCatalog["groups"][number]["coverage"] => {
    const selected = summaries.filter((chapter) => ids.includes(chapter.id));
    return {
      chapterCount: selected.length,
      nonEmptyChapterCount: selected.filter((chapter) => chapter.hasContent)
        .length,
      currentSummaryChapterCount: selected.filter(
        (chapter) => chapter.hasContent && chapter.summaryState === "current",
      ).length,
      missingSummaryChapterIds: selected
        .filter(
          (chapter) => chapter.hasContent && chapter.summaryState !== "current",
        )
        .map((chapter) => chapter.id),
    };
  };
  const groups: NarrativeIndexCatalog["groups"] = [
    {
      kind: "book",
      id: project.id,
      version: project.version,
      title: project.title,
      chapterIds: chapters.map((chapter) => chapter.id),
      state: "current",
      reasons: [],
      coverage: coverage(chapters.map((chapter) => chapter.id)),
    },
  ];
  for (const volume of input.volumes.filter(
    (volume) => volume.projectId === project.id,
  )) {
    const ids = chapters
      .filter((chapter) => chapter.volumeId === volume.id)
      .map((chapter) => chapter.id);
    groups.push({
      kind: "volume",
      id: volume.id,
      version: volume.version,
      title: volume.title,
      chapterIds: ids,
      state: "current",
      reasons: [],
      coverage: coverage(ids),
    });
  }
  for (const arc of input.arcs.filter(
    (arc) => arc.projectId === project.id && arc.domain === "story-arcs",
  )) {
    const parsed = NarrativeArcScopeSchema.safeParse(
      arc.payload.narrativeChapterScope,
    );
    const scope = parsed.success ? parsed.data : undefined;
    const actual = chapters.filter((chapter) =>
      scope?.chapters.some((ref) => ref.id === chapter.id),
    );
    const valid =
      scope &&
      actual.length === scope.chapters.length &&
      actual.every(
        (chapter, index) =>
          chapter.id === scope.chapters[index]?.id &&
          chapter.version === scope.chapters[index]?.version,
      );
    groups.push({
      kind: "story-arc",
      id: arc.id,
      version: arc.version,
      title: arc.title,
      chapterIds: scope?.chapters.map((chapter) => chapter.id) ?? [],
      state: !scope ? "unbound" : valid ? "current" : "stale",
      reasons: !scope
        ? ["未记录有效的显式章节引用；旧起止章号不用于猜测范围。"]
        : valid
          ? []
          : [
              "章节已删除、重排、跨项目或版本已变化；重新确认范围，不自动替换。",
            ],
      coverage: coverage(valid ? actual.map((chapter) => chapter.id) : []),
    });
  }
  const unavailable = [...input.unavailable];
  if (
    chapters.some(
      (chapter) =>
        chapter.volumeId &&
        !input.volumes.some(
          (volume) =>
            volume.projectId === project.id && volume.id === chapter.volumeId,
        ),
    )
  )
    unavailable.push(
      "部分章节的卷归属不存在或无法读取；仅保留全书目录，不猜测卷范围。",
    );
  const unassignedRecords: NarrativeIndexCatalog["unassignedRecords"] =
    input.records
      .filter(
        (record) =>
          record.projectId === project.id &&
          !chapters.some(
            (chapter) =>
              record.parentId === chapter.id ||
              record.payload.sourceChapterId === chapter.id,
          ),
      )
      .map((record) => ({
        id: record.id,
        version: record.version,
        reason:
          record.parentId || record.payload.sourceChapterId
            ? "chapter-missing"
            : "chapter-unbound",
      }));
  const fingerprint = indexHash({
    project: { id: project.id, version: project.version },
    chapters: summaries,
    details: details.map(({ paragraphs, summaries, facts, excluded }) => ({
      paragraphs,
      summaries,
      facts,
      excluded,
    })),
    groups,
    records: input.records
      .filter((record) => record.projectId === project.id)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((record) => ({
        id: record.id,
        version: record.version,
        payloadHash: indexHash(canonical(record.payload)),
        adopted: record.adopted,
      })),
    unavailable,
    unassignedRecords,
  });
  return {
    catalog: {
      projectId: project.id,
      projectVersion: project.version,
      fingerprint,
      chapters: summaries,
      groups,
      unavailable,
      unassignedRecords,
    },
    details: details.map((detail) => ({ ...detail, fingerprint })),
  };
}
