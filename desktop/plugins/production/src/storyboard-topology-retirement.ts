import type { PluginMigration } from "@dramaip/plugin-api/internal";

/** Forward-only reason capture; historical retirement remains the original
 * scene-shot protocol. Actual row fields and media ancestry are untouched. */
export const storyboardTopologyRetirementMigration: PluginMigration = {
  id: "production.0016.scene-topology-retirement",
  pluginId: "production",
  version: "3.0.0-alpha.4",
  dependsOn: ["production.0015.author-topology-revisions"],
  sql: `ALTER TABLE production_records ADD COLUMN retired_reason TEXT CHECK(retired_reason IS NULL OR retired_reason IN ('author-scene-shot-plan', 'author-scene-topology-plan'));`,
};
