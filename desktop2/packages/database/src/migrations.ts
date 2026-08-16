import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { MigrationDefinition } from "@dramaip/plugin-api";

export const foundationMigrations: readonly MigrationDefinition[] = [
  {
    id: "foundation-0001",
    pluginId: "foundation",
    version: "1.0.0",
    dependsOn: [],
    sql: `
      CREATE TABLE IF NOT EXISTS domain_events (
        cursor INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        plugin_id TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        aggregate_version INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS domain_events_aggregate_idx
        ON domain_events (aggregate_type, aggregate_id, aggregate_version);
      CREATE TABLE IF NOT EXISTS event_consumer_checkpoints (
        consumer_id TEXT PRIMARY KEY,
        plugin_id TEXT NOT NULL,
        cursor INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS idempotency_records (
        scope TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_status INTEGER NOT NULL,
        response_headers_json TEXT NOT NULL,
        response_body BLOB,
        created_at TEXT NOT NULL,
        PRIMARY KEY (scope, idempotency_key)
      );
    `,
  },
] as const;

function checksum(migration: MigrationDefinition): string {
  return createHash("sha256").update(migration.sql).digest("hex");
}

export function sortMigrations(
  migrations: readonly MigrationDefinition[],
): readonly MigrationDefinition[] {
  const byId = new Map(
    migrations.map((migration) => [migration.id, migration]),
  );
  if (byId.size !== migrations.length)
    throw new Error("duplicate migration id");
  const state = new Map<string, "visiting" | "visited">();
  const output: MigrationDefinition[] = [];

  const visit = (id: string, trail: readonly string[]): void => {
    const status = state.get(id);
    if (status === "visited") return;
    if (status === "visiting")
      throw new Error(`migration cycle: ${[...trail, id].join(" -> ")}`);
    const migration = byId.get(id);
    if (!migration) throw new Error(`missing migration dependency: ${id}`);
    state.set(id, "visiting");
    for (const dependency of migration.dependsOn)
      visit(dependency, [...trail, id]);
    state.set(id, "visited");
    output.push(migration);
  };

  for (const migration of migrations) visit(migration.id, []);
  return output;
}

export function applyMigrations(
  database: DatabaseSync,
  migrations: readonly MigrationDefinition[],
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS plugin_migrations (
      migration_id TEXT PRIMARY KEY,
      plugin_id TEXT NOT NULL,
      version TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const read = database.prepare(
    "SELECT plugin_id, version, checksum FROM plugin_migrations WHERE migration_id = ?",
  );
  const record = database.prepare(
    "INSERT INTO plugin_migrations (migration_id, plugin_id, version, checksum, applied_at) VALUES (?, ?, ?, ?, ?)",
  );

  for (const migration of sortMigrations(migrations)) {
    const expected = checksum(migration);
    const existing = read.get(migration.id) as
      | { plugin_id: string; version: string; checksum: string }
      | undefined;
    if (existing) {
      if (
        existing.plugin_id !== migration.pluginId ||
        existing.version !== migration.version ||
        existing.checksum !== expected
      ) {
        throw new Error(`migration checksum changed: ${migration.id}`);
      }
      continue;
    }

    if (migration.foreignKeysOff) database.exec("PRAGMA foreign_keys = OFF");
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      if (migration.foreignKeysOff) {
        const violations = database
          .prepare("PRAGMA foreign_key_check")
          .all() as unknown[];
        if (violations.length)
          throw new Error(
            `foreign key check failed with ${violations.length} violation(s)`,
          );
      }
      record.run(
        migration.id,
        migration.pluginId,
        migration.version,
        expected,
        new Date().toISOString(),
      );
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw new Error(`migration failed: ${migration.id}`, { cause: error });
    } finally {
      if (migration.foreignKeysOff) database.exec("PRAGMA foreign_keys = ON");
    }
  }
}
