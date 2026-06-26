// SQLite client —— better-sqlite3 + Drizzle
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import { runMigrations } from './migrator'

export type DB = BetterSQLite3Database<typeof schema>

export interface RawSqlite {
  exec(sql: string): void
  prepare(sql: string): { run(...params: unknown[]): unknown }
  close(): void
  pragma(pragma: string): unknown
}

/**
 * 创建并初始化数据库连接。
 * @param dbPath SQLite 文件路径（建议放在 app.getPath('userData') 下）
 */
export function createDb(dbPath: string): { db: DB; raw: Database.Database } {
  const raw = new Database(dbPath)
  raw.pragma('journal_mode = WAL')
  raw.pragma('foreign_keys = ON')

  const db = drizzle(raw, { schema })
  runMigrations(raw as unknown as Parameters<typeof runMigrations>[0])
  return { db, raw }
}

