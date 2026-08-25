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
  if (["adaptations", "episodes", "scripts", "scenes", "shots"].includes(kind))
    return "/adapt";
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
  )
    return "/produce";
  if (
    ["quality", "compliance", "localization", "review", "delivery"].includes(
      kind,
    )
  )
    return "/review";
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
  items: readonly string[];
  active: string;
  onChange(value: string): void;
}) {
  return (
    <nav
      aria-label={props.label}
      className="flex flex-wrap gap-1 rounded-lg border border-line bg-surface-muted p-1.5"
    >
      {props.items.map((item) => {
        const active = props.active === item;
        return (
          <BareButton
            key={item}
            type="button"
            aria-current={active ? "step" : undefined}
            className={`rounded-md px-3 py-2 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-focus ${active ? "bg-surface-raised text-ink shadow-control" : "text-muted hover:bg-surface hover:text-ink"}`}
            onClick={() => props.onChange(item)}
          >
            {domainLabel(item)}
          </BareButton>
        );
      })}
    </nav>
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
