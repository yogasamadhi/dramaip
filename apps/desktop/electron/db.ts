// 数据库单例：在 app ready 后初始化，存放于 userData 目录
import { app, dialog } from 'electron'
import { join } from 'node:path'
import { existsSync, readdirSync, copyFileSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { createDb, createRepositories, type Repositories } from '@sdns/db'
import { BUILT_IN_AGENTS, BUILT_IN_GENRE_PRESETS, BUILT_IN_TEMPLATES, DB_FILE_NAME } from '@sdns/core'

let repos: Repositories | null = null

/** 启动时最多保留的自动备份数 */
const MAX_BACKUPS = 7

export function initDatabase(): void {
  const userData = app.getPath('userData')
  const dbPath = join(userData, DB_FILE_NAME)
  // v1.0：打开前先做一次自动备份（仅当库已存在时）
  try {
    backupDatabase(userData, dbPath)
  } catch {
    // 备份失败不阻断启动
  }
  const { db } = createDb(dbPath)
  repos = createRepositories(db)
  seedBuiltInPresets(repos)
}

/**
 * v1.0：启动自动备份 SQLite（ROADMAP v1.0-2）。
 * - 把 studio.db 复制到 userData/backups/studio-YYYYMMDD-HHmmss.db
 * - 保留最近 MAX_BACKUPS 份，超出按时间最旧删除（含 WAL 残留时尽力而为）。
 */
function backupDatabase(userData: string, dbPath: string): void {
  if (!existsSync(dbPath)) return // 首次启动，库还没建
  const backupDir = join(userData, 'backups')
  mkdirSync(backupDir, { recursive: true })
  const ts = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`
  const backupPath = join(backupDir, `studio-${stamp}.db`)
  copyFileSync(dbPath, backupPath)
  // 同步 WAL/SHM 快照（若存在）——拷贝主 db 即可还原数据
  // 滚动删除：按修改时间保留最近 MAX_BACKUPS 份
  const files = readdirSync(backupDir)
    .filter((f) => f.startsWith('studio-') && f.endsWith('.db'))
    .map((f) => ({ f, mtime: statSync(join(backupDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  for (const stale of files.slice(MAX_BACKUPS)) {
    try {
      unlinkSync(join(backupDir, stale.f))
    } catch {
      /* 忽略单个删除失败 */
    }
  }
}

/**
 * v0.8：幂等 seed 内置预设（Agent / 模板 / 类型库）。
 * - 已存在同 role/name 的记录不覆盖用户改动，仅补 builtIn 标记。
 * - 用户自定义/编辑的记录不受影响。
 */
function seedBuiltInPresets(r: Repositories): void {
  try {
    r.agentProfile.upsertBuiltInAgentProfiles(r.db, BUILT_IN_AGENTS)
    r.template.upsertBuiltInTemplates(r.db, BUILT_IN_TEMPLATES)
    r.genrePreset.upsertBuiltInGenrePresets(r.db, BUILT_IN_GENRE_PRESETS)
  } catch {
    // seed 失败不应阻断启动（用户仍可手动在设置页创建）
  }
}

export function getRepos(): Repositories {
  if (!repos) throw new Error('数据库尚未初始化')
  return repos
}

/** v1.0：数据库初始化失败时的顶层兜底，弹原生对话框提示而非静默崩溃 */
export function safeInitDatabase(): void {
  try {
    initDatabase()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    void dialog.showErrorBox(
      '数据库初始化失败',
      `应用无法初始化数据库，请检查 userData 目录权限后重试。\n\n错误详情：${msg}`,
    )
  }
}
