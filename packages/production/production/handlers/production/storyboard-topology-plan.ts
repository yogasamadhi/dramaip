import {
  StoryboardTopologyPlanRequestSchema,
  StoryboardSceneTopologyPlanPatchSchema,
  type StoryboardTopologyPlanRequest,
  type EpisodeDevelopmentResult,
  type EpisodeOutlineContent,
  type EpisodeScriptContent,
  type StoryboardPackageContent,
} from "@dramaip/contracts/production";
import { inspectStoryboardContent } from "./storyboard-content.js";
import { inspectEpisodeScriptContent } from "./episode-script-content.js";

type Binding = NonNullable<
  EpisodeDevelopmentResult["productionRecords"]
>[number];
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const fail = (message: string): never => {
  throw new Error(message);
};

/** Pure mechanical admission, not author-source/actual-row/CAS admission.
 * Owner must separately verify both formal ancestry, every real row and frozen
 * baseline. Historical identity cannot be moved, guessed or reincarnated. */
export function freezeStoryboardTopologyPlan(input: {
  request: unknown;
  base: StoryboardPackageContent;
  bindings: Binding[];
  previousOutline: EpisodeOutlineContent;
  previousScript: EpisodeScriptContent;
  outline: EpisodeOutlineContent;
  script: EpisodeScriptContent;
  reservedSceneIds: readonly string[];
  reservedShotIds: readonly string[];
}) {
  const request = StoryboardTopologyPlanRequestSchema.parse(input.request);
  inspectEpisodeScriptContent(input.previousScript, input.previousOutline);
  inspectEpisodeScriptContent(input.script, input.outline);
  const base = inspectStoryboardContent(
    input.base,
    input.previousOutline,
    input.previousScript,
    [...new Set(input.base.assets.flatMap((asset) => asset.sourceBibleIds))],
  );
  const oldScenes = new Map(
    base.scenes.map((scene, index) => [scene.sceneId, { scene, index }]),
  );
  const oldShots = new Map(
    base.scenes.flatMap((scene) =>
      scene.shots.map(
        (shot) => [shot.id, { shot, sceneId: scene.sceneId }] as const,
      ),
    ),
  );
  const scenes = new Map(
    input.bindings
      .filter((binding) => binding.kind === "scenes")
      .map((binding) => [binding.stableId, binding]),
  );
  const shots = new Map(
    input.bindings
      .filter((binding) => binding.kind === "shots")
      .map((binding) => [binding.stableId, binding]),
  );
  if (
    new Set(input.bindings.map((binding) => binding.id)).size !==
      input.bindings.length ||
    scenes.size !== oldScenes.size ||
    shots.size !== oldShots.size ||
    input.bindings.length !== scenes.size + shots.size ||
    [...oldScenes.keys()].some((id) => !scenes.has(id)) ||
    [...oldShots.keys()].some((id) => !shots.has(id))
  )
    fail("原正式包的完整场景／镜头实际绑定未核全。");
  const oldBlocks = new Map(
    input.previousScript.sceneLinks.flatMap((link) =>
      link.blockIds.map((id) => [id, link.sceneId] as const),
    ),
  );
  const expectedShotRetirement = new Set(oldShots.keys()),
    expectedSceneRetirement = new Set(oldScenes.keys());
  const selectedShots: { shotId: string; recordId: string; version: number }[] =
    [];
  const selectedScenes: {
    sceneId: string;
    recordId: string;
    version: number;
  }[] = [];
  if (request.scenes.length !== input.outline.scenes.length)
    fail("新计划未覆盖整个已确认正式场景拓扑。");
  for (const [index, plan] of request.scenes.entries()) {
    const outline = input.outline.scenes[index]!,
      link = input.script.sceneLinks[index]!;
    if (
      plan.sceneId !== outline.id ||
      plan.sceneId !== link.sceneId ||
      plan.durationSeconds !== outline.durationSeconds ||
      plan.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0) !==
        plan.durationSeconds
    )
      fail("新计划场景顺序、实际映射或镜头时长与新正式结果不一致。");
    const old = oldScenes.get(plan.sceneId),
      binding = scenes.get(plan.sceneId);
    if (old) {
      if (
        !plan.retains ||
        binding?.id !== plan.retains.recordId ||
        binding.version !== plan.retains.version ||
        old.scene.scriptBlockIds[0] !== link.blockIds[0]
      )
        fail("复用场景须保持原实际身份、版本与稳定标题块，不重新解释旧身份。");
      expectedSceneRetirement.delete(plan.sceneId);
    } else if (plan.retains || input.reservedSceneIds.includes(plan.sceneId))
      fail("新场景不能复用已存在或已退役的历史身份。");
    for (const id of link.blockIds) {
      const previousScene = oldBlocks.get(id);
      if (previousScene && previousScene !== plan.sceneId)
        fail("原稳定剧本块不可跨场迁移到新身份。");
    }
    for (const shot of plan.shots) {
      if (
        shot.assetIds.some(
          (id) => !base.assets.some((asset) => asset.id === id),
        )
      )
        fail("新计划只能引用原正式资产，不补造新资产或权利。");
      const oldShot = oldShots.get(shot.id),
        actual = shots.get(shot.id);
      if (oldShot) {
        if (
          oldShot.sceneId !== plan.sceneId ||
          !shot.retains ||
          actual?.id !== shot.retains.recordId ||
          actual.version !== shot.retains.version
        )
          fail("镜头只能明确复用同场原实际身份，不跨场迁移或推定版本。");
        expectedShotRetirement.delete(shot.id);
      } else if (shot.retains || input.reservedShotIds.includes(shot.id))
        fail("新镜头身份曾被使用，不能重新解释历史或退役记录。");
    }
    if (plan.mode === "retain") {
      if (
        !old ||
        !binding ||
        old.index !== index ||
        !equal(input.previousOutline.scenes[old.index], outline) ||
        !equal(old.scene.scriptBlockIds, link.blockIds) ||
        !equal(
          input.previousScript.blocks.filter((block) =>
            old.scene.scriptBlockIds.includes(block.id),
          ),
          input.script.blocks.filter((block) =>
            link.blockIds.includes(block.id),
          ),
        ) ||
        !equal(
          plan.shots,
          old.scene.shots.map((shot) => ({
            id: shot.id,
            orderIndex: shot.orderIndex,
            durationSeconds: shot.durationSeconds,
            assetIds: shot.assetIds,
            retains: {
              recordId: shots.get(shot.id)!.id,
              version: shots.get(shot.id)!.version,
            },
          })),
        )
      )
        fail(
          "未选场景的顺序、正文、正式大纲或镜头计划变化，不能当作保持原值。",
        );
    } else if (old && binding) {
      selectedScenes.push({
        sceneId: plan.sceneId,
        recordId: binding.id,
        version: binding.version,
      });
      selectedShots.push(
        ...old.scene.shots.map((shot) => ({
          shotId: shot.id,
          recordId: shots.get(shot.id)!.id,
          version: shots.get(shot.id)!.version,
        })),
      );
    }
  }
  for (const old of request.retiredScenes) {
    const binding = scenes.get(old.sceneId);
    if (
      !expectedSceneRetirement.has(old.sceneId) ||
      binding?.id !== old.recordId ||
      binding.version !== old.version
    )
      fail("场景退役未绑定原实际身份／版本或范围不符。");
    selectedScenes.push(old);
    selectedShots.push(
      ...oldScenes.get(old.sceneId)!.scene.shots.map((shot) => ({
        shotId: shot.id,
        recordId: shots.get(shot.id)!.id,
        version: shots.get(shot.id)!.version,
      })),
    );
  }
  if (request.retiredScenes.length !== expectedSceneRetirement.size)
    fail("全部移除的原场景须明确确认退役，不静默删除。");
  for (const old of request.retiredShots) {
    const binding = shots.get(old.shotId);
    if (
      !expectedShotRetirement.has(old.shotId) ||
      binding?.id !== old.recordId ||
      binding.version !== old.version
    )
      fail("镜头退役未绑定原实际身份／版本或范围不符。");
  }
  if (request.retiredShots.length !== expectedShotRetirement.size)
    fail("全部移除的原镜头须明确确认退役，不静默覆盖。");
  if (
    selectedShots.length > 1000 ||
    new Set(selectedShots.map((shot) => shot.recordId)).size !==
      selectedShots.length
  )
    fail("原实际选中镜头重复或超过一次局部范围上限，不截断。");
  const previousTopology = input.previousOutline.scenes.map((scene) => [
    scene.id,
    scene.orderIndex,
    scene.durationSeconds,
  ]);
  const currentTopology = input.outline.scenes.map((scene) => [
    scene.id,
    scene.orderIndex,
    scene.durationSeconds,
  ]);
  if (equal(previousTopology, currentTopology))
    fail("正式场景拓扑没有变化，不能用新协议跳过原场内／镜头计划约束。");
  return {
    request,
    selectedScenes,
    selectedShots,
    semanticVerification: "unverified" as const,
  };
}

/** Build only a new immutable proposal. Actual records/retirement/media belong
 * to the caller's verified transaction; this function performs no writes. */
export function inspectStoryboardTopologyPlan(
  raw: unknown,
  base: StoryboardPackageContent,
  request: StoryboardTopologyPlanRequest,
  outline: EpisodeOutlineContent,
  script: EpisodeScriptContent,
  approvedBibleIds: string[],
) {
  inspectEpisodeScriptContent(script, outline);
  const plan = StoryboardTopologyPlanRequestSchema.parse(request),
    patch = StoryboardSceneTopologyPlanPatchSchema.parse(raw);
  const desired = plan.scenes
    .filter((scene) => scene.mode === "generate")
    .flatMap((scene) => scene.shots);
  const replacements = new Map(patch.shots.map((shot) => [shot.id, shot]));
  if (
    replacements.size !== patch.shots.length ||
    replacements.size !== desired.length ||
    desired.some((shot) => !replacements.has(shot.id))
  )
    fail("模型局部候选必须恰好覆盖作者冻结的新范围，不输出未选或退役镜头。");
  const scenes = plan.scenes.map((scene, index) => {
    const link = script.sceneLinks[index];
    if (
      !link ||
      link.sceneId !== scene.sceneId ||
      outline.scenes[index]?.id !== scene.sceneId
    )
      fail("已确认的新正式场景顺序或映射未核全。");
    if (scene.mode === "retain") {
      const original = base.scenes.find(
        (item) => item.sceneId === scene.sceneId,
      );
      if (!original || !equal(original.scriptBlockIds, link!.blockIds))
        fail("未选原场景不存在或实际映射变化。");
      return structuredClone(original!);
    }
    const shots = scene.shots.map((planned) => {
      const shot = replacements.get(planned.id)!;
      if (
        shot.orderIndex !== planned.orderIndex ||
        shot.durationSeconds !== planned.durationSeconds ||
        !equal(shot.assetIds, planned.assetIds) ||
        shot.sourceBlockIds.some((id) => !link!.blockIds.includes(id))
      )
        fail("模型更改了冻结身份、顺序、时长、资产或跨场正文。");
      return shot;
    });
    return { sceneId: scene.sceneId, scriptBlockIds: link!.blockIds, shots };
  });
  const retained = new Set(
    plan.scenes
      .filter((scene) => scene.mode === "retain")
      .flatMap((scene) => scene.shots.map((shot) => shot.id)),
  );
  const selected = new Set(desired.map((shot) => shot.id));
  if (
    patch.subtitles.some((item) => !selected.has(item.shotId)) ||
    patch.costRisks.some((risk) => risk.shotIds.some((id) => !selected.has(id)))
  )
    fail("新字幕或风险只能属于作者明确的新生成范围，不改未选／退役者。");
  const usedAssets = new Set(
    scenes.flatMap((scene) => scene.shots.flatMap((shot) => shot.assetIds)),
  );
  return inspectStoryboardContent(
    {
      ...base,
      scenes,
      assets: base.assets.filter((asset) => usedAssets.has(asset.id)),
      subtitles: [
        ...base.subtitles.filter((item) => retained.has(item.shotId)),
        ...patch.subtitles,
      ],
      costRisks: [
        ...base.costRisks.flatMap((risk) => {
          const shotIds = risk.shotIds.filter((id) => retained.has(id));
          return shotIds.length ? [{ ...risk, shotIds }] : [];
        }),
        ...patch.costRisks,
      ],
    },
    outline,
    script,
    approvedBibleIds,
  );
}
