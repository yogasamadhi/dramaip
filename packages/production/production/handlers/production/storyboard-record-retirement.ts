import type { PluginMigration } from "@dramaip/plugin-api/internal";

/** Forward-only: retired rows, their payloads and dependent media survive.
 * Historical formal packages continue to reference their original identity. */
export const storyboardRecordRetirementMigration: PluginMigration = {
  id: "production.0012.storyboard-record-retirement",
  pluginId: "production",
  version: "3.0.0-alpha.4",
  dependsOn: ["production.0011.adaptation-strategies"],
  sql: `ALTER TABLE production_records ADD COLUMN retired_result_id TEXT;
    ALTER TABLE production_records ADD COLUMN retired_at TEXT;
    CREATE INDEX production_active_records ON production_records(project_id, kind, parent_id, order_index) WHERE retired_result_id IS NULL;`,
};
