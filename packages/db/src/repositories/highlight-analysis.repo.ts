// highlight_analyses —— 爽点分析（ROADMAP v0.3 §3）
import { and, eq } from 'drizzle-orm'
import type { DB } from '../client'
import { highlightAnalyses } from '../schema'
import type { HighlightAnalysis, OptionalId } from '@sdns/core'
import { genId, now, parseJsonArray, stringifyArray, insertRow, updateRows } from './util'

type HighlightRow = typeof highlightAnalyses.$inferSelect

function rowToEntity(row: HighlightRow): HighlightAnalysis {
  return {
    id: row.id,
    projectId: row.projectId,
    chapterId: row.chapterId,
    faceSlap: row.faceSlap,
    revenge: row.revenge,
    identityReveal: row.identityReveal,
    misunderstandingCleared: row.misunderstandingCleared,
    pampering: row.pampering,
    counterKill: row.counterKill,
    counterattack: row.counterattack,
    angst: row.angst,
    highlightTypes: parseJsonArray(row.highlightTypes),
    summary: row.summary,
    suggestions: row.suggestions ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listHighlights(db: DB, projectId: string): HighlightAnalysis[] {
  return db.select().from(highlightAnalyses).where(eq(highlightAnalyses.projectId, projectId)).orderBy(highlightAnalyses.createdAt).all().map(rowToEntity)
}

export function getHighlightByChapter(db: DB, projectId: string, chapterId: string): HighlightAnalysis | undefined {
  const row = db
    .select()
    .from(highlightAnalyses)
    .where(and(eq(highlightAnalyses.projectId, projectId), eq(highlightAnalyses.chapterId, chapterId)))
    .get()
  return row ? rowToEntity(row as HighlightRow) : undefined
}

export function createHighlight(
  db: DB,
  data: Partial<OptionalId<HighlightAnalysis>> & { projectId: string; chapterId: string; summary: string },
): HighlightAnalysis {
  const ts = now()
  const value: typeof highlightAnalyses.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    projectId: data.projectId,
    chapterId: data.chapterId,
    faceSlap: data.faceSlap ?? 0,
    revenge: data.revenge ?? 0,
    identityReveal: data.identityReveal ?? 0,
    misunderstandingCleared: data.misunderstandingCleared ?? 0,
    pampering: data.pampering ?? 0,
    counterKill: data.counterKill ?? 0,
    counterattack: data.counterattack ?? 0,
    angst: data.angst ?? 0,
    highlightTypes: stringifyArray(data.highlightTypes),
    summary: data.summary,
    suggestions: data.suggestions ?? null,
  }
  const [row] = insertRow(db, highlightAnalyses, value)
  return rowToEntity(row as HighlightRow)
}

export function upsertHighlightByChapter(
  db: DB,
  data: Partial<OptionalId<HighlightAnalysis>> & { projectId: string; chapterId: string; summary: string },
): HighlightAnalysis {
  const existing = getHighlightByChapter(db, data.projectId, data.chapterId)
  if (existing) {
    const fields: Record<string, unknown> = { ...data, updatedAt: now() }
    if (Array.isArray(fields.highlightTypes)) fields.highlightTypes = stringifyArray(fields.highlightTypes as string[])
    const [row] = updateRows(db, highlightAnalyses, fields).where(eq(highlightAnalyses.id, existing.id)).returning().all()
    return row ? rowToEntity(row as HighlightRow) : existing
  }
  return createHighlight(db, data)
}

export function deleteHighlight(db: DB, id: string): void {
  db.delete(highlightAnalyses).where(eq(highlightAnalyses.id, id)).run()
}
