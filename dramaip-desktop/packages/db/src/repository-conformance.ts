import { initializeV3AgentSchema, type SqliteSchemaDatabase } from "./schema";
import { initializeOperationalSchema } from "./operational-schema";

type Statement = {
  run(...values: unknown[]): unknown;
  get(...values: any[]): Record<string, unknown> | null | undefined;
};
export type RepositoryConformanceDatabase = SqliteSchemaDatabase & {
  prepare(sql: string): Statement;
};

/** Node 与 Bun 适配器共同执行的最小 Repository 合约。 */
export function runRepositoryConformanceSuite(
  sqlite: RepositoryConformanceDatabase,
): void {
  initializeOperationalSchema(sqlite);
  // 复现第一版 HTTP 数据库，确保应用升级后会原位补齐会话列，且无需删库。
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      engine_session_id TEXT NOT NULL UNIQUE,
      engine_kind TEXT NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
      status TEXT NOT NULL,
      active_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  initializeV3AgentSchema(sqlite);
  sqlite
    .prepare(
      `INSERT INTO projects(
        id, title, short_drama_type, synopsis, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "project-1",
      "Repository 合约项目",
      "悬疑",
      "",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
  sqlite
    .prepare(
      `INSERT INTO tasks(
        id, kind, status, title, progress, project_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "task-1",
      "agent.chapter_diagnostic",
      "running",
      "章节诊断",
      0,
      "project-1",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
  sqlite
    .prepare(
      `INSERT INTO agent_sessions(
        id, engine_session_id, engine_kind, project_id, task_type, title,
        model_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "session-1",
      "engine-session-1",
      "opencode",
      "project-1",
      "generate_chapter",
      "AI 生成正文：第 1 章",
      JSON.stringify({ modelId: "测试模型" }),
      "idle",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
  const migratedSession = sqlite
    .prepare(
      "SELECT task_type, title, model_json FROM agent_sessions WHERE id = ?",
    )
    .get("session-1");
  if (
    migratedSession?.task_type !== "generate_chapter" ||
    migratedSession.title !== "AI 生成正文：第 1 章" ||
    JSON.parse(String(migratedSession.model_json)).modelId !== "测试模型"
  )
    throw new Error("Repository 合约：早期智能会话表未完成原位升级");
  sqlite
    .prepare(
      `INSERT INTO agent_runs(
        id, session_id, task_id, task_type, engine_kind, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "run-1",
      "session-1",
      "task-1",
      "chapter_diagnostic",
      "opencode",
      "running",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
  sqlite
    .prepare(
      `INSERT INTO agent_items(
        id, run_id, sequence, type, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "item-1",
      "run-1",
      1,
      "message",
      "completed",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
  const count = Number(
    sqlite.prepare("SELECT COUNT(*) AS value FROM agent_items").get()?.value,
  );
  if (count !== 1) throw new Error("Repository 合约：运行条目未正确持久化");
  sqlite
    .prepare(
      `INSERT INTO agent_engine_configs(
        engine_kind, enabled, is_default, model_json, updated_at
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      "opencode",
      1,
      1,
      JSON.stringify({ modelId: "测试模型" }),
      "2026-01-01T00:00:00.000Z",
    );
  const defaultEngine = sqlite
    .prepare(
      "SELECT engine_kind, model_json FROM agent_engine_configs WHERE is_default = 1",
    )
    .get();
  if (
    defaultEngine?.engine_kind !== "opencode" ||
    JSON.parse(String(defaultEngine.model_json)).modelId !== "测试模型"
  )
    throw new Error("Repository 合约：全局智能引擎设置未正确持久化");
  sqlite.prepare("DELETE FROM agent_sessions WHERE id = ?").run("session-1");
  const runCount = Number(
    sqlite.prepare("SELECT COUNT(*) AS value FROM agent_runs").get()?.value,
  );
  if (runCount !== 0) throw new Error("Repository 合约：级联删除未生效");
}
