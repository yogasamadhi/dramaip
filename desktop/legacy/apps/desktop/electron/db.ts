// 数据库单例：在 app ready 后初始化，存放于 userData 目录
import { app, dialog } from 'electron'
import { basename, join, resolve, sep } from 'node:path'
import { existsSync, readdirSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import {
  LATEST_MIGRATION_VERSION,
  backupSqliteDatabase,
  createDb,
  createRepositories,
  restoreSqliteDatabaseFromBackup,
  verifySqliteDatabaseFile,
  type Repositories,
} from '@sdns/db'
import {
  BUILT_IN_AGENTS,
  BUILT_IN_COMPLIANCE_RULE_PROFILES,
  BUILT_IN_GENRE_PRESETS,
  BUILT_IN_TEMPLATES,
  DEFAULT_GENRE_MARKET_SNAPSHOT,
  DB_FILE_NAME,
  RETIRED_BUILT_IN_GENRE_PRESET_NAMES,
} from '@sdns/core'
import { initializeSecretStorage, installSecretProtection } from './secrets'
import { logger } from './logger'
import { runStartupDatabaseInitialization } from './startup-database'

let repos: Repositories | null = null
let rawDb: ReturnType<typeof createDb>['raw'] | null = null

/** 启动时最多保留的自动备份数 */
const MAX_BACKUPS = 7
const BACKUP_DIR_NAME = 'backups'
const BACKUP_PREFIX = 'studio-'
const BACKUP_EXT = '.db'

type DatabaseBackupKind = 'auto' | 'manual' | 'pre_restore' | 'unknown'

export interface DatabaseBackupInfo {
  fileName: string
  path: string
  sizeBytes: number
  createdAt: string
  kind: DatabaseBackupKind
}

export interface DatabaseBackupResult {
  ok: boolean
  error?: string
  backup?: DatabaseBackupInfo
  safetyBackup?: DatabaseBackupInfo
  backups?: DatabaseBackupInfo[]
}

export interface DatabaseMigrationInfo {
  latestVersion: number
  appliedVersion: number
  applied: Array<{ version: number; appliedAt: string }>
}

export interface DatabaseRuntimeInfo {
  userData: string
  dbPath: string
  migration: DatabaseMigrationInfo
}

export async function initDatabase(): Promise<void> {
  const { userData, dbPath } = getDatabasePaths()
  // v1.0：打开前先做一次自动备份（仅当库已存在时）
  try {
    createDatabaseBackup(userData, dbPath, 'auto')
  } catch {
    // 备份失败不阻断启动
  }
  await openDatabase(dbPath)
}

function getDatabasePaths(): { userData: string; dbPath: string; backupDir: string } {
  const userData = app.getPath('userData')
  return {
    userData,
    dbPath: join(userData, DB_FILE_NAME),
    backupDir: join(userData, BACKUP_DIR_NAME),
  }
}

async function openDatabase(dbPath: string): Promise<void> {
  const created = createDb(dbPath)
  rawDb = created.raw
  repos = createRepositories(created.db)
  installSecretProtection(repos)
  const secretMigration = await initializeSecretStorage(repos)
  const logLevel = secretMigration.failed > 0 ? 'warn' : 'info'
  logger[logLevel]('security', 'secret migration checked', {
    localCredentialStoreAvailable: secretMigration.keychainAvailable,
    attempted: secretMigration.attempted,
    migrated: secretMigration.migrated,
    skipped: secretMigration.skipped,
    failed: secretMigration.failed,
    before: secretMigration.before.totals,
    after: secretMigration.after.totals,
    failures: secretMigration.failures,
  })
  seedBuiltInPresets(repos)
}

function closeDatabase(): void {
  try {
    rawDb?.close()
  } finally {
    rawDb = null
    repos = null
  }
}

/**
 * v1.0：启动自动备份 SQLite（ROADMAP v1.0-2）。
 * - 把 studio.db 复制到 userData/backups/studio-YYYYMMDD-HHmmss.db
 * - 备份前 checkpoint WAL，生成可独立打开的 SQLite 快照。
 * - 保留最近 MAX_BACKUPS 份，超出按时间最旧删除。
 */
function createDatabaseBackup(
  userData: string,
  dbPath: string,
  kind: Exclude<DatabaseBackupKind, 'unknown'>,
  options: { prune?: boolean } = {},
): DatabaseBackupInfo | undefined {
  if (!existsSync(dbPath)) return undefined // 首次启动，库还没建
  const backupDir = join(userData, BACKUP_DIR_NAME)
  mkdirSync(backupDir, { recursive: true })
  const backupPath = join(backupDir, createBackupFileName(kind))
  backupSqliteDatabase(dbPath, backupPath)
  if (options.prune !== false) pruneDatabaseBackups(backupDir)
  return getBackupInfo(backupPath)
}

function createBackupFileName(kind: Exclude<DatabaseBackupKind, 'unknown'>): string {
  const prefix =
    kind === 'auto' ? 'studio' : kind === 'manual' ? 'studio-manual' : 'studio-pre-restore'
  const ts = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const millis = String(ts.getMilliseconds()).padStart(3, '0')
  const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}-${millis}`
  return `${prefix}-${stamp}${BACKUP_EXT}`
}

function pruneDatabaseBackups(backupDir: string): void {
  const files = readdirSync(backupDir)
    .filter(isBackupFile)
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

function isBackupFile(fileName: string): boolean {
  return fileName.startsWith(BACKUP_PREFIX) && fileName.endsWith(BACKUP_EXT)
}

function getBackupKind(fileName: string): DatabaseBackupKind {
  if (fileName.startsWith('studio-manual-')) return 'manual'
  if (fileName.startsWith('studio-pre-restore-')) return 'pre_restore'
  if (/^studio-\d{8}-\d{6}(?:-\d{3})?\.db$/.test(fileName)) return 'auto'
  return 'unknown'
}

function getBackupInfo(path: string): DatabaseBackupInfo {
  const fileName = basename(path)
  const stat = statSync(path)
  return {
    fileName,
    path,
    sizeBytes: stat.size,
    createdAt: stat.mtime.toISOString(),
    kind: getBackupKind(fileName),
  }
}

function toStructuredBackupError(error: unknown, fallback: string): DatabaseBackupResult {
  return {
    ok: false,
    error: error instanceof Error ? error.message : fallback,
    backups: safeListDatabaseBackups(),
  }
}

function safeListDatabaseBackups(): DatabaseBackupInfo[] {
  try {
    return listDatabaseBackups()
  } catch {
    return []
  }
}

export function listDatabaseBackups(): DatabaseBackupInfo[] {
  const { backupDir } = getDatabasePaths()
  if (!existsSync(backupDir)) return []
  return readdirSync(backupDir)
    .filter(isBackupFile)
    .map((fileName) => getBackupInfo(join(backupDir, fileName)))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

export function getDatabaseRuntimeInfo(): DatabaseRuntimeInfo {
  const { userData, dbPath } = getDatabasePaths()
  return {
    userData,
    dbPath,
    migration: getDatabaseMigrationInfo(),
  }
}

export function getDatabaseMigrationInfo(): DatabaseMigrationInfo {
  if (!rawDb) {
    return {
      latestVersion: LATEST_MIGRATION_VERSION,
      appliedVersion: 0,
      applied: [],
    }
  }

  try {
    const rows = rawDb
      .prepare('SELECT version, applied_at AS appliedAt FROM schema_migrations ORDER BY version ASC')
      .all() as Array<{ version?: number; appliedAt?: string }>
    const applied = rows
      .filter((row): row is { version: number; appliedAt: string } =>
        typeof row.version === 'number' && typeof row.appliedAt === 'string',
      )
      .map((row) => ({ version: row.version, appliedAt: row.appliedAt }))
    return {
      latestVersion: LATEST_MIGRATION_VERSION,
      appliedVersion: applied.at(-1)?.version ?? 0,
      applied,
    }
  } catch {
    return {
      latestVersion: LATEST_MIGRATION_VERSION,
      appliedVersion: 0,
      applied: [],
    }
  }
}

export function createManualDatabaseBackup(): DatabaseBackupResult {
  try {
    const { userData, dbPath } = getDatabasePaths()
    const backup = createDatabaseBackup(userData, dbPath, 'manual')
    if (!backup) return { ok: false, error: '当前数据库文件不存在，无法创建备份。', backups: listDatabaseBackups() }
    return { ok: true, backup, backups: listDatabaseBackups() }
  } catch (error) {
    return toStructuredBackupError(error, '手动备份失败。')
  }
}

export async function restoreDatabaseBackup(backupPath: string): Promise<DatabaseBackupResult> {
  const { userData, dbPath, backupDir } = getDatabasePaths()
  try {
    const backupRoot = resolve(backupDir)
    const sourcePath = resolve(backupPath)
    if (!sourcePath.startsWith(`${backupRoot}${sep}`)) {
      return { ok: false, error: '只能恢复应用备份目录内的数据库备份。', backups: listDatabaseBackups() }
    }
    if (!isBackupFile(basename(sourcePath))) {
      return { ok: false, error: '指定文件不是应用生成的数据库备份。', backups: listDatabaseBackups() }
    }
    if (!existsSync(sourcePath)) {
      return { ok: false, error: '指定备份文件不存在。', backups: listDatabaseBackups() }
    }
    verifySqliteDatabaseFile(sourcePath)

    const restoredFrom = getBackupInfo(sourcePath)
    const safetyBackup = createDatabaseBackup(userData, dbPath, 'pre_restore', { prune: false })
    if (!safetyBackup) {
      return { ok: false, error: '恢复前安全备份创建失败，已停止恢复。', backups: listDatabaseBackups() }
    }

    closeDatabase()
    restoreSqliteDatabaseFromBackup(sourcePath, dbPath)
    await openDatabase(dbPath)
    pruneDatabaseBackups(backupDir)

    return {
      ok: true,
      backup: restoredFrom,
      safetyBackup,
      backups: listDatabaseBackups(),
    }
  } catch (error) {
    if (!repos) {
      try {
        await openDatabase(dbPath)
      } catch {
        // 若重开也失败，交给结构化错误提示调用方。
      }
    }
    return toStructuredBackupError(error, '恢复备份失败。')
  }
}

/**
 * 幂等同步内置预设（Agent / 模板 / 类型库）。
 * - Agent / 模板沿用原 seed 规则。
 * - 类型库同步当前市场版内置内容并清理退役内置项；用户自定义类型不受影响。
 */
function seedBuiltInPresets(r: Repositories): void {
  try {
    r.agentProfile.upsertBuiltInAgentProfiles(r.db, BUILT_IN_AGENTS)
    r.template.upsertBuiltInTemplates(r.db, BUILT_IN_TEMPLATES)
    r.genrePreset.upsertBuiltInGenrePresets(
      r.db,
      BUILT_IN_GENRE_PRESETS,
      RETIRED_BUILT_IN_GENRE_PRESET_NAMES,
    )
    r.genreMarketSnapshot.ensureBuiltInGenreMarketSnapshot(r.db, DEFAULT_GENRE_MARKET_SNAPSHOT)
    r.compliance.upsertBuiltInComplianceRuleProfiles(r.db, BUILT_IN_COMPLIANCE_RULE_PROFILES)
  } catch {
    // seed 失败不应阻断启动（用户仍可手动在设置页创建）
  }
}

export function getRepos(): Repositories {
  if (!repos) throw new Error('数据库尚未初始化')
  return repos
}

/** v1.0：数据库初始化失败时的顶层兜底；调用方必须在 false 时停止启动。 */
export async function safeInitDatabase(): Promise<boolean> {
  const { dbPath, backupDir } = getDatabasePaths()
  return runStartupDatabaseInitialization(initDatabase, (message) => {
    dialog.showErrorBox(
      '数据库初始化失败',
      `应用无法初始化数据库，现已停止启动。请检查文件权限或数据库完整性后重新打开应用。\n\n数据库：${dbPath}\n备份目录：${backupDir}\n\n错误详情：${message}`,
    )
  })
}
