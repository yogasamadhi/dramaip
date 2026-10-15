import type {
  StoryDeclarationInput,
  StoryEventTimeline,
} from "@dramaip/contracts/knowledge";

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
  const field =
    "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm";
  return (
    <fieldset
      className="space-y-2 rounded border border-line p-3"
      aria-label="可选事件时间标注"
    >
      <label className="block text-sm">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) =>
            onChange({ ...value, enabled: event.target.checked })
          }
        />{" "}
        明确标注此事件的故事时间
      </label>
      <p className="text-xs text-muted">
        可不标注，不按章节、剧本块或认知顺序补时间。顺序表示作者审阅的故事时间先后，不是讲述顺序；同序仅并列，不认定同时。原文陈述和作者推断都需与参考内容一起审阅。
      </p>
      {value.enabled && (
        <>
          <label className="block text-sm">
            事件故事时间顺序
            <input
              className={field}
              type="number"
              aria-label="事件故事时间顺序"
              min={0}
              step={1}
              value={value.order}
              onChange={(event) =>
                onChange({ ...value, order: event.target.value })
              }
            />
          </label>
          <label className="block text-sm">
            事件故事时间标签
            <input
              className={field}
              maxLength={240}
              aria-label="事件故事时间标签"
              value={value.timeLabel}
              onChange={(event) =>
                onChange({ ...value, timeLabel: event.target.value })
              }
            />
          </label>
          <label className="block text-sm">
            事件时间解释来源
            <select
              className={field}
              aria-label="事件时间解释来源"
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
                作者推断（不升级为原文事实）
              </option>
              <option value="source-stated">
                作者声明原文有陈述（不是语义认证）
              </option>
            </select>
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
    <p className="whitespace-pre-wrap break-words text-sm">
      事件故事时间顺序 {value.storyOrder} · {value.timeLabel} ·{" "}
      {value.interpretation === "source-stated"
        ? "作者声明原文有陈述（不是语义认证）"
        : "作者推断（不升级为原文事实）"}
    </p>
  );
}
