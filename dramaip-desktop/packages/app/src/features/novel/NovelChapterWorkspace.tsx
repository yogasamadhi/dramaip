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
  type DragEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import type { StudioClient } from "@sdns/client";
import type {
  AgentEngineDescriptor,
  AgentEngineKind,
  AgentTaskType,
  ChangePreview,
  Chapter,
  DomainEntity,
  NovelChapterStatus,
  Task,
} from "@sdns/schema";
import { MODEL_PROVIDER_CATALOG } from "@sdns/schema";
import { BareButton, Button, Dialog, Textarea } from "@sdns/ui";
import {
  buildSegmentedTextDiff,
  changedBlockIds,
  selectedText,
  type SegmentedDiffBlock,
} from "./segmented-text-diff";

const PREFERENCES_KEY = "dramaip-novel-editor-preferences-v2";
const DEFAULT_WORD_GOAL = 2_000;
const WORD_GOAL_TOLERANCE = 300;

type SaveState = "clean" | "dirty" | "saving" | "saved" | "error" | "recovered";

interface EditorPreferences {
  fontSize: 16 | 18 | 20;
  lineHeight: 1.65 | 1.85 | 2.05;
  contentWidth: 680 | 760 | 880;
  wordGoal: number;
  typewriterMode: boolean;
}

interface ActiveRun {
  taskId: string;
  runId: string;
  chapterId: string;
  taskType: AgentTaskType;
  engineKind: AgentEngineKind;
  autoCommitWhenReady: boolean;
  originalContent: string;
  status: Task["status"];
  progress: number;
  error?: string;
}

interface DraftRecovery {
  chapterId: string;
  baseVersion: number;
  title: string;
  content: string;
  updatedAt: string;
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
  primary?: boolean;
}

const COMMON_ACTIONS: readonly AiAction[] = [
  {
    taskType: "generate_chapter",
    label: "智能生成正文",
    description: "根据设定、人物与大纲直接生成完整章节",
    primary: true,
  },
  {
    taskType: "continue_chapter",
    label: "续写本章",
    description: "承接现有结尾继续写作",
    requiresContent: true,
  },
  {
    taskType: "rewrite_chapter",
    label: "改写本章",
    description: "保留剧情目标并重新组织全文",
    requiresContent: true,
  },
  {
    taskType: "polish_chapter",
    label: "润色本章",
    description: "提升表达、对白和画面感",
    requiresContent: true,
  },
  {
    taskType: "expand_chapter",
    label: "扩写本章",
    description: "补充情节、动作与情绪细节",
    requiresContent: true,
  },
];

const ENHANCEMENT_ACTIONS: readonly AiAction[] = [
  {
    taskType: "enhance_conflict",
    label: "增强冲突",
    description: "提高对抗强度",
  },
  {
    taskType: "enhance_highlight",
    label: "增强爽点",
    description: "强化情绪回报",
  },
  {
    taskType: "enhance_hook",
    label: "强化钩子",
    description: "优化开篇吸引力",
  },
  {
    taskType: "enhance_reversal",
    label: "强化反转",
    description: "增加有效意外",
  },
  {
    taskType: "enhance_cliffhanger",
    label: "强化悬念",
    description: "增强章节尾钩",
  },
  {
    taskType: "enhance_ai_drama_feel",
    label: "增强短剧感",
    description: "压缩铺垫并提高节奏",
  },
  {
    taskType: "enhance_author_style",
    label: "强化作者风格",
    description: "统一叙事语言",
  },
  {
    taskType: "rewrite_as_ai_drama_novel",
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

function taskStatusLabel(status: Task["status"]): string {
  const labels: Record<Task["status"], string> = {
    queued: "等待中",
    running: "生成中",
    succeeded: "生成完成",
    failed: "生成失败",
    canceled: "已取消",
    interrupted: "已中断",
  };
  return labels[status];
}

export function completedPreviewUiState(
  autoCommitWhenReady: boolean,
  outsideGoal: boolean,
): { mode: "length-decision" | "auto-commit" | "diff"; busy: boolean } {
  if (autoCommitWhenReady && outsideGoal)
    return { mode: "length-decision", busy: false };
  if (autoCommitWhenReady) return { mode: "auto-commit", busy: true };
  return { mode: "diff", busy: false };
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
  const searchInputRef = useRef<HTMLInputElement>(null);

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
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
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
  const visibleChapters = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return props.chapters.filter(
      (chapter) =>
        !normalized ||
        chapter.title.toLowerCase().includes(normalized) ||
        chapter.summary.toLowerCase().includes(normalized),
    );
  }, [props.chapters, query]);
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
    <section className="relative flex min-h-[720px] overflow-hidden rounded-xl border border-line bg-surface shadow-float">
      <aside className="flex w-[272px] shrink-0 flex-col border-r border-line bg-page">
        <div className="space-y-3 border-b border-line p-4">
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
                          onClick={() => props.onSelectChapter(chapter.id)}
                        >
                          <span
                            className={`block truncate text-sm font-medium ${selected ? "text-rust" : "text-ink"}`}
                          >
                            {chapter.title}
                          </span>
                          <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
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
        </div>
      </aside>
      {props.activeChapter ? (
        <NovelEditor
          {...props}
          chapter={props.activeChapter}
          onWorkspaceChanged={loadWorkspace}
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
  },
) {
  const [title, setTitle] = useState(props.chapter.title);
  const [content, setContent] = useState(props.chapter.content);
  const [preferences, setPreferences] = useState(readPreferences);
  const [saveState, setSaveState] = useState<SaveState>("clean");
  const [saveError, setSaveError] = useState<string>();
  const [recovery, setRecovery] = useState(() => readRecovery(props.chapter));
  const [selectedRange, setSelectedRange] = useState<{
    text: string;
    from: number;
    to: number;
  }>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [engines, setEngines] = useState<AgentEngineDescriptor[]>([]);
  const [engineKind, setEngineKind] = useState<AgentEngineKind>("opencode");
  const [modelId, setModelId] = useState("");
  const [activeRun, setActiveRunState] = useState<ActiveRun>();
  const [streamText, setStreamText] = useState("");
  const [notice, setNotice] = useState<string>();
  const [preview, setPreview] = useState<ChangePreview>();
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
    serverContent.current = props.chapter.content;
    serverTitle.current = props.chapter.title;
  }, [props.chapter.version, props.chapter.content, props.chapter.title]);

  useEffect(() => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  }, [preferences]);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [2, 3] } }),
        Placeholder.configure({
          placeholder: "正文可以直接编辑，也可以点击“智能写作”生成",
        }),
        Markdown.configure({
          html: false,
          transformPastedText: true,
          transformCopiedText: true,
        }),
      ],
      content: props.chapter.content,
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
        if (activeRunRef.current) return;
        const storage = editor.storage as {
          markdown?: { getMarkdown?: () => string };
        };
        const markdown = storage.markdown?.getMarkdown?.() ?? editor.getText();
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

  const persist = useCallback(async (): Promise<Chapter> => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const unchanged =
      title.trim() === serverTitle.current && content === serverContent.current;
    if (unchanged) return props.client.chapters.get(props.chapter.id);
    setSaveState("saving");
    setSaveError(undefined);
    try {
      const updated = await props.onSaveChapter(
        props.chapter.id,
        { title: title.trim() || props.chapter.title, content },
        currentVersion.current,
      );
      currentVersion.current = updated.version;
      serverContent.current = updated.content;
      serverTitle.current = updated.title;
      window.localStorage.removeItem(draftKey(props.chapter.id));
      setSaveState("saved");
      props.onWorkspaceChanged();
      return updated;
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      setSaveState("error");
      setSaveError(error);
      throw cause;
    }
  }, [content, props, title]);

  useEffect(() => {
    if (saveState !== "dirty") return;
    const draft: DraftRecovery = {
      chapterId: props.chapter.id,
      baseVersion: currentVersion.current,
      title,
      content,
      updatedAt: new Date().toISOString(),
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
    ])
      .then(([items, settings]) => {
        setEngines(items);
        setEngineKind(settings.defaultEngineKind);
        setModelId(settings.defaultModel?.modelId ?? "");
      })
      .catch((cause) =>
        setNotice(cause instanceof Error ? cause.message : String(cause)),
      );
  }, [props.client, props.projectId]);

  useEffect(() => {
    const unsubscribe = props.client.events.subscribe((event) => {
      const run = activeRunRef.current;
      if (!run || !event.payload || typeof event.payload !== "object") return;
      const payload = event.payload as Record<string, unknown>;
      if (event.type === "agent_item.delta" && payload.runId === run.runId) {
        if (props.chapter.id !== run.chapterId) return;
        const delta = typeof payload.delta === "string" ? payload.delta : "";
        if (!delta) return;
        streamTextRef.current += delta;
        setStreamText(streamTextRef.current);
        editor?.commands.setContent(streamTextRef.current, false);
        window.requestAnimationFrame(() => {
          const container = scrollRef.current;
          container?.scrollTo({
            top: container.scrollHeight,
            behavior: "smooth",
          });
        });
        return;
      }
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
        const next = {
          ...run,
          status: task.status,
          progress: task.progress,
          error: task.error,
        };
        setActiveRun(next);
        if (task.status === "failed" || task.status === "canceled") {
          editor?.commands.setContent(run.originalContent, false);
          editor?.setEditable(true);
          setContent(run.originalContent);
          setNotice(task.error ?? "生成任务未能完成，请使用相同设置重试");
          setBusy(false);
        } else if (task.status === "interrupted") {
          editor?.commands.setContent(run.originalContent, false);
          editor?.setEditable(true);
          setContent(run.originalContent);
          setNotice("生成已中断，可以使用原引擎重试");
          setBusy(false);
        } else if (task.status === "succeeded") {
          const candidate = previewFromTaskResult(task.result);
          if (candidate && props.chapter.id === run.chapterId)
            void handleCompletedPreview(candidate, run);
          else if (!candidate && !preview) {
            editor?.commands.setContent(run.originalContent, false);
            editor?.setEditable(true);
            setContent(run.originalContent);
            setBusy(false);
            setNotice("模型本次没有返回可采用的正文，可使用相同设置重试");
          }
        }
      }
    });
    return unsubscribe;
  }, [editor, props.chapter.id, props.client, setActiveRun]);

  const finishRun = useCallback(() => {
    editor?.setEditable(true);
    setBusy(false);
    setActiveRun(undefined);
    streamTextRef.current = "";
    setStreamText("");
  }, [editor, setActiveRun]);

  const commitPreview = useCallback(
    async (candidate: ChangePreview, editedContent?: string) => {
      setBusy(true);
      try {
        let pending = candidate;
        if (
          editedContent !== undefined &&
          editedContent !== proposedContent(candidate)
        )
          pending = await props.client.changePreviews.updateContent(
            candidate.id,
            {
              content: editedContent,
            },
          );
        await props.client.changePreviews.commit(
          pending.id,
          crypto.randomUUID(),
        );
        const committedContent =
          editedContent ?? proposedContent(pending) ?? "";
        if (committedContent) {
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
      } catch (cause) {
        setBusy(false);
        setNotice(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [editor, finishRun, props],
  );

  const handleCompletedPreview = useCallback(
    async (candidate: ChangePreview, run: ActiveRun) => {
      if (handledPreviewIds.current.has(candidate.id)) return;
      handledPreviewIds.current.add(candidate.id);
      const nextContent = proposedContent(candidate);
      if (!nextContent) {
        editor?.commands.setContent(run.originalContent, false);
        editor?.setEditable(true);
        setContent(run.originalContent);
        setNotice("模型本次没有返回正文，可使用相同设置重试");
        setBusy(false);
        return;
      }
      editor?.commands.setContent(nextContent, false);
      setPreview(candidate);
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
      if (completion.mode === "auto-commit") {
        await commitPreview(candidate);
        return;
      }
      setDiffOpen(true);
      setNotice("候选正文已生成，请核对差异后采用");
      setBusy(completion.busy);
      editor?.setEditable(true);
    },
    [commitPreview, editor, preferences.wordGoal],
  );

  const selectedEngine = engines.find((item) => item.kind === engineKind);
  const canRun = selectedEngine
    ? (selectedEngine.canRun ?? selectedEngine.status === "available")
    : false;

  const startRun = async (
    taskType: AgentTaskType,
    options?: {
      selection?: { text: string; from: number; to: number };
      prompt?: string;
    },
  ): Promise<void> => {
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
    setDiffOpen(false);
    handledPreviewIds.current.clear();
    try {
      const persisted = await persist();
      const original = persisted.content;
      const started = await props.client.novelWorkspace.runChapterAgent(
        persisted.id,
        {
          taskType,
          engineKind,
          ...(modelId.trim() ? { model: { modelId: modelId.trim() } } : {}),
          ...((options?.prompt ?? instruction).trim()
            ? { prompt: (options?.prompt ?? instruction).trim() }
            : {}),
          wordGoal: preferences.wordGoal,
          baseVersion: persisted.version,
          ...(options?.selection ? { selection: options.selection } : {}),
        },
        crypto.randomUUID(),
      );
      const run: ActiveRun = {
        ...started,
        taskType,
        engineKind,
        originalContent: original,
        status: "queued",
        progress: 0,
      };
      streamTextRef.current = "";
      setStreamText("");
      setActiveRun(run);
      editor?.setEditable(false);
      setNotice("正在读取设定、人物、大纲与章节上下文");
    } catch (cause) {
      setBusy(false);
      editor?.setEditable(true);
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const continueNext = async (): Promise<void> => {
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
    setDiffOpen(false);
    handledPreviewIds.current.clear();
    try {
      const persisted = await persist();
      const result = await props.client.novelWorkspace.continueChapter(
        props.projectId,
        {
          sourceChapterId: persisted.id,
          engineKind,
          ...(modelId.trim() ? { model: { modelId: modelId.trim() } } : {}),
          ...(instruction.trim() ? { prompt: instruction.trim() } : {}),
          wordGoal: preferences.wordGoal,
          baseVersion: persisted.version,
        },
        crypto.randomUUID(),
      );
      await props.onReload();
      props.onSelectChapter(result.chapter.id);
      const run: ActiveRun = {
        ...result.run,
        taskType: "generate_chapter",
        engineKind,
        originalContent: "",
        status: "queued",
        progress: 0,
      };
      streamTextRef.current = "";
      setStreamText("");
      setActiveRun(run);
      editor?.commands.setContent("", false);
      editor?.setEditable(false);
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

  const retry = (): void => {
    if (!activeRun) return;
    void startRun(activeRun.taskType);
  };

  const restoreRecovery = (): void => {
    if (!recovery) return;
    setTitle(recovery.title);
    setContent(recovery.content);
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
        <header className="flex min-h-[76px] flex-wrap items-center gap-3 border-b border-line bg-surface-raised/90 px-5 py-3 backdrop-blur-xl">
          <input
            className="min-w-[160px] flex-1 border-0 bg-transparent text-lg font-semibold outline-none"
            value={title}
            disabled={Boolean(activeRun)}
            aria-label="章节标题"
            onChange={(event) => {
              setTitle(event.target.value);
              setSaveState("dirty");
            }}
          />
          <span
            className={`text-xs ${saveState === "error" ? "text-red-600" : "text-muted"}`}
          >
            {saveStateLabel(saveState)}
          </span>
          <span className="text-xs tabular-nums text-muted">
            {wordCount} / {preferences.wordGoal} 字
          </span>
          <BareButton
            className="rounded-full bg-studio-dark px-5 py-2.5 text-sm font-medium text-white shadow-card hover:bg-rust"
            onClick={() => setDrawerOpen(true)}
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
          <Button variant="secondary" size="sm" onClick={openRevision}>
            修订预览
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={saveState === "saving"}
            disabled={Boolean(activeRun)}
            onClick={() => void persist()}
          >
            保存
          </Button>
        </header>

        {recovery && (
          <div className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
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
          <div className="border-b border-red-100 bg-red-50 px-5 py-2 text-sm text-red-700">
            {saveError}　
            <BareButton
              className="font-medium underline"
              onClick={() => void persist()}
            >
              重新保存
            </BareButton>
          </div>
        )}
        {activeRun && !drawerOpen && (
          <BareButton
            className="flex items-center gap-3 border-b border-line bg-brand-soft px-5 py-2 text-left text-sm text-rust"
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

        <EditorToolbar
          editor={editor}
          preferences={preferences}
          onPreferencesChange={setPreferences}
          selectedText={selectedRange?.text}
          disabled={Boolean(activeRun)}
          onPolishSelection={() => {
            setDrawerOpen(true);
            if (selectedRange)
              void startRun("polish_chapter", { selection: selectedRange });
          }}
        />
        <div
          ref={scrollRef}
          className="studio-scrollbar min-h-0 flex-1 overflow-auto bg-page"
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

        {drawerOpen && (
          <WritingDrawer
            engines={engines}
            selectedEngine={selectedEngine}
            engineKind={engineKind}
            modelId={modelId}
            instruction={instruction}
            hasContent={Boolean(content.trim())}
            busy={busy}
            activeRun={activeRun}
            notice={notice}
            streamText={streamText}
            wordGoal={preferences.wordGoal}
            onClose={() => setDrawerOpen(false)}
            onEngineChange={setEngineKind}
            onModelChange={setModelId}
            onInstructionChange={setInstruction}
            onWordGoalChange={(wordGoal) =>
              setPreferences((current) => ({ ...current, wordGoal }))
            }
            onRun={(taskType) => void startRun(taskType)}
            onContinueNext={() => void continueNext()}
            onInterrupt={() => void interrupt()}
            onRetry={retry}
          />
        )}

        {preview && diffOpen && (
          <DiffDialog
            before={activeRun?.originalContent ?? props.chapter.content}
            after={proposedContent(preview) ?? ""}
            rationale={preview.rationale}
            busy={busy}
            onCancel={() => {
              void props.client.changePreviews
                .discard(preview.id, crypto.randomUUID())
                .then(() => {
                  editor?.commands.setContent(
                    activeRun?.originalContent ?? props.chapter.content,
                    false,
                  );
                  setContent(
                    activeRun?.originalContent ?? props.chapter.content,
                  );
                  setDiffOpen(false);
                  setPreview(undefined);
                  finishRun();
                })
                .catch((cause) =>
                  setNotice(
                    cause instanceof Error ? cause.message : String(cause),
                  ),
                );
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
                  editor?.commands.setContent(
                    activeRun?.originalContent ?? "",
                    false,
                  );
                  setContent(activeRun?.originalContent ?? "");
                  setLengthPreview(undefined);
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
      {props.renderStoryBibleSidecar?.({ chapter: props.chapter, content })}
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

function WritingDrawer(props: {
  engines: AgentEngineDescriptor[];
  selectedEngine?: AgentEngineDescriptor;
  engineKind: AgentEngineKind;
  modelId: string;
  instruction: string;
  hasContent: boolean;
  busy: boolean;
  activeRun?: ActiveRun;
  notice?: string;
  streamText: string;
  wordGoal: number;
  onClose(): void;
  onEngineChange(value: AgentEngineKind): void;
  onModelChange(value: string): void;
  onInstructionChange(value: string): void;
  onWordGoalChange(value: number): void;
  onRun(value: AgentTaskType): void;
  onContinueNext(): void;
  onInterrupt(): void;
  onRetry(): void;
}) {
  const runnable = props.selectedEngine
    ? (props.selectedEngine.canRun ??
      props.selectedEngine.status === "available")
    : false;
  return (
    <aside
      className="absolute inset-y-0 right-0 z-20 flex w-[min(460px,94%)] flex-col border-l border-line bg-canvas shadow-float"
      aria-label="智能写作抽屉"
    >
      <header className="flex items-start gap-3 border-b border-line bg-surface-raised/85 p-5 backdrop-blur-xl">
        <div className="min-w-0 flex-1">
          <p className="studio-eyebrow">章节智能协作</p>
          <h2 className="mt-1 text-lg font-semibold">智能写作</h2>
          <p className="mt-1 text-xs text-muted">
            {props.selectedEngine?.name ?? "尚未选择引擎"} ·{" "}
            {props.selectedEngine
              ? engineStatusLabel(props.selectedEngine)
              : "未配置"}
          </p>
        </div>
        <BareButton
          className="rounded-full border border-line bg-surface-raised px-4 py-2 text-sm text-muted hover:border-line-strong hover:text-ink"
          onClick={props.onClose}
        >
          关闭
        </BareButton>
      </header>
      <div className="studio-scrollbar min-h-0 flex-1 space-y-4 overflow-auto p-5">
        {!runnable && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p>
              {props.selectedEngine?.statusMessage ?? "当前引擎尚不能启动任务"}
            </p>
            {props.selectedEngine?.lastFailure?.message && (
              <p className="mt-1 text-xs">
                最近原因：{props.selectedEngine.lastFailure.message}
              </p>
            )}
            <Link
              className="mt-2 inline-block font-medium underline"
              to="/settings"
            >
              前往模型服务商设置
            </Link>
          </div>
        )}
        <label className="grid gap-1 text-sm text-muted">
          本次写作要求（可选）
          <textarea
            className="min-h-28 rounded-xl border border-line bg-surface-raised p-4 text-sm leading-6 text-ink shadow-card"
            value={props.instruction}
            disabled={props.busy}
            onChange={(event) => props.onInstructionChange(event.target.value)}
            placeholder="例如：开篇直接进入冲突，强化女主反击，结尾留下身份揭露钩子。"
          />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          {COMMON_ACTIONS.map((action) => (
            <BareButton
              key={action.taskType}
              className={`rounded-xl border p-4 text-left shadow-card disabled:cursor-not-allowed disabled:opacity-40 ${action.primary ? "border-studio-dark bg-studio-dark text-white hover:border-rust hover:bg-rust" : "border-line bg-surface-raised hover:border-brand"}`}
              disabled={
                props.busy ||
                !runnable ||
                (action.requiresContent && !props.hasContent)
              }
              onClick={() => props.onRun(action.taskType)}
            >
              <span className="block text-sm font-semibold">
                {action.label}
              </span>
              <span
                className={`mt-1 block text-xs leading-5 ${action.primary ? "text-white/80" : "text-muted"}`}
              >
                {action.description}
              </span>
            </BareButton>
          ))}
        </div>
        <BareButton
          className="w-full rounded-full border border-rust bg-surface-raised px-4 py-2.5 text-sm font-medium text-rust hover:bg-brand-soft disabled:opacity-40"
          disabled={props.busy || !runnable || !props.hasContent}
          onClick={props.onContinueNext}
        >
          智能续写下一章
        </BareButton>
        <details className="rounded-xl border border-line bg-surface-raised p-4 shadow-card">
          <summary className="cursor-pointer text-sm font-medium">
            高级设置与强化方式
          </summary>
          <div className="mt-3 space-y-3">
            <label className="grid gap-1 text-xs text-muted">
              智能引擎
              <select
                className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
                value={props.engineKind}
                disabled={props.busy}
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
                    {engine.name}
                    {engine.isBeta ? "（测试版）" : ""} ·{" "}
                    {engineStatusLabel(engine)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-muted">
              本次模型（留空使用项目默认模型）
              <select
                className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
                value={props.modelId}
                disabled={props.busy}
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
                      <option
                        key={`${provider.id}:${model.id}`}
                        value={model.id}
                      >
                        {model.label}
                        {model.recommended ? "（推荐）" : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-muted">
              目标字数
              <input
                className="rounded-lg border border-line px-3 py-2 text-sm text-ink"
                type="number"
                min={300}
                max={20_000}
                value={props.wordGoal}
                onChange={(event) =>
                  props.onWordGoalChange(
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
            <div className="grid grid-cols-2 gap-2">
              {ENHANCEMENT_ACTIONS.map((action) => (
                <BareButton
                  key={action.taskType}
                  className="rounded-lg border border-line px-2 py-2 text-left text-xs hover:border-brand hover:text-brand disabled:opacity-40"
                  disabled={props.busy || !runnable || !props.hasContent}
                  onClick={() => props.onRun(action.taskType)}
                >
                  <span className="block font-medium">{action.label}</span>
                  <span className="mt-0.5 block text-[11px] text-muted">
                    {action.description}
                  </span>
                </BareButton>
              ))}
            </div>
          </div>
        </details>
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
              {["queued", "running"].includes(props.activeRun.status) && (
                <BareButton
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600"
                  onClick={props.onInterrupt}
                >
                  中断生成
                </BareButton>
              )}
              {["failed", "canceled", "interrupted"].includes(
                props.activeRun.status,
              ) && (
                <BareButton
                  className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white"
                  onClick={props.onRetry}
                >
                  使用原引擎重试
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
      </div>
    </aside>
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
      ? "border-emerald-200 bg-emerald-50"
      : block.kind === "remove"
        ? "border-red-200 bg-red-50"
        : block.kind === "replace"
          ? "border-amber-200 bg-amber-50"
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
                      <p className="mb-2 whitespace-pre-wrap font-editor text-sm leading-7 text-red-700 line-through">
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
            放弃候选稿
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
