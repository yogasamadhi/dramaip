import type { DomainEvent } from "@dramaip/contracts";
import {
  CREATIVE_INITIAL_GOAL_EVENT,
  CreativeInitialGoalFactSchema,
  CreativeInitialGoalRecordSchema,
  CreativeInitialGoalSummarySchema,
} from "@dramaip/contracts/insights";
import type {
  PluginMigration,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

export const creativeInitialGoalMigration: PluginMigration = {
  id: "insights.0007.initial-goals",
  pluginId: "insights",
  version: "3.0.0-alpha.4",
  dependsOn: ["insights.0006.quality-associations"],
  sql: `CREATE TABLE insights_creative_initial_goals (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL UNIQUE, source_cursor INTEGER NOT NULL UNIQUE,
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json)),
    record_json TEXT NOT NULL CHECK(json_valid(record_json))
  );`,
};

/** Immutable initial request proof, never the project's current author intent. */
export function projectCreativeInitialGoal(
  tx: UnitOfWorkTransaction,
  event: DomainEvent,
): void {
  const fact = CreativeInitialGoalFactSchema.parse(event.payload);
  if (
    event.type !== CREATIVE_INITIAL_GOAL_EVENT ||
    event.pluginId !== "workspace" ||
    event.aggregateType !== "project" ||
    event.aggregateId !== fact.projectId ||
    event.aggregateVersion !== fact.projectVersion
  )
    throw new Error(
      "Initial goal does not match its committed owner envelope.",
    );
  const record = CreativeInitialGoalRecordSchema.parse({
    ...fact,
    eventId: event.eventId,
    cursor: event.cursor,
    occurredAt: event.occurredAt,
  });
  const factJSON = JSON.stringify(fact);
  const recordJSON = JSON.stringify(record);
  const existing = tx.all<{
    project_id: string;
    event_id: string;
    source_cursor: number;
    fact_json: string;
    record_json: string;
  }>(
    "SELECT * FROM insights_creative_initial_goals WHERE project_id=? OR event_id=? OR source_cursor=?",
    fact.projectId,
    event.eventId,
    event.cursor,
  );
  for (const row of existing)
    if (
      row.project_id !== fact.projectId ||
      row.fact_json !== factJSON ||
      ((row.event_id === event.eventId || row.source_cursor === event.cursor) &&
        row.record_json !== recordJSON)
    )
      throw new Error(
        "An initial goal or original receipt cannot be replaced on replay.",
      );
  // A repeated semantic fact preserves the first actual event, cursor and time.
  if (existing.length) return;
  tx.run(
    "INSERT INTO insights_creative_initial_goals VALUES (?,?,?,?,?)",
    fact.projectId,
    event.eventId,
    event.cursor,
    factJSON,
    recordJSON,
  );
}

export function measureCreativeInitialGoals(
  tx: UnitOfWorkTransaction,
  projectId: string,
) {
  const row = tx.get<{ record_json: string }>(
    "SELECT record_json FROM insights_creative_initial_goals WHERE project_id=?",
    projectId,
  );
  const items = row
    ? [CreativeInitialGoalRecordSchema.parse(JSON.parse(row.record_json))]
    : [];
  return CreativeInitialGoalSummarySchema.parse({
    historyPolicy: "recorded-explicit-initial-goals-only",
    recordedProjects: items.length,
    byWorkflow: (["novel", "adaptation"] as const).map((workflowPath) => ({
      workflowPath,
      total: items.filter((item) => item.workflowPath === workflowPath).length,
    })),
    items,
  });
}
