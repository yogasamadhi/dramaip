import { createHash } from "node:crypto";
import {
  SeasonPlanContentSchema,
  SeasonPlanBasisSchema,
  SeasonPlanOrderInputSchema,
  type SeasonPlanContent,
  type SeasonPlanBasis,
  type SeasonPlanCoverage,
} from "@dramaip/contracts/production";
import type { CreationIssue } from "@dramaip/contracts/creation";
import { assertReviewedNarrativeSources } from "./narrative-sources.js";

// This is deterministic structural evidence, not a semantic/quality score.
// Coverage is derived from actual episode references, never trusted from an
// AI-provided "100% covered" field. Content adoption remains the owner's job.
export function inspectSeasonPlanContent(
  raw: unknown,
  rawBasis: SeasonPlanBasis,
): {
  content?: SeasonPlanContent;
  coverage: SeasonPlanCoverage[];
  issues: CreationIssue[];
} {
  const issues: CreationIssue[] = [];
  const issue = (location: string, message: string) =>
    issues.push({
      severity: "error",
      source: "rule",
      location,
      message,
      evidence: "",
      suggestion:
        "核对冻结来源、目标集数、完整顺序与分集内容；遗漏须明确说明，不能声明已覆盖。",
    });
  const parsed = SeasonPlanContentSchema.safeParse(raw);
  const basisResult = SeasonPlanBasisSchema.safeParse(rawBasis);
  if (!parsed.success || !basisResult.success) {
    issue("整季方案", "整季方案或冻结基准结构无效。");
    return { coverage: [], issues };
  }
  const content = parsed.data;
  const basis = basisResult.data;
  try {
    assertReviewedNarrativeSources(basis.sourceBasis, content.reviewedSources);
  } catch (error) {
    issue(
      "实际表达",
      error instanceof Error ? error.message : "实际表达未完整声明。",
    );
  }
  const ids = content.episodes.map((item) => item.id);
  if (new Set(ids).size !== ids.length)
    issue("分集标识", "分集标识重复，无法稳定重排或引用。");
  if (content.episodes.length !== basis.target.episodeCount)
    issue("整季集数", "实际分集数与冻结目标不符。");
  if (content.episodes.some((episode, index) => episode.orderIndex !== index))
    issue(
      "分集顺序",
      "分集顺序必须完整且与保存数组一致，不能重复、跳号或隐式排序。",
    );
  const sources = new Map(basis.chapters.map((item) => [item.id, item]));
  if (sources.size !== basis.chapters.length)
    issue("冻结来源", "冻结章节标识重复。");
  if (basis.scope === "whole-book" && basis.omittedChapters.length)
    issue("冻结来源", "全书基准不能同时包含诊断未覆盖章节。");
  if (basis.omittedChapters.some((item) => sources.has(item.id)))
    issue("冻结来源", "同一章节不能同时属于诊断已读与未覆盖范围。");
  const uses = new Map<string, string[]>();
  const fingerprints = new Set<string>();
  for (const episode of content.episodes) {
    const location = `分集 ${episode.id}`;
    if (episode.durationSeconds !== basis.target.durationSeconds)
      issue(location, "分集时长与冻结目标不符。");
    const selected = new Set<string>();
    for (const source of episode.sourceChapters) {
      if (selected.has(source.id))
        issue(location, "同一分集重复引用同一来源章节。");
      selected.add(source.id);
      const frozen = sources.get(source.id);
      if (!frozen || frozen.version !== source.version) {
        issue(location, "来源章节不属于冻结诊断范围或版本不符。");
        continue;
      }
      const episodes = uses.get(source.id) ?? [];
      if (!episodes.includes(episode.id)) episodes.push(episode.id);
      uses.set(source.id, episodes);
    }
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          logline: episode.logline,
          goal: episode.goal,
          mainConflict: episode.mainConflict,
          turningPoint: episode.turningPoint,
          endingHook: episode.endingHook,
        }),
      )
      .digest("hex");
    if (fingerprints.has(fingerprint))
      issue(location, "分集核心节拍完全重复；不同标题或标识不能冒充新的推进。");
    fingerprints.add(fingerprint);
  }
  const omissions = new Map<string, string>();
  for (const omitted of content.omittedSources) {
    const frozen = sources.get(omitted.id);
    if (!frozen || frozen.version !== omitted.version)
      issue("未采用来源", "遗漏说明的章节不属于本轮冻结范围或版本不符。");
    if (omissions.has(omitted.id))
      issue("未采用来源", "同一章节的遗漏说明重复。");
    if (uses.has(omitted.id))
      issue("来源覆盖", "同一来源不能同时标为已使用与已删减。");
    omissions.set(omitted.id, omitted.reason);
  }
  const coverage = basis.chapters.map((chapter): SeasonPlanCoverage => {
    const episodeIds = uses.get(chapter.id) ?? [];
    const reason = omissions.get(chapter.id);
    if (!episodeIds.length && !reason)
      issue("来源覆盖", "存在未分配且未明确说明删减的冻结章节。");
    return {
      chapterId: chapter.id,
      chapterVersion: chapter.version,
      episodeIds,
      disposition: episodeIds.length
        ? "used"
        : reason
          ? "omitted"
          : "unaccounted",
      ...(reason ? { omissionReason: reason } : {}),
    };
  });
  return { content, coverage, issues };
}

// The owner must persist this as a new candidate version with CAS, provenance
// and explicit adoption. This pure transformation performs no business write.
export function reorderSeasonPlanContent(
  raw: SeasonPlanContent,
  rawOrder: string[],
): SeasonPlanContent {
  const content = SeasonPlanContentSchema.parse(raw);
  const { episodeIds } = SeasonPlanOrderInputSchema.parse({
    episodeIds: rawOrder,
  });
  const ids = content.episodes.map((episode) => episode.id);
  if (
    new Set(ids).size !== ids.length ||
    episodeIds.length !== ids.length ||
    new Set(episodeIds).size !== ids.length ||
    episodeIds.some((id) => !ids.includes(id))
  )
    throw new Error("请提交完整、不重复且属于该版本的分集标识列表。");
  const byId = new Map(
    content.episodes.map((episode) => [episode.id, episode]),
  );
  return {
    ...content,
    episodes: episodeIds.map((id, orderIndex) => ({
      ...byId.get(id)!,
      orderIndex,
    })),
  };
}
