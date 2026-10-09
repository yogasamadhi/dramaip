import { createHash } from "node:crypto";
import {
  AgentUsageObservationSchema,
  AgentUsageObservationPageSchema,
  type AgentEngineKind,
} from "@dramaip/contracts";
import type { UnitOfWorkTransaction } from "@dramaip/plugin-api/internal";
import {
  AgentUsageCursorError,
  AgentUsageIntegrityError,
  contentHash,
  createAgentUsageObservation,
} from "./usage.js";

export class AgentUsageBlindError extends Error {}
type Binding = {
  run_id: string;
  session_id: string;
  engine_run_id: string;
  engine_kind: AgentEngineKind;
  project_id: string | null;
  context_snapshot_id: string;
  context_manifest_sha256: string;
  evaluation_candidate_id: string | null;
  memory_job_id: string | null;
};
type BoundRun = Binding & { binding_sha256: string; created_at: string };
const bindingHash = (value: Binding) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        value.run_id,
        value.session_id,
        value.engine_run_id,
        value.engine_kind,
        value.project_id,
        value.context_snapshot_id,
        value.context_manifest_sha256,
        value.evaluation_candidate_id,
        value.memory_job_id,
      ]),
    )
    .digest("hex");

/** Registration is not proof of a model call; a prepared run can have no report. */
export function registerAuxiliaryUsageRun(
  tx: UnitOfWorkTransaction,
  input: {
    runId: string;
    sessionId: string;
    engineRunId: string;
    engineKind: AgentEngineKind;
    contextSnapshotId: string;
    createdAt: string;
    owner:
      | { evaluationId: string; candidate: "a" | "b" | "c" }
      | { memoryJobId: string };
  },
) {
  const snapshot = tx.get<{
    project_id: string | null;
    manifest_sha256: string;
  }>(
    "SELECT project_id, manifest_sha256 FROM agent_context_snapshots WHERE id = ?",
    input.contextSnapshotId,
  );
  if (!snapshot || !/^[a-f0-9]{64}$/u.test(snapshot.manifest_sha256))
    throw new AgentUsageIntegrityError("辅助运行缺少原冻结上下文。");
  let evaluationCandidateId: string | null = null;
  let memoryJobId: string | null = null;
  if ("evaluationId" in input.owner) {
    const candidate = tx.get<{
      id: string;
      run_id: string;
      engine_kind: string;
      project_id: string;
      context_snapshot_id: string | null;
    }>(
      `SELECT candidate.id, candidate.run_id, candidate.engine_kind, evaluation.project_id, evaluation.context_snapshot_id
       FROM agent_evaluation_candidates candidate JOIN agent_evaluations evaluation ON evaluation.id = candidate.evaluation_id
       WHERE candidate.evaluation_id = ? AND candidate.candidate = ?`,
      input.owner.evaluationId,
      input.owner.candidate,
    );
    if (
      !candidate ||
      candidate.run_id !== input.runId ||
      candidate.engine_kind !== input.engineKind ||
      candidate.context_snapshot_id !== input.contextSnapshotId ||
      candidate.project_id !== snapshot.project_id
    )
      throw new AgentUsageIntegrityError("盲测运行不属于原候选或冻结项目。");
    evaluationCandidateId = candidate.id;
  } else {
    const job = tx.get<{ context_snapshot_id: string | null }>(
      "SELECT context_snapshot_id FROM agent_inspiration_memory_jobs WHERE id = ?",
      input.owner.memoryJobId,
    );
    if (!job || job.context_snapshot_id !== input.contextSnapshotId)
      throw new AgentUsageIntegrityError("整理运行不属于原任务或冻结上下文。");
    memoryJobId = input.owner.memoryJobId;
  }
  const binding: Binding = {
    run_id: input.runId,
    session_id: input.sessionId,
    engine_run_id: input.engineRunId,
    engine_kind: input.engineKind,
    project_id: snapshot.project_id,
    context_snapshot_id: input.contextSnapshotId,
    context_manifest_sha256: snapshot.manifest_sha256,
    evaluation_candidate_id: evaluationCandidateId,
    memory_job_id: memoryJobId,
  };
  if (tx.get("SELECT id FROM agent_assistant_runs WHERE id = ?", input.runId))
    throw new AgentUsageIntegrityError("辅助运行不能替换普通运行身份。");
  const prior = tx.get<BoundRun>(
    "SELECT * FROM agent_auxiliary_usage_runs WHERE run_id = ?",
    input.runId,
  );
  if (prior) {
    if (
      bindingHash(prior) !== prior.binding_sha256 ||
      bindingHash(binding) !== prior.binding_sha256
    )
      throw new AgentUsageIntegrityError("原辅助运行身份不能被替换。");
    return;
  }
  tx.run(
    `INSERT INTO agent_auxiliary_usage_runs(run_id, session_id, engine_run_id, engine_kind, project_id,
     context_snapshot_id, context_manifest_sha256, evaluation_candidate_id, memory_job_id, binding_sha256, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    binding.run_id,
    binding.session_id,
    binding.engine_run_id,
    binding.engine_kind,
    binding.project_id,
    binding.context_snapshot_id,
    binding.context_manifest_sha256,
    binding.evaluation_candidate_id,
    binding.memory_job_id,
    bindingHash(binding),
    input.createdAt,
  );
}
function readBinding(tx: UnitOfWorkTransaction, runId: string) {
  const run = tx.get<BoundRun>(
    "SELECT * FROM agent_auxiliary_usage_runs WHERE run_id = ?",
    runId,
  );
  if (!run) return undefined;
  const snapshot = tx.get<{
    project_id: string | null;
    manifest_sha256: string;
  }>(
    "SELECT project_id, manifest_sha256 FROM agent_context_snapshots WHERE id = ?",
    run.context_snapshot_id,
  );
  if (
    bindingHash(run) !== run.binding_sha256 ||
    !snapshot ||
    snapshot.project_id !== run.project_id ||
    snapshot.manifest_sha256 !== run.context_manifest_sha256
  )
    throw new AgentUsageIntegrityError("原辅助运行身份或上下文指纹无法核对。");
  return run;
}
export function recordAuxiliaryUsage(
  tx: UnitOfWorkTransaction,
  input: {
    runId: string;
    engineRunId: string;
    engineKind: AgentEngineKind;
    cursor: number;
    usage: unknown;
    recordedAt: string;
  },
) {
  const run = readBinding(tx, input.runId);
  if (
    !run ||
    run.engine_run_id !== input.engineRunId ||
    run.engine_kind !== input.engineKind
  )
    throw new AgentUsageIntegrityError("用量报告不属于原辅助运行。");
  const observation = createAgentUsageObservation({
    ...input,
    sessionId: run.session_id,
    ...(run.project_id ? { projectId: run.project_id } : {}),
  });
  const hash = contentHash(run.engine_run_id, observation);
  const prior = tx.get<{ content_sha256: string; observation_json: string }>(
    "SELECT content_sha256, observation_json FROM agent_auxiliary_usage_observations WHERE run_id = ? AND engine_cursor = ?",
    run.run_id,
    input.cursor,
  );
  if (prior) {
    if (
      prior.content_sha256 !== hash ||
      contentHash(
        run.engine_run_id,
        AgentUsageObservationSchema.parse(JSON.parse(prior.observation_json)),
      ) !== hash
    )
      throw new AgentUsageIntegrityError("原辅助用量游标内容不能被替换。");
    return;
  }
  tx.run(
    "INSERT INTO agent_auxiliary_usage_observations VALUES (?, ?, ?, ?)",
    run.run_id,
    input.cursor,
    JSON.stringify(observation),
    hash,
  );
  tx.run(
    "UPDATE agent_auxiliary_usage_runs SET last_engine_cursor = MAX(last_engine_cursor, ?) WHERE run_id = ?",
    input.cursor,
    run.run_id,
  );
  tx.append({
    type: "agents.auxiliary-usage-observed.v1",
    pluginId: "agents",
    aggregateType: "auxiliary-agent-run",
    aggregateId: run.run_id,
    aggregateVersion: input.cursor,
    // Blind evaluation identities remain private until explicit reveal.
    payload: { runId: run.run_id },
  });
}
export function readAuxiliaryUsagePage(
  tx: UnitOfWorkTransaction,
  runId: string,
  projectId: string | undefined,
  cursor: number | undefined,
  limit: number,
) {
  const run = readBinding(tx, runId);
  if (!run || (run.project_id ?? undefined) !== projectId) return undefined;
  if (run.evaluation_candidate_id) {
    const evaluation = tx.get<{ revealed_at: string | null }>(
      `SELECT evaluation.revealed_at FROM agent_evaluation_candidates candidate
       JOIN agent_evaluations evaluation ON evaluation.id = candidate.evaluation_id WHERE candidate.id = ?`,
      run.evaluation_candidate_id,
    );
    if (!evaluation) return undefined;
    if (!evaluation.revealed_at)
      throw new AgentUsageBlindError(
        "盲测尚未明确揭盲，不公开原运行用量明细。",
      );
  }
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (cursor !== undefined &&
      (!Number.isSafeInteger(cursor) ||
        cursor < 1 ||
        !tx.get(
          "SELECT engine_cursor FROM agent_auxiliary_usage_observations WHERE run_id = ? AND engine_cursor = ?",
          runId,
          cursor,
        )))
  )
    throw new AgentUsageCursorError("辅助运行用量分页参数或游标无效。");
  const rows = tx.all<{
    engine_cursor: number;
    observation_json: string;
    content_sha256: string;
  }>(
    "SELECT * FROM agent_auxiliary_usage_observations WHERE run_id = ? AND (? IS NULL OR engine_cursor < ?) ORDER BY engine_cursor DESC LIMIT ?",
    runId,
    cursor ?? null,
    cursor ?? null,
    limit + 1,
  );
  const items = rows.slice(0, limit).map((row) => {
    let raw: unknown;
    try {
      raw = JSON.parse(row.observation_json);
    } catch {
      throw new AgentUsageIntegrityError("辅助运行用量格式无法核对。");
    }
    const parsed = AgentUsageObservationSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.runId !== runId ||
      parsed.data.sessionId !== run.session_id ||
      parsed.data.engineKind !== run.engine_kind ||
      parsed.data.projectId !== projectId ||
      parsed.data.cursor !== row.engine_cursor ||
      contentHash(run.engine_run_id, parsed.data) !== row.content_sha256
    )
      throw new AgentUsageIntegrityError("辅助运行用量指纹或归属无法核对。");
    return parsed.data;
  });
  return AgentUsageObservationPageSchema.parse({
    format: "agent-usage-observation-page-v1",
    runId,
    ...(projectId ? { projectId } : {}),
    observationCount: tx.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM agent_auxiliary_usage_observations WHERE run_id = ?",
      runId,
    )!.count,
    coverage: "partial-or-unknown",
    billingStatus: "unknown",
    items,
    ...(rows.length > limit ? { nextCursor: items.at(-1)!.cursor } : {}),
  });
}
