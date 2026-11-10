import { BareButton } from "@dramaip/infra-ui-primitives";
import {
  NOVEL_STORY_PRESETS,
  novelStoryPreset,
  type NovelStoryPresetId,
} from "./story-presets";
import styles from "./NovelStoryPresetPicker.module.css";
import { copyText } from "../../copy";
import { clsx } from "clsx";

export function NovelStoryPresetPicker(props: {
  selectedId?: NovelStoryPresetId;
  onSelect(id: NovelStoryPresetId): void;
  onClear(): void;
  mode?: "series_longform" | "single_season";
  compact?: boolean;
}) {
  const selected = novelStoryPreset(props.selectedId);
  const singleSeason = props.mode === "single_season";
  return (
    <section
      className={styles.c1}
      aria-label={copyText("app/features/novel/NovelStoryPresetPicker.1")}
    >
      <div className={styles.c2}>
        <div>
          <h2 className={styles.c3}>
            {copyText("app/features/novel/NovelStoryPresetPicker.2")}
          </h2>
          <p className={styles.c4}>
            {singleSeason
              ? "选择后会初始化单季故事母稿、4 个角色槽位、季纲和首集节点，所有内容均可编辑。"
              : "选择后会初始化项目设定、4 个角色槽位、全书大纲、3 个故事弧和首章节点，所有内容均可编辑。"}
          </p>
        </div>
        {selected && (
          <BareButton className={styles.c5} onClick={props.onClear}>
            {copyText("app/features/novel/NovelStoryPresetPicker.3")}
          </BareButton>
        )}
      </div>
      <div className={props.compact ? styles.c6 : styles.c7}>
        {NOVEL_STORY_PRESETS.map((preset) => {
          const active = preset.id === props.selectedId;
          return (
            <BareButton
              key={preset.id}
              type="button"
              aria-pressed={active}
              className={clsx(
                props.compact ? styles.k1 : styles.k2,
                styles.c8,
                active ? styles.k3 : styles.k4,
              )}
              onClick={() => props.onSelect(preset.id)}
            >
              <span className={styles.c9}>
                <span className={styles.c10}>{preset.label}</span>
                <span
                  className={clsx(styles.c11, active ? styles.k5 : styles.k6)}
                >
                  {active ? "已选择" : "完整预设"}
                </span>
              </span>
              <span className={styles.c12}>{preset.tagline}</span>
            </BareButton>
          );
        })}
      </div>
      {selected && (
        <div className={styles.c13}>
          <p className={styles.c14}>
            {copyText("app/features/novel/NovelStoryPresetPicker.4")}
            {selected.label}
            {copyText("app/features/novel/NovelStoryPresetPicker.5")}
          </p>
          <p className={styles.c15}>{selected.summary}</p>
          <div className={styles.c16}>
            <span className={styles.c17}>
              {selected.characters.length}
              {copyText("app/features/novel/NovelStoryPresetPicker.6")}
            </span>
            {singleSeason ? (
              <>
                <span className={styles.c17}>
                  {copyText("app/features/novel/NovelStoryPresetPicker.7")}
                </span>
                <span className={styles.c17}>
                  {copyText("app/features/novel/NovelStoryPresetPicker.8")}
                </span>
              </>
            ) : (
              <>
                <span className={styles.c17}>
                  {copyText("app/features/novel/NovelStoryPresetPicker.9")}
                </span>
                <span className={styles.c17}>
                  {selected.storyArcs.length}
                  {copyText("app/features/novel/NovelStoryPresetPicker.10")}
                </span>
                <span className={styles.c17}>
                  {copyText("app/features/novel/NovelStoryPresetPicker.11")}
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
