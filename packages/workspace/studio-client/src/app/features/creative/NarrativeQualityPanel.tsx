import {
  currentOwnerQuery,
  CURRENT_OWNER_READ_OPTIONS,
  exactNavigationError,
  sameFrozenOwnerSnapshot,
} from "../../current-owner-read";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "../../query";
import { Link, useSearchParams } from "../../router";
import { Button, NativeSelect } from "@dramaip/infra-ui-primitives";
import { confirmDialog } from "../../controls";
import {
  NarrativeQualityDimensionSchema,
  NarrativeQualityRequestSchema,
  type NarrativeQualityRequest,
  type NarrativeQualityReport,
} from "@dramaip/contracts/creative-quality";
import { useStudio, message } from "../../studio-shared";
import { CreationWorkbench } from "../creation-workbench";
import { NarrativeIndexPanel } from "./NarrativeIndexPanel";
import { NarrativeSummaryPanel } from "./NarrativeSummaryPanel";
import { NarrativeLocalQualityPanel } from "./NarrativeLocalQualityPanel";
import { NarrativeQualitySourceCoverage } from "../NarrativeQualitySourceCoverage";
import {
  matchesExactStageCandidate,
  resolveStageCandidateId,
} from "../../exact-object-navigation";
import { NovelContextPicker } from "../novel/NovelContextPicker";
import {
  sameQualityRequest,
  isQualityRequestCurrent,
  QUALITY_DIMENSION_LABELS as QUALITY_DIMENSIONS,
} from "../../narrative-quality-scope";
import styles from "./NarrativeQualityPanel.module.css";
import { copyText } from "../../copy";

export { QUALITY_DIMENSIONS };
const targetKey = (target: NarrativeQualityRequest["target"]) =>
  `${target.kind}:${target.id}`;
const reportStatus = (value: NarrativeQualityReport) =>
  value.status === "awaiting-review"
    ? "等待审阅采用"
    : value.status === "discarded"
      ? "已放弃"
      : value.isCurrent
        ? "当前已采用报告"
        : "历史已采用报告";

function QualityIssue(props: {
  report: NarrativeQualityReport;
  issue: NarrativeQualityReport["content"]["issues"][number];
  reports: NarrativeQualityReport[];
  onChanged(): Promise<unknown>;
}) {
  const client = useStudio();
  const { report, issue } = props;
  const decision = report.dispositions.find(
    (value) => value.issueId === issue.id,
  );
  const [note, setNote] = useState(decision?.note ?? "");
  const [recheck, setRecheck] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const keys = useRef(new Map<string, string>());
  const canDecide =
    report.status === "adopted" && report.sourceState === "current";
  const eligible = props.reports.filter(
    (value) =>
      value.id !== report.id &&
      value.isCurrent &&
      value.status === "adopted" &&
      value.sourceState === "current" &&
      sameQualityRequest(value.basis.request, report.basis.request),
  );
  const decide = async (state: "open" | "accepted-risk" | "resolved") => {
    if (
      !canDecide ||
      busy ||
      !note.trim() ||
      (state === "resolved" && !recheck)
    )
      return;
    const input = {
      issueId: issue.id,
      version: report.version,
      state,
      note: note.trim(),
      confirmed: true as const,
      ...(state === "resolved" ? { recheckReportId: recheck } : {}),
    };
    if (
      !(await confirmDialog({
        title:
          state === "accepted-risk"
            ? "明确接受此风险"
            : state === "resolved"
              ? "记录复检后的解决决定"
              : "重新打开质量问题",
        description: `只记录报告 v${report.version} 的人工决定，不改正文。${state === "accepted-risk" ? "接受风险不代表修复或质量保证。" : state === "resolved" ? "系统还会核对所选当前复检报告；无真实依据不能标为解决。" : "问题重新进入未处理状态。"}`,
        confirmLabel: "确认记录决定",
      }))
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      const fingerprint = JSON.stringify([report.id, input]);
      const key = keys.current.get(fingerprint) ?? crypto.randomUUID();
      keys.current.set(fingerprint, key);
      await client.narrativeQuality.disposition(report.id, input, key);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
      await props.onChanged();
    }
  };
  return (
    <article data-quality-issue-id={issue.id} className={styles.c1}>
      <h4 className={styles.c2}>
        {QUALITY_DIMENSIONS[issue.category]} ·{" "}
        {issue.severity === "error"
          ? "错误"
          : issue.severity === "warning"
            ? "提醒"
            : "建议"}{" "}
        {copyText("app/features/creative/NarrativeQualityPanel.1")}
      </h4>
      <p className={styles.c3}>{issue.message}</p>
      <p className={styles.c4}>
        {copyText("app/features/creative/NarrativeQualityPanel.2")}
        {issue.suggestion}
      </p>
      {issue.evidence.map((evidence, index) => (
        <div key={index} className={styles.c5}>
          <p className={styles.c6}>
            {copyText("app/features/creative/NarrativeQualityPanel.3")}
            {evidence.sourceId}
            {copyText("app/features/creative/NarrativeQualityPanel.4")}
            {evidence.sourceVersion} · {evidence.fieldPath}
            {copyText("app/features/creative/NarrativeQualityPanel.5")}
            {evidence.valuePath}
          </p>
          <blockquote className={styles.c7}>{evidence.quote}</blockquote>
        </div>
      ))}
      <p
        className={styles.c8}
        data-quality-decision={decision?.state ?? "open"}
      >
        {copyText("app/features/creative/NarrativeQualityPanel.6")}
        {decision?.state === "accepted-risk"
          ? "已明确接受风险（不是修复）"
          : decision?.state === "resolved"
            ? "已依据复检记录解决"
            : "待处理"}
        {decision?.recheckReportId
          ? ` · 复检报告 ${decision.recheckReportId}`
          : ""}
      </p>
      {decision?.note && (
        <p className={styles.c4}>
          {copyText("app/features/creative/NarrativeQualityPanel.7")}
          {decision.note}
        </p>
      )}
      {canDecide && (
        <div className={styles.c9}>
          <label className={styles.c10}>
            {copyText("app/features/creative/NarrativeQualityPanel.8")}
            <textarea
              aria-label={copyText(
                "app/features/creative/NarrativeQualityPanel.81",
                { p1: issue.id },
              )}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className={styles.c11}
            />
          </label>
          <label className={styles.c10}>
            {copyText("app/features/creative/NarrativeQualityPanel.9")}
            <NativeSelect
              aria-label={copyText(
                "app/features/creative/NarrativeQualityPanel.82",
                { p1: issue.id },
              )}
              value={recheck}
              onChange={(event) => setRecheck(event.target.value)}
              className={styles.c12}
            >
              <option value="">
                {copyText("app/features/creative/NarrativeQualityPanel.10")}
              </option>
              {eligible.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.id}
                  {copyText("app/features/creative/NarrativeQualityPanel.11")}
                  {value.version}
                </option>
              ))}
            </NativeSelect>
          </label>
          <div className={styles.c13}>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !note.trim()}
              onClick={() => void decide("accepted-risk")}
            >
              {copyText("app/features/creative/NarrativeQualityPanel.12")}
            </Button>
            <Button
              size="sm"
              disabled={busy || !note.trim() || !recheck}
              onClick={() => void decide("resolved")}
            >
              {copyText("app/features/creative/NarrativeQualityPanel.13")}
            </Button>
            {decision && decision.state !== "open" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !note.trim()}
                onClick={() => void decide("open")}
              >
                {copyText("app/features/creative/NarrativeQualityPanel.14")}
              </Button>
            )}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className={styles.c14}>
          {error}
        </p>
      )}
    </article>
  );
}

export function NarrativeQualityPanel({ projectId }: { projectId: string }) {
  const client = useStudio();
  const queries = useQueryClient();
  const [params, setParams] = useSearchParams();
  const navigationError = exactNavigationError(params, [
    "workflowId",
    "reportId",
  ]);
  const draftKey = `dramaip-quality-scope:${projectId}`;
  const [request, setRequest] = useState<NarrativeQualityRequest | undefined>(
    () => {
      try {
        const parsed = NarrativeQualityRequestSchema.safeParse(
          JSON.parse(window.localStorage.getItem(draftKey) ?? "null"),
        );
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },
  );
  const [target, setTarget] = useState(
    request ? targetKey(request.target) : "",
  );
  const [dimensions, setDimensions] = useState<
    NarrativeQualityRequest["dimensions"]
  >(request?.dimensions ?? [...NarrativeQualityDimensionSchema.options]);
  const [chapterMode, setChapterMode] = useState<"selection" | "full">(
    request?.chapterScope?.mode ?? "selection",
  );
  const [chapterIds, setChapterIds] = useState<string[]>(
    request?.chapterScope?.chapters.map((chapter) => chapter.id) ?? [],
  );
  const [focused, setFocused] = useState<string>();
  const [mixed, setMixed] = useState(Boolean(request?.context));
  const [context, setContext] = useState<
    NonNullable<NarrativeQualityRequest["context"]>
  >(request?.context ?? { format: "narrative-context-v1", chapters: [] });
  const expressionChapters = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["quality-expression-chapters", projectId],
      queryFn: () => client.chapters.list(projectId),
      enabled: mixed && target === `chapter-set:${projectId}`,
    }),
  );
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const keys = useRef(new Map<string, string>());
  const catalog = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["narrative-quality-sources", projectId],
      queryFn: () => client.narrativeQuality.sources(projectId),
      refetchOnMount: "always",
      refetchInterval: 2000,
    }),
  );
  const history = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["narrative-quality-history", projectId],
      refetchOnMount: "always",
      queryFn: async () => {
        const values: NarrativeQualityReport[] = [];
        const seen = new Set<string>();
        const identities = new Set<string>();
        let cursor: string | undefined;
        do {
          const page = await client.narrativeQuality.list(
            projectId,
            cursor,
            100,
          );
          for (const value of page.items) {
            if (value.projectId !== projectId || identities.has(value.id))
              throw new Error("质量历史归属或完整分页无法核对。");
            identities.add(value.id);
            values.push(value);
          }
          cursor = page.nextCursor;
          if (cursor && seen.has(cursor))
            throw new Error("质量报告历史游标重复，尚未核全。");
          if (cursor) seen.add(cursor);
        } while (cursor);
        return values;
      },
      refetchInterval: 2000,
    }),
  );
  const requestedWorkflow = params.get("workflowId") ?? undefined;
  const run = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["creation-workflow", projectId, requestedWorkflow],
      queryFn: () => client.creation.get(requestedWorkflow!),
      enabled: Boolean(requestedWorkflow) && !navigationError,
      refetchOnMount: "always",
      refetchInterval: 1500,
    }),
  );
  const validRun =
    !navigationError &&
    !run.error &&
    run.data?.id === requestedWorkflow &&
    run.data?.input.projectId === projectId &&
    run.data.input.operation === "quality-review" &&
    Boolean(run.data.input.qualityReviewRequest)
      ? run.data
      : undefined;
  const requestedReportId = params.get("reportId") ?? undefined;
  const reportId =
    navigationError || params.has("localReviewId")
      ? undefined
      : resolveStageCandidateId({
          requestedId: requestedReportId,
          requestedWorkflowId: requestedWorkflow,
          workflowCandidateId: validRun?.narrativeReportId,
          focusedId: focused,
          latestId: history.data?.[0]?.id,
        });
  const detail = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["narrative-quality-report", projectId, reportId],
      queryFn: () => client.narrativeQuality.get(reportId!),
      enabled: Boolean(reportId),
      refetchOnMount: "always",
      refetchInterval: 1500,
    }),
  );
  const value =
    !detail.error &&
    matchesExactStageCandidate(detail.data, {
      projectId,
      candidateId: reportId,
      workflowId: requestedWorkflow,
    }) &&
    (!requestedWorkflow ||
      (validRun?.narrativeReportId === detail.data.id &&
        sameFrozenOwnerSnapshot(
          validRun.input.qualityReviewRequest,
          detail.data.basis.request,
        )))
      ? detail.data
      : undefined;
  const reportRun = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["creation-workflow", projectId, value?.workflowId],
      queryFn: () => client.creation.get(value!.workflowId),
      enabled: Boolean(value?.workflowId),
      refetchOnMount: "always",
      refetchInterval: 1500,
    }),
  );
  const actualRun =
    !reportRun.error &&
    reportRun.data?.id === value?.workflowId &&
    reportRun.data?.input.projectId === projectId &&
    reportRun.data.input.operation === "quality-review" &&
    reportRun.data.narrativeReportId === value?.id &&
    sameFrozenOwnerSnapshot(
      reportRun.data.input.qualityReviewRequest,
      value?.basis.request,
    )
      ? reportRun.data
      : undefined;
  const refresh = () =>
    Promise.all([
      queries.invalidateQueries({
        queryKey: ["narrative-quality-history", projectId],
      }),
      queries.invalidateQueries({ queryKey: ["narrative-quality-report"] }),
      queries.invalidateQueries({ queryKey: ["pending-confirmations"] }),
      queries.invalidateQueries({ queryKey: ["creation-workflow"] }),
      queries.invalidateQueries({ queryKey: ["change-preview"] }),
      queries.invalidateQueries({ queryKey: ["narrative-index", projectId] }),
      queries.invalidateQueries({
        queryKey: ["narrative-index-detail", projectId],
      }),
      queries.invalidateQueries({ queryKey: ["resource", "story-arcs"] }),
    ]);
  useEffect(
    () =>
      client.events.subscribe((event) => {
        // The embedded index shares this existing event connection. Opening a
        // second long-lived SSE for every panel can exhaust Chromium's HTTP/1
        // socket pool and leave ordinary workflow GETs waiting indefinitely.
        if (event.type === "automation.creation-updated.v1") {
          void queries.invalidateQueries({
            queryKey: ["narrative-index", projectId],
          });
          void queries.invalidateQueries({
            queryKey: ["narrative-index-detail", projectId],
          });
          return;
        }
        if (
          /^(creative-quality\.narrative-report-|writing\.|workspace\.|knowledge\.|production\.)/u.test(
            event.type,
          )
        ) {
          void queries.invalidateQueries({
            queryKey: ["narrative-quality-sources", projectId],
          });
          void queries.invalidateQueries({
            queryKey: ["quality-expression-chapters", projectId],
          });
          void refresh();
        }
      }),
    [client, projectId, queries],
  );
  const workRequest = requestedWorkflow
    ? validRun?.input.qualityReviewRequest
    : request;
  const workCurrent =
    !catalog.error && isQualityRequestCurrent(workRequest, catalog.data);
  const selectReport = (id: string) => {
    setFocused(id);
    setParams({ reportId: id });
  };
  const confirmScope = () => {
    const selected = catalog.data?.targets.find(
      (item) => targetKey(item.target) === target,
    );
    if (catalog.error || !selected || !dimensions.length) {
      setError("请选择实际当前目标和至少一个检查维度。");
      return;
    }
    let chapterScope: NarrativeQualityRequest["chapterScope"];
    if (selected.target.kind === "chapter-set") {
      const chapterSet = catalog.data?.chapterSet;
      const chapters =
        chapterSet?.chapters.filter((chapter) =>
          chapterIds.includes(chapter.id),
        ) ?? [];
      if (
        !chapterSet ||
        !chapters.length ||
        chapters.length !== chapterIds.length ||
        chapters.some((chapter) => !chapter.hasContent)
      ) {
        setError(
          "请选择当前非空章节；选中章节已删除、变空或尚未读取时必须重新选择。",
        );
        return;
      }
      if (
        chapterMode === "full" &&
        chapters.length !==
          chapterSet.chapters.filter((chapter) => chapter.hasContent).length
      ) {
        setError(
          "全书检查须明确选择全部当前非空章节，不能用部分章节代表全书。",
        );
        return;
      }
      chapterScope = {
        mode: chapterMode,
        chapters: chapters.map(({ id, version }) => ({ id, version })),
        ...(chapterMode === "full"
          ? { directoryFingerprint: chapterSet.directoryFingerprint }
          : {}),
      };
    }
    const parsed = NarrativeQualityRequestSchema.safeParse({
      target: selected.target,
      dimensions: NarrativeQualityDimensionSchema.options.filter((dimension) =>
        dimensions.includes(dimension),
      ),
      chapterScope,
      ...(chapterScope && mixed ? { context } : {}),
    });
    if (!parsed.success) {
      setError(
        "检查范围无效或超过 2000 章；请明确调整范围，不会自动裁成开头几章。",
      );
      return;
    }
    const input = parsed.data;
    try {
      window.localStorage.setItem(draftKey, JSON.stringify(input));
    } catch {
      setError("本机确认未保存；未更换原来源或退出原报告链接。");
      return;
    }
    setRequest(input);
    setParams({});
    setFocused(undefined);
    setError(undefined);
  };
  const transition = async (action: "commit" | "discard") => {
    if (!value || !actualRun?.previewId || busy) return;
    if (
      !(await confirmDialog({
        title: action === "commit" ? "采用质量报告" : "放弃质量报告 AI 草稿",
        description:
          action === "commit"
            ? `采用报告 v${value.version}，不改正文、不自动接受风险；${value.blockers.length} 项错误仍须处理。来源或竞争头变化会拒绝采用。`
            : "只放弃这份 AI 草稿，不删除作者正文或已采用报告。",
        confirmLabel: action === "commit" ? "确认采用报告" : "确认放弃报告",
        tone: action === "commit" ? "default" : "danger",
      }))
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      const fingerprint = `${value.id}:${value.version}:${action}`;
      const key = keys.current.get(fingerprint) ?? crypto.randomUUID();
      keys.current.set(fingerprint, key);
      if (action === "commit")
        await client.changePreviews.commit(actualRun.previewId, key);
      else await client.changePreviews.discard(actualRun.previewId, key);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
      await refresh();
    }
  };
  const requestMismatch =
    Boolean(navigationError) ||
    Boolean(!run.error && requestedWorkflow && run.data && !validRun) ||
    Boolean(!detail.error && !run.error && detail.data && !value);
  return (
    <section
      aria-label={copyText("app/features/creative/NarrativeQualityPanel.15")}
      className={styles.c15}
    >
      <NarrativeIndexPanel key={projectId} projectId={projectId} />
      <NarrativeSummaryPanel
        key={`summaries:${projectId}`}
        projectId={projectId}
      />
      <div className={styles.c16}>
        <h2 className={styles.c2}>
          {copyText("app/features/creative/NarrativeQualityPanel.16")}
        </h2>
        <p className={styles.c17}>
          {copyText("app/features/creative/NarrativeQualityPanel.17")}
        </p>
        <label className={styles.c10}>
          {copyText("app/features/creative/NarrativeQualityPanel.18")}
          <NativeSelect
            aria-label={copyText(
              "app/features/creative/NarrativeQualityPanel.18",
            )}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className={styles.c12}
          >
            <option value="">
              {copyText("app/features/creative/NarrativeQualityPanel.19")}
            </option>
            {!catalog.error &&
              catalog.data?.targets.map((item) => (
                <option
                  key={targetKey(item.target)}
                  value={targetKey(item.target)}
                >
                  {item.title}
                  {copyText("app/features/creative/NarrativeQualityPanel.11")}
                  {item.target.version}
                </option>
              ))}
          </NativeSelect>
        </label>
        {target === `chapter-set:${projectId}` && catalog.data?.chapterSet && (
          <fieldset className={styles.c18}>
            <legend className={styles.c19}>
              {copyText("app/features/creative/NarrativeQualityPanel.20")}
            </legend>
            <label className={styles.c8}>
              {copyText("app/features/creative/NarrativeQualityPanel.21")}{" "}
              <NativeSelect
                aria-label={copyText(
                  "app/features/creative/NarrativeQualityPanel.22",
                )}
                value={chapterMode}
                onChange={(event) =>
                  setChapterMode(event.target.value as "selection" | "full")
                }
                className={styles.c20}
              >
                <option value="selection">
                  {copyText("app/features/creative/NarrativeQualityPanel.23")}
                </option>
                <option value="full">
                  {copyText("app/features/creative/NarrativeQualityPanel.24")}
                </option>
              </NativeSelect>
            </label>
            <p className={styles.c17}>
              {copyText("app/features/creative/NarrativeQualityPanel.25")}
              {catalog.data.chapterSet.chapters.length}
              {copyText("app/features/creative/NarrativeQualityPanel.26")}{" "}
              {
                catalog.data.chapterSet.chapters.filter(
                  (chapter) => chapter.hasContent,
                ).length
              }{" "}
              {copyText("app/features/creative/NarrativeQualityPanel.27")}
            </p>
            <div className={styles.c21}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  setChapterIds(
                    catalog
                      .data!.chapterSet!.chapters.filter(
                        (chapter) => chapter.hasContent,
                      )
                      .map((chapter) => chapter.id),
                  )
                }
              >
                {copyText("app/features/creative/NarrativeQualityPanel.28")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setChapterIds([])}
              >
                {copyText("app/features/creative/NarrativeQualityPanel.29")}
              </Button>
            </div>
            <div className={styles.c22}>
              {catalog.data.chapterSet.chapters.map((chapter) => (
                <label key={chapter.id} className={styles.c23}>
                  <input
                    type="checkbox"
                    aria-label={copyText(
                      "app/features/creative/NarrativeQualityPanel.83",
                      { p1: chapter.title },
                    )}
                    disabled={!chapter.hasContent}
                    checked={chapterIds.includes(chapter.id)}
                    onChange={(event) =>
                      setChapterIds((ids) =>
                        event.target.checked
                          ? [...ids, chapter.id]
                          : ids.filter((id) => id !== chapter.id),
                      )
                    }
                  />
                  <span>
                    {chapter.title}
                    {copyText("app/features/creative/NarrativeQualityPanel.11")}
                    {chapter.version} ·{" "}
                    {chapter.hasContent
                      ? chapterIds.includes(chapter.id)
                        ? mixed
                          ? "待明确表达"
                          : "待纳入原文"
                        : "未选（未读）"
                      : "空章（未检查）"}
                  </span>
                </label>
              ))}
            </div>
            <p className={styles.c17}>
              {copyText("app/features/creative/NarrativeQualityPanel.30")}
            </p>
            <label className={styles.c10}>
              <input
                type="checkbox"
                aria-label={copyText(
                  "app/features/creative/NarrativeQualityPanel.31",
                )}
                checked={mixed}
                onChange={(event) => setMixed(event.target.checked)}
              />{" "}
              {copyText("app/features/creative/NarrativeQualityPanel.32")}
            </label>
            {mixed && (
              <>
                <p className={styles.c17}>
                  {copyText("app/features/creative/NarrativeQualityPanel.33")}
                </p>
                {expressionChapters.data && (
                  <NovelContextPicker
                    scope={{ projectId, title: "质量评议实际表达" }}
                    chapters={expressionChapters.data.filter((chapter) =>
                      chapterIds.includes(chapter.id),
                    )}
                    request={context}
                    disabled={busy}
                    onChange={setContext}
                  />
                )}
                {expressionChapters.error && (
                  <p role="alert">
                    {copyText("app/features/creative/NarrativeQualityPanel.34")}
                    {message(expressionChapters.error)}
                  </p>
                )}
              </>
            )}
          </fieldset>
        )}
        <div className={styles.c24}>
          {NarrativeQualityDimensionSchema.options.map((dimension) => (
            <label key={dimension} className={styles.c8}>
              <input
                type="checkbox"
                checked={dimensions.includes(dimension)}
                onChange={(event) =>
                  setDimensions((value) =>
                    event.target.checked
                      ? [...value, dimension]
                      : value.filter((item) => item !== dimension),
                  )
                }
              />{" "}
              {QUALITY_DIMENSIONS[dimension]}
            </label>
          ))}
        </div>
        <Button
          size="sm"
          disabled={!catalog.data || Boolean(catalog.error)}
          onClick={confirmScope}
        >
          {copyText("app/features/creative/NarrativeQualityPanel.16")}
        </Button>
        {workRequest && (
          <p
            className={styles.c25}
            data-quality-basis-version={workRequest.target.version}
          >
            {copyText("app/features/creative/NarrativeQualityPanel.35")}
            {workRequest.target.id}
            {copyText("app/features/creative/NarrativeQualityPanel.4")}
            {workRequest.target.version} ·{" "}
            {workRequest.dimensions
              .map((dimension) => QUALITY_DIMENSIONS[dimension])
              .join("、")}{" "}
            ·{" "}
            {workCurrent
              ? workRequest.context
                ? "章节版本核对有效；表达采用头和隐私在生成时另核对，不自动换源"
                : "版本仍有效"
              : "来源已变化或尚未读取；重新明确确认，不自动换源"}
          </p>
        )}
        {workRequest?.chapterScope && (
          <p
            className={styles.c8}
            data-quality-chapter-scope={workRequest.chapterScope.mode}
          >
            {copyText("app/features/creative/NarrativeQualityPanel.36")}
            {workRequest.chapterScope.mode === "full"
              ? "全书非空正文"
              : "局部所选章节（不是全书）"}{" "}
            · {workRequest.chapterScope.chapters.length}
            {copyText("app/features/creative/NarrativeQualityPanel.37")}
            {workRequest.context ? "明确表达" : "原文"}
            {copyText("app/features/creative/NarrativeQualityPanel.38")}
            {workRequest.context &&
              "摘要/段落不代表全文评议，实际表达在运行与报告中分别列明。"}
          </p>
        )}
        {workRequest?.target.sourceFingerprint && (
          <p
            className={styles.c6}
            data-quality-source-fingerprint={
              workRequest.target.sourceFingerprint
            }
          >
            {copyText("app/features/creative/NarrativeQualityPanel.39")}
            {workRequest.target.sourceFingerprint}
            {copyText("app/features/creative/NarrativeQualityPanel.40")}
          </p>
        )}
        {catalog.data?.unavailable.map((item) => (
          <p key={item} role="alert" className={styles.c17}>
            {item}
          </p>
        ))}
        <Link className={styles.c26} to={`/pending?projectId=${projectId}`}>
          {copyText("app/features/creative/NarrativeQualityPanel.41")}
        </Link>
      </div>
      <NarrativeLocalQualityPanel projectId={projectId} request={request} />
      {workRequest &&
        !params.has("localReviewId") &&
        !requestMismatch &&
        (!requestedReportId || value) && (
          <CreationWorkbench
            projectId={projectId}
            operation="quality-review"
            workflowId={requestedWorkflow}
            targetId={workRequest.target.id}
            baseVersion={workRequest.target.version}
            qualityReviewRequest={workRequest}
            externalReview
            disabled={!workCurrent}
            onStarted={(workflow) => {
              setFocused(undefined);
              setParams({ workflowId: workflow.id });
            }}
            defaultInstruction="逐项核对所选目标版本和冻结约束，引用逐字证据，不改正文、不生成质量分数。"
            onCandidate={(workflow) => {
              if (workflow.narrativeReportId && !params.get("reportId"))
                setFocused(workflow.narrativeReportId);
            }}
          />
        )}
      {(error ||
        catalog.error ||
        history.error ||
        detail.error ||
        run.error ||
        reportRun.error ||
        requestMismatch) && (
        <p role="alert" className={styles.c14}>
          {requestMismatch
            ? "指定报告或运行归属／关联不符，未打开最新报告或上次 AI 草稿代替。"
            : (error ??
              message(
                catalog.error ??
                  history.error ??
                  detail.error ??
                  run.error ??
                  reportRun.error,
              ))}
        </p>
      )}
      {value && (
        <div data-narrative-report-id={value.id} className={styles.c27}>
          <h3 className={styles.c2}>
            {copyText("app/features/creative/NarrativeQualityPanel.42")}
            {value.version} · {reportStatus(value)}
          </h3>
          <p className={styles.c28}>
            {copyText("app/features/creative/NarrativeQualityPanel.43")}
            {value.basis.request.target.id}
            {copyText("app/features/creative/NarrativeQualityPanel.4")}
            {value.basis.request.target.version} ·{" "}
            {value.sourceState === "current"
              ? "来源有效"
              : "来源已失效（只保留历史）"}
          </p>
          <p className={styles.c3}>{value.content.summary}</p>
          <p className={styles.c17}>
            {copyText("app/features/creative/NarrativeQualityPanel.44")}
            {value.engineKind}
            {copyText("app/features/creative/NarrativeQualityPanel.45")}
            {value.content.reviewedDimensions
              .map((dimension) => QUALITY_DIMENSIONS[dimension])
              .join("、")}{" "}
            {copyText("app/features/creative/NarrativeQualityPanel.46")}
          </p>
          {value.contextBudget && (
            <p className={styles.c17}>
              {copyText("app/features/creative/NarrativeQualityPanel.47")}
              {value.contextBudget.estimatedTokens}
              {copyText("app/features/creative/NarrativeQualityPanel.48")}{" "}
              {value.contextBudget.tokenBudget}
              {copyText("app/features/creative/NarrativeQualityPanel.49")}
            </p>
          )}
          {value.basis.productionSourceBasis && (
            <details className={styles.c29} data-quality-production-basis>
              <summary className={styles.c30}>
                {copyText("app/features/creative/NarrativeQualityPanel.50")}
              </summary>
              <p className={styles.c31}>
                {value.basis.productionSourceBasis.kind === "script"
                  ? "保存剧本"
                  : "独立／关联场景"}{" "}
                {value.basis.productionSourceBasis.id}
                {copyText("app/features/creative/NarrativeQualityPanel.4")}
                {value.basis.productionSourceBasis.version}
                {copyText(
                  "app/features/creative/NarrativeQualityPanel.51",
                )}{" "}
                {value.basis.productionSourceBasis.contentHash}
              </p>
              <p className={styles.c6}>
                {copyText("app/features/creative/NarrativeQualityPanel.52")}{" "}
                {value.basis.productionSourceBasis.recordContentHash}
                {copyText("app/features/creative/NarrativeQualityPanel.53")}
              </p>
              {value.basis.productionSourceBasis.document && (
                <>
                  <p className={styles.c31}>
                    {copyText("app/features/creative/NarrativeQualityPanel.54")}
                    {value.basis.productionSourceBasis.document.id}{" "}
                    {copyText("app/features/creative/NarrativeQualityPanel.55")}
                    {value.basis.productionSourceBasis.document.version}
                    {copyText(
                      "app/features/creative/NarrativeQualityPanel.51",
                    )}{" "}
                    {value.basis.productionSourceBasis.document.contentHash}
                  </p>
                  {value.basis.productionSourceBasis.document.blocks.map(
                    (block) => (
                      <p key={block.id} className={styles.c32}>
                        {copyText(
                          "app/features/creative/NarrativeQualityPanel.56",
                        )}
                        {block.index + 1} · {block.type} · {block.id}
                      </p>
                    ),
                  )}
                </>
              )}
              {value.basis.productionSourceBasis.ancestors.map((ancestor) => (
                <p key={ancestor.id} className={styles.c32}>
                  {copyText("app/features/creative/NarrativeQualityPanel.57")}
                  {ancestor.kind} {ancestor.id}
                  {copyText("app/features/creative/NarrativeQualityPanel.4")}
                  {ancestor.version}
                  {copyText("app/features/creative/NarrativeQualityPanel.58")}
                  {ancestor.contentHash}
                  {ancestor.document
                    ? ` · 保存父文档 ${ancestor.document.id} v${ancestor.document.version} SHA-256 ${ancestor.document.contentHash}`
                    : ""}
                  {copyText("app/features/creative/NarrativeQualityPanel.59")}
                </p>
              ))}
            </details>
          )}
          {value.basis.sourceBasis?.summaries?.map((summary) => (
            <details key={summary.id} className={styles.c25}>
              <summary className={styles.c33}>
                {copyText("app/features/creative/NarrativeQualityPanel.60")}
                {summary.scopeTitle}
              </summary>
              <p>
                {copyText("app/features/creative/NarrativeQualityPanel.61")}
                {summary.id}
                {copyText("app/features/creative/NarrativeQualityPanel.4")}
                {summary.version}
                {copyText(
                  "app/features/creative/NarrativeQualityPanel.62",
                )}{" "}
                {summary.chapters.length}
                {copyText("app/features/creative/NarrativeQualityPanel.63")}
              </p>
              {summary.chapters.map((chapter) => (
                <p key={chapter.id}>
                  {chapter.id}
                  {copyText("app/features/creative/NarrativeQualityPanel.4")}
                  {chapter.version}
                </p>
              ))}
            </details>
          ))}
          <NarrativeQualitySourceCoverage basis={value.basis} />
          {value.basis.chapterCoverage && (
            <section
              aria-label={copyText(
                "app/features/creative/NarrativeQualityPanel.64",
              )}
              className={styles.c29}
            >
              <h4 className={styles.c34}>
                {value.basis.sourceBasis
                  ? value.basis.chapterCoverage.mode === "full"
                    ? "全书范围的明确表达（不是全文评议）"
                    : "所选范围的明确表达（不是全文评议）"
                  : value.basis.chapterCoverage.mode === "full"
                    ? "全书非空正文（冻结目录）"
                    : "所选章节（局部，不是全书）"}
              </h4>
              <p>
                {copyText("app/features/creative/NarrativeQualityPanel.65")}
                {value.basis.chapterCoverage.included.length}/
                {value.basis.chapterCoverage.nonEmptyChapterCount}
                {copyText("app/features/creative/NarrativeQualityPanel.37")}
                {value.basis.sourceBasis ? "来源表达" : "非空原文"}
                {copyText(
                  "app/features/creative/NarrativeQualityPanel.66",
                )}{" "}
                {value.basis.chapterCoverage.totalChapterCount}
                {copyText(
                  "app/features/creative/NarrativeQualityPanel.67",
                )}{" "}
                {value.basis.chapterCoverage.excluded.length}{" "}
                {copyText("app/features/creative/NarrativeQualityPanel.68")}
              </p>
              {value.basis.chapterCoverage.included.map((chapter) => (
                <p key={chapter.id}>
                  {chapter.representations
                    ? `实际表达：${chapter.representations.map((kind) => ({ original: "完整原文", summary: "章节派生摘要", paragraphs: "所选原文段落", "hierarchical-summary": "高层冻结范围摘要" })[kind]).join("＋")}`
                    : "已纳入原文（模型声明已核对）"}
                  ：{chapter.title}
                  {copyText("app/features/creative/NarrativeQualityPanel.11")}
                  {chapter.version}
                </p>
              ))}
              <details>
                <summary className={styles.c33}>
                  {copyText("app/features/creative/NarrativeQualityPanel.69")}
                </summary>
                {value.basis.chapterCoverage.excluded.map((chapter) => (
                  <p key={chapter.id} className={styles.c35}>
                    {chapter.id}
                    {copyText("app/features/creative/NarrativeQualityPanel.11")}
                    {chapter.version} ·{" "}
                    {chapter.reason === "empty"
                      ? "空章，未检查"
                      : "未选择，未读"}
                  </p>
                ))}
              </details>
            </section>
          )}
          {value.staleReasons.map((reason) => (
            <p key={reason} role="alert" className={styles.c14}>
              {reason}
            </p>
          ))}
          {value.status === "awaiting-review" && (
            <div className={styles.c21}>
              <Button
                size="sm"
                disabled={
                  busy ||
                  value.sourceState !== "current" ||
                  !actualRun?.previewId
                }
                onClick={() => void transition("commit")}
              >
                {copyText("app/features/creative/NarrativeQualityPanel.70")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !actualRun?.previewId}
                onClick={() => void transition("discard")}
              >
                {copyText("app/features/creative/NarrativeQualityPanel.71")}
              </Button>
            </div>
          )}
          {!value.content.issues.length && (
            <p className={styles.c8}>
              {copyText("app/features/creative/NarrativeQualityPanel.72")}
            </p>
          )}
          {value.content.issues.map((issue) => (
            <QualityIssue
              key={`${value.id}:${issue.id}`}
              report={value}
              issue={issue}
              reports={history.error ? [] : (history.data ?? [])}
              onChanged={refresh}
            />
          ))}
          <details className={styles.c8}>
            <summary className={styles.c33}>
              {copyText("app/features/creative/NarrativeQualityPanel.73")}
            </summary>
            <p className={styles.c36}>
              {copyText("app/features/creative/NarrativeQualityPanel.74")}
              {value.id}
              {copyText("app/features/creative/NarrativeQualityPanel.75")}
              {value.workflowId}
              {copyText("app/features/creative/NarrativeQualityPanel.76")}{" "}
              {value.sourceSnapshotId}
              {copyText("app/features/creative/NarrativeQualityPanel.77")}
              {value.runIds.join("、")}
            </p>
            {value.basis.references.map((ref) => (
              <p
                key={`${ref.sourceId}:${ref.fieldPath}`}
                className={styles.c36}
              >
                {ref.sourceKind} · {ref.sourceId}
                {copyText("app/features/creative/NarrativeQualityPanel.4")}
                {ref.sourceVersion} · {ref.fieldPath}
                {copyText("app/features/creative/NarrativeQualityPanel.58")}
                {ref.contentHash}
              </p>
            ))}
          </details>
        </div>
      )}
      <details className={styles.c37} open>
        <summary className={styles.c38}>
          {copyText("app/features/creative/NarrativeQualityPanel.78")}
        </summary>
        <div className={styles.c39}>
          {!history.error &&
            history.data?.map((item) => (
              <Button
                key={item.id}
                variant="ghost"
                size="sm"
                className={styles.c40}
                onClick={() => selectReport(item.id)}
              >
                {copyText("app/features/creative/NarrativeQualityPanel.74")}
                {item.id}
                {copyText("app/features/creative/NarrativeQualityPanel.79")}
                {item.version} · {reportStatus(item)} ·{" "}
                {item.sourceState === "current" ? "来源有效" : "来源失效"}
              </Button>
            ))}
          {!history.isLoading && !history.error && !history.data?.length && (
            <p className={styles.c17}>
              {copyText("app/features/creative/NarrativeQualityPanel.80")}
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
