import {
  StoryboardPackageContentSchema,
  type EpisodeOutlineContent,
  type EpisodeScriptContent,
} from "@dramaip/contracts/production";

/** Checks only deterministic structure/lineage. It does not certify semantics,
 * rights, producibility, model quality or provider cost. */
export function inspectStoryboardContent(
  value: unknown,
  outline: EpisodeOutlineContent,
  script: EpisodeScriptContent,
  approvedBibleIds: string[],
) {
  const content = StoryboardPackageContentSchema.parse(value);
  function fail(message: string): never {
    throw new Error(message);
  }
  const unique = (ids: string[], label: string) => {
    if (new Set(ids).size !== ids.length) fail(`${label}标识重复。`);
  };
  unique(
    content.assets.map((item) => item.id),
    "资产",
  );
  unique(
    content.scenes.map((item) => item.sceneId),
    "场景",
  );
  const shots = content.scenes.flatMap((item) => item.shots);
  unique(
    shots.map((item) => item.id),
    "镜头",
  );
  unique(
    content.subtitles.map((item) => item.id),
    "字幕",
  );
  const assets = new Set(content.assets.map((item) => item.id));
  for (const asset of content.assets) {
    unique(asset.sourceBibleIds, "设定来源");
    if (asset.sourceBibleIds.some((id) => !approvedBibleIds.includes(id)))
      fail("资产引用未批准或外部 Story Bible。");
  }
  if (
    content.scenes.length !== outline.scenes.length ||
    content.scenes.length !== script.sceneLinks.length
  )
    fail("分镜包未完整覆盖已采用剧本场景。");
  const usedAssets = new Set<string>();
  const blocks = new Map(script.blocks.map((item) => [item.id, item]));
  for (const [index, scene] of content.scenes.entries()) {
    const link = script.sceneLinks[index]!;
    const target = outline.scenes[index]!;
    if (
      scene.sceneId !== target.id ||
      scene.sceneId !== link.sceneId ||
      JSON.stringify(scene.scriptBlockIds) !== JSON.stringify(link.blockIds)
    )
      fail("分镜场景顺序或稳定剧本块映射与正式剧本不符。");
    if (
      scene.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0) !==
      target.durationSeconds
    )
      fail("镜头时长总和必须匹配正式场景目标。");
    const covered = new Set<string>();
    for (const [order, shot] of scene.shots.entries()) {
      if (shot.orderIndex !== order) fail("镜头顺序必须从 0 连续完整排列。");
      unique(shot.sourceBlockIds, "镜头来源");
      unique(shot.assetIds, "镜头资产引用");
      if (
        shot.sourceBlockIds.some(
          (id) => !link.blockIds.includes(id) || !blocks.has(id),
        )
      )
        fail("镜头包含不存在、外部或跨场景剧本块。");
      for (const id of shot.sourceBlockIds) covered.add(id);
      for (const id of shot.assetIds) {
        if (!assets.has(id)) fail("镜头资产引用不存在。");
        usedAssets.add(id);
      }
    }
    if (link.blockIds.some((id) => !covered.has(id)))
      fail("分镜遗漏正式剧本块。");
  }
  if (content.assets.some((item) => !usedAssets.has(item.id)))
    fail("存在未被镜头使用的孤立资产。");
  const dialogueCovered = new Set<string>();
  for (const subtitle of content.subtitles) {
    const shot = shots.find((item) => item.id === subtitle.shotId);
    if (
      !shot ||
      subtitle.startSeconds >= subtitle.endSeconds ||
      subtitle.endSeconds > shot.durationSeconds
    )
      fail("字幕镜头或相对镜头时码无效。");
    unique(subtitle.sourceBlockIds, "字幕来源");
    const text: string[] = [];
    for (const id of subtitle.sourceBlockIds) {
      const block = blocks.get(id);
      if (
        !block ||
        block.type !== "dialogue" ||
        !shot.sourceBlockIds.includes(id) ||
        dialogueCovered.has(id)
      )
        fail("字幕须引用对应镜头的真实对白块，不得重复或另造对白。");
      dialogueCovered.add(id);
      text.push(block.text);
    }
    if (text.join("\n") !== subtitle.text) fail("字幕文本与正式对白块不符。");
  }
  if (
    script.blocks.some(
      (item) => item.type === "dialogue" && !dialogueCovered.has(item.id),
    )
  )
    fail("分镜包遗漏正式对白字幕。");
  for (const risk of content.costRisks) {
    unique(risk.shotIds, "风险镜头引用");
    if (risk.shotIds.some((id) => !shots.some((item) => item.id === id)))
      fail("成本风险必须对应实际镜头，不是费用报价。");
  }
  return content;
}
