import type { ChangePreview, Project } from "@dramaip/contracts/product";
import styles from "./creative-intent.module.css";
import { copyText } from "./copy";
import { clsx } from "clsx";

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
    <section className={styles.c1}>
      <div className={styles.c2}>
        <div>
          <p className={styles.c3}>{copyText("app/creative-intent.1")}</p>
          <h3 className={styles.c4}>{copyText("app/creative-intent.2")}</h3>
        </div>
        <span className={styles.c5}>{intent.formalContentState}</span>
      </div>
      <div className={clsx(styles.c6, props.compact ? "" : styles.k1)}>
        <div className={styles.c7}>
          <p className={styles.c8}>{copyText("app/creative-intent.3")}</p>
          <p className={styles.c9}>{intent.userOriginalIdea}</p>
        </div>
        <div className={styles.c7}>
          <p className={styles.c8}>{copyText("app/creative-intent.4")}</p>
          <p className={styles.c10}>
            {copyText("app/creative-intent.5")}
            {intent.storyPreset}
          </p>
          <p className={styles.c11}>{intent.presetSkeleton}</p>
        </div>
        <div className={styles.c7}>
          <p className={styles.c8}>{copyText("app/creative-intent.6")}</p>
          <p className={styles.c9}>{intent.aiRationale}</p>
          {intent.changes.length > 0 && (
            <ul className={styles.c12}>
              {intent.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {!props.compact && (
        <details className={styles.c13}>
          <summary className={styles.c14}>
            {copyText("app/creative-intent.7")}
          </summary>
          <ul className={styles.c15}>
            {intent.confirmedProjectSettings.map((setting) => (
              <li key={setting}>{setting}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
