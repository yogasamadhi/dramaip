import {
  ProblemDetailsSchema,
  type AgentContextService,
  type AgentEngineKind,
} from "@dramaip/contracts";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import { createHostAgentRuntime } from "@dramaip/desktop-host";
import { type PluginContext } from "@dramaip/plugin-api/internal";
import { AgentRouteDraft, problem } from "../internal/shared.js";
import {
  AgentModelSelection,
  agentEngineDescriptors,
  configuredProvider,
  findProvider,
  isRecord,
  modelSelection,
  text,
} from "../providers/routes.js";
import { assistantTaskType, engineResponseText } from "../sessions/routes.js";
import {
  recordAuxiliaryUsage,
  registerAuxiliaryUsageRun,
} from "../runs/auxiliary-usage.js";
export type EvaluationCandidate = "a" | "b" | "c";
export const evaluationCandidates: readonly EvaluationCandidate[] = [
  "a",
  "b",
  "c",
];
export const activeEvaluationEngines: readonly AgentEngineKind[] = [
  "pi",
  "codex",
  "langgraph",
];

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
  engine_kind: AgentEngineKind;
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

export function shuffledEvaluationEngines(): readonly AgentEngineKind[] {
  const engines = [...activeEvaluationEngines];
  for (let index = engines.length - 1; index > 0; index -= 1) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0]!;
    const target = random % (index + 1);
    [engines[index], engines[target]] = [engines[target]!, engines[index]!];
  }
  return engines;
}

export async function runEvaluationCandidate(
  pluginContext: PluginContext,
  host: DesktopHostClient | undefined,
  input: {
    evaluationId: string;
    candidate: EvaluationCandidate;
    engine: AgentEngineKind;
    runId: string;
    prompt: string;
    projectId: string;
    model?: AgentModelSelection;
  },
): Promise<void> {
  // Native plugin disposal revokes service lookups immediately. This accepted
  // owner retains its already acquired UoW until the registered drain finishes.
  const uow = pluginContext.uow;
  const startedAt = Date.now();
  let ttftMs: number | undefined;
  let output = "";
  let toolCalls = 0;
  let toolErrors = 0;
  let failureCode: string | undefined;
  let disposeSession: (() => Promise<void>) | undefined;
  const capabilityGrant = {
    endpoint: "",
    token: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
  try {
    if (!host) throw new Error("CAPABILITY_UNAVAILABLE");
    uow.execute((transaction) => {
      transaction.run(
        `UPDATE agent_evaluation_candidates
         SET status = 'running' WHERE evaluation_id = ? AND candidate = ?`,
        input.evaluationId,
        input.candidate,
      );
      transaction.run(
        `INSERT INTO agent_capability_grants(
          id, run_id, expires_at, consumed_at, capabilities_json, created_at
        ) VALUES (?, ?, ?, NULL, ?, ?)`,
        capabilityGrant.token,
        input.runId,
        capabilityGrant.expiresAt,
        JSON.stringify(["mcp.readonly"]),
        new Date().toISOString(),
      );
    });
    const runtime = createHostAgentRuntime(host, input.engine);
    const availability = await runtime.availability();
    if (!availability.available)
      throw new Error(
        availability.authenticated
          ? "ENGINE_UNAVAILABLE"
          : "ENGINE_AUTH_REQUIRED",
      );
    const session = await runtime.createSession({
      sessionId: `evaluation-${input.evaluationId}-${input.candidate}`,
      title: `盲测 ${input.candidate.toUpperCase()}`,
      projectId: input.projectId,
      ...(input.model ? { model: input.model } : {}),
      capabilityGrant,
    });
    disposeSession = () => runtime.dispose(session);
    const run = await runtime.prompt(session, {
      runId: input.runId,
      prompt: input.prompt,
      responseMode: "structured",
      capabilityGrant,
    });
    uow.execute((transaction) => {
      const evaluation = transaction.get<{
        context_snapshot_id: string | null;
      }>(
        "SELECT context_snapshot_id FROM agent_evaluations WHERE id = ?",
        input.evaluationId,
      );
      if (!evaluation?.context_snapshot_id)
        throw new Error("CONTEXT_UNAVAILABLE");
      registerAuxiliaryUsageRun(transaction, {
        runId: input.runId,
        sessionId: session.sessionId,
        engineRunId: run.engineRunId ?? run.runId,
        engineKind: input.engine,
        contextSnapshotId: evaluation.context_snapshot_id,
        createdAt: new Date().toISOString(),
        owner: { evaluationId: input.evaluationId, candidate: input.candidate },
      });
    });
    for await (const event of runtime.subscribe(run)) {
      if (event.type === "content.delta") {
        ttftMs ??= Date.now() - startedAt;
        output = `${output}${event.delta}`.slice(0, 500_000);
      }
      if (event.type === "result") {
        const textOutput = engineResponseText(event.result);
        if (textOutput) output = textOutput;
      }
      if (event.type === "usage") {
        uow.execute((transaction) =>
          recordAuxiliaryUsage(transaction, {
            runId: input.runId,
            engineRunId: run.engineRunId ?? run.runId,
            engineKind: input.engine,
            cursor: event.cursor,
            usage: event.usage,
            recordedAt: new Date().toISOString(),
          }),
        );
      }
      if (event.type === "tool") {
        toolCalls += 1;
        if (event.status === "failed") toolErrors += 1;
      }
      if (event.type === "error") {
        failureCode = event.code;
        throw new Error(event.message);
      }
    }
    if (!output.trim()) throw new Error("EMPTY_RESULT");
    const now = new Date().toISOString();
    uow.execute((transaction) => {
      transaction.run(
        `UPDATE agent_evaluation_candidates
         SET status = 'succeeded', output_json = ?, metrics_json = ? WHERE evaluation_id = ? AND candidate = ?`,
        JSON.stringify({ text: output }),
        JSON.stringify({
          completed: true,
          formatError: false,
          toolViolation: false,
          latencyMs: Date.now() - startedAt,
          ttftMs,
          durationMs: Date.now() - startedAt,
          engine: input.engine,
          engineVersion: runtime.descriptor.version,
          model: input.model?.modelId,
          provider: input.model?.providerId,
          success: true,
          toolCalls,
          toolErrors,
          promptCharacters: input.prompt.length,
          retryCount: 0,
          adopted: false,
        }),
        input.evaluationId,
        input.candidate,
      );
      transaction.run(
        `UPDATE agent_evaluations SET updated_at = ? WHERE id = ?`,
        now,
        input.evaluationId,
      );
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "ENGINE_OPERATION_FAILED";
    failureCode ??= /^[A-Z_]+$/u.test(message)
      ? message
      : "ENGINE_OPERATION_FAILED";
    uow.execute((transaction) => {
      const now = new Date().toISOString();
      transaction.run(
        `UPDATE agent_evaluation_candidates
         SET status = 'failed', metrics_json = ? WHERE evaluation_id = ? AND candidate = ?`,
        JSON.stringify({
          completed: false,
          formatError: false,
          toolViolation: false,
          latencyMs: Date.now() - startedAt,
          durationMs: Date.now() - startedAt,
          engine: input.engine,
          model: input.model?.modelId,
          provider: input.model?.providerId,
          success: false,
          toolCalls,
          toolErrors,
          promptCharacters: input.prompt.length,
          retryCount: 0,
          failureCode,
          adopted: false,
        }),
        input.evaluationId,
        input.candidate,
      );
      transaction.run(
        `UPDATE agent_evaluations SET updated_at = ? WHERE id = ?`,
        now,
        input.evaluationId,
      );
    });
  } finally {
    await disposeSession?.().catch(() => undefined);
    uow.execute((transaction) => {
      transaction.run(
        "UPDATE agent_capability_grants SET consumed_at = COALESCE(consumed_at, ?) WHERE id = ?",
        new Date().toISOString(),
        capabilityGrant.token,
      );
      const remaining = transaction.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM agent_evaluation_candidates
         WHERE evaluation_id = ? AND status IN ('queued', 'running')`,
        input.evaluationId,
      )?.count;
      const evaluation = transaction.get<{ status: string }>(
        "SELECT status FROM agent_evaluations WHERE id = ?",
        input.evaluationId,
      );
      const releasing = transaction.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM agent_capability_grants grant_row
         JOIN agent_evaluation_candidates candidate ON candidate.run_id = grant_row.run_id
         WHERE candidate.evaluation_id = ? AND grant_row.consumed_at IS NULL`,
        input.evaluationId,
      )?.count;
      if (
        remaining === 0 &&
        releasing === 0 &&
        evaluation?.status === "running"
      ) {
        const now = new Date().toISOString();
        transaction.run(
          `UPDATE agent_evaluations SET status = 'ready_for_review', updated_at = ? WHERE id = ?`,
          now,
          input.evaluationId,
        );
        transaction.append({
          type: "agents.evaluation-ready.v1",
          pluginId: "agents",
          aggregateType: "agent-evaluation",
          aggregateId: input.evaluationId,
          aggregateVersion: 1,
          payload: { evaluationId: input.evaluationId },
        });
      }
    });
  }
}

export function evaluationRoutes(
  pluginContext: PluginContext,
  host: DesktopHostClient | undefined,
  agentContext: AgentContextService,
): readonly AgentRouteDraft[] {
  let stopping = false;
  const active = new Set<Promise<void>>();
  pluginContext.effect(
    () => async () => {
      stopping = true;
      // Every dispatched candidate owns its original session and final writes.
      // Drain all owners even if one fails; this is not provider cancellation.
      const results = await Promise.allSettled(active);
      if (results.some((result) => result.status === "rejected"))
        throw new Error("Agent evaluation cleanup did not complete");
    },
    "worker:agent-evaluations",
  );
  const stoppingResponse = () =>
    new Response(
      JSON.stringify(
        ProblemDetailsSchema.parse({
          type: "https://dramaip.local/problems/agent-plugin-stopping",
          title: "Agent plugin stopping",
          status: 503,
          detail: "智能体插件正在停止，暂不接收新的盲测任务。",
          code: "AGENT_PLUGIN_STOPPING",
          traceId: crypto.randomUUID(),
        }),
      ),
      {
        status: 503,
        headers: {
          "Content-Type": "application/problem+json",
          "Cache-Control": "no-store",
        },
      },
    );
  return [
    {
      id: "agents:evaluations-create",
      pluginId: "agents",
      bind: (routes) =>
        routes.post("/api/v2/agent-experiments", async (context) => {
          if (stopping) return stoppingResponse();
          const body = await context.req.json().catch(() => undefined);
          if (stopping) return stoppingResponse();
          if (
            !isRecord(body) ||
            !text(body.projectId) ||
            !assistantTaskType(body.taskType)
          )
            return problem(context, 400, "VALIDATION_ERROR", "盲测参数无效。");
          const model =
            body.model === undefined ? undefined : modelSelection(body.model);
          if (body.model !== undefined && !model)
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "盲测模型配置无效；仅支持 providerId、modelId、profileId，不会忽略其他参数。",
            );
          if (!host)
            return problem(
              context,
              503,
              "CAPABILITY_UNAVAILABLE",
              "当前 Runtime 未连接 Desktop Host，无法启动三引擎盲测。",
            );
          const unavailable = (
            await agentEngineDescriptors(pluginContext, host)
          ).filter(
            (engine) =>
              activeEvaluationEngines.includes(
                engine.kind as AgentEngineKind,
              ) && engine.canRun !== true,
          );
          if (stopping) return stoppingResponse();
          if (unavailable.length)
            return problem(
              context,
              409,
              "ENGINE_NOT_READY",
              `三引擎盲测要求全部引擎就绪；当前不可用：${unavailable
                .map((engine) => String(engine.name ?? engine.kind))
                .join("、")}。`,
            );
          const evaluationId = crypto.randomUUID();
          const now = new Date().toISOString();
          const prompt =
            text(body.prompt) ?? "请基于已授权的项目上下文完成此项任务。";
          const selectedProvider = model?.providerId
            ? findProvider(pluginContext, model.providerId)
            : undefined;
          const provider = selectedProvider
            ? configuredProvider(selectedProvider)
            : undefined;
          if (provider?.authentication === "none")
            return problem(
              context,
              422,
              "UNSUPPORTED_OPERATION",
              "三引擎盲测包含不支持本地模型服务商的 Codex 引擎，不能静默切换到云端模型。",
            );
          let contextSnapshot;
          try {
            const preview = agentContext.createPreview({
              projectId: text(body.projectId)!,
              runIntent: `blind-experiment:${assistantTaskType(body.taskType)}`,
              basePrompt: prompt,
              tokenBudget: 64_000,
              destination: {
                kind: "cloud",
                provider: "multi-engine-benchmark",
                ...(model?.modelId ? { model: model.modelId } : {}),
              },
              temporaryOverrides: [],
            });
            contextSnapshot = agentContext.freeze(preview.id, preview.version);
          } catch (error) {
            return problem(
              context,
              409,
              "CONTEXT_PREVIEW_FAILED",
              error instanceof Error
                ? error.message
                : "盲测上下文预览无法冻结。",
            );
          }
          if (!contextSnapshot)
            return problem(
              context,
              409,
              "CONTEXT_PREVIEW_STALE",
              "盲测上下文预览已失效，请重新创建。",
            );
          const mapping = shuffledEvaluationEngines();
          const runInputs = pluginContext.uow.execute((transaction) => {
            transaction.run(
              `INSERT INTO agent_evaluations(
                id, project_id, task_type, prompt, context_snapshot_json,
                context_snapshot_id, status, revealed_at, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, 'running', NULL, ?, ?)`,
              evaluationId,
              text(body.projectId),
              assistantTaskType(body.taskType),
              prompt,
              JSON.stringify({ projectId: text(body.projectId), model }),
              contextSnapshot.id,
              now,
              now,
            );
            const inputs = evaluationCandidates.map((candidate, index) => {
              const runId = crypto.randomUUID();
              const engine = mapping[index]!;
              transaction.run(
                `INSERT INTO agent_evaluation_candidates(
                  id, evaluation_id, candidate, engine_kind, run_id, status,
                  output_json, metrics_json
                ) VALUES (?, ?, ?, ?, ?, 'queued', NULL, '{}')`,
                crypto.randomUUID(),
                evaluationId,
                candidate,
                engine,
                runId,
              );
              return { candidate, engine, runId };
            });
            transaction.append({
              type: "agents.evaluation-created.v1",
              pluginId: "agents",
              aggregateType: "agent-evaluation",
              aggregateId: evaluationId,
              aggregateVersion: 1,
              payload: {
                evaluationId,
                engines: activeEvaluationEngines.length,
              },
            });
            return inputs;
          });
          for (const candidate of runInputs) {
            const work = runEvaluationCandidate(pluginContext, host, {
              evaluationId,
              ...candidate,
              prompt: contextSnapshot.finalPrompt,
              projectId: text(body.projectId)!,
              ...(model ? { model } : {}),
            });
            active.add(work);
            void work.finally(() => active.delete(work)).catch(() => undefined);
          }
          return context.json(
            evaluationPayload(pluginContext, evaluationId),
            202,
          );
        }),
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
