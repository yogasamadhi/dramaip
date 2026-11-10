import {
  currentOwnerQuery,
  CURRENT_OWNER_READ_OPTIONS,
  exactNavigationError,
  sameFrozenOwnerSnapshot,
} from "../../current-owner-read";
import { useEffect, useState } from "react";
import { useSearchParams } from "../../router";
import { useQuery, useQueryClient } from "../../query";
import { Button, NativeSelect } from "@dramaip/infra-ui-primitives";
import { confirmDialog } from "../../controls";
import {
  NarrativeSummaryRequestSchema,
  type NarrativeSummaryRequest,
  type NarrativeSummaryScope,
  type NarrativeSummary,
} from "@dramaip/contracts/knowledge";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import { useStudio, message } from "../../studio-shared";
import { CreationWorkbench } from "../creation-workbench";
import styles from "./NarrativeSummaryPanel.module.css";
import { copyText } from "../../copy";

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
    <fieldset className={styles.c1}>
      <legend>
        {chapter.title}
        {copyText("app/features/creative/NarrativeSummaryPanel.1")}
        {chapter.version}
      </legend>
      <label className={styles.c2}>
        {copyText("app/features/creative/NarrativeSummaryPanel.2")}
        <NativeSelect
          aria-label={copyText(
            "app/features/creative/NarrativeSummaryPanel.39",
            { p1: chapter.title },
          )}
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
          className={styles.c3}
        >
          <option value="original">
            {copyText("app/features/creative/NarrativeSummaryPanel.3")}
            {chapter.originalEstimatedTokens}
            {copyText("app/features/creative/NarrativeSummaryPanel.4")}
          </option>
          {current?.summaries.map((item) => (
            <option key={item.id} value={item.id}>
              {copyText("app/features/creative/NarrativeSummaryPanel.5")}
              {item.text.slice(0, 45)}
            </option>
          ))}
          {value.representation === "summary" &&
            !current?.summaries.some(
              (item) =>
                item.id === value.record.id &&
                item.version === value.record.version,
            ) && (
              <option value={value.record.id} disabled>
                {copyText("app/features/creative/NarrativeSummaryPanel.6")}
              </option>
            )}
        </NativeSelect>
      </label>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => (read ? void detail.refetch() : setRead(true))}
      >
        {copyText("app/features/creative/NarrativeSummaryPanel.7")}
      </Button>
      {detail.error && <p role="alert">{message(detail.error)}</p>}
      {read && detail.data && !current && (
        <p role="alert">
          {copyText("app/features/creative/NarrativeSummaryPanel.8")}
        </p>
      )}
      {current && !current.summaries.length && (
        <p className={styles.c4}>
          {copyText("app/features/creative/NarrativeSummaryPanel.9")}
        </p>
      )}
    </fieldset>
  );
}

function SummaryDetails({ value }: { value: NarrativeSummary }) {
  return (
    <section
      aria-label={copyText("app/features/creative/NarrativeSummaryPanel.10")}
      className={styles.c5}
    >
      <h3 className={styles.c6}>
        {value.basis.scopeTitle} ·{" "}
        {value.status === "adopted"
          ? "已采用派生摘要"
          : value.status === "discarded"
            ? "已放弃"
            : "等待审阅"}
      </h3>
      <p className={styles.c7}>
        {value.isCurrent
          ? "当前有效采用头"
          : value.isHead
            ? "采用头已失效，保留历史"
            : "AI 草稿或历史版本，不是当前采用头"}
        {copyText("app/features/creative/NarrativeSummaryPanel.11")}
      </p>
      {value.staleReasons.map((reason) => (
        <p role="alert" key={reason}>
          {reason}
        </p>
      ))}
      <p className={styles.c8}>{value.content.summary}</p>
      <p className={styles.c7}>
        {copyText("app/features/creative/NarrativeSummaryPanel.12")}
        {value.content.coveredChapters.length}
        {copyText("app/features/creative/NarrativeSummaryPanel.13")}{" "}
        {value.basis.directory.filter((item) => !item.hasContent).length}{" "}
        {copyText("app/features/creative/NarrativeSummaryPanel.14")}
        {value.contextBudget.estimatedTokens} /{" "}
        {value.contextBudget.tokenBudget}
        {copyText("app/features/creative/NarrativeSummaryPanel.15")}
      </p>
      <details>
        <summary className={styles.c9}>
          {copyText("app/features/creative/NarrativeSummaryPanel.16")}
        </summary>
        {value.basis.references.map((ref) => (
          <div key={ref.chapter.id} className={styles.c10}>
            {copyText("app/features/creative/NarrativeSummaryPanel.17")}
            {ref.chapter.id}
            {copyText("app/features/creative/NarrativeSummaryPanel.18")}
            {ref.chapter.version} ·{" "}
            {ref.representation === "original" ? "完整原文" : "已采用派生摘要"}{" "}
            · {ref.sourceId}
            {copyText("app/features/creative/NarrativeSummaryPanel.18")}
            {ref.sourceVersion} · {ref.fieldPath}
            {value.content.evidence
              .filter((item) => item.chapter.id === ref.chapter.id)
              .map((entry, position) => (
                <p key={position} className={styles.c11}>
                  {copyText("app/features/creative/NarrativeSummaryPanel.19")}
                  {entry.quote}”
                </p>
              ))}
          </div>
        ))}
      </details>
      <p className={styles.c12}>
        {copyText("app/features/creative/NarrativeSummaryPanel.20")}
        {value.id}
        {copyText("app/features/creative/NarrativeSummaryPanel.18")}
        {value.version}
        {copyText("app/features/creative/NarrativeSummaryPanel.21")}
        {value.workflowId}
        {copyText("app/features/creative/NarrativeSummaryPanel.22")}{" "}
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
      <details open className={styles.c13}>
        <summary className={styles.c14}>
          {copyText("app/features/creative/NarrativeSummaryPanel.23")}
        </summary>
        <section
          aria-label={copyText(
            "app/features/creative/NarrativeSummaryPanel.24",
          )}
          className={styles.c15}
        >
          <p className={styles.c7}>
            {copyText("app/features/creative/NarrativeSummaryPanel.25")}
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
            {copyText("app/features/creative/NarrativeSummaryPanel.26")}
          </Button>
        </section>
      </details>
    );
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className={styles.c13}
    >
      <summary className={styles.c14}>
        {copyText("app/features/creative/NarrativeSummaryPanel.23")}
      </summary>
      {open && (
        <section
          aria-label={copyText(
            "app/features/creative/NarrativeSummaryPanel.24",
          )}
          className={styles.c15}
        >
          <p className={styles.c7}>
            {copyText("app/features/creative/NarrativeSummaryPanel.27")}
          </p>
          <Button size="sm" variant="secondary" onClick={() => void refresh()}>
            {copyText("app/features/creative/NarrativeSummaryPanel.28")}
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
          <label className={styles.c16}>
            {copyText("app/features/creative/NarrativeSummaryPanel.29")}
            <NativeSelect
              aria-label={copyText(
                "app/features/creative/NarrativeSummaryPanel.29",
              )}
              value={scope ? `${scope.target.kind}:${scope.target.id}` : ""}
              className={styles.c17}
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
              <option value="">
                {copyText("app/features/creative/NarrativeSummaryPanel.30")}
              </option>
              {sources.data?.scopes.map((item) => (
                <option
                  key={`${item.target.kind}:${item.target.id}`}
                  value={`${item.target.kind}:${item.target.id}`}
                  disabled={item.state !== "current"}
                >
                  {kinds[item.target.kind]} · {item.title} ·{" "}
                  {item.chapters.filter((chapter) => chapter.hasContent).length}{" "}
                  {copyText("app/features/creative/NarrativeSummaryPanel.31")}
                  {item.state !== "current" ? " · 范围失效／未绑定" : ""}
                </option>
              ))}
            </NativeSelect>
          </label>
          {scope && (
            <div className={styles.c18}>
              <p className={styles.c7}>
                {scope.title}
                {copyText("app/features/creative/NarrativeSummaryPanel.32")}
                {scope.target.version}
                {copyText(
                  "app/features/creative/NarrativeSummaryPanel.33",
                )}{" "}
                {scope.chapters.filter((chapter) => !chapter.hasContent).length}{" "}
                {copyText("app/features/creative/NarrativeSummaryPanel.34")}
              </p>
              <div className={styles.c19}>
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
                {copyText("app/features/creative/NarrativeSummaryPanel.35")}
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
            <summary className={styles.c9}>
              {copyText("app/features/creative/NarrativeSummaryPanel.36")}
            </summary>
            {history.data?.map((item) => (
              <div key={item.id} className={styles.c20}>
                {item.basis.scopeTitle} · {item.status} · {item.sourceState}
                {copyText("app/features/creative/NarrativeSummaryPanel.37")}
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
                  {copyText("app/features/creative/NarrativeSummaryPanel.38")}
                </Button>
              </div>
            ))}
          </details>
        </section>
      )}
    </details>
  );
}
