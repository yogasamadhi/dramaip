// shots —— 镜头（ROADMAP v0.6 §1），由场景拆分得到，是 AI 视频平台的最小生成单元
import { eq, and } from 'drizzle-orm'
import type { DB } from '../client'
import { shots, promptVersions } from '../schema'
import type { Shot, OptionalId } from '@sdns/core'
import { genId, now, parseJsonArray, stringifyArray, insertRow, updateRows } from './util'

type ShotRow = typeof shots.$inferSelect

function rowToEntity(row: ShotRow): Shot {
  return {
    id: row.id,
    sceneId: row.sceneId,
    episodeId: row.episodeId,
    shotNumber: row.shotNumber,
    durationSeconds: row.durationSeconds ?? undefined,
    visualDescription: row.visualDescription,
    characterIds: parseJsonArray(row.characterIds),
    dialogue: row.dialogue ?? undefined,
    narration: row.narration ?? undefined,
    cameraAngle: row.cameraAngle ?? undefined,
    cameraMovement: row.cameraMovement ?? undefined,
    emotion: row.emotion ?? undefined,
    action: row.action ?? undefined,
    videoPrompt: row.videoPrompt,
    negativePrompt: row.negativePrompt ?? undefined,
    imagePrompt: row.imagePrompt ?? undefined,
    consistencyNotes: row.consistencyNotes ?? undefined,
    aiVideoDifficulty: (row.aiVideoDifficulty as Shot['aiVideoDifficulty']) ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** 某场景下的所有镜头（按 shotNumber 升序） */
export function listShotsByScene(db: DB, sceneId: string): Shot[] {
  return db
    .select()
    .from(shots)
    .where(eq(shots.sceneId, sceneId))
    .orderBy(shots.shotNumber)
    .all()
    .map((row) => rowToEntity(row as ShotRow))
}

/** 某集下的所有镜头（跨场景，按 shotNumber 升序） */
export function listShotsByEpisode(db: DB, episodeId: string): Shot[] {
  return db
    .select()
    .from(shots)
    .where(eq(shots.episodeId, episodeId))
    .orderBy(shots.shotNumber)
    .all()
    .map((row) => rowToEntity(row as ShotRow))
}

export function getShot(db: DB, id: string): Shot | undefined {
  const row = db.select().from(shots).where(eq(shots.id, id)).get()
  return row ? rowToEntity(row as ShotRow) : undefined
}

export function createShot(
  db: DB,
  data: Partial<OptionalId<Shot>> & {
    sceneId: string
    episodeId: string
    shotNumber: number
    visualDescription: string
  },
): Shot {
  const ts = now()
  const value: typeof shots.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    sceneId: data.sceneId,
    episodeId: data.episodeId,
    shotNumber: data.shotNumber,
    durationSeconds: data.durationSeconds ?? null,
    visualDescription: data.visualDescription,
    characterIds: stringifyArray(data.characterIds),
    dialogue: data.dialogue ?? null,
    narration: data.narration ?? null,
    cameraAngle: data.cameraAngle ?? null,
    cameraMovement: data.cameraMovement ?? null,
    emotion: data.emotion ?? null,
    action: data.action ?? null,
    videoPrompt: data.videoPrompt ?? '',
    negativePrompt: data.negativePrompt ?? null,
    imagePrompt: data.imagePrompt ?? null,
    consistencyNotes: data.consistencyNotes ?? null,
    aiVideoDifficulty: (data.aiVideoDifficulty as typeof shots.$inferInsert.aiVideoDifficulty) ?? null,
  }
  const [row] = insertRow(db, shots, value)
  return rowToEntity(row as ShotRow)
}

export function updateShot(db: DB, id: string, patch: Partial<OptionalId<Shot>>): Shot | undefined {
  const fields: Record<string, unknown> = { ...patch, updatedAt: now() }
  if (Array.isArray(fields.characterIds)) fields.characterIds = stringifyArray(fields.characterIds as string[])
  const [row] = updateRows(db, shots, fields).where(eq(shots.id, id)).returning().all()
  return row ? rowToEntity(row as ShotRow) : undefined
}

/** 删除某场景下的所有镜头（重新拆分前清空） */
export function deleteShotsByScene(db: DB, sceneId: string): void {
  // 同时清掉这些镜头的 prompt 版本快照
  const rows = db.select({ id: shots.id }).from(shots).where(eq(shots.sceneId, sceneId)).all() as Array<{ id: string }>
  for (const r of rows) {
    db.delete(promptVersions).where(eq(promptVersions.shotId, r.id)).run()
  }
  db.delete(shots).where(eq(shots.sceneId, sceneId)).run()
}

export function deleteShot(db: DB, id: string): void {
  db.delete(promptVersions).where(eq(promptVersions.shotId, id)).run()
  db.delete(shots).where(eq(shots.id, id)).run()
}

// ---------------------------------------------------------------------------
// prompt_versions —— Prompt 版本快照（每次生成/改写追加一条）
// ---------------------------------------------------------------------------

type VersionRow = typeof promptVersions.$inferSelect

function versionRowToEntity(row: VersionRow) {
  return {
    id: row.id,
    shotId: row.shotId,
    version: row.version,
    taskType: row.taskType,
    videoPrompt: row.videoPrompt,
    negativePrompt: row.negativePrompt ?? undefined,
    imagePrompt: row.imagePrompt ?? undefined,
    note: row.note ?? undefined,
    createdAt: row.createdAt,
  }
}

/** 某镜头的 Prompt 版本历史（按版本号升序） */
export function listPromptVersions(db: DB, shotId: string) {
  return db
    .select()
    .from(promptVersions)
    .where(eq(promptVersions.shotId, shotId))
    .orderBy(promptVersions.version)
    .all()
    .map((row) => versionRowToEntity(row as VersionRow))
}

/** 当前最大版本号（用于递增），无记录返回 0 */
export function currentPromptVersion(db: DB, shotId: string): number {
  const rows = listPromptVersions(db, shotId)
  return rows.length ? rows[rows.length - 1].version : 0
}

/** 追加一条 Prompt 版本快照（version 自动 +1） */
export function appendPromptVersion(
  db: DB,
  data: {
    shotId: string
    taskType: string
    videoPrompt?: string
    negativePrompt?: string
    imagePrompt?: string
    note?: string
  },
) {
  const version = currentPromptVersion(db, data.shotId) + 1
  const value: typeof promptVersions.$inferInsert = {
    id: genId(),
    createdAt: now(),
    shotId: data.shotId,
    version,
    taskType: data.taskType,
    videoPrompt: data.videoPrompt ?? '',
    negativePrompt: data.negativePrompt ?? null,
    imagePrompt: data.imagePrompt ?? null,
    note: data.note ?? null,
  }
  const [row] = insertRow(db, promptVersions, value)
  return versionRowToEntity(row as VersionRow)
}

export function deletePromptVersionsByShot(db: DB, shotId: string): void {
  db.delete(promptVersions).where(and(eq(promptVersions.shotId, shotId))).run()
}
