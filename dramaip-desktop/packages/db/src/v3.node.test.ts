import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openNodeSqliteDatabase } from "./v3";
import { runRepositoryConformanceSuite } from "./repository-conformance";

test("node:sqlite adapter enables the v3 SQLite safety pragmas", () => {
  const directory = mkdtempSync(join(tmpdir(), "dramaip-db-"));
  const path = join(directory, "dramaip.db");
  const { sqlite } = openNodeSqliteDatabase(path);
  try {
    assert.equal(sqlite.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
    assert.equal(
      sqlite.prepare("PRAGMA journal_mode").get()?.journal_mode,
      "wal",
    );
    sqlite.exec("CREATE TABLE parent (id TEXT PRIMARY KEY);");
    sqlite.exec(
      "CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent(id));",
    );
    assert.throws(
      () =>
        sqlite.prepare("INSERT INTO child VALUES (?, ?)").run("c1", "missing"),
      /FOREIGN KEY constraint failed/,
    );
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("node:sqlite adapter passes the shared Repository conformance suite", () => {
  const directory = mkdtempSync(join(tmpdir(), "dramaip-node-repository-"));
  const { sqlite } = openNodeSqliteDatabase(join(directory, "dramaip.db"));
  try {
    runRepositoryConformanceSuite(sqlite);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
