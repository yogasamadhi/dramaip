import { createHash } from "node:crypto";
import {
  normalizeAgentUsage,
  AgentUsageObservationSchema,
  AgentUsageObservationPageSchema,
  type AgentUsageNumber,
  type AgentUsageObservationPage,
  type AgentEngineKind,
  AgentRunUsageScopeSchema,
} from "@dramaip/contracts";
import type { UnitOfWorkTransaction } from "@dramaip/plugin-api/internal";

interface UsageRun {
  id: string;
  session_id: string;
  project_id: string | null;
  engine_kind: AgentEngineKind;
  engine_run_id: string | null;
  context_snapshot_id: string | null;
  snapshot_id: string | null;
}
export function contentHash(
  engineRunId: string,
  observation: import("@dramaip/contracts").AgentUsageObservation,
) {
  const { recordedAt: _recordedAt, ...content } = observation;
  return createHash("sha256")
    .update(JSON.stringify([engineRunId, content]))
    .digest("hex");
}

export function createAgentUsageObservation(input: {
  runId: string;
  sessionId: string;
  projectId?: string;
  engineKind: AgentEngineKind;
  cursor: number;
  usage: unknown;
  recordedAt: string;
}) {
  const usage = normalizeAgentUsage(input.usage);
  const number = (
    field: "inputTokens" | "outputTokens" | "cachedTokens",
  ): AgentUsageNumber =>
    usage.invalidFields?.includes(field)
      ? { status: "invalid" }
      : usage[field] === undefined
        ? { status: "unreported" }
        : { status: "reported", value: usage[field] };
  return AgentUsageObservationSchema.parse({
    format: "agent-usage-observation-v1",
    runId: input.runId,
    sessionId: input.sessionId,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    engineKind: input.engineKind,
    cursor: input.cursor,
    measurementScope: usage.measurementScope ?? "unspecified",
    inputAccounting: usage.inputAccounting ?? "unspecified",
    inputTokens: number("inputTokens"),
    outputTokens: number("outputTokens"),
    cachedTokens: number("cachedTokens"),
    costEstimate: {
      source: "engine-reported-estimate",
      amount: usage.invalidCostFields?.includes("estimatedCost")
        ? { status: "invalid" }
        : usage.estimatedCost === undefined
          ? { status: "unreported" }
          : { status: "reported", value: usage.estimatedCost },
      currency: usage.invalidCostFields?.includes("currency")
        ? { status: "invalid" }
        : usage.currency === undefined
          ? { status: "unreported" }
          : { status: "reported", value: usage.currency },
      billingStatus: "unknown",
    },
    source: "engine-reported",
    runClassification: "unknown",
    billingStatus: "unknown",
    recordedAt: input.recordedAt,
  });
}
function usageRun(tx: UnitOfWorkTransaction, runId: string) {
  return tx.get<UsageRun>(
    `SELECT run.id, run.session_id, run.engine_kind, run.engine_run_id, run.context_snapshot_id, snapshot.id AS snapshot_id,
     CASE WHEN run.context_snapshot_id IS NOT NULL THEN snapshot.project_id ELSE session.project_id END AS project_id
     FROM agent_assistant_runs run JOIN agent_assistant_sessions session ON session.id = run.session_id
     LEFT JOIN agent_context_snapshots snapshot ON snapshot.id = run.context_snapshot_id
     WHERE run.id = ?`,
    runId,
  );
}

export function readAgentUsageScope(tx: UnitOfWorkTransaction, runId: string) {
  const run = usageRun(tx, runId);
  if (!run) return undefined;
  if (run.context_snapshot_id && !run.snapshot_id)
    throw new AgentUsageIntegrityError("运行原上下文快照无法核对。");
  const first = tx.get<{ observation_json: string; content_sha256: string }>(
    "SELECT observation_json, content_sha256 FROM agent_usage_observations WHERE run_id = ? ORDER BY engine_cursor LIMIT 1",
    runId,
  );
  let projectId = run.project_id ?? undefined;
  if (first) {
    let raw: unknown;
    try {
      raw = JSON.parse(first.observation_json);
    } catch {
      throw new AgentUsageIntegrityError("原用量记录格式无法核对。");
    }
    const item = AgentUsageObservationSchema.safeParse(raw);
    if (
      !item.success ||
      item.data.runId !== run.id ||
      item.data.sessionId !== run.session_id ||
      item.data.engineKind !== run.engine_kind ||
      !run.engine_run_id ||
      contentHash(run.engine_run_id, item.data) !== first.content_sha256 ||
      (run.context_snapshot_id && item.data.projectId !== projectId)
    )
      throw new AgentUsageIntegrityError("运行原用量指纹或归属无法核对。");
    projectId = item.data.projectId;
  }
  return AgentRunUsageScopeSchema.parse({
    runId,
    sessionId: run.session_id,
    ...(projectId ? { projectId } : {}),
    origin: run.context_snapshot_id
      ? "frozen-context"
      : first
        ? "first-observation"
        : "unreported-session",
  });
}

/** One owner transaction records a sanitized observation, durable event and cursor. */
export function recordAgentUsage(
  tx: UnitOfWorkTransaction,
  input: {
    runId: string;
    engineRunId: string;
    engineKind: AgentEngineKind;
    cursor: number;
    usage: unknown;
    recordedAt: string;
  },
): void {
  const run = usageRun(tx, input.runId);
  if (
    !run ||
    run.engine_kind !== input.engineKind ||
    run.engine_run_id !== input.engineRunId
  )
    throw new Error("用量报告不属于当前持久运行身份。");
  const scope = readAgentUsageScope(tx, input.runId)!;
  const observation = createAgentUsageObservation({
    runId: run.id,
    sessionId: run.session_id,
    ...(scope.projectId ? { projectId: scope.projectId } : {}),
    engineKind: run.engine_kind,
    cursor: input.cursor,
    usage: input.usage,
    recordedAt: input.recordedAt,
  });
  const hash = contentHash(input.engineRunId, observation);
  const prior = tx.get<{ content_sha256: string; observation_json: string }>(
    "SELECT content_sha256, observation_json FROM agent_usage_observations WHERE run_id = ? AND engine_cursor = ?",
    run.id,
    input.cursor,
  );
  if (prior) {
    const original = AgentUsageObservationSchema.parse(
      JSON.parse(prior.observation_json),
    );
    // Old immutable observations deliberately had no cost representation.
    // Replay their original normalized fields without backfilling the newly
    // reported estimate. Every new observation has explicit missing states,
    // so a changed estimate cannot hide behind this compatibility branch.
    const { costEstimate: _newCost, ...legacyObservation } = observation;
    const replayHash = original.costEstimate
      ? hash
      : contentHash(input.engineRunId, legacyObservation);
    if (
      prior.content_sha256 !== replayHash ||
      contentHash(input.engineRunId, original) !== replayHash
    )
      throw new Error("原用量游标内容不同，不能覆盖或重复计量。");
    return;
  }
  tx.run(
    "INSERT INTO agent_usage_observations(run_id, engine_cursor, observation_json, content_sha256) VALUES (?, ?, ?, ?)",
    run.id,
    input.cursor,
    JSON.stringify(observation),
    hash,
  );
  tx.run(
    "UPDATE agent_assistant_runs SET last_engine_cursor = MAX(last_engine_cursor, ?), updated_at = ? WHERE id = ?",
    input.cursor,
    input.recordedAt,
    run.id,
  );
  tx.append({
    type: "agents.usage-observed.v1",
    pluginId: "agents",
    aggregateType: "agent-run",
    aggregateId: run.id,
    aggregateVersion: input.cursor,
    payload: { ...observation },
  });
}

export class AgentUsageCursorError extends Error {}
export class AgentUsageIntegrityError extends Error {}
/** No inferred historical zero or totals; engine cursors are scoped to the original run. */
export function readAgentUsagePage(
  tx: UnitOfWorkTransaction,
  runId: string,
  projectId: string | undefined,
  cursor: number | undefined,
  limit: number,
): AgentUsageObservationPage | undefined {
  const run = usageRun(tx, runId);
  if (!run || readAgentUsageScope(tx, runId)?.projectId !== projectId)
    return undefined;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 1))
  )
    throw new AgentUsageCursorError("用量分页参数无效。");
  if (
    cursor !== undefined &&
    !tx.get(
      "SELECT engine_cursor FROM agent_usage_observations WHERE run_id = ? AND engine_cursor = ?",
      runId,
      cursor,
    )
  )
    throw new AgentUsageCursorError("用量游标不属于当前运行。");
  const rows = tx.all<{ observation_json: string; content_sha256: string }>(
    "SELECT observation_json, content_sha256 FROM agent_usage_observations WHERE run_id = ? AND (? IS NULL OR engine_cursor < ?) ORDER BY engine_cursor DESC LIMIT ?",
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
      throw new AgentUsageIntegrityError("原用量记录格式无法核对。");
    }
    const parsed = AgentUsageObservationSchema.safeParse(raw);
    if (!parsed.success)
      throw new AgentUsageIntegrityError("原用量记录格式无法核对。");
    const item = parsed.data;
    if (
      !run.engine_run_id ||
      contentHash(run.engine_run_id, item) !== row.content_sha256
    )
      throw new AgentUsageIntegrityError(
        "原用量记录指纹已变化，不能作为当前报告读取。",
      );
    return item;
  });
  if (
    items.some(
      (item) =>
        item.runId !== runId ||
        item.sessionId !== run.session_id ||
        item.projectId !== projectId ||
        item.engineKind !== run.engine_kind,
    )
  )
    throw new AgentUsageIntegrityError("用量持久记录归属无法核对。");
  const count = tx.get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM agent_usage_observations WHERE run_id = ?",
    runId,
  )!.count;
  return AgentUsageObservationPageSchema.parse({
    format: "agent-usage-observation-page-v1",
    runId,
    ...(projectId ? { projectId } : {}),
    observationCount: count,
    coverage: "partial-or-unknown",
    billingStatus: "unknown",
    items,
    ...(rows.length > limit ? { nextCursor: items.at(-1)!.cursor } : {}),
  });
}
