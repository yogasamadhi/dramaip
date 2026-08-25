import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginMigration } from "@dramaip/plugin-api/internal";
import { openDatabase } from "./index.js";
import { runMigrationPlanInWorker } from "./migration-worker.js";

if (process.versions.bun !== "1.4.0")
  throw new Error("Migration Worker integration requires Bun 1.4.0");

const directory = mkdtempSync(join(tmpdir(), "dramaip-worker-test-"));
const databasePath = join(directory, "dramaip.db");
const workerEntry = fileURLToPath(
  new URL("../../runtime/src/migration-worker-process.ts", import.meta.url),
);

try {
  const migration: PluginMigration = {
    id: "worker-test.0001",
    pluginId: "worker-test",
    version: "1.0.0",
    dependsOn: [],
    sql: "CREATE TABLE worker_test(value TEXT NOT NULL);",
  };
  const diagnostic = await runMigrationPlanInWorker({
    runtimeKind: "bun",
    executable: process.execPath,
    workerEntry,
    databasePath,
    backupDirectory: join(directory, "backups"),
    migrations: [migration],
    dryRun: true,
  });
  assert.equal(diagnostic.appliedCount, 1);
  assert.equal(diagnostic.integrity, "ok");
  let database = openDatabase(databasePath);
  assert.ok(
    database.sqlite
      .prepare(
        "SELECT migration_id FROM plugin_migrations WHERE migration_id = ?",
      )
      .get(migration.id),
  );
  database.close();

  const stuckMigration: PluginMigration = {
    id: "worker-test.0002-timeout",
    pluginId: "worker-test",
    version: "1.0.0",
    dependsOn: [],
    sql: `
      CREATE TABLE worker_timeout(value INTEGER NOT NULL);
      INSERT INTO worker_timeout(value)
      WITH RECURSIVE values_forever(value) AS (
        VALUES(1) UNION ALL SELECT value + 1 FROM values_forever
      ) SELECT value FROM values_forever;
    `,
  };
  const stuckDatabasePath = join(directory, "stuck.db");
  await assert.rejects(
    runMigrationPlanInWorker({
      runtimeKind: "bun",
      executable: process.execPath,
      workerEntry,
      databasePath: stuckDatabasePath,
      backupDirectory: join(directory, "backups"),
      migrations: [stuckMigration],
      dryRun: false,
      migrationTimeoutMs: 50,
      totalTimeoutMs: 2_000,
    }),
    /migration timed out/u,
  );
  database = openDatabase(stuckDatabasePath);
  assert.equal(
    database.sqlite
      .prepare(
        "SELECT 1 FROM plugin_migrations WHERE migration_id = 'worker-test.0002-timeout'",
      )
      .get(),
    null,
  );
  assert.equal(
    database.sqlite
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'worker_timeout'",
      )
      .get(),
    null,
  );
  database.close();
  console.log("Bun Migration Worker integration passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
