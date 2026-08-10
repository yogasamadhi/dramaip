// video_provider_configs —— 视频生成 Provider 配置（ROADMAP v0.7 §1）
import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import { videoProviderConfigs } from '../schema'
import type { VideoProviderConfig, OptionalId } from '@sdns/core'
import { genId, now, insertRow, updateRows } from './util'

type ConfigRow = typeof videoProviderConfigs.$inferSelect

function rowToEntity(row: ConfigRow): VideoProviderConfig {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as VideoProviderConfig['kind'],
    baseUrl: row.baseUrl ?? undefined,
    apiKey: row.apiKey ?? '',
    model: row.model ?? undefined,
    defaultParams: row.defaultParams ?? undefined,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listVideoProviderConfigs(db: DB): VideoProviderConfig[] {
  return db
    .select()
    .from(videoProviderConfigs)
    .orderBy(videoProviderConfigs.createdAt)
    .all()
    .map((row) => rowToEntity(row as ConfigRow))
}

export function getVideoProviderConfig(db: DB, id: string): VideoProviderConfig | undefined {
  const row = db.select().from(videoProviderConfigs).where(eq(videoProviderConfigs.id, id)).get()
  return row ? rowToEntity(row as ConfigRow) : undefined
}

export function createVideoProviderConfig(
  db: DB,
  data: Partial<OptionalId<VideoProviderConfig>> & { id?: string; name: string; kind: string },
): VideoProviderConfig {
  const ts = now()
  if (data.isDefault) clearDefault(db)
  const value: typeof videoProviderConfigs.$inferInsert = {
    id: data.id ?? genId(),
    createdAt: ts,
    updatedAt: ts,
    name: data.name,
    kind: data.kind,
    baseUrl: data.baseUrl ?? null,
    apiKey: data.apiKey ?? '',
    model: data.model ?? null,
    defaultParams: data.defaultParams ?? null,
    isDefault: data.isDefault ?? false,
  }
  const [row] = insertRow(db, videoProviderConfigs, value)
  return rowToEntity(row as ConfigRow)
}

export function updateVideoProviderConfig(
  db: DB,
  id: string,
  patch: Partial<OptionalId<VideoProviderConfig>>,
): VideoProviderConfig | undefined {
  if (patch.isDefault) clearDefault(db)
  const [row] = updateRows(db, videoProviderConfigs, { ...patch, updatedAt: now() })
    .where(eq(videoProviderConfigs.id, id))
    .returning()
    .all()
  return row ? rowToEntity(row as ConfigRow) : undefined
}

export function deleteVideoProviderConfig(db: DB, id: string): void {
  db.delete(videoProviderConfigs).where(eq(videoProviderConfigs.id, id)).run()
}

export function getDefaultVideoProviderConfig(db: DB): VideoProviderConfig | undefined {
  const row = db.select().from(videoProviderConfigs).where(eq(videoProviderConfigs.isDefault, true)).get()
  if (row) return rowToEntity(row as ConfigRow)
  const first = db.select().from(videoProviderConfigs).orderBy(videoProviderConfigs.createdAt).limit(1).get()
  return first ? rowToEntity(first as ConfigRow) : undefined
}

export function setDefaultVideoProviderConfig(db: DB, id: string): void {
  clearDefault(db)
  updateRows(db, videoProviderConfigs, { isDefault: true, updatedAt: now() })
    .where(eq(videoProviderConfigs.id, id))
    .run()
}

function clearDefault(db: DB): void {
  updateRows(db, videoProviderConfigs, { isDefault: false })
    .where(eq(videoProviderConfigs.isDefault, true))
    .run()
}
