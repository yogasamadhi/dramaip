import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { Button, confirmDialog, NativeSelect } from "@dramaip/ui-shared";
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
      aria-label="逐镜头明确来源关联"
      className="space-y-3 rounded border border-line p-4 text-sm"
    >
      <h4 className="font-semibold">逐镜头明确来源关联</h4>
      <p className="text-muted">
        场景继承不等于每个镜头归因。明确选择实际块、引文的具体位置和可选已采用节点；人工声明／逐字规则不证明叙事语义或合法授权，不调用模型。
      </p>
      {(initial.error || invalidLink || error) && (
        <p role="alert" className="text-danger-strong">
          {initial.error ??
            (invalidLink
              ? "原关联链接重复或身份无效；未打开其他关联。"
              : error)}
        </p>
      )}
      {!opened ? (
        <Button variant="secondary" onClick={() => setOpened(true)}>
          打开逐镜头关联审阅
        </Button>
      ) : (
        <>
          {draft.pending && (
            <div
              aria-label="原关联请求待核对"
              className="space-y-2 rounded border border-line p-3"
            >
              <p>
                本机保留原{draft.pending.kind === "create" ? "创建" : "决定"}
                请求：{draft.pending.key}
                。未收到可核对回执不代表失败；重启不换键、不自动提交。
              </p>
              <Button
                disabled={busy || Boolean(initial.error) || invalidLink}
                onClick={() => void submit(draft.pending!)}
              >
                重发原关联请求（不换键）
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
                  保留明确拒绝记录，解除原请求等待
                </Button>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={unavailable}
              onClick={() => void captureSource()}
            >
              读取并明确确认当前关联来源
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void refresh()}
            >
              重读此原关联与来源
            </Button>
          </div>
          {sourceQuery.isError && !draft.pending && (
            <p role="alert" className="text-danger-strong">
              实际关联来源读取失败，旧缓存不用于本轮选择或确认。
              {message(sourceQuery.error)}
            </p>
          )}
          {draft.source && !sourceCurrent && !draft.pending && (
            <p className="text-danger-strong">
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
              <p className="break-all">
                实际正式大纲 {source!.outline.id} v{source!.outline.version} ·
                剧本 {source!.script.id} v{source!.script.version} ·{" "}
                {source!.shots.length} 个镜头；来源指纹{" "}
                {source!.sourceFingerprint}
              </p>
              {sourceCurrent && !draft.pending && (
                <div aria-label="逐镜头关联选择" className="space-y-3">
                  <label className="block">
                    明确镜头
                    <NativeSelect
                      aria-label="明确关联镜头"
                      className="w-full"
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
                      <option value="">请选择实际镜头，不默认第一项</option>
                      {source!.shots.map((value) => (
                        <option key={value.shotId} value={value.shotId}>
                          场景 {value.sceneId} · 镜头 {value.shotId}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                  {shot && (
                    <>
                      <fieldset className="space-y-2">
                        <legend>
                          明确剧本块（按实际原顺序保存，不默认全部）
                        </legend>
                        {shot.sourceBlockIds.map((id) => {
                          const block = review.script.blocks.find(
                            (value) => value.id === id,
                          );
                          return (
                            <label key={id} className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                aria-label={`关联剧本块 ${id}`}
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
                              <span className="whitespace-pre-wrap break-words">
                                {block?.type} · {id}
                                {block && "text" in block
                                  ? `：${block.text}`
                                  : ""}
                              </span>
                            </label>
                          );
                        })}
                      </fieldset>
                      <label className="block">
                        明确引文
                        <NativeSelect
                          aria-label="明确关联引文"
                          className="w-full"
                          value={evidenceId}
                          disabled={unavailable}
                          onChange={(event) => {
                            setEvidenceId(event.target.value);
                            setMatchIndex("");
                          }}
                        >
                          <option value="">请选择此场景实际引文</option>
                          {source!.evidence
                            .filter((value) => value.sceneId === shot.sceneId)
                            .map((value) => (
                              <option
                                key={value.evidenceId}
                                value={value.evidenceId}
                              >
                                {value.evidenceId} · {value.source.sourceKind}{" "}
                                {value.source.sourceId} · {value.matches.length}{" "}
                                处匹配
                              </option>
                            ))}
                        </NativeSelect>
                      </label>
                      {evidence && (
                        <>
                          {frozenQuote && (
                            <blockquote className="whitespace-pre-wrap border-l-2 border-line pl-3">
                              {frozenQuote.quote}
                            </blockquote>
                          )}
                          <p className="break-all">
                            实际表达 {evidence.source.fieldPath}
                            {evidence.valuePath} ·{" "}
                            {evidence.paragraphId
                              ? `原段落 ${evidence.paragraphId}`
                              : evidence.sourceBlockId
                                ? `原稿块 ${evidence.sourceBlockId}`
                                : "无原文段落／块锚点，不从摘要补造"}
                          </p>
                          <label className="block">
                            具体匹配位置（UTF-16，结束不含）
                            <NativeSelect
                              aria-label="明确引文匹配位置"
                              className="w-full"
                              value={matchIndex}
                              disabled={unavailable}
                              onChange={(event) =>
                                setMatchIndex(event.target.value)
                              }
                            >
                              <option value="">
                                请选择具体位置，不默认首处
                              </option>
                              {evidence.matches.map((value, index) => (
                                <option key={index} value={index}>
                                  第 {index + 1} 处 · 表达 [{value.start},{" "}
                                  {value.end})
                                  {value.chapterStart !== undefined
                                    ? ` · 原章节 [${value.chapterStart}, ${value.chapterEnd})`
                                    : ""}
                                </option>
                              ))}
                            </NativeSelect>
                          </label>
                        </>
                      )}
                      <label className="block">
                        可选已采用故事节点
                        <NativeSelect
                          aria-label="可选关联故事节点"
                          className="w-full"
                          value={nodeDeclarationId}
                          disabled={unavailable}
                          onChange={(event) =>
                            setNodeDeclarationId(event.target.value)
                          }
                        >
                          <option value="">
                            不关联节点（仍可独立保存镜头位置关联）
                          </option>
                          {(currentRead(nodes) ?? []).map((value) => (
                            <option key={value.id} value={value.id}>
                              {value.title} · {value.adoptedNode!.id} v
                              {value.adoptedNode!.version}
                            </option>
                          ))}
                        </NativeSelect>
                      </label>
                      {nodes.isError && (
                        <p role="alert">
                          节点目录读取失败，不使用旧缓存；无节点关联仍可保存。
                          {message(nodes.error)}
                        </p>
                      )}
                      {nodeDeclarationId && node.isError && (
                        <p role="alert">
                          原节点读取失败，不沿用旧节点正文或确认。
                          {message(node.error)}
                        </p>
                      )}
                      {nodeDeclarationId && nodeValue && (
                        <details aria-label="实际采用节点来源">
                          <summary>审阅原节点与实际来源锚点</summary>
                          <p className="whitespace-pre-wrap">
                            {nodeValue.input.statement}
                          </p>
                          {nodeValue.basis.sources.map((value, index) => (
                            <div key={index}>
                              <p className="break-all">
                                {JSON.stringify(value.selection)} ·{" "}
                                {JSON.stringify(value.anchors)}
                              </p>
                              <blockquote className="whitespace-pre-wrap">
                                {value.quote}
                              </blockquote>
                            </div>
                          ))}
                        </details>
                      )}
                      <label className="block">
                        人工关联理由（私人审阅，不导出）
                        <textarea
                          aria-label="人工镜头关联理由"
                          className="block w-full rounded border border-line p-2"
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
                        加入此镜头的明确关联
                      </Button>
                    </>
                  )}
                  <div aria-label="原关联草稿选择" className="space-y-2">
                    <p>
                      明确选择 {draft.selections.length} 条 ·{" "}
                      {
                        new Set(draft.selections.map((value) => value.shotId))
                          .size
                      }
                      /{source!.shots.length} 镜头；未选镜头不算已关联。
                    </p>
                    {draft.selections.map((value, index) => (
                      <div
                        key={index}
                        className="rounded border border-line p-2"
                      >
                        <p className="break-all">
                          {value.sceneId}／{value.shotId} · {value.evidenceId}{" "}
                          第{value.matchIndex + 1}处 · 块{" "}
                          {value.blockIds.join("、")}{" "}
                          {value.storyNode
                            ? `· 节点 ${value.storyNode.id} v${value.storyNode.version}`
                            : "· 无节点关联"}
                        </p>
                        <p className="whitespace-pre-wrap">{value.rationale}</p>
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
                          移除此未提交选择
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
                    保存明确关联草稿（尚不采用）
                  </Button>
                </div>
              )}
            </>
          )}
          {selectedId && detail.isError && (
            <p role="alert" className="text-danger-strong">
              原关联读取失败，旧候选正文／确认隐藏；不打开最新记录。
              {message(detail.error)}
            </p>
          )}
          {selectedId && !candidate && !detail.isError && (
            <p>正在读取精确原关联，首读缓存不用于确认…</p>
          )}
          {candidate && (
            <article
              aria-label="精确原镜头关联候选"
              className="space-y-2 rounded border border-line p-3"
            >
              <p className="break-all">
                {candidate.id} v{candidate.version} · {statusLabel(candidate)} ·
                来源 {candidate.sourceState}
              </p>
              <p>
                明确关联 {candidate.coverage.associatedShots}/
                {candidate.coverage.totalShots} 镜头；节点关联{" "}
                {candidate.coverage.nodeAssociatedShots}，实际块{" "}
                {candidate.coverage.associatedBlockCount}。
              </p>
              <p className="break-all">
                未关联镜头：
                {candidate.coverage.unassociatedShotIds.join("、") || "无"}
              </p>
              {candidate.sourceReasons.map((value) => (
                <p className="text-danger-strong" key={value}>
                  {value}
                </p>
              ))}
              {candidate.links.map((value, index) => (
                <div
                  key={index}
                  className="space-y-1 border-t border-line pt-2"
                >
                  <p className="break-all">
                    {value.sceneId}／{value.shotId} · {value.evidenceId} 第
                    {value.matchIndex + 1}处；表达 [{value.evidence.match.start}
                    , {value.evidence.match.end})
                    {value.evidence.match.chapterStart !== undefined
                      ? `；原章节 [${value.evidence.match.chapterStart}, ${value.evidence.match.chapterEnd})`
                      : ""}{" "}
                    · 块 {value.blockIds.join("、")}
                  </p>
                  <p className="break-all">
                    {value.storyNode
                      ? `实际节点 ${value.storyNode.node.id} v${value.storyNode.node.version} · ${value.storyNode.linkKind}`
                      : "无节点关联"}
                  </p>
                  <p className="whitespace-pre-wrap">
                    人工理由：{candidate.input.selections[index]!.rationale}
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
                    <label key={label} className="flex items-start gap-2">
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
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={
                        unavailable ||
                        detail.isFetching ||
                        candidate.sourceState !== "current" ||
                        !reviewed.every(Boolean)
                      }
                      onClick={() => void decide("adopt")}
                    >
                      采用此原镜头关联
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
                      放弃此原镜头关联 AI 草稿
                    </Button>
                  </div>
                </>
              )}
            </article>
          )}
          <details aria-label="逐镜头关联脱敏历史">
            <summary>逐镜头关联历史（目录不载入私人理由）</summary>
            {history.isError && (
              <p role="alert">
                本次历史读取失败，不展示旧缓存。{message(history.error)}
              </p>
            )}
            {(currentRead(history) ?? [])
              .filter(
                (value) =>
                  value.storyboard.id === result.id &&
                  value.storyboard.version === result.version,
              )
              .map((value) => (
                <p key={value.id} className="break-all">
                  <Link
                    className="text-link"
                    to={`/projects/${result.projectId}/tools/episode-development?episodeId=${result.episodeId}&operation=storyboard-package&resultId=${result.id}&shotAttributionId=${value.id}`}
                  >
                    {value.id} v{value.version} · {statusLabel(value)} ·{" "}
                    {value.sourceState} · {value.coverage.associatedShots}/
                    {value.coverage.totalShots} 镜头
                  </Link>
                </p>
              ))}
          </details>
        </>
      )}
    </section>
  );
}
