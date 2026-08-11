import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import { schema } from "./schema";

export * from "./schema";
export * from "./operational-schema";

export function openNodeSqliteDatabase(path: string) {
  const sqlite = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  sqlite.exec(
    "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;",
  );
  return { sqlite, db: drizzle({ client: sqlite, schema }) };
}
