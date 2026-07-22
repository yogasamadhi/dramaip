// 幂等建表 DDL —— 运行期由 ensureSchema 执行（CREATE TABLE IF NOT EXISTS）。
// 保持与 ./schema.ts 一致；schema 变更时同步更新此处与 ensureColumns。
export const INITIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  short_drama_type TEXT NOT NULL,
  target_audience TEXT,
  target_word_count INTEGER,
  target_episode_count INTEGER,
  core_hook TEXT,
  emotional_core TEXT,
  core_selling_point TEXT,
  synopsis TEXT,
  style_guide TEXT,
  visual_style_direction TEXT,
  genre_opportunity TEXT,
  production_brief TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  identity TEXT,
  personality TEXT,
  desire TEXT,
  secret TEXT,
  weakness TEXT,
  arc TEXT,
  relationship_to_protagonist TEXT,
  conflict_target TEXT,
  emotional_function TEXT,
  short_drama_function TEXT,
  visual_description TEXT,
  appearance_prompt TEXT,
  negative_prompt TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outlines (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  outline TEXT,
  content TEXT NOT NULL DEFAULT '',
  main_conflict TEXT,
  hook TEXT,
  highlight TEXT,
  reversal TEXT,
  cliffhanger TEXT,
  short_drama_note TEXT,
  ai_video_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  chapter_id TEXT,
  total_score REAL NOT NULL,
  hook_score REAL NOT NULL,
  conflict_score REAL NOT NULL,
  reversal_score REAL NOT NULL,
  emotion_score REAL NOT NULL,
  visualization_score REAL NOT NULL,
  ai_video_feasibility_score REAL NOT NULL,
  character_consistency_score REAL NOT NULL,
  shot_clarity_score REAL NOT NULL,
  cliffhanger_score REAL NOT NULL,
  adaptation_difficulty_score REAL NOT NULL,
  issues TEXT NOT NULL DEFAULT '[]',
  suggestions TEXT NOT NULL DEFAULT '[]',
  raw_result TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  chapter_id TEXT,
  graph_name TEXT NOT NULL,
  node_name TEXT,
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input TEXT NOT NULL DEFAULT '',
  output TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  error_message TEXT,
  token_usage INTEGER,
  latency_ms INTEGER,
  created_at TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS model_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chapter_memories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  important_events TEXT NOT NULL DEFAULT '[]',
  character_changes TEXT NOT NULL DEFAULT '[]',
  revealed_secrets TEXT NOT NULL DEFAULT '[]',
  new_foreshadowing TEXT NOT NULL DEFAULT '[]',
  resolved_foreshadowing TEXT NOT NULL DEFAULT '[]',
  key_visual_elements TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS character_states (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  chapter_id TEXT,
  current_status TEXT NOT NULL,
  emotional_state TEXT,
  relationship_changes TEXT,
  known_secrets TEXT NOT NULL DEFAULT '[]',
  hidden_secrets TEXT NOT NULL DEFAULT '[]',
  visual_continuity_notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS character_visual_profiles (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  appearance_prompt TEXT NOT NULL,
  casting_prompt TEXT,
  face_description TEXT,
  hairstyle TEXT,
  clothing_style TEXT,
  body_type TEXT,
  age_look TEXT,
  temperament TEXT,
  color_palette TEXT,
  negative_prompt TEXT,
  reference_image_url TEXT,
  actor_reference_url TEXT,
  voice_tone TEXT,
  voice_sample_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS visual_settings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  visual_prompt TEXT NOT NULL,
  negative_prompt TEXT,
  reference_image_url TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS story_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  chapter_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  event_type TEXT NOT NULL,
  related_character_ids TEXT NOT NULL DEFAULT '[]',
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS foreshadowings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  setup_chapter_id TEXT,
  payoff_chapter_id TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  description TEXT NOT NULL,
  payoff_plan TEXT,
  related_character_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS beats (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  chapter_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  drama_value REAL NOT NULL,
  visual_value REAL NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  related_character_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS highlight_analyses (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  face_slap REAL NOT NULL,
  revenge REAL NOT NULL,
  identity_reveal REAL NOT NULL,
  misunderstanding_cleared REAL NOT NULL,
  pampering REAL NOT NULL,
  counter_kill REAL NOT NULL,
  counterattack REAL NOT NULL,
  angst REAL NOT NULL,
  highlight_types TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL,
  suggestions TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_video_feasibility_reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  character_count_score REAL NOT NULL,
  action_complexity_score REAL NOT NULL,
  interaction_density_score REAL NOT NULL,
  scene_stability_score REAL NOT NULL,
  visual_clarity_score REAL NOT NULL,
  character_consistency_score REAL NOT NULL,
  generatable_score REAL NOT NULL,
  vertical_suitability_score REAL NOT NULL,
  prompt_controllability_score REAL NOT NULL,
  overall_score REAL NOT NULL,
  risks TEXT NOT NULL DEFAULT '[]',
  suggestions TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drama_trend_reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  hook_trend TEXT NOT NULL DEFAULT '[]',
  conflict_trend TEXT NOT NULL DEFAULT '[]',
  reversal_trend TEXT NOT NULL DEFAULT '[]',
  emotion_trend TEXT NOT NULL DEFAULT '[]',
  cliffhanger_trend TEXT NOT NULL DEFAULT '[]',
  visualization_trend TEXT NOT NULL DEFAULT '[]',
  ai_video_feasibility_trend TEXT NOT NULL DEFAULT '[]',
  character_consistency_trend TEXT NOT NULL DEFAULT '[]',
  shot_clarity_trend TEXT NOT NULL DEFAULT '[]',
  overall_trend TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS adaptation_projects (
  id TEXT PRIMARY KEY,
  source_project_id TEXT,
  title TEXT NOT NULL,
  target_episode_count INTEGER NOT NULL,
  episode_duration TEXT,
  adaptation_style TEXT NOT NULL,
  visual_style_direction TEXT,
  audience TEXT,
  strategy TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  adaptation_project_id TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  hook TEXT NOT NULL,
  main_conflict TEXT NOT NULL,
  reversal TEXT,
  emotional_beat TEXT,
  cliffhanger TEXT NOT NULL,
  ai_video_note TEXT,
  key_visuals TEXT NOT NULL DEFAULT '[]',
  related_chapter_ids TEXT NOT NULL DEFAULT '[]',
  related_beat_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS episode_analyses (
  id TEXT PRIMARY KEY,
  adaptation_project_id TEXT NOT NULL,
  hook_strength_trend TEXT NOT NULL DEFAULT '[]',
  retention_score_trend TEXT NOT NULL DEFAULT '[]',
  pace_score_trend TEXT NOT NULL DEFAULT '[]',
  reversal_density_trend TEXT NOT NULL DEFAULT '[]',
  visual_appeal_trend TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL,
  suggestions TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scripts (
  id TEXT PRIMARY KEY,
  adaptation_project_id TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  hook TEXT,
  main_conflict TEXT,
  emotional_beat TEXT,
  reversal TEXT,
  cliffhanger TEXT,
  estimated_duration TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  scene_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  location TEXT NOT NULL,
  time_of_day TEXT,
  visual_description TEXT NOT NULL DEFAULT '',
  characters TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS script_reviews (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL,
  hook_strength_score REAL NOT NULL,
  dialogue_score REAL NOT NULL,
  conflict_score REAL NOT NULL,
  visual_clarity_score REAL NOT NULL,
  scene_clarity_score REAL NOT NULL,
  character_fit_score REAL NOT NULL,
  shot_readiness_score REAL NOT NULL,
  ai_video_feasibility_score REAL NOT NULL,
  cliffhanger_score REAL NOT NULL,
  overall_score REAL NOT NULL,
  issues TEXT NOT NULL DEFAULT '[]',
  suggestions TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shots (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  shot_number INTEGER NOT NULL,
  duration_seconds INTEGER,
  visual_description TEXT NOT NULL DEFAULT '',
  character_ids TEXT NOT NULL DEFAULT '[]',
  dialogue TEXT,
  narration TEXT,
  subtitle_draft TEXT,
  camera_angle TEXT,
  camera_movement TEXT,
  emotion TEXT,
  action TEXT,
  video_prompt TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT,
  image_prompt TEXT,
  cover_prompt TEXT,
  consistency_notes TEXT,
  ai_video_difficulty TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shot_reviews (
  id TEXT PRIMARY KEY,
  shot_id TEXT NOT NULL,
  length_score REAL NOT NULL,
  character_count_score REAL NOT NULL,
  action_complexity_score REAL NOT NULL,
  visual_clarity_score REAL NOT NULL,
  character_consistency_score REAL NOT NULL,
  scene_continuity_score REAL NOT NULL,
  prompt_controllability_score REAL NOT NULL,
  vertical_suitability_score REAL NOT NULL,
  overall_score REAL NOT NULL,
  ai_video_difficulty TEXT NOT NULL,
  issues TEXT NOT NULL DEFAULT '[]',
  suggestions TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id TEXT PRIMARY KEY,
  shot_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  task_type TEXT NOT NULL,
  video_prompt TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT,
  image_prompt TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS video_provider_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  base_url TEXT,
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT,
  default_params TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS video_generation_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  episode_id TEXT,
  scene_id TEXT,
  shot_id TEXT,
  lineage_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT,
  reference_image_urls TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  remote_task_id TEXT,
  error_message TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS video_results (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  shot_id TEXT,
  result_video_url TEXT NOT NULL,
  remote_video_url TEXT,
  local_video_path TEXT,
  cover_image_url TEXT,
  remote_cover_image_url TEXT,
  local_cover_image_path TEXT,
  raw_meta TEXT,
  archived_at TEXT,
  archive_error TEXT,
  is_best INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS asset_rights_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  rightsholder TEXT,
  source TEXT,
  rights_types TEXT NOT NULL DEFAULT '[]',
  permitted_uses TEXT NOT NULL DEFAULT '[]',
  platforms TEXT NOT NULL DEFAULT '[]',
  regions TEXT NOT NULL DEFAULT '[]',
  valid_from TEXT,
  valid_until TEXT,
  evidence_asset_id TEXT,
  evidence_sha256 TEXT,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unknown',
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS visual_asset_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  owner_kind TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  label TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate',
  notes TEXT,
  adopted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shot_visual_asset_locks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  shot_id TEXT NOT NULL,
  visual_asset_version_id TEXT NOT NULL,
  role TEXT NOT NULL,
  stale_at TEXT,
  stale_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shot_still_candidates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  shot_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate',
  label TEXT NOT NULL,
  notes TEXT,
  source_fingerprint TEXT,
  stale_at TEXT,
  stale_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS animatic_drafts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  adaptation_project_id TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  source_fingerprint TEXT NOT NULL,
  clips TEXT NOT NULL DEFAULT '[]',
  annotations TEXT NOT NULL DEFAULT '[]',
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_lineages (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  adaptation_project_id TEXT,
  episode_id TEXT,
  scene_id TEXT,
  shot_id TEXT,
  media_type TEXT NOT NULL,
  task_kind TEXT NOT NULL,
  task_id TEXT,
  parent_lineage_id TEXT,
  retry_of_lineage_id TEXT,
  source_entity_kind TEXT,
  source_entity_id TEXT,
  source_version TEXT,
  source_snapshot TEXT NOT NULL DEFAULT '{}',
  provider_snapshot TEXT NOT NULL DEFAULT '{}',
  parameter_snapshot TEXT NOT NULL DEFAULT '{}',
  reference_assets TEXT NOT NULL DEFAULT '[]',
  seed TEXT,
  completeness TEXT NOT NULL DEFAULT 'unknown',
  adopted_output_kind TEXT,
  adopted_output_id TEXT,
  adopted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_cost_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  adaptation_project_id TEXT,
  episode_id TEXT,
  scene_id TEXT,
  shot_id TEXT,
  lineage_id TEXT,
  task_id TEXT,
  media_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  currency TEXT,
  estimated_cost REAL,
  actual_cost REAL,
  estimate_basis TEXT,
  actual_cost_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  output_schema TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  built_in INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  scope TEXT,
  description TEXT,
  content TEXT NOT NULL DEFAULT '',
  variables TEXT NOT NULL DEFAULT '[]',
  built_in INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS genre_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  common_relationships TEXT NOT NULL DEFAULT '[]',
  common_highlights TEXT NOT NULL DEFAULT '[]',
  common_reversals TEXT NOT NULL DEFAULT '[]',
  common_openings TEXT NOT NULL DEFAULT '[]',
  common_cliffhangers TEXT NOT NULL DEFAULT '[]',
  visual_style TEXT NOT NULL,
  shot_prompt_advice TEXT NOT NULL,
  ai_video_risks TEXT NOT NULL,
  built_in INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS genre_market_snapshots (
  version TEXT PRIMARY KEY,
  observed_at TEXT NOT NULL,
  sources TEXT NOT NULL,
  opportunities TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS template_runs (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  project_id TEXT,
  scope TEXT NOT NULL,
  rendered_content TEXT NOT NULL DEFAULT '',
  variables TEXT NOT NULL DEFAULT '{}',
  ai_run_id TEXT,
  created_at TEXT NOT NULL
);
`

/**
 * 列级幂等迁移：CREATE TABLE IF NOT EXISTS 无法对已存在的表加列。
 * 用 PRAGMA table_info 探测已有列，对缺失列执行 ALTER TABLE ADD COLUMN。
 * 覆盖：projects.visual_style_direction、characters 视觉三字段、chapters.ai_video_note、
 *       evaluations 评分字段重命名后新增的三列（旧 budget_friendly_score 列保留为孤儿列，不再引用）。
 */
interface AddColumnSpec {
  table: string
  column: string
  definition: string
}

const ADD_COLUMN_SPECS: AddColumnSpec[] = [
  { table: 'projects', column: 'visual_style_direction', definition: 'TEXT' },
  { table: 'characters', column: 'visual_description', definition: 'TEXT' },
  { table: 'characters', column: 'appearance_prompt', definition: 'TEXT' },
  { table: 'characters', column: 'negative_prompt', definition: 'TEXT' },
  { table: 'chapters', column: 'ai_video_note', definition: 'TEXT' },
  { table: 'evaluations', column: 'ai_video_feasibility_score', definition: 'REAL' },
  { table: 'evaluations', column: 'character_consistency_score', definition: 'REAL' },
  { table: 'evaluations', column: 'shot_clarity_score', definition: 'REAL' },
  { table: 'video_results', column: 'remote_video_url', definition: 'TEXT' },
  { table: 'video_results', column: 'local_video_path', definition: 'TEXT' },
  { table: 'video_results', column: 'remote_cover_image_url', definition: 'TEXT' },
  { table: 'video_results', column: 'local_cover_image_path', definition: 'TEXT' },
  { table: 'video_results', column: 'archived_at', definition: 'TEXT' },
  { table: 'video_results', column: 'archive_error', definition: 'TEXT' },
  // 注：v1.0 多季的 season_number / source_chapter_range 由 v3 版本化迁移负责，
  //     不放这里（ensureColumns 在 v1 内对全新库先加列会导致 v3 ALTER 重复列报错）。
]

export function ensureColumns(raw: { exec(sql: string): void; prepare(sql: string): { all(...params: unknown[]): unknown[] } }): void {
  // 按 table 分组，每组只查一次 PRAGMA table_info
  const tables = [...new Set(ADD_COLUMN_SPECS.map((s) => s.table))]
  for (const table of tables) {
    let existing: Set<string>
    try {
      const rows = raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      existing = new Set(rows.map((r) => r.name))
    } catch {
      // 表不存在（理论上 ensureSchema 先跑过 CREATE，不会到这）；跳过
      continue
    }
    for (const spec of ADD_COLUMN_SPECS) {
      if (spec.table !== table) continue
      if (!existing.has(spec.column)) {
        raw.exec(`ALTER TABLE ${table} ADD COLUMN ${spec.column} ${spec.definition};`)
      }
    }
  }
}
