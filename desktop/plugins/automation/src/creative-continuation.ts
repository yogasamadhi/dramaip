import { CreativeContinuationFactSchema } from "@dramaip/contracts/insights";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type {
  PluginMigration,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

export const creativeContinuationMigration: PluginMigration = {
  id: "automation.0009.creative-continuation-receipts",
  pluginId: "automation",
  version: "3.0.0-alpha.4",
  dependsOn: ["automation.0008.creative-metric-receipts"],
  sql: `CREATE TABLE automation_creative_continuation_receipts (
    workflow_id TEXT PRIMARY KEY REFERENCES automation_creation_workflows(id) ON DELETE CASCADE,
    request_json TEXT NOT NULL, started_json TEXT
  );`,
};
export function recordContinuationRequest(
  tx: UnitOfWorkTransaction,
  workflow: CreationWorkflow,
) {
  if (!workflow.continuationBasis) return;
  const fact = CreativeContinuationFactSchema.parse({
    kind: "request",
    eventVersion: 1,
    projectId: workflow.input.projectId,
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    operation: workflow.input.operation,
    basis: workflow.continuationBasis,
    requestedAt: workflow.createdAt,
    evidenceKind: "rule",
    modelEvidence: "unknown",
  });
  tx.run(
    "INSERT INTO automation_creative_continuation_receipts(workflow_id, request_json) VALUES (?, ?)",
    workflow.id,
    JSON.stringify(fact),
  );
  tx.append({
    type: "automation.creative-continuation-requested.v1",
    pluginId: "automation",
    aggregateType: "creation",
    aggregateId: workflow.id,
    aggregateVersion: workflow.version,
    payload: fact,
  });
}
/** Call only after the runner accepted its actual managed run/session, not allocation. */
export function recordContinuationStarted(
  tx: UnitOfWorkTransaction,
  workflow: CreationWorkflow,
  accepted: { runId: string; sessionId: string },
) {
  if (
    workflow.stage !== "generating" ||
    workflow.runId !== accepted.runId ||
    workflow.sessionId !== accepted.sessionId
  )
    return;
  const receipt = tx.get<{ request_json: string; started_json: string | null }>(
    "SELECT request_json, started_json FROM automation_creative_continuation_receipts WHERE workflow_id = ?",
    workflow.id,
  );
  if (!receipt || receipt.started_json) return;
  const request = CreativeContinuationFactSchema.parse(
    JSON.parse(receipt.request_json),
  );
  const fact = CreativeContinuationFactSchema.parse({
    ...request,
    kind: "started",
    workflowVersion: workflow.version,
    runId: accepted.runId,
    sessionId: accepted.sessionId,
  });
  tx.run(
    "UPDATE automation_creative_continuation_receipts SET started_json = ? WHERE workflow_id = ? AND started_json IS NULL",
    JSON.stringify(fact),
    workflow.id,
  );
  tx.append({
    type: "automation.creative-continuation-started.v1",
    pluginId: "automation",
    aggregateType: "creation",
    aggregateId: workflow.id,
    aggregateVersion: workflow.version,
    payload: fact,
  });
}
