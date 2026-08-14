// chapter_memories —— 章节记忆（ROADMAP v0.2 §1）
import { and, eq } from 'drizzle-orm'
import type { DB } from '../client'
import { chapterMemories } from '../schema'
import type { ChapterMemory, OptionalId } from '@sdns/core'
import { genId, now, parseJsonArray, stringifyArray, insertRow, updateRows } from './util'

type ChapterMemoryRow = typeof chapterMemories.$inferSelect

function rowToEntity(row: ChapterMemoryRow): ChapterMemory {
  return {
    id: row.id,
    projectId: row.projectId,
    chapterId: row.chapterId,
    summary: row.summary,
    importantEvents: parseJsonArray(row.importantEvents),
    characterChanges: parseJsonArray(row.characterChanges),
    revealedSecrets: parseJsonArray(row.revealedSecrets),
    newForeshadowing: parseJsonArray(row.newForeshadowing),
    resolvedForeshadowing: parseJsonArray(row.resolvedForeshadowing),
    keyVisualElements: parseJsonArray(row.keyVisualElements),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listChapterMemories(db: DB, projectId: string): ChapterMemory[] {
  return db
    .select()
    .from(chapterMemories)
    .where(eq(chapterMemories.projectId, projectId))
    .orderBy(chapterMemories.createdAt)
    .all()
    .map(rowToEntity)
}

export function getChapterMemoryByChapter(
  db: DB,
  projectId: string,
  chapterId: string,
): ChapterMemory | undefined {
  const row = db
    .select()
    .from(chapterMemories)
    .where(and(eq(chapterMemories.projectId, projectId), eq(chapterMemories.chapterId, chapterId)))
    .get()
  return row ? rowToEntity(row as ChapterMemoryRow) : undefined
}

export function getChapterMemory(db: DB, id: string): ChapterMemory | undefined {
  const row = db.select().from(chapterMemories).where(eq(chapterMemories.id, id)).get()
  return row ? rowToEntity(row as ChapterMemoryRow) : undefined
}

export function createChapterMemory(
  db: DB,
  data: Partial<OptionalId<ChapterMemory>> & { projectId: string; chapterId: string; summary: string },
): ChapterMemory {
  const ts = now()
  const value: typeof chapterMemories.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    projectId: data.projectId,
    chapterId: data.chapterId,
    summary: data.summary,
    importantEvents: stringifyArray(data.importantEvents),
    characterChanges: stringifyArray(data.characterChanges),
    revealedSecrets: stringifyArray(data.revealedSecrets),
    newForeshadowing: stringifyArray(data.newForeshadowing),
    resolvedForeshadowing: stringifyArray(data.resolvedForeshadowing),
    keyVisualElements: stringifyArray(data.keyVisualElements),
  }
  const [row] = insertRow(db, chapterMemories, value)
  return rowToEntity(row as ChapterMemoryRow)
}

export function updateChapterMemory(
  db: DB,
  id: string,
  patch: Partial<OptionalId<ChapterMemory>>,
): ChapterMemory | undefined {
  const fields: Record<string, unknown> = { ...patch, updatedAt: now() }
  // 数组字段序列化
  for (const k of [
    'importantEvents',
    'characterChanges',
    'revealedSecrets',
    'newForeshadowing',
    'resolvedForeshadowing',
    'keyVisualElements',
  ]) {
    if (Array.isArray(fields[k])) fields[k] = stringifyArray(fields[k] as string[])
  }
  const [row] = updateRows(db, chapterMemories, fields)
    .where(eq(chapterMemories.id, id))
    .returning()
    .all()
  return row ? rowToEntity(row as ChapterMemoryRow) : undefined
}

export function deleteChapterMemory(db: DB, id: string): void {
  db.delete(chapterMemories).where(eq(chapterMemories.id, id)).run()
}
