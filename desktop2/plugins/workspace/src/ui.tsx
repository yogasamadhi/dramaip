import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";

import type { UiContribution } from "@dramaip/plugin-api";
import { confirmDialog } from "@dramaip/ui";
import {
  EmptyPanel,
  ErrorPanel,
  LoadingPanel,
  useStudioClient,
  useUiSlots,
} from "@dramaip/ui-shared";

import type {
  Project,
  ProjectPackage,
  SourceImportCandidate,
  SourceImportPreview,
} from "./contracts.ts";

type ProjectPage = { items: Project[]; nextCursor?: string };
type CreationMode = Project["creationMode"];

function ProjectLibraryPage() {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [packagePreview, setPackagePreview] = useState<{
    id: string;
    projectName: string;
  }>();
  const projects = useQuery({
    queryKey: ["workspace", "projects"],
    queryFn: () => client.request<ProjectPage>("/api/v2/workspace/projects"),
  });
  const previewPackage = useMutation({
    mutationFn: async () => {
      const selected = await window.dramaip.files.select({
        extensions: ["json"],
      });
      if (!selected) return undefined;
      return client.request<{ id: string; projectName: string }>(
        "/api/v2/workspace/project-packages/actions/preview",
        {
          method: "POST",
          body: JSON.stringify({ capability: selected.capability }),
        },
      );
    },
    onSuccess: (value) => setPackagePreview(value),
  });
  const commitPackage = useMutation({
    mutationFn: () =>
      client.request<Project>(
        `/api/v2/workspace/project-packages/${packagePreview!.id}/actions/commit`,
        {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({}),
        },
      ),
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({
        queryKey: ["workspace", "projects"],
      });
      navigate(`/projects/${project.id}`);
    },
  });
  const createSample = useMutation({
    mutationFn: async () => {
      const project = await client.request<Project>(
        "/api/v2/workspace/projects",
        {
          method: "POST",
          body: JSON.stringify({
            name: "示例短剧：雨夜归来",
            description: "摄影师林晚在雨夜遇见自称失忆的陆沉。",
            synopsis:
              "摄影师林晚在雨夜遇见自称失忆的陆沉，却发现他掌握着三年前失踪案的关键证据。",
            genre: "都市悬疑情感",
            creationMode: "inspiration",
            targetWordCount: 80_000,
            targetEpisodeCount: 24,
            initialScript: null,
          }),
        },
      );
      for (const [index, chapter] of [
        [
          "第一章：雨夜敲门",
          "暴雨吞没了巷口的霓虹。林晚打开门，门外的男人浑身湿透。",
        ],
        ["第二章：旧照片", "泛黄照片背后写着一个她从未见过的日期。"],
        ["第三章：无人接听", "电话响到第七声，对面只传来列车经过的轰鸣。"],
      ].entries()) {
        await client.request(
          `/api/v2/writing/projects/${project.id}/chapters`,
          {
            method: "POST",
            body: JSON.stringify({
              title: chapter[0],
              content: chapter[1],
              ordinal: index,
            }),
          },
        );
      }
      return project;
    },
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["workspace", "projects"] }),
  });
  return (
    <section className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">本地项目库</p>
          <h1>项目工作台</h1>
          <p>创建、导入和管理创作项目，从已有内容继续推进下一步工作。</p>
        </div>
        <Link className="page-header-action" to="/projects/trash">
          项目管理
        </Link>
      </header>
      {(previewPackage.error || commitPackage.error) && (
        <ErrorPanel error={previewPackage.error ?? commitPackage.error} />
      )}
      {packagePreview && (
        <div className="notice-card">
          <div>
            <strong>准备导入：{packagePreview.projectName}</strong>
            <small>项目将获得新的身份，不读取 Desktop 数据。</small>
          </div>
          <button
            className="primary-button"
            onClick={() => commitPackage.mutate()}
            disabled={commitPackage.isPending}
          >
            确认导入
          </button>
        </div>
      )}
      <section className="start-section" aria-labelledby="start-heading">
        <div className="section-heading">
          <div>
            <h2 id="start-heading">选择开始方式</h2>
            <p>
              先选择你手里的内容，再补齐可编辑的生产简报。不会要求选择模型、智能任务或服务商。
            </p>
          </div>
          <button
            className="secondary-button"
            disabled={createSample.isPending}
            onClick={() => createSample.mutate()}
          >
            创建示例项目
          </button>
        </div>
        <div className="start-choice-grid">
          <Link className="start-choice-card" to="/write/new?mode=inspiration">
            <strong>从灵感开始</strong>
            <small>先保存故事构思和试制方向，再逐步补全人物与章节。</small>
            <span>首个产出：可继续完善的生产简报</span>
          </Link>
          <Link
            className="start-choice-card"
            to="/write/new?mode=source-import"
          >
            <strong>导入原著</strong>
            <small>
              导入你拥有权利的小说或 IP；文件会先预览，确认授权后才写入。
            </small>
            <span>首个产出：可审查的原著导入预览</span>
          </Link>
          <Link
            className="start-choice-card"
            to="/write/new?mode=script-import"
          >
            <strong>直接导入 / 粘贴剧本</strong>
            <small>
              已有剧本可直接粘贴为首集草稿，也可选择文件进入同一预览流程。
            </small>
            <span>首个产出：可编辑的首集剧本草稿</span>
          </Link>
        </div>
      </section>
      <section className="package-import-card">
        <div>
          <h2>导入新版项目包</h2>
          <p>
            导入由 DramaIP 新版导出的项目
            JSON。系统会先预览，再创建一个新的独立项目；不会读取旧版数据库。
          </p>
        </div>
        <button
          className="secondary-button"
          onClick={() => previewPackage.mutate()}
        >
          选择项目包
        </button>
      </section>
      <div className="section-heading project-list-heading">
        <div>
          <p className="eyebrow">本地项目库</p>
          <h2>项目</h2>
        </div>
        <p>
          {projects.data?.items.length ?? 0} 个　
          <Link to="/projects/trash">查看回收站</Link>
        </p>
      </div>
      {projects.isLoading ? (
        <LoadingPanel />
      ) : projects.error ? (
        <ErrorPanel error={projects.error} />
      ) : (
        <div className="project-library-list">
          {projects.data?.items.map((project) => (
            <Link
              className="project-card"
              key={project.id}
              to={`/projects/${project.id}`}
            >
              <span className="card-kicker">{project.genre}</span>
              <h2>{project.name}</h2>
              <p>
                {project.synopsis || project.description || "尚未填写项目简介"}
              </p>
              <small>
                {String(projects.data.items.indexOf(project) + 1).padStart(
                  2,
                  "0",
                )}
              </small>
              <span className="project-card-action">继续写作 →</span>
            </Link>
          ))}
          {!projects.data?.items.length && (
            <EmptyPanel>还没有项目，创建第一个故事吧。</EmptyPanel>
          )}
        </div>
      )}
      {createSample.error && <ErrorPanel error={createSample.error} />}
    </section>
  );
}

function CreateProjectPage() {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedMode = searchParams.get("mode");
  const [mode, setMode] = useState<CreationMode>(() =>
    requestedMode === "source-import" || requestedMode === "script-import"
      ? requestedMode
      : "inspiration",
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const [genre, setGenre] = useState("都市情感");
  const [targetWordCount, setTargetWordCount] = useState(100_000);
  const [initialScript, setInitialScript] = useState("");
  const [preview, setPreview] = useState<SourceImportPreview>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const create = useMutation({
    mutationFn: async () => {
      const project = await client.request<Project>(
        "/api/v2/workspace/projects",
        {
          method: "POST",
          body: JSON.stringify({
            name,
            description,
            synopsis,
            genre,
            creationMode: mode,
            targetWordCount,
            targetEpisodeCount: 0,
            initialScript: mode === "script-import" ? initialScript : null,
          }),
        },
      );
      if (mode === "script-import" && initialScript.trim()) {
        await client.request(
          `/api/v2/writing/projects/${project.id}/chapters`,
          {
            method: "POST",
            body: JSON.stringify({ title: "剧本导入", content: initialScript }),
          },
        );
      }
      if (mode !== "source-import") return { project };
      const file = await window.dramaip.files.select({
        extensions: ["txt", "md", "docx"],
      });
      if (!file) return { project };
      const sourcePreview = await client.request<SourceImportPreview>(
        "/api/v2/workspace/source-imports/actions/preview",
        {
          method: "POST",
          body: JSON.stringify({
            projectId: project.id,
            capability: file.capability,
          }),
        },
      );
      return { project, preview: sourcePreview };
    },
    onSuccess: async ({ project, preview: sourcePreview }) => {
      await queryClient.invalidateQueries({
        queryKey: ["workspace", "projects"],
      });
      if (sourcePreview) {
        setPreview(sourcePreview);
        setSelected(
          new Set(
            sourcePreview.candidates
              .filter((item) => item.selectedByDefault)
              .map((item) => item.id),
          ),
        );
      } else navigate(`/projects/${project.id}`);
    },
  });
  const commit = useMutation({
    mutationFn: () =>
      client.request(
        `/api/v2/workspace/source-imports/${preview!.id}/actions/commit`,
        {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({
            rightsConfirmed,
            selectedCandidateIds: [...selected],
          }),
        },
      ),
    onSuccess: () => navigate(`/projects/${preview!.projectId}`),
  });
  if (preview) {
    return (
      <section className="page-stack">
        <header className="page-header">
          <div>
            <p className="eyebrow">原著导入预览</p>
            <h1>{preview.fileName}</h1>
            <p>
              已解析 {preview.charCount.toLocaleString("zh-CN")} 字、
              {preview.chapters.length} 个章节。只会采用你勾选的候选。
            </p>
          </div>
        </header>
        <div className="candidate-grid">
          {preview.candidates.map((candidate) => (
            <label className="candidate-card" key={candidate.id}>
              <input
                type="checkbox"
                checked={selected.has(candidate.id)}
                onChange={(event) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(candidate.id);
                    else next.delete(candidate.id);
                    return next;
                  })
                }
              />
              <span>
                <strong>{candidate.title}</strong>
                <small>{candidateLabel(candidate)}</small>
              </span>
            </label>
          ))}
        </div>
        <label className="rights-confirmation">
          <input
            type="checkbox"
            checked={rightsConfirmed}
            onChange={(event) => setRightsConfirmed(event.target.checked)}
          />
          我确认拥有该原著的合法使用或改编权利，并同意将所选内容写入本地项目。
        </label>
        {commit.error && <ErrorPanel error={commit.error} />}
        <div className="button-row">
          <button
            className="secondary-button"
            onClick={() => navigate(`/projects/${preview.projectId}`)}
          >
            暂不采用
          </button>
          <button
            className="primary-button"
            disabled={!rightsConfirmed || commit.isPending}
            onClick={() => commit.mutate()}
          >
            采用所选内容
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className="narrow-page create-flow">
      <p className="eyebrow">新建小说项目</p>
      <h1>选择创作起点</h1>
      <div className="mode-grid">
        {(
          [
            [
              "inspiration",
              "从灵感开始",
              "填写创作简报，从人物和大纲开始搭建。",
            ],
            [
              "source-import",
              "导入原著",
              "读取 TXT、Markdown 或 DOCX，预览后选择性采用。",
            ],
            [
              "script-import",
              "粘贴剧本",
              "把现有剧本文本作为第一章进入写作台。",
            ],
          ] as const
        ).map(([value, label, detail]) => (
          <button
            type="button"
            className={mode === value ? "mode-card active" : "mode-card"}
            key={value}
            onClick={() => setMode(value)}
          >
            <strong>{label}</strong>
            <small>{detail}</small>
          </button>
        ))}
      </div>
      <form
        className="form-card"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <div className="form-grid">
          <label>
            项目名称
            <input
              required
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            类型
            <input
              value={genre}
              onChange={(event) => setGenre(event.target.value)}
            />
          </label>
        </div>
        <label>
          一句话创意
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="主角、欲望与核心阻力"
          />
        </label>
        <label>
          故事简介
          <textarea
            rows={5}
            value={synopsis}
            onChange={(event) => setSynopsis(event.target.value)}
          />
        </label>
        <label>
          目标字数
          <input
            type="number"
            min={0}
            max={20_000_000}
            value={targetWordCount}
            onChange={(event) => setTargetWordCount(Number(event.target.value))}
          />
        </label>
        {mode === "script-import" && (
          <label>
            剧本文本
            <textarea
              rows={12}
              required
              value={initialScript}
              onChange={(event) => setInitialScript(event.target.value)}
              placeholder="粘贴现有剧本或章节内容…"
            />
          </label>
        )}
        {mode === "source-import" && (
          <p className="security-note">
            创建项目后会弹出系统文件选择器。本机路径不会进入 Renderer
            请求或数据库。
          </p>
        )}
        {create.error && <ErrorPanel error={create.error} />}
        <button
          className="primary-button"
          disabled={create.isPending || !name.trim()}
        >
          {create.isPending
            ? "正在创建…"
            : mode === "source-import"
              ? "创建并选择原著"
              : "创建并进入项目"}
        </button>
      </form>
    </section>
  );
}

function candidateLabel(candidate: SourceImportCandidate): string {
  return {
    character: "人物候选",
    scene: "场景候选",
    prop: "道具候选",
    "chapter-summary": "章节摘要",
    "adaptation-suggestion": "创作建议",
  }[candidate.kind];
}

function ProjectPage() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const client = useStudioClient();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sections = useUiSlots("project.section");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const [genre, setGenre] = useState("");
  const [targetWordCount, setTargetWordCount] = useState(0);
  const project = useQuery({
    queryKey: ["workspace", "project", projectId],
    queryFn: () =>
      client.requestWithMetadata<Project>(
        `/api/v2/workspace/projects/${projectId}`,
      ),
    enabled: Boolean(projectId),
  });
  const remove = useMutation({
    mutationFn: () =>
      client.request(`/api/v2/workspace/projects/${projectId}`, {
        method: "DELETE",
        headers: { "if-match": project.data!.response.headers.get("etag")! },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["workspace", "projects"],
      });
      navigate("/");
    },
  });
  useEffect(() => {
    if (!project.data?.data) return;
    setName(project.data.data.name);
    setSynopsis(project.data.data.synopsis);
    setGenre(project.data.data.genre);
    setTargetWordCount(project.data.data.targetWordCount);
  }, [project.data?.data.version]);
  const update = useMutation({
    mutationFn: () =>
      client.request<Project>(`/api/v2/workspace/projects/${projectId}`, {
        method: "PATCH",
        headers: { "if-match": project.data!.response.headers.get("etag")! },
        body: JSON.stringify({ name, synopsis, genre, targetWordCount }),
      }),
    onSuccess: async () => {
      setEditing(false);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["workspace", "project", projectId],
        }),
        queryClient.invalidateQueries({ queryKey: ["workspace", "projects"] }),
      ]);
    },
  });
  const exportPackage = async () => {
    const value = await client.request<ProjectPackage>(
      `/api/v2/workspace/projects/${projectId}/exports/project-package`,
    );
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${value.project.name}.dramaip-next.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  if (project.isLoading) return <LoadingPanel />;
  if (project.error || !project.data)
    return <ErrorPanel error={project.error} />;
  const activeTool = searchParams.get("section") ?? "overview";
  const toolNavigation = [
    ["overview", "总览"],
    ["import", "导入内容"],
    ["review", "导入审阅"],
    ["dashboard", "项目驾驶舱"],
    ["pilot", "试制计划"],
    ["series", "系列资料"],
  ] as const;
  if (activeTool === "overview") {
    const tools = [
      ["import", "导入内容", "随时可用"],
      ["review", "导入审阅", "暂无待办"],
      ["dashboard", "项目驾驶舱", "数据已就绪"],
      ["pilot", "试制计划", "可以试制"],
      ["series", "系列资料", "数据已就绪"],
    ] as const;
    return (
      <section className="project-tools-workspace">
        <header className="project-tools-header">
          <Link to={`/projects/${projectId}`}>← 返回写作</Link>
          <div>
            <small>{project.data.data.name}</small>
            <strong>项目工具</strong>
          </div>
          <nav aria-label="项目工具导航">
            {toolNavigation.map(([key, label]) => (
              <Link
                className={key === activeTool ? "active" : ""}
                key={key}
                to={`/projects/${projectId}/tools?section=${key}`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="project-tools-content">
          <p className="eyebrow">按需打开</p>
          <h1>项目工具</h1>
          <p>这些工具不再占用正文工作区。这里只保留状态和当前唯一下一步。</p>
          <Link
            className="recommended-tool"
            to={`/projects/${projectId}/tools?section=dashboard`}
          >
            <span>
              <small>推荐下一步</small>
              <strong>项目驾驶舱</strong>
            </span>
            <b>现在处理 →</b>
          </Link>
          <div className="project-tool-list">
            {tools.map(([key, label, status]) => (
              <Link
                key={key}
                to={`/projects/${projectId}/tools?section=${key}`}
              >
                <strong>{label}</strong>
                <span>{status}</span>
                <small>待处理 0</small>
                <b>打开 →</b>
              </Link>
            ))}
          </div>
        </main>
      </section>
    );
  }
  return (
    <section className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">{project.data.data.genre} · 小说项目</p>
          <h1>{project.data.data.name}</h1>
          <p>
            {project.data.data.synopsis ||
              project.data.data.description ||
              "为这个故事补充创作简介。"}
          </p>
        </div>
        <div className="button-row">
          <button className="secondary-button" onClick={() => setEditing(true)}>
            编辑项目
          </button>
          <button
            className="secondary-button"
            onClick={() => void exportPackage()}
          >
            导出项目包
          </button>
          <button
            className="danger-button"
            onClick={async () => {
              if (
                await confirmDialog({
                  title: "移到回收站",
                  description: `将「${project.data.data.name}」移到回收站？之后仍可恢复。`,
                  confirmLabel: "移到回收站",
                  tone: "danger",
                })
              ) {
                remove.mutate();
              }
            }}
          >
            移到回收站
          </button>
        </div>
      </header>
      {(remove.error || update.error) && (
        <ErrorPanel error={remove.error ?? update.error} />
      )}
      {editing && (
        <form
          className="form-card project-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            update.mutate();
          }}
        >
          <div className="form-grid">
            <label>
              项目名称
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              类型
              <input
                value={genre}
                onChange={(event) => setGenre(event.target.value)}
              />
            </label>
          </div>
          <label>
            故事简介
            <textarea
              rows={4}
              value={synopsis}
              onChange={(event) => setSynopsis(event.target.value)}
            />
          </label>
          <label>
            目标字数
            <input
              type="number"
              min={0}
              max={20_000_000}
              value={targetWordCount}
              onChange={(event) =>
                setTargetWordCount(Number(event.target.value))
              }
            />
          </label>
          <div className="button-row">
            <button className="primary-button" disabled={!name.trim()}>
              保存项目
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setEditing(false)}
            >
              取消
            </button>
          </div>
        </form>
      )}
      <div className="project-metrics">
        <span>
          <strong>
            {project.data.data.targetWordCount.toLocaleString("zh-CN")}
          </strong>
          目标字数
        </span>
        <span>
          <strong>{project.data.data.creationMode}</strong>创建路径
        </span>
        <span>
          <strong>v{project.data.data.version}</strong>项目版本
        </span>
      </div>
      <div className="tool-grid">
        {sections.map(({ id, Component }) => (
          <Component key={id} />
        ))}
      </div>
    </section>
  );
}

function ProjectHeaderLeading() {
  const client = useStudioClient();
  const location = useLocation();
  const projectId = /^\/projects\/([0-9a-f-]{36})(?:\/|$)/iu.exec(
    location.pathname,
  )?.[1];
  const project = useQuery({
    queryKey: ["workspace", "project-header", projectId],
    queryFn: () =>
      client.request<Project>(`/api/v2/workspace/projects/${projectId}`),
    enabled: Boolean(projectId),
  });
  const writing = useQuery({
    queryKey: ["workspace", "project-chapter-count", projectId],
    queryFn: () =>
      client.request<{ chapters: unknown[] }>(
        `/api/v2/writing/projects/${projectId}/workspace`,
      ),
    enabled: Boolean(projectId),
  });
  return (
    <div className="project-header-leading">
      <Link to="/" aria-label="返回项目列表">
        ← 小说
      </Link>
      <div>
        <strong>{project.data?.name ?? "项目"}</strong>
        <small>
          {Array.isArray(writing.data?.chapters)
            ? `${writing.data.chapters.length} 章`
            : "正在加载项目"}
        </small>
      </div>
    </div>
  );
}

function ProjectHeaderActions() {
  const location = useLocation();
  const projectId = /^\/projects\/([0-9a-f-]{36})(?:\/|$)/iu.exec(
    location.pathname,
  )?.[1];
  return (
    <div className="project-header-actions">
      <Link className="project-header-tool" to={`/projects/${projectId}/tools`}>
        项目工具
      </Link>
      <Link
        className="secondary-button"
        to={`/projects/${projectId}/tools/import`}
      >
        输入输出
      </Link>
    </div>
  );
}

function TrashPage() {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const trash = useQuery({
    queryKey: ["workspace", "trash"],
    queryFn: () =>
      client.request<ProjectPage>("/api/v2/workspace/projects/trash"),
  });
  const restore = useMutation({
    mutationFn: async (project: Project) =>
      client.request<Project>(
        `/api/v2/workspace/projects/${project.id}/actions/restore`,
        {
          method: "POST",
          headers: {
            "if-match": `"v${project.version}"`,
            "idempotency-key": crypto.randomUUID(),
          },
        },
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspace", "trash"] }),
        queryClient.invalidateQueries({ queryKey: ["workspace", "projects"] }),
      ]);
    },
  });
  const purge = useMutation({
    mutationFn: (project: Project) =>
      client.request(`/api/v2/workspace/projects/${project.id}/actions/purge`, {
        method: "POST",
        headers: {
          "if-match": `"v${project.version}"`,
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ confirmation: project.name }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace", "trash"] });
    },
  });
  return (
    <section className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">项目管理</p>
          <h1>回收站</h1>
          <p>恢复项目，或在确认项目名称后永久删除。</p>
        </div>
      </header>
      {(trash.error || restore.error || purge.error) && (
        <ErrorPanel error={trash.error ?? restore.error ?? purge.error} />
      )}
      <div className="list-card">
        {trash.data?.items.map((project) => (
          <article className="list-row" key={project.id}>
            <div>
              <strong>{project.name}</strong>
              <small>v{project.version}</small>
            </div>
            <div className="button-row">
              <button
                className="secondary-button"
                onClick={() => restore.mutate(project)}
              >
                恢复
              </button>
              <button
                className="danger-button"
                onClick={async () => {
                  if (
                    await confirmDialog({
                      title: "永久删除项目",
                      description: `永久删除「${project.name}」及其全部小说数据？此操作不可恢复。`,
                      confirmLabel: "永久删除",
                      tone: "danger",
                    })
                  ) {
                    purge.mutate(project);
                  }
                }}
              >
                永久删除
              </button>
            </div>
          </article>
        ))}
        {!trash.data?.items.length && <EmptyPanel>回收站为空。</EmptyPanel>}
      </div>
    </section>
  );
}

export const workspaceUi: readonly UiContribution[] = [
  {
    kind: "route",
    id: "workspace.dashboard",
    pluginId: "workspace",
    path: "/",
    title: "工作台",
    component: async () => ({ default: ProjectLibraryPage }),
  },
  {
    kind: "route",
    id: "workspace.create",
    pluginId: "workspace",
    path: "/write/new",
    title: "创建项目",
    component: async () => ({ default: CreateProjectPage }),
  },
  {
    kind: "route",
    id: "workspace.project.tools",
    pluginId: "workspace",
    path: "/projects/:projectId/tools",
    title: "项目工具",
    component: async () => ({ default: ProjectPage }),
  },
  {
    kind: "route",
    id: "workspace.project.tool",
    pluginId: "workspace",
    path: "/projects/:projectId/tools/:toolKey",
    title: "项目工具",
    layout: "project-tools",
    component: async () => ({ default: ProjectPage }),
  },
  {
    kind: "route",
    id: "workspace.trash",
    pluginId: "workspace",
    path: "/projects/trash",
    title: "回收站",
    component: async () => ({ default: TrashPage }),
  },
  {
    kind: "navigation",
    id: "workspace.dashboard.navigation",
    pluginId: "workspace",
    section: "main",
    order: 10,
    label: "项目",
    to: "/",
  },
  {
    kind: "navigation",
    id: "workspace.settings.navigation",
    pluginId: "workspace",
    section: "project",
    order: 40,
    label: "设定",
    to: "/projects/:projectId/tools?section=settings",
  },
  {
    kind: "slot",
    id: "workspace.project.header.leading",
    pluginId: "workspace",
    slot: "project.header.leading",
    order: 10,
    component: async () => ({ default: ProjectHeaderLeading }),
  },
  {
    kind: "slot",
    id: "workspace.project.header.actions",
    pluginId: "workspace",
    slot: "project.header.actions",
    order: 10,
    component: async () => ({ default: ProjectHeaderActions }),
  },
];
