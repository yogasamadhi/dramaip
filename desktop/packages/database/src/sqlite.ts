/**
 * The only Node/Bun SQLite seam. Repositories consume this structural surface,
 * never `node:sqlite` or `bun:sqlite` directly.
 */
import { createRequire } from "node:module";
export interface SqliteStatement {
  run(...parameters: unknown[]): { lastInsertRowid?: number | bigint };
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

type SqliteConstructor = new (
  path: string,
  options?: Record<string, unknown>,
) => SqliteDatabase;

const taskRequire = createRequire(import.meta.url);
const sqliteModule = taskRequire(
  process.versions.bun ? "bun:sqlite" : "node:sqlite",
) as {
  Database?: SqliteConstructor;
  DatabaseSync?: SqliteConstructor;
};

const resolvedConstructor = sqliteModule.DatabaseSync ?? sqliteModule.Database;
if (!resolvedConstructor)
  throw new Error("SQLite runtime adapter is unavailable");
const DatabaseConstructor: SqliteConstructor = resolvedConstructor;

export function createSqlite(
  path: string,
  options: { readOnly?: boolean } = {},
): SqliteDatabase {
  if (process.versions.bun)
    return new DatabaseConstructor(path, {
      readonly: options.readOnly ?? false,
      create: !options.readOnly,
    });
  return new DatabaseConstructor(path, {
    readOnly: options.readOnly ?? false,
    enableForeignKeyConstraints: true,
  });
}
