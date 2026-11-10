import { Button } from "@dramaip/infra-ui-primitives";
import type {
  EpisodeDevelopmentResult,
  StoryboardTopologyPlanRequest,
} from "@dramaip/contracts/production";
import styles from "./StoryboardTopologyPlanEditor.module.css";
import { copyText } from "../../copy";

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
    <div
      aria-label={copyText(
        "app/features/production/StoryboardTopologyPlanEditor.1",
      )}
      className={styles.c1}
    >
      {value.scenes.map((scene) => (
        <div key={scene.sceneId}>
          <p>
            {copyText("app/features/production/StoryboardTopologyPlanEditor.2")}
            {scene.orderIndex + 1} · {scene.sceneId} · {scene.durationSeconds}
            {copyText(
              "app/features/production/StoryboardTopologyPlanEditor.3",
            )}{" "}
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
              {copyText(
                "app/features/production/StoryboardTopologyPlanEditor.4",
              )}
              {shot.orderIndex + 1} · {shot.id} · {shot.durationSeconds}
              {copyText(
                "app/features/production/StoryboardTopologyPlanEditor.3",
              )}{" "}
              {shot.retains
                ? `同场实际 ${shot.retains.recordId} v${shot.retains.version}`
                : "新增，无旧实际字段"}{" "}
              {copyText(
                "app/features/production/StoryboardTopologyPlanEditor.5",
              )}
              {shot.assetIds.join("、")}
            </p>
          ))}
        </div>
      ))}
      {value.retiredScenes.map((scene) => (
        <p key={scene.recordId}>
          {copyText("app/features/production/StoryboardTopologyPlanEditor.6")}
          {scene.sceneId}
          {copyText("app/features/production/StoryboardTopologyPlanEditor.7")}
          {scene.recordId}
          {copyText("app/features/production/StoryboardTopologyPlanEditor.8")}
          {scene.version}
        </p>
      ))}
      {value.retiredShots.map((shot) => (
        <p key={shot.recordId}>
          {copyText("app/features/production/StoryboardTopologyPlanEditor.9")}
          {shot.shotId}
          {copyText("app/features/production/StoryboardTopologyPlanEditor.7")}
          {shot.recordId}
          {copyText("app/features/production/StoryboardTopologyPlanEditor.8")}
          {shot.version}
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
    <section
      aria-label={copyText(
        "app/features/production/StoryboardTopologyPlanEditor.10",
      )}
      className={styles.c2}
    >
      <p>
        {copyText("app/features/production/StoryboardTopologyPlanEditor.11")}
      </p>
      {value.scenes.map((scene) => (
        <section
          key={scene.sceneId}
          aria-label={copyText(
            "app/features/production/StoryboardTopologyPlanEditor.29",
            { p1: scene.orderIndex + 1 },
          )}
          className={styles.c3}
        >
          <p className={styles.c4}>
            {copyText("app/features/production/StoryboardTopologyPlanEditor.2")}
            {scene.orderIndex + 1} · {scene.sceneId}
            {copyText(
              "app/features/production/StoryboardTopologyPlanEditor.12",
            )}{" "}
            {scene.durationSeconds}
            {copyText(
              "app/features/production/StoryboardTopologyPlanEditor.13",
            )}{" "}
            {scene.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0)}{" "}
            {copyText(
              "app/features/production/StoryboardTopologyPlanEditor.14",
            )}
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
              {copyText(
                "app/features/production/StoryboardTopologyPlanEditor.15",
              )}
            </label>
          )}
          {scene.shots.map((shot, index) => (
            <div key={shot.id} className={styles.c5}>
              <p className={styles.c4}>
                {shot.retains ? "同场复用" : "新增"}
                {copyText(
                  "app/features/production/StoryboardTopologyPlanEditor.4",
                )}
                {index + 1} · {shot.id}
                {shot.retains &&
                  ` · 实际 ${shot.retains.recordId} v${shot.retains.version}`}
              </p>
              <label>
                {copyText(
                  "app/features/production/StoryboardTopologyPlanEditor.16",
                )}
                {scene.orderIndex + 1}
                {copyText(
                  "app/features/production/StoryboardTopologyPlanEditor.17",
                )}
                {index + 1}
                {copyText(
                  "app/features/production/StoryboardTopologyPlanEditor.18",
                )}{" "}
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
                <legend>
                  {copyText(
                    "app/features/production/StoryboardTopologyPlanEditor.19",
                  )}
                </legend>
                {content.assets.map((asset) => (
                  <label key={asset.id} className={styles.c6}>
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
              <div className={styles.c7}>
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
                  {copyText(
                    "app/features/production/StoryboardTopologyPlanEditor.20",
                  )}
                  {index + 1}
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
                  {copyText(
                    "app/features/production/StoryboardTopologyPlanEditor.21",
                  )}
                  {index + 1}
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
                  {copyText(
                    "app/features/production/StoryboardTopologyPlanEditor.22",
                  )}
                  {index + 1}
                  {copyText(
                    "app/features/production/StoryboardTopologyPlanEditor.23",
                  )}
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
            {copyText(
              "app/features/production/StoryboardTopologyPlanEditor.24",
            )}
          </Button>
        </section>
      ))}
      {removedScenes.map((scene) => (
        <label key={scene.sceneId} className={styles.c8}>
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
          {copyText("app/features/production/StoryboardTopologyPlanEditor.25")}
          {scene.sceneId}
          {copyText("app/features/production/StoryboardTopologyPlanEditor.26")}
        </label>
      ))}
      {removedShots.map((shot) => (
        <label key={shot.id} className={styles.c8}>
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
          {copyText("app/features/production/StoryboardTopologyPlanEditor.27")}
          {shot.id}
          {copyText("app/features/production/StoryboardTopologyPlanEditor.28")}
        </label>
      ))}
    </section>
  );
}
