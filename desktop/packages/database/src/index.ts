import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { DomainEvent } from "@dramaip/contracts";
import type {
  DatabaseBackupSnapshot,
  DatabaseMaintenanceService,
} from "@dramaip/contracts/foundation";
import type {
  PendingDomainEvent,
  PluginMigration,
  UnitOfWork,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { createSqlite, type SqliteDatabase } from "./sqlite.js";

export {
  prepareDestructiveV3Cutover,
  type DestructiveCutover,
  type DestructiveCutoverOptions,
  type LegacyDatabaseManifest,
} from "./cutover.js";
export {
  prepareAlpha1ToAlpha2Cutover,
  type Alpha1ToAlpha2Cutover,
  type Alpha1ToAlpha2CutoverOptions,
  type Alpha2DatabaseManifest,
} from "./alpha2-cutover.js";
export {
  prepareAlpha2ToAlpha3AgentCutover,
  type Alpha2ToAlpha3AgentCutover,
  type Alpha2ToAlpha3AgentCutoverOptions,
  type Alpha3AgentCutoverManifest,
} from "./alpha3-agent-cutover.js";

export interface DatabaseHandle {
  sqlite: SqliteDatabase;
  uow: SqliteUnitOfWork;
  maintenance(backupDirectory: string): DatabaseMaintenanceService;
  close(): void;
}

export interface AppliedMigrationDiagnostic {
  migrationId: string;
  pluginId: string;
  version: string;
  appliedAt: string;
}

export interface MigrationPlan {
  readonly ordered: readonly PluginMigration[];
  readonly pending: readonly PluginMigration[];
  readonly appliedCount: number;
}

export interface MigrationRunDiagnostic {
  readonly pendingCount: number;
  readonly appliedCount: number;
  readonly backup?: DatabaseBackupSnapshot;
  readonly dryRun: boolean;
  readonly integrity: "ok";
  readonly elapsedMs: number;
}

export interface MigrationRunOptions {
  readonly databasePath: string;
  readonly backupDirectory: string;
  readonly dryRun?: boolean;
  readonly migrationTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly onProgress?: (event: {
    phase: "dry-run" | "apply";
    status: "started" | "completed";
    migrationId: string;
  }) => void;
}

export const foundationMigrations: readonly PluginMigration[] = [
  {
    id: "foundation.0001.runtime-ledger",
    pluginId: "foundation",
    version: "3.0.0-alpha.2",
    dependsOn: [],
    sql: `
      CREATE TABLE IF NOT EXISTS plugin_migrations (
        migration_id TEXT PRIMARY KEY,
        plugin_id TEXT NOT NULL,
        version TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
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
      CREATE INDEX IF NOT EXISTS domain_events_type_cursor
        ON domain_events(type, cursor);
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
  {
    id: "foundation.0002.event-delivery-failures",
    pluginId: "foundation",
    version: "3.0.0-alpha.3",
    dependsOn: ["foundation.0001.runtime-ledger"],
    sql: `
      CREATE TABLE IF NOT EXISTS event_consumer_failures (
        consumer_id TEXT NOT NULL,
        cursor INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        status TEXT NOT NULL,
        last_error TEXT NOT NULL,
        first_failed_at TEXT NOT NULL,
        last_failed_at TEXT NOT NULL,
        PRIMARY KEY (consumer_id, cursor)
      );
      CREATE INDEX IF NOT EXISTS event_consumer_failures_status
        ON event_consumer_failures(status, last_failed_at);
    `,
  },
];

export function openDatabase(path: string): DatabaseHandle {
  const directory = dirname(path);
  if (path !== ":memory:" && directory !== ".")
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  const sqlite = createSqlite(path);
  sqlite.exec(
    "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;",
  );
  return {
    sqlite,
    uow: new SqliteUnitOfWork(sqlite),
    maintenance: (backupDirectory) =>
      databaseMaintenance(sqlite, path, backupDirectory),
    close: () => sqlite.close(),
  };
}

function verifiedSnapshot(path: string): DatabaseBackupSnapshot {
  // A checkpointed copy of an open WAL database may need a writable first
  // connection so SQLite can establish and clean up its sidecar state.
  const result = integrityCheck(path, { readOnly: false });
  if (result !== "ok")
    throw new Error(`database backup integrity check failed: ${result}`);
  return {
    fileName: basename(path),
    size: statSync(path).size,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    createdAt: new Date().toISOString(),
  };
}

function validTableName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(value);
}

function databaseMaintenance(
  sqlite: SqliteDatabase,
  databasePath: string,
  backupDirectory: string,
): DatabaseMaintenanceService {
  return {
    createBackup: () => {
      if (databasePath === ":memory:")
        throw new Error("in-memory databases cannot be backed up");
      sqlite.prepare("PRAGMA wal_checkpoint(TRUNCATE)").all();
      const current = integrityCheck(databasePath);
      if (current !== "ok")
        throw new Error(`active database integrity check failed: ${current}`);
      mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
      const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
      const fileName = `dramaip-${stamp}-${randomUUID()}.db`;
      const target = join(backupDirectory, fileName);
      const temporary = `${target}.${process.pid}.tmp`;
      try {
        copyFileSync(databasePath, temporary);
        const snapshot = verifiedSnapshot(temporary);
        renameSync(temporary, target);
        return { ...snapshot, fileName };
      } catch (error) {
        try {
          unlinkSync(temporary);
        } catch {}
        throw error;
      }
    },
    restoreBackup: (fileName, expectedSha256) => {
      const safeName = basename(fileName);
      if (safeName !== fileName) throw new Error("invalid backup file name");
      const backupPath = join(backupDirectory, safeName);
      const snapshot = verifiedSnapshot(backupPath);
      if (snapshot.sha256 !== expectedSha256)
        throw new Error("database backup checksum mismatch");
      const source = createSqlite(backupPath, { readOnly: true });
      const backupTables = source
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as Array<{ name: string; sql: string }>;
      source.close();
      const currentTables = sqlite
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as Array<{ name: string; sql: string }>;
      if (
        JSON.stringify(backupTables) !== JSON.stringify(currentTables) ||
        backupTables.some((table) => !validTableName(table.name))
      )
        throw new Error("database backup schema is incompatible");
      sqlite.prepare("ATTACH DATABASE ? AS dramaip_restore").run(backupPath);
      try {
        sqlite.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE");
        for (const { name } of currentTables)
          sqlite.exec(
            `DELETE FROM main."${name}"; INSERT INTO main."${name}" SELECT * FROM dramaip_restore."${name}";`,
          );
        sqlite.exec("COMMIT; PRAGMA foreign_keys = ON");
        if (sqlite.prepare("PRAGMA foreign_key_check").all().length > 0)
          throw new Error("restored database violates foreign keys");
      } catch (error) {
        try {
          sqlite.exec("ROLLBACK; PRAGMA foreign_keys = ON");
        } catch {}
        throw error;
      } finally {
        sqlite.exec("DETACH DATABASE dramaip_restore");
      }
    },
  };
}

function migrationChecksum(migration: PluginMigration): string {
  return createHash("sha256").update(migration.sql).digest("hex");
}

function hasMigrationLedger(sqlite: SqliteDatabase): boolean {
  return Boolean(
    sqlite
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plugin_migrations' LIMIT 1",
      )
      .get(),
  );
}

function activeIntegrityCheck(sqlite: SqliteDatabase): "ok" {
  const row = sqlite.prepare("PRAGMA integrity_check").get() as
    { integrity_check?: string } | undefined;
  const result = row?.integrity_check ?? "unknown";
  if (result !== "ok")
    throw new Error(`active database integrity check failed: ${result}`);
  return "ok";
}

export function planMigrations(
  sqlite: SqliteDatabase,
  migrations: readonly PluginMigration[],
): MigrationPlan {
  const ordered = sortMigrations(migrations);
  if (!hasMigrationLedger(sqlite))
    return { ordered, pending: ordered, appliedCount: 0 };
  const read = sqlite.prepare(
    "SELECT plugin_id, version, checksum FROM plugin_migrations WHERE migration_id = ?",
  );
  let appliedCount = 0;
  const pending: PluginMigration[] = [];
  for (const migration of ordered) {
    const applied = read.get(migration.id) as
      { plugin_id: string; version: string; checksum: string } | undefined;
    if (!applied) {
      pending.push(migration);
      continue;
    }
    if (
      applied.plugin_id !== migration.pluginId ||
      applied.version !== migration.version ||
      applied.checksum !== migrationChecksum(migration)
    )
      throw new Error(`migration checksum changed: ${migration.id}`);
    appliedCount += 1;
  }
  return { ordered, pending, appliedCount };
}

export function sortMigrations(
  migrations: readonly PluginMigration[],
): readonly PluginMigration[] {
  const byId = new Map(
    migrations.map((migration) => [migration.id, migration]),
  );
  if (byId.size !== migrations.length)
    throw new Error("duplicate migration id");
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const sorted: PluginMigration[] = [];
  const visit = (id: string, path: readonly string[]): void => {
    if (visited.has(id)) return;
    if (visiting.has(id))
      throw new Error(`migration cycle: ${[...path, id].join(" -> ")}`);
    const migration = byId.get(id);
    if (!migration) throw new Error(`missing migration dependency: ${id}`);
    visiting.add(id);
    for (const dependency of migration.dependsOn)
      visit(dependency, [...path, id]);
    visiting.delete(id);
    visited.add(id);
    sorted.push(migration);
  };
  for (const migration of migrations) visit(migration.id, []);
  return sorted;
}

export function applyMigrations(
  sqlite: SqliteDatabase,
  migrations: readonly PluginMigration[],
): void {
  applyMigrationBatch(sqlite, migrations, {
    migrationTimeoutMs: 60_000,
    totalTimeoutMs: 10 * 60_000,
  });
}

function applyMigrationBatch(
  sqlite: SqliteDatabase,
  migrations: readonly PluginMigration[],
  limits: {
    migrationTimeoutMs: number;
    totalTimeoutMs: number;
    phase?: "dry-run" | "apply";
    onProgress?: MigrationRunOptions["onProgress"];
  },
): void {
  const batchStartedAt = Date.now();
  sqlite.exec(foundationMigrations[0]!.sql);
  const read = sqlite.prepare(
    "SELECT plugin_id, version, checksum FROM plugin_migrations WHERE migration_id = ?",
  );
  const write = sqlite.prepare(
    "INSERT INTO plugin_migrations(migration_id, plugin_id, version, checksum, applied_at) VALUES (?, ?, ?, ?, ?)",
  );
  for (const migration of sortMigrations(migrations)) {
    if (Date.now() - batchStartedAt > limits.totalTimeoutMs)
      throw new Error("migration batch exceeded total timeout");
    const checksum = migrationChecksum(migration);
    const applied = read.get(migration.id) as
      { plugin_id: string; version: string; checksum: string } | undefined;
    if (applied) {
      if (
        applied.plugin_id !== migration.pluginId ||
        applied.version !== migration.version ||
        applied.checksum !== checksum
      )
        throw new Error(`migration checksum changed: ${migration.id}`);
      continue;
    }
    if (migration.foreignKeysOff) sqlite.exec("PRAGMA foreign_keys = OFF");
    limits.onProgress?.({
      phase: limits.phase ?? "apply",
      status: "started",
      migrationId: migration.id,
    });
    sqlite.exec("BEGIN IMMEDIATE");
    const migrationStartedAt = Date.now();
    try {
      sqlite.exec(migration.sql);
      if (Date.now() - migrationStartedAt > limits.migrationTimeoutMs)
        throw new Error(`migration exceeded timeout: ${migration.id}`);
      if (migration.foreignKeysOff) {
        const violations = sqlite.prepare("PRAGMA foreign_key_check").all();
        if (violations.length > 0)
          throw new Error(`foreign key check failed: ${migration.id}`);
      }
      write.run(
        migration.id,
        migration.pluginId,
        migration.version,
        checksum,
        new Date().toISOString(),
      );
      sqlite.exec("COMMIT");
      limits.onProgress?.({
        phase: limits.phase ?? "apply",
        status: "completed",
        migrationId: migration.id,
      });
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw new Error(`migration failed: ${migration.id}`, { cause: error });
    } finally {
      if (migration.foreignKeysOff) sqlite.exec("PRAGMA foreign_keys = ON");
    }
  }
}

/**
 * Production migration entry point. It validates the immutable ledger before
 * touching schema state, creates a verified pre-migration backup for an
 * existing database, exercises the complete plan against a temporary copy,
 * and verifies integrity again after the real transaction batch.
 */
export function runMigrationPlan(
  database: DatabaseHandle,
  migrations: readonly PluginMigration[],
  options: MigrationRunOptions,
): MigrationRunDiagnostic {
  const startedAt = Date.now();
  const migrationTimeoutMs = options.migrationTimeoutMs ?? 60_000;
  const totalTimeoutMs = options.totalTimeoutMs ?? 10 * 60_000;
  activeIntegrityCheck(database.sqlite);
  const plan = planMigrations(database.sqlite, migrations);
  if (plan.pending.length === 0)
    return {
      pendingCount: 0,
      appliedCount: 0,
      dryRun: false,
      integrity: "ok",
      elapsedMs: Date.now() - startedAt,
    };

  const hasExistingState = Boolean(
    database.sqlite
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1",
      )
      .get(),
  );
  let backup: DatabaseBackupSnapshot | undefined;
  let dryRunDirectory: string | undefined;
  try {
    if (
      options.databasePath !== ":memory:" &&
      existsSync(options.databasePath) &&
      hasExistingState
    ) {
      backup = database.maintenance(options.backupDirectory).createBackup();
      if (options.dryRun !== false) {
        dryRunDirectory = mkdtempSync(
          join(tmpdir(), "dramaip-migration-dry-run-"),
        );
        const dryRunPath = join(dryRunDirectory, "dramaip.db");
        copyFileSync(
          join(options.backupDirectory, backup.fileName),
          dryRunPath,
        );
        const dryRunDatabase = createSqlite(dryRunPath);
        try {
          applyMigrationBatch(dryRunDatabase, plan.ordered, {
            migrationTimeoutMs,
            totalTimeoutMs,
            phase: "dry-run",
            onProgress: options.onProgress,
          });
          activeIntegrityCheck(dryRunDatabase);
        } finally {
          dryRunDatabase.close();
        }
      }
    }
    applyMigrationBatch(database.sqlite, plan.ordered, {
      migrationTimeoutMs,
      totalTimeoutMs,
      phase: "apply",
      onProgress: options.onProgress,
    });
    activeIntegrityCheck(database.sqlite);
    return {
      pendingCount: plan.pending.length,
      appliedCount: plan.pending.length,
      backup,
      dryRun: Boolean(backup && options.dryRun !== false),
      integrity: "ok",
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    if (dryRunDirectory)
      rmSync(dryRunDirectory, { recursive: true, force: true });
  }
}

export function listAppliedMigrations(
  sqlite: SqliteDatabase,
): readonly AppliedMigrationDiagnostic[] {
  return sqlite
    .prepare(
      "SELECT migration_id, plugin_id, version, applied_at FROM plugin_migrations ORDER BY applied_at, migration_id",
    )
    .all()
    .map((row) => {
      const value = row as {
        migration_id: string;
        plugin_id: string;
        version: string;
        applied_at: string;
      };
      return {
        migrationId: value.migration_id,
        pluginId: value.plugin_id,
        version: value.version,
        appliedAt: value.applied_at,
      };
    });
}

export class SqliteUnitOfWork implements UnitOfWork {
  private readonly afterCommitListeners = new Set<
    (events: readonly DomainEvent[]) => void
  >();

  constructor(private readonly sqlite: SqliteDatabase) {}

  private eventValidator: ((event: PendingDomainEvent) => void) | undefined;

  setEventValidator(validator: (event: PendingDomainEvent) => void): void {
    this.eventValidator = validator;
  }

  execute<T>(work: (transaction: UnitOfWorkTransaction) => T): T {
    this.sqlite.exec("BEGIN IMMEDIATE");
    const appended: DomainEvent[] = [];
    try {
      const result = work(
        new SqliteTransaction(this.sqlite, appended, this.eventValidator),
      );
      this.sqlite.exec("COMMIT");
      if (appended.length > 0)
        for (const listener of this.afterCommitListeners) {
          try {
            listener(appended);
          } catch {
            // State is already committed. A failing notifier is diagnostic,
            // never a reason to report the transaction as rolled back.
          }
        }
      return result;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  onAfterCommit(
    listener: (events: readonly DomainEvent[]) => void,
  ): () => void {
    this.afterCommitListeners.add(listener);
    return () => this.afterCommitListeners.delete(listener);
  }
}

class SqliteTransaction implements UnitOfWorkTransaction {
  constructor(
    private readonly sqlite: SqliteDatabase,
    private readonly appended: DomainEvent[],
    private readonly validateEvent?: (event: PendingDomainEvent) => void,
  ) {}

  run(sql: string, ...parameters: unknown[]): void {
    this.sqlite.prepare(sql).run(...parameters);
  }

  get<T>(sql: string, ...parameters: unknown[]): T | undefined {
    return this.sqlite.prepare(sql).get(...parameters) as T | undefined;
  }

  all<T>(sql: string, ...parameters: unknown[]): T[] {
    return this.sqlite.prepare(sql).all(...parameters) as T[];
  }

  append(event: PendingDomainEvent): DomainEvent {
    this.validateEvent?.(event);
    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();
    const result = this.sqlite
      .prepare(
        `INSERT INTO domain_events(
          event_id, type, plugin_id, aggregate_type, aggregate_id,
          aggregate_version, payload_json, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        eventId,
        event.type,
        event.pluginId,
        event.aggregateType,
        event.aggregateId,
        event.aggregateVersion,
        JSON.stringify(event.payload),
        occurredAt,
      );
    const committed = {
      cursor: Number(result.lastInsertRowid),
      eventId,
      type: event.type,
      pluginId: event.pluginId,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      aggregateVersion: event.aggregateVersion,
      payload: event.payload,
      occurredAt,
    };
    this.appended.push(committed);
    return committed;
  }
}

export function integrityCheck(
  path: string,
  options: { readOnly?: boolean } = {},
): "ok" | string {
  const sqlite = createSqlite(path, { readOnly: options.readOnly ?? true });
  try {
    if (options.readOnly === false)
      sqlite.prepare("PRAGMA journal_mode = DELETE").get();
    const row = sqlite.prepare("PRAGMA integrity_check").get() as {
      integrity_check?: string;
    };
    return row.integrity_check === "ok"
      ? "ok"
      : (row.integrity_check ?? "unknown");
  } finally {
    sqlite.close();
  }
}
