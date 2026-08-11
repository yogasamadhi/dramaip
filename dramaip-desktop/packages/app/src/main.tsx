import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  StrictMode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import ReactDOM from "react-dom/client";
import {
  HashRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { createStudioClient, type StudioClient } from "@sdns/client";
import {
  defaultProductionBrief,
  projectInputFromBrief,
  type ProductionBriefDraft,
  type ProjectCreationSource,
} from "./project-intake";
import { deriveProjectCockpit } from "./project-cockpit";
import {
  buildStoryboard,
  reorderStoryboardShots,
  type StoryboardScene,
  type StoryboardShot,
} from "./storyboard-board";
import {
  buildEpisodePacingBoard,
  type PacingKind,
  type PacingPoint,
} from "./episode-pacing";
import {
  buildStoryBibleSidecar,
  type StoryBibleContext,
} from "./story-bible-sidecar";
import {
  contextAssistantPage,
  contextAssistantPreflight,
  contextAssistantProjectId,
  resolveContextAssistantActions,
} from "./context-assistant";
import {
  MODEL_PROVIDER_CATALOG,
  MODEL_PROVIDER_CATALOG_RELEASE,
  MODEL_PROVIDER_CATALOG_UPDATED_AT,
  modelProviderPreset,
  recommendedProviderModel,
  type ModelProviderPresetId,
} from "@sdns/schema";
import type {
  AgentEngineKind,
  AgentExperiment,
  AgentTaskType,
  Chapter,
  DomainEntity,
  Project,
  PilotPlan,
  SourceImportPreview,
  SourceImportStrategy,
  ImportExtractionChangeSet,
  EpisodeWorkflowKind,
  FeedbackKind,
  FeedbackPreview,
  StoryBibleChangeSet,
  ProjectPackagePreview,
  PlatformDeliveryArchive,
  PlatformDeliveryPreflight,
  DeliveryCreativeVariant,
  EpisodeCompliancePreflight,
  AudioTrack,
  AnimaticInitialization,
  CreativeCaseStudy,
  CreativeDiagnosticKind,
  ChangePreview,
  ProviderActionPreview,
  RevisionPreview,
  AssetCenterAsset,
  AssetCenterPreviewMedia,
  VideoGenerationInput,
  VideoGenerationPreflight,
} from "@sdns/schema";
import "./styles.css";

const ClientContext = createContext<StudioClient | undefined>(undefined);
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 1 } },
});

/** Internal route identifiers stay stable; no internal English identifier is shown in the UI. */
const DOMAIN_LABELS: Record<string, string> = {
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

const TASK_STATUS_LABELS: Record<string, string> = {
  queued: "等待中",
  running: "进行中",
  succeeded: "已完成",
  failed: "失败",
  canceled: "已取消",
  interrupted: "已中断",
};

const CREATIVE_DIAGNOSTIC_LABELS: Record<CreativeDiagnosticKind, string> = {
  freshness: "新鲜度",
  anti_trope: "反套路",
  quality_gate: "质量门禁",
  audience: "受众模拟",
  narrative_curve: "叙事曲线",
};

function domainLabel(domain: string): string {
  return DOMAIN_LABELS[domain] ?? "资源";
}

function searchKindLabel(kind: string): string {
  if (kind === "project") return "项目";
  if (kind === "chapter") return "章节";
  return domainLabel(kind);
}

function searchResultPath(
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

type ChapterDetailKey =
  | "outline"
  | "mainConflict"
  | "hook"
  | "highlight"
  | "reversal"
  | "cliffhanger"
  | "shortDramaNote"
  | "aiVideoNote";
type EditableChapter = Pick<
  Chapter,
  "title" | "summary" | "content" | ChapterDetailKey
>;
type EditableProject = Pick<
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

const CHAPTER_DETAIL_FIELDS: ReadonlyArray<{
  key: ChapterDetailKey;
  label: string;
  placeholder: string;
}> = [
  { key: "outline", label: "章节大纲", placeholder: "本章事件推进" },
  { key: "mainConflict", label: "核心冲突", placeholder: "本章的主要矛盾" },
  { key: "hook", label: "开场钩子", placeholder: "吸引观众继续观看的开端" },
  { key: "highlight", label: "高光时刻", placeholder: "本章最有记忆点的场面" },
  { key: "reversal", label: "反转", placeholder: "关系或信息的变化" },
  { key: "cliffhanger", label: "章节悬念", placeholder: "推动下一章的悬念" },
  {
    key: "shortDramaNote",
    label: "短剧节奏备注",
    placeholder: "节奏、时长或情绪提示",
  },
  {
    key: "aiVideoNote",
    label: "视频制作备注",
    placeholder: "画面、动作或制作限制",
  },
];

function chapterDetailDraft(
  chapter: Chapter,
): Record<ChapterDetailKey, string> {
  return Object.fromEntries(
    CHAPTER_DETAIL_FIELDS.map(({ key }) => [key, chapter[key] ?? ""]),
  ) as Record<ChapterDetailKey, string>;
}

function useStudio(): StudioClient {
  const client = useContext(ClientContext);
  if (!client) throw new Error("工作台服务尚未初始化");
  return client;
}

function AppRoot() {
  const [client, setClient] = useState<StudioClient>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    void window.desktop
      .awaitInitialization()
      .then((ready) => setClient(createStudioClient(ready)))
      .catch((cause) => setError(message(cause)));
  }, []);
  if (error)
    return (
      <StartupFailure
        error={error}
        onRetry={() => {
          setError(undefined);
          void window.desktop
            .retryInitialization()
            .then((ready) => setClient(createStudioClient(ready)))
            .catch((cause) => setError(message(cause)));
        }}
      />
    );
  if (!client)
    return (
      <div className="grid min-h-screen place-items-center bg-canvas text-muted">
        正在连接 DramaIP 本地服务…
      </div>
    );
  return (
    <ClientContext.Provider value={client}>
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <Studio />
        </HashRouter>
      </QueryClientProvider>
    </ClientContext.Provider>
  );
}

function StartupFailure(props: { error: string; onRetry(): void }) {
  return (
    <main className="grid min-h-screen place-items-center bg-canvas p-8">
      <section className="max-w-lg rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <p className="text-sm font-semibold text-brand">DramaIP 桌面版</p>
        <h1 className="mt-2 text-2xl font-semibold">本地服务未能启动</h1>
        <p className="mt-3 text-sm text-muted">{props.error}</p>
        <button
          className="mt-6 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
          onClick={props.onRetry}
        >
          重试
        </button>
      </section>
    </main>
  );
}

function Studio() {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-line bg-surface px-6">
        <Link to="/" className="font-semibold tracking-tight text-ink">
          DramaIP <span className="text-brand">创作工作台</span>
        </Link>
        <nav className="flex gap-4 text-sm text-muted">
          <Link to="/">项目</Link>
          <Link to="/create">创作</Link>
          <Link to="/adapt">改编</Link>
          <Link to="/produce">制作</Link>
          <Link to="/review">审核交付</Link>
          <Link to="/insights">数据洞察</Link>
          <Link to="/search">搜索</Link>
          <Link to="/tasks">任务</Link>
          <Link to="/settings">设置</Link>
        </nav>
      </header>
      <main className="mx-auto grid max-w-[1600px] grid-cols-[1fr_340px] gap-6 p-6">
        <section className="min-w-0">
          <Routes>
            <Route path="/" element={<ProjectHome />} />
            <Route path="/projects/:projectId" element={<ProjectWorkspace />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/create" element={<CreativeWorkspace />} />
            <Route path="/adapt" element={<AdaptationWorkspace />} />
            <Route path="/produce" element={<ProductionWorkspace />} />
            <Route path="/review" element={<ReviewDeliveryWorkspace />} />
            <Route path="/insights" element={<FeedbackPage />} />
            <Route path="/tasks" element={<TaskPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </section>
        <AgentSidePanel />
      </main>
    </div>
  );
}

function SearchPage() {
  const client = useStudio();
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [results, setResults] = useState<
    Array<{
      kind: string;
      id: string;
      title: string;
      excerpt?: string;
      projectId?: string;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const search = async () => {
    const text = query.trim();
    if (!text) return;
    setLoading(true);
    setError(undefined);
    try {
      const response = await client.search.global(text);
      setSearchedQuery(response.query);
      setResults(response.results);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setLoading(false);
    }
  };
  return (
    <section className="mx-auto max-w-4xl">
      <p className="text-sm text-muted">全局搜索</p>
      <h1 className="mt-1 text-2xl font-semibold">查找项目资料</h1>
      <p className="mt-2 text-sm text-muted">
        可搜索项目、章节和全部创作、制作、审核资料。
      </p>
      <div className="mt-5 flex gap-3 rounded-2xl border border-line bg-surface p-4">
        <input
          className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2"
          placeholder="输入项目名称、章节内容或资料关键词"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void search();
          }}
        />
        <button
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={!query.trim() || loading}
          onClick={() => void search()}
        >
          {loading ? "搜索中…" : "搜索"}
        </button>
      </div>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {searchedQuery && (
        <p className="mt-5 text-sm text-muted">
          “{searchedQuery}” 共找到 {results.length} 条结果
        </p>
      )}
      <div className="mt-3 space-y-2">
        {results.map((result) => (
          <Link
            key={`${result.kind}-${result.id}`}
            to={searchResultPath(result.kind, result.id, result.projectId)}
            className="block rounded-xl border border-line bg-surface p-4 transition hover:border-brand"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">{result.title}</p>
              <span className="rounded-full bg-brand-soft px-2 py-1 text-xs text-brand">
                {searchKindLabel(result.kind)}
              </span>
            </div>
            {result.excerpt &&
              (result.kind === "project" || result.kind === "chapter") && (
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-muted">
                  {result.excerpt}
                </p>
              )}
          </Link>
        ))}
        {searchedQuery && !results.length && (
          <p className="rounded-xl border border-dashed border-line p-8 text-sm text-muted">
            没有找到相关资料。请更换关键词后重试。
          </p>
        )}
      </div>
    </section>
  );
}

function ProjectPackageImportPanel(props: {
  onImported(project: Project): void;
}) {
  const client = useStudio();
  const [fileName, setFileName] = useState<string>();
  const [preview, setPreview] = useState<ProjectPackagePreview>();
  const [title, setTitle] = useState("");
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string>();
  const choose = async () => {
    setNotice(undefined);
    const selected = await window.desktop.pickFiles({
      multiple: false,
      extensions: ["json"],
    });
    const file = selected?.[0];
    if (!file) return;
    setWorking(true);
    try {
      if (preview)
        await client.projectPackages.discard(preview.id).catch(() => undefined);
      const next = await client.projectPackages.preview({
        capabilityToken: file.token,
      });
      setFileName(file.name);
      setPreview(next);
      setTitle(next.projectTitle);
    } catch (cause) {
      setPreview(undefined);
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const discard = async () => {
    if (preview)
      await client.projectPackages.discard(preview.id).catch(() => undefined);
    setPreview(undefined);
    setFileName(undefined);
    setTitle("");
    setNotice(undefined);
  };
  const commit = async () => {
    if (!preview || !title.trim()) return;
    setWorking(true);
    setNotice(undefined);
    try {
      const result = await client.projectPackages.commit(preview.id, {
        title: title.trim(),
      });
      props.onImported(result.project);
      setNotice(
        `已导入「${result.project.title}」，包含 ${result.chaptersCreated} 个章节和 ${result.resourcesCreated} 项资料。`,
      );
      setPreview(undefined);
      setFileName(undefined);
      setTitle("");
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">导入新版项目包</h2>
          <p className="mt-1 text-sm text-muted">
            导入由 DramaIP 新版导出的项目
            JSON。系统会先预览，再创建一个新的独立项目；不会读取旧版数据库。
          </p>
        </div>
        <button
          className="rounded-lg border border-line px-3 py-2 text-sm text-brand disabled:opacity-50"
          disabled={working}
          onClick={() => void choose()}
        >
          {working ? "正在读取…" : "选择项目包"}
        </button>
      </div>
      {preview && (
        <div className="mt-4 rounded-xl bg-canvas p-4">
          <p className="text-sm font-medium">
            预览：{fileName ?? preview.sourceName}
          </p>
          <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
            <p>原项目：{preview.projectTitle}</p>
            <p>章节：{preview.chapterCount}</p>
            <p>资料：{preview.resourceCount}</p>
          </div>
          <label className="mt-3 grid max-w-lg gap-1 text-sm">
            新项目名称
            <input
              className="rounded-lg border border-line bg-white px-3 py-2"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {preview.warnings.map((warning) => (
            <p key={warning} className="mt-2 text-xs text-amber-800">
              注意：{warning}
            </p>
          ))}
          <div className="mt-4 flex justify-end gap-2">
            <button
              className="rounded-lg border border-line px-3 py-2 text-sm text-muted"
              disabled={working}
              onClick={() => void discard()}
            >
              取消
            </button>
            <button
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={working || !title.trim()}
              onClick={() => void commit()}
            >
              {working ? "正在导入…" : "确认创建新项目"}
            </button>
          </div>
        </div>
      )}
      {notice && (
        <p className="mt-3 rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
    </section>
  );
}

function ProjectHome() {
  const client = useStudio();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [creationSource, setCreationSource] = useState<ProjectCreationSource>();
  const [brief, setBrief] = useState<ProductionBriefDraft>(() =>
    defaultProductionBrief("inspiration"),
  );
  const [scriptContent, setScriptContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [creatingDemo, setCreatingDemo] = useState(false);
  const [error, setError] = useState<string>();
  const [showTrash, setShowTrash] = useState(false);
  const [trashedProjects, setTrashedProjects] = useState<Project[]>([]);
  const load = () =>
    void client.projects
      .list()
      .then(setProjects)
      .catch((cause) => setError(message(cause)));
  useEffect(load, [client]);
  const loadTrash = () =>
    void client.projects
      .listTrash()
      .then(setTrashedProjects)
      .catch((cause) => setError(message(cause)));
  const selectCreationSource = (source: ProjectCreationSource) => {
    setCreationSource(source);
    setBrief(defaultProductionBrief(source));
    setScriptContent("");
    setError(undefined);
  };
  const updateBrief = <Key extends keyof ProductionBriefDraft>(
    key: Key,
    value: ProductionBriefDraft[Key],
  ) => setBrief((current) => ({ ...current, [key]: value }));
  const cleanupUnfinishedProject = async (project: Project) => {
    try {
      await client.projects.trash(project.id);
      await client.projects.purge(project.id, project.title);
    } catch {
      // The source write itself is transactional. A failed local cleanup never
      // hides the error or makes an unverified draft look like an imported one.
    }
  };
  const createFromBrief = async (
    mode: "inspiration" | "source-file" | "script-draft" | "script-file",
  ) => {
    if (!creationSource || !brief.title.trim() || !brief.shortDramaType.trim())
      return;
    if (mode === "script-draft" && !scriptContent.trim()) return;
    setSaving(true);
    setError(undefined);
    try {
      const project = await client.projects.create(
        projectInputFromBrief(brief),
      );
      if (mode === "script-draft") {
        try {
          await client.chapters.create({
            projectId: project.id,
            title: "第 1 集剧本草稿",
            summary: "从首页直接粘贴的剧本草稿，待后续拆分为场景与分镜。",
            content: scriptContent.trim(),
          });
        } catch (cause) {
          await cleanupUnfinishedProject(project);
          throw cause;
        }
      }
      setProjects((items) => [project, ...items]);
      const sourceImport = mode === "source-file" || mode === "script-file";
      navigate(
        `/projects/${project.id}${sourceImport ? "?intake=source" : ""}`,
      );
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSaving(false);
    }
  };
  const createDemo = async () => {
    setCreatingDemo(true);
    setError(undefined);
    try {
      const project = await client.support.createDemoProject();
      setProjects((items) => [project, ...items]);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setCreatingDemo(false);
    }
  };
  const trashProject = async (project: Project) => {
    if (!window.confirm(`将「${project.title}」移入回收站吗？`)) return;
    try {
      await client.projects.trash(project.id);
      setProjects((items) => items.filter((item) => item.id !== project.id));
      if (showTrash) loadTrash();
    } catch (cause) {
      setError(message(cause));
    }
  };
  const restoreProject = async (project: Project) => {
    try {
      const restored = await client.projects.restore(project.id);
      setTrashedProjects((items) =>
        items.filter((item) => item.id !== project.id),
      );
      setProjects((items) => [restored, ...items]);
    } catch (cause) {
      setError(message(cause));
    }
  };
  const purgeProject = async (project: Project) => {
    const confirmation = window.prompt(
      `请输入项目名称“${project.title}”以永久删除：`,
    );
    if (confirmation === null) return;
    try {
      await client.projects.purge(project.id, confirmation);
      setTrashedProjects((items) =>
        items.filter((item) => item.id !== project.id),
      );
    } catch (cause) {
      setError(message(cause));
    }
  };
  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-gradient-to-br from-brand to-indigo-700 p-8 text-white">
        <p className="text-sm text-indigo-200">智能漫剧生产工作台</p>
        <h1 className="mt-2 text-3xl font-semibold">从故事到可交付内容</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-indigo-100">
          项目资料、章节创作、改编生产与智能助手工作流全部由本地服务统一管理。
        </p>
      </section>
      <section className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">选择开始方式</h2>
            <p className="mt-1 text-sm text-muted">
              先选择你手里的内容，再补齐可编辑的生产简报。不会要求选择模型、智能任务或服务商。
            </p>
          </div>
          <button
            className="rounded-lg border border-line px-3 py-2 text-sm text-brand disabled:opacity-50"
            disabled={saving || creatingDemo}
            onClick={() => void createDemo()}
          >
            {creatingDemo ? "正在创建示例…" : "创建示例项目"}
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {[
            {
              source: "inspiration" as const,
              title: "从灵感开始",
              description: "先保存故事构思和试制方向，再逐步补全人物与章节。",
              outcome: "首个产出：可继续完善的生产简报",
            },
            {
              source: "source-import" as const,
              title: "导入原著",
              description:
                "导入你拥有权利的小说或 IP；文件会先预览，确认授权后才写入。",
              outcome: "首个产出：可审查的原著导入预览",
            },
            {
              source: "script" as const,
              title: "直接导入 / 粘贴剧本",
              description:
                "已有剧本可直接粘贴为首集草稿，也可选择文件进入同一预览流程。",
              outcome: "首个产出：可编辑的首集剧本草稿",
            },
          ].map((path) => (
            <button
              key={path.source}
              className={`rounded-xl border p-4 text-left transition ${creationSource === path.source ? "border-brand bg-brand-soft" : "border-line hover:border-brand"}`}
              aria-pressed={creationSource === path.source}
              onClick={() => selectCreationSource(path.source)}
            >
              <p className="font-medium">{path.title}</p>
              <p className="mt-2 text-sm leading-6 text-muted">
                {path.description}
              </p>
              <p className="mt-3 text-xs text-brand">{path.outcome}</p>
            </button>
          ))}
        </div>
        {creationSource && (
          <div className="mt-5 border-t border-line pt-5">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                项目名称
                <input
                  className="rounded-lg border border-line px-3 py-2"
                  value={brief.title}
                  onChange={(event) => updateBrief("title", event.target.value)}
                />
              </label>
              <label className="grid gap-1 text-sm">
                短剧题材
                <input
                  className="rounded-lg border border-line px-3 py-2"
                  value={brief.shortDramaType}
                  onChange={(event) =>
                    updateBrief("shortDramaType", event.target.value)
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                目标受众
                <input
                  className="rounded-lg border border-line px-3 py-2"
                  value={brief.targetAudience}
                  onChange={(event) =>
                    updateBrief("targetAudience", event.target.value)
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                目标平台
                <input
                  className="rounded-lg border border-line px-3 py-2"
                  value={brief.targetPlatform}
                  onChange={(event) =>
                    updateBrief("targetPlatform", event.target.value)
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                单集时长
                <input
                  className="rounded-lg border border-line px-3 py-2"
                  value={brief.episodeDuration}
                  onChange={(event) =>
                    updateBrief("episodeDuration", event.target.value)
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                计划集数
                <input
                  className="rounded-lg border border-line px-3 py-2"
                  inputMode="numeric"
                  value={brief.targetEpisodeCount}
                  onChange={(event) =>
                    updateBrief("targetEpisodeCount", event.target.value)
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                画幅
                <input
                  className="rounded-lg border border-line px-3 py-2"
                  value={brief.aspectRatio}
                  onChange={(event) =>
                    updateBrief("aspectRatio", event.target.value)
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                视觉方向
                <input
                  className="rounded-lg border border-line px-3 py-2"
                  value={brief.visualStyleDirection}
                  onChange={(event) =>
                    updateBrief("visualStyleDirection", event.target.value)
                  }
                />
              </label>
            </div>
            {creationSource === "script" && (
              <label className="mt-3 grid gap-1 text-sm">
                首集剧本
                <textarea
                  className="min-h-40 rounded-lg border border-line p-3 font-editor"
                  placeholder="粘贴已拥有权利的剧本内容；保存后会作为首集草稿进入项目。"
                  value={scriptContent}
                  onChange={(event) => setScriptContent(event.target.value)}
                />
              </label>
            )}
            {creationSource === "source-import" && (
              <p className="mt-4 rounded-lg bg-brand-soft/40 p-3 text-sm text-muted">
                下一步会先选择本地文件并生成导入预览。只有确认内容权利后，章节、剧本和场景才会写入项目。
              </p>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                className="rounded-lg border border-line px-3 py-2 text-sm text-muted"
                disabled={saving}
                onClick={() => setCreationSource(undefined)}
              >
                取消
              </button>
              {creationSource === "inspiration" && (
                <button
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={saving || !brief.title.trim()}
                  onClick={() => void createFromBrief("inspiration")}
                >
                  {saving ? "正在创建…" : "创建项目并开始构思"}
                </button>
              )}
              {creationSource === "source-import" && (
                <button
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={saving || !brief.title.trim()}
                  onClick={() => void createFromBrief("source-file")}
                >
                  {saving ? "正在创建…" : "创建项目并预览原著"}
                </button>
              )}
              {creationSource === "script" && (
                <>
                  <button
                    className="rounded-lg border border-brand px-4 py-2 text-sm font-medium text-brand disabled:opacity-50"
                    disabled={saving || !brief.title.trim()}
                    onClick={() => void createFromBrief("script-file")}
                  >
                    选择剧本文件并预览
                  </button>
                  <button
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    disabled={
                      saving || !brief.title.trim() || !scriptContent.trim()
                    }
                    onClick={() => void createFromBrief("script-draft")}
                  >
                    {saving ? "正在保存…" : "保存剧本草稿并进入项目"}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </section>
      <ProjectPackageImportPanel
        onImported={(project) => {
          setProjects((items) => [project, ...items]);
          navigate(`/projects/${project.id}`);
        }}
      />
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">项目</h2>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">{projects.length} 个</span>
            <button
              className="text-sm text-muted hover:text-brand"
              onClick={() => {
                setShowTrash((value) => !value);
                if (!showTrash) loadTrash();
              }}
            >
              {showTrash ? "收起回收站" : "查看回收站"}
            </button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <article
              key={project.id}
              className="rounded-xl border border-line bg-surface p-5 transition hover:border-brand"
            >
              <Link to={`/projects/${project.id}`} className="block">
                <p className="font-medium">{project.title}</p>
                <p className="mt-1 text-sm text-muted">
                  {project.shortDramaType}
                </p>
                <p className="mt-5 line-clamp-2 text-sm text-muted">
                  {project.synopsis || "尚未填写项目简介"}
                </p>
              </Link>
              <button
                className="mt-4 text-xs text-muted hover:text-red-600"
                onClick={() => void trashProject(project)}
              >
                移入回收站
              </button>
            </article>
          ))}
          {!projects.length && (
            <p className="rounded-xl border border-dashed border-line p-8 text-sm text-muted">
              创建第一个项目，开始搭建故事世界。
            </p>
          )}
        </div>
        {showTrash && (
          <section className="mt-6 rounded-2xl border border-dashed border-line bg-surface p-5">
            <h3 className="font-medium">回收站</h3>
            <p className="mt-1 text-sm text-muted">
              恢复后项目会重新出现在项目列表；永久删除需要再次输入项目名称确认。
            </p>
            <div className="mt-4 space-y-2">
              {trashedProjects.map((project) => (
                <div
                  key={project.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3"
                >
                  <div>
                    <p className="font-medium">{project.title}</p>
                    <p className="text-xs text-muted">
                      {project.shortDramaType}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="rounded-md border border-line px-2 py-1 text-xs text-brand"
                      onClick={() => void restoreProject(project)}
                    >
                      恢复项目
                    </button>
                    <button
                      className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600"
                      onClick={() => void purgeProject(project)}
                    >
                      永久删除
                    </button>
                  </div>
                </div>
              ))}
              {!trashedProjects.length && (
                <p className="text-sm text-muted">回收站为空。</p>
              )}
            </div>
          </section>
        )}
      </section>
    </div>
  );
}

function ProjectWorkspace() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const { projectId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project>();
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [error, setError] = useState<string>();
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [exporting, setExporting] = useState<
    "markdown" | "json" | "script" | "storyboard" | "delivery"
  >();
  const [exportNotice, setExportNotice] = useState<string>();
  const active = chapters.find((item) => item.id === activeId) ?? chapters[0];
  const load = () => {
    if (!projectId) return;
    void Promise.all([
      client.projects.get(projectId),
      client.chapters.list(projectId),
    ])
      .then(([p, c]) => {
        setProject(p);
        setChapters(c);
        setActiveId((current) => current ?? c[0]?.id);
      })
      .catch((cause) => setError(message(cause)));
  };
  useEffect(load, [client, projectId]);
  const addChapter = async () => {
    if (!projectId) return;
    try {
      const created = await client.chapters.create({
        projectId,
        title: `第 ${chapters.length + 1} 章`,
        summary: "",
        content: "",
      });
      setChapters((items) => [...items, created]);
      setActiveId(created.id);
    } catch (cause) {
      setError(message(cause));
    }
  };
  const updateChapter = async (patch: Partial<EditableChapter>) => {
    if (!active) return;
    try {
      const updated = await client.chapters.update(active.id, {
        ...patch,
        version: active.version,
      });
      setChapters((items) =>
        items.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (cause) {
      setError(message(cause));
      load();
    }
  };
  const updateProject = async (patch: EditableProject) => {
    if (!project) return;
    try {
      const updated = await client.projects.update(project.id, {
        ...patch,
        version: project.version,
      });
      setProject(updated);
      setShowProjectSettings(false);
    } catch (cause) {
      setError(message(cause));
      load();
    }
  };
  const moveChapter = async (chapterId: string, direction: -1 | 1) => {
    if (!projectId) return;
    const index = chapters.findIndex((item) => item.id === chapterId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= chapters.length) return;
    const reordered = [...chapters];
    [reordered[index], reordered[nextIndex]] = [
      reordered[nextIndex],
      reordered[index],
    ];
    try {
      const updated = await client.chapters.reorder(projectId, {
        chapterIds: reordered.map((item) => item.id),
      });
      setChapters(updated);
    } catch (cause) {
      setError(message(cause));
      load();
    }
  };
  const removeChapter = async (chapter: Chapter) => {
    if (!window.confirm(`确定删除「${chapter.title}」吗？此操作无法撤销。`))
      return;
    try {
      await client.chapters.remove(chapter.id);
      const next = chapters.filter((item) => item.id !== chapter.id);
      setChapters(next);
      if (activeId === chapter.id) setActiveId(next[0]?.id);
    } catch (cause) {
      setError(message(cause));
      load();
    }
  };
  const exportProject = async (
    format: "markdown" | "json" | "script" | "storyboard" | "delivery",
  ) => {
    if (!project) return;
    setExporting(format);
    setExportNotice(undefined);
    try {
      const document = await client.exports.project(project.id, format);
      const result = await window.desktop.saveTextFile({
        suggestedName: document.fileName,
        content: document.content,
      });
      setExportNotice(result.saved ? "项目已导出。" : "已取消导出。");
    } catch (cause) {
      setExportNotice(message(cause));
    } finally {
      setExporting(undefined);
    }
  };
  if (!project) return <div className="text-sm text-muted">加载项目…</div>;
  return (
    <div className="space-y-5">
      <button
        className="text-sm text-muted hover:text-brand"
        onClick={() => navigate("/")}
      >
        ← 返回项目
      </button>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{project.shortDramaType}</p>
          <h1 className="text-2xl font-semibold">{project.title}</h1>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-brand disabled:opacity-50"
            disabled={Boolean(exporting)}
            onClick={() => void exportProject("markdown")}
          >
            {exporting === "markdown" ? "导出中…" : "导出文档"}
          </button>
          <button
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-brand disabled:opacity-50"
            disabled={Boolean(exporting)}
            onClick={() => void exportProject("json")}
          >
            {exporting === "json" ? "导出中…" : "导出数据"}
          </button>
          <button
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-brand disabled:opacity-50"
            disabled={Boolean(exporting)}
            onClick={() => void exportProject("script")}
          >
            {exporting === "script" ? "导出中…" : "导出剧本"}
          </button>
          <button
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-brand disabled:opacity-50"
            disabled={Boolean(exporting)}
            onClick={() => void exportProject("storyboard")}
          >
            {exporting === "storyboard" ? "导出中…" : "导出分镜"}
          </button>
          <button
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-brand disabled:opacity-50"
            disabled={Boolean(exporting)}
            onClick={() => void exportProject("delivery")}
          >
            {exporting === "delivery" ? "导出中…" : "导出交付资料"}
          </button>
          <button
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-brand"
            onClick={() => setShowProjectSettings((value) => !value)}
          >
            项目设定
          </button>
        </div>
      </div>
      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}
      {exportNotice && (
        <p className="rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {exportNotice}
        </p>
      )}
      <ProjectCockpitPanel project={project} chapters={chapters} />
      <ProjectPilotPanel project={project} chapters={chapters} />
      {showProjectSettings && (
        <ProjectSettingsEditor project={project} onSave={updateProject} />
      )}
      <SourceImportPanel
        projectId={project.id}
        initialOpen={
          new URLSearchParams(location.search).get("intake") === "source"
        }
        onImported={() => {
          load();
          void queryClient.invalidateQueries({
            queryKey: ["import-extractions", project.id],
          });
        }}
      />
      <ImportExtractionReviewPanel projectId={project.id} onChanged={load} />
      <ContentVersionPanel projectId={project.id} onRestored={load} />
      <ProjectActivityPanel projectId={project.id} />
      <div className="grid min-h-[650px] grid-cols-[220px_1fr] overflow-hidden rounded-2xl border border-line bg-surface">
        <aside className="border-r border-line p-3">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium">章节</span>
            <button
              className="rounded-md px-2 py-1 text-sm text-brand hover:bg-brand-soft"
              onClick={() => void addChapter()}
            >
              ＋
            </button>
          </div>
          <div className="space-y-1">
            {chapters.map((chapter, index) => (
              <div
                key={chapter.id}
                className={`group flex items-center gap-1 rounded-lg ${active?.id === chapter.id ? "bg-brand-soft text-brand" : "hover:bg-slate-50"}`}
              >
                <button
                  className="min-w-0 flex-1 px-3 py-2 text-left text-sm"
                  onClick={() => setActiveId(chapter.id)}
                >
                  {chapter.title}
                </button>
                <div className="flex pr-1 text-xs text-muted opacity-0 transition group-hover:opacity-100">
                  <button
                    aria-label="上移章节"
                    className="rounded px-1 hover:text-brand disabled:opacity-30"
                    disabled={index === 0}
                    onClick={() => void moveChapter(chapter.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    aria-label="下移章节"
                    className="rounded px-1 hover:text-brand disabled:opacity-30"
                    disabled={index === chapters.length - 1}
                    onClick={() => void moveChapter(chapter.id, 1)}
                  >
                    ↓
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>
        {active ? (
          <ChapterEditor
            projectId={project.id}
            chapter={active}
            onSave={updateChapter}
            onReload={load}
            onRemove={() => void removeChapter(active)}
          />
        ) : (
          <div className="grid place-items-center text-sm text-muted">
            创建章节开始写作。
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectCockpitPanel(props: { project: Project; chapters: Chapter[] }) {
  const client = useStudio();
  const { data: graph, error: graphError } = useQuery({
    queryKey: ["production-graph", props.project.id],
    queryFn: () => client.production.graph(props.project.id),
  });
  const { data: tasks = [], error: taskError } = useQuery({
    queryKey: ["tasks"],
    queryFn: client.tasks.list,
    refetchInterval: 15_000,
  });
  if (graphError || taskError)
    return (
      <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
        项目驾驶舱暂时无法读取真实状态：{message(graphError ?? taskError)}
      </p>
    );
  if (!graph)
    return (
      <section
        aria-label="项目驾驶舱"
        className="rounded-2xl border border-line bg-surface p-5 text-sm text-muted"
      >
        正在根据已保存的项目资料整理阶段、阻断项和下一步…
      </section>
    );
  const cockpit = deriveProjectCockpit({
    project: props.project,
    chapters: props.chapters,
    graph,
    tasks,
  });
  const context = new URLSearchParams({
    projectId: props.project.id,
  }).toString();
  const zones = [
    {
      label: "创作",
      to: `/projects/${props.project.id}`,
      detail: "正文与项目设定",
    },
    {
      label: "改编",
      to: `/adapt?${context}`,
      detail: "方案、分集、剧本和分镜",
    },
    {
      label: "制作",
      to: `/produce?${context}`,
      detail: "资产、静帧与视听制作",
    },
    {
      label: "审核交付",
      to: `/review?${context}`,
      detail: "质量、审片与交付记录",
    },
  ];
  return (
    <section
      aria-label="项目驾驶舱"
      className="rounded-2xl border border-brand/30 bg-gradient-to-br from-brand-soft/50 to-surface p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-brand">项目驾驶舱</p>
          <h2 className="mt-1 text-xl font-semibold">{cockpit.statusLabel}</h2>
          <p className="mt-1 text-sm text-muted">{cockpit.recentResult}</p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs text-brand">
          {cockpit.status}
        </span>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <article className="rounded-xl border border-brand/20 bg-white p-4">
          <p className="text-xs font-medium text-muted">唯一推荐下一步</p>
          <p className="mt-1 font-semibold">{cockpit.primaryAction.label}</p>
          <p className="mt-1 text-sm leading-6 text-muted">
            {cockpit.primaryAction.description}
          </p>
          <Link
            className="mt-4 inline-flex rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
            to={cockpit.primaryAction.to}
          >
            {cockpit.primaryAction.label}
          </Link>
        </article>
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-xs font-medium text-muted">真实覆盖情况</p>
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {cockpit.coverage.map((item) => (
              <div key={item.label} className="rounded-lg bg-canvas p-2">
                <dt className="text-xs text-muted">{item.label}</dt>
                <dd className="mt-1 font-semibold">
                  {item.required === undefined
                    ? item.current
                    : `${item.current}/${item.required}`}
                </dd>
              </div>
            ))}
          </dl>
          {cockpit.blockers.length > 0 && (
            <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">当前阻断项</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {cockpit.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      <nav
        aria-label="项目四区导航"
        className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
      >
        {zones.map((zone) => (
          <Link
            key={zone.label}
            to={zone.to}
            className="rounded-lg border border-line bg-white p-3 transition hover:border-brand"
          >
            <p className="font-medium">{zone.label}</p>
            <p className="mt-1 text-xs text-muted">{zone.detail}</p>
          </Link>
        ))}
      </nav>
    </section>
  );
}

const PILOT_STAGE_LABELS: Record<PilotPlan["stage"], string> = {
  "confirm-source": "确认试制来源",
  script: "采用试制剧本",
  scenes: "拆分制作场景",
  shots: "建立试制分镜",
  assets: "整理试制资产",
  review: "进入人工审核",
};

function ProjectPilotPanel(props: { project: Project; chapters: Chapter[] }) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const { data: plans = [] } = useQuery({
    queryKey: ["pilot-plans", props.project.id],
    queryFn: () => client.pilotPlans.list(props.project.id),
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [episodeCount, setEpisodeCount] = useState(1);
  const [notice, setNotice] = useState<string>();
  const [working, setWorking] = useState(false);
  useEffect(() => {
    setSelectedIds((current) =>
      current.filter((id) =>
        props.chapters.some((chapter) => chapter.id === id),
      ).length
        ? current.filter((id) =>
            props.chapters.some((chapter) => chapter.id === id),
          )
        : props.chapters.slice(0, 1).map((chapter) => chapter.id),
    );
  }, [props.chapters]);
  const active = plans.find((plan) => plan.status !== "canceled") ?? plans[0];
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["pilot-plans", props.project.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ["production-graph", props.project.id],
      }),
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
    ]);
  };
  const toggle = (id: string) => {
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 3) {
        setNotice("试制最多选择 3 个来源章节。");
        return current;
      }
      return [...current, id];
    });
  };
  const create = async () => {
    if (!selectedIds.length || episodeCount > selectedIds.length) {
      setNotice("请选择 1–3 个章节，且试制集数不能超过来源章节数。");
      return;
    }
    setWorking(true);
    try {
      await client.pilotPlans.create({
        projectId: props.project.id,
        chapterIds: selectedIds,
        episodeCount,
      });
      setNotice("已保存试制范围；确认来源后才会创建试制分集。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const act = async (
    plan: PilotPlan,
    action: "confirm-source" | "return-source" | "cancel" | "resume",
  ) => {
    setWorking(true);
    try {
      await client.pilotPlans.action(plan.id, { action });
      setNotice(
        action === "confirm-source"
          ? "来源已人工确认，已建立可继续编辑的试制分集。"
          : action === "cancel"
            ? "试制运行已取消；已采用内容会保留在现有工作区。"
            : action === "resume"
              ? "已用当前章节版本恢复试制，等待重新确认来源。"
              : "已退回来源确认；不会删除已采用内容。",
      );
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
      await refresh();
    } finally {
      setWorking(false);
    }
  };
  const nextTo = (plan: PilotPlan) => {
    const context = new URLSearchParams({
      projectId: plan.projectId,
      ...(plan.adaptationId ? { adaptationId: plan.adaptationId } : {}),
      ...(plan.episodeIds[0] ? { episodeId: plan.episodeIds[0] } : {}),
    }).toString();
    if (plan.stage === "script") return `/adapt?${context}&stage=scripts`;
    if (plan.stage === "scenes") return `/adapt?${context}&stage=scenes`;
    if (plan.stage === "shots") return `/adapt?${context}&stage=shots`;
    if (plan.stage === "assets")
      return `/produce?${context}&stage=visual-assets`;
    if (plan.stage === "review") return `/review?${context}&stage=quality`;
    return undefined;
  };
  return (
    <section
      aria-label="试制向导"
      className="rounded-2xl border border-line bg-surface p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">1–3 集可恢复试制</p>
          <h2 className="mt-1 text-xl font-semibold">
            先完成一小段可信制作链路
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            向导只保存试制范围与人工确认。剧本、场景、分镜、资产和完成度都来自已有的权威资料，关闭后可随时恢复。
          </p>
        </div>
        <span className="rounded-full bg-brand-soft px-3 py-1 text-xs text-brand">
          最多 3 集
        </span>
      </div>
      {notice && (
        <p className="mt-3 rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
      {!active && (
        <div className="mt-4 rounded-xl border border-line bg-canvas p-4">
          <p className="font-medium">选择试制来源</p>
          <p className="mt-1 text-sm text-muted">
            建议从最能代表项目钩子的连续章节开始。
          </p>
          <div className="mt-3 space-y-2">
            {props.chapters.slice(0, 12).map((chapter) => (
              <label
                key={chapter.id}
                className="flex items-center gap-2 rounded-lg bg-white p-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(chapter.id)}
                  onChange={() => toggle(chapter.id)}
                />
                <span>来源章节：{chapter.title}</span>
              </label>
            ))}
            {!props.chapters.length && (
              <p className="text-sm text-amber-800">
                请先导入或写入至少一个章节。
              </p>
            )}
          </div>
          <label className="mt-3 grid max-w-xs gap-1 text-sm">
            试制集数
            <select
              className="rounded-lg border border-line bg-white px-3 py-2"
              value={episodeCount}
              onChange={(event) => setEpisodeCount(Number(event.target.value))}
            >
              {[1, 2, 3].map((count) => (
                <option
                  key={count}
                  value={count}
                  disabled={count > selectedIds.length}
                >
                  {count} 集
                </option>
              ))}
            </select>
          </label>
          <button
            className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={working || !props.chapters.length}
            onClick={() => void create()}
          >
            建立试制计划
          </button>
        </div>
      )}
      {active && (
        <div className="mt-4 rounded-xl border border-line p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium">
                当前阶段：{PILOT_STAGE_LABELS[active.stage]}
              </p>
              <p className="mt-1 text-sm text-muted">
                {active.episodeCount} 集试制 ·{" "}
                {active.sourceConfirmed ? "来源已确认" : "尚未确认来源"}
              </p>
              {active.blocker && (
                <p className="mt-2 text-sm text-amber-800">{active.blocker}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {active.stage === "confirm-source" &&
                active.status !== "canceled" && (
                  <button
                    className="rounded-md bg-brand px-3 py-1.5 text-xs text-white disabled:opacity-50"
                    disabled={working}
                    onClick={() => void act(active, "confirm-source")}
                  >
                    确认来源并创建试制分集
                  </button>
                )}
              {active.status === "canceled" && (
                <button
                  className="rounded-md border border-line px-3 py-1.5 text-xs text-brand"
                  disabled={working}
                  onClick={() => void act(active, "resume")}
                >
                  恢复试制
                </button>
              )}
              {active.status === "stale" && (
                <button
                  className="rounded-md border border-line px-3 py-1.5 text-xs text-brand"
                  disabled={working}
                  onClick={() => void act(active, "resume")}
                >
                  按当前来源重新开始
                </button>
              )}
              {nextTo(active) && (
                <Link
                  className="rounded-md border border-line px-3 py-1.5 text-xs text-brand"
                  to={nextTo(active)!}
                >
                  前往唯一待办
                </Link>
              )}
              {active.status !== "canceled" && (
                <button
                  className="rounded-md border border-line px-3 py-1.5 text-xs text-muted"
                  disabled={working}
                  onClick={() => void act(active, "return-source")}
                >
                  退回来源
                </button>
              )}
              {active.status !== "canceled" && (
                <button
                  className="rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-600"
                  disabled={working}
                  onClick={() => void act(active, "cancel")}
                >
                  取消试制
                </button>
              )}
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {Object.entries(active.coverage).map(([label, count]) => (
              <div key={label} className="rounded-lg bg-canvas p-2 text-sm">
                <dt className="text-xs text-muted">
                  {
                    (
                      {
                        episodes: "分集",
                        scripts: "剧本",
                        scenes: "场景",
                        shots: "分镜",
                        assets: "资产",
                      } as Record<string, string>
                    )[label]
                  }
                </dt>
                <dd className="mt-1 font-semibold">{count}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}

function ProjectSettingsEditor(props: {
  project: Project;
  onSave(input: EditableProject): Promise<void>;
}) {
  const makeDraft = (project: Project): Record<string, string> => ({
    title: project.title,
    shortDramaType: project.shortDramaType,
    targetAudience: project.targetAudience ?? "",
    targetWordCount: project.targetWordCount?.toString() ?? "",
    targetEpisodeCount: project.targetEpisodeCount?.toString() ?? "",
    coreHook: project.coreHook ?? "",
    emotionalCore: project.emotionalCore ?? "",
    coreSellingPoint: project.coreSellingPoint ?? "",
    synopsis: project.synopsis,
    styleGuide: project.styleGuide ?? "",
    visualStyleDirection: project.visualStyleDirection ?? "",
    genreOpportunity: project.genreOpportunity ?? "",
    productionBrief: project.productionBrief ?? "",
  });
  const [draft, setDraft] = useState(() => makeDraft(props.project));
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(makeDraft(props.project)), [props.project]);
  const set = (key: string, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const number = (value: string): number | undefined => {
    const parsed = Number(value);
    return value.trim() && Number.isInteger(parsed) && parsed >= 0
      ? parsed
      : undefined;
  };
  const submit = async () => {
    if (!draft.title.trim() || !draft.shortDramaType.trim()) return;
    setSaving(true);
    try {
      await props.onSave({
        title: draft.title.trim(),
        shortDramaType: draft.shortDramaType.trim(),
        targetAudience: draft.targetAudience,
        targetWordCount: number(draft.targetWordCount),
        targetEpisodeCount: number(draft.targetEpisodeCount),
        coreHook: draft.coreHook,
        emotionalCore: draft.emotionalCore,
        coreSellingPoint: draft.coreSellingPoint,
        synopsis: draft.synopsis,
        styleGuide: draft.styleGuide,
        visualStyleDirection: draft.visualStyleDirection,
        genreOpportunity: draft.genreOpportunity,
        productionBrief: draft.productionBrief,
      });
    } finally {
      setSaving(false);
    }
  };
  const fields = [
    ["targetAudience", "目标受众", "例如：18—35 岁女性观众"],
    ["coreHook", "核心钩子", "一句话说明最吸引人的设定"],
    ["emotionalCore", "情感内核", "人物和故事真正关心的主题"],
    ["coreSellingPoint", "核心卖点", "面向观众的差异化亮点"],
    ["styleGuide", "文风指南", "叙事语气、台词或禁忌"],
    ["visualStyleDirection", "视觉风格方向", "美术、镜头和色彩方向"],
    ["genreOpportunity", "题材机会", "市场洞察与机会判断"],
  ] as const;
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">项目设定</h2>
          <p className="mt-1 text-sm text-muted">
            故事、改编和制作环节会以这些设定作为共同上下文。
          </p>
        </div>
        <button
          className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={
            saving || !draft.title.trim() || !draft.shortDramaType.trim()
          }
          onClick={() => void submit()}
        >
          {saving ? "保存中…" : "保存项目设定"}
        </button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          项目名称
          <input
            className="rounded-lg border border-line px-3 py-2"
            value={draft.title}
            onChange={(event) => set("title", event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          短剧题材
          <input
            className="rounded-lg border border-line px-3 py-2"
            value={draft.shortDramaType}
            onChange={(event) => set("shortDramaType", event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          目标字数
          <input
            className="rounded-lg border border-line px-3 py-2"
            inputMode="numeric"
            value={draft.targetWordCount}
            onChange={(event) => set("targetWordCount", event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          目标集数
          <input
            className="rounded-lg border border-line px-3 py-2"
            inputMode="numeric"
            value={draft.targetEpisodeCount}
            onChange={(event) => set("targetEpisodeCount", event.target.value)}
          />
        </label>
        {fields.map(([key, label, placeholder]) => (
          <label key={key} className="grid gap-1 text-sm">
            {label}
            <input
              className="rounded-lg border border-line px-3 py-2"
              placeholder={placeholder}
              value={draft[key]}
              onChange={(event) => set(key, event.target.value)}
            />
          </label>
        ))}
      </div>
      <label className="mt-3 grid gap-1 text-sm">
        项目简介
        <textarea
          className="min-h-24 rounded-lg border border-line p-3"
          value={draft.synopsis}
          onChange={(event) => set("synopsis", event.target.value)}
        />
      </label>
      <label className="mt-3 grid gap-1 text-sm">
        制作说明
        <textarea
          className="min-h-24 rounded-lg border border-line p-3"
          value={draft.productionBrief}
          onChange={(event) => set("productionBrief", event.target.value)}
        />
      </label>
    </section>
  );
}

function SourceImportPanel(props: {
  projectId: string;
  initialOpen?: boolean;
  onImported(): void;
}) {
  const client = useStudio();
  const [open, setOpen] = useState(props.initialOpen ?? false);
  const [importId, setImportId] = useState<string>();
  const [preview, setPreview] = useState<SourceImportPreview>();
  const [duplicates, setDuplicates] = useState<{
    chapters: string[];
    episodes: number[];
  }>({
    chapters: [],
    episodes: [],
  });
  const [selectedChapter, setSelectedChapter] = useState(0);
  const [strategy, setStrategy] = useState<SourceImportStrategy>("append");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [destructiveConfirmed, setDestructiveConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    if (props.initialOpen) setOpen(true);
  }, [props.initialOpen]);

  const totalEntries =
    (preview?.chapters.length ?? 0) + (preview?.episodes.length ?? 0);
  const reset = async () => {
    if (importId) {
      try {
        await client.sourceImports.discard(importId);
      } catch {
        // The temporary preview may already have expired or been committed.
      }
    }
    setImportId(undefined);
    setPreview(undefined);
    setDuplicates({ chapters: [], episodes: [] });
    setSelectedChapter(0);
    setStrategy("append");
    setRightsConfirmed(false);
    setDestructiveConfirmed(false);
  };
  const close = () => {
    void reset();
    setOpen(false);
  };
  const choose = async () => {
    setWorking(true);
    setNotice(undefined);
    try {
      const selected = await window.desktop.pickFiles({
        multiple: false,
        extensions: ["txt", "md", "markdown", "docx", "epub", "json"],
      });
      const file = selected?.[0];
      if (!file) return;
      if (importId) await client.sourceImports.discard(importId);
      const result = await client.sourceImports.preview({
        projectId: props.projectId,
        capabilityToken: file.token,
      });
      setImportId(result.importId);
      setPreview(result.preview);
      setDuplicates(result.duplicates);
      setSelectedChapter(0);
      setStrategy("append");
      setRightsConfirmed(false);
      setDestructiveConfirmed(false);
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const updateChapter = (
    patch: Partial<
      Pick<SourceImportPreview["chapters"][number], "title" | "content">
    >,
  ) => {
    setPreview((current) => {
      if (!current || !current.chapters[selectedChapter]) return current;
      return {
        ...current,
        chapters: current.chapters.map((chapter, index) => {
          if (index !== selectedChapter) return chapter;
          const content = patch.content ?? chapter.content;
          return {
            ...chapter,
            ...patch,
            content,
            wordCount: [...content.replace(/\s/g, "")].length,
          };
        }),
      };
    });
  };
  const addChapter = () => {
    setPreview((current) => {
      if (!current) return current;
      const chapters = [
        ...current.chapters,
        {
          key: `manual-${crypto.randomUUID()}`,
          title: `第${current.chapters.length + 1}章`,
          content: "",
          orderIndex: current.chapters.length,
          wordCount: 0,
        },
      ];
      setSelectedChapter(chapters.length - 1);
      return { ...current, chapters };
    });
  };
  const removeChapter = () => {
    setPreview((current) => {
      if (!current || current.chapters.length <= 1) return current;
      const chapters = current.chapters
        .filter((_, index) => index !== selectedChapter)
        .map((chapter, index) => ({ ...chapter, orderIndex: index }));
      setSelectedChapter(Math.max(0, selectedChapter - 1));
      return { ...current, chapters };
    });
  };
  const commit = async () => {
    if (!importId || !preview) return;
    setWorking(true);
    setNotice(undefined);
    try {
      const result = await client.sourceImports.commit(importId, {
        projectId: props.projectId,
        strategy,
        rightsConfirmed,
        destructiveConfirmed,
        preview,
      });
      setNotice(
        `导入完成：新增 ${result.createdChapters} 个章节、${result.createdScripts} 个剧本、${result.createdScenes} 个场景。`,
      );
      setImportId(undefined);
      setPreview(undefined);
      props.onImported();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const activeChapter = preview?.chapters[selectedChapter];
  const canCommit = Boolean(
    importId &&
    preview &&
    totalEntries > 0 &&
    rightsConfirmed &&
    (strategy === "append" || destructiveConfirmed) &&
    !working,
  );
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">导入小说原稿或漫剧剧本</h2>
          <p className="mt-1 text-sm text-muted">
            支持文本、Markdown、Word、EPUB
            与结构化剧本数据。先预览，确认后才写入；原文件只读且不会上传。
          </p>
        </div>
        <button
          className="rounded-lg border border-line px-3 py-2 text-sm text-brand disabled:opacity-50"
          disabled={working}
          onClick={() => (open ? close() : setOpen(true))}
        >
          {open ? "收起导入" : "导入内容"}
        </button>
      </div>
      {open && (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          {!preview ? (
            <div className="rounded-xl border border-dashed border-line p-5 text-center">
              <p className="font-medium">选择拥有授权的内容文件</p>
              <p className="mt-1 text-xs text-muted">
                不支持绕过数字版权保护、OCR 识别受限内容或从网络抓取付费内容。
              </p>
              <button
                className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={working}
                onClick={() => void choose()}
              >
                {working ? "正在解析…" : "选择文件并解析"}
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-brand-soft/40 p-3 text-sm">
                <span className="font-medium">{preview.fileName}</span>
                <span className="rounded-full bg-white px-2 py-1 text-xs text-brand">
                  {sourceTypeLabel(preview.sourceType)}
                </span>
                <span className="text-xs text-muted">
                  {preview.contentKind === "script"
                    ? `识别 ${preview.episodes.length} 集、${preview.episodes.reduce((count, episode) => count + episode.scenes.length, 0)} 个场景`
                    : `识别 ${preview.chapters.length} 个${preview.contentKind === "novel" ? "章节" : "草稿段落"}`}
                  {" · "}
                  {preview.charCount.toLocaleString("zh-CN")} 字符
                </span>
                <button
                  className="ml-auto rounded-md border border-line bg-white px-2 py-1 text-xs text-brand disabled:opacity-50"
                  disabled={working}
                  onClick={() => void choose()}
                >
                  重新选择
                </button>
              </div>
              {preview.warnings.map((warning) => (
                <p
                  key={warning}
                  className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800"
                >
                  {importWarning(warning)}
                </p>
              ))}
              {(duplicates.chapters.length > 0 ||
                duplicates.episodes.length > 0) && (
                <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                  发现重复内容：
                  {duplicates.chapters.length
                    ? `${duplicates.chapters.length} 个同名章节`
                    : ""}
                  {duplicates.chapters.length && duplicates.episodes.length
                    ? "；"
                    : ""}
                  {duplicates.episodes.length
                    ? `${duplicates.episodes.length} 个同集号剧本`
                    : ""}
                  。默认只会新建，不覆盖已有内容。
                </p>
              )}
              {preview.contentKind === "script" ? (
                <div className="max-h-72 space-y-2 overflow-auto rounded-xl border border-line p-3">
                  {preview.episodes.map((episode) => (
                    <article
                      key={episode.key}
                      className="rounded-lg border border-line p-3 text-sm"
                    >
                      <p className="font-medium">
                        第 {episode.episodeNumber} 集 · {episode.title}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {episode.scenes.length} 个场景 ·{" "}
                        {episode.content.length.toLocaleString("zh-CN")} 字符
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="grid min-h-72 grid-cols-[11rem_1fr] gap-3">
                  <div className="space-y-1 overflow-auto rounded-xl border border-line p-2">
                    {preview.chapters.map((chapter, index) => (
                      <button
                        key={chapter.key}
                        className={`block w-full rounded-lg px-2 py-2 text-left text-xs ${index === selectedChapter ? "bg-brand text-white" : "hover:bg-brand-soft"}`}
                        onClick={() => setSelectedChapter(index)}
                      >
                        <span className="block truncate">{chapter.title}</span>
                        <span className="opacity-70">
                          {chapter.wordCount.toLocaleString("zh-CN")} 字
                        </span>
                      </button>
                    ))}
                    <button
                      className="mt-2 w-full rounded-md border border-line px-2 py-1 text-xs text-brand"
                      onClick={addChapter}
                    >
                      新增章节
                    </button>
                  </div>
                  {activeChapter && (
                    <div className="space-y-2 rounded-xl border border-line p-3">
                      <div className="flex gap-2">
                        <input
                          className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-sm"
                          aria-label="导入章节标题"
                          value={activeChapter.title}
                          onChange={(event) =>
                            updateChapter({ title: event.target.value })
                          }
                        />
                        <button
                          className="rounded-lg border border-red-200 px-2 text-xs text-red-600 disabled:opacity-50"
                          disabled={preview.chapters.length <= 1}
                          onClick={removeChapter}
                        >
                          删除
                        </button>
                      </div>
                      <textarea
                        className="min-h-48 w-full rounded-lg border border-line p-3 font-editor text-sm"
                        aria-label="导入章节正文"
                        value={activeChapter.content}
                        onChange={(event) =>
                          updateChapter({ content: event.target.value })
                        }
                      />
                      <p className="text-xs text-muted">
                        可在确认前编辑、拆分或新增章节；空章节不会写入项目。
                      </p>
                    </div>
                  )}
                </div>
              )}
              <div className="space-y-3 rounded-xl border border-line bg-canvas p-3 text-sm">
                <label className="flex items-start gap-2">
                  <input
                    className="mt-1"
                    type="checkbox"
                    checked={rightsConfirmed}
                    onChange={(event) =>
                      setRightsConfirmed(event.target.checked)
                    }
                  />
                  我确认拥有此内容的使用权，或已经取得必要授权。
                </label>
                <label className="flex flex-wrap items-center gap-2">
                  重复内容处理方式
                  <select
                    className="rounded-lg border border-line bg-white px-2 py-1"
                    value={strategy}
                    onChange={(event) => {
                      setStrategy(event.target.value as SourceImportStrategy);
                      setDestructiveConfirmed(false);
                    }}
                  >
                    <option value="append">默认新建，不覆盖已有内容</option>
                    <option value="merge">合并到同名内容</option>
                    <option value="replace">覆盖同名内容</option>
                  </select>
                </label>
                {strategy !== "append" && (
                  <label className="flex items-start gap-2 text-amber-800">
                    <input
                      className="mt-1"
                      type="checkbox"
                      checked={destructiveConfirmed}
                      onChange={(event) =>
                        setDestructiveConfirmed(event.target.checked)
                      }
                    />
                    我理解这会修改已有内容；系统会先保存可恢复的内容检查点。
                  </label>
                )}
                <p className="text-xs text-muted">
                  写入在同一个数据库事务中完成；解析、校验或写入失败不会留下部分章节、剧本或场景。
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  className="rounded-lg border border-line px-3 py-2 text-sm text-muted"
                  onClick={close}
                >
                  取消
                </button>
                <button
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={!canCommit}
                  onClick={() => void commit()}
                >
                  {working ? "正在导入…" : "确认导入"}
                </button>
              </div>
            </>
          )}
          {notice && (
            <p className="rounded-lg bg-brand-soft p-3 text-sm text-brand">
              {notice}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

const IMPORT_EXTRACTION_STATUS_LABELS: Record<string, string> = {
  draft: "待审查",
  applied: "已部分/全部采用",
  stale: "来源已更新",
  discarded: "已撤销",
  failed: "整理失败",
  rejected: "未采用",
  adopted: "已采用",
  conflict: "需人工处理",
};
const IMPORT_EXTRACTION_TYPE_LABELS: Record<string, string> = {
  character: "人物",
  scene: "场景",
  prop: "道具",
  "chapter-summary": "章节摘要",
  adaptation: "改编建议",
};

function ImportExtractionReviewPanel(props: {
  projectId: string;
  onChanged(): void;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const { data: changeSets = [] } = useQuery({
    queryKey: ["import-extractions", props.projectId],
    queryFn: () => client.importExtractions.list(props.projectId),
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState({ title: "", summary: "" });
  const [notice, setNotice] = useState<string>();
  const [workingId, setWorkingId] = useState<string>();
  useEffect(() => {
    const draftIds = changeSets.flatMap((set) =>
      set.candidates
        .filter((candidate) => candidate.status === "draft")
        .map((candidate) => candidate.id),
    );
    setSelectedIds((current) =>
      draftIds.some((id) => current.has(id)) ? current : new Set(draftIds),
    );
  }, [changeSets]);
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["import-extractions", props.projectId],
      }),
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      queryClient.invalidateQueries({
        queryKey: ["resource", "characters", props.projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["resource", "scenes", props.projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["resource", "assets", props.projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["resource", "adaptations", props.projectId],
      }),
    ]);
    props.onChanged();
  };
  const toggle = (candidateId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  };
  const startEdit = (
    candidate: ImportExtractionChangeSet["candidates"][number],
  ) => {
    setEditingId(candidate.id);
    setDraft({ title: candidate.title, summary: candidate.summary });
  };
  const saveEdit = async (changeSetId: string, candidateId: string) => {
    setWorkingId(candidateId);
    setNotice(undefined);
    try {
      await client.importExtractions.updateCandidate(
        changeSetId,
        candidateId,
        draft,
      );
      setEditingId(undefined);
      setNotice("候选已更新；采用前仍可继续调整。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorkingId(undefined);
    }
  };
  const setCandidateStatus = async (
    changeSetId: string,
    candidateId: string,
    status: "draft" | "rejected",
  ) => {
    setWorkingId(candidateId);
    try {
      await client.importExtractions.updateCandidate(changeSetId, candidateId, {
        status,
      });
      setNotice(
        status === "rejected"
          ? "候选已保留为未采用，不会写入项目。"
          : "候选已重新加入待审查列表。",
      );
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorkingId(undefined);
    }
  };
  const adopt = async (changeSet: ImportExtractionChangeSet) => {
    const ids = changeSet.candidates
      .filter(
        (candidate) =>
          candidate.status === "draft" && selectedIds.has(candidate.id),
      )
      .map((candidate) => candidate.id);
    if (!ids.length) {
      setNotice("请至少选择一条待审查候选。未选择的候选不会被采用。");
      return;
    }
    if (
      !window.confirm(
        `将采用 ${ids.length} 条已选候选。系统会在一个事务中写入；如检测到人工内容冲突，不会部分采用。确定继续吗？`,
      )
    )
      return;
    setWorkingId(changeSet.id);
    try {
      await client.importExtractions.adopt(changeSet.id, { candidateIds: ids });
      setNotice("已采用所选候选，并保留可撤销记录。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
      await refresh();
    } finally {
      setWorkingId(undefined);
    }
  };
  const undo = async (changeSet: ImportExtractionChangeSet) => {
    if (
      !window.confirm(
        "撤销只会回退本次采用且未被人工编辑的内容；人工后续修改会被保留。确定继续吗？",
      )
    )
      return;
    setWorkingId(changeSet.id);
    try {
      const result = await client.importExtractions.undo(changeSet.id);
      setNotice(
        result.status === "stale"
          ? "已撤销未修改的项目；人工改动已保护并标记为待处理。"
          : "已撤销本变更集采用的内容。",
      );
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorkingId(undefined);
    }
  };
  if (!changeSets.length) return null;
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">导入候选审阅</p>
          <h2 className="mt-1 text-xl font-semibold">
            先查看差异，再采用到项目资料
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            每个候选都保留原稿章节、文本范围与置信度。采用前不会改写权威资料；可逐项编辑、拒绝或选择性采用。
          </p>
        </div>
        <span className="rounded-full bg-brand-soft px-3 py-1 text-xs text-brand">
          全部候选预览
        </span>
      </div>
      {notice && (
        <p className="mt-3 rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
      <div className="mt-4 space-y-4">
        {changeSets.map((changeSet) => {
          const draftCount = changeSet.candidates.filter(
            (candidate) => candidate.status === "draft",
          ).length;
          return (
            <article
              key={changeSet.id}
              className="rounded-xl border border-line p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{changeSet.sourceTitle}</p>
                  <p className="mt-1 text-xs text-muted">{changeSet.summary}</p>
                  <p className="mt-1 text-xs text-muted">
                    {IMPORT_EXTRACTION_STATUS_LABELS[changeSet.status] ??
                      changeSet.status}{" "}
                    · {draftCount} 条可选
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {draftCount > 0 &&
                    ["draft", "applied"].includes(changeSet.status) && (
                      <button
                        className="rounded-md bg-brand px-3 py-1.5 text-xs text-white disabled:opacity-50"
                        disabled={workingId === changeSet.id}
                        onClick={() => void adopt(changeSet)}
                      >
                        采用已选项目
                      </button>
                    )}
                  {["applied", "stale"].includes(changeSet.status) && (
                    <button
                      className="rounded-md border border-line px-3 py-1.5 text-xs text-brand disabled:opacity-50"
                      disabled={workingId === changeSet.id}
                      onClick={() => void undo(changeSet)}
                    >
                      撤销采用
                    </button>
                  )}
                </div>
              </div>
              {changeSet.errorMessage && (
                <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                  {changeSet.errorMessage}
                </p>
              )}
              <div className="mt-3 space-y-2">
                {changeSet.candidates.map((candidate) => {
                  const editing = editingId === candidate.id;
                  const selectable = candidate.status === "draft";
                  return (
                    <div
                      key={candidate.id}
                      className="rounded-lg border border-line bg-canvas p-3"
                    >
                      <div className="flex flex-wrap items-start gap-3">
                        {selectable && (
                          <input
                            className="mt-1"
                            aria-label={`选择候选 ${candidate.title}`}
                            type="checkbox"
                            checked={selectedIds.has(candidate.id)}
                            onChange={() => toggle(candidate.id)}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-white px-2 py-0.5 text-xs text-brand">
                              {IMPORT_EXTRACTION_TYPE_LABELS[candidate.type]}
                            </span>
                            <span className="text-xs text-muted">
                              {IMPORT_EXTRACTION_STATUS_LABELS[
                                candidate.status
                              ] ?? candidate.status}{" "}
                              · 置信度 {Math.round(candidate.confidence * 100)}%
                            </span>
                          </div>
                          {editing ? (
                            <div className="mt-2 space-y-2">
                              <input
                                className="w-full rounded-md border border-line bg-white px-2 py-1 text-sm"
                                aria-label="候选标题"
                                value={draft.title}
                                onChange={(event) =>
                                  setDraft((value) => ({
                                    ...value,
                                    title: event.target.value,
                                  }))
                                }
                              />
                              <textarea
                                className="min-h-20 w-full rounded-md border border-line bg-white p-2 text-sm"
                                aria-label="候选说明"
                                value={draft.summary}
                                onChange={(event) =>
                                  setDraft((value) => ({
                                    ...value,
                                    summary: event.target.value,
                                  }))
                                }
                              />
                            </div>
                          ) : (
                            <>
                              <p className="mt-2 font-medium">
                                {candidate.title}
                              </p>
                              <p className="mt-1 text-sm text-muted">
                                {candidate.summary}
                              </p>
                            </>
                          )}
                          {candidate.sourceRefs.map((ref) => (
                            <blockquote
                              key={`${ref.sourceKey}-${ref.start}`}
                              className="mt-2 border-l-2 border-brand/30 pl-2 text-xs text-muted"
                            >
                              《{ref.chapterTitle}》 {ref.start}–{ref.end}：
                              {ref.excerpt || "（原文为空）"}
                            </blockquote>
                          ))}
                          {candidate.conflictNote && (
                            <p className="mt-2 text-xs text-amber-800">
                              {candidate.conflictNote}
                            </p>
                          )}
                        </div>
                        {candidate.status !== "adopted" && (
                          <div className="flex gap-2">
                            {editing ? (
                              <>
                                <button
                                  className="rounded-md bg-brand px-2 py-1 text-xs text-white disabled:opacity-50"
                                  disabled={workingId === candidate.id}
                                  onClick={() =>
                                    void saveEdit(changeSet.id, candidate.id)
                                  }
                                >
                                  保存
                                </button>
                                <button
                                  className="rounded-md border border-line px-2 py-1 text-xs text-muted"
                                  onClick={() => setEditingId(undefined)}
                                >
                                  取消
                                </button>
                              </>
                            ) : (
                              <button
                                className="rounded-md border border-line px-2 py-1 text-xs text-brand"
                                onClick={() => startEdit(candidate)}
                              >
                                编辑
                              </button>
                            )}
                            {candidate.status === "draft" && (
                              <button
                                className="rounded-md border border-line px-2 py-1 text-xs text-muted disabled:opacity-50"
                                disabled={workingId === candidate.id}
                                onClick={() =>
                                  void setCandidateStatus(
                                    changeSet.id,
                                    candidate.id,
                                    "rejected",
                                  )
                                }
                              >
                                不采用
                              </button>
                            )}
                            {(candidate.status === "rejected" ||
                              candidate.status === "conflict") && (
                              <button
                                className="rounded-md border border-line px-2 py-1 text-xs text-brand disabled:opacity-50"
                                disabled={workingId === candidate.id}
                                onClick={() =>
                                  void setCandidateStatus(
                                    changeSet.id,
                                    candidate.id,
                                    "draft",
                                  )
                                }
                              >
                                重新审查
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ProjectActivityPanel(props: { projectId: string }) {
  const client = useStudio();
  const { data: tasks = [] } = useQuery({
    queryKey: ["project-activity", props.projectId],
    queryFn: client.tasks.list,
    refetchInterval: 15_000,
  });
  const recent = tasks
    .filter((task) => task.projectId === props.projectId)
    .slice(0, 5);
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">项目运行历史</h2>
          <p className="mt-1 text-sm text-muted">
            导入、检查、智能任务和修订相关的最近处理记录。
          </p>
        </div>
        <Link className="text-sm text-brand" to="/tasks">
          查看全部任务
        </Link>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        {recent.map((task) => (
          <article key={task.id} className="rounded-lg bg-canvas p-3 text-sm">
            <p className="truncate font-medium">{task.title}</p>
            <p className="mt-1 text-xs text-muted">
              {TASK_STATUS_LABELS[task.status] ?? "未知状态"}
            </p>
          </article>
        ))}
        {!recent.length && (
          <p className="text-sm text-muted">尚无项目运行记录。</p>
        )}
      </div>
    </section>
  );
}

function ContentVersionPanel(props: { projectId: string; onRestored(): void }) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const { data: versions = [], error } = useQuery({
    queryKey: ["content-versions", props.projectId],
    queryFn: () => client.contentVersions.list(props.projectId),
  });
  const [notice, setNotice] = useState<string>();
  const restore = async (item: DomainEntity) => {
    const payload = recordPayload(item.payload);
    const kind = String(payload["目标类型"] ?? "内容");
    if (
      !window.confirm(
        `恢复「${item.title}」将先保存当前${kind}为新的检查点。确定继续吗？`,
      )
    )
      return;
    try {
      await client.contentVersions.restore(item.id);
      setNotice("已恢复检查点，并保存恢复前内容。");
      props.onRestored();
      await queryClient.invalidateQueries({
        queryKey: ["content-versions", props.projectId],
      });
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  if (!versions.length && !error) return null;
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div>
        <h2 className="font-semibold">内容检查点</h2>
        <p className="mt-1 text-sm text-muted">
          导入或恢复前自动保存的版本；恢复时会再保存当前内容，方便回退。
        </p>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{message(error)}</p>}
      {notice && <p className="mt-3 text-sm text-brand">{notice}</p>}
      <div className="mt-3 space-y-2">
        {versions.slice(0, 8).map((item) => {
          const payload = recordPayload(item.payload);
          return (
            <article
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3 text-sm"
            >
              <div>
                <p className="font-medium">{item.title}</p>
                <p className="mt-1 text-xs text-muted">
                  {String(payload["目标类型"] ?? "内容")} ·{" "}
                  {String(payload["来源"] ?? "自动保存")}
                </p>
              </div>
              <button
                className="rounded-md border border-line px-2 py-1 text-xs text-brand"
                onClick={() => void restore(item)}
              >
                恢复此检查点
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function sourceTypeLabel(type: SourceImportPreview["sourceType"]): string {
  const labels: Record<SourceImportPreview["sourceType"], string> = {
    txt: "文本",
    markdown: "Markdown 文档",
    docx: "Word 文档",
    epub: "电子书",
    "script-json": "结构化剧本",
    draft: "草稿文本",
  };
  return labels[type];
}

const STORY_BIBLE_SIDECAR_DOMAINS = [
  "characters",
  "character-states",
  "story-bible",
  "outlines",
  "story-events",
  "foreshadowings",
  "visual-assets",
  "visual-settings",
  "assets",
  "chapter-memories",
] as const;

function StoryBibleSidecar(props: {
  projectId: string;
  context: StoryBibleContext;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [wide, setWide] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [selectedFields, setSelectedFields] = useState<Record<string, string[]>>({});
  const { data: records = [], error: recordsError } = useQuery({
    queryKey: ["story-bible-sidecar-records", props.projectId],
    queryFn: async () =>
      (
        await Promise.all(
          STORY_BIBLE_SIDECAR_DOMAINS.map((domain) =>
            client.resources.list(domain, props.projectId),
          ),
        )
      ).flat(),
  });
  const { data: changeSets = [] } = useQuery({
    queryKey: ["story-bible-change-sets", props.projectId],
    queryFn: () => client.storyBible.list(props.projectId),
  });
  const { data: staleMarks = [] } = useQuery({
    queryKey: ["story-bible-stale", props.projectId],
    queryFn: () => client.storyBible.stale(props.projectId),
  });
  const { data: preferences = [] } = useQuery({
    queryKey: ["story-bible-sidecar-preferences", props.projectId],
    queryFn: () =>
      client.resources.list("story-bible-sidecar-preferences", props.projectId),
  });
  const preference = preferences[0];
  const preferencePayload = preference ? recordPayload(preference.payload) : {};
  const pinned = Array.isArray(preferencePayload["固定标识"])
    ? preferencePayload["固定标识"].filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  useEffect(() => {
    if (!preference) return;
    setCollapsed(preferencePayload["已折叠"] === true);
    setWide(preferencePayload["宽度"] === "宽");
  }, [preference?.id, preference?.version]);
  const model = buildStoryBibleSidecar({
    context: props.context,
    records,
    changeSets,
    staleMarks,
  });
  const storyBiblePath = `/create?projectId=${encodeURIComponent(props.projectId)}${
    props.context.kind === "chapter"
      ? `&chapterId=${encodeURIComponent(props.context.id)}`
      : ""
  }`;
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["story-bible-sidecar-records", props.projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["story-bible-change-sets", props.projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["story-bible-stale", props.projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["story-bible-sidecar-preferences", props.projectId],
      }),
    ]);
  };
  const savePreference = async (patch: Record<string, unknown>) => {
    const payload = { ...preferencePayload, ...patch };
    if (preference)
      await client.resources.update("story-bible-sidecar-preferences", preference.id, {
        title: preference.title,
        payload,
        version: preference.version,
      });
    else
      await client.resources.create("story-bible-sidecar-preferences", {
        projectId: props.projectId,
        title: "Story Bible 侧栏偏好",
        payload,
      });
    await refresh();
  };
  const updateCollapsed = async (next: boolean) => {
    setCollapsed(next);
    try {
      await savePreference({ 已折叠: next, 宽度: wide ? "宽" : "常规" });
    } catch (cause) {
      setCollapsed(!next);
      setNotice(message(cause));
    }
  };
  const updateWide = async (next: boolean) => {
    setWide(next);
    try {
      await savePreference({ 已折叠: collapsed, 宽度: next ? "宽" : "常规" });
    } catch (cause) {
      setWide(!next);
      setNotice(message(cause));
    }
  };
  const togglePin = async (id: string) => {
    const next = pinned.includes(id)
      ? pinned.filter((item) => item !== id)
      : [...pinned, id];
    try {
      await savePreference({
        固定标识: next,
        已折叠: collapsed,
        宽度: wide ? "宽" : "常规",
      });
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const queue = async () => {
    if (props.context.kind !== "chapter") return;
    try {
      await client.storyBible.queue({
        projectId: props.projectId,
        chapterId: props.context.id,
      });
      setNotice("已生成待确认变更草案，请先核对字段差异。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const apply = async (item: StoryBibleChangeSet) => {
    const fields = selectedFields[item.id] ?? item.preview.fields.map((field) => field.key);
    if (!fields.length) {
      setNotice("请至少选择一个待采用字段。");
      return;
    }
    if (!window.confirm("采用后只会写入所选的章节记忆字段，不会修改正文。确定采用吗？")) return;
    try {
      await client.storyBible.apply(item.id, { fields });
      setNotice("已采用所选字段，并保留可撤销记录。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
      await refresh();
    }
  };
  const undo = async (item: StoryBibleChangeSet) => {
    if (!window.confirm("撤销会删除此变更集创建的章节记忆，不会修改正文。确定撤销吗？")) return;
    try {
      await client.storyBible.undo(item.id);
      setNotice("已撤销此变更集创建的资料。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const setStatus = async (item: StoryBibleChangeSet, status: "discarded") => {
    try {
      await client.storyBible.setStatus(item.id, status);
      setNotice("已丢弃该变更草案。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const toggleField = (item: StoryBibleChangeSet, key: string) => {
    const current = selectedFields[item.id] ?? item.preview.fields.map((field) => field.key);
    setSelectedFields((previous) => ({
      ...previous,
      [item.id]: current.includes(key)
        ? current.filter((field) => field !== key)
        : [...current, key],
    }));
  };
  const visible = model.items
    .filter((item) =>
      `${item.group} ${item.title} ${item.text}`
        .toLocaleLowerCase("zh-CN")
        .includes(query.trim().toLocaleLowerCase("zh-CN")),
    )
    .sort((left, right) => Number(pinned.includes(right.id)) - Number(pinned.includes(left.id)));
  return (
    <aside
      className={`border-t border-line bg-canvas/40 p-3 xl:border-l xl:border-t-0 ${collapsed ? "xl:w-14 xl:p-2" : wide ? "xl:w-[26rem]" : "xl:w-80"}`}
      aria-label="Story Bible 侧栏"
    >
      <div className="flex items-start justify-between gap-2">
        {!collapsed && <div>
          <p className="text-xs text-muted">当前{props.context.kind === "chapter" ? "章节" : "剧本"}上下文</p>
          <h2 className="text-sm font-semibold">Story Bible</h2>
        </div>}
        <div className="flex gap-1">
          {!collapsed && <button className="rounded px-2 py-1 text-xs text-brand hover:bg-brand-soft" onClick={() => void updateWide(!wide)}>{wide ? "窄" : "宽"}</button>}
          <button className="rounded px-2 py-1 text-xs text-brand hover:bg-brand-soft" aria-expanded={!collapsed} onClick={() => void updateCollapsed(!collapsed)}>{collapsed ? "展开" : "折叠"}</button>
        </div>
      </div>
      {!collapsed && (
        <>
          <input className="mt-3 w-full rounded border border-line bg-white px-2 py-1.5 text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索人物、伏笔、设定…" aria-label="搜索 Story Bible" />
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Link className="text-brand underline" to={storyBiblePath}>打开完整 Story Bible</Link>
            {props.context.kind === "chapter" && <button className="text-brand underline" onClick={() => void queue()}>生成变更草案</button>}
          </div>
          {notice && <p className="mt-3 rounded bg-brand-soft p-2 text-xs text-brand" role="status">{notice}</p>}
          {recordsError && <p className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-900" role="alert">本地 Story Bible 暂不可读取；正文编辑与保存不受影响。</p>}
          {model.staleMarks.length > 0 && <p className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-900">待复核：{model.staleMarks.map((mark) => mark.reason).join("；")}</p>}
          <div className="mt-3 max-h-[calc(100vh-15rem)] space-y-2 overflow-y-auto pr-1" aria-live="polite">
            {visible.map((item) => <article key={item.id} className="rounded border border-line bg-white p-2 text-xs">
              <div className="flex items-start justify-between gap-2"><div><p className="text-muted">{item.group} · {sidecarStateLabel(item.state)}</p><p className="mt-1 font-medium">{item.title}</p></div><button className="text-brand underline" onClick={() => void togglePin(item.id)}>{pinned.includes(item.id) ? "取消固定" : "固定"}</button></div>
              <p className="mt-1 whitespace-pre-wrap text-muted">{item.text}</p><p className="mt-1 text-[0.6875rem] text-muted">来源 {item.sourceId.slice(0, 8)}{item.sourceVersion !== undefined ? ` · v${item.sourceVersion}` : ""} · <Link className="text-brand underline" to={storyBiblePath}>查看来源</Link></p>
            </article>)}
            {!visible.length && <p className="rounded border border-dashed border-line p-3 text-xs text-muted">当前范围没有可关联的 Story Bible 条目。</p>}
          </div>
          {model.relevantChangeSets.length > 0 && <div className="mt-3 space-y-2"><p className="text-xs font-medium">当前章节变更集</p>{model.relevantChangeSets.map((item) => <div key={item.id} className="rounded border border-line bg-white p-2 text-xs"><p>{item.summary}</p><p className="mt-1 text-muted">章节版本 {item.sourceVersion} · {sidecarStateLabel(item.status === "draft" ? "suggested" : item.status === "applied" ? "confirmed" : item.status === "stale" ? "stale" : "authoritative")}</p>{item.conflictNotes.length > 0 && <p className="mt-1 text-amber-800">冲突：{item.conflictNotes.join("；")}</p>}{item.status === "draft" && <details className="mt-2"><summary className="cursor-pointer text-brand">查看字段差异并选择采用</summary><div className="mt-2 space-y-2">{item.preview.fields.map((field) => { const fields = selectedFields[item.id] ?? item.preview.fields.map((entry) => entry.key); return <label key={field.key} className="flex gap-2"><input type="checkbox" checked={fields.includes(field.key)} onChange={() => toggleField(item, field.key)} /><span><b>{field.key}</b>：{field.value}</span></label>; })}</div></details>}{item.status === "draft" && <div className="mt-2 flex gap-2"><button className="text-brand underline" onClick={() => void apply(item)}>采用所选字段</button><button className="text-muted underline" onClick={() => void setStatus(item, "discarded")}>丢弃</button></div>}{["applied", "stale"].includes(item.status) && <button className="mt-2 text-brand underline" onClick={() => void undo(item)}>撤销采用</button>}</div>)}</div>}
        </>
      )}
    </aside>
  );
}

function sidecarStateLabel(state: ReturnType<typeof buildStoryBibleSidecar>["items"][number]["state"]) {
  return { authoritative: "权威事实", confirmed: "人工确认", suggested: "AI 建议", stale: "来源已变化" }[state];
}

function importWarning(value: string): string {
  return /[A-Za-z]{3,}/.test(value)
    ? "导入内容存在需要人工复核的格式或结构问题。"
    : value;
}

function ChapterEditor(props: {
  projectId: string;
  chapter: Chapter;
  onSave(patch: Partial<EditableChapter>): Promise<void>;
  onReload(): void;
  onRemove(): void;
}) {
  const client = useStudio();
  const [title, setTitle] = useState(props.chapter.title);
  const [content, setContent] = useState(props.chapter.content);
  const [summary, setSummary] = useState(props.chapter.summary);
  const [details, setDetails] = useState(() =>
    chapterDetailDraft(props.chapter),
  );
  const [saving, setSaving] = useState(false);
  const [showRevision, setShowRevision] = useState(false);
  const [proposedContent, setProposedContent] = useState(props.chapter.content);
  const [rationale, setRationale] = useState("");
  const [preview, setPreview] = useState<{
    id: string;
    baseVersion: number;
    proposedContent: string;
    rationale: string;
  }>();
  const [revisionError, setRevisionError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    setTitle(props.chapter.title);
    setContent(props.chapter.content);
    setSummary(props.chapter.summary);
    setDetails(chapterDetailDraft(props.chapter));
    setProposedContent(props.chapter.content);
    setPreview(undefined);
    setRevisionError(undefined);
  }, [props.chapter]);
  const save = async () => {
    setSaving(true);
    try {
      await props.onSave({ title, summary, content, ...details });
    } finally {
      setSaving(false);
    }
  };
  const createPreview = async () => {
    setSubmitting(true);
    setRevisionError(undefined);
    try {
      const created = await client.revisions.create(
        { chapterId: props.chapter.id, proposedContent, rationale },
        crypto.randomUUID(),
      );
      setPreview(created);
    } catch (cause) {
      setRevisionError(message(cause));
    } finally {
      setSubmitting(false);
    }
  };
  const commitPreview = async () => {
    if (!preview) return;
    setSubmitting(true);
    setRevisionError(undefined);
    try {
      await client.revisions.commit(
        preview.id,
        preview.baseVersion,
        crypto.randomUUID(),
      );
      setShowRevision(false);
      await props.onReload();
    } catch (cause) {
      setRevisionError(message(cause));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="grid min-w-0 xl:grid-cols-[minmax(0,1fr)_auto]">
    <article className="flex min-w-0 flex-col">
      <header className="flex items-center justify-between border-b border-line p-4">
        <input
          className="min-w-0 border-0 text-lg font-semibold outline-none"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <div className="flex gap-2">
          <button
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted"
            onClick={() => setShowRevision((value) => !value)}
          >
            修订预览
          </button>
          <button
            className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600"
            onClick={props.onRemove}
          >
            删除本章
          </button>
          <button
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </header>
      {showRevision && (
        <section className="border-b border-line bg-brand-soft/40 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">受控修订预览</p>
              <p className="mt-1 text-xs text-muted">
                此处不会改写正文。只有确认提交且版本仍匹配时，本地服务才会在事务中应用修订。
              </p>
            </div>
            {preview && (
              <span className="rounded-full bg-white px-2 py-1 text-xs text-brand">
                等待确认
              </span>
            )}
          </div>
          <textarea
            className="mt-4 min-h-40 w-full rounded-lg border border-line bg-white p-3 font-editor text-sm leading-7"
            value={proposedContent}
            onChange={(event) => setProposedContent(event.target.value)}
            placeholder="粘贴或编辑候选改写…"
            disabled={Boolean(preview)}
          />
          <input
            className="mt-3 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
            placeholder="修订依据（可选）"
            disabled={Boolean(preview)}
          />
          {preview && (
            <div className="mt-3 grid gap-3 rounded-lg border border-line bg-white p-3 md:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-muted">当前已保存内容</p>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-editor text-sm">
                  {content}
                </pre>
              </div>
              <div>
                <p className="text-xs font-medium text-brand">候选修订</p>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-editor text-sm">
                  {preview.proposedContent}
                </pre>
              </div>
            </div>
          )}
          {revisionError && (
            <p className="mt-3 text-sm text-red-600">{revisionError}</p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            {!preview ? (
              <button
                className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={!proposedContent.trim() || submitting}
                onClick={() => void createPreview()}
              >
                {submitting ? "保存预览…" : "保存预览"}
              </button>
            ) : (
              <button
                className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={submitting}
                onClick={() => void commitPreview()}
              >
                {submitting ? "提交中…" : "确认提交修订"}
              </button>
            )}
          </div>
        </section>
      )}
      <div className="grid flex-1 grid-rows-[auto_auto_1fr] gap-3 p-5">
        <textarea
          className="min-h-20 resize-none rounded-lg border border-line p-3 text-sm"
          placeholder="本章摘要"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />
        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-sm font-medium">
            章节创作要点
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {CHAPTER_DETAIL_FIELDS.map(({ key, label, placeholder }) => (
              <label key={key} className="grid gap-1 text-sm">
                {label}
                <textarea
                  className="min-h-20 rounded-lg border border-line p-2"
                  placeholder={placeholder}
                  value={details[key]}
                  onChange={(event) =>
                    setDetails((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                />
              </label>
            ))}
          </div>
        </details>
        <textarea
          className="min-h-[460px] resize-none border-0 font-editor text-lg leading-9 outline-none"
          placeholder="开始创作本章内容…"
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
      </div>
    </article>
    <StoryBibleSidecar
      projectId={props.projectId}
      context={{
        kind: "chapter",
        id: props.chapter.id,
        title: props.chapter.title,
        content,
        version: props.chapter.version,
      }}
    />
    </div>
  );
}

const STORY_BIBLE_STATUS_LABELS: Record<string, string> = {
  queued: "等待生成",
  draft: "待确认草案",
  applied: "已采用",
  paused: "已暂停",
  skipped: "已跳过",
  discarded: "已撤销",
  stale: "已过期",
  failed: "生成失败",
};

function StoryBibleChangeSetPanel() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const location = useLocation();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const [projectId, setProjectId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [notice, setNotice] = useState<string>();
  const { data: chapters = [] } = useQuery({
    queryKey: ["story-bible-chapters", projectId],
    queryFn: () => client.chapters.list(projectId),
    enabled: Boolean(projectId),
  });
  const { data: settings } = useQuery({
    queryKey: ["story-bible-settings", projectId],
    queryFn: () => client.storyBible.settings(projectId),
    enabled: Boolean(projectId),
  });
  const { data: changeSets = [] } = useQuery({
    queryKey: ["story-bible-change-sets", projectId],
    queryFn: () => client.storyBible.list(projectId),
    enabled: Boolean(projectId),
  });
  const { data: staleMarks = [] } = useQuery({
    queryKey: ["story-bible-stale", projectId],
    queryFn: () => client.storyBible.stale(projectId),
    enabled: Boolean(projectId),
  });
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("projectId");
    if (requested && projects.some((project) => project.id === requested))
      setProjectId(requested);
  }, [location.search, projects]);
  useEffect(() => {
    if (chapterId && !chapters.some((chapter) => chapter.id === chapterId))
      setChapterId("");
  }, [chapterId, chapters]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("chapterId");
    if (requested && chapters.some((chapter) => chapter.id === requested))
      setChapterId(requested);
  }, [chapters, location.search]);
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["story-bible-settings", projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["story-bible-change-sets", projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["story-bible-stale", projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["resource", "chapter-memories", projectId],
      }),
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
    ]);
  };
  const updateAutoSuggest = async (autoSuggest: boolean) => {
    if (!projectId) return;
    setNotice(undefined);
    try {
      await client.storyBible.updateSettings(projectId, { autoSuggest });
      setNotice(
        autoSuggest
          ? "已开启：保存章节正文后会生成待确认的本地变更草案。"
          : "已关闭自动建议；仍可手动生成草案。",
      );
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const queue = async () => {
    if (!projectId || !chapterId) {
      setNotice("请先选择包含正文的章节。");
      return;
    }
    setNotice(undefined);
    try {
      const result = await client.storyBible.queue({ projectId, chapterId });
      setNotice(
        `已生成「${result.summary.slice(0, 48)}${result.summary.length > 48 ? "…" : ""}」的待确认草案。`,
      );
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const apply = async (item: StoryBibleChangeSet) => {
    if (
      !window.confirm(
        "采用后会将这份草案写入章节记忆；不会修改章节正文。确定采用吗？",
      )
    )
      return;
    try {
      await client.storyBible.apply(item.id, {});
      setNotice("已采用变更集，并保留可撤销记录。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
      await refresh();
    }
  };
  const undo = async (item: StoryBibleChangeSet) => {
    if (
      !window.confirm(
        "撤销只会删除该变更集创建的章节记忆，不会影响原有资料。确定撤销吗？",
      )
    )
      return;
    try {
      await client.storyBible.undo(item.id);
      setNotice("已撤销此变更集创建的资料。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const setStatus = async (
    item: StoryBibleChangeSet,
    status: "queued" | "paused" | "skipped" | "discarded",
  ) => {
    try {
      await client.storyBible.setStatus(item.id, status);
      setNotice(`已更新为${STORY_BIBLE_STATUS_LABELS[status]}。`);
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">故事圣经</p>
          <h1 className="mt-1 text-2xl font-semibold">可审查的章节记忆更新</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            基于已保存的章节正文生成摘要草案。采用前不会写入资料；采用后只创建可追溯的章节记忆，正文更新会使旧草案标记为待复核。
          </p>
        </div>
        <label className="flex items-center gap-2 rounded-lg bg-canvas px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={settings?.autoSuggest ?? false}
            disabled={!projectId}
            onChange={(event) => void updateAutoSuggest(event.target.checked)}
          />
          保存正文后自动建议
        </label>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className="grid gap-1 text-sm">
          项目
          <select
            className="rounded-lg border border-line px-3 py-2"
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setChapterId("");
            }}
          >
            <option value="">选择项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          章节
          <select
            className="rounded-lg border border-line px-3 py-2"
            disabled={!projectId}
            value={chapterId}
            onChange={(event) => setChapterId(event.target.value)}
          >
            <option value="">选择包含正文的章节</option>
            {chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.title}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!projectId || !chapterId}
            onClick={() => void queue()}
          >
            生成待确认草案
          </button>
        </div>
      </div>
      {notice && (
        <p className="mt-3 rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
      {staleMarks.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">待重新核对</p>
          <p className="mt-1">
            {staleMarks
              .map((mark) => mark.reason)
              .filter((value, index, values) => values.indexOf(value) === index)
              .join("；")}
          </p>
        </div>
      )}
      <div className="mt-4 space-y-2">
        {changeSets.map((item) => (
          <article key={item.id} className="rounded-xl border border-line p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{item.summary}</p>
                <p className="mt-1 text-xs text-muted">
                  章节版本 {item.sourceVersion} ·{" "}
                  {STORY_BIBLE_STATUS_LABELS[item.status] ?? "未知状态"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {item.status === "draft" && (
                  <>
                    <button
                      className="rounded-md bg-brand px-2 py-1 text-xs text-white"
                      onClick={() => void apply(item)}
                    >
                      采用
                    </button>
                    <button
                      className="rounded-md border border-line px-2 py-1 text-xs text-muted"
                      onClick={() => void setStatus(item, "paused")}
                    >
                      暂停
                    </button>
                    <button
                      className="rounded-md border border-line px-2 py-1 text-xs text-muted"
                      onClick={() => void setStatus(item, "discarded")}
                    >
                      丢弃
                    </button>
                  </>
                )}
                {item.status === "paused" && (
                  <button
                    className="rounded-md border border-line px-2 py-1 text-xs text-brand"
                    onClick={() => void setStatus(item, "queued")}
                  >
                    恢复
                  </button>
                )}
                {(item.status === "applied" || item.status === "stale") && (
                  <button
                    className="rounded-md border border-line px-2 py-1 text-xs text-brand"
                    onClick={() => void undo(item)}
                  >
                    撤销采用
                  </button>
                )}
              </div>
            </div>
            {item.conflictNotes.length > 0 && (
              <p className="mt-2 text-xs text-amber-800">
                冲突：{item.conflictNotes.join("；")}
              </p>
            )}
          </article>
        ))}
        {projectId && !changeSets.length && (
          <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">
            尚无变更草案。选择一个已写入正文的章节后生成。
          </p>
        )}
      </div>
    </section>
  );
}

function CreativeWorkspace() {
  return (
    <div className="space-y-5">
      <StoryBibleChangeSetPanel />
      <ChapterAnalysisPanel />
      <CreativeDiagnosticsPanel />
      <DomainWorkspace
        title="创作"
        domains={[
          "story",
          "characters",
          "outlines",
          "story-arcs",
          "project-skills",
          "agent-schemes",
          "inspirations",
          "memory",
          "chapter-memories",
          "character-states",
          "visual-profiles",
          "visual-settings",
          "story-events",
          "foreshadowings",
          "analysis",
          "beats",
          "highlights",
          "feasibility",
          "trends",
          "evaluations",
          "templates",
        ]}
      />
    </div>
  );
}

function ChapterAnalysisPanel() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const [projectId, setProjectId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [notice, setNotice] = useState<string>();
  const { data: chapters = [] } = useQuery({
    queryKey: ["analysis-chapters", projectId],
    queryFn: () => client.chapters.list(projectId),
    enabled: Boolean(projectId),
  });
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);
  useEffect(() => {
    if (chapterId && !chapters.some((chapter) => chapter.id === chapterId))
      setChapterId("");
  }, [chapterId, chapters]);
  const run = async () => {
    if (!chapterId) return;
    setNotice(undefined);
    try {
      const result = await client.analysis.runChapter(chapterId);
      setNotice(
        `已生成 ${result.records.length} 项章节分析，可在下方对应资料区查看。`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["resource"] }),
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      ]);
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div>
        <h2 className="font-semibold">章节自动分析</h2>
        <p className="mt-1 text-sm text-muted">
          基于已保存正文提取节拍、高光、可制作性和章节评估，结果均为可编辑的本地资料。
        </p>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className="grid gap-1 text-sm">
          项目
          <select
            className="rounded-lg border border-line px-3 py-2"
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setChapterId("");
            }}
          >
            <option value="">选择项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          章节
          <select
            className="rounded-lg border border-line px-3 py-2"
            disabled={!projectId}
            value={chapterId}
            onChange={(event) => setChapterId(event.target.value)}
          >
            <option value="">选择已写入正文的章节</option>
            {chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.title}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!chapterId}
            onClick={() => void run()}
          >
            执行章节分析
          </button>
        </div>
      </div>
      {notice && (
        <p className="mt-3 rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
    </section>
  );
}

function CreativeDiagnosticsPanel() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const { data: projects = [] } = useQuery({
    queryKey: ["creative-diagnostic-projects"],
    queryFn: client.projects.list,
  });
  const { data: caseStudies = [] } = useQuery({
    queryKey: ["creative-case-studies"],
    queryFn: client.creative.listCaseStudies,
  });
  const [projectId, setProjectId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [kinds, setKinds] = useState<CreativeDiagnosticKind[]>([
    "freshness",
    "quality_gate",
    "audience",
    "narrative_curve",
  ]);
  const [caseStudyIds, setCaseStudyIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string>();
  const { data: chapters = [] } = useQuery({
    queryKey: ["creative-diagnostic-chapters", projectId],
    queryFn: () => client.chapters.list(projectId),
    enabled: Boolean(projectId),
  });
  const { data: diagnostics = [] } = useQuery({
    queryKey: ["creative-diagnostics", projectId],
    queryFn: () => client.creative.listDiagnostics(projectId),
    enabled: Boolean(projectId),
  });
  const { data: acknowledgements = [] } = useQuery({
    queryKey: ["creative-issue-acknowledgements", projectId],
    queryFn: () => client.creative.listIssueAcknowledgements(projectId),
    enabled: Boolean(projectId),
  });
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);
  useEffect(() => {
    if (chapterId && !chapters.some((chapter) => chapter.id === chapterId))
      setChapterId("");
  }, [chapterId, chapters]);
  const toggleKind = (kind: CreativeDiagnosticKind) =>
    setKinds((items) =>
      items.includes(kind)
        ? items.filter((item) => item !== kind)
        : [...items, kind],
    );
  const run = async () => {
    if (!projectId || !kinds.length) return;
    setNotice(undefined);
    try {
      const result = await client.creative.runDiagnostics({
        projectId,
        ...(chapterId
          ? { targetKind: "chapter" as const, targetId: chapterId }
          : {}),
        kinds,
        ...(caseStudyIds.length ? { caseStudyIds } : {}),
      });
      setNotice(`已保存 ${result.diagnostics.length} 份创意诊断报告。`);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["creative-diagnostics", projectId],
        }),
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      ]);
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const acknowledge = async (diagnosticId: string, issueKey: string) => {
    if (!projectId) return;
    try {
      await client.creative.acknowledgeIssue({
        projectId,
        diagnosticId,
        issueKey,
        disposition: "accepted",
        actorLabel: "本地用户",
      });
      await queryClient.invalidateQueries({
        queryKey: ["creative-issue-acknowledgements", projectId],
      });
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const acknowledged = new Set(
    acknowledgements.map((item) => `${item.diagnosticId}:${item.issueKey}`),
  );
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div>
        <p className="text-sm text-muted">创意质量</p>
        <h2 className="mt-1 text-2xl font-semibold">可审阅的创意诊断</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          本地规则基于已保存资料生成新鲜度、反套路、质量门禁、受众模拟与叙事曲线。它们只是辅助判断，不会自动改写小说、剧本或分镜。
        </p>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="grid gap-1 text-sm">
          项目
          <select
            className="rounded-lg border border-line px-3 py-2"
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setChapterId("");
            }}
          >
            <option value="">选择项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          诊断目标
          <select
            className="rounded-lg border border-line px-3 py-2"
            disabled={!projectId}
            value={chapterId}
            onChange={(event) => setChapterId(event.target.value)}
          >
            <option value="">整个项目</option>
            {chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                章节：{chapter.title}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!projectId || !kinds.length}
            onClick={() => void run()}
          >
            生成创意诊断
          </button>
        </div>
      </div>
      <fieldset className="mt-4">
        <legend className="text-sm font-medium">诊断类型</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(
            Object.keys(CREATIVE_DIAGNOSTIC_LABELS) as CreativeDiagnosticKind[]
          ).map((kind) => (
            <label
              key={kind}
              className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                checked={kinds.includes(kind)}
                onChange={() => toggleKind(kind)}
              />
              {CREATIVE_DIAGNOSTIC_LABELS[kind]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-4">
        <p className="text-sm font-medium">参考案例（可选）</p>
        {caseStudies.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {caseStudies.map((item) => (
              <label
                key={item.id}
                className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={caseStudyIds.includes(item.id)}
                  onChange={() =>
                    setCaseStudyIds((ids) =>
                      ids.includes(item.id)
                        ? ids.filter((id) => id !== item.id)
                        : [...ids, item.id],
                    )
                  }
                />
                {item.title}
              </label>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">尚无案例，可在下方新建。</p>
        )}
      </div>
      {notice && (
        <p className="mt-4 rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {diagnostics.map((diagnostic) => (
          <article
            key={diagnostic.id}
            className="rounded-xl border border-line p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">{diagnostic.title}</p>
                <p className="mt-1 text-xs text-muted">
                  {diagnostic.targetTitle} ·{" "}
                  {CREATIVE_DIAGNOSTIC_LABELS[diagnostic.kind]}
                </p>
              </div>
              <span className="rounded-full bg-brand-soft px-2 py-1 text-xs text-brand">
                已保存
              </span>
            </div>
            <p className="mt-3 text-sm text-muted">{diagnostic.summary}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {diagnostic.scores.map((item) => (
                <span
                  key={item.label}
                  className="rounded bg-canvas px-2 py-1 text-xs"
                >
                  {item.label} {item.value.toFixed(1)}/10
                </span>
              ))}
            </div>
            {diagnostic.curve && (
              <p className="mt-3 text-xs text-muted">
                曲线：
                {diagnostic.curve.map((value) => value.toFixed(1)).join(" → ")}
              </p>
            )}
            <div className="mt-3 space-y-2 text-sm">
              {diagnostic.findings.map((item) => {
                const key = `${diagnostic.id}:${item}`;
                return (
                  <div
                    key={item}
                    className="flex items-start justify-between gap-2"
                  >
                    <p className="text-muted">{item}</p>
                    {diagnostic.kind === "quality_gate" &&
                      !acknowledged.has(key) && (
                        <button
                          className="shrink-0 rounded border border-line px-2 py-1 text-xs text-brand"
                          onClick={() => void acknowledge(diagnostic.id, item)}
                        >
                          确认知悉
                        </button>
                      )}
                    {diagnostic.kind === "quality_gate" &&
                      acknowledged.has(key) && (
                        <span className="shrink-0 text-xs text-brand">
                          已确认
                        </span>
                      )}
                  </div>
                );
              })}
            </div>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-brand">
                查看改进建议
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                {diagnostic.recommendations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </details>
          </article>
        ))}
        {projectId && !diagnostics.length && (
          <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
            选择诊断类型后生成第一份报告。
          </p>
        )}
      </div>
      <CreativeCaseStudyPanel />
    </section>
  );
}

function creativeItems(value: string): string[] {
  return value
    .split(/[；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function CreativeCaseStudyPanel() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const { data: caseStudies = [] } = useQuery({
    queryKey: ["creative-case-studies"],
    queryFn: client.creative.listCaseStudies,
  });
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [summary, setSummary] = useState("");
  const [hooks, setHooks] = useState("");
  const [riskTags, setRiskTags] = useState("");
  const [notice, setNotice] = useState<string>();
  const create = async () => {
    if (!title.trim()) return;
    try {
      await client.creative.createCaseStudy({
        title: title.trim(),
        ...(genre.trim() ? { genre: genre.trim() } : {}),
        ...(summary.trim() ? { summary: summary.trim() } : {}),
        ...(hooks.trim() ? { openingHooks: creativeItems(hooks) } : {}),
        ...(riskTags.trim() ? { riskTags: creativeItems(riskTags) } : {}),
      });
      setTitle("");
      setGenre("");
      setSummary("");
      setHooks("");
      setRiskTags("");
      setNotice("案例已保存，可在上方作为诊断参考。");
      await queryClient.invalidateQueries({
        queryKey: ["creative-case-studies"],
      });
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  return (
    <section className="mt-6 border-t border-line pt-5">
      <h3 className="font-semibold">案例库</h3>
      <p className="mt-1 text-sm text-muted">
        案例只用于提取结构参考，不会将原文或素材自动带入当前项目。
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          案例标题
          <input
            className="rounded-lg border border-line px-3 py-2"
            placeholder="例如：身份错位的开场钩子"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          题材
          <input
            className="rounded-lg border border-line px-3 py-2"
            placeholder="例如：都市情感"
            value={genre}
            onChange={(event) => setGenre(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2">
          结构摘要
          <textarea
            className="min-h-20 rounded-lg border border-line p-3"
            placeholder="记录可借鉴的结构、人物关系和叙事边界"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          开场钩子（用分号分隔）
          <input
            className="rounded-lg border border-line px-3 py-2"
            value={hooks}
            onChange={(event) => setHooks(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          风险标签（用分号分隔）
          <input
            className="rounded-lg border border-line px-3 py-2"
            value={riskTags}
            onChange={(event) => setRiskTags(event.target.value)}
          />
        </label>
      </div>
      <div className="mt-3 flex justify-end">
        <button
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={!title.trim()}
          onClick={() => void create()}
        >
          新建案例
        </button>
      </div>
      {notice && <p className="mt-3 text-sm text-brand">{notice}</p>}
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {caseStudies.map((item) => (
          <CreativeCaseStudyCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

function CreativeCaseStudyCard(props: { item: CreativeCaseStudy }) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(props.item.title);
  const [genre, setGenre] = useState(props.item.genre ?? "");
  const [summary, setSummary] = useState(props.item.summary ?? "");
  const [notice, setNotice] = useState<string>();
  const save = async () => {
    try {
      await client.creative.updateCaseStudy(props.item.id, {
        title,
        genre,
        summary,
        version: props.item.version,
      });
      setEditing(false);
      await queryClient.invalidateQueries({
        queryKey: ["creative-case-studies"],
      });
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const remove = async () => {
    if (!window.confirm(`确定删除案例「${props.item.title}」吗？`)) return;
    try {
      await client.creative.removeCaseStudy(props.item.id);
      await queryClient.invalidateQueries({
        queryKey: ["creative-case-studies"],
      });
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  return (
    <article className="rounded-xl border border-line p-3 text-sm">
      {editing ? (
        <div className="grid gap-2">
          <input
            className="rounded border border-line px-2 py-1"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <input
            className="rounded border border-line px-2 py-1"
            placeholder="题材"
            value={genre}
            onChange={(event) => setGenre(event.target.value)}
          />
          <textarea
            className="min-h-16 rounded border border-line p-2"
            placeholder="结构摘要"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </div>
      ) : (
        <>
          <p className="font-medium">{props.item.title}</p>
          <p className="mt-1 text-xs text-muted">
            {[props.item.genre, props.item.summary]
              .filter(Boolean)
              .join(" · ") || "未补充摘要"}
          </p>
        </>
      )}
      <div className="mt-3 flex gap-2">
        {editing ? (
          <button
            className="rounded border border-line px-2 py-1 text-xs text-brand"
            onClick={() => void save()}
          >
            保存修改
          </button>
        ) : (
          <button
            className="rounded border border-line px-2 py-1 text-xs text-brand"
            onClick={() => setEditing(true)}
          >
            编辑
          </button>
        )}
        <button
          className="rounded border border-line px-2 py-1 text-xs text-red-600"
          onClick={() => void remove()}
        >
          删除
        </button>
      </div>
      {notice && <p className="mt-2 text-xs text-red-600">{notice}</p>}
    </article>
  );
}

function TaskPage() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const location = useLocation();
  const projectId = new URLSearchParams(location.search).get("projectId");
  const [retryEngine, setRetryEngine] = useState<AgentEngineKind>("opencode");
  const { data: items = [], error } = useQuery({
    queryKey: ["tasks"],
    queryFn: client.tasks.list,
    refetchInterval: 15_000,
  });
  useEffect(
    () =>
      client.events.subscribe((event) => {
        if (
          event.type.startsWith("task.") ||
          event.type.startsWith("agent_session.")
        )
          void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      }),
    [client, queryClient],
  );
  const cancel = useMutation({
    mutationFn: (id: string) => client.tasks.cancel(id),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["tasks"] }),
  });
  const retry = useMutation({
    mutationFn: (id: string) =>
      client.tasks.retry(id, { engineKind: retryEngine }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["tasks"] }),
  });
  const visibleItems = projectId
    ? items.filter((item) => item.projectId === projectId)
    : items;
  return (
    <section>
      <h1 className="text-2xl font-semibold">任务</h1>
      {projectId && (
        <p className="mt-1 text-sm text-muted">正在显示当前项目的任务。</p>
      )}
      <label className="mt-4 flex max-w-xs flex-col gap-1 text-sm text-muted">
        重试使用的智能引擎
        <select
          className="rounded-md border border-line bg-surface px-3 py-2 text-ink"
          value={retryEngine}
          onChange={(event) =>
            setRetryEngine(event.target.value as AgentEngineKind)
          }
        >
          <option value="opencode">OpenCode</option>
          <option value="codex">Codex（测试版）</option>
          <option value="langgraph">LangGraph.js</option>
        </select>
      </label>
      {error && <p className="mt-4 text-sm text-red-600">{message(error)}</p>}
      <div className="mt-5 space-y-2">
        {visibleItems.map((item) => (
          <div
            key={item.id}
            className="rounded-xl border border-line bg-surface p-4"
          >
            <div className="flex justify-between">
              <span>{item.title}</span>
              <span className="text-sm text-muted">
                {TASK_STATUS_LABELS[item.status] ?? "未知状态"}
              </span>
            </div>
            <div className="mt-3 h-1.5 rounded bg-slate-100">
              <div
                className="h-full rounded bg-brand"
                style={{ width: `${item.progress * 100}%` }}
              />
            </div>
            <div className="mt-3 flex justify-end gap-2">
              {["queued", "running", "interrupted"].includes(item.status) && (
                <button
                  className="rounded-md border border-line px-2 py-1 text-xs text-muted"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(item.id)}
                >
                  取消
                </button>
              )}
              {["failed", "canceled", "interrupted"].includes(item.status) &&
                [
                  "agent.chapter_diagnostic",
                  "agent.chapter_revision",
                  "feedback.revision",
                ].includes(item.kind) && (
                  <button
                    className="rounded-md border border-line px-2 py-1 text-xs text-brand"
                    disabled={retry.isPending}
                    onClick={() => retry.mutate(item.id)}
                  >
                    重试
                  </button>
                )}
            </div>
            {item.error && (
              <p className="mt-2 text-xs text-red-600">
                {message(new Error(item.error))}
              </p>
            )}
            {agentRevisionPreview(item.result) && (
              <AgentRevisionPreviewCard
                preview={agentRevisionPreview(item.result)!}
                projectId={item.projectId}
              />
            )}
            {agentChangePreview(item.result) && (
              <AgentChangePreviewCard
                preview={agentChangePreview(item.result)!}
              />
            )}
            {agentProviderActionPreview(item.result) && (
              <AgentProviderActionPreviewCard
                preview={agentProviderActionPreview(item.result)!}
              />
            )}
            {item.result !== undefined && (
              <details className="mt-3 rounded-lg bg-slate-50 p-3">
                <summary className="cursor-pointer text-xs font-medium text-muted">
                  查看任务结果
                </summary>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                  {taskResultText(item.result)}
                </p>
              </details>
            )}
          </div>
        ))}
        {!items.length && (
          <p className="rounded-xl border border-dashed border-line p-8 text-sm text-muted">
            暂无任务。
          </p>
        )}
      </div>
    </section>
  );
}

function AgentRevisionPreviewCard(props: {
  preview: RevisionPreview;
  projectId?: string;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RevisionPreview["status"]>(
    props.preview.status,
  );
  const [notice, setNotice] = useState<string>();
  useEffect(
    () => setStatus(props.preview.status),
    [props.preview.id, props.preview.status],
  );
  const commit = useMutation({
    mutationFn: () =>
      client.revisions.commit(
        props.preview.id,
        props.preview.baseVersion,
        crypto.randomUUID(),
      ),
    onSuccess: async () => {
      setStatus("committed");
      setNotice("已采用修订。章节内容已更新，请重新打开项目查看最新版本。");
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (cause) => setNotice(message(cause)),
  });
  const discard = useMutation({
    mutationFn: () =>
      client.revisions.discard(props.preview.id, crypto.randomUUID()),
    onSuccess: async () => {
      setStatus("discarded");
      setNotice("已放弃此修订预览，章节内容没有发生改变。");
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (cause) => setNotice(message(cause)),
  });
  const statusLabel =
    {
      pending: "待确认",
      committed: "已采用",
      discarded: "已放弃",
      conflicted: "版本冲突",
    }[status] ?? "待确认";
  return (
    <section className="mt-3 rounded-lg border border-brand/30 bg-brand-soft/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink">章节修订预览</p>
          <p className="mt-1 text-xs text-muted">
            基于章节版本 {props.preview.baseVersion}{" "}
            生成；未确认前不会改动正式内容。
          </p>
        </div>
        <span className="rounded-full bg-white px-2 py-1 text-xs text-brand">
          {statusLabel}
        </span>
      </div>
      {props.preview.rationale && (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted">
          {props.preview.rationale}
        </p>
      )}
      <details className="mt-3 rounded-md bg-white/80 p-3">
        <summary className="cursor-pointer text-sm font-medium text-brand">
          查看候选正文
        </summary>
        <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-6 text-ink">
          {props.preview.proposedContent}
        </pre>
      </details>
      {status === "pending" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={commit.isPending || discard.isPending}
            onClick={() => commit.mutate()}
          >
            {commit.isPending ? "正在采用…" : "确认采用修订"}
          </button>
          <button
            className="rounded-lg border border-line px-3 py-2 text-sm text-muted disabled:opacity-50"
            disabled={commit.isPending || discard.isPending}
            onClick={() => {
              if (
                window.confirm("确定放弃此修订预览吗？章节正文不会发生改变。")
              )
                discard.mutate();
            }}
          >
            {discard.isPending ? "正在放弃…" : "放弃此预览"}
          </button>
        </div>
      )}
      {notice && <p className="mt-3 text-xs leading-5 text-muted">{notice}</p>}
      {status === "committed" && props.projectId && (
        <Link
          className="mt-3 inline-block text-xs text-brand hover:underline"
          to={`/projects/${props.projectId}`}
        >
          返回项目查看章节
        </Link>
      )}
    </section>
  );
}

function AgentChangePreviewCard(props: { preview: ChangePreview }) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState(props.preview.status);
  const [notice, setNotice] = useState<string>();
  useEffect(
    () => setStatus(props.preview.status),
    [props.preview.id, props.preview.status],
  );
  const commit = useMutation({
    mutationFn: () =>
      client.changePreviews.commit(props.preview.id, crypto.randomUUID()),
    onSuccess: async (preview) => {
      setStatus(preview.status);
      setNotice("已应用变更；所有目标均已通过版本检查并在同一事务中更新。");
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (cause) => setNotice(message(cause)),
  });
  const discard = useMutation({
    mutationFn: () =>
      client.changePreviews.discard(props.preview.id, crypto.randomUUID()),
    onSuccess: async (preview) => {
      setStatus(preview.status);
      setNotice("已放弃变更预览，正式内容没有发生改变。");
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (cause) => setNotice(message(cause)),
  });
  const statusLabel =
    {
      pending: "待确认",
      committed: "已应用",
      discarded: "已放弃",
      conflicted: "版本冲突",
    }[status] ?? "待确认";
  return (
    <section className="mt-3 rounded-lg border border-brand/30 bg-brand-soft/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink">内容变更预览</p>
          <p className="mt-1 text-xs text-muted">
            涉及 {props.preview.targets.length} 项内容；确认前不会修改正式数据。
          </p>
        </div>
        <span className="rounded-full bg-white px-2 py-1 text-xs text-brand">
          {statusLabel}
        </span>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted">
        {props.preview.rationale}
      </p>
      <div className="mt-3 space-y-2">
        {props.preview.targets.map((target, index) => (
          <details
            key={`${target.kind}-${target.id}`}
            className="rounded-md bg-white/80 p-3"
          >
            <summary className="cursor-pointer text-sm font-medium text-brand">
              变更 {index + 1} · {changeTargetLabel(target.kind)} · 基础版本{" "}
              {target.baseVersion}
            </summary>
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap font-sans text-sm leading-6 text-ink">
              {changeTargetPreviewText(target)}
            </pre>
          </details>
        ))}
      </div>
      {status === "pending" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={commit.isPending || discard.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `确认应用这 ${props.preview.targets.length} 项变更吗？系统会再次检查所有目标版本。`,
                )
              )
                commit.mutate();
            }}
          >
            {commit.isPending ? "正在应用…" : "确认应用"}
          </button>
          <button
            className="rounded-lg border border-line px-3 py-2 text-sm text-muted disabled:opacity-50"
            disabled={commit.isPending || discard.isPending}
            onClick={() => discard.mutate()}
          >
            {discard.isPending ? "正在放弃…" : "放弃此预览"}
          </button>
        </div>
      )}
      {notice && <p className="mt-3 text-xs leading-5 text-muted">{notice}</p>}
    </section>
  );
}

function AgentProviderActionPreviewCard(props: {
  preview: ProviderActionPreview;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState(props.preview.status);
  const [notice, setNotice] = useState<string>();
  useEffect(
    () => setStatus(props.preview.status),
    [props.preview.id, props.preview.status],
  );
  const execute = useMutation({
    mutationFn: () =>
      client.providerActionPreviews.execute(
        props.preview.id,
        crypto.randomUUID(),
      ),
    onSuccess: async (task) => {
      setStatus("executed");
      setNotice(`已创建远程厂商任务：${task.id.slice(0, 8)}。`);
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (cause) => setNotice(message(cause)),
  });
  const discard = useMutation({
    mutationFn: () =>
      client.providerActionPreviews.discard(
        props.preview.id,
        crypto.randomUUID(),
      ),
    onSuccess: async (preview) => {
      setStatus(preview.status);
      setNotice("已放弃厂商调用，不会产生本次调用费用。");
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (cause) => setNotice(message(cause)),
  });
  const kindLabel =
    {
      image: "图片生成",
      audio: "音频生成",
      video: "视频生成",
      remote_render: "远程渲染",
    }[props.preview.kind] ?? "远程厂商调用";
  const costUnknown = props.preview.estimatedCost === undefined;
  return (
    <section className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink">{kindLabel}调用预览</p>
          <p className="mt-1 text-xs text-muted">
            当前仅为建议；确认后才会调用远程服务并可能产生费用。
          </p>
        </div>
        <span className="rounded-full bg-white px-2 py-1 text-xs text-amber-800">
          {status === "pending"
            ? "待费用确认"
            : status === "executed"
              ? "已创建任务"
              : status === "discarded"
                ? "已放弃"
                : "已过期"}
        </span>
      </div>
      <dl className="mt-3 grid gap-1 text-sm text-muted">
        <div>
          <dt className="inline font-medium text-ink">服务商编号：</dt>
          <dd className="inline">{props.preview.providerId}</dd>
        </div>
        {props.preview.modelId && (
          <div>
            <dt className="inline font-medium text-ink">模型：</dt>
            <dd className="inline">{props.preview.modelId}</dd>
          </div>
        )}
        <div>
          <dt className="inline font-medium text-ink">预估费用：</dt>
          <dd className="inline">
            {props.preview.estimatedCost === undefined
              ? "厂商尚未返回可靠估价，以实际账单为准"
              : `${props.preview.estimatedCost.toFixed(4)} ${props.preview.currency ?? "USD"}`}
          </dd>
        </div>
      </dl>
      <details className="mt-3 rounded-md bg-white/80 p-3">
        <summary className="cursor-pointer text-sm font-medium text-amber-800">
          查看建议参数
        </summary>
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap font-sans text-sm leading-6 text-ink">
          {JSON.stringify(props.preview.parameters, null, 2)}
        </pre>
      </details>
      {status === "pending" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="rounded-lg bg-amber-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={costUnknown || execute.isPending || discard.isPending}
            onClick={() => {
              const cost =
                props.preview.estimatedCost === undefined
                  ? "费用以厂商实际账单为准"
                  : `预估费用 ${props.preview.estimatedCost.toFixed(4)} ${props.preview.currency ?? "USD"}`;
              if (window.confirm(`确认发起${kindLabel}吗？${cost}。`))
                execute.mutate();
            }}
          >
            {execute.isPending ? "正在创建任务…" : "确认并创建远程任务"}
          </button>
          <button
            className="rounded-lg border border-line px-3 py-2 text-sm text-muted disabled:opacity-50"
            disabled={execute.isPending || discard.isPending}
            onClick={() => discard.mutate()}
          >
            {discard.isPending ? "正在放弃…" : "放弃此次调用"}
          </button>
        </div>
      )}
      {status === "pending" && costUnknown && (
        <p className="mt-3 text-xs leading-5 text-amber-800">
          厂商尚未返回可靠报价，远程任务已禁用。请更新服务商报价后重新生成调用预览；在此之前不会产生媒体生成费用。
        </p>
      )}
      {notice && <p className="mt-3 text-xs leading-5 text-muted">{notice}</p>}
    </section>
  );
}

function changeTargetLabel(kind: string): string {
  return (
    {
      project: "项目",
      chapter: "章节",
      character: "角色",
      outline: "故事大纲",
      story_bible: "故事圣经",
      episode: "分集",
      script: "剧本",
      scene: "场景",
      shot: "镜头",
    }[kind] ?? "内容"
  );
}

function changeTargetPreviewText(
  target: ChangePreview["targets"][number],
): string {
  const patch = target.patch as Record<string, unknown> | undefined;
  if (patch && typeof patch.content === "string") return patch.content;
  if (
    target.displayDiff &&
    typeof target.displayDiff === "object" &&
    !Array.isArray(target.displayDiff)
  ) {
    const diff = target.displayDiff as Record<string, unknown>;
    if (typeof diff.proposedContent === "string") return diff.proposedContent;
  }
  return JSON.stringify(target.displayDiff ?? target.patch, null, 2);
}
type ResourceFieldKind = "text" | "multiline" | "number" | "switch";
type ResourceField = {
  key: string;
  label: string;
  kind: ResourceFieldKind;
  placeholder?: string;
};
type ResourceDefinition = {
  description: string;
  titleLabel: string;
  projectRequired?: boolean;
  fields: ResourceField[];
};

const shortText = (
  key: string,
  label: string,
  placeholder?: string,
): ResourceField => ({
  key,
  label,
  kind: "text",
  placeholder,
});
const longText = (
  key: string,
  label: string,
  placeholder?: string,
): ResourceField => ({
  key,
  label,
  kind: "multiline",
  placeholder,
});
const numberField = (key: string, label: string): ResourceField => ({
  key,
  label,
  kind: "number",
});

const RESOURCE_DEFINITIONS: Record<string, ResourceDefinition> = {
  story: {
    description: "记录世界观、主题和叙事方向，供后续创作与诊断使用。",
    titleLabel: "故事资料名称",
    fields: [
      longText("故事前提", "故事前提"),
      longText("主题", "主题"),
      longText("世界观", "世界观"),
      longText("叙事方向", "叙事方向"),
    ],
  },
  characters: {
    description: "建立人物动机、关系、成长和视觉描述。",
    titleLabel: "角色姓名",
    fields: [
      shortText("角色定位", "角色定位", "主角、反派或配角"),
      longText("身份背景", "身份背景"),
      longText("性格", "性格"),
      longText("欲望与目标", "欲望与目标"),
      longText("秘密与弱点", "秘密与弱点"),
      longText("人物弧光", "人物弧光"),
      longText("视觉描述", "视觉描述"),
    ],
  },
  "character-states": {
    description: "按章节记录角色的处境、情绪、关系与秘密变化。",
    titleLabel: "角色状态名称",
    fields: [
      shortText("关联角色", "关联角色"),
      shortText("关联章节", "关联章节"),
      longText("当前状态", "当前状态"),
      longText("情绪与关系变化", "情绪与关系变化"),
      longText("连续性备注", "连续性备注"),
    ],
  },
  "visual-profiles": {
    description: "为角色锁定外观、服装、声线和视觉生成参考。",
    titleLabel: "角色视觉档案名称",
    fields: [
      shortText("关联角色", "关联角色"),
      longText("外观提示", "外观提示"),
      longText("服装与发型", "服装与发型"),
      longText("色彩与气质", "色彩与气质"),
      longText("负面提示与声线", "负面提示与声线"),
    ],
  },
  "visual-settings": {
    description: "定义世界、地点、物件和整体风格的可视化标准。",
    titleLabel: "视觉设定名称",
    fields: [
      shortText("设定类型", "设定类型", "世界、地点、风格或物件"),
      longText("视觉提示", "视觉提示"),
      longText("负面提示", "负面提示"),
      longText("参考与备注", "参考与备注"),
    ],
  },
  outlines: {
    description: "管理全书与章节大纲，明确冲突和节奏。",
    titleLabel: "大纲标题",
    fields: [
      shortText("大纲层级", "大纲层级", "全书或章节"),
      numberField("排序", "排序"),
      longText("内容", "内容"),
    ],
  },
  "story-arcs": {
    description: "规划卷、单元和阶段的冲突、章节范围及回收伏笔。",
    titleLabel: "故事弧标题",
    fields: [
      shortText("层级", "层级", "卷、单元或阶段"),
      shortText("父级故事弧", "父级故事弧"),
      numberField("起始章节", "起始章节"),
      numberField("结束章节", "结束章节"),
      longText("核心冲突", "核心冲突"),
      longText("高光与伏笔回收", "高光与伏笔回收"),
    ],
  },
  "story-events": {
    description: "维护故事时间线中的关键事件与相关角色。",
    titleLabel: "故事事件标题",
    fields: [
      shortText("事件类型", "事件类型"),
      shortText("关联章节", "关联章节"),
      numberField("排序", "排序"),
      longText("事件描述", "事件描述"),
      longText("相关角色", "相关角色"),
    ],
  },
  foreshadowings: {
    description: "跟踪伏笔的埋设、回收计划和状态。",
    titleLabel: "伏笔标题",
    fields: [
      shortText("埋设章节", "埋设章节"),
      shortText("回收章节", "回收章节"),
      shortText("状态", "状态", "计划、已埋设、已回收或放弃"),
      longText("伏笔说明", "伏笔说明"),
      longText("回收计划", "回收计划"),
    ],
  },
  "chapter-memories": {
    description: "把已完成章节中的事件、人物变化和视觉要素沉淀为长期记忆。",
    titleLabel: "章节记忆名称",
    fields: [
      shortText("关联章节", "关联章节"),
      longText("章节摘要", "章节摘要"),
      longText("重要事件", "重要事件"),
      longText("人物变化与秘密", "人物变化与秘密"),
      longText("新增或回收伏笔", "新增或回收伏笔"),
    ],
  },
  "story-bible": {
    description: "维护跨章节的一致性变更、冲突和采用记录。",
    titleLabel: "变更集名称",
    fields: [
      shortText("关联章节", "关联章节"),
      shortText("状态", "状态", "草案、待确认或已采用"),
      longText("变更说明", "变更说明"),
      longText("冲突与处理", "冲突与处理"),
    ],
  },
  "story-bible-settings": {
    description: "控制故事圣经的更新策略与人工确认规则。",
    titleLabel: "故事圣经设置名称",
    fields: [
      shortText("更新方式", "更新方式", "手动确认或自动建议"),
      longText("更新规则", "更新规则"),
    ],
  },
  "story-bible-stale": {
    description: "记录章节变化后需要重新检查的故事圣经和诊断结果。",
    titleLabel: "待更新提醒名称",
    fields: [
      shortText("关联章节", "关联章节"),
      shortText("提醒目标", "提醒目标"),
      longText("原因", "原因"),
      shortText("处理状态", "处理状态"),
    ],
  },
  memory: {
    description: "沉淀章节记忆、角色状态、时间线和伏笔。",
    titleLabel: "记忆条目名称",
    fields: [
      shortText("记忆类型", "记忆类型", "章节、角色、事件或伏笔"),
      shortText("关联章节", "关联章节"),
      longText("内容", "内容"),
      longText("连续性备注", "连续性备注"),
    ],
  },
  analysis: {
    description: "记录节拍、高光、趋势与可制作性分析。",
    titleLabel: "分析名称",
    fields: [
      shortText("分析类型", "分析类型", "节拍、高光、趋势或可制作性"),
      shortText("关联章节", "关联章节"),
      numberField("评分", "评分"),
      longText("发现", "发现"),
      longText("建议", "建议"),
    ],
  },
  beats: {
    description: "按章节维护钩子、冲突、反转、情绪和悬念节拍。",
    titleLabel: "节拍标题",
    fields: [
      shortText("关联章节", "关联章节"),
      shortText("节拍类型", "节拍类型"),
      numberField("戏剧强度", "戏剧强度"),
      numberField("视觉强度", "视觉强度"),
      longText("节拍描述", "节拍描述"),
    ],
  },
  highlights: {
    description: "记录爽点、身份揭示、反击等高光分析与优化建议。",
    titleLabel: "高光分析名称",
    fields: [
      shortText("关联章节", "关联章节"),
      numberField("高光评分", "高光评分"),
      longText("高光类型", "高光类型"),
      longText("总结与建议", "总结与建议"),
    ],
  },
  feasibility: {
    description: "评估角色、动作、场景与镜头在智能视频生产中的可控性。",
    titleLabel: "可制作性分析名称",
    fields: [
      shortText("关联章节", "关联章节"),
      numberField("综合评分", "综合评分"),
      longText("制作风险", "制作风险"),
      longText("优化建议", "优化建议"),
    ],
  },
  trends: {
    description: "汇总全项目的钩子、冲突、反转和情绪趋势。",
    titleLabel: "趋势分析名称",
    fields: [
      longText("趋势总结", "趋势总结"),
      longText("行动建议", "行动建议"),
    ],
  },
  evaluations: {
    description: "保存章节或项目的多维评估、问题和改进建议。",
    titleLabel: "评估名称",
    fields: [
      shortText("关联章节", "关联章节"),
      numberField("总分", "总分"),
      longText("发现的问题", "发现的问题"),
      longText("改进建议", "改进建议"),
    ],
  },
  "project-skills": {
    description: "为项目维护可复用的节奏、对白、提示和交付技能。",
    titleLabel: "技能名称",
    fields: [
      shortText("技能类别", "技能类别"),
      numberField("优先级", "优先级"),
      longText("使用说明", "使用说明"),
      longText("技能内容", "技能内容"),
    ],
  },
  "agent-schemes": {
    description: "把智能助手、项目技能和模型选择组合为可复用的方案。",
    titleLabel: "智能助手方案名称",
    fields: [
      shortText("主智能助手", "主智能助手"),
      longText("协作智能助手", "协作智能助手"),
      longText("引用技能", "引用技能"),
      longText("模型与工作说明", "模型与工作说明"),
    ],
  },
  inspirations: {
    description: "收藏开场、关系、冲突、反转、悬念和视觉灵感。",
    titleLabel: "灵感名称",
    fields: [
      shortText("灵感类型", "灵感类型"),
      shortText("来源", "来源"),
      longText("模式与用法", "模式与用法"),
      longText("风险提示", "风险提示"),
    ],
  },
  templates: {
    description: "沉淀可复用的创作、诊断和交付模板。",
    titleLabel: "模板名称",
    projectRequired: false,
    fields: [
      shortText("用途", "用途"),
      longText("模板正文", "模板正文"),
      longText("变量说明", "变量说明"),
    ],
  },
  adaptations: {
    description: "将小说项目组织为可执行的短剧改编方案。",
    titleLabel: "改编项目名称",
    fields: [
      shortText("改编方向", "改编方向"),
      numberField("目标集数", "目标集数"),
      longText("改编简介", "改编简介"),
      longText("改编策略", "改编策略"),
    ],
  },
  episodes: {
    description: "管理分集目标、冲突、悬念和制作状态。",
    titleLabel: "分集标题",
    fields: [
      numberField("集数", "集数"),
      shortText("关联改编项目", "关联改编项目"),
      longText("分集简介", "分集简介"),
      longText("结尾悬念", "结尾悬念"),
    ],
  },
  scripts: {
    description: "保存分集剧本和结构化改写备注。",
    titleLabel: "剧本名称",
    fields: [
      shortText("关联分集", "关联分集"),
      longText("剧本内容", "剧本内容"),
      longText("审查意见", "审查意见"),
    ],
  },
  scenes: {
    description: "拆分剧本场景，记录地点、人物、动作与对白。",
    titleLabel: "场景标题",
    fields: [
      shortText("关联剧本", "关联剧本"),
      shortText("地点与时间", "地点与时间"),
      longText("场景动作", "场景动作"),
      longText("对白与备注", "对白与备注"),
    ],
  },
  shots: {
    description: "规划镜头语言、提示词、时长和审查意见。",
    titleLabel: "分镜标题",
    fields: [
      shortText("关联场景", "关联场景"),
      numberField("镜头序号", "镜头序号"),
      longText("镜头描述", "镜头描述"),
      longText("生成提示", "生成提示"),
      longText("审查备注", "审查备注"),
    ],
  },
  "shot-stills": {
    description: "为一个分镜维护静帧候选，并在人工确认后采用其中一个版本。",
    titleLabel: "静帧候选名称",
    fields: [
      shortText("关联分镜", "关联分镜"),
      longText("生成提示", "生成提示"),
      longText("画面说明", "画面说明"),
      shortText("采用状态", "采用状态", "未采用或已采用"),
    ],
  },
  "visual-assets": {
    description: "维护角色、场景或道具的视觉资产版本，可采用并锁定已确认版本。",
    titleLabel: "视觉资产名称",
    fields: [
      shortText("资产类型", "资产类型", "角色、场景、道具或风格"),
      shortText("关联对象", "关联对象"),
      shortText("资产版本", "资产版本", "例如：v1 或雨夜版"),
      longText("视觉说明", "视觉说明"),
      shortText("采用状态", "采用状态", "未采用或已采用"),
      shortText("锁定状态", "锁定状态", "未锁定或已锁定"),
      shortText("权利状态", "权利状态", "已授权、待核验或受限"),
      shortText("费用状态", "费用状态", "已核对或未知"),
      shortText("服务状态", "服务状态", "可用、不可用或离线"),
      shortText("设定状态", "设定状态", "当前或已过期"),
    ],
  },
  assets: {
    description: "归档项目素材，并保留来源、用途和版权备注。",
    titleLabel: "素材名称",
    fields: [
      shortText("素材类型", "素材类型"),
      shortText("来源", "来源"),
      longText("用途与备注", "用途与备注"),
      longText("版权说明", "版权说明"),
    ],
  },
  rights: {
    description: "维护素材、原稿和交付内容的权利来源、允许用途与核验结论。",
    titleLabel: "版权声明名称",
    fields: [
      shortText("权利状态", "权利状态", "已授权、待核验或受限"),
      shortText("来源文件", "来源文件"),
      longText("允许用途", "允许用途"),
      longText("备注", "备注"),
    ],
  },
  "content-versions": {
    description: "保存导入、修订或人工编辑前的可恢复内容检查点。",
    titleLabel: "内容检查点名称",
    fields: [
      shortText("目标类型", "目标类型"),
      shortText("目标标识", "目标标识"),
      longText("内容", "内容"),
      longText("来源", "来源"),
    ],
  },
  image: {
    description: "管理图片生成任务、参考和采用结果。",
    titleLabel: "图片任务名称",
    fields: [
      shortText("关联对象", "关联对象"),
      longText("生成提示", "生成提示"),
      longText("负面提示", "负面提示"),
      shortText("结果状态", "结果状态"),
    ],
  },
  audio: {
    description: "管理音色、音轨、配乐和采用状态。",
    titleLabel: "音频条目名称",
    fields: [
      shortText("音频类型", "音频类型", "音色、配音、配乐或音效"),
      shortText("关联分集", "关联分集"),
      longText("制作说明", "制作说明"),
      shortText("采用状态", "采用状态"),
    ],
  },
  video: {
    description: "记录视频生成任务、结果比较和采用版本。",
    titleLabel: "视频任务名称",
    fields: [
      shortText("关联分镜", "关联分镜"),
      longText("生成提示", "生成提示"),
      shortText("任务状态", "任务状态"),
      longText("结果与选择理由", "结果与选择理由"),
    ],
  },
  renders: {
    description: "保存成片渲染的预检结果、提交记录和最终归档信息。",
    titleLabel: "渲染任务名称",
    fields: [
      shortText("关联分集", "关联分集"),
      shortText("渲染状态", "渲染状态"),
      longText("预检结果", "预检结果"),
      longText("说明", "说明"),
    ],
  },
  animatics: {
    description: "汇总分镜、声音和节奏，形成可审阅的动态分镜。",
    titleLabel: "动态分镜名称",
    fields: [
      shortText("关联分集", "关联分集"),
      shortText("审阅状态", "审阅状态"),
      longText("时间线说明", "时间线说明"),
      longText("审阅意见", "审阅意见"),
    ],
  },
  quality: {
    description: "记录质量门禁、问题、返工和确认处理。",
    titleLabel: "质量检查名称",
    fields: [
      shortText("关联分集", "关联分集"),
      shortText("严重程度", "严重程度"),
      longText("问题描述", "问题描述"),
      longText("返工方案", "返工方案"),
    ],
  },
  compliance: {
    description: "维护合规规则、预检结果和处理记录。",
    titleLabel: "合规检查名称",
    fields: [
      shortText("规则来源", "规则来源"),
      shortText("检查状态", "检查状态"),
      longText("风险与依据", "风险与依据"),
      longText("处理说明", "处理说明"),
    ],
  },
  localization: {
    description: "管理字幕、译文、配音版本和本地化采用结果。",
    titleLabel: "本地化版本名称",
    fields: [
      shortText("目标语言", "目标语言"),
      shortText("关联分集", "关联分集"),
      longText("字幕与译文", "字幕与译文"),
      shortText("采用状态", "采用状态"),
    ],
  },
  review: {
    description: "汇集离线或云端审片包、评论和决策。",
    titleLabel: "审片包名称",
    fields: [
      shortText("审片方式", "审片方式"),
      shortText("审片状态", "审片状态"),
      longText("评论", "评论"),
      longText("决策与跟进", "决策与跟进"),
    ],
  },
  delivery: {
    description: "管理平台交付配置、创意变体、预检和导出记录。",
    titleLabel: "交付任务名称",
    fields: [
      shortText("目标平台", "目标平台"),
      shortText("交付状态", "交付状态"),
      longText("预检结果", "预检结果"),
      longText("交付说明", "交付说明"),
    ],
  },
  providers: {
    description:
      "配置厂商 API 或开源模型服务。图片调用协议可填“OpenAI 兼容”或“Stable Diffusion WebUI”；若供智能助手使用，服务类型填“智能模型”，调用协议填“OpenAI 兼容文本”、Anthropic 或 Google。密钥仅保存凭据引用，保存后可测试连接或设为智能助手模型。",
    titleLabel: "服务商名称",
    projectRequired: false,
    fields: [
      shortText("服务类型", "服务类型"),
      shortText("模型名称", "模型名称"),
      shortText("服务地址", "服务地址"),
      shortText("调用协议", "OpenAI 兼容或 Stable Diffusion WebUI"),
      shortText("凭据引用", "凭据引用"),
    ],
  },
  settings: {
    description: "保存本地工作台偏好、预算和生成策略。",
    titleLabel: "设置名称",
    projectRequired: false,
    fields: [
      shortText("设置类别", "设置类别"),
      longText("设置内容", "设置内容"),
    ],
  },
  backup: {
    description: "记录本地备份、恢复演练和数据保留策略。",
    titleLabel: "备份记录名称",
    projectRequired: false,
    fields: [shortText("备份状态", "备份状态"), longText("说明", "说明")],
  },
  cloud: {
    description: "管理云端账户、快照、草稿交接和同步记录。",
    titleLabel: "云端连接名称",
    projectRequired: false,
    fields: [shortText("连接状态", "连接状态"), longText("说明", "说明")],
  },
  agents: {
    description: "管理智能助手角色、工作流方案和可用范围。",
    titleLabel: "智能助手名称",
    fields: [
      shortText("职责", "职责"),
      longText("工作指引", "工作指引"),
      longText("允许工具与限制", "允许工具与限制"),
    ],
  },
};

function resourceDefinition(domain: string): ResourceDefinition {
  return (
    RESOURCE_DEFINITIONS[domain] ?? {
      description: "管理此功能域的项目资料。",
      titleLabel: "条目名称",
      fields: [longText("说明", "说明")],
    }
  );
}

function recordPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function fieldValue(value: unknown, kind: ResourceFieldKind): string | boolean {
  if (kind === "switch") return Boolean(value);
  return value === undefined || value === null ? "" : String(value);
}

function templateVariableNames(value: string): string[] {
  return [
    ...new Set(
      [...value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)]
        .map((match) => match[1].trim())
        .filter(Boolean),
    ),
  ];
}

function DomainWorkspace(props: {
  title: string;
  domains: string[];
  projectId?: string;
  parentId?: string;
  parentRequired?: boolean;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [domain, setDomain] = useState(props.domains[0]);
  const definition = resourceDefinition(domain);
  const [selectedProjectId, setSelectedProjectId] = useState(
    props.projectId ?? "",
  );
  const effectiveProjectId = props.projectId ?? selectedProjectId;
  const [editor, setEditor] = useState<DomainEntity | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [basePayload, setBasePayload] = useState<Record<string, unknown>>({});
  const [file, setFile] = useState<{ token: string; name: string }>();
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [actionNotice, setActionNotice] = useState<string>();
  const [templateRunner, setTemplateRunner] = useState<DomainEntity>();
  const [templateValues, setTemplateValues] = useState<Record<string, string>>(
    {},
  );
  const [templateResult, setTemplateResult] = useState<string>();
  const [templateMissing, setTemplateMissing] = useState<string[]>([]);
  const [runningTemplate, setRunningTemplate] = useState(false);
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const { data: items = [], error } = useQuery({
    queryKey: ["resource", domain, effectiveProjectId, props.parentId],
    queryFn: () =>
      client.resources.list(
        domain,
        effectiveProjectId || undefined,
        props.parentId,
      ),
  });
  useEffect(() => {
    setDomain(props.domains[0]);
    setEditor(null);
    setFile(undefined);
  }, [props.domains]);
  useEffect(() => {
    if (
      definition.projectRequired !== false &&
      !props.projectId &&
      !selectedProjectId &&
      projects[0]
    )
      setSelectedProjectId(projects[0].id);
  }, [
    definition.projectRequired,
    props.projectId,
    selectedProjectId,
    projects,
  ]);
  const openEditor = (item: DomainEntity | "new") => {
    const payload = item === "new" ? {} : recordPayload(item.payload);
    setEditor(item);
    setTitle(item === "new" ? "" : item.title);
    setBasePayload(payload);
    setDraft(
      Object.fromEntries(
        definition.fields.map((field) => [
          field.key,
          fieldValue(payload[field.key], field.kind),
        ]),
      ),
    );
    setFile(undefined);
    setActionError(undefined);
    setActionNotice(undefined);
  };
  const chooseFile = async () => {
    const selected = await window.desktop.pickFiles({ multiple: false });
    const first = selected?.[0];
    if (!first) return;
    setFile(first);
    if (!title.trim()) setTitle(first.name);
  };
  const save = async () => {
    if (!editor || !title.trim()) return;
    const projectId = props.projectId ?? selectedProjectId;
    if (definition.projectRequired !== false && !projectId) {
      setActionError("请先选择所属项目。");
      return;
    }
    if (props.parentRequired && !props.parentId) {
      setActionError("请先选择上级条目。");
      return;
    }
    const payload: Record<string, unknown> = { ...basePayload };
    for (const field of definition.fields) {
      const value = draft[field.key];
      payload[field.key] =
        field.kind === "number"
          ? value === "" || value === undefined
            ? undefined
            : Number(value)
          : value;
    }
    setSaving(true);
    setActionError(undefined);
    setActionNotice(undefined);
    try {
      if (editor === "new") {
        await client.resources.create(domain, {
          title: title.trim(),
          projectId: projectId || undefined,
          parentId: props.parentId,
          payload,
          ...(file &&
          ["assets", "visual-assets", "shot-stills"].includes(domain)
            ? { capabilityToken: file.token }
            : {}),
        });
      } else {
        await client.resources.update(domain, editor.id, {
          title: title.trim(),
          payload,
          version: editor.version,
        });
      }
      setEditor(null);
      setFile(undefined);
      void queryClient.invalidateQueries({ queryKey: ["resource", domain] });
    } catch (cause) {
      setActionError(message(cause));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (item: DomainEntity) => {
    if (!window.confirm(`删除「${item.title}」吗？`)) return;
    try {
      await client.resources.remove(domain, item.id);
      void queryClient.invalidateQueries({ queryKey: ["resource", domain] });
    } catch (cause) {
      setActionError(message(cause));
    }
  };
  const testProvider = async (item: DomainEntity) => {
    setActionError(undefined);
    setActionNotice(undefined);
    try {
      const result = await client.providers.testConnection(item.id);
      setActionNotice(`${item.title}：${result.message}`);
      void queryClient.invalidateQueries({
        queryKey: ["resource", "providers"],
      });
    } catch (cause) {
      setActionError(message(cause));
    }
  };
  const activateProviderForAgent = async (item: DomainEntity) => {
    setActionError(undefined);
    setActionNotice(undefined);
    try {
      const result = await client.providers.activateForAgent(item.id);
      setActionNotice(`${item.title}：${result.message}`);
      void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
    } catch (cause) {
      setActionError(message(cause));
    }
  };
  const adopt = async (item: DomainEntity) => {
    setActionError(undefined);
    try {
      if (domain === "shot-stills") await client.visuals.adoptStill(item.id);
      else if (domain === "visual-assets")
        await client.visuals.adoptVisualAsset(item.id);
      else if (domain === "localization")
        await client.localization.adopt(item.id);
      else return;
      void queryClient.invalidateQueries({ queryKey: ["resource", domain] });
    } catch (cause) {
      setActionError(message(cause));
    }
  };
  const exportSubtitles = async (item: DomainEntity, format: "srt" | "vtt") => {
    setActionError(undefined);
    setActionNotice(undefined);
    try {
      const document = await client.localization.subtitles(item.id, format);
      const saved = await window.desktop.saveTextFile({
        suggestedName: document.fileName,
        content: document.content,
      });
      setActionNotice(saved.saved ? "字幕文件已导出。" : "已取消字幕导出。");
    } catch (cause) {
      setActionError(message(cause));
    }
  };
  const exportDelivery = async (item: DomainEntity) => {
    setActionError(undefined);
    setActionNotice(undefined);
    try {
      const document = await client.delivery.export(item.id);
      const saved = await window.desktop.saveTextFile({
        suggestedName: document.fileName,
        content: document.content,
      });
      setActionNotice(
        saved.saved ? "交付清单已导出。" : "已取消交付清单导出。",
      );
    } catch (cause) {
      setActionError(message(cause));
    }
  };
  const lockVisualAsset = async (item: DomainEntity) => {
    setActionError(undefined);
    try {
      await client.visuals.lockVisualAsset(item.id);
      void queryClient.invalidateQueries({ queryKey: ["resource", domain] });
    } catch (cause) {
      setActionError(message(cause));
    }
  };
  const openTemplateRunner = (item: DomainEntity) => {
    const body = String(recordPayload(item.payload)["模板正文"] ?? "");
    setTemplateRunner(item);
    setTemplateValues(
      Object.fromEntries(templateVariableNames(body).map((name) => [name, ""])),
    );
    setTemplateResult(undefined);
    setTemplateMissing([]);
    setActionError(undefined);
  };
  const runTemplate = async () => {
    if (!templateRunner) return;
    setRunningTemplate(true);
    setActionError(undefined);
    try {
      const result = await client.templates.run(templateRunner.id, {
        projectId: effectiveProjectId || undefined,
        variables: templateValues,
      });
      setTemplateResult(result.rendered);
      setTemplateMissing(result.missing);
      void queryClient.invalidateQueries({
        queryKey: ["resource", "template-runs"],
      });
    } catch (cause) {
      setActionError(message(cause));
    } finally {
      setRunningTemplate(false);
    }
  };
  return (
    <section>
      <p className="text-sm text-muted">{props.title}资料库</p>
      <h1 className="mt-1 text-2xl font-semibold">{domainLabel(domain)}</h1>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{definition.description}</p>
        <button
          className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white"
          onClick={() => openEditor("new")}
        >
          新建{domainLabel(domain)}
        </button>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {props.domains.map((item) => (
          <button
            key={item}
            className={`rounded-full px-3 py-1.5 text-sm ${domain === item ? "bg-brand text-white" : "bg-surface text-muted ring-1 ring-line"}`}
            onClick={() => {
              setDomain(item);
              setEditor(null);
            }}
          >
            {domainLabel(item)}
          </button>
        ))}
      </div>
      {!props.projectId && (
        <div className="mt-5 rounded-2xl border border-line bg-surface p-4">
          <label className="grid max-w-sm gap-1 text-sm">
            所属项目
            <select
              className="rounded-lg border border-line px-3 py-2"
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
            >
              {!definition.projectRequired && (
                <option value="">全局设置</option>
              )}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {editor && (
        <section className="mt-5 rounded-2xl border border-brand bg-brand-soft/30 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">
                {editor === "new"
                  ? `新建${domainLabel(domain)}`
                  : `编辑${domainLabel(domain)}`}
              </h2>
              <p className="mt-1 text-sm text-muted">
                所有字段均会随项目安全保存。
              </p>
            </div>
            <button
              className="text-sm text-muted hover:text-brand"
              onClick={() => setEditor(null)}
            >
              取消
            </button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              {definition.titleLabel}
              <input
                className="rounded-lg border border-line bg-white px-3 py-2"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            {definition.fields.map((field) => (
              <label
                key={field.key}
                className={`grid gap-1 text-sm ${field.kind === "multiline" ? "md:col-span-2" : ""}`}
              >
                {field.label}
                {field.kind === "multiline" ? (
                  <textarea
                    className="min-h-24 rounded-lg border border-line bg-white p-3"
                    placeholder={field.placeholder}
                    value={String(draft[field.key] ?? "")}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                  />
                ) : field.kind === "switch" ? (
                  <input
                    className="h-4 w-4"
                    type="checkbox"
                    checked={Boolean(draft[field.key])}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        [field.key]: event.target.checked,
                      }))
                    }
                  />
                ) : (
                  <input
                    className="rounded-lg border border-line bg-white px-3 py-2"
                    type={field.kind === "number" ? "number" : "text"}
                    placeholder={field.placeholder}
                    value={String(draft[field.key] ?? "")}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                  />
                )}
              </label>
            ))}
          </div>
          {["assets", "visual-assets", "shot-stills"].includes(domain) &&
            editor === "new" && (
              <div className="mt-4 rounded-lg border border-dashed border-line bg-white p-3">
                <button
                  className="rounded-lg border border-line px-3 py-2 text-sm text-muted"
                  onClick={() => void chooseFile()}
                >
                  {file ? `已选择：${file.name}` : "选择本地文件"}
                </button>
                <p className="mt-2 text-xs text-muted">
                  文件路径不会暴露给界面，仅向本地服务授予一次性只读权限。
                </p>
              </div>
            )}
          {actionError && (
            <p className="mt-3 text-sm text-red-600">{actionError}</p>
          )}
          <div className="mt-4 flex justify-end">
            <button
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={!title.trim() || saving}
              onClick={() => void save()}
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </section>
      )}
      {templateRunner && (
        <section className="mt-5 rounded-2xl border border-brand bg-brand-soft/30 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">
                运行模板：{templateRunner.title}
              </h2>
              <p className="mt-1 text-sm text-muted">
                填写变量后仅完成模板变量替换；这不是模型生成，结果会保存在项目记录中，不会自动写入正文。
              </p>
            </div>
            <button
              className="text-sm text-muted hover:text-brand"
              onClick={() => setTemplateRunner(undefined)}
            >
              关闭
            </button>
          </div>
          {Object.keys(templateValues).length ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {Object.keys(templateValues).map((name) => (
                <label key={name} className="grid gap-1 text-sm">
                  {name}
                  <input
                    className="rounded-lg border border-line bg-white px-3 py-2"
                    value={templateValues[name]}
                    onChange={(event) =>
                      setTemplateValues((current) => ({
                        ...current,
                        [name]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">
              此模板没有变量，可直接运行。
            </p>
          )}
          {templateMissing.length > 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
              尚未填写：{templateMissing.join("、")}。对应位置会以空文本渲染。
            </p>
          )}
          {templateResult !== undefined && (
            <textarea
              className="mt-3 min-h-40 w-full rounded-lg border border-line bg-white p-3 font-editor text-sm"
              value={templateResult}
              readOnly
            />
          )}
          <div className="mt-4 flex justify-end">
            <button
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={runningTemplate}
              onClick={() => void runTemplate()}
            >
              {runningTemplate ? "正在运行…" : "运行模板"}
            </button>
          </div>
        </section>
      )}
      {error && <p className="mt-4 text-sm text-red-600">{message(error)}</p>}
      {actionError && !editor && (
        <p className="mt-4 text-sm text-red-600">{actionError}</p>
      )}
      {actionNotice && (
        <p className="mt-4 text-sm text-brand">{actionNotice}</p>
      )}
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => {
          const payload = recordPayload(item.payload);
          const details = definition.fields
            .map((field) => ({ label: field.label, value: payload[field.key] }))
            .filter(
              ({ value }) =>
                value !== undefined && value !== null && value !== "",
            )
            .slice(0, 3);
          if (domain === "providers") {
            details.push(
              ...[
                { label: "连接状态", value: payload["连接状态"] },
                { label: "最近测试", value: payload["最近测试"] },
                { label: "可用模型", value: payload["可用模型"] },
              ].filter(
                ({ value }) =>
                  value !== undefined && value !== null && value !== "",
              ),
            );
          }
          return (
            <article
              key={item.id}
              className="rounded-xl border border-line bg-surface p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.title}</p>
                  <p className="mt-1 text-xs text-muted">版本 {item.version}</p>
                </div>
                <div className="flex gap-1">
                  <button
                    className="rounded px-2 py-1 text-xs text-brand hover:bg-brand-soft"
                    onClick={() => openEditor(item)}
                  >
                    编辑
                  </button>
                  <button
                    className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                    onClick={() => void remove(item)}
                  >
                    删除
                  </button>
                  {domain === "templates" && (
                    <button
                      className="rounded px-2 py-1 text-xs text-brand hover:bg-brand-soft"
                      onClick={() => openTemplateRunner(item)}
                    >
                      运行
                    </button>
                  )}
                  {domain === "providers" && (
                    <button
                      className="rounded px-2 py-1 text-xs text-brand hover:bg-brand-soft"
                      onClick={() => void testProvider(item)}
                    >
                      测试连接
                    </button>
                  )}
                  {domain === "providers" &&
                    payload["服务类型"] === "智能模型" && (
                      <button
                        className="rounded px-2 py-1 text-xs text-brand hover:bg-brand-soft"
                        onClick={() => void activateProviderForAgent(item)}
                      >
                        设为智能助手模型
                      </button>
                    )}
                  {domain === "delivery" && (
                    <button
                      className="rounded px-2 py-1 text-xs text-brand hover:bg-brand-soft"
                      onClick={() => void exportDelivery(item)}
                    >
                      导出交付清单
                    </button>
                  )}
                </div>
              </div>
              {(domain === "shot-stills" ||
                domain === "visual-assets" ||
                domain === "localization") && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="rounded-md border border-brand px-2 py-1 text-xs text-brand"
                    onClick={() => void adopt(item)}
                  >
                    {domain === "localization"
                      ? "采用本地化版本"
                      : "采用此版本"}
                  </button>
                  {domain === "visual-assets" &&
                    payload["锁定状态"] !== "已锁定" && (
                      <button
                        className="rounded-md border border-line px-2 py-1 text-xs text-muted"
                        onClick={() => void lockVisualAsset(item)}
                      >
                        锁定此资产
                      </button>
                    )}
                  {domain === "localization" && (
                    <>
                      <button
                        className="rounded-md border border-line px-2 py-1 text-xs text-muted"
                        onClick={() => void exportSubtitles(item, "srt")}
                      >
                        导出字幕
                      </button>
                      <button
                        className="rounded-md border border-line px-2 py-1 text-xs text-muted"
                        onClick={() => void exportSubtitles(item, "vtt")}
                      >
                        导出网页字幕
                      </button>
                    </>
                  )}
                </div>
              )}
              <dl className="mt-3 space-y-2 text-sm">
                {details.map(({ label, value }) => (
                  <div key={label} className="grid grid-cols-[5rem_1fr] gap-2">
                    <dt className="text-muted">{label}</dt>
                    <dd className="line-clamp-2 whitespace-pre-wrap">
                      {String(value)}
                    </dd>
                  </div>
                ))}
                {!details.length && (
                  <p className="text-sm text-muted">尚未填写详细资料。</p>
                )}
              </dl>
            </article>
          );
        })}
        {!items.length && (
          <p className="rounded-xl border border-dashed border-line p-8 text-sm text-muted">
            尚无{domainLabel(domain)}。新建后即可在此持续维护。
          </p>
        )}
      </div>
    </section>
  );
}

function AdaptationWorkspace() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const location = useLocation();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const [projectId, setProjectId] = useState("");
  const [adaptationId, setAdaptationId] = useState("");
  const [episodeId, setEpisodeId] = useState("");
  const [scriptId, setScriptId] = useState("");
  const [sceneId, setSceneId] = useState("");
  const [shotId, setShotId] = useState("");
  const [notice, setNotice] = useState<string>();
  const [stage, setStage] = useState<
    "adaptations" | "episodes" | "scripts" | "scenes" | "shots"
  >("adaptations");
  const { data: adaptations = [] } = useQuery({
    queryKey: ["resource", "adaptations", projectId],
    queryFn: () => client.resources.list("adaptations", projectId),
    enabled: Boolean(projectId),
  });
  const { data: episodes = [] } = useQuery({
    queryKey: ["resource", "episodes", projectId, adaptationId],
    queryFn: () => client.resources.list("episodes", projectId, adaptationId),
    enabled: Boolean(projectId && adaptationId),
  });
  const { data: scripts = [] } = useQuery({
    queryKey: ["resource", "scripts", projectId, episodeId],
    queryFn: () => client.resources.list("scripts", projectId, episodeId),
    enabled: Boolean(projectId && episodeId),
  });
  const { data: scenes = [] } = useQuery({
    queryKey: ["resource", "scenes", projectId, scriptId],
    queryFn: () => client.resources.list("scenes", projectId, scriptId),
    enabled: Boolean(projectId && scriptId),
  });
  const { data: shots = [] } = useQuery({
    queryKey: ["resource", "shots", projectId, sceneId],
    queryFn: () => client.resources.list("shots", projectId, sceneId),
    enabled: Boolean(projectId && sceneId),
  });
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("projectId");
    if (requested && projects.some((project) => project.id === requested))
      setProjectId(requested);
  }, [location.search, projects]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("stage");
    if (
      requested &&
      ["adaptations", "episodes", "scripts", "scenes", "shots"].includes(
        requested,
      )
    )
      setStage(requested as typeof stage);
  }, [location.search]);
  useEffect(() => {
    if (adaptationId && !adaptations.some((item) => item.id === adaptationId))
      setAdaptationId("");
  }, [adaptationId, adaptations]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("adaptationId");
    if (requested && adaptations.some((item) => item.id === requested))
      setAdaptationId(requested);
  }, [adaptations, location.search]);
  useEffect(() => {
    const project = projects.find((item) => item.id === projectId);
    if (
      !adaptationId &&
      project?.currentAdaptationId &&
      adaptations.some((item) => item.id === project.currentAdaptationId)
    )
      setAdaptationId(project.currentAdaptationId);
  }, [adaptationId, adaptations, projectId, projects]);
  useEffect(() => {
    if (episodeId && !episodes.some((item) => item.id === episodeId))
      setEpisodeId("");
  }, [episodeId, episodes]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("episodeId");
    if (requested && episodes.some((item) => item.id === requested))
      setEpisodeId(requested);
  }, [episodes, location.search]);
  useEffect(() => {
    if (scriptId && !scripts.some((item) => item.id === scriptId))
      setScriptId("");
  }, [scriptId, scripts]);
  useEffect(() => {
    if (sceneId && !scenes.some((item) => item.id === sceneId)) setSceneId("");
  }, [sceneId, scenes]);
  useEffect(() => {
    if (shotId && !shots.some((item) => item.id === shotId)) setShotId("");
  }, [shotId, shots]);
  const parentId =
    stage === "episodes"
      ? adaptationId
      : stage === "scripts"
        ? episodeId
        : stage === "scenes"
          ? scriptId
          : stage === "shots"
            ? sceneId
            : undefined;
  const parentRequired = stage !== "adaptations";
  const selectedScript = scripts.find((item) => item.id === scriptId);
  return (
    <section className="space-y-5">
      <div>
        <p className="text-sm text-muted">改编生产链路</p>
        <h1 className="mt-1 text-2xl font-semibold">从故事到分镜</h1>
        <p className="mt-2 text-sm text-muted">
          依次建立改编项目、分集、剧本、场景和分镜；下级资料会明确归属到上级条目。
        </p>
      </div>
      <section className="grid gap-3 rounded-2xl border border-line bg-surface p-4 md:grid-cols-2 xl:grid-cols-5">
        <label className="grid gap-1 text-sm">
          项目
          <select
            className="rounded-lg border border-line px-3 py-2"
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setAdaptationId("");
              setEpisodeId("");
              setScriptId("");
              setSceneId("");
              setShotId("");
            }}
          >
            <option value="">选择项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          改编项目
          <select
            className="rounded-lg border border-line px-3 py-2"
            disabled={!projectId}
            value={adaptationId}
            onChange={(event) => {
              const nextId = event.target.value;
              setAdaptationId(nextId);
              setEpisodeId("");
              setScriptId("");
              setSceneId("");
              setShotId("");
              setNotice(undefined);
              if (!nextId || !projectId) return;
              void client.productionStructure
                .selectCurrentAdaptation(projectId, { adaptationId: nextId })
                .then(() => {
                  setNotice(
                    "已设为当前改编方案。下次打开项目会自动恢复此选择。",
                  );
                  void queryClient.invalidateQueries({
                    queryKey: ["projects"],
                  });
                })
                .catch((cause) => setNotice(message(cause)));
            }}
          >
            <option value="">选择改编项目</option>
            {adaptations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          分集
          <select
            className="rounded-lg border border-line px-3 py-2"
            disabled={!adaptationId}
            value={episodeId}
            onChange={(event) => {
              setEpisodeId(event.target.value);
              setScriptId("");
              setSceneId("");
              setShotId("");
            }}
          >
            <option value="">选择分集</option>
            {episodes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          剧本
          <select
            className="rounded-lg border border-line px-3 py-2"
            disabled={!episodeId}
            value={scriptId}
            onChange={(event) => {
              setScriptId(event.target.value);
              setSceneId("");
              setShotId("");
            }}
          >
            <option value="">选择剧本</option>
            {scripts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          场景
          <select
            className="rounded-lg border border-line px-3 py-2"
            disabled={!scriptId}
            value={sceneId}
            onChange={(event) => {
              setSceneId(event.target.value);
              setShotId("");
            }}
          >
            <option value="">选择场景</option>
            {scenes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        {stage === "shots" && (
          <label className="grid gap-1 text-sm">
            分镜
            <select
              className="rounded-lg border border-line px-3 py-2"
              disabled={!sceneId}
              value={shotId}
              onChange={(event) => setShotId(event.target.value)}
            >
              <option value="">选择分镜</option>
              {shots.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>
      <div className="flex flex-wrap gap-2">
        {(
          ["adaptations", "episodes", "scripts", "scenes", "shots"] as const
        ).map((item) => (
          <button
            key={item}
            className={`rounded-full px-3 py-1.5 text-sm ${stage === item ? "bg-brand text-white" : "bg-surface text-muted ring-1 ring-line"}`}
            onClick={() => setStage(item)}
          >
            {domainLabel(item)}
          </button>
        ))}
      </div>
      {notice && <p className="text-sm text-brand">{notice}</p>}
      {!projectId ? (
        <p className="rounded-xl border border-dashed border-line p-8 text-sm text-muted">
          请先创建或选择项目，再开始改编生产。
        </p>
      ) : (
        <>
          {adaptationId && <EpisodeAnalysisPanel adaptationId={adaptationId} />}
          {episodeId && (
            <EpisodePacingPanel
              projectId={projectId}
              episodeId={episodeId}
              episode={episodes.find((item) => item.id === episodeId)}
              onOpenScript={(nextScriptId) => {
                setScriptId(nextScriptId);
                setStage("scripts");
              }}
            />
          )}
          <ProductionOrderPanel
            stage={stage}
            parentId={parentId}
            records={
              stage === "episodes"
                ? episodes
                : stage === "scenes"
                  ? scenes
                  : stage === "shots"
                    ? shots
                    : []
            }
          />
          {stage === "scripts" && scriptId && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
              <ScriptReviewPanel scriptId={scriptId} />
              {selectedScript && (
                <StoryBibleSidecar
                  projectId={projectId}
                  context={{
                    kind: "script",
                    id: scriptId,
                    title: selectedScript.title,
                    content: String(
                      recordPayload(selectedScript.payload)["剧本内容"] ?? "",
                    ),
                    version: selectedScript.version,
                  }}
                />
              )}
            </div>
          )}
          {stage === "shots" && shotId && <ShotReviewPanel shotId={shotId} />}
          <DomainWorkspace
            title="改编生产"
            domains={[stage]}
            projectId={projectId}
            parentId={parentId}
            parentRequired={parentRequired}
          />
        </>
      )}
    </section>
  );
}

function EpisodePacingPanel(props: {
  projectId: string;
  episodeId: string;
  episode?: DomainEntity;
  onOpenScript: (scriptId: string) => void;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string>();
  const { data: allScripts = [] } = useQuery({
    queryKey: ["episode-pacing", "scripts", props.projectId],
    queryFn: () => client.resources.list("scripts", props.projectId),
  });
  const { data: allBeats = [] } = useQuery({
    queryKey: ["episode-pacing", "beats", props.projectId],
    queryFn: () => client.resources.list("beats", props.projectId),
  });
  const { data: allScenes = [] } = useQuery({
    queryKey: ["episode-pacing", "scenes", props.projectId],
    queryFn: () => client.resources.list("scenes", props.projectId),
  });
  const { data: allShots = [] } = useQuery({
    queryKey: ["episode-pacing", "shots", props.projectId],
    queryFn: () => client.resources.list("shots", props.projectId),
  });
  const { data: manualMarks = [] } = useQuery({
    queryKey: ["episode-pacing-marks", props.projectId, props.episodeId],
    queryFn: () =>
      client.resources.list(
        "episode-pacing-marks",
        props.projectId,
        props.episodeId,
      ),
  });
  const { data: checkpoints = [] } = useQuery({
    queryKey: ["content-versions", props.projectId],
    queryFn: () => client.contentVersions.list(props.projectId),
  });
  const scripts = allScripts.filter((item) => item.parentId === props.episodeId);
  const scriptIds = new Set(scripts.map((item) => item.id));
  const scenes = allScenes.filter((item) => item.parentId && scriptIds.has(item.parentId));
  const sceneIds = new Set(scenes.map((item) => item.id));
  const shots = allShots.filter((item) => item.parentId && sceneIds.has(item.parentId));
  const beats = allBeats.filter(
    (item) => item.parentId === props.episodeId || Boolean(item.parentId && scriptIds.has(item.parentId)),
  );
  const board = buildEpisodePacingBoard({
    episodeId: props.episodeId,
    episode: props.episode,
    scripts,
    beats,
    scenes,
    shots,
    manualMarks,
  });
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["episode-pacing-marks", props.projectId, props.episodeId],
      }),
      queryClient.invalidateQueries({ queryKey: ["episode-pacing"] }),
      queryClient.invalidateQueries({ queryKey: ["content-versions", props.projectId] }),
    ]);
  };
  const addManual = async (kind: PacingKind) => {
    const evidence = window.prompt("记录该节奏点的依据：", "");
    if (evidence === null) return;
    const source =
      board.points.find(
        (point) =>
          point.sourceId &&
          point.scriptId &&
          point.disposition === "active",
      ) ??
      board.points.find(
        (point) => point.sourceId && point.disposition === "active",
      );
    if (!source?.sourceId || source.sourceVersion === undefined) {
      setNotice("请先保存分集、剧本、场景或镜头，再添加可追溯的人工标记。");
      return;
    }
    try {
      await client.resources.create("episode-pacing-marks", {
        projectId: props.projectId,
        parentId: props.episodeId,
        title: `人工${pacingKindLabel(kind)}标记`,
        payload: {
          类型: kind,
          位置: source.position,
          依据: evidence,
          来源标识: source.sourceId,
          来源版本: source.sourceVersion,
          状态: "已确认",
        },
      });
      setNotice("已保存人工节奏标记；它会保留并在来源版本变化时标为过期。");
      await invalidate();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const editManual = async (point: PacingPoint) => {
    const record = manualMarks.find((item) => item.id === point.id);
    if (!record) return;
    const evidence = window.prompt("调整人工标记依据：", point.evidence);
    if (evidence === null) return;
    const requestedPosition = window.prompt("调整时间轴位置：", String(point.position));
    if (requestedPosition === null) return;
    const position = Number(requestedPosition);
    if (!Number.isFinite(position) || position < 1) {
      setNotice("时间轴位置必须是大于等于 1 的数字。");
      return;
    }
    try {
      await client.resources.update("episode-pacing-marks", record.id, {
        title: record.title,
        payload: {
          ...recordPayload(record.payload),
          位置: Math.round(position),
          依据: evidence,
          状态: "已确认",
        },
        version: record.version,
      });
      setNotice("人工标记已调整并保留了来源版本。");
      await invalidate();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const rejectManual = async (point: PacingPoint) => {
    const record = manualMarks.find((item) => item.id === point.id);
    if (!record || !window.confirm("否决此人工标记吗？记录会保留在轨道中作为审查历史。")) return;
    try {
      await client.resources.update("episode-pacing-marks", record.id, {
        title: record.title,
        payload: { ...recordPayload(record.payload), 状态: "已否决" },
        version: record.version,
      });
      setNotice("已否决人工标记；它不会被当作有效诊断点。");
      await invalidate();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const createAiRecommendation = async (point: PacingPoint) => {
    const script = scripts.find((item) => item.id === point.scriptId);
    if (!script || !point.sourceId || point.sourceVersion === undefined) {
      setNotice("该诊断点尚未关联到可修订的剧本来源。");
      return;
    }
    const scriptPayload = recordPayload(script.payload);
    const prompt = [
      "请仅针对以下节奏诊断生成一份可审阅的剧本修订建议，不能直接修改内容。",
      `诊断类型：${pacingKindLabel(point.kind)}；时间轴位置：${point.position}；依据：${point.evidence.slice(0, 800)}`,
      `目标剧本 ID：${script.id}；基础版本：${script.version}；来源 ID：${point.sourceId}；来源版本：${point.sourceVersion}。`,
      "严格输出 JSON：{summary,content,data:{targets:[{kind:'script',id,baseVersion,patch:{payload:{...原payload,剧本内容:完整候选稿}},displayDiff:{proposedContent:'完整候选稿',pacingSourceId:'来源 ID',pacingSourceVersion:来源版本}}]}}。",
      "完整原 payload 已作为 target.scriptPayload 附在上下文中；必须保留未修改字段。",
    ].join("\n");
    try {
      const session = await client.agentSessions.create({
        projectId: props.projectId,
        taskType: "rewrite_ai_drama_script",
        title: `节奏修订建议：${script.title}`,
      });
      const run = await client.agentSessions.run(session.id, {
        taskType: "rewrite_ai_drama_script",
        prompt,
        target: {
          scriptId: script.id,
          scriptVersion: script.version,
          scriptPayload,
          pacingSourceId: point.sourceId,
          pacingSourceVersion: point.sourceVersion,
          evidence: point.evidence,
        },
      });
      setNotice(`已创建智能修订建议任务 ${run.taskId.slice(0, 8)}；请在任务中心确认预览、采用或放弃。`);
      navigate("/tasks");
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const restoreCheckpoint = async (checkpoint: DomainEntity) => {
    if (!window.confirm("恢复此修订前检查点吗？当前剧本会先自动保存为新的检查点。")) return;
    try {
      await client.contentVersions.restore(checkpoint.id);
      setNotice("已恢复修订前版本；当前版本也已保存为新的检查点。");
      await invalidate();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const pacingCheckpoints = checkpoints.filter((checkpoint) => {
    const checkpointPayload = recordPayload(checkpoint.payload);
    return checkpointPayload["来源"] === "节奏修订预览采用前检查点" && scriptIds.has(checkpoint.parentId ?? "");
  });
  return (
    <section className="rounded-2xl border border-line bg-surface p-4" aria-label="集级节奏看板">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">集级节奏看板</h2>
          <p className="mt-1 text-sm text-muted">四条轨道只呈现带来源的节奏点；这是编辑辅助，不预测市场成功。</p>
        </div>
        <span className="text-xs text-muted">{board.staleCount ? `${board.staleCount} 个标记待复核` : "来源均为当前版本"}{board.rejectedCount ? `；${board.rejectedCount} 个已否决` : ""}</span>
      </div>
      {!board.hasSources ? <p className="mt-3 text-sm text-muted">尚无已采用分集、剧本、节拍、场景或镜头来源，无法生成可信的节奏曲线。</p> : (
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          {(["density", "highlight", "reversal", "cliffhanger"] as const).map((kind) => (
            <section key={kind} className="rounded-lg border border-line p-3" aria-label={`${pacingKindLabel(kind)}轨道`}>
              <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium">{pacingKindLabel(kind)}</h3><button className="text-xs text-brand" onClick={() => void addManual(kind)}>人工标记</button></div>
              <ol className="mt-2 space-y-2 text-xs">
                {board.points.filter((point) => point.kind === kind).map((point) => <li key={point.id} className={point.stale ? "rounded bg-amber-50 p-2 text-amber-800" : "rounded bg-canvas p-2"}>
                  <button className="text-left underline" onClick={() => point.scriptId && props.onOpenScript(point.scriptId)}>{point.position}. {point.title}</button>
                  <p className="mt-1">{point.evidence}</p><p className="mt-1 text-muted">{point.confidence === "manual" ? "人工确认" : "规则派生"}{point.disposition === "rejected" ? " · 已否决" : ""}{point.stale ? " · 来源已变化" : ""}</p>
                  {point.confidence === "manual" && point.disposition === "active" && <div className="mt-2 flex flex-wrap gap-2"><button className="text-xs text-brand underline" onClick={() => void editManual(point)}>调整</button><button className="text-xs text-muted underline" onClick={() => void rejectManual(point)}>否决</button></div>}
                  {point.confidence === "derived" && point.disposition === "active" && point.scriptId && <button className="mt-2 text-xs text-brand underline" onClick={() => void createAiRecommendation(point)}>创建上下文 AI 修订预览</button>}
                </li>)}
                {!board.points.some((point) => point.kind === kind) && <li className="text-muted">暂无可追溯标记</li>}
              </ol>
            </section>
          ))}
        </div>
      )}
      {scripts[0] && <button className="mt-3 rounded border border-brand px-3 py-2 text-sm text-brand" onClick={() => props.onOpenScript(scripts[0].id)}>定位到剧本</button>}
      {pacingCheckpoints.length > 0 && <section className="mt-3 rounded-lg border border-line p-3" aria-label="节奏修订检查点"><h3 className="text-sm font-medium">节奏修订检查点</h3><p className="mt-1 text-xs text-muted">已采用的建议保留修订前内容，可随时恢复；恢复也会先保存当前版本。</p><ul className="mt-2 space-y-1 text-xs">{pacingCheckpoints.slice(0, 3).map((checkpoint) => <li key={checkpoint.id} className="flex flex-wrap items-center justify-between gap-2"><span>{checkpoint.title}</span><button className="text-brand underline" onClick={() => void restoreCheckpoint(checkpoint)}>恢复此版本</button></li>)}</ul></section>}
      {notice && <p className="mt-3 text-sm text-brand">{notice}</p>}
    </section>
  );
}

function pacingKindLabel(kind: PacingKind): string {
  return { density: "节拍密度", highlight: "爽点", reversal: "反转", cliffhanger: "结尾悬念" }[kind];
}

function EpisodeAnalysisPanel(props: { adaptationId: string }) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string>();
  const { data: analysis, isLoading } = useQuery({
    queryKey: ["episode-analysis", props.adaptationId],
    queryFn: () => client.adaptationAnalysis.get(props.adaptationId),
  });
  const run = async () => {
    setNotice(undefined);
    try {
      await client.adaptationAnalysis.run(props.adaptationId);
      setNotice("已根据已保存的分集资料生成覆盖分析；它不会虚构模型评估。");
      void queryClient.invalidateQueries({
        queryKey: ["episode-analysis", props.adaptationId],
      });
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const remove = async () => {
    if (!window.confirm("删除这份分集分析记录吗？")) return;
    try {
      await client.adaptationAnalysis.remove(props.adaptationId);
      setNotice("已删除分集分析记录。");
      void queryClient.invalidateQueries({
        queryKey: ["episode-analysis", props.adaptationId],
      });
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">分集结构分析</h2>
          <p className="mt-1 text-sm text-muted">
            汇总分集的钩子、结尾悬念和简介覆盖情况，可随时重新生成或删除。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded-lg bg-brand px-3 py-2 text-sm text-white"
            onClick={() => void run()}
          >
            {isLoading ? "读取中…" : analysis ? "重新分析" : "开始分析"}
          </button>
          {analysis && (
            <button
              className="rounded-lg border border-line px-3 py-2 text-sm text-muted"
              onClick={() => void remove()}
            >
              删除分析
            </button>
          )}
        </div>
      </div>
      {notice && <p className="mt-3 text-sm text-brand">{notice}</p>}
      {analysis ? (
        <>
          <p className="mt-3 text-sm">{analysis.summary}</p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-4">
            {[
              ["综合", analysis.overallScore],
              ["钩子", analysis.hookCoverage],
              ["结尾悬念", analysis.cliffhangerCoverage],
              ["分集简介", analysis.outlineCoverage],
            ].map(([label, score]) => (
              <div
                key={String(label)}
                className="rounded-lg bg-brand-soft p-3 text-center"
              >
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-1 text-lg font-semibold">{score}%</dd>
              </div>
            ))}
          </dl>
          {analysis.suggestions.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
              {analysis.suggestions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </>
      ) : !isLoading ? (
        <p className="mt-3 text-sm text-muted">尚未生成分集分析记录。</p>
      ) : null}
    </section>
  );
}

type ProductionStructureStage =
  "adaptations" | "episodes" | "scripts" | "scenes" | "shots";

/** A dedicated production-order editor, separate from the generic data editor. */
function ProductionOrderPanel(props: {
  stage: ProductionStructureStage;
  parentId?: string;
  records: DomainEntity[];
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string>();
  const [saving, setSaving] = useState(false);
  if (!props.parentId || !["episodes", "scenes", "shots"].includes(props.stage))
    return null;
  const ordered = [...props.records].sort((left, right) => {
    const leftOrder = Number(recordPayload(left.payload)["排序"]);
    const rightOrder = Number(recordPayload(right.payload)["排序"]);
    const safeLeft =
      Number.isFinite(leftOrder) && leftOrder > 0
        ? leftOrder
        : Number.MAX_SAFE_INTEGER;
    const safeRight =
      Number.isFinite(rightOrder) && rightOrder > 0
        ? rightOrder
        : Number.MAX_SAFE_INTEGER;
    return (
      safeLeft - safeRight || left.createdAt.localeCompare(right.createdAt)
    );
  });
  const move = async (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= ordered.length || !props.parentId) return;
    const next = [...ordered];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setSaving(true);
    setNotice(undefined);
    try {
      const input = {
        items: next.map((record) => ({
          id: record.id,
          version: record.version,
        })),
      };
      if (props.stage === "episodes")
        await client.productionStructure.reorderEpisodes(props.parentId, input);
      else if (props.stage === "scenes")
        await client.productionStructure.reorderScenes(props.parentId, input);
      else await client.productionStructure.reorderShots(props.parentId, input);
      setNotice("已保存顺序。若其他窗口同时修改过条目，请刷新后再次调整。");
      void queryClient.invalidateQueries({
        queryKey: ["resource", props.stage],
      });
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{domainLabel(props.stage)}顺序</h2>
          <p className="mt-1 text-sm text-muted">
            顺序会以完整列表和版本号原子保存，不会因局部更新产生重复序号。
          </p>
        </div>
        <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs text-brand">
          共 {ordered.length} 项
        </span>
      </div>
      {notice && <p className="mt-3 text-sm text-brand">{notice}</p>}
      <ol className="mt-3 space-y-2">
        {ordered.map((record, index) => (
          <li
            key={record.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2"
          >
            <span className="min-w-0 truncate text-sm">
              {index + 1}. {record.title}
            </span>
            <span className="flex shrink-0 gap-1">
              <button
                className="rounded border border-line px-2 py-1 text-xs text-muted disabled:opacity-40"
                disabled={saving || index === 0}
                onClick={() => void move(index, -1)}
              >
                上移
              </button>
              <button
                className="rounded border border-line px-2 py-1 text-xs text-muted disabled:opacity-40"
                disabled={saving || index === ordered.length - 1}
                onClick={() => void move(index, 1)}
              >
                下移
              </button>
            </span>
          </li>
        ))}
      </ol>
      {!ordered.length && (
        <p className="mt-3 text-sm text-muted">
          建立至少两个条目后即可在此调整顺序。
        </p>
      )}
    </section>
  );
}

function ScriptReviewPanel(props: { scriptId: string }) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string>();
  const { data: review, isLoading } = useQuery({
    queryKey: ["production-review", "script", props.scriptId],
    queryFn: () => client.productionReviews.getScript(props.scriptId),
  });
  const run = async () => {
    setNotice(undefined);
    try {
      await client.productionReviews.runScript(props.scriptId);
      setNotice(
        "已完成本地规则审查。它仅依据已保存的剧本和场景，不会冒充模型结论。",
      );
      void queryClient.invalidateQueries({
        queryKey: ["production-review", "script", props.scriptId],
      });
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const remove = async () => {
    if (!window.confirm("删除这份剧本审查记录吗？")) return;
    try {
      await client.productionReviews.removeScript(props.scriptId);
      setNotice("已删除剧本审查记录。");
      void queryClient.invalidateQueries({
        queryKey: ["production-review", "script", props.scriptId],
      });
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const scores = review
    ? [
        ["开场钩子", review.hookStrengthScore],
        ["对白", review.dialogueScore],
        ["冲突", review.conflictScore],
        ["视觉清晰度", review.visualClarityScore],
        ["场景清晰度", review.sceneClarityScore],
        ["分镜就绪度", review.shotReadinessScore],
        ["生成可制作性", review.aiVideoFeasibilityScore],
        ["结尾悬念", review.cliffhangerScore],
      ]
    : [];
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">剧本审查</h2>
          <p className="mt-1 text-sm text-muted">
            检查当前剧本正文、场景和制作准备度，结果可重新生成或删除。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded-lg bg-brand px-3 py-2 text-sm text-white"
            onClick={() => void run()}
          >
            {isLoading ? "读取中…" : review ? "重新审查" : "开始审查"}
          </button>
          {review && (
            <button
              className="rounded-lg border border-line px-3 py-2 text-sm text-muted"
              onClick={() => void remove()}
            >
              删除审查
            </button>
          )}
        </div>
      </div>
      {notice && <p className="mt-3 text-sm text-brand">{notice}</p>}
      {review ? (
        <>
          <p className="mt-4 text-sm">
            综合得分：<strong>{review.overallScore}</strong> / 100
          </p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {scores.map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-lg bg-brand-soft px-3 py-2 text-sm"
              >
                <dt className="text-muted">{label}</dt>
                <dd className="mt-1 font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          <ReviewFindings
            issues={review.issues}
            suggestions={review.suggestions}
          />
        </>
      ) : !isLoading ? (
        <p className="mt-3 text-sm text-muted">尚未生成审查记录。</p>
      ) : null}
    </section>
  );
}

function ShotReviewPanel(props: { shotId: string }) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string>();
  const [taskType, setTaskType] = useState("人工快照");
  const [videoPrompt, setVideoPrompt] = useState("");
  const [note, setNote] = useState("");
  const [savingVersion, setSavingVersion] = useState(false);
  const { data: review, isLoading } = useQuery({
    queryKey: ["production-review", "shot", props.shotId],
    queryFn: () => client.productionReviews.getShot(props.shotId),
  });
  const { data: versions = [] } = useQuery({
    queryKey: ["prompt-versions", props.shotId],
    queryFn: () => client.productionReviews.listPromptVersions(props.shotId),
  });
  const run = async () => {
    setNotice(undefined);
    try {
      await client.productionReviews.runShot(props.shotId);
      setNotice(
        "已完成本地规则审查。结论基于保存的镜头字段和提示词，不代表模型生成结果。",
      );
      void queryClient.invalidateQueries({
        queryKey: ["production-review", "shot", props.shotId],
      });
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const remove = async () => {
    if (!window.confirm("删除这份镜头审查记录吗？")) return;
    try {
      await client.productionReviews.removeShot(props.shotId);
      setNotice("已删除镜头审查记录。");
      void queryClient.invalidateQueries({
        queryKey: ["production-review", "shot", props.shotId],
      });
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const append = async () => {
    if (!taskType.trim()) {
      setNotice("请填写版本来源。");
      return;
    }
    setSavingVersion(true);
    setNotice(undefined);
    try {
      const version = await client.productionReviews.appendPromptVersion(
        props.shotId,
        {
          taskType: taskType.trim(),
          ...(videoPrompt.trim() ? { videoPrompt: videoPrompt.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      );
      setNotice(`已保存提示词版本 ${version.version}。`);
      setVideoPrompt("");
      setNote("");
      void queryClient.invalidateQueries({
        queryKey: ["prompt-versions", props.shotId],
      });
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setSavingVersion(false);
    }
  };
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">镜头审查与提示词版本</h2>
          <p className="mt-1 text-sm text-muted">
            审查可生成制作风险说明；提示词每次保存都会追加不可覆盖的版本。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded-lg bg-brand px-3 py-2 text-sm text-white"
            onClick={() => void run()}
          >
            {isLoading ? "读取中…" : review ? "重新审查" : "开始审查"}
          </button>
          {review && (
            <button
              className="rounded-lg border border-line px-3 py-2 text-sm text-muted"
              onClick={() => void remove()}
            >
              删除审查
            </button>
          )}
        </div>
      </div>
      {notice && <p className="mt-3 text-sm text-brand">{notice}</p>}
      {review && (
        <>
          <p className="mt-4 text-sm">
            综合得分：<strong>{review.overallScore}</strong> / 100 · 制作难度：
            {review.aiVideoDifficulty === "low"
              ? "低"
              : review.aiVideoDifficulty === "medium"
                ? "中"
                : "高"}
          </p>
          <ReviewFindings
            issues={review.issues}
            suggestions={review.suggestions}
          />
        </>
      )}
      <div className="mt-4 grid gap-3 rounded-xl border border-dashed border-line p-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          版本来源
          <input
            className="rounded-lg border border-line px-3 py-2"
            value={taskType}
            onChange={(event) => setTaskType(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          版本备注
          <input
            className="rounded-lg border border-line px-3 py-2"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="例如：缩短动作后的可控版本"
          />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2">
          视频提示词（留空时会快照当前已保存的生成提示）
          <textarea
            className="min-h-20 rounded-lg border border-line px-3 py-2"
            value={videoPrompt}
            onChange={(event) => setVideoPrompt(event.target.value)}
          />
        </label>
        <div className="md:col-span-2">
          <button
            className="rounded-lg border border-brand px-3 py-2 text-sm text-brand disabled:opacity-50"
            disabled={savingVersion}
            onClick={() => void append()}
          >
            {savingVersion ? "保存中…" : "保存提示词版本"}
          </button>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <h3 className="text-sm font-medium">提示词版本历史</h3>
        {versions.map((version) => (
          <article
            key={version.id}
            className="rounded-lg border border-line p-3 text-sm"
          >
            <p className="font-medium">
              版本 {version.version} · {version.taskType}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-muted">
              {version.videoPrompt || "（当前镜头尚未填写生成提示）"}
            </p>
            {version.note && (
              <p className="mt-1 text-xs text-muted">备注：{version.note}</p>
            )}
          </article>
        ))}
        {!versions.length && (
          <p className="text-sm text-muted">尚未保存提示词版本。</p>
        )}
      </div>
    </section>
  );
}

function ReviewFindings(props: { issues: string[]; suggestions: string[] }) {
  if (!props.issues.length && !props.suggestions.length)
    return (
      <p className="mt-3 text-sm text-muted">当前规则未发现必须处理的问题。</p>
    );
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2 text-sm">
      <div>
        <h3 className="font-medium">待核对项</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
          {props.issues.length ? (
            props.issues.map((item) => <li key={item}>{item}</li>)
          ) : (
            <li>暂无</li>
          )}
        </ul>
      </div>
      <div>
        <h3 className="font-medium">改进建议</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
          {props.suggestions.length ? (
            props.suggestions.map((item) => <li key={item}>{item}</li>)
          ) : (
            <li>暂无</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function ProductionWorkspace() {
  const client = useStudio();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const [projectId, setProjectId] = useState("");
  const [adaptationId, setAdaptationId] = useState("");
  const [episodeId, setEpisodeId] = useState("");
  const [scriptId, setScriptId] = useState("");
  const [sceneId, setSceneId] = useState("");
  const [shotId, setShotId] = useState("");
  const [stage, setStage] = useState<
    | "assets"
    | "asset-center"
    | "storyboard"
    | "rights"
    | "visual-assets"
    | "shot-stills"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders"
  >("assets");
  const { data: adaptations = [] } = useQuery({
    queryKey: ["resource", "adaptations", projectId],
    queryFn: () => client.resources.list("adaptations", projectId),
    enabled: Boolean(projectId),
  });
  const { data: episodes = [] } = useQuery({
    queryKey: ["resource", "episodes", projectId, adaptationId],
    queryFn: () => client.resources.list("episodes", projectId, adaptationId),
    enabled: Boolean(projectId && adaptationId),
  });
  const { data: scripts = [] } = useQuery({
    queryKey: ["resource", "scripts", projectId, episodeId],
    queryFn: () => client.resources.list("scripts", projectId, episodeId),
    enabled: Boolean(projectId && episodeId),
  });
  const { data: scenes = [] } = useQuery({
    queryKey: ["resource", "scenes", projectId, scriptId],
    queryFn: () => client.resources.list("scenes", projectId, scriptId),
    enabled: Boolean(projectId && scriptId),
  });
  const { data: shots = [] } = useQuery({
    queryKey: ["resource", "shots", projectId, sceneId],
    queryFn: () => client.resources.list("shots", projectId, sceneId),
    enabled: Boolean(projectId && sceneId),
  });
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("projectId");
    if (requested && projects.some((project) => project.id === requested))
      setProjectId(requested);
  }, [location.search, projects]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("stage");
    if (
      requested &&
      [
        "assets",
        "asset-center",
        "storyboard",
        "rights",
        "visual-assets",
        "shot-stills",
        "image",
        "audio",
        "video",
        "animatics",
        "renders",
      ].includes(requested)
    )
      setStage(requested as typeof stage);
  }, [location.search]);
  useEffect(() => {
    if (adaptationId && !adaptations.some((item) => item.id === adaptationId))
      setAdaptationId("");
  }, [adaptationId, adaptations]);
  useEffect(() => {
    if (adaptationId || !adaptations.length) return;
    const current = projects.find(
      (project) => project.id === projectId,
    )?.currentAdaptationId;
    setAdaptationId(
      adaptations.some((item) => item.id === current)
        ? current!
        : adaptations[0]!.id,
    );
  }, [adaptationId, adaptations, projectId, projects]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("adaptationId");
    if (requested && adaptations.some((item) => item.id === requested))
      setAdaptationId(requested);
  }, [adaptations, location.search]);
  useEffect(() => {
    if (episodeId && !episodes.some((item) => item.id === episodeId))
      setEpisodeId("");
  }, [episodeId, episodes]);
  useEffect(() => {
    if (!episodeId && episodes[0]) setEpisodeId(episodes[0].id);
  }, [episodeId, episodes]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("episodeId");
    if (requested && episodes.some((item) => item.id === requested))
      setEpisodeId(requested);
  }, [episodes, location.search]);
  useEffect(() => {
    if (scriptId && !scripts.some((item) => item.id === scriptId))
      setScriptId("");
  }, [scriptId, scripts]);
  useEffect(() => {
    if (!scriptId && scripts[0]) setScriptId(scripts[0].id);
  }, [scriptId, scripts]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("scriptId");
    if (requested && scripts.some((item) => item.id === requested))
      setScriptId(requested);
  }, [location.search, scripts]);
  useEffect(() => {
    if (sceneId && !scenes.some((item) => item.id === sceneId)) setSceneId("");
  }, [sceneId, scenes]);
  useEffect(() => {
    if (!sceneId && scenes[0]) setSceneId(scenes[0].id);
  }, [sceneId, scenes]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("sceneId");
    if (requested && scenes.some((item) => item.id === requested))
      setSceneId(requested);
  }, [location.search, scenes]);
  useEffect(() => {
    if (shotId && shots.length && !shots.some((item) => item.id === shotId))
      setShotId("");
  }, [shotId, shots]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("shotId");
    if (requested && shots.some((item) => item.id === requested))
      setShotId(requested);
  }, [location.search, shots]);
  const parentId =
    stage === "audio" || stage === "animatics" || stage === "renders"
      ? episodeId
      : stage === "video" || stage === "shot-stills"
        ? shotId
        : undefined;
  const parentRequired =
    stage === "audio" ||
    stage === "animatics" ||
    stage === "renders" ||
    stage === "video" ||
    stage === "shot-stills";
  const resetChain = () => {
    setAdaptationId("");
    setEpisodeId("");
    setScriptId("");
    setSceneId("");
    setShotId("");
  };
  const selectStoryboardShot = (
    nextShotId: string,
    nextSceneId: string,
    nextScriptId: string,
    nextStage: "storyboard" | "asset-center" = "storyboard",
  ) => {
    setScriptId(nextScriptId);
    setSceneId(nextSceneId);
    setShotId(nextShotId);
    setStage(nextStage);
    const search = new URLSearchParams({
      projectId,
      adaptationId,
      episodeId,
      scriptId: nextScriptId,
      sceneId: nextSceneId,
      shotId: nextShotId,
      stage: nextStage,
    });
    navigate(`/produce?${search}`);
  };
  return (
    <section className="space-y-5">
      <div>
        <p className="text-sm text-muted">制作工作区</p>
        <h1 className="mt-1 text-2xl font-semibold">素材与视听制作</h1>
        <p className="mt-2 text-sm text-muted">
          素材、版权和视觉资产归属项目；静帧与视频归属具体分镜；音频、动态分镜和渲染预检归属分集。
        </p>
      </div>
      <section className="grid gap-3 rounded-2xl border border-line bg-surface p-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="grid gap-1 text-sm">
          项目
          <select
            className="rounded-lg border border-line px-3 py-2"
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              resetChain();
            }}
          >
            <option value="">选择项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          改编项目
          <select
            className="rounded-lg border border-line px-3 py-2"
            disabled={!projectId}
            value={adaptationId}
            onChange={(event) => {
              setAdaptationId(event.target.value);
              setEpisodeId("");
              setScriptId("");
              setSceneId("");
              setShotId("");
            }}
          >
            <option value="">选择改编项目</option>
            {adaptations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          分集
          <select
            className="rounded-lg border border-line px-3 py-2"
            disabled={!adaptationId}
            value={episodeId}
            onChange={(event) => {
              setEpisodeId(event.target.value);
              setScriptId("");
              setSceneId("");
              setShotId("");
            }}
          >
            <option value="">选择分集</option>
            {episodes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          剧本
          <select
            className="rounded-lg border border-line px-3 py-2"
            disabled={!episodeId}
            value={scriptId}
            onChange={(event) => {
              setScriptId(event.target.value);
              setSceneId("");
              setShotId("");
            }}
          >
            <option value="">选择剧本</option>
            {scripts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          场景
          <select
            className="rounded-lg border border-line px-3 py-2"
            disabled={!scriptId}
            value={sceneId}
            onChange={(event) => {
              setSceneId(event.target.value);
              setShotId("");
            }}
          >
            <option value="">选择场景</option>
            {scenes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          分镜
          <select
            className="rounded-lg border border-line px-3 py-2"
            disabled={!sceneId}
            value={shotId}
            onChange={(event) => setShotId(event.target.value)}
          >
            <option value="">选择分镜</option>
            {shots.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
      </section>
      {projectId && <ProductionGraphPanel projectId={projectId} />}
      <div className="flex flex-wrap gap-2">
        {(
          [
            "assets",
            "asset-center",
            "storyboard",
            "rights",
            "visual-assets",
            "shot-stills",
            "image",
            "audio",
            "video",
            "animatics",
            "renders",
          ] as const
        ).map((item) => (
          <button
            key={item}
            className={`rounded-full px-3 py-1.5 text-sm ${stage === item ? "bg-brand text-white" : "bg-surface text-muted ring-1 ring-line"}`}
            onClick={() => setStage(item)}
          >
            {domainLabel(item)}
          </button>
        ))}
      </div>
      {!projectId ? (
        <p className="rounded-xl border border-dashed border-line p-8 text-sm text-muted">
          请先选择项目，再登记或制作素材。
        </p>
      ) : stage === "asset-center" ? (
        <AssetCenterPanel
          projectId={projectId}
          selectedShotId={shotId}
          onOpenCatalog={() => setStage("visual-assets")}
        />
      ) : stage === "storyboard" ? (
        <StoryboardBoard
          projectId={projectId}
          episodeId={episodeId}
          selectedShotId={shotId}
          onSelectShot={(shotId, sceneId, scriptId) =>
            selectStoryboardShot(shotId, sceneId, scriptId)
          }
          onOpenAssetCenter={(shotId, sceneId, scriptId) =>
            selectStoryboardShot(shotId, sceneId, scriptId, "asset-center")
          }
        />
      ) : stage === "audio" && episodeId ? (
        <AudioProductionPanel
          projectId={projectId}
          episodeId={episodeId}
          shotId={shotId}
        />
      ) : stage === "image" && shotId ? (
        <ImageGenerationPanel projectId={projectId} shotId={shotId} />
      ) : stage === "video" && shotId ? (
        <VideoGenerationPanel
          projectId={projectId}
          episodeId={episodeId}
          shotId={shotId}
        />
      ) : stage === "animatics" && episodeId ? (
        <AnimaticProductionPanel projectId={projectId} episodeId={episodeId} />
      ) : stage === "renders" && episodeId ? (
        <EpisodeRenderPreflightPanel episodeId={episodeId} />
      ) : (
        <DomainWorkspace
          title="制作"
          domains={[stage]}
          projectId={projectId}
          parentId={parentId}
          parentRequired={parentRequired}
        />
      )}
    </section>
  );
}

type StoryboardUndo = {
  sceneId: string;
  previousIds: string[];
  currentRecords: DomainEntity[];
};

function stillStateLabel(state: StoryboardShot["stillState"]): string {
  if (state === "adopted") return "静帧已采用";
  if (state === "candidate") return "存在待确认静帧";
  return "暂无静帧预览";
}

function StoryboardBoard(props: {
  projectId: string;
  episodeId: string;
  selectedShotId?: string;
  onSelectShot(shotId: string, sceneId: string, scriptId: string): void;
  onOpenAssetCenter(shotId: string, sceneId: string, scriptId: string): void;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "attention" | "missing-assets">(
    "all",
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [visiblePerScene, setVisiblePerScene] = useState(50);
  const [draggingId, setDraggingId] = useState<string>();
  const [savingSceneId, setSavingSceneId] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [undo, setUndo] = useState<StoryboardUndo>();
  const { data: scripts = [] } = useQuery({
    queryKey: ["storyboard", "scripts", props.projectId],
    queryFn: () => client.resources.list("scripts", props.projectId),
  });
  const { data: scenes = [] } = useQuery({
    queryKey: ["storyboard", "scenes", props.projectId],
    queryFn: () => client.resources.list("scenes", props.projectId),
  });
  const { data: shots = [] } = useQuery({
    queryKey: ["storyboard", "shots", props.projectId],
    queryFn: () => client.resources.list("shots", props.projectId),
  });
  const { data: stills = [] } = useQuery({
    queryKey: ["storyboard", "stills", props.projectId],
    queryFn: () => client.resources.list("shot-stills", props.projectId),
  });
  const { data: assetCenter } = useQuery({
    queryKey: ["asset-center", props.projectId],
    queryFn: () => client.assetCenter.get(props.projectId),
  });
  const storyboard = buildStoryboard({
    episodeId: props.episodeId || undefined,
    scripts,
    scenes,
    shots,
    stills,
    assets: assetCenter?.assets ?? [],
  });
  const matchesFilter = (shot: StoryboardShot) => {
    const haystack = [
      shot.title,
      shot.visualDescription,
      shot.dialogue,
      ...shot.referencedAssets.map((asset) => asset.title),
    ]
      .join(" ")
      .toLocaleLowerCase();
    if (query.trim() && !haystack.includes(query.trim().toLocaleLowerCase()))
      return false;
    if (filter === "attention")
      return shot.rightsBlocked || shot.costRisk || shot.stillState !== "adopted";
    return filter !== "missing-assets" || shot.missingAssetReference;
  };
  const visibleScenes = storyboard
    .map((scene) => ({
      ...scene,
      shots: scene.shots.filter(matchesFilter),
    }))
    .filter((scene) => scene.shots.length);
  const toggleSelected = (shotId: string) =>
    setSelectedIds((current) =>
      current.includes(shotId)
        ? current.filter((id) => id !== shotId)
        : [...current, shotId],
    );
  const refreshShots = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["storyboard", "shots", props.projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["resource", "shots", props.projectId],
      }),
      queryClient.invalidateQueries({ queryKey: ["asset-center", props.projectId] }),
    ]);
  };
  const reorder = async (
    scene: StoryboardScene,
    movingId: string,
    targetId: string,
  ) => {
    const next = reorderStoryboardShots(scene.shots, movingId, targetId);
    if (next.every((shot, index) => shot.id === scene.shots[index]?.id)) return;
    setSavingSceneId(scene.id);
    setNotice(undefined);
    try {
      const result = await client.productionStructure.reorderShots(scene.id, {
        items: next.map((shot) => ({ id: shot.id, version: shot.version })),
      });
      setUndo({
        sceneId: scene.id,
        previousIds: scene.shots.map((shot) => shot.id),
        currentRecords: result.records,
      });
      setNotice("已保存分镜顺序；可在下一次调整前撤销这次重排。");
      await refreshShots();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setSavingSceneId(undefined);
      setDraggingId(undefined);
    }
  };
  const move = (scene: StoryboardScene, shotId: string, direction: -1 | 1) => {
    const index = scene.shots.findIndex((shot) => shot.id === shotId);
    const target = scene.shots[index + direction];
    if (target) void reorder(scene, shotId, target.id);
  };
  const undoReorder = async () => {
    if (!undo) return;
    const recordsById = new Map(undo.currentRecords.map((record) => [record.id, record]));
    const items = undo.previousIds
      .map((id) => recordsById.get(id))
      .filter((record): record is DomainEntity => Boolean(record))
      .map((record) => ({ id: record.id, version: record.version }));
    if (items.length !== undo.previousIds.length) {
      setNotice("无法恢复：镜头集合已变化，请刷新后检查当前顺序。");
      setUndo(undefined);
      return;
    }
    setSavingSceneId(undo.sceneId);
    try {
      await client.productionStructure.reorderShots(undo.sceneId, { items });
      setNotice("已恢复上一次分镜顺序。");
      setUndo(undefined);
      await refreshShots();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setSavingSceneId(undefined);
    }
  };
  const selectedShot = storyboard
    .flatMap((scene) => scene.shots.map((shot) => ({ scene, shot })))
    .find(({ shot }) => selectedIds.length === 1 && shot.id === selectedIds[0]);
  return (
    <section className="space-y-5" aria-label="导演分镜看板">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">集级导演工作台</p>
          <h2 className="mt-1 text-2xl font-semibold">卡片式导演分镜看板</h2>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            按场景扫视镜头、静帧和锁定资产。重排只提交同一场景的完整镜头集合，并以版本号防止并发覆盖。
          </p>
        </div>
        <span className="rounded-full bg-brand-soft px-3 py-1.5 text-sm text-brand">
          {storyboard.reduce((total, scene) => total + scene.shots.length, 0)} 个镜头
        </span>
      </div>
      <div className="grid gap-3 rounded-2xl border border-line bg-surface p-4 md:grid-cols-[1fr_auto]">
        <label className="grid gap-1 text-sm">
          搜索镜头、对白或资产
          <input
            className="rounded-lg border border-line px-3 py-2"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="例如：雨夜、门缝、林晚"
          />
        </label>
        <div className="grid gap-1 text-sm">
          风险筛选
          <div className="flex flex-wrap gap-2" role="group" aria-label="分镜筛选">
            {(
              [
                ["all", "全部镜头"],
                ["attention", "需处理"],
                ["missing-assets", "缺资产引用"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={`rounded-full px-3 py-1.5 text-sm ${filter === value ? "bg-brand text-white" : "bg-canvas text-muted ring-1 ring-line"}`}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {notice && (
        <p className="rounded-lg bg-brand-soft p-3 text-sm text-brand">{notice}</p>
      )}
      {(selectedIds.length > 0 || undo) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3 text-sm">
          {selectedIds.length > 0 && <span>已选 {selectedIds.length} 个镜头</span>}
          {selectedShot && (
            <button
              className="rounded-lg border border-brand px-3 py-1.5 text-brand"
              onClick={() =>
                props.onOpenAssetCenter(
                  selectedShot.shot.id,
                  selectedShot.scene.id,
                  selectedShot.scene.scriptId,
                )
              }
            >
              查看选定镜头的资产用途
            </button>
          )}
          {selectedIds.length > 0 && (
            <button
              className="rounded-lg border border-line px-3 py-1.5 text-muted"
              onClick={() => setSelectedIds([])}
            >
              清除选择
            </button>
          )}
          {undo && (
            <button
              className="rounded-lg border border-brand px-3 py-1.5 text-brand disabled:opacity-50"
              disabled={Boolean(savingSceneId)}
              onClick={() => void undoReorder()}
            >
              撤销上次重排
            </button>
          )}
        </div>
      )}
      {visibleScenes.map((scene) => {
        const shownShots = scene.shots.slice(0, visiblePerScene);
        return (
          <section
            key={scene.id}
            className="rounded-2xl border border-line bg-surface p-4"
            aria-label={`场景：${scene.title}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">{scene.title}</h3>
                <p className="mt-1 text-sm text-muted">
                  {scene.location || "未填写地点与时间"} · {scene.shots.length} 个镜头
                </p>
              </div>
              <span className="text-xs text-muted">
                {savingSceneId === scene.id ? "正在保存顺序…" : "可拖拽或用 Alt + ↑/↓ 重排"}
              </span>
            </div>
            <div className="mt-4 grid gap-3 xl:grid-cols-2">
              {shownShots.map((shot) => {
                const fullIndex = scene.shots.findIndex(
                  (candidate) => candidate.id === shot.id,
                );
                return (
                  <article
                  key={shot.id}
                  data-shot-id={shot.id}
                  draggable={!savingSceneId}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    setDraggingId(shot.id);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggingId) void reorder(scene, draggingId, shot.id);
                  }}
                  className={`rounded-xl border p-4 ${props.selectedShotId === shot.id ? "border-brand bg-brand-soft" : "border-line bg-canvas"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <button
                        className="text-left text-sm font-semibold hover:text-brand"
                        aria-label={`选择分镜：${shot.title}`}
                        aria-pressed={props.selectedShotId === shot.id}
                        onClick={() =>
                          props.onSelectShot(shot.id, scene.id, scene.scriptId)
                        }
                        onKeyDown={(event) => {
                          if (!event.altKey) return;
                          if (event.key === "ArrowUp") {
                            event.preventDefault();
                            move(scene, shot.id, -1);
                          }
                          if (event.key === "ArrowDown") {
                            event.preventDefault();
                            move(scene, shot.id, 1);
                          }
                        }}
                      >
                        {fullIndex + 1}. {shot.title}
                      </button>
                      <p className="mt-1 text-xs text-muted">{shot.visualDescription}</p>
                    </div>
                    <label className="flex shrink-0 items-center gap-1 text-xs text-muted">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(shot.id)}
                        aria-label={`批量选择：${shot.title}`}
                        onChange={() => toggleSelected(shot.id)}
                      />
                      选择
                    </label>
                  </div>
                  <div
                    className="mt-3 rounded-lg border border-dashed border-line bg-white p-3 text-xs text-muted"
                    aria-label={`静帧预览：${stillStateLabel(shot.stillState)}`}
                  >
                    {stillStateLabel(shot.stillState)}；本卡片只显示真实静帧状态，未附带受控媒体时不伪造缩略图。
                  </div>
                  <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                    <div><dt className="text-muted">对白</dt><dd>{shot.dialogue || "无对白"}</dd></div>
                    <div><dt className="text-muted">景别 / 机位</dt><dd>{shot.camera || "未填写"}</dd></div>
                    <div><dt className="text-muted">运镜 / 时长</dt><dd>{[shot.movement, shot.duration].filter(Boolean).join(" · ") || "未填写"}</dd></div>
                    <div><dt className="text-muted">任务状态</dt><dd>{shot.taskStatus}</dd></div>
                  </dl>
                  <div className="mt-3 flex flex-wrap gap-1.5" aria-label={`${shot.title} 资产覆盖`}>
                    {(["character", "scene", "prop", "voice"] as const).map((category) => (
                      <span key={category} className="rounded-full bg-white px-2 py-1 text-xs text-muted ring-1 ring-line">
                        {ASSET_CATEGORY_LABELS[category]} {shot.categoryCounts[category]}
                      </span>
                    ))}
                    <span className={`rounded-full px-2 py-1 text-xs ${shot.lockedAssetCount ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                      {shot.lockedAssetCount ? `已锁 ${shot.lockedAssetCount}` : "暂无锁定资产"}
                    </span>
                    {shot.missingAssetReference && <span className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-800">缺资产引用</span>}
                    {shot.rightsBlocked && <span className="rounded-full bg-red-50 px-2 py-1 text-xs text-red-700">权利 / stale 阻断</span>}
                    {shot.costRisk && <span className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-800">费用或服务风险</span>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="rounded border border-line px-2 py-1 text-xs text-muted disabled:opacity-40"
                      disabled={Boolean(savingSceneId) || fullIndex === 0}
                      onClick={() => move(scene, shot.id, -1)}
                    >
                      上移
                    </button>
                    <button
                      className="rounded border border-line px-2 py-1 text-xs text-muted disabled:opacity-40"
                      disabled={
                        Boolean(savingSceneId) ||
                        fullIndex === scene.shots.length - 1
                      }
                      onClick={() => move(scene, shot.id, 1)}
                    >
                      下移
                    </button>
                    <button
                      className="rounded border border-brand px-2 py-1 text-xs text-brand"
                      onClick={() =>
                        props.onOpenAssetCenter(shot.id, scene.id, scene.scriptId)
                      }
                    >
                      查看资产用途
                    </button>
                  </div>
                  </article>
                );
              })}
            </div>
            {scene.shots.length > shownShots.length && (
              <button
                className="mt-3 rounded-lg border border-line px-3 py-2 text-sm text-muted"
                onClick={() => setVisiblePerScene((current) => current + 50)}
              >
                继续加载该场景的 {Math.min(50, scene.shots.length - shownShots.length)} 个镜头
              </button>
            )}
          </section>
        );
      })}
      {!visibleScenes.length && (
        <p className="rounded-xl border border-dashed border-line p-8 text-sm text-muted">
          当前分集尚无可展示的分镜；可先在改编区建立场景和镜头，或调整筛选条件。
        </p>
      )}
    </section>
  );
}

const ASSET_CATEGORY_LABELS: Record<AssetCenterAsset["category"], string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
  voice: "音色",
};

function assetStatusLabel(asset: AssetCenterAsset): string {
  if (asset.stale) return "设定已过期";
  if (asset.preview.status === "missing") return "本地文件缺失";
  if (asset.rightsStatus === "restricted") return "权利受限";
  if (asset.costStatus === "unknown") return "费用未知";
  if (asset.providerStatus === "unavailable") return "服务不可用";
  if (asset.preview.status === "unattached") return "尚未附加媒体";
  return asset.adopted ? "已采用" : "候选版本";
}

function AssetCenterPanel(props: {
  projectId: string;
  selectedShotId?: string;
  onOpenCatalog(): void;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const { data: center, error } = useQuery({
    queryKey: ["asset-center", props.projectId],
    queryFn: () => client.assetCenter.get(props.projectId),
  });
  const { data: shots = [] } = useQuery({
    queryKey: ["resource", "shots", props.projectId],
    queryFn: () => client.resources.list("shots", props.projectId),
  });
  const [category, setCategory] = useState<
    "all" | AssetCenterAsset["category"]
  >("all");
  const [query, setQuery] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [shotId, setShotId] = useState("");
  const [notice, setNotice] = useState<string>();
  const [workingId, setWorkingId] = useState<string>();
  const [previews, setPreviews] = useState<
    Record<string, AssetCenterPreviewMedia>
  >({});
  useEffect(() => {
    if (props.selectedShotId) setShotId(props.selectedShotId);
  }, [props.selectedShotId]);
  const assets = center?.assets ?? [];
  const filtered = assets.filter(
    (asset) =>
      (category === "all" || asset.category === category) &&
      `${asset.title} ${asset.subject}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const compared = assets.filter((asset) => compareIds.includes(asset.id));
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["asset-center", props.projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["resource", "shots", props.projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["resource", "visual-assets", props.projectId],
      }),
    ]);
  };
  const action = async (
    asset: AssetCenterAsset,
    actionName: "adopt" | "lock" | "unlock" | "assign-shot" | "remove-shot",
  ) => {
    if (
      (actionName === "assign-shot" || actionName === "remove-shot") &&
      !shotId
    ) {
      setNotice("请先选择要查看或迁移用途的镜头。");
      return;
    }
    setWorkingId(asset.id);
    setNotice(undefined);
    try {
      await client.assetCenter.action(asset.id, {
        action: actionName,
        version: asset.version,
        ...(actionName === "assign-shot" || actionName === "remove-shot"
          ? { shotId }
          : {}),
      });
      setNotice(
        actionName === "assign-shot"
          ? "已将锁定版本分配给镜头。"
          : actionName === "remove-shot"
            ? "已移除该镜头的资产用途。"
            : "资产版本状态已更新。",
      );
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorkingId(undefined);
    }
  };
  const toggleCompare = (id: string) => {
    setCompareIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 4) {
        setNotice("最多并排比较 4 个候选版本。");
        return current;
      }
      return [...current, id];
    });
  };
  const openPreview = async (asset: AssetCenterAsset) => {
    setWorkingId(asset.id);
    setNotice(undefined);
    try {
      const preview = await client.assetCenter.preview(asset.id);
      setPreviews((current) => ({ ...current, [asset.id]: preview }));
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorkingId(undefined);
    }
  };
  return (
    <section className="space-y-5" aria-label="资产中心">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">导演资产工作台</p>
          <h2 className="mt-1 text-2xl font-semibold">统一资产中心</h2>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            角色、场景、道具和音色的候选版本共用同一份本地实体记录；媒体只保留受控归档引用，不在此复制二进制或暴露路径。
          </p>
        </div>
        <button
          className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white"
          onClick={props.onOpenCatalog}
        >
          新建资产候选
        </button>
      </div>
      <div className="grid gap-3 rounded-2xl border border-line bg-surface p-4 md:grid-cols-[1fr_auto]">
        <label className="grid gap-1 text-sm">
          搜索资产或关联对象
          <input
            className="rounded-lg border border-line px-3 py-2"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="例如：林晚、雨夜门口"
          />
        </label>
        <label className="grid gap-1 text-sm">
          镜头用途
          <select
            className="min-w-56 rounded-lg border border-line px-3 py-2"
            value={shotId}
            onChange={(event) => setShotId(event.target.value)}
          >
            <option value="">选择镜头以分配或迁移</option>
            {shots.map((shot) => (
              <option key={shot.id} value={shot.id}>
                {shot.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="资产类型筛选"
      >
        {(["all", "character", "scene", "prop", "voice"] as const).map(
          (item) => (
            <button
              key={item}
              className={`rounded-full px-3 py-1.5 text-sm ${category === item ? "bg-brand text-white" : "bg-surface text-muted ring-1 ring-line"}`}
              onClick={() => setCategory(item)}
            >
              {item === "all" ? "全部资产" : ASSET_CATEGORY_LABELS[item]}
            </button>
          ),
        )}
      </div>
      {notice && (
        <p className="rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {message(error)}
        </p>
      )}
      {compared.length > 0 && (
        <section
          className="rounded-2xl border border-brand bg-brand-soft/30 p-4"
          aria-label="资产版本比较"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">候选版本比较</h3>
              <p className="mt-1 text-sm text-muted">
                比较不会改变采用、锁定或镜头引用。
              </p>
            </div>
            <button
              className="text-sm text-brand"
              onClick={() => setCompareIds([])}
            >
              清空比较
            </button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {compared.map((asset) => (
              <article
                key={asset.id}
                className="rounded-xl border border-line bg-white p-3 text-sm"
              >
                <p className="font-medium">{asset.title}</p>
                <p className="mt-1 text-xs text-muted">
                  {asset.assetVersion} · {assetStatusLabel(asset)}
                </p>
                <p className="mt-3 line-clamp-3 text-muted">
                  {asset.preview.label ?? "没有可展示的本地预览说明。"}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((asset) => (
          <article
            key={asset.id}
            className="rounded-2xl border border-line bg-surface p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-brand">
                  {ASSET_CATEGORY_LABELS[asset.category]} · {asset.subject}
                </p>
                <h3 className="mt-1 truncate font-semibold">{asset.title}</h3>
                <p className="mt-1 text-xs text-muted">
                  版本 {asset.assetVersion}
                </p>
              </div>
              <button
                className={`rounded-md px-2 py-1 text-xs ${compareIds.includes(asset.id) ? "bg-brand text-white" : "border border-line text-muted"}`}
                onClick={() => toggleCompare(asset.id)}
              >
                {compareIds.includes(asset.id) ? "已加入比较" : "加入比较"}
              </button>
            </div>
            <div className="mt-3 rounded-xl bg-canvas p-3 text-sm">
              <p className="font-medium">
                {asset.preview.kind === "audio" ? "音频预览" : "视觉预览"}
              </p>
              {previews[asset.id]?.kind === "image" ? (
                <img
                  className="mt-2 max-h-48 w-full rounded-lg object-cover"
                  src={previews[asset.id].dataUrl}
                  alt={`${asset.title} 本地预览`}
                />
              ) : previews[asset.id]?.kind === "audio" ? (
                <audio
                  className="mt-2 w-full"
                  controls
                  src={previews[asset.id].dataUrl}
                  aria-label={`${asset.title} 音频预览`}
                />
              ) : (
                <p className="mt-1 text-muted">
                  {asset.preview.status === "available"
                    ? `本地归档可用：${asset.preview.label ?? "已附加媒体"}`
                    : asset.preview.status === "missing"
                      ? "本地归档文件缺失；不会伪造预览。"
                      : (asset.preview.label ??
                        "尚未附加本地媒体；可先保留为文字候选。")}
                </p>
              )}
              {asset.preview.status === "available" && !previews[asset.id] && (
                <button
                  className="mt-2 rounded-md border border-line px-2 py-1 text-xs text-brand disabled:opacity-50"
                  disabled={workingId === asset.id}
                  onClick={() => void openPreview(asset)}
                >
                  打开本地预览
                </button>
              )}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-muted">采用</dt>
                <dd>{asset.adopted ? "已采用" : "候选"}</dd>
              </div>
              <div>
                <dt className="text-muted">锁定</dt>
                <dd>{asset.lockStatus === "locked" ? "已锁定" : "未锁定"}</dd>
              </div>
              <div>
                <dt className="text-muted">权利</dt>
                <dd>
                  {asset.rightsStatus === "verified"
                    ? "已核验"
                    : asset.rightsStatus === "restricted"
                      ? "受限"
                      : "待核验"}
                </dd>
              </div>
              <div>
                <dt className="text-muted">费用 / 服务</dt>
                <dd>
                  {asset.costStatus === "unknown" ? "费用未知" : "费用已知"} ·{" "}
                  {asset.providerStatus === "unavailable"
                    ? "不可用"
                    : "可用或无需服务"}
                </dd>
              </div>
            </dl>
            {asset.usages.length > 0 && (
              <p className="mt-3 rounded-lg bg-brand-soft/50 p-2 text-xs text-brand">
                正在用于：
                {asset.usages.map((usage) => usage.shotTitle).join("、")}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {!asset.adopted && (
                <button
                  className="rounded-md border border-brand px-2 py-1 text-xs text-brand disabled:opacity-50"
                  disabled={workingId === asset.id}
                  onClick={() => void action(asset, "adopt")}
                >
                  采用此版本
                </button>
              )}
              {asset.adopted && asset.lockStatus === "unlocked" && (
                <button
                  className="rounded-md border border-line px-2 py-1 text-xs text-muted disabled:opacity-50"
                  disabled={workingId === asset.id}
                  onClick={() => void action(asset, "lock")}
                >
                  锁定版本
                </button>
              )}
              {asset.lockStatus === "locked" && (
                <button
                  className="rounded-md border border-line px-2 py-1 text-xs text-muted disabled:opacity-50"
                  disabled={workingId === asset.id}
                  onClick={() => void action(asset, "unlock")}
                >
                  解除锁定
                </button>
              )}
              {asset.adopted && asset.lockStatus === "locked" && (
                <button
                  className="rounded-md border border-line px-2 py-1 text-xs text-muted disabled:opacity-50"
                  disabled={workingId === asset.id}
                  onClick={() => void action(asset, "assign-shot")}
                >
                  分配到镜头
                </button>
              )}
              {asset.usages.some((usage) => usage.shotId === shotId) && (
                <button
                  className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 disabled:opacity-50"
                  disabled={workingId === asset.id}
                  onClick={() => void action(asset, "remove-shot")}
                >
                  移除镜头用途
                </button>
              )}
            </div>
          </article>
        ))}
        {!filtered.length && (
          <p className="rounded-xl border border-dashed border-line p-8 text-sm text-muted">
            当前筛选下没有资产候选。可先新建角色、场景、道具或音色版本。
          </p>
        )}
      </div>
    </section>
  );
}

function ImageGenerationPanel(props: { projectId: string; shotId: string }) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [providerId, setProviderId] = useState("");
  const [kind, setKind] = useState<
    "still" | "first_frame" | "last_frame" | "cover"
  >("still");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [size, setSize] = useState("1024x1536");
  const [notice, setNotice] = useState<string>();
  const [running, setRunning] = useState(false);
  const { data: providers = [] } = useQuery({
    queryKey: ["resource", "providers"],
    queryFn: () => client.resources.list("providers"),
  });
  const { data: candidates = [] } = useQuery({
    queryKey: ["resource", "shot-stills", props.projectId, props.shotId],
    queryFn: () =>
      client.resources.list("shot-stills", props.projectId, props.shotId),
  });
  const run = async () => {
    if (!providerId || !prompt.trim()) {
      setNotice("请选择图片服务商并填写生成提示。");
      return;
    }
    setRunning(true);
    setNotice(undefined);
    try {
      const result = await client.imageGeneration.run(
        {
          providerId,
          projectId: props.projectId,
          shotId: props.shotId,
          kind,
          prompt: prompt.trim(),
          ...(negativePrompt.trim()
            ? { negativePrompt: negativePrompt.trim() }
            : {}),
          ...(size.trim() ? { size: size.trim() } : {}),
        },
        crypto.randomUUID(),
      );
      setNotice(
        `已归档 ${result.candidates.length} 张候选图片，请人工采用后进入动态分镜。`,
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["resource", "shot-stills", props.projectId, props.shotId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["resource", "assets", props.projectId],
        }),
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      ]);
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setRunning(false);
    }
  };
  const adopt = async (id: string) => {
    try {
      await client.visuals.adoptStill(id);
      setNotice("已采用该静帧候选。后续动态分镜会优先引用它。");
      await queryClient.invalidateQueries({
        queryKey: ["resource", "shot-stills", props.projectId, props.shotId],
      });
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  return (
    <section className="space-y-4 rounded-2xl border border-line bg-surface p-4">
      <div>
        <h2 className="font-semibold">图片生成与静帧采用</h2>
        <p className="mt-1 text-sm text-muted">
          服务端只会请求已配置的厂商图片 API 或 Stable Diffusion WebUI
          服务；结果先归档为候选静帧，不会自动替换已采用版本。
        </p>
      </div>
      <div className="grid gap-3 rounded-xl border border-line p-3 md:grid-cols-2 xl:grid-cols-3">
        <label className="grid gap-1 text-sm">
          图片服务商
          <select
            className="rounded-lg border border-line px-3 py-2"
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
          >
            <option value="">选择已配置服务商</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          候选类型
          <select
            className="rounded-lg border border-line px-3 py-2"
            value={kind}
            onChange={(event) => setKind(event.target.value as typeof kind)}
          >
            <option value="still">静帧</option>
            <option value="first_frame">首帧</option>
            <option value="last_frame">尾帧</option>
            <option value="cover">封面</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          尺寸
          <input
            className="rounded-lg border border-line px-3 py-2"
            value={size}
            onChange={(event) => setSize(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2 xl:col-span-3">
          生成提示
          <textarea
            className="min-h-24 rounded-lg border border-line px-3 py-2"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="描述构图、角色、场景、光线与竖屏画面要求"
          />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2 xl:col-span-3">
          反向提示词（可选）
          <textarea
            className="min-h-20 rounded-lg border border-line px-3 py-2"
            placeholder="例如：低清晰度、文字水印、变形手部"
            value={negativePrompt}
            onChange={(event) => setNegativePrompt(event.target.value)}
          />
        </label>
        <button
          className="w-fit rounded-lg bg-brand px-3 py-2 text-sm text-white disabled:opacity-50"
          disabled={running}
          onClick={() => void run()}
        >
          {running ? "正在生成并归档…" : "生成候选图片"}
        </button>
      </div>
      <section className="rounded-xl border border-line p-3">
        <h3 className="font-medium">当前分镜候选</h3>
        <div className="mt-3 space-y-2">
          {!candidates.length && (
            <p className="text-sm text-muted">尚无候选图片。</p>
          )}
          {candidates.map((candidate) => {
            const payload = recordPayload(candidate.payload);
            const adopted = payload["采用状态"] === "已采用";
            return (
              <div
                key={candidate.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3 text-sm"
              >
                <span>
                  {candidate.title} · {adopted ? "已采用" : "待采用"}
                </span>
                {!adopted && (
                  <button
                    className="rounded border border-brand px-2 py-1 text-xs text-brand"
                    onClick={() => void adopt(candidate.id)}
                  >
                    采用此静帧
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>
      {notice && (
        <p className="rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
    </section>
  );
}

function VideoGenerationPanel(props: {
  projectId: string;
  episodeId: string;
  shotId: string;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [providerId, setProviderId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [seconds, setSeconds] = useState("5");
  const [confirmUnknownCost, setConfirmUnknownCost] = useState(false);
  const [preflight, setPreflight] = useState<VideoGenerationPreflight>();
  const [notice, setNotice] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [checkingReadiness, setCheckingReadiness] = useState(false);
  const { data: providers = [] } = useQuery({
    queryKey: ["resource", "providers"],
    queryFn: () => client.resources.list("providers"),
  });
  const { data: shot } = useQuery({
    queryKey: ["video-generation-shot", props.shotId],
    queryFn: () => client.resources.get("shots", props.shotId),
  });
  const { data: jobs = [] } = useQuery({
    queryKey: ["video-generation", props.shotId],
    queryFn: () => client.videoGeneration.listByShot(props.shotId),
    refetchInterval: (query) =>
      query.state.data?.some((job) =>
        ["queued", "running"].includes(job.status),
      )
        ? 10_000
        : false,
  });
  const refresh = async () =>
    queryClient.invalidateQueries({
      queryKey: ["video-generation", props.shotId],
    });
  useEffect(() => {
    setPreflight(undefined);
  }, [providerId, prompt, seconds, props.shotId]);
  useEffect(() => {
    const payload = recordPayload(shot?.payload);
    const savedPrompt =
      typeof payload["生成提示"] === "string" ? payload["生成提示"] : "";
    const durationValue = payload["时长"] ?? payload["时长秒数"];
    const duration =
      typeof durationValue === "number"
        ? durationValue
        : typeof durationValue === "string"
          ? Number(durationValue.match(/\d+/)?.[0])
          : undefined;
    if (savedPrompt) setPrompt(savedPrompt);
    if (Number.isInteger(duration) && duration! > 0)
      setSeconds(String(duration));
  }, [shot?.id, shot?.version]);
  const input = (): VideoGenerationInput | undefined => {
    if (!providerId || !prompt.trim()) {
      setNotice("请选择视频服务商并填写生成提示。");
      return undefined;
    }
    const length = Number(seconds);
    if (!Number.isInteger(length) || length < 1 || length > 60) {
      setNotice("视频时长须为 1 至 60 秒的整数。");
      return undefined;
    }
    return {
      providerId,
      projectId: props.projectId,
      episodeId: props.episodeId,
      shotId: props.shotId,
      prompt: prompt.trim(),
      seconds: length,
      confirmUnknownCost,
    };
  };
  const checkReadiness = async () => {
    const request = input();
    if (!request) return;
    setCheckingReadiness(true);
    setNotice(undefined);
    try {
      const result = await client.videoGeneration.preflight(
        props.shotId,
        request,
      );
      setPreflight(result);
      setNotice(
        result.ready
          ? "预检通过：本次提交将固定使用当前静帧、资产版本、参数与费用快照。"
          : "预检发现阻断项；不会向视频服务商发起调用。",
      );
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setCheckingReadiness(false);
    }
  };
  const create = async () => {
    const request = input();
    if (!request) return;
    if (!preflight?.ready) {
      setNotice("请先完成静帧、资产、权利和费用预检。");
      return;
    }
    setCreating(true);
    try {
      const job = await client.videoGeneration.create(
        { ...request, readinessHash: preflight.snapshotHash },
        crypto.randomUUID(),
      );
      setNotice(videoJobNotice(job.status));
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setCreating(false);
    }
  };
  const check = async (id: string) => {
    try {
      const job = await client.videoGeneration.refresh(id);
      setNotice(videoJobNotice(job.status));
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const cancel = async (id: string) => {
    try {
      await client.videoGeneration.cancel(id);
      setNotice("已停止本地追踪，请在服务商侧确认远端任务状态。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const retry = async (id: string) => {
    try {
      const job = await client.videoGeneration.retry(
        id,
        {},
        crypto.randomUUID(),
      );
      setNotice(
        job.status === "succeeded"
          ? "重试视频已完成并归档为分镜候选。"
          : "已创建新的视频生成任务，并保留原任务作为重试父记录。",
      );
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const adopt = async (id: string) => {
    try {
      await client.visuals.adoptVideo(id);
      setNotice("已采用视频候选。分镜将引用此版本，其他候选仍会保留以供比较。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  return (
    <section className="space-y-4 rounded-2xl border border-line bg-surface p-4">
      <div>
        <h2 className="font-semibold">视频生成与候选采用</h2>
        <p className="mt-1 text-sm text-muted">
          先确认低成本静帧和锁定资产，再以服务端签发的快照提交兼容 OpenAI
          视频接口； 任何预检阻断都会在厂商调用前停止。
        </p>
      </div>
      <section className="grid gap-3 rounded-xl border border-line p-3 md:grid-cols-2 xl:grid-cols-3">
        <select
          className="rounded-lg border border-line px-3 py-2 text-sm"
          value={providerId}
          onChange={(event) => setProviderId(event.target.value)}
        >
          <option value="">选择视频服务商</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.title}
            </option>
          ))}
        </select>
        <input
          className="rounded-lg border border-line px-3 py-2 text-sm"
          type="number"
          min="1"
          max="60"
          value={seconds}
          onChange={(event) => setSeconds(event.target.value)}
        />
        <button
          className="w-fit rounded-lg border border-brand px-3 py-2 text-sm text-brand disabled:opacity-50"
          disabled={
            creating || checkingReadiness || !providerId || !prompt.trim()
          }
          onClick={() => void checkReadiness()}
        >
          {checkingReadiness ? "正在检查…" : "检查静帧与视频预检"}
        </button>
        <button
          className="w-fit rounded-lg bg-brand px-3 py-2 text-sm text-white disabled:opacity-50"
          disabled={creating || !preflight?.ready}
          onClick={() => void create()}
          title={
            preflight?.ready
              ? "提交与预检快照完全一致的视频任务"
              : "请先通过静帧与视频预检"
          }
        >
          {creating ? "正在提交…" : "提交视频生成"}
        </button>
        <textarea
          className="min-h-24 rounded-lg border border-line px-3 py-2 text-sm md:col-span-2 xl:col-span-3"
          placeholder="描述动作、镜头运动、角色、场景和竖屏构图"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </section>
      <section className="rounded-xl border border-line p-3 text-sm">
        <h3 className="font-medium">静帧优先预检</h3>
        <p className="mt-1 text-xs text-muted">
          必须已采用未过期静帧，且当前镜头引用的资产均已采用、锁定并完成权利核验；提示、时长或资产版本变化后需重新检查。
        </p>
        {preflight?.costStatus === "unknown" && (
          <label className="mt-3 flex items-start gap-2 text-xs text-amber-700">
            <input
              type="checkbox"
              checked={confirmUnknownCost}
              onChange={(event) => setConfirmUnknownCost(event.target.checked)}
            />
            我理解当前视频费用未知，并会在生成账本中复核实际费用。
          </label>
        )}
        {preflight && (
          <div className="mt-3 space-y-2 text-xs">
            <p>
              快照 {preflight.snapshotHash.slice(0, 18)}… · 静帧{" "}
              {preflight.adoptedStillId ? "已采用" : "未采用"} · 已锁定资产{" "}
              {preflight.lockedAssetIds.length} 个
              {preflight.costStatus === "known"
                ? ` · 预估费用 ${preflight.estimatedCost ?? 0} ${preflight.currency ?? "USD"}`
                : " · 费用未知"}
            </p>
            {preflight.blockers.map((blocker) => (
              <p
                key={blocker}
                className="rounded bg-red-50 px-2 py-1 text-red-700"
              >
                阻断：{blocker}
              </p>
            ))}
            {preflight.warnings.map((warning) => (
              <p
                key={warning}
                className="rounded bg-amber-50 px-2 py-1 text-amber-700"
              >
                注意：{warning}
              </p>
            ))}
            {preflight.ready && (
              <p className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">
                已通过：提交按钮会携带此快照；服务端会再次校验，避免静默继承变化。
              </p>
            )}
          </div>
        )}
      </section>
      <section className="rounded-xl border border-line p-3">
        <h3 className="font-medium">本分镜生成任务</h3>
        <div className="mt-3 space-y-2">
          {!jobs.length && (
            <p className="text-sm text-muted">尚未提交视频生成任务。</p>
          )}
          {jobs.map((job) => (
            <article
              key={job.id}
              className="rounded-lg border border-line p-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {videoJobStatusLabel(job.status)} ·{" "}
                  {job.results.length
                    ? `已归档 ${job.results.length} 个候选`
                    : "暂无可采用结果"}
                </span>
                <div className="flex gap-2">
                  {["queued", "running"].includes(job.status) && (
                    <button
                      className="rounded border border-brand px-2 py-1 text-xs text-brand"
                      onClick={() => void check(job.id)}
                    >
                      查询状态
                    </button>
                  )}
                  {["queued", "running"].includes(job.status) && (
                    <button
                      className="rounded border border-line px-2 py-1 text-xs text-muted"
                      onClick={() => void cancel(job.id)}
                    >
                      停止追踪
                    </button>
                  )}
                  {["failed", "canceled"].includes(job.status) && (
                    <button
                      className="rounded border border-brand px-2 py-1 text-xs text-brand"
                      onClick={() => void retry(job.id)}
                    >
                      重试生成
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-1 text-xs text-muted">{job.prompt}</p>
              {job.error && (
                <p className="mt-1 text-xs text-red-600">{job.error}</p>
              )}
              {job.results.length > 0 && (
                <div className="mt-3 space-y-2 border-t border-line pt-3">
                  <p className="text-xs font-medium text-muted">视频候选</p>
                  {job.results.map((candidate) => {
                    const adopted =
                      recordPayload(candidate.payload)["采用状态"] === "已采用";
                    return (
                      <div
                        key={candidate.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs"
                      >
                        <span>
                          {candidate.title} · {adopted ? "已采用" : "待采用"}
                        </span>
                        {!adopted && (
                          <button
                            className="rounded border border-brand px-2 py-1 text-xs text-brand"
                            onClick={() => void adopt(candidate.id)}
                          >
                            采用此视频
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
      {notice && (
        <p className="rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
    </section>
  );
}

function videoJobStatusLabel(
  status: "queued" | "running" | "succeeded" | "failed" | "canceled",
): string {
  return {
    queued: "排队中",
    running: "生成中",
    succeeded: "已完成",
    failed: "失败",
    canceled: "已停止",
  }[status];
}
function videoJobNotice(
  status: "queued" | "running" | "succeeded" | "failed" | "canceled",
): string {
  return {
    queued: "视频任务已提交，正在等待服务商开始执行。",
    running: "视频正在生成，系统会定期查询状态。",
    succeeded: "视频已完成并归档为分镜候选。",
    failed: "视频服务商报告任务失败。",
    canceled: "视频任务已停止。",
  }[status];
}

function AudioProductionPanel(props: {
  projectId: string;
  episodeId: string;
  shotId: string;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [voiceTitle, setVoiceTitle] = useState("");
  const [providerVoice, setProviderVoice] = useState("");
  const [trackLabel, setTrackLabel] = useState("");
  const [trackKind, setTrackKind] = useState<
    "dialogue" | "narration" | "bgm" | "sfx"
  >("narration");
  const [assetId, setAssetId] = useState("");
  const [voiceProfileId, setVoiceProfileId] = useState("");
  const [startSeconds, setStartSeconds] = useState("0");
  const [durationSeconds, setDurationSeconds] = useState("3");
  const [clipText, setClipText] = useState("");
  const [ttsProviderId, setTtsProviderId] = useState("");
  const [ttsVoice, setTtsVoice] = useState("");
  const [ttsText, setTtsText] = useState("");
  const [runningTts, setRunningTts] = useState(false);
  const [notice, setNotice] = useState<string>();
  const { data: voiceProfiles = [] } = useQuery({
    queryKey: ["voice-profiles", props.projectId],
    queryFn: () => client.episodeMedia.listVoiceProfiles(props.projectId),
  });
  const { data: audioTracks = [] } = useQuery({
    queryKey: ["audio-tracks", props.episodeId],
    queryFn: () => client.episodeMedia.listAudioTracks(props.episodeId),
  });
  const { data: assets = [] } = useQuery({
    queryKey: ["resource", "assets", props.projectId],
    queryFn: () => client.resources.list("assets", props.projectId),
  });
  const { data: providers = [] } = useQuery({
    queryKey: ["resource", "providers"],
    queryFn: () => client.resources.list("providers"),
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["voice-profiles", props.projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["audio-tracks", props.episodeId],
      }),
    ]);
  };
  const createVoice = async () => {
    if (!voiceTitle.trim()) {
      setNotice("请填写音色名称。");
      return;
    }
    try {
      await client.episodeMedia.createVoiceProfile({
        projectId: props.projectId,
        title: voiceTitle.trim(),
        ...(providerVoice.trim()
          ? { providerVoice: providerVoice.trim() }
          : {}),
      });
      setVoiceTitle("");
      setProviderVoice("");
      setNotice("已创建音色草案。采用后可供当前项目音轨引用。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const adoptVoice = async (id: string) => {
    try {
      await client.episodeMedia.adoptVoiceProfile(id);
      setNotice("已采用音色；同一角色只会保留一个已采用版本。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const saveTrack = async () => {
    if (!trackLabel.trim()) {
      setNotice("请填写音轨名称。");
      return;
    }
    const start = Number(startSeconds);
    const duration = Number(durationSeconds);
    if (
      !Number.isFinite(start) ||
      start < 0 ||
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      setNotice("请填写有效的片段起点和时长。");
      return;
    }
    try {
      await client.episodeMedia.createAudioTrack({
        projectId: props.projectId,
        episodeId: props.episodeId,
        kind: trackKind,
        label: trackLabel.trim(),
        clips: [
          {
            ...(props.shotId ? { shotId: props.shotId } : {}),
            ...(assetId ? { assetId } : {}),
            ...(voiceProfileId ? { voiceProfileId } : {}),
            startSeconds: start,
            durationSeconds: duration,
            ...(clipText.trim() ? { text: clipText.trim() } : {}),
          },
        ],
      });
      setTrackLabel("");
      setClipText("");
      setNotice("已另存音轨草案；采用时会再次校验当前镜头版本。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const adoptTrack = async (track: AudioTrack) => {
    try {
      await client.episodeMedia.adoptAudioTrack(track.id);
      setNotice("已采用音轨。若镜头或剧本更新，系统会将它标记为过期。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const runTts = async () => {
    if (!ttsProviderId || !ttsVoice.trim() || !ttsText.trim()) {
      setNotice("请选择语音服务商，并填写音色标识和要生成的文本。");
      return;
    }
    setRunningTts(true);
    try {
      const result = await client.ttsGeneration.run(
        {
          providerId: ttsProviderId,
          projectId: props.projectId,
          episodeId: props.episodeId,
          ...(props.shotId ? { shotId: props.shotId } : {}),
          ...(voiceProfileId ? { voiceProfileId } : {}),
          kind: trackKind === "dialogue" ? "dialogue" : "narration",
          input: ttsText.trim(),
          voice: ttsVoice.trim(),
          responseFormat: "mp3",
        },
        crypto.randomUUID(),
      );
      setAssetId(result.asset.id);
      setTtsText("");
      setNotice("已归档语音素材，并已选入当前音轨草案。请另存并采用音轨。");
      await queryClient.invalidateQueries({
        queryKey: ["resource", "assets", props.projectId],
      });
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setRunningTts(false);
    }
  };
  return (
    <section className="space-y-4 rounded-2xl border border-line bg-surface p-4">
      <div>
        <h2 className="font-semibold">音色与音轨版本</h2>
        <p className="mt-1 text-sm text-muted">
          音轨只能关联当前分集的分镜、当前项目的音色和素材；采用前会验证镜头谱系。
        </p>
      </div>
      <section className="grid gap-3 rounded-xl border border-line p-3 lg:grid-cols-2">
        <div>
          <h3 className="font-medium">新建音色草案</h3>
          <div className="mt-3 grid gap-2">
            <input
              className="rounded-lg border border-line px-3 py-2 text-sm"
              placeholder="音色名称，例如：主角旁白"
              value={voiceTitle}
              onChange={(event) => setVoiceTitle(event.target.value)}
            />
            <input
              className="rounded-lg border border-line px-3 py-2 text-sm"
              placeholder="服务商音色标识（可选）"
              value={providerVoice}
              onChange={(event) => setProviderVoice(event.target.value)}
            />
            <button
              className="w-fit rounded-lg bg-brand px-3 py-2 text-sm text-white"
              onClick={() => void createVoice()}
            >
              创建音色草案
            </button>
          </div>
        </div>
        <div>
          <h3 className="font-medium">已保存音色</h3>
          <div className="mt-3 max-h-40 space-y-2 overflow-auto">
            {!voiceProfiles.length && (
              <p className="text-sm text-muted">尚未创建音色档案。</p>
            )}
            {voiceProfiles.map((profile) => (
              <div
                key={profile.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-2 text-sm"
              >
                <span>
                  {profile.title} ·{" "}
                  {profile.status === "adopted" ? "已采用" : "草案"}
                </span>
                {profile.status !== "adopted" && (
                  <button
                    className="rounded border border-brand px-2 py-1 text-xs text-brand"
                    onClick={() => void adoptVoice(profile.id)}
                  >
                    采用音色
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="rounded-xl border border-line p-3">
        <h3 className="font-medium">生成对白或旁白</h3>
        <p className="mt-1 text-xs text-muted">
          语音结果会安全归档为素材，并自动选入下方音轨草案；不会自动采用。
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          <select
            className="rounded-lg border border-line px-3 py-2 text-sm"
            value={ttsProviderId}
            onChange={(event) => setTtsProviderId(event.target.value)}
          >
            <option value="">选择语音服务商</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.title}
              </option>
            ))}
          </select>
          <input
            className="rounded-lg border border-line px-3 py-2 text-sm"
            placeholder="服务商音色标识"
            value={ttsVoice}
            onChange={(event) => setTtsVoice(event.target.value)}
          />
          <button
            className="w-fit rounded-lg border border-brand px-3 py-2 text-sm text-brand disabled:opacity-50"
            disabled={runningTts}
            onClick={() => void runTts()}
          >
            {runningTts ? "正在生成语音…" : "生成并归档语音"}
          </button>
          <textarea
            className="min-h-20 rounded-lg border border-line px-3 py-2 text-sm md:col-span-2 xl:col-span-3"
            placeholder="输入对白或旁白文本"
            value={ttsText}
            onChange={(event) => setTtsText(event.target.value)}
          />
        </div>
      </section>
      <section className="rounded-xl border border-line p-3">
        <h3 className="font-medium">另存音轨版本</h3>
        <p className="mt-1 text-xs text-muted">
          先在“素材”中归档音频文件；未绑定文件的草案可保存，但无法通过最终成片预检。
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          <input
            className="rounded-lg border border-line px-3 py-2 text-sm"
            placeholder="音轨名称"
            value={trackLabel}
            onChange={(event) => setTrackLabel(event.target.value)}
          />
          <select
            className="rounded-lg border border-line px-3 py-2 text-sm"
            value={trackKind}
            onChange={(event) =>
              setTrackKind(event.target.value as typeof trackKind)
            }
          >
            <option value="dialogue">对白</option>
            <option value="narration">旁白</option>
            <option value="bgm">配乐</option>
            <option value="sfx">音效</option>
          </select>
          <select
            className="rounded-lg border border-line px-3 py-2 text-sm"
            value={assetId}
            onChange={(event) => setAssetId(event.target.value)}
          >
            <option value="">不绑定归档音频（仅草案）</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.title}
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-line px-3 py-2 text-sm"
            value={voiceProfileId}
            onChange={(event) => setVoiceProfileId(event.target.value)}
          >
            <option value="">不绑定音色</option>
            {voiceProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.title}
              </option>
            ))}
          </select>
          <input
            className="rounded-lg border border-line px-3 py-2 text-sm"
            type="number"
            min="0"
            step="0.1"
            placeholder="起点（秒）"
            value={startSeconds}
            onChange={(event) => setStartSeconds(event.target.value)}
          />
          <input
            className="rounded-lg border border-line px-3 py-2 text-sm"
            type="number"
            min="0.1"
            step="0.1"
            placeholder="时长（秒）"
            value={durationSeconds}
            onChange={(event) => setDurationSeconds(event.target.value)}
          />
          <textarea
            className="min-h-20 rounded-lg border border-line px-3 py-2 text-sm md:col-span-2 xl:col-span-3"
            placeholder="对白、旁白或制作说明（可选）"
            value={clipText}
            onChange={(event) => setClipText(event.target.value)}
          />
          <button
            className="w-fit rounded-lg bg-brand px-3 py-2 text-sm text-white"
            onClick={() => void saveTrack()}
          >
            另存音轨草案
          </button>
        </div>
      </section>
      <section className="rounded-xl border border-line p-3">
        <h3 className="font-medium">本分集音轨版本</h3>
        <div className="mt-3 space-y-2">
          {!audioTracks.length && (
            <p className="text-sm text-muted">尚未保存音轨。</p>
          )}
          {audioTracks.map((track) => (
            <article
              key={track.id}
              className="rounded-lg border border-line p-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {track.label} · {audioTrackKindLabel(track.kind)} ·{" "}
                  {track.status === "adopted" ? "已采用" : "草案"}
                </span>
                {track.status !== "adopted" && !track.stale && (
                  <button
                    className="rounded border border-brand px-2 py-1 text-xs text-brand"
                    onClick={() => void adoptTrack(track)}
                  >
                    采用此音轨
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-muted">
                {track.clips.length} 个片段
                {track.stale
                  ? ` · 已过期：${track.staleReason}`
                  : " · 与当前镜头版本一致"}
              </p>
            </article>
          ))}
        </div>
      </section>
      {notice && (
        <p className="rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
    </section>
  );
}

function AnimaticProductionPanel(props: {
  projectId: string;
  episodeId: string;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [annotations, setAnnotations] = useState("");
  const [notice, setNotice] = useState<string>();
  const { data: initialization, error: initializationError } = useQuery({
    queryKey: ["animatic-initialization", props.episodeId],
    queryFn: () => client.episodeMedia.initializeAnimatic(props.episodeId),
  });
  const { data: drafts = [] } = useQuery({
    queryKey: ["animatics", props.episodeId],
    queryFn: () => client.episodeMedia.listAnimatics(props.episodeId),
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["animatic-initialization", props.episodeId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["animatics", props.episodeId],
      }),
    ]);
  };
  const save = async () => {
    if (!initialization) return;
    try {
      await client.episodeMedia.createAnimatic({
        projectId: props.projectId,
        episodeId: props.episodeId,
        sourceFingerprint: initialization.sourceFingerprint,
        clips: initialization.clips,
        ...(annotations.trim() ? { annotations: annotations.trim() } : {}),
      });
      setAnnotations("");
      setNotice("已另存动态分镜草案。审核前将再次校验当前镜头谱系。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const review = async (
    id: string,
    status: "approved" | "returned",
    version: number,
  ) => {
    try {
      await client.episodeMedia.reviewAnimatic(id, { status, version });
      setNotice(
        status === "approved" ? "已通过动态分镜版本。" : "已退回动态分镜版本。",
      );
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  return (
    <section className="space-y-4 rounded-2xl border border-line bg-surface p-4">
      <div>
        <h2 className="font-semibold">动态分镜审核</h2>
        <p className="mt-1 text-sm text-muted">
          初始化从当前镜头生成时间线，并优先引用已采用的视频或静帧。缺少媒体的镜头会明确标出，不会伪造成片。
        </p>
      </div>
      {initializationError && (
        <p className="text-sm text-red-600">{message(initializationError)}</p>
      )}
      {initialization && (
        <section className="rounded-xl border border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">当前镜头时间线</h3>
            <span className="text-xs text-muted">
              {initialization.clips.length} 个镜头
            </span>
          </div>
          <div className="mt-3 max-h-48 space-y-2 overflow-auto">
            {initialization.clips.map((clip) => (
              <div
                key={clip.shotId}
                className="rounded-lg bg-canvas p-2 text-sm"
              >
                {clip.startSeconds.toFixed(1)} 秒 · {clip.title} ·{" "}
                {animaticMediaLabel(clip.mediaKind)}
              </div>
            ))}
            {!initialization.clips.length && (
              <p className="text-sm text-muted">请先建立场景与分镜。</p>
            )}
          </div>
          <label className="mt-3 grid gap-1 text-sm">
            节奏与审核说明（可选）
            <textarea
              className="min-h-20 rounded-lg border border-line px-3 py-2"
              value={annotations}
              onChange={(event) => setAnnotations(event.target.value)}
              placeholder="例如：第 3 个镜头的停留需更短"
            />
          </label>
          <button
            className="mt-3 rounded-lg bg-brand px-3 py-2 text-sm text-white disabled:opacity-50"
            disabled={!initialization.clips.length}
            onClick={() => void save()}
          >
            另存动态分镜草案
          </button>
        </section>
      )}
      <section className="rounded-xl border border-line p-3">
        <h3 className="font-medium">版本与审核结论</h3>
        <div className="mt-3 space-y-2">
          {!drafts.length && (
            <p className="text-sm text-muted">尚无动态分镜版本。</p>
          )}
          {drafts.map((draft) => (
            <article
              key={draft.id}
              className="rounded-lg border border-line p-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {draft.clips.length} 个镜头 ·{" "}
                  {animaticStatusLabel(draft.status)}
                </span>
                {draft.status === "draft" && (
                  <div className="flex gap-2">
                    <button
                      className="rounded border border-brand px-2 py-1 text-xs text-brand"
                      onClick={() =>
                        void review(draft.id, "approved", draft.version)
                      }
                    >
                      通过
                    </button>
                    <button
                      className="rounded border border-line px-2 py-1 text-xs text-muted"
                      onClick={() =>
                        void review(draft.id, "returned", draft.version)
                      }
                    >
                      退回
                    </button>
                  </div>
                )}
              </div>
              {draft.annotations && (
                <p className="mt-1 text-xs text-muted">
                  说明：{draft.annotations}
                </p>
              )}
            </article>
          ))}
        </div>
      </section>
      {notice && (
        <p className="rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
    </section>
  );
}

function EpisodeRenderPreflightPanel(props: { episodeId: string }) {
  const client = useStudio();
  const {
    data: preflight,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["episode-render-preflight", props.episodeId],
    queryFn: () => client.episodeMedia.renderPreflight(props.episodeId),
  });
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">成片渲染预检</h2>
          <p className="mt-1 text-sm text-muted">
            核对已通过的动态分镜、已采用音轨、归档媒体和当前镜头谱系；不会将占位资料冒充最终
            MP4。
          </p>
        </div>
        <button
          className="rounded-lg bg-brand px-3 py-2 text-sm text-white disabled:opacity-50"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          {isFetching ? "正在预检…" : "重新执行预检"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{message(error)}</p>}
      {preflight && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <section
            className={`rounded-xl p-3 text-sm ${preflight.ok ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-950"}`}
          >
            <h3 className="font-medium">
              {preflight.ok ? "制作输入完整" : "尚不能提交渲染"}
            </h3>
            <p className="mt-1">
              总时长：{preflight.durationSeconds.toFixed(1)} 秒 · 已采用音轨：
              {preflight.audioTrackIds.length} 条
            </p>
          </section>
          <section className="rounded-xl border border-line p-3 text-sm">
            <h3 className="font-medium">待处理阻断项</h3>
            {preflight.blockers.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                {preflight.blockers.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-muted">未发现输入阻断项。</p>
            )}
          </section>
          <section className="rounded-xl border border-line p-3 text-sm lg:col-span-2">
            <h3 className="font-medium">提示</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
              {preflight.warnings.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </section>
  );
}

function audioTrackKindLabel(kind: AudioTrack["kind"]): string {
  return { dialogue: "对白", narration: "旁白", bgm: "配乐", sfx: "音效" }[
    kind
  ];
}

function animaticMediaLabel(
  kind: AnimaticInitialization["clips"][number]["mediaKind"],
): string {
  return { video: "视频", still: "静帧", missing: "缺少媒体" }[kind];
}

function animaticStatusLabel(
  status: "draft" | "approved" | "returned",
): string {
  return { draft: "待审核", approved: "已通过", returned: "已退回" }[status];
}

function ProductionGraphPanel(props: { projectId: string }) {
  const client = useStudio();
  const { data: graph, error } = useQuery({
    queryKey: ["production-graph", props.projectId],
    queryFn: () => client.production.graph(props.projectId),
  });
  const [impact, setImpact] =
    useState<Awaited<ReturnType<typeof client.production.impact>>>();
  const impactPreview = useMutation({
    mutationFn: (sourceId: string) =>
      client.production.impact({ projectId: props.projectId, sourceId }),
    onSuccess: setImpact,
  });
  if (error)
    return (
      <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
        {message(error)}
      </p>
    );
  if (!graph)
    return (
      <p className="rounded-lg border border-line p-3 text-sm text-muted">
        正在整理制作依赖关系…
      </p>
    );
  const stages = [
    ["分集", graph.coverage.episodes],
    ["剧本", graph.coverage.scripts],
    ["场景", graph.coverage.scenes],
    ["分镜", graph.coverage.shots],
    ["素材", graph.coverage.assets],
    ["静帧已采用", `${graph.coverage.adoptedStills}/${graph.coverage.stills}`],
  ] as const;
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div>
        <h2 className="font-semibold">制作依赖图</h2>
        <p className="mt-1 text-sm text-muted">
          从项目到分镜、素材和审核交付记录的实时依赖摘要。下级资料会显示为上级的依赖项。
        </p>
      </div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {stages.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-canvas p-3 text-center">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="mt-1 text-lg font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex max-h-32 flex-wrap gap-2 overflow-auto text-xs">
        {graph.nodes.slice(1, 30).map((node) => (
          <button
            key={node.id}
            className="rounded-full border border-line bg-white px-2 py-1 text-left hover:border-brand disabled:opacity-50"
            disabled={
              impactPreview.isPending ||
              node.kind === "chapter" ||
              node.kind === "project"
            }
            onClick={() => impactPreview.mutate(node.id)}
            title="查看此条目变更后需要复核的下游内容"
          >
            {domainLabel(node.kind)} · {node.title} · {node.status}
          </button>
        ))}
        {graph.nodes.length <= 1 && (
          <p className="text-sm text-muted">
            建立分集、剧本或素材后，这里会显示生产依赖关系。
          </p>
        )}
      </div>
      {impactPreview.isPending && (
        <p className="mt-3 text-sm text-muted">正在评估变更影响…</p>
      )}
      {impactPreview.error && (
        <p className="mt-3 text-sm text-red-600">
          {message(impactPreview.error)}
        </p>
      )}
      {impact && (
        <div className="mt-3 rounded-lg bg-brand-soft/40 p-3 text-sm">
          <p className="font-medium text-brand">{impact.summary}</p>
          {impact.affected.length > 0 && (
            <p className="mt-1 text-xs leading-5 text-muted">
              {impact.affected
                .slice(0, 12)
                .map((node) => `${domainLabel(node.kind)}：${node.title}`)
                .join("；")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function ReviewDeliveryWorkspace() {
  const client = useStudio();
  const location = useLocation();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const [projectId, setProjectId] = useState("");
  const [adaptationId, setAdaptationId] = useState("");
  const [episodeId, setEpisodeId] = useState("");
  const [stage, setStage] = useState<
    "quality" | "compliance" | "localization" | "review" | "delivery"
  >("quality");
  const { data: adaptations = [] } = useQuery({
    queryKey: ["resource", "adaptations", projectId],
    queryFn: () => client.resources.list("adaptations", projectId),
    enabled: Boolean(projectId),
  });
  const { data: episodes = [] } = useQuery({
    queryKey: ["resource", "episodes", projectId, adaptationId],
    queryFn: () => client.resources.list("episodes", projectId, adaptationId),
    enabled: Boolean(projectId && adaptationId),
  });
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("projectId");
    if (requested && projects.some((project) => project.id === requested))
      setProjectId(requested);
  }, [location.search, projects]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("stage");
    if (
      requested &&
      ["quality", "compliance", "localization", "review", "delivery"].includes(
        requested,
      )
    )
      setStage(requested as typeof stage);
  }, [location.search]);
  useEffect(() => {
    if (adaptationId && !adaptations.some((item) => item.id === adaptationId))
      setAdaptationId("");
  }, [adaptationId, adaptations]);
  useEffect(() => {
    if (adaptationId || !adaptations.length) return;
    const current = projects.find(
      (project) => project.id === projectId,
    )?.currentAdaptationId;
    setAdaptationId(
      adaptations.some((item) => item.id === current)
        ? current!
        : adaptations[0]!.id,
    );
  }, [adaptationId, adaptations, projectId, projects]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("adaptationId");
    if (requested && adaptations.some((item) => item.id === requested))
      setAdaptationId(requested);
  }, [adaptations, location.search]);
  useEffect(() => {
    if (episodeId && !episodes.some((item) => item.id === episodeId))
      setEpisodeId("");
  }, [episodeId, episodes]);
  useEffect(() => {
    if (!episodeId && episodes[0]) setEpisodeId(episodes[0].id);
  }, [episodeId, episodes]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("episodeId");
    if (requested && episodes.some((item) => item.id === requested))
      setEpisodeId(requested);
  }, [episodes, location.search]);
  return (
    <section className="space-y-5">
      <div>
        <p className="text-sm text-muted">审核交付工作区</p>
        <h1 className="mt-1 text-2xl font-semibold">质量、审片与交付</h1>
        <p className="mt-2 text-sm text-muted">
          所有质量、合规、本地化、审片和交付记录均归属到具体分集。
        </p>
      </div>
      <section className="grid gap-3 rounded-2xl border border-line bg-surface p-4 md:grid-cols-3">
        <label className="grid gap-1 text-sm">
          项目
          <select
            className="rounded-lg border border-line px-3 py-2"
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setAdaptationId("");
              setEpisodeId("");
            }}
          >
            <option value="">选择项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          改编项目
          <select
            className="rounded-lg border border-line px-3 py-2"
            disabled={!projectId}
            value={adaptationId}
            onChange={(event) => {
              setAdaptationId(event.target.value);
              setEpisodeId("");
            }}
          >
            <option value="">选择改编项目</option>
            {adaptations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          分集
          <select
            className="rounded-lg border border-line px-3 py-2"
            disabled={!adaptationId}
            value={episodeId}
            onChange={(event) => setEpisodeId(event.target.value)}
          >
            <option value="">选择分集</option>
            {episodes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
      </section>
      <div className="flex flex-wrap gap-2">
        {(
          [
            "quality",
            "compliance",
            "localization",
            "review",
            "delivery",
          ] as const
        ).map((item) => (
          <button
            key={item}
            className={`rounded-full px-3 py-1.5 text-sm ${stage === item ? "bg-brand text-white" : "bg-surface text-muted ring-1 ring-line"}`}
            onClick={() => setStage(item)}
          >
            {domainLabel(item)}
          </button>
        ))}
      </div>
      {projectId && episodeId && (
        <EpisodeWorkflowPanel projectId={projectId} episodeId={episodeId} />
      )}
      {!projectId ? (
        <p className="rounded-xl border border-dashed border-line p-8 text-sm text-muted">
          请先选择项目。
        </p>
      ) : stage === "delivery" && adaptationId && episodeId ? (
        <PlatformDeliveryPanel
          projectId={projectId}
          adaptationId={adaptationId}
          episodeId={episodeId}
        />
      ) : stage === "review" && adaptationId && episodeId ? (
        <ReviewEditorPanel episodeId={episodeId} />
      ) : stage === "compliance" && adaptationId && episodeId ? (
        <CompliancePreflightPanel
          episodeId={episodeId}
          episodeTitle={
            episodes.find((item) => item.id === episodeId)?.title ?? ""
          }
        />
      ) : (
        <DomainWorkspace
          title="审核交付"
          domains={[stage]}
          projectId={projectId}
          parentId={episodeId}
          parentRequired
        />
      )}
    </section>
  );
}

function PlatformDeliveryPanel(props: {
  projectId: string;
  adaptationId: string;
  episodeId: string;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [profileId, setProfileId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [label, setLabel] = useState("方案一");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [coverAssetId, setCoverAssetId] = useState("");
  const [manualFieldsConfirmed, setManualFieldsConfirmed] = useState(false);
  const [preflight, setPreflight] = useState<PlatformDeliveryPreflight>();
  const [notice, setNotice] = useState<string>();
  const [working, setWorking] = useState<
    "保存候选" | "采用候选" | "运行预检" | "创建归档" | "导出" | undefined
  >();
  const { data: profiles = [] } = useQuery({
    queryKey: ["platform-delivery", "profiles"],
    queryFn: client.platformDelivery.listProfiles,
  });
  const { data: variants = [] } = useQuery({
    queryKey: ["platform-delivery", "variants", props.adaptationId],
    queryFn: () => client.platformDelivery.listVariants(props.adaptationId),
  });
  const { data: archives = [] } = useQuery({
    queryKey: ["platform-delivery", "archives", props.episodeId],
    queryFn: () => client.platformDelivery.listArchives(props.episodeId),
  });
  const { data: assets = [] } = useQuery({
    queryKey: ["resource", "assets", props.projectId],
    queryFn: () => client.resources.list("assets", props.projectId),
  });
  useEffect(() => {
    if (!profileId && profiles[0]) setProfileId(profiles[0].id);
  }, [profileId, profiles]);
  useEffect(() => {
    if (!variants.some((variant) => variant.id === variantId))
      setVariantId(
        variants.find((variant) => variant.status === "adopted")?.id ??
          variants[0]?.id ??
          "",
      );
  }, [variantId, variants]);
  const selectedProfile = profiles.find((profile) => profile.id === profileId);
  const resetPreflight = () => setPreflight(undefined);
  const saveVariant = async () => {
    const tagList = tags
      .split(/[，,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (
      !label.trim() ||
      !title.trim() ||
      !description.trim() ||
      !tagList.length
    ) {
      setNotice("候选必须填写标签、标题、简介和至少一个标签词。");
      return;
    }
    setWorking("保存候选");
    setNotice(undefined);
    try {
      const created = await client.platformDelivery.createVariant(
        props.adaptationId,
        {
          label: label.trim(),
          title: title.trim(),
          description: description.trim(),
          tags: tagList,
          ...(coverAssetId ? { coverAssetId } : {}),
          source: "manual",
        },
      );
      setVariantId(created.id);
      setTitle("");
      setDescription("");
      setTags("");
      setLabel(
        `方案 ${String.fromCharCode(65 + Math.min(variants.length + 1, 25))}`,
      );
      resetPreflight();
      setNotice(`已保存候选「${created.label}」，仍需显式采用后才能归档。`);
      await queryClient.invalidateQueries({
        queryKey: ["platform-delivery", "variants", props.adaptationId],
      });
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const adoptVariant = async (id: string) => {
    setWorking("采用候选");
    setNotice(undefined);
    try {
      const adopted = await client.platformDelivery.adoptVariant(id);
      setVariantId(adopted.id);
      resetPreflight();
      setNotice(`已采用「${adopted.label}」，此前采用的候选已归档保留。`);
      await queryClient.invalidateQueries({
        queryKey: ["platform-delivery", "variants", props.adaptationId],
      });
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const currentInput = () => ({
    profileId,
    creativeVariantId: variantId,
    manualFieldsConfirmed,
  });
  const runPreflight = async () => {
    if (!profileId || !variantId) {
      setNotice("请先选择平台档案和创意候选。");
      return;
    }
    setWorking("运行预检");
    setNotice(undefined);
    try {
      const result = await client.platformDelivery.preflight(
        props.episodeId,
        currentInput(),
      );
      setPreflight(result);
      setNotice(
        result.ok
          ? "预检通过，可以创建可追溯的平台提交资料清单。"
          : `预检发现 ${result.blockers.length} 项阻断，请补齐后重试。`,
      );
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const createArchive = async () => {
    if (!preflight?.ok) {
      setNotice("请先运行并通过平台交付预检。");
      return;
    }
    setWorking("创建归档");
    setNotice(undefined);
    try {
      const archive = await client.platformDelivery.createArchive(
        props.episodeId,
        currentInput(),
      );
      setNotice(
        `已创建提交资料归档 v${String(archive.deliveryVersion).padStart(3, "0")}，不会覆盖历史记录。`,
      );
      await queryClient.invalidateQueries({
        queryKey: ["platform-delivery", "archives", props.episodeId],
      });
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const exportArchive = async (archive: PlatformDeliveryArchive) => {
    setWorking("导出");
    setNotice(undefined);
    try {
      const document = await client.platformDelivery.exportArchive(archive.id);
      const result = await window.desktop.saveTextFile({
        suggestedName: document.fileName,
        content: document.content,
      });
      setNotice(result.saved ? "提交资料清单已导出。" : "已取消导出。");
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const assetTitle = (id?: string) =>
    assets.find((asset) => asset.id === id)?.title ?? "未引用";
  return (
    <section className="space-y-4 rounded-2xl border border-line bg-surface p-4">
      <div>
        <p className="text-sm text-muted">平台交付</p>
        <h2 className="mt-1 text-lg font-semibold">
          提交文案、封面与版本化资料归档
        </h2>
        <p className="mt-1 text-sm text-muted">
          这里不会保存平台账号、登录或代投。它只创建可追溯的提交资料清单；真实成片、字幕和封面仍须由人工核验并附加。
        </p>
      </div>
      <div className="grid gap-3 rounded-xl border border-line bg-page p-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          平台交付档案
          <select
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={profileId}
            onChange={(event) => {
              setProfileId(event.target.value);
              resetPreflight();
            }}
          >
            <option value="">选择平台档案</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.title} · {profile.video.width}×{profile.video.height}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          当前创意候选
          <select
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={variantId}
            onChange={(event) => {
              setVariantId(event.target.value);
              resetPreflight();
            }}
          >
            <option value="">选择创意候选</option>
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.label} · v{variant.versionNumber} · {variant.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      {selectedProfile && (
        <section className="rounded-xl border border-line p-3 text-sm">
          <p className="font-medium">{selectedProfile.title}</p>
          <p className="mt-1 text-muted">
            {selectedProfile.platform} · {selectedProfile.region} ·{" "}
            {selectedProfile.video.videoCodec}/
            {selectedProfile.video.audioCodec} · {selectedProfile.video.width}×
            {selectedProfile.video.height}
          </p>
          <p className="mt-1 text-xs text-muted">
            时长：{selectedProfile.duration.note} 字幕安全区：底部{" "}
            {selectedProfile.subtitleSafeZone.bottomMarginPx} 像素。
          </p>
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={manualFieldsConfirmed}
              onChange={(event) => {
                setManualFieldsConfirmed(event.target.checked);
                resetPreflight();
              }}
            />
            <span>
              我已人工核对：{selectedProfile.manualFields.join("；")}。
            </span>
          </label>
        </section>
      )}
      <section className="grid gap-3 rounded-xl border border-line bg-page p-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          候选标签
          <input
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="例如：方案一"
          />
        </label>
        <label className="grid gap-1 text-sm">
          封面素材
          <select
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={coverAssetId}
            onChange={(event) => setCoverAssetId(event.target.value)}
          >
            <option value="">选择已归档封面素材</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          平台标题
          <input
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="用户可见的成品标题"
          />
        </label>
        <label className="grid gap-1 text-sm">
          标签词
          <input
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="用逗号分隔，例如：悬疑、反转"
          />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2">
          平台简介
          <textarea
            className="min-h-24 rounded-lg border border-line bg-surface px-3 py-2"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="描述冲突、钩子和卖点；不会自动发布。"
          />
        </label>
        <div className="md:col-span-2">
          <button
            className="rounded-lg border border-brand px-3 py-2 text-sm text-brand disabled:opacity-50"
            disabled={Boolean(working)}
            onClick={() => void saveVariant()}
          >
            {working === "保存候选" ? "正在保存…" : "保存为新候选"}
          </button>
        </div>
      </section>
      <section className="space-y-2 rounded-xl border border-line p-3">
        <h3 className="font-medium">创意候选与采用历史</h3>
        {!variants.length && (
          <p className="text-sm text-muted">
            尚无候选。请先保存一个完整的标题、简介、标签词和封面组合。
          </p>
        )}
        {variants.map((variant: DeliveryCreativeVariant) => (
          <article
            key={variant.id}
            className={`rounded-lg border p-3 ${variant.id === variantId ? "border-brand" : "border-line"}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand">
                {variant.status === "adopted"
                  ? "已采用"
                  : variant.status === "archived"
                    ? "历史采用"
                    : "候选"}
              </span>
              <span className="text-sm font-medium">
                {variant.label} · v{variant.versionNumber} · {variant.title}
              </span>
              {variant.status !== "adopted" && (
                <button
                  className="rounded border border-line px-2 py-1 text-xs text-brand disabled:opacity-50"
                  disabled={Boolean(working)}
                  onClick={() => void adoptVariant(variant.id)}
                >
                  {working === "采用候选" ? "正在采用…" : "采用此候选"}
                </button>
              )}
            </div>
            <p className="mt-2 text-sm">{variant.description}</p>
            <p className="mt-1 text-xs text-muted">
              标签：{variant.tags.join("、")} · 封面：
              {assetTitle(variant.coverAssetId)}
            </p>
          </article>
        ))}
      </section>
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={Boolean(working)}
          onClick={() => void runPreflight()}
        >
          {working === "运行预检" ? "正在预检…" : "运行平台交付预检"}
        </button>
        <button
          className="rounded-lg border border-brand px-3 py-2 text-sm text-brand disabled:opacity-50"
          disabled={Boolean(working) || !preflight?.ok}
          onClick={() => void createArchive()}
        >
          {working === "创建归档" ? "正在归档…" : "创建提交资料归档"}
        </button>
      </div>
      {preflight && <PlatformDeliveryPreflightView preflight={preflight} />}
      {notice && (
        <p className="rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
      <section className="space-y-2 rounded-xl border border-line p-3">
        <h3 className="font-medium">提交资料归档历史</h3>
        {!archives.length && (
          <p className="text-sm text-muted">尚未创建提交资料归档。</p>
        )}
        {archives.map((archive) => (
          <div
            key={archive.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2 text-sm"
          >
            <span>v{String(archive.deliveryVersion).padStart(3, "0")}</span>
            <span className="text-muted">
              {archive.profileId} · {archive.createdAt}
            </span>
            <button
              className="rounded border border-line px-2 py-1 text-xs text-brand disabled:opacity-50"
              disabled={Boolean(working)}
              onClick={() => void exportArchive(archive)}
            >
              {working === "导出" ? "正在导出…" : "导出提交资料清单"}
            </button>
          </div>
        ))}
      </section>
    </section>
  );
}

function PlatformDeliveryPreflightView(props: {
  preflight: PlatformDeliveryPreflight;
}) {
  return (
    <section
      className={`rounded-xl border p-3 text-sm ${props.preflight.ok ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"}`}
    >
      <p className="font-medium">
        {props.preflight.ok ? "预检通过：可创建提交资料归档" : "预检未通过"}
      </p>
      {props.preflight.finalBaseName && (
        <p className="mt-1 text-xs text-muted">
          建议文件前缀：{props.preflight.finalBaseName}
        </p>
      )}
      {props.preflight.blockers.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-red-700">
          {props.preflight.blockers.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {props.preflight.warnings.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-800">
          {props.preflight.warnings.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted">
        归档将列明：{props.preflight.expectedFiles.join("、")}。
      </p>
    </section>
  );
}

function CompliancePreflightPanel(props: {
  episodeId: string;
  episodeTitle: string;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(props.episodeTitle);
  const [subtitleLanguage, setSubtitleLanguage] = useState("中文");
  const [targetPlatform, setTargetPlatform] = useState("");
  const [targetRegion, setTargetRegion] = useState("中国大陆");
  const [deliveryDate, setDeliveryDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [aigcDeclared, setAigcDeclared] = useState(false);
  const [manualReview, setManualReview] = useState(false);
  const [result, setResult] = useState<EpisodeCompliancePreflight>();
  const [notice, setNotice] = useState<string>();
  const [working, setWorking] = useState(false);
  const { data: profiles = [] } = useQuery({
    queryKey: ["compliance", "profiles"],
    queryFn: client.compliance.listProfiles,
  });
  useEffect(() => {
    if (!title && props.episodeTitle) setTitle(props.episodeTitle);
  }, [props.episodeTitle, title]);
  const activate = async (id: string) => {
    setWorking(true);
    setNotice(undefined);
    try {
      const profile = await client.compliance.activateProfile(id);
      setNotice(`已启用规则档案「${profile.title}」。`);
      await queryClient.invalidateQueries({
        queryKey: ["compliance", "profiles"],
      });
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const preflight = async () => {
    if (!title.trim() || !subtitleLanguage.trim() || !deliveryDate) {
      setNotice("请填写交付剧名、字幕语言和交付日期。");
      return;
    }
    setWorking(true);
    setNotice(undefined);
    try {
      const next = await client.compliance.preflight(props.episodeId, {
        title: title.trim(),
        subtitleLanguage: subtitleLanguage.trim(),
        ...(targetPlatform.trim()
          ? { targetPlatform: targetPlatform.trim() }
          : {}),
        ...(targetRegion.trim() ? { targetRegion: targetRegion.trim() } : {}),
        deliveryDate,
        aigcDeclared,
        manualContentReviewConfirmed: manualReview,
      });
      setResult(next);
      setNotice(
        next.ok
          ? "合规预检通过，可作为后续受控媒体封装的依据。"
          : "合规预检存在阻断项。",
      );
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  return (
    <section className="space-y-4 rounded-2xl border border-line bg-surface p-4">
      <div>
        <p className="text-sm text-muted">合规规则与预检</p>
        <h2 className="mt-1 text-lg font-semibold">
          版本化规则、人工声明与交付前核验
        </h2>
        <p className="mt-1 text-sm text-muted">
          规则档案是本地证据而非法律意见；预检不会伪造合规
          MP4、水印或平台审核结果。
        </p>
      </div>
      <section className="space-y-2 rounded-xl border border-line p-3">
        <h3 className="font-medium">规则档案</h3>
        {profiles.map((profile) => (
          <div
            key={profile.id}
            className="rounded-lg border border-line p-2 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{profile.title}</span>
              <span className="text-muted">{profile.version}</span>
              <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand">
                {profile.active
                  ? "当前启用"
                  : profile.sourceStatus === "official"
                    ? "正式规则"
                    : "仅供参考"}
              </span>
              {!profile.active &&
                profile.sourceStatus === "official" &&
                profile.integrityStatus === "verified" && (
                  <button
                    className="rounded border border-line px-2 py-1 text-xs text-brand disabled:opacity-50"
                    disabled={working}
                    onClick={() => void activate(profile.id)}
                  >
                    启用此规则
                  </button>
                )}
            </div>
            <p className="mt-1 text-xs text-muted">
              发布：{profile.publishedAt.slice(0, 10)} · 完整性：
              {profile.integrityStatus === "verified"
                ? "已验证"
                : profile.integrityStatus === "invalid"
                  ? "无效"
                  : "未验证"}{" "}
              · 范围：{profile.regions.join("、") || "未限定"}
            </p>
          </div>
        ))}
      </section>
      <section className="grid gap-3 rounded-xl border border-line bg-page p-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          交付剧名
          <input
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          字幕语言
          <input
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={subtitleLanguage}
            onChange={(event) => setSubtitleLanguage(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          目标平台（可选）
          <input
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={targetPlatform}
            onChange={(event) => setTargetPlatform(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          目标地区（可选）
          <input
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={targetRegion}
            onChange={(event) => setTargetRegion(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          交付日期
          <input
            className="rounded-lg border border-line bg-surface px-3 py-2"
            type="date"
            value={deliveryDate}
            onChange={(event) => setDeliveryDate(event.target.value)}
          />
        </label>
        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={aigcDeclared}
              onChange={(event) => setAigcDeclared(event.target.checked)}
            />
            <span>
              我确认本交付包含 AI
              生成或合成内容，并同意按规则写入显式和隐式标识。
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={manualReview}
              onChange={(event) => setManualReview(event.target.checked)}
            />
            <span>
              我已完成人工核对：未成年人、历史/民俗、版权、许可证和备案。
            </span>
          </label>
        </div>
        <div className="md:col-span-2">
          <button
            className="rounded-lg bg-brand px-3 py-2 text-sm text-white disabled:opacity-50"
            disabled={working}
            onClick={() => void preflight()}
          >
            {working ? "正在预检…" : "运行合规预检"}
          </button>
        </div>
      </section>
      {result && (
        <section
          className={`rounded-xl border p-3 text-sm ${result.ok ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"}`}
        >
          <p className="font-medium">
            {result.ok ? "合规预检通过" : "合规预检未通过"}
            {result.visibleLabel
              ? ` · 固定可见标识：${result.visibleLabel}`
              : ""}
          </p>
          {result.blockers.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-red-700">
              {result.blockers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {result.warnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-amber-800">
              {result.warnings.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted">
            证据指纹：{result.sourceFingerprint}
          </p>
        </section>
      )}
      {notice && (
        <p className="rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
    </section>
  );
}

function ReviewEditorPanel(props: { episodeId: string }) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [packageId, setPackageId] = useState("");
  const [shotId, setShotId] = useState("");
  const [authorAlias, setAuthorAlias] = useState("");
  const [timecode, setTimecode] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [decision, setDecision] = useState<
    "approve" | "return" | "request_changes" | "note"
  >("note");
  const [decisionNote, setDecisionNote] = useState("");
  const [notice, setNotice] = useState<string>();
  const [working, setWorking] = useState<string>();
  const { data: timeline, error: timelineError } = useQuery({
    queryKey: ["review-editor", "timeline", props.episodeId],
    queryFn: () => client.reviewEditor.timeline(props.episodeId),
  });
  const { data: preflight } = useQuery({
    queryKey: ["review-editor", "preflight", props.episodeId],
    queryFn: () => client.reviewEditor.preflight(props.episodeId),
  });
  const { data: packages = [] } = useQuery({
    queryKey: ["review-editor", "packages", props.episodeId],
    queryFn: () => client.reviewEditor.listPackages(props.episodeId),
  });
  useEffect(() => {
    if (!packages.some((item) => item.id === packageId))
      setPackageId(packages[0]?.id ?? "");
  }, [packageId, packages]);
  const { data: comments = [] } = useQuery({
    queryKey: ["review-editor", "comments", packageId],
    queryFn: () => client.reviewEditor.listComments(packageId),
    enabled: Boolean(packageId),
  });
  const { data: decisions = [] } = useQuery({
    queryKey: ["review-editor", "decisions", packageId],
    queryFn: () => client.reviewEditor.listDecisions(packageId),
    enabled: Boolean(packageId),
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["review-editor", "packages", props.episodeId],
    });
    await queryClient.invalidateQueries({
      queryKey: ["review-editor", "comments", packageId],
    });
    await queryClient.invalidateQueries({
      queryKey: ["review-editor", "decisions", packageId],
    });
  };
  const saveDocument = async (fileName: string, content: string) =>
    window.desktop.saveTextFile({ suggestedName: fileName, content });
  const exportTimeline = async (format: "json" | "edl" | "fcpxml" | "srt") => {
    setWorking(`时间线-${format}`);
    setNotice(undefined);
    try {
      const document = await client.reviewEditor.exportTimeline(
        props.episodeId,
        format,
      );
      const result = await saveDocument(document.fileName, document.content);
      setNotice(result.saved ? "剪辑交换资料已导出。" : "已取消导出。");
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const createPackage = async () => {
    setWorking("创建审片包");
    setNotice(undefined);
    try {
      const created = await client.reviewEditor.createPackage(props.episodeId);
      setPackageId(created.id);
      setNotice("已创建离线审片包记录；可以导出单文件审阅页分发给审片人。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const exportPackage = async () => {
    if (!packageId) return;
    setWorking("导出审片包");
    setNotice(undefined);
    try {
      const document = await client.reviewEditor.exportPackage(packageId);
      const result = await saveDocument(document.fileName, document.content);
      setNotice(
        result.saved
          ? "离线审片页已导出。审片人可在浏览器中填写意见并导出 JSON。"
          : "已取消导出。",
      );
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const importOffline = async () => {
    if (!packageId) return;
    setWorking("导入审片意见");
    setNotice(undefined);
    try {
      const files = await window.desktop.pickFiles({
        multiple: false,
        extensions: ["json"],
      });
      const file = files?.[0];
      if (!file) return;
      const result = await client.reviewEditor.importOffline(packageId, {
        capabilityToken: file.token,
      });
      setNotice(
        `已导入 ${result.commentCount} 条审阅意见和 ${result.decisionCount} 条决定。`,
      );
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const createComment = async () => {
    if (!packageId || !commentBody.trim()) {
      setNotice("请先选择审片包并填写意见。");
      return;
    }
    const parsedTimecode = Number(timecode);
    setWorking("保存意见");
    setNotice(undefined);
    try {
      await client.reviewEditor.createComment(packageId, {
        ...(shotId ? { shotId } : {}),
        ...(Number.isFinite(parsedTimecode) && parsedTimecode >= 0
          ? { timecodeSeconds: parsedTimecode }
          : {}),
        ...(authorAlias.trim() ? { authorAlias: authorAlias.trim() } : {}),
        body: commentBody.trim(),
      });
      setCommentBody("");
      setNotice("审阅意见已保存到本地审片包记录。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const createDecision = async () => {
    if (!packageId) {
      setNotice("请先选择审片包。");
      return;
    }
    setWorking("保存决定");
    setNotice(undefined);
    try {
      await client.reviewEditor.createDecision(packageId, {
        ...(shotId ? { shotId } : {}),
        decision,
        ...(authorAlias.trim() ? { authorAlias: authorAlias.trim() } : {}),
        ...(decisionNote.trim() ? { note: decisionNote.trim() } : {}),
      });
      setDecisionNote("");
      setNotice("审片决定已保存，可作为后续返工和交付复核依据。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const resolveComment = async (id: string, resolved: boolean) => {
    setWorking(`处理意见-${id}`);
    try {
      await client.reviewEditor.resolveComment(id, resolved);
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const decisionLabel = (value: string) =>
    value === "approve"
      ? "通过"
      : value === "return"
        ? "退回"
        : value === "request_changes"
          ? "需要修改"
          : "仅备注";
  return (
    <section className="space-y-4 rounded-2xl border border-line bg-surface p-4">
      <div>
        <p className="text-sm text-muted">审片与剪辑交接</p>
        <h2 className="mt-1 text-lg font-semibold">
          离线审片包与可重链接剪辑时间线
        </h2>
        <p className="mt-1 text-sm text-muted">
          时间线不暴露绝对路径、不复制媒体，也不伪装为成片。导入剪辑软件后请人工重链接已核验媒体。
        </p>
      </div>
      {timelineError && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {message(timelineError)}
        </p>
      )}
      {timeline && (
        <section className="rounded-xl border border-line bg-page p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-medium">{timeline.title}</h3>
              <p className="mt-1 text-sm text-muted">
                {timeline.clips.length} 个分镜 · {timeline.width}×
                {timeline.height} · {timeline.frameRate} 帧
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["json", "导出时间线数据"],
                  ["edl", "导出剪辑清单"],
                  ["fcpxml", "导出剪辑工程"],
                  ["srt", "导出字幕"],
                ] as const
              ).map(([format, label]) => (
                <button
                  key={format}
                  className="rounded border border-line px-2 py-1 text-xs text-brand disabled:opacity-50"
                  disabled={Boolean(working)}
                  onClick={() => void exportTimeline(format)}
                >
                  {working === `时间线-${format}` ? "正在导出…" : label}
                </button>
              ))}
            </div>
          </div>
          {preflight && (
            <div className="mt-3 rounded-lg border border-line bg-surface p-2 text-sm">
              <p>
                {preflight.canExport ? "时间线可导出" : "时间线存在阻断项"} ·
                已引用 {preflight.referencedClipCount} 个 · 待重链接{" "}
                {preflight.relinkRequiredCount} 个
              </p>
              {preflight.blockers.length > 0 && (
                <p className="mt-1 text-red-700">
                  {preflight.blockers.join("；")}
                </p>
              )}
              {preflight.warnings.map((item) => (
                <p key={item} className="mt-1 text-xs text-muted">
                  {item}
                </p>
              ))}
            </div>
          )}
          <div className="mt-3 space-y-1">
            {timeline.clips.map((clip) => (
              <div
                key={clip.id}
                className="rounded-lg border border-line bg-surface p-2 text-sm"
              >
                <span className="font-medium">
                  {clip.orderIndex + 1}. {clip.name}
                </span>
                <span className="ml-2 text-muted">
                  {clip.startSeconds.toFixed(1)}–
                  {(clip.startSeconds + clip.durationSeconds).toFixed(1)} 秒 ·{" "}
                  {clip.mediaStatus === "referenced"
                    ? "已引用媒体"
                    : "待人工重链接"}
                </span>
                {clip.subtitle && (
                  <p className="mt-1 text-xs text-muted">
                    字幕：{clip.subtitle}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="rounded-xl border border-line p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-medium">离线审片包</h3>
            <p className="mt-1 text-sm text-muted">
              导出的是中文单文件审阅页；意见 JSON 需要显式导回当前审片包。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-lg bg-brand px-3 py-2 text-sm text-white disabled:opacity-50"
              disabled={Boolean(working)}
              onClick={() => void createPackage()}
            >
              {working === "创建审片包" ? "正在创建…" : "创建离线审片包"}
            </button>
            <button
              className="rounded-lg border border-brand px-3 py-2 text-sm text-brand disabled:opacity-50"
              disabled={Boolean(working) || !packageId}
              onClick={() => void exportPackage()}
            >
              {working === "导出审片包" ? "正在导出…" : "导出离线审片页"}
            </button>
            <button
              className="rounded-lg border border-line px-3 py-2 text-sm text-brand disabled:opacity-50"
              disabled={Boolean(working) || !packageId}
              onClick={() => void importOffline()}
            >
              {working === "导入审片意见" ? "正在导入…" : "导入离线审片意见"}
            </button>
          </div>
        </div>
        <label className="mt-3 grid gap-1 text-sm">
          当前审片包
          <select
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={packageId}
            onChange={(event) => setPackageId(event.target.value)}
          >
            <option value="">选择审片包</option>
            {packages.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} · {item.createdAt}
              </option>
            ))}
          </select>
        </label>
      </section>
      {packageId && (
        <section className="grid gap-4 xl:grid-cols-2">
          <section className="rounded-xl border border-line p-3">
            <h3 className="font-medium">记录审阅意见</h3>
            <div className="mt-3 grid gap-2">
              <label className="grid gap-1 text-sm">
                关联分镜
                <select
                  className="rounded-lg border border-line px-3 py-2"
                  value={shotId}
                  onChange={(event) => setShotId(event.target.value)}
                >
                  <option value="">项目级意见</option>
                  {timeline?.clips.map((clip) => (
                    <option key={clip.shotId} value={clip.shotId}>
                      {clip.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                时间码（秒）
                <input
                  className="rounded-lg border border-line px-3 py-2"
                  type="number"
                  min="0"
                  step="0.1"
                  value={timecode}
                  onChange={(event) => setTimecode(event.target.value)}
                />
              </label>
              <label className="grid gap-1 text-sm">
                署名（可选）
                <input
                  className="rounded-lg border border-line px-3 py-2"
                  value={authorAlias}
                  onChange={(event) => setAuthorAlias(event.target.value)}
                />
              </label>
              <label className="grid gap-1 text-sm">
                审阅意见
                <textarea
                  className="min-h-24 rounded-lg border border-line px-3 py-2"
                  value={commentBody}
                  onChange={(event) => setCommentBody(event.target.value)}
                  placeholder="描述问题、建议或确认事项"
                />
              </label>
              <button
                className="w-fit rounded-lg bg-brand px-3 py-2 text-sm text-white disabled:opacity-50"
                disabled={Boolean(working)}
                onClick={() => void createComment()}
              >
                {working === "保存意见" ? "正在保存…" : "保存审阅意见"}
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {!comments.length && (
                <p className="text-sm text-muted">尚无审阅意见。</p>
              )}
              {comments.map((comment) => (
                <div
                  key={comment.id}
                  className="rounded-lg border border-line p-2 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {comment.resolved ? "已解决" : "待处理"} ·{" "}
                      {comment.authorAlias ?? "未署名"}
                    </span>
                    <button
                      className="rounded border border-line px-2 py-1 text-xs text-brand disabled:opacity-50"
                      disabled={Boolean(working)}
                      onClick={() =>
                        void resolveComment(comment.id, !comment.resolved)
                      }
                    >
                      {comment.resolved ? "标为待处理" : "标为已解决"}
                    </button>
                  </div>
                  <p className="mt-1">{comment.body}</p>
                  {comment.timecodeSeconds !== undefined && (
                    <p className="mt-1 text-xs text-muted">
                      时间码：{comment.timecodeSeconds} 秒
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-xl border border-line p-3">
            <h3 className="font-medium">记录审片决定</h3>
            <div className="mt-3 grid gap-2">
              <label className="grid gap-1 text-sm">
                决定
                <select
                  className="rounded-lg border border-line px-3 py-2"
                  value={decision}
                  onChange={(event) =>
                    setDecision(event.target.value as typeof decision)
                  }
                >
                  <option value="note">仅备注</option>
                  <option value="approve">通过</option>
                  <option value="return">退回</option>
                  <option value="request_changes">需要修改</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                决定说明（可选）
                <textarea
                  className="min-h-24 rounded-lg border border-line px-3 py-2"
                  value={decisionNote}
                  onChange={(event) => setDecisionNote(event.target.value)}
                />
              </label>
              <button
                className="w-fit rounded-lg bg-brand px-3 py-2 text-sm text-white disabled:opacity-50"
                disabled={Boolean(working)}
                onClick={() => void createDecision()}
              >
                {working === "保存决定" ? "正在保存…" : "保存审片决定"}
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {!decisions.length && (
                <p className="text-sm text-muted">尚无审片决定。</p>
              )}
              {decisions.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-line p-2 text-sm"
                >
                  <p>
                    {decisionLabel(item.decision)}
                    {item.authorAlias ? ` · ${item.authorAlias}` : ""}
                  </p>
                  {item.note && <p className="mt-1 text-muted">{item.note}</p>}
                </div>
              ))}
            </div>
          </section>
        </section>
      )}
      {notice && (
        <p className="rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
    </section>
  );
}

function EpisodeWorkflowPanel(props: { projectId: string; episodeId: string }) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string>();
  const workflow = useMutation({
    mutationFn: (kind: EpisodeWorkflowKind) =>
      client.workflows.runEpisode(
        { projectId: props.projectId, episodeId: props.episodeId, kind },
        crypto.randomUUID(),
      ),
    onSuccess: async (result) => {
      setNotice(result.summary);
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["resource"] });
    },
    onError: (cause) => setNotice(message(cause)),
  });
  const actions: Array<{
    kind: EpisodeWorkflowKind;
    label: string;
    description: string;
  }> = [
    {
      kind: "quality-check",
      label: "执行质量检查",
      description: "检查剧本、场景、分镜和素材是否具备继续制作的基础。",
    },
    {
      kind: "compliance-check",
      label: "执行合规预检",
      description: "结合基础风险词与素材归档状态，标出需人工核验的内容。",
    },
    {
      kind: "review-package",
      label: "生成审片包",
      description: "汇总当前剧本、场景、分镜和待审项目，形成审阅清单。",
    },
    {
      kind: "minimal-redo-plan",
      label: "生成最小返工计划",
      description: "按依赖关系整理优先处理步骤，不会直接改写任何内容。",
    },
    {
      kind: "delivery-preflight",
      label: "执行交付预检",
      description: "核查质量、合规、审片和本地化记录是否具备交付条件。",
    },
    {
      kind: "animatic-draft",
      label: "生成动态分镜草案",
      description: "根据分镜创建可审阅的节奏时间线，不伪造实际视频成片。",
    },
    {
      kind: "render-preflight",
      label: "执行渲染预检",
      description: "确认剧本、场景、分镜和素材是否具备提交真实渲染任务的条件。",
    },
  ];
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div>
        <h2 className="font-semibold">分集审核与制作工具</h2>
        <p className="mt-1 text-sm text-muted">
          每次执行都会创建可追踪任务和持久化报告；不会修改剧本、分镜或正式交付内容。
        </p>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {actions.map((action) => (
          <button
            key={action.kind}
            className="rounded-xl border border-line p-3 text-left transition hover:border-brand disabled:opacity-50"
            disabled={workflow.isPending}
            onClick={() => workflow.mutate(action.kind)}
          >
            <span className="block text-sm font-medium text-brand">
              {action.label}
            </span>
            <span className="mt-1 block text-xs leading-5 text-muted">
              {action.description}
            </span>
          </button>
        ))}
      </div>
      {workflow.isPending && (
        <p className="mt-3 text-sm text-muted">正在执行检查并保存报告…</p>
      )}
      {notice && (
        <p className="mt-3 rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
    </section>
  );
}

function FeedbackPage() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const [projectId, setProjectId] = useState("");
  const [preview, setPreview] = useState<FeedbackPreview>();
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string>();
  const { data: dashboard, error } = useQuery({
    queryKey: ["feedback", projectId],
    queryFn: () => client.feedback.dashboard(projectId),
    enabled: Boolean(projectId),
  });
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);
  const choose = async (kind: FeedbackKind) => {
    if (!projectId) return;
    setWorking(true);
    setNotice(undefined);
    try {
      const selected = await window.desktop.pickFiles({
        multiple: false,
        extensions: ["csv", "json"],
      });
      const file = selected?.[0];
      if (!file) return;
      const result = await client.feedback.preview({
        projectId,
        kind,
        capabilityToken: file.token,
      });
      setPreview(result);
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const commit = async () => {
    if (!preview) return;
    setWorking(true);
    setNotice(undefined);
    try {
      const batch = await client.feedback.commit(preview.importId, {
        projectId: preview.projectId,
      });
      setPreview(undefined);
      setNotice(
        `已导入 ${batch.rowCount} 条${batch.kind === "metrics" ? "运营指标" : "用户评论"}。`,
      );
      await queryClient.invalidateQueries({
        queryKey: ["feedback", preview.projectId],
      });
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const cluster = async (batchId: string) => {
    if (!projectId) return;
    setWorking(true);
    setNotice(undefined);
    try {
      const clusters = await client.feedback.cluster({ projectId, batchId });
      setNotice(`已按内容主题整理为 ${clusters.length} 个评论簇。`);
      await queryClient.invalidateQueries({
        queryKey: ["feedback", projectId],
      });
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const createRevisionTask = async (clusterId: string) => {
    setWorking(true);
    setNotice(undefined);
    try {
      const task = await client.feedback.createRevisionTask(
        clusterId,
        crypto.randomUUID(),
      );
      setNotice(`已创建修订任务「${task.title}」，可在任务中心查看。`);
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const batches = dashboard?.batches ?? [];
  return (
    <section className="space-y-5">
      <div>
        <p className="text-sm text-muted">反馈闭环</p>
        <h1 className="mt-1 text-2xl font-semibold">运营数据与用户反馈</h1>
        <p className="mt-2 text-sm text-muted">
          先预览再导入 CSV 或
          JSON。指标与评论只保存在本地项目数据库，可用于后续人工修订决策。
        </p>
      </div>
      <section className="rounded-2xl border border-line bg-surface p-4">
        <label className="grid max-w-md gap-1 text-sm">
          所属项目
          <select
            className="rounded-lg border border-line px-3 py-2"
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setPreview(undefined);
              setNotice(undefined);
            }}
          >
            <option value="">选择项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!projectId || working}
            onClick={() => void choose("metrics")}
          >
            导入运营指标
          </button>
          <button
            className="rounded-lg border border-line px-3 py-2 text-sm text-brand disabled:opacity-50"
            disabled={!projectId || working}
            onClick={() => void choose("comments")}
          >
            导入用户评论
          </button>
        </div>
      </section>
      {preview && (
        <section className="rounded-2xl border border-brand bg-brand-soft/30 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">导入预览：{preview.sourceName}</h2>
              <p className="mt-1 text-sm text-muted">
                已识别 {preview.validCount} 条
                {preview.kind === "metrics" ? "运营指标" : "用户评论"}
                ；确认后才会写入。
              </p>
            </div>
            <button
              className="text-sm text-muted hover:text-brand"
              disabled={working}
              onClick={() => setPreview(undefined)}
            >
              取消预览
            </button>
          </div>
          {preview.warnings.map((warning) => (
            <p
              key={warning}
              className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800"
            >
              {importWarning(warning)}
            </p>
          ))}
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {preview.sample.map((item, index) => (
              <p
                key={index}
                className="rounded-lg border border-line bg-white p-3 text-xs leading-5 text-muted"
              >
                {feedbackSampleText(item, preview.kind)}
              </p>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <button
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={working}
              onClick={() => void commit()}
            >
              {working ? "正在导入…" : "确认导入"}
            </button>
          </div>
        </section>
      )}
      {working && (
        <p className="text-sm text-muted">正在读取、校验或整理本地反馈数据…</p>
      )}
      {(notice || error) && (
        <p className="rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice ?? message(error)}
        </p>
      )}
      {projectId && (
        <section className="grid gap-4 xl:grid-cols-2">
          <article className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="font-semibold">导入批次</h2>
            <div className="mt-3 space-y-2">
              {batches.map((batch) => (
                <div
                  key={batch.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{batch.sourceName}</p>
                    <p className="mt-1 text-xs text-muted">
                      {batch.kind === "metrics" ? "运营指标" : "用户评论"} ·{" "}
                      {batch.rowCount} 条
                    </p>
                  </div>
                  {batch.kind === "comments" && (
                    <button
                      className="rounded-md border border-line px-2 py-1 text-xs text-brand disabled:opacity-50"
                      disabled={working}
                      onClick={() => void cluster(batch.id)}
                    >
                      整理评论主题
                    </button>
                  )}
                </div>
              ))}
              {!batches.length && (
                <p className="text-sm text-muted">
                  尚未导入任何运营数据或用户评论。
                </p>
              )}
            </div>
          </article>
          <article className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="font-semibold">数据摘要</h2>
            <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-canvas p-3">
                <dt className="text-xs text-muted">指标</dt>
                <dd className="mt-1 text-xl font-semibold">
                  {dashboard?.metrics.length ?? 0}
                </dd>
              </div>
              <div className="rounded-lg bg-canvas p-3">
                <dt className="text-xs text-muted">评论</dt>
                <dd className="mt-1 text-xl font-semibold">
                  {dashboard?.comments.length ?? 0}
                </dd>
              </div>
              <div className="rounded-lg bg-canvas p-3">
                <dt className="text-xs text-muted">主题簇</dt>
                <dd className="mt-1 text-xl font-semibold">
                  {dashboard?.clusters.length ?? 0}
                </dd>
              </div>
            </dl>
            <div className="mt-4 space-y-2">
              {(dashboard?.clusters ?? []).map((cluster) => (
                <article
                  key={cluster.id}
                  className="rounded-lg border border-line p-3 text-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-medium">
                      {cluster.title}（{cluster.commentCount} 条）
                    </p>
                    <button
                      className="rounded-md border border-line px-2 py-1 text-xs text-brand disabled:opacity-50"
                      disabled={working}
                      onClick={() => void createRevisionTask(cluster.id)}
                    >
                      创建修订任务
                    </button>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    {cluster.summary}
                  </p>
                </article>
              ))}
              {dashboard?.comments.slice(0, 3).map((comment) => (
                <p
                  key={comment.id}
                  className="rounded-lg bg-canvas p-3 text-sm text-muted"
                >
                  <span className="mr-2 text-xs text-brand">
                    {comment.category}
                  </span>
                  {comment.content}
                </p>
              ))}
            </div>
          </article>
        </section>
      )}
    </section>
  );
}

function feedbackSampleText(value: unknown, kind: FeedbackKind): string {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return "已识别一条数据。";
  const item = value as Record<string, unknown>;
  if (kind === "metrics")
    return `指标：${String(item.name ?? "未命名")}；数值：${String(item.value ?? "未提供")}`;
  return `评论：${String(item.content ?? "未提供").slice(0, 100)}`;
}

function BackupPanel() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const { data: backups = [], error } = useQuery({
    queryKey: ["backups"],
    queryFn: client.backups.list,
  });
  const create = useMutation({
    mutationFn: client.backups.create,
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["backups"] }),
  });
  const restore = useMutation({
    mutationFn: client.backups.restore,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });
  const size = (bytes: number) =>
    bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} 千字节`
      : `${(bytes / (1024 * 1024)).toFixed(1)} 兆字节`;
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">本地备份</h2>
          <p className="mt-1 text-sm text-muted">
            备份由本地服务直接创建，恢复时会替换当前新版数据库并刷新界面数据。
          </p>
        </div>
        <button
          className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? "正在创建…" : "创建备份"}
        </button>
      </div>
      {(error || create.error || restore.error) && (
        <p className="mt-3 text-sm text-red-600">
          {message(error ?? create.error ?? restore.error)}
        </p>
      )}
      <div className="mt-4 space-y-2">
        {backups.map((item) => (
          <div
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3"
          >
            <div>
              <p className="font-medium">{item.name}</p>
              <p className="mt-1 text-xs text-muted">
                {new Intl.DateTimeFormat("zh-CN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(item.createdAt))}
                {" · "}
                {size(item.size)}
              </p>
            </div>
            <button
              className="rounded-md border border-line px-2 py-1 text-xs text-brand disabled:opacity-50"
              disabled={restore.isPending}
              onClick={() => {
                if (window.confirm("恢复备份会替换当前新版数据。确定继续吗？"))
                  restore.mutate(item.id);
              }}
            >
              {restore.isPending ? "恢复中…" : "恢复此备份"}
            </button>
          </div>
        ))}
        {!backups.length && (
          <p className="text-sm text-muted">
            暂无备份。建议在重大改动前创建备份。
          </p>
        )}
      </div>
    </section>
  );
}

function DiagnosticPanel() {
  const client = useStudio();
  const [credentialStorageAvailable, setCredentialStorageAvailable] =
    useState<boolean>();
  const [report, setReport] =
    useState<Awaited<ReturnType<typeof client.support.diagnostics>>>();
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    void window.desktop
      .getCredentialStorageStatus()
      .then((status) => setCredentialStorageAvailable(status.available))
      .catch(() => setCredentialStorageAvailable(false));
  }, []);
  const collect = async () => {
    setWorking(true);
    setNotice(undefined);
    try {
      setReport(await client.support.diagnostics());
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const exportReport = async () => {
    if (!report) return;
    setWorking(true);
    try {
      const result = await window.desktop.saveTextFile({
        suggestedName: "DramaIP-诊断信息.json",
        content: JSON.stringify(report, null, 2),
      });
      setNotice(result.saved ? "诊断信息已导出。" : "已取消导出。");
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">诊断与安全</h2>
          <p className="mt-1 text-sm text-muted">
            诊断信息只包含本地服务和数据库计数，不包含正文、密钥或文件绝对路径。
          </p>
        </div>
        <div className="flex gap-2">
          {report && (
            <button
              className="rounded-lg border border-line px-3 py-2 text-sm text-brand disabled:opacity-50"
              disabled={working}
              onClick={() => void exportReport()}
            >
              导出诊断信息
            </button>
          )}
          <button
            className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={working}
            onClick={() => void collect()}
          >
            {working ? "正在收集…" : "收集诊断信息"}
          </button>
        </div>
      </div>
      <p className="mt-3 text-sm">
        本地凭据库：
        {credentialStorageAvailable === undefined
          ? "正在检查…"
          : credentialStorageAvailable
            ? "可用，数据保存在应用数据目录，不访问系统钥匙串。"
            : "不可用，请检查应用数据目录的写入权限。"}
      </p>
      {report && (
        <dl className="mt-3 grid gap-2 rounded-lg bg-canvas p-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted">项目</dt>
            <dd>{report.database.projectCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">章节</dt>
            <dd>{report.database.chapterCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">任务</dt>
            <dd>{report.database.taskCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">智能引擎</dt>
            <dd>{report.engineAvailable ? "可用" : "暂不可用"}</dd>
          </div>
        </dl>
      )}
      {notice && <p className="mt-3 text-sm text-muted">{notice}</p>}
    </section>
  );
}

function GenerationLedgerPanel() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const [projectId, setProjectId] = useState("");
  const [notice, setNotice] = useState<string>();
  const { data: records = [], error } = useQuery({
    queryKey: ["generation-ledger", projectId],
    queryFn: () => client.generation.list(projectId),
    enabled: Boolean(projectId),
  });
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);
  const updateCost = async (
    id: string,
    current?: number,
    currency = "CNY",
    note = "",
  ) => {
    const entered = window.prompt(
      "请输入本次实际成本；留空表示暂不记录：",
      current?.toString() ?? "",
    );
    if (entered === null) return;
    const amount = entered.trim() ? Number(entered) : undefined;
    if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
      setNotice("成本必须是大于或等于零的数字。");
      return;
    }
    const costNote = window.prompt("成本备注（可选）：", note);
    if (costNote === null) return;
    try {
      await client.generation.update(id, {
        ...(amount === undefined ? {} : { actualCost: amount }),
        currency,
        costNote,
      });
      setNotice("已更新成本记录。");
      await queryClient.invalidateQueries({
        queryKey: ["generation-ledger", projectId],
      });
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">生成账本</h2>
          <p className="mt-1 text-sm text-muted">
            记录智能任务与制作检查的运行摘要，并可补录实际成本。
          </p>
        </div>
        <label className="grid gap-1 text-sm">
          项目
          <select
            className="rounded-lg border border-line px-3 py-2"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">选择项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{message(error)}</p>}
      {notice && <p className="mt-3 text-sm text-brand">{notice}</p>}
      <div className="mt-4 space-y-2">
        {records.map((record) => (
          <article
            key={record.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line p-3 text-sm"
          >
            <div className="min-w-0">
              <p className="font-medium">{record.title}</p>
              <p className="mt-1 line-clamp-2 text-xs text-muted">
                {record.summary}
              </p>
              <p className="mt-1 text-xs text-muted">
                成本：
                {record.actualCost === undefined
                  ? "尚未记录"
                  : `${record.currency} ${record.actualCost.toFixed(2)}`}
              </p>
            </div>
            <button
              className="rounded-md border border-line px-2 py-1 text-xs text-brand"
              onClick={() =>
                void updateCost(
                  record.id,
                  record.actualCost,
                  record.currency,
                  record.costNote,
                )
              }
            >
              补录成本
            </button>
          </article>
        ))}
        {projectId && !records.length && (
          <p className="text-sm text-muted">
            当前项目还没有可归档的生成或检查记录。
          </p>
        )}
      </div>
    </section>
  );
}

type ProviderChoice = ModelProviderPresetId | "other";

function providerDiscoveredModels(payload: Record<string, unknown>): string[] {
  const value = payload["可用模型"];
  return typeof value === "string"
    ? value
        .split("、")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function ProviderSettingsPanel() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const { data: providers = [] } = useQuery({
    queryKey: ["resource", "providers"],
    queryFn: () => client.resources.list("providers"),
  });
  const { data: credentialStorage } = useQuery({
    queryKey: ["credential-storage-status"],
    queryFn: window.desktop.getCredentialStorageStatus,
  });
  const [choice, setChoice] = useState<ProviderChoice>("openai");
  const [modelId, setModelId] = useState(
    recommendedProviderModel(MODEL_PROVIDER_CATALOG[0]),
  );
  const [apiKey, setApiKey] = useState("");
  const [customName, setCustomName] = useState("");
  const [customServiceType, setCustomServiceType] = useState("智能模型");
  const [customModel, setCustomModel] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customProtocol, setCustomProtocol] = useState("OpenAI 兼容文本");
  const [editing, setEditing] = useState<DomainEntity>();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const preset = choice === "other" ? undefined : modelProviderPreset(choice);
  const editingPayload = recordPayload(editing?.payload);
  const selectableModels = preset
    ? [
        ...preset.models,
        ...providerDiscoveredModels(editingPayload)
          .filter((id) => !preset.models.some((model) => model.id === id))
          .map((id) => ({ id, label: `${id}（账户可用）` })),
        ...(modelId && !preset.models.some((model) => model.id === modelId)
          ? [{ id: modelId, label: `${modelId}（已保存）` }]
          : []),
      ]
    : [];

  const selectPreset = (next: ProviderChoice) => {
    setChoice(next);
    setEditing(undefined);
    setApiKey("");
    setError(undefined);
    setNotice(undefined);
    if (next === "other") {
      setCustomName("");
      setCustomServiceType("智能模型");
      setCustomModel("");
      setCustomBaseUrl("");
      setCustomProtocol("OpenAI 兼容文本");
      setModelId("");
      return;
    }
    const nextPreset = modelProviderPreset(next);
    if (nextPreset) setModelId(recommendedProviderModel(nextPreset));
  };

  const editProvider = (provider: DomainEntity) => {
    const payload = recordPayload(provider.payload);
    const presetId = String(payload["预设服务商"] ?? "");
    const known = modelProviderPreset(presetId);
    setEditing(provider);
    setChoice(known ? known.id : "other");
    setModelId(String(payload["模型名称"] ?? ""));
    setApiKey("");
    setCustomName(provider.title);
    setCustomServiceType(String(payload["服务类型"] ?? "智能模型"));
    setCustomModel(String(payload["模型名称"] ?? ""));
    setCustomBaseUrl(String(payload["服务地址"] ?? ""));
    setCustomProtocol(String(payload["调用协议"] ?? "OpenAI 兼容文本"));
    setError(undefined);
    setNotice(undefined);
  };

  const resetForm = () => selectPreset("openai");

  const saveProvider = async () => {
    const oldPayload = recordPayload(editing?.payload);
    const previousCredentialRef = String(oldPayload["凭据引用"] ?? "").trim();
    const selectedModel = preset ? modelId.trim() : customModel.trim();
    const title = preset?.name ?? customName.trim();
    const protocol = preset?.protocol ?? customProtocol.trim();
    const serviceType = preset ? "智能模型" : customServiceType.trim();
    const baseUrl = preset?.baseUrl ?? customBaseUrl.trim();
    const stableDiffusionWithoutKey =
      !preset && protocol.toLowerCase().includes("stable diffusion");
    if (!title || !serviceType || !selectedModel || !protocol) {
      setError("请完整填写服务商名称、服务类型、模型和调用协议。");
      return;
    }
    if (
      !apiKey.trim() &&
      !previousCredentialRef &&
      !stableDiffusionWithoutKey
    ) {
      setError("请输入接口密钥（API Key）。");
      return;
    }
    if (apiKey.trim() && credentialStorage?.available !== true) {
      setError("本地凭据库当前不可用，无法安全保存接口密钥。");
      return;
    }
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    let newCredentialRef: string | undefined;
    try {
      if (apiKey.trim()) {
        newCredentialRef = (await window.desktop.storeCredential(apiKey.trim()))
          .credentialRef;
      }
      const credentialRef = newCredentialRef ?? previousCredentialRef;
      const payload: Record<string, unknown> = {
        ...oldPayload,
        服务类型: serviceType,
        模型名称: selectedModel,
        服务地址: baseUrl,
        调用协议: protocol,
        ...(credentialRef ? { 凭据引用: credentialRef } : {}),
        ...(preset
          ? {
              预设服务商: preset.id,
              模型目录版本: MODEL_PROVIDER_CATALOG_RELEASE,
              模型目录核对日期: MODEL_PROVIDER_CATALOG_UPDATED_AT,
            }
          : { 预设服务商: "other" }),
      };
      if (editing) {
        await client.resources.update("providers", editing.id, {
          title,
          payload,
          version: editing.version,
        });
      } else {
        await client.resources.create("providers", { title, payload });
      }
      if (
        newCredentialRef &&
        previousCredentialRef &&
        previousCredentialRef !== newCredentialRef
      )
        await window.desktop.removeCredential(previousCredentialRef);
      setApiKey("");
      setEditing(undefined);
      setNotice(`已保存 ${title}，密钥不会写入业务数据库。`);
      await queryClient.invalidateQueries({
        queryKey: ["resource", "providers"],
      });
    } catch (cause) {
      if (newCredentialRef)
        await window.desktop.removeCredential(newCredentialRef).catch(() => {});
      setError(message(cause));
    } finally {
      setSaving(false);
    }
  };

  const removeProvider = async (provider: DomainEntity) => {
    if (!window.confirm(`删除模型服务商「${provider.title}」吗？`)) return;
    setError(undefined);
    const credentialRef = String(
      recordPayload(provider.payload)["凭据引用"] ?? "",
    ).trim();
    try {
      await client.resources.remove("providers", provider.id);
      if (credentialRef)
        await window.desktop.removeCredential(credentialRef).catch(() => {});
      if (editing?.id === provider.id) resetForm();
      await queryClient.invalidateQueries({
        queryKey: ["resource", "providers"],
      });
    } catch (cause) {
      setError(message(cause));
    }
  };

  const testProvider = async (provider: DomainEntity) => {
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await client.providers.testConnection(provider.id);
      await queryClient.invalidateQueries({
        queryKey: ["resource", "providers"],
      });
      if (editing?.id === provider.id) {
        const refreshed = await client.resources.get("providers", provider.id);
        editProvider(refreshed);
      }
      setNotice(`${provider.title}：${result.message}`);
    } catch (cause) {
      setError(message(cause));
    }
  };

  const activateProvider = async (provider: DomainEntity) => {
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await client.providers.activateForAgent(provider.id);
      setNotice(`${provider.title}：${result.message}`);
      await queryClient.invalidateQueries({ queryKey: ["agent-engines"] });
    } catch (cause) {
      setError(message(cause));
    }
  };

  return (
    <section className="rounded-2xl border border-brand bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">模型服务商</p>
          <p className="mt-1 text-sm text-muted">
            常用服务商已预填接口地址和协议，只需选择模型并填写接口密钥。
          </p>
        </div>
        <span className="rounded-full bg-brand-soft px-2 py-1 text-xs text-brand">
          模型目录核对于 {MODEL_PROVIDER_CATALOG_UPDATED_AT}
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <label className="grid gap-1 text-sm text-muted">
          服务商
          <select
            className="rounded-lg border border-line bg-white px-3 py-2 text-ink"
            value={choice}
            onChange={(event) =>
              selectPreset(event.target.value as ProviderChoice)
            }
          >
            {MODEL_PROVIDER_CATALOG.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
            <option value="other">其他（全部手动填写）</option>
          </select>
        </label>

        {preset ? (
          <label className="grid gap-1 text-sm text-muted">
            模型
            <select
              className="rounded-lg border border-line bg-white px-3 py-2 text-ink"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
            >
              {selectableModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                  {"recommended" in model && model.recommended
                    ? "（推荐）"
                    : ""}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="grid gap-1 text-sm text-muted">
            服务商名称
            <input
              className="rounded-lg border border-line bg-white px-3 py-2 text-ink"
              placeholder="输入服务商名称"
              value={customName}
              onChange={(event) => setCustomName(event.target.value)}
            />
          </label>
        )}

        <label className="grid gap-1 text-sm text-muted">
          接口密钥（API Key）
          <input
            className="rounded-lg border border-line bg-white px-3 py-2 text-ink"
            type="password"
            autoComplete="off"
            disabled={credentialStorage?.available !== true}
            placeholder={
              editing ? "留空表示继续使用已保存密钥" : "粘贴接口密钥"
            }
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
      </div>

      {!preset && (
        <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1 text-sm text-muted">
            服务类型
            <select
              className="rounded-lg border border-line bg-white px-3 py-2 text-ink"
              value={customServiceType}
              onChange={(event) => setCustomServiceType(event.target.value)}
            >
              <option value="智能模型">智能模型</option>
              <option value="图片生成">图片生成</option>
              <option value="语音生成">语音生成</option>
              <option value="视频生成">视频生成</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm text-muted">
            模型名称
            <input
              className="rounded-lg border border-line bg-white px-3 py-2 text-ink"
              placeholder="输入模型标识"
              value={customModel}
              onChange={(event) => setCustomModel(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm text-muted">
            服务地址
            <input
              className="rounded-lg border border-line bg-white px-3 py-2 text-ink"
              placeholder="输入完整接口基础地址"
              value={customBaseUrl}
              onChange={(event) => setCustomBaseUrl(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm text-muted">
            调用协议
            <select
              className="rounded-lg border border-line bg-white px-3 py-2 text-ink"
              value={customProtocol}
              onChange={(event) => setCustomProtocol(event.target.value)}
            >
              <option value="OpenAI 兼容文本">OpenAI 兼容文本</option>
              <option value="Anthropic">Anthropic</option>
              <option value="Google Gemini">Google Gemini</option>
              <option value="OpenAI 兼容图片">OpenAI 兼容图片</option>
              <option value="OpenAI 兼容语音">OpenAI 兼容语音</option>
              <option value="OpenAI 兼容视频">OpenAI 兼容视频</option>
              <option value="Stable Diffusion WebUI">
                Stable Diffusion WebUI
              </option>
            </select>
          </label>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3 text-xs text-muted">
          {preset && (
            <button
              className="text-brand hover:underline"
              onClick={() => void window.desktop.openExternal(preset.apiKeyUrl)}
            >
              打开接口密钥申请页面
            </button>
          )}
          <span>密钥仅进入本地加密凭据库，业务数据库只保存凭据引用。</span>
        </div>
        <div className="flex gap-2">
          {editing && (
            <button
              className="rounded-lg border border-line px-3 py-2 text-sm"
              onClick={resetForm}
            >
              取消编辑
            </button>
          )}
          <button
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={saving}
            onClick={() => void saveProvider()}
          >
            {saving ? "保存中…" : editing ? "保存服务商修改" : "添加模型服务商"}
          </button>
        </div>
      </div>

      {credentialStorage?.available === false && (
        <p className="mt-3 text-sm text-amber-700">
          本地凭据库不可用，当前不能新增或更换接口密钥，也不会降级保存明文。
        </p>
      )}
      {notice && <p className="mt-3 text-sm text-brand">{notice}</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {providers.map((provider) => {
          const payload = recordPayload(provider.payload);
          return (
            <article
              key={provider.id}
              className="rounded-xl border border-line p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{provider.title}</p>
                  <p className="mt-1 text-sm text-muted">
                    {String(payload["模型名称"] ?? "尚未选择模型")}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {String(payload["连接状态"] ?? "尚未测试连接")}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    className="rounded-md border border-line px-2 py-1 text-xs text-brand"
                    onClick={() => editProvider(provider)}
                  >
                    编辑配置
                  </button>
                  <button
                    className="rounded-md border border-line px-2 py-1 text-xs text-brand"
                    onClick={() => void testProvider(provider)}
                  >
                    测试连接
                  </button>
                  {payload["服务类型"] === "智能模型" && (
                    <button
                      className="rounded-md border border-brand px-2 py-1 text-xs text-brand"
                      onClick={() => void activateProvider(provider)}
                    >
                      设为智能助手模型
                    </button>
                  )}
                  <button
                    className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600"
                    onClick={() => void removeProvider(provider)}
                  >
                    删除服务商
                  </button>
                </div>
              </div>
            </article>
          );
        })}
        {!providers.length && (
          <p className="text-sm text-muted">
            尚未配置模型服务商，请从上方常用服务商开始添加。
          </p>
        )}
      </div>
    </section>
  );
}

function SettingsPage() {
  return (
    <div className="space-y-5">
      <ProviderSettingsPanel />
      <AgentEngineSettingsPanel />
      <BackupPanel />
      <DiagnosticPanel />
      <GenerationLedgerPanel />
      <DomainWorkspace
        title="设置与连接"
        domains={["settings", "backup", "cloud", "agents"]}
      />
    </div>
  );
}

const AGENT_ENGINE_LABELS: Record<AgentEngineKind, string> = {
  opencode: "OpenCode",
  codex: "Codex",
  langgraph: "LangGraph.js",
};

function AgentEngineSettingsPanel() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const { data: engines = [] } = useQuery({
    queryKey: ["agent-engines"],
    queryFn: client.agentEngines.list,
    refetchInterval: 5_000,
  });
  const { data: globalSettings } = useQuery({
    queryKey: ["global-agent-settings"],
    queryFn: client.agentEngines.getGlobalSettings,
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const { data: codexAuth } = useQuery({
    queryKey: ["codex-auth"],
    queryFn: client.agentEngines.codexAuthStatus,
    refetchInterval: 5_000,
  });
  const { data: credentialStorage } = useQuery({
    queryKey: ["credential-storage-status"],
    queryFn: window.desktop.getCredentialStorageStatus,
  });
  const [projectId, setProjectId] = useState("");
  const [globalDefaultEngine, setGlobalDefaultEngine] =
    useState<AgentEngineKind>("opencode");
  const [globalModelId, setGlobalModelId] = useState("");
  const [defaultEngine, setDefaultEngine] =
    useState<AgentEngineKind>("opencode");
  const [defaultModelId, setDefaultModelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [notice, setNotice] = useState<string>();
  const { data: projectSettings } = useQuery({
    queryKey: ["project-agent-settings", projectId],
    queryFn: () => client.agentEngines.getProjectSettings(projectId),
    enabled: Boolean(projectId),
  });
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);
  useEffect(() => {
    if (globalSettings) {
      setGlobalDefaultEngine(globalSettings.defaultEngineKind);
      setGlobalModelId(globalSettings.defaultModel?.modelId ?? "");
    }
  }, [globalSettings]);
  useEffect(() => {
    if (projectSettings) {
      setDefaultEngine(projectSettings.defaultEngineKind);
      setDefaultModelId(projectSettings.defaultModel?.modelId ?? "");
    }
  }, [projectSettings]);
  const updateGlobalDefault = useMutation({
    mutationFn: () =>
      client.agentEngines.updateGlobalSettings({
        defaultEngineKind: globalDefaultEngine,
        ...(globalModelId.trim()
          ? { defaultModel: { modelId: globalModelId.trim() } }
          : {}),
      }),
    onSuccess: async () => {
      setNotice("全局默认智能引擎已保存");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["global-agent-settings"] }),
        queryClient.invalidateQueries({ queryKey: ["agent-engines"] }),
      ]);
    },
    onError: (cause) => setNotice(message(cause)),
  });
  const updateDefault = useMutation({
    mutationFn: () =>
      client.agentEngines.updateProjectSettings(projectId, {
        defaultEngineKind: defaultEngine,
        ...(defaultModelId.trim()
          ? { defaultModel: { modelId: defaultModelId.trim() } }
          : {}),
      }),
    onSuccess: async () => {
      setNotice("项目默认智能引擎已保存");
      await queryClient.invalidateQueries({
        queryKey: ["project-agent-settings", projectId],
      });
    },
    onError: (cause) => setNotice(message(cause)),
  });
  const loginCodex = useMutation({
    mutationFn: async (
      mode: "api_key" | "chatgpt_browser" | "chatgpt_device_code",
    ) => {
      if (mode === "api_key") {
        if (!apiKey.trim()) throw new Error("请输入 Codex 接口密钥");
        const stored = await window.desktop.storeCredential(apiKey.trim());
        try {
          return await client.agentEngines.codexLogin({
            mode,
            credentialRef: stored.credentialRef,
          });
        } catch (cause) {
          await window.desktop.removeCredential(stored.credentialRef);
          throw cause;
        }
      }
      return client.agentEngines.codexLogin({ mode });
    },
    onSuccess: async (result) => {
      setApiKey("");
      if (result.verificationUrl)
        await window.desktop.openExternal(result.verificationUrl);
      setNotice(
        result.userCode
          ? `请在已打开的页面输入设备码：${result.userCode}`
          : (result.message ?? "Codex 登录流程已启动"),
      );
      await queryClient.invalidateQueries({ queryKey: ["codex-auth"] });
    },
    onError: (cause) => setNotice(message(cause)),
  });
  const logoutCodex = useMutation({
    mutationFn: client.agentEngines.codexLogout,
    onSuccess: async () => {
      setNotice("已退出 Codex");
      await queryClient.invalidateQueries({ queryKey: ["codex-auth"] });
    },
    onError: (cause) => setNotice(message(cause)),
  });
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">智能引擎</p>
          <p className="mt-1 text-xs leading-5 text-muted">
            每次任务只运行你明确选择的引擎。引擎失败时不会自动切换。
          </p>
        </div>
        <span className="rounded-full bg-brand-soft px-2 py-1 text-xs text-brand">
          {AGENT_ENGINE_LABELS[globalSettings?.defaultEngineKind ?? "opencode"]}{" "}
          全局默认
        </span>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {engines.map((engine) => (
          <article
            key={engine.kind}
            className="rounded-xl border border-line p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{engine.name}</p>
              {engine.isBeta && (
                <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                  测试版
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted">版本 {engine.version}</p>
            <p
              className={`mt-2 text-sm ${engine.status === "available" ? "text-emerald-700" : "text-amber-700"}`}
            >
              {engine.status === "available" ? "运行正常" : "当前不可用"}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted">
              {engine.statusMessage}
            </p>
          </article>
        ))}
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
        <label className="grid gap-1 text-sm text-muted">
          全局默认引擎
          <select
            className="rounded-lg border border-line bg-white px-3 py-2 text-ink"
            value={globalDefaultEngine}
            onChange={(event) =>
              setGlobalDefaultEngine(event.target.value as AgentEngineKind)
            }
          >
            {engines.map((engine) => (
              <option key={engine.kind} value={engine.kind}>
                {engine.name}
                {engine.isBeta ? "（测试版）" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm text-muted">
          全局默认模型（可选）
          <input
            className="rounded-lg border border-line bg-white px-3 py-2 text-ink"
            placeholder="例如：gpt-5.4"
            value={globalModelId}
            onChange={(event) => setGlobalModelId(event.target.value)}
          />
        </label>
        <button
          className="self-end rounded-lg border border-brand px-3 py-2 text-sm font-medium text-brand disabled:opacity-50"
          disabled={updateGlobalDefault.isPending}
          onClick={() => updateGlobalDefault.mutate()}
        >
          {updateGlobalDefault.isPending ? "保存中…" : "保存全局默认值"}
        </button>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_1fr_auto]">
        <label className="grid gap-1 text-sm text-muted">
          项目
          <select
            className="rounded-lg border border-line bg-white px-3 py-2 text-ink"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">选择项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm text-muted">
          项目默认模型（可选）
          <input
            className="rounded-lg border border-line bg-white px-3 py-2 text-ink"
            placeholder="留空时继承全局设置"
            value={defaultModelId}
            onChange={(event) => setDefaultModelId(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm text-muted">
          项目默认引擎
          <select
            className="rounded-lg border border-line bg-white px-3 py-2 text-ink"
            value={defaultEngine}
            onChange={(event) =>
              setDefaultEngine(event.target.value as AgentEngineKind)
            }
          >
            {engines.map((engine) => (
              <option key={engine.kind} value={engine.kind}>
                {engine.name}
                {engine.isBeta ? "（测试版）" : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          className="self-end rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={!projectId || updateDefault.isPending}
          onClick={() => updateDefault.mutate()}
        >
          {updateDefault.isPending ? "保存中…" : "保存默认引擎"}
        </button>
      </div>
      <div className="mt-5 rounded-xl border border-line p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Codex 认证</p>
            <p className="mt-1 text-xs text-muted">
              {codexAuth?.authenticated
                ? `已登录${codexAuth.accountLabel ? `：${codexAuth.accountLabel}` : ""}`
                : (codexAuth?.message ?? "尚未登录")}
            </p>
          </div>
          {codexAuth?.authenticated && (
            <button
              className="rounded-lg border border-line px-3 py-2 text-sm"
              disabled={logoutCodex.isPending}
              onClick={() => logoutCodex.mutate()}
            >
              退出 Codex
            </button>
          )}
        </div>
        {!codexAuth?.authenticated && (
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              className="min-w-56 flex-1 rounded-lg border border-line px-3 py-2 text-sm"
              type="password"
              autoComplete="off"
              placeholder="Codex 接口密钥"
              disabled={credentialStorage?.available !== true}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <button
              className="rounded-lg border border-brand px-3 py-2 text-sm text-brand disabled:opacity-50"
              disabled={
                credentialStorage?.available !== true ||
                !apiKey.trim() ||
                loginCodex.isPending
              }
              onClick={() => loginCodex.mutate("api_key")}
            >
              使用接口密钥登录
            </button>
            <button
              className="rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50"
              disabled={
                credentialStorage?.available !== true || loginCodex.isPending
              }
              onClick={() => loginCodex.mutate("chatgpt_browser")}
            >
              使用 ChatGPT 登录
            </button>
            <button
              className="rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50"
              disabled={
                credentialStorage?.available !== true || loginCodex.isPending
              }
              onClick={() => loginCodex.mutate("chatgpt_device_code")}
            >
              使用设备码登录
            </button>
          </div>
        )}
        {credentialStorage?.available === false && (
          <p className="mt-3 text-xs text-amber-700">
            本地凭据库不可用，Codex 登录已禁用；应用不会降级保存明文凭据。
          </p>
        )}
      </div>
      {notice && <p className="mt-3 text-sm text-brand">{notice}</p>}
    </section>
  );
}
function AgentSidePanel() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const location = useLocation();
  const { data: projects = [] } = useQuery({
    queryKey: ["agent-projects", location.pathname],
    queryFn: client.projects.list,
  });
  const [projectId, setProjectId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [engineKind, setEngineKind] = useState<AgentEngineKind>("opencode");
  const [taskType, setTaskType] = useState<AgentTaskType>("chapter_diagnostic");
  const [modelId, setModelId] = useState("");
  const [experimentMode, setExperimentMode] = useState<
    "recommended" | "same_model"
  >("recommended");
  const [assistantMode, setAssistantMode] = useState<"simple" | "advanced">(
    "simple",
  );
  const [prompt, setPrompt] = useState("");
  const [notice, setNotice] = useState<string>();
  const [activeRunId, setActiveRunId] = useState<string>();
  const [experimentId, setExperimentId] = useState<string>();
  const { data: engines = [] } = useQuery({
    queryKey: ["agent-engines"],
    queryFn: client.agentEngines.list,
    refetchInterval: 5_000,
  });
  const { data: taskDefinitions = [] } = useQuery({
    queryKey: ["agent-task-definitions"],
    queryFn: client.agentEngines.listTasks,
  });
  const { data: projectSettings } = useQuery({
    queryKey: ["project-agent-settings", projectId],
    queryFn: () => client.agentEngines.getProjectSettings(projectId),
    enabled: Boolean(projectId),
  });
  const { data: chapters = [] } = useQuery({
    queryKey: ["agent-chapters", projectId],
    queryFn: () => client.chapters.list(projectId),
    enabled: Boolean(projectId),
  });
  const { data: contextShots = [] } = useQuery({
    queryKey: ["agent-shots", projectId],
    queryFn: () => client.resources.list("shots", projectId),
    enabled: Boolean(projectId),
  });
  const requestedProjectId = contextAssistantProjectId(location);
  const requestedShotId = new URLSearchParams(location.search).get("shotId");
  useEffect(() => {
    if (requestedProjectId && projectId !== requestedProjectId) {
      setProjectId(requestedProjectId);
      return;
    }
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects, requestedProjectId]);
  useEffect(() => setChapterId(""), [projectId]);
  useEffect(() => {
    if (projectSettings) {
      setEngineKind(projectSettings.defaultEngineKind);
      setModelId(projectSettings.defaultModel?.modelId ?? "");
      setAssistantMode(projectSettings.assistantMode);
    }
  }, [projectSettings]);
  const selectedTask = taskDefinitions.find((item) => item.id === taskType);
  const requiresChapter =
    selectedTask?.category === "章节写作" ||
    selectedTask?.category === "记忆与连续性";
  const contextPage = contextAssistantPage(location.pathname);
  const selectedShot = contextShots.find((shot) => shot.id === requestedShotId);
  const selectedShotPayload = selectedShot ? recordPayload(selectedShot.payload) : {};
  const shotContext = selectedShot
    ? [
        `当前导演看板分镜：${selectedShot.title}`,
        selectedShotPayload["镜头描述"]
          ? `镜头画面：${String(selectedShotPayload["镜头描述"])}`
          : "",
        selectedShotPayload["生成提示"]
          ? `已有提示：${String(selectedShotPayload["生成提示"])}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const contextualPrompt = [shotContext, prompt.trim()]
    .filter(Boolean)
    .join("\n\n");
  const { actions: contextActions, missingTaskTypes } =
    resolveContextAssistantActions({
      page: contextPage,
      catalog: taskDefinitions,
    });
  const selectedEngine = engines.find((engine) => engine.kind === engineKind);
  const preflightFor = (action: (typeof contextActions)[number]) =>
    contextAssistantPreflight({
      action,
      projectId,
      chapterId,
      engine: selectedEngine,
      modelId,
    });
  const updateAssistantMode = useMutation({
    mutationFn: (nextMode: "simple" | "advanced") => {
      if (!projectId) throw new Error("请先选择项目以保存助手偏好");
      return client.agentEngines.updateProjectSettings(projectId, {
        defaultEngineKind: projectSettings?.defaultEngineKind ?? engineKind,
        ...(projectSettings?.defaultModel
          ? { defaultModel: projectSettings.defaultModel }
          : {}),
        assistantMode: nextMode,
      });
    },
    onSuccess: async (settings) => {
      setAssistantMode(settings.assistantMode);
      setNotice(
        settings.assistantMode === "advanced"
          ? "已恢复完整任务目录和高级参数。"
          : "已切换为当前页面的简洁助手。",
      );
      await queryClient.invalidateQueries({
        queryKey: ["project-agent-settings", projectId],
      });
    },
    onError: (cause) => {
      setAssistantMode(projectSettings?.assistantMode ?? "simple");
      setNotice(message(cause));
    },
  });
  const runAgent = useMutation({
    mutationFn: async (requested?: { taskType?: AgentTaskType }) => {
      if (!projectId) throw new Error("请先创建或选择一个项目");
      const requestedTaskType = requested?.taskType ?? taskType;
      const definition = taskDefinitions.find(
        (item) => item.id === requestedTaskType,
      );
      const taskRequiresChapter =
        definition?.category === "章节写作" ||
        definition?.category === "记忆与连续性";
      if (taskRequiresChapter && !chapterId)
        throw new Error("此智能任务需要先选择一个章节");
      const session = await client.agentSessions.create({
        projectId,
        ...(chapterId ? { chapterId } : {}),
        engineKind,
        taskType: requestedTaskType,
        title: definition?.label,
        ...(modelId.trim() ? { model: { modelId: modelId.trim() } } : {}),
      });
      return client.agentSessions.run(session.id, {
        taskType: requestedTaskType,
        ...(modelId.trim() ? { model: { modelId: modelId.trim() } } : {}),
        ...(contextualPrompt ? { prompt: contextualPrompt } : {}),
      });
    },
    onSuccess: (result, requested) => {
      const definition = taskDefinitions.find(
        (item) => item.id === (requested?.taskType ?? taskType),
      );
      setActiveRunId(result.runId);
      setNotice(
        `${definition?.label ?? "智能"}任务已创建：${result.taskId.slice(0, 8)}`,
      );
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (cause) => setNotice(message(cause)),
  });
  const { data: activeRun } = useQuery({
    queryKey: ["agent-run", activeRunId],
    queryFn: () => client.agentSessions.getRun(activeRunId!),
    enabled: Boolean(activeRunId),
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? 1_000 : false,
  });
  const { data: activeItems = [] } = useQuery({
    queryKey: ["agent-run-items", activeRunId],
    queryFn: () => client.agentSessions.listItems(activeRunId!),
    enabled: Boolean(activeRunId),
    refetchInterval: activeRun?.status === "running" ? 1_000 : false,
  });
  const interruptRun = useMutation({
    mutationFn: () => client.agentSessions.interrupt(activeRunId!),
    onSuccess: (run) => {
      setNotice("智能任务已中断");
      queryClient.setQueryData(["agent-run", run.id], run);
    },
    onError: (cause) => setNotice(message(cause)),
  });
  const resumeRun = useMutation({
    mutationFn: () => client.agentSessions.resume(activeRunId!),
    onSuccess: (run) => {
      setNotice("智能任务已恢复");
      queryClient.setQueryData(["agent-run", run.id], run);
    },
    onError: (cause) => setNotice(message(cause)),
  });
  const createExperiment = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("请先选择项目");
      if (requiresChapter && !chapterId)
        throw new Error("此盲测任务需要先选择章节");
      if (experimentMode === "same_model" && !modelId.trim())
        throw new Error("同模型盲测需要先填写本次模型");
      const selectedChapter = chapters.find((item) => item.id === chapterId);
      const estimatedInputPerEngine = Math.max(
        800,
        Math.ceil(
          ((selectedChapter?.content.length ?? 0) + contextualPrompt.length) /
            1.6,
        ) + 600,
      );
      const estimatedOutputPerEngine =
        selectedTask?.writePolicy === "readonly" ? 1_200 : 2_400;
      const confirmed = window.confirm(
        [
          "三引擎盲测会分别调用 OpenCode、Codex 和 LangGraph.js，共产生三次模型费用。",
          experimentMode === "same_model"
            ? `比较方式：三个引擎统一使用模型 ${modelId.trim()}。`
            : "比较方式：各引擎使用各自当前推荐配置。",
          `预估输入：每个引擎约 ${estimatedInputPerEngine.toLocaleString("zh-CN")} Token；三次合计约 ${(estimatedInputPerEngine * 3).toLocaleString("zh-CN")} Token。`,
          `预估输出上限：每个引擎约 ${estimatedOutputPerEngine.toLocaleString("zh-CN")} Token；三次合计约 ${(estimatedOutputPerEngine * 3).toLocaleString("zh-CN")} Token。`,
          "预估费用：各引擎的模型与认证计价可能不同，未配置统一单价时无法可靠折算金额；应用会在运行后记录实际 Token 与厂商返回的费用。",
          "确认开始吗？",
        ].join("\n\n"),
      );
      if (!confirmed) throw new Error("已取消三引擎盲测");
      return client.agentExperiments.create(
        {
          projectId,
          ...(chapterId ? { chapterId } : {}),
          taskType,
          comparisonMode: experimentMode,
          ...(experimentMode === "same_model"
            ? { model: { modelId: modelId.trim() } }
            : {}),
          ...(contextualPrompt ? { prompt: contextualPrompt } : {}),
          confirmedEstimatedCost: true,
        },
        crypto.randomUUID(),
      );
    },
    onSuccess: (experiment) => {
      setExperimentId(experiment.id);
      setNotice("三引擎盲测已开始，结果将匿名展示");
    },
    onError: (cause) => setNotice(message(cause)),
  });
  const { data: experiment } = useQuery({
    queryKey: ["agent-experiment", experimentId],
    queryFn: () => client.agentExperiments.get(experimentId!),
    enabled: Boolean(experimentId),
    refetchInterval: (query) =>
      ["queued", "running"].includes(query.state.data?.status ?? "")
        ? 1_000
        : false,
  });
  const reviewExperiment = useMutation({
    mutationFn: (preferredCandidate: "one" | "two" | "three" | "tie") =>
      client.agentExperiments.review(experimentId!, { preferredCandidate }),
    onSuccess: (result) => {
      queryClient.setQueryData(["agent-experiment", result.id], result);
      setNotice("盲测评价已保存，现在可以查看引擎名称");
    },
    onError: (cause) => setNotice(message(cause)),
  });
  return (
    <aside className="sticky top-20 h-fit rounded-2xl border border-indigo-100 bg-gradient-to-br from-white to-indigo-50 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">DramaIP 智能助手</h2>
        <span className="rounded-full bg-brand-soft px-2 py-1 text-xs text-brand">
          受控引擎
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted">
        智能助手经由 DramaIP
        本地服务代理，只使用受控的只读工具；所有内容改动和付费厂商调用都必须由你确认。
      </p>
      <div
        className="mt-3 flex rounded-lg border border-line bg-white p-1 text-xs"
        role="group"
        aria-label="智能助手模式"
      >
        <button
          className={`flex-1 rounded-md px-2 py-1.5 ${assistantMode === "simple" ? "bg-brand-soft font-medium text-brand" : "text-muted"}`}
          disabled={!projectId || updateAssistantMode.isPending}
          onClick={() => {
            setAssistantMode("simple");
            updateAssistantMode.mutate("simple");
          }}
        >
          简洁模式
        </button>
        <button
          className={`flex-1 rounded-md px-2 py-1.5 ${assistantMode === "advanced" ? "bg-brand-soft font-medium text-brand" : "text-muted"}`}
          disabled={!projectId || updateAssistantMode.isPending}
          onClick={() => {
            setAssistantMode("advanced");
            updateAssistantMode.mutate("advanced");
          }}
        >
          高级模式
        </button>
      </div>
      <select
        className="mt-4 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
        value={projectId}
        onChange={(event) => setProjectId(event.target.value)}
      >
        <option value="">选择诊断项目</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.title}
          </option>
        ))}
      </select>
      {selectedShot && (
        <p
          className="mt-3 rounded-lg bg-brand-soft p-3 text-xs leading-5 text-brand"
          aria-label="当前分镜上下文"
        >
          当前分镜：{selectedShot.title}。已从导演看板带入；新建任务会附带这段镜头上下文，不需要重复选择父级资料。
        </p>
      )}
      <select
        className="mt-3 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
        value={chapterId}
        onChange={(event) => setChapterId(event.target.value)}
        disabled={!projectId}
      >
        <option value="">项目级诊断（可选）</option>
        {chapters.map((chapter) => (
          <option key={chapter.id} value={chapter.id}>
            {chapter.title}（助手上下文）
          </option>
        ))}
      </select>
      {assistantMode === "simple" && (
        <section className="mt-4 space-y-3" aria-label="当前页面推荐动作">
          <div>
            <p className="text-sm font-medium">当前页面推荐</p>
            <p className="mt-1 text-xs leading-5 text-muted">
              已根据当前页面和项目输入筛选；每次任务都会保留可追溯快照，结果仅进入预览或变更包。
            </p>
          </div>
          {contextActions.map((action) => {
            const preflight = preflightFor(action);
            const costLabel =
              preflight.cost === "unknown"
                ? "费用：待厂商调用预览确认"
                : "费用：模型调用按服务商账单结算";
            return (
              <article
                key={action.actionId}
                className="rounded-xl border border-line bg-white p-3"
              >
                <p className="text-sm font-medium">{action.label}</p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  {action.summary}
                </p>
                <p className="mt-2 text-xs text-muted">
                  输入：
                  {preflight.input === "ready"
                    ? "已就绪"
                    : preflight.input === "chapter-required"
                      ? "需要选择章节"
                      : "需要选择项目"}
                  <br />
                  能力：
                  {preflight.capability === "ready"
                    ? `${selectedEngine?.name ?? "智能引擎"} 可用`
                    : preflight.capability === "unavailable"
                      ? "所选引擎当前不可用"
                      : "需要配置引擎或默认模型"}
                  <br />
                  {costLabel}
                </p>
                {!preflight.ready && (
                  <div className="mt-2 text-xs leading-5 text-amber-700">
                    {preflight.fixes.map((fix) => (
                      <p key={fix}>{fix}</p>
                    ))}
                    <Link className="text-brand hover:underline" to="/settings">
                      前往设置修复
                    </Link>
                  </div>
                )}
                <button
                  className="mt-3 w-full rounded-lg border border-brand bg-white px-3 py-2 text-sm font-medium text-brand disabled:opacity-50"
                  disabled={runAgent.isPending || !preflight.ready}
                  onClick={() => runAgent.mutate({ taskType: action.id })}
                >
                  {runAgent.isPending
                    ? "正在创建任务…"
                    : `生成${action.label}预览`}
                </button>
              </article>
            );
          })}
          {!contextActions.length && !missingTaskTypes.length && (
            <p className="rounded-lg border border-line bg-white p-3 text-xs text-muted">
              正在读取受控任务目录…
            </p>
          )}
          {!!missingTaskTypes.length && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
              当前安装的任务目录缺少推荐动作，请更新本地服务后重试。
            </p>
          )}
        </section>
      )}
      {assistantMode === "advanced" && (
        <>
          <label className="mt-3 grid gap-1 text-sm text-muted">
            智能引擎
            <select
              className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink"
              value={engineKind}
              onChange={(event) =>
                setEngineKind(event.target.value as AgentEngineKind)
              }
            >
              {engines.map((engine) => (
                <option
                  key={engine.kind}
                  value={engine.kind}
                  disabled={engine.status !== "available"}
                >
                  {engine.name}
                  {engine.isBeta ? "（测试版）" : ""} ·{" "}
                  {engine.status === "available" ? "可用" : "不可用"}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 grid gap-1 text-sm text-muted">
            智能任务
            <select
              className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink"
              value={taskType}
              onChange={(event) =>
                setTaskType(event.target.value as AgentTaskType)
              }
            >
              {Array.from(
                new Set(taskDefinitions.map((item) => item.category)),
              ).map((category) => (
                <optgroup key={category} label={category}>
                  {taskDefinitions
                    .filter((item) => item.category === category)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="mt-3 grid gap-1 text-sm text-muted">
            本次模型（可选）
            <input
              className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink"
              placeholder="留空时使用项目或引擎默认模型"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
            />
          </label>
          <label className="mt-3 grid gap-1 text-sm text-muted">
            盲测比较方式
            <select
              className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink"
              value={experimentMode}
              onChange={(event) =>
                setExperimentMode(
                  event.target.value as "recommended" | "same_model",
                )
              }
            >
              <option value="recommended">各引擎推荐配置</option>
              <option value="same_model">三个引擎使用同一模型</option>
            </select>
          </label>
          {requiresChapter && !chapterId && (
            <p className="mt-2 text-xs leading-5 text-amber-700">
              此任务需要先选择章节。生成结果只会创建待确认预览，不会直接改写正式内容。
            </p>
          )}
          <label className="mt-3 grid gap-1 text-sm text-muted">
            任务要求（可选）
            <textarea
              className="min-h-24 rounded-lg border border-line bg-white p-3 text-sm text-ink"
              placeholder={
                selectedTask?.writePolicy === "change-preview"
                  ? "例如：保持原有悬疑节奏，强化主角动机，并保留结尾钩子。"
                  : "例如：检查人物动机是否连贯，并给出可执行建议。"
              }
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <button
            className="mt-3 w-full rounded-lg border border-brand bg-white px-3 py-2 text-sm font-medium text-brand disabled:opacity-50"
            disabled={
              runAgent.isPending ||
              !projectId ||
              (requiresChapter && !chapterId) ||
              engines.find((engine) => engine.kind === engineKind)?.status !==
                "available"
            }
            onClick={() => runAgent.mutate({})}
          >
            {runAgent.isPending
              ? "正在创建任务…"
              : `执行${selectedTask?.label ?? "智能任务"}`}
          </button>
          <button
            className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm font-medium disabled:opacity-50"
            disabled={
              createExperiment.isPending ||
              !projectId ||
              (requiresChapter && !chapterId)
            }
            onClick={() => createExperiment.mutate()}
          >
            {createExperiment.isPending ? "正在创建盲测…" : "启动三引擎盲测"}
          </button>
        </>
      )}
      {activeRun && (
        <section className="mt-4 rounded-xl border border-line bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">任务条目流</p>
            <span className="text-xs text-muted">
              {TASK_STATUS_LABELS[activeRun.status] ?? "状态未知"}
            </span>
          </div>
          <div className="mt-2 max-h-48 space-y-2 overflow-auto">
            {activeItems.map((item) => (
              <div key={item.id} className="rounded-lg bg-canvas p-2 text-xs">
                <p className="font-medium">
                  {item.type === "message"
                    ? "正式输出"
                    : item.type === "tool_call"
                      ? "工具调用"
                      : item.type === "tool_result"
                        ? "工具结果"
                        : item.type === "usage"
                          ? "用量"
                          : item.type === "structured_output"
                            ? "结构化结果"
                            : item.type === "error"
                              ? "错误"
                              : "推理摘要"}
                </p>
                {item.content && (
                  <p className="mt-1 whitespace-pre-wrap text-muted">
                    {item.content}
                  </p>
                )}
              </div>
            ))}
            {!activeItems.length && (
              <p className="text-xs text-muted">正在等待引擎返回正式输出…</p>
            )}
          </div>
          <p className="mt-2 text-xs text-muted">
            输入 {activeRun.inputTokens?.toLocaleString("zh-CN") ?? "待统计"} ·
            输出 {activeRun.outputTokens?.toLocaleString("zh-CN") ?? "待统计"} ·
            缓存 {activeRun.cachedTokens?.toLocaleString("zh-CN") ?? "待统计"} ·
            {activeRun.estimatedCost === undefined
              ? "费用待厂商结算"
              : `预估费用 ${activeRun.estimatedCost.toFixed(4)} ${activeRun.currency ?? "USD"}`}
          </p>
          <div className="mt-2 flex gap-2">
            {activeRun.status === "running" && (
              <button
                className="rounded-md border border-line px-2 py-1 text-xs"
                disabled={interruptRun.isPending}
                onClick={() => interruptRun.mutate()}
              >
                中断任务
              </button>
            )}
            {activeRun.status === "interrupted" && (
              <button
                className="rounded-md border border-brand px-2 py-1 text-xs text-brand"
                disabled={resumeRun.isPending}
                onClick={() => resumeRun.mutate()}
              >
                恢复任务
              </button>
            )}
          </div>
        </section>
      )}
      {experiment && (
        <AgentExperimentCard
          experiment={experiment}
          reviewing={reviewExperiment.isPending}
          onReview={(candidate) => reviewExperiment.mutate(candidate)}
        />
      )}
      {notice && <p className="mt-3 text-xs leading-5 text-muted">{notice}</p>}
      <p className="mt-3 text-xs leading-5 text-muted">
        任务状态会实时同步到任务中心。
      </p>
    </aside>
  );
}

function AgentExperimentCard(props: {
  experiment: AgentExperiment;
  reviewing: boolean;
  onReview(candidate: "one" | "two" | "three" | "tie"): void;
}) {
  const candidateLabels = { one: "方案一", two: "方案二", three: "方案三" };
  return (
    <section className="mt-4 rounded-xl border border-line bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">三引擎盲测</p>
        <span className="text-xs text-muted">
          {props.experiment.status === "ready_for_review"
            ? "等待评价"
            : props.experiment.status === "completed"
              ? "评价完成"
              : props.experiment.status === "failed"
                ? "盲测失败"
                : "运行中"}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">
        {props.experiment.comparisonMode === "same_model"
          ? `同模型比较：${props.experiment.model?.modelId ?? "模型未记录"}`
          : "各引擎推荐配置比较"}
      </p>
      <div className="mt-2 space-y-2">
        {props.experiment.candidates?.map((candidate) => (
          <article
            key={candidate.candidate}
            className="rounded-lg bg-canvas p-2 text-xs"
          >
            <p className="font-medium">
              {candidateLabels[candidate.candidate]}
              {candidate.engineKind
                ? ` · ${AGENT_ENGINE_LABELS[candidate.engineKind]}`
                : ""}
            </p>
            <p className="mt-1 text-muted">
              {TASK_STATUS_LABELS[candidate.status] ?? "状态未知"}
            </p>
            {candidate.metrics && (
              <p className="mt-1 text-muted">
                耗时 {(candidate.metrics.latencyMs / 1000).toFixed(1)} 秒 · 输入{" "}
                {candidate.metrics.inputTokens.toLocaleString("zh-CN")} · 输出{" "}
                {candidate.metrics.outputTokens.toLocaleString("zh-CN")}
                {candidate.metrics.estimatedCost !== undefined
                  ? ` · 预估费用 ${candidate.metrics.estimatedCost.toFixed(4)} ${candidate.metrics.currency ?? "USD"}`
                  : " · 费用待厂商结算"}
                {candidate.metrics.formatError ? " · 格式不合格" : ""}
                {candidate.metrics.toolViolation ? " · 工具违规" : ""}
                {candidate.metrics.adopted ? " · 已采用" : ""}
              </p>
            )}
            {candidate.output !== undefined && (
              <p className="mt-1 line-clamp-6 whitespace-pre-wrap text-muted">
                {taskResultText(candidate.output)}
              </p>
            )}
            {props.experiment.status === "ready_for_review" && (
              <button
                className="mt-2 rounded border border-brand px-2 py-1 text-brand disabled:opacity-50"
                disabled={props.reviewing}
                onClick={() => props.onReview(candidate.candidate)}
              >
                选择此方案
              </button>
            )}
          </article>
        ))}
      </div>
      {props.experiment.status === "ready_for_review" && (
        <button
          className="mt-2 rounded border border-line px-2 py-1 text-xs disabled:opacity-50"
          disabled={props.reviewing}
          onClick={() => props.onReview("tie")}
        >
          三个方案相当
        </button>
      )}
    </section>
  );
}
function message(cause: unknown): string {
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
  return /[A-Za-z]{2,}/.test(raw) ? "操作未能完成，请稍后重试。" : raw;
}

function taskResultText(value: unknown): string {
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

function agentRevisionPreview(value: unknown): RevisionPreview | undefined {
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

function agentChangePreview(value: unknown): ChangePreview | undefined {
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

function agentProviderActionPreview(
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);
