import { createHash } from "node:crypto";
import type { AgentContextEntry } from "@dramaip/contracts/agent-context";
import {
  EpisodeSceneEvidenceSchema,
  type EpisodeDevelopmentBasis,
  type EpisodeOutlineContent,
  type EpisodeSceneEvidence,
} from "@dramaip/contracts/production";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const key = (ref: {
  sourceKind: string;
  sourceId: string;
  sourceVersion: number;
  fieldPath: string;
}) =>
  JSON.stringify([
    ref.sourceKind,
    ref.sourceId,
    ref.sourceVersion,
    ref.fieldPath,
  ]);
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const sameChapter = (
  a: { id: string; version: number },
  b: { id: string; version: number },
) => a.id === b.id && a.version === b.version;

/** Only actual story expressions, never directories, intent or approved Bible. */
export function sceneStoryReferences(basis: EpisodeDevelopmentBasis) {
  const selected = basis.sourceBasis
    ? new Set(basis.sourceBasis.references.map(key))
    : undefined;
  return basis.references.filter((ref) =>
    basis.request.direct
      ? (ref.sourceKind === "project" &&
          basis.request.direct.entryPath === "inspiration") ||
        (ref.sourceKind === "production" &&
          ref.sourceId === basis.request.direct.sourceScript?.id)
      : selected
        ? selected.has(key(ref))
        : ref.sourceKind === "chapter" &&
          basis.chapters.some(
            (chapter) =>
              chapter.id === ref.sourceId &&
              chapter.version === ref.sourceVersion,
          ),
  );
}

function coverage(
  basis: EpisodeDevelopmentBasis,
  ref: EpisodeDevelopmentBasis["references"][number],
) {
  if (ref.sourceKind === "chapter")
    return [{ id: ref.sourceId, version: ref.sourceVersion }];
  const chapter = basis.sourceBasis?.chapters.find(
    (item) =>
      item.representation === "summary" &&
      item.record.id === ref.sourceId &&
      item.record.version === ref.sourceVersion,
  );
  if (chapter) return [{ id: chapter.id, version: chapter.version }];
  return (
    basis.sourceBasis?.summaries?.find(
      (item) => item.id === ref.sourceId && item.version === ref.sourceVersion,
    )?.chapters ?? []
  );
}

/** Missing/legacy protocol never receives retroactive proof or auto-upgraded quotes. */
export function inspectSceneSourceEvidence(
  outline: EpisodeOutlineContent,
  basis: EpisodeDevelopmentBasis,
  entries: readonly Pick<
    AgentContextEntry,
    | "included"
    | "sourceKind"
    | "sourceId"
    | "sourceVersion"
    | "fieldPath"
    | "value"
  >[],
  attribution: EpisodeSceneEvidence["attribution"] = "model-declared",
): EpisodeSceneEvidence[] | undefined {
  if (!basis.request.sourceEvidenceFormat) {
    if (outline.scenes.some((scene) => scene.sourceEvidence))
      throw new Error(
        "历史基准没有逐场引文协议，不接受未校验的来源声明；请另行确认新大纲。",
      );
    return undefined;
  }
  const allowed = sceneStoryReferences(basis);
  const result: EpisodeSceneEvidence[] = [];
  const ids = new Set<string>();
  for (const scene of outline.scenes) {
    if (!scene.sourceEvidence?.length)
      throw new Error("新协议要求每个场景引用实际冻结表达，不能只有章节映射。");
    const covered = new Set<string>();
    const directUsed = new Set<string>();
    for (const evidence of scene.sourceEvidence) {
      if (ids.has(evidence.id)) throw new Error("逐场引文标识必须全局唯一。");
      ids.add(evidence.id);
      const source = allowed.find((ref) => key(ref) === key(evidence.source));
      if (!source)
        throw new Error(
          "引文不是实际故事表达，或身份、版本、字段已变化；不能用意图／Bible／目录冒充正文。",
        );
      const actual = entries.filter(
        (entry) => entry.included && key(entry) === key(source),
      );
      if (actual.length !== 1 || hash(actual[0]!.value) !== source.contentHash)
        throw new Error("逐场引文缺少唯一且哈希一致的实际冻结表达。");
      if (basis.request.direct) {
        if (!scene.sourceReferences?.some((ref) => key(ref) === key(source)))
          throw new Error("引文未绑定本场声明的实际直写来源。");
        directUsed.add(key(source));
      } else {
        const matching = coverage(basis, source).filter((chapter) =>
          scene.sourceChapters.some((item) => sameChapter(item, chapter)),
        );
        if (!matching.length)
          throw new Error(
            "引文表达覆盖与本场章节映射没有交集，不把整季其他集来源强行归因到本场。",
          );
        matching.forEach((chapter) => covered.add(chapter.id));
      }
      const value = record(actual[0]!.value);
      let prose: unknown;
      let sourceBlockId: string | undefined;
      if (source.sourceKind === "chapter" && evidence.valuePath === "/content")
        prose = value.content;
      else if (
        source.sourceKind === "knowledge" &&
        evidence.valuePath === "/summary"
      )
        prose = value.summary;
      else if (
        source.sourceKind === "project" &&
        ["/content/synopsis", "/content/productionBrief"].includes(
          evidence.valuePath,
        )
      )
        prose = record(value.content)[
          evidence.valuePath.slice("/content/".length)
        ];
      else if (source.sourceKind === "production") {
        if (evidence.valuePath === "/content") prose = value.content;
        else {
          const match = /^\/blocks\/(0|[1-9]\d*)\/text$/u.exec(
            evidence.valuePath,
          );
          const block =
            match && Array.isArray(value.blocks)
              ? record(value.blocks[Number(match[1])])
              : {};
          if (
            ["action", "dialogue"].includes(String(block.type)) &&
            typeof block.id === "string"
          ) {
            prose = block.text;
            sourceBlockId = block.id;
          }
        }
      }
      if (typeof prose !== "string" || !evidence.quote.trim())
        throw new Error(
          "引文只允许来自实际正文／摘要／简报或原稿动作对白块，不引用标题、目录或空白。",
        );
      const paragraph =
        source.sourceKind === "chapter" &&
        value.representation === "paragraphs";
      if (
        paragraph &&
        (typeof value.paragraphId !== "string" ||
          !Number.isInteger(value.start) ||
          !Number.isInteger(value.end) ||
          Number(value.start) < 0 ||
          Number(value.end) - Number(value.start) !== prose.length ||
          source.fieldPath !==
            `/chapters/${source.sourceId}/paragraphs/${encodeURIComponent(value.paragraphId as string)}`)
      )
        throw new Error("冻结段落身份或原章节位置不完整，不能补造精确锚点。");
      const matches: EpisodeSceneEvidence["matches"] = [];
      let start = prose.indexOf(evidence.quote);
      while (start !== -1) {
        if (matches.length === 1000)
          throw new Error(
            "引文过短且匹配过多，请选择更明确的真实引文；不截断或猜测唯一位置。",
          );
        const end = start + evidence.quote.length;
        matches.push({
          start,
          end,
          ...(source.sourceKind === "chapter"
            ? {
                chapterStart: start + (paragraph ? Number(value.start) : 0),
                chapterEnd: end + (paragraph ? Number(value.start) : 0),
              }
            : {}),
        });
        start = prose.indexOf(evidence.quote, start + 1);
      }
      if (!matches.length)
        throw new Error(
          "引文不在实际提供的表达中逐字出现；不回读未选整章或猜测摘要对应的原文。",
        );
      result.push(
        EpisodeSceneEvidenceSchema.parse({
          sceneId: scene.id,
          evidenceId: evidence.id,
          source,
          valuePath: evidence.valuePath,
          quoteHash: createHash("sha256").update(evidence.quote).digest("hex"),
          quoteCharacters: evidence.quote.length,
          offsetUnit: "utf16-code-unit",
          matches,
          ...(paragraph ? { paragraphId: value.paragraphId } : {}),
          ...(sourceBlockId ? { sourceBlockId } : {}),
          attribution,
          matchVerification: "rule",
          semanticVerification: "unverified",
        }),
      );
    }
    if (
      scene.sourceChapters.some((chapter) => !covered.has(chapter.id)) ||
      scene.sourceReferences?.some((ref) => !directUsed.has(key(ref)))
    )
      throw new Error(
        "本场声明来源没有完整的实际引文覆盖；覆盖校验不证明语义改编正确。",
      );
  }
  return result;
}
