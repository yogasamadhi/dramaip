import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import { chapters } from '../schema'
import type { Chapter, OptionalId } from '@sdns/core'
import { genId, now, insertRow, updateRows } from './util'

export type ChapterRow = typeof chapters.$inferSelect

export function listChapters(db: DB, projectId: string): Chapter[] {
  return db
    .select()
    .from(chapters)
    .where(eq(chapters.projectId, projectId))
    .orderBy(chapters.orderIndex)
    .all() as unknown as Chapter[]
}

export function getChapter(db: DB, id: string): Chapter | undefined {
  const row = db.select().from(chapters).where(eq(chapters.id, id)).get()
  return (row as unknown as Chapter) ?? undefined
}

export function createChapter(
  db: DB,
  data: Partial<OptionalId<Chapter>> & { projectId: string; title: string },
): Chapter {
  const ts = now()
  const orderIndex = data.orderIndex ?? listChapters(db, data.projectId).length
  const value: typeof chapters.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    projectId: data.projectId,
    title: data.title,
    orderIndex,
    content: data.content ?? '',
    summary: data.summary ?? null,
    outline: data.outline ?? null,
    mainConflict: data.mainConflict ?? null,
    hook: data.hook ?? null,
    highlight: data.highlight ?? null,
    reversal: data.reversal ?? null,
    cliffhanger: data.cliffhanger ?? null,
    shortDramaNote: data.shortDramaNote ?? null,
    aiVideoNote: data.aiVideoNote ?? null,
  }
  const [row] = insertRow(db, chapters, value)
  return row as unknown as Chapter
}

export function updateChapter(
  db: DB,
  id: string,
  patch: Partial<OptionalId<Chapter>>,
): Chapter | undefined {
  const [row] = updateRows(db, chapters, { ...patch, updatedAt: now() })
    .where(eq(chapters.id, id))
    .returning()
    .all()
  return (row as unknown as Chapter) ?? undefined
}

/** 章节正文自动保存 / AI 写回专用 */
export function updateChapterContent(db: DB, id: string, content: string): Chapter | undefined {
  return updateChapter(db, id, { content })
}

export function deleteChapter(db: DB, id: string): void {
  db.delete(chapters).where(eq(chapters.id, id)).run()
}
