import type { DomainEvent } from "@dramaip/contracts";
import {
  CREATIVE_PLANNING_ADOPTION_EVENTS,
  CreativePlanningAdoptionFactSchema,
  CreativePlanningAdoptionRecordSchema,
  CreativePlanningAdoptionSummarySchema,
  canonicalCreativeMetricJSON,
} from "@dramaip/contracts/insights";
import { NarrativePlanningOperationSchema } from "@dramaip/contracts/creation";
import type {
  PluginMigration,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
export const creativePlanningAdoptionMigration: PluginMigration = {
  id: "insights.0009.planning-adoptions",
  pluginId: "insights",
  version: "3.0.0-alpha.4",
  dependsOn: ["insights.0008.source-confirmations"],
  sql: `CREATE TABLE insights_creative_planning_adoptions (
 owner TEXT NOT NULL, workflow_id TEXT NOT NULL,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 event_id TEXT NOT NULL UNIQUE, source_cursor INTEGER NOT NULL UNIQUE,
 fact_json TEXT NOT NULL CHECK(json_valid(fact_json)), record_json TEXT NOT NULL CHECK(json_valid(record_json)),
 PRIMARY KEY(owner, workflow_id)
 ); CREATE INDEX insights_creative_planning_project ON insights_creative_planning_adoptions(project_id,source_cursor DESC);
 CREATE TABLE insights_creative_planning_records (
 owner TEXT NOT NULL,record_id TEXT NOT NULL,workflow_id TEXT NOT NULL,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 PRIMARY KEY(owner,record_id),
 FOREIGN KEY(owner,workflow_id) REFERENCES insights_creative_planning_adoptions(owner,workflow_id) ON DELETE CASCADE
 ); CREATE TABLE insights_creative_planning_funnel (event_id TEXT PRIMARY KEY,source_cursor INTEGER NOT NULL UNIQUE,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,workflow_id TEXT NOT NULL,value_json TEXT NOT NULL CHECK(json_valid(value_json))); CREATE INDEX insights_creative_planning_funnel_project ON insights_creative_planning_funnel(project_id,source_cursor);`,
};
export function projectCreativePlanningAdoption(
  tx: UnitOfWorkTransaction,
  event: DomainEvent,
) {
  const fact = CreativePlanningAdoptionFactSchema.parse(event.payload);
  const owner = fact.operation === "knowledge-plan" ? "knowledge" : "writing";
  if (
    event.type !== CREATIVE_PLANNING_ADOPTION_EVENTS[owner] ||
    event.pluginId !== owner ||
    event.aggregateType !== "creation" ||
    event.aggregateId !== fact.workflowId ||
    event.aggregateVersion !== 1
  )
    throw new Error(
      "The complete planning batch must match its actual content-owner envelope.",
    );
  const record = CreativePlanningAdoptionRecordSchema.parse({
    owner,
    fact,
    eventId: event.eventId,
    cursor: event.cursor,
    occurredAt: event.occurredAt,
  });
  const same = tx.get<{
    owner: string;
    workflow_id: string;
    project_id: string;
    event_id: string;
    source_cursor: number;
    fact_json: string;
    record_json: string;
  }>(
    "SELECT * FROM insights_creative_planning_adoptions WHERE workflow_id=? OR event_id=? OR source_cursor=?",
    fact.workflowId,
    event.eventId,
    event.cursor,
  );
  if (same) {
    if (
      same.owner !== owner ||
      same.workflow_id !== fact.workflowId ||
      same.project_id !== fact.projectId ||
      same.fact_json !== canonicalCreativeMetricJSON(fact) ||
      ((same.event_id === event.eventId ||
        same.source_cursor === event.cursor) &&
        same.record_json !== JSON.stringify(record))
    )
      throw new Error(
        "An actual adopted planning batch is immutable and cannot change scope or material.",
      );
    return;
  }
  tx.run(
    "INSERT INTO insights_creative_planning_adoptions VALUES (?,?,?,?,?,?,?)",
    owner,
    fact.workflowId,
    fact.projectId,
    event.eventId,
    event.cursor,
    canonicalCreativeMetricJSON(fact),
    JSON.stringify(record),
  );
  for (const item of fact.records)
    tx.run(
      "INSERT INTO insights_creative_planning_records VALUES (?,?,?,?)",
      owner,
      item.id,
      fact.workflowId,
      fact.projectId,
    );
}
export function readCreativePlanningAdoptions(
  tx: UnitOfWorkTransaction,
  projectId: string,
) {
  return tx
    .all<{
      owner: string;
      workflow_id: string;
      project_id: string;
      event_id: string;
      source_cursor: number;
      fact_json: string;
      record_json: string;
    }>(
      "SELECT * FROM insights_creative_planning_adoptions WHERE project_id=? ORDER BY source_cursor",
      projectId,
    )
    .map((row) => {
      const record = CreativePlanningAdoptionRecordSchema.parse(
        JSON.parse(row.record_json),
      );
      if (
        record.owner !== row.owner ||
        record.fact.workflowId !== row.workflow_id ||
        record.fact.projectId !== projectId ||
        row.project_id !== projectId ||
        record.eventId !== row.event_id ||
        record.cursor !== row.source_cursor ||
        canonicalCreativeMetricJSON(record.fact) !== row.fact_json
      )
        throw new Error(
          "The owned planning projection cannot replace historical scope, envelope or material.",
        );
      return record;
    });
}
export function measureCreativePlanningAdoptions(
  tx: UnitOfWorkTransaction,
  projectId: string,
) {
  const records = readCreativePlanningAdoptions(tx, projectId);
  return CreativePlanningAdoptionSummarySchema.parse({
    historyPolicy: "recorded-complete-owner-planning-batches-only",
    countingUnit: "adopted-planning-batch-not-individual-records",
    recordedBatches: records.length,
    counts: NarrativePlanningOperationSchema.options.map((operation) => ({
      operation,
      batches: records.filter((record) => record.fact.operation === operation)
        .length,
      actualRecords: records
        .filter((record) => record.fact.operation === operation)
        .reduce((sum, record) => sum + record.fact.records.length, 0),
    })),
    items: records
      .slice(-20)
      .reverse()
      .map((record) => ({
        ...record,
        fact: {
          ...record.fact,
          recordDisplay: "first-five-actual-records",
          recordCount: record.fact.records.length,
          records: record.fact.records.slice(0, 5),
        },
      })),
  });
}
