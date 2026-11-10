import {
  AgentRunExecutionSchema,
  type AgentRunExecution,
} from "@dramaip/contracts";
import type { UnitOfWorkTransaction } from "@dramaip/plugin-api/internal";
import { readAgentUsageScope } from "./usage.js";
import { z } from "zod";

/** Agents alone reads its run metadata. No prompt, credentials, raw model configuration or current defaults. */
export function readAgentRunExecution(
  tx: UnitOfWorkTransaction,
  runId: string,
  projectId: string,
): AgentRunExecution | undefined {
  const scope = readAgentUsageScope(tx, runId);
  if (!scope || scope.projectId !== projectId) return undefined;
  const row = tx.get<{
    task_type: string;
    status: string;
    engine_kind: string;
    context_snapshot_id: string | null;
    model_json: string | null;
    started_at: string | null;
    completed_at: string | null;
  }>(
    "SELECT task_type, status, engine_kind, context_snapshot_id, model_json, started_at, completed_at FROM agent_assistant_runs WHERE id = ?",
    runId,
  );
  if (!row) return undefined;
  let model: AgentRunExecution["model"] = { status: "unrecorded" };
  if (row.model_json !== null) {
    try {
      const raw: unknown = JSON.parse(row.model_json);
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new Error("invalid model");
      const selected = raw as Record<string, unknown>;
      if (selected.modelId === undefined) model = { status: "unrecorded" };
      else {
        const parsed = AgentRunExecutionSchema.shape.model.safeParse({
          status: "recorded",
          modelId: selected.modelId,
          ...(selected.providerId !== undefined
            ? { providerId: selected.providerId }
            : {}),
          ...(selected.profileId !== undefined
            ? { profileId: selected.profileId }
            : {}),
        });
        model = parsed.success ? parsed.data : { status: "invalid" };
      }
    } catch {
      model = { status: "invalid" };
    }
  }
  let timing: AgentRunExecution["timing"] = { status: "unrecorded" };
  const date = (value: string | null) =>
    z.string().datetime().safeParse(value).success;
  if (
    (row.started_at !== null && !date(row.started_at)) ||
    (row.completed_at !== null && !date(row.completed_at))
  )
    timing = { status: "invalid" };
  else if (row.started_at && row.completed_at) {
    const durationMs =
      Date.parse(row.completed_at) - Date.parse(row.started_at);
    timing =
      durationMs >= 0 && Number.isSafeInteger(durationMs)
        ? {
            status: "measured",
            startedAt: row.started_at,
            completedAt: row.completed_at,
            durationMs,
          }
        : { status: "invalid" };
  } else if (
    row.started_at &&
    ![
      "completed",
      "failed",
      "canceled",
      "aborted",
      "interrupted",
      "orphaned",
    ].includes(row.status)
  )
    timing = { status: "in-progress", startedAt: row.started_at };
  return AgentRunExecutionSchema.parse({
    format: "agent-run-execution-v1",
    runId,
    sessionId: scope.sessionId,
    projectId,
    ...(row.context_snapshot_id
      ? { contextSnapshotId: row.context_snapshot_id }
      : {}),
    engineKind: row.engine_kind,
    taskType: row.task_type,
    status: row.status,
    model,
    timing,
    source: "persisted-agent-run",
  });
}
