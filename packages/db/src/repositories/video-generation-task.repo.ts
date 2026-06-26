// video_generation_tasks —— 视频生成任务（ROADMAP v0.7 §2），按镜头/集可有多条
import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import { videoGenerationTasks } from '../schema'
import type { VideoGenerationTask, VideoTaskStatus, OptionalId } from '@sdns/core'
import { genId, now, parseJsonArray, stringifyArray, insertRow, updateRows } from './util'

type TaskRow = typeof videoGenerationTasks.$inferSelect

function rowToEntity(row: TaskRow): VideoGenerationTask {
  return {
    id: row.id,
    projectId: row.projectId ?? undefined,
    episodeId: row.episodeId ?? undefined,
    sceneId: row.sceneId ?? undefined,
    shotId: row.shotId ?? undefined,
    provider: row.provider,
    model: row.model,
    prompt: row.prompt,
    negativePrompt: row.negativePrompt ?? undefined,
    referenceImageUrls: parseJsonArray(row.referenceImageUrls),
    status: row.status as VideoTaskStatus,
    remoteTaskId: row.remoteTaskId ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    note: row.note ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listVideoTasks(db: DB): VideoGenerationTask[] {
  return db
    .select()
    .from(videoGenerationTasks)
    .orderBy(videoGenerationTasks.createdAt)
    .all()
    .map((row) => rowToEntity(row as TaskRow))
}

export function listVideoTasksByShot(db: DB, shotId: string): VideoGenerationTask[] {
  return db
    .select()
    .from(videoGenerationTasks)
    .where(eq(videoGenerationTasks.shotId, shotId))
    .orderBy(videoGenerationTasks.createdAt)
    .all()
    .map((row) => rowToEntity(row as TaskRow))
}

export function listVideoTasksByEpisode(db: DB, episodeId: string): VideoGenerationTask[] {
  return db
    .select()
    .from(videoGenerationTasks)
    .where(eq(videoGenerationTasks.episodeId, episodeId))
    .orderBy(videoGenerationTasks.createdAt)
    .all()
    .map((row) => rowToEntity(row as TaskRow))
}

export function getVideoTask(db: DB, id: string): VideoGenerationTask | undefined {
  const row = db.select().from(videoGenerationTasks).where(eq(videoGenerationTasks.id, id)).get()
  return row ? rowToEntity(row as TaskRow) : undefined
}

export function createVideoTask(
  db: DB,
  data: Partial<OptionalId<VideoGenerationTask>> & { provider: string; model: string },
): VideoGenerationTask {
  const ts = now()
  const value: typeof videoGenerationTasks.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    projectId: data.projectId ?? null,
    episodeId: data.episodeId ?? null,
    sceneId: data.sceneId ?? null,
    shotId: data.shotId ?? null,
    provider: data.provider,
    model: data.model,
    prompt: data.prompt ?? '',
    negativePrompt: data.negativePrompt ?? null,
    referenceImageUrls: stringifyArray(data.referenceImageUrls),
    status: (data.status as typeof videoGenerationTasks.$inferInsert.status) ?? 'pending',
    remoteTaskId: data.remoteTaskId ?? null,
    errorMessage: data.errorMessage ?? null,
    note: data.note ?? null,
  }
  const [row] = insertRow(db, videoGenerationTasks, value)
  return rowToEntity(row as TaskRow)
}

export function updateVideoTask(
  db: DB,
  id: string,
  patch: Partial<OptionalId<VideoGenerationTask>>,
): VideoGenerationTask | undefined {
  const fields: Record<string, unknown> = { ...patch, updatedAt: now() }
  if (Array.isArray(fields.referenceImageUrls)) {
    fields.referenceImageUrls = stringifyArray(fields.referenceImageUrls as string[])
  }
  const [row] = updateRows(db, videoGenerationTasks, fields)
    .where(eq(videoGenerationTasks.id, id))
    .returning()
    .all()
  return row ? rowToEntity(row as TaskRow) : undefined
}

export function deleteVideoTask(db: DB, id: string): void {
  db.delete(videoGenerationTasks).where(eq(videoGenerationTasks.id, id)).run()
}
