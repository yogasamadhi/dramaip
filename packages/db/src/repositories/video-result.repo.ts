// video_results —— 视频生成结果（ROADMAP v0.7 §3），一个任务可有多个结果，支持「标记最佳」
import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import { videoResults } from '../schema'
import type { VideoResult, OptionalId } from '@sdns/core'
import { genId, now, insertRow, updateRows } from './util'

type ResultRow = typeof videoResults.$inferSelect

function rowToEntity(row: ResultRow): VideoResult {
  return {
    id: row.id,
    taskId: row.taskId,
    shotId: row.shotId ?? undefined,
    resultVideoUrl: row.resultVideoUrl,
    coverImageUrl: row.coverImageUrl ?? undefined,
    rawMeta: row.rawMeta ?? undefined,
    isBest: row.isBest,
    note: row.note ?? undefined,
    createdAt: row.createdAt,
  }
}

export function listVideoResultsByTask(db: DB, taskId: string): VideoResult[] {
  return db
    .select()
    .from(videoResults)
    .where(eq(videoResults.taskId, taskId))
    .orderBy(videoResults.createdAt)
    .all()
    .map((row) => rowToEntity(row as ResultRow))
}

export function listVideoResultsByShot(db: DB, shotId: string): VideoResult[] {
  return db
    .select()
    .from(videoResults)
    .where(eq(videoResults.shotId, shotId))
    .orderBy(videoResults.createdAt)
    .all()
    .map((row) => rowToEntity(row as ResultRow))
}

export function createVideoResult(
  db: DB,
  data: Partial<OptionalId<VideoResult>> & { taskId: string; resultVideoUrl: string },
): VideoResult {
  const value: typeof videoResults.$inferInsert = {
    id: genId(),
    createdAt: now(),
    taskId: data.taskId,
    shotId: data.shotId ?? null,
    resultVideoUrl: data.resultVideoUrl,
    coverImageUrl: data.coverImageUrl ?? null,
    rawMeta: data.rawMeta ?? null,
    isBest: data.isBest ?? false,
    note: data.note ?? null,
  }
  const [row] = insertRow(db, videoResults, value)
  return rowToEntity(row as ResultRow)
}

export function updateVideoResult(db: DB, id: string, patch: Partial<OptionalId<VideoResult>>): VideoResult | undefined {
  const [row] = updateRows(db, videoResults, patch).where(eq(videoResults.id, id)).returning().all()
  return row ? rowToEntity(row as ResultRow) : undefined
}

/**
 * 把某结果标记为本镜头最佳：先清除该镜头其它结果的 isBest，再置本条为最佳。
 * 若该结果没有 shotId，则仅置本条（无法保证镜头级唯一）。
 */
export function markBestVideoResult(db: DB, id: string): VideoResult | undefined {
  const target = db.select().from(videoResults).where(eq(videoResults.id, id)).get() as ResultRow | undefined
  if (!target) return undefined
  if (target.shotId) {
    // 清除同镜头其它结果的最佳标记
    updateRows(db, videoResults, { isBest: false })
      .where(eq(videoResults.shotId, target.shotId))
      .run()
  }
  const [row] = updateRows(db, videoResults, { isBest: true })
    .where(eq(videoResults.id, id))
    .returning()
    .all()
  return row ? rowToEntity(row as ResultRow) : undefined
}

export function deleteVideoResult(db: DB, id: string): void {
  db.delete(videoResults).where(eq(videoResults.id, id)).run()
}

/** 删除某任务下的所有结果（任务删除/重试前清理） */
export function deleteVideoResultsByTask(db: DB, taskId: string): void {
  db.delete(videoResults).where(eq(videoResults.taskId, taskId)).run()
}
