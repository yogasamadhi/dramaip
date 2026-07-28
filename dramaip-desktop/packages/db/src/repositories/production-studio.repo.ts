import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type {
  GenerationPolicyProfile,
  ProductionImpact,
  ProviderDataPolicy,
  ProviderObservation,
  RetakeRequest,
  ReviewComment,
  ReviewDecision,
  ReviewPackageManifest,
  ReviewPackageRecord,
} from '@sdns/core'
import type { DB } from '../client'
import {
  generationPolicyProfiles,
  productAnalyticsEvents,
  productAnalyticsSettings,
  productionImpacts,
  providerDataPolicies,
  providerObservations,
  retakeRequests,
  reviewComments,
  reviewDecisions,
  reviewPackageRecords,
} from '../schema'
import { genId, insertRow, now, parseJsonArray, parseJsonObject, stringifyJson, updateRows } from './util'

type ImpactRow = typeof productionImpacts.$inferSelect
type RetakeRow = typeof retakeRequests.$inferSelect
type ReviewPackageRow = typeof reviewPackageRecords.$inferSelect
type ReviewCommentRow = typeof reviewComments.$inferSelect
type ReviewDecisionRow = typeof reviewDecisions.$inferSelect
type PolicyProfileRow = typeof generationPolicyProfiles.$inferSelect
type DataPolicyRow = typeof providerDataPolicies.$inferSelect
type ObservationRow = typeof providerObservations.$inferSelect

function impactFromRow(row: ImpactRow): ProductionImpact {
  return {
    id: row.id,
    projectId: row.projectId,
    source: {
      kind: row.sourceKind as ProductionImpact['source']['kind'],
      id: row.sourceId,
      version: row.sourceVersion ?? undefined,
      label: row.sourceLabel ?? undefined,
    },
    target: {
      kind: row.targetKind as ProductionImpact['target']['kind'],
      id: row.targetId,
      version: row.targetVersion ?? undefined,
      label: row.targetLabel ?? undefined,
    },
    reason: row.reason,
    severity: row.severity,
    status: row.status,
    resolutionNote: row.resolutionNote ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt ?? undefined,
  }
}

export function listProductionImpacts(db: DB, projectId: string, statuses?: ProductionImpact['status'][]): ProductionImpact[] {
  const query = db.select().from(productionImpacts)
  const rows = statuses?.length
    ? query.where(and(eq(productionImpacts.projectId, projectId), inArray(productionImpacts.status, statuses))).orderBy(desc(productionImpacts.createdAt)).all()
    : query.where(eq(productionImpacts.projectId, projectId)).orderBy(desc(productionImpacts.createdAt)).all()
  return rows.map((row) => impactFromRow(row as ImpactRow))
}

export function getProductionImpact(db: DB, id: string): ProductionImpact | undefined {
  const row = db.select().from(productionImpacts).where(eq(productionImpacts.id, id)).get() as ImpactRow | undefined
  return row ? impactFromRow(row) : undefined
}

export function createProductionImpact(
  db: DB,
  data: Omit<ProductionImpact, 'id' | 'status' | 'createdAt' | 'updatedAt'> & { status?: ProductionImpact['status'] },
): ProductionImpact {
  const existing = db.select().from(productionImpacts).where(and(
    eq(productionImpacts.projectId, data.projectId),
    eq(productionImpacts.sourceKind, data.source.kind),
    eq(productionImpacts.sourceId, data.source.id),
    eq(productionImpacts.targetKind, data.target.kind),
    eq(productionImpacts.targetId, data.target.id),
    eq(productionImpacts.reason, data.reason),
    inArray(productionImpacts.status, ['open', 'accepted']),
  )).get() as ImpactRow | undefined
  if (existing) return impactFromRow(existing)
  const ts = now()
  const [row] = insertRow(db, productionImpacts, {
    id: genId(),
    projectId: data.projectId,
    sourceKind: data.source.kind,
    sourceId: data.source.id,
    sourceVersion: data.source.version ?? null,
    sourceLabel: data.source.label ?? null,
    targetKind: data.target.kind,
    targetId: data.target.id,
    targetVersion: data.target.version ?? null,
    targetLabel: data.target.label ?? null,
    reason: data.reason,
    severity: data.severity,
    status: data.status ?? 'open',
    resolutionNote: data.resolutionNote ?? null,
    resolvedAt: data.resolvedAt ?? null,
    createdAt: ts,
    updatedAt: ts,
  })
  return impactFromRow(row as ImpactRow)
}

export function resolveProductionImpact(
  db: DB,
  id: string,
  status: Extract<ProductionImpact['status'], 'accepted' | 'resolved' | 'waived'>,
  resolutionNote?: string,
): ProductionImpact | undefined {
  if (status === 'waived' && !resolutionNote?.trim()) throw new Error('豁免生产阻断必须填写理由')
  const ts = now()
  const [row] = updateRows(db, productionImpacts, {
    status,
    resolutionNote: resolutionNote?.trim() || null,
    resolvedAt: status === 'accepted' ? null : ts,
    updatedAt: ts,
  }).where(eq(productionImpacts.id, id)).returning().all()
  return row ? impactFromRow(row as ImpactRow) : undefined
}

export function hasOpenProductionBlockers(db: DB, projectId: string): boolean {
  return Boolean(db.select({ id: productionImpacts.id }).from(productionImpacts).where(and(
    eq(productionImpacts.projectId, projectId),
    eq(productionImpacts.severity, 'blocker'),
    inArray(productionImpacts.status, ['open', 'accepted']),
  )).get())
}

function retakeFromRow(row: RetakeRow): RetakeRequest {
  return {
    id: row.id,
    projectId: row.projectId,
    shotId: row.shotId,
    sourceCandidateId: row.sourceCandidateId,
    operation: row.operation as RetakeRequest['operation'],
    instruction: row.instruction,
    preserveFields: parseJsonArray(row.preserveFields, 'retake.preserveFields'),
    referenceAssetIds: parseJsonArray(row.referenceAssetIds, 'retake.referenceAssetIds'),
    maskAssetId: row.maskAssetId ?? undefined,
    providerConfigId: row.providerConfigId ?? undefined,
    status: row.status as RetakeRequest['status'],
    lineageId: row.lineageId ?? undefined,
    resultCandidateId: row.resultCandidateId ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function createRetakeRequest(
  db: DB,
  data: Omit<RetakeRequest, 'id' | 'status' | 'createdAt' | 'updatedAt'> & { status?: RetakeRequest['status'] },
): RetakeRequest {
  const instruction = data.instruction.trim()
  if (!instruction) throw new Error('Retake 指令不能为空')
  const ts = now()
  const [row] = insertRow(db, retakeRequests, {
    id: genId(),
    projectId: data.projectId,
    shotId: data.shotId,
    sourceCandidateId: data.sourceCandidateId,
    operation: data.operation,
    instruction,
    preserveFields: stringifyJson(data.preserveFields),
    referenceAssetIds: stringifyJson(data.referenceAssetIds),
    maskAssetId: data.maskAssetId ?? null,
    providerConfigId: data.providerConfigId ?? null,
    status: data.status ?? 'draft',
    lineageId: data.lineageId ?? null,
    resultCandidateId: data.resultCandidateId ?? null,
    errorMessage: data.errorMessage ?? null,
    createdAt: ts,
    updatedAt: ts,
  })
  return retakeFromRow(row as RetakeRow)
}

export function getRetakeRequest(db: DB, id: string): RetakeRequest | undefined {
  const row = db.select().from(retakeRequests).where(eq(retakeRequests.id, id)).get() as RetakeRow | undefined
  return row ? retakeFromRow(row) : undefined
}

export function listRetakeRequests(db: DB, projectId: string, shotId?: string): RetakeRequest[] {
  const rows = shotId
    ? db.select().from(retakeRequests).where(and(eq(retakeRequests.projectId, projectId), eq(retakeRequests.shotId, shotId))).orderBy(desc(retakeRequests.updatedAt)).all()
    : db.select().from(retakeRequests).where(eq(retakeRequests.projectId, projectId)).orderBy(desc(retakeRequests.updatedAt)).all()
  return rows.map((row) => retakeFromRow(row as RetakeRow))
}

export function updateRetakeRequest(db: DB, id: string, patch: Partial<RetakeRequest>): RetakeRequest | undefined {
  const value: Partial<typeof retakeRequests.$inferInsert> = {
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.lineageId !== undefined ? { lineageId: patch.lineageId ?? null } : {}),
    ...(patch.resultCandidateId !== undefined ? { resultCandidateId: patch.resultCandidateId ?? null } : {}),
    ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage ?? null } : {}),
    ...(patch.providerConfigId !== undefined ? { providerConfigId: patch.providerConfigId ?? null } : {}),
    updatedAt: now(),
  }
  const [row] = updateRows(db, retakeRequests, value).where(eq(retakeRequests.id, id)).returning().all()
  return row ? retakeFromRow(row as RetakeRow) : undefined
}

function reviewPackageFromRow(row: ReviewPackageRow): ReviewPackageRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    adaptationProjectId: row.adaptationProjectId,
    episodeId: row.episodeId,
    kind: row.kind,
    status: row.status as ReviewPackageRecord['status'],
    title: row.title,
    manifest: parseJsonObject(row.manifest, {}, 'review.manifest') as unknown as ReviewPackageManifest,
    outputPath: row.outputPath ?? undefined,
    cloudPackageId: row.cloudPackageId ?? undefined,
    syncCursor: row.syncCursor ?? undefined,
    expiresAt: row.expiresAt ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function createReviewPackageRecord(
  db: DB,
  data: Omit<ReviewPackageRecord, 'id' | 'createdAt' | 'updatedAt'>,
): ReviewPackageRecord {
  const ts = now()
  const [row] = insertRow(db, reviewPackageRecords, {
    id: data.manifest.packageId || genId(),
    projectId: data.projectId,
    adaptationProjectId: data.adaptationProjectId,
    episodeId: data.episodeId,
    kind: data.kind,
    status: data.status,
    title: data.title,
    manifest: stringifyJson(data.manifest),
    outputPath: data.outputPath ?? null,
    cloudPackageId: data.cloudPackageId ?? null,
    syncCursor: data.syncCursor ?? null,
    expiresAt: data.expiresAt ?? null,
    errorMessage: data.errorMessage ?? null,
    createdAt: ts,
    updatedAt: ts,
  })
  return reviewPackageFromRow(row as ReviewPackageRow)
}

export function listReviewPackageRecords(db: DB, projectId: string, episodeId?: string): ReviewPackageRecord[] {
  const rows = episodeId
    ? db.select().from(reviewPackageRecords).where(and(eq(reviewPackageRecords.projectId, projectId), eq(reviewPackageRecords.episodeId, episodeId))).orderBy(desc(reviewPackageRecords.updatedAt)).all()
    : db.select().from(reviewPackageRecords).where(eq(reviewPackageRecords.projectId, projectId)).orderBy(desc(reviewPackageRecords.updatedAt)).all()
  return rows.map((row) => reviewPackageFromRow(row as ReviewPackageRow))
}

export function getReviewPackageRecord(db: DB, id: string): ReviewPackageRecord | undefined {
  const row = db.select().from(reviewPackageRecords).where(eq(reviewPackageRecords.id, id)).get() as ReviewPackageRow | undefined
  return row ? reviewPackageFromRow(row) : undefined
}

export function updateReviewPackageRecord(db: DB, id: string, patch: Partial<ReviewPackageRecord>): ReviewPackageRecord | undefined {
  const value: Partial<typeof reviewPackageRecords.$inferInsert> = {
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.manifest ? { manifest: stringifyJson(patch.manifest) } : {}),
    ...(patch.outputPath !== undefined ? { outputPath: patch.outputPath ?? null } : {}),
    ...(patch.cloudPackageId !== undefined ? { cloudPackageId: patch.cloudPackageId ?? null } : {}),
    ...(patch.syncCursor !== undefined ? { syncCursor: patch.syncCursor ?? null } : {}),
    ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt ?? null } : {}),
    ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage ?? null } : {}),
    updatedAt: now(),
  }
  const [row] = updateRows(db, reviewPackageRecords, value).where(eq(reviewPackageRecords.id, id)).returning().all()
  return row ? reviewPackageFromRow(row as ReviewPackageRow) : undefined
}

function commentFromRow(row: ReviewCommentRow): ReviewComment {
  return {
    id: row.id,
    packageId: row.packageId,
    shotId: row.shotId ?? undefined,
    timecodeSeconds: row.timecodeSeconds ?? undefined,
    authorAlias: row.authorAlias ?? undefined,
    body: row.body,
    resolved: row.resolved,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function upsertReviewComment(db: DB, comment: ReviewComment): ReviewComment {
  const existing = db.select().from(reviewComments).where(eq(reviewComments.id, comment.id)).get()
  if (existing) {
    const [row] = updateRows(db, reviewComments, {
      body: comment.body,
      resolved: comment.resolved,
      authorAlias: comment.authorAlias ?? null,
      timecodeSeconds: comment.timecodeSeconds ?? null,
      updatedAt: comment.updatedAt,
    }).where(eq(reviewComments.id, comment.id)).returning().all()
    return commentFromRow(row as ReviewCommentRow)
  }
  const [row] = insertRow(db, reviewComments, {
    id: comment.id || genId(),
    packageId: comment.packageId,
    shotId: comment.shotId ?? null,
    timecodeSeconds: comment.timecodeSeconds ?? null,
    authorAlias: comment.authorAlias ?? null,
    body: comment.body,
    resolved: comment.resolved,
    createdAt: comment.createdAt || now(),
    updatedAt: comment.updatedAt || now(),
  })
  return commentFromRow(row as ReviewCommentRow)
}

export function listReviewComments(db: DB, packageId: string): ReviewComment[] {
  return db.select().from(reviewComments).where(eq(reviewComments.packageId, packageId)).orderBy(reviewComments.createdAt).all()
    .map((row) => commentFromRow(row as ReviewCommentRow))
}

function decisionFromRow(row: ReviewDecisionRow): ReviewDecision {
  return {
    id: row.id,
    packageId: row.packageId,
    shotId: row.shotId ?? undefined,
    decision: row.decision,
    authorAlias: row.authorAlias ?? undefined,
    note: row.note ?? undefined,
    createdAt: row.createdAt,
  }
}

export function insertReviewDecision(db: DB, decision: ReviewDecision): ReviewDecision {
  const existing = db.select().from(reviewDecisions).where(eq(reviewDecisions.id, decision.id)).get() as ReviewDecisionRow | undefined
  if (existing) return decisionFromRow(existing)
  const [row] = insertRow(db, reviewDecisions, {
    id: decision.id || genId(),
    packageId: decision.packageId,
    shotId: decision.shotId ?? null,
    decision: decision.decision,
    authorAlias: decision.authorAlias ?? null,
    note: decision.note ?? null,
    createdAt: decision.createdAt || now(),
  })
  return decisionFromRow(row as ReviewDecisionRow)
}

export function listReviewDecisions(db: DB, packageId: string): ReviewDecision[] {
  return db.select().from(reviewDecisions).where(eq(reviewDecisions.packageId, packageId)).orderBy(reviewDecisions.createdAt).all()
    .map((row) => decisionFromRow(row as ReviewDecisionRow))
}

function policyProfileFromRow(row: PolicyProfileRow): GenerationPolicyProfile {
  return {
    id: row.id,
    projectId: row.projectId ?? undefined,
    mode: row.mode,
    label: row.label,
    allowedProviderConfigIds: parseJsonArray(row.allowedProviderConfigIds, 'routing.allowedProviders'),
    maximumProviders: row.maximumProviders,
    automaticFallback: row.automaticFallback,
    requireCostConfirmation: row.requireCostConfirmation,
    requireReferenceLocks: row.requireReferenceLocks,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listGenerationPolicyProfiles(db: DB, projectId?: string): GenerationPolicyProfile[] {
  const globalRows = db.select().from(generationPolicyProfiles).where(isNull(generationPolicyProfiles.projectId)).all()
  const projectRows = projectId
    ? db.select().from(generationPolicyProfiles).where(eq(generationPolicyProfiles.projectId, projectId)).all()
    : []
  const byMode = new Map(globalRows.map((row) => [row.mode, row as PolicyProfileRow]))
  for (const row of projectRows) byMode.set(row.mode, row as PolicyProfileRow)
  return [...byMode.values()].map(policyProfileFromRow).sort((left, right) => left.mode.localeCompare(right.mode))
}

export function saveGenerationPolicyProfile(
  db: DB,
  data: Omit<GenerationPolicyProfile, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): GenerationPolicyProfile {
  const existing = data.projectId
    ? db.select().from(generationPolicyProfiles).where(and(eq(generationPolicyProfiles.projectId, data.projectId), eq(generationPolicyProfiles.mode, data.mode))).get()
    : db.select().from(generationPolicyProfiles).where(and(isNull(generationPolicyProfiles.projectId), eq(generationPolicyProfiles.mode, data.mode))).get()
  const ts = now()
  const value = {
    projectId: data.projectId ?? null,
    mode: data.mode,
    label: data.label,
    allowedProviderConfigIds: stringifyJson(data.allowedProviderConfigIds),
    maximumProviders: data.mode === 'lookdev' ? Math.min(2, Math.max(1, data.maximumProviders)) : 1,
    automaticFallback: data.mode === 'draft' && data.automaticFallback,
    requireCostConfirmation: data.requireCostConfirmation,
    requireReferenceLocks: data.requireReferenceLocks,
    updatedAt: ts,
  }
  if (existing) {
    const [row] = updateRows(db, generationPolicyProfiles, value).where(eq(generationPolicyProfiles.id, existing.id)).returning().all()
    return policyProfileFromRow(row as PolicyProfileRow)
  }
  const [row] = insertRow(db, generationPolicyProfiles, { id: data.id ?? genId(), ...value, createdAt: ts })
  return policyProfileFromRow(row as PolicyProfileRow)
}

function dataPolicyFromRow(row: DataPolicyRow): ProviderDataPolicy {
  return {
    id: row.id,
    providerKind: row.providerKind,
    regions: parseJsonArray(row.regions, 'providerPolicy.regions'),
    retentionSummary: row.retentionSummary ?? undefined,
    trainsOnInputs: row.trainsOnInputs,
    sourceUrl: row.sourceUrl ?? undefined,
    lastVerifiedAt: row.lastVerifiedAt ?? undefined,
    userAcknowledgedAt: row.userAcknowledgedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listProviderDataPolicies(db: DB): ProviderDataPolicy[] {
  return db.select().from(providerDataPolicies).orderBy(providerDataPolicies.providerKind).all()
    .map((row) => dataPolicyFromRow(row as DataPolicyRow))
}

export function saveProviderDataPolicy(
  db: DB,
  data: Omit<ProviderDataPolicy, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): ProviderDataPolicy {
  const existing = db.select().from(providerDataPolicies).where(eq(providerDataPolicies.providerKind, data.providerKind)).get()
  const ts = now()
  const value = {
    providerKind: data.providerKind,
    regions: stringifyJson(data.regions),
    retentionSummary: data.retentionSummary ?? null,
    trainsOnInputs: data.trainsOnInputs,
    sourceUrl: data.sourceUrl ?? null,
    lastVerifiedAt: data.lastVerifiedAt ?? null,
    userAcknowledgedAt: data.userAcknowledgedAt ?? null,
    updatedAt: ts,
  }
  if (existing) {
    const [row] = updateRows(db, providerDataPolicies, value).where(eq(providerDataPolicies.id, existing.id)).returning().all()
    return dataPolicyFromRow(row as DataPolicyRow)
  }
  const [row] = insertRow(db, providerDataPolicies, { id: data.id ?? genId(), ...value, createdAt: ts })
  return dataPolicyFromRow(row as DataPolicyRow)
}

function observationFromRow(row: ObservationRow): ProviderObservation {
  return {
    id: row.id,
    projectId: row.projectId ?? undefined,
    providerConfigId: row.providerConfigId,
    providerKind: row.providerKind,
    mode: row.mode,
    taskKind: row.taskKind,
    outcome: row.outcome,
    latencyMs: row.latencyMs ?? undefined,
    estimatedCost: row.estimatedCost ?? undefined,
    actualCost: row.actualCost ?? undefined,
    currency: row.currency ?? undefined,
    errorCode: row.errorCode ?? undefined,
    createdAt: row.createdAt,
  }
}

export function recordProviderObservation(db: DB, data: Omit<ProviderObservation, 'id' | 'createdAt'>): ProviderObservation {
  const [row] = insertRow(db, providerObservations, {
    id: genId(),
    projectId: data.projectId ?? null,
    providerConfigId: data.providerConfigId,
    providerKind: data.providerKind,
    mode: data.mode,
    taskKind: data.taskKind,
    outcome: data.outcome,
    latencyMs: data.latencyMs ?? null,
    estimatedCost: data.estimatedCost ?? null,
    actualCost: data.actualCost ?? null,
    currency: data.currency ?? null,
    errorCode: data.errorCode ?? null,
    createdAt: now(),
  })
  return observationFromRow(row as ObservationRow)
}

export function listProviderObservations(db: DB, providerConfigId: string, taskKind?: string): ProviderObservation[] {
  const rows = taskKind
    ? db.select().from(providerObservations).where(and(eq(providerObservations.providerConfigId, providerConfigId), eq(providerObservations.taskKind, taskKind))).orderBy(desc(providerObservations.createdAt)).all()
    : db.select().from(providerObservations).where(eq(providerObservations.providerConfigId, providerConfigId)).orderBy(desc(providerObservations.createdAt)).all()
  return rows.map((row) => observationFromRow(row as ObservationRow))
}

export type ProductAnalyticsConsent = 'unknown' | 'granted' | 'denied'
export interface ProductAnalyticsSettings {
  consent: ProductAnalyticsConsent
  installationId: string
  decidedAt?: string
  updatedAt: string
}

export function getProductAnalyticsSettings(db: DB): ProductAnalyticsSettings {
  const row = db.select().from(productAnalyticsSettings).where(eq(productAnalyticsSettings.id, 'default')).get()
  if (row) {
    return {
      consent: row.consent,
      installationId: row.installationId,
      decidedAt: row.decidedAt ?? undefined,
      updatedAt: row.updatedAt,
    }
  }
  const ts = now()
  const [created] = insertRow(db, productAnalyticsSettings, {
    id: 'default',
    consent: 'unknown',
    installationId: genId(),
    decidedAt: null,
    updatedAt: ts,
  })
  const value = created as typeof productAnalyticsSettings.$inferSelect
  return { consent: value.consent, installationId: value.installationId, updatedAt: value.updatedAt }
}

export function setProductAnalyticsConsent(db: DB, consent: ProductAnalyticsConsent): ProductAnalyticsSettings {
  const current = getProductAnalyticsSettings(db)
  const ts = now()
  const [row] = updateRows(db, productAnalyticsSettings, {
    consent,
    decidedAt: ts,
    updatedAt: ts,
  }).where(eq(productAnalyticsSettings.id, 'default')).returning().all()
  if (consent !== 'granted') db.delete(productAnalyticsEvents).where(isNull(productAnalyticsEvents.uploadedAt)).run()
  const value = row as typeof productAnalyticsSettings.$inferSelect
  return { consent: value.consent, installationId: current.installationId, decidedAt: value.decidedAt ?? undefined, updatedAt: value.updatedAt }
}

const ANALYTICS_EVENT_ALLOWLIST = new Set([
  'demo_opened',
  'first_shot_ready',
  'retake_started',
  'retake_succeeded',
  'retake_adopted',
  'review_exported',
  'review_published',
  'editor_exported',
])

export function recordProductAnalyticsEvent(
  db: DB,
  input: { eventName: string; appVersion: string; operatingSystem: string; durationBucket?: string; resultCode?: string },
): boolean {
  if (!ANALYTICS_EVENT_ALLOWLIST.has(input.eventName)) throw new Error('产品分析事件不在允许列表中')
  if (getProductAnalyticsSettings(db).consent !== 'granted') return false
  insertRow(db, productAnalyticsEvents, {
    id: genId(),
    eventName: input.eventName,
    appVersion: input.appVersion.slice(0, 32),
    operatingSystem: input.operatingSystem.slice(0, 32),
    durationBucket: input.durationBucket?.slice(0, 32) ?? null,
    resultCode: input.resultCode?.slice(0, 64) ?? null,
    createdAt: now(),
    uploadedAt: null,
  })
  return true
}

export function listPendingProductAnalyticsEvents(db: DB) {
  return db.select().from(productAnalyticsEvents).where(isNull(productAnalyticsEvents.uploadedAt)).orderBy(productAnalyticsEvents.createdAt).all()
}

export function clearPendingProductAnalyticsEvents(db: DB): number {
  return db.delete(productAnalyticsEvents).where(isNull(productAnalyticsEvents.uploadedAt)).run().changes
}
