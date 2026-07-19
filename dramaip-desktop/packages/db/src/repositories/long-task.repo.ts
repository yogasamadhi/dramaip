import { and, desc, eq, inArray } from 'drizzle-orm'
import type { DB } from '../client'
import { longTasks } from '../schema'
import type { LongTask, LongTaskKind, LongTaskStatus, OptionalId } from '@sdns/core'
import { genId, insertRow, now, parseJsonObject, stringifyJson, updateRows } from './util'

type LongTaskRow = typeof longTasks.$inferSelect

function rowToEntity(row: LongTaskRow): LongTask {
  return {
    id: row.id,
    kind: row.kind as LongTaskKind,
    status: row.status as LongTaskStatus,
    title: row.title,
    taskType: row.taskType ?? undefined,
    projectId: row.projectId ?? undefined,
    adaptationProjectId: row.adaptationProjectId ?? undefined,
    episodeId: row.episodeId ?? undefined,
    sceneId: row.sceneId ?? undefined,
    shotId: row.shotId ?? undefined,
    relatedEntityId: row.relatedEntityId ?? undefined,
    input: parseJsonObject<Record<string, unknown>>(row.input, {}),
    output: parseJsonObject<Record<string, unknown>>(row.output, {}),
    errorMessage: row.errorMessage ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt ?? undefined,
    finishedAt: row.finishedAt ?? undefined,
  }
}

export function createLongTask(
  db: DB,
  data: Partial<OptionalId<LongTask>> & { kind: LongTaskKind; title: string },
): LongTask {
  const ts = now()
  const value: typeof longTasks.$inferInsert = {
    id: genId(),
    kind: data.kind,
    status: data.status ?? 'pending',
    title: data.title,
    taskType: data.taskType ?? null,
    projectId: data.projectId ?? null,
    adaptationProjectId: data.adaptationProjectId ?? null,
    episodeId: data.episodeId ?? null,
    sceneId: data.sceneId ?? null,
    shotId: data.shotId ?? null,
    relatedEntityId: data.relatedEntityId ?? null,
    input: data.input ? stringifyJson(data.input) : null,
    output: data.output ? stringifyJson(data.output) : null,
    errorMessage: data.errorMessage ?? null,
    createdAt: ts,
    updatedAt: ts,
    startedAt: data.startedAt ?? null,
    finishedAt: data.finishedAt ?? null,
  }
  const [row] = insertRow(db, longTasks, value)
  return rowToEntity(row as LongTaskRow)
}

export function getLongTask(db: DB, id: string): LongTask | undefined {
  const row = db.select().from(longTasks).where(eq(longTasks.id, id)).get()
  return row ? rowToEntity(row as LongTaskRow) : undefined
}

export function listLongTasks(db: DB, limit = 100): LongTask[] {
  return db
    .select()
    .from(longTasks)
    .orderBy(desc(longTasks.updatedAt))
    .limit(limit)
    .all()
    .map((row) => rowToEntity(row as LongTaskRow))
}

/**
 * 仅返回应用需要在启动时重新确认的未完成任务。
 *
 * 任务恢复不能依赖内存中的 AbortController；进程退出后，只有持久化状态才是可信来源。
 */
export function listIncompleteLongTasks(db: DB): LongTask[] {
  return db
    .select()
    .from(longTasks)
    .where(inArray(longTasks.status, ['pending', 'running']))
    .orderBy(desc(longTasks.updatedAt))
    .all()
    .map((row) => rowToEntity(row as LongTaskRow))
}

export function listLongTasksByProject(db: DB, projectId: string, limit = 100): LongTask[] {
  return db
    .select()
    .from(longTasks)
    .where(eq(longTasks.projectId, projectId))
    .orderBy(desc(longTasks.updatedAt))
    .limit(limit)
    .all()
    .map((row) => rowToEntity(row as LongTaskRow))
}

export function getLongTaskByRelatedEntity(
  db: DB,
  kind: LongTaskKind,
  relatedEntityId: string,
): LongTask | undefined {
  const row = db
    .select()
    .from(longTasks)
    .where(and(eq(longTasks.kind, kind), eq(longTasks.relatedEntityId, relatedEntityId)))
    .orderBy(desc(longTasks.updatedAt))
    .limit(1)
    .get()
  return row ? rowToEntity(row as LongTaskRow) : undefined
}

export function updateLongTask(db: DB, id: string, patch: Partial<LongTask>): LongTask | undefined {
  const fields: Record<string, unknown> = { ...patch, updatedAt: now() }
  if (fields.input && typeof fields.input === 'object') fields.input = stringifyJson(fields.input)
  if (fields.output && typeof fields.output === 'object') fields.output = stringifyJson(fields.output)
  const [row] = updateRows(db, longTasks, fields).where(eq(longTasks.id, id)).returning().all()
  return row ? rowToEntity(row as LongTaskRow) : undefined
}

export function markLongTaskRunning(db: DB, id: string): LongTask | undefined {
  return updateLongTask(db, id, { status: 'running', startedAt: now() })
}

export function finishLongTask(
  db: DB,
  id: string,
  status: Extract<LongTaskStatus, 'success' | 'failed' | 'canceled'>,
  patch: Partial<LongTask> = {},
): LongTask | undefined {
  return updateLongTask(db, id, { ...patch, status, finishedAt: now() })
}
