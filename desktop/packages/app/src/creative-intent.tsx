import type { ChangePreview, Project } from "@dramaip/contracts/product";

export type CreativeIntentViewModel = {
  userOriginalIdea: string;
  confirmedProjectSettings: string[];
  storyPreset: string;
  presetSkeleton: string;
  aiRationale: string;
  changes: string[];
  formalContentState: string;
};

const UNRECORDED = "未记录";

function recordedSection(value: string | undefined, heading: string): string {
  if (!value) return UNRECORDED;
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `【${escaped}】\\s*([\\s\\S]*?)(?=\\n\\s*\\n【|$)`,
  ).exec(value);
  return match?.[1]?.trim() || UNRECORDED;
}

function targetLabel(kind: string): string {
  return (
    {
      project: "项目设定",
      chapter: "章节",
      character: "人物",
      outline: "故事大纲",
      story_bible: "故事圣经",
      episode: "分集",
      script: "剧本",
      scene: "场景",
      shot: "分镜",
    }[kind] ?? "内容对象"
  );
}

export function deriveCreativeIntent(
  project: Project,
  preview?: ChangePreview,
): CreativeIntentViewModel {
  const synopsisIdea = recordedSection(project.synopsis, "用户灵感");
  const styleIdea = recordedSection(project.styleGuide, "创作灵感");
  const presetIdea = recordedSection(project.styleGuide, "用户灵感优先");
  const presetMatch = /【完整故事预设】\s*([^\n]+)/.exec(
    project.styleGuide ?? "",
  );
  const confirmedProjectSettings = [
    `项目名称：${project.title}`,
    project.targetAudience ? `目标受众：${project.targetAudience}` : undefined,
    project.coreHook ? `核心钩子：${project.coreHook}` : undefined,
    project.emotionalCore ? `情感核心：${project.emotionalCore}` : undefined,
    project.coreSellingPoint
      ? `核心卖点：${project.coreSellingPoint}`
      : undefined,
    project.visualStyleDirection
      ? `视觉方向：${project.visualStyleDirection}`
      : undefined,
  ].filter((item): item is string => Boolean(item));
  const formalContentState = preview
    ? preview.status === "committed"
      ? "已采用变更；任务、预览状态和版本记录继续保留"
      : preview.status === "conflicted"
        ? "版本冲突，正式内容未覆盖；请重新读取最新内容后重新生成"
        : preview.status === "discarded"
          ? "已放弃建议，正式内容未修改"
          : "等待用户确认，正式内容未修改"
    : "当前仅展示已确认设定，不会修改正式内容";
  return {
    userOriginalIdea:
      [synopsisIdea, styleIdea, presetIdea].find(
        (value) => value !== UNRECORDED,
      ) ?? UNRECORDED,
    confirmedProjectSettings,
    storyPreset: presetMatch?.[1]?.trim() || UNRECORDED,
    presetSkeleton: recordedSection(project.synopsis, "预设展开方向"),
    aiRationale: preview?.rationale.trim() || UNRECORDED,
    changes:
      preview?.targets.map(
        (target) =>
          `${targetLabel(target.kind)} · 基础版本 ${target.baseVersion}`,
      ) ?? [],
    formalContentState,
  };
}

export function CreativeIntentSummary(props: {
  project: Project;
  preview?: ChangePreview;
  compact?: boolean;
}) {
  const intent = deriveCreativeIntent(props.project, props.preview);
  return (
    <section className="rounded-xl border border-line bg-surface-raised p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="studio-eyebrow">作者意图与变更来源</p>
          <h3 className="mt-1 font-semibold">哪些来自你，哪些来自预设与 AI</h3>
        </div>
        <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand">
          {intent.formalContentState}
        </span>
      </div>
      <div
        className={`mt-3 grid gap-3 text-sm ${props.compact ? "" : "lg:grid-cols-3"}`}
      >
        <div className="rounded-lg bg-surface-muted p-3">
          <p className="text-xs font-medium text-brand">用户输入</p>
          <p className="mt-1 whitespace-pre-wrap leading-6">
            {intent.userOriginalIdea}
          </p>
        </div>
        <div className="rounded-lg bg-surface-muted p-3">
          <p className="text-xs font-medium text-brand">预设骨架</p>
          <p className="mt-1">完整故事预设：{intent.storyPreset}</p>
          <p className="mt-1 whitespace-pre-wrap leading-6 text-muted">
            {intent.presetSkeleton}
          </p>
        </div>
        <div className="rounded-lg bg-surface-muted p-3">
          <p className="text-xs font-medium text-brand">AI 本次建议</p>
          <p className="mt-1 whitespace-pre-wrap leading-6">
            {intent.aiRationale}
          </p>
          {intent.changes.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted">
              {intent.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {!props.compact && (
        <details className="mt-3 rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-sm font-medium">
            查看用户已确认的项目设定
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
            {intent.confirmedProjectSettings.map((setting) => (
              <li key={setting}>{setting}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
