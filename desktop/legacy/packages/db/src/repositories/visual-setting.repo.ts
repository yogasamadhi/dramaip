// visual_settings —— 世界/场景视觉设定（ROADMAP v0.2 §4）
import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import { visualSettings } from '../schema'
import type { OptionalId, VisualSetting } from '@sdns/core'
import { genId, now, insertRow, updateRows } from './util'

export function listVisualSettings(db: DB, projectId: string): VisualSetting[] {
  return db
    .select()
    .from(visualSettings)
    .where(eq(visualSettings.projectId, projectId))
    .orderBy(visualSettings.createdAt)
    .all() as unknown as VisualSetting[]
}

export function getVisualSetting(db: DB, id: string): VisualSetting | undefined {
  const row = db.select().from(visualSettings).where(eq(visualSettings.id, id)).get()
  return (row as unknown as VisualSetting) ?? undefined
}

export function createVisualSetting(
  db: DB,
  data: Partial<OptionalId<VisualSetting>> & { projectId: string; title: string; type: VisualSetting['type']; visualPrompt: string },
): VisualSetting {
  const ts = now()
  const value: typeof visualSettings.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    projectId: data.projectId,
    title: data.title,
    type: data.type,
    visualPrompt: data.visualPrompt,
    negativePrompt: data.negativePrompt ?? null,
    referenceImageUrl: data.referenceImageUrl ?? null,
    notes: data.notes ?? null,
  }
  const [row] = insertRow(db, visualSettings, value)
  return row as unknown as VisualSetting
}

export function updateVisualSetting(
  db: DB,
  id: string,
  patch: Partial<OptionalId<VisualSetting>>,
): VisualSetting | undefined {
  const [row] = updateRows(db, visualSettings, { ...patch, updatedAt: now() })
    .where(eq(visualSettings.id, id))
    .returning()
    .all()
  return (row as unknown as VisualSetting) ?? undefined
}

export function deleteVisualSetting(db: DB, id: string): void {
  db.delete(visualSettings).where(eq(visualSettings.id, id)).run()
}
