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
  {
    id: "agents.0009.inspiration-space",
    pluginId: "agents",
    version: "3.0.0-alpha.3",
    dependsOn: ["agents.0008.langgraph-four-engine"],
    sql: `
      ALTER TABLE agent_assistant_sessions ADD COLUMN creative_mode TEXT NOT NULL
        DEFAULT 'free'
        CHECK(creative_mode IN ('free', 'guided', 'character_interview', 'world_simulation', 'conflict_lab'));
      ALTER TABLE agent_assistant_sessions ADD COLUMN parent_session_id TEXT
        REFERENCES agent_assistant_sessions(id) ON DELETE SET NULL;
      ALTER TABLE agent_assistant_sessions ADD COLUMN prompt_policy_version TEXT NOT NULL
        DEFAULT 'inspiration.v1';

      CREATE TABLE agent_inspiration_cards (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES agent_assistant_sessions(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('premise', 'character', 'world', 'conflict', 'scene', 'style', 'question')),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        source_turn_id TEXT REFERENCES agent_assistant_turns(id) ON DELETE SET NULL,
        adopted INTEGER NOT NULL DEFAULT 0 CHECK(adopted IN (0, 1)),
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX agent_inspiration_cards_conversation
        ON agent_inspiration_cards(conversation_id, updated_at DESC, id);

      CREATE TABLE agent_creative_memory_settings (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
        consented_at TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT INTO agent_creative_memory_settings(singleton, enabled, consented_at, updated_at)
        VALUES (1, 0, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
      CREATE TABLE agent_creative_memories (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('preference', 'theme', 'constraint', 'avoid', 'goal')),
        content TEXT NOT NULL,
        confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE agent_creative_memory_sources (
        memory_id TEXT NOT NULL REFERENCES agent_creative_memories(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL REFERENCES agent_assistant_sessions(id) ON DELETE CASCADE,
        turn_id TEXT REFERENCES agent_assistant_turns(id) ON DELETE SET NULL,
        PRIMARY KEY(memory_id, conversation_id)
      );
      CREATE INDEX agent_creative_memory_sources_conversation
        ON agent_creative_memory_sources(conversation_id, memory_id);

      CREATE TABLE agent_inspiration_summaries (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES agent_assistant_sessions(id) ON DELETE CASCADE,
        through_turn_count INTEGER NOT NULL,
        summary TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX agent_inspiration_summaries_conversation
        ON agent_inspiration_summaries(conversation_id, through_turn_count DESC);
      CREATE TABLE agent_inspiration_memory_jobs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES agent_assistant_sessions(id) ON DELETE CASCADE,
        through_turn_count INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed')),
        reason TEXT NOT NULL CHECK(reason IN ('six_turns', 'archive', 'manual')),
        error TEXT,
        model TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX agent_inspiration_memory_jobs_six_turn_once
        ON agent_inspiration_memory_jobs(conversation_id, through_turn_count)
        WHERE reason = 'six_turns';

      CREATE TABLE agent_inspiration_project_previews (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES agent_assistant_sessions(id) ON DELETE CASCADE,
        project_json TEXT NOT NULL,
        card_ids_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'project_created', 'cards_copied', 'completed', 'failed')),
        project_id TEXT,
        copied_count INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX agent_inspiration_project_previews_conversation
        ON agent_inspiration_project_previews(conversation_id, created_at DESC);
    `,
  },
  {
    id: "agents.0010.web-research-consent",
    pluginId: "agents",
    version: "3.0.0-alpha.3",
    dependsOn: ["agents.0009.inspiration-space"],
    sql: `
      ALTER TABLE agent_assistant_sessions ADD COLUMN web_access_mode TEXT NOT NULL
        DEFAULT 'auto' CHECK(web_access_mode IN ('auto', 'off'));
      CREATE TABLE agent_web_research_settings (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        consented_at TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT INTO agent_web_research_settings(singleton, consented_at, updated_at)
        VALUES (1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
    `,
  },
  {
    id: "agents.0011.remove-grok-build",
    pluginId: "agents",
    version: "3.0.0-alpha.3",
    dependsOn: ["agents.0010.web-research-consent"],
    sql: `
      UPDATE agent_global_settings
        SET default_engine_kind = 'pi', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE default_engine_kind = 'grok';
      UPDATE agent_project_settings
        SET default_engine_kind = 'pi', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE default_engine_kind = 'grok';

      UPDATE agent_assistant_turns
        SET status = 'failed', error = 'Grok Build engine was removed.',
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id IN (
          SELECT id FROM agent_assistant_runs
          WHERE engine_kind = 'grok'
            AND status IN ('created', 'queued', 'preparing', 'running', 'waiting_approval', 'committing', 'recoverable')
        );
      UPDATE agent_assistant_runs
        SET status = 'interrupted', recovery_error = 'Grok Build engine was removed.',
            completed_at = COALESCE(completed_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE engine_kind = 'grok'
          AND status IN ('created', 'queued', 'preparing', 'running', 'waiting_approval', 'committing', 'recoverable');
      UPDATE agent_assistant_sessions
        SET status = 'interrupted',
            archived_at = COALESCE(archived_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE engine_kind = 'grok';

      ALTER TABLE agent_evaluation_candidates
        RENAME TO agent_evaluation_candidates_four_engine;
      CREATE TEMP TABLE agent_evaluation_candidate_remap AS
      SELECT evaluation_id,
             candidate AS old_candidate,
             char(96 + ROW_NUMBER() OVER (
               PARTITION BY evaluation_id ORDER BY candidate
             )) AS candidate
      FROM agent_evaluation_candidates_four_engine
      WHERE engine_kind <> 'grok';
      CREATE TABLE agent_evaluation_candidates (
        id TEXT PRIMARY KEY,
        evaluation_id TEXT NOT NULL,
        candidate TEXT NOT NULL CHECK(candidate IN ('a', 'b', 'c')),
        engine_kind TEXT NOT NULL CHECK(engine_kind IN ('pi', 'codex', 'langgraph')),
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
      SELECT source.id, source.evaluation_id, remap.candidate,
             source.engine_kind, source.run_id, source.status,
             source.output_json, source.metrics_json
      FROM agent_evaluation_candidates_four_engine source
      JOIN agent_evaluation_candidate_remap remap
        ON remap.evaluation_id = source.evaluation_id
       AND remap.old_candidate = source.candidate;

      ALTER TABLE agent_evaluation_reviews
        RENAME TO agent_evaluation_reviews_four_engine;
      CREATE TABLE agent_evaluation_reviews (
        evaluation_id TEXT PRIMARY KEY,
        preferred_candidate TEXT NOT NULL CHECK(preferred_candidate IN ('a', 'b', 'c', 'tie')),
        accepted INTEGER NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO agent_evaluation_reviews(
        evaluation_id, preferred_candidate, accepted, notes, created_at
      )
      SELECT review.evaluation_id,
             CASE
               WHEN review.preferred_candidate = 'tie' THEN 'tie'
               ELSE remap.candidate
             END,
             review.accepted, review.notes, review.created_at
      FROM agent_evaluation_reviews_four_engine review
      LEFT JOIN agent_evaluation_candidate_remap remap
        ON remap.evaluation_id = review.evaluation_id
       AND remap.old_candidate = review.preferred_candidate
      WHERE review.preferred_candidate = 'tie' OR remap.candidate IS NOT NULL;

      UPDATE agent_evaluations
        SET status = 'ready_for_review', revealed_at = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id IN (
          SELECT review.evaluation_id
          FROM agent_evaluation_reviews_four_engine review
          LEFT JOIN agent_evaluation_candidate_remap remap
            ON remap.evaluation_id = review.evaluation_id
           AND remap.old_candidate = review.preferred_candidate
          WHERE review.preferred_candidate <> 'tie' AND remap.candidate IS NULL
        );
      UPDATE agent_evaluations
        SET status = 'failed', revealed_at = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE status IN ('queued', 'running')
           OR NOT EXISTS (
             SELECT 1 FROM agent_evaluation_candidates candidate
             WHERE candidate.evaluation_id = agent_evaluations.id
           );

      DROP TABLE agent_evaluation_reviews_four_engine;
      DROP TABLE agent_evaluation_candidates_four_engine;
      DROP TABLE agent_evaluation_candidate_remap;
    `,
  },
  {
    id: "agents.0012.context-policies-and-snapshots",
    pluginId: "agents",
    version: "3.0.0-alpha.3",
    dependsOn: ["agents.0011.remove-grok-build"],
    sql: `
      CREATE TABLE agent_context_policy_sets (
        project_id TEXT PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE agent_context_policies (
        project_id TEXT,
        field_path TEXT NOT NULL,
        mode TEXT NOT NULL CHECK(mode IN ('auto', 'always', 'never')),
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(project_id, field_path)
      );
      CREATE TABLE agent_context_previews (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        input_json TEXT NOT NULL,
        entries_json TEXT NOT NULL,
        token_budget INTEGER NOT NULL CHECK(token_budget > 0),
        estimated_tokens INTEGER NOT NULL CHECK(estimated_tokens >= 0),
        destination_json TEXT NOT NULL,
        final_prompt TEXT NOT NULL,
        manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256) = 64),
        version INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK(status IN ('pending', 'frozen', 'expired')),
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX agent_context_previews_project
        ON agent_context_previews(project_id, created_at DESC, id);
      CREATE TABLE agent_context_snapshots (
        id TEXT PRIMARY KEY,
        preview_id TEXT NOT NULL UNIQUE
          REFERENCES agent_context_previews(id) ON DELETE RESTRICT,
        project_id TEXT,
        entries_json TEXT NOT NULL,
        token_budget INTEGER NOT NULL CHECK(token_budget > 0),
        estimated_tokens INTEGER NOT NULL CHECK(estimated_tokens >= 0),
        destination_json TEXT NOT NULL,
        final_prompt TEXT NOT NULL,
        manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256) = 64),
        final_prompt_sha256 TEXT NOT NULL CHECK(length(final_prompt_sha256) = 64),
        created_at TEXT NOT NULL
      );
      CREATE INDEX agent_context_snapshots_project
        ON agent_context_snapshots(project_id, created_at DESC, id);
      ALTER TABLE agent_assistant_runs ADD COLUMN context_snapshot_id TEXT
        REFERENCES agent_context_snapshots(id) ON DELETE RESTRICT;
      CREATE INDEX agent_assistant_runs_context_snapshot
        ON agent_assistant_runs(context_snapshot_id);
      ALTER TABLE agent_evaluations ADD COLUMN context_snapshot_id TEXT
        REFERENCES agent_context_snapshots(id) ON DELETE RESTRICT;
      CREATE INDEX agent_evaluations_context_snapshot
        ON agent_evaluations(context_snapshot_id);
      ALTER TABLE agent_inspiration_memory_jobs ADD COLUMN context_snapshot_id TEXT
        REFERENCES agent_context_snapshots(id) ON DELETE RESTRICT;
      CREATE INDEX agent_inspiration_memory_jobs_context_snapshot
        ON agent_inspiration_memory_jobs(context_snapshot_id);
    `,
  },
] as const satisfies readonly PluginMigration[];
