// migrator.ts —— 版本化数据库迁移框架（ROADMAP v1.0-1）
//
// 设计：
// - 用 schema_migrations 表记录已应用迁移版本，保证「每版本有明确 migration」。
// - 首次空库：直接建全部表为 v1（CREATE TABLE IF NOT EXISTS 安全）。
// - 已有 v0.x 库：表已存在则 IF NOT EXISTS 跳过，列级迁移用 PRAGMA 探测补列，记录 v1。
// - 保证 v0.1 → v1.0 升级数据零丢失。
//
// 每个迁移是一个 { version, name, up(raw) }，按 version 升序依次执行未应用的。
import { INITIAL_SCHEMA_SQL, ensureColumns } from './migrations'

/** 迁移依赖的最小 raw sqlite 接口（与 better-sqlite3 Database 对齐） */
export interface MigrationRaw {
  exec(sql: string): void
  prepare(sql: string): { all(...params: unknown[]): unknown[] }
}

export interface Migration {
  version: number
  name: string
  up(raw: MigrationRaw): void
}

/**
 * v1 迁移：把 v0.1–v0.8 的全部建表 + 列级迁移 + schema_migrations 自身纳入一个版本。
 * 这是「现状的快照」：新库一次建成；旧库经 IF NOT EXISTS / ensureColumns 安全补齐。
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'baseline-v0.1-to-v0.8',
    up(raw) {
      // schema_migrations 表自身（若已存在则跳过）
      raw.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
      `)
      // 全部业务表（IF NOT EXISTS）
      raw.exec(INITIAL_SCHEMA_SQL)
      // 列级幂等迁移（对已存在的旧表补列）
      ensureColumns(raw)
    },
  },
  {
    version: 2,
    name: 'task-model-bindings',
    up(raw) {
      raw.exec(`
        CREATE TABLE IF NOT EXISTS task_model_bindings (
          id TEXT PRIMARY KEY,
          task_group TEXT NOT NULL,
          model_config_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS task_model_bindings_task_group_unique
          ON task_model_bindings(task_group);
      `)
    },
  },
  {
    version: 3,
    name: 'adaptation-seasons',
    up(raw) {
      // 多季连载：adaptation_projects 加季号 + 本季改编章节范围
      raw.exec(`ALTER TABLE adaptation_projects ADD COLUMN season_number INTEGER;`)
      raw.exec(`ALTER TABLE adaptation_projects ADD COLUMN source_chapter_range TEXT;`)
    },
  },
]

/** 当前最新迁移版本（= MIGRATIONS 末项 version） */
export const LATEST_MIGRATION_VERSION = MIGRATIONS.reduce((m, x) => Math.max(m, x.version), 0)

/**
 * 读取已应用的最大迁移版本。表不存在时返回 0。
 */
function getAppliedVersion(raw: MigrationRaw): number {
  try {
    const rows = raw.prepare('SELECT MAX(version) AS v FROM schema_migrations').all() as Array<{ v?: number }>
    return rows[0]?.v ?? 0
  } catch {
    // schema_migrations 尚未创建（v1 迁移会创建它）
    return 0
  }
}

/**
 * 运行所有未应用的迁移（幂等）。
 * - 首次（无 schema_migrations）：v1 建表 + schema_migrations，记 version=1，再继续 v2…
 * - 旧库（schema_migrations 已存在）：从记录的最大 version 之后开始。
 * @returns 已应用的版本号数组（本次新跑的）
 */
export function runMigrations(raw: MigrationRaw): number[] {
  const applied: number[] = []
  // 注意：schema_migrations 由 v1 迁移创建；若它还不存在，getAppliedVersion 返回 0，
  // v1 会先 CREATE schema_migrations 再 INSERT，后续版本正常判定。
  const current = getAppliedVersion(raw)
  const pending = MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version)

  for (const m of pending) {
    m.up(raw)
    // 记账（schema_migrations 此时一定已存在：v1 已建）
    raw.exec(
      `INSERT INTO schema_migrations (version, applied_at) VALUES (${m.version}, '${new Date().toISOString()}');`,
    )
    applied.push(m.version)
  }
  return applied
}
