CREATE TABLE projects (
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO projects (
  id,
  title,
  short_drama_type,
  target_audience,
  target_word_count,
  target_episode_count,
  core_hook,
  emotional_core,
  core_selling_point,
  synopsis,
  style_guide,
  created_at,
  updated_at
) VALUES (
  'p-legacy',
  '旧库项目',
  '复仇',
  '女性用户',
  120000,
  80,
  '重生复仇',
  '爽感',
  '反击',
  '旧版本项目简介',
  '快节奏',
  '2025-01-01T00:00:00.000Z',
  '2025-01-01T00:00:00.000Z'
);

CREATE TABLE characters (
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
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO characters (
  id,
  project_id,
  name,
  role,
  identity,
  personality,
  desire,
  secret,
  weakness,
  arc,
  relationship_to_protagonist,
  conflict_target,
  emotional_function,
  short_drama_function,
  notes,
  created_at,
  updated_at
) VALUES (
  'c-legacy',
  'p-legacy',
  '林晚',
  'protagonist',
  '重生千金',
  '果断',
  '复仇',
  '知道未来',
  '信任成本高',
  '从隐忍到掌控',
  '本人',
  '继母',
  '爽点承载',
  '女主',
  '旧库人物备注',
  '2025-01-01T00:00:00.000Z',
  '2025-01-01T00:00:00.000Z'
);

CREATE TABLE chapters (
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO chapters (
  id,
  project_id,
  title,
  order_index,
  summary,
  outline,
  content,
  main_conflict,
  hook,
  highlight,
  reversal,
  cliffhanger,
  short_drama_note,
  created_at,
  updated_at
) VALUES (
  'ch-legacy',
  'p-legacy',
  '第 1 章',
  1,
  '旧库章节摘要',
  '旧库章节大纲',
  '旧库正文',
  '家族夺权',
  '重生醒来',
  '当众反击',
  '识破圈套',
  '证据出现',
  '短剧化备注',
  '2025-01-01T00:00:00.000Z',
  '2025-01-01T00:00:00.000Z'
);

CREATE TABLE evaluations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  chapter_id TEXT,
  total_score REAL NOT NULL,
  hook_score REAL NOT NULL,
  conflict_score REAL NOT NULL,
  reversal_score REAL NOT NULL,
  emotion_score REAL NOT NULL,
  visualization_score REAL NOT NULL,
  cliffhanger_score REAL NOT NULL,
  adaptation_difficulty_score REAL NOT NULL,
  budget_friendly_score REAL NOT NULL,
  issues TEXT NOT NULL DEFAULT '[]',
  suggestions TEXT NOT NULL DEFAULT '[]',
  raw_result TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO evaluations (
  id,
  project_id,
  chapter_id,
  total_score,
  hook_score,
  conflict_score,
  reversal_score,
  emotion_score,
  visualization_score,
  cliffhanger_score,
  adaptation_difficulty_score,
  budget_friendly_score,
  issues,
  suggestions,
  raw_result,
  created_at
) VALUES (
  'e-legacy',
  'p-legacy',
  'ch-legacy',
  80,
  81,
  82,
  83,
  84,
  85,
  86,
  40,
  90,
  '[]',
  '[]',
  '{}',
  '2025-01-01T00:00:00.000Z'
);

CREATE TABLE adaptation_projects (
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

INSERT INTO adaptation_projects (
  id,
  source_project_id,
  title,
  target_episode_count,
  episode_duration,
  adaptation_style,
  visual_style_direction,
  audience,
  strategy,
  created_at,
  updated_at
) VALUES (
  'a-legacy',
  'p-legacy',
  '旧库改编',
  24,
  '1min',
  '强钩子',
  '现代都市',
  '短剧用户',
  '{}',
  '2025-01-01T00:00:00.000Z',
  '2025-01-01T00:00:00.000Z'
);

CREATE TABLE video_results (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  shot_id TEXT,
  result_video_url TEXT NOT NULL,
  cover_image_url TEXT,
  raw_meta TEXT,
  is_best INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO video_results (
  id,
  task_id,
  shot_id,
  result_video_url,
  cover_image_url,
  raw_meta,
  is_best,
  note,
  created_at
) VALUES (
  'vr-legacy',
  'vt-legacy',
  NULL,
  'https://example.invalid/video.mp4',
  NULL,
  '{}',
  1,
  '旧库视频结果',
  '2025-01-01T00:00:00.000Z'
);
