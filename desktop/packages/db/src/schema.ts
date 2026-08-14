import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/** Fresh v3 storage model. It never opens or reads the archived studio.db. */
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  shortDramaType: text("short_drama_type").notNull(),
  targetAudience: text("target_audience"),
  targetWordCount: integer("target_word_count"),
  targetEpisodeCount: integer("target_episode_count"),
  coreHook: text("core_hook"),
  emotionalCore: text("emotional_core"),
  coreSellingPoint: text("core_selling_point"),
  synopsis: text("synopsis").notNull().default(""),
  styleGuide: text("style_guide"),
  visualStyleDirection: text("visual_style_direction"),
  genreOpportunity: text("genre_opportunity"),
  productionBrief: text("production_brief"),
  deletedAt: text("deleted_at"),
  version: integer("version").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const chapters = sqliteTable(
  "chapters",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    orderIndex: integer("order_index").notNull(),
    summary: text("summary").notNull().default(""),
    outline: text("outline"),
    content: text("content").notNull().default(""),
    mainConflict: text("main_conflict"),
    hook: text("hook"),
    highlight: text("highlight"),
    reversal: text("reversal"),
    cliffhanger: text("cliffhanger"),
    shortDramaNote: text("short_drama_note"),
    aiVideoNote: text("ai_video_note"),
    version: integer("version").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("chapters_project_order").on(table.projectId, table.orderIndex),
  ],
);

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  title: text("title").notNull(),
  progress: integer("progress").notNull().default(0),
  projectId: text("project_id"),
  parentTaskId: text("parent_task_id"),
  resultJson: text("result_json"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const taskEvents = sqliteTable("task_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(),
  payloadJson: text("payload_json").notNull(),
  occurredAt: text("occurred_at").notNull(),
});
export const agentSessions = sqliteTable("agent_sessions", {
  id: text("id").primaryKey(),
  engineSessionId: text("engine_session_id").notNull().unique(),
  engineKind: text("engine_kind").notNull(),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  surface: text("surface").notNull().default("legacy"),
  chapterId: text("chapter_id").references(() => chapters.id, {
    onDelete: "set null",
  }),
  taskType: text("task_type"),
  title: text("title"),
  modelJson: text("model_json"),
  status: text("status").notNull(),
  activeTaskId: text("active_task_id").references(() => tasks.id, {
    onDelete: "set null",
  }),
  archivedAt: text("archived_at"),
  lastOpenedAt: text("last_opened_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const agentEngineConfigs = sqliteTable("agent_engine_configs", {
  engineKind: text("engine_kind").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  isDefault: integer("is_default", { mode: "boolean" })
    .notNull()
    .default(false),
  credentialRef: text("credential_ref"),
  modelJson: text("model_json"),
  updatedAt: text("updated_at").notNull(),
});

export const projectAgentSettings = sqliteTable("project_agent_settings", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  defaultEngineKind: text("default_engine_kind").notNull().default("opencode"),
  defaultModelJson: text("default_model_json"),
  assistantMode: text("assistant_mode").notNull().default("simple"),
  updatedAt: text("updated_at").notNull(),
});

export const agentContextSnapshots = sqliteTable(
  "agent_context_snapshots",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id").references(() => chapters.id, {
      onDelete: "set null",
    }),
    taskType: text("task_type").notNull(),
    promptVersion: text("prompt_version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    toolPolicyVersion: text("tool_policy_version").notNull(),
    contentHash: text("content_hash").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("agent_context_snapshots_hash").on(
      table.projectId,
      table.contentHash,
    ),
  ],
);

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    taskType: text("task_type").notNull(),
    engineKind: text("engine_kind").notNull(),
    status: text("status").notNull(),
    modelJson: text("model_json"),
    contextSnapshotId: text("context_snapshot_id").references(
      () => agentContextSnapshots.id,
      { onDelete: "set null" },
    ),
    turnId: text("turn_id"),
    chapterId: text("chapter_id").references(() => chapters.id, {
      onDelete: "set null",
    }),
    error: text("error"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cachedTokens: integer("cached_tokens"),
    estimatedCost: real("estimated_cost"),
    currency: text("currency"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("agent_runs_session").on(table.sessionId, table.createdAt)],
);

export const assistantTurns = sqliteTable(
  "assistant_turns",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => agentRuns.id, {
      onDelete: "set null",
    }),
    userMessage: text("user_message").notNull(),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    chapterId: text("chapter_id").references(() => chapters.id, {
      onDelete: "set null",
    }),
    selectionJson: text("selection_json"),
    routeJson: text("route_json"),
    routingInputTokens: integer("routing_input_tokens"),
    routingOutputTokens: integer("routing_output_tokens"),
    routingCachedTokens: integer("routing_cached_tokens"),
    routingEstimatedCost: real("routing_estimated_cost"),
    status: text("status").notNull(),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("assistant_turns_session").on(table.sessionId, table.createdAt),
  ],
);

export const agentItems = sqliteTable(
  "agent_items",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull(),
    content: text("content"),
    payloadJson: text("payload_json"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("agent_items_run_sequence").on(table.runId, table.sequence),
  ],
);

export const agentCheckpoints = sqliteTable(
  "agent_checkpoints",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    engineKind: text("engine_kind").notNull(),
    checkpointJson: text("checkpoint_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("agent_checkpoints_run").on(table.runId, table.createdAt)],
);
export const revisionPreviews = sqliteTable("revision_previews", {
  id: text("id").primaryKey(),
  chapterId: text("chapter_id")
    .notNull()
    .references(() => chapters.id, { onDelete: "cascade" }),
  baseVersion: integer("base_version").notNull(),
  proposedContent: text("proposed_content").notNull(),
  rationale: text("rationale").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  committedAt: text("committed_at"),
});

export const changePreviews = sqliteTable("change_previews", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => agentSessions.id, {
    onDelete: "set null",
  }),
  runId: text("run_id").references(() => agentRuns.id, {
    onDelete: "set null",
  }),
  taskId: text("task_id").references(() => tasks.id, {
    onDelete: "set null",
  }),
  engineKind: text("engine_kind"),
  taskType: text("task_type"),
  targetsJson: text("targets_json").notNull(),
  rationale: text("rationale").notNull(),
  status: text("status").notNull(),
  contentHash: text("content_hash").notNull(),
  createdAt: text("created_at").notNull(),
  committedAt: text("committed_at"),
});

export const providerActionPreviews = sqliteTable("provider_action_previews", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => agentSessions.id, {
    onDelete: "set null",
  }),
  runId: text("run_id").references(() => agentRuns.id, {
    onDelete: "set null",
  }),
  taskId: text("task_id").references(() => tasks.id, {
    onDelete: "set null",
  }),
  kind: text("kind").notNull(),
  providerId: text("provider_id").notNull(),
  modelId: text("model_id"),
  parametersJson: text("parameters_json").notNull(),
  estimatedCost: real("estimated_cost"),
  currency: text("currency"),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  executedAt: text("executed_at"),
});

export const agentExperimentGroups = sqliteTable("agent_experiment_groups", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  taskType: text("task_type").notNull(),
  contextSnapshotId: text("context_snapshot_id")
    .notNull()
    .references(() => agentContextSnapshots.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  comparisonMode: text("comparison_mode").notNull().default("recommended"),
  modelJson: text("model_json"),
  candidateOrderJson: text("candidate_order_json").notNull(),
  estimatedCost: real("estimated_cost"),
  currency: text("currency"),
  error: text("error"),
  revealed: integer("revealed", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const agentExperimentRuns = sqliteTable(
  "agent_experiment_runs",
  {
    id: text("id").primaryKey(),
    experimentId: text("experiment_id")
      .notNull()
      .references(() => agentExperimentGroups.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    candidate: text("candidate").notNull(),
    engineKind: text("engine_kind").notNull(),
    engineVersion: text("engine_version").notNull(),
    modelJson: text("model_json"),
    metricsJson: text("metrics_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("agent_experiment_candidate").on(
      table.experimentId,
      table.candidate,
    ),
  ],
);

export const agentExperimentReviews = sqliteTable(
  "agent_experiment_reviews",
  {
    id: text("id").primaryKey(),
    experimentId: text("experiment_id")
      .notNull()
      .references(() => agentExperimentGroups.id, { onDelete: "cascade" }),
    preferredCandidate: text("preferred_candidate").notNull(),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("agent_experiment_single_review").on(table.experimentId),
  ],
);

export const schema = {
  projects,
  chapters,
  tasks,
  taskEvents,
  agentEngineConfigs,
  projectAgentSettings,
  agentSessions,
  agentContextSnapshots,
  agentRuns,
  assistantTurns,
  agentItems,
  agentCheckpoints,
  revisionPreviews,
  changePreviews,
  providerActionPreviews,
  agentExperimentGroups,
  agentExperimentRuns,
  agentExperimentReviews,
};

/**
 * Agent 子系统的建表入口。Server 不再拥有这些表的 SQL；Drizzle 表定义与
 * 运行时建表语句保存在同一模块，并由 Node/Bun 两套 Repository 测试校验。
 */
export interface SqliteSchemaDatabase {
  exec(sql: string): unknown;
}

export function initializeV3AgentSchema(sqlite: SqliteSchemaDatabase): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_engine_configs (
      engine_kind TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      credential_ref TEXT,
      model_json TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_agent_settings (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      default_engine_kind TEXT NOT NULL DEFAULT 'opencode',
      default_model_json TEXT,
      assistant_mode TEXT NOT NULL DEFAULT 'simple',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      engine_session_id TEXT NOT NULL UNIQUE,
      engine_kind TEXT NOT NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      surface TEXT NOT NULL DEFAULT 'legacy',
      chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
      task_type TEXT,
      title TEXT,
      model_json TEXT,
      status TEXT NOT NULL,
      active_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      archived_at TEXT,
      last_opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS agent_sessions_project
      ON agent_sessions(project_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS agent_context_snapshots (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
      task_type TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      schema_version TEXT NOT NULL,
      tool_policy_version TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS agent_context_snapshots_hash
      ON agent_context_snapshots(project_id, content_hash);
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      task_type TEXT NOT NULL,
      engine_kind TEXT NOT NULL,
      status TEXT NOT NULL,
      model_json TEXT,
      context_snapshot_id TEXT REFERENCES agent_context_snapshots(id) ON DELETE SET NULL,
      turn_id TEXT,
      chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
      error TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cached_tokens INTEGER,
      estimated_cost REAL,
      currency TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS agent_runs_session
      ON agent_runs(session_id, created_at);
    CREATE TABLE IF NOT EXISTS assistant_turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
      user_message TEXT NOT NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
      selection_json TEXT,
      route_json TEXT,
      routing_input_tokens INTEGER,
      routing_output_tokens INTEGER,
      routing_cached_tokens INTEGER,
      routing_estimated_cost REAL,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS assistant_turns_session
      ON assistant_turns(session_id, created_at);
    CREATE TABLE IF NOT EXISTS agent_items (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      content TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS agent_items_run_sequence
      ON agent_items(run_id, sequence);
    CREATE TABLE IF NOT EXISTS agent_checkpoints (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      engine_kind TEXT NOT NULL,
      checkpoint_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS agent_checkpoints_run
      ON agent_checkpoints(run_id, created_at);
    CREATE TABLE IF NOT EXISTS change_previews (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL,
      run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      engine_kind TEXT,
      task_type TEXT,
      targets_json TEXT NOT NULL,
      rationale TEXT NOT NULL,
      status TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      committed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS provider_action_previews (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL,
      run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT,
      parameters_json TEXT NOT NULL,
      estimated_cost REAL,
      currency TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      executed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS agent_experiment_groups (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_type TEXT NOT NULL,
      context_snapshot_id TEXT NOT NULL REFERENCES agent_context_snapshots(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      comparison_mode TEXT NOT NULL DEFAULT 'recommended',
      model_json TEXT,
      candidate_order_json TEXT NOT NULL,
      estimated_cost REAL,
      currency TEXT,
      error TEXT,
      revealed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_experiment_runs (
      id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL REFERENCES agent_experiment_groups(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      candidate TEXT NOT NULL,
      engine_kind TEXT NOT NULL,
      engine_version TEXT NOT NULL,
      model_json TEXT,
      metrics_json TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(experiment_id, candidate)
    );
    CREATE TABLE IF NOT EXISTS agent_experiment_reviews (
      id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL UNIQUE REFERENCES agent_experiment_groups(id) ON DELETE CASCADE,
      preferred_candidate TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL
    );
  `);
  // 早期 HTTP 架构已经创建过 agent_sessions，但当时还没有任务目录、
  // 会话标题和模型快照。CREATE TABLE IF NOT EXISTS 不会补列，因此旧的新架构
  // 数据库会在引擎成功创建会话后，因本地 INSERT 缺列而失败。这里采用仅追加列的
  // 原位升级，保留项目数据和已有会话；Node/Bun SQLite 共用同一迁移入口。
  addColumnIfMissing(sqlite, "agent_sessions", "task_type", "TEXT");
  addColumnIfMissing(sqlite, "agent_sessions", "title", "TEXT");
  addColumnIfMissing(sqlite, "agent_sessions", "model_json", "TEXT");
  addColumnIfMissing(
    sqlite,
    "agent_sessions",
    "surface",
    "TEXT NOT NULL DEFAULT 'legacy'",
  );
  addColumnIfMissing(sqlite, "agent_sessions", "archived_at", "TEXT");
  addColumnIfMissing(sqlite, "agent_sessions", "last_opened_at", "TEXT");
  sqlite.exec(
    "UPDATE agent_sessions SET last_opened_at = updated_at WHERE last_opened_at IS NULL",
  );
  rebuildAgentSessionsWithOptionalProject(sqlite);
  addColumnIfMissing(sqlite, "agent_runs", "turn_id", "TEXT");
  addColumnIfMissing(sqlite, "agent_runs", "chapter_id", "TEXT");
  addColumnIfMissing(
    sqlite,
    "assistant_turns",
    "routing_input_tokens",
    "INTEGER",
  );
  addColumnIfMissing(
    sqlite,
    "assistant_turns",
    "routing_output_tokens",
    "INTEGER",
  );
  addColumnIfMissing(
    sqlite,
    "assistant_turns",
    "routing_cached_tokens",
    "INTEGER",
  );
  addColumnIfMissing(
    sqlite,
    "assistant_turns",
    "routing_estimated_cost",
    "REAL",
  );
  // v3 databases predate the presentation preference. SQLite lacks an
  // idempotent ADD COLUMN form, so an existing column is the only expected
  // failure on repeated startup.
  addColumnIfMissing(
    sqlite,
    "project_agent_settings",
    "assistant_mode",
    "TEXT NOT NULL DEFAULT 'simple'",
  );
}

function rebuildAgentSessionsWithOptionalProject(
  sqlite: SqliteSchemaDatabase,
): void {
  const columns = (
    sqlite as SqliteSchemaDatabase & {
      prepare?(sql: string): {
        all?(): Array<Record<string, unknown>>;
      };
    }
  )
    .prepare?.("PRAGMA table_info(agent_sessions)")
    .all?.();
  const projectColumn = columns?.find((column) => column.name === "project_id");
  if (!projectColumn || Number(projectColumn.notnull) === 0) return;
  sqlite.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN IMMEDIATE;
    CREATE TABLE agent_sessions_v4 (
      id TEXT PRIMARY KEY,
      engine_session_id TEXT NOT NULL UNIQUE,
      engine_kind TEXT NOT NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      surface TEXT NOT NULL DEFAULT 'legacy',
      chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
      task_type TEXT,
      title TEXT,
      model_json TEXT,
      status TEXT NOT NULL,
      active_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      archived_at TEXT,
      last_opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO agent_sessions_v4 (
      id, engine_session_id, engine_kind, project_id, surface, chapter_id,
      task_type, title, model_json, status, active_task_id, archived_at,
      last_opened_at, created_at, updated_at
    )
    SELECT id, engine_session_id, engine_kind, project_id,
      COALESCE(surface, 'legacy'), chapter_id, task_type, title, model_json,
      status, active_task_id, archived_at, COALESCE(last_opened_at, updated_at),
      created_at, updated_at
    FROM agent_sessions;
    DROP TABLE agent_sessions;
    ALTER TABLE agent_sessions_v4 RENAME TO agent_sessions;
    CREATE INDEX agent_sessions_project
      ON agent_sessions(project_id, updated_at DESC);
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

function addColumnIfMissing(
  sqlite: SqliteSchemaDatabase,
  table: string,
  column: string,
  definition: string,
): void {
  try {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (cause) {
    if (/duplicate column name/i.test(String(cause))) return;
    throw cause;
  }
}
