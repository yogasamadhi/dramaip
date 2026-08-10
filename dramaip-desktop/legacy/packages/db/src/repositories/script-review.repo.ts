// script_reviews —— 剧本审稿（ROADMAP v0.5 §4），每集剧本一份，覆盖更新
import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import { scriptReviews } from '../schema'
import type { ScriptReview, OptionalId } from '@sdns/core'
import { genId, now, parseJsonArray, stringifyArray, insertRow, updateRows } from './util'

type ReviewRow = typeof scriptReviews.$inferSelect

function rowToEntity(row: ReviewRow): ScriptReview {
  return {
    id: row.id,
    scriptId: row.scriptId,
    hookStrengthScore: row.hookStrengthScore,
    dialogueScore: row.dialogueScore,
    conflictScore: row.conflictScore,
    visualClarityScore: row.visualClarityScore,
    sceneClarityScore: row.sceneClarityScore,
    characterFitScore: row.characterFitScore,
    shotReadinessScore: row.shotReadinessScore,
    aiVideoFeasibilityScore: row.aiVideoFeasibilityScore,
    cliffhangerScore: row.cliffhangerScore,
    overallScore: row.overallScore,
    issues: parseJsonArray(row.issues),
    suggestions: parseJsonArray(row.suggestions),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function getScriptReview(db: DB, scriptId: string): ScriptReview | undefined {
  const row = db
    .select()
    .from(scriptReviews)
    .where(eq(scriptReviews.scriptId, scriptId))
    .get()
  return row ? rowToEntity(row as ReviewRow) : undefined
}

export function upsertScriptReview(
  db: DB,
  data: Partial<OptionalId<ScriptReview>> & { scriptId: string },
): ScriptReview {
  const existing = getScriptReview(db, data.scriptId)
  const fields: Record<string, unknown> = { ...data, updatedAt: now() }
  for (const k of ['issues', 'suggestions']) {
    if (Array.isArray(fields[k])) fields[k] = stringifyArray(fields[k] as string[])
  }
  if (existing) {
    const [row] = updateRows(db, scriptReviews, fields)
      .where(eq(scriptReviews.id, existing.id))
      .returning()
      .all()
    return row ? rowToEntity(row as ReviewRow) : existing
  }
  const ts = now()
  const value: typeof scriptReviews.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    scriptId: data.scriptId,
    hookStrengthScore: data.hookStrengthScore ?? 0,
    dialogueScore: data.dialogueScore ?? 0,
    conflictScore: data.conflictScore ?? 0,
    visualClarityScore: data.visualClarityScore ?? 0,
    sceneClarityScore: data.sceneClarityScore ?? 0,
    characterFitScore: data.characterFitScore ?? 0,
    shotReadinessScore: data.shotReadinessScore ?? 0,
    aiVideoFeasibilityScore: data.aiVideoFeasibilityScore ?? 0,
    cliffhangerScore: data.cliffhangerScore ?? 0,
    overallScore: data.overallScore ?? 0,
    issues: stringifyArray(data.issues),
    suggestions: stringifyArray(data.suggestions),
  }
  const [row] = insertRow(db, scriptReviews, value)
  return rowToEntity(row as ReviewRow)
}

export function deleteScriptReview(db: DB, id: string): void {
  db.delete(scriptReviews).where(eq(scriptReviews.id, id)).run()
}
