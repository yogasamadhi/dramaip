import type { Project } from "@dramaip/contracts/product";
import {
  BareButton,
  Button,
  EmptyState,
  InlineNotice,
  Input,
  LoadingState,
  Textarea,
} from "@dramaip/ui-shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  defaultProductionBrief,
  projectModeBrief,
  projectModeConfigFromDraft,
  projectInputFromBrief,
} from "../../project-intake";
import {
  initializeProjectMaterials,
  ProjectInitializationError,
} from "../../project-creation-coordinator";
import { createCreationDraft, useStudioSession } from "../../studio-session";
import {
  NOVEL_GENRE_CHOICES,
  WorkspaceIntro,
  message,
  useStudio,
} from "../../studio-shared";
import { NovelStoryPresetPicker } from "../novel/NovelStoryPresetPicker";
import {
  applyNovelStoryPresetToBrief,
  novelStoryPreset,
  projectInputFromStoryPreset,
  type NovelStoryPresetId,
} from "../novel/story-presets";
export function NovelWritingHome() {
  const client = useStudio();
  const {
    data: projects = [],
    error,
    isLoading,
  } = useQuery({
    queryKey: ["novel-writing-projects"],
    queryFn: client.projects.list,
  });
  return (
    <div className="space-y-5">
      <WorkspaceIntro
        eyebrow="核心工作区"
        title="小说写作"
        description="集中完成项目设定、人物塑造、全书大纲和章节正文，并在同一上下文中使用智能写作。"
        badge="主要创作入口"
      />
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">继续写作</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              选择项目，继续 AI 生成、修订或审阅上次的候选。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link to="/create">创作分析工具</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/write/new?mode=source">导入原著</Link>
            </Button>
            <Button asChild variant="primary">
              <Link to="/write/new">新建小说</Link>
            </Button>
          </div>
        </div>
        {error && (
          <InlineNotice className="mt-4" tone="danger">
            {message(error)}
          </InlineNotice>
        )}
        {isLoading ? (
          <LoadingState className="mt-5" label="正在读取小说项目…" />
        ) : projects.length ? (
          <div
            className={`mt-5 grid gap-3 ${projects.length === 1 ? "grid-cols-1" : "md:grid-cols-2 xl:grid-cols-3"}`}
          >
            {projects.map((project) => (
              <Link
                key={project.id}
                to={`/projects/${project.id}`}
                className="group rounded-xl border border-line bg-surface-raised p-5 shadow-control transition hover:-translate-y-0.5 hover:border-line-strong hover:bg-surface-muted hover:shadow-card"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="text-xs font-medium text-rust">
                    {project.shortDramaType}
                  </span>
                  <span className="text-xs text-muted">
                    版本 {project.version + 1}
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-semibold tracking-tight text-ink group-hover:text-rust">
                  {project.title}
                </h3>
                <p className="mt-2 line-clamp-2 min-h-12 text-sm leading-6 text-muted">
                  {project.synopsis || "尚未填写项目简介"}
                </p>
                <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4 text-sm">
                  <span className="text-muted">
                    {project.targetWordCount
                      ? `目标 ${project.targetWordCount} 字`
                      : "尚未设置目标字数"}
                  </span>
                  <span className="font-medium text-rust">进入 AI 创作 →</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            className="mt-5"
            title="还没有可写作的小说项目"
            description="提供创意或导入已有来源，由 AI 提出方案并生成小说。"
            action={
              <Button asChild variant="primary">
                <Link to="/write/new">创建第一个小说</Link>
              </Button>
            }
          />
        )}
      </section>
    </div>
  );
}

export function NovelQuickStart() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const session = useStudioSession();
  const navigate = useNavigate();
  const location = useLocation();
  const requestedMode = new URLSearchParams(location.search).get("mode");
  const restored =
    session.creationDraft?.projectMode === "series_longform"
      ? session.creationDraft
      : undefined;
  const initialSource =
    requestedMode === "source"
      ? "source-import"
      : (restored?.creationSource ?? "inspiration");
  const initialBrief =
    restored?.brief ?? projectModeBrief("series_longform", initialSource);
  const [mode, setMode] = useState<"inspiration" | "source">(
    initialSource === "source-import" ? "source" : "inspiration",
  );
  const [title, setTitle] = useState(initialBrief.title);
  const [idea, setIdea] = useState(initialBrief.idea);
  const [genre, setGenre] = useState<string>(initialBrief.shortDramaType);
  const [storyPresetId, setStoryPresetId] = useState<
    NovelStoryPresetId | undefined
  >(() =>
    novelStoryPreset(restored?.storyPresetId as NovelStoryPresetId)
      ? (restored?.storyPresetId as NovelStoryPresetId)
      : undefined,
  );
  const [replaceOtherDraft, setReplaceOtherDraft] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const conflictingDraft = Boolean(
    session.creationDraft &&
    session.creationDraft.projectMode !== "series_longform" &&
    !replaceOtherDraft,
  );

  const persist = (values: {
    nextMode?: "inspiration" | "source";
    nextTitle?: string;
    nextIdea?: string;
    nextGenre?: string;
    nextPresetId?: NovelStoryPresetId;
  }) => {
    const nextMode = values.nextMode ?? mode;
    const source = nextMode === "source" ? "source-import" : "inspiration";
    const brief = projectModeBrief("series_longform", source, {
      ...initialBrief,
      title: values.nextTitle ?? title,
      idea: values.nextIdea ?? idea,
      shortDramaType: values.nextGenre ?? genre,
    });
    brief.shortDramaType = values.nextGenre ?? genre;
    const base = createCreationDraft(
      "novel-quick-start",
      "series_longform",
      source,
    );
    session.saveCreationDraft({
      ...base,
      ...restored,
      projectMode: "series_longform",
      creationSource: source,
      brief,
      storyPresetId: values.nextPresetId,
      scriptDraft: "",
      creatorTopic: "",
      origin: "novel-quick-start",
      updatedAt: new Date().toISOString(),
    });
  };

  const create = async (): Promise<void> => {
    if (!title.trim()) return;
    setSaving(true);
    setError(undefined);
    let project: Project | undefined;
    try {
      let draft = defaultProductionBrief(
        mode === "source" ? "source-import" : "inspiration",
      );
      draft.title = title.trim();
      draft.idea = idea.trim();
      draft.shortDramaType = genre || "都市情感";
      const preset =
        mode === "inspiration" ? novelStoryPreset(storyPresetId) : undefined;
      if (preset) draft = applyNovelStoryPresetToBrief(draft, preset);
      const modeConfig = projectModeConfigFromDraft(
        "series_longform",
        draft.creationSource,
        draft,
        "",
      );
      if (!modeConfig) throw new Error("系列长篇规模设置无效。");
      const attemptId = session.creationDraft?.attemptId ?? crypto.randomUUID();
      session.saveCreationDraft(
        {
          ...(session.creationDraft ??
            createCreationDraft(
              "novel-quick-start",
              "series_longform",
              draft.creationSource,
            )),
          brief: draft,
          storyPresetId,
          attemptId,
          updatedAt: new Date().toISOString(),
        },
        true,
      );
      project = (
        await client.projects.create(
          preset
            ? projectInputFromStoryPreset(draft, preset, modeConfig)
            : projectInputFromBrief(draft, modeConfig),
          attemptId,
        )
      ).project;
      session.saveCreationDraft(
        {
          ...(session.creationDraft ??
            createCreationDraft(
              "novel-quick-start",
              "series_longform",
              draft.creationSource,
            )),
          brief: draft,
          storyPresetId,
          attemptId,
          createdProjectId: project.id,
          updatedAt: new Date().toISOString(),
        },
        true,
      );
      try {
        const initialized = await initializeProjectMaterials(client, {
          project,
          brief: draft,
          preset,
        });
        session.saveCreationDraft(
          {
            ...(session.creationDraft ??
              createCreationDraft(
                "novel-quick-start",
                "series_longform",
                draft.creationSource,
              )),
            brief: draft,
            storyPresetId,
            attemptId,
            createdProjectId: project.id,
            initializationSteps: initialized.steps,
            updatedAt: new Date().toISOString(),
          },
          true,
        );
        if (initialized.chapterId)
          window.localStorage.setItem(
            `dramaip-novel-last-chapter:${project.id}`,
            initialized.chapterId,
          );
      } catch (cause) {
        if (cause instanceof ProjectInitializationError)
          session.saveCreationDraft(
            {
              ...(session.creationDraft ??
                createCreationDraft(
                  "novel-quick-start",
                  "series_longform",
                  draft.creationSource,
                )),
              brief: draft,
              storyPresetId,
              attemptId,
              createdProjectId: project.id,
              initializationSteps: cause.steps,
              updatedAt: new Date().toISOString(),
            },
            true,
          );
        throw cause;
      }
      if (mode === "source") {
        session.clearCreationDraft();
        await queryClient.invalidateQueries({ queryKey: ["projects"] });
        navigate(`/projects/${project.id}/tools/import`);
        return;
      }
      session.clearCreationDraft();
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${project.id}`);
    } catch (cause) {
      setError(
        project
          ? `${message(cause)} 项目和已完成资料均已保留，可安全重试。`
          : message(cause),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 py-4">
      <Button variant="ghost" size="sm" onClick={() => navigate("/write")}>
        ← 返回小说写作
      </Button>
      <section className="rounded-xl border border-line bg-surface p-6 shadow-card">
        <p className="studio-eyebrow">快速开始</p>
        <h1 className="mt-2 text-2xl font-semibold">创建小说项目</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          起一个作品名即可开始。人物、大纲和制作设置都可以稍后补充。
        </p>
        {conflictingDraft && (
          <InlineNotice className="mt-4" tone="warning">
            你还有一份其他模式的未完成创作草稿。可以返回项目首页继续，或明确开始新的系列长篇；系统不会静默覆盖它。
            <span className="mt-3 flex flex-wrap gap-2">
              <Button asChild size="sm" variant="secondary">
                <Link to="/">继续原草稿</Link>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  session.clearCreationDraft();
                  setReplaceOtherDraft(true);
                }}
              >
                开始新的系列长篇
              </Button>
            </span>
          </InlineNotice>
        )}
        {!conflictingDraft && (
          <>
            <div className="mt-5 grid grid-cols-2 gap-2 rounded-lg bg-surface-muted p-1.5">
              {(
                [
                  ["inspiration", "从灵感开始"],
                  ["source", "导入已有原著"],
                ] as const
              ).map(([value, label]) => (
                <BareButton
                  key={value}
                  className={`rounded-md px-3 py-2.5 text-sm font-medium ${mode === value ? "bg-surface-raised text-brand shadow-control" : "text-muted hover:text-ink"}`}
                  onClick={() => {
                    setMode(value);
                    if (value === "source") {
                      setStoryPresetId(undefined);
                      setGenre("都市情感");
                    }
                    persist({
                      nextMode: value,
                      nextGenre: value === "source" ? "都市情感" : genre,
                      nextPresetId: undefined,
                    });
                  }}
                >
                  {label}
                </BareButton>
              ))}
            </div>
            <div className="mt-5 space-y-4">
              <label className="grid gap-1.5 text-sm font-medium">
                作品名称
                <Input
                  autoFocus
                  aria-label="作品名称"
                  value={title}
                  placeholder="例如：雨夜归来"
                  onChange={(event) => {
                    setTitle(event.target.value);
                    persist({
                      nextTitle: event.target.value,
                      nextPresetId: storyPresetId,
                    });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) void create();
                  }}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                一句话灵感（可选）
                <Textarea
                  className="min-h-24"
                  aria-label="一句话灵感"
                  value={idea}
                  placeholder="例如：失踪三年的姐姐在雨夜寄来一封来自明天的信。"
                  onChange={(event) => {
                    setIdea(event.target.value);
                    persist({
                      nextIdea: event.target.value,
                      nextPresetId: storyPresetId,
                    });
                  }}
                />
              </label>
              {mode === "inspiration" && (
                <NovelStoryPresetPicker
                  selectedId={storyPresetId}
                  onSelect={(id) => {
                    const preset = novelStoryPreset(id);
                    if (!preset) return;
                    setStoryPresetId(id);
                    setGenre(preset.label);
                    persist({ nextGenre: preset.label, nextPresetId: id });
                  }}
                  onClear={() => {
                    setStoryPresetId(undefined);
                    setGenre("都市情感");
                    persist({ nextGenre: "都市情感", nextPresetId: undefined });
                  }}
                />
              )}
              <fieldset>
                <legend className="text-sm font-medium">题材（可选）</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {NOVEL_GENRE_CHOICES.map((item) => (
                    <BareButton
                      key={item}
                      type="button"
                      aria-pressed={genre === item}
                      className={`rounded-full border px-3 py-1.5 text-sm ${genre === item ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:border-line-strong hover:text-ink"}`}
                      onClick={() => {
                        setStoryPresetId(undefined);
                        setGenre(item);
                        persist({ nextGenre: item, nextPresetId: undefined });
                      }}
                    >
                      {item}
                    </BareButton>
                  ))}
                </div>
              </fieldset>
            </div>
            {mode === "source" && (
              <p className="mt-5 rounded-lg bg-brand-soft/50 p-3 text-sm text-muted">
                项目创建后会直接进入本地文件导入向导；确认预览和内容权利前不会写入章节。
              </p>
            )}
            {error && (
              <InlineNotice className="mt-5" tone="danger">
                {error}
              </InlineNotice>
            )}
            <div className="mt-6 flex justify-end">
              <Button
                variant="primary"
                loading={saving}
                disabled={saving || !title.trim()}
                onClick={() => void create()}
              >
                {saving
                  ? "正在创建…"
                  : mode === "source"
                    ? "创建并导入原著"
                    : "创建并进入 AI 工作台"}
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
