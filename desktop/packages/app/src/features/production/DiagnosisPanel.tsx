import {
  currentOwnerQuery,
  CURRENT_OWNER_READ_OPTIONS,
  exactNavigationError,
  sameFrozenOwnerSnapshot,
} from "../../current-owner-read";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Button, confirmDialog, NativeSelect } from "@dramaip/ui-shared";
import {
  DiagnosisRequestSchema,
  type DiagnosisRequest,
  type AdaptationDiagnosis,
} from "@dramaip/contracts/production";
import { useStudio, message } from "../../studio-shared";
import { CreationWorkbench } from "../creation-workbench";
import { NovelContextPicker } from "../novel/NovelContextPicker";
import { NarrativeSourceCoverage } from "../NarrativeSourceCoverage";
import {
  matchesExactCreationWorkflow,
  matchesExactStageCandidate,
  resolveStageCandidateId,
} from "../../exact-object-navigation";
import type { NarrativeContextRequest } from "@dramaip/contracts/creation";

export function DiagnosisPanel({ projectId }: { projectId: string }) {
  const client = useStudio();
  const queries = useQueryClient();
  const [params, setParams] = useSearchParams();
  const navigationError = exactNavigationError(params, [
    "workflowId",
    "diagnosisId",
  ]);
  const workflowId = params.get("workflowId") ?? undefined;
  const requestedId = params.get("diagnosisId") ?? undefined;
  const draftKey = `dramaip-diagnosis-scope:${projectId}`;
  const [draftRequest, setRequest] = useState<DiagnosisRequest | undefined>(
    () => {
      try {
        const parsed = DiagnosisRequestSchema.safeParse(
          JSON.parse(window.localStorage.getItem(draftKey) ?? "null"),
        );
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },
  );
  const [selected, setSelected] = useState<string[]>(
    draftRequest?.chapters.map((item) => item.id) ?? [],
  );
  const [mixed, setMixed] = useState(Boolean(draftRequest?.context));
  const [context, setContext] = useState<NarrativeContextRequest>(
    draftRequest?.context ?? { format: "narrative-context-v1", chapters: [] },
  );
  const [rights, setRights] = useState(draftRequest?.rightsDeclared ?? false);
  const [scope, setScope] = useState<DiagnosisRequest["scope"]>(
    draftRequest?.scope ?? "selected-chapters",
  );
  const [target, setTarget] = useState<DiagnosisRequest["target"]>(
    draftRequest?.target ?? {
      format: "short-drama",
      episodeCount: 12,
      durationSeconds: 90,
    },
  );
  const [focused, setFocused] = useState<string | undefined>(
    params.get("diagnosisId") ?? undefined,
  );
  const [choice, setChoice] = useState<{ id: string; strategy: string }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const keys = useRef(new Map<string, string>());
  const original = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["creation-workflow", projectId, workflowId],
      queryFn: () => client.creation.get(workflowId!),
      enabled: Boolean(workflowId) && !navigationError,
      refetchInterval: 1500,
    }),
  );
  const validWorkflow =
    !navigationError &&
    workflowId &&
    matchesExactCreationWorkflow(original.data, {
      projectId,
      workflowId,
      operation: "adaptation-diagnosis",
    }) &&
    original.data.input.diagnosisRequest
      ? original.data
      : undefined;
  const request = workflowId
    ? validWorkflow?.input.diagnosisRequest
    : draftRequest;
  const catalog = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["diagnosis-sources", projectId],
      queryFn: () => client.diagnoses.sources(projectId),
      refetchInterval: 2000,
    }),
  );
  const expressionChapters = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["diagnosis-expression-chapters", projectId],
      queryFn: () => client.chapters.list(projectId),
      enabled: mixed,
    }),
  );
  useEffect(() => {
    void queries.invalidateQueries({
      queryKey: ["diagnosis-expression-chapters", projectId],
    });
  }, [queries, projectId, catalog.data?.inventoryFingerprint]);
  const history = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["diagnoses", projectId],
      refetchInterval: 1500,
      queryFn: async () => {
        const items: AdaptationDiagnosis[] = [];
        const cursors = new Set<string>();
        const identities = new Set<string>();
        let cursor: string | undefined;
        do {
          const page = await client.diagnoses.list(projectId, cursor, 100);
          for (const item of page.items) {
            if (item.projectId !== projectId || identities.has(item.id))
              throw new Error("历史归属或完整分页无法核对。");
            identities.add(item.id);
            items.push(item);
          }
          cursor = page.nextCursor;
          if (cursor && cursors.has(cursor))
            throw new Error("诊断历史游标重复，尚未核全。");
          if (cursor) cursors.add(cursor);
        } while (cursor);
        return items;
      },
    }),
  );
  const id = navigationError
    ? undefined
    : resolveStageCandidateId({
        requestedId,
        requestedWorkflowId: workflowId,
        workflowCandidateId: validWorkflow?.diagnosisId,
        focusedId: focused,
        latestId: history.data?.[0]?.id,
      });
  const candidate = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["diagnosis", projectId, id],
      queryFn: () => client.diagnoses.get(id!),
      enabled: Boolean(id),
      refetchInterval: 1500,
    }),
  );
  const value =
    matchesExactStageCandidate(candidate.data, {
      projectId,
      candidateId: id,
      workflowId,
    }) &&
    (!workflowId ||
      (validWorkflow?.diagnosisId === candidate.data.id &&
        sameFrozenOwnerSnapshot(
          validWorkflow.diagnosisBasis,
          candidate.data.basis,
        )))
      ? candidate.data
      : undefined;
  const exactMismatch = Boolean(
    navigationError ||
    (workflowId && (original.error || (original.data && !validWorkflow))) ||
    candidate.error ||
    (candidate.data && !value),
  );
  const strategyId = choice?.id === value?.id ? choice?.strategy : undefined;
  const accepted = history.data?.find((item) => item.isCurrent);
  const refresh = () =>
    Promise.all([
      queries.invalidateQueries({ queryKey: ["diagnoses", projectId] }),
      queries.invalidateQueries({ queryKey: ["diagnosis"] }),
      queries.invalidateQueries({ queryKey: ["diagnosis-sources", projectId] }),
      queries.invalidateQueries({ queryKey: ["creation-workflow"] }),
      queries.invalidateQueries({ queryKey: ["change-preview"] }),
    ]);
  const confirmSources = () => {
    try {
      const available = catalog.data;
      if (!available?.authorIntent)
        throw new Error("请先明确采用正式作者意图。");
      const input = DiagnosisRequestSchema.parse({
        scope,
        chapters: available.chapters
          .filter((item) => selected.includes(item.id))
          .map(({ id, version }) => ({ id, version })),
        inventoryFingerprint: available.inventoryFingerprint,
        authorIntent: available.authorIntent,
        baseAdoptedId: available.adoptedDiagnosisId,
        rightsDeclared: rights,
        target,
        ...(mixed ? { context } : {}),
      });
      if (
        scope === "whole-book" &&
        input.chapters.length !== available.chapters.length
      )
        throw new Error("全书诊断需要明确选择全部非空章节。");
      window.localStorage.setItem(draftKey, JSON.stringify(input));
      setRequest(input);
      const next = new URLSearchParams(params);
      next.delete("workflowId");
      next.delete("diagnosisId");
      setParams(next);
      setError(undefined);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.name === "ZodError"
          ? "请选择非空章节，确认来源权利声明及有效目标时长与集数。"
          : message(cause),
      );
    }
  };
  const transition = async (action: "adopt" | "discard", legacy = false) => {
    if (!value || busy || (legacy && !strategyId)) return;
    const selectedId = legacy ? strategyId : undefined;
    const chosen = value.content.strategies.find(
      (item) => item.id === selectedId,
    );
    if (
      !(await confirmDialog({
        title:
          action === "adopt"
            ? legacy
              ? "采用诊断与选定策略"
              : "采用改编诊断"
            : "放弃诊断候选",
        description:
          action === "adopt"
            ? legacy
              ? `兼容路径：采用 v${value.version} 的「${chosen?.title}」。这会替换当前诊断头，保留历史；不创建独立策略，不写入小说、季纲、剧本或媒体。`
              : `采用诊断 v${value.version} 的叙事证据与结论，保留历史。下一步单独比较独立策略；本次不选择诊断内旧策略，不写入原稿或下游内容。`
            : "只放弃此候选，不改写作者正文或已采用诊断。",
        confirmLabel:
          action === "adopt"
            ? legacy
              ? "确认采用选定策略"
              : "确认采用诊断"
            : "确认放弃",
        tone: action === "adopt" ? "default" : "danger",
      }))
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      const fingerprint = JSON.stringify([
        value.id,
        value.stateVersion,
        action,
        action === "adopt" ? selectedId : undefined,
      ]);
      const key = keys.current.get(fingerprint) ?? crypto.randomUUID();
      keys.current.set(fingerprint, key);
      if (action === "adopt")
        await client.diagnoses.adopt(
          value.id,
          value.stateVersion,
          selectedId,
          key,
        );
      else await client.diagnoses.discard(value.id, value.stateVersion, key);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
      await refresh();
    }
  };
  return (
    <section aria-label="改编诊断工作台" className="space-y-5">
      <div className="rounded-lg border border-line bg-surface p-5">
        <h2 className="font-semibold">确认本轮诊断范围</h2>
        <p className="mt-2 text-sm text-muted">
          先采用作者意图，再选择实际送入模型的章节。采用诊断后单独比较独立策略，再开发季纲与单集。未覆盖的章节不代表已读；权利声明不等于授权证明核验。
        </p>
        <p className="mt-2 text-sm">
          正式作者意图：
          {catalog.data?.authorIntent
            ? `v${catalog.data.authorIntent.version}`
            : "尚未采用"}{" "}
          ·{" "}
          <Link
            className="text-link"
            to={`/projects/${projectId}/tools/author-intent`}
          >
            核对作者意图
          </Link>
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <label>
            范围{" "}
            <NativeSelect
              className="w-auto"
              aria-label="诊断范围"
              value={scope}
              onChange={(event) => setScope(event.target.value as typeof scope)}
            >
              <option value="selected-chapters">所选章节（局部诊断）</option>
              <option value="whole-book">全书非空章节</option>
            </NativeSelect>
          </label>
          <label>
            目标形式{" "}
            <NativeSelect
              className="w-auto"
              aria-label="诊断目标形式"
              value={target.format}
              onChange={(event) =>
                setTarget({
                  ...target,
                  format: event.target.value as typeof target.format,
                })
              }
            >
              <option value="short-drama">短剧</option>
              <option value="motion-comic">漫剧</option>
            </NativeSelect>
          </label>
          <label>
            目标集数{" "}
            <input
              aria-label="诊断目标集数"
              type="number"
              min={1}
              max={120}
              value={target.episodeCount}
              onChange={(event) =>
                setTarget({
                  ...target,
                  episodeCount: Number(event.target.value),
                })
              }
              className="w-20 rounded border border-line"
            />
          </label>
          <label>
            单集秒数{" "}
            <input
              aria-label="诊断单集秒数"
              type="number"
              min={30}
              max={1800}
              value={target.durationSeconds}
              onChange={(event) =>
                setTarget({
                  ...target,
                  durationSeconds: Number(event.target.value),
                })
              }
              className="w-20 rounded border border-line"
            />
          </label>
        </div>
        <div className="mt-3 max-h-64 space-y-2 overflow-auto rounded border border-line p-3">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={!catalog.data}
              onClick={() =>
                setSelected(catalog.data!.chapters.map((item) => item.id))
              }
            >
              选择全部非空章节
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
              清空选择
            </Button>
          </div>
          {catalog.data?.chapters.map((chapter) => (
            <label key={chapter.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={`诊断来源 ${chapter.title}`}
                checked={selected.includes(chapter.id)}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? [...selected, chapter.id]
                      : selected.filter((id) => id !== chapter.id),
                  )
                }
              />
              {chapter.title} · v{chapter.version} · {chapter.characters} 字
            </label>
          ))}
          {catalog.data && !catalog.data.chapters.length && (
            <p className="text-sm text-muted">
              尚无非空章节。可以导入小说；已有剧本和小说独立创作无需经过此诊断。
            </p>
          )}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label="诊断使用明确混合表达"
            checked={mixed}
            onChange={(event) => setMixed(event.target.checked)}
          />
          诊断使用明确混合表达（范围与表达分别确认，不补整章原文）
        </label>
        {mixed && (
          <div className="mt-3">
            <NovelContextPicker
              scope={{ projectId, title: "诊断实际表达" }}
              chapters={(expressionChapters.data ?? []).filter((item) =>
                selected.includes(item.id),
              )}
              request={context}
              disabled={busy || expressionChapters.isPending}
              onChange={setContext}
            />
            {expressionChapters.error && (
              <p role="alert">
                来源表达未核全：{message(expressionChapters.error)}
              </p>
            )}
          </div>
        )}
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            aria-label="诊断来源权利声明"
            type="checkbox"
            checked={rights}
            onChange={(event) => setRights(event.target.checked)}
          />
          我声明对所选内容拥有使用和改编权利，并确认向当前模型提供这些章节。
        </label>
        <Button
          className="mt-3"
          size="sm"
          disabled={!catalog.data || busy}
          onClick={confirmSources}
        >
          确认本轮来源与版本
        </Button>
        {request && (
          <p className="mt-2 text-sm" role="status">
            已确认 {request.chapters.length} 章 ·{" "}
            {request.context ? "明确混合表达（不补全文）" : "完整章节原文"} ·
            作者意图 v{request.authorIntent.version} ·{" "}
            {request.target.episodeCount} 集 × {request.target.durationSeconds}{" "}
            秒。编辑上方选项后需再次确认；不会自动替换旧来源版本。
          </p>
        )}
        {request &&
          catalog.data?.inventoryFingerprint !==
            request.inventoryFingerprint && (
            <p role="alert" className="mt-2 text-sm text-danger-strong">
              目录已变化，生成新候选前请重新确认来源；旧候选仍保留。
            </p>
          )}
      </div>
      {(error || catalog.error || history.error || candidate.error) && (
        <p
          role="alert"
          className="rounded bg-danger-soft p-3 text-sm text-danger-strong"
        >
          {error ?? message(catalog.error ?? history.error ?? candidate.error)}
        </p>
      )}
      {(!requestedId || value) &&
        (!workflowId || validWorkflow) &&
        !exactMismatch && (
          <CreationWorkbench
            projectId={projectId}
            operation="adaptation-diagnosis"
            workflowId={workflowId}
            diagnosisRequest={request}
            externalReview
            disabled={!request || exactMismatch}
            onStarted={(workflow) => {
              const next = new URLSearchParams(params);
              next.set("workflowId", workflow.id);
              next.delete("diagnosisId");
              setParams(next);
            }}
            defaultInstruction="按本轮明确确认的实际表达与正式作者意图，给出有逐字证据的改编诊断和 2–3 个可比较策略，不把摘要或局部范围冒充全文。"
            onCandidate={(workflow) => {
              if (workflow.diagnosisId) setFocused(workflow.diagnosisId);
            }}
            onApplied={async () => {
              await refresh();
            }}
          />
        )}
      {exactMismatch && (
        <p role="alert">
          指定诊断或工作流不存在、归属／关联操作不符；不会改读最新诊断或保留上次选择。
        </p>
      )}
      {accepted && (
        <p className="rounded border border-line p-3 text-sm">
          当前采用诊断 v{accepted.version} ·{" "}
          {accepted.selectedStrategyId
            ? `兼容策略：${
                accepted.content.strategies.find(
                  (item) => item.id === accepted.selectedStrategyId,
                )?.title ?? accepted.selectedStrategyId
              }`
            : "叙事诊断已采用，独立策略另行确认"}{" "}
          ·{" "}
          {accepted.sourceState === "stale"
            ? "来源已变化，需重新诊断"
            : "来源有效"}
          {accepted.sourceState === "current" && (
            <Link
              className="ml-3 text-link"
              to={`/projects/${projectId}/tools/adaptation-strategy`}
            >
              从已采用诊断比较独立策略 →
            </Link>
          )}
          {accepted.sourceState === "current" &&
            accepted.selectedStrategyId && (
              <Link
                className="ml-3 text-link"
                to={`/projects/${projectId}/tools/season-plan`}
              >
                兼容：从诊断内策略继续整季方案 →
              </Link>
            )}
        </p>
      )}
      {history.data?.length ? (
        <nav aria-label="诊断版本历史" className="flex flex-wrap gap-2">
          {history.data.map((item) => (
            <Button
              key={item.id}
              size="sm"
              variant={item.id === id ? "primary" : "secondary"}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set("diagnosisId", item.id);
                next.set("workflowId", item.workflowId);
                setParams(next);
              }}
            >
              诊断 v{item.version} ·{" "}
              {item.status === "adopted"
                ? "已采用"
                : item.status === "discarded"
                  ? "已放弃"
                  : item.status === "conflicted"
                    ? "冲突"
                    : "候选"}
            </Button>
          ))}
        </nav>
      ) : null}
      {value && (
        <article
          aria-label={`诊断候选 v${value.version}`}
          data-diagnosis-state-version={value.stateVersion}
          className="space-y-4 rounded-lg border border-line bg-surface p-5"
        >
          <h2 className="font-semibold">
            {value.title || "改编诊断"} · v{value.version}
          </h2>
          <p className="text-sm text-muted">
            AI
            评估；引文已核对实际冻结表达，但不代表结论或制作成本经过人工验证。正式作者意图
            v{value.authorIntent.version}。
          </p>
          {value.basis.sourceBasis && (
            <NarrativeSourceCoverage
              basis={value.basis.sourceBasis}
              chapters={value.basis.chapters}
              label="诊断实际来源表达"
            />
          )}
          <p className="text-sm">
            实际覆盖：{value.basis.chapters.length} /{" "}
            {value.basis.chapters.length + value.basis.omittedChapters.length}{" "}
            章（
            {value.basis.scope === "whole-book"
              ? "本轮全书非空章节"
              : "局部范围"}
            ），{value.basis.target.episodeCount} 集 ×{" "}
            {value.basis.target.durationSeconds} 秒。采用不等于季纲已完成。
          </p>
          <details>
            <summary>来源与未覆盖区域</summary>
            {value.basis.chapters.map((item) => (
              <p key={item.id} className="text-sm">
                已纳入 {item.title} · v{item.version}
              </p>
            ))}
            {value.basis.omittedChapters.map((item) => (
              <p key={item.id} className="text-sm text-muted">
                未覆盖 {item.title} · v{item.version}
              </p>
            ))}
          </details>
          <p className="whitespace-pre-wrap text-sm leading-7">
            {value.content.summary}
          </p>
          <dl className="space-y-2 text-sm">
            {[
              ["主题", value.content.theme],
              ["情绪承诺", value.content.emotionalPromise],
              ["主线", value.content.mainLine],
              ["卖点", value.content.sellingPoints.join("；")],
              ["人物弧", value.content.characterArcs.join("；")],
              ["关系", value.content.relationships.join("；")],
            ].map(([label, detail]) => (
              <div key={label}>
                <dt className="font-medium">{label}</dt>
                <dd>{detail}</dd>
              </div>
            ))}
          </dl>
          {value.content.findings.map((finding) => (
            <section
              key={finding.id}
              className="rounded border border-line p-3 text-sm"
            >
              <h3 className="font-medium">{finding.claim}</h3>
              {finding.evidence.map((evidence, index) => (
                <blockquote
                  key={index}
                  className="my-2 border-l-2 border-brand pl-3"
                >
                  {
                    value.basis.chapters.find(
                      (item) => item.id === evidence.chapterId,
                    )?.title
                  }{" "}
                  · v{evidence.chapterVersion}：{evidence.quote}
                  {evidence.source && (
                    <span className="block break-all text-xs text-muted">
                      实际来源 {evidence.source.sourceId} v
                      {evidence.source.sourceVersion} ·{" "}
                      {evidence.source.fieldPath} · {evidence.source.valuePath}
                      （不是未提供的原文）
                    </span>
                  )}
                </blockquote>
              ))}
              <p>建议：{finding.suggestion}</p>
            </section>
          ))}
          <details>
            <summary>旧诊断内策略（兼容路径）</summary>
            <p className="my-3 text-sm text-muted">
              仅为旧记录或明确选择的旧流程保留。新主流程采用上方诊断证据后，在独立策略工作台选择正式策略，不必在此重复选择。
            </p>
            <fieldset className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <legend className="mb-3 font-semibold">比较并选择一个策略</legend>
              {value.content.strategies.map((strategy) => (
                <label
                  key={strategy.id}
                  className="space-y-2 rounded border border-line p-4 text-sm"
                >
                  <span className="flex gap-2 font-semibold">
                    <input
                      type="radio"
                      name={`diagnosis-strategy-${value.id}`}
                      aria-label={`选择策略 ${strategy.title}`}
                      checked={
                        strategyId === strategy.id ||
                        (value.status === "adopted" &&
                          value.selectedStrategyId === strategy.id)
                      }
                      disabled={value.status !== "pending" || busy}
                      onChange={() =>
                        setChoice({ id: value.id, strategy: strategy.id })
                      }
                    />
                    {strategy.title}
                  </span>
                  <p>{strategy.rationale}</p>
                  {(
                    [
                      "preserve",
                      "merge",
                      "remove",
                      "reorder",
                      "restructure",
                    ] as const
                  ).map((key, index) => (
                    <p key={key}>
                      {["保留", "合并", "删减", "重排", "重构"][index]}：
                      {strategy[key].join("；") || "无"}
                    </p>
                  ))}
                  <p>节奏：{strategy.rhythm}</p>
                  <p>风险：{strategy.risks.join("；")}</p>
                  <p>
                    制作风险等级：{strategy.productionRisk}；
                    {strategy.productionNotes}
                  </p>
                  <p className="text-muted">
                    证据：{strategy.findingIds.join("、")}
                  </p>
                </label>
              ))}
            </fieldset>
            <Button
              className="mt-3"
              size="sm"
              variant="secondary"
              disabled={
                busy ||
                value.status !== "pending" ||
                value.sourceState === "stale" ||
                !strategyId
              }
              onClick={() => void transition("adopt", true)}
            >
              采用选定策略与诊断
            </Button>
          </details>
          {value.staleReasons.length > 0 && (
            <p role="alert" className="text-sm text-danger-strong">
              {value.staleReasons.join("；")}。历史保留，不能采用此过期候选。
            </p>
          )}
          <div className="flex gap-3">
            <Button
              size="sm"
              disabled={
                busy ||
                value.status !== "pending" ||
                value.sourceState === "stale"
              }
              onClick={() => void transition("adopt")}
            >
              采用诊断，下一步独立策略
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={
                busy || !["pending", "conflicted"].includes(value.status)
              }
              onClick={() => void transition("discard")}
            >
              放弃诊断候选
            </Button>
          </div>
        </article>
      )}
    </section>
  );
}
