// scenes —— 剧本场景（ROADMAP v0.5 §2），由剧本拆分得到
import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import { scenes, shots, promptVersions, shotReviews } from '../schema'
import type { Scene, OptionalId } from '@sdns/core'
import { genId, now, parseJsonArray, stringifyArray, insertRow, updateRows } from './util'

type SceneRow = typeof scenes.$inferSelect

function rowToEntity(row: SceneRow): Scene {
  return {
    id: row.id,
    scriptId: row.scriptId,
    episodeId: row.episodeId,
    sceneNumber: row.sceneNumber,
    title: row.title,
    location: row.location,
    timeOfDay: row.timeOfDay ?? undefined,
    visualDescription: row.visualDescription,
    characters: parseJsonArray(row.characters),
    summary: row.summary,
    orderIndex: row.orderIndex,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** 某剧本下的所有场景（按 orderIndex 升序） */
export function listScenesByScript(db: DB, scriptId: string): Scene[] {
  return db
    .select()
    .from(scenes)
    .where(eq(scenes.scriptId, scriptId))
    .orderBy(scenes.orderIndex)
    .all()
    .map((row) => rowToEntity(row as SceneRow))
}

export function getScene(db: DB, id: string): Scene | undefined {
  const row = db.select().from(scenes).where(eq(scenes.id, id)).get()
  return row ? rowToEntity(row as SceneRow) : undefined
}

export function createScene(
  db: DB,
  data: Partial<OptionalId<Scene>> & {
    scriptId: string
    episodeId: string
    sceneNumber: number
    title: string
    location: string
    summary: string
  },
): Scene {
  const ts = now()
  const value: typeof scenes.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    scriptId: data.scriptId,
    episodeId: data.episodeId,
    sceneNumber: data.sceneNumber,
    title: data.title,
    location: data.location,
    timeOfDay: data.timeOfDay ?? null,
    visualDescription: data.visualDescription ?? '',
    characters: stringifyArray(data.characters),
    summary: data.summary,
    orderIndex: data.orderIndex ?? 0,
  }
  const [row] = insertRow(db, scenes, value)
  return rowToEntity(row as SceneRow)
}

export function updateScene(db: DB, id: string, patch: Partial<OptionalId<Scene>>): Scene | undefined {
  const fields: Record<string, unknown> = { ...patch, updatedAt: now() }
  if (Array.isArray(fields.characters)) fields.characters = stringifyArray(fields.characters as string[])
  const [row] = updateRows(db, scenes, fields).where(eq(scenes.id, id)).returning().all()
  return row ? rowToEntity(row as SceneRow) : undefined
}

/** 删除某剧本下的所有场景（重新拆分前清空），级联其镜头/审查/版本 */
export function deleteScenesByScript(db: DB, scriptId: string): void {
  const sceneRows = db.select({ id: scenes.id }).from(scenes).where(eq(scenes.scriptId, scriptId)).all() as Array<{ id: string }>
  for (const s of sceneRows) deleteSceneCascade(db, s.id)
  db.delete(scenes).where(eq(scenes.scriptId, scriptId)).run()
}

/** 删除单个场景，级联其镜头（含镜头的审查与 Prompt 版本） */
export function deleteScene(db: DB, id: string): void {
  deleteSceneCascade(db, id)
  db.delete(scenes).where(eq(scenes.id, id)).run()
}

/** 清理某场景下的镜头及其审查/Prompt 版本（不删场景本身） */
function deleteSceneCascade(db: DB, sceneId: string): void {
  const shotRows = db.select({ id: shots.id }).from(shots).where(eq(shots.sceneId, sceneId)).all() as Array<{ id: string }>
  for (const sh of shotRows) {
    db.delete(promptVersions).where(eq(promptVersions.shotId, sh.id)).run()
    db.delete(shotReviews).where(eq(shotReviews.shotId, sh.id)).run()
  }
  db.delete(shots).where(eq(shots.sceneId, sceneId)).run()
}
