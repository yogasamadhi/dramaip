import { and, eq } from 'drizzle-orm'
import type { DB } from '../client'
import { outlines } from '../schema'
import type { Outline, OptionalId } from '@sdns/core'
import { genId, now, insertRow, updateRows } from './util'

export function listOutlines(db: DB, projectId: string, type?: 'book' | 'chapter'): Outline[] {
  const condition = type
    ? and(eq(outlines.projectId, projectId), eq(outlines.type, type))
    : eq(outlines.projectId, projectId)
  return db
    .select()
    .from(outlines)
    .where(condition)
    .orderBy(outlines.orderIndex)
    .all() as unknown as Outline[]
}

export function getOutline(db: DB, id: string): Outline | undefined {
  const row = db.select().from(outlines).where(eq(outlines.id, id)).get()
  return (row as unknown as Outline) ?? undefined
}

export function createOutline(
  db: DB,
  data: Partial<OptionalId<Outline>> & { projectId: string; type: 'book' | 'chapter'; title: string },
): Outline {
  const ts = now()
  const orderIndex = data.orderIndex ?? 0
  const value: typeof outlines.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    projectId: data.projectId,
    type: data.type,
    title: data.title,
    content: data.content ?? '',
    orderIndex,
  }
  const [row] = insertRow(db, outlines, value)
  return row as unknown as Outline
}

export function updateOutline(
  db: DB,
  id: string,
  patch: Partial<OptionalId<Outline>>,
): Outline | undefined {
  const [row] = updateRows(db, outlines, { ...patch, updatedAt: now() })
    .where(eq(outlines.id, id))
    .returning()
    .all()
  return (row as unknown as Outline) ?? undefined
}

export function deleteOutline(db: DB, id: string): void {
  db.delete(outlines).where(eq(outlines.id, id)).run()
}
