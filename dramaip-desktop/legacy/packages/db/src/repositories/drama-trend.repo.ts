// drama_trend_reports —— 全书 AI 短剧适配趋势（ROADMAP v0.3 §1）
import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import { dramaTrendReports } from '../schema'
import type { DramaTrendReport, OptionalId } from '@sdns/core'
import { genId, now, insertRow, updateRows } from './util'

type TrendRow = typeof dramaTrendReports.$inferSelect

/** JSON text → number[]（趋势点） */
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

function rowToEntity(row: TrendRow): DramaTrendReport {
  return {
    id: row.id,
    projectId: row.projectId,
    hookTrend: numArr(row.hookTrend),
    conflictTrend: numArr(row.conflictTrend),
    reversalTrend: numArr(row.reversalTrend),
    emotionTrend: numArr(row.emotionTrend),
    cliffhangerTrend: numArr(row.cliffhangerTrend),
    visualizationTrend: numArr(row.visualizationTrend),
    aiVideoFeasibilityTrend: numArr(row.aiVideoFeasibilityTrend),
    characterConsistencyTrend: numArr(row.characterConsistencyTrend),
    shotClarityTrend: numArr(row.shotClarityTrend),
    overallTrend: numArr(row.overallTrend),
    summary: row.summary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function getDramaTrend(db: DB, projectId: string): DramaTrendReport | undefined {
  const row = db.select().from(dramaTrendReports).where(eq(dramaTrendReports.projectId, projectId)).get()
  return row ? rowToEntity(row as TrendRow) : undefined
}

export function upsertDramaTrend(
  db: DB,
  data: Partial<OptionalId<DramaTrendReport>> & { projectId: string; summary: string },
): DramaTrendReport {
  const existing = getDramaTrend(db, data.projectId)
  const fields: Record<string, unknown> = { ...data, updatedAt: now() }
  for (const k of [
    'hookTrend',
    'conflictTrend',
    'reversalTrend',
    'emotionTrend',
    'cliffhangerTrend',
    'visualizationTrend',
    'aiVideoFeasibilityTrend',
    'characterConsistencyTrend',
    'shotClarityTrend',
    'overallTrend',
  ]) {
    if (Array.isArray(fields[k])) fields[k] = strNumArr(fields[k] as number[])
  }
  if (existing) {
    const [row] = updateRows(db, dramaTrendReports, fields).where(eq(dramaTrendReports.id, existing.id)).returning().all()
    return row ? rowToEntity(row as TrendRow) : existing
  }
  const ts = now()
  const value: typeof dramaTrendReports.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    projectId: data.projectId,
    hookTrend: strNumArr(data.hookTrend),
    conflictTrend: strNumArr(data.conflictTrend),
    reversalTrend: strNumArr(data.reversalTrend),
    emotionTrend: strNumArr(data.emotionTrend),
    cliffhangerTrend: strNumArr(data.cliffhangerTrend),
    visualizationTrend: strNumArr(data.visualizationTrend),
    aiVideoFeasibilityTrend: strNumArr(data.aiVideoFeasibilityTrend),
    characterConsistencyTrend: strNumArr(data.characterConsistencyTrend),
    shotClarityTrend: strNumArr(data.shotClarityTrend),
    overallTrend: strNumArr(data.overallTrend),
    summary: data.summary,
  }
  const [row] = insertRow(db, dramaTrendReports, value)
  return rowToEntity(row as TrendRow)
}

export function deleteDramaTrend(db: DB, id: string): void {
  db.delete(dramaTrendReports).where(eq(dramaTrendReports.id, id)).run()
}
