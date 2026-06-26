// story_events —— 故事事件时间线（ROADMAP v0.2 §5）
import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import { storyEvents } from '../schema'
import type { OptionalId, StoryEvent } from '@sdns/core'
import { genId, now, parseJsonArray, stringifyArray, insertRow, updateRows } from './util'

type StoryEventRow = typeof storyEvents.$inferSelect

function rowToEntity(row: StoryEventRow): StoryEvent {
  return {
    id: row.id,
    projectId: row.projectId,
    chapterId: row.chapterId ?? undefined,
    title: row.title,
    description: row.description,
    eventType: row.eventType as StoryEvent['eventType'],
    relatedCharacterIds: parseJsonArray(row.relatedCharacterIds),
    orderIndex: row.orderIndex,
    createdAt: row.createdAt,
  }
}

export function listStoryEvents(db: DB, projectId: string): StoryEvent[] {
  return db
    .select()
    .from(storyEvents)
    .where(eq(storyEvents.projectId, projectId))
    .orderBy(storyEvents.orderIndex)
    .all()
    .map(rowToEntity)
}

export function getStoryEvent(db: DB, id: string): StoryEvent | undefined {
  const row = db.select().from(storyEvents).where(eq(storyEvents.id, id)).get()
  return row ? rowToEntity(row as StoryEventRow) : undefined
}

export function createStoryEvent(
  db: DB,
  data: Partial<OptionalId<StoryEvent>> & { projectId: string; title: string; description: string; eventType: StoryEvent['eventType'] },
): StoryEvent {
  const orderIndex = data.orderIndex ?? listStoryEvents(db, data.projectId).length
  const value: typeof storyEvents.$inferInsert = {
    id: genId(),
    createdAt: now(),
    projectId: data.projectId,
    chapterId: data.chapterId ?? null,
    title: data.title,
    description: data.description,
    eventType: data.eventType,
    relatedCharacterIds: stringifyArray(data.relatedCharacterIds),
    orderIndex,
  }
  const [row] = insertRow(db, storyEvents, value)
  return rowToEntity(row as StoryEventRow)
}

export function updateStoryEvent(
  db: DB,
  id: string,
  patch: Partial<OptionalId<StoryEvent>>,
): StoryEvent | undefined {
  const fields: Record<string, unknown> = { ...patch }
  if (Array.isArray(fields.relatedCharacterIds)) {
    fields.relatedCharacterIds = stringifyArray(fields.relatedCharacterIds as string[])
  }
  const [row] = updateRows(db, storyEvents, fields)
    .where(eq(storyEvents.id, id))
    .returning()
    .all()
  return row ? rowToEntity(row as StoryEventRow) : undefined
}

export function deleteStoryEvent(db: DB, id: string): void {
  db.delete(storyEvents).where(eq(storyEvents.id, id)).run()
}
