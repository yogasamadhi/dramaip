import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, confirmDialog } from "@dramaip/ui-shared";
import {
  EpisodeOutlineContentSchema,
  EpisodeSourceRevisionInputSchema,
  type EpisodeDevelopmentResult,
  type EpisodeOutlineContent,
  type EpisodeSourceRevisionInput,
  type EpisodeSourceRevisionConfirmation,
} from "@dramaip/contracts/production";
import type { NarrativeContextRequest } from "@dramaip/contracts/creation";
import { useStudio, message } from "../../studio-shared";
import {
  CURRENT_OWNER_READ_OPTIONS,
  currentOwnerQuery,
  sameFrozenOwnerSnapshot,
} from "../../current-owner-read";
import {
  newSourceRevisionRequest,
  sourceRevisionSceneLinks,
  readExactSourceRevision,
  readSourceRevisionRecovery,
  saveSourceRevisionRecovery,
  clearSourceRevisionRecovery,
  verifySourceRevisionRecoveryReply,
  type SourceRevisionRecovery,
  rebindSameSelectedSourceVersions,
} from "../../episode-source-revision-state";
import { NovelContextPicker } from "../novel/NovelContextPicker";

const reviews: Array<{
  key: keyof EpisodeSourceRevisionConfirmation;
  label: string;
}> = [
  {
    key: "currentSourcesReviewed",
    label: "已审阅本次明确的新来源、版本及实际覆盖",
  },
  {
    key: "outlineReviewed",
    label: "已审阅完整新大纲，不用旧采用记录冒充新来源",
  },
  {
    key: "actualDocumentReviewed",
    label: "已审阅实际保存的原稿；本操作不改写正文",
  },
  {
    key: "sceneMappingReviewed",
    label: "已审阅每个实际块到新大纲场景的完整映射",
  },
  {
    key: "retainedManuscriptReviewed",
    label: "明确保留原稿与旧采用历史；人工声明不证明语义或权利",
  },
];
const inputClass =
  "w-full rounded border border-line bg-surface px-3 py-2 text-sm";

/** Full human source confirmation. All business reads/writes use the SDK.
 * A local request record only recovers the exact already-authorized request;
 * it never adopts a different preview or silently refreshes its source basis. */
export function EpisodeSourceRevisionPanel({
  result,
}: {
  result: EpisodeDevelopmentResult;
}) {
  const client = useStudio(),
    cache = useQueryClient(),
    [params, setParams] = useSearchParams();
  const requestedId = params.get("sourceRevisionId") ?? undefined;
  const outlineRef = result.basis.request.outline;
  const binding = {
    projectId: result.projectId,
    episodeId: result.episodeId,
    sourceScript: { id: result.id, version: result.version },
    sourceOutline: outlineRef!,
  };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [opened, setOpened] = useState(Boolean(requestedId)),
    [draft, setDraft] = useState<EpisodeSourceRevisionInput>();
  const [recovery, setRecovery] = useState<SourceRevisionRecovery>(),
    [storageError, setStorageError] = useState<string>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const [sourceScriptId, setSourceScriptId] = useState(""),
    [duration, setDuration] = useState(result.basis.episode.durationSeconds);
  const [novelMode, setNovelMode] = useState<"inherit" | "independent">(
      "inherit",
    ),
    [narrative, setNarrative] = useState<NarrativeContextRequest>({
      format: "narrative-context-v1",
      chapters: [],
    });
  const [reviewed, setReviewed] = useState<boolean[]>(reviews.map(() => false));
  const [outlinePending, setOutlinePending] = useState(false);
  const [draftOwners, setDraftOwners] = useState<unknown>();
  useEffect(() => {
    try {
      if (!outlineRef)
        throw new Error("原正式大纲引用缺失，不能创建或恢复来源确认。");
      const original = readSourceRevisionRecovery(localStorage, binding);
      setRecovery(original);
      setStorageError(undefined);
      if (original) setOpened(true);
    } catch (cause) {
      setStorageError(message(cause));
    }
    // The parent keys this panel by the precise original result/revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.id, result.version, requestedId]);
  const options = {
    ...CURRENT_OWNER_READ_OPTIONS,
    refetchOnWindowFocus: false,
    refetchInterval: opened ? 5000 : (false as const),
  };
  const originalQuery = useQuery({
    ...options,
    queryKey: [
      "source-confirm-original",
      result.projectId,
      result.id,
      result.version,
    ],
    enabled: opened,
    queryFn: async () => {
      const value = await client.episodeDevelopments.get(result.id);
      if (
        value.projectId !== result.projectId ||
        value.episodeId !== result.episodeId ||
        value.version !== result.version ||
        value.operation !== "episode-script" ||
        value.scriptId !== result.scriptId ||
        !sameFrozenOwnerSnapshot(value.basis.request.outline, outlineRef)
      )
        throw new Error("原正式剧本身份未核全，不读取其他成果。");
      return value;
    },
  });
  const outlineQuery = useQuery({
    ...options,
    queryKey: ["source-confirm-outline", result.projectId, outlineRef],
    enabled: opened && Boolean(outlineRef),
    queryFn: async () => {
      const value = await client.episodeDevelopments.get(outlineRef!.id);
      if (
        value.projectId !== result.projectId ||
        value.episodeId !== result.episodeId ||
        value.version !== outlineRef!.version ||
        value.content.kind !== "episode-outline"
      )
        throw new Error("原正式大纲身份未核全，不替换为最新大纲。");
      return value;
    },
  });
  const documentQuery = useQuery({
    ...options,
    queryKey: ["source-confirm-document", result.projectId, result.scriptId],
    enabled: opened && Boolean(result.scriptId),
    queryFn: async () => {
      const value = await client.screenplays.get(result.scriptId!);
      if (
        value.projectId !== result.projectId ||
        value.scriptId !== result.scriptId
      )
        throw new Error("实际保存文档归属不符，不初始化或重新解析稿件。");
      return value;
    },
  });
  const catalogQuery = useQuery({
    ...options,
    queryKey: ["source-confirm-catalog", result.projectId],
    enabled: opened,
    queryFn: async () => {
      const value = await client.episodeDevelopments.sources(result.projectId);
      if (value.projectId !== result.projectId)
        throw new Error("当前来源目录项目不符。");
      return value;
    },
  });
  const revisionQuery = useQuery({
    ...options,
    queryKey: [
      "source-confirm-preview",
      result.projectId,
      result.id,
      requestedId,
    ],
    enabled: opened && Boolean(requestedId),
    queryFn: async () => {
      const value = await client.episodeDevelopments.getSourceRevision(
        requestedId!,
      );
      if (
        !readExactSourceRevision(
          { data: value, status: "success", isFetchedAfterMount: true },
          { ...binding, id: requestedId! },
        )
      )
        throw new Error("指定来源预览不属于完整原双头，不转到其他 AI 草稿。");
      return value;
    },
  });
  const original = currentOwnerQuery(originalQuery).data,
    outline = currentOwnerQuery(outlineQuery).data,
    document = currentOwnerQuery(documentQuery).data,
    catalog = currentOwnerQuery(catalogQuery).data;
  const queries = [
    originalQuery,
    outlineQuery,
    documentQuery,
    catalogQuery,
    ...(requestedId ? [revisionQuery] : []),
  ];
  const readError = queries.find((query) => query.error)?.error;
  const ownersReady = Boolean(
    original && outline && document && catalog && !readError,
  );
  const value =
    ownersReady && requestedId
      ? readExactSourceRevision(revisionQuery, { ...binding, id: requestedId })
      : undefined;
  const sourceContextQuery = useQuery({
    ...options,
    queryKey: [
      "source-confirm-context",
      result.projectId,
      requestedId,
      value?.stateVersion,
      value?.status,
      value?.sourceSnapshotId,
      value?.sourceBasisHash,
      value?.sourceManifestHash,
      value?.sourcePromptHash,
    ],
    enabled: opened && Boolean(value && value.sourceState === "current"),
    queryFn: () => {
      if (!value) throw new Error("本次完整原预览尚未读取，不请求来源正文。");
      return client.episodeDevelopments.getSourceRevisionContext(value);
    },
  });
  const sourceContext =
    value?.sourceState === "current"
      ? currentOwnerQuery(sourceContextQuery).data
      : undefined;
  const reading =
    queries.some((query) => query.isFetching) || sourceContextQuery.isFetching;
  const reviewFrame =
    value && ownersReady
      ? JSON.stringify({
          value,
          sourceContext,
          document,
          original,
          outline,
          catalog,
        })
      : "";
  useEffect(() => {
    setReviewed(reviews.map(() => false));
  }, [reviewFrame]);
  const scope =
    catalog?.narrativeSourceScope ?? catalog?.narrativeSources?.chapters;
  const chaptersQuery = useQuery({
    ...options,
    queryKey: ["source-confirm-chapters", result.projectId, scope],
    enabled:
      opened &&
      !result.basis.request.direct &&
      novelMode === "independent" &&
      Boolean(scope),
    queryFn: async () => {
      if (!scope) throw new Error("当前季纲实际范围未核全。");
      const rows = await client.chapters.list(result.projectId);
      return scope.map((ref) => {
        const matching = rows.filter(
          (row) =>
            row.id === ref.id &&
            row.projectId === result.projectId &&
            row.version === ref.version,
        );
        if (matching.length !== 1)
          throw new Error("当前范围的实际章节版本未核全，不切最新原文。");
        return matching[0]!;
      });
    },
  });
  const chapters = currentOwnerQuery(chaptersQuery).data;
  const independentNovel =
    !result.basis.request.direct && novelMode === "independent";
  const selectionReady =
    !independentNovel ||
    Boolean(chapters && !chaptersQuery.isFetching && !chaptersQuery.error);
  const ownerFrame =
    ownersReady && selectionReady
      ? {
          original,
          outline,
          document,
          catalog,
          selection: { sourceScriptId, duration, novelMode, narrative },
          ...(independentNovel ? { chapters } : {}),
        }
      : undefined;
  const draftCurrent = Boolean(
    draft && sameFrozenOwnerSnapshot(ownerFrame, draftOwners),
  );
  const frozen =
    busy ||
    reading ||
    (independentNovel && chaptersQuery.isFetching) ||
    !ownersReady ||
    Boolean(storageError || recovery);
  const start = () => {
    try {
      if (
        frozen ||
        !selectionReady ||
        !original?.isCurrent ||
        !outline?.isCurrent ||
        outline.content.kind !== "episode-outline" ||
        !document ||
        !catalog ||
        original.content.kind !== "episode-script"
      )
        throw new Error("须先读取当前原正式双头和实际文档，再明确选择新来源。");
      const request = newSourceRevisionRequest(original, catalog, {
        sourceScriptId: sourceScriptId || undefined,
        durationSeconds: duration,
        novelMode,
        narrative,
      });
      // The strict input validator checks this request before a draft exists.
      const next: EpisodeSourceRevisionInput = {
        sourceVersion: original.version,
        outline: outlineRef!,
        documentVersion: document.version,
        request,
        tokenBudget: 60_000,
        outlineContent: structuredClone(outline.content.value),
        sceneLinks: sourceRevisionSceneLinks(document, original.content.value),
      };
      setDraft(next);
      setDraftOwners(structuredClone(ownerFrame));
      setReviewed(reviews.map(() => false));
      setError(undefined);
    } catch (cause) {
      setError(message(cause));
    }
  };
  const change = (work: (next: EpisodeSourceRevisionInput) => void) => {
    if (!draft || frozen) return;
    const next = structuredClone(draft);
    work(next);
    setDraft(next);
  };
  const perform = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (cause) {
      if (mounted.current) setError(message(cause));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const sendOriginal = async (pending: SourceRevisionRecovery) => {
    const stored = readSourceRevisionRecovery(localStorage, binding);
    if (!sameFrozenOwnerSnapshot(stored, pending))
      throw new Error("原恢复记录已变化；未发送另一笔请求。");
    const response =
      pending.action === "preview"
        ? await client.episodeDevelopments.previewSourceRevision(
            pending.sourceScript.id,
            pending.input,
            pending.key,
          )
        : pending.action === "adopt"
          ? await client.episodeDevelopments.adoptSourceRevision(
              pending.id,
              pending.stateVersion,
              pending.confirmation,
              pending.key,
            )
          : await client.episodeDevelopments.discardSourceRevision(
              pending.id,
              pending.stateVersion,
              pending.key,
            );
    verifySourceRevisionRecoveryReply(response, pending);
    clearSourceRevisionRecovery(localStorage, pending);
    if (!mounted.current) return;
    setRecovery(undefined);
    setDraft(undefined);
    const next = new URLSearchParams();
    next.set("resultId", pending.sourceScript.id);
    next.set("episodeId", pending.episodeId);
    next.set("operation", "episode-script");
    next.set("sourceRevisionId", response.id);
    setParams(next);
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["source-confirm-preview"] }),
      cache.invalidateQueries({ queryKey: ["episode-development"] }),
      cache.invalidateQueries({ queryKey: ["episode-development-sources"] }),
      cache.invalidateQueries({ queryKey: ["pending-confirmations"] }),
    ]);
  };
  const persistAndSend = async (pending: SourceRevisionRecovery) => {
    let saved: SourceRevisionRecovery;
    try {
      saved = saveSourceRevisionRecovery(localStorage, pending);
    } catch {
      throw new Error(
        "本机原请求未可靠保存；未发送请求，原审阅草稿保留。请检查存储空间／权限或另一窗口的恢复记录，再明确提交。",
      );
    }
    setRecovery(saved);
    await sendOriginal(saved);
  };
  const base = () => {
    if (!document) throw new Error("实际文档尚未读取。");
    return {
      ...binding,
      format: "author-source-revision-request-v1" as const,
      document: {
        id: document.id,
        scriptId: document.scriptId,
        version: document.version,
      },
      key: crypto.randomUUID(),
      savedAt: new Date().toISOString(),
    };
  };
  const decide = (action: "adopt" | "discard") =>
    perform(async () => {
      if (
        frozen ||
        !value ||
        value.status !== "pending" ||
        (action === "adopt" &&
          (value.sourceState !== "current" || !reviewed.every(Boolean)))
      )
        throw new Error("本次来源读取或审阅不完整，未提交决定。");
      if (action === "adopt" && (!sourceContext || sourceContextQuery.error))
        throw new Error("本次完整来源正文尚未可靠读取，未提交采用。");
      if (
        !(await confirmDialog({
          title:
            action === "adopt"
              ? "确认新来源与两份新正式成果？"
              : "撤回此来源预览？",
          description:
            action === "adopt"
              ? "保留实际原稿与旧采用历史，只提交这份明确新来源。不会运行模型或自动重做分镜；人工声明不证明语义、质量或授权。"
              : "只撤回此原预览，不修改原稿或原正式成果。",
        }))
      )
        return;
      const envelope = {
        ...base(),
        document: value.document,
        id: value.id,
        stateVersion: value.stateVersion,
      };
      await persistAndSend(
        action === "adopt"
          ? {
              ...envelope,
              action,
              confirmation: Object.fromEntries(
                reviews.map(({ key }) => [key, true]),
              ) as EpisodeSourceRevisionConfirmation,
            }
          : { ...envelope, action },
      );
    });
  return (
    <section
      aria-label="新来源正式确认"
      className="space-y-3 rounded border border-line p-3 text-sm"
    >
      <Button variant="secondary" onClick={() => setOpened(!opened)}>
        {opened ? "收起新来源正式确认" : "新来源正式确认"}
      </Button>
      {opened && (
        <>
          <p className="text-muted">
            上游实际变化后，明确选择新来源、审阅完整大纲与实际原稿，再独立采用两份新正式成果。本操作不生成正文、模型任务或分镜；不强迫小说或媒体，不清除旧来源失效原因。
          </p>
          <p className="break-all">
            原剧本 {result.id} v{result.version} · 原大纲{" "}
            {outlineRef?.id ?? "缺失"} v{outlineRef?.version ?? "未知"}
          </p>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void Promise.all([
                ...queries.map((query) => query.refetch()),
                ...(independentNovel ? [chaptersQuery.refetch()] : []),
                ...(value?.sourceState === "current"
                  ? [sourceContextQuery.refetch()]
                  : []),
              ])
            }
          >
            重读原成果、实际文档与来源
          </Button>
          {(reading || (independentNovel && chaptersQuery.isFetching)) && (
            <p role="status">
              正在读取本次实际状态；操作暂时冻结，不把首次缓存当作来源。
            </p>
          )}
          {(error || storageError || readError) && (
            <p role="alert" className="text-error">
              {error ||
                storageError ||
                `本次来源读取失败：${message(readError)}。未使用缓存继续确认。`}
            </p>
          )}
          {recovery && (
            <section
              aria-label="来源确认原请求恢复"
              className="space-y-2 rounded border border-warning p-3"
            >
              <p>
                存在尚未收取可靠回复的原
                {recovery.action === "preview"
                  ? "预览"
                  : recovery.action === "adopt"
                    ? "采用"
                    : "撤回"}
                请求。新请求冻结；只重放完整原输入／原状态／原审阅和同一键，不换来源。
              </p>
              <p className="break-all">
                原键 {recovery.key} · 保存于 {recovery.savedAt}
              </p>
              <details>
                <summary>查看完整原请求（含本机稿件，不外发模型）</summary>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(recovery, null, 2)}
                </pre>
              </details>
              <Button
                disabled={
                  busy || reading || !ownersReady || Boolean(storageError)
                }
                onClick={() =>
                  void perform(async () => {
                    if (
                      !(await confirmDialog({
                        title: "重放完整原请求？",
                        description:
                          "此前服务端可能已完成，只查询／重放同一笔请求；原五项审阅不应用于其他预览。",
                      }))
                    )
                      return;
                    await sendOriginal(recovery);
                  })
                }
              >
                重放原键与原输入
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    if (
                      !(await confirmDialog({
                        title: "解除本机原请求恢复记录？",
                        description:
                          "只清除这笔本机记录；不会撤回、删除或否认服务端可能已存在的预览／决定。可从待确认中心找回真实记录。",
                      }))
                    )
                      return;
                    clearSourceRevisionRecovery(localStorage, recovery);
                    setRecovery(undefined);
                  })
                }
              >
                只解除本机恢复记录
              </Button>
            </section>
          )}
          {!requestedId && ownersReady && (
            <>
              {catalog?.direct ? (
                <div className="space-y-2">
                  <p>
                    当前{" "}
                    {catalog.direct.entryPath === "script"
                      ? "已有剧本"
                      : "独立创意"}{" "}
                    来源：项目 v{catalog.direct.project.version} · 作者意图{" "}
                    {catalog.direct.authorIntent?.id ?? "未正式采用"} v
                    {catalog.direct.authorIntent?.version ?? "未知"}
                  </p>
                  <label>
                    明确实际剧本来源
                    <select
                      aria-label="新来源实际剧本"
                      className={inputClass}
                      disabled={frozen}
                      value={sourceScriptId}
                      onChange={(event) =>
                        setSourceScriptId(event.target.value)
                      }
                    >
                      <option value="">
                        {catalog.direct.entryPath === "script"
                          ? "请选择原分集的实际剧本"
                          : "不使用额外原剧本来源"}
                      </option>
                      {catalog.direct.episodes
                        .find((item) => item.id === result.episodeId)
                        ?.scripts.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.title} · {item.id} v{item.version} / 文档 v
                            {item.documentVersion ?? "未保存"}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    本集明确时长（秒）
                    <input
                      aria-label="新来源时长"
                      type="number"
                      min={30}
                      max={1800}
                      className={inputClass}
                      disabled={frozen}
                      value={duration}
                      onChange={(event) =>
                        setDuration(Number(event.target.value))
                      }
                    />
                  </label>
                </div>
              ) : (
                <div className="space-y-2">
                  <p>
                    当前季纲 {catalog?.seasonPlan?.id ?? "未采用"} v
                    {catalog?.seasonPlan?.version ?? "未知"}；只保留原分集{" "}
                    {result.episodeId}，不切首集。
                  </p>
                  <label>
                    本集实际表达
                    <select
                      aria-label="新来源小说表达模式"
                      className={inputClass}
                      disabled={frozen}
                      value={novelMode}
                      onChange={(event) =>
                        setNovelMode(
                          event.target.value as "inherit" | "independent",
                        )
                      }
                    >
                      <option value="inherit">
                        明确继承这份季纲的实际来源
                      </option>
                      <option value="independent">
                        本集独立选择实际原文／摘要／段落
                      </option>
                    </select>
                  </label>
                  {novelMode === "independent" && (
                    <>
                      {chaptersQuery.error && (
                        <p role="alert">{message(chaptersQuery.error)}</p>
                      )}
                      <NovelContextPicker
                        purpose="production"
                        scope={{
                          projectId: result.projectId,
                          title: "新来源本集实际表达",
                        }}
                        chapters={chapters ?? []}
                        request={narrative}
                        disabled={
                          frozen || chaptersQuery.isFetching || !chapters
                        }
                        onChange={setNarrative}
                      />
                    </>
                  )}
                </div>
              )}
              <Button
                disabled={
                  frozen ||
                  !original?.isCurrent ||
                  !outline?.isCurrent ||
                  (novelMode === "independent" &&
                    !catalog?.direct &&
                    (!chapters ||
                      chaptersQuery.isFetching ||
                      Boolean(chaptersQuery.error)))
                }
                onClick={start}
              >
                明确新来源，准备完整审阅草稿
              </Button>
            </>
          )}
          {draft && !requestedId && (
            <section aria-label="新来源完整审阅草稿" className="space-y-3">
              <p>
                本机审阅草稿，不是服务端预览。来源引用不会自动换版；你可以编辑全部大纲、引用／原引文和实际场景映射。
              </p>
              {!draftCurrent && (
                <p role="alert">
                  原正式成果／实际文档／来源或当前选择已变化、尚未核全或读取失败；保留本机草稿，不能创建预览。请重读后明确重新准备并核对，不自动刷新引用。
                </p>
              )}
              <details>
                <summary>完整明确新来源请求</summary>
                <pre className="overflow-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(draft.request, null, 2)}
                </pre>
              </details>
              <Button
                variant="secondary"
                disabled={frozen || !draftCurrent || outlinePending}
                onClick={() =>
                  change((next) => {
                    if (catalog)
                      next.outlineContent = rebindSameSelectedSourceVersions(
                        next.outlineContent,
                        next.request,
                        catalog,
                      );
                  })
                }
              >
                明确更新所选同一来源 ID 的场景引用版本
              </Button>
              <p className="text-muted">
                只更新你已选的同一来源
                ID；不替换来源、引用路径、原引文或位置。更换季纲／摘要身份须在完整引用中明确编辑；逐字不匹配仍由服务端拒绝。
              </p>
              <SourceOutlineEditor
                outline={draft.outlineContent}
                disabled={frozen}
                onDirty={setOutlinePending}
                change={(work) => change((next) => work(next.outlineContent))}
              />
              {outlinePending && (
                <p role="alert">
                  存在尚未应用的大纲／引用编辑；请逐项应用或还原后再创建预览，不能把屏幕上的新文本忽略成旧请求。
                </p>
              )}
              <label>
                完整本地上下文预算（估算 token）
                <input
                  aria-label="新来源完整预算"
                  type="number"
                  min={128}
                  max={1_000_000}
                  className={inputClass}
                  disabled={frozen}
                  value={draft.tokenBudget}
                  onChange={(event) =>
                    change((next) => {
                      next.tokenBudget = Number(event.target.value);
                    })
                  }
                />
              </label>
              <section aria-label="实际文档场景映射" className="space-y-2">
                {draft.sceneLinks.map((link, index) => (
                  <label key={link.blockIds[0]} className="block">
                    实际场景 {index + 1} · 稳定块 {link.blockIds[0]}（
                    {link.blockIds.length} 块）
                    <select
                      aria-label={`新来源场景映射 ${index + 1}`}
                      className={inputClass}
                      disabled={frozen}
                      value={link.sceneId}
                      onChange={(event) =>
                        change((next) => {
                          next.sceneLinks[index]!.sceneId = event.target.value;
                        })
                      }
                    >
                      <option value="">明确选择新大纲场景</option>
                      {draft.outlineContent.scenes.map((scene) => (
                        <option key={scene.id} value={scene.id}>
                          {scene.id} · {scene.location} · {scene.goal}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </section>
              <Button
                disabled={frozen || !draftCurrent || outlinePending}
                onClick={() =>
                  void perform(async () => {
                    const input = EpisodeSourceRevisionInputSchema.parse(draft);
                    await persistAndSend({
                      ...base(),
                      action: "preview",
                      input,
                    });
                  })
                }
              >
                创建完整新来源预览（不调用模型）
              </Button>
            </section>
          )}
          {ownersReady && document && (
            <details>
              <summary>
                实际保存原稿 v{document.version}（只读，不改写）
              </summary>
              <div className="max-h-96 space-y-2 overflow-auto">
                {document.blocks.map((block) => (
                  <p key={block.id} className="whitespace-pre-wrap break-all">
                    <span className="text-muted">
                      {block.type} · {block.id}
                    </span>
                    <br />
                    {"text" in block ? block.text : "分页"}
                  </p>
                ))}
              </div>
            </details>
          )}
          {value && (
            <section aria-label="本次读取的新来源预览" className="space-y-3">
              <p className="break-all">
                原预览 {value.id} · 状态 {value.status} v{value.stateVersion} ·
                来源 {value.sourceState}
              </p>
              <p>
                完整冻结来源 {value.sourceSnapshotId}；内容／来源／Prompt
                哈希已由正式 owner 核对。规则逐字核验不等于语义正确。
              </p>
              <details>
                <summary>本次完整来源、覆盖与冻结引用</summary>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(value.outlineBasis, null, 2)}
                </pre>
              </details>
              {sourceContextQuery.error && (
                <p role="alert">
                  本次完整来源正文读取失败：{message(sourceContextQuery.error)}
                  。 未使用旧正文缓存，审阅声明已重置，不能采用。
                </p>
              )}
              {value.sourceState === "current" &&
                !sourceContext &&
                !sourceContextQuery.error && (
                  <p role="status">
                    完整实际来源正文尚未可靠读取；不能作出来源审阅或采用。
                  </p>
                )}
              {sourceContext && (
                <section
                  aria-label="本次完整实际来源正文"
                  className="space-y-3 rounded border border-line p-3"
                >
                  <p>
                    以下 {sourceContext.entries.length}{" "}
                    项是本次明确选择的全部实际表达， 顺序、身份、版本和逐项正文
                    SHA 已核对。摘要／段落不是整章；
                    不展示未选正文、禁止依赖的旧正文或完整 Prompt。
                  </p>
                  {sourceContext.entries.map((entry) => (
                    <details
                      key={JSON.stringify([
                        entry.sourceKind,
                        entry.sourceId,
                        entry.sourceVersion,
                        entry.fieldPath,
                      ])}
                    >
                      <summary className="break-all">
                        {entry.sourceKind} · {entry.sourceId} v
                        {entry.sourceVersion} · {entry.fieldPath}
                      </summary>
                      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all">
                        {typeof entry.value === "string"
                          ? entry.value
                          : JSON.stringify(entry.value, null, 2)}
                      </pre>
                      <p className="break-all text-xs text-muted">
                        正文 SHA-256 {entry.contentHash}
                      </p>
                    </details>
                  ))}
                </section>
              )}
              <SourceOutlineEditor
                key={value.id}
                outline={value.outlineContent}
                disabled
                change={() => {}}
              />
              <details>
                <summary>完整保留原稿与场景映射</summary>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(value.scriptContent, null, 2)}
                </pre>
              </details>
              {value.sourceState === "stale" && (
                <p role="alert">
                  {value.staleReasons.join("；")}
                  。不能采用这份预览，不自动替换来源。
                </p>
              )}
              {value.status === "pending" && (
                <>
                  {reviews.map(({ key, label }, index) => (
                    <label key={key} className="flex items-start gap-2">
                      <input
                        aria-label={label}
                        type="checkbox"
                        disabled={
                          frozen ||
                          value.sourceState !== "current" ||
                          !sourceContext ||
                          Boolean(sourceContextQuery.error)
                        }
                        checked={reviewed[index] ?? false}
                        onChange={(event) =>
                          setReviewed((previous) =>
                            previous.map((item, at) =>
                              at === index ? event.target.checked : item,
                            ),
                          )
                        }
                      />
                      {label}
                    </label>
                  ))}
                  <Button
                    disabled={
                      frozen ||
                      value.sourceState !== "current" ||
                      !sourceContext ||
                      Boolean(sourceContextQuery.error) ||
                      !reviewed.every(Boolean)
                    }
                    onClick={() => void decide("adopt")}
                  >
                    独立采用新来源与两份正式成果
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={frozen}
                    onClick={() => void decide("discard")}
                  >
                    撤回这份来源预览
                  </Button>
                </>
              )}
              {value.results && (
                <p>
                  已建立新的独立正式成果；原稿与原采用历史保留。
                  <Link
                    className="text-link"
                    to={`/projects/${encodeURIComponent(value.projectId)}/tools/episode-development?episodeId=${encodeURIComponent(value.episodeId)}&operation=episode-script&resultId=${encodeURIComponent(value.results.script.id)}`}
                  >
                    查看本次新正式剧本
                  </Link>
                  ；不会自动重做分镜。
                </p>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}

function JsonField<T>({
  label,
  value,
  disabled,
  change,
  onPending,
}: {
  label: string;
  value: T;
  disabled: boolean;
  change(value: T): void;
  onPending?(label: string, pending: boolean): void;
}) {
  const serialized = JSON.stringify(value, null, 2),
    [text, setText] = useState(serialized),
    [error, setError] = useState<string>();
  useEffect(() => {
    setText(serialized);
    setError(undefined);
    onPending?.(label, false);
  }, [serialized, label]);
  return (
    <label className="block">
      {label}
      <textarea
        aria-label={label}
        className={`${inputClass} min-h-24 font-mono`}
        disabled={disabled}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setError(undefined);
          onPending?.(label, event.target.value !== serialized);
        }}
      />
      {error && <span role="alert">{error}</span>}
      {!disabled && (
        <Button
          variant="ghost"
          onClick={() => {
            try {
              change(JSON.parse(text) as T);
              setError(undefined);
              onPending?.(label, false);
            } catch {
              setError("格式或完整大纲约束不符；未应用，不丢弃旧来源。");
            }
          }}
        >
          应用{label}
        </Button>
      )}
    </label>
  );
}
function SourceOutlineEditor({
  outline,
  disabled,
  change,
  onDirty,
}: {
  outline: EpisodeOutlineContent;
  disabled: boolean;
  change(work: (next: EpisodeOutlineContent) => void): void;
  onDirty?(dirty: boolean): void;
}) {
  const [pending, setPending] = useState<Set<string>>(new Set());
  const onPending = (label: string, dirty: boolean) =>
    setPending((previous) => {
      if (previous.has(label) === dirty) return previous;
      const next = new Set(previous);
      if (dirty) next.add(label);
      else next.delete(label);
      return next;
    });
  useEffect(() => {
    onDirty?.(pending.size > 0);
  }, [pending, onDirty]);
  const fields = {
    title: "标题",
    logline: "一句话故事",
    goal: "本集目标",
    mainConflict: "主冲突",
    turningPoint: "转折",
    endingHook: "结尾钩子",
  } as const;
  return (
    <section aria-label="完整新来源大纲" className="space-y-3">
      {Object.entries(fields).map(([key, label]) => (
        <label key={key} className="block">
          {label}
          <textarea
            aria-label={`新来源大纲${label}`}
            className={inputClass}
            disabled={disabled}
            value={outline[key as keyof typeof fields]}
            onChange={(event) =>
              change((next) => {
                next[key as keyof typeof fields] = event.target.value;
              })
            }
          />
        </label>
      ))}
      {outline.scenes.map((scene, index) => (
        <fieldset
          key={scene.id}
          className="space-y-2 rounded border border-line p-3"
        >
          <legend>
            场景 {index + 1} · {scene.id}
          </legend>
          {(
            ["location", "timeOfDay", "goal", "conflict", "outcome"] as const
          ).map((key) => (
            <label key={key} className="block">
              {
                {
                  location: "地点",
                  timeOfDay: "时间",
                  goal: "场景目标",
                  conflict: "场景冲突",
                  outcome: "场景结果",
                }[key]
              }
              <textarea
                aria-label={`场景 ${scene.id} ${key}`}
                className={inputClass}
                disabled={disabled}
                value={scene[key]}
                onChange={(event) =>
                  change((next) => {
                    next.scenes[index]![key] = event.target.value;
                  })
                }
              />
            </label>
          ))}
          <label>
            时长（秒）
            <input
              type="number"
              min={1}
              max={1800}
              aria-label={`场景 ${scene.id} 时长`}
              className={inputClass}
              disabled={disabled}
              value={scene.durationSeconds}
              onChange={(event) =>
                change((next) => {
                  next.scenes[index]!.durationSeconds = Number(
                    event.target.value,
                  );
                })
              }
            />
          </label>
          <JsonField
            onPending={onPending}
            label={`场景 ${scene.id} 角色`}
            value={scene.characters}
            disabled={disabled}
            change={(characters) =>
              change((next) => {
                next.scenes[index]!.characters = characters;
              })
            }
          />
          <JsonField
            onPending={onPending}
            label={`场景 ${scene.id} 完整节拍`}
            value={scene.beats}
            disabled={disabled}
            change={(beats) =>
              change((next) => {
                next.scenes[index]!.beats = beats;
              })
            }
          />
          <JsonField
            onPending={onPending}
            label={`场景 ${scene.id} 章节引用`}
            value={scene.sourceChapters}
            disabled={disabled}
            change={(refs) =>
              change((next) => {
                next.scenes[index]!.sourceChapters = refs;
              })
            }
          />
          <JsonField
            onPending={onPending}
            label={`场景 ${scene.id} 直写来源引用`}
            value={scene.sourceReferences ?? []}
            disabled={disabled}
            change={(refs) =>
              change((next) => {
                if (refs.length) next.scenes[index]!.sourceReferences = refs;
                else delete next.scenes[index]!.sourceReferences;
              })
            }
          />
          <JsonField
            onPending={onPending}
            label={`场景 ${scene.id} 完整原引文声明`}
            value={scene.sourceEvidence ?? []}
            disabled={disabled}
            change={(evidence) =>
              change((next) => {
                if (evidence.length)
                  next.scenes[index]!.sourceEvidence = evidence;
                else delete next.scenes[index]!.sourceEvidence;
              })
            }
          />
        </fieldset>
      ))}
      <details>
        <summary>增删／重排场景及完整引用的高级编辑</summary>
        <p>
          应用前核完整结构；实际原稿不变，每个场景仍须明确映射，不自动补引用或寻找新引文位置。
        </p>
        <JsonField
          onPending={onPending}
          label="完整大纲结构"
          value={outline}
          disabled={disabled}
          change={(next) => {
            const parsed = EpisodeOutlineContentSchema.parse(next);
            change((current) => Object.assign(current, parsed));
          }}
        />
      </details>
    </section>
  );
}
