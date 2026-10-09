import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { BareButton } from "@dramaip/ui-shared";
import type {
  CreativeWorkflowExecution,
  CreativeExecutionFact,
} from "@dramaip/contracts/insights";
import {
  creativeExecutionOperation,
  measureCreativeExecution,
} from "@dramaip/contracts/insights";
import { message, useStudio } from "../../studio-shared";
import { AgentUsagePanel, AgentUsageObservationView } from "../AgentUsagePanel";

const states = {
  missing: "原记录缺失（未知，不等于零）",
  unavailable: "原读取能力暂不可用",
  "read-failed": "原记录读取失败（不换最新，不补零）",
};
const phases = {
  generating: "生成",
  checking: "检查",
  revising: "修订",
  rechecking: "复检",
};
export function CreativeExecutionStatisticsView({
  value,
}: {
  value: CreativeWorkflowExecution;
}) {
  const statistics = measureCreativeExecution(value);
  return (
    <section
      aria-label="原尝试配置分组与运行统计"
      className="space-y-2 rounded border border-line p-2"
    >
      <h4 className="font-medium">原尝试配置分组与运行统计</h4>
      <p className="text-xs text-muted">
        仅此原工作流的阶段，按原引擎及请求模型／服务／配置档精确归组；不是实际模型版本分组或项目成功率。耗时范围只含有原起止时间的阶段，不是工作流总耗时；未结束、缺失和异常不补零。
      </p>
      {statistics.state !== "recorded" ? (
        <p role="status">{states[statistics.state]}；没有统计分母。</p>
      ) : (
        <>
          <p>
            回执运行身份 {statistics.runCount} · 已记录阶段{" "}
            {statistics.recordedRunCount} · 缺失身份{" "}
            {statistics.missingRunIds.length} · 已记录修订阶段{" "}
            {statistics.revisionRunIds.length}
            （不等于达到采用所需的局部修订次数）
          </p>
          {statistics.runCount === 0 && <p>此尝试尚无运行身份，不视为成功。</p>}
          {statistics.missingRunIds.map((id) => (
            <p key={id} className="break-all">
              缺失原运行 {id}：阶段、配置和耗时未知。
            </p>
          ))}
          {statistics.groups.map((group, index) => {
            const { model, engineKind } = group.configuration,
              timing = group.timing;
            return (
              <section
                key={index}
                aria-label={`原请求配置组 ${index + 1}`}
                className="space-y-1"
              >
                <p className="break-all">
                  组 {index + 1} · 引擎 {engineKind} ·{" "}
                  {model.status === "recorded"
                    ? `请求模型 ${model.modelId} · 原服务 ${model.providerId ?? "未记录"} · 原配置档 ${model.profileId ?? "未记录"}`
                    : model.status === "invalid"
                      ? "原模型配置无效"
                      : "原模型配置未记录"}
                </p>
                <p>
                  本组 {group.runs.length} 阶段 · 可核耗时{" "}
                  {timing.measuredCount}/{group.runs.length} · 尚未结束{" "}
                  {timing.inProgressCount} · 起止未记录 {timing.unrecordedCount}{" "}
                  · 时钟异常 {timing.invalidCount} · 已知阶段耗时范围{" "}
                  {timing.minDurationMs === null
                    ? "未知"
                    : `${timing.minDurationMs}–${timing.maxDurationMs} 毫秒`}
                </p>
                {group.runs.map((run) => (
                  <p key={run.runId} className="break-all">
                    {phases[run.phase]} · {run.status} · 原运行 {run.runId}
                  </p>
                ))}
              </section>
            );
          })}
        </>
      )}
    </section>
  );
}
export function CreativeWorkflowExecutionView({
  value,
  history = value.facts.items,
}: {
  value: CreativeWorkflowExecution;
  history?: readonly CreativeExecutionFact[];
}) {
  const request = value.request.record.fact;
  return (
    <section
      aria-label="原工作流运行关联"
      className="space-y-2 text-sm"
      data-creative-execution-workflow-id={value.workflowId}
    >
      <p className="break-all">
        原工作流 {value.workflowId} · 操作{" "}
        {creativeExecutionOperation(value.request)} · 原请求事件{" "}
        {value.request.record.eventId}
      </p>
      {request.kind === "request" && (
        <p>
          实际尝试 {request.targetAttempt} · {request.requestKind} · 原请求时间{" "}
          {request.requestedAt}
          {request.parentWorkflowId && (
            <> · 原父工作流 {request.parentWorkflowId}</>
          )}
        </p>
      )}
      {value.projection.state !== "healthy" && (
        <p role="status">投影尚未追平或异常；已记录事实可能不完整。</p>
      )}
      <p className="text-xs text-muted">
        只展示精确原请求与原阶段。下列模型是运行发生时记录的请求配置，不证明服务实际使用的模型版本。模型来源未知、质量未核验、账单与结算未知；没有汇总
        Token、累计报告或不同币种费用。
      </p>
      <CreativeExecutionStatisticsView value={value} />
      <div className="space-y-1" aria-label="工作流历史事实">
        {history.map((item) => {
          const fact =
            item.family === "outcome" ? item.record : item.record.fact;
          return (
            <p key={item.record.eventId} className="break-all">
              事件 {item.record.eventId} · 游标 {item.record.cursor} ·{" "}
              {fact.kind}
              {"candidate" in fact && fact.candidate && (
                <>
                  {" "}
                  · 原候选 {fact.candidate.id} · 指纹{" "}
                  {fact.candidate.contentFingerprint}
                </>
              )}
              {item.family === "outcome" && (
                <>
                  {" "}
                  · 正式版本{" "}
                  {item.record.formalVersions
                    .map((r) => `${r.kind}:${r.id}@${r.version}`)
                    .join("、")}
                </>
              )}
              {item.family === "planning-adoption" && (
                <> · 完整采用批次 {item.record.fact.records.length} 项</>
              )}
            </p>
          );
        })}
      </div>
      {value.execution.state !== "recorded" ? (
        <p role="status">{states[value.execution.state]}</p>
      ) : value.execution.receipt.runs.length === 0 ? (
        <p>此原尝试尚没有运行身份；不是成功或零用量。</p>
      ) : (
        value.execution.receipt.runs.map((run) => {
          if (run.state === "missing")
            return (
              <p key={run.runId} className="break-all">
                原运行 {run.runId}：{states.missing}；未推测阶段或成功。
              </p>
            );
          const observation =
            value.execution.state === "recorded"
              ? value.execution.usage.find((u) => u.runId === run.runId)
              : undefined;
          const model = run.execution.model,
            timing = run.execution.timing;
          return (
            <section
              key={run.runId}
              aria-label={`原${phases[run.phase]}阶段`}
              className="space-y-2 rounded border border-line p-2"
            >
              <p className="break-all">
                {phases[run.phase]} · 原运行 {run.runId} · 会话{" "}
                {run.execution.sessionId} · 引擎 {run.execution.engineKind} ·
                实际状态 {run.execution.status}
              </p>
              <p className="break-all">
                原上下文 {run.execution.contextSnapshotId ?? "未记录"} ·
                请求模型{" "}
                {model.status === "recorded"
                  ? `${model.modelId}（原服务 ${model.providerId ?? "未记录"}）`
                  : model.status === "invalid"
                    ? "原配置无效"
                    : "原配置未记录"}
              </p>
              <p>
                阶段耗时：
                {timing.status === "measured"
                  ? `${timing.durationMs} 毫秒（原起止时间）`
                  : timing.status === "in-progress"
                    ? "尚未结束，不补当前耗时"
                    : timing.status === "invalid"
                      ? "原时钟记录异常"
                      : "原起止时间未记录"}
              </p>
              {observation?.state === "recorded" ? (
                <AgentUsageObservationView pages={[observation.page]} />
              ) : (
                <p>
                  {observation ? states[observation.state] : "用量关联未记录"}
                </p>
              )}
            </section>
          );
        })
      )}
    </section>
  );
}

/** Explicit local GETs; keyed mount prevents old project/workflow state surviving a switch. */
function WorkflowDetail({
  projectId,
  workflowId,
}: {
  projectId: string;
  workflowId: string;
}) {
  const client = useStudio();
  const detail = useInfiniteQuery({
    queryKey: ["creative-execution", projectId, workflowId],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.creativeOutcomes.execution(
        projectId,
        workflowId,
        pageParam,
        25,
        signal,
      ),
    getNextPageParam: (page) => page.facts.nextCursor,
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const current = detail.isFetching ? undefined : detail.data?.pages[0];
  return (
    <div className="space-y-2">
      {(detail.isPending || detail.isFetching) && <p>正在读取原工作流…</p>}
      {detail.error ? (
        <p role="alert">
          原运行读取失败：{message(detail.error)}；不显示旧读数作为成功。
        </p>
      ) : (
        current && (
          <>
            <CreativeWorkflowExecutionView
              value={current}
              history={detail.data!.pages.flatMap((p) => p.facts.items)}
            />
            {detail.hasNextPage && (
              <BareButton
                disabled={detail.isFetching}
                onClick={() => void detail.fetchNextPage()}
              >
                读取更早的原工作流事实
              </BareButton>
            )}
            {current.execution.state === "recorded" &&
              current.execution.receipt.runs
                .filter((r) => r.state === "recorded")
                .map(
                  (run) =>
                    run.state === "recorded" && (
                      <details
                        key={run.runId}
                        className="rounded border border-line p-2"
                      >
                        <summary>
                          单独读取原{phases[run.phase]}阶段全部用量分页
                        </summary>
                        <AgentUsagePanel
                          runId={run.runId}
                          projectId={projectId}
                          expectedSessionId={run.execution.sessionId}
                          expectedEngineKind={run.execution.engineKind}
                        />
                      </details>
                    ),
                )}
          </>
        )
      )}
      <BareButton
        disabled={detail.isFetching}
        onClick={() => void detail.refetch()}
      >
        重新读取原工作流
      </BareButton>
    </div>
  );
}
export function CreativeExecutions({ projectId }: { projectId: string }) {
  const client = useStudio();
  const [enabled, setEnabled] = useState(false),
    [selected, setSelected] = useState<string>();
  const requests = useInfiniteQuery({
    queryKey: ["creative-execution-requests", projectId],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.creativeOutcomes.executions(projectId, pageParam, 25, signal),
    getNextPageParam: (page) => page.nextCursor,
    enabled,
    retry: false,
    staleTime: 0,
  });
  return (
    <section
      aria-label="本地原请求与运行台账"
      className="space-y-2 rounded border border-line p-3"
    >
      <h3 className="font-medium">本地原请求与运行关联</h3>
      <p className="text-xs text-muted">
        包括已记录的失败、重试和规划请求；没有原请求的历史资料不补入。不是成果数、模型质量或账单。
      </p>
      <BareButton
        disabled={requests.isFetching}
        onClick={() => {
          setSelected(undefined);
          if (enabled) void requests.refetch();
          else setEnabled(true);
        }}
      >
        读取原请求台账
      </BareButton>
      {requests.error ? (
        <p role="alert">
          原请求读取失败：{message(requests.error)}；不视为没有请求。
        </p>
      ) : (
        enabled &&
        requests.data &&
        (!requests.isFetching || requests.isFetchingNextPage) && (
          <>
            {requests.data.pages[0]?.projection.state !== "healthy" && (
              <p role="status">原请求投影未追平或异常；本页不代表完整历史。</p>
            )}
            {requests.data.pages
              .flatMap((page) => page.items)
              .map((item) => (
                <div key={item.record.fact.workflowId} className="break-all">
                  <BareButton
                    onClick={() => setSelected(item.record.fact.workflowId)}
                  >
                    {creativeExecutionOperation(item)} · 原工作流{" "}
                    {item.record.fact.workflowId}
                  </BareButton>
                </div>
              ))}
            {!requests.data.pages.some((p) => p.items.length) && (
              <p>没有已记录的原请求；不等于历史没有创作。</p>
            )}
            {requests.hasNextPage && (
              <BareButton
                disabled={requests.isFetching}
                onClick={() => void requests.fetchNextPage()}
              >
                读取更早的原请求
              </BareButton>
            )}
            {selected && (
              <WorkflowDetail
                key={`${projectId}:${selected}`}
                projectId={projectId}
                workflowId={selected}
              />
            )}
          </>
        )
      )}
    </section>
  );
}
