import { Button } from "@dramaip/ui-shared";
import type {
  EpisodeDevelopmentResult,
  StoryboardShotPlanRequest,
} from "@dramaip/contracts/production";

/** Metadata only. The Runtime rechecks actual rows and history before allocation
 * and adoption; a local draft never asserts those sources are current. */
export function StoryboardShotPlanEditor({
  base,
  value,
  onChange,
}: {
  base: EpisodeDevelopmentResult;
  value: StoryboardShotPlanRequest;
  onChange: (next: StoryboardShotPlanRequest) => void;
}) {
  if (base.content.kind !== "storyboard-package") return null;
  const content = base.content.value;
  const updateScene = (
    sceneId: string,
    shots: StoryboardShotPlanRequest["scenePlans"][number]["shots"],
  ) =>
    onChange({
      ...value,
      scenePlans: value.scenePlans.map((scene) =>
        scene.sceneId === sceneId
          ? {
              ...scene,
              shots: shots.map((shot, orderIndex) => ({ ...shot, orderIndex })),
            }
          : scene,
      ),
    });
  return (
    <section aria-label="作者场景镜头计划" className="space-y-3">
      <p>
        按场景完整选择。复用镜头保持实际身份；新增镜头使用新身份。增删、顺序、秒数和既有资产引用都须在生成前明确冻结。各场总时长须仍等于正式大纲；不能增删场景、跨场移镜或补造新资产。退役只保留历史，不删除素材。
      </p>
      {content.scenes.map((original, index) => {
        const plan = value.scenePlans.find(
          (scene) => scene.sceneId === original.sceneId,
        );
        const binding = base.productionRecords?.find(
          (record) =>
            record.kind === "scenes" && record.stableId === original.sceneId,
        );
        const retired = original.shots.filter(
          (shot) =>
            !plan?.shots.some((next) => next.id === shot.id && next.retains),
        );
        return (
          <section
            key={original.sceneId}
            aria-label={`场景 ${index + 1} 镜头计划`}
            className="space-y-2 rounded border border-line p-3"
          >
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={Boolean(plan)}
                disabled={!binding}
                onChange={(event) => {
                  if (!event.target.checked) {
                    onChange({
                      ...value,
                      scenePlans: value.scenePlans.filter(
                        (scene) => scene.sceneId !== original.sceneId,
                      ),
                    });
                    return;
                  }
                  const shots = original.shots.flatMap((shot) => {
                    const record = base.productionRecords?.find(
                      (item) =>
                        item.kind === "shots" && item.stableId === shot.id,
                    );
                    return record
                      ? [
                          {
                            id: shot.id,
                            orderIndex: shot.orderIndex,
                            durationSeconds: shot.durationSeconds,
                            assetIds: [...shot.assetIds],
                            retains: {
                              recordId: record.id,
                              version: record.version,
                            },
                          },
                        ]
                      : [];
                  });
                  if (!binding || shots.length !== original.shots.length)
                    return;
                  const next = {
                    ...value,
                    scenePlans: [
                      ...value.scenePlans,
                      {
                        sceneId: original.sceneId,
                        recordId: binding.id,
                        version: binding.version,
                        shots,
                      },
                    ],
                  };
                  // Canonical formal scene order; never silently reorder shots.
                  next.scenePlans.sort(
                    (left, right) =>
                      content.scenes.findIndex(
                        (scene) => scene.sceneId === left.sceneId,
                      ) -
                      content.scenes.findIndex(
                        (scene) => scene.sceneId === right.sceneId,
                      ),
                  );
                  onChange(next);
                }}
              />
              <span>
                纳入场景 {index + 1} 的全部原镜头 · {original.sceneId}
              </span>
            </label>
            {plan && (
              <>
                <p>
                  新计划 {plan.shots.length} 镜头 ·{" "}
                  {plan.shots.reduce(
                    (sum, shot) => sum + shot.durationSeconds,
                    0,
                  )}{" "}
                  秒；原正式场景{" "}
                  {original.shots.reduce(
                    (sum, shot) => sum + shot.durationSeconds,
                    0,
                  )}{" "}
                  秒。将退役 {retired.length} 个原镜头。
                </p>
                {plan.shots.map((shot, position) => (
                  <div
                    key={shot.id}
                    className="space-y-2 rounded border border-line p-2"
                    aria-label={`计划镜头 ${position + 1}`}
                  >
                    <p className="break-all">
                      {shot.retains ? "复用" : "新增"} {shot.id}
                      {shot.retains
                        ? ` · 实际 ${shot.retains.recordId} v${shot.retains.version}`
                        : " · 未创建实际记录"}
                    </p>
                    <label>
                      计划镜头 {position + 1} 时长（秒）
                      <input
                        className="ml-2 w-24 rounded border border-line bg-surface p-1"
                        type="number"
                        min={1}
                        max={1800}
                        step={1}
                        value={
                          Number.isFinite(shot.durationSeconds)
                            ? shot.durationSeconds
                            : ""
                        }
                        onChange={(event) =>
                          updateScene(
                            original.sceneId,
                            plan.shots.map((entry) =>
                              entry.id === shot.id
                                ? {
                                    ...entry,
                                    durationSeconds:
                                      event.target.value === ""
                                        ? Number.NaN
                                        : Number(event.target.value),
                                  }
                                : entry,
                            ),
                          )
                        }
                      />
                    </label>
                    <fieldset>
                      <legend>计划镜头 {position + 1} 既有资产引用</legend>
                      {content.assets.map((asset) => (
                        <label
                          key={asset.id}
                          className="mr-3 inline-flex items-center gap-1"
                        >
                          <input
                            type="checkbox"
                            checked={shot.assetIds.includes(asset.id)}
                            onChange={(event) =>
                              updateScene(
                                original.sceneId,
                                plan.shots.map((entry) =>
                                  entry.id === shot.id
                                    ? {
                                        ...entry,
                                        assetIds: event.target.checked
                                          ? [...entry.assetIds, asset.id]
                                          : entry.assetIds.filter(
                                              (id) => id !== asset.id,
                                            ),
                                      }
                                    : entry,
                                ),
                              )
                            }
                          />
                          {asset.title} · {asset.id}
                        </label>
                      ))}
                    </fieldset>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="ghost"
                        disabled={position === 0}
                        onClick={() => {
                          const next = [...plan.shots];
                          [next[position - 1], next[position]] = [
                            next[position]!,
                            next[position - 1]!,
                          ];
                          updateScene(original.sceneId, next);
                        }}
                      >
                        上移计划镜头 {position + 1}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={position === plan.shots.length - 1}
                        onClick={() => {
                          const next = [...plan.shots];
                          [next[position], next[position + 1]] = [
                            next[position + 1]!,
                            next[position]!,
                          ];
                          updateScene(original.sceneId, next);
                        }}
                      >
                        下移计划镜头 {position + 1}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          updateScene(
                            original.sceneId,
                            plan.shots.filter((entry) => entry.id !== shot.id),
                          )
                        }
                      >
                        移除计划镜头 {position + 1}
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  variant="secondary"
                  disabled={plan.shots.length >= 500}
                  onClick={() =>
                    updateScene(original.sceneId, [
                      ...plan.shots,
                      {
                        id: crypto.randomUUID(),
                        orderIndex: plan.shots.length,
                        durationSeconds: 1,
                        assetIds: [
                          ...(plan.shots[0]?.assetIds ??
                            original.shots[0]!.assetIds),
                        ],
                      },
                    ])
                  }
                >
                  新增镜头（新身份，初始 1 秒，请调整）
                </Button>
                {retired.length > 0 && (
                  <p className="break-all">
                    将退役的原身份：{retired.map((shot) => shot.id).join("、")}
                    。旧正式快照与实际记录保留，关联旧素材须重新复核；没有模型质量、费用或权利承诺。
                  </p>
                )}
              </>
            )}
          </section>
        );
      })}
    </section>
  );
}
