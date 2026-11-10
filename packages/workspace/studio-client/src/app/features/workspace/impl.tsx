import type {
  DomainEntity,
  Project,
  ProjectDerivationPreview,
  ProjectMode,
  ProjectPackagePreview,
  StoryBibleChangeSet,
} from "@dramaip/contracts/product";
import type { SourceImportPreview } from "@dramaip/contracts/workspace";
import {
  BareButton,
  Button,
  DropdownMenu,
  EmptyState,
  IconButton,
  InlineNotice,
  Input,
  Select,
  Textarea,
  showToast,
} from "@dramaip/infra-ui-primitives";
import { confirmDialog } from "../../controls";
import {
  IconRightUpOutlineRegular as ArrowUpRight,
  IconBookOutlineRegular as BookOpenText,
  IconEditOutlineRegular as Feather,
  IconEllipsisOutlineRegular as MoreHorizontal,
  IconPlusOutlineRegular as Plus,
  IconSparkleRegular as Sparkles,
} from "@dramaip/infra-ui-primitives";
import { useQuery, useQueryClient } from "../../query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "../../router";
import {
  deriveProjectCockpit,
  usesNovelWorkflow,
  usesAdaptationWorkflow,
} from "../../project-cockpit";
import { loadNovelCockpitEvidence } from "../../novel-cockpit-evidence";
import { loadAdaptationCockpitEvidence } from "../../adaptation-cockpit-evidence";
import { loadDirectScriptCockpitEvidence } from "../../direct-script-cockpit-evidence";
import { projectProgressReadiness } from "../../project-progress-readiness";
import { NativeScriptIntakePanel } from "./NativeScriptIntakePanel";
import {
  creationDraftWorthRestoring,
  explicitCreationGoal,
  prepareProjectCreationAttempt,
  projectInputForNativeCreation,
} from "../../project-create-binding";
import type { NativeScriptIntakeBinding } from "../../native-script-intake";
import {
  initializeProjectMaterials,
  scriptWorkspacePath,
  ProjectInitializationError,
} from "../../project-creation-coordinator";
import {
  PROJECT_GENRE_CHOICES,
  PROJECT_GENRE_GROUPS,
} from "../../project-genres";
import {
  positiveInteger,
  isDirectScriptProject,
  PROJECT_QUICK_START_OPTIONS,
  PROJECT_SOURCE_OPTIONS,
  projectQuickStart,
  quickStartProjectTitle,
  type ProjectQuickStartKind,
  projectModeBrief,
  projectModeConfigFromDraft,
  projectInputFromBrief,
  recommendedProjectMode,
  type ProductionBriefDraft,
  type ProjectCreationSource,
} from "../../project-intake";
import {
  buildStoryBibleSidecar,
  type StoryBibleContext,
} from "../../story-bible-sidecar";
import {
  EditableProject,
  RecoveryNotice,
  TASK_STATUS_LABELS,
  WorkspaceIntro,
  message,
  useStudio,
} from "../../studio-shared";
import {
  createCreationDraft,
  useStudioSession,
  type CreationDraftV1,
} from "../../studio-session";
import {
  freezeSourceImportAttempt,
  checkSourceImportRecovery,
  restoredSourceImportDraft,
} from "../../source-import-binding";
import { NovelStoryPresetPicker } from "../novel/NovelStoryPresetPicker";
import {
  applyNovelStoryPresetToBrief,
  novelStoryPreset,
  projectInputFromStoryPreset,
  type NovelStoryPresetId,
} from "../novel/story-presets";
import { recordPayload } from "../studio-widgets";
import styles from "./impl.module.css";
import { copyText } from "../../copy";
import { clsx } from "clsx";
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
    <section className={styles.c1}>
      <div className={styles.c2}>
        <div>
          <h2 className={styles.c3}>
            {copyText("app/features/workspace/impl.1")}
          </h2>
          <p className={styles.c4}>
            {copyText("app/features/workspace/impl.2")}
          </p>
        </div>
        <BareButton
          className={styles.c5}
          disabled={working}
          onClick={() => void choose()}
        >
          {working ? "正在读取…" : "选择项目包"}
        </BareButton>
      </div>
      {preview && (
        <div className={styles.c6}>
          <p className={styles.c7}>
            {copyText("app/features/workspace/impl.3")}
            {fileName ?? preview.sourceName}
          </p>
          <div className={styles.c8}>
            <p>
              {copyText("app/features/workspace/impl.4")}
              {preview.projectTitle}
            </p>
            <p>
              {copyText("app/features/workspace/impl.5")}
              {preview.chapterCount}
            </p>
            <p>
              {copyText("app/features/workspace/impl.6")}
              {preview.resourceCount}
            </p>
          </div>
          <label className={styles.c9}>
            {copyText("app/features/workspace/impl.7")}
            <input
              className={styles.c10}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {preview.warnings.map((warning) => (
            <p key={warning} className={styles.c11}>
              {copyText("app/features/workspace/impl.8")}
              {warning}
            </p>
          ))}
          <div className={styles.c12}>
            <BareButton
              className={styles.c13}
              disabled={working}
              onClick={() => void discard()}
            >
              {copyText("app/features/workspace/impl.9")}
            </BareButton>
            <BareButton
              className={styles.c14}
              disabled={working || !title.trim()}
              onClick={() => void commit()}
            >
              {working ? "正在导入…" : "确认创建新项目"}
            </BareButton>
          </div>
        </div>
      )}
      {notice && <p className={styles.c15}>{notice}</p>}
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

type PendingSourceImport = {
  importId: string;
  preview: SourceImportPreview;
  expiresAt: string;
  rightsConfirmed: boolean;
};

function ProjectlessSourceImportEditor(props: {
  value?: PendingSourceImport;
  disabled?: boolean;
  onChange(value: PendingSourceImport | undefined): void;
  onSuggestedTitle(title: string): void;
}) {
  const client = useStudio();
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [selectedChapter, setSelectedChapter] = useState(0);
  const choose = async () => {
    setWorking(true);
    setNotice(undefined);
    try {
      const files = await client.host.pickFiles({
        multiple: false,
        extensions: ["txt", "md", "markdown", "docx", "epub", "json"],
      });
      const file = files?.[0];
      if (!file) return;
      if (props.value) await client.sourceImports.discard(props.value.importId);
      const result = await client.sourceImports.preview({
        capabilityToken: file.grantId,
      });
      props.onChange({
        importId: result.importId,
        preview: result.preview,
        expiresAt: result.expiresAt,
        rightsConfirmed: false,
      });
      props.onSuggestedTitle(result.preview.title);
      setSelectedChapter(0);
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
    const current = props.value;
    if (!current || !current.preview.chapters[selectedChapter]) return;
    const chapters = current.preview.chapters.map((chapter, index) => {
      if (index !== selectedChapter) return chapter;
      const content = patch.content ?? chapter.content;
      return {
        ...chapter,
        ...patch,
        content,
        wordCount: [...content.replace(/\s/gu, "")].length,
      };
    });
    props.onChange({
      ...current,
      preview: { ...current.preview, chapters },
    });
  };
  const addChapter = () => {
    const current = props.value;
    if (!current) return;
    const chapters = [
      ...current.preview.chapters,
      {
        key: `manual-${crypto.randomUUID()}`,
        title: `第${current.preview.chapters.length + 1}章`,
        content: "",
        orderIndex: current.preview.chapters.length,
        wordCount: 0,
      },
    ];
    props.onChange({
      ...current,
      preview: { ...current.preview, chapters },
    });
    setSelectedChapter(chapters.length - 1);
  };
  const removeChapter = () => {
    const current = props.value;
    if (!current || current.preview.chapters.length <= 1) return;
    const chapters = current.preview.chapters
      .filter((_, index) => index !== selectedChapter)
      .map((chapter, index) => ({ ...chapter, orderIndex: index }));
    props.onChange({
      ...current,
      preview: { ...current.preview, chapters },
    });
    setSelectedChapter(Math.max(0, selectedChapter - 1));
  };
  const splitChapter = () => {
    const current = props.value;
    const chapter = current?.preview.chapters[selectedChapter];
    if (!current || !chapter?.content.trim()) {
      setNotice("当前章节没有可拆分的正文。");
      return;
    }
    const midpoint = Math.floor(chapter.content.length / 2);
    const followingBreak = chapter.content.indexOf("\n\n", midpoint);
    const precedingBreak = chapter.content.lastIndexOf("\n\n", midpoint);
    const splitAt =
      followingBreak >= 0
        ? followingBreak
        : precedingBreak > 0
          ? precedingBreak
          : midpoint;
    if (splitAt <= 0 || splitAt >= chapter.content.length) {
      setNotice("未找到适合拆分的位置，请先在正文中增加段落。");
      return;
    }
    const before = chapter.content.slice(0, splitAt).trim();
    const after = chapter.content.slice(splitAt).trim();
    const chapters = [...current.preview.chapters];
    chapters.splice(
      selectedChapter,
      1,
      {
        ...chapter,
        content: before,
        wordCount: [...before.replace(/\s/gu, "")].length,
      },
      {
        ...chapter,
        key: `split-${crypto.randomUUID()}`,
        title: `${chapter.title}（续）`,
        content: after,
        wordCount: [...after.replace(/\s/gu, "")].length,
      },
    );
    props.onChange({
      ...current,
      preview: {
        ...current.preview,
        chapters: chapters.map((item, index) => ({
          ...item,
          orderIndex: index,
        })),
      },
    });
    setSelectedChapter(selectedChapter + 1);
    setNotice(undefined);
  };
  const preview = props.value?.preview;
  return (
    <section className={styles.c16}>
      <div className={styles.c17}>
        <div>
          <p className={styles.c7}>
            {copyText("app/features/workspace/impl.10")}
          </p>
          <p className={styles.c18}>
            {copyText("app/features/workspace/impl.11")}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={props.disabled || working}
          onClick={() => void choose()}
        >
          {working ? "正在解析…" : preview ? "重新选择" : "选择文件"}
        </Button>
      </div>
      {preview && props.value && (
        <div className={styles.c19}>
          <div className={styles.c20}>
            <span className={styles.c21}>{preview.fileName}</span>
            <span className={styles.c22}>
              {sourceTypeLabel(preview.sourceType)}
            </span>
            <span className={styles.c23}>
              {preview.contentKind === "script"
                ? `${preview.episodes.length} 集 · ${preview.episodes.reduce((sum, episode) => sum + episode.scenes.length, 0)} 个场景`
                : `${preview.chapters.length} 章 · ${preview.charCount.toLocaleString("zh-CN")} 字符`}
            </span>
          </div>
          {preview.contentKind === "script" ? (
            <div className={styles.c24}>
              {preview.episodes.map((episode) => (
                <div key={episode.key} className={styles.c25}>
                  <p className={styles.c21}>
                    {copyText("app/features/workspace/impl.12")}
                    {episode.episodeNumber}
                    {copyText("app/features/workspace/impl.13")}
                    {episode.title}
                  </p>
                  <p className={styles.c18}>
                    {episode.scenes.length}
                    {copyText("app/features/workspace/impl.14")}
                    {episode.content.length}{" "}
                    {copyText("app/features/workspace/impl.15")}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.c26}>
              <div className={styles.c27}>
                {preview.chapters.map((chapter, index) => (
                  <BareButton
                    key={chapter.key}
                    className={clsx(
                      styles.c28,
                      index === selectedChapter ? styles.k1 : styles.k2,
                    )}
                    onClick={() => setSelectedChapter(index)}
                  >
                    {chapter.title}
                  </BareButton>
                ))}
                <Button
                  className={styles.c29}
                  size="sm"
                  variant="secondary"
                  disabled={props.disabled || working}
                  onClick={addChapter}
                >
                  {copyText("app/features/workspace/impl.16")}
                </Button>
              </div>
              {preview.chapters[selectedChapter] && (
                <div className={styles.c30}>
                  <div className={styles.c31}>
                    <Input
                      aria-label={copyText("app/features/workspace/impl.17")}
                      disabled={props.disabled || working}
                      value={preview.chapters[selectedChapter].title}
                      onChange={(event) =>
                        updateChapter({ title: event.target.value })
                      }
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={splitChapter}
                      disabled={props.disabled || working}
                    >
                      {copyText("app/features/workspace/impl.18")}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={
                        preview.chapters.length <= 1 ||
                        props.disabled ||
                        working
                      }
                      onClick={removeChapter}
                    >
                      {copyText("app/features/workspace/impl.19")}
                    </Button>
                  </div>
                  <Textarea
                    className={styles.c32}
                    aria-label={copyText("app/features/workspace/impl.20")}
                    disabled={props.disabled || working}
                    value={preview.chapters[selectedChapter].content}
                    onChange={(event) =>
                      updateChapter({ content: event.target.value })
                    }
                  />
                </div>
              )}
            </div>
          )}
          <label className={styles.c33}>
            <input
              className={styles.c34}
              type="checkbox"
              checked={props.value.rightsConfirmed}
              disabled={props.disabled || working}
              onChange={(event) =>
                props.onChange({
                  ...props.value!,
                  rightsConfirmed: event.target.checked,
                })
              }
            />
            {copyText("app/features/workspace/impl.21")}
          </label>
          <p className={styles.c23}>
            {copyText("app/features/workspace/impl.22")}{" "}
            {new Date(props.value.expiresAt).toLocaleTimeString("zh-CN")}
            {copyText("app/features/workspace/impl.23")}
          </p>
        </div>
      )}
      {notice && <InlineNotice tone="danger">{notice}</InlineNotice>}
    </section>
  );
}

function projectModeNextStep(project: Project): string {
  if (project.lifecycleStatus === "initializing") return "正在初始化…";
  switch (project.mode) {
    case "series_longform":
      return "建立母本与第 1 卷 →";
    case "single_season":
      if (isDirectScriptProject(project))
        return project.modeConfig.mode === "single_season" &&
          project.modeConfig.entryPath === "inspiration"
          ? "创作与审阅本集剧本 →"
          : "检查已有剧本 →";
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
        title: "从创意开始",
        description: "从一个精简故事开始，建立故事母稿、人物、季纲和第一集。",
        outcome: "创建后进入单季故事规划",
        recommended: true,
      },
      {
        source: "source-import",
        title: "导入小说 / IP",
        description: "导入已授权小说或 IP，预览确认后开始单季改编。",
        outcome: "确认预览后才创建项目",
      },
      {
        source: "script",
        title: "使用已有剧本",
        description: "粘贴首集剧本草稿，或预览并导入结构化剧本 JSON。",
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

function projectCreateLabel(mode: ProjectMode): string {
  return {
    series_longform: "创建系列长篇",
    single_season: "创建单季短剧",
    personal_theater: "创建我的 AI 小剧场",
    creator_channel: "创建博主内容工作室",
  }[mode];
}

function ProjectHomeContinueCard(props: { project: Project }) {
  const client = useStudio();
  const session = useStudioSession();
  const chapterRead = useQuery({
    queryKey: ["chapters", props.project.id],
    queryFn: () => client.chapters.list(props.project.id),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const graphRead = useQuery({
    queryKey: ["production-graph", props.project.id],
    queryFn: () => client.production.graph(props.project.id),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const taskRead = useQuery({
    queryKey: ["tasks"],
    queryFn: client.tasks.list,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const { data: chapters = [] } = chapterRead;
  const { data: graph } = graphRead;
  const { data: tasks = [] } = taskRead;
  const novelOnly = Boolean(graph && usesNovelWorkflow(props.project, graph));
  const adaptationOnly = Boolean(
    graph && usesAdaptationWorkflow(props.project, graph),
  );
  const directOnly = isDirectScriptProject(props.project);
  const novelEvidence = useQuery({
    queryKey: ["novel-cockpit-evidence", props.project.id],
    queryFn: () => loadNovelCockpitEvidence(client, props.project.id),
    enabled: novelOnly,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 5000,
  });
  const adaptationEvidence = useQuery({
    queryKey: ["adaptation-cockpit-evidence", props.project.id],
    queryFn: () => loadAdaptationCockpitEvidence(client, props.project.id),
    enabled: adaptationOnly,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 5000,
  });
  const directEvidence = useQuery({
    queryKey: ["direct-script-cockpit-evidence", props.project.id],
    queryFn: () => loadDirectScriptCockpitEvidence(client, props.project.id),
    enabled: directOnly,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 5000,
  });
  const readiness = projectProgressReadiness([
    graphRead,
    taskRead,
    ...(!directOnly && !adaptationOnly ? [chapterRead] : []),
    ...(novelOnly ? [novelEvidence] : []),
    ...(adaptationOnly ? [adaptationEvidence] : []),
    ...(directOnly ? [directEvidence] : []),
  ]);
  if (readiness.state === "failed")
    return (
      <section
        aria-label={copyText("app/features/workspace/impl.24")}
        className={styles.c35}
      >
        <p className={styles.c36}>
          {copyText("app/features/workspace/impl.24")}
        </p>
        <h2 className={styles.c37}>{props.project.title}</h2>
        <p role="alert" className={styles.c38}>
          {copyText("app/features/workspace/impl.25")}
          {message(readiness.error)}
        </p>
        <p className={styles.c39}>
          {copyText("app/features/workspace/impl.26")}
        </p>
        <Button asChild className={styles.c40} variant="secondary">
          <Link to={`/projects/${encodeURIComponent(props.project.id)}`}>
            {copyText("app/features/workspace/impl.27")}
          </Link>
        </Button>
      </section>
    );
  if (!graph || readiness.state === "loading")
    return (
      <section
        aria-label={copyText("app/features/workspace/impl.24")}
        className={styles.c35}
      >
        <p className={styles.c36}>
          {copyText("app/features/workspace/impl.24")}
        </p>
        <h2 className={styles.c37}>{props.project.title}</h2>
        <p className={styles.c39}>
          {copyText("app/features/workspace/impl.28")}
        </p>
      </section>
    );
  const cockpit = deriveProjectCockpit({
    project: props.project,
    chapters,
    graph,
    tasks,
    novel: novelEvidence.error ? undefined : novelEvidence.data,
    adaptation: adaptationEvidence.error ? undefined : adaptationEvidence.data,
    direct: directEvidence.error ? undefined : directEvidence.data,
  });
  const lastRoute = session.lastProjectRoute(props.project.id);
  return (
    <section
      aria-label={copyText("app/features/workspace/impl.24")}
      className={clsx(styles.c41, styles.continueCard)}
    >
      <div className={styles.heroArtwork} aria-hidden="true">
        <Feather />
      </div>
      <div className={styles.c42}>
        <div>
          <p className={clsx(styles.c36, styles.heroKicker)}>
            <Sparkles aria-hidden="true" className={styles.actionIcon} />
            {copyText("app/features/workspace/impl.24")}
          </p>
          <h2 className={styles.c43}>{props.project.title}</h2>
          <p className={styles.c39}>
            {cockpit.statusLabel} · {cockpit.recentResult}
          </p>
        </div>
        <span className={styles.c44}>
          {cockpit.blockers.length ? "需要补充资料" : "可以继续"}
        </span>
      </div>
      {cockpit.blockers.length > 0 && (
        <p className={styles.c45}>{cockpit.blockers.join("；")}</p>
      )}
      {novelEvidence.error && (
        <p role="status" className={styles.c46}>
          {copyText("app/features/workspace/impl.29")}
          {message(novelEvidence.error)}
          {copyText("app/features/workspace/impl.30")}
        </p>
      )}
      {adaptationEvidence.error && (
        <p role="status" className={styles.c46}>
          {copyText("app/features/workspace/impl.31")}
          {message(adaptationEvidence.error)}
          {copyText("app/features/workspace/impl.32")}
        </p>
      )}
      <div className={styles.c47}>
        <Button asChild variant="primary">
          <Link to={cockpit.primaryAction.to}>
            {cockpit.primaryAction.label}
            <ArrowUpRight aria-hidden="true" className={styles.actionIcon} />
          </Link>
        </Button>
        {lastRoute && lastRoute !== cockpit.primaryAction.to && (
          <Button asChild variant="secondary">
            <Link to={lastRoute}>
              {copyText("app/features/workspace/impl.33")}
            </Link>
          </Button>
        )}
      </div>
      <p className={styles.c48}>
        {copyText("app/features/workspace/impl.34")}
        {cockpit.primaryAction.description}
      </p>
    </section>
  );
}

function ProjectHomeTaskSummary(props: { projectId: string }) {
  const client = useStudio();
  const { data } = useQuery({
    queryKey: ["task-worklist-summary", props.projectId],
    queryFn: () =>
      client.tasks.worklist({
        projectId: props.projectId,
        category: "pending-result",
        limit: 3,
      }),
  });
  if (!data || (!data.counts.pendingResult && !data.counts.attention))
    return null;
  return (
    <section className={styles.c49}>
      <div className={styles.c17}>
        <div>
          <h2 className={styles.c50}>
            {copyText("app/features/workspace/impl.35")}
          </h2>
          <p className={styles.c4}>
            {data.counts.pendingResult}
            {copyText("app/features/workspace/impl.36")}
            {data.counts.attention
              ? ` · ${data.counts.attention} 个任务需要处理`
              : ""}
          </p>
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link to={`/tasks?projectId=${encodeURIComponent(props.projectId)}`}>
            {copyText("app/features/workspace/impl.37")}
          </Link>
        </Button>
      </div>
    </section>
  );
}

export function ProjectHome() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const session = useStudioSession();
  // Only a draft with real content (or an unfinished creation) reopens the
  // step-by-step form. A draft that merely recorded clicks is dropped, so
  // 新建项目 always opens on the quick start.
  const [restoredDraft] = useState(() =>
    creationDraftWorthRestoring(session.creationDraft)
      ? session.creationDraft
      : undefined,
  );
  // Judged once, when the page opens: a draft being built in this visit is
  // never dropped, even before anything has been typed.
  const [staleDraftId] = useState(() =>
    session.creationDraft && !creationDraftWorthRestoring(session.creationDraft)
      ? session.creationDraft.draftId
      : undefined,
  );
  const liveDraft =
    staleDraftId && session.creationDraft?.draftId === staleDraftId
      ? undefined
      : session.creationDraft;
  const creationDraftRef = useRef(liveDraft);
  creationDraftRef.current = liveDraft;
  useEffect(() => {
    if (staleDraftId && session.creationDraft?.draftId === staleDraftId)
      session.clearCreationDraft();
    // Run once for the draft found on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staleDraftId]);
  const creationPanelRef = useRef<HTMLElement>(null);
  const openCreation = () => {
    setCreationOpen(true);
    window.setTimeout(
      () =>
        creationPanelRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      0,
    );
  };
  const [projects, setProjects] = useState<Project[]>(session.projects);
  const [creationOpen, setCreationOpen] = useState(Boolean(restoredDraft));
  const [packageImportOpen, setPackageImportOpen] = useState(false);
  const [creationSource, setCreationSource] = useState<ProjectCreationSource>(
    restoredDraft?.creationSource ?? "inspiration",
  );
  const [projectMode, setProjectMode] = useState<ProjectMode>(
    restoredDraft?.projectMode ?? "series_longform",
  );
  const [storyPresetId, setStoryPresetId] = useState<
    NovelStoryPresetId | undefined
  >(() =>
    novelStoryPreset(restoredDraft?.storyPresetId as NovelStoryPresetId)
      ? (restoredDraft?.storyPresetId as NovelStoryPresetId)
      : undefined,
  );
  const [pendingImport, setPendingImport] = useState<
    PendingSourceImport | undefined
  >(() =>
    restoredSourceImportDraft(
      restoredDraft?.sourceImportAttempt,
      restoredDraft?.pendingSourceImport,
    ),
  );
  const [nativeScriptIntake, setNativeScriptIntake] = useState<
    NativeScriptIntakeBinding | undefined
  >(restoredDraft?.nativeScriptIntake);
  const pendingImportRef = useRef<PendingSourceImport | undefined>(undefined);
  const [creatorTopic, setCreatorTopic] = useState(
    restoredDraft?.creatorTopic ?? "",
  );
  const [brief, setBrief] = useState<ProductionBriefDraft>(
    () =>
      restoredDraft?.brief ??
      projectModeBrief("series_longform", "inspiration"),
  );
  const [scriptContent, setScriptContent] = useState(
    restoredDraft?.scriptDraft ?? "",
  );
  // A recovered draft is not a renewed grant of rights to its pasted content.
  const [scriptRightsConfirmed, setScriptRightsConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creatingDemo, setCreatingDemo] = useState(false);
  const [error, setError] = useState<string>();
  const [showTrash, setShowTrash] = useState(false);
  const [trashedProjects, setTrashedProjects] = useState<Project[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeCreateStep, setActiveCreateStep] = useState<1 | 2 | 3>(
    restoredDraft?.intakeStep ?? (restoredDraft ? 3 : 1),
  );
  // New projects start from one choice; the step-by-step form is kept for
  // file imports and the other templates, and for restoring an unfinished one.
  const [wizardOpen, setWizardOpen] = useState(Boolean(restoredDraft));
  const [quickKind, setQuickKind] = useState<ProjectQuickStartKind>("novel");
  const [quickName, setQuickName] = useState("");
  const [quickTarget, setQuickTarget] = useState<{
    projectMode: ProjectMode;
    creationSource: ProjectCreationSource;
    brief: ProductionBriefDraft;
  }>();
  const startMethodRef = useRef<HTMLDivElement>(null);
  const creationGoalRef = useRef<HTMLElement>(null);
  const projectFormRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    pendingImportRef.current = pendingImport;
  }, [pendingImport]);
  useEffect(
    () => () => {
      const current = pendingImportRef.current;
      if (current && !creationDraftRef.current?.sourceImportAttempt)
        void client.sourceImports
          .discard(current.importId)
          .catch(() => undefined);
    },
    [client],
  );
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
  const discardPendingImport = (current = pendingImport) => {
    setPendingImport(undefined);
    if (current)
      void client.sourceImports
        .discard(current.importId)
        .catch(() => undefined);
  };
  const resetCreationForm = (close = false, nativeCompleted = false) => {
    if (creationDraftRef.current?.sourceImportAttempt) {
      setError(
        "原导入结果尚未核验；保留原预览和动作键，先明确恢复同一次导入，不清空或换稿。",
      );
      return;
    }
    if (
      creationDraftRef.current?.attemptId &&
      !creationDraftRef.current.createdProjectId
    ) {
      setError(
        "原创建结果尚未核验；保留同一创建键，先明确重试核验，不清空或换键创建。",
      );
      return;
    }
    if (nativeScriptIntake && !nativeCompleted) {
      setError(
        "原生文件预览或同次初始化仍需核验；请先在原生面板明确取消未提交预览，或恢复同一次创建，不清除未知结果。",
      );
      return;
    }
    setNativeScriptIntake(undefined);
    setProjectMode("series_longform");
    setCreationSource("inspiration");
    setBrief(projectModeBrief("series_longform", "inspiration"));
    setStoryPresetId(undefined);
    discardPendingImport();
    setCreatorTopic("");
    setScriptContent("");
    setScriptRightsConfirmed(false);
    setShowAdvanced(false);
    setActiveCreateStep(1);
    setQuickName("");
    setQuickTarget(undefined);
    if (close) {
      setCreationOpen(false);
      setWizardOpen(false);
    }
    session.clearCreationDraft();
    creationDraftRef.current = undefined;
  };
  const persistCreationDraft = (
    values: Partial<CreationDraftV1>,
    preserveAttempt = false,
  ) => {
    const base =
      creationDraftRef.current ??
      createCreationDraft("project-home", projectMode, creationSource);
    const next: CreationDraftV1 = {
      ...base,
      projectMode,
      creationSource,
      brief,
      storyPresetId,
      scriptDraft: scriptContent,
      nativeScriptIntake,
      creatorTopic,
      origin: "project-home",
      ...values,
    };
    session.saveCreationDraft(
      next,
      preserveAttempt || Boolean(base.attemptId || base.sourceImportAttempt),
    );
    creationDraftRef.current = next;
  };
  const updatePendingImport = (value: PendingSourceImport | undefined) => {
    if (creationDraftRef.current?.sourceImportAttempt) {
      setError("原导入已冻结；不编辑原输入或更换预览，请先恢复同一次导入。");
      return;
    }
    // Persist private preview text only, never the file grant or absolute path.
    persistCreationDraft({ pendingSourceImport: value });
    setPendingImport(value);
  };
  const selectCreationSource = (source: ProjectCreationSource) => {
    if (creationDraftRef.current?.attemptId) {
      setError(
        "同次创建已绑定原目标与输入；不能通过更换素材重绑，请先核验原创建。",
      );
      return;
    }
    if (nativeScriptIntake) {
      setError(
        "请先核验或明确取消创建前原生预览；不会暗中换稿或遗失创建恢复身份。",
      );
      return;
    }
    // Keep the active recovery form visible if a lost create reply is followed
    // by a successful list read revealing the newly created project.
    setCreationOpen(true);
    discardPendingImport();
    setCreationSource(source);
    const mode = recommendedProjectMode(source);
    setProjectMode(mode);
    setStoryPresetId(undefined);
    const nextBrief = projectModeBrief(mode, source, brief);
    setBrief(nextBrief);
    setScriptContent("");
    setScriptRightsConfirmed(false);
    setActiveCreateStep(2);
    setError(undefined);
    persistCreationDraft({
      creationSource: source,
      projectMode: mode,
      brief: nextBrief,
      storyPresetId: undefined,
      scriptDraft: "",
      intakeStep: 2,
      goalConfirmation: undefined,
    });
    window.setTimeout(
      () =>
        creationGoalRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      0,
    );
  };
  const selectProjectMode = (mode: ProjectMode) => {
    if (creationDraftRef.current?.attemptId) {
      setError(
        "同次创建已绑定原目标与输入；不能通过更换目标补确认，请先核验原创建。",
      );
      return;
    }
    if (nativeScriptIntake) {
      setError("请先核验或明确取消创建前原生预览；已确认创建的目标不能更换。");
      return;
    }
    setCreationOpen(true);
    discardPendingImport();
    const paths = projectStartOptions(mode);
    const source = paths.some((path) => path.source === creationSource)
      ? creationSource
      : paths[0]!.source;
    setProjectMode(mode);
    setCreationSource(source);
    setStoryPresetId(undefined);
    const nextBrief = projectModeBrief(mode, source, brief);
    setBrief(nextBrief);
    setScriptContent("");
    setScriptRightsConfirmed(false);
    setShowAdvanced(false);
    setError(undefined);
    setCreatorTopic("");
    setActiveCreateStep(3);
    persistCreationDraft({
      projectMode: mode,
      creationSource: source,
      brief: nextBrief,
      storyPresetId: undefined,
      scriptDraft: "",
      creatorTopic: "",
      intakeStep: 3,
      goalConfirmation: explicitCreationGoal(mode, source),
    });
    window.setTimeout(
      () =>
        projectFormRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      0,
    );
  };
  const modeConfig = projectModeConfigFromDraft(
    projectMode,
    creationSource,
    brief,
    creatorTopic,
  );
  const updateBrief = <Key extends keyof ProductionBriefDraft>(
    key: Key,
    value: ProductionBriefDraft[Key],
  ) => {
    const next = { ...brief, [key]: value };
    setBrief(next);
    persistCreationDraft({ brief: next });
  };
  const clearStoryPreset = (shortDramaType?: string) => {
    setStoryPresetId(undefined);
    const defaults = projectModeBrief(projectMode, creationSource, brief);
    const next = {
      ...brief,
      shortDramaType: shortDramaType ?? defaults.shortDramaType,
      targetAudience: defaults.targetAudience,
      visualStyleDirection: defaults.visualStyleDirection,
    };
    setBrief(next);
    persistCreationDraft({ brief: next, storyPresetId: undefined });
  };
  const createFromBrief = async (
    mode: "inspiration" | "source-file" | "script-draft" | "script-file",
    resumeScriptInitialization = false,
    quick?: {
      projectMode: ProjectMode;
      creationSource: ProjectCreationSource;
      brief: ProductionBriefDraft;
    },
  ) => {
    // The quick start passes its own choices; wizard state may not have
    // re-rendered yet, so never read the closure values in that case.
    const target = quick ?? { projectMode, creationSource, brief };
    const targetConfig = quick
      ? projectModeConfigFromDraft(
          quick.projectMode,
          quick.creationSource,
          quick.brief,
          "",
        )
      : modeConfig;
    const draftFields = quick
      ? {
          projectMode: quick.projectMode,
          creationSource: quick.creationSource,
          brief: quick.brief,
        }
      : {};
    if (nativeScriptIntake) {
      setError("先核验并完成或撤销同一原生文件预览；不会另建项目。");
      return;
    }
    if (!target.creationSource || !target.brief.title.trim() || !targetConfig)
      return;
    if (
      mode === "script-draft" &&
      (!scriptContent.trim() || !scriptRightsConfirmed) &&
      !resumeScriptInitialization
    )
      return;
    if (resumeScriptInitialization && !session.creationDraft?.createdProjectId)
      return;
    const sourceFile = mode === "source-file" || mode === "script-file";
    if (sourceFile && (!pendingImport || !pendingImport.rightsConfirmed))
      return;
    if (
      mode === "script-file" &&
      pendingImport?.preview.contentKind !== "script"
    ) {
      setError(
        "这是小说或大纲文件，请通过“导入小说或大纲”入口确认创作目标；不会把小说正文误存为剧本。",
      );
      return;
    }
    if (
      mode === "source-file" &&
      pendingImport?.preview.contentKind === "script"
    ) {
      setError(
        "这是已有剧本，请从“导入已有剧本”入口开始；不会将其误初始化为小说母稿。",
      );
      return;
    }
    setSaving(true);
    setError(undefined);
    let createdProject: Project | undefined;
    let destination: string | undefined;
    try {
      const storyPreset =
        !quick &&
        mode === "inspiration" &&
        (target.projectMode === "series_longform" ||
          target.projectMode === "single_season")
          ? novelStoryPreset(storyPresetId)
          : undefined;
      const attempt = prepareProjectCreationAttempt(
        creationDraftRef.current,
        storyPreset
          ? projectInputFromStoryPreset(target.brief, storyPreset, targetConfig)
          : projectInputFromBrief(target.brief, targetConfig),
      );
      const { attemptId, frozenProjectInput } = attempt;
      persistCreationDraft(
        { ...draftFields, attemptId, frozenProjectInput },
        true,
      );
      const project = creationDraftRef.current?.createdProjectId
        ? await client.projects.get(creationDraftRef.current.createdProjectId)
        : (await client.projects.create(attempt.input, attemptId)).project;
      createdProject = project;
      persistCreationDraft(
        {
          ...draftFields,
          attemptId,
          frozenProjectInput,
          createdProjectId: project.id,
        },
        true,
      );
      if (sourceFile && pendingImport) {
        try {
          const original = creationDraftRef.current?.sourceImportAttempt;
          const frozen = freezeSourceImportAttempt(
            pendingImport.importId,
            {
              projectId: project.id,
              strategy: "append",
              rightsConfirmed: true,
              destructiveConfirmed: false,
              preview: pendingImport.preview,
            },
            original,
          );
          persistCreationDraft(
            { sourceImportAttempt: frozen, pendingSourceImport: pendingImport },
            true,
          );
          if (original) {
            try {
              const saved = await client.sourceImports.getCommit(
                frozen.importId,
                project.id,
                frozen.requestKey,
              );
              checkSourceImportRecovery(frozen, saved);
            } catch (cause) {
              if (!(
                cause &&
                typeof cause === "object" &&
                "status" in cause &&
                cause.status === 404
              ))
                throw cause;
              // The first request may not have reached the owner; keep its exact input/key.
            }
          }
          await client.sourceImports.commit(
            frozen.importId,
            frozen.input,
            frozen.requestKey,
          );
        } catch (cause) {
          throw new Error(
            `${message(cause)}；项目和原导入请求保留，内容可能已整批写入。请恢复同一次导入，不重复创建或删除项目。`,
          );
        }
      }
      try {
        const initialized = await initializeProjectMaterials(client, {
          project,
          brief: target.brief,
          preset: storyPreset,
          ...(mode === "script-draft"
            ? { scriptDraft: scriptContent, scriptRightsConfirmed }
            : {}),
        });
        if (initialized.scriptContext)
          destination = scriptWorkspacePath(initialized.scriptContext);
        // A novel-to-script project made without a file starts by importing
        // the novel inside the project.
        else if (target.creationSource === "source-import" && !sourceFile)
          destination = `/projects/${encodeURIComponent(project.id)}/tools/import`;
        // A novel started from the quick start is planned with the AI first:
        // setup, characters and outline, then the first chapter.
        else if (quick && target.projectMode === "series_longform")
          destination = `/projects/${encodeURIComponent(project.id)}?section=plan`;
        persistCreationDraft(
          { ...draftFields, initializationSteps: initialized.steps },
          true,
        );
        if (initialized.chapterId)
          window.localStorage.setItem(
            `dramaip-novel-last-chapter:${project.id}`,
            initialized.chapterId,
          );
      } catch (cause) {
        if (cause instanceof ProjectInitializationError)
          persistCreationDraft(
            { ...draftFields, initializationSteps: cause.steps },
            true,
          );
        throw new Error(
          `${message(cause)}；项目和已完成的初始化资料均已保留，可安全继续初始化。`,
        );
      }
      if (sourceFile && creationDraftRef.current?.sourceImportAttempt) {
        persistCreationDraft(
          { sourceImportAttempt: undefined, pendingSourceImport: undefined },
          true,
        );
        setPendingImport(undefined);
      }
      setProjects((items) => [project, ...items]);
      resetCreationForm(true);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate(destination ?? `/projects/${project.id}`);
    } catch (cause) {
      setError(
        createdProject
          ? `${message(cause)} 当前项目已保留，不会自动永久删除。`
          : message(cause),
      );
      load();
    } finally {
      setSaving(false);
    }
  };
  const quickCreate = async () => {
    const option = projectQuickStart(quickKind);
    const target = {
      projectMode: option.mode as ProjectMode,
      creationSource: option.source as ProjectCreationSource,
      brief: {
        ...projectModeBrief(option.mode, option.source),
        title: quickStartProjectTitle(
          quickKind,
          quickName,
          projects.map((project) => project.title),
        ),
      },
    };
    // Keep the wizard state in step so a recovery retry sees the same target.
    setProjectMode(target.projectMode);
    setCreationSource(target.creationSource);
    setBrief(target.brief);
    setStoryPresetId(undefined);
    setQuickTarget(target);
    persistCreationDraft({
      ...target,
      storyPresetId: undefined,
      scriptDraft: "",
      intakeStep: 3,
      goalConfirmation: explicitCreationGoal(
        target.projectMode,
        target.creationSource,
      ),
    });
    await createFromBrief("inspiration", false, target);
  };
  const createDemo = async () => {
    setCreatingDemo(true);
    setError(undefined);
    try {
      const project = await client.support.createDemoProject();
      setProjects((items) => [project, ...items]);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    } catch (cause) {
      setError(message(cause));
    } finally {
      setCreatingDemo(false);
    }
  };
  const removeUnfinishedProject = async () => {
    if (creationDraftRef.current?.sourceImportAttempt) {
      setError(
        "原导入已绑定且内容可能已写入；先核验／恢复，不能把它当空项目移除。",
      );
      return;
    }
    const projectId = session.creationDraft?.createdProjectId;
    if (!projectId) return;
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      session.clearCreationDraft();
      return;
    }
    try {
      await client.projects.trash(project.id);
      session.clearCreationDraft();
      setProjects((items) => items.filter((item) => item.id !== project.id));
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      setError(undefined);
      showToast({
        message: `未完成项目「${project.title}」已移入回收站。`,
        actionLabel: "撤销",
        onAction: () => restoreProject(project),
      });
    } catch (cause) {
      setError(message(cause));
    }
  };
  // Trash is recoverable, so it acts immediately and offers undo instead of
  // asking for confirmation first.
  const trashProject = async (project: Project) => {
    try {
      await client.projects.trash(project.id);
      setProjects((items) => items.filter((item) => item.id !== project.id));
      if (showTrash) loadTrash();
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      showToast({
        message: `「${project.title}」已移入回收站。`,
        actionLabel: "撤销",
        onAction: () => restoreProject(project),
      });
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
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
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
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    } catch (cause) {
      setError(message(cause));
    }
  };
  const modeCards = [
    {
      mode: "series_longform" as const,
      title: "写小说 · 系列长篇",
      badge: "独立稿件成果",
      description:
        "持续创作小说、维护人物与世界，完成章节、稿件或投稿，不必改编。",
      next: "人物与大纲、章节采用、记忆与下一章",
      primary: true,
    },
    {
      mode: "single_season" as const,
      title: "开发剧本 · 单季短剧",
      badge: "支持漫剧 / 真人短剧",
      description: "从原创故事、小说或剧本开始，用一季讲完并进入制作。",
      next: "季纲、分集、剧本与分镜",
      primary: true,
    },
    {
      mode: "personal_theater" as const,
      title: "我的AI小剧场",
      badge: "个人故事",
      description: "以自己和已授权亲友为主角，创作一集五分钟的小故事。",
      next: "故事模板与人物授权",
      primary: false,
    },
    {
      mode: "creator_channel" as const,
      title: "博主内容工作室",
      badge: "内容创作",
      description: "围绕一个主题持续生产选题、研究、文章和口播。",
      next: "账号定位与首个选题",
      primary: false,
    },
  ];
  const importReady = Boolean(pendingImport?.rightsConfirmed);
  // A quick-start project has no file to import before creation; retrying it
  // must not take the file-import route.
  const retryQuickTarget =
    quickTarget ??
    (creationSource === "source-import" && !pendingImport
      ? { projectMode, creationSource, brief }
      : undefined);
  const creationErrorNotice = error ? (
    <div className={styles.c94}>
      <RecoveryNotice
        tone="danger"
        happened={error}
        contentSafety={
          session.creationDraft?.createdProjectId
            ? "项目、已完成的初始化资料和创作草稿均已保留在本机。"
            : "创作草稿已保留，尚未确认成功的项目不会被当作完成项目。"
        }
        nextStep={
          session.creationDraft?.sourceImportAttempt
            ? "先核验并恢复同一次导入；保留原输入和原键，不把可能已有内容的项目当作空项目移除。"
            : session.creationDraft?.createdProjectId
              ? "继续初始化只会读取实际资料并补齐缺失步骤；也可以把确认无内容的项目移入回收站。"
              : "检查当前输入后重试创建。"
        }
        returnTo="成功后进入刚创建的项目工作区。"
        actions={
          session.creationDraft?.createdProjectId ? (
            <>
              <Button
                variant="secondary"
                disabled={saving}
                onClick={() =>
                  void (retryQuickTarget
                    ? createFromBrief("inspiration", false, retryQuickTarget)
                    : createFromBrief(
                        creationSource === "inspiration"
                          ? "inspiration"
                          : creationSource === "source-import"
                            ? "source-file"
                            : pendingImport
                              ? "script-file"
                              : "script-draft",
                        creationSource === "script" && !pendingImport,
                      ))
                }
              >
                {copyText("app/features/workspace/impl.89")}
              </Button>
              <Button
                variant="ghost"
                disabled={
                  saving || Boolean(session.creationDraft?.sourceImportAttempt)
                }
                onClick={() => void removeUnfinishedProject()}
              >
                {copyText("app/features/workspace/impl.90")}
              </Button>
            </>
          ) : undefined
        }
      />
    </div>
  ) : null;
  const scaleSummary =
    modeConfig?.mode === "series_longform"
      ? `${modeConfig.targetChapterCount}章 · 写完可导出小说稿件`
      : modeConfig?.mode === "single_season"
        ? `${modeConfig.targetEpisodeCount}集 · ${brief.episodeDuration}`
        : modeConfig?.mode === "personal_theater"
          ? `${modeConfig.episodeCount}集 · ${brief.episodeDuration}`
          : "持续内容项目";
  return (
    <div className={clsx(styles.c51, styles.homePage)}>
      <WorkspaceIntro
        title={copyText("app/features/workspace/impl.38")}
        description={
          projects.length
            ? "继续最近的项目，或新建一个。"
            : "从创意、小说或剧本开始；AI 生成与修订，你来决定采用。"
        }
        actions={
          projects.length ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPackageImportOpen((value) => !value)}
              >
                {copyText("app/features/workspace/impl.39")}
              </Button>
              <Button size="sm" variant="primary" onClick={openCreation}>
                <Plus aria-hidden="true" className={styles.actionIcon} />
                {copyText("app/features/workspace/impl.40")}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={creatingDemo}
              onClick={() => void createDemo()}
            >
              {creatingDemo ? "正在创建示例…" : "先看看示例"}
            </Button>
          )
        }
      />
      {session.activeProject && projects.length ? (
        <ProjectHomeContinueCard project={session.activeProject} />
      ) : null}
      {session.activeProject && projects.length ? (
        <ProjectHomeTaskSummary projectId={session.activeProject.id} />
      ) : null}
      {(creationOpen || !projects.length) && !wizardOpen && (
        <section
          ref={creationPanelRef}
          className={styles.c52}
          aria-label={copyText("app/features/workspace/impl.40")}
        >
          <div className={styles.c2}>
            <div>
              <h2 className={styles.c53}>
                {copyText("app/features/workspace/impl.40")}
              </h2>
              <p className={styles.c4}>
                选一种开始方式就能创建。题材、篇幅、平台等都可以创建后在项目里补充，或和智能助手对话完善。
              </p>
            </div>
            {projects.length ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCreationOpen(false)}
              >
                {copyText("app/features/workspace/impl.43")}
              </Button>
            ) : null}
          </div>
          <div className={styles.c55} role="radiogroup" aria-label="开始方式">
            {PROJECT_QUICK_START_OPTIONS.map((option) => (
              <BareButton
                key={option.kind}
                role="radio"
                aria-checked={quickKind === option.kind}
                aria-label={option.title}
                className={clsx(
                  styles.c56,
                  quickKind === option.kind ? styles.k3 : styles.k4,
                )}
                disabled={saving}
                onClick={() => setQuickKind(option.kind)}
              >
                <p className={styles.c58}>{option.title}</p>
                <p className={styles.c59}>{option.description}</p>
              </BareButton>
            ))}
          </div>
          <div className={styles.c90}>
            <div className={styles.c77}>
              <label htmlFor="quick-project-title">项目名称（可不填）</label>
              <Input
                id="quick-project-title"
                placeholder={quickStartProjectTitle(
                  quickKind,
                  "",
                  projects.map((project) => project.title),
                )}
                value={quickName}
                disabled={saving}
                onChange={(event) => setQuickName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !saving) void quickCreate();
                }}
              />
              <span className={styles.c23}>
                只是项目的名字，不是小说或剧本的书名，随时可以改。
              </span>
            </div>
            <div className={styles.c93}>
              <Button
                variant="primary"
                disabled={saving}
                onClick={() => void quickCreate()}
              >
                {saving ? "正在创建…" : "创建项目"}
              </Button>
            </div>
          </div>
          <p className={styles.c80}>
            已经有小说或剧本文件，或想用其他模板（AI 小剧场、博主内容）？
            <BareButton
              type="button"
              className={styles.c81}
              disabled={saving}
              onClick={() => {
                setError(undefined);
                setWizardOpen(true);
              }}
            >
              用其他方式新建
            </BareButton>
          </p>
          {creationErrorNotice}
        </section>
      )}
      {(creationOpen || !projects.length) && wizardOpen && (
        <section ref={creationPanelRef} className={styles.c52}>
          <div className={styles.c2}>
            <div>
              <h2 className={styles.c53}>
                {copyText("app/features/workspace/impl.41")}
              </h2>
              <p className={styles.c4}>
                {copyText("app/features/workspace/impl.42")}
              </p>
            </div>
            <div className={styles.c93}>
              <Button
                variant="ghost"
                size="sm"
                disabled={
                  saving ||
                  Boolean(
                    session.creationDraft?.attemptId ||
                    session.creationDraft?.sourceImportAttempt ||
                    nativeScriptIntake,
                  )
                }
                onClick={() => {
                  resetCreationForm();
                  setWizardOpen(false);
                }}
              >
                返回快速新建
              </Button>
              {projects.length ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCreationOpen(false)}
                >
                  {copyText("app/features/workspace/impl.43")}
                </Button>
              ) : null}
            </div>
          </div>
          {activeCreateStep === 1 ? (
            <div ref={startMethodRef} className={styles.c54}>
              <h3 className={styles.c3}>
                {copyText("app/features/workspace/impl.44")}
              </h3>
              <p className={styles.c18}>
                {copyText("app/features/workspace/impl.45")}
              </p>
              <div className={styles.c55}>
                {PROJECT_SOURCE_OPTIONS.map((path) => (
                  <BareButton
                    key={path.source}
                    aria-label={path.title}
                    className={clsx(
                      styles.c56,
                      "recommended" in path && path.recommended
                        ? styles.k3
                        : styles.k4,
                    )}
                    onClick={() => selectCreationSource(path.source)}
                  >
                    {"recommended" in path && path.recommended ? (
                      <span className={styles.c57}>
                        {copyText("app/features/workspace/impl.46")}
                      </span>
                    ) : null}
                    <p className={styles.c58}>{path.title}</p>
                    <p className={styles.c59}>{path.description}</p>
                    <p className={styles.c60}>{path.outcome} →</p>
                  </BareButton>
                ))}
              </div>
            </div>
          ) : (
            <div className={styles.c61}>
              <div>
                <p className={styles.c23}>
                  {copyText("app/features/workspace/impl.47")}
                </p>
                <p className={styles.c50}>
                  {
                    PROJECT_SOURCE_OPTIONS.find(
                      (item) => item.source === creationSource,
                    )?.title
                  }
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={Boolean(session.creationDraft?.attemptId)}
                onClick={() => {
                  setActiveCreateStep(1);
                  persistCreationDraft({ intakeStep: 1 });
                }}
              >
                {copyText("app/features/workspace/impl.48")}
              </Button>
            </div>
          )}
          {activeCreateStep === 2 && (
            <section
              ref={creationGoalRef}
              className={styles.c62}
              aria-label={copyText("app/features/workspace/impl.49")}
            >
              <h3 className={styles.c3}>
                {copyText("app/features/workspace/impl.50")}
              </h3>
              <p className={styles.c18}>
                {copyText("app/features/workspace/impl.51")}
              </p>
              <p className={styles.c63}>
                {copyText("app/features/workspace/impl.52")}
              </p>
              <div className={styles.c64}>
                {modeCards
                  .filter(
                    (item) =>
                      item.primary &&
                      (creationSource !== "script" ||
                        item.mode === "single_season"),
                  )
                  .map((item) => (
                    <BareButton
                      key={item.mode}
                      aria-label={item.title}
                      className={styles.c65}
                      onClick={() => selectProjectMode(item.mode)}
                    >
                      <span className={styles.c57}>
                        {item.mode === projectMode ? "推荐 · " : ""}
                        {item.badge}
                      </span>
                      <p className={styles.c58}>{item.title}</p>
                      <p className={styles.c59}>{item.description}</p>
                      <p className={styles.c60}>{item.next} →</p>
                    </BareButton>
                  ))}
              </div>
              <details className={styles.c66}>
                <summary className={styles.c67}>
                  {copyText("app/features/workspace/impl.53")}
                </summary>
                <p className={styles.c68}>
                  {copyText("app/features/workspace/impl.54")}
                </p>
                <div className={styles.c69}>
                  {modeCards
                    .filter((item) => !item.primary)
                    .map((item) => (
                      <BareButton
                        key={item.mode}
                        className={styles.c70}
                        onClick={() => selectProjectMode(item.mode)}
                      >
                        <span className={styles.c21}>{item.title}</span>
                        <span className={styles.c71}>{item.description}</span>
                      </BareButton>
                    ))}
                </div>
              </details>
            </section>
          )}
          {activeCreateStep === 3 && (
            <div className={styles.c72}>
              <div>
                <p className={styles.c23}>
                  {copyText("app/features/workspace/impl.55")}
                </p>
                <p className={styles.c50}>
                  {modeCards.find((item) => item.mode === projectMode)?.title}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={Boolean(session.creationDraft?.attemptId)}
                onClick={() => {
                  setActiveCreateStep(2);
                  persistCreationDraft({ intakeStep: 2 });
                }}
              >
                {copyText("app/features/workspace/impl.56")}
              </Button>
            </div>
          )}
          {activeCreateStep === 3 && creationSource && (
            <div ref={projectFormRef} className={styles.c62}>
              {session.creationDraft?.attemptId && (
                <p role="status" className={styles.c73}>
                  {session.creationDraft.frozenProjectInput
                    ? `同次创建已冻结原请求：${session.creationDraft.frozenProjectInput.title}；重试使用原输入与创建键，当前表单修改不会重绑原项目。`
                    : "旧创建键未保存原请求，目标确认仍未知；只按原键核验，不补确认或自动换键。"}
                </p>
              )}
              {session.creationDraft?.sourceImportAttempt && (
                <p role="status" className={styles.c73}>
                  {copyText("app/features/workspace/impl.57")}
                </p>
              )}
              <div className={styles.c74}>
                <span className={styles.c75}>
                  {projectMode === "creator_channel" ? "2" : "3"}
                </span>
                <div>
                  <h3 className={styles.c3}>
                    {copyText("app/features/workspace/impl.58")}
                  </h3>
                  <p className={styles.c23}>
                    {copyText("app/features/workspace/impl.59")}
                  </p>
                </div>
              </div>
              <div className={styles.c76}>
                <div className={styles.c77}>
                  <label htmlFor="new-project-title">
                    {copyText("app/features/workspace/impl.60")}
                    <span className={styles.c78}>
                      {copyText("app/features/workspace/impl.61")}
                    </span>
                  </label>
                  <Input
                    id="new-project-title"
                    autoFocus={false}
                    placeholder={copyText("app/features/workspace/impl.149", {
                      p1: projectModeLabel(projectMode),
                    })}
                    value={brief.title}
                    onChange={(event) =>
                      updateBrief("title", event.target.value)
                    }
                  />
                </div>
                {projectMode === "creator_channel" && (
                  <label className={styles.c77}>
                    <span>
                      {copyText("app/features/workspace/impl.62")}
                      <span className={styles.c79}>
                        {copyText("app/features/workspace/impl.61")}
                      </span>
                    </span>
                    <Input
                      placeholder={copyText("app/features/workspace/impl.63")}
                      value={creatorTopic}
                      onChange={(event) => {
                        const value = event.target.value;
                        setCreatorTopic(value);
                        persistCreationDraft({ creatorTopic: value });
                      }}
                    />
                  </label>
                )}
                {projectMode === "personal_theater" && (
                  <label className={styles.c77}>
                    {copyText("app/features/workspace/impl.64")}
                    <Input
                      value={brief.shortDramaType}
                      onChange={(event) => {
                        if (storyPresetId) clearStoryPreset(event.target.value);
                        else updateBrief("shortDramaType", event.target.value);
                      }}
                    />
                  </label>
                )}
                {(projectMode === "series_longform" ||
                  projectMode === "single_season") && (
                  <div className={styles.c77}>
                    <label htmlFor="new-project-genre">
                      {copyText("app/features/workspace/impl.65")}
                    </label>
                    <Select
                      id="new-project-genre"
                      value={brief.shortDramaType || "__unspecified__"}
                      options={[
                        { value: "__unspecified__", label: "暂不选择" },
                        ...PROJECT_GENRE_GROUPS.flatMap((group) =>
                          group.genres.map((genre) => ({
                            value: genre,
                            label: genre,
                            group: group.label,
                          })),
                        ),
                        ...(brief.shortDramaType &&
                        !PROJECT_GENRE_CHOICES.some(
                          (genre) => genre === brief.shortDramaType,
                        )
                          ? [
                              {
                                value: brief.shortDramaType,
                                label: brief.shortDramaType,
                                group: "其他",
                              },
                            ]
                          : []),
                      ]}
                      onValueChange={(value) => {
                        const nextValue =
                          value === "__unspecified__" ? "" : value;
                        if (storyPresetId) clearStoryPreset(nextValue);
                        else updateBrief("shortDramaType", nextValue);
                      }}
                    />
                  </div>
                )}
              </div>
              <p className={styles.c80}>
                {copyText("app/features/workspace/impl.66")}
                <Link className={styles.c81} to="/inspiration">
                  {copyText("app/features/workspace/impl.67")}
                </Link>
                {copyText("app/features/workspace/impl.68")}
                <BareButton
                  type="button"
                  aria-label={copyText("app/features/workspace/impl.69")}
                  className={styles.c81}
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("dramaip:open-assistant-conversation"),
                    )
                  }
                >
                  {copyText("app/features/workspace/impl.70")}
                </BareButton>
                {copyText("app/features/workspace/impl.71")}
              </p>
              {creationSource === "inspiration" &&
                (projectMode === "series_longform" ||
                  projectMode === "single_season") && (
                  <NovelStoryPresetPicker
                    selectedId={storyPresetId}
                    mode={projectMode}
                    compact
                    onSelect={(id) => {
                      const preset = novelStoryPreset(id);
                      if (!preset) return;
                      const nextBrief = applyNovelStoryPresetToBrief(
                        brief,
                        preset,
                      );
                      setStoryPresetId(id);
                      setBrief(nextBrief);
                      persistCreationDraft({
                        storyPresetId: id,
                        brief: nextBrief,
                      });
                    }}
                    onClear={() => clearStoryPreset()}
                  />
                )}
              {creationSource !== "script" && (
                <label className={styles.c82}>
                  {projectMode === "creator_channel"
                    ? "补充说明"
                    : projectMode === "personal_theater"
                      ? "想讲的故事（可选）"
                      : "故事构思（可选）"}
                  <Textarea
                    className={styles.c83}
                    placeholder={
                      projectMode === "creator_channel"
                        ? "例如：强调数据来源，风格通俗但不过度简化"
                        : "写一句话也可以，创建后再继续完善"
                    }
                    value={brief.idea}
                    onChange={(event) =>
                      updateBrief("idea", event.target.value)
                    }
                  />
                </label>
              )}
              {creationSource === "script" && (
                <>
                  <label className={styles.c82}>
                    {projectMode === "personal_theater"
                      ? "故事描述"
                      : "已有剧本内容"}
                    <span className={styles.c23}>
                      {copyText("app/features/workspace/impl.72")}
                    </span>
                    <Textarea
                      className={styles.c32}
                      placeholder={
                        projectMode === "personal_theater"
                          ? "描述主角、发生的事情和希望呈现的情绪"
                          : "粘贴已拥有权利的剧本内容；保存后会作为首集草稿进入项目"
                      }
                      value={scriptContent}
                      onChange={(event) => {
                        const value = event.target.value;
                        setScriptContent(value);
                        setScriptRightsConfirmed(false);
                        persistCreationDraft({ scriptDraft: value });
                      }}
                    />
                  </label>
                  <label className={styles.c84}>
                    <input
                      type="checkbox"
                      checked={scriptRightsConfirmed}
                      onChange={(event) =>
                        setScriptRightsConfirmed(event.target.checked)
                      }
                    />
                    {copyText("app/features/workspace/impl.73")}
                  </label>
                  {projectMode !== "single_season" && (
                    <ProjectlessSourceImportEditor
                      value={pendingImport}
                      disabled={
                        saving ||
                        Boolean(
                          nativeScriptIntake ||
                          session.creationDraft?.sourceImportAttempt,
                        )
                      }
                      onChange={updatePendingImport}
                      onSuggestedTitle={(title) => {
                        if (!brief.title.trim()) updateBrief("title", title);
                      }}
                    />
                  )}
                  {projectMode === "single_season" && (
                    <NativeScriptIntakePanel
                      binding={nativeScriptIntake}
                      disabled={
                        saving ||
                        Boolean(pendingImport) ||
                        Boolean(session.creationDraft?.attemptId)
                      }
                      projectInput={
                        brief.title.trim() && modeConfig
                          ? projectInputForNativeCreation(
                              projectInputFromBrief(brief, modeConfig),
                              session.creationDraft?.goalConfirmation,
                            )
                          : undefined
                      }
                      onBusy={setSaving}
                      onChange={(value) => {
                        // Identity is durable before a preview or commit write; consent is not.
                        persistCreationDraft(
                          { nativeScriptIntake: value },
                          true,
                        );
                        setNativeScriptIntake(value);
                      }}
                      onOpen={(receipt) => {
                        resetCreationForm(true, true);
                        void queryClient.invalidateQueries({
                          queryKey: ["projects"],
                        });
                        navigate(
                          scriptWorkspacePath({
                            projectId: receipt.projectId,
                            adaptationId: receipt.adaptationId,
                            episodeId: receipt.episodeId,
                            scriptId: receipt.scriptId,
                          }),
                        );
                      }}
                    />
                  )}
                  {pendingImport?.preview.contentKind === "novel" && (
                    <p className={styles.c85}>
                      {copyText("app/features/workspace/impl.74")}
                    </p>
                  )}
                </>
              )}
              {creationSource === "source-import" && (
                <>
                  <ProjectlessSourceImportEditor
                    value={pendingImport}
                    disabled={
                      saving ||
                      Boolean(session.creationDraft?.sourceImportAttempt)
                    }
                    onChange={updatePendingImport}
                    onSuggestedTitle={(title) => {
                      if (!brief.title.trim()) updateBrief("title", title);
                    }}
                  />
                  {pendingImport?.preview.contentKind === "script" && (
                    <p className={styles.c85}>
                      {copyText("app/features/workspace/impl.75")}
                    </p>
                  )}
                </>
              )}
              <BareButton
                className={styles.c86}
                aria-expanded={showAdvanced}
                onClick={() => setShowAdvanced((value) => !value)}
              >
                {showAdvanced ? "收起更多设置 ↑" : "展开受众、平台与视觉设置 ↓"}
              </BareButton>
              {showAdvanced && (
                <div className={styles.c87}>
                  <label className={styles.c88}>
                    {copyText("app/features/workspace/impl.76")}
                    <Input
                      value={brief.targetAudience}
                      onChange={(event) =>
                        updateBrief("targetAudience", event.target.value)
                      }
                    />
                  </label>
                  <label className={styles.c88}>
                    {copyText("app/features/workspace/impl.77")}
                    <Input
                      value={brief.targetPlatform}
                      onChange={(event) =>
                        updateBrief("targetPlatform", event.target.value)
                      }
                    />
                  </label>
                  {projectMode === "series_longform" && (
                    <>
                      <label className={styles.c88}>
                        {copyText("app/features/workspace/impl.78")}
                        <Input
                          inputMode="numeric"
                          value={brief.targetChapterCount}
                          onChange={(event) =>
                            updateBrief(
                              "targetChapterCount",
                              event.target.value,
                            )
                          }
                        />
                        {!positiveInteger(brief.targetChapterCount) && (
                          <span className={styles.c89}>
                            {copyText("app/features/workspace/impl.79")}
                          </span>
                        )}
                      </label>
                      <label className={styles.c88}>
                        {copyText("app/features/workspace/impl.80")}
                        <Input
                          inputMode="numeric"
                          value={brief.targetSeasonCount}
                          onChange={(event) =>
                            updateBrief("targetSeasonCount", event.target.value)
                          }
                        />
                        {!positiveInteger(brief.targetSeasonCount) && (
                          <span className={styles.c89}>
                            {copyText("app/features/workspace/impl.79")}
                          </span>
                        )}
                      </label>
                      <label className={styles.c88}>
                        {copyText("app/features/workspace/impl.81")}
                        <Input
                          inputMode="numeric"
                          value={brief.targetEpisodesPerSeason}
                          onChange={(event) =>
                            updateBrief(
                              "targetEpisodesPerSeason",
                              event.target.value,
                            )
                          }
                        />
                        {!positiveInteger(brief.targetEpisodesPerSeason) && (
                          <span className={styles.c89}>
                            {copyText("app/features/workspace/impl.79")}
                          </span>
                        )}
                      </label>
                    </>
                  )}
                  {(projectMode === "single_season" ||
                    projectMode === "personal_theater") && (
                    <>
                      <label className={styles.c88}>
                        {copyText("app/features/workspace/impl.82")}
                        <Input
                          value={brief.episodeDuration}
                          onChange={(event) =>
                            updateBrief("episodeDuration", event.target.value)
                          }
                        />
                        {projectMode === "personal_theater" &&
                          !/^\s*[1-9]\d*(?:\s*分钟)?\s*$/u.test(
                            brief.episodeDuration,
                          ) && (
                            <span className={styles.c89}>
                              {copyText("app/features/workspace/impl.83")}
                            </span>
                          )}
                      </label>
                      <label className={styles.c88}>
                        {copyText("app/features/workspace/impl.84")}
                        <Input
                          inputMode="numeric"
                          value={brief.targetEpisodeCount}
                          onChange={(event) =>
                            updateBrief(
                              "targetEpisodeCount",
                              event.target.value,
                            )
                          }
                        />
                        {!positiveInteger(brief.targetEpisodeCount) && (
                          <span className={styles.c89}>
                            {copyText("app/features/workspace/impl.79")}
                          </span>
                        )}
                      </label>
                    </>
                  )}
                  <label className={styles.c88}>
                    {copyText("app/features/workspace/impl.85")}
                    <Input
                      value={brief.aspectRatio}
                      onChange={(event) =>
                        updateBrief("aspectRatio", event.target.value)
                      }
                    />
                  </label>
                  <label className={styles.c88}>
                    {copyText("app/features/workspace/impl.86")}
                    <Input
                      value={brief.visualStyleDirection}
                      onChange={(event) =>
                        updateBrief("visualStyleDirection", event.target.value)
                      }
                    />
                  </label>
                </div>
              )}
              <div className={styles.c90}>
                <div>
                  <p className={styles.c91}>
                    {copyText("app/features/workspace/impl.87")}
                  </p>
                  <p className={styles.c92}>
                    {brief.title.trim() || "未命名项目"} ·{" "}
                    {projectModeLabel(projectMode)} ·{" "}
                    {
                      projectStartOptions(projectMode).find(
                        (item) => item.source === creationSource,
                      )?.title
                    }
                  </p>
                  <p className={styles.c18}>
                    {storyPresetId
                      ? `${novelStoryPreset(storyPresetId)?.label}预设 · `
                      : ""}
                    {scaleSummary}
                  </p>
                </div>
                <div className={styles.c93}>
                  <Button
                    variant="ghost"
                    disabled={saving}
                    onClick={() => resetCreationForm()}
                  >
                    {copyText("app/features/workspace/impl.88")}
                  </Button>
                  {creationSource === "inspiration" && (
                    <Button
                      variant="primary"
                      disabled={saving || !brief.title.trim() || !modeConfig}
                      onClick={() => void createFromBrief("inspiration")}
                    >
                      {saving ? "正在创建…" : projectCreateLabel(projectMode)}
                    </Button>
                  )}
                  {creationSource === "source-import" && (
                    <Button
                      variant="primary"
                      disabled={
                        saving ||
                        !brief.title.trim() ||
                        !modeConfig ||
                        !importReady ||
                        pendingImport?.preview.contentKind === "script"
                      }
                      onClick={() => void createFromBrief("source-file")}
                    >
                      {saving
                        ? "正在创建…"
                        : `${projectCreateLabel(projectMode)}并导入`}
                    </Button>
                  )}
                  {creationSource === "script" && (
                    <>
                      {pendingImport && (
                        <Button
                          variant="secondary"
                          disabled={
                            saving ||
                            !brief.title.trim() ||
                            !modeConfig ||
                            !importReady ||
                            pendingImport.preview.contentKind !== "script"
                          }
                          onClick={() => void createFromBrief("script-file")}
                        >
                          {saving
                            ? "正在导入…"
                            : `${projectCreateLabel(projectMode)}并导入`}
                        </Button>
                      )}
                      <Button
                        variant="primary"
                        disabled={
                          saving ||
                          Boolean(nativeScriptIntake) ||
                          !brief.title.trim() ||
                          !modeConfig ||
                          !scriptContent.trim() ||
                          !scriptRightsConfirmed
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
          {creationErrorNotice}
        </section>
      )}
      {packageImportOpen ? (
        <ProjectPackageImportPanel
          onImported={async (project) => {
            setProjects((items) => [project, ...items]);
            await queryClient.invalidateQueries({ queryKey: ["projects"] });
            navigate(`/projects/${project.id}`);
          }}
        />
      ) : null}
      {projects.length ? (
        <section>
          <div className={styles.c95}>
            <h2 className={styles.c96}>
              {copyText("app/features/workspace/impl.91")}
            </h2>
            <div className={styles.c74}>
              <span className={styles.c97}>
                {projects.length}
                {copyText("app/features/workspace/impl.92")}
              </span>
              <BareButton
                className={styles.c98}
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
            className={clsx(
              styles.c99,
              projects.length === 1 ? styles.k5 : styles.k6,
            )}
          >
            {projects.map((project, index) => (
              <article
                key={project.id}
                className={clsx(
                  styles.c100,
                  styles.projectCard,
                  projects.length === 1 ? styles.k7 : "",
                )}
              >
                <span className={styles.c101}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <Link to={`/projects/${project.id}`} className={styles.c102}>
                  <div className={styles.projectCover} aria-hidden="true">
                    <BookOpenText />
                  </div>
                  <div className={styles.c103}>
                    <span className={styles.c104}>
                      {projectModeLabel(project.mode)}
                    </span>
                    {project.id === session.activeProjectId && (
                      <span className={styles.c105}>
                        {copyText("app/features/workspace/impl.93")}
                      </span>
                    )}
                  </div>
                  <p className={styles.c106}>{project.title}</p>
                  <p className={styles.c107}>
                    {project.synopsis || "尚未填写项目简介"}
                  </p>
                  <p className={styles.c108}>{projectModeNextStep(project)}</p>
                  <p className={styles.c68}>
                    {copyText("app/features/workspace/impl.94")}
                    {new Date(project.updatedAt).toLocaleString("zh-CN")}
                  </p>
                </Link>
                <DropdownMenu>
                  <DropdownMenu.Trigger asChild>
                    <IconButton
                      aria-label={copyText("app/features/workspace/impl.150", {
                        p1: project.title,
                      })}
                      variant="ghost"
                      size="sm"
                      className={styles.c109}
                    >
                      <MoreHorizontal
                        aria-hidden="true"
                        className={styles.c110}
                      />
                    </IconButton>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end">
                    <DropdownMenu.Item
                      onSelect={() => void trashProject(project)}
                    >
                      {copyText("app/features/workspace/impl.95")}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu>
              </article>
            ))}
            {!projects.length && (
              <EmptyState
                className={styles.c111}
                title={copyText("app/features/workspace/impl.96")}
                description="从灵感、原著或已有剧本开始搭建故事世界。"
                action={
                  <Button
                    variant="secondary"
                    disabled={creatingDemo}
                    onClick={() => void createDemo()}
                  >
                    {creatingDemo ? "正在创建示例…" : "先看看示例"}
                  </Button>
                }
              />
            )}
          </div>
          {showTrash && (
            <section className={styles.c112}>
              <h3 className={styles.c21}>
                {copyText("app/features/workspace/impl.97")}
              </h3>
              <p className={styles.c4}>
                {copyText("app/features/workspace/impl.98")}
              </p>
              <div className={styles.c113}>
                {trashedProjects.map((project) => (
                  <div key={project.id} className={styles.c114}>
                    <div>
                      <p className={styles.c21}>{project.title}</p>
                      <p className={styles.c23}>
                        {projectModeLabel(project.mode)}
                      </p>
                    </div>
                    <div className={styles.c31}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void restoreProject(project)}
                      >
                        {copyText("app/features/workspace/impl.99")}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => void purgeProject(project)}
                      >
                        {copyText("app/features/workspace/impl.100")}
                      </Button>
                    </div>
                  </div>
                ))}
                {!trashedProjects.length && (
                  <p className={styles.c97}>
                    {copyText("app/features/workspace/impl.101")}
                  </p>
                )}
              </div>
            </section>
          )}
        </section>
      ) : null}
    </div>
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
    <section className={styles.c115}>
      <div className={styles.c116}>
        <div>
          <h2 className={styles.c3}>
            {copyText("app/features/workspace/impl.102")}
          </h2>
          <p className={styles.c4}>
            {copyText("app/features/workspace/impl.103")}
          </p>
        </div>
        <BareButton
          className={styles.c117}
          disabled={
            saving || !draft.title.trim() || !draft.shortDramaType.trim()
          }
          onClick={() => void submit()}
        >
          {saving ? "保存中…" : "保存项目设定"}
        </BareButton>
      </div>
      <div className={styles.c118}>
        <label className={styles.c88}>
          {copyText("app/features/workspace/impl.104")}
          <input
            className={styles.c119}
            value={draft.title}
            onChange={(event) => set("title", event.target.value)}
          />
        </label>
        <label className={styles.c88}>
          {copyText("app/features/workspace/impl.105")}
          <input
            className={styles.c119}
            value={draft.shortDramaType}
            onChange={(event) => set("shortDramaType", event.target.value)}
          />
        </label>
        <label className={styles.c88}>
          {copyText("app/features/workspace/impl.106")}
          <input
            className={styles.c119}
            inputMode="numeric"
            value={draft.targetWordCount}
            onChange={(event) => set("targetWordCount", event.target.value)}
          />
        </label>
        <label className={styles.c88}>
          {copyText("app/features/workspace/impl.107")}
          <input
            className={styles.c119}
            inputMode="numeric"
            value={draft.targetEpisodeCount}
            onChange={(event) => set("targetEpisodeCount", event.target.value)}
          />
        </label>
        {fields.map(([key, label, placeholder]) => (
          <label key={key} className={styles.c88}>
            {label}
            <input
              className={styles.c119}
              placeholder={placeholder}
              value={draft[key]}
              onChange={(event) => set(key, event.target.value)}
            />
          </label>
        ))}
      </div>
      <label className={styles.c82}>
        {copyText("app/features/workspace/impl.108")}
        <textarea
          className={styles.c120}
          value={draft.synopsis}
          onChange={(event) => set("synopsis", event.target.value)}
        />
      </label>
      <label className={styles.c82}>
        {copyText("app/features/workspace/impl.109")}
        <textarea
          className={styles.c120}
          value={draft.productionBrief}
          onChange={(event) => set("productionBrief", event.target.value)}
        />
      </label>
      <ProjectDerivationPanel project={props.project} />
    </section>
  );
}

const DERIVATION_TARGET: Partial<Record<ProjectMode, ProjectMode>> = {
  series_longform: "single_season",
  single_season: "series_longform",
  personal_theater: "single_season",
  creator_channel: "personal_theater",
};

function ProjectDerivationPanel(props: { project: Project }) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const session = useStudioSession();
  const targetMode = DERIVATION_TARGET[props.project.mode];
  const [title, setTitle] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [preview, setPreview] = useState<ProjectDerivationPreview>();
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string>();
  const { data: seasons } = useQuery({
    queryKey: ["seasons", props.project.id, "derivation"],
    queryFn: () => client.seasons.list(props.project.id),
    enabled: props.project.mode === "series_longform",
  });

  useEffect(() => {
    setTitle("");
    setSeasonId("");
    setPreview(undefined);
    setNotice(undefined);
  }, [props.project.id]);

  if (!targetMode) return null;
  const needsSeason = props.project.mode === "series_longform";
  const canPreview = !needsSeason || Boolean(seasonId);
  const createPreview = async () => {
    if (!canPreview) return;
    setWorking(true);
    setNotice(undefined);
    try {
      const value = await client.projects.previewDerivation(props.project.id, {
        targetMode,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(seasonId ? { seasonId } : {}),
      });
      setPreview(value);
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const commit = async () => {
    if (!preview?.supported) return;
    setWorking(true);
    setNotice(undefined);
    try {
      const result = await client.projects.commitDerivation(
        props.project.id,
        preview.id,
      );
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      session.selectProject(result.project.id);
      navigate(`/projects/${result.project.id}`);
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className={styles.c121}>
      <p className={styles.c122}>
        {copyText("app/features/workspace/impl.110")}
      </p>
      <div className={styles.c123}>
        <div>
          <h3 className={styles.c3}>
            {copyText("app/features/workspace/impl.111")}
            {projectModeLabel(targetMode)}
          </h3>
          <p className={styles.c124}>
            {copyText("app/features/workspace/impl.112")}
          </p>
        </div>
        {props.project.derivedFromProjectId ? (
          <span className={styles.c125}>
            {copyText("app/features/workspace/impl.113")}
          </span>
        ) : null}
      </div>
      <div className={styles.c118}>
        {needsSeason ? (
          <label className={styles.c88}>
            {copyText("app/features/workspace/impl.114")}
            <Select
              aria-label={copyText("app/features/workspace/impl.114")}
              placeholder={copyText("app/features/workspace/impl.115")}
              value={seasonId}
              options={(seasons?.items ?? []).map((season) => ({
                value: season.id,
                label: season.title,
              }))}
              onValueChange={(value) => {
                setSeasonId(value);
                setPreview(undefined);
              }}
            />
            {seasons && seasons.items.length === 0 ? (
              <span className={styles.c23}>
                {copyText("app/features/workspace/impl.116")}
              </span>
            ) : null}
          </label>
        ) : null}
        <label className={styles.c88}>
          {copyText("app/features/workspace/impl.117")}
          <Input
            placeholder={copyText("app/features/workspace/impl.151", {
              p1: props.project.title,
              p2: projectModeLabel(targetMode),
            })}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setPreview(undefined);
            }}
          />
        </label>
      </div>
      {preview ? (
        <div className={styles.c126}>
          <p className={styles.c7}>
            {copyText("app/features/workspace/impl.118")}
            {preview.title}
          </p>
          <p className={styles.c127}>
            {copyText("app/features/workspace/impl.119")}
            {projectModeLabel(preview.targetMode)}
            {copyText("app/features/workspace/impl.120")}
            {new Date(preview.expiresAt).toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
            })}
            {copyText("app/features/workspace/impl.121")}
          </p>
          {preview.reason ? (
            <InlineNotice tone="warning" className={styles.c94}>
              {preview.reason}
            </InlineNotice>
          ) : null}
        </div>
      ) : null}
      {notice ? (
        <InlineNotice tone="danger" className={styles.c94}>
          {notice}
        </InlineNotice>
      ) : null}
      <div className={styles.c47}>
        <Button
          variant="secondary"
          disabled={working || !canPreview}
          onClick={() => void createPreview()}
        >
          {working && !preview ? "正在生成预览…" : "预览派生项目"}
        </Button>
        {preview?.supported ? (
          <Button disabled={working} onClick={() => void commit()}>
            {working ? "正在创建…" : "确认创建派生项目"}
          </Button>
        ) : null}
      </div>
    </div>
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
    <section className={styles.c128}>
      <div className={styles.c129}>
        <div>
          <h2 className={styles.c3}>
            {copyText("app/features/workspace/impl.122")}
          </h2>
          <p className={styles.c4}>
            {copyText("app/features/workspace/impl.123")}
          </p>
        </div>
        <Link className={styles.c130} to="/tasks">
          {copyText("app/features/workspace/impl.124")}
        </Link>
      </div>
      <div className={styles.c131}>
        {recent.map((task) => (
          <article key={task.id} className={styles.c132}>
            <p className={styles.c133}>{task.title}</p>
            <p className={styles.c18}>
              {task.kind === "quality-check" ||
              task.kind === "creative_diagnostics"
                ? "历史记录 · 质量未认证"
                : (TASK_STATUS_LABELS[task.status] ?? "未知状态")}
            </p>
          </article>
        ))}
        {!recent.length && (
          <p className={styles.c97}>
            {copyText("app/features/workspace/impl.125")}
          </p>
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
    // Restoring first saves the current content as a checkpoint, so it is
    // reversible and needs no confirmation.
    try {
      await client.contentVersions.restore(item.id);
      setNotice(`已恢复检查点；恢复前的${kind}已另存为新的检查点。`);
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
    <section className={styles.c128}>
      <div>
        <h2 className={styles.c3}>
          {copyText("app/features/workspace/impl.126")}
        </h2>
        <p className={styles.c4}>
          {copyText("app/features/workspace/impl.127")}
        </p>
      </div>
      {error && <p className={styles.c134}>{message(error)}</p>}
      {notice && <p className={styles.c135}>{notice}</p>}
      <div className={styles.c136}>
        {versions.slice(0, 8).map((item) => {
          const payload = recordPayload(item.payload);
          return (
            <article key={item.id} className={styles.c137}>
              <div>
                <p className={styles.c21}>{item.title}</p>
                <p className={styles.c18}>
                  {String(payload["目标类型"] ?? "内容")} ·{" "}
                  {String(payload["来源"] ?? "自动保存")}
                </p>
              </div>
              <BareButton
                className={styles.c138}
                onClick={() => void restore(item)}
              >
                {copyText("app/features/workspace/impl.128")}
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
          ? styles.c139
          : `${styles.c140} ${collapsed ? styles.k8 : wide ? styles.k9 : styles.k10}`
      }
      aria-label={copyText("app/features/workspace/impl.129")}
    >
      <div className={styles.c141}>
        {!isCollapsed && (
          <div>
            <p className={styles.c23}>
              {copyText("app/features/workspace/impl.130")}
              {props.context.kind === "chapter" ? "章节" : "剧本"}
              {copyText("app/features/workspace/impl.131")}
            </p>
            <h2 className={styles.c50}>
              {copyText("app/features/workspace/impl.132")}
            </h2>
          </div>
        )}
        {!props.embedded && (
          <div className={styles.c142}>
            {!isCollapsed && (
              <BareButton
                className={styles.c143}
                onClick={() => void updateWide(!wide)}
              >
                {wide ? "窄" : "宽"}
              </BareButton>
            )}
            <BareButton
              className={styles.c143}
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
            className={styles.c144}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copyText("app/features/workspace/impl.133")}
            aria-label={copyText("app/features/workspace/impl.134")}
          />
          <div className={styles.c145}>
            <Link className={styles.c146} to={storyBiblePath}>
              {copyText("app/features/workspace/impl.135")}
            </Link>
            {props.context.kind === "chapter" && (
              <BareButton className={styles.c146} onClick={() => void queue()}>
                {copyText("app/features/workspace/impl.136")}
              </BareButton>
            )}
          </div>
          {notice && (
            <p className={styles.c147} role="status">
              {notice}
            </p>
          )}
          {recordsError && (
            <p className={styles.c148} role="alert">
              {copyText("app/features/workspace/impl.137")}
            </p>
          )}
          {model.staleMarks.length > 0 && (
            <p className={styles.c148}>
              {copyText("app/features/workspace/impl.138")}
              {model.staleMarks.map((mark) => mark.reason).join("；")}
            </p>
          )}
          <div
            className={clsx(styles.c149, props.embedded ? "" : styles.k11)}
            aria-live="polite"
          >
            {visible.map((item) => (
              <article key={item.id} className={styles.c150}>
                <div className={styles.c141}>
                  <div>
                    <p className={styles.c151}>
                      {item.group} · {sidecarStateLabel(item.state)}
                    </p>
                    <p className={styles.c152}>{item.title}</p>
                  </div>
                  <BareButton
                    className={styles.c146}
                    onClick={() => void togglePin(item.id)}
                  >
                    {pinned.includes(item.id) ? "取消固定" : "固定"}
                  </BareButton>
                </div>
                <p className={styles.c153}>{item.text}</p>
                <p className={styles.c154}>
                  {copyText("app/features/workspace/impl.139")}
                  {item.sourceId.slice(0, 8)}
                  {item.sourceVersion !== undefined
                    ? ` · v${item.sourceVersion}`
                    : ""}{" "}
                  ·{" "}
                  <Link className={styles.c146} to={storyBiblePath}>
                    {copyText("app/features/workspace/impl.140")}
                  </Link>
                </p>
              </article>
            ))}
            {!visible.length && (
              <p className={styles.c155}>
                {copyText("app/features/workspace/impl.141")}
              </p>
            )}
          </div>
          {model.relevantChangeSets.length > 0 && (
            <div className={styles.c136}>
              <p className={styles.c156}>
                {copyText("app/features/workspace/impl.142")}
              </p>
              {model.relevantChangeSets.map((item) => (
                <div key={item.id} className={styles.c150}>
                  <p>{item.summary}</p>
                  <p className={styles.c157}>
                    {copyText("app/features/workspace/impl.143")}
                    {item.sourceVersion} ·{" "}
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
                    <p className={styles.c158}>
                      {copyText("app/features/workspace/impl.144")}
                      {item.conflictNotes.join("；")}
                    </p>
                  )}
                  {item.status === "draft" && (
                    <details className={styles.c159}>
                      <summary className={styles.c160}>
                        {copyText("app/features/workspace/impl.145")}
                      </summary>
                      <div className={styles.c161}>
                        {item.preview.fields.map((field) => {
                          const fields =
                            selectedFields[item.id] ??
                            item.preview.fields.map((entry) => entry.key);
                          return (
                            <label key={field.key} className={styles.c31}>
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
                    <div className={styles.c162}>
                      <BareButton
                        className={styles.c146}
                        onClick={() => void apply(item)}
                      >
                        {copyText("app/features/workspace/impl.146")}
                      </BareButton>
                      <BareButton
                        className={styles.c163}
                        onClick={() => void setStatus(item, "discarded")}
                      >
                        {copyText("app/features/workspace/impl.147")}
                      </BareButton>
                    </div>
                  )}
                  {["applied", "stale"].includes(item.status) && (
                    <BareButton
                      className={styles.c164}
                      onClick={() => void undo(item)}
                    >
                      {copyText("app/features/workspace/impl.148")}
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
