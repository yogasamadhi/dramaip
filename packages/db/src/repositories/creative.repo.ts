// creative.repo —— v1.1 创意诊断与反套路迭代系统
import { and, desc, eq } from 'drizzle-orm'
import type { DB } from '../client'
import {
  antiTropeVariants,
  audienceSimulations,
  contentVersions,
  creativeCaseStudies,
  freshnessReports,
  narrativeCurveReports,
  qualityGateReports,
  revisionTasks,
  workflowRuns,
} from '../schema'
import type {
  AntiTropeVariant,
  AudienceSimulation,
  ContentVersion,
  CreativeCaseStudy,
  FreshnessReport,
  NarrativeCurveReport,
  OptionalId,
  QualityGateReport,
  RevisionTask,
  RevisionTaskBenefit,
  WorkflowRun,
  WorkflowRunStep,
} from '@sdns/core'
import {
  genId,
  insertRow,
  normalizeStringArrayPatch,
  now,
  parseJsonArray,
  parseJsonObject,
  stringifyArray,
  stringifyJson,
  updateRows,
} from './util'

type CaseStudyRow = typeof creativeCaseStudies.$inferSelect
type FreshnessRow = typeof freshnessReports.$inferSelect
type AntiTropeRow = typeof antiTropeVariants.$inferSelect
type RevisionTaskRow = typeof revisionTasks.$inferSelect
type ContentVersionRow = typeof contentVersions.$inferSelect
type QualityGateRow = typeof qualityGateReports.$inferSelect
type AudienceRow = typeof audienceSimulations.$inferSelect
type CurveRow = typeof narrativeCurveReports.$inferSelect
type WorkflowRow = typeof workflowRuns.$inferSelect

const emptyBenefit: RevisionTaskBenefit = { retention: 0, freshness: 0, visual: 0, cost: 0 }

function numberArray(v: string | null | undefined): number[] {
  if (!v) return []
  try {
    const parsed = JSON.parse(v)
    return Array.isArray(parsed) ? parsed.map((n) => Number(n)).filter((n) => !Number.isNaN(n)) : []
  } catch {
    return []
  }
}

function stringifyNumberArray(v: number[] | undefined): string {
  return JSON.stringify(v ?? [])
}

function caseStudyFromRow(row: CaseStudyRow): CreativeCaseStudy {
  return {
    id: row.id,
    title: row.title,
    sourceType: row.sourceType ?? undefined,
    genre: row.genre ?? undefined,
    summary: row.summary ?? undefined,
    relationshipPatterns: parseJsonArray(row.relationshipPatterns),
    openingHooks: parseJsonArray(row.openingHooks),
    highlightBeats: parseJsonArray(row.highlightBeats),
    reversalMechanisms: parseJsonArray(row.reversalMechanisms),
    cliffhangers: parseJsonArray(row.cliffhangers),
    visualPatterns: parseJsonArray(row.visualPatterns),
    riskTags: parseJsonArray(row.riskTags),
    notes: row.notes ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function freshnessFromRow(row: FreshnessRow): FreshnessReport {
  return {
    id: row.id,
    projectId: row.projectId ?? undefined,
    targetKind: row.targetKind as FreshnessReport['targetKind'],
    targetId: row.targetId ?? undefined,
    targetTitle: row.targetTitle ?? undefined,
    originalityScore: row.originalityScore,
    predictabilityScore: row.predictabilityScore,
    tropeRiskScore: row.tropeRiskScore,
    characterFreshnessScore: row.characterFreshnessScore,
    conflictFreshnessScore: row.conflictFreshnessScore,
    reversalFreshnessScore: row.reversalFreshnessScore,
    emotionalFreshnessScore: row.emotionalFreshnessScore,
    overallScore: row.overallScore,
    clicheSignals: parseJsonArray(row.clicheSignals),
    audiencePredictionPoints: parseJsonArray(row.audiencePredictionPoints),
    suggestions: parseJsonArray(row.suggestions),
    rawResult: row.rawResult ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function antiTropeFromRow(row: AntiTropeRow): AntiTropeVariant {
  return {
    id: row.id,
    projectId: row.projectId ?? undefined,
    targetKind: row.targetKind as AntiTropeVariant['targetKind'],
    targetId: row.targetId ?? undefined,
    mode: row.mode as AntiTropeVariant['mode'],
    title: row.title,
    premise: row.premise,
    pressureMechanism: row.pressureMechanism,
    preservedPayoffs: parseJsonArray(row.preservedPayoffs),
    keyChanges: parseJsonArray(row.keyChanges),
    risks: parseJsonArray(row.risks),
    sampleRewrite: row.sampleRewrite ?? undefined,
    createdAt: row.createdAt,
  }
}

function revisionTaskFromRow(row: RevisionTaskRow): RevisionTask {
  return {
    id: row.id,
    projectId: row.projectId ?? undefined,
    targetKind: row.targetKind as RevisionTask['targetKind'],
    targetId: row.targetId ?? undefined,
    sourceReportId: row.sourceReportId ?? undefined,
    title: row.title,
    description: row.description,
    priority: row.priority as RevisionTask['priority'],
    status: row.status as RevisionTask['status'],
    suggestedAction: row.suggestedAction,
    expectedBenefit: parseJsonObject<Record<string, unknown>>(row.expectedBenefit, emptyBenefit as unknown as Record<string, unknown>) as unknown as RevisionTaskBenefit,
    appliedVersionId: row.appliedVersionId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function contentVersionFromRow(row: ContentVersionRow): ContentVersion {
  return {
    id: row.id,
    projectId: row.projectId ?? undefined,
    targetKind: row.targetKind as ContentVersion['targetKind'],
    targetId: row.targetId,
    label: row.label,
    source: row.source as ContentVersion['source'],
    content: row.content,
    meta: parseJsonObject<Record<string, unknown>>(row.meta, {}),
    createdAt: row.createdAt,
  }
}

function qualityGateFromRow(row: QualityGateRow): QualityGateReport {
  return {
    id: row.id,
    projectId: row.projectId ?? undefined,
    adaptationProjectId: row.adaptationProjectId ?? undefined,
    targetKind: row.targetKind as QualityGateReport['targetKind'],
    targetId: row.targetId ?? undefined,
    stage: row.stage as QualityGateReport['stage'],
    score: row.score,
    verdict: row.verdict as QualityGateReport['verdict'],
    blockingIssues: parseJsonArray(row.blockingIssues),
    warnings: parseJsonArray(row.warnings),
    suggestions: parseJsonArray(row.suggestions),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function audienceFromRow(row: AudienceRow): AudienceSimulation {
  return {
    id: row.id,
    projectId: row.projectId ?? undefined,
    targetKind: row.targetKind as AudienceSimulation['targetKind'],
    targetId: row.targetId ?? undefined,
    audienceProfile: row.audienceProfile,
    retentionScore: row.retentionScore,
    emotionalEngagementScore: row.emotionalEngagementScore,
    noveltyScore: row.noveltyScore,
    likelyDropOffPoints: parseJsonArray(row.likelyDropOffPoints),
    mostMemorableMoments: parseJsonArray(row.mostMemorableMoments),
    complaints: parseJsonArray(row.complaints),
    shareableClips: parseJsonArray(row.shareableClips),
    summary: row.summary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function curveFromRow(row: CurveRow): NarrativeCurveReport {
  return {
    id: row.id,
    projectId: row.projectId ?? undefined,
    adaptationProjectId: row.adaptationProjectId ?? undefined,
    targetKind: row.targetKind as NarrativeCurveReport['targetKind'],
    targetId: row.targetId ?? undefined,
    hookCurve: numberArray(row.hookCurve),
    conflictCurve: numberArray(row.conflictCurve),
    reversalCurve: numberArray(row.reversalCurve),
    emotionCurve: numberArray(row.emotionCurve),
    cliffhangerCurve: numberArray(row.cliffhangerCurve),
    freshnessCurve: numberArray(row.freshnessCurve),
    summary: row.summary,
    weakSpots: parseJsonArray(row.weakSpots),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function workflowFromRow(row: WorkflowRow): WorkflowRun {
  return {
    id: row.id,
    projectId: row.projectId ?? undefined,
    adaptationProjectId: row.adaptationProjectId ?? undefined,
    templateKey: row.templateKey,
    title: row.title,
    status: row.status as WorkflowRun['status'],
    currentStep: row.currentStep ?? undefined,
    steps: parseJsonObject<{ steps: WorkflowRunStep[] }>(row.steps, { steps: [] }).steps,
    errorMessage: row.errorMessage ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function targetWhere<T extends { targetKind: unknown; targetId: unknown }>(
  table: T,
  targetKind: string,
  targetId?: string,
) {
  return targetId ? and(eq(table.targetKind as never, targetKind), eq(table.targetId as never, targetId)) : eq(table.targetKind as never, targetKind)
}

export function listCaseStudies(db: DB): CreativeCaseStudy[] {
  return db.select().from(creativeCaseStudies).orderBy(desc(creativeCaseStudies.updatedAt)).all().map((r) => caseStudyFromRow(r as CaseStudyRow))
}

export function createCaseStudy(db: DB, data: Partial<OptionalId<CreativeCaseStudy>> & { title: string }): CreativeCaseStudy {
  const ts = now()
  const value: typeof creativeCaseStudies.$inferInsert = {
    id: genId(),
    title: data.title,
    sourceType: data.sourceType ?? null,
    genre: data.genre ?? null,
    summary: data.summary ?? null,
    relationshipPatterns: stringifyArray(data.relationshipPatterns),
    openingHooks: stringifyArray(data.openingHooks),
    highlightBeats: stringifyArray(data.highlightBeats),
    reversalMechanisms: stringifyArray(data.reversalMechanisms),
    cliffhangers: stringifyArray(data.cliffhangers),
    visualPatterns: stringifyArray(data.visualPatterns),
    riskTags: stringifyArray(data.riskTags),
    notes: data.notes ?? null,
    createdAt: ts,
    updatedAt: ts,
  }
  const [row] = insertRow(db, creativeCaseStudies, value)
  return caseStudyFromRow(row as CaseStudyRow)
}

export function updateCaseStudy(db: DB, id: string, patch: Partial<CreativeCaseStudy>): CreativeCaseStudy | undefined {
  const fields = normalizeStringArrayPatch({ ...patch, updatedAt: now() }, [
    'relationshipPatterns',
    'openingHooks',
    'highlightBeats',
    'reversalMechanisms',
    'cliffhangers',
    'visualPatterns',
    'riskTags',
  ])
  const [row] = updateRows(db, creativeCaseStudies, fields as Partial<typeof creativeCaseStudies.$inferInsert>).where(eq(creativeCaseStudies.id, id)).returning().all()
  return row ? caseStudyFromRow(row as CaseStudyRow) : undefined
}

export function deleteCaseStudy(db: DB, id: string): void {
  db.delete(creativeCaseStudies).where(eq(creativeCaseStudies.id, id)).run()
}

export function listFreshnessReports(db: DB, projectId?: string): FreshnessReport[] {
  const q = db.select().from(freshnessReports)
  const rows = projectId ? q.where(eq(freshnessReports.projectId, projectId)).orderBy(desc(freshnessReports.createdAt)).all() : q.orderBy(desc(freshnessReports.createdAt)).all()
  return rows.map((r) => freshnessFromRow(r as FreshnessRow))
}

export function listFreshnessReportsByTarget(db: DB, targetKind: string, targetId?: string): FreshnessReport[] {
  return db
    .select()
    .from(freshnessReports)
    .where(targetWhere(freshnessReports, targetKind, targetId))
    .orderBy(desc(freshnessReports.createdAt))
    .all()
    .map((r) => freshnessFromRow(r as FreshnessRow))
}

export function createFreshnessReport(
  db: DB,
  data: Partial<OptionalId<FreshnessReport>> & { targetKind: FreshnessReport['targetKind']; overallScore: number },
): FreshnessReport {
  const ts = now()
  const value: typeof freshnessReports.$inferInsert = {
    id: genId(),
    projectId: data.projectId ?? null,
    targetKind: data.targetKind,
    targetId: data.targetId ?? null,
    targetTitle: data.targetTitle ?? null,
    originalityScore: data.originalityScore ?? 0,
    predictabilityScore: data.predictabilityScore ?? 0,
    tropeRiskScore: data.tropeRiskScore ?? 0,
    characterFreshnessScore: data.characterFreshnessScore ?? 0,
    conflictFreshnessScore: data.conflictFreshnessScore ?? 0,
    reversalFreshnessScore: data.reversalFreshnessScore ?? 0,
    emotionalFreshnessScore: data.emotionalFreshnessScore ?? 0,
    overallScore: data.overallScore,
    clicheSignals: stringifyArray(data.clicheSignals),
    audiencePredictionPoints: stringifyArray(data.audiencePredictionPoints),
    suggestions: stringifyArray(data.suggestions),
    rawResult: data.rawResult ?? null,
    createdAt: ts,
    updatedAt: ts,
  }
  const [row] = insertRow(db, freshnessReports, value)
  return freshnessFromRow(row as FreshnessRow)
}

export function listAntiTropeVariantsByTarget(db: DB, targetKind: string, targetId?: string): AntiTropeVariant[] {
  return db
    .select()
    .from(antiTropeVariants)
    .where(targetWhere(antiTropeVariants, targetKind, targetId))
    .orderBy(desc(antiTropeVariants.createdAt))
    .all()
    .map((r) => antiTropeFromRow(r as AntiTropeRow))
}

export function createAntiTropeVariant(
  db: DB,
  data: Partial<OptionalId<AntiTropeVariant>> & { targetKind: AntiTropeVariant['targetKind']; mode: AntiTropeVariant['mode']; title: string; premise: string; pressureMechanism: string },
): AntiTropeVariant {
  const value: typeof antiTropeVariants.$inferInsert = {
    id: genId(),
    projectId: data.projectId ?? null,
    targetKind: data.targetKind,
    targetId: data.targetId ?? null,
    mode: data.mode,
    title: data.title,
    premise: data.premise,
    pressureMechanism: data.pressureMechanism,
    preservedPayoffs: stringifyArray(data.preservedPayoffs),
    keyChanges: stringifyArray(data.keyChanges),
    risks: stringifyArray(data.risks),
    sampleRewrite: data.sampleRewrite ?? null,
    createdAt: now(),
  }
  const [row] = insertRow(db, antiTropeVariants, value)
  return antiTropeFromRow(row as AntiTropeRow)
}

export function listRevisionTasks(db: DB, projectId?: string): RevisionTask[] {
  const q = db.select().from(revisionTasks)
  const rows = projectId ? q.where(eq(revisionTasks.projectId, projectId)).orderBy(desc(revisionTasks.createdAt)).all() : q.orderBy(desc(revisionTasks.createdAt)).all()
  return rows.map((r) => revisionTaskFromRow(r as RevisionTaskRow))
}

export function listRevisionTasksByTarget(db: DB, targetKind: string, targetId?: string): RevisionTask[] {
  return db
    .select()
    .from(revisionTasks)
    .where(targetWhere(revisionTasks, targetKind, targetId))
    .orderBy(desc(revisionTasks.createdAt))
    .all()
    .map((r) => revisionTaskFromRow(r as RevisionTaskRow))
}

export function createRevisionTask(
  db: DB,
  data: Partial<OptionalId<RevisionTask>> & { targetKind: RevisionTask['targetKind']; title: string; description: string; suggestedAction: string },
): RevisionTask {
  const ts = now()
  const value: typeof revisionTasks.$inferInsert = {
    id: genId(),
    projectId: data.projectId ?? null,
    targetKind: data.targetKind,
    targetId: data.targetId ?? null,
    sourceReportId: data.sourceReportId ?? null,
    title: data.title,
    description: data.description,
    priority: data.priority ?? 'should',
    status: data.status ?? 'open',
    suggestedAction: data.suggestedAction,
    expectedBenefit: stringifyJson(data.expectedBenefit ?? emptyBenefit),
    appliedVersionId: data.appliedVersionId ?? null,
    createdAt: ts,
    updatedAt: ts,
  }
  const [row] = insertRow(db, revisionTasks, value)
  return revisionTaskFromRow(row as RevisionTaskRow)
}

export function updateRevisionTask(db: DB, id: string, patch: Partial<RevisionTask>): RevisionTask | undefined {
  const fields: Record<string, unknown> = { ...patch, updatedAt: now() }
  if (fields.expectedBenefit) fields.expectedBenefit = stringifyJson(fields.expectedBenefit)
  const [row] = updateRows(db, revisionTasks, fields).where(eq(revisionTasks.id, id)).returning().all()
  return row ? revisionTaskFromRow(row as RevisionTaskRow) : undefined
}

export function createContentVersion(
  db: DB,
  data: Partial<OptionalId<ContentVersion>> & { targetKind: ContentVersion['targetKind']; targetId: string; label: string; source: ContentVersion['source']; content: string },
): ContentVersion {
  const value: typeof contentVersions.$inferInsert = {
    id: genId(),
    projectId: data.projectId ?? null,
    targetKind: data.targetKind,
    targetId: data.targetId,
    label: data.label,
    source: data.source,
    content: data.content,
    meta: data.meta ? stringifyJson(data.meta) : null,
    createdAt: now(),
  }
  const [row] = insertRow(db, contentVersions, value)
  return contentVersionFromRow(row as ContentVersionRow)
}

export function getContentVersion(db: DB, id: string): ContentVersion | undefined {
  const [row] = db.select().from(contentVersions).where(eq(contentVersions.id, id)).limit(1).all()
  return row ? contentVersionFromRow(row as ContentVersionRow) : undefined
}

export function listContentVersionsByTarget(db: DB, targetKind: string, targetId: string): ContentVersion[] {
  return db
    .select()
    .from(contentVersions)
    .where(and(eq(contentVersions.targetKind, targetKind), eq(contentVersions.targetId, targetId)))
    .orderBy(desc(contentVersions.createdAt))
    .all()
    .map((r) => contentVersionFromRow(r as ContentVersionRow))
}

export function createQualityGateReport(
  db: DB,
  data: Partial<OptionalId<QualityGateReport>> & { targetKind: QualityGateReport['targetKind']; stage: QualityGateReport['stage']; score: number; verdict: QualityGateReport['verdict'] },
): QualityGateReport {
  const ts = now()
  const value: typeof qualityGateReports.$inferInsert = {
    id: genId(),
    projectId: data.projectId ?? null,
    adaptationProjectId: data.adaptationProjectId ?? null,
    targetKind: data.targetKind,
    targetId: data.targetId ?? null,
    stage: data.stage,
    score: data.score,
    verdict: data.verdict,
    blockingIssues: stringifyArray(data.blockingIssues),
    warnings: stringifyArray(data.warnings),
    suggestions: stringifyArray(data.suggestions),
    createdAt: ts,
    updatedAt: ts,
  }
  const [row] = insertRow(db, qualityGateReports, value)
  return qualityGateFromRow(row as QualityGateRow)
}

export function listQualityGateReports(db: DB, projectId?: string): QualityGateReport[] {
  const q = db.select().from(qualityGateReports)
  const rows = projectId ? q.where(eq(qualityGateReports.projectId, projectId)).orderBy(desc(qualityGateReports.createdAt)).all() : q.orderBy(desc(qualityGateReports.createdAt)).all()
  return rows.map((r) => qualityGateFromRow(r as QualityGateRow))
}

export function createAudienceSimulation(
  db: DB,
  data: Partial<OptionalId<AudienceSimulation>> & { targetKind: AudienceSimulation['targetKind']; audienceProfile: string; summary: string },
): AudienceSimulation {
  const ts = now()
  const value: typeof audienceSimulations.$inferInsert = {
    id: genId(),
    projectId: data.projectId ?? null,
    targetKind: data.targetKind,
    targetId: data.targetId ?? null,
    audienceProfile: data.audienceProfile,
    retentionScore: data.retentionScore ?? 0,
    emotionalEngagementScore: data.emotionalEngagementScore ?? 0,
    noveltyScore: data.noveltyScore ?? 0,
    likelyDropOffPoints: stringifyArray(data.likelyDropOffPoints),
    mostMemorableMoments: stringifyArray(data.mostMemorableMoments),
    complaints: stringifyArray(data.complaints),
    shareableClips: stringifyArray(data.shareableClips),
    summary: data.summary,
    createdAt: ts,
    updatedAt: ts,
  }
  const [row] = insertRow(db, audienceSimulations, value)
  return audienceFromRow(row as AudienceRow)
}

export function listAudienceSimulations(db: DB, projectId?: string): AudienceSimulation[] {
  const q = db.select().from(audienceSimulations)
  const rows = projectId ? q.where(eq(audienceSimulations.projectId, projectId)).orderBy(desc(audienceSimulations.createdAt)).all() : q.orderBy(desc(audienceSimulations.createdAt)).all()
  return rows.map((r) => audienceFromRow(r as AudienceRow))
}

export function createNarrativeCurveReport(
  db: DB,
  data: Partial<OptionalId<NarrativeCurveReport>> & { targetKind: NarrativeCurveReport['targetKind']; summary: string },
): NarrativeCurveReport {
  const ts = now()
  const value: typeof narrativeCurveReports.$inferInsert = {
    id: genId(),
    projectId: data.projectId ?? null,
    adaptationProjectId: data.adaptationProjectId ?? null,
    targetKind: data.targetKind,
    targetId: data.targetId ?? null,
    hookCurve: stringifyNumberArray(data.hookCurve),
    conflictCurve: stringifyNumberArray(data.conflictCurve),
    reversalCurve: stringifyNumberArray(data.reversalCurve),
    emotionCurve: stringifyNumberArray(data.emotionCurve),
    cliffhangerCurve: stringifyNumberArray(data.cliffhangerCurve),
    freshnessCurve: stringifyNumberArray(data.freshnessCurve),
    summary: data.summary,
    weakSpots: stringifyArray(data.weakSpots),
    createdAt: ts,
    updatedAt: ts,
  }
  const [row] = insertRow(db, narrativeCurveReports, value)
  return curveFromRow(row as CurveRow)
}

export function listNarrativeCurveReports(db: DB, projectId?: string): NarrativeCurveReport[] {
  const q = db.select().from(narrativeCurveReports)
  const rows = projectId ? q.where(eq(narrativeCurveReports.projectId, projectId)).orderBy(desc(narrativeCurveReports.createdAt)).all() : q.orderBy(desc(narrativeCurveReports.createdAt)).all()
  return rows.map((r) => curveFromRow(r as CurveRow))
}

export function createWorkflowRun(
  db: DB,
  data: Partial<OptionalId<WorkflowRun>> & { templateKey: string; title: string },
): WorkflowRun {
  const ts = now()
  const value: typeof workflowRuns.$inferInsert = {
    id: genId(),
    projectId: data.projectId ?? null,
    adaptationProjectId: data.adaptationProjectId ?? null,
    templateKey: data.templateKey,
    title: data.title,
    status: data.status ?? 'pending',
    currentStep: data.currentStep ?? null,
    steps: stringifyJson({ steps: data.steps ?? [] }),
    errorMessage: data.errorMessage ?? null,
    createdAt: ts,
    updatedAt: ts,
  }
  const [row] = insertRow(db, workflowRuns, value)
  return workflowFromRow(row as WorkflowRow)
}

export function updateWorkflowRun(db: DB, id: string, patch: Partial<WorkflowRun>): WorkflowRun | undefined {
  const fields: Record<string, unknown> = { ...patch, updatedAt: now() }
  if (fields.steps) fields.steps = stringifyJson({ steps: fields.steps })
  const [row] = updateRows(db, workflowRuns, fields).where(eq(workflowRuns.id, id)).returning().all()
  return row ? workflowFromRow(row as WorkflowRow) : undefined
}

export function listWorkflowRuns(db: DB, projectId?: string): WorkflowRun[] {
  const q = db.select().from(workflowRuns)
  const rows = projectId ? q.where(eq(workflowRuns.projectId, projectId)).orderBy(desc(workflowRuns.createdAt)).all() : q.orderBy(desc(workflowRuns.createdAt)).all()
  return rows.map((r) => workflowFromRow(r as WorkflowRow))
}
