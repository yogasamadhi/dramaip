import { StructuredScriptDocumentSchema } from "@dramaip/contracts/workspace";
import type { ScreenplayIntakePreview } from "@dramaip/contracts/production";
import { parseFountain } from "./screenplay-codec.js";

/** Freeze every actual episode/scene and mint AST IDs once, before project creation. */
export function parseStructuredScriptIntake(sourceName: string, text: string) {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const source = StructuredScriptDocumentSchema.parse(raw);
  const unsupported = Object.keys(raw)
    .filter((key) => !["title", "episodes"].includes(key))
    .map((key) => `document:${key}`);
  for (const [index, episode] of (
    raw.episodes as Record<string, unknown>[]
  ).entries())
    unsupported.push(
      ...Object.keys(episode)
        .filter(
          (key) =>
            !["episodeNumber", "title", "content", "scenes"].includes(key),
        )
        .map((key) => `episodes[${index}]:${key}`),
    );
  const episodes: NonNullable<ScreenplayIntakePreview["episodes"]> =
    source.episodes.map((episode) => {
      const fromBody = Boolean(episode.content?.trim());
      // Scene labels are source metadata, not invented Action blocks proving a story exists.
      const content = fromBody
        ? episode.content!
        : episode.scenes.map((scene) => scene.content ?? "").join("\n\n");
      const parsed = parseFountain(content);
      return {
        id: crypto.randomUUID(),
        episodeNumber: episode.episodeNumber,
        title: episode.title || `第 ${episode.episodeNumber} 集`,
        content,
        contentSource: fromBody ? "episode-content" : "scene-content",
        blocks: parsed.blocks,
        scenes: episode.scenes,
        lossReport: {
          ...parsed.lossReport,
          warnings: [
            ...parsed.lossReport.warnings,
            fromBody
              ? "分集正文逐字保留；场景资料另行保存，不自动拼入正文或作为正式分镜。"
              : "本集无独立正文，读取表达由实际场景正文拼接；场景标题及属性分别保留，不冒充原文件逐字正文。",
          ],
        },
      };
    });
  return {
    sourceTitle:
      source.title || sourceName.replace(/\.json$/iu, "") || "导入剧本",
    episodes,
    // JSON has per-episode ASTs, never a fabricated concatenated 'first script'.
    blocks: [],
    lossReport: {
      unsupported,
      warnings: [
        "结构化 JSON 按文件分集顺序保留全部原稿和提供的场景资料；正文解析为稳定剧本块，未知文档／分集字段不转换，已列出字段名称；场景属性按公开格式校验，标题等元数据去除首尾空白，未知场景属性保留。场景资料不是正式分镜采用。",
      ],
      preserved: [
        "分集号与文件顺序",
        "分集标题和正文",
        "原场景属性",
        "逐集稳定块",
      ],
    },
  };
}
