import { Button } from "@dramaip/infra-ui-primitives";
import type {
  EpisodeDevelopmentResult,
  StoryboardShotPlanRequest,
} from "@dramaip/contracts/production";
import styles from "./StoryboardShotPlanEditor.module.css";
import { copyText } from "../../copy";

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
    <section
      aria-label={copyText(
        "app/features/production/StoryboardShotPlanEditor.1",
      )}
      className={styles.c1}
    >
      <p>{copyText("app/features/production/StoryboardShotPlanEditor.2")}</p>
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
            aria-label={copyText(
              "app/features/production/StoryboardShotPlanEditor.19",
              { p1: index + 1 },
            )}
            className={styles.c2}
          >
            <label className={styles.c3}>
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
                {copyText("app/features/production/StoryboardShotPlanEditor.3")}
                {index + 1}
                {copyText("app/features/production/StoryboardShotPlanEditor.4")}
                {original.sceneId}
              </span>
            </label>
            {plan && (
              <>
                <p>
                  {copyText(
                    "app/features/production/StoryboardShotPlanEditor.5",
                  )}
                  {plan.shots.length}
                  {copyText(
                    "app/features/production/StoryboardShotPlanEditor.6",
                  )}{" "}
                  {plan.shots.reduce(
                    (sum, shot) => sum + shot.durationSeconds,
                    0,
                  )}{" "}
                  {copyText(
                    "app/features/production/StoryboardShotPlanEditor.7",
                  )}{" "}
                  {original.shots.reduce(
                    (sum, shot) => sum + shot.durationSeconds,
                    0,
                  )}{" "}
                  {copyText(
                    "app/features/production/StoryboardShotPlanEditor.8",
                  )}
                  {retired.length}
                  {copyText(
                    "app/features/production/StoryboardShotPlanEditor.9",
                  )}
                </p>
                {plan.shots.map((shot, position) => (
                  <div
                    key={shot.id}
                    className={styles.c4}
                    aria-label={copyText(
                      "app/features/production/StoryboardShotPlanEditor.20",
                      { p1: position + 1 },
                    )}
                  >
                    <p className={styles.c5}>
                      {shot.retains ? "复用" : "新增"} {shot.id}
                      {shot.retains
                        ? ` · 实际 ${shot.retains.recordId} v${shot.retains.version}`
                        : " · 未创建实际记录"}
                    </p>
                    <label>
                      {copyText(
                        "app/features/production/StoryboardShotPlanEditor.10",
                      )}
                      {position + 1}
                      {copyText(
                        "app/features/production/StoryboardShotPlanEditor.11",
                      )}
                      <input
                        className={styles.c6}
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
                      <legend>
                        {copyText(
                          "app/features/production/StoryboardShotPlanEditor.10",
                        )}
                        {position + 1}
                        {copyText(
                          "app/features/production/StoryboardShotPlanEditor.12",
                        )}
                      </legend>
                      {content.assets.map((asset) => (
                        <label key={asset.id} className={styles.c7}>
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
                    <div className={styles.c8}>
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
                        {copyText(
                          "app/features/production/StoryboardShotPlanEditor.13",
                        )}
                        {position + 1}
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
                        {copyText(
                          "app/features/production/StoryboardShotPlanEditor.14",
                        )}
                        {position + 1}
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
                        {copyText(
                          "app/features/production/StoryboardShotPlanEditor.15",
                        )}
                        {position + 1}
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
                  {copyText(
                    "app/features/production/StoryboardShotPlanEditor.16",
                  )}
                </Button>
                {retired.length > 0 && (
                  <p className={styles.c5}>
                    {copyText(
                      "app/features/production/StoryboardShotPlanEditor.17",
                    )}
                    {retired.map((shot) => shot.id).join("、")}
                    {copyText(
                      "app/features/production/StoryboardShotPlanEditor.18",
                    )}
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
