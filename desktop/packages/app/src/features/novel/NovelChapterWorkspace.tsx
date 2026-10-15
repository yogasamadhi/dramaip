import { CreationWorkbench } from "../creation-workbench";
import { ChapterPreviewRevisionPanel } from "../ChapterPreviewRevisionPanel";
import { NovelContextPicker } from "./NovelContextPicker";
import { rememberContinuedChapterContext } from "../../continued-chapter-context";
import {
  NarrativeContextRequestSchema,
  type NarrativeContextRequest,
} from "@dramaip/contracts/creation";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Link } from "react-router-dom";
import type { StudioClient } from "@dramaip/client";
import type {
  AgentEngineDescriptor,
  AgentEngineKind,
  AgentItem,
  AgentRun,
  AgentSession,
  AgentTaskType,
  AssistantConversationDetail,
  ChangePreview,
  Chapter,
  DomainEntity,
  NovelChapterStatus,
  Project,
  Task,
} from "@dramaip/contracts/product";
import { MODEL_PROVIDER_CATALOG } from "@dramaip/contracts/product";
import {
  BareButton,
  Button,
  Dialog,
  Textarea,
  confirmDialog,
} from "@dramaip/ui-shared";
import { AiSettingsLink, useStudioSession } from "../../studio-session";
import { CreativeIntentSummary } from "../../creative-intent";
import {
  buildSegmentedTextDiff,
  changedBlockIds,
  selectedText,
  type SegmentedDiffBlock,
} from "./segmented-text-diff";
import {
  DocumentSaveQueue,
  responseMatchesCurrentDraft,
} from "./document-save-queue";
import {
  AssistantMessageContent,
  AssistantStageSummary,
  AssistantToolActivity,
  useAssistantAutoScroll,
} from "../assistant-message-content";

const PREFERENCES_KEY = "dramaip-novel-editor-preferences-v2";
const DEFAULT_WORD_GOAL = 2_000;
const WORD_GOAL_TOLERANCE = 300;
const NOVEL_WORKSPACE_LAYOUT_VERSION = 5 as const;
const DEFAULT_RIGHT_PANEL_WIDTH = 440;
const MIN_RIGHT_PANEL_WIDTH = 360;
const MAX_RIGHT_PANEL_WIDTH = 640;

type SaveState = "clean" | "dirty" | "saving" | "saved" | "error" | "recovered";

interface EditorPreferences {
  fontSize: 16 | 18 | 20;
  lineHeight: 1.65 | 1.85 | 2.05;
  contentWidth: 680 | 760 | 880;
  wordGoal: number;
  typewriterMode: boolean;
}

type NovelContextTab = "writing" | "story-bible" | "conversations";
type NovelWorkspaceMode = "context" | "ai";

interface NovelWorkspacePreferences {
  layoutVersion: typeof NOVEL_WORKSPACE_LAYOUT_VERSION;
  rightTab: NovelContextTab;
  rightWidth: number;
  rightCollapsed: boolean;
  mode: NovelWorkspaceMode;
}

interface ActiveRun {
  taskId: string;
  runId: string;
  chapterId: string;
  taskType: AgentTaskType;
  engineKind: AgentEngineKind;
  autoCommitWhenReady: boolean;
  originalContent: string;
  status: AgentRun["status"];
  progress: number;
  error?: string;
}

interface DraftRecovery {
  chapterId: string;
  baseVersion: number;
  title: string;
  content: string;
  updatedAt: string;
  editingSessionId?: string;
}

const CHAPTER_DETAIL_FIELDS = [
  ["summary", "章节摘要", "用几句话概括本章推进"],
  ["outline", "章节大纲", "本章事件顺序和关键节点"],
  ["mainConflict", "核心冲突", "本章主要矛盾与对抗"],
  ["hook", "开场钩子", "开篇如何快速抓住读者"],
  ["highlight", "爽点与高光", "最有情绪回报的场面"],
  ["reversal", "关键反转", "信息、关系或局势变化"],
  ["cliffhanger", "结尾悬念", "推动读者进入下一章的钩子"],
  ["shortDramaNote", "短剧化备注", "节奏、对白、画面或改编提示"],
  ["aiVideoNote", "视觉制作备注", "场景、人物一致性与未来视频制作约束"],
] as const satisfies ReadonlyArray<
  readonly [keyof ChapterEditablePatch, string, string]
>;

type ChapterEditablePatch = Partial<
  Pick<
    Chapter,
    | "title"
    | "summary"
    | "content"
    | "outline"
    | "mainConflict"
    | "hook"
    | "highlight"
    | "reversal"
    | "cliffhanger"
    | "shortDramaNote"
    | "aiVideoNote"
  >
>;

export interface NovelChapterWorkspaceProps {
  client: StudioClient;
  projectId: string;
  chapters: Chapter[];
  activeChapter?: Chapter;
  onSelectChapter(id: string): void;
  onCreateChapter(): Promise<Chapter | undefined>;
  onSaveChapter(
    chapterId: string,
    patch: ChapterEditablePatch,
    baseVersion: number,
  ): Promise<Chapter>;
  onRemoveChapter(chapter: Chapter): Promise<void>;
  onReorderChapters(chapterIds: string[]): Promise<void>;
  onReload(): Promise<void> | void;
  renderStoryBibleSidecar?(input: {
    chapter: Chapter;
    content: string;
  }): ReactNode;
}

interface AiAction {
  taskType: AgentTaskType;
  label: string;
  description: string;
  requiresContent?: boolean;
  instruction: string;
}

const COMMON_ACTIONS: readonly AiAction[] = [
  {
    taskType: "generate_chapter",
    label: "智能生成正文",
    description: "根据设定、人物与大纲直接生成完整章节",
    instruction: "根据当前项目设定、人物与章节大纲，生成并检查完整的本章正文。",
  },
  {
    taskType: "continue_chapter",
    instruction:
      "续写本章：保留已有正文，承接当前结尾继续推进情节。返回包含原文和新增内容的完整本章正文。",
    label: "续写本章",
    description: "承接现有结尾继续写作",
    requiresContent: true,
  },
  {
    taskType: "rewrite_chapter",
    instruction:
      "改写本章：保留人物设定、关键事实与剧情目标，重新组织本章叙事和表达。返回改写后的完整本章正文。",
    label: "改写本章",
    description: "保留剧情目标并重新组织全文",
    requiresContent: true,
  },
  {
    taskType: "polish_chapter",
    instruction:
      "润色本章：保留情节顺序和关键事实，改善语言、对白、节奏与画面感。返回润色后的完整本章正文。",
    label: "润色本章",
    description: "提升表达、对白和画面感",
    requiresContent: true,
  },
  {
    taskType: "expand_chapter",
    instruction:
      "扩写本章：保留现有情节与人物动机，补充动作、环境和情绪细节。返回扩写后的完整本章正文。",
    label: "扩写本章",
    description: "补充情节、动作与情绪细节",
    requiresContent: true,
  },
];

const ENHANCEMENT_ACTIONS: readonly AiAction[] = [
  {
    taskType: "enhance_conflict",
    instruction:
      "增强冲突：围绕当前人物目标，强化本章的阻力、对抗与代价，保持设定一致。返回完整本章正文。",
    label: "增强冲突",
    description: "提高对抗强度",
  },
  {
    taskType: "enhance_highlight",
    instruction:
      "增强爽点：强化本章高光场面与情绪回报，保留合理铺垫和人物动机。返回完整本章正文。",
    label: "增强爽点",
    description: "强化情绪回报",
  },
  {
    taskType: "enhance_hook",
    instruction:
      "强化钩子：优化本章开篇的信息、行动或悬念，提高吸引力并衔接后文。返回完整本章正文。",
    label: "强化钩子",
    description: "优化开篇吸引力",
  },
  {
    taskType: "enhance_reversal",
    instruction:
      "强化反转：根据已有伏笔设计合理的信息、关系或局势变化，避免无依据的突变。返回完整本章正文。",
    label: "强化反转",
    description: "增加有效意外",
  },
  {
    taskType: "enhance_cliffhanger",
    instruction:
      "强化悬念：优化本章结尾的未决问题与紧迫感，自然引出下一章。返回完整本章正文。",
    label: "强化悬念",
    description: "增强章节尾钩",
  },
  {
    taskType: "enhance_ai_drama_feel",
    instruction:
      "增强短剧感：压缩冗长铺垫，强化可视动作、对白与场景推进，保留小说叙事形式。返回完整本章正文。",
    label: "增强短剧感",
    description: "压缩铺垫并提高节奏",
  },
  {
    taskType: "enhance_author_style",
    instruction:
      "强化作者风格：参考已采用章节的叙事声音、句式与用词，统一本章表达，保留情节与事实。返回完整本章正文。",
    label: "强化作者风格",
    description: "统一叙事语言",
  },
  {
    taskType: "rewrite_as_ai_drama_novel",
    instruction:
      "短剧化改写：将本章改写为画面鲜明、节奏紧凑、对白推动剧情的短剧小说，保留人物和核心情节。返回完整本章正文。",
    label: "短剧化改写",
    description: "改为强画面短剧小说",
  },
];

function readPreferences(): EditorPreferences {
  const fallback: EditorPreferences = {
    fontSize: 18,
    lineHeight: 1.85,
    contentWidth: 760,
    wordGoal: DEFAULT_WORD_GOAL,
    typewriterMode: false,
  };
  try {
    const value = JSON.parse(
      window.localStorage.getItem(PREFERENCES_KEY) ?? "null",
    ) as Partial<EditorPreferences> | null;
    return {
      fontSize:
        value?.fontSize === 16 || value?.fontSize === 20 ? value.fontSize : 18,
      lineHeight:
        value?.lineHeight === 1.65 || value?.lineHeight === 2.05
          ? value.lineHeight
          : 1.85,
      contentWidth:
        value?.contentWidth === 680 || value?.contentWidth === 880
          ? value.contentWidth
          : 760,
      wordGoal:
        Number.isInteger(value?.wordGoal) && Number(value?.wordGoal) > 0
          ? Math.min(5_000, Number(value?.wordGoal))
          : DEFAULT_WORD_GOAL,
      typewriterMode: value?.typewriterMode === true,
    };
  } catch {
    return fallback;
  }
}

function readWorkspacePreferences(
  projectId: string,
): NovelWorkspacePreferences {
  const fallback: NovelWorkspacePreferences = {
    layoutVersion: NOVEL_WORKSPACE_LAYOUT_VERSION,
    rightTab: "writing",
    rightWidth: DEFAULT_RIGHT_PANEL_WIDTH,
    rightCollapsed: false,
    mode: "ai",
  };
  try {
    const value = JSON.parse(
      window.localStorage.getItem(
        `dramaip-novel-workspace-preferences-v5:${projectId}`,
      ) ??
        window.localStorage.getItem(
          `dramaip-novel-workspace-preferences-v4:${projectId}`,
        ) ??
        window.localStorage.getItem(
          `dramaip-novel-workspace-preferences-v3:${projectId}`,
        ) ??
        "null",
    ) as Partial<NovelWorkspacePreferences> | null;
    if (!value) return fallback;
    const migratedRightWidth = (() => {
      if (value?.layoutVersion === NOVEL_WORKSPACE_LAYOUT_VERSION)
        return value.rightWidth ?? DEFAULT_RIGHT_PANEL_WIDTH;
      if (value?.layoutVersion === 3)
        return value.rightWidth ?? DEFAULT_RIGHT_PANEL_WIDTH;
      if (value?.layoutVersion === 2) return (value.rightWidth ?? 480) + 40;
      return (value?.rightWidth ?? 340) + 180;
    })();
    return {
      layoutVersion: NOVEL_WORKSPACE_LAYOUT_VERSION,
      rightTab:
        value.layoutVersion === NOVEL_WORKSPACE_LAYOUT_VERSION &&
        (value.rightTab === "story-bible" || value.rightTab === "conversations")
          ? value.rightTab
          : "writing",
      rightWidth: Math.min(
        MAX_RIGHT_PANEL_WIDTH,
        Math.max(MIN_RIGHT_PANEL_WIDTH, migratedRightWidth),
      ),
      rightCollapsed:
        value?.layoutVersion === NOVEL_WORKSPACE_LAYOUT_VERSION &&
        value.rightCollapsed === true,
      mode:
        value?.mode === "context" || value?.mode === "ai" ? value.mode : "ai",
    };
  } catch {
    return fallback;
  }
}

export function recommendedNovelActions(input: {
  hasContent: boolean;
  hasSelection: boolean;
}): readonly AgentTaskType[] {
  if (input.hasSelection) return ["polish_chapter"];
  if (!input.hasContent) return ["generate_chapter"];
  return ["continue_chapter", "rewrite_chapter", "polish_chapter"];
}

function countCharacters(value: string): number {
  return value.replace(/\s/g, "").length;
}

function proposedContent(preview: ChangePreview): string | undefined {
  const target = preview.targets.find((item) => item.kind === "chapter");
  if (!target) return undefined;
  if (target.patch && typeof target.patch === "object") {
    const content = (target.patch as Record<string, unknown>).content;
    if (typeof content === "string") return content;
  }
  if (target.displayDiff && typeof target.displayDiff === "object") {
    const content = (target.displayDiff as Record<string, unknown>)
      .proposedContent;
    if (typeof content === "string") return content;
  }
  return undefined;
}

function previewFromTaskResult(value: unknown): ChangePreview | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const candidate = (value as Record<string, unknown>).changePreview;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
    return undefined;
  return candidate as ChangePreview;
}

function asChangePreview(value: unknown): ChangePreview | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const preview = value as Record<string, unknown>;
  if (
    typeof preview.id !== "string" ||
    !Array.isArray(preview.targets) ||
    typeof preview.status !== "string"
  )
    return undefined;
  return value as ChangePreview;
}

function draftKey(chapterId: string): string {
  return `dramaip-novel-draft:${chapterId}`;
}

function readRecovery(chapter: Chapter): DraftRecovery | undefined {
  try {
    const recovery = JSON.parse(
      window.localStorage.getItem(draftKey(chapter.id)) ?? "null",
    ) as DraftRecovery | null;
    if (
      recovery?.chapterId === chapter.id &&
      (recovery.content !== chapter.content || recovery.title !== chapter.title)
    )
      return recovery;
  } catch {}
  return undefined;
}

function saveStateLabel(state: SaveState): string {
  if (state === "dirty") return "等待自动保存";
  if (state === "saving") return "正在保存";
  if (state === "error") return "保存失败";
  if (state === "recovered") return "已恢复草稿";
  if (state === "saved") return "刚刚已保存";
  return "已保存";
}

function engineStatusLabel(engine: AgentEngineDescriptor): string {
  if (engine.runtimeStatus === "crashed") return "进程已崩溃";
  if (engine.runtimeStatus === "stopped") return "进程未启动";
  if (engine.configurationStatus === "missing_credentials") return "缺少凭据";
  if (engine.configurationStatus === "missing_model") return "缺少模型";
  if (engine.configurationStatus === "login_required") return "需要登录";
  if (engine.invocationStatus === "failed") return "上次调用失败";
  if (engine.invocationStatus === "untested") return "尚未检测";
  return engine.canRun === false ? "暂不可运行" : "已验证";
}

function taskStatusLabel(status: AgentRun["status"]): string {
  const labels: Record<AgentRun["status"], string> = {
    created: "已创建",
    queued: "等待中",
    preparing: "准备中",
    running: "生成中",
    waiting_approval: "等待授权",
    committing: "正在提交",
    completed: "生成完成",
    failed: "生成失败",
    aborted: "已取消",
    interrupted: "已中断",
    orphaned: "运行已失联",
    recoverable: "等待恢复",
  };
  return labels[status];
}

function taskTypeLabel(taskType: AgentTaskType): string {
  return (
    [...COMMON_ACTIONS, ...ENHANCEMENT_ACTIONS].find(
      (action) => action.taskType === taskType,
    )?.label ?? "请处理当前创作任务"
  );
}

function expectsNovelChange(taskType: AgentTaskType): boolean {
  return (
    taskType === "chapter_revision" ||
    [...COMMON_ACTIONS, ...ENHANCEMENT_ACTIONS].some(
      (action) => action.taskType === taskType,
    )
  );
}

export function completedPreviewUiState(
  autoCommitWhenReady: boolean,
  outsideGoal: boolean,
): {
  mode: "length-decision" | "candidate-review";
  busy: boolean;
} {
  if (autoCommitWhenReady && outsideGoal)
    return { mode: "length-decision", busy: false };
  return { mode: "candidate-review", busy: false };
}

export function NovelChapterWorkspace(props: NovelChapterWorkspaceProps) {
  const [workspace, setWorkspace] = useState<{
    statuses: NovelChapterStatus[];
    storyArcs: DomainEntity[];
  }>({ statuses: [], storyArcs: [] });
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );
  const [draggingId, setDraggingId] = useState<string>();
  const [visibleLimit, setVisibleLimit] = useState(100);
  const directoryKey = `dramaip-novel-directory:${props.projectId}`;
  const [directoryState, setDirectoryState] = useState({
    key: directoryKey,
    open: window.localStorage.getItem(directoryKey) !== "closed",
  });
  const directoryOpen =
    directoryState.key === directoryKey
      ? directoryState.open
      : window.localStorage.getItem(directoryKey) !== "closed";
  const setDirectoryOpen = (value: boolean | ((open: boolean) => boolean)) => {
    const open = typeof value === "function" ? value(directoryOpen) : value;
    setDirectoryState({ key: directoryKey, open });
    window.localStorage.setItem(directoryKey, open ? "open" : "closed");
  };
  const searchInputRef = useRef<HTMLInputElement>(null);
  const directoryToggleRef = useRef<HTMLButtonElement>(null);
  const toggleDirectory = () => setDirectoryOpen((open) => !open);

  const loadWorkspace = useCallback(() => {
    void props.client.novelWorkspace
      .get(props.projectId)
      .then((value) =>
        setWorkspace({ statuses: value.statuses, storyArcs: value.storyArcs }),
      )
      .catch(() => undefined);
  }, [props.client, props.projectId]);

  useEffect(loadWorkspace, [loadWorkspace, props.chapters]);
  useEffect(() => {
    setVisibleLimit(100);
  }, [props.projectId]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setDirectoryOpen(true);
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void props.onCreateChapter();
        return;
      }
      if (
        event.altKey &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        const index = props.chapters.findIndex(
          (chapter) => chapter.id === props.activeChapter?.id,
        );
        const nextIndex = index + (event.key === "ArrowUp" ? -1 : 1);
        const next = props.chapters[nextIndex];
        if (next) {
          event.preventDefault();
          props.onSelectChapter(next.id);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props]);
  const statuses = useMemo(
    () =>
      Object.fromEntries(
        workspace.statuses.map((item) => [item.chapterId, item]),
      ) as Record<string, NovelChapterStatus>,
    [workspace.statuses],
  );
  const filteredChapters = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return props.chapters.filter(
      (chapter) =>
        !normalized ||
        chapter.title.toLowerCase().includes(normalized) ||
        chapter.summary.toLowerCase().includes(normalized),
    );
  }, [props.chapters, query]);
  useEffect(() => setVisibleLimit(100), [query]);
  useEffect(() => {
    const activeIndex = filteredChapters.findIndex(
      (chapter) => chapter.id === props.activeChapter?.id,
    );
    if (activeIndex >= visibleLimit)
      setVisibleLimit(Math.ceil((activeIndex + 1) / 100) * 100);
  }, [filteredChapters, props.activeChapter?.id, visibleLimit]);
  const visibleChapters = useMemo(
    () => filteredChapters.slice(0, visibleLimit),
    [filteredChapters, visibleLimit],
  );
  const chapterGroups = useMemo(() => {
    const candidates = workspace.storyArcs
      .map((arc) => {
        const payload =
          arc.payload && typeof arc.payload === "object"
            ? (arc.payload as Record<string, unknown>)
            : {};
        return {
          id: arc.id,
          title: arc.title,
          level: String(payload["层级"] ?? ""),
          start: Number(payload["起始章节"] ?? 0),
          end: Number(payload["结束章节"] ?? 0),
        };
      })
      .filter(
        (arc) =>
          (arc.level === "卷" || arc.level === "单元") &&
          Number.isInteger(arc.start) &&
          Number.isInteger(arc.end) &&
          arc.start > 0 &&
          arc.end >= arc.start,
      );
    const units = candidates.filter((arc) => arc.level === "单元");
    const ranges = (
      units.length ? units : candidates.filter((arc) => arc.level === "卷")
    ).sort((left, right) => left.start - right.start || left.end - right.end);
    if (!ranges.length)
      return [{ id: "all", title: "", chapters: visibleChapters }];
    const byId = new Map(
      visibleChapters.map((chapter) => [chapter.id, chapter]),
    );
    const claimed = new Set<string>();
    const groups = ranges.map((range) => {
      const chapters = props.chapters
        .slice(range.start - 1, range.end)
        .filter((chapter) => byId.has(chapter.id));
      chapters.forEach((chapter) => claimed.add(chapter.id));
      return {
        id: range.id,
        title: `${range.level} · ${range.title}`,
        chapters,
      };
    });
    const unassigned = visibleChapters.filter(
      (chapter) => !claimed.has(chapter.id),
    );
    if (unassigned.length)
      groups.push({
        id: "unassigned",
        title: "未分组章节",
        chapters: unassigned,
      });
    return groups.filter((group) => group.chapters.length);
  }, [props.chapters, visibleChapters, workspace.storyArcs]);

  const reorderBefore = (sourceId: string, targetId: string): void => {
    if (sourceId === targetId) return;
    const ids = props.chapters.map((chapter) => chapter.id);
    const next = ids.filter((id) => id !== sourceId);
    const target = next.indexOf(targetId);
    if (target < 0) return;
    next.splice(target, 0, sourceId);
    void props.onReorderChapters(next);
  };

  const moveCheckedToEnd = (): void => {
    const ids = props.chapters.map((chapter) => chapter.id);
    void props.onReorderChapters([
      ...ids.filter((id) => !checked.has(id)),
      ...ids.filter((id) => checked.has(id)),
    ]);
    setChecked(new Set());
  };

  return (
    <section className="relative flex h-full min-h-0 min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-float">
      <aside
        id="novel-chapter-directory"
        aria-label="章节目录"
        className={`${directoryOpen ? "flex" : "hidden"} absolute inset-y-0 left-0 z-30 w-[224px] shrink-0 flex-col border-r border-line bg-page shadow-float xl:relative xl:z-auto xl:shadow-none`}
      >
        <div className="space-y-3 border-b border-line p-4">
          <div className="flex items-center justify-between text-sm font-medium">
            卷章目录
            <BareButton
              aria-label="收起章节目录"
              onClick={() => {
                setDirectoryOpen(false);
                directoryToggleRef.current?.focus();
              }}
            >
              收起
            </BareButton>
          </div>
          <div className="flex items-center gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">搜索章节</span>
              <input
                ref={searchInputRef}
                className="h-10 w-full rounded-xl border border-line bg-surface-raised/90 px-3 text-sm shadow-card"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索章节"
              />
            </label>
            <BareButton
              aria-label="＋"
              className="h-10 shrink-0 rounded-full bg-studio-dark px-4 text-sm font-medium text-white shadow-card hover:bg-rust"
              onClick={() => void props.onCreateChapter()}
            >
              新建
            </BareButton>
          </div>
          <p className="text-xs text-muted">
            共 {props.chapters.length} 章
            {workspace.storyArcs.length
              ? ` · ${workspace.storyArcs.length} 个卷或单元`
              : ""}
            · 可拖拽排序
          </p>
          {checked.size > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-brand-soft p-2 text-xs text-brand">
              <span className="min-w-0 flex-1">已选 {checked.size} 章</span>
              <BareButton className="font-medium" onClick={moveCheckedToEnd}>
                移至末尾
              </BareButton>
              <BareButton onClick={() => setChecked(new Set())}>
                取消
              </BareButton>
            </div>
          )}
        </div>
        <div
          className="studio-scrollbar min-h-0 flex-1 overflow-auto p-3"
          role="tree"
        >
          {chapterGroups.map((group) => {
            const collapsed = !query.trim() && collapsedGroups.has(group.id);
            return (
              <section key={group.id} className="mb-1">
                {group.title && (
                  <BareButton
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs font-medium text-muted hover:text-brand"
                    aria-expanded={!collapsed}
                    onClick={() =>
                      setCollapsedGroups((current) => {
                        const next = new Set(current);
                        if (next.has(group.id)) next.delete(group.id);
                        else next.add(group.id);
                        return next;
                      })
                    }
                  >
                    <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {group.title}
                    </span>
                    <span>{group.chapters.length} 章</span>
                  </BareButton>
                )}
                {!collapsed &&
                  group.chapters.map((chapter) => {
                    const status = statuses[chapter.id];
                    const selected = chapter.id === props.activeChapter?.id;
                    return (
                      <div
                        key={chapter.id}
                        draggable
                        role="treeitem"
                        aria-selected={selected}
                        className={`group mb-2 flex items-start gap-1 rounded-xl border p-2.5 transition ${
                          selected
                            ? "border-brand bg-surface-raised shadow-card"
                            : "border-transparent hover:border-line-strong hover:bg-surface-raised/75"
                        } ${draggingId === chapter.id ? "opacity-50" : ""}`}
                        onDragStart={(event: DragEvent<HTMLDivElement>) => {
                          event.dataTransfer.setData("text/plain", chapter.id);
                          event.dataTransfer.effectAllowed = "move";
                          setDraggingId(chapter.id);
                        }}
                        onDragEnd={() => setDraggingId(undefined)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          reorderBefore(
                            event.dataTransfer.getData("text/plain"),
                            chapter.id,
                          );
                          setDraggingId(undefined);
                        }}
                      >
                        <span
                          className="mt-1 text-xs text-muted"
                          aria-hidden="true"
                        >
                          ⋮⋮
                        </span>
                        <input
                          className="mt-1"
                          aria-label={`选择${chapter.title}`}
                          type="checkbox"
                          checked={checked.has(chapter.id)}
                          onChange={() =>
                            setChecked((current) => {
                              const next = new Set(current);
                              if (next.has(chapter.id)) next.delete(chapter.id);
                              else next.add(chapter.id);
                              return next;
                            })
                          }
                        />
                        <BareButton
                          className="min-w-0 flex-1 text-left"
                          onClick={() => {
                            props.onSelectChapter(chapter.id);
                            if (window.innerWidth < 1280)
                              setDirectoryOpen(false);
                          }}
                        >
                          <span
                            className={`block truncate text-sm font-medium ${selected ? "text-rust" : "text-ink"}`}
                          >
                            {chapter.title}
                          </span>
                          <span className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                            <span>
                              {status?.words ??
                                countCharacters(chapter.content)}{" "}
                              字
                            </span>
                            <span
                              title={
                                status?.hasMemory
                                  ? "已有章节记忆"
                                  : "尚无章节记忆"
                              }
                            >
                              {status?.hasMemory ? "记忆已更新" : "无记忆"}
                            </span>
                            {status?.quality && (
                              <span>
                                {status.quality === "pass"
                                  ? "质检通过"
                                  : status.quality === "warn"
                                    ? "质检提醒"
                                    : "质检阻塞"}
                              </span>
                            )}
                          </span>
                        </BareButton>
                      </div>
                    );
                  })}
              </section>
            );
          })}
          {!visibleChapters.length && (
            <p className="p-5 text-center text-sm text-muted">
              {props.chapters.length ? "没有匹配的章节" : "新建章节开始创作"}
            </p>
          )}
          {filteredChapters.length > visibleChapters.length ? (
            <BareButton
              className="mx-2 mb-3 w-[calc(100%-1rem)] rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm font-medium text-brand-strong"
              onClick={() => setVisibleLimit((value) => value + 100)}
            >
              再显示 100 章
            </BareButton>
          ) : null}
        </div>
      </aside>
      {props.activeChapter ? (
        <NovelEditor
          {...props}
          chapter={props.activeChapter}
          onWorkspaceChanged={loadWorkspace}
          directoryOpen={directoryOpen}
          onToggleDirectory={toggleDirectory}
          directoryToggleRef={directoryToggleRef}
        />
      ) : (
        <div className="grid min-w-0 flex-1 place-items-center text-sm text-muted">
          新建章节后即可智能生成正文。
        </div>
      )}
    </section>
  );
}

function NovelEditor(
  props: NovelChapterWorkspaceProps & {
    chapter: Chapter;
    onWorkspaceChanged(): void;
    directoryOpen: boolean;
    onToggleDirectory(): void;
    directoryToggleRef: RefObject<HTMLButtonElement | null>;
  },
) {
  const studioSession = useStudioSession();
  const pendingChapterIntent =
    studioSession.pendingIntent?.actionId.startsWith("novel-chapter:") &&
    studioSession.pendingIntent.projectId === props.projectId &&
    (!studioSession.pendingIntent.chapterId ||
      studioSession.pendingIntent.chapterId === props.chapter.id)
      ? studioSession.pendingIntent
      : undefined;
  const [manualEditing, setManualEditing] = useState(false);
  const [title, setTitle] = useState(props.chapter.title);
  const [content, setContent] = useState(props.chapter.content);
  const [preferences, setPreferences] = useState(readPreferences);
  const contextKey = `dramaip-novel-context:${props.projectId}:${props.chapter.id}`;
  const readContext = (): NarrativeContextRequest => {
    try {
      const parsed = NarrativeContextRequestSchema.safeParse(
        JSON.parse(window.localStorage.getItem(contextKey) ?? "null"),
      );
      if (parsed.success) return parsed.data;
    } catch {
      /* An invalid draft does not become a source selection. */
    }
    return { format: "narrative-context-v1", chapters: [] };
  };
  const [contextDraft, setContextDraft] = useState(() => ({
    key: contextKey,
    value: readContext(),
  }));
  const narrativeContextRequest =
    contextDraft.key === contextKey ? contextDraft.value : readContext();
  const updateContext = (value: NarrativeContextRequest) => {
    setContextDraft({ key: contextKey, value });
    window.localStorage.setItem(contextKey, JSON.stringify(value));
  };
  const nextContextKey = `${contextKey}:next`;
  const readNextContext = (): NarrativeContextRequest | undefined => {
    try {
      const parsed = NarrativeContextRequestSchema.safeParse(
        JSON.parse(window.localStorage.getItem(nextContextKey) ?? "null"),
      );
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  };
  const [nextContextDraft, setNextContextDraft] = useState<{
    key: string;
    value?: NarrativeContextRequest;
  }>(() => ({ key: nextContextKey, value: readNextContext() }));
  const explicitNextContext =
    nextContextDraft.key === nextContextKey
      ? nextContextDraft.value
      : readNextContext();
  const nextContextRequest = explicitNextContext ?? {
    format: "narrative-context-v1",
    chapters: [
      {
        id: props.chapter.id,
        version: props.chapter.version,
        representation: "original",
      },
    ],
  };
  const updateNextContext = (value: NarrativeContextRequest) => {
    setNextContextDraft({ key: nextContextKey, value });
    window.localStorage.setItem(nextContextKey, JSON.stringify(value));
  };
  const [saveState, setSaveState] = useState<SaveState>("clean");
  const [saveError, setSaveError] = useState<string>();
  const [recovery, setRecovery] = useState(() => readRecovery(props.chapter));
  const [selectedRange, setSelectedRange] = useState<{
    text: string;
    from: number;
    to: number;
  }>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [workspacePreferences, setWorkspacePreferences] = useState(() =>
    readWorkspacePreferences(props.projectId),
  );
  const [instruction, setInstruction] = useState(
    () => pendingChapterIntent?.input ?? "",
  );
  const [engines, setEngines] = useState<AgentEngineDescriptor[]>([]);
  const [engineKind, setEngineKind] = useState<AgentEngineKind>("pi");
  const [modelId, setModelId] = useState("");
  const [conversations, setConversations] = useState<AgentSession[]>([]);
  const [archivedConversations, setArchivedConversations] = useState<
    AgentSession[]
  >([]);
  const [conversationId, setConversationId] = useState<string>();
  const [conversationDetail, setConversationDetail] =
    useState<AssistantConversationDetail>();
  const [activeRun, setActiveRunState] = useState<ActiveRun>();
  const [streamText, setStreamText] = useState("");
  const [notice, setNotice] = useState<string>();
  const [preview, setPreview] = useState<ChangePreview>();
  const [intentProject, setIntentProject] = useState<Project>();
  const [previewView, setPreviewView] = useState<"original" | "candidate">(
    "candidate",
  );
  const [diffOpen, setDiffOpen] = useState(false);
  const [lengthPreview, setLengthPreview] = useState<ChangePreview>();
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionContent, setRevisionContent] = useState(props.chapter.content);
  const [revisionRationale, setRevisionRationale] = useState("");
  const [revisionPreview, setRevisionPreview] = useState<{
    id: string;
    baseVersion: number;
    proposedContent: string;
    rationale: string;
  }>();
  const [revisionError, setRevisionError] = useState<string>();
  const [chapterDetails, setChapterDetails] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        CHAPTER_DETAIL_FIELDS.map(([key]) => [
          key,
          String(props.chapter[key] ?? ""),
        ]),
      ),
  );
  const [versions, setVersions] = useState<DomainEntity[]>([]);
  const [busy, setBusy] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const editingSessionId = useRef(crypto.randomUUID());
  const activeChapterIdRef = useRef(props.chapter.id);
  const versionByChapter = useRef(
    new Map<string, number>([[props.chapter.id, props.chapter.version]]),
  );
  const titleRef = useRef(props.chapter.title);
  const contentRef = useRef(props.chapter.content);
  const editRevision = useRef(0);
  const saveQueue = useRef(new DocumentSaveQueue());
  const draftAtPreview = useRef(props.chapter.content);
  const serverContent = useRef(props.chapter.content);
  const serverTitle = useRef(props.chapter.title);
  const currentVersion = useRef(props.chapter.version);
  const activeRunRef = useRef<ActiveRun | undefined>(undefined);
  const streamTextRef = useRef("");
  const handledPreviewIds = useRef(new Set<string>());
  const scrollRef = useRef<HTMLDivElement>(null);

  const setActiveRun = useCallback((value: ActiveRun | undefined) => {
    activeRunRef.current = value;
    setActiveRunState(value);
  }, []);

  useEffect(() => {
    currentVersion.current = props.chapter.version;
    versionByChapter.current.set(props.chapter.id, props.chapter.version);
    serverContent.current = props.chapter.content;
    serverTitle.current = props.chapter.title;
  }, [props.chapter.version, props.chapter.content, props.chapter.title]);

  useEffect(() => {
    activeChapterIdRef.current = props.chapter.id;
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    window.localStorage.setItem(
      `dramaip-novel-workspace-preferences-v5:${props.projectId}`,
      JSON.stringify(workspacePreferences),
    );
  }, [props.projectId, workspacePreferences]);

  useEffect(() => {
    const focusAssistant = (event: Event) => {
      event.preventDefault();
      setWorkspacePreferences((current) => ({
        ...current,
        rightTab: "writing",
        rightCollapsed: false,
        mode: "ai",
      }));
      setDrawerOpen(true);
    };
    window.addEventListener("dramaip:open-novel-assistant", focusAssistant);
    return () =>
      window.removeEventListener(
        "dramaip:open-novel-assistant",
        focusAssistant,
      );
  }, []);

  useEffect(() => {
    if (!selectedRange) return;
    setWorkspacePreferences((current) =>
      current.rightTab === "writing" && current.mode === "ai"
        ? current
        : {
            ...current,
            rightTab: "writing",
            rightCollapsed: false,
            mode: "ai",
          },
    );
  }, [selectedRange]);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [2, 3] } }),
        Placeholder.configure({
          placeholder: "提出本章目标，让 AI 生成并检查候选正文。",
        }),
        Markdown.configure({
          html: false,
          transformPastedText: true,
          transformCopiedText: true,
        }),
      ],
      content: props.chapter.content,
      editable: manualEditing && (!preview || previewView !== "candidate"),
      editorProps: {
        attributes: {
          class:
            "novel-tiptap-content mx-auto min-h-full px-8 py-8 focus:outline-none",
          role: "textbox",
          "aria-label": "章节正文编辑器",
          "aria-multiline": "true",
        },
      },
      onUpdate: ({ editor }) => {
        const storage = editor.storage as {
          markdown?: { getMarkdown?: () => string };
        };
        const markdown = storage.markdown?.getMarkdown?.() ?? editor.getText();
        contentRef.current = markdown;
        editRevision.current += 1;
        setContent(markdown);
        setSaveState("dirty");
      },
      onSelectionUpdate: ({ editor }) => {
        const { from, to } = editor.state.selection;
        const text =
          from === to ? "" : editor.state.doc.textBetween(from, to, " ");
        setSelectedRange(text.trim() ? { text, from, to } : undefined);
        if (!preferences.typewriterMode || from === to) return;
        window.requestAnimationFrame(() => {
          const selection = window.getSelection();
          const anchor = selection?.anchorNode?.parentElement;
          const container = scrollRef.current;
          if (!anchor || !container) return;
          const parent = container.getBoundingClientRect();
          const child = anchor.getBoundingClientRect();
          container.scrollTo({
            top:
              container.scrollTop +
              child.top -
              parent.top -
              parent.height * 0.42,
            behavior: "smooth",
          });
        });
      },
    },
    [props.chapter.id],
  );

  useEffect(() => {
    setTitle(props.chapter.title);
    setContent(props.chapter.content);
    titleRef.current = props.chapter.title;
    contentRef.current = props.chapter.content;
    draftAtPreview.current = props.chapter.content;
    editRevision.current += 1;
    editingSessionId.current = crypto.randomUUID();
    setRecovery(readRecovery(props.chapter));
    setSaveState("clean");
    setSaveError(undefined);
    setRevisionOpen(false);
    setRevisionContent(props.chapter.content);
    setRevisionRationale("");
    setRevisionPreview(undefined);
    setRevisionError(undefined);
    setChapterDetails(
      Object.fromEntries(
        CHAPTER_DETAIL_FIELDS.map(([key]) => [
          key,
          String(props.chapter[key] ?? ""),
        ]),
      ),
    );
    currentVersion.current = props.chapter.version;
    serverContent.current = props.chapter.content;
    serverTitle.current = props.chapter.title;
  }, [props.chapter.id]);

  const persist = useCallback((): Promise<Chapter> => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const snapshot = {
      chapterId: props.chapter.id,
      title: titleRef.current.trim() || props.chapter.title,
      content: contentRef.current,
      revision: editRevision.current,
    };
    const unchanged =
      snapshot.title === serverTitle.current &&
      snapshot.content === serverContent.current;
    if (unchanged) return props.client.chapters.get(props.chapter.id);
    setSaveState("saving");
    setSaveError(undefined);
    const operation = saveQueue.current.enqueue(
      snapshot.chapterId,
      async () => {
        const updated = await props.onSaveChapter(
          snapshot.chapterId,
          { title: snapshot.title, content: snapshot.content },
          versionByChapter.current.get(snapshot.chapterId) ??
            currentVersion.current,
        );
        versionByChapter.current.set(snapshot.chapterId, updated.version);
        const stillActive = activeChapterIdRef.current === snapshot.chapterId;
        if (stillActive) {
          currentVersion.current = updated.version;
          serverContent.current = updated.content;
          serverTitle.current = updated.title;
        }
        const stillLatest = responseMatchesCurrentDraft({
          snapshot: {
            documentId: snapshot.chapterId,
            revision: snapshot.revision,
            title: snapshot.title,
            content: snapshot.content,
          },
          activeDocumentId: activeChapterIdRef.current,
          currentRevision: editRevision.current,
          currentTitle: titleRef.current,
          currentContent: contentRef.current,
        });
        if (stillLatest) {
          window.localStorage.removeItem(draftKey(snapshot.chapterId));
          setSaveState("saved");
        } else if (stillActive) {
          setSaveState("dirty");
        }
        props.onWorkspaceChanged();
        return updated;
      },
    );
    void operation.catch((cause) => {
      if (
        activeChapterIdRef.current === snapshot.chapterId &&
        editRevision.current === snapshot.revision
      ) {
        const error = cause instanceof Error ? cause.message : String(cause);
        setSaveState("error");
        setSaveError(error);
      }
    });
    return operation;
  }, [props]);

  useEffect(() => {
    if (saveState !== "dirty") return;
    const draft: DraftRecovery = {
      chapterId: props.chapter.id,
      baseVersion: currentVersion.current,
      title,
      content,
      updatedAt: new Date().toISOString(),
      editingSessionId: editingSessionId.current,
    };
    window.localStorage.setItem(
      draftKey(props.chapter.id),
      JSON.stringify(draft),
    );
    saveTimer.current = setTimeout(
      () => void persist().catch(() => undefined),
      850,
    );
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [content, persist, props.chapter.id, saveState, title]);

  useEffect(() => {
    void Promise.all([
      props.client.agentEngines.list(),
      props.client.agentEngines.getProjectSettings(props.projectId),
      props.client.projects.get(props.projectId),
    ])
      .then(([items, settings, project]) => {
        setEngines(items);
        setEngineKind(settings.defaultEngineKind);
        setModelId(settings.defaultModel?.modelId ?? "");
        setIntentProject(project);
      })
      .catch((cause) =>
        setNotice(cause instanceof Error ? cause.message : String(cause)),
      );
  }, [props.client, props.projectId]);

  const loadConversationDetail = useCallback(
    async (id: string) => {
      const detail = await props.client.assistantConversations.get(id);
      setConversationDetail(detail);
      setEngineKind(detail.conversation.engineKind);
      setModelId(detail.conversation.model?.modelId ?? "");
      const pendingPreview = detail.changePreviews
        .map(asChangePreview)
        .find(
          (candidate) =>
            candidate?.status === "pending" &&
            candidate.targets.some(
              (target) =>
                target.kind === "chapter" && target.id === props.chapter.id,
            ),
        );
      const candidateContent = pendingPreview
        ? proposedContent(pendingPreview)
        : undefined;
      if (pendingPreview && candidateContent) {
        setPreview(pendingPreview);
        draftAtPreview.current = contentRef.current;
        setPreviewView("original");
      }
      const running = detail.runs.find((run) =>
        [
          "created",
          "queued",
          "preparing",
          "running",
          "waiting_approval",
          "committing",
          "recoverable",
        ].includes(run.status),
      );
      if (running?.chapterId && !activeRunRef.current) {
        setActiveRun({
          taskId: running.taskId,
          runId: running.id,
          chapterId: running.chapterId,
          taskType: running.taskType,
          engineKind: running.engineKind,
          autoCommitWhenReady: false,
          originalContent:
            running.chapterId === props.chapter.id ? serverContent.current : "",
          status: running.status,
          progress: 0,
        });
        setBusy(true);
      }
      return detail;
    },
    [editor, props.chapter.id, props.client, setActiveRun],
  );

  const loadConversations = useCallback(async () => {
    const [items, archived] = await Promise.all([
      props.client.assistantConversations.list({
        surface: "novel",
        projectId: props.projectId,
      }),
      props.client.assistantConversations.list({
        surface: "novel",
        projectId: props.projectId,
        archived: true,
      }),
    ]);
    setConversations(items);
    setArchivedConversations(archived);
    const stored = window.localStorage.getItem(
      `dramaip-novel-assistant-conversation:${props.projectId}`,
    );
    const next =
      (stored && items.some((item) => item.id === stored)
        ? stored
        : undefined) ?? items[0]?.id;
    setConversationId((current) =>
      current && items.some((item) => item.id === current) ? current : next,
    );
  }, [props.client, props.projectId]);

  useEffect(() => {
    void loadConversations().catch((cause) =>
      setNotice(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [loadConversations]);

  useEffect(() => {
    if (!conversationId) {
      setConversationDetail(undefined);
      return;
    }
    window.localStorage.setItem(
      `dramaip-novel-assistant-conversation:${props.projectId}`,
      conversationId,
    );
    void loadConversationDetail(conversationId).catch((cause) =>
      setNotice(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [conversationId, loadConversationDetail, props.projectId]);

  useEffect(() => {
    const unsubscribe = props.client.events.subscribe((event) => {
      if (!event.payload || typeof event.payload !== "object") return;
      const payload = event.payload as Record<string, unknown>;
      const run = activeRunRef.current;
      if (
        event.type.startsWith("assistant_turn.") &&
        payload.sessionId === conversationId &&
        conversationId
      )
        void loadConversationDetail(conversationId).catch(() => undefined);
      if (
        [
          "agent_item.started",
          "agent_item.completed",
          "agent_item.failed",
        ].includes(event.type) &&
        typeof payload.id === "string" &&
        typeof payload.runId === "string"
      ) {
        const item = payload as unknown as AgentItem;
        setConversationDetail((current) =>
          current &&
          (current.runs.some((candidate) => candidate.id === item.runId) ||
            run?.runId === item.runId)
            ? { ...current, items: upsertAgentItem(current.items, item) }
            : current,
        );
        if (run?.runId === item.runId && item.type === "message") {
          streamTextRef.current = item.content ?? "";
          setStreamText(streamTextRef.current);
        }
      }
      if (event.type === "agent_item.delta" && payload.runId === run?.runId) {
        if (!run) return;
        if (props.chapter.id !== run.chapterId) return;
        const delta = typeof payload.delta === "string" ? payload.delta : "";
        if (!delta) return;
        streamTextRef.current += delta;
        setStreamText(streamTextRef.current);
        setConversationDetail((current) =>
          current
            ? {
                ...current,
                items: current.items.map((item) =>
                  item.id === payload.itemId
                    ? {
                        ...item,
                        content: `${item.content ?? ""}${delta}`,
                        status: "streaming",
                      }
                    : item,
                ),
              }
            : current,
        );
        return;
      }
      if (
        [
          "agent_run.completed",
          "agent_run.failed",
          "agent_run.interrupted",
        ].includes(event.type) &&
        conversationId
      )
        void loadConversationDetail(conversationId).catch(() => undefined);
      if (!run) return;
      if (event.type === "change_preview.created") {
        const candidate = payload as unknown as ChangePreview;
        if (candidate.taskId !== run.taskId) return;
        if (props.chapter.id !== run.chapterId) {
          setNotice("后台生成已经完成，请返回对应章节查看候选正文");
          setBusy(false);
          return;
        }
        void handleCompletedPreview(candidate, run);
        return;
      }
      if (event.type === "task.updated" && payload.id === run.taskId) {
        const task = payload as unknown as Task;
        const runStatus: AgentRun["status"] =
          task.status === "succeeded"
            ? "completed"
            : task.status === "canceled"
              ? "aborted"
              : task.status;
        const next = {
          ...run,
          status: runStatus,
          progress: task.progress,
          error: task.error,
        };
        setActiveRun(next);
        if (task.status === "failed" || task.status === "canceled") {
          setNotice(
            task.error ??
              "生成任务未能完成；当前编辑草稿没有变化，可从原操作重试",
          );
          setBusy(false);
        } else if (task.status === "interrupted") {
          setNotice("生成已中断；当前编辑草稿已保留，可以使用原引擎继续");
          setBusy(false);
        } else if (task.status === "succeeded") {
          if (!expectsNovelChange(run.taskType)) {
            setBusy(false);
            setActiveRun(undefined);
            if (conversationId)
              void loadConversationDetail(conversationId).catch(
                () => undefined,
              );
            return;
          }
          const candidate = previewFromTaskResult(task.result);
          if (candidate && props.chapter.id === run.chapterId)
            void handleCompletedPreview(candidate, run);
          else if (!candidate && !preview) {
            setBusy(false);
            setNotice("模型本次没有返回可采用的正文；当前编辑草稿已保留");
          }
        }
      }
    });
    return unsubscribe;
  }, [
    conversationId,
    editor,
    loadConversationDetail,
    props.chapter.id,
    props.client,
    setActiveRun,
  ]);

  const finishRun = useCallback(() => {
    if (!preview || previewView !== "candidate")
      editor?.setEditable(manualEditing, false);
    setBusy(false);
    setActiveRun(undefined);
    streamTextRef.current = "";
    setStreamText("");
  }, [editor, manualEditing, preview, previewView, setActiveRun]);

  const commitPreview = useCallback(
    async (candidate: ChangePreview, editedContent?: string) => {
      setBusy(true);
      try {
        if (previewView === "candidate") {
          const draft = contentRef.current;
          contentRef.current = draft;
          setContent(draft);
          editor?.commands.setContent(draft, false);
          editor?.setEditable(manualEditing, false);
          setPreviewView("original");
        }
        const saved = await persist();
        const target = candidate.targets.find(
          (item) => item.kind === "chapter" && item.id === props.chapter.id,
        );
        if (!target) throw new Error("候选稿没有关联当前章节。");
        const baseContent = activeRunRef.current?.originalContent;
        if (
          editedContent === undefined &&
          (saved.version !== target.baseVersion ||
            (baseContent !== undefined && saved.content !== baseContent))
        ) {
          draftAtPreview.current = saved.content;
          contentRef.current = saved.content;
          setContent(saved.content);
          editor?.commands.setContent(saved.content, false);
          setDiffOpen(true);
          setBusy(false);
          setNotice(
            "生成后正文已有新修改，请在差异窗口逐段确认；你的新增内容不会被自动覆盖",
          );
          return false;
        }
        const resolvedContent =
          editedContent ?? proposedContent(candidate) ?? "";
        if (!resolvedContent.trim())
          throw new Error("候选正文为空，无法采用。");
        let pending = candidate;
        if (saved.version !== target.baseVersion)
          pending = await props.client.changePreviews.rebase(
            candidate.id,
            { baseVersion: saved.version, content: resolvedContent },
            crypto.randomUUID(),
          );
        else if (resolvedContent !== proposedContent(candidate))
          pending = await props.client.changePreviews.updateContent(
            candidate.id,
            {
              content: resolvedContent,
            },
          );
        await props.client.changePreviews.commit(
          pending.id,
          crypto.randomUUID(),
        );
        const committedContent = proposedContent(pending) ?? resolvedContent;
        if (committedContent) {
          contentRef.current = committedContent;
          titleRef.current = saved.title;
          editRevision.current += 1;
          setContent(committedContent);
          serverContent.current = committedContent;
          editor?.commands.setContent(committedContent, false);
        }
        window.localStorage.removeItem(draftKey(props.chapter.id));
        setPreview(undefined);
        setDiffOpen(false);
        setLengthPreview(undefined);
        setNotice("正文已经保存，并创建了版本检查点");
        finishRun();
        await props.onReload();
        props.onWorkspaceChanged();
        return true;
      } catch (cause) {
        setBusy(false);
        setNotice(cause instanceof Error ? cause.message : String(cause));
        return false;
      }
    },
    [editor, finishRun, persist, previewView, props],
  );

  const handleCompletedPreview = useCallback(
    async (candidate: ChangePreview, run: ActiveRun) => {
      if (handledPreviewIds.current.has(candidate.id)) return;
      handledPreviewIds.current.add(candidate.id);
      const nextContent = proposedContent(candidate);
      if (!nextContent) {
        setNotice("模型本次没有返回正文；当前编辑草稿已保留");
        setBusy(false);
        return;
      }
      draftAtPreview.current = contentRef.current;
      setPreview(candidate);
      setPreviewView("original");
      const count = countCharacters(nextContent);
      const outsideGoal =
        count < Math.max(1, preferences.wordGoal - WORD_GOAL_TOLERANCE) ||
        count > preferences.wordGoal + WORD_GOAL_TOLERANCE;
      const completion = completedPreviewUiState(
        run.autoCommitWhenReady,
        outsideGoal,
      );
      if (completion.mode === "length-decision") {
        setLengthPreview(candidate);
        setBusy(completion.busy);
        setNotice(
          `首稿为 ${count} 字，与 ${preferences.wordGoal} 字目标相差较大`,
        );
        return;
      }
      setDiffOpen(false);
      setNotice(
        "候选正文已生成；你可以继续编辑当前草稿，再查看差异并决定是否采用",
      );
      setBusy(completion.busy);
    },
    [commitPreview, editor, preferences.wordGoal],
  );

  const selectedEngine = engines.find((item) => item.kind === engineKind);
  const canRun = selectedEngine
    ? (selectedEngine.canRun ?? selectedEngine.status === "available")
    : false;

  const ensureNovelConversation = async (): Promise<AgentSession> => {
    const requestedModel = modelId.trim() || undefined;
    const current = conversations.find((item) => item.id === conversationId);
    if (
      current?.chapterId === props.chapter.id &&
      current.projectId === props.projectId &&
      current.engineKind === engineKind &&
      (current.model?.modelId ?? undefined) === requestedModel
    )
      return current;
    const created = await props.client.assistantConversations.create({
      surface: "novel",
      projectId: props.projectId,
      chapterId: props.chapter.id,
      engineKind,
      title: `AI 写作对话 · ${props.chapter.title}`,
      ...(requestedModel ? { model: { modelId: requestedModel } } : {}),
    });
    setConversations((items) => [created, ...items]);
    setConversationId(created.id);
    setConversationDetail({
      conversation: created,
      turns: [],
      runs: [],
      items: [],
      changePreviews: [],
      providerActionPreviews: [],
    });
    return created;
  };

  const startRun = async (
    taskType: AgentTaskType,
    options?: {
      selection?: { text: string; from: number; to: number };
      prompt?: string;
    },
  ): Promise<void> => {
    setWorkspacePreferences((current) => ({
      ...current,
      rightTab: "writing",
      rightCollapsed: false,
      mode: "ai",
    }));
    setDrawerOpen(true);
    if (!canRun) {
      setNotice(
        selectedEngine?.statusMessage ?? "所选智能引擎当前不能执行写作任务",
      );
      setDrawerOpen(true);
      return;
    }
    setBusy(true);
    setNotice(undefined);
    setPreview(undefined);
    setPreviewView("candidate");
    setDiffOpen(false);
    handledPreviewIds.current.clear();
    try {
      const persisted = await persist();
      await props.client.creation.start(
        {
          projectId: props.projectId,
          operation: "chapter",
          targetId: persisted.id,
          baseVersion: persisted.version,
          engineKind,
          model: modelId.trim() ? { modelId: modelId.trim() } : undefined,
          instruction: [
            options?.prompt?.trim() ||
              [...COMMON_ACTIONS, ...ENHANCEMENT_ACTIONS].find(
                (action) => action.taskType === taskType,
              )?.instruction ||
              taskTypeLabel(taskType),
            options?.selection
              ? `仅修订选段，保留其他内容：${options.selection.text}`
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
          wordGoal: preferences.wordGoal,
          sourceIds: [],
          narrativeContextRequest,
        },
        crypto.randomUUID(),
      );
      setBusy(false);
      setNotice("创作已启动，可在 AI 创作中查看生成、检查与候选。");
    } catch (cause) {
      setBusy(false);
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const sendChatMessage = async (): Promise<void> => {
    const message = instruction.trim();
    if (!message || !canRun || activeRun) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const persisted = await persist();
      const conversation = await ensureNovelConversation();
      const started = await props.client.assistantConversations.sendMessage(
        conversation.id,
        {
          message,
          chapterId: persisted.id,
          chapterBaseVersion: persisted.version,
          ...(selectedRange ? { selection: selectedRange } : {}),
        },
      );
      setInstruction("");
      if (!started.run) {
        setBusy(false);
        setNotice(started.turn.route?.clarification ?? "请补充任务上下文");
        await loadConversationDetail(conversation.id);
        return;
      }
      setActiveRun({
        taskId: started.run.taskId,
        runId: started.run.id,
        chapterId: persisted.id,
        taskType: started.run.taskType,
        engineKind,
        autoCommitWhenReady: false,
        originalContent: persisted.content,
        status: "queued",
        progress: 0,
      });
      await loadConversationDetail(conversation.id);
    } catch (cause) {
      setBusy(false);
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const continueNext = async (prompt?: string): Promise<void> => {
    setWorkspacePreferences((current) => ({
      ...current,
      rightTab: "writing",
      rightCollapsed: false,
      mode: "ai",
    }));
    setDrawerOpen(true);
    if (!content.trim()) {
      setNotice("当前章节还没有正文，请先生成本章");
      return;
    }
    if (!canRun) {
      setNotice(
        selectedEngine?.statusMessage ?? "所选智能引擎当前不能执行写作任务",
      );
      return;
    }
    setBusy(true);
    setNotice(undefined);
    setPreview(undefined);
    setPreviewView("candidate");
    setDiffOpen(false);
    handledPreviewIds.current.clear();
    try {
      const persisted = await persist();
      const request = NarrativeContextRequestSchema.parse(
        explicitNextContext ?? {
          format: "narrative-context-v1",
          chapters: [
            {
              id: persisted.id,
              version: persisted.version,
              representation: "original",
            },
          ],
        },
      );
      const result = await props.client.novelWorkspace.continueChapter(
        props.projectId,
        {
          sourceChapterId: persisted.id,
          narrativeContextRequest: request,
          engineKind,
          ...(modelId.trim() ? { model: { modelId: modelId.trim() } } : {}),
          ...(prompt?.trim() ? { prompt: prompt.trim() } : {}),
          wordGoal: preferences.wordGoal,
          baseVersion: persisted.version,
        },
        crypto.randomUUID(),
      );
      rememberContinuedChapterContext(window.localStorage, {
        projectId: props.projectId,
        sourceChapterId: persisted.id,
        result,
        request,
      });
      await props.onReload();
      props.onSelectChapter(result.chapter.id);
      setBusy(false);
      setWorkspacePreferences((current) => ({
        ...current,
        rightTab: "writing",
        rightCollapsed: false,
      }));
      setNotice("下一章已创建，正在承接上章生成正文");
    } catch (cause) {
      setBusy(false);
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const interrupt = async (): Promise<void> => {
    if (!activeRun) return;
    try {
      await props.client.agentSessions.interrupt(activeRun.runId);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const retry = async (): Promise<void> => {
    if (!activeRun) return;
    if (activeRun.status !== "interrupted") {
      void startRun(activeRun.taskType);
      return;
    }
    try {
      const resumed = await props.client.agentSessions.resume(activeRun.runId);
      setActiveRun({ ...activeRun, status: resumed.status, error: undefined });
      setBusy(true);
      if (conversationId)
        void loadConversationDetail(conversationId).catch(() => undefined);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const showPreviewView = (view: "original" | "candidate"): void => {
    if (!preview) return;
    if (view === "candidate" && previewView === "original")
      draftAtPreview.current = contentRef.current;
    const nextContent =
      view === "original"
        ? contentRef.current
        : (proposedContent(preview) ?? "");
    setPreviewView(view);
    editor?.commands.setContent(nextContent, false);
    if (view === "original") {
      // `content` belongs to the author's draft/recovery snapshot. A candidate
      // is only an editor projection, even when the original is still dirty.
      setContent(nextContent);
      contentRef.current = nextContent;
      editor?.setEditable(manualEditing, false);
    } else editor?.setEditable(false, false);
  };

  const discardCandidate = async (regenerate = false): Promise<void> => {
    if (!preview) return;
    const taskType = activeRun?.taskType;
    setBusy(true);
    try {
      await props.client.changePreviews.discard(
        preview.id,
        crypto.randomUUID(),
      );
      const original = contentRef.current;
      editor?.commands.setContent(original, false);
      editor?.setEditable(manualEditing, false);
      setContent(original);
      setPreview(undefined);
      setDiffOpen(false);
      setPreviewView("candidate");
      finishRun();
      setNotice(
        regenerate
          ? "已放弃候选稿，正在重新生成"
          : "已放弃候选稿，当前编辑草稿保持不变",
      );
      if (regenerate && taskType) void startRun(taskType);
    } catch (cause) {
      setBusy(false);
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const restoreRecovery = (): void => {
    if (!recovery) return;
    setTitle(recovery.title);
    setContent(recovery.content);
    titleRef.current = recovery.title;
    contentRef.current = recovery.content;
    editRevision.current += 1;
    editor?.commands.setContent(recovery.content, false);
    setSaveState("recovered");
    setRecovery(undefined);
  };

  const discardRecovery = (): void => {
    window.localStorage.removeItem(draftKey(props.chapter.id));
    setRecovery(undefined);
  };

  const openVersions = async (): Promise<void> => {
    setVersionsOpen(true);
    try {
      setVersions(
        await props.client.novelWorkspace.listChapterVersions(props.chapter.id),
      );
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const restoreVersion = async (versionId: string): Promise<void> => {
    setBusy(true);
    try {
      await props.client.novelWorkspace.restoreChapterVersion(
        props.chapter.id,
        versionId,
        { baseVersion: currentVersion.current },
      );
      setVersionsOpen(false);
      await props.onReload();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const saveChapterDetails = async (): Promise<void> => {
    setBusy(true);
    try {
      const persisted = await persist();
      const updated = await props.onSaveChapter(
        props.chapter.id,
        Object.fromEntries(
          CHAPTER_DETAIL_FIELDS.map(([key]) => [
            key,
            chapterDetails[key] ?? "",
          ]),
        ) as ChapterEditablePatch,
        persisted.version,
      );
      currentVersion.current = updated.version;
      setDetailsOpen(false);
      setNotice("章节要点已经保存，后续智能写作会自动读取");
      props.onWorkspaceChanged();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const wordCount = countCharacters(content);
  const progress = Math.min(
    100,
    Math.round((wordCount / preferences.wordGoal) * 100),
  );

  const openRevision = (): void => {
    setRevisionContent(content);
    setRevisionRationale("");
    setRevisionPreview(undefined);
    setRevisionError(undefined);
    setRevisionOpen(true);
  };

  const createRevisionPreview = async (): Promise<void> => {
    setBusy(true);
    setRevisionError(undefined);
    try {
      const saved = await persist();
      const created = await props.client.revisions.create(
        {
          chapterId: saved.id,
          proposedContent: revisionContent,
          rationale: revisionRationale,
        },
        crypto.randomUUID(),
      );
      setRevisionPreview(created);
    } catch (cause) {
      setRevisionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const commitRevisionPreview = async (): Promise<void> => {
    if (!revisionPreview) return;
    setBusy(true);
    setRevisionError(undefined);
    try {
      await props.client.revisions.commit(
        revisionPreview.id,
        revisionPreview.baseVersion,
        crypto.randomUUID(),
      );
      setRevisionOpen(false);
      setRevisionPreview(undefined);
      await props.onReload();
      props.onWorkspaceChanged();
    } catch (cause) {
      setRevisionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <article className="relative flex min-w-0 flex-1 flex-col bg-surface-raised">
        <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface-raised px-4 py-2">
          <BareButton
            ref={props.directoryToggleRef}
            aria-expanded={props.directoryOpen}
            aria-controls="novel-chapter-directory"
            onClick={props.onToggleDirectory}
            className="shrink-0 rounded-md border border-line px-3 py-2 text-sm"
          >
            章节目录
          </BareButton>
          <input
            className="min-w-[160px] flex-1 border-0 bg-transparent text-lg font-semibold outline-none"
            value={title}
            aria-label="章节标题"
            onChange={(event) => {
              const value = event.target.value;
              titleRef.current = value;
              editRevision.current += 1;
              setTitle(value);
              setSaveState("dirty");
            }}
          />
          <span
            className={`text-xs ${saveState === "error" ? "text-danger-strong" : "text-muted"}`}
          >
            {saveStateLabel(saveState)}
          </span>
          <span className="text-xs tabular-nums text-muted">
            {wordCount} / {preferences.wordGoal} 字
          </span>
          <BareButton
            className="rounded-full bg-studio-dark px-4 py-2 text-sm font-medium text-white shadow-card hover:bg-rust xl:hidden"
            onClick={() => {
              setWorkspacePreferences((current) => ({
                ...current,
                rightTab: "writing",
                rightCollapsed: false,
                mode: "ai",
              }));
              setDrawerOpen(true);
            }}
          >
            智能写作
          </BareButton>
          <BareButton
            className="rounded-full border border-line bg-surface-raised px-4 py-2 text-sm text-muted hover:border-line-strong hover:text-ink"
            onClick={() => void openVersions()}
          >
            版本记录
          </BareButton>
          <BareButton
            className="rounded-full border border-line bg-surface-raised px-4 py-2 text-sm text-muted hover:border-line-strong hover:text-ink"
            onClick={() => setDetailsOpen(true)}
          >
            章节要点
          </BareButton>
          <details className="relative">
            <summary className="cursor-pointer rounded-md border border-line px-3 py-2 text-sm">
              更多操作
            </summary>
            <div className="absolute right-0 top-full z-40 w-48 space-y-2 rounded-md border border-line bg-surface p-3 shadow-float">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const next = !manualEditing;
                  setManualEditing(next);
                  editor?.setEditable(
                    next && (!preview || previewView !== "candidate"),
                    false,
                  );
                }}
              >
                {manualEditing ? "结束微调" : "微调正文"}
              </Button>
              <Button variant="secondary" size="sm" onClick={openRevision}>
                导入修改稿
              </Button>
            </div>
          </details>
          <Button
            variant="secondary"
            size="sm"
            loading={saveState === "saving"}
            disabled={previewView === "candidate"}
            onClick={() => void persist()}
          >
            保存
          </Button>
        </header>

        {recovery && (
          <div className="flex flex-wrap items-center gap-3 border-b border-warning/25 bg-warning-soft px-5 py-3 text-sm text-warning-strong">
            <span className="min-w-0 flex-1">
              发现 {new Date(recovery.updatedAt).toLocaleString("zh-CN")}{" "}
              的未保存草稿。
            </span>
            <BareButton
              className="font-medium underline"
              onClick={restoreRecovery}
            >
              恢复草稿
            </BareButton>
            <BareButton className="underline" onClick={discardRecovery}>
              使用已保存正文
            </BareButton>
          </div>
        )}
        {saveError && (
          <div className="border-b border-danger/20 bg-danger-soft px-5 py-2 text-sm text-danger-strong">
            {saveError}　
            <BareButton
              className="font-medium underline"
              onClick={() => void persist()}
            >
              重新保存
            </BareButton>
          </div>
        )}
        {preview && (
          <div className="flex flex-wrap items-center gap-2 border-b border-brand/20 bg-brand-soft/60 px-4 py-2 text-sm">
            <span className="font-medium text-brand-strong">候选稿预览</span>
            <span className="text-xs text-muted">
              正式正文保持不变；审阅后采用或提出修改要求
            </span>
            <div className="ml-auto flex rounded-lg border border-brand/20 bg-surface-raised p-1 text-xs">
              <BareButton
                className={`rounded-md px-2.5 py-1 ${previewView === "original" ? "bg-brand-soft font-medium text-brand" : "text-muted"}`}
                onClick={() => showPreviewView("original")}
              >
                原稿
              </BareButton>
              <BareButton
                className={`rounded-md px-2.5 py-1 ${previewView === "candidate" ? "bg-brand-soft font-medium text-brand" : "text-muted"}`}
                onClick={() => showPreviewView("candidate")}
              >
                候选稿
              </BareButton>
            </div>
          </div>
        )}
        {preview && intentProject && (
          <details className="shrink-0 border-b border-line bg-surface px-4 py-2">
            <summary className="cursor-pointer text-xs font-medium text-brand">
              查看作者意图与本次变更来源
            </summary>
            <div className="mt-2 max-h-72 overflow-auto">
              <CreativeIntentSummary
                project={intentProject}
                preview={preview}
                compact
              />
            </div>
          </details>
        )}
        {activeRun && !drawerOpen && (
          <BareButton
            className="flex items-center gap-3 border-b border-line bg-brand-soft px-5 py-2 text-left text-sm text-rust xl:hidden"
            onClick={() => setDrawerOpen(true)}
          >
            <span className="font-medium">
              {taskStatusLabel(activeRun.status)}
            </span>
            <span className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-md bg-surface-raised">
              <span
                className="block h-full rounded-md bg-brand transition-all"
                style={{ width: `${Math.max(3, activeRun.progress * 100)}%` }}
              />
            </span>
            <span>打开写作进度</span>
          </BareButton>
        )}

        <details className="shrink-0 border-b border-line px-4 py-2 text-sm text-muted">
          <summary className="cursor-pointer">
            阅读设置{manualEditing ? "与格式" : ""}
          </summary>
          <EditorToolbar
            editor={editor}
            preferences={preferences}
            onPreferencesChange={setPreferences}
            selectedText={selectedRange?.text}
            disabled={
              !manualEditing || Boolean(preview && previewView === "candidate")
            }
            onPolishSelection={() => {
              setWorkspacePreferences((current) => ({
                ...current,
                rightTab: "writing",
                rightCollapsed: false,
                mode: "ai",
              }));
              setDrawerOpen(true);
              if (selectedRange)
                void startRun("polish_chapter", { selection: selectedRange });
            }}
          />
        </details>
        {selectedRange && (
          <div className="shrink-0 border-b border-line bg-brand-soft px-4 py-2 text-sm">
            已选中 {selectedRange.text.length} 字，可在右侧提出修改要求。
            <BareButton
              className="ml-3 text-brand"
              onClick={() => {
                setDrawerOpen(true);
                setWorkspacePreferences((value) => ({
                  ...value,
                  rightTab: "writing",
                  rightCollapsed: false,
                }));
              }}
            >
              向 AI 提出修改
            </BareButton>
          </div>
        )}
        <div
          ref={scrollRef}
          className="studio-scrollbar min-h-0 flex-1 overflow-auto overscroll-contain bg-page"
        >
          <div
            className="novel-tiptap mx-auto my-8 min-h-[calc(100%-4rem)] rounded-xl border border-line bg-field shadow-card"
            style={{
              maxWidth: preferences.contentWidth,
              fontSize: preferences.fontSize,
              lineHeight: preferences.lineHeight,
            }}
          >
            <EditorContent editor={editor} />
          </div>
        </div>
        <footer className="flex items-center gap-3 border-t border-line px-5 py-2 text-xs text-muted">
          <span>实时字数 {wordCount}</span>
          <span className="h-1.5 max-w-56 flex-1 rounded-md bg-surface-muted">
            <span
              className="block h-full rounded-md bg-brand"
              style={{ width: `${progress}%` }}
            />
          </span>
          <span>
            建议范围 {Math.max(1, preferences.wordGoal - WORD_GOAL_TOLERANCE)}–
            {preferences.wordGoal + WORD_GOAL_TOLERANCE} 字
          </span>
        </footer>

        {preview && diffOpen && (
          <DiffDialog
            before={draftAtPreview.current}
            after={proposedContent(preview) ?? ""}
            rationale={preview.rationale}
            busy={busy}
            onCancel={() => {
              setDiffOpen(false);
              showPreviewView("candidate");
            }}
            onAdopt={(value) => void commitPreview(preview, value)}
          />
        )}

        {lengthPreview && (
          <LengthDialog
            wordGoal={preferences.wordGoal}
            actual={countCharacters(proposedContent(lengthPreview) ?? "")}
            busy={busy}
            onKeep={() => void commitPreview(lengthPreview)}
            onDiscard={() => {
              setBusy(true);
              void props.client.changePreviews
                .discard(lengthPreview.id, crypto.randomUUID())
                .then(() => {
                  editor?.commands.setContent(draftAtPreview.current, false);
                  contentRef.current = draftAtPreview.current;
                  setContent(draftAtPreview.current);
                  setLengthPreview(undefined);
                  setPreview(undefined);
                  finishRun();
                })
                .catch((cause) => {
                  setBusy(false);
                  setNotice(
                    cause instanceof Error ? cause.message : String(cause),
                  );
                });
            }}
            onAdjust={() => {
              const candidate = proposedContent(lengthPreview) ?? "";
              setBusy(true);
              void props.client.changePreviews
                .discard(lengthPreview.id, crypto.randomUUID())
                .then(() => {
                  setLengthPreview(undefined);
                  setPreview(undefined);
                  finishRun();
                  void startRun("generate_chapter", {
                    prompt: [
                      instruction,
                      `请将下面首稿调整到约 ${preferences.wordGoal} 字，保留情节、人物和结尾钩子，只返回调整后的完整正文：`,
                      candidate,
                    ]
                      .filter(Boolean)
                      .join("\n\n"),
                  });
                })
                .catch((cause) => {
                  setBusy(false);
                  setNotice(
                    cause instanceof Error ? cause.message : String(cause),
                  );
                });
            }}
          />
        )}

        {versionsOpen && (
          <VersionsDialog
            versions={versions}
            busy={busy}
            onClose={() => setVersionsOpen(false)}
            onRestore={(id) => void restoreVersion(id)}
          />
        )}
        {detailsOpen && (
          <ChapterDetailsDialog
            values={chapterDetails}
            busy={busy}
            onChange={(key, value) =>
              setChapterDetails((current) => ({ ...current, [key]: value }))
            }
            onClose={() => setDetailsOpen(false)}
            onSave={() => void saveChapterDetails()}
            onDelete={() => void props.onRemoveChapter(props.chapter)}
          />
        )}
        <Dialog open={revisionOpen} onOpenChange={setRevisionOpen}>
          <Dialog.Content className="max-w-3xl">
            <div className="space-y-1.5">
              <Dialog.Title>受控修订预览</Dialog.Title>
              <Dialog.Description>
                候选内容会先保存为可审阅预览，确认后才写入正文并建立版本记录。
              </Dialog.Description>
            </div>
            <div className="space-y-3">
              <Textarea
                className="min-h-72 font-editor leading-7"
                aria-label="候选修订正文"
                value={revisionContent}
                disabled={Boolean(revisionPreview) || busy}
                onChange={(event) => setRevisionContent(event.target.value)}
              />
              <Textarea
                className="min-h-20"
                aria-label="修订依据"
                placeholder="修订依据（可选）"
                value={revisionRationale}
                disabled={Boolean(revisionPreview) || busy}
                onChange={(event) => setRevisionRationale(event.target.value)}
              />
              {revisionPreview && (
                <div className="grid gap-3 rounded-lg border border-line bg-surface-muted p-3 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium text-muted">当前正文</p>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-editor text-sm">
                      {content}
                    </pre>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-brand-strong">
                      候选修订
                    </p>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-editor text-sm">
                      {revisionPreview.proposedContent}
                    </pre>
                  </div>
                </div>
              )}
              {revisionError && (
                <p className="text-sm text-danger">{revisionError}</p>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setRevisionOpen(false)}
              >
                取消
              </Button>
              {revisionPreview ? (
                <Button
                  variant="primary"
                  loading={busy}
                  onClick={() => void commitRevisionPreview()}
                >
                  确认提交修订
                </Button>
              ) : (
                <Button
                  variant="primary"
                  loading={busy}
                  disabled={!revisionContent.trim()}
                  onClick={() => void createRevisionPreview()}
                >
                  保存预览
                </Button>
              )}
            </div>
          </Dialog.Content>
        </Dialog>
      </article>
      <aside
        className={`${drawerOpen ? "flex" : "hidden"} absolute inset-y-0 right-0 z-20 w-[min(640px,94%)] shrink-0 flex-col border-l border-line bg-canvas shadow-float xl:relative xl:inset-auto xl:z-auto xl:flex xl:shadow-none ${workspacePreferences.rightCollapsed ? "xl:w-14" : "xl:w-[var(--novel-right-width)]"}`}
        style={
          {
            "--novel-right-width": `${workspacePreferences.rightWidth}px`,
          } as CSSProperties
        }
        aria-label="章节辅助栏"
      >
        {workspacePreferences.rightCollapsed && (
          <div className="hidden h-full flex-col items-center gap-3 py-3 xl:flex">
            <BareButton
              className="rounded-lg bg-studio-dark px-2 py-3 text-xs font-medium text-white [writing-mode:vertical-rl]"
              onClick={() =>
                setWorkspacePreferences((current) => ({
                  ...current,
                  rightCollapsed: false,
                  rightTab: "writing",
                  mode: "ai",
                }))
              }
            >
              智能写作
            </BareButton>
            <BareButton
              className="rounded-lg px-2 py-3 text-xs text-muted [writing-mode:vertical-rl] hover:bg-surface-muted"
              onClick={() =>
                setWorkspacePreferences((current) => ({
                  ...current,
                  rightTab: "story-bible",
                  rightCollapsed: false,
                  mode: "context",
                }))
              }
            >
              故事圣经
            </BareButton>
          </div>
        )}
        <div
          className={`min-h-0 flex-1 flex-col ${workspacePreferences.rightCollapsed ? "flex xl:hidden" : "flex"}`}
        >
          <header className="flex shrink-0 items-center gap-1 border-b border-line bg-surface-raised/90 p-2 backdrop-blur-xl">
            {(
              [
                ["writing", "AI 创作"],
                ["conversations", "对话"],
                ["story-bible", "资料"],
              ] as const
            ).map(([tab, label]) => (
              <BareButton
                key={tab}
                className={`rounded-md px-2.5 py-2 text-sm ${workspacePreferences.rightTab === tab ? "bg-brand-soft font-medium text-brand-strong" : "text-muted hover:bg-surface-muted"}`}
                onClick={() =>
                  setWorkspacePreferences((current) => ({
                    ...current,
                    rightTab: tab,
                    rightCollapsed: false,
                    mode: tab === "story-bible" ? "context" : "ai",
                  }))
                }
              >
                {label}
              </BareButton>
            ))}
            <div className="ml-auto hidden items-center gap-0.5 xl:flex">
              <BareButton
                aria-label="缩窄右栏"
                className="rounded-md px-2 py-1.5 text-muted hover:bg-surface-muted"
                disabled={
                  workspacePreferences.rightWidth <= MIN_RIGHT_PANEL_WIDTH
                }
                onClick={() =>
                  setWorkspacePreferences((current) => ({
                    ...current,
                    rightWidth: Math.max(
                      MIN_RIGHT_PANEL_WIDTH,
                      current.rightWidth - 20,
                    ),
                  }))
                }
              >
                −
              </BareButton>
              <BareButton
                aria-label="加宽右栏"
                className="rounded-md px-2 py-1.5 text-muted hover:bg-surface-muted"
                disabled={
                  workspacePreferences.rightWidth >= MAX_RIGHT_PANEL_WIDTH
                }
                onClick={() =>
                  setWorkspacePreferences((current) => ({
                    ...current,
                    rightWidth: Math.min(
                      MAX_RIGHT_PANEL_WIDTH,
                      current.rightWidth + 20,
                    ),
                  }))
                }
              >
                ＋
              </BareButton>
              <BareButton
                className="rounded-md px-2 py-1.5 text-xs text-muted hover:bg-surface-muted"
                onClick={() =>
                  setWorkspacePreferences((current) => ({
                    ...current,
                    rightCollapsed: true,
                    mode: "ai",
                  }))
                }
              >
                折叠
              </BareButton>
            </div>
            <BareButton
              className="ml-auto rounded-md px-2 py-1.5 text-sm text-muted hover:bg-surface-muted xl:hidden"
              aria-label="关闭章节辅助栏"
              onClick={() => setDrawerOpen(false)}
            >
              关闭
            </BareButton>
          </header>
          <div className="min-h-0 flex-1 overflow-hidden">
            {workspacePreferences.rightTab === "writing" ? (
              <div className="flex h-full min-h-0 flex-col">
                {notice && (
                  <p
                    role="status"
                    className="shrink-0 rounded-md bg-surface-muted p-3 text-sm"
                  >
                    {notice}
                  </p>
                )}
                <CreationWorkbench
                  key={props.chapter.id}
                  projectId={props.projectId}
                  targetId={props.chapter.id}
                  operation="chapter"
                  baseVersion={props.chapter.version}
                  narrativeContextRequest={narrativeContextRequest}
                  wordGoal={preferences.wordGoal}
                  selectedText={selectedRange?.text}
                  docked
                  disabled={busy || engines.length === 0}
                  engineKind={engineKind}
                  model={
                    modelId.trim() ? { modelId: modelId.trim() } : undefined
                  }
                  renderQuickActions={({
                    disabled,
                    instruction: creationInstruction,
                    start,
                  }) => (
                    <>
                      <ChapterCreationActions
                        hasContent={Boolean(content.trim())}
                        selectedText={selectedRange?.text}
                        disabled={disabled || Boolean(preview)}
                        onRun={start}
                        onContinueNext={() =>
                          void continueNext(creationInstruction)
                        }
                      />
                      <WritingSettings
                        engines={engines}
                        engineKind={engineKind}
                        modelId={modelId}
                        wordGoal={preferences.wordGoal}
                        disabled={disabled}
                        onEngineChange={setEngineKind}
                        onModelChange={setModelId}
                        onWordGoalChange={(wordGoal) =>
                          setPreferences((current) => ({
                            ...current,
                            wordGoal,
                          }))
                        }
                      />
                      <NovelContextPicker
                        target={props.chapter}
                        chapters={props.chapters}
                        request={narrativeContextRequest}
                        disabled={disabled}
                        onChange={updateContext}
                      />
                      {props.chapter.content.trim() && (
                        <NovelContextPicker
                          target={props.chapter}
                          includeTarget
                          chapters={props.chapters}
                          request={nextContextRequest}
                          disabled={disabled}
                          onChange={updateNextContext}
                        />
                      )}
                    </>
                  )}
                  onPrepare={async () => (await persist()).version}
                  onCandidate={(_workflow, candidate) => {
                    if (
                      candidate.targets.some(
                        (target) => target.id === props.chapter.id,
                      )
                    ) {
                      draftAtPreview.current = contentRef.current;
                      setPreview(candidate);
                      setPreviewView("candidate");
                      editor?.commands.setContent(
                        proposedContent(candidate) ?? "",
                        false,
                      );
                      // Tiptap's editable toggle emits `update` by default.
                      // Previewing is not a draft edit: never feed a candidate
                      // into autosave or persist() before explicit adoption.
                      editor?.setEditable(false, false);
                    }
                  }}
                  onDiscarded={(candidate) => {
                    if (preview?.id !== candidate.id) return;
                    const draft = contentRef.current;
                    editor?.commands.setContent(draft, false);
                    editor?.setEditable(manualEditing, false);
                    setContent(draft);
                    setPreview(undefined);
                    setPreviewView("original");
                    setDiffOpen(false);
                    setLengthPreview(undefined);
                    setNotice("已放弃候选稿，当前草稿保持不变。");
                  }}
                  onAdopt={(candidate) => commitPreview(candidate)}
                  onApplied={async () => {
                    await props.onReload();
                    props.onWorkspaceChanged();
                  }}
                  onContinue={() => continueNext()}
                />
              </div>
            ) : workspacePreferences.rightTab === "conversations" ? (
              <WritingPanel
                projectId={props.projectId}
                chapterId={props.activeChapter?.id}
                engines={engines}
                selectedEngine={selectedEngine}
                engineKind={engineKind}
                modelId={modelId}
                instruction={instruction}
                selectedText={selectedRange?.text}
                busy={busy}
                activeRun={activeRun}
                notice={notice}
                streamText={streamText}
                conversations={conversations}
                archivedConversations={archivedConversations}
                conversationId={conversationId}
                conversationDetail={conversationDetail}
                preview={preview}
                onEngineChange={setEngineKind}
                onModelChange={setModelId}
                onInstructionChange={setInstruction}
                onSendMessage={() => void sendChatMessage()}
                onConversationChange={setConversationId}
                onNewConversation={() => {
                  setConversationId(undefined);
                  setConversationDetail(undefined);
                }}
                onRenameConversation={async () => {
                  if (!conversationId || !conversationDetail) return;
                  const next = window
                    .prompt(
                      "新的对话名称",
                      conversationDetail.conversation.title ?? "AI 写作对话",
                    )
                    ?.trim();
                  if (!next) return;
                  await props.client.assistantConversations.update(
                    conversationId,
                    { title: next },
                  );
                  await Promise.all([
                    loadConversationDetail(conversationId),
                    loadConversations(),
                  ]);
                }}
                onArchiveConversation={async () => {
                  if (!conversationId) return;
                  await props.client.assistantConversations.update(
                    conversationId,
                    { archived: true },
                  );
                  setConversationId(undefined);
                  setConversationDetail(undefined);
                  await loadConversations();
                }}
                onDeleteConversation={async () => {
                  if (
                    !conversationId ||
                    !(await confirmDialog(
                      "永久删除此写作对话及未采用候选稿？已采用正文和检查点不会删除。",
                    ))
                  )
                    return;
                  await props.client.assistantConversations.remove(
                    conversationId,
                  );
                  setConversationId(undefined);
                  setConversationDetail(undefined);
                  await loadConversations();
                }}
                onRestoreConversation={async (id) => {
                  await props.client.assistantConversations.update(id, {
                    archived: false,
                  });
                  await loadConversations();
                  setConversationId(id);
                }}
                onInterrupt={() => void interrupt()}
                onRetry={() => void retry()}
                onAdoptPreview={() => {
                  if (preview) void commitPreview(preview);
                }}
                onDiscardPreview={() => void discardCandidate()}
                onRegeneratePreview={() => void discardCandidate(true)}
                onOpenDiff={() => setDiffOpen(true)}
              />
            ) : (
              (props.renderStoryBibleSidecar?.({
                chapter: props.chapter,
                content,
              }) ?? (
                <p className="p-4 text-sm text-muted">
                  当前项目尚未启用 Story Bible。
                </p>
              ))
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function EditorToolbar(props: {
  editor: ReturnType<typeof useEditor>;
  preferences: EditorPreferences;
  onPreferencesChange(value: EditorPreferences): void;
  selectedText?: string;
  disabled: boolean;
  onPolishSelection(): void;
}) {
  const button = (label: string, active: boolean, onClick: () => void) => (
    <BareButton
      type="button"
      className={`rounded-md px-2 py-1 text-xs ${active ? "bg-brand-soft text-brand" : "text-muted hover:bg-surface-muted"}`}
      disabled={props.disabled}
      onClick={onClick}
    >
      {label}
    </BareButton>
  );
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface px-4 py-2.5">
      {button("加粗", Boolean(props.editor?.isActive("bold")), () =>
        props.editor?.chain().focus().toggleBold().run(),
      )}
      {button("斜体", Boolean(props.editor?.isActive("italic")), () =>
        props.editor?.chain().focus().toggleItalic().run(),
      )}
      {button(
        "标题",
        Boolean(props.editor?.isActive("heading", { level: 2 })),
        () => props.editor?.chain().focus().toggleHeading({ level: 2 }).run(),
      )}
      {button("引用", Boolean(props.editor?.isActive("blockquote")), () =>
        props.editor?.chain().focus().toggleBlockquote().run(),
      )}
      {button("列表", Boolean(props.editor?.isActive("bulletList")), () =>
        props.editor?.chain().focus().toggleBulletList().run(),
      )}
      <span className="mx-1 h-5 border-l border-line" />
      <label className="flex items-center gap-1 text-xs text-muted">
        字号
        <select
          className="rounded-md border border-line px-1 py-1"
          value={props.preferences.fontSize}
          onChange={(event) =>
            props.onPreferencesChange({
              ...props.preferences,
              fontSize: Number(
                event.target.value,
              ) as EditorPreferences["fontSize"],
            })
          }
        >
          <option value="16">小</option>
          <option value="18">中</option>
          <option value="20">大</option>
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs text-muted">
        行距
        <select
          className="rounded-md border border-line px-1 py-1"
          value={props.preferences.lineHeight}
          onChange={(event) =>
            props.onPreferencesChange({
              ...props.preferences,
              lineHeight: Number(
                event.target.value,
              ) as EditorPreferences["lineHeight"],
            })
          }
        >
          <option value="1.65">紧凑</option>
          <option value="1.85">舒适</option>
          <option value="2.05">宽松</option>
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs text-muted">
        正文宽度
        <select
          className="rounded-md border border-line px-1 py-1"
          value={props.preferences.contentWidth}
          onChange={(event) =>
            props.onPreferencesChange({
              ...props.preferences,
              contentWidth: Number(
                event.target.value,
              ) as EditorPreferences["contentWidth"],
            })
          }
        >
          <option value="680">窄</option>
          <option value="760">标准</option>
          <option value="880">宽</option>
        </select>
      </label>
      <label className="ml-auto flex items-center gap-1 text-xs text-muted">
        <input
          type="checkbox"
          checked={props.preferences.typewriterMode}
          onChange={(event) =>
            props.onPreferencesChange({
              ...props.preferences,
              typewriterMode: event.target.checked,
            })
          }
        />
        打字机滚动
      </label>
      {props.selectedText && (
        <BareButton
          className="rounded-md bg-brand-soft px-2 py-1 text-xs font-medium text-brand"
          onClick={props.onPolishSelection}
        >
          智能润色所选
        </BareButton>
      )}
    </div>
  );
}

function ChapterCreationActions(props: {
  hasContent: boolean;
  selectedText?: string;
  disabled: boolean;
  onRun(instruction: string, selectionOnly?: boolean): void;
  onContinueNext(): void;
}) {
  return (
    <div className="space-y-4" aria-label="章节创作操作">
      <p className="text-xs leading-5 text-muted">
        点选操作即可开始，AI
        会结合本章与已采用资料生成、检查，完成后由你审阅采用。
        {!props.hasContent && "先生成本章正文，再续写或强化。"}
      </p>
      <section aria-label="本章操作" className="space-y-2">
        <h3 className="text-sm font-semibold">本章操作</h3>
        <div className="grid grid-cols-2 gap-2">
          {COMMON_ACTIONS.filter((action) => action.requiresContent).map(
            (action) => (
              <BareButton
                key={action.taskType}
                aria-label={action.label}
                className="rounded-lg border border-line bg-surface-raised p-3 text-left hover:border-brand hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-40"
                disabled={props.disabled || !props.hasContent}
                onClick={() => props.onRun(action.instruction)}
              >
                <span className="block text-sm font-medium">
                  {action.label}
                </span>
                <span className="mt-1 block text-xs leading-5 text-muted">
                  {action.description}
                </span>
              </BareButton>
            ),
          )}
        </div>
        {props.selectedText && (
          <Button
            className="w-full"
            variant="secondary"
            size="sm"
            disabled={props.disabled}
            onClick={() =>
              props.onRun(
                "润色所选：改善选段的表达、对白和画面感，保留原有情节和事实。",
                true,
              )
            }
          >
            润色所选 · {props.selectedText.length} 字
          </Button>
        )}
        <Button
          className="w-full"
          variant="secondary"
          size="sm"
          disabled={props.disabled || !props.hasContent}
          onClick={props.onContinueNext}
        >
          续写下一章
        </Button>
      </section>
      <section aria-label="剧情与风格强化" className="space-y-2">
        <h3 className="text-sm font-semibold">剧情与风格强化</h3>
        <div className="grid grid-cols-2 gap-2">
          {ENHANCEMENT_ACTIONS.map((action) => (
            <BareButton
              key={action.taskType}
              title={action.description}
              className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-left text-xs hover:border-brand hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-40"
              disabled={props.disabled || !props.hasContent}
              onClick={() => props.onRun(action.instruction)}
            >
              {action.label}
            </BareButton>
          ))}
        </div>
      </section>
    </div>
  );
}

function WritingSettings(props: {
  engines: AgentEngineDescriptor[];
  engineKind: AgentEngineKind;
  modelId: string;
  disabled: boolean;
  wordGoal?: number;
  onEngineChange(value: AgentEngineKind): void;
  onModelChange(value: string): void;
  onWordGoalChange?(value: number): void;
}) {
  return (
    <details className="rounded-xl border border-line bg-surface-raised p-4 shadow-card">
      <summary className="cursor-pointer text-sm font-medium">
        {props.onWordGoalChange ? "创作设置" : "对话设置"}
      </summary>
      <div className="mt-3 space-y-3">
        <label className="grid gap-1 text-xs text-muted">
          智能引擎
          <select
            className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
            value={props.engineKind}
            disabled={props.disabled}
            onChange={(event) =>
              props.onEngineChange(event.target.value as AgentEngineKind)
            }
          >
            {props.engines.map((engine) => (
              <option
                key={engine.kind}
                value={engine.kind}
                disabled={engine.canRun === false}
              >
                {engine.name} · {engineStatusLabel(engine)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted">
          本次模型（留空使用项目默认模型）
          <select
            className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
            value={props.modelId}
            disabled={props.disabled}
            onChange={(event) => props.onModelChange(event.target.value)}
          >
            <option value="">使用项目默认模型</option>
            {props.modelId &&
              !MODEL_PROVIDER_CATALOG.some((provider) =>
                provider.models.some((model) => model.id === props.modelId),
              ) && (
                <option value={props.modelId}>
                  当前自定义模型：{props.modelId}
                </option>
              )}
            {MODEL_PROVIDER_CATALOG.map((provider) => (
              <optgroup key={provider.id} label={provider.name}>
                {provider.models.map((model) => (
                  <option key={`${provider.id}:${model.id}`} value={model.id}>
                    {model.label}
                    {model.recommended ? "（推荐）" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {props.onWordGoalChange && (
          <label className="grid gap-1 text-xs text-muted">
            目标字数
            <input
              className="rounded-lg border border-line px-3 py-2 text-sm text-ink"
              type="number"
              min={300}
              max={20_000}
              value={props.wordGoal}
              disabled={props.disabled}
              onChange={(event) =>
                props.onWordGoalChange?.(
                  Math.min(
                    20_000,
                    Math.max(
                      300,
                      Number(event.target.value) || DEFAULT_WORD_GOAL,
                    ),
                  ),
                )
              }
            />
          </label>
        )}
      </div>
    </details>
  );
}

function WritingPanel(props: {
  projectId: string;
  chapterId?: string;
  engines: AgentEngineDescriptor[];
  selectedEngine?: AgentEngineDescriptor;
  engineKind: AgentEngineKind;
  modelId: string;
  instruction: string;
  selectedText?: string;
  busy: boolean;
  activeRun?: ActiveRun;
  notice?: string;
  streamText: string;
  conversations: AgentSession[];
  archivedConversations: AgentSession[];
  conversationId?: string;
  conversationDetail?: AssistantConversationDetail;
  preview?: ChangePreview;
  onEngineChange(value: AgentEngineKind): void;
  onModelChange(value: string): void;
  onInstructionChange(value: string): void;
  onSendMessage(): void;
  onConversationChange(value: string): void;
  onNewConversation(): void;
  onRenameConversation(): void;
  onArchiveConversation(): void;
  onDeleteConversation(): void;
  onRestoreConversation(id: string): void;
  onInterrupt(): void;
  onRetry(): void;
  onAdoptPreview(): void;
  onDiscardPreview(): void;
  onRegeneratePreview(): void;
  onOpenDiff(): void;
}) {
  const runnable = props.selectedEngine
    ? (props.selectedEngine.canRun ??
      props.selectedEngine.status === "available")
    : false;
  const locked = props.busy || Boolean(props.preview);
  const assistantScroll = useAssistantAutoScroll(
    props.conversationDetail,
    props.conversationId,
  );
  return (
    <div
      ref={assistantScroll.scrollRef}
      className="studio-scrollbar h-full space-y-4 overflow-y-auto p-4"
      aria-label="章节对话"
      onScroll={assistantScroll.onScroll}
    >
      <div>
        <p className="studio-eyebrow">章节对话</p>
        <p className="mt-1 text-xs text-muted">
          {props.selectedEngine?.name ?? "尚未选择引擎"} ·{" "}
          {props.selectedEngine
            ? engineStatusLabel(props.selectedEngine)
            : "未配置"}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <select
          aria-label="AI 写作对话"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface-raised px-2 py-2 text-xs text-ink"
          value={props.conversationId ?? ""}
          disabled={props.busy}
          onChange={(event) => props.onConversationChange(event.target.value)}
        >
          <option value="">新对话（发送时创建）</option>
          {props.conversations.map((conversation) => (
            <option key={conversation.id} value={conversation.id}>
              {conversation.title ?? "未命名对话"} · {conversation.engineKind}
            </option>
          ))}
        </select>
        <BareButton
          className="shrink-0 rounded-lg border border-line px-2 py-2 text-xs hover:border-brand hover:text-brand"
          disabled={props.busy}
          onClick={props.onNewConversation}
        >
          新建
        </BareButton>
        {props.conversationId && (
          <details className="relative shrink-0 text-xs text-muted">
            <summary className="cursor-pointer rounded-lg border border-line px-2 py-2">
              管理
            </summary>
            <div className="absolute right-0 z-10 mt-1 grid w-24 gap-1 rounded-lg border border-line bg-surface-raised p-1 shadow-card">
              <BareButton
                className="rounded px-2 py-1 text-left hover:bg-surface-muted"
                onClick={props.onRenameConversation}
              >
                重命名
              </BareButton>
              <BareButton
                className="rounded px-2 py-1 text-left hover:bg-surface-muted"
                onClick={props.onArchiveConversation}
              >
                归档
              </BareButton>
              <BareButton
                className="rounded px-2 py-1 text-left text-danger-strong hover:bg-surface-muted"
                onClick={props.onDeleteConversation}
              >
                删除
              </BareButton>
            </div>
          </details>
        )}
      </div>
      {!!props.archivedConversations.length && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">
            已归档写作对话（{props.archivedConversations.length}）
          </summary>
          <div className="mt-2 space-y-1">
            {props.archivedConversations.map((conversation) => (
              <div
                key={conversation.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-surface-muted px-2 py-1.5"
              >
                <span className="truncate">{conversation.title}</span>
                <BareButton
                  className="text-brand"
                  onClick={() => props.onRestoreConversation(conversation.id)}
                >
                  恢复
                </BareButton>
              </div>
            ))}
          </div>
        </details>
      )}
      <AssistantConversationTimeline detail={props.conversationDetail} />
      {props.preview && (
        <section className="rounded-xl border border-brand/25 bg-brand-soft/60 p-4 shadow-card">
          <p className="text-sm font-semibold text-brand-strong">
            候选正文已就绪
          </p>
          <p className="mt-1 text-xs leading-5 text-muted">
            正文区正在只读预览，只有确认采用后才会覆盖原稿。
          </p>
          <ChapterPreviewRevisionPanel
            projectId={props.preview.projectId}
            previewId={props.preview.id}
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              variant="primary"
              size="sm"
              loading={props.busy}
              onClick={props.onAdoptPreview}
            >
              确认采用
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={props.busy}
              onClick={props.onDiscardPreview}
            >
              放弃候选
            </Button>
            <BareButton
              className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-xs hover:border-brand hover:text-brand disabled:opacity-40"
              disabled={props.busy}
              onClick={props.onRegeneratePreview}
            >
              重新生成
            </BareButton>
            <BareButton
              className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-xs hover:border-brand hover:text-brand disabled:opacity-40"
              disabled={props.busy}
              onClick={props.onOpenDiff}
            >
              查看详细差异
            </BareButton>
          </div>
        </section>
      )}
      <div ref={assistantScroll.endRef} aria-hidden="true" />
      {!runnable && (
        <div className="rounded-xl border border-warning/25 bg-warning-soft p-3 text-sm text-warning-strong">
          <p>
            {props.selectedEngine?.statusMessage ?? "当前引擎尚不能启动任务"}
          </p>
          {props.selectedEngine?.lastFailure?.message && (
            <p className="mt-1 text-xs">
              最近原因：{props.selectedEngine.lastFailure.message}
            </p>
          )}
          <AiSettingsLink
            actionId="novel-chapter:conversation"
            projectId={props.projectId}
            chapterId={props.chapterId}
            input={props.instruction}
            className="mt-2 inline-block font-medium underline"
          >
            前往模型服务商设置
          </AiSettingsLink>
        </div>
      )}
      <WritingSettings
        engines={props.engines}
        engineKind={props.engineKind}
        modelId={props.modelId}
        disabled={locked}
        onEngineChange={props.onEngineChange}
        onModelChange={props.onModelChange}
      />
      {props.activeRun && (
        <section className="rounded-xl border border-line bg-brand-soft/60 p-4">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium">
              {taskStatusLabel(props.activeRun.status)}
            </span>
            <span className="text-xs text-muted">
              {Math.round(props.activeRun.progress * 100)}%
            </span>
          </div>
          <div className="mt-2 h-1.5 rounded-md bg-surface-raised">
            <div
              className="h-full rounded-md bg-brand"
              style={{
                width: `${Math.max(3, props.activeRun.progress * 100)}%`,
              }}
            />
          </div>
          {props.streamText && (
            <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-raised p-3 font-editor text-xs leading-6 text-muted">
              {props.streamText}
            </pre>
          )}
          <div className="mt-3 flex gap-2">
            {[
              "created",
              "queued",
              "preparing",
              "running",
              "waiting_approval",
              "committing",
            ].includes(props.activeRun.status) && (
              <BareButton
                className="rounded-lg border border-danger/25 px-3 py-1.5 text-xs text-danger-strong"
                onClick={props.onInterrupt}
              >
                中断生成
              </BareButton>
            )}
            {[
              "failed",
              "aborted",
              "interrupted",
              "orphaned",
              "recoverable",
            ].includes(props.activeRun.status) && (
              <BareButton
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white"
                onClick={props.onRetry}
              >
                {props.activeRun.status === "interrupted"
                  ? "从检查点恢复"
                  : "使用原引擎重试"}
              </BareButton>
            )}
            <Link
              className="ml-auto self-center text-xs text-brand underline"
              to="/tasks"
            >
              查看任务详情
            </Link>
          </div>
        </section>
      )}
      {props.notice && (
        <p className="rounded-xl bg-surface-muted p-3 text-sm leading-6 text-muted">
          {props.notice}
        </p>
      )}
      <div className="sticky bottom-0 rounded-xl border border-line bg-surface-raised p-2 shadow-card">
        <textarea
          aria-label="给 AI 写作助手发消息"
          className="min-h-20 w-full resize-none bg-transparent p-2 text-sm leading-6 text-ink outline-none"
          value={props.instruction}
          disabled={Boolean(props.preview)}
          onChange={(event) => props.onInstructionChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              if (props.activeRun) props.onInterrupt();
              else props.onSendMessage();
            }
          }}
          placeholder="直接聊天或交代任务。Enter 发送，Shift+Enter 换行。"
        />
        <div className="flex items-center justify-between gap-2 border-t border-line px-2 pt-2">
          <span className="text-xs text-muted">
            本轮会带入当前章节{props.selectedText ? "和选区" : ""}
          </span>
          <Button
            variant="primary"
            size="sm"
            disabled={!props.instruction.trim() && !props.activeRun}
            onClick={props.activeRun ? props.onInterrupt : props.onSendMessage}
          >
            {props.activeRun ? "停止" : "发送"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AssistantConversationTimeline(props: {
  detail?: AssistantConversationDetail;
}) {
  if (!props.detail?.turns.length)
    return (
      <div
        className="rounded-xl border border-dashed border-line p-4 text-xs leading-5 text-muted"
        aria-label="AI 写作消息时间线"
      >
        可以直接问剧情、讨论人物，也可以说“续写本章”或“润色这一段”。执行过程会在这里实时显示。
      </div>
    );
  return (
    <div className="space-y-3" aria-label="AI 写作消息时间线">
      {props.detail.turns.map((turn) => {
        const run = props.detail?.runs.find((item) => item.id === turn.runId);
        const items = run
          ? (props.detail?.items.filter((item) => item.runId === run.id) ?? [])
          : [];
        return (
          <article key={turn.id} className="space-y-2">
            <div className="ml-7 rounded-xl rounded-tr-sm bg-studio-dark px-3 py-2 text-sm leading-6 text-white">
              <p className="whitespace-pre-wrap">{turn.userMessage}</p>
              <p className="mt-1 text-xs text-white/60">
                {turn.chapterId
                  ? `章节 ${turn.chapterId.slice(0, 8)}`
                  : "通用上下文"}
                {turn.selection ? " · 含选区" : ""}
                {turn.routingInputTokens !== undefined
                  ? ` · 意图识别 ${turn.routingInputTokens + (turn.routingOutputTokens ?? 0)} Token`
                  : ""}
              </p>
            </div>
            {turn.route?.kind === "clarify" && (
              <p className="mr-7 rounded-xl rounded-tl-sm bg-surface-muted px-3 py-2 text-sm leading-6">
                {turn.route.clarification}
              </p>
            )}
            {turn.status === "routing" && !run && (
              <p className="flex items-center gap-2 text-xs text-muted">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
                正在理解你的要求
              </p>
            )}
            <AssistantStageSummary
              items={items}
              active={Boolean(
                run &&
                [
                  "created",
                  "queued",
                  "preparing",
                  "running",
                  "waiting_approval",
                  "committing",
                ].includes(run.status),
              )}
            />
            {items.map((item) => (
              <AssistantTimelineItem key={item.id} item={item} />
            ))}
            {run &&
              [
                "created",
                "queued",
                "preparing",
                "running",
                "waiting_approval",
                "committing",
              ].includes(run.status) &&
              !items.length && (
                <p className="text-xs text-muted">正在建立实时连接…</p>
              )}
          </article>
        );
      })}
    </div>
  );
}

function AssistantTimelineItem(props: { item: AgentItem }) {
  if (props.item.type === "stage") return null;
  if (props.item.type === "tool_call")
    return <AssistantToolActivity item={props.item} />;
  if (!["message", "structured_output", "error"].includes(props.item.type))
    return null;
  return (
    <div className="mr-7 rounded-xl rounded-tl-sm border border-line bg-surface-raised px-3 py-2 text-sm leading-6 shadow-card">
      <AssistantMessageContent content={props.item.content} />
      {props.item.status === "streaming" && (
        <span className="mt-1 inline-block h-3 w-1 animate-pulse bg-brand" />
      )}
    </div>
  );
}

function DiffDialog(props: {
  before: string;
  after: string;
  rationale: string;
  busy: boolean;
  onCancel(): void;
  onAdopt(content: string): void;
}) {
  const blocks = useMemo(
    () => buildSegmentedTextDiff(props.before, props.after),
    [props.after, props.before],
  );
  const [mode, setMode] = useState<"inline" | "split" | "final">("inline");
  const [selected, setSelected] = useState(
    () => new Set(changedBlockIds(blocks)),
  );
  const [finalContent, setFinalContent] = useState(props.after);
  const selectedContent = useMemo(
    () => selectedText(blocks, selected),
    [blocks, selected],
  );
  useEffect(() => {
    if (mode !== "final") setFinalContent(selectedContent);
  }, [mode, selectedContent]);
  const blockClass = (block: SegmentedDiffBlock) =>
    block.kind === "add"
      ? "border-success/25 bg-success-soft"
      : block.kind === "remove"
        ? "border-danger/25 bg-danger-soft"
        : block.kind === "replace"
          ? "border-warning/25 bg-warning-soft"
          : "border-transparent";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onCancel();
      }}
    >
      <Dialog.Content
        aria-label="章节差异预览"
        className="flex max-h-[90vh] max-w-6xl flex-col overflow-hidden p-0"
        hideClose
      >
        <header className="flex flex-wrap items-start gap-3 border-b border-line p-5">
          <div className="min-w-0 flex-1">
            <Dialog.Title>章节差异预览</Dialog.Title>
            <p className="mt-1 text-sm text-muted">
              {props.rationale || "请核对候选正文，确认后才会写入正式内容。"}
            </p>
          </div>
          <div className="flex rounded-lg border border-line p-1 text-xs">
            <BareButton
              className={`rounded-md px-2 py-1 ${mode === "inline" ? "bg-brand-soft text-brand" : ""}`}
              onClick={() => setMode("inline")}
            >
              行内差异
            </BareButton>
            <BareButton
              className={`rounded-md px-2 py-1 ${mode === "split" ? "bg-brand-soft text-brand" : ""}`}
              onClick={() => setMode("split")}
            >
              左右对照
            </BareButton>
            <BareButton
              className={`rounded-md px-2 py-1 ${mode === "final" ? "bg-brand-soft text-brand" : ""}`}
              onClick={() => setMode("final")}
            >
              编辑最终稿
            </BareButton>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-5">
          {mode === "final" ? (
            <Textarea
              className="min-h-[55vh] font-editor text-sm leading-7"
              value={finalContent}
              onChange={(event) => setFinalContent(event.target.value)}
            />
          ) : mode === "split" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-medium text-muted">当前正文</p>
                <pre className="min-h-[55vh] whitespace-pre-wrap rounded-xl bg-surface-muted p-4 font-editor text-sm leading-7">
                  {props.before}
                </pre>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-brand">
                  采用后的正文
                </p>
                <pre className="min-h-[55vh] whitespace-pre-wrap rounded-xl bg-brand-soft/50 p-4 font-editor text-sm leading-7">
                  {selectedContent}
                </pre>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {blocks.map((block) => {
                const changed = block.kind !== "same";
                const adopted = !changed || selected.has(block.id);
                return (
                  <article
                    key={block.id}
                    className={`rounded-xl border p-3 ${blockClass(block)}`}
                  >
                    {changed && (
                      <label className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">
                        <input
                          type="checkbox"
                          checked={adopted}
                          onChange={() =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (next.has(block.id)) next.delete(block.id);
                              else next.add(block.id);
                              return next;
                            })
                          }
                        />
                        {adopted ? "采用此段" : "保留原段"}
                      </label>
                    )}
                    {block.before && changed && (
                      <p className="mb-2 whitespace-pre-wrap font-editor text-sm leading-7 text-danger-strong line-through">
                        {block.before}
                      </p>
                    )}
                    {(adopted ? block.after : block.before) && (
                      <p className="whitespace-pre-wrap font-editor text-sm leading-7">
                        {adopted ? block.after : block.before}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
        <footer className="flex justify-end gap-2 border-t border-line p-4">
          <Button
            variant="secondary"
            disabled={props.busy}
            onClick={props.onCancel}
          >
            返回候选稿
          </Button>
          <Button
            variant="primary"
            disabled={
              props.busy ||
              !(mode === "final" ? finalContent.trim() : selectedContent.trim())
            }
            onClick={() =>
              props.onAdopt(mode === "final" ? finalContent : selectedContent)
            }
          >
            {props.busy ? "正在应用…" : "确认应用"}
          </Button>
        </footer>
      </Dialog.Content>
    </Dialog>
  );
}

function LengthDialog(props: {
  wordGoal: number;
  actual: number;
  busy: boolean;
  onKeep(): void;
  onAdjust(): void;
  onDiscard(): void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onDiscard();
      }}
    >
      <Dialog.Content aria-label="首稿字数调整" className="max-w-lg" hideClose>
        <Dialog.Title>首稿字数与目标不一致</Dialog.Title>
        <p className="mt-3 text-sm leading-6 text-muted">
          目标约 {props.wordGoal} 字，首稿为 {props.actual}{" "}
          字。旧版的三种处理方式均已保留，你可以直接保留，也可以让智能引擎基于首稿调整。
        </p>
        <div className="mt-5 grid gap-2">
          <Button
            className="h-auto justify-start py-3.5 text-left"
            variant="primary"
            disabled={props.busy}
            onClick={props.onKeep}
          >
            保留首稿并保存
          </Button>
          <Button
            className="h-auto justify-start py-3.5 text-left"
            variant="subtle"
            disabled={props.busy}
            onClick={props.onAdjust}
          >
            基于首稿调整字数
          </Button>
          <Button
            className="h-auto justify-start py-3.5 text-left"
            variant="secondary"
            disabled={props.busy}
            onClick={props.onDiscard}
          >
            放弃首稿，恢复生成前草稿
          </Button>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}

function VersionsDialog(props: {
  versions: DomainEntity[];
  busy: boolean;
  onClose(): void;
  onRestore(id: string): void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Content
        aria-label="章节版本记录"
        className="max-h-[80vh] max-w-2xl overflow-hidden p-0"
        hideClose
      >
        <header className="flex items-center justify-between border-b border-line p-5">
          <div>
            <Dialog.Title>版本记录</Dialog.Title>
            <p className="mt-1 text-sm text-muted">
              恢复前会自动为当前正文创建新检查点。
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={props.onClose}>
            关闭
          </Button>
        </header>
        <div className="max-h-[60vh] space-y-2 overflow-auto p-5">
          {props.versions.map((version) => (
            <article
              key={version.id}
              className="flex items-center gap-3 rounded-xl border border-line p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{version.title}</p>
                <p className="mt-1 text-xs text-muted">
                  {new Date(version.createdAt).toLocaleString("zh-CN")}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={props.busy}
                onClick={() => props.onRestore(version.id)}
              >
                恢复此版本
              </Button>
            </article>
          ))}
          {!props.versions.length && (
            <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
              尚无章节版本记录。保存和智能修改后会自动建立检查点。
            </p>
          )}
        </div>
      </Dialog.Content>
    </Dialog>
  );
}

function ChapterDetailsDialog(props: {
  values: Record<string, string>;
  busy: boolean;
  onChange(key: string, value: string): void;
  onClose(): void;
  onSave(): void;
  onDelete(): void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onClose();
      }}
    >
      <Dialog.Content
        aria-label="章节要点编辑窗口"
        className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden p-0"
        hideClose
      >
        <header className="flex items-start justify-between gap-3 border-b border-line p-5">
          <div>
            <Dialog.Title>章节要点</Dialog.Title>
            <p className="mt-1 text-sm text-muted">
              这些结构化要点会和人物、全书大纲一起进入智能写作上下文。
            </p>
          </div>
          <BareButton className="text-sm text-muted" onClick={props.onClose}>
            关闭
          </BareButton>
        </header>
        <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-5 md:grid-cols-2">
          {CHAPTER_DETAIL_FIELDS.map(([key, label, placeholder], index) => (
            <label
              key={key}
              className={`grid gap-1 text-sm ${index < 2 || key === "shortDramaNote" || key === "aiVideoNote" ? "md:col-span-2" : ""}`}
            >
              {label}
              <Textarea
                className="min-h-24"
                value={props.values[key] ?? ""}
                placeholder={placeholder}
                onChange={(event) => props.onChange(key, event.target.value)}
              />
            </label>
          ))}
        </div>
        <footer className="flex gap-2 border-t border-line p-4">
          <Button
            className="mr-auto"
            variant="danger"
            disabled={props.busy}
            onClick={props.onDelete}
          >
            删除本章
          </Button>
          <Button
            variant="secondary"
            disabled={props.busy}
            onClick={props.onClose}
          >
            取消
          </Button>
          <Button
            variant="primary"
            disabled={props.busy}
            onClick={props.onSave}
          >
            {props.busy ? "正在保存…" : "保存章节要点"}
          </Button>
        </footer>
      </Dialog.Content>
    </Dialog>
  );
}

function upsertAgentItem(items: AgentItem[], next: AgentItem): AgentItem[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index < 0)
    return [...items, next].sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.sequence - right.sequence,
    );
  const updated = [...items];
  updated[index] = { ...updated[index]!, ...next };
  return updated;
}
