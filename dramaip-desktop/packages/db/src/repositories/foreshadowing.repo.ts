// foreshadowings —— 伏笔（ROADMAP v0.2 §6）
import { eq, or } from 'drizzle-orm'
import type { DB } from '../client'
import { foreshadowings } from '../schema'
import type { Foreshadowing, OptionalId } from '@sdns/core'
import { genId, now, parseJsonArray, stringifyArray, insertRow, updateRows } from './util'

type ForeshadowingRow = typeof foreshadowings.$inferSelect

function rowToEntity(row: ForeshadowingRow): Foreshadowing {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    setupChapterId: row.setupChapterId ?? undefined,
    payoffChapterId: row.payoffChapterId ?? undefined,
    status: row.status as Foreshadowing['status'],
    description: row.description,
    payoffPlan: row.payoffPlan ?? undefined,
    relatedCharacterIds: parseJsonArray(row.relatedCharacterIds),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listForeshadowings(db: DB, projectId: string): Foreshadowing[] {
  return db
    .select()
    .from(foreshadowings)
    .where(eq(foreshadowings.projectId, projectId))
    .orderBy(foreshadowings.createdAt)
    .all()
    .map(rowToEntity)
}

/** 在 chapterId 处埋下或回收的伏笔 */
export function listForeshadowingsByChapter(db: DB, chapterId: string): Foreshadowing[] {
  return db
    .select()
    .from(foreshadowings)
    .where(or(eq(foreshadowings.setupChapterId, chapterId), eq(foreshadowings.payoffChapterId, chapterId)))
    .orderBy(foreshadowings.createdAt)
    .all()
    .map(rowToEntity)
}

export function getForeshadowing(db: DB, id: string): Foreshadowing | undefined {
  const row = db.select().from(foreshadowings).where(eq(foreshadowings.id, id)).get()
  return row ? rowToEntity(row as ForeshadowingRow) : undefined
}

export function createForeshadowing(
  db: DB,
  data: Partial<OptionalId<Foreshadowing>> & { projectId: string; title: string; description: string },
): Foreshadowing {
  const ts = now()
  const value: typeof foreshadowings.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    projectId: data.projectId,
    title: data.title,
    setupChapterId: data.setupChapterId ?? null,
    payoffChapterId: data.payoffChapterId ?? null,
    status: data.status ?? 'planned',
    description: data.description,
    payoffPlan: data.payoffPlan ?? null,
    relatedCharacterIds: stringifyArray(data.relatedCharacterIds),
  }
  const [row] = insertRow(db, foreshadowings, value)
  return rowToEntity(row as ForeshadowingRow)
}

export function updateForeshadowing(
  db: DB,
  id: string,
  patch: Partial<OptionalId<Foreshadowing>>,
): Foreshadowing | undefined {
  const fields: Record<string, unknown> = { ...patch, updatedAt: now() }
  if (Array.isArray(fields.relatedCharacterIds)) {
    fields.relatedCharacterIds = stringifyArray(fields.relatedCharacterIds as string[])
  }
  const [row] = updateRows(db, foreshadowings, fields)
    .where(eq(foreshadowings.id, id))
    .returning()
    .all()
  return row ? rowToEntity(row as ForeshadowingRow) : undefined
}

export function deleteForeshadowing(db: DB, id: string): void {
  db.delete(foreshadowings).where(eq(foreshadowings.id, id)).run()
}
