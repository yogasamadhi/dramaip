// migrator.ts —— 版本化数据库迁移框架（ROADMAP v1.0-1）
//
// 设计：
// - 用 schema_migrations 表记录已应用迁移版本，保证「每版本有明确 migration」。
// - 首次空库：直接建全部表为 v1（CREATE TABLE IF NOT EXISTS 安全）。
// - 已有 v0.x 库：表已存在则 IF NOT EXISTS 跳过，列级迁移用 PRAGMA 探测补列，记录 v1。
// - 保证 v0.1 → v1.0 升级数据零丢失。
//
// 每个迁移是一个 { version, name, up(raw) }，按 version 升序依次执行未应用的。
import { INITIAL_SCHEMA_SQL, ensureColumns } from './migrations'

/** 迁移依赖的最小 raw sqlite 接口（与 better-sqlite3 Database 对齐） */
export interface MigrationRaw {
  exec(sql: string): void
  prepare(sql: string): { all(...params: unknown[]): unknown[] }
}

export interface Migration {
  version: number
  name: string
  up(raw: MigrationRaw): void
}

/**
 * v1 迁移：把 v0.1–v0.8 的全部建表 + 列级迁移 + schema_migrations 自身纳入一个版本。
 * 这是「现状的快照」：新库一次建成；旧库经 IF NOT EXISTS / ensureColumns 安全补齐。
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'baseline-v0.1-to-v0.8',
    up(raw) {
      // schema_migrations 表自身（若已存在则跳过）
      raw.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
      `)
      // 全部业务表（IF NOT EXISTS）
      raw.exec(INITIAL_SCHEMA_SQL)
      // 列级幂等迁移（对已存在的旧表补列）
      ensureColumns(raw)
    },
  },
  {
    version: 2,
    name: 'task-model-bindings',
    up(raw) {
      raw.exec(`
        CREATE TABLE IF NOT EXISTS task_model_bindings (
          id TEXT PRIMARY KEY,
          task_group TEXT NOT NULL,
          model_config_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS task_model_bindings_task_group_unique
          ON task_model_bindings(task_group);
      `)
    },
  },
  {
    version: 3,
    name: 'adaptation-seasons',
    up(raw) {
      // 多季连载：adaptation_projects 加季号 + 本季改编章节范围
      addColumnIfMissing(raw, 'adaptation_projects', 'season_number', 'season_number INTEGER')
      addColumnIfMissing(raw, 'adaptation_projects', 'source_chapter_range', 'source_chapter_range TEXT')
    },
  },
  {
    version: 4,
    name: 'indexes-and-runtime-constraints',
    up(raw) {
      raw.exec(`
        CREATE INDEX IF NOT EXISTS idx_characters_project_id ON characters(project_id);
        CREATE INDEX IF NOT EXISTS idx_outlines_project_type ON outlines(project_id, type);
        CREATE INDEX IF NOT EXISTS idx_chapters_project_order ON chapters(project_id, order_index);
        CREATE INDEX IF NOT EXISTS idx_evaluations_project_chapter ON evaluations(project_id, chapter_id);
        CREATE INDEX IF NOT EXISTS idx_ai_runs_project_created ON ai_runs(project_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_chapter_memories_project_chapter ON chapter_memories(project_id, chapter_id);
        CREATE INDEX IF NOT EXISTS idx_character_states_character ON character_states(character_id);
        CREATE INDEX IF NOT EXISTS idx_character_visual_profiles_character ON character_visual_profiles(character_id);
        CREATE INDEX IF NOT EXISTS idx_visual_settings_project_id ON visual_settings(project_id);
        CREATE INDEX IF NOT EXISTS idx_story_events_project_order ON story_events(project_id, order_index);
        CREATE INDEX IF NOT EXISTS idx_foreshadowings_project_status ON foreshadowings(project_id, status);
        CREATE INDEX IF NOT EXISTS idx_beats_project_chapter ON beats(project_id, chapter_id);
        CREATE INDEX IF NOT EXISTS idx_highlight_analyses_project_chapter ON highlight_analyses(project_id, chapter_id);
        CREATE INDEX IF NOT EXISTS idx_ai_video_feasibility_project_chapter ON ai_video_feasibility_reports(project_id, chapter_id);
        CREATE INDEX IF NOT EXISTS idx_drama_trend_reports_project_id ON drama_trend_reports(project_id);
        CREATE INDEX IF NOT EXISTS idx_adaptation_projects_source_project ON adaptation_projects(source_project_id);
        CREATE INDEX IF NOT EXISTS idx_episodes_adaptation_episode ON episodes(adaptation_project_id, episode_number);
        CREATE INDEX IF NOT EXISTS idx_episode_analyses_adaptation ON episode_analyses(adaptation_project_id);
        CREATE INDEX IF NOT EXISTS idx_scripts_adaptation_episode ON scripts(adaptation_project_id, episode_id);
        CREATE INDEX IF NOT EXISTS idx_scenes_script_order ON scenes(script_id, order_index);
        CREATE INDEX IF NOT EXISTS idx_script_reviews_script ON script_reviews(script_id);
        CREATE INDEX IF NOT EXISTS idx_shots_scene_number ON shots(scene_id, shot_number);
        CREATE INDEX IF NOT EXISTS idx_shots_episode_id ON shots(episode_id);
        CREATE INDEX IF NOT EXISTS idx_shot_reviews_shot ON shot_reviews(shot_id);
        CREATE INDEX IF NOT EXISTS idx_prompt_versions_shot_version ON prompt_versions(shot_id, version);
        CREATE INDEX IF NOT EXISTS idx_video_tasks_shot_status ON video_generation_tasks(shot_id, status);
        CREATE INDEX IF NOT EXISTS idx_video_tasks_episode_status ON video_generation_tasks(episode_id, status);
        CREATE INDEX IF NOT EXISTS idx_video_results_task ON video_results(task_id);
        CREATE INDEX IF NOT EXISTS idx_video_results_shot_best ON video_results(shot_id, is_best);
        CREATE INDEX IF NOT EXISTS idx_template_runs_template_created ON template_runs(template_id, created_at);
        UPDATE model_configs SET is_default = 0 WHERE is_default = 1 AND id NOT IN (SELECT id FROM model_configs WHERE is_default = 1 ORDER BY created_at LIMIT 1);
        UPDATE video_provider_configs SET is_default = 0 WHERE is_default = 1 AND id NOT IN (SELECT id FROM video_provider_configs WHERE is_default = 1 ORDER BY created_at LIMIT 1);
        CREATE UNIQUE INDEX IF NOT EXISTS model_configs_single_default ON model_configs(is_default) WHERE is_default = 1;
        CREATE UNIQUE INDEX IF NOT EXISTS video_provider_configs_single_default ON video_provider_configs(is_default) WHERE is_default = 1;
      `)
    },
  },
  {
    version: 5,
    name: 'creative-diagnosis-system',
    up(raw) {
      raw.exec(`
        CREATE TABLE IF NOT EXISTS creative_case_studies (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          source_type TEXT,
          genre TEXT,
          summary TEXT,
          relationship_patterns TEXT NOT NULL DEFAULT '[]',
          opening_hooks TEXT NOT NULL DEFAULT '[]',
          highlight_beats TEXT NOT NULL DEFAULT '[]',
          reversal_mechanisms TEXT NOT NULL DEFAULT '[]',
          cliffhangers TEXT NOT NULL DEFAULT '[]',
          visual_patterns TEXT NOT NULL DEFAULT '[]',
          risk_tags TEXT NOT NULL DEFAULT '[]',
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS freshness_reports (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          target_kind TEXT NOT NULL,
          target_id TEXT,
          target_title TEXT,
          originality_score REAL NOT NULL,
          predictability_score REAL NOT NULL,
          trope_risk_score REAL NOT NULL,
          character_freshness_score REAL NOT NULL,
          conflict_freshness_score REAL NOT NULL,
          reversal_freshness_score REAL NOT NULL,
          emotional_freshness_score REAL NOT NULL,
          overall_score REAL NOT NULL,
          cliche_signals TEXT NOT NULL DEFAULT '[]',
          audience_prediction_points TEXT NOT NULL DEFAULT '[]',
          suggestions TEXT NOT NULL DEFAULT '[]',
          raw_result TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS anti_trope_variants (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          target_kind TEXT NOT NULL,
          target_id TEXT,
          mode TEXT NOT NULL,
          title TEXT NOT NULL,
          premise TEXT NOT NULL,
          pressure_mechanism TEXT NOT NULL,
          preserved_payoffs TEXT NOT NULL DEFAULT '[]',
          key_changes TEXT NOT NULL DEFAULT '[]',
          risks TEXT NOT NULL DEFAULT '[]',
          sample_rewrite TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS revision_tasks (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          target_kind TEXT NOT NULL,
          target_id TEXT,
          source_report_id TEXT,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          priority TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          suggested_action TEXT NOT NULL,
          expected_benefit TEXT NOT NULL DEFAULT '{}',
          applied_version_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS content_versions (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          target_kind TEXT NOT NULL,
          target_id TEXT NOT NULL,
          label TEXT NOT NULL,
          source TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          meta TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS quality_gate_reports (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          adaptation_project_id TEXT,
          target_kind TEXT NOT NULL,
          target_id TEXT,
          stage TEXT NOT NULL,
          score REAL NOT NULL,
          verdict TEXT NOT NULL,
          blocking_issues TEXT NOT NULL DEFAULT '[]',
          warnings TEXT NOT NULL DEFAULT '[]',
          suggestions TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS audience_simulations (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          target_kind TEXT NOT NULL,
          target_id TEXT,
          audience_profile TEXT NOT NULL,
          retention_score REAL NOT NULL,
          emotional_engagement_score REAL NOT NULL,
          novelty_score REAL NOT NULL,
          likely_drop_off_points TEXT NOT NULL DEFAULT '[]',
          most_memorable_moments TEXT NOT NULL DEFAULT '[]',
          complaints TEXT NOT NULL DEFAULT '[]',
          shareable_clips TEXT NOT NULL DEFAULT '[]',
          summary TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS narrative_curve_reports (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          adaptation_project_id TEXT,
          target_kind TEXT NOT NULL,
          target_id TEXT,
          hook_curve TEXT NOT NULL DEFAULT '[]',
          conflict_curve TEXT NOT NULL DEFAULT '[]',
          reversal_curve TEXT NOT NULL DEFAULT '[]',
          emotion_curve TEXT NOT NULL DEFAULT '[]',
          cliffhanger_curve TEXT NOT NULL DEFAULT '[]',
          freshness_curve TEXT NOT NULL DEFAULT '[]',
          summary TEXT NOT NULL,
          weak_spots TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workflow_runs (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          adaptation_project_id TEXT,
          template_key TEXT NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          current_step TEXT,
          steps TEXT NOT NULL DEFAULT '[]',
          error_message TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_creative_case_studies_genre ON creative_case_studies(genre);
        CREATE INDEX IF NOT EXISTS idx_freshness_reports_target ON freshness_reports(target_kind, target_id);
        CREATE INDEX IF NOT EXISTS idx_freshness_reports_project ON freshness_reports(project_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_anti_trope_variants_target ON anti_trope_variants(target_kind, target_id);
        CREATE INDEX IF NOT EXISTS idx_revision_tasks_project_status ON revision_tasks(project_id, status);
        CREATE INDEX IF NOT EXISTS idx_revision_tasks_target ON revision_tasks(target_kind, target_id);
        CREATE INDEX IF NOT EXISTS idx_content_versions_target ON content_versions(target_kind, target_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_quality_gate_stage_target ON quality_gate_reports(stage, target_kind, target_id);
        CREATE INDEX IF NOT EXISTS idx_audience_simulations_target ON audience_simulations(target_kind, target_id);
        CREATE INDEX IF NOT EXISTS idx_narrative_curve_reports_target ON narrative_curve_reports(target_kind, target_id);
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_project ON workflow_runs(project_id, created_at);
      `)
    },
  },
  {
    version: 6,
    name: 'long-task-ledger',
    up(raw) {
      raw.exec(`
        CREATE TABLE IF NOT EXISTS long_tasks (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          title TEXT NOT NULL,
          task_type TEXT,
          project_id TEXT,
          adaptation_project_id TEXT,
          episode_id TEXT,
          scene_id TEXT,
          shot_id TEXT,
          related_entity_id TEXT,
          input TEXT,
          output TEXT,
          error_message TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_long_tasks_status_updated ON long_tasks(status, updated_at);
        CREATE INDEX IF NOT EXISTS idx_long_tasks_project_updated ON long_tasks(project_id, updated_at);
        CREATE INDEX IF NOT EXISTS idx_long_tasks_related_entity ON long_tasks(kind, related_entity_id);
      `)
    },
  },
  {
    version: 7,
    name: 'video-result-local-assets',
    up(raw) {
      addColumnIfMissing(raw, 'video_results', 'remote_video_url', 'remote_video_url TEXT')
      addColumnIfMissing(raw, 'video_results', 'local_video_path', 'local_video_path TEXT')
      addColumnIfMissing(raw, 'video_results', 'remote_cover_image_url', 'remote_cover_image_url TEXT')
      addColumnIfMissing(raw, 'video_results', 'local_cover_image_path', 'local_cover_image_path TEXT')
      addColumnIfMissing(raw, 'video_results', 'archived_at', 'archived_at TEXT')
      addColumnIfMissing(raw, 'video_results', 'archive_error', 'archive_error TEXT')
    },
  },
  {
    version: 8,
    name: 'ai-budget-settings',
    up(raw) {
      raw.exec(`
        CREATE TABLE IF NOT EXISTS ai_budget_settings (
          id TEXT PRIMARY KEY,
          single_run_token_limit INTEGER,
          daily_token_limit INTEGER,
          single_run_cost_limit REAL,
          daily_cost_limit REAL,
          cost_per_1k_tokens REAL NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'USD',
          updated_at TEXT NOT NULL
        );
      `)
    },
  },
  {
    version: 9,
    name: 'project-asset-library',
    up(raw) {
      raw.exec(`
        CREATE TABLE IF NOT EXISTS project_assets (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          source_entity_kind TEXT,
          source_entity_id TEXT,
          local_path TEXT,
          relative_path TEXT,
          remote_url TEXT,
          mime_type TEXT,
          original_name TEXT,
          sha256 TEXT,
          size_bytes INTEGER,
          width INTEGER,
          height INTEGER,
          duration_seconds REAL,
          tags TEXT NOT NULL DEFAULT '[]',
          metadata TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'available',
          package_policy TEXT NOT NULL DEFAULT 'reference_only',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_project_assets_project_kind ON project_assets(project_id, kind);
        CREATE INDEX IF NOT EXISTS idx_project_assets_source ON project_assets(source_entity_kind, source_entity_id);
        CREATE INDEX IF NOT EXISTS idx_project_assets_package_policy ON project_assets(project_id, package_policy);
      `)
    },
  },
  {
    version: 10,
    name: 'case-study-document-chapters',
    up(raw) {
      raw.exec(`
        CREATE TABLE IF NOT EXISTS case_study_documents (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          file_name TEXT NOT NULL,
          source_type TEXT,
          chapter_count INTEGER NOT NULL DEFAULT 0,
          total_chars INTEGER NOT NULL DEFAULT 0,
          truncated INTEGER NOT NULL DEFAULT 0,
          parse_warnings TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS case_study_chapters (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          order_index INTEGER NOT NULL DEFAULT 0,
          title TEXT NOT NULL,
          text_preview TEXT NOT NULL DEFAULT '',
          char_count INTEGER NOT NULL DEFAULT 0,
          word_count INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'parsed',
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_case_study_documents_updated ON case_study_documents(updated_at);
        CREATE INDEX IF NOT EXISTS idx_case_study_chapters_document_order ON case_study_chapters(document_id, order_index);
      `)
    },
  },
  {
    version: 11,
    name: 'case-study-creative-cards',
    up(raw) {
      addColumnIfMissing(raw, 'creative_case_studies', 'rhythm_curve', "rhythm_curve TEXT NOT NULL DEFAULT '[]'")
      addColumnIfMissing(raw, 'creative_case_studies', 'creative_cards', "creative_cards TEXT NOT NULL DEFAULT '[]'")
    },
  },
  {
    version: 12,
    name: 'story-arcs',
    up(raw) {
      raw.exec(`
        CREATE TABLE IF NOT EXISTS story_arcs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          parent_id TEXT,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          summary TEXT,
          target_word_count INTEGER,
          target_chapter_count INTEGER,
          chapter_start INTEGER,
          chapter_end INTEGER,
          core_conflict TEXT,
          key_highlights TEXT NOT NULL DEFAULT '[]',
          foreshadowing_payoffs TEXT NOT NULL DEFAULT '[]',
          order_index INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_story_arcs_project_kind_order ON story_arcs(project_id, kind, order_index);
        CREATE INDEX IF NOT EXISTS idx_story_arcs_parent_order ON story_arcs(parent_id, order_index);
      `)
    },
  },
  {
    version: 13,
    name: 'project-skills',
    up(raw) {
      raw.exec(`
        CREATE TABLE IF NOT EXISTS project_skills (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          description TEXT,
          task_types TEXT NOT NULL DEFAULT '[]',
          content TEXT NOT NULL DEFAULT '',
          priority INTEGER NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_project_skills_project_priority ON project_skills(project_id, enabled, priority);
        CREATE INDEX IF NOT EXISTS idx_project_skills_project_category ON project_skills(project_id, category);
      `)
    },
  },
  {
    version: 14,
    name: 'project-agent-schemes',
    up(raw) {
      raw.exec(`
        CREATE TABLE IF NOT EXISTS project_agent_schemes (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          primary_agent_id TEXT,
          agent_ids TEXT NOT NULL DEFAULT '[]',
          skill_ids TEXT NOT NULL DEFAULT '[]',
          model_bindings TEXT NOT NULL DEFAULT '{}',
          active INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_project_agent_schemes_project_active
          ON project_agent_schemes(project_id, active, updated_at);
      `)
    },
  },
  {
    version: 15,
    name: 'inspiration-favorites',
    up(raw) {
      raw.exec(`
        CREATE TABLE IF NOT EXISTS inspiration_favorites (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          card_key TEXT NOT NULL,
          source_kind TEXT NOT NULL,
          source_id TEXT,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          pattern TEXT NOT NULL DEFAULT '',
          apply_to TEXT NOT NULL DEFAULT '',
          risk TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_inspiration_favorites_project_card
          ON inspiration_favorites(project_id, card_key);
        CREATE INDEX IF NOT EXISTS idx_inspiration_favorites_project_kind
          ON inspiration_favorites(project_id, kind, updated_at);
      `)
    },
  },
  {
    version: 16,
    name: 'video-preproduction-assets',
    up(raw) {
      addColumnIfMissing(raw, 'character_visual_profiles', 'casting_prompt', 'casting_prompt TEXT')
      addColumnIfMissing(raw, 'character_visual_profiles', 'actor_reference_url', 'actor_reference_url TEXT')
      addColumnIfMissing(raw, 'character_visual_profiles', 'voice_tone', 'voice_tone TEXT')
      addColumnIfMissing(raw, 'character_visual_profiles', 'voice_sample_url', 'voice_sample_url TEXT')
    },
  },
  {
    version: 17,
    name: 'video-asset-draft-fields',
    up(raw) {
      addColumnIfMissing(raw, 'shots', 'subtitle_draft', 'subtitle_draft TEXT')
      addColumnIfMissing(raw, 'shots', 'cover_prompt', 'cover_prompt TEXT')
    },
  },
  {
    version: 18,
    name: 'system-credential-migration-audit',
    up(raw) {
      // 只记录迁移状态和凭据引用，绝不记录 API Key 或其密文。
      raw.exec(`
        CREATE TABLE IF NOT EXISTS credential_migration_audit (
          area TEXT NOT NULL,
          record_id TEXT NOT NULL,
          source_state TEXT NOT NULL,
          credential_ref TEXT,
          status TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          completed_at TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (area, record_id)
        );
        CREATE INDEX IF NOT EXISTS idx_credential_migration_audit_status
          ON credential_migration_audit(status, updated_at);
      `)
    },
  },
  {
    version: 19,
    name: 'quality-gate-source-fingerprint',
    up(raw) {
      addColumnIfMissing(raw, 'quality_gate_reports', 'source_fingerprint', 'source_fingerprint TEXT')
      raw.exec(`
        CREATE INDEX IF NOT EXISTS idx_quality_gate_reports_truth
          ON quality_gate_reports(project_id, stage, target_kind, target_id, created_at);
      `)
    },
  },
  {
    version: 20,
    name: 'project-soft-delete',
    up(raw) {
      addColumnIfMissing(raw, 'projects', 'deleted_at', 'deleted_at TEXT')
      raw.exec(`
        CREATE INDEX IF NOT EXISTS idx_projects_deleted_updated
          ON projects(deleted_at, updated_at);
      `)
    },
  },
  {
    version: 21,
    name: 'atomic-revision-adoption',
    up(raw) {
      addColumnIfMissing(raw, 'revision_tasks', 'preview_payload', 'preview_payload TEXT')
      addColumnIfMissing(raw, 'revision_tasks', 'preview_fingerprint', 'preview_fingerprint TEXT')
      addColumnIfMissing(raw, 'revision_tasks', 'undo_version_id', 'undo_version_id TEXT')
      raw.exec(`
        CREATE INDEX IF NOT EXISTS idx_revision_tasks_status_updated
          ON revision_tasks(status, updated_at);
      `)
    },
  },
  {
    version: 22,
    name: 'project-active-adaptation-context',
    up(raw) {
      // 旧项目不在迁移时猜测当前季；首次打开时由仓库按明确规则回填，避免批量写入改变项目排序。
      addColumnIfMissing(raw, 'projects', 'active_adaptation_id', 'active_adaptation_id TEXT')
      raw.exec(`
        CREATE INDEX IF NOT EXISTS idx_projects_active_adaptation
          ON projects(active_adaptation_id);
      `)
    },
  },
  {
    version: 23,
    name: 'quality-issue-acknowledgement-audit',
    up(raw) {
      raw.exec(`
        CREATE TABLE IF NOT EXISTS quality_issue_acknowledgements (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          adaptation_project_id TEXT,
          issue_id TEXT NOT NULL,
          issue_kind TEXT NOT NULL,
          issue_title TEXT NOT NULL,
          issue_detail TEXT,
          disposition TEXT NOT NULL,
          note TEXT,
          actor_label TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_quality_issue_ack_project_issue
          ON quality_issue_acknowledgements(project_id, issue_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_quality_issue_ack_adaptation
          ON quality_issue_acknowledgements(adaptation_project_id, created_at);
      `)
    },
  },
  {
    version: 24,
    name: 'cloud-mobile-draft-adoption-projection',
    up(raw) {
      raw.exec(`
        CREATE TABLE IF NOT EXISTS cloud_mobile_draft_adoptions (
          cloud_draft_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          adopted_at TEXT NOT NULL,
          PRIMARY KEY (cloud_draft_id, project_id)
        );
        CREATE INDEX IF NOT EXISTS idx_cloud_mobile_draft_adoptions_project
          ON cloud_mobile_draft_adoptions(project_id, adopted_at);
      `)
    },
  },
  {
    version: 25,
    name: 'project-genre-opportunity-snapshot',
    up(raw) {
      // 只保存用户在创建时采用的离线机会快照；不在迁移期猜测或改写旧项目的题材判断。
      addColumnIfMissing(raw, 'projects', 'genre_opportunity', 'genre_opportunity TEXT')
    },
  },
  {
    version: 26,
    name: 'genre-market-snapshot-history',
    up(raw) {
      raw.exec(`
        CREATE TABLE IF NOT EXISTS genre_market_snapshots (
          version TEXT PRIMARY KEY,
          observed_at TEXT NOT NULL,
          sources TEXT NOT NULL,
          opportunities TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_genre_market_snapshots_active
          ON genre_market_snapshots(active, observed_at);
      `)
    },
  },
  {
    version: 27,
    name: 'project-production-brief',
    up(raw) {
      // 旧项目在读取时计算兼容 Profile；迁移只加字段，绝不重写已有章节、季、集或时长。
      addColumnIfMissing(raw, 'projects', 'production_brief', 'production_brief TEXT')
    },
  },
  {
    version: 28,
    name: 'story-bible-change-sets',
    up(raw) {
      raw.exec(`
        CREATE TABLE IF NOT EXISTS story_bible_settings (
          project_id TEXT PRIMARY KEY,
          auto_suggest INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS story_bible_change_sets (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          chapter_id TEXT NOT NULL,
          source_chapter_updated_at TEXT NOT NULL,
          source_content_hash TEXT NOT NULL,
          task_id TEXT,
          status TEXT NOT NULL,
          estimated_tokens INTEGER,
          estimated_cost REAL,
          currency TEXT,
          payload TEXT,
          conflicts TEXT NOT NULL DEFAULT '[]',
          undo_payload TEXT,
          error_message TEXT,
          applied_at TEXT,
          undone_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS story_bible_stale_marks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          chapter_id TEXT NOT NULL,
          target_kind TEXT NOT NULL,
          reason TEXT NOT NULL,
          resolved_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_story_bible_change_sets_project_status
          ON story_bible_change_sets(project_id, status, updated_at);
        CREATE INDEX IF NOT EXISTS idx_story_bible_change_sets_chapter
          ON story_bible_change_sets(chapter_id, source_chapter_updated_at);
        CREATE INDEX IF NOT EXISTS idx_story_bible_stale_marks_project_chapter
          ON story_bible_stale_marks(project_id, chapter_id, resolved_at);
      `)
    },
  },
]

/** 当前最新迁移版本（= MIGRATIONS 末项 version） */
export const LATEST_MIGRATION_VERSION = MIGRATIONS.reduce((m, x) => Math.max(m, x.version), 0)

/**
 * 读取已应用的最大迁移版本。表不存在时返回 0。
 */
function getAppliedVersion(raw: MigrationRaw): number {
  try {
    const rows = raw.prepare('SELECT MAX(version) AS v FROM schema_migrations').all() as Array<{ v?: number }>
    return rows[0]?.v ?? 0
  } catch {
    // schema_migrations 尚未创建（v1 迁移会创建它）
    return 0
  }
}

function hasColumn(raw: MigrationRaw, table: string, column: string): boolean {
  const rows = raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>
  return rows.some((row) => row.name === column)
}

function addColumnIfMissing(raw: MigrationRaw, table: string, column: string, definition: string): void {
  if (!hasColumn(raw, table, column)) {
    raw.exec(`ALTER TABLE ${table} ADD COLUMN ${definition};`)
  }
}

function runMigrationInTransaction(raw: MigrationRaw, migration: Migration): void {
  raw.exec('BEGIN IMMEDIATE;')
  try {
    migration.up(raw)
    raw.exec(
      `INSERT INTO schema_migrations (version, applied_at) VALUES (${migration.version}, '${new Date().toISOString()}');`,
    )
    raw.exec('COMMIT;')
  } catch (error) {
    raw.exec('ROLLBACK;')
    throw error
  }
}

/**
 * 运行所有未应用的迁移（幂等）。
 * - 首次（无 schema_migrations）：v1 建表 + schema_migrations，记 version=1，再继续 v2…
 * - 旧库（schema_migrations 已存在）：从记录的最大 version 之后开始。
 * @returns 已应用的版本号数组（本次新跑的）
 */
export function runMigrations(raw: MigrationRaw): number[] {
  const applied: number[] = []
  // 注意：schema_migrations 由 v1 迁移创建；若它还不存在，getAppliedVersion 返回 0，
  // v1 会先 CREATE schema_migrations 再 INSERT，后续版本正常判定。
  const current = getAppliedVersion(raw)
  const pending = MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version)

  for (const m of pending) {
    runMigrationInTransaction(raw, m)
    applied.push(m.version)
  }
  return applied
}
