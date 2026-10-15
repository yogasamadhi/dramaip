import type {
  ChangePreview,
  CreativeCaseStudy,
  CreativeDiagnosticKind,
  DomainEntity,
  Project,
  ProviderActionPreview,
  RevisionPreview,
  StoryBibleChangeSet,
  Task,
} from "@dramaip/contracts/product";
import { BareButton, confirmDialog } from "@dramaip/ui-shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  providerEstimate,
  providerReviewStatusLabel,
  readProviderActionReview,
  readProjectProviderReview,
  readAssistantProviderReview,
  requireUnchangedProviderReview,
} from "../provider-action-review";
import { Link, useLocation } from "react-router-dom";
import {
  CREATIVE_DIAGNOSTIC_LABELS,
  domainLabel,
  message,
  useStudio,
} from "../studio-shared";
import { CreativeIntentSummary } from "../creative-intent";
import { useStudioSession } from "../studio-session";
import {
  currentOwnerQuery,
  CURRENT_OWNER_READ_OPTIONS,
} from "../current-owner-read";
import {
  readLegacyDiagnosticHistory,
  readLegacyAcknowledgementHistory,
} from "../legacy-quality-history";
export const STORY_BIBLE_STATUS_LABELS: Record<string, string> = {
  queued: "等待生成",
  draft: "待确认草案",
  applied: "已采用",
  paused: "已暂停",
  skipped: "已跳过",
  discarded: "已撤销",
  stale: "已过期",
  failed: "生成失败",
};

export function StoryBibleChangeSetPanel(props: { projectId?: string } = {}) {
  const client = useStudio();
  const session = useStudioSession();
  const queryClient = useQueryClient();
  const location = useLocation();
  const requestedChangeSetId = new URLSearchParams(location.search).get(
    "changeSetId",
  );
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const [projectId, setProjectId] = useState(
    props.projectId ?? session.activeProjectId ?? "",
  );
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
  const {
    data: changeSets = [],
    isLoading: changesLoading,
    error: changesError,
  } = useQuery({
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
    if (!projectId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = client.events.subscribe((event) => {
      if (!event.type.startsWith("writing.chapter-") || timer) return;
      if (
        !event.payload ||
        typeof event.payload !== "object" ||
        (event.payload as { projectId?: string }).projectId !== projectId
      )
        return;
      timer = setTimeout(() => {
        timer = undefined;
        void queryClient.invalidateQueries({
          queryKey: ["story-bible-change-sets", projectId],
        });
      }, 1000);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [client, projectId, queryClient]);
  useEffect(() => {
    if (props.projectId) setProjectId(props.projectId);
  }, [props.projectId]);
  useEffect(() => {
    if (
      !props.projectId &&
      session.activeProjectId &&
      projectId !== session.activeProjectId
    )
      setProjectId(session.activeProjectId);
  }, [projectId, props.projectId, session.activeProjectId]);
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
      !(await confirmDialog(
        "采用后会将这份草案写入章节记忆；不会修改章节正文。确定采用吗？",
      ))
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
      !(await confirmDialog(
        "撤销只会删除该变更集创建的章节记忆，不会影响原有资料。确定撤销吗？",
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
    <section className="rounded-xl border border-line bg-surface p-5">
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
        {!props.projectId && (
          <label className="grid gap-1 text-sm">
            项目
            <select
              className="rounded-lg border border-line px-3 py-2"
              value={projectId}
              onChange={(event) => {
                const nextProjectId = event.target.value;
                setProjectId(nextProjectId);
                if (nextProjectId) session.selectProject(nextProjectId);
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
        )}
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
          <BareButton
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!projectId || !chapterId}
            onClick={() => void queue()}
          >
            生成待确认草案
          </BareButton>
        </div>
      </div>
      {notice && (
        <p className="mt-3 rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
      {staleMarks.length > 0 && (
        <div className="mt-4 rounded-lg border border-warning/25 bg-warning-soft p-3 text-sm text-warning-strong">
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
        {requestedChangeSetId &&
          !changeSets.some((item) => item.id === requestedChangeSetId) && (
            <p
              role={changesLoading ? "status" : "alert"}
              className="text-sm text-muted"
            >
              {changesLoading
                ? "正在核对指定变更…"
                : changesError
                  ? "指定变更未能读取，请检查连接；未打开其他变更代替。"
                  : "指定变更已删除或不属于此项目，未打开其他变更代替。"}
            </p>
          )}
        {changeSets
          .filter(
            (item) => !requestedChangeSetId || item.id === requestedChangeSetId,
          )
          .map((item) => (
            <article
              key={item.id}
              data-change-set-id={item.id}
              className="rounded-xl border border-line p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{item.summary}</p>
                  <p className="mt-1 text-xs text-muted">
                    章节版本 {item.sourceVersion} ·{" "}
                    {STORY_BIBLE_STATUS_LABELS[item.status] ?? "未知状态"}
                  </p>
                  {(item.sourceState === "stale" ||
                    item.sourceState === "missing") && (
                    <p
                      role="alert"
                      className="mt-1 text-xs text-warning-strong"
                    >
                      {item.sourceState === "missing"
                        ? "来源章节不可用，不能采用此建议。"
                        : "来源版本已变化，不能采用此建议；历史草案仍保留，请核对当前章节后重新生成。"}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.status === "draft" && (
                    <>
                      {item.sourceState !== "stale" &&
                        item.sourceState !== "missing" && (
                          <BareButton
                            className="rounded-md bg-brand px-2 py-1 text-xs text-white"
                            onClick={() => void apply(item)}
                          >
                            采用
                          </BareButton>
                        )}
                      <BareButton
                        className="rounded-md border border-line px-2 py-1 text-xs text-muted"
                        onClick={() => void setStatus(item, "paused")}
                      >
                        暂停
                      </BareButton>
                    </>
                  )}
                  {item.status === "paused" &&
                    item.sourceState !== "stale" &&
                    item.sourceState !== "missing" && (
                      <BareButton
                        className="rounded-md border border-line px-2 py-1 text-xs text-brand"
                        onClick={() => void setStatus(item, "queued")}
                      >
                        恢复
                      </BareButton>
                    )}
                  {(["draft", "queued", "paused", "failed"].includes(
                    item.status,
                  ) ||
                    (item.status === "stale" && !item.appliedAt)) && (
                    <BareButton
                      className="rounded-md border border-line px-2 py-1 text-xs text-muted"
                      onClick={() => void setStatus(item, "discarded")}
                    >
                      丢弃
                    </BareButton>
                  )}
                  {(item.status === "applied" ||
                    (item.status === "stale" && item.appliedAt)) && (
                    <BareButton
                      className="rounded-md border border-line px-2 py-1 text-xs text-brand"
                      onClick={() => void undo(item)}
                    >
                      撤销采用
                    </BareButton>
                  )}
                </div>
              </div>
              {item.conflictNotes.length > 0 && (
                <p className="mt-2 text-xs text-warning-strong">
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

export function CreativeDiagnosticsPanel(props: { projectId?: string } = {}) {
  const client = useStudio();
  const session = useStudioSession();
  const [selectedProjectId, setSelectedProjectId] = useState("");
  // Explicit/current project wins synchronously; no old-project paint while an
  // effect catches up after navigation.
  const projectId =
    props.projectId ?? session.activeProjectId ?? selectedProjectId;
  const projects = currentOwnerQuery(
    useQuery({
      queryKey: ["creative-diagnostic-projects"],
      queryFn: client.projects.list,
      ...CURRENT_OWNER_READ_OPTIONS,
    }),
  );
  const [kinds, setKinds] = useState<CreativeDiagnosticKind[]>([
    "freshness",
    "anti_trope",
    "quality_gate",
    "audience",
    "narrative_curve",
  ]);
  const history = currentOwnerQuery(
    useQuery({
      queryKey: ["creative-diagnostics", projectId],
      queryFn: async () =>
        readLegacyDiagnosticHistory(
          await client.creative.listDiagnostics(projectId),
          projectId,
        ),
      enabled: Boolean(projectId),
      ...CURRENT_OWNER_READ_OPTIONS,
    }),
  );
  const declarations = currentOwnerQuery(
    useQuery({
      queryKey: ["creative-issue-acknowledgements", projectId],
      queryFn: async () =>
        readLegacyAcknowledgementHistory(
          await client.creative.listIssueAcknowledgements(projectId),
          projectId,
        ),
      enabled: Boolean(projectId),
      ...CURRENT_OWNER_READ_OPTIONS,
    }),
  );
  const diagnostics = history.data?.filter((item) => kinds.includes(item.kind));
  return (
    <section
      aria-label="旧兼容诊断历史（未认证）"
      className="rounded-xl border border-line bg-surface p-5"
    >
      <div>
        <p className="text-sm text-muted">创意质量 · 历史兼容</p>
        <h2 className="mt-1 text-2xl font-semibold">
          历史诊断，不代表当前质量
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          旧兼容诊断使用固定分数或条目数量，未完成实际内容评议；已停止新生成和新增问题确认。
          原记录与旧人工声明仅供只读查阅，不是当前质量、修复完成、受众判断或文学认证。
        </p>
        <p className="mt-3 rounded-lg bg-brand-soft p-3 text-sm text-brand">
          需要新的评议时，请明确选择独立人工声明、程序规则或模型候选；不会自动运行、采用或修改作品。
        </p>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          项目
          <select
            className="rounded-lg border border-line px-3 py-2"
            value={projectId}
            disabled={Boolean(props.projectId)}
            onChange={(event) => {
              setSelectedProjectId(event.target.value);
              if (event.target.value) session.selectProject(event.target.value);
            }}
          >
            <option value="">选择项目</option>
            {(projects.data ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          {projectId ? (
            <Link
              className="rounded-lg border border-line px-4 py-2 text-sm text-brand"
              to={`/projects/${projectId}/tools/quality-review`}
            >
              打开独立质量评议
            </Link>
          ) : (
            <p className="text-sm text-muted">选择项目后可进入独立评议。</p>
          )}
        </div>
      </div>
      <fieldset className="mt-4">
        <legend className="text-sm font-medium">
          筛选历史类型（不生成报告）
        </legend>
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
                onChange={() =>
                  setKinds((items) =>
                    items.includes(kind)
                      ? items.filter((item) => item !== kind)
                      : [...items, kind],
                  )
                }
              />
              {CREATIVE_DIAGNOSTIC_LABELS[kind]}
            </label>
          ))}
        </div>
      </fieldset>
      {projectId && history.error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-line p-3 text-sm"
        >
          历史诊断读取失败；未显示旧缓存，历史是否为空未知。
          {message(history.error)}
        </p>
      )}
      {projectId && !history.error && history.data === undefined && (
        <p className="mt-4 text-sm text-muted">
          正在实际读取本项目历史诊断；未显示旧缓存。
        </p>
      )}
      {projectId && declarations.error && (
        <p role="alert" className="mt-4 text-sm">
          历史人工声明读取失败；未使用旧缓存或判定问题已修复。
          {message(declarations.error)}
        </p>
      )}
      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {diagnostics?.map((diagnostic) => (
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
                历史记录 · 未认证
              </span>
            </div>
            <p className="mt-3 text-xs text-muted">
              原 ID：{diagnostic.id} · 原保存时间：{diagnostic.createdAt}
            </p>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-brand">
                展开原记录（未认证，量纲未知）
              </summary>
              <p className="mt-3 text-muted">
                原摘要（未认证）：{diagnostic.summary}
              </p>
              <p className="mt-2 text-xs text-muted">
                原请求指纹不证明已读取正文或当前来源：
                {diagnostic.sourceFingerprint}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {diagnostic.scores.map((item, index) => (
                  <span
                    key={index}
                    className="rounded-md bg-canvas px-2 py-1 text-xs"
                  >
                    原数值（未认证／量纲未知）：{item.label}{" "}
                    {String(item.value)}
                  </span>
                ))}
              </div>
              {diagnostic.curve && (
                <p className="mt-3 text-xs text-muted">
                  原曲线数值（未认证／量纲未知）：
                  {diagnostic.curve.map(String).join(" → ")}
                </p>
              )}
              <ul className="mt-3 list-disc space-y-1 pl-5 text-muted">
                {diagnostic.findings.map((item, index) => (
                  <li key={index}>原问题（未认证）：{item}</li>
                ))}
              </ul>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-muted">
                {diagnostic.recommendations.map((item, index) => (
                  <li key={index}>原建议（未认证）：{item}</li>
                ))}
              </ul>
              {(declarations.data ?? [])
                .filter((item) => item.diagnosticId === diagnostic.id)
                .map((item) => (
                  <p key={item.id} className="mt-3 text-xs text-muted">
                    旧人工声明（不认证修复或质量）：{item.issueKey} · 原状态{" "}
                    {item.disposition}
                    {item.actorLabel ? ` · ${item.actorLabel}` : ""}
                    {item.note ? ` · ${item.note}` : ""}
                  </p>
                ))}
            </details>
          </article>
        ))}
        {projectId && history.data !== undefined && !diagnostics?.length && (
          <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
            {history.data.length
              ? "当前筛选下没有历史记录。"
              : "已实际读取，本项目没有旧兼容诊断；不会生成固定分数。"}
          </p>
        )}
      </div>
      <CreativeCaseStudyPanel />
    </section>
  );
}

export function creativeItems(value: string): string[] {
  return value
    .split(/[；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function CreativeCaseStudyPanel() {
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
        <BareButton
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={!title.trim()}
          onClick={() => void create()}
        >
          新建案例
        </BareButton>
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

export function CreativeCaseStudyCard(props: { item: CreativeCaseStudy }) {
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
    if (!(await confirmDialog(`确定删除案例「${props.item.title}」吗？`)))
      return;
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
            className="rounded-md border border-line px-2 py-1"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <input
            className="rounded-md border border-line px-2 py-1"
            placeholder="题材"
            value={genre}
            onChange={(event) => setGenre(event.target.value)}
          />
          <textarea
            className="min-h-16 rounded-md border border-line p-2"
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
          <BareButton
            className="rounded-md border border-line px-2 py-1 text-xs text-brand"
            onClick={() => void save()}
          >
            保存修改
          </BareButton>
        ) : (
          <BareButton
            className="rounded-md border border-line px-2 py-1 text-xs text-brand"
            onClick={() => setEditing(true)}
          >
            编辑
          </BareButton>
        )}
        <BareButton
          className="rounded-md border border-line px-2 py-1 text-xs text-danger-strong"
          onClick={() => void remove()}
        >
          删除
        </BareButton>
      </div>
      {notice && <p className="mt-2 text-xs text-danger-strong">{notice}</p>}
    </article>
  );
}

export function AgentRevisionPreviewCard(props: {
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
      pending: "等待审阅采用",
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
        <span className="rounded-full bg-surface-raised px-2 py-1 text-xs text-brand">
          {statusLabel}
        </span>
      </div>
      {props.preview.rationale && (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted">
          {props.preview.rationale}
        </p>
      )}
      <details className="mt-3 rounded-md bg-surface-raised/80 p-3">
        <summary className="cursor-pointer text-sm font-medium text-brand">
          查看候选正文
        </summary>
        <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-6 text-ink">
          {props.preview.proposedContent}
        </pre>
      </details>
      {(status === "pending" || status === "conflicted") && (
        <div className="mt-3 flex flex-wrap gap-2">
          {status === "pending" && (
            <BareButton
              className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={commit.isPending || discard.isPending}
              onClick={() => commit.mutate()}
            >
              {commit.isPending ? "正在采用…" : "确认采用修订"}
            </BareButton>
          )}
          <BareButton
            className="rounded-lg border border-line px-3 py-2 text-sm text-muted disabled:opacity-50"
            disabled={commit.isPending || discard.isPending}
            onClick={async () => {
              if (
                await confirmDialog(
                  "确定放弃此修订预览吗？章节正文不会发生改变。",
                )
              )
                discard.mutate();
            }}
          >
            {discard.isPending ? "正在放弃…" : "放弃此预览"}
          </BareButton>
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

export function AgentChangePreviewCard(props: {
  preview: ChangePreview;
  onCommitted?(): void;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const { data: project } = useQuery<Project>({
    queryKey: ["project", props.preview.projectId],
    queryFn: () => client.projects.get(props.preview.projectId),
  });
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
      props.onCommitted?.();
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
        <span className="rounded-full bg-surface-raised px-2 py-1 text-xs text-brand">
          {statusLabel}
        </span>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted">
        {props.preview.rationale}
      </p>
      {project && (
        <div className="mt-3">
          <CreativeIntentSummary
            project={project}
            preview={{ ...props.preview, status }}
            compact
          />
        </div>
      )}
      <div className="mt-3 space-y-2">
        {props.preview.targets.map((target, index) => (
          <details
            key={`${target.kind}-${target.id}`}
            className="rounded-md bg-surface-raised/80 p-3"
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
          <BareButton
            className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={commit.isPending || discard.isPending}
            onClick={async () => {
              if (
                await confirmDialog(
                  `确认应用这 ${props.preview.targets.length} 项变更吗？系统会再次检查所有目标版本。`,
                )
              )
                commit.mutate();
            }}
          >
            {commit.isPending ? "正在应用…" : "确认应用"}
          </BareButton>
          <BareButton
            className="rounded-lg border border-line px-3 py-2 text-sm text-muted disabled:opacity-50"
            disabled={commit.isPending || discard.isPending}
            onClick={() => discard.mutate()}
          >
            {discard.isPending ? "正在放弃…" : "放弃此预览"}
          </BareButton>
        </div>
      )}
      {status === "conflicted" && (
        <div className="mt-3 rounded-lg border border-warning/25 bg-warning-soft p-3 text-sm text-warning-strong">
          <p>
            正式内容已有更新，本预览不会覆盖新版本。请重新读取最新内容，再从原任务生成新的差异预览。
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <BareButton
              className="font-medium underline"
              onClick={async () => {
                await queryClient.invalidateQueries({
                  queryKey: ["project", props.preview.projectId],
                });
                await queryClient.invalidateQueries({ queryKey: ["tasks"] });
                setNotice("已重新读取最新项目与任务状态，请重新生成建议。");
              }}
            >
              重新读取最新内容
            </BareButton>
            <Link
              className="font-medium underline"
              to={`/tasks?projectId=${encodeURIComponent(props.preview.projectId)}`}
            >
              返回原任务重新生成
            </Link>
          </div>
        </div>
      )}
      {notice && <p className="mt-3 text-xs leading-5 text-muted">{notice}</p>}
    </section>
  );
}

export function AgentAssistantProviderActionPreviewCard(props: {
  id: string;
  projectId?: string;
  conversationId: string;
}) {
  const client = useStudio();
  const actual = useQuery({
    queryKey: [
      "assistant-provider-review",
      props.id,
      props.projectId,
      props.conversationId,
    ],
    queryFn: () => readAssistantProviderReview(client, props),
    refetchInterval: 1500,
    retry: false,
  });
  if (actual.error || !actual.data)
    return (
      <p role={actual.error ? "alert" : "status"}>
        {actual.error
          ? message(actual.error)
          : "正在核对实际对话、运行和原任务…"}
      </p>
    );
  return (
    <AgentProviderActionPreviewCard
      preview={actual.data.preview}
      task={actual.data.task}
    />
  );
}

export function AgentProviderActionPreviewCard(props: {
  preview: ProviderActionPreview;
  task?: Task;
  projectId?: string;
}) {
  const client = useStudio();
  const binding = {
    id: props.preview.id,
    projectId: props.task?.projectId ?? props.projectId ?? "",
    task: props.task,
  };
  const actual = useQuery({
    queryKey: [
      "provider-action-review",
      binding.id,
      binding.projectId,
      props.task?.id,
    ],
    queryFn: () =>
      props.task
        ? readProviderActionReview(client, { ...binding, task: props.task })
        : readProjectProviderReview(client, binding),
    refetchInterval: 1500,
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
  if (actual.error || !actual.data || !actual.isFetchedAfterMount)
    return (
      <p
        role={actual.error ? "alert" : "status"}
        className="mt-3 text-sm text-warning-strong"
      >
        {actual.error
          ? message(actual.error)
          : "正在核对实际厂商预览、项目和原任务…"}
      </p>
    );
  return (
    <ReviewedProviderActionCard
      key={`${binding.projectId}:${binding.id}:${props.task?.id ?? "owner-preview"}`}
      preview={actual.data}
      task={props.task}
      projectId={binding.projectId}
    />
  );
}

function ReviewedProviderActionCard(props: {
  preview: ProviderActionPreview;
  task?: Task;
  projectId?: string;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string>();
  const alive = useRef(false);
  const executeKey = useRef(crypto.randomUUID());
  const discardKey = useRef(crypto.randomUUID());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const binding = {
    id: props.preview.id,
    projectId: props.task?.projectId ?? props.projectId ?? "",
    task: props.task,
  };
  const readActual = () =>
    props.task
      ? readProviderActionReview(client, { ...binding, task: props.task })
      : readProjectProviderReview(client, binding);
  const estimate = providerEstimate(props.preview);
  const kindLabel = {
    image: "图片生成",
    audio: "音频生成",
    video: "视频生成",
    remote_render: "远程渲染",
  }[props.preview.kind];
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["provider-action-review", binding.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ["task-actual-result", props.task?.id],
      }),
      queryClient.invalidateQueries({ queryKey: ["pending-confirmations"] }),
      queryClient.invalidateQueries({ queryKey: ["pending-provider-preview"] }),
      queryClient.invalidateQueries({ queryKey: ["confirmation-context"] }),
      queryClient.invalidateQueries({ queryKey: ["task-worklist"] }),
    ]);
  };
  const report = (cause: unknown) => {
    if (alive.current) setNotice(message(cause));
  };
  const execute = useMutation({
    mutationFn: async (reviewed: ProviderActionPreview) => {
      if (!alive.current) throw new Error("已经离开原预览，未执行旧确认。");
      const current = await readActual();
      if (!alive.current) throw new Error("已经离开原预览，未执行旧确认。");
      requireUnchangedProviderReview(current, reviewed);
      return client.providerActionPreviews.execute(
        current.id,
        executeKey.current,
      );
    },
    onSuccess: async () => {
      setNotice(undefined);
      await refresh();
    },
    onError: async (cause) => {
      report(cause);
      await refresh();
    },
  });
  const discard = useMutation({
    mutationFn: async () => {
      const current = await readActual();
      if (!alive.current || current.status !== "pending")
        throw new Error("实际预览已变化或已离开；未放弃另一对象。");
      return client.providerActionPreviews.discard(
        current.id,
        discardKey.current,
      );
    },
    onSuccess: async () => {
      setNotice(undefined);
      await refresh();
    },
    onError: async (cause) => {
      report(cause);
      await refresh();
    },
  });
  const confirmExecution = async () => {
    const reviewed = props.preview;
    setNotice(undefined);
    try {
      const current = await readActual();
      if (!alive.current) return;
      requireUnchangedProviderReview(current, reviewed);
      const confirmed = await confirmDialog(
        `确认发起${kindLabel}吗？记录中的预估费用 ${providerEstimate(reviewed).label}；估值不是实际报价或结算账单。`,
      );
      if (confirmed && alive.current) execute.mutate(reviewed);
    } catch (cause) {
      report(cause);
      await refresh();
    }
  };
  return (
    <section
      aria-label="实际厂商调用预览"
      className="mt-3 rounded-lg border border-warning/40 bg-warning-soft p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink">{kindLabel}调用预览</p>
          <p className="mt-1 text-xs text-muted">
            读取实际记录后另行确认才会调用远程服务；生成建议或内容采用不构成费用与权利授权。
          </p>
        </div>
        <span className="rounded-full bg-surface-raised px-2 py-1 text-xs text-warning-strong">
          {providerReviewStatusLabel(props.preview.status)}
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
          <dt className="inline font-medium text-ink">记录中的预估费用：</dt>
          <dd className="inline">{estimate.label}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-muted">
        估值（包括零）不等于真实报价或实际账单；实际费用与合法授权仍须相应证据。
      </p>
      <details className="mt-3 rounded-md bg-surface-raised/80 p-3">
        <summary className="cursor-pointer text-sm font-medium text-warning-strong">
          查看实际记录参数
        </summary>
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap font-sans text-sm leading-6 text-ink">
          {JSON.stringify(props.preview.parameters, null, 2)}
        </pre>
      </details>
      {props.preview.status === "pending" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <BareButton
            className="rounded-lg bg-warning px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!estimate.known || execute.isPending || discard.isPending}
            onClick={() => void confirmExecution()}
          >
            {execute.isPending ? "正在创建任务…" : "确认并创建远程任务"}
          </BareButton>
          <BareButton
            className="rounded-lg border border-line px-3 py-2 text-sm text-muted disabled:opacity-50"
            disabled={execute.isPending || discard.isPending}
            onClick={() => discard.mutate()}
          >
            {discard.isPending ? "正在放弃…" : "放弃此次调用"}
          </BareButton>
        </div>
      )}
      {props.preview.status === "pending" && !estimate.known && (
        <p className="mt-3 text-xs leading-5 text-warning-strong">
          预估费用或币种未知，远程任务已禁用。须重新取得明确记录并另行确认；此状态不推断实际账单为零。
        </p>
      )}
      {notice && (
        <p role="alert" className="mt-3 text-xs leading-5 text-warning-strong">
          {notice}
        </p>
      )}
    </section>
  );
}

export function changeTargetLabel(kind: string): string {
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

export function changeTargetPreviewText(
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
export type ResourceFieldKind = "text" | "multiline" | "number" | "switch";
export type ResourceField = {
  key: string;
  label: string;
  kind: ResourceFieldKind;
  placeholder?: string;
};
export type ResourceDefinition = {
  description: string;
  titleLabel: string;
  projectRequired?: boolean;
  fields: ResourceField[];
};

export const shortText = (
  key: string,
  label: string,
  placeholder?: string,
): ResourceField => ({
  key,
  label,
  kind: "text",
  placeholder,
});
export const longText = (
  key: string,
  label: string,
  placeholder?: string,
): ResourceField => ({
  key,
  label,
  kind: "multiline",
  placeholder,
});
export const numberField = (key: string, label: string): ResourceField => ({
  key,
  label,
  kind: "number",
});

export const RESOURCE_DEFINITIONS: Record<string, ResourceDefinition> = {
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
    description:
      "跟踪伏笔的埋设、强化、误导、揭示、回收和废弃，以及观众认知与逾期风险。",
    titleLabel: "伏笔标题",
    fields: [
      shortText("埋设章节", "埋设章节"),
      shortText("回收章节", "回收章节"),
      shortText("状态", "状态", "埋设、强化、误导、揭示、回收或废弃"),
      shortText("计划章节", "计划章节"),
      shortText("逾期状态", "逾期状态", "正常、临近或逾期"),
      shortText(
        "观众认知",
        "观众认知",
        "unknown、suspects、misbelieves 或 knows",
      ),
      longText("伏笔说明", "伏笔说明"),
      longText("回收计划", "回收计划"),
      longText("实际证据", "实际证据"),
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

export function resourceDefinition(domain: string): ResourceDefinition {
  return (
    RESOURCE_DEFINITIONS[domain] ?? {
      description: "管理此功能域的项目资料。",
      titleLabel: "条目名称",
      fields: [longText("说明", "说明")],
    }
  );
}

export function recordPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function fieldValue(
  value: unknown,
  kind: ResourceFieldKind,
): string | boolean {
  if (kind === "switch") return Boolean(value);
  return value === undefined || value === null ? "" : String(value);
}

export function templateVariableNames(value: string): string[] {
  return [
    ...new Set(
      [...value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)]
        .map((match) => match[1].trim())
        .filter(Boolean),
    ),
  ];
}

export type ResourcePluginOwner =
  | "agents"
  | "automation"
  | "creative-quality"
  | "delivery"
  | "knowledge"
  | "media"
  | "production"
  | "review"
  | "writing";

export const RESOURCE_PLUGIN_OWNERS: Readonly<
  Record<string, ResourcePluginOwner>
> = {
  story: "knowledge",
  characters: "writing",
  outlines: "writing",
  "story-arcs": "writing",
  "character-states": "knowledge",
  "visual-profiles": "knowledge",
  "visual-settings": "knowledge",
  "story-events": "knowledge",
  foreshadowings: "knowledge",
  "chapter-memories": "knowledge",
  "story-bible": "knowledge",
  "story-bible-settings": "knowledge",
  "story-bible-stale": "knowledge",
  memory: "knowledge",
  analysis: "creative-quality",
  beats: "creative-quality",
  highlights: "creative-quality",
  feasibility: "creative-quality",
  trends: "creative-quality",
  evaluations: "creative-quality",
  quality: "creative-quality",
  "project-skills": "automation",
  "agent-schemes": "automation",
  inspirations: "automation",
  templates: "automation",
  adaptations: "production",
  episodes: "production",
  scripts: "production",
  scenes: "production",
  shots: "production",
  "shot-stills": "media",
  "visual-assets": "media",
  assets: "media",
  rights: "media",
  image: "media",
  audio: "media",
  video: "media",
  renders: "media",
  compliance: "review",
  review: "review",
  localization: "delivery",
  delivery: "delivery",
  providers: "agents",
};

export function PluginResourceWorkspace(props: {
  owner: ResourcePluginOwner;
  title: string;
  domains: string[];
  projectId?: string;
  parentId?: string;
  parentRequired?: boolean;
}) {
  const foreignDomain = props.domains.find(
    (domain) => RESOURCE_PLUGIN_OWNERS[domain] !== props.owner,
  );
  if (foreignDomain)
    throw new Error(
      `UI contribution ownership mismatch: ${foreignDomain} is not owned by ${props.owner}`,
    );
  const client = useStudio();
  const session = useStudioSession();
  const queryClient = useQueryClient();
  const [domain, setDomain] = useState(props.domains[0]);
  const definition = resourceDefinition(domain);
  const [selectedProjectId, setSelectedProjectId] = useState(
    props.projectId ?? session.activeProjectId ?? "",
  );
  const effectiveProjectId = props.projectId ?? selectedProjectId;
  const [editor, setEditor] = useState<DomainEntity | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [basePayload, setBasePayload] = useState<Record<string, unknown>>({});
  const [file, setFile] = useState<{
    grantId: string;
    kind: "file" | "directory";
    displayName: string;
    expiresAt: string;
    generation: number;
  }>();
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
      session.activeProjectId &&
      selectedProjectId !== session.activeProjectId
    )
      setSelectedProjectId(session.activeProjectId);
  }, [
    definition.projectRequired,
    props.projectId,
    selectedProjectId,
    session.activeProjectId,
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
    const selected = await client.host.pickFiles({ multiple: false });
    const first = selected?.[0];
    if (!first) return;
    setFile(first);
    if (!title.trim()) setTitle(first.displayName);
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
            ? { capabilityToken: file.grantId }
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
    if (!(await confirmDialog(`删除「${item.title}」吗？`))) return;
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
  const exportSubtitles = async (
    item: DomainEntity,
    format: "srt" | "vtt" | "txt",
  ) => {
    setActionError(undefined);
    setActionNotice(undefined);
    try {
      const document = await client.localization.subtitles(item.id, format);
      const saved = await client.host.saveTextFile({
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
      const saved = await client.host.saveTextFile({
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
    <section className="studio-card p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="studio-eyebrow">{props.title}资料库</p>
          <h2 className="mt-1 text-2xl font-semibold">{domainLabel(domain)}</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            {definition.description}
          </p>
        </div>
        <BareButton
          className="rounded-full bg-studio-dark px-5 py-2.5 text-sm font-medium text-white shadow-card hover:bg-rust"
          onClick={() => openEditor("new")}
        >
          新建{domainLabel(domain)}
        </BareButton>
      </div>
      <div className="mt-5 flex flex-wrap gap-2 rounded-xl bg-page p-2">
        {props.domains.map((item) => (
          <BareButton
            key={item}
            className={`rounded-full px-4 py-2 text-sm ${domain === item ? "bg-studio-dark text-white shadow-card" : "bg-surface-raised text-muted ring-1 ring-line hover:text-ink"}`}
            onClick={() => {
              setDomain(item);
              setEditor(null);
            }}
          >
            {domainLabel(item)}
          </BareButton>
        ))}
      </div>
      {!props.projectId && (
        <div className="mt-5 rounded-xl border border-line bg-surface p-4">
          <label className="grid max-w-sm gap-1 text-sm">
            所属项目
            <select
              className="rounded-lg border border-line px-3 py-2"
              value={selectedProjectId}
              onChange={(event) => {
                const nextProjectId = event.target.value;
                setSelectedProjectId(nextProjectId);
                if (nextProjectId) session.selectProject(nextProjectId);
              }}
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
        <section className="mt-5 rounded-xl border border-brand bg-brand-soft/30 p-5">
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
            <BareButton
              className="text-sm text-muted hover:text-brand"
              onClick={() => setEditor(null)}
            >
              取消
            </BareButton>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              {definition.titleLabel}
              <input
                className="rounded-lg border border-line bg-surface-raised px-3 py-2"
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
                    className="min-h-24 rounded-lg border border-line bg-surface-raised p-3"
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
                    className="rounded-lg border border-line bg-surface-raised px-3 py-2"
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
              <div className="mt-4 rounded-lg border border-dashed border-line bg-surface-raised p-3">
                <BareButton
                  className="rounded-lg border border-line px-3 py-2 text-sm text-muted"
                  onClick={() => void chooseFile()}
                >
                  {file ? `已选择：${file.displayName}` : "选择本地文件"}
                </BareButton>
                <p className="mt-2 text-xs text-muted">
                  文件路径不会暴露给界面，仅向本地服务授予一次性只读权限。
                </p>
              </div>
            )}
          {actionError && (
            <p className="mt-3 text-sm text-danger-strong">{actionError}</p>
          )}
          <div className="mt-4 flex justify-end">
            <BareButton
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={!title.trim() || saving}
              onClick={() => void save()}
            >
              {saving ? "保存中…" : "保存"}
            </BareButton>
          </div>
        </section>
      )}
      {templateRunner && (
        <section className="mt-5 rounded-xl border border-brand bg-brand-soft/30 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">
                运行模板：{templateRunner.title}
              </h2>
              <p className="mt-1 text-sm text-muted">
                填写变量后仅完成模板变量替换；这不是模型生成，结果会保存在项目记录中，不会自动写入正文。
              </p>
            </div>
            <BareButton
              className="text-sm text-muted hover:text-brand"
              onClick={() => setTemplateRunner(undefined)}
            >
              关闭
            </BareButton>
          </div>
          {Object.keys(templateValues).length ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {Object.keys(templateValues).map((name) => (
                <label key={name} className="grid gap-1 text-sm">
                  {name}
                  <input
                    className="rounded-lg border border-line bg-surface-raised px-3 py-2"
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
            <p className="mt-3 rounded-lg bg-warning-soft p-2 text-sm text-warning-strong">
              尚未填写：{templateMissing.join("、")}。对应位置会以空文本渲染。
            </p>
          )}
          {templateResult !== undefined && (
            <textarea
              className="mt-3 min-h-40 w-full rounded-lg border border-line bg-surface-raised p-3 font-editor text-sm"
              value={templateResult}
              readOnly
            />
          )}
          <div className="mt-4 flex justify-end">
            <BareButton
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={runningTemplate}
              onClick={() => void runTemplate()}
            >
              {runningTemplate ? "正在运行…" : "运行模板"}
            </BareButton>
          </div>
        </section>
      )}
      {error && (
        <p className="mt-4 text-sm text-danger-strong">{message(error)}</p>
      )}
      {actionError && !editor && (
        <p className="mt-4 text-sm text-danger-strong">{actionError}</p>
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
                  <BareButton
                    className="rounded-md px-2 py-1 text-xs text-brand hover:bg-brand-soft"
                    onClick={() => openEditor(item)}
                  >
                    编辑
                  </BareButton>
                  <BareButton
                    className="rounded-md px-2 py-1 text-xs text-danger-strong hover:bg-danger-soft"
                    onClick={() => void remove(item)}
                  >
                    删除
                  </BareButton>
                  {domain === "templates" && (
                    <BareButton
                      className="rounded-md px-2 py-1 text-xs text-brand hover:bg-brand-soft"
                      onClick={() => openTemplateRunner(item)}
                    >
                      运行
                    </BareButton>
                  )}
                  {domain === "providers" && (
                    <BareButton
                      className="rounded-md px-2 py-1 text-xs text-brand hover:bg-brand-soft"
                      onClick={() => void testProvider(item)}
                    >
                      测试连接
                    </BareButton>
                  )}
                  {domain === "providers" &&
                    payload["服务类型"] === "智能模型" && (
                      <BareButton
                        className="rounded-md px-2 py-1 text-xs text-brand hover:bg-brand-soft"
                        onClick={() => void activateProviderForAgent(item)}
                      >
                        设为智能助手模型
                      </BareButton>
                    )}
                  {domain === "delivery" && (
                    <BareButton
                      className="rounded-md px-2 py-1 text-xs text-brand hover:bg-brand-soft"
                      onClick={() => void exportDelivery(item)}
                    >
                      导出交付清单
                    </BareButton>
                  )}
                </div>
              </div>
              {(domain === "shot-stills" ||
                domain === "visual-assets" ||
                domain === "localization") && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <BareButton
                    className="rounded-md border border-brand px-2 py-1 text-xs text-brand"
                    onClick={() => void adopt(item)}
                  >
                    {domain === "localization"
                      ? "采用本地化版本"
                      : "采用此版本"}
                  </BareButton>
                  {domain === "visual-assets" &&
                    payload["锁定状态"] !== "已锁定" && (
                      <BareButton
                        className="rounded-md border border-line px-2 py-1 text-xs text-muted"
                        onClick={() => void lockVisualAsset(item)}
                      >
                        锁定此资产
                      </BareButton>
                    )}
                  {domain === "localization" && (
                    <>
                      <BareButton
                        className="rounded-md border border-line px-2 py-1 text-xs text-muted"
                        onClick={() => void exportSubtitles(item, "srt")}
                      >
                        导出字幕
                      </BareButton>
                      <BareButton
                        className="rounded-md border border-line px-2 py-1 text-xs text-muted"
                        onClick={() => void exportSubtitles(item, "vtt")}
                      >
                        导出网页字幕
                      </BareButton>
                      <BareButton
                        className="rounded-md border border-line px-2 py-1 text-xs text-muted"
                        onClick={() => void exportSubtitles(item, "txt")}
                      >
                        导出译文草稿 TXT
                      </BareButton>
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
