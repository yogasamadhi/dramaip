// ai_video_feasibility_reports —— AI 视频可行性（ROADMAP v0.3 §4）
import { and, eq } from 'drizzle-orm'
import type { DB } from '../client'
import { aiVideoFeasibilityReports } from '../schema'
import type { AiVideoFeasibilityReport, OptionalId } from '@sdns/core'
import { genId, now, parseJsonArray, stringifyArray, insertRow, updateRows } from './util'

type FeasibilityRow = typeof aiVideoFeasibilityReports.$inferSelect

function rowToEntity(row: FeasibilityRow): AiVideoFeasibilityReport {
  return {
    id: row.id,
    projectId: row.projectId,
    chapterId: row.chapterId,
    characterCountScore: row.characterCountScore,
    actionComplexityScore: row.actionComplexityScore,
    interactionDensityScore: row.interactionDensityScore,
    sceneStabilityScore: row.sceneStabilityScore,
    visualClarityScore: row.visualClarityScore,
    characterConsistencyScore: row.characterConsistencyScore,
    generatableScore: row.generatableScore,
    verticalSuitabilityScore: row.verticalSuitabilityScore,
    promptControllabilityScore: row.promptControllabilityScore,
    overallScore: row.overallScore,
    risks: parseJsonArray(row.risks),
    suggestions: parseJsonArray(row.suggestions),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listFeasibilityReports(db: DB, projectId: string): AiVideoFeasibilityReport[] {
  return db.select().from(aiVideoFeasibilityReports).where(eq(aiVideoFeasibilityReports.projectId, projectId)).orderBy(aiVideoFeasibilityReports.createdAt).all().map(rowToEntity)
}

export function getFeasibilityByChapter(db: DB, projectId: string, chapterId: string): AiVideoFeasibilityReport | undefined {
  const row = db
    .select()
    .from(aiVideoFeasibilityReports)
    .where(and(eq(aiVideoFeasibilityReports.projectId, projectId), eq(aiVideoFeasibilityReports.chapterId, chapterId)))
    .get()
  return row ? rowToEntity(row as FeasibilityRow) : undefined
}

export function createFeasibilityReport(
  db: DB,
  data: Partial<OptionalId<AiVideoFeasibilityReport>> & { projectId: string; chapterId: string },
): AiVideoFeasibilityReport {
  const ts = now()
  const value: typeof aiVideoFeasibilityReports.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    projectId: data.projectId,
    chapterId: data.chapterId,
    characterCountScore: data.characterCountScore ?? 0,
    actionComplexityScore: data.actionComplexityScore ?? 0,
    interactionDensityScore: data.interactionDensityScore ?? 0,
    sceneStabilityScore: data.sceneStabilityScore ?? 0,
    visualClarityScore: data.visualClarityScore ?? 0,
    characterConsistencyScore: data.characterConsistencyScore ?? 0,
    generatableScore: data.generatableScore ?? 0,
    verticalSuitabilityScore: data.verticalSuitabilityScore ?? 0,
    promptControllabilityScore: data.promptControllabilityScore ?? 0,
    overallScore: data.overallScore ?? 0,
    risks: stringifyArray(data.risks),
    suggestions: stringifyArray(data.suggestions),
  }
  const [row] = insertRow(db, aiVideoFeasibilityReports, value)
  return rowToEntity(row as FeasibilityRow)
}

export function upsertFeasibilityByChapter(
  db: DB,
  data: Partial<OptionalId<AiVideoFeasibilityReport>> & { projectId: string; chapterId: string },
): AiVideoFeasibilityReport {
  const existing = getFeasibilityByChapter(db, data.projectId, data.chapterId)
  if (existing) {
    const fields: Record<string, unknown> = { ...data, updatedAt: now() }
    if (Array.isArray(fields.risks)) fields.risks = stringifyArray(fields.risks as string[])
    if (Array.isArray(fields.suggestions)) fields.suggestions = stringifyArray(fields.suggestions as string[])
    const [row] = updateRows(db, aiVideoFeasibilityReports, fields).where(eq(aiVideoFeasibilityReports.id, existing.id)).returning().all()
    return row ? rowToEntity(row as FeasibilityRow) : existing
  }
  return createFeasibilityReport(db, data)
}

export function deleteFeasibilityReport(db: DB, id: string): void {
  db.delete(aiVideoFeasibilityReports).where(eq(aiVideoFeasibilityReports.id, id)).run()
}
