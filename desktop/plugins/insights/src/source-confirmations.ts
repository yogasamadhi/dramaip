import type { DomainEvent } from "@dramaip/contracts";
import {
  CREATIVE_SOURCE_CONFIRMATION_EVENTS,
  CreativeSourceConfirmationFactSchema,
  CreativeSourceConfirmationRecordSchema,
  CreativeSourceConfirmationSummarySchema,
} from "@dramaip/contracts/insights";
import type {
  PluginMigration,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

export const creativeSourceConfirmationMigration: PluginMigration = {
  id: "insights.0008.source-confirmations",
  pluginId: "insights",
  version: "3.0.0-alpha.4",
  dependsOn: ["insights.0007.initial-goals"],
  sql: `CREATE TABLE insights_creative_source_confirmations (
    owner TEXT NOT NULL, source_id TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL UNIQUE, source_cursor INTEGER NOT NULL UNIQUE,
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json)), record_json TEXT NOT NULL CHECK(json_valid(record_json)),
    PRIMARY KEY(owner, source_id)
  ); CREATE INDEX insights_creative_sources_project ON insights_creative_source_confirmations(project_id, source_cursor DESC);`,
};
export function projectCreativeSourceConfirmation(
  tx: UnitOfWorkTransaction,
  event: DomainEvent,
): void {
  const fact = CreativeSourceConfirmationFactSchema.parse(event.payload);
  if (
    event.type !== CREATIVE_SOURCE_CONFIRMATION_EVENTS[fact.owner] ||
    event.pluginId !== fact.owner ||
    (fact.owner === "workspace"
      ? event.aggregateType !== "project" ||
        event.aggregateId !== fact.projectId ||
        event.aggregateVersion !== fact.projectVersion
      : event.aggregateType !== "screenplay-intake" ||
        event.aggregateId !== fact.sourceId ||
        event.aggregateVersion !== 3)
  )
    throw new Error(
      "Source confirmation does not match its committed owner envelope.",
    );
  const record = CreativeSourceConfirmationRecordSchema.parse({
    ...fact,
    eventId: event.eventId,
    cursor: event.cursor,
    occurredAt: event.occurredAt,
  });
  const factJSON = JSON.stringify(fact),
    recordJSON = JSON.stringify(record);
  const existing = tx.all<{
    owner: string;
    source_id: string;
    project_id: string;
    event_id: string;
    source_cursor: number;
    fact_json: string;
    record_json: string;
  }>(
    "SELECT * FROM insights_creative_source_confirmations WHERE (owner=? AND source_id=?) OR event_id=? OR source_cursor=?",
    fact.owner,
    fact.sourceId,
    event.eventId,
    event.cursor,
  );
  for (const row of existing) {
    if (
      row.owner !== fact.owner ||
      row.source_id !== fact.sourceId ||
      row.project_id !== fact.projectId ||
      row.fact_json !== factJSON ||
      ((row.event_id === event.eventId || row.source_cursor === event.cursor) &&
        row.record_json !== recordJSON)
    )
      throw new Error(
        "An original source scope, identity or receipt cannot be replaced on replay.",
      );
  }
  if (existing.length) return;
  tx.run(
    "INSERT INTO insights_creative_source_confirmations VALUES (?,?,?,?,?,?,?)",
    fact.owner,
    fact.sourceId,
    fact.projectId,
    event.eventId,
    event.cursor,
    factJSON,
    recordJSON,
  );
}
export function measureCreativeSourceConfirmations(
  tx: UnitOfWorkTransaction,
  projectId: string,
) {
  const rows = tx.all<{ record_json: string }>(
    "SELECT record_json FROM insights_creative_source_confirmations WHERE project_id=? ORDER BY source_cursor DESC LIMIT 20",
    projectId,
  );
  const totals = tx.all<{
    workflow_path: "novel" | "adaptation" | null;
    total: number;
  }>(
    "SELECT json_extract(fact_json, '$.workflowPath') AS workflow_path, COUNT(*) AS total FROM insights_creative_source_confirmations WHERE project_id=? GROUP BY workflow_path",
    projectId,
  );
  const items = rows.map((row) => {
    const original = CreativeSourceConfirmationRecordSchema.parse(
      JSON.parse(row.record_json),
    );
    return {
      ...original,
      bindingDisplay: "first-five-original-bindings" as const,
      entries: original.entries.slice(0, 5),
    };
  });
  return CreativeSourceConfirmationSummarySchema.parse({
    historyPolicy: "recorded-owner-source-confirmations-only",
    unit: "owner-and-original-source-id",
    recordedConfirmations: totals.reduce((sum, row) => sum + row.total, 0),
    byWorkflow: (["novel", "adaptation", null] as const).map(
      (workflowPath) => ({
        workflowPath,
        total:
          totals.find((row) => row.workflow_path === workflowPath)?.total ?? 0,
      }),
    ),
    items,
  });
}
