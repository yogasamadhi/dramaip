import {
  StoryboardRedoPatchSchema,
  type StoryboardPackageContent,
  type StoryboardRedoReceipt,
  type EpisodeOutlineContent,
  type EpisodeScriptContent,
} from "@dramaip/contracts/production";
import { inspectStoryboardContent } from "./storyboard-content.js";
import { inspectStoryboardShotPlan } from "./storyboard-shot-plan.js";
import { inspectStoryboardTopologyPlan } from "./storyboard-topology-plan.js";

/** Recombine locally only. The model/checker see a patch, never the retained
 * whole baseline. Deterministic integrity is not semantic safety. */
export function inspectStoryboardRedo(
  value: unknown,
  base: StoryboardPackageContent,
  receipt: StoryboardRedoReceipt,
  outline: EpisodeOutlineContent,
  script: EpisodeScriptContent,
  approvedBibleIds: string[],
) {
  if (receipt.scope === "author-frozen-scene-topology-plan-v1")
    return inspectStoryboardTopologyPlan(
      value,
      base,
      receipt.topologyPlan,
      outline,
      script,
      approvedBibleIds,
    );
  if (receipt.scope === "author-frozen-scene-shot-plan-v1")
    return inspectStoryboardShotPlan(
      value,
      base,
      receipt,
      outline,
      script,
      approvedBibleIds,
    );
  const patch = StoryboardRedoPatchSchema.parse(value);
  function fail(message: string): never {
    throw new Error(message);
  }
  const selected = new Set(receipt.shots.map((item) => item.shotId));
  const structural =
    receipt.scope ===
    "confirmed-block-structure-fixed-shots-duration-assets-v1";
  if (
    patch.format === "selected-scene-shot-plan-v1" ||
    patch.format === "selected-scene-topology-plan-v1" ||
    (patch.format === "selected-storyboard-block-structure-v1") !== structural
  )
    fail("局部重做协议与明确冻结的模式不一致，不能自动升级旧候选。");
  const mappings = new Map<string, string[]>();
  if (structural) {
    if (base.scenes.length !== script.sceneLinks.length)
      fail("新块映射与冻结场景身份不符。");
    const expected = base.scenes.flatMap((scene, index) => {
      const next = script.sceneLinks[index]!;
      if (
        next.sceneId !== scene.sceneId ||
        next.blockIds[0] !== scene.scriptBlockIds[0]
      )
        fail("新块映射不能改变冻结场景顺序或标题身份。");
      return JSON.stringify(scene.scriptBlockIds) ===
        JSON.stringify(next.blockIds)
        ? []
        : [
            {
              sceneId: scene.sceneId,
              previousBlockIds: scene.scriptBlockIds,
              currentBlockIds: next.blockIds,
            },
          ];
    });
    if (
      !expected.length ||
      JSON.stringify(expected) !== JSON.stringify(receipt.sceneMappings)
    )
      fail("新块映射与冻结原／新映射不一致。");
    for (const mapping of receipt.sceneMappings) {
      const scene = base.scenes.find(
        (item) => item.sceneId === mapping.sceneId,
      )!;
      if (scene.shots.some((shot) => !selected.has(shot.id)))
        fail("结构变化场景的镜头须完整选中，不改写未选范围。");
      mappings.set(mapping.sceneId, mapping.currentBlockIds);
    }
  }
  const replacements = new Map(patch.shots.map((item) => [item.id, item]));
  if (
    selected.size !== receipt.shots.length ||
    replacements.size !== patch.shots.length ||
    replacements.size !== selected.size ||
    [...replacements.keys()].some((id) => !selected.has(id))
  )
    fail("局部分镜候选必须恰好覆盖冻结选中镜头，不接受重复、遗漏或越界镜头。");
  const scenes = base.scenes.map((scene) => ({
    ...scene,
    scriptBlockIds: mappings.get(scene.sceneId) ?? scene.scriptBlockIds,
    shots: scene.shots.map((old) => {
      const next = replacements.get(old.id);
      if (!next) return old;
      if (
        next.orderIndex !== old.orderIndex ||
        next.durationSeconds !== old.durationSeconds ||
        (!structural &&
          JSON.stringify(next.sourceBlockIds) !==
            JSON.stringify(old.sourceBlockIds)) ||
        JSON.stringify(next.assetIds) !== JSON.stringify(old.assetIds)
      )
        fail(
          "局部重做保留镜头顺序、时长、来源块与既有资产；结构变化须整包复核。",
        );
      return next;
    }),
  }));
  if (
    patch.subtitles.some((item) => !selected.has(item.shotId)) ||
    patch.costRisks.some((item) => item.shotIds.some((id) => !selected.has(id)))
  )
    fail("局部字幕或风险不能改写未选镜头。");
  const retainedSubtitles = base.subtitles.filter(
    (item) => !selected.has(item.shotId),
  );
  // Preserve unselected risk associations. A shared risk retains its untouched
  // portion; the selected portion is explicitly replaced by the patch.
  const retainedRisks = base.costRisks.flatMap((item) => {
    const shotIds = item.shotIds.filter((id) => !selected.has(id));
    return shotIds.length ? [{ ...item, shotIds }] : [];
  });
  return inspectStoryboardContent(
    {
      ...base,
      scenes,
      subtitles: [...retainedSubtitles, ...patch.subtitles],
      costRisks: [...retainedRisks, ...patch.costRisks],
    },
    outline,
    script,
    approvedBibleIds,
  );
}
