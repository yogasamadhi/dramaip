import type { InspirationMemoryJob } from "@dramaip/contracts/product";
import { AgentUsagePanel } from "./AgentUsagePanel";

export function AgentExperimentUsageNotice({
  revealed,
  usageRunId,
  projectId,
}: {
  revealed: boolean;
  usageRunId?: string;
  projectId: string;
}) {
  if (revealed && usageRunId)
    return <AgentUsagePanel runId={usageRunId} projectId={projectId} />;
  return (
    <p className="mt-1 text-muted">
      {revealed
        ? "没有可核对的原运行报告；历史计数不补成零。"
        : "用量明细在明确揭盲后才可读取，不提前公开引擎口径。"}
    </p>
  );
}
export function inspirationMemoryStatus(job: InspirationMemoryJob): string {
  return job.status === "completed"
    ? `${job.model ?? "模型配置未记录"} · 用量总量与费用未知`
    : `待整理 · ${job.error ?? "等待后台处理"}`;
}
export function experimentExecutionTime(
  milliseconds: number | undefined,
): string {
  return milliseconds !== undefined &&
    Number.isFinite(milliseconds) &&
    milliseconds >= 0
    ? `${(milliseconds / 1000).toFixed(1)} 秒`
    : "未知";
}
