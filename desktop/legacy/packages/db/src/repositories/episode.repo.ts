// episodes —— 分集大纲（ROADMAP v0.4 §3）
import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import { episodes } from '../schema'
import type { Episode, OptionalId } from '@sdns/core'
import { genId, now, parseJsonArray, stringifyArray, insertRow, updateRows } from './util'

type EpisodeRow = typeof episodes.$inferSelect

function rowToEntity(row: EpisodeRow): Episode {
  return {
    id: row.id,
    adaptationProjectId: row.adaptationProjectId,
    episodeNumber: row.episodeNumber,
    title: row.title,
    summary: row.summary,
    hook: row.hook,
    mainConflict: row.mainConflict,
    reversal: row.reversal ?? undefined,
    emotionalBeat: row.emotionalBeat ?? undefined,
    cliffhanger: row.cliffhanger,
    aiVideoNote: row.aiVideoNote ?? undefined,
    keyVisuals: parseJsonArray(row.keyVisuals),
    relatedChapterIds: parseJsonArray(row.relatedChapterIds),
    relatedBeatIds: parseJsonArray(row.relatedBeatIds),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listEpisodes(db: DB, adaptationProjectId: string): Episode[] {
  return db
    .select()
    .from(episodes)
    .where(eq(episodes.adaptationProjectId, adaptationProjectId))
    .orderBy(episodes.episodeNumber)
    .all()
    .map(rowToEntity)
}

export function getEpisode(db: DB, id: string): Episode | undefined {
  const row = db.select().from(episodes).where(eq(episodes.id, id)).get()
  return row ? rowToEntity(row as EpisodeRow) : undefined
}

export function createEpisode(
  db: DB,
  data: Partial<OptionalId<Episode>> & {
    adaptationProjectId: string
    episodeNumber: number
    title: string
    summary: string
    hook: string
    mainConflict: string
    cliffhanger: string
  },
): Episode {
  const ts = now()
  const value: typeof episodes.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    adaptationProjectId: data.adaptationProjectId,
    episodeNumber: data.episodeNumber,
    title: data.title,
    summary: data.summary,
    hook: data.hook,
    mainConflict: data.mainConflict,
    reversal: data.reversal ?? null,
    emotionalBeat: data.emotionalBeat ?? null,
    cliffhanger: data.cliffhanger,
    aiVideoNote: data.aiVideoNote ?? null,
    keyVisuals: stringifyArray(data.keyVisuals),
    relatedChapterIds: stringifyArray(data.relatedChapterIds),
    relatedBeatIds: stringifyArray(data.relatedBeatIds),
  }
  const [row] = insertRow(db, episodes, value)
  return rowToEntity(row as EpisodeRow)
}

export function updateEpisode(db: DB, id: string, patch: Partial<OptionalId<Episode>>): Episode | undefined {
  const fields: Record<string, unknown> = { ...patch, updatedAt: now() }
  for (const k of ['keyVisuals', 'relatedChapterIds', 'relatedBeatIds']) {
    if (Array.isArray(fields[k])) fields[k] = stringifyArray(fields[k] as string[])
  }
  const [row] = updateRows(db, episodes, fields).where(eq(episodes.id, id)).returning().all()
  return row ? rowToEntity(row as EpisodeRow) : undefined
}

/** 重排：传入按顺序的 episode id 数组，按数组顺序重写 episodeNumber */
export function reorderEpisodes(db: DB, orderedIds: string[]): void {
  orderedIds.forEach((id, idx) => {
    updateRows(db, episodes, { episodeNumber: idx + 1, updatedAt: now() })
      .where(eq(episodes.id, id))
      .run()
  })
}

export function deleteEpisode(db: DB, id: string): void {
  db.delete(episodes).where(eq(episodes.id, id)).run()
}
