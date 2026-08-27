import { BareButton } from "@dramaip/ui-shared";
import {
  NOVEL_STORY_PRESETS,
  novelStoryPreset,
  type NovelStoryPresetId,
} from "./story-presets";

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
    <section className="mt-5" aria-label="完整故事预设">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">完整故事预设（可选）</h2>
          <p className="mt-1 text-xs leading-5 text-muted">
            {singleSeason
              ? "选择后会初始化单季故事母稿、4 个角色槽位、季纲和首集节点，所有内容均可编辑。"
              : "选择后会初始化项目设定、4 个角色槽位、全书大纲、3 个故事弧和首章节点，所有内容均可编辑。"}
          </p>
        </div>
        {selected && (
          <BareButton
            className="text-xs font-medium text-brand hover:text-brand-strong"
            onClick={props.onClear}
          >
            改用普通题材
          </BareButton>
        )}
      </div>
      <div
        className={
          props.compact
            ? "mt-3 flex gap-3 overflow-x-auto pb-2"
            : "mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        }
      >
        {NOVEL_STORY_PRESETS.map((preset) => {
          const active = preset.id === props.selectedId;
          return (
            <BareButton
              key={preset.id}
              type="button"
              aria-pressed={active}
              className={`${props.compact ? "min-h-24 min-w-56 flex-1 p-3" : "min-h-32 p-4"} rounded-xl border text-left transition ${
                active
                  ? "border-brand bg-brand-soft text-brand-strong shadow-control"
                  : "border-line bg-surface-raised text-ink hover:border-line-strong hover:bg-surface-muted"
              }`}
              onClick={() => props.onSelect(preset.id)}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold">{preset.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    active
                      ? "bg-brand text-white"
                      : "bg-surface-muted text-muted"
                  }`}
                >
                  {active ? "已选择" : "完整预设"}
                </span>
              </span>
              <span className="mt-2 block text-sm leading-6 text-muted">
                {preset.tagline}
              </span>
            </BareButton>
          );
        })}
      </div>
      {selected && (
        <div className="mt-3 rounded-xl border border-brand/30 bg-brand-soft/45 p-4">
          <p className="text-sm font-medium text-brand-strong">
            将创建：{selected.label}完整骨架
          </p>
          <p className="mt-1 text-sm leading-6 text-muted">
            {selected.summary}
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
            <span className="rounded-full bg-surface-raised px-2.5 py-1">
              {selected.characters.length} 个角色槽位
            </span>
            {singleSeason ? (
              <>
                <span className="rounded-full bg-surface-raised px-2.5 py-1">
                  1 份单季季纲
                </span>
                <span className="rounded-full bg-surface-raised px-2.5 py-1">
                  首集冲突、钩子与悬念
                </span>
              </>
            ) : (
              <>
                <span className="rounded-full bg-surface-raised px-2.5 py-1">
                  1 份全书大纲
                </span>
                <span className="rounded-full bg-surface-raised px-2.5 py-1">
                  {selected.storyArcs.length} 个阶段故事弧
                </span>
                <span className="rounded-full bg-surface-raised px-2.5 py-1">
                  首章冲突、钩子与悬念
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
