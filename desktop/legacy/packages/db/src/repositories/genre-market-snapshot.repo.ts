import { desc, eq } from 'drizzle-orm'
import type { DB } from '../client'
import { genreMarketSnapshots } from '../schema'
import {
  type GenreMarketSnapshot,
  type GenreMarketSource,
  validateGenreMarketSnapshot,
} from '@sdns/core'
import { insertRow, now, stringifyJson, updateRows } from './util'

type SnapshotRow = typeof genreMarketSnapshots.$inferSelect

export interface StoredGenreMarketSnapshot extends GenreMarketSnapshot {
  active: boolean
}

function rowToSnapshot(row: SnapshotRow): StoredGenreMarketSnapshot | undefined {
  try {
    const snapshot = validateGenreMarketSnapshot({
      version: row.version,
      observedAt: row.observedAt,
      sources: JSON.parse(row.sources),
      opportunities: JSON.parse(row.opportunities),
    })
    return { ...snapshot, active: row.active }
  } catch {
    // 导入文件可能在旧版中被手动损坏；忽略该行，避免影响其余可用历史版本。
    return undefined
  }
}

export function listGenreMarketSnapshots(db: DB): StoredGenreMarketSnapshot[] {
  return db
    .select()
    .from(genreMarketSnapshots)
    .orderBy(desc(genreMarketSnapshots.active), desc(genreMarketSnapshots.observedAt), desc(genreMarketSnapshots.updatedAt))
    .all()
    .map((row) => rowToSnapshot(row as SnapshotRow))
    .filter((snapshot): snapshot is StoredGenreMarketSnapshot => Boolean(snapshot))
}

export function getActiveGenreMarketSnapshot(db: DB): StoredGenreMarketSnapshot | undefined {
  const row = db
    .select()
    .from(genreMarketSnapshots)
    .where(eq(genreMarketSnapshots.active, true))
    .orderBy(desc(genreMarketSnapshots.updatedAt))
    .get()
  return row ? rowToSnapshot(row as SnapshotRow) : undefined
}

function saveSnapshot(db: DB, input: unknown, active: boolean): StoredGenreMarketSnapshot {
  const snapshot = validateGenreMarketSnapshot(input)
  const existing = db.select().from(genreMarketSnapshots).where(eq(genreMarketSnapshots.version, snapshot.version)).get()
  const ts = now()
  if (active) db.update(genreMarketSnapshots).set({ active: false, updatedAt: ts }).run()

  const fields = {
    observedAt: snapshot.observedAt,
    sources: stringifyJson(snapshot.sources),
    opportunities: stringifyJson(snapshot.opportunities),
    active,
    updatedAt: ts,
  }
  if (existing) {
    const [row] = updateRows(db, genreMarketSnapshots, fields)
      .where(eq(genreMarketSnapshots.version, snapshot.version))
      .returning()
      .all()
    const saved = rowToSnapshot(row as SnapshotRow)
    if (saved) return saved
  } else {
    const [row] = insertRow(db, genreMarketSnapshots, {
      version: snapshot.version,
      createdAt: ts,
      ...fields,
    })
    const saved = rowToSnapshot(row as SnapshotRow)
    if (saved) return saved
  }
  throw new Error('市场快照保存失败')
}

/** 启动时幂等写入产品内置快照；不覆盖用户切换过的 active 版本。 */
export function ensureBuiltInGenreMarketSnapshot(db: DB, snapshot: GenreMarketSnapshot): StoredGenreMarketSnapshot {
  const existing = db.select().from(genreMarketSnapshots).where(eq(genreMarketSnapshots.version, snapshot.version)).get()
  const hasActive = Boolean(getActiveGenreMarketSnapshot(db))
  // 已有内置快照的 active 状态属于用户选择的一部分，启动同步不能把它意外关闭。
  return saveSnapshot(db, snapshot, existing ? existing.active : !hasActive)
}

/**
 * 手动导入的文件会显式追加 user_imported 来源标签，保留原始研究/官方来源供用户追溯。
 */
export function importGenreMarketSnapshot(db: DB, input: unknown): StoredGenreMarketSnapshot {
  const snapshot = validateGenreMarketSnapshot(input)
  const today = now().slice(0, 10)
  const hasImportedTag = snapshot.sources.some((source) => source.kind === 'user_imported')
  const sources: GenreMarketSource[] = hasImportedTag
    ? snapshot.sources
    : [
        ...snapshot.sources,
        {
          kind: 'user_imported',
          label: '本地手动导入',
          accessedAt: today,
          note: '文件内容仅在本机保存；导入过程不会请求网络。',
        },
      ]
  return saveSnapshot(db, { ...snapshot, sources }, true)
}

/** 回滚只改变新建项目默认采用的版本，不删除任何历史版本或已建项目快照。 */
export function activateGenreMarketSnapshot(db: DB, version: string): StoredGenreMarketSnapshot | undefined {
  const existing = db.select().from(genreMarketSnapshots).where(eq(genreMarketSnapshots.version, version)).get()
  if (!existing || !rowToSnapshot(existing as SnapshotRow)) return undefined
  const ts = now()
  db.update(genreMarketSnapshots).set({ active: false, updatedAt: ts }).run()
  const [row] = updateRows(db, genreMarketSnapshots, { active: true, updatedAt: ts })
    .where(eq(genreMarketSnapshots.version, version))
    .returning()
    .all()
  return row ? rowToSnapshot(row as SnapshotRow) : undefined
}
