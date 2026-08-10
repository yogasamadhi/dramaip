// scripts —— AI 短剧剧本（ROADMAP v0.5 §1），每集一份，按 episodeId 唯一
import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import { scripts } from '../schema'
import type { Script, OptionalId } from '@sdns/core'
import { genId, now, insertRow, updateRows } from './util'

type ScriptRow = typeof scripts.$inferSelect

function rowToEntity(row: ScriptRow): Script {
  return {
    id: row.id,
    adaptationProjectId: row.adaptationProjectId,
    episodeId: row.episodeId,
    episodeNumber: row.episodeNumber,
    title: row.title,
    content: row.content,
    hook: row.hook ?? undefined,
    mainConflict: row.mainConflict ?? undefined,
    emotionalBeat: row.emotionalBeat ?? undefined,
    reversal: row.reversal ?? undefined,
    cliffhanger: row.cliffhanger ?? undefined,
    estimatedDuration: row.estimatedDuration ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** 列出某改编项目下所有剧本（按集数升序） */
export function listScripts(db: DB, adaptationProjectId: string): Script[] {
  return db
    .select()
    .from(scripts)
    .where(eq(scripts.adaptationProjectId, adaptationProjectId))
    .orderBy(scripts.episodeNumber)
    .all()
    .map((row) => rowToEntity(row as ScriptRow))
}

export function getScript(db: DB, id: string): Script | undefined {
  const row = db.select().from(scripts).where(eq(scripts.id, id)).get()
  return row ? rowToEntity(row as ScriptRow) : undefined
}

/** 某集分集大纲对应的剧本（每集一份） */
export function getScriptByEpisode(db: DB, episodeId: string): Script | undefined {
  const row = db.select().from(scripts).where(eq(scripts.episodeId, episodeId)).get()
  return row ? rowToEntity(row as ScriptRow) : undefined
}

export function createScript(
  db: DB,
  data: Partial<OptionalId<Script>> & {
    adaptationProjectId: string
    episodeId: string
    episodeNumber: number
    title: string
    content: string
  },
): Script {
  const ts = now()
  const value: typeof scripts.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    adaptationProjectId: data.adaptationProjectId,
    episodeId: data.episodeId,
    episodeNumber: data.episodeNumber,
    title: data.title,
    content: data.content,
    hook: data.hook ?? null,
    mainConflict: data.mainConflict ?? null,
    emotionalBeat: data.emotionalBeat ?? null,
    reversal: data.reversal ?? null,
    cliffhanger: data.cliffhanger ?? null,
    estimatedDuration: data.estimatedDuration ?? null,
  }
  const [row] = insertRow(db, scripts, value)
  return rowToEntity(row as ScriptRow)
}

export function updateScript(db: DB, id: string, patch: Partial<OptionalId<Script>>): Script | undefined {
  const [row] = updateRows(db, scripts, { ...patch, updatedAt: now() })
    .where(eq(scripts.id, id))
    .returning()
    .all()
  return row ? rowToEntity(row as ScriptRow) : undefined
}

/** 仅更新剧本正文（编辑器保存） */
export function updateScriptContent(db: DB, id: string, content: string): Script | undefined {
  return updateScript(db, id, { content })
}

/** 按集 upsert：存在则更新全字段，否则新建。用于 AI 生成后落库与「预览后落库」。 */
export function upsertScriptByEpisode(
  db: DB,
  data: Partial<OptionalId<Script>> & {
    adaptationProjectId: string
    episodeId: string
    episodeNumber: number
    title: string
    content: string
  },
): Script {
  const existing = getScriptByEpisode(db, data.episodeId)
  if (existing) {
    const updated = updateScript(db, existing.id, {
      title: data.title,
      content: data.content,
      hook: data.hook,
      mainConflict: data.mainConflict,
      emotionalBeat: data.emotionalBeat,
      reversal: data.reversal,
      cliffhanger: data.cliffhanger,
      estimatedDuration: data.estimatedDuration,
    })
    return updated ?? existing
  }
  return createScript(db, data)
}

export function deleteScript(db: DB, id: string): void {
  db.delete(scripts).where(eq(scripts.id, id)).run()
}
