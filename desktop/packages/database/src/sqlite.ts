/**
 * The only Node/Bun SQLite seam. Repositories consume this structural surface,
 * never `node:sqlite` or `bun:sqlite` directly.
 */
import { createRequire } from "node:module";
export interface SqliteStatement {
  run(...parameters: unknown[]): { lastInsertRowid?: number | bigint };
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
  finalize?(): void;
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
  const database = process.versions.bun
    ? new DatabaseConstructor(path, {
        readonly: options.readOnly ?? false,
        create: !options.readOnly,
      })
    : new DatabaseConstructor(path, {
        readOnly: options.readOnly ?? false,
        enableForeignKeyConstraints: true,
      });
  const statements = new Set<SqliteStatement>();
  let closed = false;
  return {
    exec: (sql) => database.exec(sql),
    prepare: (sql) => {
      const statement = database.prepare(sql);
      statements.add(statement);
      return statement;
    },
    close: () => {
      if (closed) return;
      closed = true;
      for (const statement of statements) {
        try {
          statement.finalize?.();
        } catch {}
      }
      statements.clear();
      database.close();
    },
  };
}
