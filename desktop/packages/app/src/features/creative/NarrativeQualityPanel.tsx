import {
  currentOwnerQuery,
  CURRENT_OWNER_READ_OPTIONS,
  exactNavigationError,
  sameFrozenOwnerSnapshot,
} from "../../current-owner-read";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Button, confirmDialog } from "@dramaip/ui-shared";
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
    <article
      data-quality-issue-id={issue.id}
      className="space-y-3 rounded-lg border border-line p-4"
    >
      <h4 className="font-semibold">
        {QUALITY_DIMENSIONS[issue.category]} ·{" "}
        {issue.severity === "error"
          ? "错误"
          : issue.severity === "warning"
            ? "提醒"
            : "建议"}{" "}
        · 模型意见
      </h4>
      <p className="whitespace-pre-wrap text-sm">{issue.message}</p>
      <p className="whitespace-pre-wrap text-sm text-muted">
        建议：{issue.suggestion}
      </p>
      {issue.evidence.map((evidence, index) => (
        <div
          key={index}
          className="rounded border border-line bg-surface-muted p-3 text-sm"
        >
          <p className="break-all text-xs text-muted">
            源 {evidence.sourceId} v{evidence.sourceVersion} ·{" "}
            {evidence.fieldPath} · 字段 {evidence.valuePath}
          </p>
          <blockquote className="mt-2 whitespace-pre-wrap break-words">
            {evidence.quote}
          </blockquote>
        </div>
      ))}
      <p className="text-sm" data-quality-decision={decision?.state ?? "open"}>
        人工处理：
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
        <p className="whitespace-pre-wrap text-sm text-muted">
          已记录说明：{decision.note}
        </p>
      )}
      {canDecide && (
        <div className="space-y-3">
          <label className="block text-sm">
            人工处理说明
            <textarea
              aria-label={`问题 ${issue.id} 的处理说明`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="mt-1 w-full rounded border border-line bg-surface p-2"
            />
          </label>
          <label className="block text-sm">
            真实复检报告
            <select
              aria-label={`问题 ${issue.id} 的复检报告`}
              value={recheck}
              onChange={(event) => setRecheck(event.target.value)}
              className="ml-2 max-w-full rounded border border-line bg-surface p-2"
            >
              <option value="">请选择当前已采用的同范围复检</option>
              {eligible.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.id} · v{value.version}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !note.trim()}
              onClick={() => void decide("accepted-risk")}
            >
              接受此风险
            </Button>
            <Button
              size="sm"
              disabled={busy || !note.trim() || !recheck}
              onClick={() => void decide("resolved")}
            >
              记录已解决（需复检）
            </Button>
            {decision && decision.state !== "open" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !note.trim()}
                onClick={() => void decide("open")}
              >
                重新打开问题
              </Button>
            )}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger-strong">
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
        title: action === "commit" ? "采用质量报告" : "放弃质量报告候选",
        description:
          action === "commit"
            ? `采用报告 v${value.version}，不改正文、不自动接受风险；${value.blockers.length} 项错误仍须处理。来源或竞争头变化会拒绝采用。`
            : "只放弃这份候选，不删除作者正文或已采用报告。",
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
    <section aria-label="版本绑定质量报告工作台" className="space-y-5">
      <NarrativeIndexPanel key={projectId} projectId={projectId} />
      <NarrativeSummaryPanel
        key={`summaries:${projectId}`}
        projectId={projectId}
      />
      <div className="space-y-3 rounded-lg border border-line bg-surface p-5">
        <h2 className="font-semibold">确认本轮质量基准</h2>
        <p className="text-sm text-muted">
          选择实际内容版本与检查维度。报告不改作者正文；逐字证据只证明引用存在，不保证模型语义正确。小说可以独立完成，可选制作风险不要求进入改编或媒体。
        </p>
        <label className="block text-sm">
          质量检查目标
          <select
            aria-label="质量检查目标"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className="ml-2 max-w-full rounded border border-line bg-surface p-2"
          >
            <option value="">请选择当前正式内容</option>
            {!catalog.error &&
              catalog.data?.targets.map((item) => (
                <option
                  key={targetKey(item.target)}
                  value={targetKey(item.target)}
                >
                  {item.title} · v{item.target.version}
                </option>
              ))}
          </select>
        </label>
        {target === `chapter-set:${projectId}` && catalog.data?.chapterSet && (
          <fieldset className="space-y-3 rounded border border-line p-3">
            <legend className="px-1 text-sm font-medium">
              跨章正文范围（明确选择，不默认前三章）
            </legend>
            <label className="text-sm">
              检查范围{" "}
              <select
                aria-label="跨章检查范围"
                value={chapterMode}
                onChange={(event) =>
                  setChapterMode(event.target.value as "selection" | "full")
                }
                className="rounded border border-line bg-surface p-2"
              >
                <option value="selection">所选章节（局部，不是全书）</option>
                <option value="full">全书非空正文（须选择全部）</option>
              </select>
            </label>
            <p className="text-sm text-muted">
              实际目录 {catalog.data.chapterSet.chapters.length} 章，非空正文{" "}
              {
                catalog.data.chapterSet.chapters.filter(
                  (chapter) => chapter.hasContent,
                ).length
              }{" "}
              章。空章未检查；选择变化只影响下一次明确确认，不改旧基准。
            </p>
            <div className="flex gap-2">
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
                选择全部非空章节
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setChapterIds([])}
              >
                清空章节选择
              </Button>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {catalog.data.chapterSet.chapters.map((chapter) => (
                <label
                  key={chapter.id}
                  className="flex items-start gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    aria-label={`质量范围章节 ${chapter.title}`}
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
                    {chapter.title} · v{chapter.version} ·{" "}
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
            <p className="text-sm text-muted">
              所选原文、正式意图和可信设定必须完整纳入冻结预算；超限或被隐私排除会阻断，不用摘要冒充读过正文。
            </p>
            <label className="block text-sm">
              <input
                type="checkbox"
                aria-label="质量评议使用明确混合表达"
                checked={mixed}
                onChange={(event) => setMixed(event.target.checked)}
              />{" "}
              明确选择原文／摘要／段落（不代表全文评议）
            </label>
            {mixed && (
              <>
                <p className="text-sm text-muted">
                  范围覆盖与表达类型分别记录。派生摘要与段落评议不能补足全文评议门，亦不能用摘要标
                  always 绕过原来源禁止策略。
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
                    来源正文未核全：{message(expressionChapters.error)}
                  </p>
                )}
              </>
            )}
          </fieldset>
        )}
        <div className="flex flex-wrap gap-3">
          {NarrativeQualityDimensionSchema.options.map((dimension) => (
            <label key={dimension} className="text-sm">
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
          确认本轮质量基准
        </Button>
        {workRequest && (
          <p
            className="break-all text-sm"
            data-quality-basis-version={workRequest.target.version}
          >
            已确认目标 {workRequest.target.id} v{workRequest.target.version} ·{" "}
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
            className="text-sm"
            data-quality-chapter-scope={workRequest.chapterScope.mode}
          >
            已确认
            {workRequest.chapterScope.mode === "full"
              ? "全书非空正文"
              : "局部所选章节（不是全书）"}{" "}
            · {workRequest.chapterScope.chapters.length} 章
            {workRequest.context ? "明确表达" : "原文"} ·
            顺序及逐章版本已冻结，不自动扩大范围。
            {workRequest.context &&
              "摘要/段落不代表全文评议，实际表达在运行与报告中分别列明。"}
          </p>
        )}
        {workRequest?.target.sourceFingerprint && (
          <p
            className="break-all text-xs text-muted"
            data-quality-source-fingerprint={
              workRequest.target.sourceFingerprint
            }
          >
            已确认实际保存来源 SHA-256 {workRequest.target.sourceFingerprint}
            ；文档／块或真实父来源变化时须另行确认，原运行不换稿。
          </p>
        )}
        {catalog.data?.unavailable.map((item) => (
          <p key={item} role="alert" className="text-sm text-muted">
            {item}
          </p>
        ))}
        <Link
          className="text-sm text-brand"
          to={`/pending?projectId=${projectId}`}
        >
          查看本项目待确认与质量问题
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
        <p role="alert" className="text-sm text-danger-strong">
          {requestMismatch
            ? "指定报告或运行归属／关联不符，未打开最新报告或上次候选代替。"
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
        <div
          data-narrative-report-id={value.id}
          className="space-y-4 rounded-lg border border-line bg-surface p-5"
        >
          <h3 className="font-semibold">
            质量报告 · v{value.version} · {reportStatus(value)}
          </h3>
          <p className="break-all text-sm text-muted">
            目标 {value.basis.request.target.id} v
            {value.basis.request.target.version} ·{" "}
            {value.sourceState === "current"
              ? "来源有效"
              : "来源已失效（只保留历史）"}
          </p>
          <p className="whitespace-pre-wrap text-sm">{value.content.summary}</p>
          <p className="text-sm text-muted">
            引擎 {value.engineKind} · 检查范围：
            {value.content.reviewedDimensions
              .map((dimension) => QUALITY_DIMENSIONS[dimension])
              .join("、")}{" "}
            · 实际 token/费用未提供（未知，不是零）
          </p>
          {value.contextBudget && (
            <p className="text-sm text-muted">
              冻结上下文估算 {value.contextBudget.estimatedTokens} token / 预算{" "}
              {value.contextBudget.tokenBudget}；这是估算，不是实际 usage
              或费用。
            </p>
          )}
          {value.basis.productionSourceBasis && (
            <details
              className="space-y-2 rounded border border-line p-3 text-sm"
              data-quality-production-basis
            >
              <summary className="cursor-pointer font-medium">
                实际保存来源与原块身份（只读冻结基准）
              </summary>
              <p className="break-all">
                {value.basis.productionSourceBasis.kind === "script"
                  ? "保存剧本"
                  : "独立／关联场景"}{" "}
                {value.basis.productionSourceBasis.id} v
                {value.basis.productionSourceBasis.version} · SHA-256{" "}
                {value.basis.productionSourceBasis.contentHash}
              </p>
              <p className="break-all text-xs text-muted">
                原记录 SHA-256{" "}
                {value.basis.productionSourceBasis.recordContentHash}
                ；来源身份和模型覆盖声明不证明文学／叙事语义质量。
              </p>
              {value.basis.productionSourceBasis.document && (
                <>
                  <p className="break-all">
                    实际保存文档 {value.basis.productionSourceBasis.document.id}{" "}
                    v{value.basis.productionSourceBasis.document.version} ·
                    SHA-256{" "}
                    {value.basis.productionSourceBasis.document.contentHash}
                  </p>
                  {value.basis.productionSourceBasis.document.blocks.map(
                    (block) => (
                      <p key={block.id} className="break-all text-xs">
                        保存块 #{block.index + 1} · {block.type} · {block.id}
                      </p>
                    ),
                  )}
                </>
              )}
              {value.basis.productionSourceBasis.ancestors.map((ancestor) => (
                <p key={ancestor.id} className="break-all text-xs">
                  原父级 {ancestor.kind} {ancestor.id} v{ancestor.version} ·
                  SHA-256 {ancestor.contentHash}
                  {ancestor.document
                    ? ` · 保存父文档 ${ancestor.document.id} v${ancestor.document.version} SHA-256 ${ancestor.document.contentHash}`
                    : ""}
                  （不代表父正文已读）
                </p>
              ))}
            </details>
          )}
          {value.basis.sourceBasis?.summaries?.map((summary) => (
            <details key={summary.id} className="break-all text-sm">
              <summary className="cursor-pointer">
                质量高层摘要的原冻结范围 · {summary.scopeTitle}
              </summary>
              <p>
                摘要 {summary.id} v{summary.version}；覆盖{" "}
                {summary.chapters.length} 章，不是已读原文。
              </p>
              {summary.chapters.map((chapter) => (
                <p key={chapter.id}>
                  {chapter.id} v{chapter.version}
                </p>
              ))}
            </details>
          ))}
          <NarrativeQualitySourceCoverage basis={value.basis} />
          {value.basis.chapterCoverage && (
            <section
              aria-label="质量报告实际章节覆盖"
              className="space-y-2 rounded border border-line p-3 text-sm"
            >
              <h4 className="font-medium">
                {value.basis.sourceBasis
                  ? value.basis.chapterCoverage.mode === "full"
                    ? "全书范围的明确表达（不是全文评议）"
                    : "所选范围的明确表达（不是全文评议）"
                  : value.basis.chapterCoverage.mode === "full"
                    ? "全书非空正文（冻结目录）"
                    : "所选章节（局部，不是全书）"}
              </h4>
              <p>
                本轮实际纳入 {value.basis.chapterCoverage.included.length}/
                {value.basis.chapterCoverage.nonEmptyChapterCount} 章
                {value.basis.sourceBasis ? "来源表达" : "非空原文"} · 冻结目录{" "}
                {value.basis.chapterCoverage.totalChapterCount} 章 · 未读/空章{" "}
                {value.basis.chapterCoverage.excluded.length}{" "}
                章。完整纳入与模型覆盖声明不证明实际阅读理解或语义正确。
              </p>
              {value.basis.chapterCoverage.included.map((chapter) => (
                <p key={chapter.id}>
                  {chapter.representations
                    ? `实际表达：${chapter.representations.map((kind) => ({ original: "完整原文", summary: "章节派生摘要", paragraphs: "所选原文段落", "hierarchical-summary": "高层冻结范围摘要" })[kind]).join("＋")}`
                    : "已纳入原文（模型声明已核对）"}
                  ：{chapter.title} · v{chapter.version}
                </p>
              ))}
              <details>
                <summary className="cursor-pointer">未读章节与原因</summary>
                {value.basis.chapterCoverage.excluded.map((chapter) => (
                  <p key={chapter.id} className="mt-1 break-all">
                    {chapter.id} · v{chapter.version} ·{" "}
                    {chapter.reason === "empty"
                      ? "空章，未检查"
                      : "未选择，未读"}
                  </p>
                ))}
              </details>
            </section>
          )}
          {value.staleReasons.map((reason) => (
            <p key={reason} role="alert" className="text-sm text-danger-strong">
              {reason}
            </p>
          ))}
          {value.status === "awaiting-review" && (
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={
                  busy ||
                  value.sourceState !== "current" ||
                  !actualRun?.previewId
                }
                onClick={() => void transition("commit")}
              >
                采用此质量报告
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !actualRun?.previewId}
                onClick={() => void transition("discard")}
              >
                放弃此质量报告
              </Button>
            </div>
          )}
          {!value.content.issues.length && (
            <p className="text-sm">
              本次模型报告没有问题；不能自动消除其他有效报告中尚未处理的问题，也不代表文学质量保证。
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
          <details className="text-sm">
            <summary className="cursor-pointer">实际冻结来源与运行</summary>
            <p className="mt-2 break-all">
              报告 {value.id} · 工作流 {value.workflowId} · 快照{" "}
              {value.sourceSnapshotId} · Run {value.runIds.join("、")}
            </p>
            {value.basis.references.map((ref) => (
              <p
                key={`${ref.sourceId}:${ref.fieldPath}`}
                className="mt-2 break-all"
              >
                {ref.sourceKind} · {ref.sourceId} v{ref.sourceVersion} ·{" "}
                {ref.fieldPath} · SHA-256 {ref.contentHash}
              </p>
            ))}
          </details>
        </div>
      )}
      <details className="rounded-lg border border-line bg-surface p-4" open>
        <summary className="cursor-pointer font-semibold">
          报告历史（保留原版本）
        </summary>
        <div className="mt-3 space-y-2">
          {!history.error &&
            history.data?.map((item) => (
              <Button
                key={item.id}
                variant="ghost"
                size="sm"
                className="block max-w-full truncate"
                onClick={() => selectReport(item.id)}
              >
                报告 {item.id} · 版本 v{item.version} · {reportStatus(item)} ·{" "}
                {item.sourceState === "current" ? "来源有效" : "来源失效"}
              </Button>
            ))}
          {!history.isLoading && !history.error && !history.data?.length && (
            <p className="text-sm text-muted">
              尚无质量报告。未检查不等于通过。
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
