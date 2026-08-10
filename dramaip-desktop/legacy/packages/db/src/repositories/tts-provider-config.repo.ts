import { eq } from 'drizzle-orm'
import type { TtsProviderConfigRecord } from '@sdns/core'
import type { DB } from '../client'
import { ttsProviderConfigs } from '../schema'
import { genId, insertRow, now, updateRows } from './util'

export interface NewTtsProviderConfig {
  id?: string
  name: string
  kind: TtsProviderConfigRecord['kind']
  apiKey?: string
  model?: string
  featureEnabled?: boolean
  isDefault?: boolean
}

export function listTtsProviderConfigs(db: DB): TtsProviderConfigRecord[] {
  return db.select().from(ttsProviderConfigs).orderBy(ttsProviderConfigs.createdAt).all() as unknown as TtsProviderConfigRecord[]
}

export function getTtsProviderConfig(db: DB, id: string): TtsProviderConfigRecord | undefined {
  return db.select().from(ttsProviderConfigs).where(eq(ttsProviderConfigs.id, id)).get() as unknown as TtsProviderConfigRecord | undefined
}

export function getDefaultTtsProviderConfig(db: DB): TtsProviderConfigRecord | undefined {
  const configured = db.select().from(ttsProviderConfigs).where(eq(ttsProviderConfigs.isDefault, true)).get()
  if (configured) return configured as unknown as TtsProviderConfigRecord
  return db.select().from(ttsProviderConfigs).orderBy(ttsProviderConfigs.createdAt).limit(1).get() as unknown as TtsProviderConfigRecord | undefined
}

export function createTtsProviderConfig(db: DB, data: NewTtsProviderConfig): TtsProviderConfigRecord {
  const ts = now()
  if (data.isDefault) clearDefault(db)
  const [row] = insertRow(db, ttsProviderConfigs, {
    id: data.id ?? genId(), name: data.name, kind: data.kind, apiKey: data.apiKey ?? '', model: data.model ?? 'gpt-4o-mini-tts',
    featureEnabled: data.featureEnabled ?? false, isDefault: data.isDefault ?? false, createdAt: ts, updatedAt: ts,
  })
  return row as unknown as TtsProviderConfigRecord
}

export function updateTtsProviderConfig(db: DB, id: string, patch: Partial<NewTtsProviderConfig>): TtsProviderConfigRecord | undefined {
  if (patch.isDefault) clearDefault(db)
  const [row] = updateRows(db, ttsProviderConfigs, { ...patch, updatedAt: now() }).where(eq(ttsProviderConfigs.id, id)).returning().all()
  return row as unknown as TtsProviderConfigRecord | undefined
}

export function deleteTtsProviderConfig(db: DB, id: string): void {
  db.delete(ttsProviderConfigs).where(eq(ttsProviderConfigs.id, id)).run()
}

export function setDefaultTtsProviderConfig(db: DB, id: string): void {
  clearDefault(db)
  updateRows(db, ttsProviderConfigs, { isDefault: true, updatedAt: now() }).where(eq(ttsProviderConfigs.id, id)).run()
}

function clearDefault(db: DB): void {
  updateRows(db, ttsProviderConfigs, { isDefault: false, updatedAt: now() }).where(eq(ttsProviderConfigs.isDefault, true)).run()
}
