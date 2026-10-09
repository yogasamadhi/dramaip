import {
  EpisodeScriptContentSchema,
  type EpisodeOutlineContent,
} from "@dramaip/contracts/production";
import { exportFountain } from "./screenplay-codec.js";

/** Shared structural check for model candidates and author-confirmed edits.
 * A valid mapping is not a claim that its narrative meaning was verified. */
export function inspectEpisodeScriptContent(
  value: unknown,
  outline: EpisodeOutlineContent,
  fountain?: string,
) {
  const content = EpisodeScriptContentSchema.parse(value);
  const fail = (message: string): never => {
    throw new Error(message);
  };
  if (
    new Set(content.blocks.map((block) => block.id)).size !==
    content.blocks.length
  )
    fail("剧本块 UUID 重复。");
  if (
    fountain !== undefined &&
    exportFountain(content.blocks).trim() !== fountain.trim()
  )
    fail("Fountain 正文与结构化剧本块不一致。");
  if (content.sceneLinks.length !== outline.scenes.length)
    fail("剧本没有完整对应已采用大纲场景。");
  let offset = 0;
  for (const [index, link] of content.sceneLinks.entries()) {
    if (link.sceneId !== outline.scenes[index]!.id)
      fail("剧本场景映射与已采用大纲顺序不符。");
    const group = content.blocks.slice(offset, offset + link.blockIds.length);
    if (
      JSON.stringify(group.map((block) => block.id)) !==
        JSON.stringify(link.blockIds) ||
      group[0]?.type !== "scene_heading" ||
      !group.some(
        (block) => block.type === "action" || block.type === "dialogue",
      ) ||
      group.slice(1).some((block) => block.type === "scene_heading")
    )
      fail("场景映射须为完整连续块组且有动作/对白，不得重叠或混入另一场景。");
    if (group.some((block) => "text" in block && !block.text.trim()))
      fail("剧本块文本不能为空。");
    offset += group.length;
  }
  if (offset !== content.blocks.length) fail("存在未映射剧本块。");
  return content;
}
