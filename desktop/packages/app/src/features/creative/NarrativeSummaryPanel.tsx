import {
  currentOwnerQuery,
  CURRENT_OWNER_READ_OPTIONS,
  exactNavigationError,
  sameFrozenOwnerSnapshot,
} from "../../current-owner-read";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, NativeSelect, confirmDialog } from "@dramaip/ui-shared";
import {
  NarrativeSummaryRequestSchema,
  type NarrativeSummaryRequest,
  type NarrativeSummaryScope,
  type NarrativeSummary,
} from "@dramaip/contracts/knowledge";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import { useStudio, message } from "../../studio-shared";
import { CreationWorkbench } from "../creation-workbench";

const kinds = { book: "全书", volume: "卷", "story-arc": "已绑定故事弧" };

function SummarySource({
  projectId,
  chapter,
  value,
  onChange,
}: {
  projectId: string;
  chapter: NarrativeSummaryScope["chapters"][number];
  value: NarrativeSummaryRequest["chapters"][number];
  onChange(value: NarrativeSummaryRequest["chapters"][number]): void;
}) {
  const client = useStudio();
  const [read, setRead] = useState(false);
  const detail = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: [
        "narrative-index-detail",
        projectId,
        chapter.id,
        chapter.version,
      ],
      queryFn: () => client.narrativeIndex.chapter(projectId, chapter.id),
      enabled: read,
    }),
  );
  const current =
    detail.data?.projectId === projectId &&
    detail.data.chapter.id === chapter.id &&
    detail.data.chapter.version === chapter.version
      ? detail.data
      : undefined;
  return (
    <fieldset className="rounded border border-line p-3 text-sm">
      <legend>
        {chapter.title} · 正文 v{chapter.version}
      </legend>
      <label className="flex flex-wrap items-center gap-2">
        来源表达
        <NativeSelect
          aria-label={`${chapter.title}摘要来源表达`}
          value={
            value.representation === "original" ? "original" : value.record.id
          }
          onChange={(event) => {
            const summary = current?.summaries.find(
              (item) => item.id === event.target.value,
            );
            if (event.target.value !== "original" && !summary) return;
            onChange(
              summary
                ? {
                    id: chapter.id,
                    version: chapter.version,
                    representation: "summary",
                    record: { id: summary.id, version: summary.version },
                  }
                : {
                    id: chapter.id,
                    version: chapter.version,
                    representation: "original",
                  },
            );
          }}
          className="max-w-full"
        >
          <option value="original">
            完整原文 · 估算 {chapter.originalEstimatedTokens} token
          </option>
          {current?.summaries.map((item) => (
            <option key={item.id} value={item.id}>
              已采用摘要 · {item.text.slice(0, 45)}
            </option>
          ))}
          {value.representation === "summary" &&
            !current?.summaries.some(
              (item) =>
                item.id === value.record.id &&
                item.version === value.record.version,
            ) && (
              <option value={value.record.id} disabled>
                已选摘要未核验，须重新选择
              </option>
            )}
        </NativeSelect>
      </label>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => (read ? void detail.refetch() : setRead(true))}
      >
        读取此章已采用摘要
      </Button>
      {detail.error && <p role="alert">{message(detail.error)}</p>}
      {read && detail.data && !current && (
        <p role="alert">章节版本已变化，请重新选择范围，不自动重绑。</p>
      )}
      {current && !current.summaries.length && (
        <p className="text-muted">
          没有当前有效的精确采用摘要；可使用原文，旧摘要字段不升级。
        </p>
      )}
    </fieldset>
  );
}

function SummaryDetails({ value }: { value: NarrativeSummary }) {
  return (
    <section
      aria-label="分层摘要详情"
      className="space-y-3 rounded border border-line p-4"
    >
      <h3 className="font-semibold">
        {value.basis.scopeTitle} ·{" "}
        {value.status === "adopted"
          ? "已采用派生摘要"
          : value.status === "discarded"
            ? "已放弃"
            : "等待审阅"}
      </h3>
      <p className="text-sm text-muted">
        {value.isCurrent
          ? "当前有效采用头"
          : value.isHead
            ? "采用头已失效，保留历史"
            : "AI 草稿或历史版本，不是当前采用头"}
        ；摘要不替代原文或语义质量评议。
      </p>
      {value.staleReasons.map((reason) => (
        <p role="alert" key={reason}>
          {reason}
        </p>
      ))}
      <p className="whitespace-pre-wrap text-sm">{value.content.summary}</p>
      <p className="text-sm text-muted">
        纳入 {value.content.coveredChapters.length} 个非空章节；空章{" "}
        {value.basis.directory.filter((item) => !item.hasContent).length}{" "}
        个。冻结估算 {value.contextBudget.estimatedTokens} /{" "}
        {value.contextBudget.tokenBudget} token；实际 usage／费用未知。
      </p>
      <details>
        <summary className="cursor-pointer">逐章来源与逐字依据</summary>
        {value.basis.references.map((ref) => (
          <div
            key={ref.chapter.id}
            className="mt-2 break-all border-t border-line pt-2 text-xs"
          >
            章节 {ref.chapter.id} v{ref.chapter.version} ·{" "}
            {ref.representation === "original" ? "完整原文" : "已采用派生摘要"}{" "}
            · {ref.sourceId} v{ref.sourceVersion} · {ref.fieldPath}
            {value.content.evidence
              .filter((item) => item.chapter.id === ref.chapter.id)
              .map((entry, position) => (
                <p key={position} className="whitespace-pre-wrap">
                  依据：“{entry.quote}”
                </p>
              ))}
          </div>
        ))}
      </details>
      <p className="break-all text-xs text-muted">
        摘要 {value.id} v{value.version} · 工作流 {value.workflowId} · 快照{" "}
        {value.sourceSnapshotId}
      </p>
    </section>
  );
}

function SummaryCandidate({
  projectId,
  workflow,
}: {
  projectId: string;
  workflow: CreationWorkflow;
}) {
  const client = useStudio();
  const result = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: [
        "narrative-summary",
        projectId,
        workflow.narrativeSummaryId,
        workflow.version,
      ],
      queryFn: () =>
        client.narrativeSummaries.get(projectId, workflow.narrativeSummaryId!),
      enabled: Boolean(workflow.narrativeSummaryId),
    }),
  );
  const value =
    result.data?.projectId === projectId &&
    result.data.id === workflow.narrativeSummaryId &&
    result.data.workflowId === workflow.id &&
    sameFrozenOwnerSnapshot(
      result.data.basis.request,
      workflow.input.narrativeSummaryRequest,
    )
      ? result.data
      : undefined;
  return value ? (
    <SummaryDetails value={value} />
  ) : (
    <p>{result.error ? message(result.error) : "正在读取实际摘要 AI 草稿…"}</p>
  );
}

export function NarrativeSummaryPanel({ projectId }: { projectId: string }) {
  const client = useStudio();
  const queries = useQueryClient();
  const [params, setParams] = useSearchParams();
  const navigationError = exactNavigationError(params, [
    "summaryId",
    "summaryWorkflowId",
  ]);
  const requestedRun = params.get("summaryWorkflowId") ?? undefined;
  const requestedSummary = params.get("summaryId") ?? undefined;
  const [open, setOpen] = useState(
    params.has("summaryWorkflowId") || params.has("summaryId"),
  );
  useEffect(() => {
    if (params.has("summaryWorkflowId") || params.has("summaryId"))
      setOpen(true);
  }, [requestedRun, requestedSummary]);
  const [scope, setScope] = useState<NarrativeSummaryScope>();
  const [choices, setChoices] = useState<
    Record<string, NarrativeSummaryRequest["chapters"][number]>
  >({});
  const storageKey = `dramaip-summary-request:${projectId}`;
  const [ready, setReady] = useState<NarrativeSummaryRequest | undefined>(
    () => {
      try {
        const parsed = NarrativeSummaryRequestSchema.safeParse(
          JSON.parse(window.localStorage.getItem(storageKey) ?? "null"),
        );
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },
  );
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const sources = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["narrative-summary-scopes", projectId],
      queryFn: () => client.narrativeSummaries.scopes(projectId),
      enabled: open && !requestedSummary,
    }),
  );
  const history = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["narrative-summaries", projectId],
      queryFn: async () => {
        const items: NarrativeSummary[] = [];
        let cursor: string | undefined;
        const seen = new Set<string>();
        do {
          const page = await client.narrativeSummaries.list(projectId, {
            limit: 200,
            cursor,
          });
          items.push(...page.items);
          cursor = page.nextCursor;
          if (cursor && seen.has(cursor))
            throw new Error("摘要历史分页异常，未核全。");
          if (cursor) seen.add(cursor);
        } while (cursor);
        return items;
      },
      enabled: open && !requestedSummary,
    }),
  );
  const requested = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["narrative-summary", projectId, requestedSummary],
      queryFn: () =>
        client.narrativeSummaries.get(projectId, requestedSummary!),
      enabled: open && Boolean(requestedSummary) && !navigationError,
    }),
  );
  const effectiveWorkflowId =
    requestedRun ??
    (requested.data?.projectId === projectId &&
    requested.data.id === requestedSummary
      ? requested.data.workflowId
      : undefined);
  const workflow = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["creation-workflow", projectId, effectiveWorkflowId],
      queryFn: () => client.creation.get(effectiveWorkflowId!),
      enabled: open && Boolean(effectiveWorkflowId) && !navigationError,
    }),
  );
  const actualRun =
    !navigationError &&
    workflow.data &&
    workflow.data.id === effectiveWorkflowId &&
    workflow.data.input.projectId === projectId &&
    workflow.data.input.operation === "narrative-summary" &&
    workflow.data.input.narrativeSummaryRequest
      ? workflow.data
      : undefined;
  const exactSummary =
    requested.data?.projectId === projectId &&
    requested.data.id === requestedSummary &&
    actualRun?.narrativeSummaryId === requestedSummary &&
    requested.data.workflowId === actualRun.id &&
    sameFrozenOwnerSnapshot(
      requested.data.basis.request,
      actualRun.input.narrativeSummaryRequest,
    )
      ? requested.data
      : undefined;
  const request = effectiveWorkflowId
    ? actualRun?.input.narrativeSummaryRequest
    : ready;
  const refresh = async () => {
    await Promise.all([
      queries.invalidateQueries({
        queryKey: ["narrative-index-detail", projectId],
      }),
      queries.invalidateQueries({
        queryKey: ["narrative-summary-scopes", projectId],
      }),
      queries.invalidateQueries({
        queryKey: ["narrative-summaries", projectId],
      }),
      queries.invalidateQueries({ queryKey: ["narrative-summary", projectId] }),
    ]);
  };
  const confirm = async () => {
    if (!scope || busy || !sources.data || sources.isFetching) return;
    const selected: NarrativeSummaryRequest = {
      target: scope.target,
      scopeFingerprint: scope.scopeFingerprint,
      expectedHead: scope.head?.id ?? null,
      chapters: scope.chapters
        .filter((chapter) => chapter.hasContent)
        .map(
          (chapter) =>
            choices[chapter.id] ?? {
              id: chapter.id,
              version: chapter.version,
              representation: "original",
            },
        ),
    };
    const parsed = NarrativeSummaryRequestSchema.safeParse(selected);
    if (!parsed.success) {
      setError("请确认含 1–2000 个非空章节的完整范围；空范围不能生成摘要。");
      return;
    }
    if (
      !(await confirmDialog({
        title: "确认分层摘要来源范围",
        description: `将「${scope.title}」的全部 ${selected.chapters.length} 个非空章节按所示原文／摘要表达冻结；空章不算已读，隐私或预算排除时阻断。生成的是待采用摘要，不改正文，不保证文学质量。`,
        confirmLabel: "确认本轮摘要来源",
      }))
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      const current = (
        await client.narrativeSummaries.scopes(projectId)
      ).scopes.find(
        (item) =>
          item.target.kind === scope.target.kind &&
          item.target.id === scope.target.id,
      );
      if (
        current?.scopeFingerprint !== scope.scopeFingerprint ||
        (current.head?.id ?? null) !== selected.expectedHead
      )
        throw new Error("确认期间范围或采用头已变化，请重新选择，不自动换源。");
      window.localStorage.setItem(storageKey, JSON.stringify(parsed.data));
      setReady(parsed.data);
      const next = new URLSearchParams(params);
      next.delete("summaryWorkflowId");
      next.delete("summaryId");
      setParams(next);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  if (
    navigationError ||
    (requestedSummary &&
      (!exactSummary || ["adopted", "discarded"].includes(exactSummary.status)))
  )
    return (
      <details open className="rounded-lg border border-line bg-surface p-5">
        <summary className="cursor-pointer font-semibold">
          卷／故事弧／全书派生摘要
        </summary>
        <section aria-label="分层摘要工作台" className="mt-4 space-y-4">
          <p className="text-sm text-muted">
            指定摘要原版本只读复核；不改读最新 AI
            草稿，不自动重新生成或扩大原冻结范围。
          </p>
          {navigationError ? (
            <p role="alert">{navigationError}</p>
          ) : exactSummary ? (
            <SummaryDetails value={exactSummary} />
          ) : (
            <p
              role={
                requested.isLoading || workflow.isLoading ? "status" : "alert"
              }
            >
              {requested.isLoading || workflow.isLoading
                ? "正在核对指定摘要与原工作流…"
                : "指定摘要或工作流未能读取、归属／关联不符；未显示最新摘要或上次 AI 草稿代替。"}
            </p>
          )}
          <Button
            variant="secondary"
            onClick={() => {
              const next = new URLSearchParams(params);
              next.delete("summaryId");
              next.delete("summaryWorkflowId");
              setParams(next);
            }}
          >
            返回分层摘要工作台（另行确认来源）
          </Button>
        </section>
      </details>
    );
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="rounded-lg border border-line bg-surface p-5"
    >
      <summary className="cursor-pointer font-semibold">
        卷／故事弧／全书派生摘要
      </summary>
      {open && (
        <section aria-label="分层摘要工作台" className="mt-4 space-y-4">
          <p className="text-sm text-muted">
            明确完整范围 → 逐章原文或当前采用摘要 → 生成／检查 →
            审阅采用。摘要是有来源的派生概括，不等于原文、全书理解或质量保证；仅查看不调用模型。高层摘要暂不自动进入其他模型操作。
          </p>
          <Button size="sm" variant="secondary" onClick={() => void refresh()}>
            刷新摘要与来源
          </Button>
          {(error ||
            sources.error ||
            history.error ||
            workflow.error ||
            requested.error) && (
            <p role="alert">
              {error ??
                message(
                  sources.error ??
                    history.error ??
                    workflow.error ??
                    requested.error,
                )}
            </p>
          )}
          {sources.data?.unavailable.map((reason) => (
            <p role="alert" key={reason}>
              {reason}
            </p>
          ))}
          <label className="block text-sm">
            实际摘要范围
            <NativeSelect
              aria-label="实际摘要范围"
              value={scope ? `${scope.target.kind}:${scope.target.id}` : ""}
              className="ml-2 max-w-full"
              onChange={(event) => {
                setScope(
                  sources.data?.scopes.find(
                    (item) =>
                      `${item.target.kind}:${item.target.id}` ===
                      event.target.value,
                  ),
                );
                setChoices({});
              }}
            >
              <option value="">请选择完整实际范围</option>
              {sources.data?.scopes.map((item) => (
                <option
                  key={`${item.target.kind}:${item.target.id}`}
                  value={`${item.target.kind}:${item.target.id}`}
                  disabled={item.state !== "current"}
                >
                  {kinds[item.target.kind]} · {item.title} ·{" "}
                  {item.chapters.filter((chapter) => chapter.hasContent).length}{" "}
                  个非空章
                  {item.state !== "current" ? " · 范围失效／未绑定" : ""}
                </option>
              ))}
            </NativeSelect>
          </label>
          {scope && (
            <div className="space-y-2">
              <p className="text-sm text-muted">
                {scope.title} · 目标 v{scope.target.version}；空章{" "}
                {scope.chapters.filter((chapter) => !chapter.hasContent).length}{" "}
                个不纳入；禁止漏选。默认显示完整原文，须点击确认后才用于模型。
              </p>
              <div className="max-h-96 space-y-3 overflow-auto overscroll-contain">
                {scope.chapters
                  .filter((chapter) => chapter.hasContent)
                  .map((chapter) => (
                    <SummarySource
                      key={`${scope.scopeFingerprint}:${chapter.id}`}
                      projectId={projectId}
                      chapter={chapter}
                      value={
                        choices[chapter.id] ?? {
                          id: chapter.id,
                          version: chapter.version,
                          representation: "original",
                        }
                      }
                      onChange={(value) =>
                        setChoices((old) => ({ ...old, [chapter.id]: value }))
                      }
                    />
                  ))}
              </div>
              <Button
                size="sm"
                disabled={
                  busy ||
                  !sources.data ||
                  sources.isFetching ||
                  Boolean(sources.error) ||
                  Boolean(sources.data?.unavailable.length)
                }
                onClick={() => void confirm()}
              >
                确认本轮摘要来源
              </Button>
            </div>
          )}
          {request && (
            <CreationWorkbench
              projectId={projectId}
              operation="narrative-summary"
              targetId={request.target.id}
              baseVersion={request.target.version}
              narrativeSummaryRequest={request}
              workflowId={effectiveWorkflowId}
              disabled={
                busy ||
                Boolean(effectiveWorkflowId && !actualRun) ||
                Boolean(!effectiveWorkflowId && !sources.data)
              }
              defaultInstruction="忠实概括当前完整范围的主线、人物变化、因果与未解伏笔；只使用明确所选来源，不续写未来情节。"
              renderCandidate={(run) => (
                <SummaryCandidate projectId={projectId} workflow={run} />
              )}
              onApplied={refresh}
              onStarted={(run) => {
                const next = new URLSearchParams(params);
                next.set("summaryWorkflowId", run.id);
                next.delete("summaryId");
                setParams(next);
              }}
            />
          )}
          {exactSummary && <SummaryDetails value={exactSummary} />}
          <details>
            <summary className="cursor-pointer">
              实际摘要历史（不自动采用或换成最新版本）
            </summary>
            {history.data?.map((item) => (
              <div
                key={item.id}
                className="mt-2 flex flex-wrap items-center gap-2 rounded border border-line p-3 text-sm"
              >
                {item.basis.scopeTitle} · {item.status} · {item.sourceState} · v
                {item.version}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.set("summaryId", item.id);
                    next.set("summaryWorkflowId", item.workflowId);
                    setParams(next);
                  }}
                >
                  查看此摘要版本
                </Button>
              </div>
            ))}
          </details>
        </section>
      )}
    </details>
  );
}
