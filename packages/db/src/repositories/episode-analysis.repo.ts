// episode_analyses —— 前 10 集分析（ROADMAP v0.4 §5），按改编项目唯一
import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import { episodeAnalyses } from '../schema'
import type { EpisodeAnalysis, OptionalId } from '@sdns/core'
import { genId, now, insertRow, updateRows } from './util'

type AnalysisRow = typeof episodeAnalyses.$inferSelect

function numArr(v: string): number[] {
  try {
    const parsed = JSON.parse(v)
    return Array.isArray(parsed) ? parsed.map((n) => Number(n)).filter((n) => !Number.isNaN(n)) : []
  } catch {
    return []
  }
}
function strNumArr(v: number[] | undefined): string {
  return JSON.stringify(v ?? [])
}

function rowToEntity(row: AnalysisRow): EpisodeAnalysis {
  return {
    id: row.id,
    adaptationProjectId: row.adaptationProjectId,
    hookStrengthTrend: numArr(row.hookStrengthTrend),
    retentionScoreTrend: numArr(row.retentionScoreTrend),
    paceScoreTrend: numArr(row.paceScoreTrend),
    reversalDensityTrend: numArr(row.reversalDensityTrend),
    visualAppealTrend: numArr(row.visualAppealTrend),
    summary: row.summary,
    suggestions: row.suggestions ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function getEpisodeAnalysis(db: DB, adaptationProjectId: string): EpisodeAnalysis | undefined {
  const row = db
    .select()
    .from(episodeAnalyses)
    .where(eq(episodeAnalyses.adaptationProjectId, adaptationProjectId))
    .get()
  return row ? rowToEntity(row as AnalysisRow) : undefined
}

export function upsertEpisodeAnalysis(
  db: DB,
  data: Partial<OptionalId<EpisodeAnalysis>> & { adaptationProjectId: string; summary: string },
): EpisodeAnalysis {
  const existing = getEpisodeAnalysis(db, data.adaptationProjectId)
  const fields: Record<string, unknown> = { ...data, updatedAt: now() }
  for (const k of ['hookStrengthTrend', 'retentionScoreTrend', 'paceScoreTrend', 'reversalDensityTrend', 'visualAppealTrend']) {
    if (Array.isArray(fields[k])) fields[k] = strNumArr(fields[k] as number[])
  }
  if (existing) {
    const [row] = updateRows(db, episodeAnalyses, fields).where(eq(episodeAnalyses.id, existing.id)).returning().all()
    return row ? rowToEntity(row as AnalysisRow) : existing
  }
  const ts = now()
  const value: typeof episodeAnalyses.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    adaptationProjectId: data.adaptationProjectId,
    hookStrengthTrend: strNumArr(data.hookStrengthTrend),
    retentionScoreTrend: strNumArr(data.retentionScoreTrend),
    paceScoreTrend: strNumArr(data.paceScoreTrend),
    reversalDensityTrend: strNumArr(data.reversalDensityTrend),
    visualAppealTrend: strNumArr(data.visualAppealTrend),
    summary: data.summary,
    suggestions: data.suggestions ?? null,
  }
  const [row] = insertRow(db, episodeAnalyses, value)
  return rowToEntity(row as AnalysisRow)
}

export function deleteEpisodeAnalysis(db: DB, id: string): void {
  db.delete(episodeAnalyses).where(eq(episodeAnalyses.id, id)).run()
}
