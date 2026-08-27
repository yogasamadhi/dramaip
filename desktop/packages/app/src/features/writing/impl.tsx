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
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  defaultProductionBrief,
  projectInputFromBrief,
} from "../../project-intake";
import {
  NOVEL_GENRE_CHOICES,
  WorkspaceIntro,
  message,
  useStudio,
} from "../../studio-shared";
import { NovelStoryPresetPicker } from "../novel/NovelStoryPresetPicker";
import {
  applyNovelStoryPresetToBrief,
  initializeStoryPresetMaterials,
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
              选择一个项目后直接进入章节正文编辑器。
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
                  <span className="font-medium text-rust">进入正文写作 →</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            className="mt-5"
            title="还没有可写作的小说项目"
            description="先从灵感创建项目，或导入已有原著开始写作。"
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
  const navigate = useNavigate();
  const location = useLocation();
  const requestedMode = new URLSearchParams(location.search).get("mode");
  const [mode, setMode] = useState<"inspiration" | "source">(
    requestedMode === "source" ? "source" : "inspiration",
  );
  const [title, setTitle] = useState("");
  const [idea, setIdea] = useState("");
  const [genre, setGenre] = useState<string>("都市情感");
  const [storyPresetId, setStoryPresetId] = useState<NovelStoryPresetId>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const cleanup = async (project: Project): Promise<void> => {
    try {
      await client.projects.trash(project.id);
      await client.projects.purge(project.id, project.title);
    } catch {
      // The creation error remains authoritative; cleanup is best-effort only.
    }
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
      const modeConfig = {
        mode: "series_longform" as const,
        targetChapterCount: 300,
        targetSeasonCount: 5,
        targetEpisodesPerSeason: 80,
      };
      project = (
        await client.projects.create(
          preset
            ? projectInputFromStoryPreset(draft, preset, modeConfig)
            : projectInputFromBrief(draft, modeConfig),
        )
      ).project;
      if (mode === "source") {
        navigate(`/projects/${project.id}/tools/import`);
        return;
      }
      const chapter = preset
        ? await initializeStoryPresetMaterials(client, project.id, preset, idea)
        : await client.chapters.create({
            projectId: project.id,
            title: "第 1 章",
            summary: "",
            content: "",
          });
      window.localStorage.setItem(
        `dramaip-novel-last-chapter:${project.id}`,
        chapter.id,
      );
      navigate(`/projects/${project.id}`);
    } catch (cause) {
      if (project) await cleanup(project);
      setError(message(cause));
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
              onChange={(event) => setTitle(event.target.value)}
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
              onChange={(event) => setIdea(event.target.value)}
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
              }}
              onClear={() => {
                setStoryPresetId(undefined);
                setGenre("都市情感");
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
                : "创建并开始写作"}
          </Button>
        </div>
      </section>
    </div>
  );
}
