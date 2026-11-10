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
import { BareButton, NativeSelect } from "@dramaip/infra-ui-primitives";
import { confirmDialog } from "../controls";
import { useMutation, useQuery, useQueryClient } from "../query";
import { useEffect, useRef, useState } from "react";
import {
  providerEstimate,
  providerReviewStatusLabel,
  readProviderActionReview,
  readProjectProviderReview,
  readAssistantProviderReview,
  requireUnchangedProviderReview,
} from "../provider-action-review";
import { Link, useLocation } from "../router";
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
import styles from "./studio-widgets.module.css";
import { copyText } from "../copy";
import { clsx } from "clsx";
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
    <section className={styles.c1}>
      <div className={styles.c2}>
        <div>
          <p className={styles.c3}>
            {copyText("app/features/studio-widgets.1")}
          </p>
          <h1 className={styles.c4}>
            {copyText("app/features/studio-widgets.2")}
          </h1>
          <p className={styles.c5}>
            {copyText("app/features/studio-widgets.3")}
          </p>
        </div>
        <label className={styles.c6}>
          <input
            type="checkbox"
            checked={settings?.autoSuggest ?? false}
            disabled={!projectId}
            onChange={(event) => void updateAutoSuggest(event.target.checked)}
          />
          {copyText("app/features/studio-widgets.4")}
        </label>
      </div>
      <div className={styles.c7}>
        {!props.projectId && (
          <label className={styles.c8}>
            {copyText("app/features/studio-widgets.5")}
            <NativeSelect
              className={styles.c9}
              value={projectId}
              onChange={(event) => {
                const nextProjectId = event.target.value;
                setProjectId(nextProjectId);
                if (nextProjectId) session.selectProject(nextProjectId);
                setChapterId("");
              }}
            >
              <option value="">
                {copyText("app/features/studio-widgets.6")}
              </option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
        <label className={styles.c8}>
          {copyText("app/features/studio-widgets.7")}
          <NativeSelect
            className={styles.c9}
            disabled={!projectId}
            value={chapterId}
            onChange={(event) => setChapterId(event.target.value)}
          >
            <option value="">
              {copyText("app/features/studio-widgets.8")}
            </option>
            {chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.title}
              </option>
            ))}
          </NativeSelect>
        </label>
        <div className={styles.c10}>
          <BareButton
            className={styles.c11}
            disabled={!projectId || !chapterId}
            onClick={() => void queue()}
          >
            {copyText("app/features/studio-widgets.9")}
          </BareButton>
        </div>
      </div>
      {notice && <p className={styles.c12}>{notice}</p>}
      {staleMarks.length > 0 && (
        <div className={styles.c13}>
          <p className={styles.c14}>
            {copyText("app/features/studio-widgets.10")}
          </p>
          <p className={styles.c15}>
            {staleMarks
              .map((mark) => mark.reason)
              .filter((value, index, values) => values.indexOf(value) === index)
              .join("；")}
          </p>
        </div>
      )}
      <div className={styles.c16}>
        {requestedChangeSetId &&
          !changeSets.some((item) => item.id === requestedChangeSetId) && (
            <p role={changesLoading ? "status" : "alert"} className={styles.c3}>
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
              className={styles.c17}
            >
              <div className={styles.c2}>
                <div className={styles.c18}>
                  <p className={styles.c14}>{item.summary}</p>
                  <p className={styles.c19}>
                    {copyText("app/features/studio-widgets.11")}
                    {item.sourceVersion} ·{" "}
                    {STORY_BIBLE_STATUS_LABELS[item.status] ?? "未知状态"}
                  </p>
                  {(item.sourceState === "stale" ||
                    item.sourceState === "missing") && (
                    <p role="alert" className={styles.c20}>
                      {item.sourceState === "missing"
                        ? "来源章节不可用，不能采用此建议。"
                        : "来源版本已变化，不能采用此建议；历史草案仍保留，请核对当前章节后重新生成。"}
                    </p>
                  )}
                </div>
                <div className={styles.c21}>
                  {item.status === "draft" && (
                    <>
                      {item.sourceState !== "stale" &&
                        item.sourceState !== "missing" && (
                          <BareButton
                            className={styles.c22}
                            onClick={() => void apply(item)}
                          >
                            {copyText("app/features/studio-widgets.12")}
                          </BareButton>
                        )}
                      <BareButton
                        className={styles.c23}
                        onClick={() => void setStatus(item, "paused")}
                      >
                        {copyText("app/features/studio-widgets.13")}
                      </BareButton>
                    </>
                  )}
                  {item.status === "paused" &&
                    item.sourceState !== "stale" &&
                    item.sourceState !== "missing" && (
                      <BareButton
                        className={styles.c24}
                        onClick={() => void setStatus(item, "queued")}
                      >
                        {copyText("app/features/studio-widgets.14")}
                      </BareButton>
                    )}
                  {(["draft", "queued", "paused", "failed"].includes(
                    item.status,
                  ) ||
                    (item.status === "stale" && !item.appliedAt)) && (
                    <BareButton
                      className={styles.c23}
                      onClick={() => void setStatus(item, "discarded")}
                    >
                      {copyText("app/features/studio-widgets.15")}
                    </BareButton>
                  )}
                  {(item.status === "applied" ||
                    (item.status === "stale" && item.appliedAt)) && (
                    <BareButton
                      className={styles.c24}
                      onClick={() => void undo(item)}
                    >
                      {copyText("app/features/studio-widgets.16")}
                    </BareButton>
                  )}
                </div>
              </div>
              {item.conflictNotes.length > 0 && (
                <p className={styles.c25}>
                  {copyText("app/features/studio-widgets.17")}
                  {item.conflictNotes.join("；")}
                </p>
              )}
            </article>
          ))}
        {projectId && !changeSets.length && (
          <p className={styles.c26}>
            {copyText("app/features/studio-widgets.18")}
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
      aria-label={copyText("app/features/studio-widgets.19")}
      className={styles.c1}
    >
      <div>
        <p className={styles.c3}>
          {copyText("app/features/studio-widgets.20")}
        </p>
        <h2 className={styles.c4}>
          {copyText("app/features/studio-widgets.21")}
        </h2>
        <p className={styles.c5}>
          {copyText("app/features/studio-widgets.22")}
        </p>
        <p className={styles.c12}>
          {copyText("app/features/studio-widgets.23")}
        </p>
      </div>
      <div className={styles.c27}>
        <label className={styles.c8}>
          {copyText("app/features/studio-widgets.5")}
          <NativeSelect
            className={styles.c9}
            value={projectId}
            disabled={Boolean(props.projectId)}
            onChange={(event) => {
              setSelectedProjectId(event.target.value);
              if (event.target.value) session.selectProject(event.target.value);
            }}
          >
            <option value="">
              {copyText("app/features/studio-widgets.6")}
            </option>
            {(projects.data ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </NativeSelect>
        </label>
        <div className={styles.c10}>
          {projectId ? (
            <Link
              className={styles.c28}
              to={`/projects/${projectId}/tools/quality-review`}
            >
              {copyText("app/features/studio-widgets.24")}
            </Link>
          ) : (
            <p className={styles.c3}>
              {copyText("app/features/studio-widgets.25")}
            </p>
          )}
        </div>
      </div>
      <fieldset className={styles.c29}>
        <legend className={styles.c30}>
          {copyText("app/features/studio-widgets.26")}
        </legend>
        <div className={styles.c31}>
          {(
            Object.keys(CREATIVE_DIAGNOSTIC_LABELS) as CreativeDiagnosticKind[]
          ).map((kind) => (
            <label key={kind} className={styles.c32}>
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
        <p role="alert" className={styles.c33}>
          {copyText("app/features/studio-widgets.27")}
          {message(history.error)}
        </p>
      )}
      {projectId && !history.error && history.data === undefined && (
        <p className={styles.c34}>
          {copyText("app/features/studio-widgets.28")}
        </p>
      )}
      {projectId && declarations.error && (
        <p role="alert" className={styles.c35}>
          {copyText("app/features/studio-widgets.29")}
          {message(declarations.error)}
        </p>
      )}
      <div className={styles.c36}>
        {diagnostics?.map((diagnostic) => (
          <article key={diagnostic.id} className={styles.c17}>
            <div className={styles.c37}>
              <div>
                <p className={styles.c14}>{diagnostic.title}</p>
                <p className={styles.c19}>
                  {diagnostic.targetTitle} ·{" "}
                  {CREATIVE_DIAGNOSTIC_LABELS[diagnostic.kind]}
                </p>
              </div>
              <span className={styles.c38}>
                {copyText("app/features/studio-widgets.30")}
              </span>
            </div>
            <p className={styles.c39}>
              {copyText("app/features/studio-widgets.31")}
              {diagnostic.id}
              {copyText("app/features/studio-widgets.32")}
              {diagnostic.createdAt}
            </p>
            <details className={styles.c40}>
              <summary className={styles.c41}>
                {copyText("app/features/studio-widgets.33")}
              </summary>
              <p className={styles.c42}>
                {copyText("app/features/studio-widgets.34")}
                {diagnostic.summary}
              </p>
              <p className={styles.c43}>
                {copyText("app/features/studio-widgets.35")}
                {diagnostic.sourceFingerprint}
              </p>
              <div className={styles.c44}>
                {diagnostic.scores.map((item, index) => (
                  <span key={index} className={styles.c45}>
                    {copyText("app/features/studio-widgets.36")}
                    {item.label} {String(item.value)}
                  </span>
                ))}
              </div>
              {diagnostic.curve && (
                <p className={styles.c39}>
                  {copyText("app/features/studio-widgets.37")}
                  {diagnostic.curve.map(String).join(" → ")}
                </p>
              )}
              <ul className={styles.c46}>
                {diagnostic.findings.map((item, index) => (
                  <li key={index}>
                    {copyText("app/features/studio-widgets.38")}
                    {item}
                  </li>
                ))}
              </ul>
              <ul className={styles.c46}>
                {diagnostic.recommendations.map((item, index) => (
                  <li key={index}>
                    {copyText("app/features/studio-widgets.39")}
                    {item}
                  </li>
                ))}
              </ul>
              {(declarations.data ?? [])
                .filter((item) => item.diagnosticId === diagnostic.id)
                .map((item) => (
                  <p key={item.id} className={styles.c39}>
                    {copyText("app/features/studio-widgets.40")}
                    {item.issueKey}
                    {copyText("app/features/studio-widgets.41")}{" "}
                    {item.disposition}
                    {item.actorLabel ? ` · ${item.actorLabel}` : ""}
                    {item.note ? ` · ${item.note}` : ""}
                  </p>
                ))}
            </details>
          </article>
        ))}
        {projectId && history.data !== undefined && !diagnostics?.length && (
          <p className={styles.c47}>
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
    <section className={styles.c48}>
      <h3 className={styles.c49}>
        {copyText("app/features/studio-widgets.42")}
      </h3>
      <p className={styles.c50}>{copyText("app/features/studio-widgets.43")}</p>
      <div className={styles.c51}>
        <label className={styles.c8}>
          {copyText("app/features/studio-widgets.44")}
          <input
            className={styles.c52}
            placeholder={copyText("app/features/studio-widgets.45")}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className={styles.c8}>
          {copyText("app/features/studio-widgets.46")}
          <input
            className={styles.c52}
            placeholder={copyText("app/features/studio-widgets.47")}
            value={genre}
            onChange={(event) => setGenre(event.target.value)}
          />
        </label>
        <label className={styles.c53}>
          {copyText("app/features/studio-widgets.48")}
          <textarea
            className={styles.c54}
            placeholder={copyText("app/features/studio-widgets.49")}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </label>
        <label className={styles.c8}>
          {copyText("app/features/studio-widgets.50")}
          <input
            className={styles.c52}
            value={hooks}
            onChange={(event) => setHooks(event.target.value)}
          />
        </label>
        <label className={styles.c8}>
          {copyText("app/features/studio-widgets.51")}
          <input
            className={styles.c52}
            value={riskTags}
            onChange={(event) => setRiskTags(event.target.value)}
          />
        </label>
      </div>
      <div className={styles.c55}>
        <BareButton
          className={styles.c56}
          disabled={!title.trim()}
          onClick={() => void create()}
        >
          {copyText("app/features/studio-widgets.52")}
        </BareButton>
      </div>
      {notice && <p className={styles.c57}>{notice}</p>}
      <div className={styles.c58}>
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
    <article className={styles.c59}>
      {editing ? (
        <div className={styles.c60}>
          <input
            className={styles.c61}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <input
            className={styles.c61}
            placeholder={copyText("app/features/studio-widgets.46")}
            value={genre}
            onChange={(event) => setGenre(event.target.value)}
          />
          <textarea
            className={styles.c62}
            placeholder={copyText("app/features/studio-widgets.48")}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </div>
      ) : (
        <>
          <p className={styles.c14}>{props.item.title}</p>
          <p className={styles.c19}>
            {[props.item.genre, props.item.summary]
              .filter(Boolean)
              .join(" · ") || "未补充摘要"}
          </p>
        </>
      )}
      <div className={styles.c63}>
        {editing ? (
          <BareButton className={styles.c24} onClick={() => void save()}>
            {copyText("app/features/studio-widgets.53")}
          </BareButton>
        ) : (
          <BareButton className={styles.c24} onClick={() => setEditing(true)}>
            {copyText("app/features/studio-widgets.54")}
          </BareButton>
        )}
        <BareButton className={styles.c64} onClick={() => void remove()}>
          {copyText("app/features/studio-widgets.55")}
        </BareButton>
      </div>
      {notice && <p className={styles.c65}>{notice}</p>}
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
    <section className={styles.c66}>
      <div className={styles.c67}>
        <div>
          <p className={styles.c68}>
            {copyText("app/features/studio-widgets.56")}
          </p>
          <p className={styles.c19}>
            {copyText("app/features/studio-widgets.57")}
            {props.preview.baseVersion}{" "}
            {copyText("app/features/studio-widgets.58")}
          </p>
        </div>
        <span className={styles.c69}>{statusLabel}</span>
      </div>
      {props.preview.rationale && (
        <p className={styles.c70}>{props.preview.rationale}</p>
      )}
      <details className={styles.c71}>
        <summary className={styles.c72}>
          {copyText("app/features/studio-widgets.59")}
        </summary>
        <pre className={styles.c73}>{props.preview.proposedContent}</pre>
      </details>
      {(status === "pending" || status === "conflicted") && (
        <div className={styles.c44}>
          {status === "pending" && (
            <BareButton
              className={styles.c74}
              disabled={commit.isPending || discard.isPending}
              onClick={() => commit.mutate()}
            >
              {commit.isPending ? "正在采用…" : "确认采用修订"}
            </BareButton>
          )}
          <BareButton
            className={styles.c75}
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
      {notice && <p className={styles.c76}>{notice}</p>}
      {status === "committed" && props.projectId && (
        <Link className={styles.c77} to={`/projects/${props.projectId}`}>
          {copyText("app/features/studio-widgets.60")}
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
    <section className={styles.c66}>
      <div className={styles.c67}>
        <div>
          <p className={styles.c68}>
            {copyText("app/features/studio-widgets.61")}
          </p>
          <p className={styles.c19}>
            {copyText("app/features/studio-widgets.62")}
            {props.preview.targets.length}
            {copyText("app/features/studio-widgets.63")}
          </p>
        </div>
        <span className={styles.c69}>{statusLabel}</span>
      </div>
      <p className={styles.c70}>{props.preview.rationale}</p>
      {project && (
        <div className={styles.c78}>
          <CreativeIntentSummary
            project={project}
            preview={{ ...props.preview, status }}
            compact
          />
        </div>
      )}
      <div className={styles.c79}>
        {props.preview.targets.map((target, index) => (
          <details key={`${target.kind}-${target.id}`} className={styles.c80}>
            <summary className={styles.c72}>
              {copyText("app/features/studio-widgets.64")}
              {index + 1} · {changeTargetLabel(target.kind)}
              {copyText("app/features/studio-widgets.65")} {target.baseVersion}
            </summary>
            <pre className={styles.c81}>{changeTargetPreviewText(target)}</pre>
          </details>
        ))}
      </div>
      {status === "pending" && (
        <div className={styles.c44}>
          <BareButton
            className={styles.c74}
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
            className={styles.c75}
            disabled={commit.isPending || discard.isPending}
            onClick={() => discard.mutate()}
          >
            {discard.isPending ? "正在放弃…" : "放弃此预览"}
          </BareButton>
        </div>
      )}
      {status === "conflicted" && (
        <div className={styles.c82}>
          <p>{copyText("app/features/studio-widgets.66")}</p>
          <div className={styles.c83}>
            <BareButton
              className={styles.c84}
              onClick={async () => {
                await queryClient.invalidateQueries({
                  queryKey: ["project", props.preview.projectId],
                });
                await queryClient.invalidateQueries({ queryKey: ["tasks"] });
                setNotice("已重新读取最新项目与任务状态，请重新生成建议。");
              }}
            >
              {copyText("app/features/studio-widgets.67")}
            </BareButton>
            <Link
              className={styles.c84}
              to={`/tasks?projectId=${encodeURIComponent(props.preview.projectId)}`}
            >
              {copyText("app/features/studio-widgets.68")}
            </Link>
          </div>
        </div>
      )}
      {notice && <p className={styles.c76}>{notice}</p>}
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
      <p role={actual.error ? "alert" : "status"} className={styles.c85}>
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
      aria-label={copyText("app/features/studio-widgets.69")}
      className={styles.c86}
    >
      <div className={styles.c67}>
        <div>
          <p className={styles.c68}>
            {kindLabel}
            {copyText("app/features/studio-widgets.70")}
          </p>
          <p className={styles.c19}>
            {copyText("app/features/studio-widgets.71")}
          </p>
        </div>
        <span className={styles.c87}>
          {providerReviewStatusLabel(props.preview.status)}
        </span>
      </div>
      <dl className={styles.c88}>
        <div>
          <dt className={styles.c89}>
            {copyText("app/features/studio-widgets.72")}
          </dt>
          <dd className={styles.c90}>{props.preview.providerId}</dd>
        </div>
        {props.preview.modelId && (
          <div>
            <dt className={styles.c89}>
              {copyText("app/features/studio-widgets.73")}
            </dt>
            <dd className={styles.c90}>{props.preview.modelId}</dd>
          </div>
        )}
        <div>
          <dt className={styles.c89}>
            {copyText("app/features/studio-widgets.74")}
          </dt>
          <dd className={styles.c90}>{estimate.label}</dd>
        </div>
      </dl>
      <p className={styles.c43}>{copyText("app/features/studio-widgets.75")}</p>
      <details className={styles.c71}>
        <summary className={styles.c91}>
          {copyText("app/features/studio-widgets.76")}
        </summary>
        <pre className={styles.c92}>
          {JSON.stringify(props.preview.parameters, null, 2)}
        </pre>
      </details>
      {props.preview.status === "pending" && (
        <div className={styles.c44}>
          <BareButton
            className={styles.c93}
            disabled={!estimate.known || execute.isPending || discard.isPending}
            onClick={() => void confirmExecution()}
          >
            {execute.isPending ? "正在创建任务…" : "确认并创建远程任务"}
          </BareButton>
          <BareButton
            className={styles.c75}
            disabled={execute.isPending || discard.isPending}
            onClick={() => discard.mutate()}
          >
            {discard.isPending ? "正在放弃…" : "放弃此次调用"}
          </BareButton>
        </div>
      )}
      {props.preview.status === "pending" && !estimate.known && (
        <p className={styles.c94}>
          {copyText("app/features/studio-widgets.77")}
        </p>
      )}
      {notice && (
        <p role="alert" className={styles.c94}>
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
    description: "为一个分镜维护静帧 AI 草稿，并在人工确认后采用其中一个版本。",
    titleLabel: "静帧 AI 草稿名称",
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
    <section className={styles.c95}>
      <div className={styles.c96}>
        <div>
          <p className={styles.c97}>
            {props.title}
            {copyText("app/features/studio-widgets.78")}
          </p>
          <h2 className={styles.c4}>{domainLabel(domain)}</h2>
          <p className={styles.c98}>{definition.description}</p>
        </div>
        <BareButton className={styles.c99} onClick={() => openEditor("new")}>
          {copyText("app/features/studio-widgets.79")}
          {domainLabel(domain)}
        </BareButton>
      </div>
      <div className={styles.c100}>
        {props.domains.map((item) => (
          <BareButton
            key={item}
            className={clsx(
              styles.c101,
              domain === item ? styles.k1 : styles.k2,
            )}
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
        <div className={styles.c102}>
          <label className={styles.c103}>
            {copyText("app/features/studio-widgets.80")}
            <NativeSelect
              className={styles.c9}
              value={selectedProjectId}
              onChange={(event) => {
                const nextProjectId = event.target.value;
                setSelectedProjectId(nextProjectId);
                if (nextProjectId) session.selectProject(nextProjectId);
              }}
            >
              {!definition.projectRequired && (
                <option value="">
                  {copyText("app/features/studio-widgets.81")}
                </option>
              )}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </NativeSelect>
          </label>
        </div>
      )}
      {editor && (
        <section className={styles.c104}>
          <div className={styles.c105}>
            <div>
              <h2 className={styles.c49}>
                {editor === "new"
                  ? `新建${domainLabel(domain)}`
                  : `编辑${domainLabel(domain)}`}
              </h2>
              <p className={styles.c50}>
                {copyText("app/features/studio-widgets.82")}
              </p>
            </div>
            <BareButton className={styles.c106} onClick={() => setEditor(null)}>
              {copyText("app/features/studio-widgets.83")}
            </BareButton>
          </div>
          <div className={styles.c27}>
            <label className={styles.c8}>
              {definition.titleLabel}
              <input
                className={styles.c107}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            {definition.fields.map((field) => (
              <label
                key={field.key}
                className={clsx(
                  styles.c8,
                  field.kind === "multiline" ? styles.k3 : "",
                )}
              >
                {field.label}
                {field.kind === "multiline" ? (
                  <textarea
                    className={styles.c108}
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
                    className={styles.c109}
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
                    className={styles.c107}
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
              <div className={styles.c110}>
                <BareButton
                  className={styles.c111}
                  onClick={() => void chooseFile()}
                >
                  {file ? `已选择：${file.displayName}` : "选择本地文件"}
                </BareButton>
                <p className={styles.c43}>
                  {copyText("app/features/studio-widgets.84")}
                </p>
              </div>
            )}
          {actionError && <p className={styles.c112}>{actionError}</p>}
          <div className={styles.c113}>
            <BareButton
              className={styles.c56}
              disabled={!title.trim() || saving}
              onClick={() => void save()}
            >
              {saving ? "保存中…" : "保存"}
            </BareButton>
          </div>
        </section>
      )}
      {templateRunner && (
        <section className={styles.c104}>
          <div className={styles.c2}>
            <div>
              <h2 className={styles.c49}>
                {copyText("app/features/studio-widgets.85")}
                {templateRunner.title}
              </h2>
              <p className={styles.c50}>
                {copyText("app/features/studio-widgets.86")}
              </p>
            </div>
            <BareButton
              className={styles.c106}
              onClick={() => setTemplateRunner(undefined)}
            >
              {copyText("app/features/studio-widgets.87")}
            </BareButton>
          </div>
          {Object.keys(templateValues).length ? (
            <div className={styles.c27}>
              {Object.keys(templateValues).map((name) => (
                <label key={name} className={styles.c8}>
                  {name}
                  <input
                    className={styles.c107}
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
            <p className={styles.c34}>
              {copyText("app/features/studio-widgets.88")}
            </p>
          )}
          {templateMissing.length > 0 && (
            <p className={styles.c114}>
              {copyText("app/features/studio-widgets.89")}
              {templateMissing.join("、")}
              {copyText("app/features/studio-widgets.90")}
            </p>
          )}
          {templateResult !== undefined && (
            <textarea className={styles.c115} value={templateResult} readOnly />
          )}
          <div className={styles.c113}>
            <BareButton
              className={styles.c56}
              disabled={runningTemplate}
              onClick={() => void runTemplate()}
            >
              {runningTemplate ? "正在运行…" : "运行模板"}
            </BareButton>
          </div>
        </section>
      )}
      {error && <p className={styles.c116}>{message(error)}</p>}
      {actionError && !editor && <p className={styles.c116}>{actionError}</p>}
      {actionNotice && <p className={styles.c117}>{actionNotice}</p>}
      <div className={styles.c118}>
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
            <article key={item.id} className={styles.c119}>
              <div className={styles.c120}>
                <div className={styles.c18}>
                  <p className={styles.c121}>{item.title}</p>
                  <p className={styles.c19}>
                    {copyText("app/features/studio-widgets.91")}
                    {item.version}
                  </p>
                </div>
                <div className={styles.c122}>
                  <BareButton
                    className={styles.c123}
                    onClick={() => openEditor(item)}
                  >
                    {copyText("app/features/studio-widgets.54")}
                  </BareButton>
                  <BareButton
                    className={styles.c124}
                    onClick={() => void remove(item)}
                  >
                    {copyText("app/features/studio-widgets.55")}
                  </BareButton>
                  {domain === "templates" && (
                    <BareButton
                      className={styles.c123}
                      onClick={() => openTemplateRunner(item)}
                    >
                      {copyText("app/features/studio-widgets.92")}
                    </BareButton>
                  )}
                  {domain === "providers" && (
                    <BareButton
                      className={styles.c123}
                      onClick={() => void testProvider(item)}
                    >
                      {copyText("app/features/studio-widgets.93")}
                    </BareButton>
                  )}
                  {domain === "providers" &&
                    payload["服务类型"] === "智能模型" && (
                      <BareButton
                        className={styles.c123}
                        onClick={() => void activateProviderForAgent(item)}
                      >
                        {copyText("app/features/studio-widgets.94")}
                      </BareButton>
                    )}
                  {domain === "delivery" && (
                    <BareButton
                      className={styles.c123}
                      onClick={() => void exportDelivery(item)}
                    >
                      {copyText("app/features/studio-widgets.95")}
                    </BareButton>
                  )}
                </div>
              </div>
              {(domain === "shot-stills" ||
                domain === "visual-assets" ||
                domain === "localization") && (
                <div className={styles.c44}>
                  <BareButton
                    className={styles.c125}
                    onClick={() => void adopt(item)}
                  >
                    {domain === "localization"
                      ? "采用本地化版本"
                      : "采用此版本"}
                  </BareButton>
                  {domain === "visual-assets" &&
                    payload["锁定状态"] !== "已锁定" && (
                      <BareButton
                        className={styles.c23}
                        onClick={() => void lockVisualAsset(item)}
                      >
                        {copyText("app/features/studio-widgets.96")}
                      </BareButton>
                    )}
                  {domain === "localization" && (
                    <>
                      <BareButton
                        className={styles.c23}
                        onClick={() => void exportSubtitles(item, "srt")}
                      >
                        {copyText("app/features/studio-widgets.97")}
                      </BareButton>
                      <BareButton
                        className={styles.c23}
                        onClick={() => void exportSubtitles(item, "vtt")}
                      >
                        {copyText("app/features/studio-widgets.98")}
                      </BareButton>
                      <BareButton
                        className={styles.c23}
                        onClick={() => void exportSubtitles(item, "txt")}
                      >
                        {copyText("app/features/studio-widgets.99")}
                      </BareButton>
                    </>
                  )}
                </div>
              )}
              <dl className={styles.c126}>
                {details.map(({ label, value }) => (
                  <div key={label} className={styles.c127}>
                    <dt className={styles.c128}>{label}</dt>
                    <dd className={styles.c129}>{String(value)}</dd>
                  </div>
                ))}
                {!details.length && (
                  <p className={styles.c3}>
                    {copyText("app/features/studio-widgets.100")}
                  </p>
                )}
              </dl>
            </article>
          );
        })}
        {!items.length && (
          <p className={styles.c130}>
            {copyText("app/features/studio-widgets.101")}
            {domainLabel(domain)}
            {copyText("app/features/studio-widgets.102")}
          </p>
        )}
      </div>
    </section>
  );
}
