import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { Search, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";

import { ApiClientError } from "@dramaip/client";
import type { UiContribution } from "@dramaip/plugin-api";
import { confirmDialog } from "@dramaip/ui";
import {
  EmptyPanel,
  ErrorPanel,
  ChapterUiProvider,
  LoadingPanel,
  useStudioClient,
  useUiSlots,
} from "@dramaip/ui-shared";

import type { Chapter, ChapterVersion, WritingWorkspace } from "./contracts.ts";

interface DraftRecord {
  chapterId: string;
  baseVersion: number;
  title: string;
  content: string;
  savedAt: string;
}

const draftKey = (id: string) => `dramaip-next:chapter-draft:${id}`;

function markdownOf(editor: ReturnType<typeof useEditor>): string {
  return editor ? (editor.storage.markdown.getMarkdown() as string) : "";
}

function MarkdownEditor({
  value,
  onChange,
}: {
  value: string;
  onChange(value: string): void;
}) {
  const latestChange = useRef(onChange);
  latestChange.current = onChange;
  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({ html: false, tightLists: true }),
    ],
    content: value,
    onUpdate: ({ editor: current }) =>
      latestChange.current(current.storage.markdown.getMarkdown() as string),
  });
  useEffect(() => {
    if (!editor || markdownOf(editor) === value) return;
    editor.commands.setContent(value, false);
  }, [editor, value]);
  if (!editor) return <LoadingPanel label="正在装载 Markdown 编辑器…" />;
  return (
    <div className="markdown-editor">
      <div className="editor-toolbar">
        <button
          className={editor.isActive("bold") ? "active" : ""}
          title="粗体"
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          加粗
        </button>
        <button
          className={editor.isActive("italic") ? "active" : ""}
          title="斜体"
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          斜体
        </button>
        <button
          className={editor.isActive("heading", { level: 2 }) ? "active" : ""}
          title="小标题"
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          标题
        </button>
        <button
          className={editor.isActive("blockquote") ? "active" : ""}
          title="引用"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          引用
        </button>
        <button
          className={editor.isActive("bulletList") ? "active" : ""}
          title="列表"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          列表
        </button>
        <span />
        <label>
          字号
          <select aria-label="字号" defaultValue="中">
            <option>小</option>
            <option>中</option>
            <option>大</option>
          </select>
        </label>
        <label>
          行距
          <select aria-label="行距" defaultValue="舒适">
            <option>紧凑</option>
            <option>舒适</option>
            <option>宽松</option>
          </select>
        </label>
        <label>
          正文宽度
          <select aria-label="正文宽度" defaultValue="标准">
            <option>窄</option>
            <option>标准</option>
            <option>宽</option>
          </select>
        </label>
        <label className="typewriter-toggle">
          <input type="checkbox" />
          打字机滚动
        </label>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

function WritingHomePage() {
  const client = useStudioClient();
  const projects = useQuery({
    queryKey: ["workspace", "projects"],
    queryFn: () =>
      client.request<{
        items: Array<{
          id: string;
          name: string;
          synopsis: string;
          updatedAt: string;
        }>;
      }>("/api/v2/workspace/projects"),
  });
  return (
    <section className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">WRITING</p>
          <h1>小说写作</h1>
          <p>选择项目进入章节工作区，或创建一个新的故事。</p>
        </div>
        <Link className="primary-button" to="/write/new">
          创建项目
        </Link>
      </header>
      {projects.error && <ErrorPanel error={projects.error} />}
      <div className="card-grid">
        {projects.data?.items.map((project) => (
          <Link
            className="project-card"
            key={project.id}
            to={`/projects/${project.id}`}
          >
            <span className="card-kicker">继续写作</span>
            <h2>{project.name}</h2>
            <p>{project.synopsis || "进入章节工作区"}</p>
            <small>{new Date(project.updatedAt).toLocaleString("zh-CN")}</small>
          </Link>
        ))}
      </div>
    </section>
  );
}

function NovelWritingPage() {
  const { projectId } = useParams();
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const auxiliary = useUiSlots("chapter.auxiliary");
  const [selectedId, setSelectedId] = useState<string>();
  const [editingChapterId, setEditingChapterId] = useState<string>();
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState<
    "saved" | "saving" | "draft" | "conflict"
  >("saved");
  const [conflict, setConflict] = useState<{
    server?: Chapter;
    draft: DraftRecord;
  }>();
  const [rightOpen, setRightOpen] = useState(true);
  const [rightWidth, setRightWidth] = useState(() => {
    const stored = Number(localStorage.getItem("dramaip:writing:right-width"));
    return Number.isFinite(stored) && stored >= 280 && stored <= 560
      ? stored
      : 520;
  });
  const [rightTab, setRightTab] = useState("assistant");
  const [draggedId, setDraggedId] = useState<string>();
  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = rightWidth;
    const move = (pointerEvent: PointerEvent) =>
      setRightWidth(
        Math.min(
          560,
          Math.max(280, startWidth + startX - pointerEvent.clientX),
        ),
      );
    const stop = (pointerEvent: PointerEvent) => {
      const next = Math.min(
        560,
        Math.max(280, startWidth + startX - pointerEvent.clientX),
      );
      setRightWidth(next);
      localStorage.setItem("dramaip:writing:right-width", String(next));
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  const workspace = useQuery({
    queryKey: ["writing", "workspace", projectId],
    queryFn: () =>
      client.requestWithMetadata<WritingWorkspace>(
        `/api/v2/writing/projects/${projectId}/workspace`,
      ),
    enabled: Boolean(projectId),
  });
  const chapters = workspace.data?.data.chapters ?? [];
  const selected =
    chapters.find((chapter) => chapter.id === selectedId) ?? chapters[0];
  useEffect(() => {
    if (!selectedId && chapters[0]) setSelectedId(chapters[0].id);
  }, [chapters, selectedId]);
  const activateChapter = (chapter: Chapter) => {
    setSelectedId(chapter.id);
    setEditingChapterId(chapter.id);
    setTitle(chapter.title);
    const stored = localStorage.getItem(draftKey(chapter.id));
    const draft = stored ? (JSON.parse(stored) as DraftRecord) : undefined;
    if (draft && draft.content !== chapter.content) {
      setContent(draft.content);
      setTitle(draft.title.trim() ? draft.title : chapter.title);
      setSaveState("draft");
    } else {
      setContent(chapter.content);
      setSaveState("saved");
    }
  };
  useEffect(() => {
    if (!selected) return;
    activateChapter(selected);
  }, [selected?.id]);

  const updateCache = (chapter: Chapter) => {
    queryClient.setQueryData(
      ["writing", "workspace", projectId],
      (current: { data: WritingWorkspace; response: Response } | undefined) =>
        current
          ? {
              ...current,
              data: {
                ...current.data,
                chapters: current.data.chapters.map((item) =>
                  item.id === chapter.id ? chapter : item,
                ),
              },
            }
          : current,
    );
  };
  const save = async (manual: boolean) => {
    if (
      !selected ||
      editingChapterId !== selected.id ||
      (title === selected.title && content === selected.content && !manual)
    )
      return;
    setSaveState("saving");
    try {
      const result = await client.requestWithMetadata<Chapter>(
        manual
          ? `/api/v2/writing/chapters/${selected.id}/actions/save`
          : `/api/v2/writing/chapters/${selected.id}`,
        {
          method: manual ? "POST" : "PATCH",
          headers: {
            "if-match": `"v${selected.version}"`,
            ...(manual ? { "idempotency-key": crypto.randomUUID() } : {}),
          },
          body: JSON.stringify({ title, content }),
        },
      );
      updateCache(result.data);
      localStorage.removeItem(draftKey(selected.id));
      setSaveState("saved");
    } catch (error) {
      const draft: DraftRecord = {
        chapterId: selected.id,
        baseVersion: selected.version,
        title,
        content,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(draftKey(selected.id), JSON.stringify(draft));
      if (error instanceof ApiClientError && error.problem.status === 412) {
        setConflict({ draft });
        setSaveState("conflict");
      } else setSaveState("draft");
    }
  };
  useEffect(() => {
    if (
      !selected ||
      editingChapterId !== selected.id ||
      (title === selected.title && content === selected.content)
    )
      return;
    const draft: DraftRecord = {
      chapterId: selected.id,
      baseVersion: selected.version,
      title,
      content,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(draftKey(selected.id), JSON.stringify(draft));
    setSaveState("draft");
    const timeout = window.setTimeout(() => void save(false), 850);
    return () => window.clearTimeout(timeout);
  }, [selected?.id, selected?.version, editingChapterId, title, content]);

  const createChapter = useMutation({
    mutationFn: () =>
      client.request<Chapter>(
        `/api/v2/writing/projects/${projectId}/chapters`,
        {
          method: "POST",
          body: JSON.stringify({
            title: `第 ${chapters.length + 1} 章`,
            content: "",
          }),
        },
      ),
    onSuccess: async (chapter) => {
      await queryClient.invalidateQueries({
        queryKey: ["writing", "workspace", projectId],
      });
      setSelectedId(chapter.id);
    },
  });
  const deleteChapter = useMutation({
    mutationFn: (chapter: Chapter) =>
      client.request(`/api/v2/writing/chapters/${chapter.id}`, {
        method: "DELETE",
        headers: { "if-match": `"v${chapter.version}"` },
      }),
    onSuccess: async () => {
      setSelectedId(undefined);
      await queryClient.invalidateQueries({
        queryKey: ["writing", "workspace", projectId],
      });
    },
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) =>
      client.request<WritingWorkspace>(
        `/api/v2/writing/projects/${projectId}/chapters/actions/reorder`,
        {
          method: "POST",
          headers: {
            "if-match": `"v${workspace.data!.data.version}"`,
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({ chapterIds: ids }),
        },
      ),
    onSuccess: (value) =>
      queryClient.setQueryData(
        ["writing", "workspace", projectId],
        (current: { response: Response } | undefined) =>
          current ? { ...current, data: value } : current,
      ),
  });
  const visible = chapters.filter(
    (chapter) =>
      !search ||
      chapter.title
        .toLocaleLowerCase("zh-CN")
        .includes(search.toLocaleLowerCase("zh-CN")),
  );
  if (workspace.isLoading) return <LoadingPanel label="正在打开小说工作区…" />;
  if (workspace.error) return <ErrorPanel error={workspace.error} />;
  return (
    <section
      className={`writing-studio ${rightOpen ? "" : "right-collapsed"}`}
      style={{ "--assistant-width": `${rightWidth}px` } as CSSProperties}
    >
      <aside className="chapter-rail">
        <header>
          <label className="rail-search">
            <Search size={14} />
            <input
              aria-label="搜索章节"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索章节"
            />
          </label>
          <button
            className="primary-button rail-create-button"
            title="新建章节"
            onClick={() => createChapter.mutate()}
          >
            新建
          </button>
        </header>
        <p className="chapter-rail-summary">
          共 {chapters.length} 章 · 可拖拽排序
        </p>
        <div className="chapter-list">
          {visible.map((chapter) => (
            <button
              draggable
              onDragStart={() => setDraggedId(chapter.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (!draggedId || draggedId === chapter.id) return;
                const ids = chapters.map((item) => item.id);
                const from = ids.indexOf(draggedId);
                const to = ids.indexOf(chapter.id);
                ids.splice(to, 0, ...ids.splice(from, 1));
                reorder.mutate(ids);
                setDraggedId(undefined);
              }}
              className={
                chapter.id === selected?.id
                  ? "chapter-item active"
                  : "chapter-item"
              }
              key={chapter.id}
              onClick={() => activateChapter(chapter)}
            >
              <span>
                <strong>{chapter.title}</strong>
                <small>{chapter.wordCount} 字 · 无记忆</small>
              </span>
            </button>
          ))}
        </div>
        <footer>
          <button
            className="secondary-button"
            disabled={!selected}
            onClick={async () => {
              if (
                selected &&
                (await confirmDialog({
                  title: "删除章节",
                  description: `确定删除「${selected.title}」？章节将从当前项目移除。`,
                  confirmLabel: "删除章节",
                  tone: "danger",
                }))
              ) {
                deleteChapter.mutate(selected);
              }
            }}
          >
            <Trash2 size={14} /> 删除章节
          </button>
        </footer>
      </aside>
      <main className="chapter-canvas">
        {selected ? (
          <>
            <header className="chapter-header">
              <input
                className="chapter-title"
                aria-label="章节标题"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <div className={`save-state ${saveState}`}>
                {saveState === "saved"
                  ? "已保存"
                  : saveState === "saving"
                    ? "保存中…"
                    : saveState === "conflict"
                      ? "版本冲突"
                      : "本地草稿"}
              </div>
              <span className="chapter-word-goal">
                {[...content.replace(/\s/gu, "")].length} /{" "}
                {workspace.data?.data.wordGoal} 字
              </span>
              <button
                className="secondary-button"
                onClick={() => setRightTab("versions")}
              >
                版本记录
              </button>
              <button
                className="secondary-button"
                onClick={() => setRightTab("bible")}
              >
                章节要点
              </button>
              {!rightOpen && (
                <button
                  className="secondary-button"
                  title="展开智能写作侧栏"
                  onClick={() => setRightOpen(true)}
                >
                  展开智能写作
                </button>
              )}
              <div className="chapter-header-actions">
                <button
                  className="secondary-button"
                  onClick={() => setRightTab("versions")}
                >
                  修订预览
                </button>
                <button
                  className="secondary-button"
                  onClick={() => void save(true)}
                >
                  保存
                </button>
              </div>
            </header>
            {conflict && (
              <div className="conflict-banner">
                <strong>服务器章节已更新，你的草稿没有被覆盖。</strong>
                <div className="button-row">
                  <button
                    onClick={() => {
                      navigator.clipboard
                        .writeText(conflict.draft.content)
                        .catch(() => undefined);
                    }}
                  >
                    复制草稿
                  </button>
                  <button
                    onClick={async () => {
                      const latest = await client.request<Chapter>(
                        `/api/v2/writing/chapters/${selected.id}`,
                      );
                      updateCache(latest);
                      setContent(latest.content);
                      setTitle(latest.title);
                      setConflict(undefined);
                    }}
                  >
                    重新载入
                  </button>
                  <button onClick={() => setRightTab("versions")}>
                    查看差异
                  </button>
                </div>
              </div>
            )}
            <MarkdownEditor value={content} onChange={setContent} />
            <footer className="editor-status">
              <span>
                实时字数{" "}
                {[...content.replace(/\s/gu, "")].length.toLocaleString(
                  "zh-CN",
                )}
              </span>
              <span className="word-progress" aria-hidden="true">
                <i />
              </span>
              <span>建议范围 1700–2300 字</span>
            </footer>
          </>
        ) : (
          <EmptyPanel>创建第一章开始写作。</EmptyPanel>
        )}
      </main>
      {selected ? (
        <ChapterUiProvider
          value={{
            projectId: projectId!,
            chapterId: selected.id,
            title,
            content,
            version: selected.version,
          }}
        >
          <aside className="chapter-assistant">
            <div
              className="assistant-resize-handle"
              role="separator"
              aria-label="调整智能写作侧栏宽度"
              aria-orientation="vertical"
              aria-valuemin={280}
              aria-valuemax={560}
              aria-valuenow={rightWidth}
              tabIndex={0}
              onPointerDown={beginResize}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                  return;
                const next = Math.min(
                  560,
                  Math.max(
                    280,
                    rightWidth + (event.key === "ArrowLeft" ? 16 : -16),
                  ),
                );
                setRightWidth(next);
                localStorage.setItem(
                  "dramaip:writing:right-width",
                  String(next),
                );
              }}
            />
            <div className="aux-tabs">
              <button
                className={rightTab === "assistant" ? "active" : ""}
                onClick={() => setRightTab("assistant")}
              >
                智能写作
              </button>
              <button
                className={rightTab === "bible" ? "active" : ""}
                onClick={() => setRightTab("bible")}
              >
                Story Bible
              </button>
              <div className="aux-panel-actions">
                <button
                  aria-label="缩小智能写作侧栏"
                  onClick={() =>
                    setRightWidth((value) => Math.max(280, value - 24))
                  }
                >
                  −
                </button>
                <button
                  aria-label="放大智能写作侧栏"
                  onClick={() =>
                    setRightWidth((value) => Math.min(560, value + 24))
                  }
                >
                  ＋
                </button>
                <button title="收起侧栏" onClick={() => setRightOpen(false)}>
                  折叠
                </button>
              </div>
            </div>
            <div className="aux-content">
              {rightTab === "versions" && selected ? (
                <VersionPanel
                  chapter={selected}
                  onRestored={(chapter) => {
                    updateCache(chapter);
                    setContent(chapter.content);
                    setTitle(chapter.title);
                  }}
                />
              ) : (
                auxiliary
                  .filter((item) =>
                    rightTab === "assistant"
                      ? item.id.includes("agents")
                      : item.id.includes("knowledge"),
                  )
                  .map(({ id, Component }) => (
                    <Component key={`${id}:${selected?.id ?? "none"}`} />
                  ))
              )}
            </div>
          </aside>
        </ChapterUiProvider>
      ) : (
        <aside className="chapter-assistant" />
      )}
    </section>
  );
}

function VersionPanel({
  chapter,
  onRestored,
}: {
  chapter: Chapter;
  onRestored(chapter: Chapter): void;
}) {
  const client = useStudioClient();
  const [selectedVersion, setSelectedVersion] = useState<ChapterVersion>();
  const [selectedParagraphs, setSelectedParagraphs] = useState<Set<number>>(
    new Set(),
  );
  const versions = useQuery({
    queryKey: ["writing", "versions", chapter.id, chapter.version],
    queryFn: () =>
      client.request<{ items: ChapterVersion[] }>(
        `/api/v2/writing/chapters/${chapter.id}/versions`,
      ),
  });
  const restore = useMutation({
    mutationFn: (version: ChapterVersion) =>
      client.request<Chapter>(
        `/api/v2/writing/chapters/${chapter.id}/versions/${version.id}/actions/restore`,
        {
          method: "POST",
          headers: {
            "if-match": `"v${chapter.version}"`,
            "idempotency-key": crypto.randomUUID(),
          },
        },
      ),
    onSuccess: onRestored,
  });
  const choices = useMemo(
    () =>
      paragraphChoices(
        chapter.content,
        selectedVersion?.content ?? chapter.content,
      ),
    [chapter.content, selectedVersion],
  );
  useEffect(() => {
    setSelectedParagraphs(
      new Set(
        choices
          .filter((choice) => choice.changed)
          .map((choice) => choice.index),
      ),
    );
  }, [selectedVersion?.id]);
  const applySelected = useMutation({
    mutationFn: async () => {
      if (!selectedVersion) throw new Error("请先选择一个版本");
      const proposedContent = choices
        .map((choice) =>
          selectedParagraphs.has(choice.index)
            ? choice.candidate
            : choice.current,
        )
        .filter((paragraph): paragraph is string => paragraph !== undefined)
        .join("\n\n");
      const revision = await client.request<{ id: string; version: number }>(
        "/api/v2/writing/revisions",
        {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({
            projectId: chapter.projectId,
            chapterId: chapter.id,
            baseVersion: chapter.version,
            proposedTitle: chapter.title,
            proposedContent,
            rationale: `从章节版本 v${selectedVersion.chapterVersion} 选择性采用段落`,
          }),
        },
      );
      return client.request<{ chapter: Chapter }>(
        `/api/v2/writing/revisions/${revision.id}/actions/commit`,
        {
          method: "POST",
          headers: {
            "if-match": `"v${revision.version}"`,
            "idempotency-key": crypto.randomUUID(),
          },
        },
      );
    },
    onSuccess: (result) => onRestored(result.chapter),
  });
  return (
    <div className="version-panel">
      {versions.error && <ErrorPanel error={versions.error} />}
      {versions.data?.items.map((version) => (
        <button
          className={
            selectedVersion?.id === version.id
              ? "version-row active"
              : "version-row"
          }
          key={version.id}
          onClick={() => setSelectedVersion(version)}
        >
          <strong>v{version.chapterVersion}</strong>
          <small>
            {version.reason}
            <br />
            {new Date(version.createdAt).toLocaleString("zh-CN")}
          </small>
        </button>
      ))}
      {selectedVersion && (
        <div className="paragraph-diff">
          <h3>分段差异</h3>
          {choices.map((choice) => (
            <label
              className={
                choice.changed ? "paragraph-choice changed" : "paragraph-choice"
              }
              key={`${choice.index}:${choice.candidate?.slice(0, 12) ?? "deleted"}`}
            >
              <input
                type="checkbox"
                checked={
                  !choice.changed || selectedParagraphs.has(choice.index)
                }
                disabled={!choice.changed}
                onChange={() =>
                  setSelectedParagraphs((current) => {
                    const next = new Set(current);
                    if (next.has(choice.index)) next.delete(choice.index);
                    else next.add(choice.index);
                    return next;
                  })
                }
              />
              <span>
                {choice.changed && choice.current !== undefined && (
                  <del>{choice.current || "（空段）"}</del>
                )}
                <ins>{choice.candidate ?? "（删除此段）"}</ins>
              </span>
            </label>
          ))}
          {applySelected.error && <ErrorPanel error={applySelected.error} />}
          <div className="button-row">
            <button
              className="primary-button"
              disabled={applySelected.isPending || !selectedParagraphs.size}
              onClick={() => applySelected.mutate()}
            >
              采用所选段落
            </button>
            <button
              className="secondary-button"
              disabled={restore.isPending}
              onClick={() => restore.mutate(selectedVersion)}
            >
              恢复整个版本
            </button>
            <button
              className="ghost-button"
              onClick={() => setSelectedVersion(undefined)}
            >
              放弃候选
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function paragraphDiff(
  current: string,
  candidate: string,
): Array<{ kind: "same" | "added" | "removed"; text: string }> {
  const choices = paragraphChoices(current, candidate);
  const values: Array<{ kind: "same" | "added" | "removed"; text: string }> =
    [];
  for (const choice of choices) {
    if (!choice.changed)
      values.push({ kind: "same", text: choice.current ?? "" });
    else {
      if (choice.current !== undefined)
        values.push({ kind: "removed", text: choice.current });
      if (choice.candidate !== undefined)
        values.push({ kind: "added", text: choice.candidate });
    }
  }
  return values;
}

export function paragraphChoices(current: string, candidate: string) {
  const left = current.split(/\n{2,}/u);
  const right = candidate.split(/\n{2,}/u);
  return Array.from(
    { length: Math.max(left.length, right.length) },
    (_, index) => ({
      index,
      current: left[index],
      candidate: right[index],
      changed: left[index] !== right[index],
    }),
  );
}

function WritingProjectCard() {
  const { projectId } = useParams();
  return (
    <Link className="tool-card featured" to={`/projects/${projectId}`}>
      <span className="card-kicker">WRITING</span>
      <h2>小说写作</h2>
      <p>章节编辑、自动草稿、不可变版本与恢复。</p>
    </Link>
  );
}

function WritingAlias() {
  const { projectId } = useParams();
  return <Navigate to={`/projects/${projectId}`} replace />;
}

export const writingUi: readonly UiContribution[] = [
  {
    kind: "route",
    id: "writing.root",
    pluginId: "writing",
    path: "/write",
    title: "小说写作",
    component: async () => ({ default: WritingHomePage }),
  },
  {
    kind: "route",
    id: "writing.project",
    pluginId: "writing",
    path: "/projects/:projectId",
    title: "章节写作",
    layout: "project",
    component: async () => ({ default: NovelWritingPage }),
  },
  {
    kind: "route",
    id: "writing.project.alias",
    pluginId: "writing",
    path: "/projects/:projectId/write",
    title: "章节写作",
    component: async () => ({ default: WritingAlias }),
  },
  {
    kind: "navigation",
    id: "writing.navigation",
    pluginId: "writing",
    section: "main",
    order: 20,
    label: "小说写作",
    to: "/write",
    activePaths: ["/write/*", "/projects/:projectId/*"],
  },
  {
    kind: "navigation",
    id: "writing.project.navigation",
    pluginId: "writing",
    section: "project",
    order: 10,
    label: "正文",
    to: "/projects/:projectId",
  },
  {
    kind: "slot",
    id: "writing.project.section",
    pluginId: "writing",
    slot: "project.section",
    order: 10,
    component: async () => ({ default: WritingProjectCard }),
  },
];
