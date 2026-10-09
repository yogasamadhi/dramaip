import { Button } from "@dramaip/ui-shared";
import type {
  EpisodeDevelopmentResult,
  StoryboardTopologyPlanRequest,
} from "@dramaip/contracts/production";

const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
/** Explicit author draft, not Runtime ancestry/currentness or semantic proof. */
export function draftStoryboardTopologyPlan(
  base: EpisodeDevelopmentResult,
  previousOutline: EpisodeDevelopmentResult,
  previousScript: EpisodeDevelopmentResult,
  outline: EpisodeDevelopmentResult,
  script: EpisodeDevelopmentResult,
): StoryboardTopologyPlanRequest {
  const values = [previousOutline, previousScript, outline, script];
  if (
    base.content.kind !== "storyboard-package" ||
    previousOutline.content.kind !== "episode-outline" ||
    previousScript.content.kind !== "episode-script" ||
    outline.content.kind !== "episode-outline" ||
    script.content.kind !== "episode-script" ||
    values.some(
      (value) =>
        value.projectId !== base.projectId ||
        value.episodeId !== base.episodeId,
    ) ||
    previousOutline.id !== base.basis.request.outline?.id ||
    previousOutline.version !== base.basis.request.outline.version ||
    previousScript.id !== base.basis.request.script?.id ||
    previousScript.version !== base.basis.request.script.version ||
    script.basis.request.outline?.id !== outline.id ||
    script.basis.request.outline.version !== outline.version ||
    script.scriptId !== base.scriptId ||
    !outline.isCurrent ||
    !script.isCurrent ||
    outline.sourceState !== "current" ||
    script.sourceState !== "current"
  )
    throw new Error(
      "须核全原双正式版本与同项目／分集的新有效正式版本；不替换历史或推定确认链。",
    );
  const content = base.content.value,
    oldScript = previousScript.content.value,
    oldOutline = previousOutline.content.value,
    currentScript = script.content.value;
  const binding = (kind: "scenes" | "shots", stableId: string) => {
    const found = (base.productionRecords ?? []).filter(
      (row) => row.kind === kind && row.stableId === stableId,
    );
    if (found.length !== 1)
      throw new Error("原实际场景／镜头绑定未核全，不猜身份或版本。");
    return { recordId: found[0]!.id, version: found[0]!.version };
  };
  return {
    format: "author-scene-topology-plan-v1",
    scenes: outline.content.value.scenes.map((scene, index) => {
      const original = content.scenes.find((old) => old.sceneId === scene.id),
        oldIndex = content.scenes.findIndex((old) => old.sceneId === scene.id),
        link = currentScript.sceneLinks[index],
        previousLink = oldScript.sceneLinks.find(
          (link) => link.sceneId === scene.id,
        );
      if (!link || link.sceneId !== scene.id)
        throw new Error("新正式场景顺序与实际块映射不一致。");
      const unchanged = Boolean(
        original &&
        oldIndex === index &&
        equal(oldOutline.scenes[oldIndex], scene) &&
        equal(previousLink, link) &&
        equal(
          oldScript.blocks.filter((block) =>
            previousLink!.blockIds.includes(block.id),
          ),
          currentScript.blocks.filter((block) =>
            link.blockIds.includes(block.id),
          ),
        ),
      );
      return {
        sceneId: scene.id,
        orderIndex: index,
        durationSeconds: scene.durationSeconds,
        mode: unchanged ? "retain" : "generate",
        ...(original ? { retains: binding("scenes", scene.id) } : {}),
        shots: original
          ? original.shots.map((shot) => ({
              id: shot.id,
              orderIndex: shot.orderIndex,
              durationSeconds: shot.durationSeconds,
              assetIds: [...shot.assetIds],
              retains: binding("shots", shot.id),
            }))
          : [
              {
                id: crypto.randomUUID(),
                orderIndex: 0,
                durationSeconds: scene.durationSeconds,
                assetIds: content.assets[0] ? [content.assets[0].id] : [],
              },
            ],
      };
    }),
    retiredScenes: [],
    retiredShots: [],
  };
}
export function topologySelectedOldShotIds(
  base: EpisodeDevelopmentResult,
  plan: StoryboardTopologyPlanRequest,
): string[] {
  if (base.content.kind !== "storyboard-package")
    throw new Error("原正式分镜类型不符。");
  const selected = new Set([
    ...plan.scenes
      .filter((scene) => scene.mode === "generate")
      .map((scene) => scene.sceneId),
    ...plan.retiredScenes.map((scene) => scene.sceneId),
  ]);
  return base.content.value.scenes
    .filter((scene) => selected.has(scene.sceneId))
    .flatMap((scene) => scene.shots.map((shot) => shot.id));
}
export function StoryboardTopologyPlanView({
  value,
}: {
  value: StoryboardTopologyPlanRequest;
}) {
  return (
    <div aria-label="冻结场景拓扑元数据" className="space-y-2 break-all">
      {value.scenes.map((scene) => (
        <div key={scene.sceneId}>
          <p>
            场景 {scene.orderIndex + 1} · {scene.sceneId} ·{" "}
            {scene.durationSeconds} 秒 ·{" "}
            {scene.mode === "retain"
              ? "未选保留"
              : scene.retains
                ? "同身份重做"
                : "新增身份"}
            {scene.retains &&
              ` · 实际 ${scene.retains.recordId} v${scene.retains.version}`}
          </p>
          {scene.shots.map((shot) => (
            <p key={shot.id}>
              镜头 {shot.orderIndex + 1} · {shot.id} · {shot.durationSeconds} 秒
              ·{" "}
              {shot.retains
                ? `同场实际 ${shot.retains.recordId} v${shot.retains.version}`
                : "新增，无旧实际字段"}{" "}
              · 原方案资产 {shot.assetIds.join("、")}
            </p>
          ))}
        </div>
      ))}
      {value.retiredScenes.map((scene) => (
        <p key={scene.recordId}>
          明确退役场景 {scene.sceneId} · 实际 {scene.recordId} v{scene.version}
        </p>
      ))}
      {value.retiredShots.map((shot) => (
        <p key={shot.recordId}>
          明确退役镜头 {shot.shotId} · 实际 {shot.recordId} v{shot.version}
        </p>
      ))}
    </div>
  );
}
/** Edits only metadata in a local draft. No document, record, media or model
 * write occurs here; source/CAS/privacy checks still belong to Runtime. */
export function StoryboardTopologyPlanEditor({
  base,
  value,
  onChange,
}: {
  base: EpisodeDevelopmentResult;
  value: StoryboardTopologyPlanRequest;
  onChange: (value: StoryboardTopologyPlanRequest) => void;
}) {
  if (base.content.kind !== "storyboard-package") return null;
  const content = base.content.value;
  const update = (
    sceneId: string,
    shots: StoryboardTopologyPlanRequest["scenes"][number]["shots"],
  ) =>
    onChange({
      ...value,
      scenes: value.scenes.map((scene) =>
        scene.sceneId === sceneId
          ? {
              ...scene,
              mode: "generate",
              shots: shots.map((shot, orderIndex) => ({ ...shot, orderIndex })),
            }
          : scene,
      ),
    });
  const sceneRef = (id: string) => {
    const row = base.productionRecords?.find(
      (row) => row.kind === "scenes" && row.stableId === id,
    );
    if (!row) throw new Error("原场景绑定缺失。");
    return { sceneId: id, recordId: row.id, version: row.version };
  };
  const shotRef = (id: string) => {
    const row = base.productionRecords?.find(
      (row) => row.kind === "shots" && row.stableId === id,
    );
    if (!row) throw new Error("原镜头绑定缺失。");
    return { shotId: id, recordId: row.id, version: row.version };
  };
  const removedScenes = content.scenes.filter(
      (scene) => !value.scenes.some((next) => next.sceneId === scene.sceneId),
    ),
    removedShots = content.scenes.flatMap((scene) =>
      scene.shots.filter(
        (shot) =>
          !value.scenes.some((next) =>
            next.shots.some((item) => item.id === shot.id),
          ),
      ),
    );
  return (
    <section aria-label="作者场景拓扑计划" className="space-y-3">
      <p>
        场景顺序、数量和目标秒数取已正式确认的新大纲／实际剧本，不能在这里改稿。可明确重做或保留、增删／排序镜头与调整秒数及原资产引用。未选保留仅是机械原值相同，不证明语义安全。每项退役须明确确认；历史原值与旧媒体不删除或自动迁移。
      </p>
      {value.scenes.map((scene) => (
        <section
          key={scene.sceneId}
          aria-label={`拓扑场景 ${scene.orderIndex + 1}`}
          className="space-y-2 rounded border border-line p-3"
        >
          <p className="break-all">
            场景 {scene.orderIndex + 1} · {scene.sceneId} · 正式目标{" "}
            {scene.durationSeconds} 秒 · 计划合计{" "}
            {scene.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0)}{" "}
            秒
            {scene.retains
              ? ` · 同实际 ${scene.retains.recordId} v${scene.retains.version}`
              : " · 新场景，尚未创建实际记录"}
          </p>
          {scene.retains && (
            <label>
              <input
                type="checkbox"
                checked={scene.mode === "generate"}
                onChange={(event) =>
                  onChange({
                    ...value,
                    scenes: value.scenes.map((item) =>
                      item.sceneId === scene.sceneId
                        ? {
                            ...item,
                            mode: event.target.checked ? "generate" : "retain",
                          }
                        : item,
                    ),
                  })
                }
              />{" "}
              明确重做此场景全部旧镜头（取消仅在完整原值未变时可保留，Runtime
              会复核）
            </label>
          )}
          {scene.shots.map((shot, index) => (
            <div
              key={shot.id}
              className="space-y-2 rounded border border-line p-2"
            >
              <p className="break-all">
                {shot.retains ? "同场复用" : "新增"}镜头 {index + 1} · {shot.id}
                {shot.retains &&
                  ` · 实际 ${shot.retains.recordId} v${shot.retains.version}`}
              </p>
              <label>
                拓扑场景 {scene.orderIndex + 1} 镜头 {index + 1} 秒数{" "}
                <input
                  type="number"
                  min={1}
                  max={1800}
                  value={
                    Number.isFinite(shot.durationSeconds)
                      ? shot.durationSeconds
                      : ""
                  }
                  onChange={(event) =>
                    update(
                      scene.sceneId,
                      scene.shots.map((item) =>
                        item.id === shot.id
                          ? {
                              ...item,
                              durationSeconds:
                                event.target.value === ""
                                  ? Number.NaN
                                  : Number(event.target.value),
                            }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <fieldset>
                <legend>原方案资产引用</legend>
                {content.assets.map((asset) => (
                  <label key={asset.id} className="mr-3">
                    <input
                      type="checkbox"
                      checked={shot.assetIds.includes(asset.id)}
                      onChange={(event) =>
                        update(
                          scene.sceneId,
                          scene.shots.map((item) =>
                            item.id === shot.id
                              ? {
                                  ...item,
                                  assetIds: event.target.checked
                                    ? [...item.assetIds, asset.id]
                                    : item.assetIds.filter(
                                        (id) => id !== asset.id,
                                      ),
                                }
                              : item,
                          ),
                        )
                      }
                    />{" "}
                    {asset.title} · {asset.id}
                  </label>
                ))}
              </fieldset>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  disabled={index === 0}
                  onClick={() => {
                    const shots = [...scene.shots];
                    [shots[index - 1], shots[index]] = [
                      shots[index]!,
                      shots[index - 1]!,
                    ];
                    update(scene.sceneId, shots);
                  }}
                >
                  上移拓扑镜头 {index + 1}
                </Button>
                <Button
                  variant="ghost"
                  disabled={index === scene.shots.length - 1}
                  onClick={() => {
                    const shots = [...scene.shots];
                    [shots[index], shots[index + 1]] = [
                      shots[index + 1]!,
                      shots[index]!,
                    ];
                    update(scene.sceneId, shots);
                  }}
                >
                  下移拓扑镜头 {index + 1}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    update(
                      scene.sceneId,
                      scene.shots.filter((item) => item.id !== shot.id),
                    )
                  }
                >
                  移除拓扑计划镜头 {index + 1}（旧身份须另行明确退役）
                </Button>
              </div>
            </div>
          ))}
          <Button
            variant="secondary"
            disabled={scene.shots.length >= 500}
            onClick={() =>
              update(scene.sceneId, [
                ...scene.shots,
                {
                  id: crypto.randomUUID(),
                  orderIndex: scene.shots.length,
                  durationSeconds: 1,
                  assetIds: scene.shots[0]?.assetIds.length
                    ? [...scene.shots[0].assetIds]
                    : content.assets[0]
                      ? [content.assets[0].id]
                      : [],
                },
              ])
            }
          >
            新增拓扑镜头（新身份，初始 1 秒须调整）
          </Button>
        </section>
      ))}
      {removedScenes.map((scene) => (
        <label key={scene.sceneId} className="block break-all">
          <input
            type="checkbox"
            checked={value.retiredScenes.some(
              (row) => row.sceneId === scene.sceneId,
            )}
            onChange={(event) =>
              onChange({
                ...value,
                retiredScenes: event.target.checked
                  ? [...value.retiredScenes, sceneRef(scene.sceneId)]
                  : value.retiredScenes.filter(
                      (row) => row.sceneId !== scene.sceneId,
                    ),
              })
            }
          />{" "}
          明确退役旧场景 {scene.sceneId}（所有旧镜头也须逐项确认）
        </label>
      ))}
      {removedShots.map((shot) => (
        <label key={shot.id} className="block break-all">
          <input
            type="checkbox"
            checked={value.retiredShots.some((row) => row.shotId === shot.id)}
            onChange={(event) =>
              onChange({
                ...value,
                retiredShots: event.target.checked
                  ? [...value.retiredShots, shotRef(shot.id)]
                  : value.retiredShots.filter((row) => row.shotId !== shot.id),
              })
            }
          />{" "}
          明确退役旧镜头 {shot.id}，保留实际历史与关联旧素材
        </label>
      ))}
    </section>
  );
}
