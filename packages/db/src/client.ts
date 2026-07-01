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
 * 为一个已存在的 SQLite 数据库生成一致性备份。
 *
 * SQLite 运行在 WAL 模式时，最新提交可能仍在 `*.db-wal` 文件中。直接复制主
 * `*.db` 文件会得到缺少最近写入的备份。这里先 checkpoint WAL，再用
 * `VACUUM INTO` 生成一个独立、可直接打开的 SQLite 文件。
 */
export function backupSqliteDatabase(sourcePath: string, backupPath: string): void {
  const raw = new Database(sourcePath, { fileMustExist: true })
  try {
    raw.pragma('busy_timeout = 5000')
    raw.pragma('wal_checkpoint(TRUNCATE)')
    raw.prepare('VACUUM INTO ?').run(backupPath)
  } finally {
    raw.close()
  }
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
