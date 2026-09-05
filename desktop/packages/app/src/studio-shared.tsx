import type { StudioClient } from "@dramaip/client";
import type {
  ChangePreview,
  ChapterPatch,
  CreativeDiagnosticKind,
  Project,
  ProviderActionPreview,
  RevisionPreview,
} from "@dramaip/contracts/product";
import { BareButton, PageHeader } from "@dramaip/ui-shared";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useStudioClient } from "./runtime-connection";
export const NOVEL_GENRE_CHOICES = [
  "都市情感",
  "悬疑推理",
  "古装权谋",
  "现代甜宠",
  "逆袭爽文",
  "奇幻冒险",
] as const;

export type ProjectToolKey =
  | "import"
  | "review"
  | "cockpit"
  | "pilot"
  | "series"
  | "personal-theater"
  | "creator-channel";

/** Internal route identifiers stay stable; no internal English identifier is shown in the UI. */
export const DOMAIN_LABELS: Record<string, string> = {
  project: "项目",
  chapter: "章节",
  story: "故事设定",
  characters: "角色",
  outlines: "大纲",
  "story-bible": "故事圣经",
  "story-bible-settings": "故事圣经设置",
  "story-bible-stale": "待更新提醒",
  memory: "创作记忆",
  "chapter-memories": "章节记忆",
  "character-states": "角色状态",
  "visual-profiles": "角色视觉档案",
  "visual-settings": "视觉设定",
  "story-events": "故事事件",
  foreshadowings: "伏笔",
  analysis: "故事分析",
  beats: "节拍",
  highlights: "高光分析",
  feasibility: "可制作性分析",
  trends: "趋势分析",
  evaluations: "章节评估",
  "story-arcs": "故事弧",
  "project-skills": "项目技能",
  "agent-schemes": "智能助手方案",
  inspirations: "灵感收藏",
  templates: "创作模板",
  adaptations: "改编项目",
  episodes: "分集",
  scripts: "剧本",
  scenes: "场景",
  shots: "分镜",
  "shot-stills": "分镜静帧候选",
  "visual-assets": "视觉资产",
  "asset-center": "资产中心",
  storyboard: "导演看板",
  assets: "素材",
  rights: "版权声明",
  "content-versions": "内容检查点",
  image: "图片生成",
  audio: "音频制作",
  video: "视频制作",
  animatics: "动态分镜",
  timeline: "多轨时间线",
  renders: "成片渲染",
  quality: "质量检查",
  compliance: "合规检查",
  localization: "本地化",
  review: "审片",
  delivery: "交付",
  providers: "模型服务商",
  settings: "偏好设置",
  backup: "备份恢复",
  cloud: "云端连接",
  agents: "智能助手",
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  queued: "等待中",
  running: "进行中",
  succeeded: "已完成",
  failed: "失败",
  canceled: "已取消",
  interrupted: "已中断",
  active: "可用",
  available: "可用",
  ready: "可以继续",
  draft: "尚未开始",
  initializing: "正在准备",
  blocked: "需要补充资料",
  conflicted: "需要处理",
  discarded: "已放弃",
  applied: "已完成",
  stale: "需要重新确认",
  expired: "已过期",
  revoked: "已撤销",
};

export const CREATIVE_DIAGNOSTIC_LABELS: Record<
  CreativeDiagnosticKind,
  string
> = {
  freshness: "新鲜度",
  anti_trope: "反套路",
  quality_gate: "质量门禁",
  audience: "受众模拟",
  narrative_curve: "叙事曲线",
};

export function domainLabel(domain: string): string {
  return DOMAIN_LABELS[domain] ?? "资源";
}

export function searchKindLabel(kind: string): string {
  if (kind === "project") return "项目";
  if (kind === "chapter") return "章节";
  return domainLabel(kind);
}

export function searchResultPath(
  kind: string,
  id: string,
  projectId?: string,
): string {
  if (kind === "project") return `/projects/${id}`;
  if (kind === "chapter" && projectId) return `/projects/${projectId}`;
  if (
    ["adaptations", "episodes", "scripts", "scenes", "shots"].includes(kind)
  ) {
    const search = new URLSearchParams({ stage: kind });
    if (projectId) search.set("projectId", projectId);
    const idKey = {
      adaptations: "adaptationId",
      episodes: "episodeId",
      scripts: "scriptId",
      scenes: "sceneId",
      shots: "shotId",
    }[kind];
    if (idKey) search.set(idKey, id);
    return `/adapt?${search}`;
  }
  if (
    [
      "assets",
      "rights",
      "visual-assets",
      "shot-stills",
      "image",
      "audio",
      "video",
      "animatics",
      "renders",
    ].includes(kind)
  ) {
    const search = new URLSearchParams({ stage: kind });
    if (projectId) search.set("projectId", projectId);
    return `/produce?${search}`;
  }
  if (
    ["quality", "compliance", "localization", "review", "delivery"].includes(
      kind,
    )
  ) {
    const search = new URLSearchParams({ stage: kind });
    if (projectId) search.set("projectId", projectId);
    return `/review?${search}`;
  }
  if (["providers", "settings", "backup", "cloud", "agents"].includes(kind))
    return "/settings";
  return "/create";
}

export type EditableChapter = Omit<ChapterPatch, "version">;
export type EditableProject = Pick<
  Project,
  | "title"
  | "shortDramaType"
  | "targetAudience"
  | "targetWordCount"
  | "targetEpisodeCount"
  | "coreHook"
  | "emotionalCore"
  | "coreSellingPoint"
  | "synopsis"
  | "styleGuide"
  | "visualStyleDirection"
  | "genreOpportunity"
  | "productionBrief"
>;

export function useStudio(): StudioClient {
  return useStudioClient();
}

export function WorkspaceIntro(props: {
  eyebrow: string;
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <PageHeader
      eyebrow={props.eyebrow}
      title={props.title}
      description={props.description}
      actions={
        <span className="text-xs font-medium tracking-[0.06em] text-muted">
          {props.badge ?? "本地工作区"}
        </span>
      }
    />
  );
}

export function StageNavigation(props: {
  label: string;
  items: readonly (string | WorkspaceStageItem)[];
  active: string;
  onChange(value: string): void;
}) {
  const items = props.items.map((item): WorkspaceStageItem =>
    typeof item === "string"
      ? {
          id: item,
          label: domainLabel(item),
          availability: "available",
          recommended: false,
        }
      : item,
  );
  const activeItem = items.find((item) => item.id === props.active);
  return (
    <section className="space-y-2">
      <nav
        aria-label={props.label}
        className="flex flex-wrap gap-1 rounded-lg border border-line bg-surface-muted p-1.5"
      >
        {items.map((item) => {
          const active = props.active === item.id;
          return (
            <BareButton
              key={item.id}
              type="button"
              aria-current={active ? "step" : undefined}
              aria-label={item.label}
              aria-describedby={`${props.label}-${item.id}-state`}
              className={`rounded-md px-3 py-2 text-left text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-focus ${active ? "bg-surface-raised text-ink shadow-control" : "text-muted hover:bg-surface hover:text-ink"}`}
              onClick={() => props.onChange(item.id)}
            >
              <span className="block">{item.label}</span>
              <span
                id={`${props.label}-${item.id}-state`}
                className={`mt-0.5 block text-[10px] font-normal ${item.availability === "blocked" ? "text-amber-700" : item.recommended ? "text-brand" : "text-muted"}`}
              >
                {workspaceStageStateLabel(item)}
              </span>
            </BareButton>
          );
        })}
      </nav>
      {activeItem?.availability === "blocked" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p>{activeItem.reason ?? "当前阶段需要先补齐上游资料。"}</p>
          {activeItem.recoveryTarget && activeItem.recoveryLabel && (
            <Link
              className="font-medium text-brand underline underline-offset-2"
              to={activeItem.recoveryTarget}
            >
              {activeItem.recoveryLabel}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

export type WorkspaceStageAvailability = "available" | "blocked";

export interface WorkspaceStageItem {
  id: string;
  label: string;
  availability: WorkspaceStageAvailability;
  recommended: boolean;
  reason?: string;
  recoveryLabel?: string;
  recoveryTarget?: string;
}

export function workspaceStageStateLabel(
  item: Pick<WorkspaceStageItem, "availability" | "recommended">,
): "需要先完成" | "建议现在做" | "可以稍后做" {
  if (item.availability === "blocked") return "需要先完成";
  return item.recommended ? "建议现在做" : "可以稍后做";
}

export const PRODUCT_STATUS_LABELS: Record<string, string> = {
  "not-started": "尚未开始",
  preparing: "正在准备",
  pending: "等待用户确认",
  queued: "正在准备",
  running: "进行中",
  working: "进行中",
  succeeded: "已完成",
  completed: "已完成",
  delivered: "已完成",
  "needs-input": "需要补充资料",
  "needs-attention": "需要处理",
  "needs-human": "等待用户确认",
  "ready-for-review": "可以进入审核",
  failed: "执行失败",
  retryable: "可以重试",
  canceled: "已取消",
  interrupted: "已中断",
};

export function productStatusLabel(status: string): string {
  return PRODUCT_STATUS_LABELS[status] ?? "状态待确认";
}

export function RecoveryNotice(props: {
  happened: string;
  contentSafety: string;
  nextStep: string;
  returnTo: string;
  actions?: ReactNode;
  tone?: "warning" | "danger";
}) {
  return (
    <section
      role="alert"
      className={`rounded-xl border p-4 text-sm ${props.tone === "danger" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}
    >
      <p className="font-medium">发生了什么：{props.happened}</p>
      <p className="mt-2">已有内容：{props.contentSafety}</p>
      <p className="mt-1">下一步：{props.nextStep}</p>
      <p className="mt-1">完成后：{props.returnTo}</p>
      {props.actions && (
        <div className="mt-3 flex flex-wrap gap-2">{props.actions}</div>
      )}
    </section>
  );
}
export function message(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const translations: Record<string, string> = {
    "Studio client is unavailable": "本地服务连接尚未准备就绪",
    "Server is not initialized": "本地服务尚未初始化",
    "Database unavailable": "本地数据库暂不可用",
    "Origin is not allowed": "当前界面来源未获授权",
    "Invalid server credentials": "本地服务身份验证失败",
    "Invalid MCP credentials": "智能助手工具身份验证失败",
    "本地凭据目录不可用，请检查应用数据目录的写入权限。":
      "本地凭据目录不可用，请检查应用数据目录的写入权限。",
    "DramaIP Server health check failed": "本地服务健康检查失败",
  };
  if (translations[raw]) return translations[raw];
  if (/[㐀-鿿]/u.test(raw)) return raw;
  return /[A-Za-z]{2,}/.test(raw) ? "操作未能完成，请稍后重试。" : raw;
}

export function taskResultText(value: unknown): string {
  const seen = new Set<unknown>();
  const findText = (current: unknown, depth: number): string | undefined => {
    if (typeof current === "string" && current.trim()) return current.trim();
    if (
      !current ||
      typeof current !== "object" ||
      depth > 5 ||
      seen.has(current)
    )
      return undefined;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) {
        const found = findText(item, depth + 1);
        if (found) return found;
      }
      return undefined;
    }
    const object = current as Record<string, unknown>;
    for (const key of [
      "summary",
      "suggestedAction",
      "nextSteps",
      "text",
      "content",
      "output",
      "message",
      "result",
      "parts",
    ]) {
      const found = findText(object[key], depth + 1);
      if (found) return found;
    }
    for (const nested of Object.values(object)) {
      const found = findText(nested, depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return findText(value, 0) ?? "任务已完成，未返回可显示的文字结果。";
}

export function agentRevisionPreview(
  value: unknown,
): RevisionPreview | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const candidate = (value as Record<string, unknown>).revisionPreview;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
    return undefined;
  const preview = candidate as Record<string, unknown>;
  if (
    typeof preview.id !== "string" ||
    typeof preview.chapterId !== "string" ||
    typeof preview.baseVersion !== "number" ||
    typeof preview.proposedContent !== "string" ||
    typeof preview.rationale !== "string" ||
    typeof preview.createdAt !== "string" ||
    !["pending", "committed", "discarded", "conflicted"].includes(
      String(preview.status),
    )
  )
    return undefined;
  return preview as unknown as RevisionPreview;
}

export function agentChangePreview(value: unknown): ChangePreview | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const candidate = (value as Record<string, unknown>).changePreview;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
    return undefined;
  const preview = candidate as Record<string, unknown>;
  if (
    typeof preview.id !== "string" ||
    typeof preview.projectId !== "string" ||
    !Array.isArray(preview.targets) ||
    typeof preview.rationale !== "string" ||
    typeof preview.contentHash !== "string" ||
    typeof preview.createdAt !== "string" ||
    !["pending", "committed", "discarded", "conflicted"].includes(
      String(preview.status),
    )
  )
    return undefined;
  return preview as unknown as ChangePreview;
}

export function agentProviderActionPreview(
  value: unknown,
): ProviderActionPreview | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const candidate = (value as Record<string, unknown>).providerActionPreview;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
    return undefined;
  const preview = candidate as Record<string, unknown>;
  if (
    typeof preview.id !== "string" ||
    typeof preview.projectId !== "string" ||
    typeof preview.providerId !== "string" ||
    !["image", "audio", "video", "remote_render"].includes(
      String(preview.kind),
    ) ||
    !["pending", "executed", "discarded", "expired"].includes(
      String(preview.status),
    ) ||
    typeof preview.createdAt !== "string"
  )
    return undefined;
  return preview as unknown as ProviderActionPreview;
}
