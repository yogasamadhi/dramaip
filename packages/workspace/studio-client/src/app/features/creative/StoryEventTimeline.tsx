import { NativeSelect } from "@dramaip/infra-ui-primitives";
import type {
  StoryDeclarationInput,
  StoryEventTimeline,
} from "@dramaip/contracts/knowledge";
import styles from "./StoryEventTimeline.module.css";
import { copyText } from "../../copy";

export interface EventTimelineDraft {
  enabled: boolean;
  order: string;
  timeLabel: string;
  interpretation: StoryEventTimeline["interpretation"];
}
export const emptyEventTimelineDraft = (): EventTimelineDraft => ({
  enabled: false,
  order: "",
  timeLabel: "",
  interpretation: "author-inferred",
});
export function eventTimelineInput(
  kind: StoryDeclarationInput["kind"],
  draft: EventTimelineDraft,
) {
  return kind === "event" && draft.enabled
    ? {
        eventTimeline: {
          storyOrder: draft.order.trim() ? Number(draft.order) : Number.NaN,
          timeLabel: draft.timeLabel,
          interpretation: draft.interpretation,
        },
      }
    : {};
}
export function StoryEventTimelineFields({
  value,
  onChange,
}: {
  value: EventTimelineDraft;
  onChange(value: EventTimelineDraft): void;
}) {
  const field = styles.c1;
  return (
    <fieldset
      className={styles.c2}
      aria-label={copyText("app/features/creative/StoryEventTimeline.1")}
    >
      <label className={styles.c3}>
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) =>
            onChange({ ...value, enabled: event.target.checked })
          }
        />{" "}
        {copyText("app/features/creative/StoryEventTimeline.2")}
      </label>
      <p className={styles.c4}>
        {copyText("app/features/creative/StoryEventTimeline.3")}
      </p>
      {value.enabled && (
        <>
          <label className={styles.c3}>
            {copyText("app/features/creative/StoryEventTimeline.4")}
            <input
              className={field}
              type="number"
              aria-label={copyText(
                "app/features/creative/StoryEventTimeline.4",
              )}
              min={0}
              step={1}
              value={value.order}
              onChange={(event) =>
                onChange({ ...value, order: event.target.value })
              }
            />
          </label>
          <label className={styles.c3}>
            {copyText("app/features/creative/StoryEventTimeline.5")}
            <input
              className={field}
              maxLength={240}
              aria-label={copyText(
                "app/features/creative/StoryEventTimeline.5",
              )}
              value={value.timeLabel}
              onChange={(event) =>
                onChange({ ...value, timeLabel: event.target.value })
              }
            />
          </label>
          <label className={styles.c3}>
            {copyText("app/features/creative/StoryEventTimeline.6")}
            <NativeSelect
              aria-label={copyText(
                "app/features/creative/StoryEventTimeline.6",
              )}
              value={value.interpretation}
              onChange={(event) =>
                onChange({
                  ...value,
                  interpretation:
                    event.target.value === "source-stated"
                      ? "source-stated"
                      : "author-inferred",
                })
              }
            >
              <option value="author-inferred">
                {copyText("app/features/creative/StoryEventTimeline.7")}
              </option>
              <option value="source-stated">
                {copyText("app/features/creative/StoryEventTimeline.8")}
              </option>
            </NativeSelect>
          </label>
        </>
      )}
    </fieldset>
  );
}
export function StoryEventTimelineText({
  value,
}: {
  value: StoryEventTimeline;
}) {
  return (
    <p className={styles.c5}>
      {copyText("app/features/creative/StoryEventTimeline.9")}
      {value.storyOrder} · {value.timeLabel} ·{" "}
      {value.interpretation === "source-stated"
        ? "作者声明原文有陈述（不是语义认证）"
        : "作者推断（不升级为原文事实）"}
    </p>
  );
}
