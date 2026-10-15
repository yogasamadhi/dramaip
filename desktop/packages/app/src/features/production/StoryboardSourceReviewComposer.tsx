import { useState } from "react";
import { Button, NativeSelect } from "@dramaip/ui-shared";
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
      aria-label="完整来源影响审阅"
      className="space-y-3 rounded border border-line p-3"
    >
      <h4 className="font-medium">全部实际镜头的独立决定</h4>
      <p className="text-muted">
        先在本轮重做范围明确选择镜头，再逐一核对以下决定，二者必须完全一致。未知范围不能以全选或作者确认放行；来源变化后未关联镜头不能默认为保留。原来源资格、结构计划及未选实际字段保护仍须通过后端核对。
      </p>
      <p className="break-all">
        原关联 {attribution.id} · v{attribution.version} · 本次观察{" "}
        {report.snapshotHash}
      </p>
      {report.shots.map((shot) => {
        const state = sourceReviewShotState(report, shot);
        return (
          <label key={shot.shotId} className="block space-y-1">
            <span className="break-all">
              场景 {shot.sceneId} · 镜头 {shot.shotId} ·{" "}
              {state === "unresolved"
                ? "范围未核全，禁止进入重做"
                : state === "affected"
                  ? "机械受影响，必须明确重做"
                  : state === "unassociated"
                    ? "未关联，不等于未变化"
                    : "未观察到关联变化，不证明语义安全"}{" "}
              · 本轮选择：
              {selectedShotIds.includes(shot.shotId) ? "重做" : "保留"}
            </span>
            <span className="block break-all">
              实际记录 {shot.record?.id ?? "缺失"} · 当前版本{" "}
              {shot.record?.currentVersion ?? "未核全"}
            </span>
            <NativeSelect
              aria-label={`来源审阅镜头决定 ${shot.shotId}`}
              className="w-full"
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
              <option value="">请明确决定，不自动填入</option>
              <option value="redo">重做</option>
              <option value="retain">保留（不是语义安全保证）</option>
            </NativeSelect>
          </label>
        );
      })}
      {Object.entries(sourceReviewConfirmations).map(([name, label]) => (
        <label key={name} className="flex items-start gap-2">
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
        冻结本次完整来源审阅
      </Button>
      {frozen && (
        <p role="status">
          完整来源审阅已冻结；确认本轮基准前还会读取同一原关联与全部实际观察，不自动换版本。
        </p>
      )}
      {!prepared && (
        <p className="text-muted">
          尚未满足全部镜头明确决定、完整范围与五项独立审阅；未知或不符范围仍拒绝。
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger-strong">
          {error}
        </p>
      )}
    </section>
  );
}
