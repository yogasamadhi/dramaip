import type { AgentEngineKind } from "@dramaip/contracts";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import {
  AGENT_RUNTIME_DESCRIPTORS,
  createHostAgentRuntime,
} from "@dramaip/desktop-host";
import type { PluginContext, UnitOfWork } from "@dramaip/plugin-api/internal";

interface RecoverableRunRow {
  id: string;
  session_id: string;
  engine_kind: string;
  status: string;
  engine_run_id: string | null;
  checkpoint_json: string | null;
  recovery_attempts: number;
  engine_session_id?: string;
  last_engine_cursor?: number;
  engine_generation?: number | null;
}

/** Reconciles recoverable Runs after each observed Host/Engine generation. */
export async function recoverAvailableAgentRuns(
  pluginContext: PluginContext,
  host: DesktopHostClient | undefined,
  isStopping: () => boolean = () => false,
): Promise<void> {
  if (!host || isStopping()) return;
  // Native disposal deactivates service lookup before effects finish draining.
  // Keep the original owned resource for already accepted recovery bookkeeping.
  const uow = pluginContext.uow;
  const runs = uow.execute((transaction) =>
    transaction.all<RecoverableRunRow>(
      `SELECT r.id, r.session_id, r.engine_kind, r.status, r.engine_run_id,
              r.checkpoint_json, r.recovery_attempts, r.last_engine_cursor, r.engine_generation,
              s.engine_session_id
       FROM agent_assistant_runs r
       JOIN agent_assistant_sessions s ON s.id = r.session_id
       WHERE r.status IN ('recoverable', 'running', 'committing')
       ORDER BY r.created_at, r.id`,
    ),
  );
  for (const run of runs) {
    if (isStopping()) return;
    if (!run.engine_run_id || !run.engine_session_id) {
      updateRecoveryStatus(
        uow,
        run.id,
        "orphaned",
        "Engine run handle is missing.",
      );
      continue;
    }
    const kind = run.engine_kind as AgentEngineKind;
    const runtime = createHostAgentRuntime(host, kind);
    let recoveryAccepted = false;
    try {
      const health = await runtime.health();
      if (isStopping()) return;
      if (!health.healthy || !health.configured) continue;
      // A different engine becoming ready must not recover a live run owned by
      // this generation. Startup already marks stale runs as recoverable.
      if (
        run.status !== "recoverable" &&
        run.engine_generation === health.generation
      )
        continue;
      recoveryAccepted = true;
      const recovered = await runtime.recoverRun({
        session: {
          sessionId: run.session_id,
          engineSessionId: run.engine_session_id,
        },
        run: { runId: run.id, engineRunId: run.engine_run_id },
        afterCursor: Number(run.last_engine_cursor ?? 0),
      });
      if (recovered.disposition === "missing") {
        updateRecoveryStatus(
          uow,
          run.id,
          "orphaned",
          "Engine no longer recognizes the persisted run handle.",
        );
        continue;
      }
      if (recovered.disposition === "resumed") {
        updateRecoveryStatus(uow, run.id, "running", null);
        continue;
      }
      const now = new Date().toISOString();
      uow.execute((transaction) => {
        transaction.run(
          `UPDATE agent_assistant_runs
           SET status = 'completed', checkpoint_json = ?, last_engine_cursor = ?,
               recovery_error = NULL, completed_at = COALESCE(completed_at, ?), updated_at = ?
           WHERE id = ? AND status IN ('recoverable', 'running', 'committing')`,
          JSON.stringify(recovered.result),
          recovered.finalCursor,
          now,
          now,
          run.id,
        );
        transaction.run(
          `INSERT OR IGNORE INTO agent_assistant_items(
            id, run_id, sequence, type, status, payload_json, created_at, updated_at
          ) VALUES (?, ?, 2147483647, 'result', 'completed', ?, ?, ?)`,
          `${run.id}:recovered-result`,
          run.id,
          JSON.stringify(recovered.result),
          now,
          now,
        );
        transaction.run(
          "UPDATE agent_assistant_turns SET status = 'succeeded', error = NULL, updated_at = ? WHERE run_id = ?",
          now,
          run.id,
        );
        transaction.run(
          "UPDATE agent_assistant_sessions SET status = 'idle', updated_at = ?, last_opened_at = ? WHERE id = ?",
          now,
          now,
          run.session_id,
        );
      });
    } catch (error) {
      if (isStopping() && !recoveryAccepted) return;
      updateRecoveryStatus(
        uow,
        run.id,
        "recoverable",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

function updateRecoveryStatus(
  uow: UnitOfWork,
  runId: string,
  status: "interrupted" | "orphaned" | "recoverable" | "running",
  error: string | null,
): void {
  uow.execute((transaction) =>
    transaction.run(
      `UPDATE agent_assistant_runs
       SET status = ?, recovery_attempts = recovery_attempts + 1,
           recovery_error = ?, updated_at = ? WHERE id = ?`,
      status,
      error,
      new Date().toISOString(),
      runId,
    ),
  );
}

const ACTIVE_AGENT_RUN_STATUSES = [
  "created",
  "queued",
  "preparing",
  "running",
  "waiting_approval",
  "committing",
] as const;

/** Deterministically removes every stale active Run during Runtime startup. */
export function recoverAgentRuns(
  pluginContext: PluginContext,
  host: DesktopHostClient | undefined,
): void {
  const runs = pluginContext.uow.execute((transaction) =>
    transaction.all<RecoverableRunRow>(
      `SELECT id, session_id, engine_kind, status, engine_run_id,
              checkpoint_json, recovery_attempts
       FROM agent_assistant_runs
       WHERE status IN (${ACTIVE_AGENT_RUN_STATUSES.map(() => "?").join(", ")})
       ORDER BY created_at, id`,
      ...ACTIVE_AGENT_RUN_STATUSES,
    ),
  );
  for (const run of runs) {
    const now = new Date().toISOString();
    const hasCommittedResult =
      run.status === "committing" && Boolean(run.checkpoint_json);
    const status = hasCommittedResult
      ? "completed"
      : !host
        ? "recoverable"
        : !run.engine_run_id
          ? "orphaned"
          : AGENT_RUNTIME_DESCRIPTORS[run.engine_kind as AgentEngineKind]
                .capabilities.resume
            ? "recoverable"
            : "interrupted";
    const recoveryError = hasCommittedResult
      ? null
      : status === "recoverable"
        ? host
          ? "Engine session must be resumed from its persisted cursor."
          : "Desktop Host is unavailable; retry after the next Host generation."
        : status === "orphaned"
          ? "The persisted run has no engine run handle."
          : "The engine cannot resume this run.";
    pluginContext.uow.execute((transaction) => {
      transaction.run(
        `UPDATE agent_assistant_runs
         SET status = ?, recovery_attempts = recovery_attempts + 1,
             recovery_error = ?, completed_at = CASE WHEN ? = 'completed'
               THEN COALESCE(completed_at, ?) ELSE completed_at END,
             updated_at = ?
         WHERE id = ?`,
        status,
        recoveryError,
        status,
        now,
        now,
        run.id,
      );
      if (status === "completed") {
        transaction.run(
          "UPDATE agent_assistant_turns SET status = 'succeeded', error = NULL, updated_at = ? WHERE run_id = ?",
          now,
          run.id,
        );
        transaction.run(
          "UPDATE agent_assistant_sessions SET status = 'idle', updated_at = ?, last_opened_at = ? WHERE id = ?",
          now,
          now,
          run.session_id,
        );
      }
      transaction.append({
        type: "agents.run-recovered.v1",
        pluginId: "agents",
        aggregateType: "agent-run",
        aggregateId: run.id,
        aggregateVersion: Math.max(1, Number(run.recovery_attempts ?? 0) + 1),
        payload: { runId: run.id, status },
      });
    });
  }
}
