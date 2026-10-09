import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BareButton } from "@dramaip/ui-shared";
import type { CreativeConfigurationFunnel } from "@dramaip/contracts/insights";
import { message, useStudio } from "../../studio-shared";

const states = {
  missing: "最初原工作流回执缺失",
  unavailable: "最初原回执读取能力不可用",
  "read-failed": "最初原回执读取失败",
  "missing-generating-run": "最初生成阶段未记录，配置未知",
  "unobserved-first-request": "最初请求未记录，不借重试配置补算",
};
export function CreativeConfigurationFunnelView({
  value,
}: {
  value: CreativeConfigurationFunnel;
}) {
  return (
    <section
      aria-label="全项目原请求配置漏斗结果"
      className="space-y-2 text-sm"
    >
      <p>
        检查点 {value.projection.checkpoint} · 已记录原工作流{" "}
        {value.recordedWorkflows} · 原目标 {value.recordedTargets}
      </p>
      {value.projection.state !== "healthy" && (
        <p role="status">
          投影尚未追平或异常；完整读取了已记录页，不代表完整业务历史。
        </p>
      )}
      {!value.groups.length && <p>没有已记录原请求；不等于历史没有创作。</p>}
      {value.groups.map((group, i) => (
        <section
          key={i}
          aria-label={`原配置漏斗组 ${i + 1}`}
          className="space-y-1 rounded border border-line p-2"
        >
          <p>
            组 {i + 1} ·{" "}
            {group.family === "planning" ? "独立小说规划" : "小说章节／改编"} ·{" "}
            {group.configuration.state === "recorded"
              ? `原生成引擎 ${group.configuration.engineKind} · 请求模型 ${group.configuration.model.status === "recorded" ? `${group.configuration.model.modelId} · 服务 ${group.configuration.model.providerId ?? "未记录"} · 配置档 ${group.configuration.model.profileId ?? "未记录"}` : group.configuration.model.status === "invalid" ? "原配置无效" : "原配置未记录"}`
              : states[group.configuration.state]}
          </p>
          {group.summary.measures
            .filter((row) => row.recordedRequests > 0)
            .map((row) => (
              <section
                key={"metric" in row ? row.metric : row.operation}
                aria-label={"metric" in row ? row.metric : row.operation}
                className="space-y-1"
              >
                <p>
                  {"metric" in row ? row.metric : row.operation} · 原请求{" "}
                  {row.recordedRequests} · 目标 {row.requestedTargets} ·
                  最初请求未记录 {row.unobservedFirstTargets}
                </p>
                <p>
                  首候选 {row.firstCandidates} · 原候选直接采用{" "}
                  {row.firstAdopted} · 待决定 {row.pendingDecision} ·
                  已关闭未直接采用 {row.closedWithoutFirstAdoption} · 修改后采用{" "}
                  {row.revisedAdoption} · 重试候选 {row.retryCandidates}
                </p>
                <p>
                  截至此检查点首候选直接采用{" "}
                  {row.firstCandidateAdoptionRatio === null
                    ? "分母未建立"
                    : `${row.firstAdopted}/${row.firstCandidates}（包含待决定，不是公开模型采用率）`}
                </p>
                {row.firstAccepted && (
                  <p className="break-all">
                    本组首次正式采用事件 {row.firstAccepted.adoptedEventId} ·
                    原工作流 {row.firstAccepted.workflowId} · 请求到可审候选{" "}
                    {row.firstAccepted.requestToReadyMs ?? "未知"} 毫秒 ·
                    请求到正式采用{" "}
                    {row.firstAccepted.requestToAdoptMs ?? "未知"} 毫秒 · 时钟{" "}
                    {row.firstAccepted.clockState}
                  </p>
                )}
              </section>
            ))}
          <details>
            <summary>本组最初锚点与全部原尝试身份</summary>
            <p className="break-all">
              最初已观察请求：{group.anchorWorkflowIds.join("、")}
            </p>
            <p className="break-all">
              全部原工作流（包含重试，不表示全部使用本组配置）：
              {group.workflowIds.join("、")}
            </p>
          </details>
        </section>
      ))}
    </section>
  );
}
export function CreativeConfigurationFunnelPanel({
  projectId,
}: {
  projectId: string;
}) {
  const client = useStudio(),
    [enabled, setEnabled] = useState(false);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["creative-configuration-funnel", projectId],
    queryFn: ({ signal }) =>
      client.creativeOutcomes.configurationFunnel(projectId, signal),
    enabled,
    retry: false,
    staleTime: 0,
  });
  return (
    <section
      aria-label="全项目原请求配置漏斗"
      className="space-y-2 rounded border border-line p-3"
    >
      <h3 className="font-medium">全项目原请求配置漏斗</h3>
      <p className="text-xs text-muted">
        明确读取全部已记录原请求及各工作流事实分页，逐项只读，可能需要等待。按每个目标最初请求的生成阶段配置字段归组；后续换模型重试不重置目标。不是完整超参数或实际模型版本分组；来源未知、质量未核验、费用结算未知，不汇总Token／费用，也不把首次人工采用当文学质量。小说和独立规划分别保留，未记录的旧资料不补入。
      </p>
      <BareButton
        disabled={query.isFetching}
        onClick={() => {
          if (enabled) void query.refetch();
          else setEnabled(true);
        }}
      >
        读取全项目原配置漏斗
      </BareButton>
      {query.isFetching && (
        <BareButton
          onClick={() => {
            setEnabled(false);
            void queryClient.cancelQueries({
              queryKey: ["creative-configuration-funnel", projectId],
              exact: true,
            });
          }}
        >
          停止本次读取
        </BareButton>
      )}
      {query.isFetching ? (
        <p role="status">正在完整读取原配置漏斗；不显示部分结果或旧分母…</p>
      ) : (
        enabled &&
        (query.error ? (
          <p role="alert">
            原配置漏斗读取失败：{message(query.error)}
            ；没有部分分母，请明确重读。
          </p>
        ) : (
          query.data && <CreativeConfigurationFunnelView value={query.data} />
        ))
      )}
    </section>
  );
}
