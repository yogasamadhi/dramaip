import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import { modelConfigs } from '../schema'
import type { ModelConfig } from '@sdns/core'
import { genId, now, insertRow, updateRows } from './util'

export function listModelConfigs(db: DB): ModelConfig[] {
  return db.select().from(modelConfigs).orderBy(modelConfigs.createdAt).all() as unknown as ModelConfig[]
}

export function getModelConfig(db: DB, id: string): ModelConfig | undefined {
  const row = db.select().from(modelConfigs).where(eq(modelConfigs.id, id)).get()
  return (row as unknown as ModelConfig) ?? undefined
}

export interface NewModelConfig {
  id?: string
  name: string
  provider: string
  baseUrl: string
  apiKey?: string
  model: string
  isDefault?: boolean
}

export function createModelConfig(db: DB, data: NewModelConfig): ModelConfig {
  const ts = now()
  if (data.isDefault) clearDefault(db)
  const value: typeof modelConfigs.$inferInsert = {
    id: data.id ?? genId(),
    createdAt: ts,
    updatedAt: ts,
    name: data.name,
    provider: data.provider,
    baseUrl: data.baseUrl,
    apiKey: data.apiKey ?? '',
    model: data.model,
    isDefault: data.isDefault ?? false,
  }
  const [row] = insertRow(db, modelConfigs, value)
  return row as unknown as ModelConfig
}

export function updateModelConfig(
  db: DB,
  id: string,
  patch: Partial<NewModelConfig> & { id?: string },
): ModelConfig | undefined {
  if (patch.isDefault) clearDefault(db)
  const { ...rest } = patch
  const [row] = updateRows(db, modelConfigs, { ...rest, updatedAt: now() })
    .where(eq(modelConfigs.id, id))
    .returning()
    .all()
  return (row as unknown as ModelConfig) ?? undefined
}

export function deleteModelConfig(db: DB, id: string): void {
  db.delete(modelConfigs).where(eq(modelConfigs.id, id)).run()
}

export function getDefaultModelConfig(db: DB): ModelConfig | undefined {
  const row = db.select().from(modelConfigs).where(eq(modelConfigs.isDefault, true)).get()
  if (row) return row as unknown as ModelConfig
  const first = db.select().from(modelConfigs).orderBy(modelConfigs.createdAt).limit(1).get()
  return (first as unknown as ModelConfig) ?? undefined
}

export function setDefaultModelConfig(db: DB, id: string): void {
  clearDefault(db)
  updateRows(db, modelConfigs, { isDefault: true, updatedAt: now() }).where(eq(modelConfigs.id, id)).run()
}

function clearDefault(db: DB): void {
  updateRows(db, modelConfigs, { isDefault: false }).where(eq(modelConfigs.isDefault, true)).run()
}
