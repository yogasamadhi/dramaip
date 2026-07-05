// shot_reviews —— 镜头审查（ROADMAP v0.6 §3），每镜头一份，覆盖更新
import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import { shotReviews } from '../schema'
import type { ShotReview, OptionalId, AiVideoDifficulty } from '@sdns/core'
import { genId, now, parseJsonArray, stringifyArray, insertRow, updateRows } from './util'

type ReviewRow = typeof shotReviews.$inferSelect

function rowToEntity(row: ReviewRow): ShotReview {
  return {
    id: row.id,
    shotId: row.shotId,
    lengthScore: row.lengthScore,
    characterCountScore: row.characterCountScore,
    actionComplexityScore: row.actionComplexityScore,
    visualClarityScore: row.visualClarityScore,
    characterConsistencyScore: row.characterConsistencyScore,
    sceneContinuityScore: row.sceneContinuityScore,
    promptControllabilityScore: row.promptControllabilityScore,
    verticalSuitabilityScore: row.verticalSuitabilityScore,
    overallScore: row.overallScore,
    aiVideoDifficulty: row.aiVideoDifficulty as AiVideoDifficulty,
    issues: parseJsonArray(row.issues),
    suggestions: parseJsonArray(row.suggestions),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function getShotReview(db: DB, shotId: string): ShotReview | undefined {
  const row = db.select().from(shotReviews).where(eq(shotReviews.shotId, shotId)).get()
  return row ? rowToEntity(row as ReviewRow) : undefined
}

export function upsertShotReview(
  db: DB,
  data: Partial<OptionalId<ShotReview>> & { shotId: string; aiVideoDifficulty: AiVideoDifficulty },
): ShotReview {
  const existing = getShotReview(db, data.shotId)
  const fields: Record<string, unknown> = { ...data, updatedAt: now() }
  for (const k of ['issues', 'suggestions']) {
    if (Array.isArray(fields[k])) fields[k] = stringifyArray(fields[k] as string[])
  }
  if (existing) {
    const [row] = updateRows(db, shotReviews, fields).where(eq(shotReviews.id, existing.id)).returning().all()
    return row ? rowToEntity(row as ReviewRow) : existing
  }
  const ts = now()
  const value: typeof shotReviews.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    shotId: data.shotId,
    lengthScore: data.lengthScore ?? 0,
    characterCountScore: data.characterCountScore ?? 0,
    actionComplexityScore: data.actionComplexityScore ?? 0,
    visualClarityScore: data.visualClarityScore ?? 0,
    characterConsistencyScore: data.characterConsistencyScore ?? 0,
    sceneContinuityScore: data.sceneContinuityScore ?? 0,
    promptControllabilityScore: data.promptControllabilityScore ?? 0,
    verticalSuitabilityScore: data.verticalSuitabilityScore ?? 0,
    overallScore: data.overallScore ?? 0,
    aiVideoDifficulty: data.aiVideoDifficulty,
    issues: stringifyArray(data.issues),
    suggestions: stringifyArray(data.suggestions),
  }
  const [row] = insertRow(db, shotReviews, value)
  return rowToEntity(row as ReviewRow)
}

export function deleteShotReview(db: DB, id: string): void {
  db.delete(shotReviews).where(eq(shotReviews.id, id)).run()
}
