import type { PluginMigration } from "@dramaip/plugin-api/internal";

export const agentMigrations = [
  {
    id: "agents.0001.provider-configurations",
    pluginId: "agents",
    version: "3.0.0-alpha.2",
    dependsOn: ["foundation.0001.runtime-ledger"],
    sql: `
      CREATE TABLE IF NOT EXISTS agent_provider_configurations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_provider_configurations_updated_at
        ON agent_provider_configurations(updated_at DESC, id);
    `,
  },
  {
    id: "agents.0002.provider-settings",
    pluginId: "agents",
    version: "3.0.0-alpha.2",
    dependsOn: ["agents.0001.provider-configurations"],
    sql: `
      CREATE TABLE IF NOT EXISTS agent_provider_settings (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        provider_id TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    id: "agents.0003.engine-settings",
    pluginId: "agents",
    version: "3.0.0-alpha.2",
    dependsOn: ["agents.0002.provider-settings"],
    sql: `
      CREATE TABLE IF NOT EXISTS agent_global_settings (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        default_engine_kind TEXT NOT NULL,
        default_model_json TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_project_settings (
        project_id TEXT PRIMARY KEY,
        default_engine_kind TEXT NOT NULL,
        default_model_json TEXT,
        assistant_mode TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    id: "agents.0004.assistant-conversations",
    pluginId: "agents",
    version: "3.0.0-alpha.2",
    dependsOn: ["agents.0003.engine-settings"],
    sql: `
      CREATE TABLE IF NOT EXISTS agent_assistant_sessions (
        id TEXT PRIMARY KEY,
        engine_session_id TEXT NOT NULL,
        engine_kind TEXT NOT NULL,
        project_id TEXT,
        surface TEXT NOT NULL,
        chapter_id TEXT,
        task_type TEXT,
        title TEXT,
        model_json TEXT,
        status TEXT NOT NULL,
        archived_at TEXT,
        last_opened_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_assistant_sessions_opened_at
        ON agent_assistant_sessions(archived_at, last_opened_at DESC, id);
      CREATE INDEX IF NOT EXISTS agent_assistant_sessions_project_id
        ON agent_assistant_sessions(project_id, archived_at, last_opened_at DESC);

      CREATE TABLE IF NOT EXISTS agent_assistant_turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        run_id TEXT,
        user_message TEXT NOT NULL,
        project_id TEXT,
        chapter_id TEXT,
        selection_json TEXT,
        route_json TEXT,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_assistant_turns_session_created_at
        ON agent_assistant_turns(session_id, created_at, id);

      CREATE TABLE IF NOT EXISTS agent_assistant_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        engine_kind TEXT NOT NULL,
        status TEXT NOT NULL,
        model_json TEXT,
        turn_id TEXT,
        chapter_id TEXT,
        error TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_assistant_runs_session_created_at
        ON agent_assistant_runs(session_id, created_at, id);

      CREATE TABLE IF NOT EXISTS agent_assistant_items (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        content TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(run_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS agent_assistant_items_run_sequence
        ON agent_assistant_items(run_id, sequence);
    `,
  },
  {
    id: "agents.0005.codex-custom-provider-settings",
    pluginId: "agents",
    version: "3.0.0-alpha.2",
    dependsOn: ["agents.0004.assistant-conversations"],
    sql: `
      CREATE TABLE IF NOT EXISTS agent_codex_custom_provider_settings (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        provider_id TEXT NOT NULL,
        protocol TEXT NOT NULL CHECK(protocol IN ('responses', 'chat_completions')),
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    id: "agents.0006.alpha3-agent-runtime-reset",
    pluginId: "agents",
    version: "3.0.0-alpha.3",
    dependsOn: ["agents.0005.codex-custom-provider-settings"],
    // Alpha.3 preserves provider settings and opaque credentials while
    // resetting execution/evaluation state from alpha.2.
    sql: `
      DELETE FROM agent_assistant_items;
      DELETE FROM agent_assistant_runs;
      DELETE FROM agent_assistant_turns;
      DELETE FROM agent_assistant_sessions;
      UPDATE agent_global_settings SET default_engine_kind = 'pi';
      UPDATE agent_project_settings SET default_engine_kind = 'pi';
      DROP TABLE IF EXISTS agent_experiment_runs;
      DROP TABLE IF EXISTS agent_experiment_groups;
      DROP TABLE IF EXISTS agent_evaluation_reviews;
      DROP TABLE IF EXISTS agent_evaluation_candidates;
      DROP TABLE IF EXISTS agent_evaluations;
      CREATE TABLE IF NOT EXISTS agent_capability_grants (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        capabilities_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_capability_grants_run_id
        ON agent_capability_grants(run_id, expires_at);
      CREATE TABLE IF NOT EXISTS agent_evaluations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        prompt TEXT NOT NULL,
        context_snapshot_json TEXT NOT NULL,
        status TEXT NOT NULL,
        revealed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_evaluation_candidates (
        id TEXT PRIMARY KEY,
        evaluation_id TEXT NOT NULL,
        candidate TEXT NOT NULL CHECK(candidate IN ('a', 'b', 'c')),
        engine_kind TEXT NOT NULL CHECK(engine_kind IN ('pi', 'codex', 'grok')),
        run_id TEXT NOT NULL,
        status TEXT NOT NULL,
        output_json TEXT,
        metrics_json TEXT NOT NULL,
        UNIQUE(evaluation_id, candidate),
        UNIQUE(evaluation_id, engine_kind)
      );
      CREATE TABLE IF NOT EXISTS agent_evaluation_reviews (
        evaluation_id TEXT PRIMARY KEY,
        preferred_candidate TEXT NOT NULL CHECK(preferred_candidate IN ('a', 'b', 'c', 'tie')),
        accepted INTEGER NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    id: "agents.0007.run-recovery-state",
    pluginId: "agents",
    version: "3.0.0-alpha.3",
    dependsOn: ["agents.0006.alpha3-agent-runtime-reset"],
    sql: `
      ALTER TABLE agent_assistant_runs ADD COLUMN engine_run_id TEXT;
      ALTER TABLE agent_assistant_runs ADD COLUMN last_engine_cursor INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE agent_assistant_runs ADD COLUMN engine_generation INTEGER;
      ALTER TABLE agent_assistant_runs ADD COLUMN checkpoint_json TEXT;
      ALTER TABLE agent_assistant_runs ADD COLUMN recovery_attempts INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE agent_assistant_runs ADD COLUMN recovery_error TEXT;
      UPDATE agent_assistant_runs SET status = 'completed' WHERE status = 'succeeded';
      UPDATE agent_assistant_runs SET status = 'aborted' WHERE status = 'canceled';
      CREATE INDEX IF NOT EXISTS agent_assistant_runs_recovery
        ON agent_assistant_runs(status, engine_kind, updated_at);
    `,
  },
  {
    id: "agents.0008.langgraph-four-engine",
    pluginId: "agents",
    version: "3.0.0-alpha.3",
    dependsOn: ["agents.0007.run-recovery-state"],
    sql: `
      ALTER TABLE agent_evaluation_candidates
        RENAME TO agent_evaluation_candidates_three_engine;
      CREATE TABLE agent_evaluation_candidates (
        id TEXT PRIMARY KEY,
        evaluation_id TEXT NOT NULL,
        candidate TEXT NOT NULL CHECK(candidate IN ('a', 'b', 'c', 'd')),
        engine_kind TEXT NOT NULL CHECK(engine_kind IN ('pi', 'codex', 'grok', 'langgraph')),
        run_id TEXT NOT NULL,
        status TEXT NOT NULL,
        output_json TEXT,
        metrics_json TEXT NOT NULL,
        UNIQUE(evaluation_id, candidate),
        UNIQUE(evaluation_id, engine_kind)
      );
      INSERT INTO agent_evaluation_candidates(
        id, evaluation_id, candidate, engine_kind, run_id, status,
        output_json, metrics_json
      )
      SELECT id, evaluation_id, candidate, engine_kind, run_id, status,
             output_json, metrics_json
      FROM agent_evaluation_candidates_three_engine;
      DROP TABLE agent_evaluation_candidates_three_engine;

      ALTER TABLE agent_evaluation_reviews
        RENAME TO agent_evaluation_reviews_three_engine;
      CREATE TABLE agent_evaluation_reviews (
        evaluation_id TEXT PRIMARY KEY,
        preferred_candidate TEXT NOT NULL CHECK(preferred_candidate IN ('a', 'b', 'c', 'd', 'tie')),
        accepted INTEGER NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO agent_evaluation_reviews(
        evaluation_id, preferred_candidate, accepted, notes, created_at
      )
      SELECT evaluation_id, preferred_candidate, accepted, notes, created_at
      FROM agent_evaluation_reviews_three_engine;
      DROP TABLE agent_evaluation_reviews_three_engine;
    `,
  },
] as const satisfies readonly PluginMigration[];
