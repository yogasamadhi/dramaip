import type {
  ChangePreview,
  CreativeCaseStudy,
  CreativeDiagnosticKind,
  DomainEntity,
  ProviderActionPreview,
  RevisionPreview,
  StoryBibleChangeSet,
} from "@dramaip/contracts/product";
import { BareButton, confirmDialog } from "@dramaip/ui-shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  CREATIVE_DIAGNOSTIC_LABELS,
  domainLabel,
  message,
  useStudio,
} from "../studio-shared";
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
  const queryClient = useQueryClient();
  const location = useLocation();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const [projectId, setProjectId] = useState(props.projectId ?? "");
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
    if (props.projectId) setProjectId(props.projectId);
  }, [props.projectId]);
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
                    <BareButton
                      className="rounded-md bg-brand px-2 py-1 text-xs text-white"
                      onClick={() => void apply(item)}
                    >
                      采用
                    </BareButton>
                    <BareButton
                      className="rounded-md border border-line px-2 py-1 text-xs text-muted"
                      onClick={() => void setStatus(item, "paused")}
                    >
                      暂停
                    </BareButton>
                    <BareButton
                      className="rounded-md border border-line px-2 py-1 text-xs text-muted"
                      onClick={() => void setStatus(item, "discarded")}
                    >
                      丢弃
                    </BareButton>
                  </>
                )}
                {item.status === "paused" && (
                  <BareButton
                    className="rounded-md border border-line px-2 py-1 text-xs text-brand"
                    onClick={() => void setStatus(item, "queued")}
                  >
                    恢复
                  </BareButton>
                )}
                {(item.status === "applied" || item.status === "stale") && (
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

export function CreativeDiagnosticsPanel() {
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
    <section className="rounded-xl border border-line bg-surface p-5">
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
          <BareButton
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!projectId || !kinds.length}
            onClick={() => void run()}
          >
            生成创意诊断
          </BareButton>
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
                  className="rounded-md bg-canvas px-2 py-1 text-xs"
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
                        <BareButton
                          className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-brand"
                          onClick={() => void acknowledge(diagnostic.id, item)}
                        >
                          确认知悉
                        </BareButton>
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
          className="rounded-md border border-line px-2 py-1 text-xs text-red-600"
          onClick={() => void remove()}
        >
          删除
        </BareButton>
      </div>
      {notice && <p className="mt-2 text-xs text-red-600">{notice}</p>}
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
      {status === "pending" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <BareButton
            className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={commit.isPending || discard.isPending}
            onClick={() => commit.mutate()}
          >
            {commit.isPending ? "正在采用…" : "确认采用修订"}
          </BareButton>
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
      {notice && <p className="mt-3 text-xs leading-5 text-muted">{notice}</p>}
    </section>
  );
}

export function AgentProviderActionPreviewCard(props: {
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
        <span className="rounded-full bg-surface-raised px-2 py-1 text-xs text-amber-800">
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
      <details className="mt-3 rounded-md bg-surface-raised/80 p-3">
        <summary className="cursor-pointer text-sm font-medium text-amber-800">
          查看建议参数
        </summary>
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap font-sans text-sm leading-6 text-ink">
          {JSON.stringify(props.preview.parameters, null, 2)}
        </pre>
      </details>
      {status === "pending" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <BareButton
            className="rounded-lg bg-amber-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={costUnknown || execute.isPending || discard.isPending}
            onClick={async () => {
              const cost =
                props.preview.estimatedCost === undefined
                  ? "费用以厂商实际账单为准"
                  : `预估费用 ${props.preview.estimatedCost.toFixed(4)} ${props.preview.currency ?? "USD"}`;
              if (await confirmDialog(`确认发起${kindLabel}吗？${cost}。`))
                execute.mutate();
            }}
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
      {status === "pending" && costUnknown && (
        <p className="mt-3 text-xs leading-5 text-amber-800">
          厂商尚未返回可靠报价，远程任务已禁用。请更新服务商报价后重新生成调用预览；在此之前不会产生媒体生成费用。
        </p>
      )}
      {notice && <p className="mt-3 text-xs leading-5 text-muted">{notice}</p>}
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
  const exportSubtitles = async (item: DomainEntity, format: "srt" | "vtt") => {
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
            <p className="mt-3 text-sm text-red-600">{actionError}</p>
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
            <p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
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
                  <BareButton
                    className="rounded-md px-2 py-1 text-xs text-brand hover:bg-brand-soft"
                    onClick={() => openEditor(item)}
                  >
                    编辑
                  </BareButton>
                  <BareButton
                    className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
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
