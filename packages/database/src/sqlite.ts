/**
 * The Node SQLite boundary. Repositories consume this structural surface,
 * never `node:sqlite` directly.
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
export function createSqlite(
  path: string,
  options: { readOnly?: boolean } = {},
): SqliteDatabase {
  if (process.versions.bun)
    throw new Error("Core SQLite requires Node 24.18.0 or Electron Node");
  const { DatabaseSync } = taskRequire("node:sqlite") as {
    DatabaseSync: SqliteConstructor;
  };
  const database = new DatabaseSync(path, {
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
