import type { DomainEvent } from "@dramaip/contracts";
import {
  CREATIVE_FUNNEL_EVENTS,
  CREATIVE_OWNER_REJECTION_EVENT,
  CreativeFunnelRecordSchema,
  CreativeOutcomeRecordSchema,
  canonicalCreativeMetricJSON,
  measureCreativeFunnelRecords,
  type CreativeFunnelSummary,
} from "@dramaip/contracts/insights";
import type {
  PluginMigration,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

export const creativeFunnelMigration: PluginMigration = {
  id: "insights.0003.creative-funnel",
  pluginId: "insights",
  version: "3.0.0-alpha.3",
  dependsOn: ["insights.0002.creative-outcomes"],
  sql: `CREATE TABLE insights_creative_funnel_events (
    event_id TEXT PRIMARY KEY, source_cursor INTEGER NOT NULL UNIQUE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workflow_id TEXT NOT NULL, value_json TEXT NOT NULL
  );
  CREATE INDEX insights_creative_funnel_project ON insights_creative_funnel_events(project_id, source_cursor);`,
};
export function projectCreativeFunnel(
  tx: UnitOfWorkTransaction,
  event: DomainEvent,
) {
  const fact = CreativeFunnelRecordSchema.shape.fact.parse(event.payload);
  const expected =
    fact.kind === "candidate-ready"
      ? CREATIVE_FUNNEL_EVENTS.candidate
      : fact.kind === "owner-rejection"
        ? CREATIVE_OWNER_REJECTION_EVENT
        : fact.kind === "request"
          ? CREATIVE_FUNNEL_EVENTS.request
          : fact.kind === "source-conflict"
            ? CREATIVE_FUNNEL_EVENTS.sourceConflict
            : CREATIVE_FUNNEL_EVENTS.state;
  if (
    event.type !== expected ||
    (fact.kind === "owner-rejection"
      ? event.pluginId !== fact.ownerRejection.owner ||
        event.aggregateType !== fact.ownerRejection.aggregateType ||
        event.aggregateId !== fact.candidate.id ||
        event.aggregateVersion !== fact.ownerRejection.stateVersion
      : event.pluginId !== "automation" ||
        event.aggregateType !== "creation" ||
        event.aggregateId !== fact.workflowId ||
        event.aggregateVersion !== fact.workflowVersion)
  )
    throw new Error(
      "Creative funnel owner and committed workflow envelope do not match.",
    );
  const record = CreativeFunnelRecordSchema.parse({
    fact,
    eventId: event.eventId,
    cursor: event.cursor,
    occurredAt: event.occurredAt,
  });
  const existing = tx.get<{ value_json: string }>(
    "SELECT value_json FROM insights_creative_funnel_events WHERE event_id = ? OR source_cursor = ?",
    event.eventId,
    event.cursor,
  );
  if (existing) {
    if (existing.value_json !== JSON.stringify(record))
      throw new Error(
        "A committed creative funnel fact cannot be replaced on replay.",
      );
    return;
  }
  const workflowRecords = tx
    .all<{ value_json: string }>(
      "SELECT value_json FROM insights_creative_funnel_events WHERE project_id = ? AND workflow_id = ? ORDER BY source_cursor",
      fact.projectId,
      fact.workflowId,
    )
    .map((row) => CreativeFunnelRecordSchema.parse(JSON.parse(row.value_json)));
  if (fact.kind === "owner-rejection") {
    // An owner decision identity is global, not movable to another project or
    // workflow merely by changing the declared scope on a duplicate event.
    const priorRow = tx.get<{ value_json: string }>(
      "SELECT value_json FROM insights_creative_funnel_events WHERE json_extract(value_json, '$.fact.kind') = 'owner-rejection' AND json_extract(value_json, '$.fact.candidate.id') = ? AND json_extract(value_json, '$.fact.ownerRejection.aggregateType') = ? AND json_extract(value_json, '$.fact.ownerRejection.stateVersion') = ?",
      fact.candidate.id,
      fact.ownerRejection.aggregateType,
      fact.ownerRejection.stateVersion,
    );
    if (priorRow) {
      const prior = CreativeFunnelRecordSchema.parse(
        JSON.parse(priorRow.value_json),
      );
      if (
        canonicalCreativeMetricJSON(prior.fact) !==
        canonicalCreativeMetricJSON(fact)
      )
        throw new Error(
          "A native owner rejection is immutable and cannot be replaced.",
        );
      return;
    }
    // The native owner does not own workflow request receipts. Preserve its
    // real history, and join only exact prior receipts when measuring it.
  } else if (fact.kind !== "request") {
    const request = workflowRecords
      .map((record) => record.fact)
      .find((item) => item.kind === "request");
    if (
      !request ||
      request.metric !== fact.metric ||
      request.targetKey !== fact.targetKey ||
      request.requestedAt !== fact.requestedAt
    )
      throw new Error(
        "Candidate and state facts require their exact previously committed request.",
      );
  }
  if (fact.kind === "source-conflict") {
    if (
      !workflowRecords.some(
        (record) =>
          record.fact.kind === "candidate-ready" &&
          record.cursor < event.cursor &&
          record.fact.workflowVersion < fact.workflowVersion &&
          canonicalCreativeMetricJSON(record.fact.candidate) ===
            canonicalCreativeMetricJSON(fact.candidate),
      )
    )
      throw new Error(
        "Source rejection requires the exact prior original candidate receipt.",
      );
  }
  tx.run(
    "INSERT INTO insights_creative_funnel_events VALUES (?, ?, ?, ?, ?)",
    event.eventId,
    event.cursor,
    fact.projectId,
    fact.workflowId,
    JSON.stringify(record),
  );
}
export function measureCreativeFunnel(
  tx: UnitOfWorkTransaction,
  projectId: string,
): CreativeFunnelSummary {
  const facts = tx
    .all<{ value_json: string }>(
      "SELECT value_json FROM insights_creative_funnel_events WHERE project_id = ? ORDER BY source_cursor",
      projectId,
    )
    .map((row) => CreativeFunnelRecordSchema.parse(JSON.parse(row.value_json)));
  const adopts = tx
    .all<{ value_json: string }>(
      "SELECT value_json FROM insights_creative_outcome_events WHERE project_id = ? ORDER BY source_cursor",
      projectId,
    )
    .map((row) =>
      CreativeOutcomeRecordSchema.parse(JSON.parse(row.value_json)),
    );
  return measureCreativeFunnelRecords(facts, adopts);
}
