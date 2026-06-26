import { desc, eq } from 'drizzle-orm'
import type { DB } from '../client'
import { evaluations } from '../schema'
import type { Evaluation } from '@sdns/core'
import { genId, now, parseJsonArray, stringifyArray, insertRow } from './util'

type EvaluationRow = typeof evaluations.$inferSelect

function rowToEvaluation(row: EvaluationRow): Evaluation {
  return {
    id: row.id,
    projectId: row.projectId,
    chapterId: row.chapterId ?? undefined,
    totalScore: row.totalScore,
    hookScore: row.hookScore,
    conflictScore: row.conflictScore,
    reversalScore: row.reversalScore,
    emotionScore: row.emotionScore,
    visualizationScore: row.visualizationScore,
    aiVideoFeasibilityScore: row.aiVideoFeasibilityScore,
    characterConsistencyScore: row.characterConsistencyScore,
    shotClarityScore: row.shotClarityScore,
    cliffhangerScore: row.cliffhangerScore,
    adaptationDifficultyScore: row.adaptationDifficultyScore,
    issues: parseJsonArray(row.issues),
    suggestions: parseJsonArray(row.suggestions),
    rawResult: row.rawResult ?? undefined,
    createdAt: row.createdAt,
  }
}

export function listEvaluations(db: DB, projectId: string): Evaluation[] {
  return db
    .select()
    .from(evaluations)
    .where(eq(evaluations.projectId, projectId))
    .orderBy(desc(evaluations.createdAt))
    .all()
    .map(rowToEvaluation)
}

export function listEvaluationsByChapter(db: DB, chapterId: string): Evaluation[] {
  return db
    .select()
    .from(evaluations)
    .where(eq(evaluations.chapterId, chapterId))
    .orderBy(desc(evaluations.createdAt))
    .all()
    .map(rowToEvaluation)
}

export interface NewEvaluation {
  projectId: string
  chapterId?: string
  totalScore: number
  hookScore: number
  conflictScore: number
  reversalScore: number
  emotionScore: number
  visualizationScore: number
  aiVideoFeasibilityScore: number
  characterConsistencyScore: number
  shotClarityScore: number
  cliffhangerScore: number
  adaptationDifficultyScore: number
  issues?: string[]
  suggestions?: string[]
  rawResult?: string
}

export function createEvaluation(db: DB, data: NewEvaluation): Evaluation {
  const value: typeof evaluations.$inferInsert = {
    id: genId(),
    createdAt: now(),
    projectId: data.projectId,
    chapterId: data.chapterId ?? null,
    totalScore: data.totalScore,
    hookScore: data.hookScore,
    conflictScore: data.conflictScore,
    reversalScore: data.reversalScore,
    emotionScore: data.emotionScore,
    visualizationScore: data.visualizationScore,
    aiVideoFeasibilityScore: data.aiVideoFeasibilityScore,
    characterConsistencyScore: data.characterConsistencyScore,
    shotClarityScore: data.shotClarityScore,
    cliffhangerScore: data.cliffhangerScore,
    adaptationDifficultyScore: data.adaptationDifficultyScore,
    issues: stringifyArray(data.issues),
    suggestions: stringifyArray(data.suggestions),
    rawResult: data.rawResult ?? null,
  }
  const [row] = insertRow(db, evaluations, value)
  return rowToEvaluation(row as EvaluationRow)
}
