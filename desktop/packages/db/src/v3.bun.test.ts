import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeV3AgentSchema } from "./schema";
import { initializeOperationalSchema } from "./operational-schema";
import { openBunSqliteDatabase } from "./bun-adapter";
import { runRepositoryConformanceSuite } from "./repository-conformance";

test("bun:sqlite 适配器与 Node 适配器使用同一正式 Schema", () => {
  const directory = mkdtempSync(join(tmpdir(), "dramaip-bun-db-"));
  const { sqlite } = openBunSqliteDatabase(join(directory, "dramaip.db"));
  try {
    initializeOperationalSchema(sqlite);
    initializeV3AgentSchema(sqlite);
    expect(sqlite.query("PRAGMA foreign_keys").get()).toMatchObject({
      foreign_keys: 1,
    });
    const tables = sqlite
      .query("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    expect(tables.some((table) => table.name === "agent_runs")).toBe(true);
    expect(
      tables.some((table) => table.name === "agent_experiment_reviews"),
    ).toBe(true);
    expect(
      tables.some((table) => table.name === "import_extraction_change_sets"),
    ).toBe(true);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("bun:sqlite 适配器通过共享 Repository 合约", () => {
  const directory = mkdtempSync(join(tmpdir(), "dramaip-bun-repository-"));
  const { sqlite } = openBunSqliteDatabase(join(directory, "dramaip.db"));
  try {
    runRepositoryConformanceSuite(sqlite);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("旧项目智能设置会补齐默认的简单助手偏好", () => {
  const directory = mkdtempSync(join(tmpdir(), "dramaip-bun-agent-mode-"));
  const { sqlite } = openBunSqliteDatabase(join(directory, "dramaip.db"));
  try {
    initializeOperationalSchema(sqlite);
    sqlite.exec(`
      CREATE TABLE project_agent_settings (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        default_engine_kind TEXT NOT NULL DEFAULT 'opencode',
        default_model_json TEXT,
        updated_at TEXT NOT NULL
      );
    `);
    initializeV3AgentSchema(sqlite);
    expect(
      sqlite.query("SELECT assistant_mode FROM project_agent_settings").all(),
    ).toEqual([]);
    const columns = sqlite
      .query("PRAGMA table_info(project_agent_settings)")
      .all() as Array<{ name: string }>;
    expect(columns.some((column) => column.name === "assistant_mode")).toBe(
      true,
    );
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("旧会话表原位升级为可选项目的聊天会话与逐轮上下文", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "dramaip-bun-conversation-upgrade-"),
  );
  const { sqlite } = openBunSqliteDatabase(join(directory, "dramaip.db"));
  try {
    initializeOperationalSchema(sqlite);
    sqlite.exec(`
      CREATE TABLE agent_sessions (
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
    const projectColumn = (
      sqlite.query("PRAGMA table_info(agent_sessions)").all() as Array<{
        name: string;
        notnull: number;
      }>
    ).find((column) => column.name === "project_id");
    expect(projectColumn?.notnull).toBe(0);
    expect(sqlite.query("PRAGMA foreign_keys").get()).toEqual({
      foreign_keys: 1,
    });
    sqlite
      .query(
        `INSERT INTO agent_sessions(
          id, engine_session_id, engine_kind, project_id, surface, title,
          status, last_opened_at, created_at, updated_at
        ) VALUES (?, ?, 'opencode', NULL, 'global', '通用对话', 'idle', ?, ?, ?)`,
      )
      .run(
        "conversation",
        "engine-conversation",
        "2026-08-14",
        "2026-08-14",
        "2026-08-14",
      );
    sqlite
      .query(
        `INSERT INTO assistant_turns(
          id, session_id, user_message, status, created_at, updated_at
        ) VALUES (?, ?, ?, 'needs_input', ?, ?)`,
      )
      .run(
        "turn",
        "conversation",
        "帮我想一个标题",
        "2026-08-14",
        "2026-08-14",
      );
    expect(
      sqlite
        .query(
          "SELECT project_id, surface FROM agent_sessions WHERE id = 'conversation'",
        )
        .get(),
    ).toEqual({ project_id: null, surface: "global" });
    expect(
      sqlite
        .query("SELECT user_message FROM assistant_turns WHERE id = 'turn'")
        .get(),
    ).toEqual({ user_message: "帮我想一个标题" });
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
