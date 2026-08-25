import type {
  Chapter,
  DomainEntity,
  ImportExtractionChangeSet,
  PilotPlan,
  Project,
  ProjectMode,
  ProjectPackagePreview,
  Series,
  SeriesLibrary,
  SourceImportPreview,
  SourceImportStrategy,
  StoryBibleChangeSet,
} from "@dramaip/contracts/product";
import {
  BareButton,
  Button,
  DropdownMenu,
  EmptyState,
  InlineNotice,
  Input,
  LoadingState,
  Textarea,
  confirmDialog,
} from "@dramaip/ui-shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { deriveProjectCockpit } from "../../project-cockpit";
import {
  defaultProductionBrief,
  projectInputFromBrief,
  type ProductionBriefDraft,
  type ProjectCreationSource,
} from "../../project-intake";
import {
  buildStoryBibleSidecar,
  type StoryBibleContext,
} from "../../story-bible-sidecar";
import {
  EditableChapter,
  EditableProject,
  ProjectToolKey,
  TASK_STATUS_LABELS,
  WorkspaceIntro,
  message,
  searchKindLabel,
  searchResultPath,
  useStudio,
} from "../../studio-shared";
import { ChapterAnalysisPanel } from "../creative/impl";
import { NovelChapterWorkspace } from "../novel/NovelChapterWorkspace";
import {
  NovelArtifactGenerator,
  NovelCharactersSection,
  NovelLongformToolsSection,
  NovelOutlineSection,
} from "../novel/NovelProjectSections";
import {
  CreativeDiagnosticsPanel,
  PluginResourceWorkspace,
  StoryBibleChangeSetPanel,
  recordPayload,
} from "../studio-widgets";
export function SearchPage() {
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
    <section className="mx-auto max-w-5xl">
      <WorkspaceIntro
        eyebrow="全局搜索"
        title="查找项目资料"
        description="搜索项目、章节与全部创作、制作、审核资料，快速回到正在推进的内容。"
        badge="统一资料库"
      />
      <div className="mt-5 flex gap-3 rounded-xl border border-line bg-surface p-4">
        <input
          className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2"
          placeholder="输入项目名称、章节内容或资料关键词"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void search();
          }}
        />
        <BareButton
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={!query.trim() || loading}
          onClick={() => void search()}
        >
          {loading ? "搜索中…" : "搜索"}
        </BareButton>
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

export function ProjectPackageImportPanel(props: {
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
    const selected = await client.host.pickFiles({
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
        capabilityToken: file.grantId,
      });
      setFileName(file.displayName);
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
    <section className="studio-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">导入新版项目包</h2>
          <p className="mt-1 text-sm text-muted">
            导入由 DramaIP 新版导出的项目
            JSON。系统会先预览，再创建一个新的独立项目；不会读取旧版数据库。
          </p>
        </div>
        <BareButton
          className="rounded-lg border border-line px-3 py-2 text-sm text-brand disabled:opacity-50"
          disabled={working}
          onClick={() => void choose()}
        >
          {working ? "正在读取…" : "选择项目包"}
        </BareButton>
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
              className="rounded-lg border border-line bg-surface-raised px-3 py-2"
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
            <BareButton
              className="rounded-lg border border-line px-3 py-2 text-sm text-muted"
              disabled={working}
              onClick={() => void discard()}
            >
              取消
            </BareButton>
            <BareButton
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={working || !title.trim()}
              onClick={() => void commit()}
            >
              {working ? "正在导入…" : "确认创建新项目"}
            </BareButton>
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

function projectModeLabel(mode: ProjectMode): string {
  return {
    series_longform: "系列长篇",
    single_season: "单季短剧",
    personal_theater: "我的AI小剧场",
    creator_channel: "博主内容工作室",
  }[mode];
}

function projectModeNextStep(project: Project): string {
  if (project.lifecycleStatus === "initializing") return "正在初始化…";
  switch (project.mode) {
    case "series_longform":
      return "建立母本与第 1 卷 →";
    case "single_season":
      return "完成季纲与首集 →";
    case "personal_theater":
      return "建立人物肖像授权 →";
    case "creator_channel":
      return "创建账号定位与首个选题 →";
  }
}

type ProjectStartOption = {
  source: ProjectCreationSource;
  title: string;
  description: string;
  outcome: string;
  recommended?: boolean;
};

function projectStartOptions(mode: ProjectMode): readonly ProjectStartOption[] {
  if (mode === "series_longform")
    return [
      {
        source: "inspiration",
        title: "从灵感开始",
        description: "先建立长篇母本和第一章，再逐步完善人物、卷纲与故事圣经。",
        outcome: "创建后进入母本写作",
        recommended: true,
      },
      {
        source: "source-import",
        title: "导入小说母本",
        description: "导入你拥有权利的小说或 IP，确认预览后再写入项目。",
        outcome: "创建后进入原著导入预览",
      },
    ];
  if (mode === "single_season")
    return [
      {
        source: "inspiration",
        title: "先写小说",
        description: "先用章节编辑器完成故事，再汇入本季季纲、分集和剧本。",
        outcome: "创建后进入小说写作",
        recommended: true,
      },
      {
        source: "source-import",
        title: "导入原著",
        description: "导入已授权小说或 IP，预览确认后开始单季改编。",
        outcome: "创建后进入原著导入预览",
      },
      {
        source: "script",
        title: "直接写剧本",
        description: "粘贴首集剧本草稿，或在下一步选择已有剧本文件。",
        outcome: "创建后进入首集剧本",
      },
    ];
  if (mode === "personal_theater")
    return [
      {
        source: "inspiration",
        title: "从故事模板开始",
        description: "创建一集五分钟的小故事，再添加本人或已授权亲友角色。",
        outcome: "创建后先管理人物与授权",
        recommended: true,
      },
      {
        source: "script",
        title: "自由描述故事",
        description: "直接写下想拍的故事，保存为第一集故事草稿。",
        outcome: "创建后进入人物授权与故事草稿",
      },
    ];
  return [
    {
      source: "inspiration",
      title: "从一个主题开始",
      description: "确定持续主题和账号定位，再建立栏目、选题与资料库。",
      outcome: "创建后进入内容与研究工作台",
      recommended: true,
    },
  ];
}

function projectModeBrief(
  mode: ProjectMode,
  source: ProjectCreationSource,
  current?: ProductionBriefDraft,
): ProductionBriefDraft {
  const base = defaultProductionBrief(source);
  const modeDefaults: Record<ProjectMode, Partial<ProductionBriefDraft>> = {
    series_longform: {
      shortDramaType: "逆袭爽文",
      targetEpisodeCount: "80",
      episodeDuration: "60—90 秒",
    },
    single_season: {
      shortDramaType: "逆袭爽剧",
      targetEpisodeCount: "80",
      episodeDuration: "60—90 秒",
    },
    personal_theater: {
      shortDramaType: "个人故事",
      targetAudience: "本人及亲友",
      targetEpisodeCount: "1",
      episodeDuration: "5 分钟",
    },
    creator_channel: {
      shortDramaType: "主题内容",
      targetAudience: "目标账号受众",
      targetEpisodeCount: "",
      episodeDuration: "60—180 秒",
      visualStyleDirection: "统一账号视觉与表达风格",
    },
  };
  return {
    ...base,
    ...modeDefaults[mode],
    title: current?.title ?? "",
    idea: current?.idea ?? "",
  };
}

function projectCreateLabel(mode: ProjectMode): string {
  return {
    series_longform: "创建系列长篇",
    single_season: "创建单季短剧",
    personal_theater: "创建我的 AI 小剧场",
    creator_channel: "创建博主内容工作室",
  }[mode];
}

export function ProjectHome() {
  const client = useStudio();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [creationSource, setCreationSource] =
    useState<ProjectCreationSource>("inspiration");
  const [projectMode, setProjectMode] =
    useState<ProjectMode>("series_longform");
  const [creatorTopic, setCreatorTopic] = useState("");
  const [brief, setBrief] = useState<ProductionBriefDraft>(() =>
    projectModeBrief("series_longform", "inspiration"),
  );
  const [scriptContent, setScriptContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [creatingDemo, setCreatingDemo] = useState(false);
  const [error, setError] = useState<string>();
  const [showTrash, setShowTrash] = useState(false);
  const [trashedProjects, setTrashedProjects] = useState<Project[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const startMethodRef = useRef<HTMLDivElement>(null);
  const projectFormRef = useRef<HTMLDivElement>(null);
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
    setBrief((current) => projectModeBrief(projectMode, source, current));
    setScriptContent("");
    setError(undefined);
    window.setTimeout(
      () =>
        projectFormRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      0,
    );
  };
  const selectProjectMode = (mode: ProjectMode) => {
    const source = projectStartOptions(mode)[0]!.source;
    setProjectMode(mode);
    setCreationSource(source);
    setBrief((current) => projectModeBrief(mode, source, current));
    setScriptContent("");
    setShowAdvanced(false);
    setError(undefined);
    window.setTimeout(
      () =>
        startMethodRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      0,
    );
  };
  const modeConfig = () => {
    if (projectMode === "series_longform")
      return {
        mode: projectMode,
        targetChapterCount: 300,
        targetSeasonCount: 5,
      };
    if (projectMode === "single_season")
      return {
        mode: projectMode,
        entryPath: (creationSource === "script"
          ? "script"
          : creationSource === "source-import"
            ? "source-import"
            : "novel") as "novel" | "source-import" | "script",
        targetEpisodeCount: 80,
      };
    if (projectMode === "personal_theater")
      return {
        mode: projectMode,
        storyMethod:
          creationSource === "script"
            ? ("freeform" as const)
            : ("template" as const),
        episodeCount: 1,
        episodeDurationMinutes: 5,
      };
    return {
      mode: projectMode,
      topic: creatorTopic.trim() || "待确定主题",
      riskDomain: "general" as const,
    };
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
    if (
      !creationSource ||
      !brief.title.trim() ||
      !brief.shortDramaType.trim() ||
      (projectMode === "creator_channel" && !creatorTopic.trim())
    )
      return;
    if (mode === "script-draft" && !scriptContent.trim()) return;
    setSaving(true);
    setError(undefined);
    try {
      const project = (
        await client.projects.create({
          ...projectInputFromBrief(brief),
          mode: projectMode,
          modeConfig: modeConfig(),
        })
      ).project;
      if (mode === "inspiration" && projectMode !== "creator_channel") {
        try {
          const chapter = await client.chapters.create({
            projectId: project.id,
            title:
              projectMode === "personal_theater" ? "第 1 集故事" : "第 1 章",
            summary: "",
            content: "",
          });
          window.localStorage.setItem(
            `dramaip-novel-last-chapter:${project.id}`,
            chapter.id,
          );
        } catch (cause) {
          await cleanupUnfinishedProject(project);
          throw cause;
        }
      }
      if (mode === "script-draft") {
        try {
          await client.chapters.create({
            projectId: project.id,
            title:
              projectMode === "personal_theater"
                ? "第 1 集故事草稿"
                : "第 1 集剧本草稿",
            summary:
              projectMode === "personal_theater"
                ? "从首页自由描述创建的个人小剧场故事，待完成人物授权后制作。"
                : "从首页直接粘贴的剧本草稿，待后续拆分为场景与分镜。",
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
        sourceImport
          ? `/projects/${project.id}/tools/import`
          : `/projects/${project.id}`,
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
    if (!(await confirmDialog(`将「${project.title}」移入回收站吗？`))) return;
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
      <WorkspaceIntro
        eyebrow="本地项目库"
        title="项目工作台"
        description="创建、导入和管理创作项目，从已有内容继续推进下一步工作。"
        badge="项目管理"
      />
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">新建创作项目</h2>
            <p className="mt-1 text-sm text-muted">
              按三个步骤完成创建。数量和时长都是建议值，创建后仍可调整。
            </p>
          </div>
          <Button
            variant="secondary"
            disabled={saving || creatingDemo}
            onClick={() => void createDemo()}
          >
            {creatingDemo ? "正在创建示例…" : "创建示例项目"}
          </Button>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <span className="grid size-7 place-items-center rounded-full bg-brand text-sm font-semibold text-white">
            1
          </span>
          <div>
            <h3 className="font-semibold">选择创作模式</h3>
            <p className="text-xs text-muted">决定项目的工作台和生产流程</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              mode: "series_longform" as const,
              title: "系列长篇",
              description: "先写300章级爽文母本，再按季改编为多季短剧。",
              next: "建立母本、故事圣经与分季改编",
            },
            {
              mode: "single_season" as const,
              title: "单季短剧",
              description: "从小说、已授权原著或剧本开始，建议80集。",
              next: "完成季纲、分集、剧本和分镜",
            },
            {
              mode: "personal_theater" as const,
              title: "我的AI小剧场",
              description: "以自己和已授权亲友为主角，默认一集五分钟。",
              next: "先建立人物授权，再选择故事模板",
            },
            {
              mode: "creator_channel" as const,
              title: "博主内容工作室",
              description: "围绕一个主题持续生产选题、研究、文章和口播。",
              next: "确定账号定位与首个选题",
            },
          ].map((item) => {
            const selected = projectMode === item.mode;
            return (
              <BareButton
                key={item.mode}
                className={`group relative min-h-40 rounded-xl border p-4 text-left transition ${selected ? "border-brand bg-brand-soft shadow-control" : "border-line bg-surface-raised hover:border-line-strong hover:bg-surface-muted"}`}
                aria-pressed={selected}
                onClick={() => selectProjectMode(item.mode)}
              >
                <span
                  className={`absolute right-4 top-4 text-xs font-medium ${selected ? "text-brand-strong" : "text-muted"}`}
                >
                  {selected ? "✓ 已选择" : "选择"}
                </span>
                <p className="font-medium">{item.title}</p>
                <p className="mt-2 pr-12 text-sm leading-6 text-muted">
                  {item.description}
                </p>
                <p className="mt-3 text-xs font-medium text-rust">
                  {item.next}
                </p>
              </BareButton>
            );
          })}
        </div>
        <div
          ref={startMethodRef}
          className="scroll-mt-20 border-t border-line pt-5 mt-6"
        >
          <div className="flex items-center gap-3">
            <span className="grid size-7 place-items-center rounded-full bg-brand text-sm font-semibold text-white">
              2
            </span>
            <div>
              <h3 className="font-semibold">选择怎么开始</h3>
              <p className="text-xs text-muted">
                已选择“{projectModeLabel(projectMode)}”，推荐方式已自动选中
              </p>
            </div>
          </div>
          <div
            className={`mt-4 grid gap-3 ${projectStartOptions(projectMode).length === 1 ? "md:grid-cols-1" : projectStartOptions(projectMode).length === 2 ? "md:grid-cols-2" : "md:grid-cols-3"}`}
          >
            {projectStartOptions(projectMode).map((path) => {
              const selected = creationSource === path.source;
              return (
                <BareButton
                  key={path.source}
                  className={`group relative min-h-28 overflow-hidden rounded-xl border px-5 py-4 text-left transition focus-visible:ring-2 focus-visible:ring-focus ${selected ? "border-brand bg-brand-soft text-brand-strong shadow-control" : "border-line bg-surface-raised text-ink shadow-control hover:border-line-strong hover:bg-surface-muted"}`}
                  aria-pressed={selected}
                  onClick={() => selectCreationSource(path.source)}
                >
                  {selected && (
                    <span className="absolute right-4 top-4 inline-flex items-center gap-1.5 text-xs font-medium text-brand-strong">
                      <span
                        aria-hidden="true"
                        className="grid size-4 place-items-center rounded-full bg-brand text-[10px] text-white"
                      >
                        ✓
                      </span>
                      {path.recommended ? "推荐 · 已选择" : "已选择"}
                    </span>
                  )}
                  <p
                    className={`pr-20 font-medium transition-colors ${selected ? "text-rust" : "text-ink"}`}
                  >
                    {path.title}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    {path.description}
                  </p>
                  <p className="mt-3 text-xs font-medium text-rust/90">
                    {path.outcome}
                  </p>
                </BareButton>
              );
            })}
          </div>
        </div>
        {creationSource && (
          <div
            ref={projectFormRef}
            className="mt-6 scroll-mt-20 border-t border-line pt-5"
          >
            <div className="flex items-center gap-3">
              <span className="grid size-7 place-items-center rounded-full bg-brand text-sm font-semibold text-white">
                3
              </span>
              <div>
                <h3 className="font-semibold">填写名称并创建</h3>
                <p className="text-xs text-muted">
                  只需填写必填项；其他设置可以创建后再调整
                </p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="mt-4 grid gap-1 text-sm">
                <span>
                  项目名称 <span className="text-rust">必填</span>
                </span>
                <Input
                  autoFocus={false}
                  placeholder={`例如：我的${projectModeLabel(projectMode)}项目`}
                  value={brief.title}
                  onChange={(event) => updateBrief("title", event.target.value)}
                />
              </label>
              {projectMode === "creator_channel" && (
                <label className="mt-4 grid gap-1 text-sm">
                  <span>
                    持续主题 / 账号定位
                    <span className="ml-1 text-rust">必填</span>
                  </span>
                  <Input
                    placeholder="例如：面向新手的宏观财经解读"
                    value={creatorTopic}
                    onChange={(event) => setCreatorTopic(event.target.value)}
                  />
                </label>
              )}
              {projectMode !== "creator_channel" && (
                <label className="mt-4 grid gap-1 text-sm">
                  {projectMode === "personal_theater" ? "故事类型" : "题材方向"}
                  <Input
                    value={brief.shortDramaType}
                    onChange={(event) =>
                      updateBrief("shortDramaType", event.target.value)
                    }
                  />
                </label>
              )}
            </div>
            {creationSource !== "script" && (
              <label className="mt-3 grid gap-1 text-sm">
                {projectMode === "creator_channel"
                  ? "补充说明"
                  : projectMode === "personal_theater"
                    ? "想讲的故事（可选）"
                    : "故事构思（可选）"}
                <Textarea
                  className="min-h-24"
                  placeholder={
                    projectMode === "creator_channel"
                      ? "例如：强调数据来源，风格通俗但不过度简化"
                      : "写一句话也可以，创建后再继续完善"
                  }
                  value={brief.idea}
                  onChange={(event) => updateBrief("idea", event.target.value)}
                />
              </label>
            )}
            {creationSource === "script" && (
              <label className="mt-3 grid gap-1 text-sm">
                {projectMode === "personal_theater" ? "故事描述" : "首集剧本"}
                <span className="text-xs text-muted">
                  可以直接粘贴；如果已有文件，也可以在下方选择文件导入
                </span>
                <Textarea
                  className="min-h-40 font-editor"
                  placeholder={
                    projectMode === "personal_theater"
                      ? "描述主角、发生的事情和希望呈现的情绪"
                      : "粘贴已拥有权利的剧本内容；保存后会作为首集草稿进入项目"
                  }
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
            <BareButton
              className="mt-4 text-sm font-medium text-brand hover:text-brand-strong"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((value) => !value)}
            >
              {showAdvanced ? "收起更多设置 ↑" : "展开受众、平台与视觉设置 ↓"}
            </BareButton>
            {showAdvanced && (
              <div className="mt-3 grid gap-3 rounded-xl border border-line bg-surface-raised p-4 md:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  目标受众
                  <Input
                    value={brief.targetAudience}
                    onChange={(event) =>
                      updateBrief("targetAudience", event.target.value)
                    }
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  目标平台
                  <Input
                    value={brief.targetPlatform}
                    onChange={(event) =>
                      updateBrief("targetPlatform", event.target.value)
                    }
                  />
                </label>
                {projectMode !== "creator_channel" && (
                  <>
                    <label className="grid gap-1 text-sm">
                      单集时长
                      <Input
                        value={brief.episodeDuration}
                        onChange={(event) =>
                          updateBrief("episodeDuration", event.target.value)
                        }
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      建议集数
                      <Input
                        inputMode="numeric"
                        value={brief.targetEpisodeCount}
                        onChange={(event) =>
                          updateBrief("targetEpisodeCount", event.target.value)
                        }
                      />
                    </label>
                  </>
                )}
                <label className="grid gap-1 text-sm">
                  画幅
                  <Input
                    value={brief.aspectRatio}
                    onChange={(event) =>
                      updateBrief("aspectRatio", event.target.value)
                    }
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  视觉方向
                  <Input
                    value={brief.visualStyleDirection}
                    onChange={(event) =>
                      updateBrief("visualStyleDirection", event.target.value)
                    }
                  />
                </label>
              </div>
            )}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/25 bg-brand-soft/50 p-4">
              <div>
                <p className="text-xs font-medium text-brand">即将创建</p>
                <p className="mt-1 text-sm font-semibold">
                  {projectModeLabel(projectMode)} ·{" "}
                  {
                    projectStartOptions(projectMode).find(
                      (item) => item.source === creationSource,
                    )?.title
                  }
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="ghost"
                  disabled={saving}
                  onClick={() => {
                    setBrief(projectModeBrief(projectMode, creationSource));
                    setCreatorTopic("");
                    setScriptContent("");
                    setShowAdvanced(false);
                  }}
                >
                  清空
                </Button>
                {creationSource === "inspiration" && (
                  <Button
                    variant="primary"
                    disabled={
                      saving ||
                      !brief.title.trim() ||
                      (projectMode === "creator_channel" &&
                        !creatorTopic.trim())
                    }
                    onClick={() => void createFromBrief("inspiration")}
                  >
                    {saving ? "正在创建…" : projectCreateLabel(projectMode)}
                  </Button>
                )}
                {creationSource === "source-import" && (
                  <Button
                    variant="primary"
                    disabled={saving || !brief.title.trim()}
                    onClick={() => void createFromBrief("source-file")}
                  >
                    {saving
                      ? "正在创建…"
                      : `${projectCreateLabel(projectMode)}并导入`}
                  </Button>
                )}
                {creationSource === "script" && (
                  <>
                    <Button
                      variant="secondary"
                      disabled={saving || !brief.title.trim()}
                      onClick={() => void createFromBrief("script-file")}
                    >
                      {projectMode === "personal_theater"
                        ? "创建并选择故事文件"
                        : "创建并选择剧本文件"}
                    </Button>
                    <Button
                      variant="primary"
                      disabled={
                        saving || !brief.title.trim() || !scriptContent.trim()
                      }
                      onClick={() => void createFromBrief("script-draft")}
                    >
                      {saving ? "正在创建…" : projectCreateLabel(projectMode)}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
        {error && (
          <InlineNotice className="mt-3" tone="danger">
            {error}
          </InlineNotice>
        )}
      </section>
      <ProjectPackageImportPanel
        onImported={(project) => {
          setProjects((items) => [project, ...items]);
          navigate(`/projects/${project.id}`);
        }}
      />
      <section>
        <div className="mb-5 flex items-end justify-between">
          <div>
            <p className="studio-eyebrow">本地项目库</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">项目</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">{projects.length} 个</span>
            <BareButton
              className="text-sm text-muted hover:text-brand"
              onClick={() => {
                setShowTrash((value) => !value);
                if (!showTrash) loadTrash();
              }}
            >
              {showTrash ? "收起回收站" : "查看回收站"}
            </BareButton>
          </div>
        </div>
        <div
          className={`grid gap-4 ${projects.length === 1 ? "grid-cols-1" : "md:grid-cols-2 xl:grid-cols-3"}`}
        >
          {projects.map((project, index) => (
            <article
              key={project.id}
              className={`studio-card studio-card-interactive group relative overflow-hidden p-6 transition ${projects.length === 1 ? "max-w-none" : ""}`}
            >
              <span className="absolute right-5 top-5 font-mono text-xs text-muted">
                {String(index + 1).padStart(2, "0")}
              </span>
              <Link to={`/projects/${project.id}`} className="block">
                <span className="inline-flex rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-rust">
                  {projectModeLabel(project.mode)}
                </span>
                <p className="mt-8 text-xl font-semibold tracking-tight group-hover:text-rust">
                  {project.title}
                </p>
                <p className="mt-3 min-h-12 line-clamp-2 text-sm leading-6 text-muted">
                  {project.synopsis || "尚未填写项目简介"}
                </p>
                <p className="mt-6 text-sm font-medium text-rust">
                  {projectModeNextStep(project)}
                </p>
              </Link>
              <BareButton
                className="mt-5 text-xs text-muted hover:text-red-600"
                onClick={() => void trashProject(project)}
              >
                移入回收站
              </BareButton>
            </article>
          ))}
          {!projects.length && (
            <EmptyState
              className="col-span-full"
              title="创建第一个项目"
              description="从灵感、原著或已有剧本开始搭建故事世界。"
            />
          )}
        </div>
        {showTrash && (
          <section className="mt-6 rounded-xl border border-dashed border-line bg-surface p-5">
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
                      {projectModeLabel(project.mode)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void restoreProject(project)}
                    >
                      恢复项目
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => void purgeProject(project)}
                    >
                      永久删除
                    </Button>
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

export const PROJECT_TOOL_META: ReadonlyArray<{
  key: ProjectToolKey;
  label: string;
  description: string;
}> = [
  {
    key: "import",
    label: "导入内容",
    description: "预览并导入小说原稿、剧本或结构化资料。",
  },
  {
    key: "review",
    label: "导入审阅",
    description: "核对从导入内容中提取的人物、场景和改编建议。",
  },
  {
    key: "cockpit",
    label: "项目驾驶舱",
    description: "查看当前阶段、阻断项和唯一推荐下一步。",
  },
  {
    key: "pilot",
    label: "试制计划",
    description: "用 1–3 集验证从章节到审核的制作链路。",
  },
  {
    key: "series",
    label: "系列资料",
    description: "管理系列 Story Bible 和可复用资产版本。",
  },
  {
    key: "personal-theater",
    label: "人物与授权",
    description: "以不透明媒体引用管理照片、授权、撤回和生成前预检。",
  },
  {
    key: "creator-channel",
    label: "内容与研究",
    description: "管理账号定位、选题、零账号研究、文案和内容日历。",
  },
];

function projectToolMeta(mode: ProjectMode) {
  const allowed: Record<ProjectMode, readonly ProjectToolKey[]> = {
    series_longform: ["import", "review", "cockpit", "pilot", "series"],
    single_season: ["import", "review", "cockpit", "pilot"],
    personal_theater: ["personal-theater", "cockpit", "pilot", "review"],
    creator_channel: ["creator-channel", "cockpit", "review"],
  };
  return PROJECT_TOOL_META.filter((item) => allowed[mode].includes(item.key));
}

export function ProjectToolPage() {
  const client = useStudio();
  const navigate = useNavigate();
  const { projectId, toolKey } = useParams<{
    projectId: string;
    toolKey?: string;
  }>();
  const [project, setProject] = useState<Project>();
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [error, setError] = useState<string>();
  const requestedTool = toolKey;
  const { data: overviewChangeSets = [] } = useQuery({
    queryKey: ["project-tools-overview-import-extractions", projectId],
    queryFn: () => client.importExtractions.list(projectId!),
    enabled: Boolean(projectId && !toolKey),
  });
  const pendingReviewCount = overviewChangeSets.reduce(
    (total, item) =>
      total +
      item.candidates.filter((candidate) => candidate.status === "draft")
        .length,
    0,
  );
  const load = async (): Promise<void> => {
    if (!projectId) return;
    try {
      const [nextProject, nextChapters] = await Promise.all([
        client.projects.get(projectId),
        client.chapters.list(projectId),
      ]);
      setProject(nextProject);
      setChapters(nextChapters);
    } catch (cause) {
      setError(message(cause));
    }
  };
  useEffect(() => void load(), [client, projectId]);
  if (!project) return <LoadingState label="正在打开项目工具…" />;
  const modeTools = projectToolMeta(project.mode);
  const activeTool = modeTools.find((item) => item.key === requestedTool);
  const nextTool: ProjectToolKey = pendingReviewCount
    ? "review"
    : project.mode === "personal_theater"
      ? "personal-theater"
      : project.mode === "creator_channel"
        ? "creator-channel"
        : chapters.length
          ? "cockpit"
          : "import";
  const nextMeta = modeTools.find((item) => item.key === nextTool)!;
  const toolStatus = (key: ProjectToolKey) => {
    if (key === "review")
      return {
        label: pendingReviewCount ? "需要处理" : "暂无待办",
        count: pendingReviewCount,
      };
    if (key === "import")
      return { label: "随时可用", count: chapters.length ? 0 : 1 };
    if (key === "pilot")
      return {
        label: chapters.length ? "可以试制" : "等待正文",
        count: chapters.length ? 0 : 1,
      };
    return { label: chapters.length ? "数据已就绪" : "等待正文", count: 0 };
  };
  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-[620px] flex-col overflow-hidden bg-canvas">
      <header className="flex min-h-16 flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2 lg:px-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/projects/${project.id}`)}
        >
          ← 返回写作
        </Button>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted">{project.title}</p>
          <h1 className="truncate font-semibold">
            {activeTool?.label ?? "项目工具"}
          </h1>
        </div>
        <nav
          className="studio-scrollbar ml-auto flex max-w-full gap-1 overflow-x-auto"
          aria-label="项目工具导航"
        >
          <Button asChild size="sm" variant={!activeTool ? "subtle" : "ghost"}>
            <Link to={`/projects/${project.id}/tools`}>总览</Link>
          </Button>
          {modeTools.map((item) => (
            <Button
              key={item.key}
              asChild
              size="sm"
              variant={activeTool?.key === item.key ? "subtle" : "ghost"}
            >
              <Link to={`/projects/${project.id}/tools/${item.key}`}>
                {item.label}
              </Link>
            </Button>
          ))}
        </nav>
      </header>
      <div className="studio-scrollbar min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
        <div className="mx-auto max-w-6xl">
          {error && <InlineNotice tone="danger">{error}</InlineNotice>}
          {!activeTool && (
            <section>
              <p className="studio-eyebrow">按需打开</p>
              <h2 className="mt-2 text-2xl font-semibold">项目工具</h2>
              <p className="mt-2 text-sm text-muted">
                这些工具不再占用正文工作区。这里只保留状态和当前唯一下一步。
              </p>
              <Link
                to={`/projects/${project.id}/tools/${nextTool}`}
                className="mt-6 flex flex-wrap items-center gap-4 rounded-xl border border-brand/25 bg-brand-soft/60 p-5 shadow-card transition hover:border-brand"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-brand">推荐下一步</p>
                  <h3 className="mt-1 text-lg font-semibold">
                    {nextMeta.label}
                  </h3>
                </div>
                <span className="text-sm font-medium text-brand">
                  现在处理 →
                </span>
              </Link>
              <div className="mt-4 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                {modeTools.map((item) => (
                  <Link
                    key={item.key}
                    to={`/projects/${project.id}/tools/${item.key}`}
                    className="flex items-center gap-4 border-b border-line px-5 py-4 transition last:border-b-0 hover:bg-surface-raised"
                  >
                    <h3 className="min-w-32 font-semibold">{item.label}</h3>
                    <p className="min-w-0 flex-1 text-sm text-muted">
                      {toolStatus(item.key).label}
                    </p>
                    <span className="text-xs text-muted">
                      待处理 {toolStatus(item.key).count}
                    </span>
                    <span className="text-sm text-brand">打开 →</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          {activeTool?.key === "import" && (
            <SourceImportPanel
              projectId={project.id}
              initialOpen
              onImported={() => {
                void load().then(() => {
                  // Import completion may race with a user opening another
                  // project tool. Only apply the suggested review navigation
                  // while the import route is still the active destination.
                  if (
                    window.location.hash ===
                    `#/projects/${project.id}/tools/import`
                  )
                    navigate(`/projects/${project.id}/tools/review`);
                });
              }}
            />
          )}
          {activeTool?.key === "review" && (
            <ImportExtractionReviewPanel
              projectId={project.id}
              onChanged={load}
              showEmpty
            />
          )}
          {activeTool?.key === "cockpit" && (
            <ProjectCockpitPanel project={project} chapters={chapters} />
          )}
          {activeTool?.key === "pilot" && (
            <ProjectPilotPanel project={project} chapters={chapters} />
          )}
          {activeTool?.key === "series" && (
            <SeriesLibraryPanel
              project={project}
              onProjectChanged={setProject}
            />
          )}
          {activeTool?.key === "personal-theater" && (
            <PersonalTheaterToolPanel project={project} />
          )}
          {activeTool?.key === "creator-channel" && (
            <CreatorChannelToolPanel project={project} />
          )}
        </div>
      </div>
    </div>
  );
}

function PersonalTheaterToolPanel(props: { project: Project }) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [relationship, setRelationship] = useState<
    "self" | "adult_relative_or_friend" | "minor"
  >("self");
  const [ageBand, setAgeBand] = useState<
    "adult" | "minor_14_to_17" | "under_14"
  >("adult");
  const [notice, setNotice] = useState<string>();
  const { data: subjects = [], error } = useQuery({
    queryKey: ["likeness-subjects", props.project.id],
    queryFn: () => client.likenessSubjects.list(props.project.id),
  });
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["likeness-subjects", props.project.id],
    });
  const create = async () => {
    if (!displayName.trim()) return;
    try {
      await client.likenessSubjects.create(props.project.id, {
        displayName: displayName.trim(),
        relationship,
        ageBand,
      });
      setDisplayName("");
      setNotice("人物已建立；请逐人确认用途和有效期后再附加照片。");
      void refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const confirmConsent = async (subject: (typeof subjects)[number]) => {
    try {
      await client.likenessSubjects.consent(subject.id, {
        purposeScopes: ["本项目故事、分镜与人工确认的参考图生成"],
        validUntil: new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString(),
        participantConfirmed: true,
        ...(subject.ageBand !== "adult" ? { guardianConfirmed: true } : {}),
        ...(subject.ageBand === "under_14"
          ? { under14SeparateConsentConfirmed: true }
          : {}),
      });
      setNotice("授权状态已记录。授权证明正文不会写入项目数据库或项目包。");
      void refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const attachPhoto = async (subject: (typeof subjects)[number]) => {
    try {
      const files = await client.host.pickFiles({
        multiple: false,
        extensions: ["png", "jpg", "jpeg", "webp"],
      });
      const file = files?.[0];
      if (!file) return;
      await client.likenessSubjects.attachPhoto(subject.id, file.grantId);
      setNotice(
        "照片已由 Desktop Host 重编码、清除 EXIF 并保存为不透明媒体引用。",
      );
      void refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-brand/30 bg-brand-soft/50 p-5 text-sm leading-6 text-muted">
        照片只经短期文件授权进入 Desktop
        Host；运行时、项目包、日志和诊断中只保存不透明引用、摘要和校验值。撤回授权会删除
        Host 受控副本并阻止新的参考图生成。
      </div>
      <div className="grid gap-3 rounded-xl border border-line bg-surface p-4 md:grid-cols-4">
        <Input
          placeholder="人物名称"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <select
          className="rounded-md border border-line bg-surface px-3 text-sm"
          value={relationship}
          onChange={(event) => {
            const next = event.target.value as typeof relationship;
            setRelationship(next);
            setAgeBand(next === "minor" ? "minor_14_to_17" : "adult");
          }}
        >
          <option value="self">本人</option>
          <option value="adult_relative_or_friend">成年亲友</option>
          <option value="minor">未成年人</option>
        </select>
        <select
          className="rounded-md border border-line bg-surface px-3 text-sm"
          disabled={relationship !== "minor"}
          value={ageBand}
          onChange={(event) => setAgeBand(event.target.value as typeof ageBand)}
        >
          <option value="adult">成年人</option>
          <option value="minor_14_to_17">14–17 岁</option>
          <option value="under_14">未满 14 岁</option>
        </select>
        <Button onClick={() => void create()}>添加人物</Button>
      </div>
      {notice && (
        <InlineNotice tone={notice.includes("错误") ? "danger" : "info"}>
          {notice}
        </InlineNotice>
      )}
      {error && <InlineNotice tone="danger">{message(error)}</InlineNotice>}
      <div className="space-y-2">
        {subjects.map((subject) => (
          <article
            key={subject.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-4"
          >
            <div className="min-w-40 flex-1">
              <p className="font-medium">{subject.displayName}</p>
              <p className="text-xs text-muted">
                {subject.relationship} · {subject.ageBand} · 授权：
                {subject.consentStatus}
              </p>
            </div>
            {subject.consentStatus !== "active" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void confirmConsent(subject)}
              >
                确认授权
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={subject.consentStatus !== "active"}
              onClick={() => void attachPhoto(subject)}
            >
              附加照片
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={subject.consentStatus === "revoked"}
              onClick={() =>
                void client.likenessSubjects
                  .revoke(subject.id)
                  .then(() => void refresh())
                  .catch((cause) => setNotice(message(cause)))
              }
            >
              撤回授权
            </Button>
          </article>
        ))}
        {!subjects.length && (
          <EmptyState
            title="先添加小剧场人物"
            description="每位人物都必须独立授权；所有未成年人均需监护人确认，未满14岁还需要单独确认。"
          />
        )}
      </div>
    </section>
  );
}

function CreatorChannelToolPanel(props: { project: Project }) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [profileTitle, setProfileTitle] = useState("");
  const [ideaTitle, setIdeaTitle] = useState("");
  const [researchTitle, setResearchTitle] = useState("");
  const [notice, setNotice] = useState<string>();
  const { data: profiles = { items: [] } } = useQuery({
    queryKey: ["creator-profiles", props.project.id],
    queryFn: () => client.creatorContent.list("profile", props.project.id),
  });
  const { data: ideas = { items: [] } } = useQuery({
    queryKey: ["creator-ideas", props.project.id],
    queryFn: () => client.creatorContent.list("idea", props.project.id),
  });
  const { data: topics = { items: [] } } = useQuery({
    queryKey: ["research-topics", props.project.id],
    queryFn: () => client.research.listTopics(props.project.id),
  });
  const refresh = () =>
    queryClient
      .invalidateQueries({ queryKey: ["creator-profiles", props.project.id] })
      .then(() =>
        queryClient.invalidateQueries({
          queryKey: ["creator-ideas", props.project.id],
        }),
      )
      .then(() =>
        queryClient.invalidateQueries({
          queryKey: ["research-topics", props.project.id],
        }),
      );
  const add = async (kind: "profile" | "idea", title: string) => {
    if (!title.trim()) return;
    try {
      await client.creatorContent.create(kind, {
        projectId: props.project.id,
        title: title.trim(),
        payload: {},
      });
      if (kind === "profile") setProfileTitle("");
      else setIdeaTitle("");
      void refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const research = async () => {
    if (!researchTitle.trim()) return;
    try {
      const topic = await client.research.createTopic(props.project.id, {
        title: researchTitle.trim(),
        query: researchTitle.trim(),
        riskDomain:
          props.project.modeConfig.mode === "creator_channel"
            ? props.project.modeConfig.riskDomain
            : "general",
      });
      const results = await client.research.search(topic.id);
      setResearchTitle("");
      setNotice(
        results.fallbackUsed
          ? "DuckDuckGo 不可用，已展示免账号降级来源及覆盖范围。"
          : "已保存零账号公开网页检索结果；请人工采用来源后再写入关键事实。",
      );
      void refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-brand/30 bg-brand-soft/50 p-5 text-sm leading-6 text-muted">
        内容工作室不保存平台账号密码，也不会自动发布。财经、健康、法律等高风险主题的关键事实需要已采用来源、数据日期和检索时间；事实、引述、推测和博主观点会分开保存。
      </div>
      <div className="grid gap-3 rounded-xl border border-line bg-surface p-4 md:grid-cols-[1fr_auto]">
        <Input
          value={profileTitle}
          placeholder="账号定位，例如：面向新手的宏观财经解读"
          onChange={(event) => setProfileTitle(event.target.value)}
        />
        <Button onClick={() => void add("profile", profileTitle)}>
          保存定位
        </Button>
      </div>
      <div className="grid gap-3 rounded-xl border border-line bg-surface p-4 md:grid-cols-[1fr_auto]">
        <Input
          value={ideaTitle}
          placeholder="新增内容选题"
          onChange={(event) => setIdeaTitle(event.target.value)}
        />
        <Button onClick={() => void add("idea", ideaTitle)}>保存选题</Button>
      </div>
      <div className="grid gap-3 rounded-xl border border-line bg-surface p-4 md:grid-cols-[1fr_auto]">
        <Input
          value={researchTitle}
          placeholder="检索公开资料（无需账号或密钥）"
          onChange={(event) => setResearchTitle(event.target.value)}
        />
        <Button variant="secondary" onClick={() => void research()}>
          开始研究
        </Button>
      </div>
      {notice && <InlineNotice tone="info">{notice}</InlineNotice>}
      <div className="grid gap-4 md:grid-cols-3">
        <article className="rounded-xl border border-line p-4">
          <p className="text-xs text-muted">账号定位</p>
          <p className="mt-2 font-medium">
            {profiles.items.map((item) => item.title).join("、") || "待建立"}
          </p>
        </article>
        <article className="rounded-xl border border-line p-4">
          <p className="text-xs text-muted">选题库</p>
          <p className="mt-2 font-medium">{ideas.items.length} 个选题</p>
        </article>
        <article className="rounded-xl border border-line p-4">
          <p className="text-xs text-muted">研究专题</p>
          <p className="mt-2 font-medium">{topics.items.length} 个专题</p>
        </article>
      </div>
    </section>
  );
}

export function ProjectWorkspace() {
  const client = useStudio();
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project>();
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [error, setError] = useState<string>();
  const [novelSection, setNovelSection] = useState<
    "settings" | "characters" | "outlines" | "chapters" | "story-bible" | "more"
  >("chapters");
  const [exporting, setExporting] = useState<
    | "markdown"
    | "submission-markdown"
    | "submission-json"
    | "json"
    | "script"
    | "storyboard"
    | "delivery"
  >();
  const [exportNotice, setExportNotice] = useState<string>();
  const active = chapters.find((item) => item.id === activeId) ?? chapters[0];
  const load = async (): Promise<void> => {
    if (!projectId) return;
    try {
      const [p, c] = await Promise.all([
        client.projects.get(projectId),
        client.chapters.list(projectId),
      ]);
      setProject(p);
      setChapters(c);
      setActiveId((current) => {
        const remembered = window.localStorage.getItem(
          `dramaip-novel-last-chapter:${projectId}`,
        );
        if (current && c.some((item) => item.id === current)) return current;
        if (remembered && c.some((item) => item.id === remembered))
          return remembered;
        return c[0]?.id;
      });
    } catch (cause) {
      setError(message(cause));
    }
  };
  useEffect(() => {
    void load();
  }, [client, projectId]);
  const selectChapter = (chapterId: string): void => {
    setActiveId(chapterId);
    if (projectId)
      window.localStorage.setItem(
        `dramaip-novel-last-chapter:${projectId}`,
        chapterId,
      );
  };
  const addChapter = async (): Promise<Chapter | undefined> => {
    if (!projectId) return undefined;
    try {
      const created = await client.chapters.create({
        projectId,
        title: `第 ${chapters.length + 1} 章`,
        summary: "",
        content: "",
      });
      setChapters((items) => [...items, created]);
      selectChapter(created.id);
      return created;
    } catch (cause) {
      setError(message(cause));
      return undefined;
    }
  };
  const updateChapterById = async (
    chapterId: string,
    patch: Partial<EditableChapter>,
    baseVersion: number,
  ): Promise<Chapter> => {
    try {
      const updated = await client.chapters.update(chapterId, {
        ...patch,
        version: baseVersion,
      });
      setChapters((items) =>
        items.map((item) => (item.id === updated.id ? updated : item)),
      );
      return updated;
    } catch (cause) {
      setError(message(cause));
      await load();
      throw cause;
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
    } catch (cause) {
      setError(message(cause));
      load();
    }
  };
  const reorderChapters = async (chapterIds: string[]): Promise<void> => {
    if (!projectId) return;
    try {
      const updated = await client.chapters.reorder(projectId, { chapterIds });
      setChapters(updated);
    } catch (cause) {
      setError(message(cause));
      await load();
    }
  };
  const removeChapter = async (chapter: Chapter) => {
    if (
      !(await confirmDialog(`确定删除「${chapter.title}」吗？此操作无法撤销。`))
    )
      return;
    try {
      await client.chapters.remove(chapter.id);
      const next = chapters.filter((item) => item.id !== chapter.id);
      setChapters(next);
      if (activeId === chapter.id && next[0]) selectChapter(next[0].id);
    } catch (cause) {
      setError(message(cause));
      load();
    }
  };
  const exportProject = async (
    format:
      | "markdown"
      | "submission-markdown"
      | "submission-json"
      | "json"
      | "script"
      | "storyboard"
      | "delivery",
  ) => {
    if (!project) return;
    setExporting(format);
    setExportNotice(undefined);
    try {
      const document = await client.exports.project(project.id, format);
      const result = await client.host.saveTextFile({
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
  if (!project) return <LoadingState label="正在加载项目…" />;
  const modeGuide = {
    series_longform: {
      title: "系列长篇工作台",
      detail:
        "母本写作 → 故事圣经 → 分季改编 → 制作 → 审核交付。章节变更会提示关联季重新核对。",
      action: "开始母本写作",
    },
    single_season: {
      title: "单季短剧工作台",
      detail:
        "小说、已授权原著和直接剧本都会汇入同一套季纲、分集、剧本、场景与分镜结构；80 集只是建议值。",
      action: "整理本季结构",
    },
    personal_theater: {
      title: "我的 AI 小剧场",
      detail:
        "先以短期文件授权导入本人或亲友照片，并逐人记录肖像授权；未完成授权时不能将照片交给生成服务商。",
      action: "管理人物与授权",
    },
    creator_channel: {
      title: "博主内容工作室",
      detail:
        "围绕一个主题持续管理账号定位、栏目、选题、研究、主稿、多平台变体、内容日历与复盘，不保存平台密码，也不自动发布。",
      action: "创建首个选题",
    },
  }[project.mode];
  const novelSections = [
    ["chapters", "正文"],
    ["outlines", "大纲"],
    ["characters", "人物"],
    ["settings", "设定"],
    ["story-bible", "故事圣经"],
    ["more", "长篇工具"],
  ] as const;
  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-[620px] flex-col overflow-hidden bg-canvas">
      <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-line bg-surface px-3 shadow-control lg:px-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/write")}>
          ← 小说
        </Button>
        <div className="min-w-0 shrink-0">
          <h1 className="max-w-40 truncate text-sm font-semibold lg:max-w-56">
            {project.title}
          </h1>
          <p className="text-[11px] text-muted">{chapters.length} 章</p>
        </div>
        <nav
          className="studio-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
          aria-label="小说创作入口"
        >
          {novelSections.map(([value, label]) => (
            <BareButton
              key={value}
              className={`shrink-0 rounded-md px-2.5 py-2 text-sm transition ${novelSection === value ? "bg-brand-soft font-medium text-brand-strong" : "text-muted hover:bg-surface-muted hover:text-ink"}`}
              onClick={() => setNovelSection(value)}
            >
              {label}
            </BareButton>
          ))}
        </nav>
        <Link
          className="hidden shrink-0 rounded-md px-2.5 py-2 text-sm text-muted hover:bg-surface-muted hover:text-ink lg:block"
          to={`/projects/${project.id}/tools`}
        >
          项目工具
        </Link>
        <DropdownMenu>
          <DropdownMenu.Trigger asChild>
            <Button variant="secondary" size="sm">
              输入输出
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end" className="w-56">
            <DropdownMenu.Item
              onSelect={() => navigate(`/projects/${project.id}/tools/import`)}
            >
              导入原著或剧本
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => navigate(`/projects/${project.id}/tools`)}
            >
              打开项目工具
            </DropdownMenu.Item>
            {(
              [
                ["markdown", "导出完整小说文档"],
                ["submission-markdown", "导出投稿包文档"],
                ["submission-json", "导出投稿包数据"],
                ["json", "导出完整项目包"],
                ["script", "导出剧本资料"],
                ["storyboard", "导出分镜资料"],
                ["delivery", "导出投稿与交付包"],
              ] as const
            ).map(([format, label]) => (
              <DropdownMenu.Item
                key={format}
                disabled={Boolean(exporting)}
                onSelect={() => void exportProject(format)}
              >
                {exporting === format ? "正在导出…" : label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu>
      </header>
      {(error || exportNotice) && (
        <div className="shrink-0 space-y-1 border-b border-line bg-surface px-3 py-2">
          {error && <InlineNotice tone="danger">{error}</InlineNotice>}
          {exportNotice && (
            <InlineNotice tone="success">{exportNotice}</InlineNotice>
          )}
        </div>
      )}
      <section className="shrink-0 border-b border-line bg-surface-raised px-4 py-3 lg:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-rust">
            {projectModeLabel(project.mode)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{modeGuide.title}</p>
            <p className="mt-0.5 text-xs leading-5 text-muted">
              {modeGuide.detail}
            </p>
          </div>
          <Link
            className="shrink-0 text-sm font-medium text-brand hover:text-brand-strong"
            to={`/projects/${project.id}/tools`}
          >
            {modeGuide.action} →
          </Link>
        </div>
      </section>
      {novelSection === "chapters" ? (
        <div className="min-h-0 flex-1 p-2 lg:p-3">
          <NovelChapterWorkspace
            client={client}
            projectId={project.id}
            chapters={chapters}
            activeChapter={active}
            onSelectChapter={selectChapter}
            onCreateChapter={addChapter}
            onSaveChapter={updateChapterById}
            onRemoveChapter={removeChapter}
            onReorderChapters={reorderChapters}
            onReload={load}
            renderStoryBibleSidecar={({ chapter, content }) => (
              <StoryBibleSidecar
                embedded
                projectId={project.id}
                context={{
                  kind: "chapter",
                  id: chapter.id,
                  title: chapter.title,
                  content,
                  version: chapter.version,
                }}
              />
            )}
          />
        </div>
      ) : (
        <div className="studio-scrollbar min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="mx-auto max-w-6xl space-y-5">
            {novelSection === "settings" && (
              <div className="space-y-4">
                <section className="studio-card p-6">
                  <div>
                    <h2 className="text-xl font-semibold">
                      一句话完成项目设定
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-muted">
                      像旧版一样输入一个想法即可生成题材钩子、故事梗概、情绪主轴、创作规范和视觉方向；结果确认后才写入。
                    </p>
                  </div>
                  <NovelArtifactGenerator
                    client={client}
                    projectId={project.id}
                    taskType="generate_project"
                    title="智能补全项目设定"
                    description="可以只写一句话，也可以补充目标读者、题材偏好和不希望出现的内容。"
                    onCommitted={load}
                  />
                </section>
                <ProjectSettingsEditor
                  project={project}
                  onSave={updateProject}
                />
              </div>
            )}
            {novelSection === "characters" && (
              <NovelCharactersSection client={client} projectId={project.id} />
            )}
            {novelSection === "outlines" && (
              <NovelOutlineSection client={client} projectId={project.id} />
            )}
            {novelSection === "story-bible" && (
              <StoryBibleChangeSetPanel projectId={project.id} />
            )}
            {novelSection === "more" && (
              <div className="space-y-5">
                <NovelLongformToolsSection
                  client={client}
                  projectId={project.id}
                  chapters={chapters}
                />
                <ContentVersionPanel projectId={project.id} onRestored={load} />
                <ProjectActivityPanel projectId={project.id} />
                <ChapterAnalysisPanel />
                <CreativeDiagnosticsPanel />
                <PluginResourceWorkspace
                  owner="automation"
                  title="项目技能、灵感与模板"
                  projectId={project.id}
                  domains={[
                    "project-skills",
                    "agent-schemes",
                    "inspirations",
                    "templates",
                  ]}
                />
                <PluginResourceWorkspace
                  owner="knowledge"
                  title="视觉设定"
                  projectId={project.id}
                  domains={["visual-settings"]}
                />
                <PluginResourceWorkspace
                  owner="creative-quality"
                  title="创意质量"
                  projectId={project.id}
                  domains={[
                    "beats",
                    "highlights",
                    "feasibility",
                    "trends",
                    "evaluations",
                  ]}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ProjectCockpitPanel(props: {
  project: Project;
  chapters: Chapter[];
}) {
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
        className="rounded-xl border border-line bg-surface p-5 text-sm text-muted"
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
      className="rounded-xl border border-brand/30 bg-gradient-to-br from-brand-soft/50 to-surface p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-brand">项目驾驶舱</p>
          <h2 className="mt-1 text-xl font-semibold">{cockpit.statusLabel}</h2>
          <p className="mt-1 text-sm text-muted">{cockpit.recentResult}</p>
        </div>
        <span className="rounded-full bg-surface-raised px-3 py-1 text-xs text-brand">
          {cockpit.status}
        </span>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <article className="rounded-xl border border-brand/20 bg-surface-raised p-4">
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
        <div className="rounded-xl border border-line bg-surface-raised p-4">
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
            className="rounded-lg border border-line bg-surface-raised p-3 transition hover:border-brand"
          >
            <p className="font-medium">{zone.label}</p>
            <p className="mt-1 text-xs text-muted">{zone.detail}</p>
          </Link>
        ))}
      </nav>
    </section>
  );
}

export const PILOT_STAGE_LABELS: Record<PilotPlan["stage"], string> = {
  "confirm-source": "确认试制来源",
  script: "采用试制剧本",
  scenes: "拆分制作场景",
  shots: "建立试制分镜",
  assets: "整理试制资产",
  review: "进入人工审核",
};

export function SeriesLibraryPanel(props: {
  project: Project;
  onProjectChanged(project: Project): void;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const { data: series = [] } = useQuery({
    queryKey: ["series"],
    queryFn: client.series.list,
  });
  const { data: library } = useQuery<SeriesLibrary>({
    queryKey: ["series-library", props.project.id],
    queryFn: () => client.series.library(props.project.id),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const [newSeriesTitle, setNewSeriesTitle] = useState("");
  const [settingTitle, setSettingTitle] = useState("");
  const [settingJson, setSettingJson] = useState('{"说明":"待补充"}');
  const [sourceProjectId, setSourceProjectId] = useState(props.project.id);
  const { data: sourceAssets = [] } = useQuery({
    queryKey: ["series-source-assets", sourceProjectId],
    queryFn: () => client.resources.list("visual-assets", sourceProjectId),
  });
  const [sourceAssetId, setSourceAssetId] = useState("");
  const [notice, setNotice] = useState<string>();
  const [working, setWorking] = useState(false);
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["series"] }),
      queryClient.invalidateQueries({
        queryKey: ["series-library", props.project.id],
      }),
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({
        queryKey: ["series-source-assets", sourceProjectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["asset-center", props.project.id],
      }),
    ]);
  };
  const joinSeries = async (seriesId?: string) => {
    setWorking(true);
    try {
      const updated = await client.series.setProjectSeries(
        props.project.id,
        seriesId ? { seriesId } : {},
      );
      props.onProjectChanged(updated);
      setNotice(
        seriesId
          ? "项目已加入系列；既有项目资料不会被自动迁移。"
          : "项目已解除系列归属；项目内版本保持不变。",
      );
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const createSeries = async () => {
    const title = newSeriesTitle.trim();
    if (!title) return setNotice("请填写系列名称。");
    setWorking(true);
    try {
      const created = await client.series.create({ title });
      await joinSeries(created.id);
      setNewSeriesTitle("");
      setNotice(`已创建并加入「${created.title}」。`);
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const createSetting = async () => {
    if (!library?.series) return;
    let payload: unknown;
    try {
      payload = JSON.parse(settingJson);
    } catch {
      return setNotice("系列设定必须是合法 JSON 对象。");
    }
    if (
      !settingTitle.trim() ||
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload)
    )
      return setNotice("请填写设定标题和 JSON 对象。");
    setWorking(true);
    try {
      const created = await client.series.createStoryBible(library.series.id, {
        title: settingTitle.trim(),
        payload,
      });
      await client.series.upgradeStoryBible(props.project.id, created.id, {
        sourceVersion: created.version,
      });
      setSettingTitle("");
      setNotice("系列故事圣经已新增；项目可以选择性覆写。 ");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const overrideSetting = async (
    setting: SeriesLibrary["storyBible"][number],
  ) => {
    setWorking(true);
    try {
      await client.series.overrideStoryBible(props.project.id, setting.id, {
        title: setting.title,
        payload: setting.payload,
        sourceVersion: setting.sourceVersion,
      });
      setNotice("已建立项目覆写快照；后续系列更新不会静默覆盖它。 ");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const transfer = async (mode: "copy" | "fork" | "link") => {
    const asset = sourceAssets.find((item) => item.id === sourceAssetId);
    if (!asset) return setNotice("请选择已锁定、权利已核验的源资产版本。");
    setWorking(true);
    try {
      await client.series.transferAsset(props.project.id, {
        sourceAssetId: asset.id,
        sourceVersion: asset.version,
        mode,
      });
      setNotice(
        mode === "link"
          ? "已建立不可变版本链接；源资产后续更新不会改变这个项目。"
          : mode === "fork"
            ? "已建立可独立修改的 Fork。"
            : "已建立独立副本。",
      );
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  return (
    <section
      className="rounded-xl border border-line bg-panel p-4 space-y-4"
      data-testid="series-library"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">系列资产库</h2>
          <p className="mt-1 text-sm text-muted">
            共享只通过明确版本进入项目：Link 不可变，Copy 和 Fork
            保持项目内独立；不会连接云端或复制媒体二进制。
          </p>
        </div>
        <select
          aria-label="项目所属系列"
          className="rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm"
          value={library?.series?.id ?? ""}
          disabled={working}
          onChange={(event) => void joinSeries(event.target.value || undefined)}
        >
          <option value="">不加入系列</option>
          {series.map((item: Series) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </div>
      {!library?.series ? (
        <div className="flex flex-wrap gap-2">
          <input
            aria-label="新系列名称"
            className="min-w-52 flex-1 rounded-lg border border-line bg-canvas px-3 py-2 text-sm"
            placeholder="例如：雨城宇宙"
            value={newSeriesTitle}
            onChange={(event) => setNewSeriesTitle(event.target.value)}
          />
          <BareButton
            className="rounded-lg bg-brand px-3 py-2 text-sm text-white disabled:opacity-50"
            disabled={working}
            onClick={() => void createSeries()}
          >
            新建系列并加入
          </BareButton>
        </div>
      ) : (
        <>
          <div className="rounded-lg bg-canvas p-3 text-sm">
            <span className="font-medium">
              当前系列：{library.series.title}
            </span>
            <span className="ml-2 text-muted">
              v{library.series.version} · 项目覆写与导入版本均需人工升级。
            </span>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-2 rounded-lg border border-line p-3">
              <p className="text-sm font-medium">系列故事圣经</p>
              {library.storyBible.length ? (
                library.storyBible.map((setting) => (
                  <div
                    key={setting.id}
                    className="rounded-md border border-line bg-canvas p-2 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span>{setting.title}</span>
                      <BareButton
                        className="text-brand disabled:opacity-50"
                        disabled={working || setting.overridden}
                        onClick={() => void overrideSetting(setting)}
                      >
                        {setting.overridden ? "项目已覆写" : "建立项目覆写"}
                      </BareButton>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      来源 v{setting.sourceVersion}
                      {setting.overridden
                        ? "；当前使用本项目快照"
                        : "；继承系列版本"}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted">尚无系列设定。</p>
              )}
              <div className="grid gap-2 pt-1">
                <input
                  aria-label="系列设定标题"
                  className="rounded-md border border-line bg-canvas px-2 py-1.5 text-sm"
                  placeholder="设定标题"
                  value={settingTitle}
                  onChange={(event) => setSettingTitle(event.target.value)}
                />
                <textarea
                  aria-label="系列设定 JSON"
                  className="min-h-16 rounded-md border border-line bg-canvas px-2 py-1.5 font-mono text-xs"
                  value={settingJson}
                  onChange={(event) => setSettingJson(event.target.value)}
                />
                <BareButton
                  className="w-fit rounded-md border border-line px-2 py-1 text-sm text-brand disabled:opacity-50"
                  disabled={working}
                  onClick={() => void createSetting()}
                >
                  新增系列设定
                </BareButton>
              </div>
            </div>
            <div className="space-y-2 rounded-lg border border-line p-3">
              <p className="text-sm font-medium">从同系列项目导入锁定版本</p>
              <select
                aria-label="源项目"
                className="w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-sm"
                value={sourceProjectId}
                onChange={(event) => {
                  setSourceProjectId(event.target.value);
                  setSourceAssetId("");
                }}
              >
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                    {item.seriesId === library.series?.id
                      ? ""
                      : "（非当前系列）"}
                  </option>
                ))}
              </select>
              <select
                aria-label="源资产版本"
                className="w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-sm"
                value={sourceAssetId}
                onChange={(event) => setSourceAssetId(event.target.value)}
              >
                <option value="">选择资产版本</option>
                {sourceAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.title} · v{asset.version}
                  </option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2">
                <BareButton
                  className="rounded-md border border-line px-2 py-1 text-sm disabled:opacity-50"
                  disabled={working}
                  onClick={() => void transfer("copy")}
                >
                  Copy 独立副本
                </BareButton>
                <BareButton
                  className="rounded-md border border-line px-2 py-1 text-sm disabled:opacity-50"
                  disabled={working}
                  onClick={() => void transfer("fork")}
                >
                  Fork 可编辑
                </BareButton>
                <BareButton
                  className="rounded-md bg-brand px-2 py-1 text-sm text-white disabled:opacity-50"
                  disabled={working}
                  onClick={() => void transfer("link")}
                >
                  Link 固定版本
                </BareButton>
              </div>
              {library.assets.length ? (
                <div className="pt-1 text-xs text-muted">
                  已导入：
                  {library.assets
                    .map(
                      (asset) =>
                        `${asset.mode} · 源版本 v${asset.sourceVersion}`,
                    )
                    .join("；")}
                </div>
              ) : (
                <p className="text-sm text-muted">还没有导入系列资产。</p>
              )}
            </div>
          </div>
        </>
      )}
      {notice && (
        <p className="rounded-md bg-brand-soft px-3 py-2 text-sm text-brand">
          {notice}
        </p>
      )}
    </section>
  );
}

export function ProjectPilotPanel(props: {
  project: Project;
  chapters: Chapter[];
}) {
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
      className="rounded-xl border border-line bg-surface p-5"
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
                className="flex items-center gap-2 rounded-lg bg-surface-raised p-2 text-sm"
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
              className="rounded-lg border border-line bg-surface-raised px-3 py-2"
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
          <BareButton
            className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={working || !props.chapters.length}
            onClick={() => void create()}
          >
            建立试制计划
          </BareButton>
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
                  <BareButton
                    className="rounded-md bg-brand px-3 py-1.5 text-xs text-white disabled:opacity-50"
                    disabled={working}
                    onClick={() => void act(active, "confirm-source")}
                  >
                    确认来源并创建试制分集
                  </BareButton>
                )}
              {active.status === "canceled" && (
                <BareButton
                  className="rounded-md border border-line px-3 py-1.5 text-xs text-brand"
                  disabled={working}
                  onClick={() => void act(active, "resume")}
                >
                  恢复试制
                </BareButton>
              )}
              {active.status === "stale" && (
                <BareButton
                  className="rounded-md border border-line px-3 py-1.5 text-xs text-brand"
                  disabled={working}
                  onClick={() => void act(active, "resume")}
                >
                  按当前来源重新开始
                </BareButton>
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
                <BareButton
                  className="rounded-md border border-line px-3 py-1.5 text-xs text-muted"
                  disabled={working}
                  onClick={() => void act(active, "return-source")}
                >
                  退回来源
                </BareButton>
              )}
              {active.status !== "canceled" && (
                <BareButton
                  className="rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-600"
                  disabled={working}
                  onClick={() => void act(active, "cancel")}
                >
                  取消试制
                </BareButton>
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

export function ProjectSettingsEditor(props: {
  project: Project;
  onSave(input: EditableProject): Promise<void>;
}) {
  const makeDraft = (project: Project): Record<string, string> => ({
    title: project.title,
    shortDramaType: project.shortDramaType ?? "未分类",
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
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">项目设定</h2>
          <p className="mt-1 text-sm text-muted">
            故事、改编和制作环节会以这些设定作为共同上下文。
          </p>
        </div>
        <BareButton
          className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={
            saving || !draft.title.trim() || !draft.shortDramaType.trim()
          }
          onClick={() => void submit()}
        >
          {saving ? "保存中…" : "保存项目设定"}
        </BareButton>
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

export function SourceImportPanel(props: {
  projectId: string;
  initialOpen?: boolean;
  onImported(): void;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
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
      const selected = await client.host.pickFiles({
        multiple: false,
        extensions: ["txt", "md", "markdown", "docx", "epub", "json"],
      });
      const file = selected?.[0];
      if (!file) return;
      if (importId) await client.sourceImports.discard(importId);
      const result = await client.sourceImports.preview({
        projectId: props.projectId,
        capabilityToken: file.grantId,
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
      await queryClient.invalidateQueries({
        queryKey: ["import-extractions", props.projectId],
      });
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
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">导入小说原稿或漫剧剧本</h2>
          <p className="mt-1 text-sm text-muted">
            支持文本、Markdown、Word、EPUB
            与结构化剧本数据。先预览，确认后才写入；原文件只读且不会上传。
          </p>
        </div>
        <BareButton
          className="rounded-lg border border-line px-3 py-2 text-sm text-brand disabled:opacity-50"
          disabled={working}
          onClick={() => (open ? close() : setOpen(true))}
        >
          {open ? "收起导入" : "导入内容"}
        </BareButton>
      </div>
      {open && (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          {!preview ? (
            <div className="rounded-xl border border-dashed border-line p-5 text-center">
              <p className="font-medium">选择拥有授权的内容文件</p>
              <p className="mt-1 text-xs text-muted">
                不支持绕过数字版权保护、OCR 识别受限内容或从网络抓取付费内容。
              </p>
              <BareButton
                className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={working}
                onClick={() => void choose()}
              >
                {working ? "正在解析…" : "选择文件并解析"}
              </BareButton>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-brand-soft/40 p-3 text-sm">
                <span className="font-medium">{preview.fileName}</span>
                <span className="rounded-full bg-surface-raised px-2 py-1 text-xs text-brand">
                  {sourceTypeLabel(preview.sourceType)}
                </span>
                <span className="text-xs text-muted">
                  {preview.contentKind === "script"
                    ? `识别 ${preview.episodes.length} 集、${preview.episodes.reduce((count, episode) => count + episode.scenes.length, 0)} 个场景`
                    : `识别 ${preview.chapters.length} 个${preview.contentKind === "novel" ? "章节" : "草稿段落"}`}
                  {" · "}
                  {preview.charCount.toLocaleString("zh-CN")} 字符
                </span>
                <BareButton
                  className="ml-auto rounded-md border border-line bg-surface-raised px-2 py-1 text-xs text-brand disabled:opacity-50"
                  disabled={working}
                  onClick={() => void choose()}
                >
                  重新选择
                </BareButton>
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
                      <BareButton
                        key={chapter.key}
                        className={`block w-full rounded-lg px-2 py-2 text-left text-xs ${index === selectedChapter ? "bg-brand text-white" : "hover:bg-brand-soft"}`}
                        onClick={() => setSelectedChapter(index)}
                      >
                        <span className="block truncate">{chapter.title}</span>
                        <span className="opacity-70">
                          {chapter.wordCount.toLocaleString("zh-CN")} 字
                        </span>
                      </BareButton>
                    ))}
                    <BareButton
                      className="mt-2 w-full rounded-md border border-line px-2 py-1 text-xs text-brand"
                      onClick={addChapter}
                    >
                      新增章节
                    </BareButton>
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
                        <BareButton
                          className="rounded-lg border border-red-200 px-2 text-xs text-red-600 disabled:opacity-50"
                          disabled={preview.chapters.length <= 1}
                          onClick={removeChapter}
                        >
                          删除
                        </BareButton>
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
                    className="rounded-lg border border-line bg-surface-raised px-2 py-1"
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
                <BareButton
                  className="rounded-lg border border-line px-3 py-2 text-sm text-muted"
                  onClick={close}
                >
                  取消
                </BareButton>
                <BareButton
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={!canCommit}
                  onClick={() => void commit()}
                >
                  {working ? "正在导入…" : "确认导入"}
                </BareButton>
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

export const IMPORT_EXTRACTION_STATUS_LABELS: Record<string, string> = {
  draft: "待审查",
  applied: "已部分/全部采用",
  stale: "来源已更新",
  discarded: "已撤销",
  failed: "整理失败",
  rejected: "未采用",
  adopted: "已采用",
  conflict: "需人工处理",
};
export const IMPORT_EXTRACTION_TYPE_LABELS: Record<string, string> = {
  character: "人物",
  scene: "场景",
  prop: "道具",
  "chapter-summary": "章节摘要",
  adaptation: "改编建议",
};

export function ImportExtractionReviewPanel(props: {
  projectId: string;
  onChanged(): void;
  showEmpty?: boolean;
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
      !(await confirmDialog(
        `将采用 ${ids.length} 条已选候选。系统会在一个事务中写入；如检测到人工内容冲突，不会部分采用。确定继续吗？`,
      ))
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
      !(await confirmDialog(
        "撤销只会回退本次采用且未被人工编辑的内容；人工后续修改会被保留。确定继续吗？",
      ))
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
  if (!changeSets.length)
    return props.showEmpty ? (
      <EmptyState
        title="没有待审阅的导入候选"
        description="导入原著后，如果系统提取出人物、场景或改编建议，会在这里等待你确认。"
        action={
          <Button asChild variant="primary">
            <Link to={`/projects/${props.projectId}/tools/import`}>
              导入内容
            </Link>
          </Button>
        }
      />
    ) : null;
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
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
                      <BareButton
                        className="rounded-md bg-brand px-3 py-1.5 text-xs text-white disabled:opacity-50"
                        disabled={workingId === changeSet.id}
                        onClick={() => void adopt(changeSet)}
                      >
                        采用已选项目
                      </BareButton>
                    )}
                  {["applied", "stale"].includes(changeSet.status) && (
                    <BareButton
                      className="rounded-md border border-line px-3 py-1.5 text-xs text-brand disabled:opacity-50"
                      disabled={workingId === changeSet.id}
                      onClick={() => void undo(changeSet)}
                    >
                      撤销采用
                    </BareButton>
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
                            <span className="rounded-full bg-surface-raised px-2 py-0.5 text-xs text-brand">
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
                                className="w-full rounded-md border border-line bg-surface-raised px-2 py-1 text-sm"
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
                                className="min-h-20 w-full rounded-md border border-line bg-surface-raised p-2 text-sm"
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
                                <BareButton
                                  className="rounded-md bg-brand px-2 py-1 text-xs text-white disabled:opacity-50"
                                  disabled={workingId === candidate.id}
                                  onClick={() =>
                                    void saveEdit(changeSet.id, candidate.id)
                                  }
                                >
                                  保存
                                </BareButton>
                                <BareButton
                                  className="rounded-md border border-line px-2 py-1 text-xs text-muted"
                                  onClick={() => setEditingId(undefined)}
                                >
                                  取消
                                </BareButton>
                              </>
                            ) : (
                              <BareButton
                                className="rounded-md border border-line px-2 py-1 text-xs text-brand"
                                onClick={() => startEdit(candidate)}
                              >
                                编辑
                              </BareButton>
                            )}
                            {candidate.status === "draft" && (
                              <BareButton
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
                              </BareButton>
                            )}
                            {(candidate.status === "rejected" ||
                              candidate.status === "conflict") && (
                              <BareButton
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
                              </BareButton>
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

export function ProjectActivityPanel(props: { projectId: string }) {
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
    <section className="rounded-xl border border-line bg-surface p-4">
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

export function ContentVersionPanel(props: {
  projectId: string;
  onRestored(): void;
}) {
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
      !(await confirmDialog(
        `恢复「${item.title}」将先保存当前${kind}为新的检查点。确定继续吗？`,
      ))
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
    <section className="rounded-xl border border-line bg-surface p-4">
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
              <BareButton
                className="rounded-md border border-line px-2 py-1 text-xs text-brand"
                onClick={() => void restore(item)}
              >
                恢复此检查点
              </BareButton>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function sourceTypeLabel(
  type: SourceImportPreview["sourceType"],
): string {
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

export const STORY_BIBLE_SIDECAR_DOMAINS = [
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

export function StoryBibleSidecar(props: {
  projectId: string;
  context: StoryBibleContext;
  embedded?: boolean;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [wide, setWide] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [selectedFields, setSelectedFields] = useState<
    Record<string, string[]>
  >({});
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
      await client.resources.update(
        "story-bible-sidecar-preferences",
        preference.id,
        {
          title: preference.title,
          payload,
          version: preference.version,
        },
      );
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
    const fields =
      selectedFields[item.id] ?? item.preview.fields.map((field) => field.key);
    if (!fields.length) {
      setNotice("请至少选择一个待采用字段。");
      return;
    }
    if (
      !(await confirmDialog(
        "采用后只会写入所选的章节记忆字段，不会修改正文。确定采用吗？",
      ))
    )
      return;
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
    if (
      !(await confirmDialog(
        "撤销会删除此变更集创建的章节记忆，不会修改正文。确定撤销吗？",
      ))
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
    const current =
      selectedFields[item.id] ?? item.preview.fields.map((field) => field.key);
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
    .sort(
      (left, right) =>
        Number(pinned.includes(right.id)) - Number(pinned.includes(left.id)),
    );
  const isCollapsed = props.embedded ? false : collapsed;
  return (
    <aside
      className={
        props.embedded
          ? "h-full min-h-0 overflow-y-auto bg-canvas/40 p-3"
          : `border-t border-line bg-canvas/40 p-3 xl:border-l xl:border-t-0 ${collapsed ? "xl:w-14 xl:p-2" : wide ? "xl:w-[26rem]" : "xl:w-80"}`
      }
      aria-label="Story Bible 侧栏"
    >
      <div className="flex items-start justify-between gap-2">
        {!isCollapsed && (
          <div>
            <p className="text-xs text-muted">
              当前{props.context.kind === "chapter" ? "章节" : "剧本"}上下文
            </p>
            <h2 className="text-sm font-semibold">Story Bible</h2>
          </div>
        )}
        {!props.embedded && (
          <div className="flex gap-1">
            {!isCollapsed && (
              <BareButton
                className="rounded-md px-2 py-1 text-xs text-brand hover:bg-brand-soft"
                onClick={() => void updateWide(!wide)}
              >
                {wide ? "窄" : "宽"}
              </BareButton>
            )}
            <BareButton
              className="rounded-md px-2 py-1 text-xs text-brand hover:bg-brand-soft"
              aria-expanded={!isCollapsed}
              onClick={() => void updateCollapsed(!collapsed)}
            >
              {isCollapsed ? "展开" : "折叠"}
            </BareButton>
          </div>
        )}
      </div>
      {!isCollapsed && (
        <>
          <input
            className="mt-3 w-full rounded-md border border-line bg-surface-raised px-2 py-1.5 text-xs"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索人物、伏笔、设定…"
            aria-label="搜索 Story Bible"
          />
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Link className="text-brand underline" to={storyBiblePath}>
              打开完整 Story Bible
            </Link>
            {props.context.kind === "chapter" && (
              <BareButton
                className="text-brand underline"
                onClick={() => void queue()}
              >
                生成变更草案
              </BareButton>
            )}
          </div>
          {notice && (
            <p
              className="mt-3 rounded-md bg-brand-soft p-2 text-xs text-brand"
              role="status"
            >
              {notice}
            </p>
          )}
          {recordsError && (
            <p
              className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900"
              role="alert"
            >
              本地 Story Bible 暂不可读取；正文编辑与保存不受影响。
            </p>
          )}
          {model.staleMarks.length > 0 && (
            <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
              待复核：{model.staleMarks.map((mark) => mark.reason).join("；")}
            </p>
          )}
          <div
            className={`mt-3 space-y-2 pr-1 ${props.embedded ? "" : "max-h-[calc(100vh-15rem)] overflow-y-auto"}`}
            aria-live="polite"
          >
            {visible.map((item) => (
              <article
                key={item.id}
                className="rounded-md border border-line bg-surface-raised p-2 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-muted">
                      {item.group} · {sidecarStateLabel(item.state)}
                    </p>
                    <p className="mt-1 font-medium">{item.title}</p>
                  </div>
                  <BareButton
                    className="text-brand underline"
                    onClick={() => void togglePin(item.id)}
                  >
                    {pinned.includes(item.id) ? "取消固定" : "固定"}
                  </BareButton>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-muted">
                  {item.text}
                </p>
                <p className="mt-1 text-[0.6875rem] text-muted">
                  来源 {item.sourceId.slice(0, 8)}
                  {item.sourceVersion !== undefined
                    ? ` · v${item.sourceVersion}`
                    : ""}{" "}
                  ·{" "}
                  <Link className="text-brand underline" to={storyBiblePath}>
                    查看来源
                  </Link>
                </p>
              </article>
            ))}
            {!visible.length && (
              <p className="rounded-md border border-dashed border-line p-3 text-xs text-muted">
                当前范围没有可关联的 Story Bible 条目。
              </p>
            )}
          </div>
          {model.relevantChangeSets.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-medium">当前章节变更集</p>
              {model.relevantChangeSets.map((item) => (
                <div
                  key={item.id}
                  className="rounded-md border border-line bg-surface-raised p-2 text-xs"
                >
                  <p>{item.summary}</p>
                  <p className="mt-1 text-muted">
                    章节版本 {item.sourceVersion} ·{" "}
                    {sidecarStateLabel(
                      item.status === "draft"
                        ? "suggested"
                        : item.status === "applied"
                          ? "confirmed"
                          : item.status === "stale"
                            ? "stale"
                            : "authoritative",
                    )}
                  </p>
                  {item.conflictNotes.length > 0 && (
                    <p className="mt-1 text-amber-800">
                      冲突：{item.conflictNotes.join("；")}
                    </p>
                  )}
                  {item.status === "draft" && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-brand">
                        查看字段差异并选择采用
                      </summary>
                      <div className="mt-2 space-y-2">
                        {item.preview.fields.map((field) => {
                          const fields =
                            selectedFields[item.id] ??
                            item.preview.fields.map((entry) => entry.key);
                          return (
                            <label key={field.key} className="flex gap-2">
                              <input
                                type="checkbox"
                                checked={fields.includes(field.key)}
                                onChange={() => toggleField(item, field.key)}
                              />
                              <span>
                                <b>{field.key}</b>：{field.value}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </details>
                  )}
                  {item.status === "draft" && (
                    <div className="mt-2 flex gap-2">
                      <BareButton
                        className="text-brand underline"
                        onClick={() => void apply(item)}
                      >
                        采用所选字段
                      </BareButton>
                      <BareButton
                        className="text-muted underline"
                        onClick={() => void setStatus(item, "discarded")}
                      >
                        丢弃
                      </BareButton>
                    </div>
                  )}
                  {["applied", "stale"].includes(item.status) && (
                    <BareButton
                      className="mt-2 text-brand underline"
                      onClick={() => void undo(item)}
                    >
                      撤销采用
                    </BareButton>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </aside>
  );
}

export function sidecarStateLabel(
  state: ReturnType<typeof buildStoryBibleSidecar>["items"][number]["state"],
) {
  return {
    authoritative: "权威事实",
    confirmed: "人工确认",
    suggested: "AI 建议",
    stale: "来源已变化",
  }[state];
}

export function importWarning(value: string): string {
  return /[A-Za-z]{3,}/.test(value)
    ? "导入内容存在需要人工复核的格式或结构问题。"
    : value;
}
