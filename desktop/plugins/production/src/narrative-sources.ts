import { createHash } from "node:crypto";
import type { AgentContextEntry } from "@dramaip/contracts/agent-context";
import type {
  DiagnosisBasis,
  DiagnosisContent,
  EpisodeDevelopmentBasis,
} from "@dramaip/contracts/production";
import type { NarrativeSourceBasis } from "@dramaip/contracts/creation";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const identity = (value: {
  sourceId: string;
  sourceVersion: number;
  fieldPath: string;
}) => JSON.stringify([value.sourceId, value.sourceVersion, value.fieldPath]);

/** Knowledge-owned narrative sources are not adopted Bible/asset evidence. */
export function episodeBibleReferences(
  basis: Pick<EpisodeDevelopmentBasis, "references" | "sourceBasis">,
) {
  return basis.references.filter(
    (item) =>
      item.sourceKind === "knowledge" &&
      !basis.sourceBasis?.references.some(
        (source) =>
          source.sourceKind === item.sourceKind &&
          identity(source) === identity(item),
      ),
  );
}

export function assertAdaptationSourceSnapshot(
  basis: DiagnosisBasis,
  projectId: string,
  entries: AgentContextEntry[],
): void {
  const sources = basis.sourceBasis;
  if (!sources) return;
  if (
    sources.projectId !== projectId ||
    sources.omitted.length ||
    !sources.references.length
  )
    throw new Error("混合改编来源缺少完整明确表达。");
  const covered = new Set<string>();
  for (const chapter of [
    ...sources.chapters,
    ...(sources.summaries ?? []).flatMap((summary) => summary.chapters),
  ]) {
    const original = basis.chapters.find((item) => item.id === chapter.id);
    if (
      !original ||
      original.version !== chapter.version ||
      original.narrativeContentHash !== chapter.contentHash
    )
      throw new Error("混合表达覆盖超出确认范围或原章节版本不符。");
    covered.add(chapter.id);
  }
  if (covered.size !== basis.chapters.length)
    throw new Error("确认范围存在没有实际表达的章节。");
  for (const source of sources.references) {
    const entry = entries.find(
      (item) =>
        item.included &&
        item.sourceKind === source.sourceKind &&
        identity(item) === identity(source),
    );
    if (!entry || hash(entry.value) !== source.contentHash)
      throw new Error("诊断／季纲的实际表达未完整纳入冻结上下文。");
  }
}

export function assertReviewedNarrativeSources(
  basis: NarrativeSourceBasis | undefined,
  reviewed: DiagnosisContent["reviewedSources"],
): void {
  if (!basis) {
    if (reviewed !== undefined)
      throw new Error("原文历史基准不能自报混合表达。");
    return;
  }
  const expected = new Set(basis.references.map(identity));
  if (
    !reviewed ||
    reviewed.length !== expected.size ||
    new Set(reviewed.map(identity)).size !== reviewed.length ||
    reviewed.some((item) => !expected.has(identity(item)))
  )
    throw new Error(
      "必须完整声明本轮实际表达 ID／版本／路径，不能漏报或替换。",
    );
}

export function assertDiagnosisMixedEvidence(
  basis: DiagnosisBasis,
  content: DiagnosisContent,
  entries: AgentContextEntry[],
): void {
  const sources = basis.sourceBasis!;
  assertReviewedNarrativeSources(sources, content.reviewedSources);
  for (const finding of content.findings)
    for (const evidence of finding.evidence) {
      const source = evidence.source;
      const chapter = basis.chapters.find(
        (item) =>
          item.id === evidence.chapterId &&
          item.version === evidence.chapterVersion,
      );
      const reference =
        source &&
        sources.references.find((item) => identity(item) === identity(source));
      const entry =
        reference &&
        entries.find(
          (item) =>
            item.included &&
            item.sourceKind === reference.sourceKind &&
            identity(item) === identity(reference),
        );
      const direct = sources.chapters.find(
        (item) =>
          item.id === evidence.chapterId &&
          item.version === evidence.chapterVersion,
      );
      const higher = sources.summaries?.find(
        (item) =>
          item.id === source?.sourceId &&
          item.version === source.sourceVersion &&
          item.chapters.some(
            (item) =>
              item.id === evidence.chapterId &&
              item.version === evidence.chapterVersion,
          ),
      );
      const matchesDirect =
        direct &&
        (direct.representation === "summary"
          ? source?.sourceId === direct.record.id &&
            source.sourceVersion === direct.record.version &&
            source.fieldPath === `/knowledge/${direct.record.id}`
          : source?.sourceId === direct.id &&
            (direct.representation === "original"
              ? source.fieldPath === `/chapters/${direct.id}`
              : direct.paragraphIds.some(
                  (id) =>
                    source.fieldPath ===
                    `/chapters/${direct.id}/paragraphs/${encodeURIComponent(id)}`,
                )));
      const expectedPath =
        higher || direct?.representation === "summary"
          ? "/summary"
          : "/content";
      const body = entry?.value as
        { content?: unknown; summary?: unknown } | undefined;
      const value = expectedPath === "/summary" ? body?.summary : body?.content;
      if (
        !chapter ||
        !source ||
        !reference ||
        !(higher || matchesDirect) ||
        source.valuePath !== expectedPath ||
        typeof value !== "string" ||
        !value.includes(evidence.quote)
      )
        throw new Error(
          `问题「${finding.id}」的引文不属于该章节的实际表达，不能引用未提供原文或元数据。`,
        );
    }
}

export function adaptationExpressionScope(basis: NarrativeSourceBasis) {
  return {
    chapters: basis.chapters.map(({ contentHash: _hash, ...item }) => item),
    summaries: basis.summaries?.map(({ id, version, chapters }) => ({
      id,
      version,
      chapters: chapters.map(({ id, version }) => ({ id, version })),
    })),
    reviewedSources: basis.references.map(
      ({ sourceId, sourceVersion, fieldPath }) => ({
        sourceId,
        sourceVersion,
        fieldPath,
      }),
    ),
  };
}
