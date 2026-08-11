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
