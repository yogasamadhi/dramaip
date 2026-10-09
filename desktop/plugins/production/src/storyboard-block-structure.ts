import {
  EpisodeScriptContentSchema,
  type EpisodeScriptContent,
  type StoryboardBlockStructureMapping,
} from "@dramaip/contracts/production";

/** All confirmed ancestors are checked, including IDs introduced and later
 * removed: a deleted/reintroduced ID cannot silently migrate between scenes.
 * This is structural identity checking, never narrative safety. */
export function confirmedStoryboardBlockMappings(
  previous: EpisodeScriptContent,
  ancestors: EpisodeScriptContent[],
  options?: { allowUnchanged: boolean },
): StoryboardBlockStructureMapping[] {
  const identities = previous.sceneLinks.map((link) => ({
    id: link.sceneId,
    heading: link.blockIds[0],
  }));
  const owners = new Map<string, string>();
  for (const candidate of [previous, ...ancestors]) {
    const script = EpisodeScriptContentSchema.parse(candidate);
    if (
      script.sceneLinks.length !== identities.length ||
      new Set(script.blocks.map((block) => block.id)).size !==
        script.blocks.length
    )
      throw new Error("块结构重做须保留原场景身份与完整唯一块映射。");
    let offset = 0;
    for (const [index, link] of script.sceneLinks.entries()) {
      const identity = identities[index]!;
      const group = script.blocks.slice(offset, offset + link.blockIds.length);
      if (
        link.sceneId !== identity.id ||
        link.blockIds[0] !== identity.heading ||
        JSON.stringify(group.map((block) => block.id)) !==
          JSON.stringify(link.blockIds) ||
        group[0]?.type !== "scene_heading" ||
        group.slice(1).some((block) => block.type === "scene_heading") ||
        !group.some(
          (block) => block.type === "action" || block.type === "dialogue",
        )
      )
        throw new Error(
          "块结构重做须保留原场景顺序与标题身份，连续完整映射不能跨场。",
        );
      for (const id of link.blockIds) {
        const owner = owners.get(id);
        if (owner && owner !== link.sceneId)
          throw new Error("人工确认链的稳定块发生跨场迁移，须完整复核。");
        owners.set(id, link.sceneId);
      }
      offset += group.length;
    }
    if (offset !== script.blocks.length)
      throw new Error("人工确认链存在未映射剧本块。");
  }
  const current =
    ancestors.at(-1) ?? (options?.allowUnchanged ? previous : undefined);
  if (!current) throw new Error("缺少明确人工确认的新块映射。");
  const changed = previous.sceneLinks.flatMap((link, index) => {
    const next = current.sceneLinks[index]!;
    return JSON.stringify(link.blockIds) === JSON.stringify(next.blockIds)
      ? []
      : [
          {
            sceneId: link.sceneId,
            previousBlockIds: link.blockIds,
            currentBlockIds: next.blockIds,
          },
        ];
  });
  if (!changed.length && !options?.allowUnchanged)
    throw new Error("块映射未变化，请使用原固定映射重做协议。");
  return changed;
}
