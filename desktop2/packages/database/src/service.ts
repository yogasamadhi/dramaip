import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync, type StatementResultingChanges } from "node:sqlite";

import { Service, type Context } from "@deepseek-ai/cordis";
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";

import type { DomainEvent } from "@dramaip/contracts";
import type {
  MigrationDefinition,
  PendingDomainEvent,
  UnitOfWork,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api";

import { applyMigrations, foundationMigrations } from "./migrations.ts";

export interface DatabaseRuntimeConfig {
  filename: string;
  backupDirectory?: string;
  migrations: readonly MigrationDefinition[];
}

function backupBeforeRelationalConversion(config: DatabaseRuntimeConfig): void {
  if (!config.backupDirectory || !existsSync(config.filename)) return;
  const converting = config.migrations.filter(
    (migration) =>
      migration.foreignKeysOff === true ||
      /DROP TABLE\s+[a-z][a-z0-9_]*_nodes/iu.test(migration.sql),
  );
  if (!converting.length) return;
  const probe = new DatabaseSync(config.filename);
  try {
    const hasLedger = probe
      .prepare(
        "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'plugin_migrations'",
      )
      .get() as { found: number } | undefined;
    if (!hasLedger) return;
    const pending = converting.some(
      (migration) =>
        !probe
          .prepare(
            "SELECT 1 AS found FROM plugin_migrations WHERE migration_id = ?",
          )
          .get(migration.id),
    );
    if (!pending) return;
    probe.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    probe.close();
  }
  mkdirSync(config.backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
  copyFileSync(
    config.filename,
    join(
      config.backupDirectory,
      `${basename(config.filename, ".db")}-pre-relational-${stamp}.db`,
    ),
  );
}

export class DatabaseRuntime extends Service {
  static provide = "database";
  readonly sqlite: DatabaseSync;
  readonly orm: NodeSQLiteDatabase;

  constructor(ctx: Context, config: DatabaseRuntimeConfig) {
    super(ctx, "database");
    backupBeforeRelationalConversion(config);
    this.sqlite = new DatabaseSync(config.filename);
    this.sqlite.exec("PRAGMA journal_mode = WAL");
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    this.sqlite.exec("PRAGMA busy_timeout = 5000");
    this.sqlite.exec("PRAGMA synchronous = NORMAL");
    this.orm = drizzle({ client: this.sqlite });
    applyMigrations(this.sqlite, [
      ...foundationMigrations,
      ...config.migrations,
    ]);
    ctx.effect(() => () => this.sqlite.close(), "database.close");
  }
}

class Transaction implements UnitOfWorkTransaction {
  constructor(private readonly database: DatabaseSync) {}

  run(sql: string, ...params: unknown[]): StatementResultingChanges {
    return this.database.prepare(sql).run(...(params as never[]));
  }

  get<T>(sql: string, ...params: unknown[]): T | undefined {
    return this.database.prepare(sql).get(...(params as never[])) as
      | T
      | undefined;
  }

  all<T>(sql: string, ...params: unknown[]): T[] {
    return this.database.prepare(sql).all(...(params as never[])) as T[];
  }

  append(event: PendingDomainEvent): DomainEvent {
    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();
    const result = this.run(
      `INSERT INTO domain_events
       (event_id, type, plugin_id, aggregate_type, aggregate_id, aggregate_version, payload_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      eventId,
      event.type,
      event.pluginId,
      event.aggregateType,
      event.aggregateId,
      event.aggregateVersion,
      JSON.stringify(event.payload),
      occurredAt,
    );
    return {
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
  }
}

export class UnitOfWorkService extends Service implements UnitOfWork {
  static provide = "uow";

  constructor(
    ctx: Context,
    private readonly database: DatabaseRuntime,
  ) {
    super(ctx, "uow");
  }

  execute<T>(work: (tx: UnitOfWorkTransaction) => T): T {
    this.database.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = work(new Transaction(this.database.sqlite));
      if (result instanceof Promise)
        throw new TypeError("UnitOfWork callbacks must be synchronous");
      this.database.sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    database: DatabaseRuntime;
  }
}
