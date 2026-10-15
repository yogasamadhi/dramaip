import {
  currentOwnerQuery,
  CURRENT_OWNER_READ_OPTIONS,
  exactNavigationError,
} from "../../current-owner-read";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Button, confirmDialog } from "@dramaip/ui-shared";
import {
  SeasonPlanRequestSchema,
  type SeasonPlanRequest,
  type SeasonPlan,
} from "@dramaip/contracts/production";
import { useStudio, message } from "../../studio-shared";
import { CreationWorkbench } from "../creation-workbench";
import { verifySeasonPlanOwnerLineage } from "../../season-plan-owner-evidence";
import { NarrativeSourceCoverage } from "../NarrativeSourceCoverage";
import {
  matchesExactCreationWorkflow,
  matchesExactStageCandidate,
  resolveStageCandidateId,
} from "../../exact-object-navigation";

const riskLabels = {
  low: "低",
  medium: "中",
  high: "高",
  unknown: "尚未验证",
} as const;
export function SeasonPlanPanel({ projectId }: { projectId: string }) {
  const client = useStudio();
  const queries = useQueryClient();
  const [params, setParams] = useSearchParams();
  const navigationError = exactNavigationError(params, [
    "workflowId",
    "seasonPlanId",
  ]);
  const workflowId = params.get("workflowId") ?? undefined;
  const requestedId = params.get("seasonPlanId") ?? undefined;
  const draftKey = `dramaip-season-plan-basis:${projectId}`;
  const [draftRequest, setRequest] = useState<SeasonPlanRequest | undefined>(
    () => {
      try {
        const parsed = SeasonPlanRequestSchema.safeParse(
          JSON.parse(window.localStorage.getItem(draftKey) ?? "null"),
        );
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },
  );
  const [focused, setFocused] = useState<string | undefined>(
    params.get("seasonPlanId") ?? undefined,
  );
  const [orderDraft, setOrderDraft] = useState<{
    id: string;
    episodeIds: string[];
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
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
      operation: "season-plan",
    }) &&
    original.data.input.seasonPlanRequest
      ? original.data
      : undefined;
  const request = workflowId
    ? validWorkflow?.input.seasonPlanRequest
    : draftRequest;
  const catalog = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["season-plan-sources", projectId],
      queryFn: () => client.seasonPlans.sources(projectId),
      refetchInterval: 2000,
    }),
  );
  const history = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["season-plans", projectId],
      refetchInterval: 1500,
      queryFn: async () => {
        const items: SeasonPlan[] = [];
        const cursors = new Set<string>();
        const identities = new Set<string>();
        let cursor: string | undefined;
        do {
          const page = await client.seasonPlans.list(projectId, cursor, 100);
          for (const item of page.items) {
            if (item.projectId !== projectId || identities.has(item.id))
              throw new Error("历史归属或完整分页无法核对。");
            identities.add(item.id);
            items.push(item);
          }
          cursor = page.nextCursor;
          if (cursor && cursors.has(cursor))
            throw new Error("季纲历史游标重复，尚未核全。");
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
        workflowCandidateId: validWorkflow?.seasonPlanId,
        focusedId: focused,
        latestId: history.data?.[0]?.id,
      });
  const candidate = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["season-plan", projectId, id],
      queryFn: async () => {
        const value = await client.seasonPlans.get(id!);
        if (workflowId && validWorkflow)
          await verifySeasonPlanOwnerLineage(
            value,
            validWorkflow,
            (originalId) => client.seasonPlans.get(originalId),
          );
        return value;
      },
      enabled: Boolean(id) && (!workflowId || Boolean(validWorkflow)),
      refetchInterval: 1500,
    }),
  );
  const value =
    matchesExactStageCandidate(candidate.data, {
      projectId,
      candidateId: id,
      workflowId,
    }) &&
    (!workflowId || validWorkflow)
      ? candidate.data
      : undefined;
  const exactMismatch = Boolean(
    navigationError ||
    (workflowId && (original.error || (original.data && !validWorkflow))) ||
    candidate.error ||
    (candidate.data && !value),
  );
  const accepted = history.data?.find((item) => item.isCurrent);
  const refresh = () =>
    Promise.all([
      queries.invalidateQueries({ queryKey: ["season-plans", projectId] }),
      queries.invalidateQueries({ queryKey: ["season-plan"] }),
      queries.invalidateQueries({
        queryKey: ["season-plan-sources", projectId],
      }),
      queries.invalidateQueries({ queryKey: ["creation-workflow"] }),
      queries.invalidateQueries({ queryKey: ["change-preview"] }),
    ]);
  useEffect(
    () =>
      client.events.subscribe((event) => {
        if (
          !/^(production\.|writing\.|workspace\.|automation\.creation-)/u.test(
            event.type,
          ) ||
          !event.payload ||
          typeof event.payload !== "object"
        )
          return;
        if ((event.payload as { projectId?: string }).projectId === projectId)
          void refresh();
      }),
    [client, queries, projectId],
  );
  const confirmBasis = () => {
    try {
      if (!catalog.data?.diagnosis)
        throw new Error("请先采用来源仍有效的诊断与一个策略。");
      const next = SeasonPlanRequestSchema.parse({
        diagnosis: catalog.data.diagnosis,
        strategy: catalog.data.strategy,
        baseAdoptedId: catalog.data.adoptedPlanId,
      });
      window.localStorage.setItem(draftKey, JSON.stringify(next));
      setRequest(next);
      const search = new URLSearchParams(params);
      search.delete("workflowId");
      search.delete("seasonPlanId");
      setParams(search);
      setError(undefined);
    } catch (cause) {
      setError(message(cause));
    }
  };
  const episodeIds = value
    ? orderDraft?.id === value.id
      ? orderDraft.episodeIds
      : value.content.episodes.map((item) => item.id)
    : [];
  const ordered = episodeIds.map((id) =>
    value!.content.episodes.find((item) => item.id === id)!,
  );
  const canEdit =
    value &&
    value.sourceState === "current" &&
    (value.status === "pending" ||
      (value.status === "adopted" && value.isCurrent));
  const changedOrder =
    value &&
    episodeIds.some((id, index) => value.content.episodes[index]?.id !== id);
  const move = (index: number, direction: number) => {
    if (
      !value ||
      index + direction < 0 ||
      index + direction >= episodeIds.length
    )
      return;
    const next = [...episodeIds];
    [next[index], next[index + direction]] = [
      next[index + direction]!,
      next[index]!,
    ];
    setOrderDraft({ id: value.id, episodeIds: next });
  };
  const action = async (operation: "adopt" | "discard" | "reorder") => {
    if (!value || busy) return;
    const confirmed = await confirmDialog({
      title:
        operation === "adopt"
          ? "采用这个整季方案？"
          : operation === "reorder"
            ? "保存重排为新候选？"
            : "放弃这个季纲候选？",
      description:
        operation === "adopt"
          ? "核对实际来源覆盖、完整分集顺序与风险。替换当前方案，保留旧版本；不会自动生成剧本或媒体。"
          : operation === "reorder"
            ? "保留分集标识与全部内容，保存独立新版本；原方案不变，仍需明确采用。"
            : "仅处理此候选，保留原稿、当前正式方案和其他顺序候选。",
      confirmLabel:
        operation === "adopt"
          ? "明确采用方案"
          : operation === "reorder"
            ? "保存新候选"
            : "明确放弃",
      tone: operation === "discard" ? "danger" : "default",
    });
    if (!confirmed) return;
    setBusy(true);
    setError(undefined);
    const fingerprint = JSON.stringify({
      id: value.id,
      version: value.stateVersion,
      operation,
      ...(operation === "reorder" ? { episodeIds } : {}),
    });
    const key = keys.current.get(fingerprint) ?? crypto.randomUUID();
    keys.current.set(fingerprint, key);
    try {
      const result =
        operation === "reorder"
          ? await client.seasonPlans.reorder(
              value.id,
              value.stateVersion,
              episodeIds,
              key,
            )
          : operation === "adopt"
            ? await client.seasonPlans.adopt(value.id, value.stateVersion, key)
            : await client.seasonPlans.discard(
                value.id,
                value.stateVersion,
                key,
              );
      setFocused(result.id);
      setOrderDraft(undefined);
      const next = new URLSearchParams(params);
      next.set("seasonPlanId", result.id);
      next.set("workflowId", result.workflowId);
      setParams(next);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
      await refresh();
    }
  };
  return (
    <section aria-label="整季方案工作台" className="space-y-5">
      {accepted?.sourceState === "current" && (
        <Link
          className="text-link text-sm"
          to={`/projects/${projectId}/tools/episode-development`}
        >
          从已采用季纲继续单集大纲与标准剧本 →
        </Link>
      )}
      <div className="rounded-lg border border-line bg-surface p-5">
        <h2 className="font-semibold">确认整季方案基准</h2>
        <p className="mt-2 text-sm text-muted">
          继承当前采用诊断、唯一策略、作者意图与实际表达，不扩大局部覆盖。混合诊断不补整章原文，摘要／片段不是全文阅读。旧导入占位不代表正式季纲；不会自动生成剧本、分镜或媒体。
        </p>
        <p className="mt-2 text-sm">
          当前诊断：
          {catalog.data?.diagnosis
            ? `v${catalog.data.diagnosis.version} · 策略 ${catalog.data.diagnosis.strategyId}`
            : "尚无来源有效的采用诊断"}{" "}
          ·{" "}
          <Link
            className="text-link"
            to={`/projects/${projectId}/tools/adaptation-diagnosis`}
          >
            核对诊断与策略
          </Link>
        </p>
        <p className="mt-2 text-sm text-muted">
          {catalog.data?.strategyPath === "independent"
            ? "本轮须明确冻结独立策略版本；旧诊断内策略不代替它。"
            : "旧诊断内已选策略为兼容路径，不冒充独立策略。"}{" "}
          <Link
            className="text-link"
            to={`/projects/${projectId}/tools/adaptation-strategy`}
          >
            核对独立改编策略
          </Link>
        </p>
        <Button
          className="mt-3"
          disabled={busy || !catalog.data?.diagnosis}
          onClick={confirmBasis}
        >
          确认本轮季纲基准
        </Button>
        {request && (
          <p className="mt-2 text-sm">
            本轮已确认诊断 v{request.diagnosis.version} ·{" "}
            {request.diagnosis.strategyId}
            。后续来源变化不会自动重绑，生成时会重新核对。
          </p>
        )}
        {catalog.error && (
          <p role="alert" className="text-sm text-danger">
            来源读取失败：{message(catalog.error)}
          </p>
        )}
      </div>
      {(!requestedId || value) &&
        (!workflowId || validWorkflow) &&
        !exactMismatch && (
          <CreationWorkbench
            projectId={projectId}
            workflowId={workflowId}
            operation="season-plan"
            seasonPlanRequest={request}
            externalReview
            disabled={!request || busy || exactMismatch}
            onStarted={(workflow) => {
              const next = new URLSearchParams(params);
              next.set("workflowId", workflow.id);
              next.delete("seasonPlanId");
              setParams(next);
            }}
            resultLabel="整季分集方案"
            defaultInstruction="遵守已采用诊断、唯一策略和作者意图，为已读来源生成完整目标集数方案，解释删减并保持因果与人物推进。"
            onCandidate={(workflow) => {
              if (workflow.seasonPlanId && !params.get("seasonPlanId"))
                setFocused(workflow.seasonPlanId);
              void refresh();
            }}
          />
        )}
      {(error || history.error || candidate.error) && (
        <p role="alert" className="text-sm text-danger">
          {error ?? message(history.error ?? candidate.error)}
        </p>
      )}
      {exactMismatch && (
        <p role="alert">
          指定季纲或工作流不存在、归属／关联操作不符；不会改读最新方案或上次重排选择。
        </p>
      )}
      <div className="rounded-lg border border-line p-4">
        <h3 className="font-semibold">当前正式方案与历史</h3>
        <p className="mt-2 text-sm">
          当前：
          {accepted
            ? `v${accepted.version}${accepted.sourceState === "stale" ? "（来源已变化）" : ""}`
            : "尚未采用"}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {history.data?.map((item) => (
            <Button
              key={item.id}
              variant={item.id === value?.id ? "secondary" : "ghost"}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set("seasonPlanId", item.id);
                next.set("workflowId", item.workflowId);
                setParams(next);
              }}
            >
              方案 v{item.version} ·{" "}
              {item.origin === "human-reorder" ? "人工重排" : "模型候选"} ·{" "}
              {item.status === "adopted"
                ? "已采用"
                : item.status === "discarded"
                  ? "已放弃"
                  : item.status === "conflicted"
                    ? "冲突"
                    : "待采用"}
            </Button>
          ))}
        </div>
      </div>
      {value && (
        <article
          aria-label={`整季方案 v${value.version}`}
          className="space-y-4 rounded-lg border border-line p-5"
        >
          <h3 className="font-semibold">
            方案 v{value.version} · {value.content.theme}
          </h3>
          <p className="text-sm">
            诊断 v{value.basis.diagnosis.version} /{" "}
            {value.basis.diagnosis.strategyId} · 作者意图 v
            {value.basis.authorIntent.version} ·{" "}
            {value.basis.scope === "whole-book"
              ? "全书确认范围"
              : "局部确认范围"}{" "}
            · {value.content.episodes.length} 集 ×{" "}
            {value.basis.target.durationSeconds} 秒
          </p>
          {value.basis.sourceBasis && (
            <NarrativeSourceCoverage
              basis={value.basis.sourceBasis}
              chapters={value.basis.chapters}
              label="季纲继承的实际来源表达"
            />
          )}
          <p className="text-sm">
            主要冲突：{value.content.mainConflict}；情绪承诺：
            {value.content.emotionalPromise}
          </p>
          {value.sourceState === "stale" && (
            <p role="alert" className="text-sm text-danger">
              来源已变化，不能采用或重排：{value.staleReasons.join("；")}
            </p>
          )}
          <section aria-label="季纲来源覆盖" className="space-y-2 text-sm">
            <h4 className="font-semibold">
              真实来源覆盖（不是模型自报百分比）
            </h4>
            {value.coverage.map((item) => (
              <p key={item.chapterId}>
                {
                  value.basis.chapters.find(
                    (source) => source.id === item.chapterId,
                  )?.title
                }{" "}
                v{item.chapterVersion}：
                {item.disposition === "used"
                  ? item.episodeIds
                      .map(
                        (id) =>
                          value.content.episodes.find(
                            (episode) => episode.id === id,
                          )?.title ?? id,
                      )
                      .join("、")
                  : item.disposition === "omitted"
                    ? `明确删减：${item.omissionReason}`
                    : "未说明遗漏"}
              </p>
            ))}
            <p>
              诊断未读：{value.basis.omittedChapters.length} 章，不计入已覆盖。
              {value.basis.omittedChapters
                .map((item) => `${item.title} v${item.version}`)
                .join("、")}
            </p>
          </section>
          <section aria-label="完整分集顺序" className="space-y-3">
            <h4 className="font-semibold">完整分集顺序</h4>
            {ordered.map((episode, index) => (
              <div
                key={episode.id}
                aria-label={`分集 ${episode.id}`}
                className="rounded border border-line p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h5 className="font-semibold">
                    {index + 1}. {episode.title}
                  </h5>
                  <div className="flex gap-2">
                    <Button
                      aria-label={`上移 ${episode.id}`}
                      variant="ghost"
                      disabled={!canEdit || busy || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      上移
                    </Button>
                    <Button
                      aria-label={`下移 ${episode.id}`}
                      variant="ghost"
                      disabled={
                        !canEdit || busy || index === ordered.length - 1
                      }
                      onClick={() => move(index, 1)}
                    >
                      下移
                    </Button>
                  </div>
                </div>
                <p>{episode.logline}</p>
                <p>
                  目标：{episode.goal}；冲突：{episode.mainConflict}
                </p>
                <p>
                  转折：{episode.turningPoint}；结尾钩子：{episode.endingHook}
                </p>
                <p>
                  人物推进：
                  {episode.characterProgress
                    .map(
                      (item) =>
                        `${item.character}：${item.before} → ${item.after}；${item.relationshipChange}`,
                    )
                    .join("；")}
                </p>
                <p>
                  埋设伏笔：{episode.plantedForeshadowing.join("；") || "无"}
                  ；回收：{episode.paidOffForeshadowing.join("；") || "无"}
                </p>
                <p>
                  预计 {episode.estimatedScenes} 场 /{" "}
                  {episode.estimatedCharacters} 角色 · 制作风险：
                  {riskLabels[episode.productionRisk]}。
                  {episode.productionNotes}
                </p>
                <p>
                  来源动作：
                  {episode.sourceChapters
                    .map(
                      (source) =>
                        `${value.basis.chapters.find((item) => item.id === source.id)?.title ?? source.id} v${source.version}：${source.rationale}`,
                    )
                    .join("；")}
                </p>
              </div>
            ))}
            <Button
              disabled={!canEdit || busy || !changedOrder}
              onClick={() => void action("reorder")}
            >
              保存重排为新候选
            </Button>
            {changedOrder && (
              <p className="text-sm text-muted">
                当前只是未保存顺序草稿；保存新候选后还须明确采用。原版本不变。
              </p>
            )}
          </section>
          <p className="text-sm">
            方案风险：{value.content.risks.join("；") || "仍需叙事与制作验证"}
            。权利为作者声明，不替代授权证明；不虚构费用。
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={
                busy ||
                changedOrder ||
                value.status !== "pending" ||
                value.sourceState !== "current"
              }
              onClick={() => void action("adopt")}
            >
              采用这个整季方案
            </Button>
            <Button
              variant="ghost"
              disabled={
                busy || !["pending", "conflicted"].includes(value.status)
              }
              onClick={() => void action("discard")}
            >
              放弃这个季纲候选
            </Button>
          </div>
        </article>
      )}
    </section>
  );
}
