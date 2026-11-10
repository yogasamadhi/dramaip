import type { PluginMigration } from "@dramaip/plugin-api/internal";

/** Historical SQL and request bytes stay immutable. These three owner-local
 * request ledgers must follow their actual parent when its project is purged.
 * Reversible trash does not delete parents or requests. */
export const productionProjectPurgeRequestMigration: PluginMigration = {
  id: "production.0014.project-purge-requests",
  pluginId: "production",
  version: "3.0.0-alpha.4",
  dependsOn: ["production.0013.ordinary-import-batches"],
  sql: `CREATE TABLE production_diagnosis_requests_next (
    request_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
    diagnosis_id TEXT NOT NULL REFERENCES production_diagnoses(id) ON DELETE CASCADE,
    status INTEGER NOT NULL, detail TEXT
  );
  INSERT INTO production_diagnosis_requests_next SELECT * FROM production_diagnosis_requests;
  DROP TABLE production_diagnosis_requests;
  ALTER TABLE production_diagnosis_requests_next RENAME TO production_diagnosis_requests;
  CREATE TABLE production_season_plan_requests_next (
    request_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
    plan_id TEXT NOT NULL REFERENCES production_season_plans(id) ON DELETE CASCADE,
    status INTEGER NOT NULL, detail TEXT
  );
  INSERT INTO production_season_plan_requests_next SELECT * FROM production_season_plan_requests;
  DROP TABLE production_season_plan_requests;
  ALTER TABLE production_season_plan_requests_next RENAME TO production_season_plan_requests;
  CREATE TABLE production_adaptation_strategy_requests_next (
    request_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
    strategy_id TEXT NOT NULL REFERENCES production_adaptation_strategies(id) ON DELETE CASCADE,
    status INTEGER NOT NULL, detail TEXT
  );
  INSERT INTO production_adaptation_strategy_requests_next SELECT * FROM production_adaptation_strategy_requests;
  DROP TABLE production_adaptation_strategy_requests;
  ALTER TABLE production_adaptation_strategy_requests_next RENAME TO production_adaptation_strategy_requests;`,
};
