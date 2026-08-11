import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { schema } from "./schema";

export function openBunSqliteDatabase(path: string) {
  const sqlite = new Database(path, { create: true });
  sqlite.exec(
    "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;",
  );
  return { sqlite, db: drizzle({ client: sqlite, schema }) };
}
