import { and, eq, isNull } from 'drizzle-orm'
import type { DB } from '../client'
import { storyArcs } from '../schema'
import type { OptionalId, StoryArc, StoryArcKind } from '@sdns/core'
import { genId, insertRow, now, parseJsonArray, stringifyArray, updateRows } from './util'

type StoryArcRow = typeof storyArcs.$inferSelect

function rowToEntity(row: StoryArcRow): StoryArc {
  return {
    id: row.id,
    projectId: row.projectId,
    parentId: row.parentId ?? undefined,
    kind: row.kind as StoryArcKind,
    title: row.title,
    summary: row.summary ?? undefined,
    targetWordCount: row.targetWordCount ?? undefined,
    targetChapterCount: row.targetChapterCount ?? undefined,
    chapterStart: row.chapterStart ?? undefined,
    chapterEnd: row.chapterEnd ?? undefined,
    coreConflict: row.coreConflict ?? undefined,
    keyHighlights: parseJsonArray(row.keyHighlights),
    foreshadowingPayoffs: parseJsonArray(row.foreshadowingPayoffs),
    orderIndex: row.orderIndex,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listStoryArcs(db: DB, projectId: string, kind?: StoryArcKind): StoryArc[] {
  const condition = kind
    ? and(eq(storyArcs.projectId, projectId), eq(storyArcs.kind, kind))
    : eq(storyArcs.projectId, projectId)
  return db
    .select()
    .from(storyArcs)
    .where(condition)
    .orderBy(storyArcs.orderIndex)
    .all()
    .map((row) => rowToEntity(row as StoryArcRow))
}

export function listStoryArcsByParent(db: DB, projectId: string, parentId?: string): StoryArc[] {
  const condition = parentId
    ? and(eq(storyArcs.projectId, projectId), eq(storyArcs.parentId, parentId))
    : and(eq(storyArcs.projectId, projectId), isNull(storyArcs.parentId))
  return db
    .select()
    .from(storyArcs)
    .where(condition)
    .orderBy(storyArcs.orderIndex)
    .all()
    .map((row) => rowToEntity(row as StoryArcRow))
}

export function getStoryArc(db: DB, id: string): StoryArc | undefined {
  const row = db.select().from(storyArcs).where(eq(storyArcs.id, id)).get()
  return row ? rowToEntity(row as StoryArcRow) : undefined
}

export function createStoryArc(
  db: DB,
  data: Partial<OptionalId<StoryArc>> & { projectId: string; kind: StoryArcKind; title: string },
): StoryArc {
  const ts = now()
  const value: typeof storyArcs.$inferInsert = {
    id: genId(),
    projectId: data.projectId,
    parentId: data.parentId ?? null,
    kind: data.kind,
    title: data.title,
    summary: data.summary ?? null,
    targetWordCount: data.targetWordCount ?? null,
    targetChapterCount: data.targetChapterCount ?? null,
    chapterStart: data.chapterStart ?? null,
    chapterEnd: data.chapterEnd ?? null,
    coreConflict: data.coreConflict ?? null,
    keyHighlights: stringifyArray(data.keyHighlights),
    foreshadowingPayoffs: stringifyArray(data.foreshadowingPayoffs),
    orderIndex: data.orderIndex ?? 0,
    createdAt: ts,
    updatedAt: ts,
  }
  const [row] = insertRow(db, storyArcs, value)
  return rowToEntity(row as StoryArcRow)
}

export function updateStoryArc(db: DB, id: string, patch: Partial<OptionalId<StoryArc>>): StoryArc | undefined {
  const fields: Partial<typeof storyArcs.$inferInsert> = { updatedAt: now() }
  if (patch.parentId !== undefined || 'parentId' in patch) fields.parentId = patch.parentId ?? null
  if (patch.kind !== undefined) fields.kind = patch.kind
  if (patch.title !== undefined) fields.title = patch.title
  if (patch.summary !== undefined || 'summary' in patch) fields.summary = patch.summary ?? null
  if (patch.targetWordCount !== undefined || 'targetWordCount' in patch) fields.targetWordCount = patch.targetWordCount ?? null
  if (patch.targetChapterCount !== undefined || 'targetChapterCount' in patch) {
    fields.targetChapterCount = patch.targetChapterCount ?? null
  }
  if (patch.chapterStart !== undefined || 'chapterStart' in patch) fields.chapterStart = patch.chapterStart ?? null
  if (patch.chapterEnd !== undefined || 'chapterEnd' in patch) fields.chapterEnd = patch.chapterEnd ?? null
  if (patch.coreConflict !== undefined || 'coreConflict' in patch) fields.coreConflict = patch.coreConflict ?? null
  if (patch.keyHighlights !== undefined) fields.keyHighlights = stringifyArray(patch.keyHighlights)
  if (patch.foreshadowingPayoffs !== undefined) fields.foreshadowingPayoffs = stringifyArray(patch.foreshadowingPayoffs)
  const [row] = updateRows(db, storyArcs, fields).where(eq(storyArcs.id, id)).returning().all()
  return row ? rowToEntity(row as StoryArcRow) : undefined
}

export function deleteStoryArc(db: DB, id: string): void {
  const children = db.select({ id: storyArcs.id }).from(storyArcs).where(eq(storyArcs.parentId, id)).all() as Array<{ id: string }>
  for (const child of children) deleteStoryArc(db, child.id)
  db.delete(storyArcs).where(eq(storyArcs.id, id)).run()
}
