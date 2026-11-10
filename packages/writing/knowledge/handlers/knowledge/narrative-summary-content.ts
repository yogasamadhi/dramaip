import { createHash } from "node:crypto";
import type { AgentContextReference } from "@dramaip/contracts/agent-context";
import {
  NarrativeSummaryContentSchema,
  type NarrativeSummaryBasis,
} from "@dramaip/contracts/knowledge";

export const summaryHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Coverage and exact quotes prove provenance, not the semantic correctness of a summary. */
export function inspectNarrativeSummary(
  raw: unknown,
  basis: NarrativeSummaryBasis,
  references: readonly AgentContextReference[],
) {
  const content = NarrativeSummaryContentSchema.parse(raw);
  const required = basis.directory
    .filter((chapter) => chapter.hasContent)
    .map(({ id, version }) => ({ id, version }));
  if (summaryHash(content.coveredChapters) !== summaryHash(required))
    throw new Error(
      "摘要须按实际范围顺序完整声明全部非空章节版本；局部不能冒充卷或全书。",
    );
  const seen = new Set<string>();
  for (const evidence of content.evidence) {
    const source = basis.references.find(
      (item) =>
        item.chapter.id === evidence.chapter.id &&
        item.chapter.version === evidence.chapter.version &&
        item.sourceId === evidence.sourceId &&
        item.sourceVersion === evidence.sourceVersion &&
        item.fieldPath === evidence.fieldPath,
    );
    const reference =
      source &&
      references.find(
        (item) =>
          item.sourceKind === source.sourceKind &&
          item.sourceId === source.sourceId &&
          item.sourceVersion === source.sourceVersion &&
          item.fieldPath === source.fieldPath &&
          summaryHash(item.value) === source.contentHash,
      );
    const value = reference?.value as
      { content?: unknown; summary?: unknown } | undefined;
    const text =
      source?.representation === "original" ? value?.content : value?.summary;
    if (typeof text !== "string" || !text.includes(evidence.quote))
      throw new Error(
        "摘要依据必须逐字来自所选原文或当前采用摘要的实际冻结文字，不能引用元数据、未选或旧来源。",
      );
    const identity = summaryHash(evidence);
    if (seen.has(identity)) throw new Error("摘要依据不能重复。");
    seen.add(identity);
  }
  if (
    required.some(
      (chapter) =>
        !content.evidence.some(
          (entry) =>
            entry.chapter.id === chapter.id &&
            entry.chapter.version === chapter.version,
        ),
    )
  )
    throw new Error("摘要缺少范围中某章的实际来源依据；不能只引用开头几章。");
  return content;
}
