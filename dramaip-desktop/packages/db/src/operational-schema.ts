/**
 * DramaIP 正式业务表的运行时 Schema。
 *
 * 新数据库由 packages/db 独占创建；Server 不持有建表或补列 SQL。
 * Drizzle 权威表定义与这份新库启动 SQL 均由本包维护。
 */
export interface OperationalSchemaDatabase {
  exec(sql: string): unknown;
}

export const OPERATIONAL_SCHEMA_SQL = String.raw`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, short_drama_type TEXT NOT NULL,
      target_audience TEXT, target_word_count INTEGER, target_episode_count INTEGER,
      core_hook TEXT, emotional_core TEXT, core_selling_point TEXT,
      synopsis TEXT NOT NULL DEFAULT '', style_guide TEXT, visual_style_direction TEXT,
      genre_opportunity TEXT, production_brief TEXT, current_adaptation_id TEXT,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL, order_index INTEGER NOT NULL, summary TEXT NOT NULL DEFAULT '', outline TEXT,
      content TEXT NOT NULL DEFAULT '', main_conflict TEXT, hook TEXT, highlight TEXT, reversal TEXT,
      cliffhanger TEXT, short_drama_note TEXT, ai_video_note TEXT,
      version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chapters_project_order ON chapters(project_id, order_index);
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, title TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0,
      project_id TEXT, parent_task_id TEXT, result_json TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS backups (
      id TEXT PRIMARY KEY, file_name TEXT NOT NULL UNIQUE, size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS revision_previews (
      id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE, base_version INTEGER NOT NULL,
      proposed_content TEXT NOT NULL, rationale TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, committed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS request_deduplication (
      idempotency_key TEXT PRIMARY KEY, response_status INTEGER NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_engine_config (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      provider_id TEXT NOT NULL REFERENCES domain_entities(id) ON DELETE CASCADE,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS domain_entities (
      id TEXT PRIMARY KEY, domain TEXT NOT NULL, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      parent_id TEXT, title TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS domain_entities_domain_project ON domain_entities(domain, project_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS script_reviews (
      id TEXT PRIMARY KEY, script_id TEXT NOT NULL UNIQUE,
      hook_strength_score REAL NOT NULL, dialogue_score REAL NOT NULL,
      conflict_score REAL NOT NULL, visual_clarity_score REAL NOT NULL,
      scene_clarity_score REAL NOT NULL, character_fit_score REAL NOT NULL,
      shot_readiness_score REAL NOT NULL, ai_video_feasibility_score REAL NOT NULL,
      cliffhanger_score REAL NOT NULL, overall_score REAL NOT NULL,
      issues_json TEXT NOT NULL DEFAULT '[]', suggestions_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shot_reviews (
      id TEXT PRIMARY KEY, shot_id TEXT NOT NULL UNIQUE,
      length_score REAL NOT NULL, character_count_score REAL NOT NULL,
      action_complexity_score REAL NOT NULL, visual_clarity_score REAL NOT NULL,
      character_consistency_score REAL NOT NULL, scene_continuity_score REAL NOT NULL,
      prompt_controllability_score REAL NOT NULL, vertical_suitability_score REAL NOT NULL,
      overall_score REAL NOT NULL, ai_video_difficulty TEXT NOT NULL,
      issues_json TEXT NOT NULL DEFAULT '[]', suggestions_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS prompt_versions (
      id TEXT PRIMARY KEY, shot_id TEXT NOT NULL, version INTEGER NOT NULL,
      task_type TEXT NOT NULL, video_prompt TEXT NOT NULL DEFAULT '', negative_prompt TEXT,
      image_prompt TEXT, note TEXT, created_at TEXT NOT NULL,
      UNIQUE(shot_id, version)
    );
    CREATE INDEX IF NOT EXISTS prompt_versions_shot_order ON prompt_versions(shot_id, version);
    CREATE TABLE IF NOT EXISTS episode_analyses (
      id TEXT PRIMARY KEY, adaptation_id TEXT NOT NULL UNIQUE,
      episode_count INTEGER NOT NULL, hook_coverage REAL NOT NULL,
      cliffhanger_coverage REAL NOT NULL, outline_coverage REAL NOT NULL,
      overall_score REAL NOT NULL, summary TEXT NOT NULL,
      suggestions_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS delivery_creative_variants (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      adaptation_id TEXT NOT NULL, label TEXT NOT NULL, title TEXT NOT NULL,
      description TEXT NOT NULL, tags_json TEXT NOT NULL DEFAULT '[]', cover_asset_id TEXT,
      source TEXT NOT NULL, status TEXT NOT NULL, version_number INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(adaptation_id, version_number)
    );
    CREATE INDEX IF NOT EXISTS delivery_creative_variants_adaptation ON delivery_creative_variants(adaptation_id, status, version_number DESC);
    CREATE TABLE IF NOT EXISTS platform_delivery_archives (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      adaptation_id TEXT NOT NULL, episode_id TEXT NOT NULL,
      profile_id TEXT NOT NULL, profile_version TEXT NOT NULL,
      creative_variant_id TEXT NOT NULL, delivery_version INTEGER NOT NULL,
      source_fingerprint TEXT NOT NULL, preflight_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(episode_id, profile_id, delivery_version)
    );
    CREATE INDEX IF NOT EXISTS platform_delivery_archives_episode ON platform_delivery_archives(episode_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS review_packages (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      adaptation_id TEXT NOT NULL, episode_id TEXT NOT NULL, kind TEXT NOT NULL,
      status TEXT NOT NULL, title TEXT NOT NULL, manifest_json TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS review_packages_episode ON review_packages(episode_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS review_comments (
      id TEXT PRIMARY KEY, package_id TEXT NOT NULL, shot_id TEXT,
      timecode_seconds REAL, author_alias TEXT, body TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS review_comments_package ON review_comments(package_id, created_at);
    CREATE TABLE IF NOT EXISTS review_decisions (
      id TEXT PRIMARY KEY, package_id TEXT NOT NULL, shot_id TEXT, decision TEXT NOT NULL,
      author_alias TEXT, note TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS review_decisions_package ON review_decisions(package_id, created_at);
    CREATE TABLE IF NOT EXISTS voice_profiles (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL, character_id TEXT, sample_asset_id TEXT,
      provider_voice TEXT, description TEXT, status TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS voice_profiles_project ON voice_profiles(project_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS audio_tracks (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      episode_id TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL,
      source_fingerprint TEXT NOT NULL, clips_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL, stale_reason TEXT,
      version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audio_tracks_episode ON audio_tracks(episode_id, kind, created_at DESC);
    CREATE TABLE IF NOT EXISTS animatic_drafts (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      episode_id TEXT NOT NULL, source_fingerprint TEXT NOT NULL, clips_json TEXT NOT NULL,
      annotations TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, review_note TEXT,
      version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS animatic_drafts_episode ON animatic_drafts(episode_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS video_generation_jobs (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, episode_id TEXT, shot_id TEXT,
      provider_id TEXT NOT NULL, remote_job_id TEXT NOT NULL, prompt TEXT NOT NULL,
      input_json TEXT NOT NULL, status TEXT NOT NULL, results_json TEXT NOT NULL DEFAULT '[]',
      error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS video_generation_jobs_shot ON video_generation_jobs(shot_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS creative_case_studies (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, source_type TEXT, genre TEXT, summary TEXT,
      relationship_patterns_json TEXT NOT NULL DEFAULT '[]', opening_hooks_json TEXT NOT NULL DEFAULT '[]',
      highlight_beats_json TEXT NOT NULL DEFAULT '[]', reversal_mechanisms_json TEXT NOT NULL DEFAULT '[]',
      cliffhangers_json TEXT NOT NULL DEFAULT '[]', visual_patterns_json TEXT NOT NULL DEFAULT '[]',
      rhythm_curve_json TEXT NOT NULL DEFAULT '[]', risk_tags_json TEXT NOT NULL DEFAULT '[]', notes TEXT,
      version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS creative_case_studies_updated ON creative_case_studies(updated_at DESC);
    CREATE TABLE IF NOT EXISTS creative_diagnostics (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      target_kind TEXT NOT NULL, target_id TEXT, target_title TEXT NOT NULL, kind TEXT NOT NULL,
      title TEXT NOT NULL, summary TEXT NOT NULL, scores_json TEXT NOT NULL DEFAULT '[]',
      findings_json TEXT NOT NULL DEFAULT '[]', recommendations_json TEXT NOT NULL DEFAULT '[]',
      curve_json TEXT, source_fingerprint TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS creative_diagnostics_project ON creative_diagnostics(project_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS creative_issue_acknowledgements (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      diagnostic_id TEXT NOT NULL REFERENCES creative_diagnostics(id) ON DELETE CASCADE,
      issue_key TEXT NOT NULL, disposition TEXT NOT NULL, note TEXT, actor_label TEXT,
      created_at TEXT NOT NULL, UNIQUE(project_id, diagnostic_id, issue_key)
    );
    CREATE INDEX IF NOT EXISTS creative_issue_acknowledgements_project ON creative_issue_acknowledgements(project_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS compliance_rule_profiles (
      id TEXT PRIMARY KEY, version TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
      source_url TEXT NOT NULL, source_status TEXT NOT NULL,
      published_at TEXT NOT NULL, effective_at TEXT, regions_json TEXT NOT NULL,
      platforms_json TEXT NOT NULL, required_visible_label TEXT NOT NULL,
      required_metadata_keys_json TEXT NOT NULL, content_checksum TEXT NOT NULL,
      integrity_status TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0,
      built_in INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS source_imports (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      staged_file_name TEXT NOT NULL, preview_json TEXT NOT NULL, expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS source_imports_expiry ON source_imports(expires_at);
    CREATE TABLE IF NOT EXISTS import_extraction_change_sets (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_import_id TEXT NOT NULL, source_fingerprint TEXT NOT NULL, source_title TEXT NOT NULL,
      source_versions_json TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL,
      candidates_json TEXT NOT NULL, created_entity_ids_json TEXT NOT NULL DEFAULT '[]',
      adoption_json TEXT NOT NULL DEFAULT '[]', error_message TEXT,
      applied_at TEXT, undone_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS import_extraction_change_sets_project
      ON import_extraction_change_sets(project_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS feedback_previews (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, source_name TEXT NOT NULL, rows_json TEXT NOT NULL,
      warnings_json TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS feedback_import_batches (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, source_name TEXT NOT NULL, row_count INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS feedback_batches_project ON feedback_import_batches(project_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS feedback_metrics (
      id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES feedback_import_batches(id) ON DELETE CASCADE,
      name TEXT NOT NULL, value REAL NOT NULL, occurred_at TEXT, dimensions_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS feedback_comments (
      id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES feedback_import_batches(id) ON DELETE CASCADE,
      content TEXT NOT NULL, author TEXT, occurred_at TEXT, category TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS feedback_clusters (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      batch_id TEXT NOT NULL REFERENCES feedback_import_batches(id) ON DELETE CASCADE,
      title TEXT NOT NULL, summary TEXT NOT NULL, comment_count INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS generation_records (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
      summary TEXT NOT NULL, actual_cost REAL, currency TEXT NOT NULL DEFAULT 'CNY',
      cost_note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS generation_records_project ON generation_records(project_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS story_bible_settings (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      auto_suggest INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS story_bible_change_sets (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      source_version INTEGER NOT NULL, source_content_hash TEXT NOT NULL,
      status TEXT NOT NULL, summary TEXT NOT NULL, task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      conflict_notes_json TEXT NOT NULL DEFAULT '[]', payload_json TEXT NOT NULL DEFAULT '{}',
      created_entity_ids_json TEXT NOT NULL DEFAULT '[]', error_message TEXT,
      applied_at TEXT, undone_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS story_bible_change_sets_project ON story_bible_change_sets(project_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS story_bible_stale_marks (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      reason TEXT NOT NULL, resolved_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS story_bible_stale_marks_project ON story_bible_stale_marks(project_id, resolved_at, updated_at DESC);
    CREATE TABLE IF NOT EXISTS project_package_imports (
      id TEXT PRIMARY KEY, staged_file_name TEXT NOT NULL, preview_json TEXT NOT NULL,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS project_package_imports_expiry ON project_package_imports(expires_at);
  `;

export function initializeOperationalSchema(
  database: OperationalSchemaDatabase,
): void {
  database.exec(OPERATIONAL_SCHEMA_SQL);
}
