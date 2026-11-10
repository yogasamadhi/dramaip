import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "../../query";
import { Link, useSearchParams } from "../../router";
import { z } from "zod";
import { Button, NativeSelect } from "@dramaip/infra-ui-primitives";
import { confirmDialog } from "../../controls";
import {
  StoryboardAttributionCreateSchema,
  StoryboardAttributionSelectionSchema,
  type EpisodeDevelopmentResult,
  type StoryboardAttributionSelection,
  type StoryboardAttribution,
} from "@dramaip/contracts/production";
import type { StoryDeclarationPage } from "@dramaip/contracts/knowledge";
import { message, useStudio } from "../../studio-shared";
import {
  attributionSourceMatches,
  readShotAttributionSourceReview,
  readAllShotAttributionSummaries,
  readStoryboardAttributionDraft,
  writeStoryboardAttributionDraft,
  storyboardAttributionDraftKey,
  type ShotAttributionDraft,
  type ShotAttributionPending,
} from "../../storyboard-attribution-draft";
import styles from "./StoryboardAttributionPanel.module.css";
import { copyText } from "../../copy";

const currentRead = <T,>(query: {
  data?: T;
  isSuccess: boolean;
  isError: boolean;
  isFetchedAfterMount: boolean;
}) =>
  query.isSuccess && !query.isError && query.isFetchedAfterMount
    ? query.data
    : undefined;
const statusLabel = (
  value: Pick<StoryboardAttribution, "status" | "isCurrent">,
) =>
  value.status === "pending"
    ? "AI 草稿，尚未采用"
    : value.status === "discarded"
      ? "已放弃"
      : value.isCurrent
        ? "当前明确采用"
        : "历史采用";

/** Human attribution is a separate proposal/decision, never scene inheritance or a model run. */
export function StoryboardAttributionPanel({
  result,
}: {
  result: EpisodeDevelopmentResult;
}) {
  const client = useStudio(),
    cache = useQueryClient(),
    [params, setParams] = useSearchParams();
  const scope = {
    projectId: result.projectId,
    storyboard: { id: result.id, version: result.version },
  };
  const [initial] = useState(() => {
    try {
      return {
        draft: readStoryboardAttributionDraft(
          window.localStorage.getItem(storyboardAttributionDraftKey(scope)),
          scope,
        ),
      };
    } catch {
      return {
        draft: { scope, selections: [] } as ShotAttributionDraft,
        error: "本机原关联草稿无法核对；不覆盖原数据，不发送新请求。",
      };
    }
  });
  const ids = params.getAll("shotAttributionId");
  const invalidLink =
    ids.length > 1 ||
    (ids.length === 1 && !z.string().uuid().safeParse(ids[0]).success);
  const [draft, setDraft] = useState(initial.draft),
    [opened, setOpened] = useState(
      Boolean(ids.length || initial.draft.pending),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | undefined>(initial.error),
    [rejectedStatus, setRejectedStatus] = useState<
      400 | 404 | 409 | 412 | 422
    >(),
    [shotId, setShotId] = useState(""),
    [blockIds, setBlockIds] = useState<string[]>([]),
    [evidenceId, setEvidenceId] = useState(""),
    [matchIndex, setMatchIndex] = useState(""),
    [nodeDeclarationId, setNodeDeclarationId] = useState(""),
    [rationale, setRationale] = useState(""),
    [reviewed, setReviewed] = useState([false, false, false]);
  const selectedId = invalidLink ? undefined : (ids[0] ?? draft.selectedId);
  const sourceQuery = useQuery({
    queryKey: [
      "shot-attribution-source-review",
      result.projectId,
      result.id,
      result.version,
    ],
    enabled: opened && !initial.error && !draft.pending,
    staleTime: 0,
    retry: false,
    refetchOnMount: "always",
    refetchInterval: 5000,
    queryFn: () => readShotAttributionSourceReview(client, scope),
  });
  const review = opened ? currentRead(sourceQuery) : undefined;
  const source = review?.source;
  const sourceCurrent = attributionSourceMatches(draft.source, source);
  const detail = useQuery({
    queryKey: [
      "shot-attribution-detail",
      result.projectId,
      result.id,
      result.version,
      selectedId,
    ],
    enabled: opened && !invalidLink && Boolean(selectedId),
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 2000,
    queryFn: async () => {
      const value = await client.storyboardAttributions.get(
        result.projectId,
        selectedId!,
      );
      if (
        value.source.storyboard.id !== result.id ||
        value.source.storyboard.version !== result.version ||
        value.source.episodeId !== result.episodeId
      )
        throw new Error("原关联不是此分集／正式分镜版本，不打开最近关联代替。");
      return value;
    },
  });
  const candidate = currentRead(detail);
  const history = useQuery({
    queryKey: ["shot-attribution-summary-history", result.projectId],
    enabled: opened,
    staleTime: 0,
    retry: false,
    refetchOnMount: "always",
    refetchInterval: 5000,
    queryFn: () => readAllShotAttributionSummaries(client, result.projectId),
  });
  const nodes = useQuery({
    queryKey: ["shot-attribution-node-summaries", result.projectId],
    enabled: opened && Boolean(source),
    staleTime: 0,
    retry: false,
    refetchOnMount: "always",
    refetchInterval: 5000,
    queryFn: async () => {
      const values: StoryDeclarationPage["items"] = [],
        seen = new Set<string>(),
        cursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await client.storyDeclarations.list(result.projectId, {
          cursor,
          limit: 100,
        });
        for (const value of page.items) {
          if (seen.has(value.id))
            throw new Error("故事节点目录身份重复，未核全。");
          seen.add(value.id);
          values.push(value);
        }
        cursor = page.nextCursor;
        if (cursor && (!page.items.length || cursors.has(cursor)))
          throw new Error("故事节点目录分页未推进。");
        if (cursor) cursors.add(cursor);
      } while (cursor);
      return values.filter(
        (value) =>
          value.status === "adopted" &&
          value.adoptedNode &&
          value.sourceStatus.state === "current" &&
          (!value.lifecycle || value.lifecycle.state === "active"),
      );
    },
  });
  const node = useQuery({
    queryKey: [
      "shot-attribution-node-detail",
      result.projectId,
      nodeDeclarationId,
    ],
    enabled: opened && Boolean(nodeDeclarationId),
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 2000,
    queryFn: async () => {
      const value = await client.storyDeclarations.get(
        result.projectId,
        nodeDeclarationId,
      );
      if (
        value.status !== "adopted" ||
        !value.adoptedNode ||
        value.sourceStatus.state !== "current" ||
        (value.lifecycle && value.lifecycle.state !== "active")
      )
        throw new Error("所选原故事节点已变化、撤回或不可读，不换成新节点。");
      return value;
    },
  });
  const nodeValue = currentRead(node);
  useEffect(() => {
    setReviewed([false, false, false]);
  }, [selectedId, candidate?.version, candidate?.sourceState, detail.isError]);
  const persist = (next: ShotAttributionDraft) => {
    const saved = writeStoryboardAttributionDraft(window.localStorage, next);
    setDraft(saved);
  };
  const edit = (next: ShotAttributionDraft) => {
    try {
      persist(next);
      setError(undefined);
    } catch {
      setError(
        "本机原请求／草稿未保存（存储不可用或空间不足）；未发送请求，原选择保留。",
      );
    }
  };
  const refresh = async () => {
    await Promise.all([
      cache.invalidateQueries({
        queryKey: ["shot-attribution-detail", result.projectId],
      }),
      cache.invalidateQueries({
        queryKey: ["shot-attribution-summary-history", result.projectId],
      }),
      cache.invalidateQueries({
        queryKey: ["shot-attribution-source-review", result.projectId],
      }),
      cache.invalidateQueries({
        queryKey: ["pilot-packages", result.projectId],
      }),
    ]);
  };
  const submit = async (pending: ShotAttributionPending) => {
    if (busy || initial.error || invalidLink) return;
    setBusy(true);
    setError(undefined);
    setRejectedStatus(undefined);
    try {
      try {
        persist({ ...draft, pending }); // Failure here must precede any HTTP.
      } catch {
        setError(
          "本机原请求未完整保存（存储不可用或空间不足）；未发送HTTP，原草稿保留。请恢复本机存储后再明确提交。",
        );
        return;
      }
      const value =
        pending.kind === "create"
          ? await client.storyboardAttributions.create(
              result.projectId,
              pending.input,
              pending.key,
            )
          : await client.storyboardAttributions.decide(
              result.projectId,
              pending.original,
              pending.input,
              pending.key,
            );
      persist({ ...draft, pending: undefined, selectedId: value.id });
      setParams((previous) => {
        const next = new URLSearchParams(previous);
        next.set("shotAttributionId", value.id);
        next.set("resultId", result.id);
        next.set("episodeId", result.episodeId);
        next.set("operation", "storyboard-package");
        next.delete("workflowId");
        return next;
      });
      await refresh(); // Receipt is not the current owner read; do not show it as such.
    } catch (cause) {
      const status =
        cause instanceof Error && "status" in cause ? cause.status : undefined;
      if (
        status === 400 ||
        status === 404 ||
        status === 409 ||
        status === 412 ||
        status === 422
      )
        setRejectedStatus(status);
      setError(
        `${message(cause)}；原 key／完整正文保留。回复未知时只能明确重发原请求，不自动另建 AI 草稿。`,
      );
    } finally {
      setBusy(false);
    }
  };
  const captureSource = async () => {
    if (busy || draft.pending || initial.error || invalidLink) return;
    setOpened(true);
    setBusy(true);
    setError(undefined);
    try {
      const fresh = await readShotAttributionSourceReview(client, scope);
      if (
        !(await confirmDialog({
          title: "明确确认逐镜头关联来源",
          description: `正式分镜 ${result.id} v${result.version}，${fresh.source.shots.length} 个实际镜头。完整引文位置与剧本块已读取；新草稿清空未提交选择，已保存草稿及原历史不改。人工关联不证明语义或权利通过。`,
          confirmLabel: "确认此正式版本来源",
        }))
      )
        return;
      persist({ ...draft, source: fresh.source, selections: [] });
      cache.setQueryData(
        [
          "shot-attribution-source-review",
          result.projectId,
          result.id,
          result.version,
        ],
        fresh,
      );
      await sourceQuery.refetch();
      setShotId("");
      setBlockIds([]);
      setEvidenceId("");
      setMatchIndex("");
      setNodeDeclarationId("");
      setRationale("");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const shot = source?.shots.find((value) => value.shotId === shotId);
  const evidence = source?.evidence.find(
    (value) =>
      value.sceneId === shot?.sceneId && value.evidenceId === evidenceId,
  );
  const frozenQuote = review?.outline.scenes
    .find((value) => value.id === shot?.sceneId)
    ?.sourceEvidence?.find((value) => value.id === evidenceId);
  const unavailable =
    busy ||
    Boolean(draft.pending || initial.error) ||
    invalidLink ||
    Boolean(selectedId && (!candidate || detail.isError || detail.isFetching));
  const addSelection = () => {
    if (
      unavailable ||
      !sourceCurrent ||
      !shot ||
      !evidence ||
      matchIndex === "" ||
      sourceQuery.isFetching ||
      (nodeDeclarationId && (!nodeValue || node.isFetching || nodes.isError))
    )
      return;
    try {
      const value: StoryboardAttributionSelection =
        StoryboardAttributionSelectionSchema.parse({
          sceneId: shot.sceneId,
          shotId: shot.shotId,
          blockIds: shot.sourceBlockIds.filter((id) => blockIds.includes(id)),
          evidenceId,
          matchIndex: Number(matchIndex),
          rationale,
          ...(nodeDeclarationId ? { storyNode: nodeValue!.adoptedNode } : {}),
        });
      const selections = [...draft.selections, value];
      StoryboardAttributionCreateSchema.parse({
        storyboard: scope.storyboard,
        sourceFingerprint: draft.source!.sourceFingerprint,
        baseAttributionId: draft.source!.baseAttributionId,
        selections,
      });
      edit({ ...draft, selections });
      setRationale("");
    } catch (cause) {
      setError(message(cause));
    }
  };
  const create = async () => {
    if (
      unavailable ||
      !sourceCurrent ||
      !draft.source ||
      !draft.selections.length ||
      sourceQuery.isFetching
    )
      return;
    const input = StoryboardAttributionCreateSchema.parse({
      storyboard: scope.storyboard,
      sourceFingerprint: draft.source.sourceFingerprint,
      baseAttributionId: draft.source.baseAttributionId,
      selections: draft.selections,
    });
    if (
      !(await confirmDialog({
        title: "保存明确镜头关联草稿",
        description: `${input.selections.length} 条明确位置选择；只保存人工草稿，另行审阅采用。不改变正式稿、未选镜头，不调用模型。`,
        confirmLabel: "保存原关联草稿",
      }))
    )
      return;
    await submit({ kind: "create", key: crypto.randomUUID(), input });
  };
  const decide = async (action: "adopt" | "discard") => {
    if (
      unavailable ||
      !candidate ||
      detail.isFetching ||
      candidate.status !== "pending" ||
      !reviewed.every(Boolean) ||
      (action === "adopt" && candidate.sourceState !== "current")
    )
      return;
    const original = candidate;
    if (
      !(await confirmDialog({
        title:
          action === "adopt" ? "明确采用原逐镜头关联" : "放弃原关联 AI 草稿",
        description: `${original.id} v${original.version}，${original.coverage.associatedShots}/${original.coverage.totalShots} 镜头关联。未关联范围保持未关联；位置规则不认证语义，正式稿与节点正文不改。`,
        confirmLabel: action === "adopt" ? "采用此原关联" : "放弃此原 AI 草稿",
      }))
    )
      return;
    await submit({
      kind: "decision",
      key: crypto.randomUUID(),
      original,
      input: {
        version: original.version,
        sourceFingerprint: original.source.sourceFingerprint,
        associationFingerprint: original.associationFingerprint,
        action,
        actualSourcesReviewed: true,
        exactShotLinksReviewed: true,
        unverifiedSemanticsAcknowledged: true,
      },
    });
  };
  return (
    <section
      aria-label={copyText(
        "app/features/production/StoryboardAttributionPanel.1",
      )}
      className={styles.c1}
    >
      <h4 className={styles.c2}>
        {copyText("app/features/production/StoryboardAttributionPanel.1")}
      </h4>
      <p className={styles.c3}>
        {copyText("app/features/production/StoryboardAttributionPanel.2")}
      </p>
      {(initial.error || invalidLink || error) && (
        <p role="alert" className={styles.c4}>
          {initial.error ??
            (invalidLink
              ? "原关联链接重复或身份无效；未打开其他关联。"
              : error)}
        </p>
      )}
      {!opened ? (
        <Button variant="secondary" onClick={() => setOpened(true)}>
          {copyText("app/features/production/StoryboardAttributionPanel.3")}
        </Button>
      ) : (
        <>
          {draft.pending && (
            <div
              aria-label={copyText(
                "app/features/production/StoryboardAttributionPanel.4",
              )}
              className={styles.c5}
            >
              <p>
                {copyText(
                  "app/features/production/StoryboardAttributionPanel.5",
                )}
                {draft.pending.kind === "create" ? "创建" : "决定"}
                {copyText(
                  "app/features/production/StoryboardAttributionPanel.6",
                )}
                {draft.pending.key}
                {copyText(
                  "app/features/production/StoryboardAttributionPanel.7",
                )}
              </p>
              <Button
                disabled={busy || Boolean(initial.error) || invalidLink}
                onClick={() => void submit(draft.pending!)}
              >
                {copyText(
                  "app/features/production/StoryboardAttributionPanel.8",
                )}
              </Button>
              {rejectedStatus && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    edit({
                      ...draft,
                      pending: undefined,
                      rejectedRequests: [
                        ...(draft.rejectedRequests ?? []),
                        { request: draft.pending!, status: rejectedStatus },
                      ],
                    });
                    setRejectedStatus(undefined);
                  }}
                >
                  {copyText(
                    "app/features/production/StoryboardAttributionPanel.9",
                  )}
                </Button>
              )}
            </div>
          )}
          <div className={styles.c6}>
            <Button
              variant="secondary"
              disabled={unavailable}
              onClick={() => void captureSource()}
            >
              {copyText(
                "app/features/production/StoryboardAttributionPanel.10",
              )}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void refresh()}
            >
              {copyText(
                "app/features/production/StoryboardAttributionPanel.11",
              )}
            </Button>
          </div>
          {sourceQuery.isError && !draft.pending && (
            <p role="alert" className={styles.c4}>
              {copyText(
                "app/features/production/StoryboardAttributionPanel.12",
              )}
              {message(sourceQuery.error)}
            </p>
          )}
          {draft.source && !sourceCurrent && !draft.pending && (
            <p className={styles.c4}>
              {source &&
              draft.source.sourceFingerprint === source.sourceFingerprint
                ? "关联采用头已变化，旧草稿不能直接用于新 AI 草稿；已采用记录的来源状态单独核对，原选择保留。"
                : source
                  ? "原正式来源或实际记录已变化；原草稿保留，不自动重绑。"
                  : "本次实际来源尚未核对；原草稿保留，不使用缓存确认。"}
            </p>
          )}
          {review && (
            <>
              <p className={styles.c7}>
                {copyText(
                  "app/features/production/StoryboardAttributionPanel.13",
                )}
                {source!.outline.id}
                {copyText(
                  "app/features/production/StoryboardAttributionPanel.14",
                )}
                {source!.outline.version}
                {copyText(
                  "app/features/production/StoryboardAttributionPanel.15",
                )}
                {source!.script.id}
                {copyText(
                  "app/features/production/StoryboardAttributionPanel.14",
                )}
                {source!.script.version} · {source!.shots.length}
                {copyText(
                  "app/features/production/StoryboardAttributionPanel.16",
                )}{" "}
                {source!.sourceFingerprint}
              </p>
              {sourceCurrent && !draft.pending && (
                <div
                  aria-label={copyText(
                    "app/features/production/StoryboardAttributionPanel.17",
                  )}
                  className={styles.c8}
                >
                  <label className={styles.c9}>
                    {copyText(
                      "app/features/production/StoryboardAttributionPanel.18",
                    )}
                    <NativeSelect
                      aria-label={copyText(
                        "app/features/production/StoryboardAttributionPanel.19",
                      )}
                      className={styles.c10}
                      value={shotId}
                      disabled={unavailable}
                      onChange={(event) => {
                        setShotId(event.target.value);
                        setBlockIds([]);
                        setEvidenceId("");
                        setMatchIndex("");
                        setNodeDeclarationId("");
                      }}
                    >
                      <option value="">
                        {copyText(
                          "app/features/production/StoryboardAttributionPanel.20",
                        )}
                      </option>
                      {source!.shots.map((value) => (
                        <option key={value.shotId} value={value.shotId}>
                          {copyText(
                            "app/features/production/StoryboardAttributionPanel.21",
                          )}
                          {value.sceneId}
                          {copyText(
                            "app/features/production/StoryboardAttributionPanel.22",
                          )}
                          {value.shotId}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                  {shot && (
                    <>
                      <fieldset className={styles.c11}>
                        <legend>
                          {copyText(
                            "app/features/production/StoryboardAttributionPanel.23",
                          )}
                        </legend>
                        {shot.sourceBlockIds.map((id) => {
                          const block = review.script.blocks.find(
                            (value) => value.id === id,
                          );
                          return (
                            <label key={id} className={styles.c12}>
                              <input
                                type="checkbox"
                                aria-label={copyText(
                                  "app/features/production/StoryboardAttributionPanel.70",
                                  { p1: id },
                                )}
                                disabled={unavailable}
                                checked={blockIds.includes(id)}
                                onChange={(event) =>
                                  setBlockIds((previous) =>
                                    event.target.checked
                                      ? [...previous, id]
                                      : previous.filter(
                                          (value) => value !== id,
                                        ),
                                  )
                                }
                              />
                              <span className={styles.c13}>
                                {block?.type} · {id}
                                {block && "text" in block
                                  ? `：${block.text}`
                                  : ""}
                              </span>
                            </label>
                          );
                        })}
                      </fieldset>
                      <label className={styles.c9}>
                        {copyText(
                          "app/features/production/StoryboardAttributionPanel.24",
                        )}
                        <NativeSelect
                          aria-label={copyText(
                            "app/features/production/StoryboardAttributionPanel.25",
                          )}
                          className={styles.c10}
                          value={evidenceId}
                          disabled={unavailable}
                          onChange={(event) => {
                            setEvidenceId(event.target.value);
                            setMatchIndex("");
                          }}
                        >
                          <option value="">
                            {copyText(
                              "app/features/production/StoryboardAttributionPanel.26",
                            )}
                          </option>
                          {source!.evidence
                            .filter((value) => value.sceneId === shot.sceneId)
                            .map((value) => (
                              <option
                                key={value.evidenceId}
                                value={value.evidenceId}
                              >
                                {value.evidenceId} · {value.source.sourceKind}{" "}
                                {value.source.sourceId} · {value.matches.length}{" "}
                                {copyText(
                                  "app/features/production/StoryboardAttributionPanel.27",
                                )}
                              </option>
                            ))}
                        </NativeSelect>
                      </label>
                      {evidence && (
                        <>
                          {frozenQuote && (
                            <blockquote className={styles.c14}>
                              {frozenQuote.quote}
                            </blockquote>
                          )}
                          <p className={styles.c7}>
                            {copyText(
                              "app/features/production/StoryboardAttributionPanel.28",
                            )}
                            {evidence.source.fieldPath}
                            {evidence.valuePath} ·{" "}
                            {evidence.paragraphId
                              ? `原段落 ${evidence.paragraphId}`
                              : evidence.sourceBlockId
                                ? `原稿块 ${evidence.sourceBlockId}`
                                : "无原文段落／块锚点，不从摘要补造"}
                          </p>
                          <label className={styles.c9}>
                            {copyText(
                              "app/features/production/StoryboardAttributionPanel.29",
                            )}
                            <NativeSelect
                              aria-label={copyText(
                                "app/features/production/StoryboardAttributionPanel.30",
                              )}
                              className={styles.c10}
                              value={matchIndex}
                              disabled={unavailable}
                              onChange={(event) =>
                                setMatchIndex(event.target.value)
                              }
                            >
                              <option value="">
                                {copyText(
                                  "app/features/production/StoryboardAttributionPanel.31",
                                )}
                              </option>
                              {evidence.matches.map((value, index) => (
                                <option key={index} value={index}>
                                  {copyText(
                                    "app/features/production/StoryboardAttributionPanel.32",
                                  )}
                                  {index + 1}
                                  {copyText(
                                    "app/features/production/StoryboardAttributionPanel.33",
                                  )}
                                  {value.start}, {value.end})
                                  {value.chapterStart !== undefined
                                    ? ` · 原章节 [${value.chapterStart}, ${value.chapterEnd})`
                                    : ""}
                                </option>
                              ))}
                            </NativeSelect>
                          </label>
                        </>
                      )}
                      <label className={styles.c9}>
                        {copyText(
                          "app/features/production/StoryboardAttributionPanel.34",
                        )}
                        <NativeSelect
                          aria-label={copyText(
                            "app/features/production/StoryboardAttributionPanel.35",
                          )}
                          className={styles.c10}
                          value={nodeDeclarationId}
                          disabled={unavailable}
                          onChange={(event) =>
                            setNodeDeclarationId(event.target.value)
                          }
                        >
                          <option value="">
                            {copyText(
                              "app/features/production/StoryboardAttributionPanel.36",
                            )}
                          </option>
                          {(currentRead(nodes) ?? []).map((value) => (
                            <option key={value.id} value={value.id}>
                              {value.title} · {value.adoptedNode!.id}
                              {copyText(
                                "app/features/production/StoryboardAttributionPanel.14",
                              )}
                              {value.adoptedNode!.version}
                            </option>
                          ))}
                        </NativeSelect>
                      </label>
                      {nodes.isError && (
                        <p role="alert">
                          {copyText(
                            "app/features/production/StoryboardAttributionPanel.37",
                          )}
                          {message(nodes.error)}
                        </p>
                      )}
                      {nodeDeclarationId && node.isError && (
                        <p role="alert">
                          {copyText(
                            "app/features/production/StoryboardAttributionPanel.38",
                          )}
                          {message(node.error)}
                        </p>
                      )}
                      {nodeDeclarationId && nodeValue && (
                        <details
                          aria-label={copyText(
                            "app/features/production/StoryboardAttributionPanel.39",
                          )}
                        >
                          <summary>
                            {copyText(
                              "app/features/production/StoryboardAttributionPanel.40",
                            )}
                          </summary>
                          <p className={styles.c15}>
                            {nodeValue.input.statement}
                          </p>
                          {nodeValue.basis.sources.map((value, index) => (
                            <div key={index}>
                              <p className={styles.c7}>
                                {JSON.stringify(value.selection)} ·{" "}
                                {JSON.stringify(value.anchors)}
                              </p>
                              <blockquote className={styles.c15}>
                                {value.quote}
                              </blockquote>
                            </div>
                          ))}
                        </details>
                      )}
                      <label className={styles.c9}>
                        {copyText(
                          "app/features/production/StoryboardAttributionPanel.41",
                        )}
                        <textarea
                          aria-label={copyText(
                            "app/features/production/StoryboardAttributionPanel.42",
                          )}
                          className={styles.c16}
                          rows={3}
                          maxLength={4000}
                          value={rationale}
                          disabled={unavailable}
                          onChange={(event) => setRationale(event.target.value)}
                        />
                      </label>
                      <Button
                        variant="secondary"
                        disabled={
                          unavailable ||
                          sourceQuery.isFetching ||
                          !blockIds.length ||
                          !evidence ||
                          matchIndex === "" ||
                          !rationale.trim() ||
                          Boolean(
                            nodeDeclarationId &&
                            (!nodeValue || node.isFetching || nodes.isError),
                          )
                        }
                        onClick={addSelection}
                      >
                        {copyText(
                          "app/features/production/StoryboardAttributionPanel.43",
                        )}
                      </Button>
                    </>
                  )}
                  <div
                    aria-label={copyText(
                      "app/features/production/StoryboardAttributionPanel.44",
                    )}
                    className={styles.c11}
                  >
                    <p>
                      {copyText(
                        "app/features/production/StoryboardAttributionPanel.45",
                      )}
                      {draft.selections.length}
                      {copyText(
                        "app/features/production/StoryboardAttributionPanel.46",
                      )}{" "}
                      {
                        new Set(draft.selections.map((value) => value.shotId))
                          .size
                      }
                      /{source!.shots.length}
                      {copyText(
                        "app/features/production/StoryboardAttributionPanel.47",
                      )}
                    </p>
                    {draft.selections.map((value, index) => (
                      <div key={index} className={styles.c17}>
                        <p className={styles.c7}>
                          {value.sceneId}／{value.shotId} · {value.evidenceId}{" "}
                          {copyText(
                            "app/features/production/StoryboardAttributionPanel.48",
                          )}
                          {value.matchIndex + 1}
                          {copyText(
                            "app/features/production/StoryboardAttributionPanel.49",
                          )}{" "}
                          {value.blockIds.join("、")}{" "}
                          {value.storyNode
                            ? `· 节点 ${value.storyNode.id} v${value.storyNode.version}`
                            : "· 无节点关联"}
                        </p>
                        <p className={styles.c15}>{value.rationale}</p>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={unavailable}
                          onClick={() =>
                            edit({
                              ...draft,
                              selections: draft.selections.filter(
                                (_, position) => position !== index,
                              ),
                            })
                          }
                        >
                          {copyText(
                            "app/features/production/StoryboardAttributionPanel.50",
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button
                    disabled={
                      unavailable ||
                      sourceQuery.isFetching ||
                      !draft.selections.length
                    }
                    onClick={() => void create()}
                  >
                    {copyText(
                      "app/features/production/StoryboardAttributionPanel.51",
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
          {selectedId && detail.isError && (
            <p role="alert" className={styles.c4}>
              {copyText(
                "app/features/production/StoryboardAttributionPanel.52",
              )}
              {message(detail.error)}
            </p>
          )}
          {selectedId && !candidate && !detail.isError && (
            <p>
              {copyText(
                "app/features/production/StoryboardAttributionPanel.53",
              )}
            </p>
          )}
          {candidate && (
            <article
              aria-label={copyText(
                "app/features/production/StoryboardAttributionPanel.54",
              )}
              className={styles.c5}
            >
              <p className={styles.c7}>
                {candidate.id}
                {copyText(
                  "app/features/production/StoryboardAttributionPanel.14",
                )}
                {candidate.version} · {statusLabel(candidate)}
                {copyText(
                  "app/features/production/StoryboardAttributionPanel.55",
                )}
                {candidate.sourceState}
              </p>
              <p>
                {copyText(
                  "app/features/production/StoryboardAttributionPanel.56",
                )}
                {candidate.coverage.associatedShots}/
                {candidate.coverage.totalShots}
                {copyText(
                  "app/features/production/StoryboardAttributionPanel.57",
                )}{" "}
                {candidate.coverage.nodeAssociatedShots}
                {copyText(
                  "app/features/production/StoryboardAttributionPanel.58",
                )}{" "}
                {candidate.coverage.associatedBlockCount}。
              </p>
              <p className={styles.c7}>
                {copyText(
                  "app/features/production/StoryboardAttributionPanel.59",
                )}
                {candidate.coverage.unassociatedShotIds.join("、") || "无"}
              </p>
              {candidate.sourceReasons.map((value) => (
                <p className={styles.c4} key={value}>
                  {value}
                </p>
              ))}
              {candidate.links.map((value, index) => (
                <div key={index} className={styles.c18}>
                  <p className={styles.c7}>
                    {value.sceneId}／{value.shotId} · {value.evidenceId}
                    {copyText(
                      "app/features/production/StoryboardAttributionPanel.60",
                    )}
                    {value.matchIndex + 1}
                    {copyText(
                      "app/features/production/StoryboardAttributionPanel.61",
                    )}
                    {value.evidence.match.start}, {value.evidence.match.end})
                    {value.evidence.match.chapterStart !== undefined
                      ? `；原章节 [${value.evidence.match.chapterStart}, ${value.evidence.match.chapterEnd})`
                      : ""}{" "}
                    {copyText(
                      "app/features/production/StoryboardAttributionPanel.62",
                    )}
                    {value.blockIds.join("、")}
                  </p>
                  <p className={styles.c7}>
                    {value.storyNode
                      ? `实际节点 ${value.storyNode.node.id} v${value.storyNode.node.version} · ${value.storyNode.linkKind}`
                      : "无节点关联"}
                  </p>
                  <p className={styles.c15}>
                    {copyText(
                      "app/features/production/StoryboardAttributionPanel.63",
                    )}
                    {candidate.input.selections[index]!.rationale}
                  </p>
                </div>
              ))}
              {candidate.status === "pending" && (
                <>
                  {[
                    "已审阅实际来源与具体匹配位置",
                    "已核对所选镜头／稳定块／可选节点及未关联范围",
                    "理解人工声明和位置规则不证明语义或合法授权",
                  ].map((label, index) => (
                    <label key={label} className={styles.c12}>
                      <input
                        type="checkbox"
                        aria-label={label}
                        checked={reviewed[index]}
                        disabled={unavailable || detail.isFetching}
                        onChange={(event) =>
                          setReviewed((previous) =>
                            previous.map((value, position) =>
                              position === index ? event.target.checked : value,
                            ),
                          )
                        }
                      />
                      {label}
                    </label>
                  ))}
                  <div className={styles.c6}>
                    <Button
                      disabled={
                        unavailable ||
                        detail.isFetching ||
                        candidate.sourceState !== "current" ||
                        !reviewed.every(Boolean)
                      }
                      onClick={() => void decide("adopt")}
                    >
                      {copyText(
                        "app/features/production/StoryboardAttributionPanel.64",
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={
                        unavailable ||
                        detail.isFetching ||
                        !reviewed.every(Boolean)
                      }
                      onClick={() => void decide("discard")}
                    >
                      {copyText(
                        "app/features/production/StoryboardAttributionPanel.65",
                      )}
                    </Button>
                  </div>
                </>
              )}
            </article>
          )}
          <details
            aria-label={copyText(
              "app/features/production/StoryboardAttributionPanel.66",
            )}
          >
            <summary>
              {copyText(
                "app/features/production/StoryboardAttributionPanel.67",
              )}
            </summary>
            {history.isError && (
              <p role="alert">
                {copyText(
                  "app/features/production/StoryboardAttributionPanel.68",
                )}
                {message(history.error)}
              </p>
            )}
            {(currentRead(history) ?? [])
              .filter(
                (value) =>
                  value.storyboard.id === result.id &&
                  value.storyboard.version === result.version,
              )
              .map((value) => (
                <p key={value.id} className={styles.c7}>
                  <Link
                    className={styles.c19}
                    to={`/projects/${result.projectId}/tools/episode-development?episodeId=${result.episodeId}&operation=storyboard-package&resultId=${result.id}&shotAttributionId=${value.id}`}
                  >
                    {value.id}
                    {copyText(
                      "app/features/production/StoryboardAttributionPanel.14",
                    )}
                    {value.version} · {statusLabel(value)} · {value.sourceState}{" "}
                    · {value.coverage.associatedShots}/
                    {value.coverage.totalShots}
                    {copyText(
                      "app/features/production/StoryboardAttributionPanel.69",
                    )}
                  </Link>
                </p>
              ))}
          </details>
        </>
      )}
    </section>
  );
}
