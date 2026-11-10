import { useState } from "react";
import { Button, NativeSelect } from "@dramaip/infra-ui-primitives";
import type {
  EpisodeDevelopmentImpact,
  StoryboardAttributionImpactSelection,
} from "@dramaip/contracts/production";
import type { EpisodeImpactReference } from "../../episode-impact-view";
import {
  freezeStoryboardSourceReviewFrame,
  sourceReviewConfirmations,
  sourceReviewShotState,
  type SourceReviewDraft,
  type StoryboardSourceReviewFrame,
} from "../../storyboard-source-review-state";
import { message } from "../../studio-shared";
import styles from "./StoryboardSourceReviewComposer.module.css";
import { copyText } from "../../copy";

export function StoryboardSourceReviewComposer({
  reference,
  attribution,
  report,
  selectedShotIds,
  scopeKey,
  onFreeze,
  onInvalidate,
}: {
  reference: EpisodeImpactReference;
  attribution: StoryboardAttributionImpactSelection;
  report: EpisodeDevelopmentImpact;
  selectedShotIds: readonly string[];
  scopeKey: string;
  onFreeze(frame: StoryboardSourceReviewFrame): void;
  onInvalidate(): void;
}) {
  const [draft, setDraft] = useState<SourceReviewDraft>({
    decisions: {},
    confirmation: {},
  });
  const [error, setError] = useState<string>();
  const [frozen, setFrozen] = useState(false);
  const update = (next: SourceReviewDraft) => {
    onInvalidate();
    setFrozen(false);
    setError(undefined);
    setDraft(next);
  };
  let prepared: StoryboardSourceReviewFrame | undefined;
  try {
    prepared = freezeStoryboardSourceReviewFrame(
      reference,
      attribution,
      report,
      selectedShotIds,
      draft,
      scopeKey,
    );
  } catch {
    /* Incomplete explicit input is not an approval. */
  }
  return (
    <section
      aria-label={copyText(
        "app/features/production/StoryboardSourceReviewComposer.1",
      )}
      className={styles.c1}
    >
      <h4 className={styles.c2}>
        {copyText("app/features/production/StoryboardSourceReviewComposer.2")}
      </h4>
      <p className={styles.c3}>
        {copyText("app/features/production/StoryboardSourceReviewComposer.3")}
      </p>
      <p className={styles.c4}>
        {copyText("app/features/production/StoryboardSourceReviewComposer.4")}
        {attribution.id}
        {copyText("app/features/production/StoryboardSourceReviewComposer.5")}
        {attribution.version}
        {copyText(
          "app/features/production/StoryboardSourceReviewComposer.6",
        )}{" "}
        {report.snapshotHash}
      </p>
      {report.shots.map((shot) => {
        const state = sourceReviewShotState(report, shot);
        return (
          <label key={shot.shotId} className={styles.c5}>
            <span className={styles.c4}>
              {copyText(
                "app/features/production/StoryboardSourceReviewComposer.7",
              )}
              {shot.sceneId}
              {copyText(
                "app/features/production/StoryboardSourceReviewComposer.8",
              )}
              {shot.shotId} ·{" "}
              {state === "unresolved"
                ? "范围未核全，禁止进入重做"
                : state === "affected"
                  ? "机械受影响，必须明确重做"
                  : state === "unassociated"
                    ? "未关联，不等于未变化"
                    : "未观察到关联变化，不证明语义安全"}{" "}
              {copyText(
                "app/features/production/StoryboardSourceReviewComposer.9",
              )}
              {selectedShotIds.includes(shot.shotId) ? "重做" : "保留"}
            </span>
            <span className={styles.c6}>
              {copyText(
                "app/features/production/StoryboardSourceReviewComposer.10",
              )}
              {shot.record?.id ?? "缺失"}
              {copyText(
                "app/features/production/StoryboardSourceReviewComposer.11",
              )}{" "}
              {shot.record?.currentVersion ?? "未核全"}
            </span>
            <NativeSelect
              aria-label={copyText(
                "app/features/production/StoryboardSourceReviewComposer.18",
                { p1: shot.shotId },
              )}
              className={styles.c7}
              value={draft.decisions[shot.shotId] ?? ""}
              onChange={(event) => {
                const decisions = { ...draft.decisions };
                if (event.target.value)
                  decisions[shot.shotId] = event.target.value as
                    "redo" | "retain";
                else delete decisions[shot.shotId];
                update({ ...draft, decisions });
              }}
            >
              <option value="">
                {copyText(
                  "app/features/production/StoryboardSourceReviewComposer.12",
                )}
              </option>
              <option value="redo">
                {copyText(
                  "app/features/production/StoryboardSourceReviewComposer.13",
                )}
              </option>
              <option value="retain">
                {copyText(
                  "app/features/production/StoryboardSourceReviewComposer.14",
                )}
              </option>
            </NativeSelect>
          </label>
        );
      })}
      {Object.entries(sourceReviewConfirmations).map(([name, label]) => (
        <label key={name} className={styles.c8}>
          <input
            type="checkbox"
            aria-label={label}
            checked={Boolean(
              draft.confirmation[
                name as keyof typeof sourceReviewConfirmations
              ],
            )}
            onChange={(event) =>
              update({
                ...draft,
                confirmation: {
                  ...draft.confirmation,
                  [name]: event.target.checked,
                },
              })
            }
          />
          <span>{label}</span>
        </label>
      ))}
      <Button
        variant="secondary"
        disabled={!prepared || frozen}
        onClick={() => {
          try {
            const frame = freezeStoryboardSourceReviewFrame(
              reference,
              attribution,
              report,
              selectedShotIds,
              draft,
              scopeKey,
            );
            onFreeze(frame);
            setFrozen(true);
            setError(undefined);
          } catch (cause) {
            onInvalidate();
            setError(message(cause));
          }
        }}
      >
        {copyText("app/features/production/StoryboardSourceReviewComposer.15")}
      </Button>
      {frozen && (
        <p role="status">
          {copyText(
            "app/features/production/StoryboardSourceReviewComposer.16",
          )}
        </p>
      )}
      {!prepared && (
        <p className={styles.c3}>
          {copyText(
            "app/features/production/StoryboardSourceReviewComposer.17",
          )}
        </p>
      )}
      {error && (
        <p role="alert" className={styles.c9}>
          {error}
        </p>
      )}
    </section>
  );
}
