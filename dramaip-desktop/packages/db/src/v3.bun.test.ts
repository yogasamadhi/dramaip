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
