import type { AgentRunExecution } from "./agent-run-execution.js";
import {
  CreativeWorkflowExecutionSchema,
  type CreativeWorkflowExecution,
} from "./creative-executions.js";

type RecordedRun = Extract<
  Extract<
    CreativeWorkflowExecution["execution"],
    { state: "recorded" }
  >["receipt"]["runs"][number],
  { state: "recorded" }
>;
export interface CreativeExecutionConfigurationGroup {
  configuration: {
    engineKind: AgentRunExecution["engineKind"];
    model: AgentRunExecution["model"];
  };
  runs: {
    runId: string;
    phase: RecordedRun["phase"];
    status: AgentRunExecution["status"];
    timing: AgentRunExecution["timing"];
  }[];
  timing: {
    measuredCount: number;
    inProgressCount: number;
    unrecordedCount: number;
    invalidCount: number;
    minDurationMs: number | null;
    maxDurationMs: number | null;
  };
}
type StatisticsBase = {
  format: "creative-execution-statistics-v1";
  projectId: string;
  workflowId: string;
  scope: "exact-workflow-attempt";
  modelEvidence: "unknown";
};
export type CreativeExecutionStatistics = StatisticsBase &
  (
    | {
        state: "recorded";
        runCount: number;
        recordedRunCount: number;
        missingRunIds: string[];
        revisionRunIds: string[];
        groups: CreativeExecutionConfigurationGroup[];
      }
    | { state: "missing" | "unavailable" | "read-failed" }
  );

/**
 * Descriptive statistics of one exact attempt, never a model comparison,
 * adoption/revision metric, wall-clock total or usage/billing aggregation.
 * Revalidate the owner join before grouping; no partial/foreign input is used.
 */
export function measureCreativeExecution(
  value: unknown,
): CreativeExecutionStatistics {
  const parsed = CreativeWorkflowExecutionSchema.safeParse(value);
  if (!parsed.success) throw new Error("原工作流统计归属无法核对。");
  const ledger = parsed.data;
  const base: StatisticsBase = {
    format: "creative-execution-statistics-v1",
    projectId: ledger.projectId,
    workflowId: ledger.workflowId,
    scope: "exact-workflow-attempt",
    modelEvidence: "unknown",
  };
  if (ledger.execution.state !== "recorded")
    return { ...base, state: ledger.execution.state };
  const groups = new Map<string, CreativeExecutionConfigurationGroup>();
  const missingRunIds: string[] = [],
    revisionRunIds: string[] = [];
  for (const run of ledger.execution.receipt.runs) {
    if (run.state === "missing") {
      missingRunIds.push(run.runId);
      continue;
    }
    const { engineKind, model, timing, status } = run.execution;
    // Structured tuple preserves absent provider/profile and delimiter-bearing
    // IDs; invalid/unrecorded models stay separate for each original engine.
    const key = JSON.stringify([
      engineKind,
      model.status,
      model.status === "recorded" ? model.modelId : null,
      model.status === "recorded" ? (model.providerId ?? null) : null,
      model.status === "recorded" ? (model.profileId ?? null) : null,
    ]);
    let group = groups.get(key);
    if (!group) {
      group = {
        configuration: { engineKind, model: { ...model } },
        runs: [],
        timing: {
          measuredCount: 0,
          inProgressCount: 0,
          unrecordedCount: 0,
          invalidCount: 0,
          minDurationMs: null,
          maxDurationMs: null,
        },
      };
      groups.set(key, group);
    }
    group.runs.push({
      runId: run.runId,
      phase: run.phase,
      status,
      timing: { ...timing },
    });
    if (run.phase === "revising") revisionRunIds.push(run.runId);
    if (timing.status === "measured") {
      group.timing.measuredCount++;
      group.timing.minDurationMs = Math.min(
        group.timing.minDurationMs ?? timing.durationMs,
        timing.durationMs,
      );
      group.timing.maxDurationMs = Math.max(
        group.timing.maxDurationMs ?? timing.durationMs,
        timing.durationMs,
      );
    } else if (timing.status === "in-progress") group.timing.inProgressCount++;
    else if (timing.status === "invalid") group.timing.invalidCount++;
    else group.timing.unrecordedCount++;
  }
  return {
    ...base,
    state: "recorded",
    runCount: ledger.execution.receipt.runs.length,
    recordedRunCount:
      ledger.execution.receipt.runs.length - missingRunIds.length,
    missingRunIds,
    revisionRunIds,
    groups: [...groups.values()],
  };
}
