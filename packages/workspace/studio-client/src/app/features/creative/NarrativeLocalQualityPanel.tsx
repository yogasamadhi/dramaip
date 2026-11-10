import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "../../query";
import { useSearchParams } from "../../router";
import { z } from "zod";
import { Button, NativeSelect } from "@dramaip/infra-ui-primitives";
import { confirmDialog } from "../../controls";
import {
  NarrativeLocalQualitySourceSchema,
  NarrativeLocalQualityCreateSchema,
  NarrativeLocalQualityDecisionSchema,
  NarrativeLocalQualityDispositionSchema,
  NarrativeQualityDimensionSchema,
  NarrativeQualityIssueSchema,
  type NarrativeLocalQualityReview,
  type NarrativeLocalQualitySummary,
  type NarrativeQualityRequest,
} from "@dramaip/contracts/creative-quality";
import {
  localEvidenceFields,
  localFieldKey,
  localHumanContent,
  type LocalIssueDraft,
} from "../../narrative-local-ui";
import {
  sameQualityRequest,
  QUALITY_DIMENSION_LABELS,
} from "../../narrative-quality-scope";
import { useStudio, message } from "../../studio-shared";
import styles from "./NarrativeLocalQualityPanel.module.css";
import { copyText } from "../../copy";

const pendingSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("create"),
      key: z.string().uuid(),
      input: NarrativeLocalQualityCreateSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("decision"),
      key: z.string().uuid(),
      id: z.string().uuid(),
      input: NarrativeLocalQualityDecisionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("disposition"),
      key: z.string().uuid(),
      id: z.string().uuid(),
      input: NarrativeLocalQualityDispositionSchema,
    })
    .strict(),
]);
const draftSchema = z
  .object({
    source: NarrativeLocalQualitySourceSchema.optional(),
    summary: z.string(),
    issues: z.array(
      z
        .object({
          id: z.string(),
          category: NarrativeQualityDimensionSchema,
          severity: z.enum(["error", "warning", "suggestion"]),
          message: z.string(),
          suggestion: z.string(),
          field: z.string(),
          quote: z.string(),
        })
        .strict(),
    ),
    pending: pendingSchema.optional(),
  })
  .strict();
type Draft = z.infer<typeof draftSchema>;
type Pending = z.infer<typeof pendingSchema>;
const empty: Draft = { summary: "", issues: [] };
const status = (
  value: Pick<NarrativeLocalQualityReview, "status" | "isCurrent">,
) =>
  value.status === "awaiting-review"
    ? "AI 草稿，等待明确采用"
    : value.status === "discarded"
      ? "已放弃"
      : value.isCurrent
        ? "当前采用位置"
        : "历史已采用";

function LocalIssue({
  value,
  issue,
  reviews,
  disabled,
  submit,
}: {
  value: NarrativeLocalQualityReview;
  issue: z.infer<typeof NarrativeQualityIssueSchema>;
  reviews: NarrativeLocalQualitySummary[];
  disabled: boolean;
  submit(pending: Pending): Promise<void>;
}) {
  const decision = value.dispositions.find((item) => item.issueId === issue.id),
    [note, setNote] = useState(decision?.note ?? ""),
    [recheck, setRecheck] = useState("");
  const eligible = reviews.filter(
    (item) =>
      item.id !== value.id &&
      item.origin === value.origin &&
      item.status === "adopted" &&
      item.isCurrent &&
      item.sourceState === "current" &&
      item.sourceFingerprint === value.source.sourceFingerprint &&
      sameQualityRequest(item.request, value.source.basis.request),
  );
  const decide = async (state: "open" | "accepted-risk" | "resolved") => {
    if (disabled || !note.trim() || (state === "resolved" && !recheck)) return;
    if (
      !(await confirmDialog({
        title: "记录本地评议人工决定",
        description:
          "只记录作者声明，不修改原文，不认证语义；接受风险不是修复，解决声明仍须核对同来源同范围的实际已采用复检。",
        confirmLabel: "确认记录声明",
      }))
    )
      return;
    await submit({
      kind: "disposition",
      key: crypto.randomUUID(),
      id: value.id,
      input: {
        issueId: issue.id,
        version: value.version,
        state,
        note: note.trim(),
        confirmed: true,
        ...(state === "resolved" ? { recheckReviewId: recheck } : {}),
      },
    });
  };
  return (
    <article data-local-quality-issue-id={issue.id} className={styles.c1}>
      <h4 className={styles.c2}>
        {QUALITY_DIMENSION_LABELS[issue.category]} ·{" "}
        {issue.severity === "error"
          ? "错误"
          : issue.severity === "warning"
            ? "警告"
            : "建议"}{" "}
        ·{" "}
        {value.origin === "human-declared"
          ? "人工意见声明"
          : "本地逐字重复规则"}
      </h4>
      <p className={styles.c3}>{issue.message}</p>
      <p className={styles.c4}>{issue.suggestion}</p>
      {issue.evidence.map((entry, index) => (
        <details key={index} className={styles.c5}>
          <summary className={styles.c6}>
            {copyText("app/features/creative/NarrativeLocalQualityPanel.1")}
            {entry.sourceId}
            {copyText("app/features/creative/NarrativeLocalQualityPanel.2")}
            {entry.sourceVersion} · {entry.fieldPath} · {entry.valuePath}
          </summary>
          <blockquote className={styles.c7}>{entry.quote}</blockquote>
        </details>
      ))}
      <p data-local-quality-disposition={decision?.state ?? "open"}>
        {copyText("app/features/creative/NarrativeLocalQualityPanel.3")}
        {decision?.state === "accepted-risk"
          ? "明确接受风险（不是修复）"
          : decision?.state === "resolved"
            ? "依据原复检记录的解决声明（未认证）"
            : "待处理"}
      </p>
      {decision?.note && <p className={styles.c4}>{decision.note}</p>}
      {value.status === "adopted" && (
        <div className={styles.c8}>
          <label className={styles.c9}>
            {copyText("app/features/creative/NarrativeLocalQualityPanel.4")}
            <textarea
              aria-label={copyText(
                "app/features/creative/NarrativeLocalQualityPanel.48",
                { p1: issue.id },
              )}
              className={styles.c10}
              disabled={disabled}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <label className={styles.c9}>
            {copyText("app/features/creative/NarrativeLocalQualityPanel.5")}
            <NativeSelect
              aria-label={copyText(
                "app/features/creative/NarrativeLocalQualityPanel.49",
                { p1: issue.id },
              )}
              className={styles.c11}
              disabled={disabled}
              value={recheck}
              onChange={(event) => setRecheck(event.target.value)}
            >
              <option value="">
                {copyText("app/features/creative/NarrativeLocalQualityPanel.6")}
              </option>
              {eligible.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id}
                  {copyText(
                    "app/features/creative/NarrativeLocalQualityPanel.2",
                  )}
                  {item.version}
                </option>
              ))}
            </NativeSelect>
          </label>
          <div className={styles.c12}>
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled || !note.trim()}
              onClick={() => void decide("accepted-risk")}
            >
              {copyText("app/features/creative/NarrativeLocalQualityPanel.7")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled || !note.trim() || !recheck}
              onClick={() => void decide("resolved")}
            >
              {copyText("app/features/creative/NarrativeLocalQualityPanel.8")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled || !note.trim()}
              onClick={() => void decide("open")}
            >
              {copyText("app/features/creative/NarrativeLocalQualityPanel.9")}
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

export function NarrativeLocalQualityPanel({
  projectId,
  request,
}: {
  projectId: string;
  request?: NarrativeQualityRequest;
}) {
  const client = useStudio(),
    queries = useQueryClient(),
    [params, setParams] = useSearchParams(),
    storageKey = `dramaip-local-quality-draft:${projectId}`;
  const [initial] = useState(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return { draft: empty };
      const value = draftSchema.parse(JSON.parse(raw));
      if (value.source && value.source.projectId !== projectId)
        throw new Error("本地来源归属不符");
      return { draft: value };
    } catch {
      return {
        draft: empty,
        error: "本机本地评议草稿无法核对，未自动替换原来源或发送请求。",
      };
    }
  });
  const [draft, setDraft] = useState(initial.draft),
    [error, setError] = useState<string | undefined>(initial.error),
    [busy, setBusy] = useState(false),
    [, setReadEpoch] = useState(0);
  const exact = params.getAll("localReviewId"),
    invalid =
      exact.length > 1 ||
      (exact.length === 1 && !z.string().uuid().safeParse(exact[0]).success) ||
      Boolean(
        exact.length && (params.has("reportId") || params.has("workflowId")),
      );
  const id = !invalid ? exact[0] : undefined;
  const history = useQuery({
    queryKey: ["narrative-local-quality-summary-history", projectId],
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 2000,
    retry: false,
    queryFn: async () => {
      const values: NarrativeLocalQualitySummary[] = [],
        seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await client.narrativeQuality.localSummaries(
          projectId,
          cursor,
          100,
        );
        for (const value of page.items) {
          if (seen.has(value.id)) throw new Error("本地评议历史重复，未核全。");
          seen.add(value.id);
          values.push(value);
        }
        cursor = page.nextCursor;
        if (cursor && !page.items.length)
          throw new Error("本地评议历史游标未推进。");
      } while (cursor);
      return values;
    },
  });
  const detail = useQuery({
    queryKey: ["narrative-local-quality-review", projectId, id],
    enabled: Boolean(id),
    staleTime: 0,
    retry: false,
    refetchOnMount: "always",
    refetchInterval: 1500,
    queryFn: () => client.narrativeQuality.localGet(id!),
  });
  const owner =
    detail.isSuccess &&
    !detail.isError &&
    detail.isFetchedAfterMount &&
    detail.data?.id === id &&
    detail.data.projectId === projectId
      ? detail.data
      : undefined;
  const pinned = useRef<NarrativeLocalQualityReview | undefined>(undefined);
  if (owner && !pinned.current) pinned.current = owner;
  const changed = Boolean(
      owner &&
      pinned.current &&
      JSON.stringify(owner) !== JSON.stringify(pinned.current),
    ),
    value = owner ? pinned.current : undefined;
  const reviews =
    history.isSuccess && !history.isError && history.isFetchedAfterMount
      ? history.data
      : [];
  const save = (next: Draft) => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify(draftSchema.parse(next)),
    );
    setDraft(next);
  };
  const update = (next: Draft) => {
    try {
      save(next);
      setError(undefined);
    } catch {
      setError(
        "本机草稿未保存（存储不可用或空间不足）；未发送请求，原确认保留。",
      );
    }
  };
  const refresh = () =>
    Promise.all([
      queries.invalidateQueries({
        queryKey: ["narrative-local-quality-summary-history", projectId],
      }),
      queries.invalidateQueries({
        queryKey: ["narrative-local-quality-review", projectId],
      }),
      queries.invalidateQueries({ queryKey: ["pilot-package-preview"] }),
      queries.invalidateQueries({ queryKey: ["pending-confirmations"] }),
    ]);
  const submit = async (pending: Pending) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      save({ ...draft, pending });
      if (pending.kind !== "create") {
        const original = await client.narrativeQuality.localGet(pending.id);
        if (original.projectId !== projectId)
          throw new Error("原本地记录不属于本项目，未提交决定。");
      }
      const result =
        pending.kind === "create"
          ? await client.narrativeQuality.localCreate(
              projectId,
              pending.input,
              pending.key,
            )
          : pending.kind === "decision"
            ? await client.narrativeQuality.localDecide(
                pending.id,
                pending.input,
                pending.key,
              )
            : await client.narrativeQuality.localDisposition(
                pending.id,
                pending.input,
                pending.key,
              );
      if (result.projectId !== projectId)
        throw new Error("原本地回执项目不符，未打开替代记录。");
      save({ ...draft, pending: undefined });
      pinned.current = result;
      setParams({ localReviewId: result.id });
      await refresh();
    } catch (cause) {
      setError(
        `${message(cause)}；原本地请求保留，可按原 key／正文重发，不另造新来源。`,
      );
    } finally {
      setBusy(false);
    }
  };
  const readSource = async () => {
    if (!request || busy || draft.pending) return;
    setBusy(true);
    setError(undefined);
    try {
      const source = await client.narrativeQuality.localPreview(
        projectId,
        request,
      );
      if (
        !(await confirmDialog({
          title: "确认实际本地评议来源",
          description: `已读取原目标 ${source.basis.request.target.id} v${source.basis.request.target.version}，${source.references.length} 个完整引用。仅本机人工／规则评议，不创建模型任务；摘要／片段不是全文，意见不认证语义。新确认不会改旧报告。`,
          confirmLabel: "确认此完整本地来源",
        }))
      )
        return;
      save({ source, summary: "", issues: [] });
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const create = async (origin: "human-declared" | "rule") => {
    if (!draft.source || busy || draft.pending) return;
    try {
      const source = draft.source,
        input = NarrativeLocalQualityCreateSchema.parse(
          origin === "human-declared"
            ? {
                origin,
                request: source.basis.request,
                sourceFingerprint: source.sourceFingerprint,
                baseReviewId: source.baseReviewId,
                confirmed: true,
                content: localHumanContent(source, draft.summary, draft.issues),
              }
            : {
                origin,
                request: source.basis.request,
                sourceFingerprint: source.sourceFingerprint,
                baseReviewId: source.baseReviewId,
                confirmed: true,
                ruleId: "literal-repeated-passage-v1",
              },
        );
      if (
        !(await confirmDialog({
          title:
            origin === "human-declared"
              ? "保存人工评议声明草稿"
              : "运行本地逐字重复规则",
          description:
            origin === "human-declared"
              ? "你声明已评议所确认的维度和实际表达。保存只是 AI 草稿，需另行采用；无问题不保证语义正确，不改原文、不调用模型。"
              : "只检查目标原文字段中 40–2000 字的逐字重复段落，最多100项／每项12证据，不读隐式外部来源，不提供语义维度覆盖或质量评分。",
          confirmLabel:
            origin === "human-declared"
              ? "确认保存人工草稿"
              : "确认运行本地规则",
        }))
      )
        return;
      await submit({ kind: "create", key: crypto.randomUUID(), input });
    } catch (cause) {
      setError(message(cause));
    }
  };
  const adopt = async (action: "adopt" | "discard") => {
    if (!value || busy || changed || draft.pending) return;
    if (
      !(await confirmDialog({
        title: action === "adopt" ? "明确采用本地评议" : "放弃本地 AI 草稿",
        description:
          "只决定这份实际 AI 草稿，不修改正文。采用人工或规则记录不等于质量认证；源变或竞争采用位置会拒绝。",
        confirmLabel:
          action === "adopt" ? "确认采用本地记录" : "确认放弃本地 AI 草稿",
      }))
    )
      return;
    await submit({
      kind: "decision",
      key: crypto.randomUUID(),
      id: value.id,
      input: { action, version: value.version, confirmed: true },
    });
  };
  const patchIssue = (index: number, patch: Partial<LocalIssueDraft>) =>
    update({
      ...draft,
      issues: draft.issues.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    });
  const fields = draft.source ? localEvidenceFields(draft.source) : [],
    locked = busy || Boolean(draft.pending),
    issues = value
      ? value.origin === "human-declared"
        ? value.content.issues
        : value.content.findings
      : [];
  return (
    <section
      aria-label={copyText(
        "app/features/creative/NarrativeLocalQualityPanel.10",
      )}
      className={styles.c13}
    >
      <h2 className={styles.c14}>
        {copyText("app/features/creative/NarrativeLocalQualityPanel.11")}
      </h2>
      <p className={styles.c15}>
        {copyText("app/features/creative/NarrativeLocalQualityPanel.12")}
      </p>
      <Button
        size="sm"
        disabled={!request || locked}
        onClick={() => void readSource()}
      >
        {copyText("app/features/creative/NarrativeLocalQualityPanel.13")}
      </Button>
      {!request && (
        <p className={styles.c15}>
          {copyText("app/features/creative/NarrativeLocalQualityPanel.14")}
        </p>
      )}
      {draft.pending && (
        <div className={styles.c1}>
          <p className={styles.c16}>
            {copyText("app/features/creative/NarrativeLocalQualityPanel.15")}
            {draft.pending.kind}
            {copyText("app/features/creative/NarrativeLocalQualityPanel.16")}
            {draft.pending.key}{" "}
            {copyText("app/features/creative/NarrativeLocalQualityPanel.17")}
          </p>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void submit(draft.pending!)}
          >
            {copyText("app/features/creative/NarrativeLocalQualityPanel.18")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              if (
                await confirmDialog({
                  title: "放弃本机待重发请求",
                  description:
                    "不会撤销服务器已经提交的原记录。可先重发恢复真实回执；放弃后应从原历史读取，不能把丢失回复当未写入。",
                  confirmLabel: "只放弃本机待重发",
                })
              )
                update({ ...draft, pending: undefined });
            }}
          >
            {copyText("app/features/creative/NarrativeLocalQualityPanel.19")}
          </Button>
        </div>
      )}
      {draft.source && (
        <div
          className={styles.c17}
          data-local-quality-source={draft.source.sourceFingerprint}
        >
          <p className={styles.c18}>
            {copyText("app/features/creative/NarrativeLocalQualityPanel.20")}
            {draft.source.basis.request.target.id}
            {copyText("app/features/creative/NarrativeLocalQualityPanel.2")}
            {draft.source.basis.request.target.version}
            {copyText(
              "app/features/creative/NarrativeLocalQualityPanel.21",
            )}{" "}
            {draft.source.sourceFingerprint} ·{" "}
            {draft.source.basis.request.dimensions
              .map((dimension) => QUALITY_DIMENSION_LABELS[dimension])
              .join("、")}{" "}
            ·{" "}
            {draft.source.basis.request.chapterScope?.mode === "full"
              ? "全书所确认表达（摘要／段落不是全文）"
              : draft.source.basis.request.chapterScope
                ? "局部所选章（不是全书）"
                : "单对象完整表达"}
            {copyText("app/features/creative/NarrativeLocalQualityPanel.22")}
          </p>
          <details className={styles.c19}>
            <summary>
              {copyText("app/features/creative/NarrativeLocalQualityPanel.23")}
            </summary>
            <div className={styles.c20}>
              {fields.map((field) => (
                <div key={localFieldKey(field)}>
                  <p className={styles.c18}>
                    {field.sourceId}
                    {copyText(
                      "app/features/creative/NarrativeLocalQualityPanel.2",
                    )}
                    {field.sourceVersion} · {field.valuePath}
                  </p>
                  <pre className={styles.c21}>{field.text}</pre>
                </div>
              ))}
            </div>
          </details>
          <label className={styles.c9}>
            {copyText("app/features/creative/NarrativeLocalQualityPanel.24")}
            <textarea
              aria-label={copyText(
                "app/features/creative/NarrativeLocalQualityPanel.24",
              )}
              value={draft.summary}
              disabled={locked}
              onChange={(event) =>
                update({ ...draft, summary: event.target.value })
              }
              className={styles.c10}
            />
          </label>
          {draft.issues.map((issue, index) => (
            <fieldset key={issue.id} className={styles.c1}>
              <legend>
                {copyText(
                  "app/features/creative/NarrativeLocalQualityPanel.25",
                )}
                {index + 1}
              </legend>
              <div className={styles.c22}>
                <label>
                  {copyText(
                    "app/features/creative/NarrativeLocalQualityPanel.26",
                  )}
                  <NativeSelect
                    className={styles.c23}
                    aria-label={copyText(
                      "app/features/creative/NarrativeLocalQualityPanel.50",
                      { p1: index + 1 },
                    )}
                    value={issue.category}
                    disabled={locked}
                    onChange={(event) =>
                      patchIssue(index, {
                        category: event.target
                          .value as LocalIssueDraft["category"],
                      })
                    }
                  >
                    {draft.source!.basis.request.dimensions.map((dimension) => (
                      <option key={dimension} value={dimension}>
                        {QUALITY_DIMENSION_LABELS[dimension]}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label>
                  {copyText(
                    "app/features/creative/NarrativeLocalQualityPanel.27",
                  )}
                  <NativeSelect
                    className={styles.c23}
                    aria-label={copyText(
                      "app/features/creative/NarrativeLocalQualityPanel.51",
                      { p1: index + 1 },
                    )}
                    value={issue.severity}
                    disabled={locked}
                    onChange={(event) =>
                      patchIssue(index, {
                        severity: event.target
                          .value as LocalIssueDraft["severity"],
                      })
                    }
                  >
                    <option value="error">
                      {copyText(
                        "app/features/creative/NarrativeLocalQualityPanel.28",
                      )}
                    </option>
                    <option value="warning">
                      {copyText(
                        "app/features/creative/NarrativeLocalQualityPanel.29",
                      )}
                    </option>
                    <option value="suggestion">
                      {copyText(
                        "app/features/creative/NarrativeLocalQualityPanel.30",
                      )}
                    </option>
                  </NativeSelect>
                </label>
              </div>
              <label className={styles.c9}>
                {copyText(
                  "app/features/creative/NarrativeLocalQualityPanel.31",
                )}
                <textarea
                  aria-label={copyText(
                    "app/features/creative/NarrativeLocalQualityPanel.52",
                    { p1: index + 1 },
                  )}
                  value={issue.message}
                  disabled={locked}
                  onChange={(event) =>
                    patchIssue(index, { message: event.target.value })
                  }
                  className={styles.c10}
                />
              </label>
              <label className={styles.c9}>
                {copyText(
                  "app/features/creative/NarrativeLocalQualityPanel.32",
                )}
                <textarea
                  aria-label={copyText(
                    "app/features/creative/NarrativeLocalQualityPanel.53",
                    { p1: index + 1 },
                  )}
                  value={issue.suggestion}
                  disabled={locked}
                  onChange={(event) =>
                    patchIssue(index, { suggestion: event.target.value })
                  }
                  className={styles.c10}
                />
              </label>
              <label className={styles.c9}>
                {copyText(
                  "app/features/creative/NarrativeLocalQualityPanel.33",
                )}
                <NativeSelect
                  aria-label={copyText(
                    "app/features/creative/NarrativeLocalQualityPanel.54",
                    { p1: index + 1 },
                  )}
                  value={issue.field}
                  disabled={locked}
                  onChange={(event) =>
                    patchIssue(index, { field: event.target.value })
                  }
                  className={styles.c24}
                >
                  <option value="">
                    {copyText(
                      "app/features/creative/NarrativeLocalQualityPanel.34",
                    )}
                  </option>
                  {fields.map((field) => (
                    <option
                      key={localFieldKey(field)}
                      value={localFieldKey(field)}
                    >
                      {field.sourceId} · {field.valuePath}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className={styles.c9}>
                {copyText(
                  "app/features/creative/NarrativeLocalQualityPanel.35",
                )}
                <textarea
                  aria-label={copyText(
                    "app/features/creative/NarrativeLocalQualityPanel.55",
                    { p1: index + 1 },
                  )}
                  value={issue.quote}
                  disabled={locked}
                  onChange={(event) =>
                    patchIssue(index, { quote: event.target.value })
                  }
                  className={styles.c10}
                />
              </label>
              <Button
                size="sm"
                variant="ghost"
                disabled={locked}
                onClick={() =>
                  update({
                    ...draft,
                    issues: draft.issues.filter((_, i) => i !== index),
                  })
                }
              >
                {copyText(
                  "app/features/creative/NarrativeLocalQualityPanel.36",
                )}
              </Button>
            </fieldset>
          ))}
          <div className={styles.c12}>
            <Button
              size="sm"
              variant="secondary"
              disabled={locked}
              onClick={() =>
                update({
                  ...draft,
                  issues: [
                    ...draft.issues,
                    {
                      id: crypto.randomUUID(),
                      category: draft.source!.basis.request.dimensions[0]!,
                      severity: "warning",
                      message: "",
                      suggestion: "",
                      field: "",
                      quote: "",
                    },
                  ],
                })
              }
            >
              {copyText("app/features/creative/NarrativeLocalQualityPanel.37")}
            </Button>
            <Button
              size="sm"
              disabled={locked || !draft.summary.trim()}
              onClick={() => void create("human-declared")}
            >
              {copyText("app/features/creative/NarrativeLocalQualityPanel.38")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={locked}
              onClick={() => void create("rule")}
            >
              {copyText("app/features/creative/NarrativeLocalQualityPanel.39")}
            </Button>
          </div>
        </div>
      )}
      <div className={styles.c12}>
        {reviews.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant="ghost"
            onClick={() => setParams({ localReviewId: item.id })}
          >
            {item.origin === "human-declared" ? "人工" : "规则"} ·{" "}
            {item.id.slice(0, 8)} · {status(item)}
          </Button>
        ))}
      </div>
      {(invalid ||
        error ||
        history.error ||
        detail.error ||
        (detail.isSuccess &&
          detail.isFetchedAfterMount &&
          detail.data &&
          !owner)) && (
        <p role="alert" className={styles.c25}>
          {invalid
            ? "本地原记录链接重复／空白／非法或混用模型身份，未切最新记录。"
            : (error ??
              (detail.data && !owner && !detail.error
                ? "本地原记录项目或身份不符，未显示旧缓存。"
                : message(history.error ?? detail.error)))}
        </p>
      )}
      {id && !owner && !detail.error && !invalid && (
        <p className={styles.c15}>
          {copyText("app/features/creative/NarrativeLocalQualityPanel.40")}
        </p>
      )}
      {changed && (
        <p role="alert" className={styles.c26}>
          {copyText("app/features/creative/NarrativeLocalQualityPanel.41")}
          <Button
            size="sm"
            onClick={() => {
              pinned.current = owner;
              setReadEpoch((epoch) => epoch + 1);
            }}
          >
            {copyText("app/features/creative/NarrativeLocalQualityPanel.42")}
          </Button>
        </p>
      )}
      {value && (
        <div data-local-quality-review-id={value.id} className={styles.c27}>
          <h3 className={styles.c14}>
            {value.origin === "human-declared"
              ? "人工评议声明"
              : "本地逐字重复规则"}{" "}
            {copyText("app/features/creative/NarrativeLocalQualityPanel.43")}
            {value.version} · {status(value)}
          </h3>
          <p className={styles.c18}>
            {copyText("app/features/creative/NarrativeLocalQualityPanel.20")}
            {value.source.basis.request.target.id}
            {copyText("app/features/creative/NarrativeLocalQualityPanel.2")}
            {value.source.basis.request.target.version} ·{" "}
            {value.sourceState === "current"
              ? "原来源本次核对当前"
              : value.sourceState === "stale"
                ? "原来源失效，仅保留历史"
                : "原来源未核对"}{" "}
            {copyText("app/features/creative/NarrativeLocalQualityPanel.44")}
            {value.source.sourceFingerprint}
          </p>
          <p className={styles.c28}>{value.content.summary}</p>
          <p className={styles.c15}>
            {value.origin === "rule"
              ? "规则语义覆盖：未评估；未检出重复不代表质量通过。"
              : "维度覆盖是作者评议声明，不是模型或语义认证。"}{" "}
            {copyText("app/features/creative/NarrativeLocalQualityPanel.45")}
          </p>
          {value.sourceReasons.map((reason) => (
            <p key={reason} role="alert" className={styles.c26}>
              {reason}
            </p>
          ))}
          {value.status === "awaiting-review" && (
            <div className={styles.c29}>
              <Button
                size="sm"
                disabled={locked || changed || value.sourceState !== "current"}
                onClick={() => void adopt("adopt")}
              >
                {copyText(
                  "app/features/creative/NarrativeLocalQualityPanel.46",
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={locked || changed}
                onClick={() => void adopt("discard")}
              >
                {copyText(
                  "app/features/creative/NarrativeLocalQualityPanel.47",
                )}
              </Button>
            </div>
          )}
          {issues.map((issue) => (
            <LocalIssue
              key={`${value.id}:${value.version}:${issue.id}`}
              value={value}
              issue={issue}
              reviews={reviews}
              disabled={
                locked ||
                changed ||
                value.sourceState !== "current" ||
                history.isError ||
                !history.isFetchedAfterMount
              }
              submit={submit}
            />
          ))}
        </div>
      )}
    </section>
  );
}
