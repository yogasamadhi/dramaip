import { eq } from 'drizzle-orm'
import type { ImageProviderConfigRecord } from '@sdns/core'
import type { DB } from '../client'
import { imageProviderConfigs } from '../schema'
import { genId, insertRow, now, updateRows } from './util'

export interface NewImageProviderConfig {
  id?: string
  name: string
  kind: ImageProviderConfigRecord['kind']
  apiKey?: string
  model?: string
  featureEnabled?: boolean
  isDefault?: boolean
}

export function listImageProviderConfigs(db: DB): ImageProviderConfigRecord[] {
  return db.select().from(imageProviderConfigs).orderBy(imageProviderConfigs.createdAt).all() as unknown as ImageProviderConfigRecord[]
}

export function getImageProviderConfig(db: DB, id: string): ImageProviderConfigRecord | undefined {
  return db.select().from(imageProviderConfigs).where(eq(imageProviderConfigs.id, id)).get() as unknown as ImageProviderConfigRecord | undefined
}

export function getDefaultImageProviderConfig(db: DB): ImageProviderConfigRecord | undefined {
  const configured = db.select().from(imageProviderConfigs).where(eq(imageProviderConfigs.isDefault, true)).get()
  if (configured) return configured as unknown as ImageProviderConfigRecord
  return db.select().from(imageProviderConfigs).orderBy(imageProviderConfigs.createdAt).limit(1).get() as unknown as ImageProviderConfigRecord | undefined
}

export function createImageProviderConfig(db: DB, data: NewImageProviderConfig): ImageProviderConfigRecord {
  const ts = now()
  if (data.isDefault) clearDefault(db)
  const [row] = insertRow(db, imageProviderConfigs, {
    id: data.id ?? genId(), name: data.name, kind: data.kind, apiKey: data.apiKey ?? '', model: data.model ?? 'gpt-image-2',
    featureEnabled: data.featureEnabled ?? false, isDefault: data.isDefault ?? false, createdAt: ts, updatedAt: ts,
  })
  return row as unknown as ImageProviderConfigRecord
}

export function updateImageProviderConfig(db: DB, id: string, patch: Partial<NewImageProviderConfig>): ImageProviderConfigRecord | undefined {
  if (patch.isDefault) clearDefault(db)
  const [row] = updateRows(db, imageProviderConfigs, { ...patch, updatedAt: now() }).where(eq(imageProviderConfigs.id, id)).returning().all()
  return row as unknown as ImageProviderConfigRecord | undefined
}

export function deleteImageProviderConfig(db: DB, id: string): void {
  db.delete(imageProviderConfigs).where(eq(imageProviderConfigs.id, id)).run()
}

export function setDefaultImageProviderConfig(db: DB, id: string): void {
  clearDefault(db)
  updateRows(db, imageProviderConfigs, { isDefault: true, updatedAt: now() }).where(eq(imageProviderConfigs.id, id)).run()
}

function clearDefault(db: DB): void {
  updateRows(db, imageProviderConfigs, { isDefault: false, updatedAt: now() }).where(eq(imageProviderConfigs.isDefault, true)).run()
}
