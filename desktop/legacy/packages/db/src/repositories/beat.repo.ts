// beats —— 戏剧节拍（ROADMAP v0.3 §2）
import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import { beats } from '../schema'
import type { Beat, OptionalId } from '@sdns/core'
import { genId, now, parseJsonArray, stringifyArray, insertRow, updateRows } from './util'

type BeatRow = typeof beats.$inferSelect

function rowToEntity(row: BeatRow): Beat {
  return {
    id: row.id,
    projectId: row.projectId,
    chapterId: row.chapterId ?? undefined,
    type: row.type as Beat['type'],
    title: row.title,
    description: row.description,
    dramaValue: row.dramaValue,
    visualValue: row.visualValue,
    orderIndex: row.orderIndex,
    relatedCharacterIds: parseJsonArray(row.relatedCharacterIds),
    createdAt: row.createdAt,
  }
}

export function listBeats(db: DB, projectId: string): Beat[] {
  return db.select().from(beats).where(eq(beats.projectId, projectId)).orderBy(beats.orderIndex).all().map(rowToEntity)
}

export function listBeatsByChapter(db: DB, chapterId: string): Beat[] {
  return db.select().from(beats).where(eq(beats.chapterId, chapterId)).orderBy(beats.orderIndex).all().map(rowToEntity)
}

export function getBeat(db: DB, id: string): Beat | undefined {
  const row = db.select().from(beats).where(eq(beats.id, id)).get()
  return row ? rowToEntity(row as BeatRow) : undefined
}

export function createBeat(
  db: DB,
  data: Partial<OptionalId<Beat>> & { projectId: string; type: Beat['type']; title: string; description: string },
): Beat {
  const orderIndex = data.orderIndex ?? listBeats(db, data.projectId).length
  const value: typeof beats.$inferInsert = {
    id: genId(),
    createdAt: now(),
    projectId: data.projectId,
    chapterId: data.chapterId ?? null,
    type: data.type,
    title: data.title,
    description: data.description,
    dramaValue: data.dramaValue ?? 0,
    visualValue: data.visualValue ?? 0,
    orderIndex,
    relatedCharacterIds: stringifyArray(data.relatedCharacterIds),
  }
  const [row] = insertRow(db, beats, value)
  return rowToEntity(row as BeatRow)
}

export function updateBeat(db: DB, id: string, patch: Partial<OptionalId<Beat>>): Beat | undefined {
  const fields: Record<string, unknown> = { ...patch }
  if (Array.isArray(fields.relatedCharacterIds)) {
    fields.relatedCharacterIds = stringifyArray(fields.relatedCharacterIds as string[])
  }
  const [row] = updateRows(db, beats, fields).where(eq(beats.id, id)).returning().all()
  return row ? rowToEntity(row as BeatRow) : undefined
}

export function deleteBeat(db: DB, id: string): void {
  db.delete(beats).where(eq(beats.id, id)).run()
}

/** 删除某章节的全部节拍（重新分析前清场） */
export function deleteBeatsByChapter(db: DB, chapterId: string): void {
  db.delete(beats).where(eq(beats.chapterId, chapterId)).run()
}
