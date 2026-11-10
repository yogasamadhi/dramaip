import type { PluginContext } from "@dramaip/plugin-api/internal";
import { type AgentRouteDraft, problem } from "../internal/shared.js";
import { isRecord, text } from "../providers/routes.js";
export type EvaluationCandidate = "a" | "b";

export interface EvaluationRow {
  id: string;
  project_id: string;
  task_type: string;
  prompt: string;
  context_snapshot_json: string;
  context_snapshot_id: string | null;
  context_manifest_sha256: string | null;
  status: string;
  revealed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EvaluationCandidateRow {
  id: string;
  evaluation_id: string;
  candidate: EvaluationCandidate;
  engine_kind: string;
  run_id: string;
  status: string;
  output_json: string | null;
  metrics_json: string;
}

export function evaluationMetrics(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function publicEvaluationMetrics(
  value: string,
  revealed: boolean,
): Record<string, unknown> {
  const metrics = evaluationMetrics(value);
  const result: Record<string, unknown> = {};
  for (const key of [
    "completed",
    "formatError",
    "toolViolation",
    "adopted",
    "success",
  ])
    if (typeof metrics[key] === "boolean") result[key] = metrics[key];
  for (const key of [
    "latencyMs",
    "ttftMs",
    "durationMs",
    "toolCalls",
    "toolErrors",
    "retryCount",
    "promptCharacters",
  ])
    if (
      typeof metrics[key] === "number" &&
      Number.isFinite(metrics[key]) &&
      metrics[key] >= 0
    )
      result[key] = metrics[key];
  if (
    typeof metrics.failureCode === "string" &&
    /^[A-Z_]{1,100}$/u.test(metrics.failureCode)
  )
    result.failureCode = metrics.failureCode;
  if (revealed)
    for (const key of ["engine", "engineVersion", "model", "provider"])
      if (typeof metrics[key] === "string") result[key] = metrics[key];
  return result;
}

export function evaluationPayload(
  pluginContext: PluginContext,
  id: string,
): Record<string, unknown> | undefined {
  return pluginContext.uow.execute((transaction) => {
    const evaluation = transaction.get<EvaluationRow>(
      `SELECT evaluation.id, evaluation.project_id, evaluation.task_type,
              evaluation.prompt, evaluation.context_snapshot_json,
              evaluation.context_snapshot_id, evaluation.status,
              evaluation.revealed_at, evaluation.created_at,
              evaluation.updated_at,
              snapshot.manifest_sha256 AS context_manifest_sha256
       FROM agent_evaluations evaluation
       LEFT JOIN agent_context_snapshots snapshot
         ON snapshot.id = evaluation.context_snapshot_id
       WHERE evaluation.id = ?`,
      id,
    );
    if (!evaluation) return undefined;
    const candidates = transaction
      .all<EvaluationCandidateRow>(
        `SELECT id, evaluation_id, candidate, engine_kind, run_id, status,
                output_json, metrics_json
         FROM agent_evaluation_candidates WHERE evaluation_id = ?
         ORDER BY candidate`,
        id,
      )
      .map((candidate) => {
        let output: unknown;
        if (candidate.output_json) {
          try {
            output = JSON.parse(candidate.output_json);
          } catch {
            output = undefined;
          }
        }
        return {
          candidate: candidate.candidate,
          runId: candidate.run_id,
          status: candidate.status,
          ...(output !== undefined ? { output } : {}),
          ...(evaluation.revealed_at
            ? { engineKind: candidate.engine_kind }
            : {}),
          ...(evaluation.revealed_at &&
          transaction.get(
            "SELECT run_id FROM agent_auxiliary_usage_runs WHERE run_id = ? AND evaluation_candidate_id = ?",
            candidate.run_id,
            candidate.id,
          )
            ? { usageRunId: candidate.run_id }
            : {}),
          metrics: publicEvaluationMetrics(
            candidate.metrics_json,
            Boolean(evaluation.revealed_at),
          ),
        };
      });
    let model: unknown;
    try {
      const snapshot = JSON.parse(evaluation.context_snapshot_json);
      model = isRecord(snapshot) ? snapshot.model : undefined;
    } catch {
      model = undefined;
    }
    return {
      id: evaluation.id,
      projectId: evaluation.project_id,
      taskType: evaluation.task_type,
      ...(evaluation.context_snapshot_id
        ? { contextSnapshotId: evaluation.context_snapshot_id }
        : {}),
      ...(evaluation.context_manifest_sha256
        ? { contextManifestSha256: evaluation.context_manifest_sha256 }
        : {}),
      status: evaluation.status,
      comparisonMode: model ? "same_model" : "recommended",
      ...(evaluation.revealed_at && isRecord(model) ? { model } : {}),
      revealed: Boolean(evaluation.revealed_at),
      candidates,
      createdAt: evaluation.created_at,
      updatedAt: evaluation.updated_at,
    };
  });
}

export function evaluationRoutes(
  pluginContext: PluginContext,
): readonly AgentRouteDraft[] {
  return [
    {
      id: "agents:evaluations-create",
      pluginId: "agents",
      bind: (routes) =>
        routes.post("/api/v2/agent-experiments", (context) =>
          problem(
            context,
            410,
            "EXPERIMENTS_RETIRED",
            "当前仅使用 Pi，跨引擎盲测已停用；历史记录仍可读取。",
          ),
        ),
    },
    {
      id: "agents:evaluations-get",
      pluginId: "agents",
      bind: (routes) =>
        routes.get("/api/v2/agent-experiments/:id", (context) => {
          const value = evaluationPayload(
            pluginContext,
            context.req.param("id"),
          );
          return value
            ? context.json(value)
            : problem(context, 404, "NOT_FOUND", "未找到盲测记录。");
        }),
    },
    {
      id: "agents:evaluations-review",
      pluginId: "agents",
      bind: (routes) =>
        routes.post("/api/v2/agent-experiments/:id/review", async (context) => {
          const body = await context.req.json().catch(() => undefined);
          const preferred = isRecord(body)
            ? text(body.preferredCandidate)
            : undefined;
          if (!preferred || !["a", "b", "c", "d", "tie"].includes(preferred))
            return problem(context, 400, "VALIDATION_ERROR", "盲测评价无效。");
          const id = context.req.param("id");
          const saved = pluginContext.uow.execute((transaction) => {
            const evaluation = transaction.get<EvaluationRow>(
              "SELECT id, status FROM agent_evaluations WHERE id = ?",
              id,
            );
            if (!evaluation) return false;
            if (evaluation.status !== "ready_for_review")
              throw new Error("盲测尚未完成，暂不能评价。");
            const now = new Date().toISOString();
            transaction.run(
              `INSERT INTO agent_evaluation_reviews(
                evaluation_id, preferred_candidate, accepted, notes, created_at
              ) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(evaluation_id) DO UPDATE SET
                preferred_candidate = excluded.preferred_candidate,
                accepted = excluded.accepted, notes = excluded.notes,
                created_at = excluded.created_at`,
              id,
              preferred,
              body?.accepted === false ? 0 : 1,
              text(body?.notes) ?? null,
              now,
            );
            transaction.run(
              "UPDATE agent_evaluations SET status = 'completed', updated_at = ? WHERE id = ?",
              now,
              id,
            );
            return true;
          });
          if (!saved)
            return problem(context, 404, "NOT_FOUND", "未找到盲测记录。");
          return context.json(evaluationPayload(pluginContext, id));
        }),
    },
    {
      id: "agents:evaluations-reveal",
      pluginId: "agents",
      bind: (routes) =>
        routes.post("/api/v2/agent-experiments/:id/reveal", (context) => {
          const id = context.req.param("id");
          const revealed = pluginContext.uow.execute((transaction) => {
            const evaluation = transaction.get<{ status: string }>(
              "SELECT status FROM agent_evaluations WHERE id = ?",
              id,
            );
            if (!evaluation) return false;
            if (evaluation.status !== "completed")
              throw new Error("请先提交盲测评价后再揭晓引擎。");
            transaction.run(
              "UPDATE agent_evaluations SET revealed_at = COALESCE(revealed_at, ?), updated_at = ? WHERE id = ?",
              new Date().toISOString(),
              new Date().toISOString(),
              id,
            );
            return true;
          });
          if (!revealed)
            return problem(context, 404, "NOT_FOUND", "未找到盲测记录。");
          return context.json(evaluationPayload(pluginContext, id));
        }),
    },
  ];
}
