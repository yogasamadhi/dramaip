import {
  StoryboardPackageContentSchema,
  StoryboardShotPlanRequestSchema,
  StoryboardShotPlanReceiptSchema,
  StoryboardSceneShotPlanPatchSchema,
  type StoryboardPackageContent,
  type StoryboardRedoReceipt,
  type EpisodeDevelopmentResult,
  type EpisodeOutlineContent,
  type EpisodeScriptContent,
} from "@dramaip/contracts/production";
import { inspectStoryboardContent } from "./storyboard-content.js";

type Binding = NonNullable<
  EpisodeDevelopmentResult["productionRecords"]
>[number];
type Receipt = Extract<
  StoryboardRedoReceipt,
  { scope: "author-frozen-scene-shot-plan-v1" }
>;
const equal = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
function fail(message: string): never {
  throw new Error(message);
}

/** Owner admission still verifies every actual row/baseline and source before
 * calling this. No model can choose identities, durations, order or assets. */
export function freezeStoryboardShotPlan(input: {
  request: unknown;
  base: StoryboardPackageContent;
  bindings: Binding[];
  outline: EpisodeOutlineContent;
  script: EpisodeScriptContent;
  reservedShotIds: readonly string[];
}) {
  const request = StoryboardShotPlanRequestSchema.parse(input.request);
  const base = StoryboardPackageContentSchema.parse(input.base);
  const scenes = new Map(base.scenes.map((scene) => [scene.sceneId, scene]));
  const sceneBindings = new Map(
    input.bindings
      .filter((record) => record.kind === "scenes")
      .map((record) => [record.stableId, record]),
  );
  const shotBindings = new Map(
    input.bindings
      .filter((record) => record.kind === "shots")
      .map((record) => [record.stableId, record]),
  );
  const oldShots = base.scenes.flatMap((scene) => scene.shots);
  if (
    scenes.size !== base.scenes.length ||
    new Set(oldShots.map((shot) => shot.id)).size !== oldShots.length ||
    new Set(input.bindings.map((record) => record.id)).size !==
      input.bindings.length ||
    sceneBindings.size !== scenes.size ||
    shotBindings.size !== oldShots.length ||
    input.bindings.length !== scenes.size + oldShots.length ||
    base.scenes.some((scene) => !sceneBindings.has(scene.sceneId)) ||
    oldShots.some((shot) => !shotBindings.has(shot.id))
  )
    fail("正式场景／镜头的完整实际绑定未核全，不推定旧身份。");
  const plans = new Map(
    request.scenePlans.map((scene) => [scene.sceneId, scene]),
  );
  if (
    base.scenes.length !== input.script.sceneLinks.length ||
    base.scenes.length !== input.outline.scenes.length
  )
    fail("场景镜头计划不能绕过正式场景拓扑确认。");
  const selectedShots: Receipt["shots"] = [];
  let changed = false;
  for (const [index, scene] of base.scenes.entries()) {
    const link = input.script.sceneLinks[index]!;
    const outlineScene = input.outline.scenes[index]!;
    if (
      scene.sceneId !== link.sceneId ||
      scene.sceneId !== outlineScene.id ||
      scene.scriptBlockIds[0] !== link.blockIds[0]
    )
      fail("正式场景身份／顺序或标题块已变化，不能借镜头计划自动换源。");
    const plan = plans.get(scene.sceneId);
    if (!plan) {
      if (!equal(scene.scriptBlockIds, link.blockIds))
        fail("未选场景块映射已变化，不能保留为已核全。");
      continue;
    }
    const binding = sceneBindings.get(scene.sceneId)!;
    if (
      binding.id !== plan.recordId ||
      binding.version !== plan.version ||
      plan.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0) !==
        outlineScene.durationSeconds
    )
      fail("场景实际身份／版本或新镜头时长总和与正式目标不一致。");
    const oldIds = new Set(scene.shots.map((shot) => shot.id));
    for (const next of plan.shots) {
      if (
        next.assetIds.some(
          (id) => !base.assets.some((asset) => asset.id === id),
        )
      )
        fail("新镜头计划仅引用原正式资产，不补造资产或授权。");
      if (next.retains) {
        const old = shotBindings.get(next.id);
        if (
          !oldIds.has(next.id) ||
          old?.id !== next.retains.recordId ||
          old.version !== next.retains.version
        )
          fail("复用镜头须绑定同场原实际身份／版本，不能跨场迁移。");
      } else if (
        shotBindings.has(next.id) ||
        input.reservedShotIds.includes(next.id)
      ) {
        fail("新增镜头身份曾被使用，不能重新解释历史或退役镜头。");
      }
    }
    const oldPlan = scene.shots.map((shot) => ({
      id: shot.id,
      orderIndex: shot.orderIndex,
      durationSeconds: shot.durationSeconds,
      assetIds: shot.assetIds,
      retains: {
        recordId: shotBindings.get(shot.id)!.id,
        version: shotBindings.get(shot.id)!.version,
      },
    }));
    changed ||=
      !equal(oldPlan, plan.shots) ||
      !equal(scene.scriptBlockIds, link.blockIds);
    selectedShots.push(
      ...scene.shots.map((shot) => ({
        shotId: shot.id,
        recordId: shotBindings.get(shot.id)!.id,
        version: shotBindings.get(shot.id)!.version,
      })),
    );
  }
  if (
    [...plans.keys()].some((id) => !scenes.has(id)) ||
    selectedShots.length > 1000
  )
    fail("新镜头计划超出完整原场景范围或选择上限。");
  if (!changed) fail("镜头计划及块映射未变化，请使用原局部重做协议。");
  return { scenePlans: request.scenePlans, selectedShots };
}

/** Locally reconstruct the complete package while retaining every unselected
 * value. Asset definitions are never model supplied; unused selected-only
 * proposal definitions are removed from the new manifest, not media storage. */
export function inspectStoryboardShotPlan(
  raw: unknown,
  base: StoryboardPackageContent,
  rawReceipt: Receipt,
  outline: EpisodeOutlineContent,
  script: EpisodeScriptContent,
  approvedBibleIds: string[],
) {
  const receipt = StoryboardShotPlanReceiptSchema.parse(rawReceipt);
  const patch = StoryboardSceneShotPlanPatchSchema.parse(raw);
  const plans = new Map(
    receipt.scenePlans.map((scene) => [scene.sceneId, scene]),
  );
  const selected = base.scenes
    .filter((scene) => plans.has(scene.sceneId))
    .flatMap((scene) => scene.shots);
  if (
    selected.length !== receipt.shots.length ||
    selected.some(
      (shot) => !receipt.shots.some((old) => old.shotId === shot.id),
    ) ||
    receipt.scenePlans.some(
      (plan) => !base.scenes.some((scene) => scene.sceneId === plan.sceneId),
    )
  )
    fail("镜头计划须完整选中原场景全部镜头，不改写未选范围。");
  const existing = new Set(
    base.scenes.flatMap((scene) => scene.shots.map((shot) => shot.id)),
  );
  const desired = receipt.scenePlans.flatMap((scene) => scene.shots);
  const replacements = new Map(patch.shots.map((shot) => [shot.id, shot]));
  if (
    replacements.size !== patch.shots.length ||
    replacements.size !== desired.length ||
    desired.some((shot) => !replacements.has(shot.id))
  )
    fail("局部候选须恰好覆盖作者冻结的新镜头计划。");
  const expectedMappings: Receipt["sceneMappings"] = [];
  const scenes = base.scenes.map((scene, index) => {
    const link = script.sceneLinks[index];
    if (
      !link ||
      link.sceneId !== scene.sceneId ||
      link.blockIds[0] !== scene.scriptBlockIds[0]
    )
      fail("镜头计划的原／新正式场景身份未核全。");
    const plan = plans.get(scene.sceneId);
    if (!plan) {
      if (!equal(scene.scriptBlockIds, link.blockIds))
        fail("未选场景映射变化，不能静默局部化。");
      return scene;
    }
    if (!equal(scene.scriptBlockIds, link.blockIds))
      expectedMappings.push({
        sceneId: scene.sceneId,
        previousBlockIds: scene.scriptBlockIds,
        currentBlockIds: link.blockIds,
      });
    const oldIds = new Set(scene.shots.map((shot) => shot.id));
    return {
      ...scene,
      scriptBlockIds: link.blockIds,
      shots: plan.shots.map((planned) => {
        const shot = replacements.get(planned.id)!;
        if (
          (planned.retains
            ? !oldIds.has(planned.id)
            : existing.has(planned.id)) ||
          shot.orderIndex !== planned.orderIndex ||
          shot.durationSeconds !== planned.durationSeconds ||
          !equal(shot.assetIds, planned.assetIds) ||
          shot.assetIds.some(
            (id) => !base.assets.some((asset) => asset.id === id),
          )
        )
          fail("模型不能改变作者冻结的镜头身份、顺序、时长或资产引用。");
        return shot;
      }),
    };
  });
  if (
    script.sceneLinks.length !== scenes.length ||
    !equal(receipt.sceneMappings, expectedMappings)
  )
    fail("镜头计划的完整原／新块映射与冻结回执不一致。");
  const desiredIds = new Set(desired.map((shot) => shot.id));
  if (
    patch.subtitles.some((subtitle) => !desiredIds.has(subtitle.shotId)) ||
    patch.costRisks.some((risk) =>
      risk.shotIds.some((id) => !desiredIds.has(id)),
    )
  )
    fail("新局部字幕与风险不能改写未选或退役镜头。");
  const selectedOldIds = new Set(selected.map((shot) => shot.id));
  const usedAssets = new Set(
    scenes.flatMap((scene) => scene.shots.flatMap((shot) => shot.assetIds)),
  );
  return inspectStoryboardContent(
    {
      ...base,
      scenes,
      assets: base.assets.filter((asset) => usedAssets.has(asset.id)),
      subtitles: [
        ...base.subtitles.filter(
          (subtitle) => !selectedOldIds.has(subtitle.shotId),
        ),
        ...patch.subtitles,
      ],
      costRisks: [
        ...base.costRisks.flatMap((risk) => {
          const shotIds = risk.shotIds.filter((id) => !selectedOldIds.has(id));
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
