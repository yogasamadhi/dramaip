import { and, desc, eq, inArray } from 'drizzle-orm'
import type {
  FeedbackComment,
  FeedbackCommentCluster,
  FeedbackImportBatch,
  FeedbackImportPreview,
  FeedbackImportResult,
  FeedbackMetric,
  FeedbackPrivacy,
} from '@sdns/core'
import type { DB } from '../client'
import { feedbackCommentClusters, feedbackComments, feedbackImportBatches, feedbackMetrics } from '../schema'
import { genId, insertRow, now, parseJsonArray, updateRows } from './util'

type BatchRow = typeof feedbackImportBatches.$inferSelect
type MetricRow = typeof feedbackMetrics.$inferSelect
type CommentRow = typeof feedbackComments.$inferSelect
type ClusterRow = typeof feedbackCommentClusters.$inferSelect

function batchFromRow(row: BatchRow): FeedbackImportBatch {
  return { id: row.id, projectId: row.projectId, kind: row.kind as FeedbackImportBatch['kind'], sourceName: row.sourceName, platform: row.platform, sourceVersion: row.sourceVersion ?? undefined, timeWindowStart: row.timeWindowStart ?? undefined, timeWindowEnd: row.timeWindowEnd ?? undefined, privacy: row.privacy as FeedbackPrivacy, contentSha256: row.contentSha256, importedRecordCount: row.importedRecordCount, skippedDuplicateCount: row.skippedDuplicateCount, createdAt: row.createdAt }
}
function metricFromRow(row: MetricRow): FeedbackMetric {
  return { id: row.id, batchId: row.batchId, projectId: row.projectId, platform: row.platform, sourceVersion: row.sourceVersion ?? undefined, metricKey: row.metricKey, metricLabel: row.metricLabel, definition: row.definition, value: row.value, denominator: row.denominator ?? undefined, targetKind: row.targetKind as FeedbackMetric['targetKind'], targetId: row.targetId ?? undefined, recordedAt: row.recordedAt ?? undefined, variantKey: row.variantKey ?? undefined, rowFingerprint: row.rowFingerprint, createdAt: row.createdAt }
}
function commentFromRow(row: CommentRow): FeedbackComment {
  return { id: row.id, batchId: row.batchId, projectId: row.projectId, platform: row.platform, sourceVersion: row.sourceVersion ?? undefined, externalId: row.externalId ?? undefined, authorAlias: row.authorAlias ?? undefined, text: row.text, privacy: row.privacy as FeedbackPrivacy, targetKind: row.targetKind as FeedbackComment['targetKind'], targetId: row.targetId ?? undefined, recordedAt: row.recordedAt ?? undefined, rowFingerprint: row.rowFingerprint, createdAt: row.createdAt }
}
function clusterFromRow(row: ClusterRow): FeedbackCommentCluster {
  return { id: row.id, batchId: row.batchId, projectId: row.projectId, label: row.label, summary: row.summary, tone: row.tone as FeedbackCommentCluster['tone'], method: row.method as FeedbackCommentCluster['method'], commentIds: parseJsonArray(row.commentIds), targetKind: row.targetKind as FeedbackCommentCluster['targetKind'], targetId: row.targetId ?? undefined, createdAt: row.createdAt }
}

export function listFeedbackImportBatches(db: DB, projectId: string): FeedbackImportBatch[] {
  return db.select().from(feedbackImportBatches).where(eq(feedbackImportBatches.projectId, projectId)).orderBy(desc(feedbackImportBatches.createdAt)).all().map((row) => batchFromRow(row as BatchRow))
}
export function listFeedbackMetrics(db: DB, projectId: string): FeedbackMetric[] {
  return db.select().from(feedbackMetrics).where(eq(feedbackMetrics.projectId, projectId)).orderBy(desc(feedbackMetrics.recordedAt), desc(feedbackMetrics.createdAt)).all().map((row) => metricFromRow(row as MetricRow))
}
export function listFeedbackComments(db: DB, projectId: string): FeedbackComment[] {
  return db.select().from(feedbackComments).where(eq(feedbackComments.projectId, projectId)).orderBy(desc(feedbackComments.recordedAt), desc(feedbackComments.createdAt)).all().map((row) => commentFromRow(row as CommentRow))
}
export function listFeedbackCommentClusters(db: DB, projectId: string): FeedbackCommentCluster[] {
  return db.select().from(feedbackCommentClusters).where(eq(feedbackCommentClusters.projectId, projectId)).orderBy(desc(feedbackCommentClusters.createdAt)).all().map((row) => clusterFromRow(row as ClusterRow))
}

export function importFeedbackPreview(db: DB, input: { projectId: string; privacy: FeedbackPrivacy; preview: FeedbackImportPreview }): FeedbackImportResult {
  const existing = db.select().from(feedbackImportBatches).where(and(eq(feedbackImportBatches.projectId, input.projectId), eq(feedbackImportBatches.kind, input.preview.kind), eq(feedbackImportBatches.contentSha256, input.preview.contentSha256 ?? ''))).get()
  if (existing) return { duplicateBatch: batchFromRow(existing as BatchRow), importedMetricCount: 0, importedCommentCount: 0, skippedDuplicateCount: 0 }
  const timestamp = now()
  let result: FeedbackImportResult = { importedMetricCount: 0, importedCommentCount: 0, skippedDuplicateCount: 0 }
  db.transaction((tx) => {
    const batchId = genId()
    const [row] = insertRow(tx as DB, feedbackImportBatches, {
      id: batchId, projectId: input.projectId, kind: input.preview.kind, sourceName: input.preview.sourceName, platform: input.preview.platform,
      sourceVersion: input.preview.sourceVersion ?? null, timeWindowStart: input.preview.timeWindowStart ?? null, timeWindowEnd: input.preview.timeWindowEnd ?? null,
      privacy: input.privacy, contentSha256: input.preview.contentSha256 ?? `missing-${batchId}`, importedRecordCount: 0, skippedDuplicateCount: 0, createdAt: timestamp,
    })
    let metricCount = 0; let commentCount = 0; let duplicateCount = 0
    for (const metric of input.preview.metrics) {
      const duplicate = tx.select({ id: feedbackMetrics.id }).from(feedbackMetrics).where(and(eq(feedbackMetrics.projectId, input.projectId), eq(feedbackMetrics.rowFingerprint, metric.rowFingerprint))).get()
      if (duplicate) { duplicateCount += 1; continue }
      insertRow(tx as DB, feedbackMetrics, { id: genId(), batchId, projectId: input.projectId, platform: metric.platform ?? input.preview.platform, sourceVersion: metric.sourceVersion ?? input.preview.sourceVersion ?? null, metricKey: metric.metricKey, metricLabel: metric.metricLabel ?? metric.metricKey, definition: metric.definition ?? '以源文件口径为准。', value: metric.value, denominator: metric.denominator ?? null, targetKind: metric.targetKind, targetId: metric.targetId ?? null, recordedAt: metric.recordedAt ?? null, variantKey: metric.variantKey ?? null, rowFingerprint: metric.rowFingerprint, createdAt: timestamp })
      metricCount += 1
    }
    for (const comment of input.preview.comments) {
      const duplicate = tx.select({ id: feedbackComments.id }).from(feedbackComments).where(and(eq(feedbackComments.projectId, input.projectId), eq(feedbackComments.rowFingerprint, comment.rowFingerprint))).get()
      if (duplicate) { duplicateCount += 1; continue }
      insertRow(tx as DB, feedbackComments, { id: genId(), batchId, projectId: input.projectId, platform: comment.platform ?? input.preview.platform, sourceVersion: comment.sourceVersion ?? input.preview.sourceVersion ?? null, externalId: comment.externalId ?? null, authorAlias: comment.authorAlias ?? null, text: input.privacy === 'redacted' ? redactComment(comment.text) : comment.text, privacy: input.privacy, targetKind: comment.targetKind, targetId: comment.targetId ?? null, recordedAt: comment.recordedAt ?? null, rowFingerprint: comment.rowFingerprint, createdAt: timestamp })
      commentCount += 1
    }
    const importedRecordCount = metricCount + commentCount
    const [updated] = updateRows(tx as DB, feedbackImportBatches, { importedRecordCount, skippedDuplicateCount: duplicateCount }).where(eq(feedbackImportBatches.id, batchId)).returning().all()
    result = { batch: batchFromRow((updated ?? row) as BatchRow), importedMetricCount: metricCount, importedCommentCount: commentCount, skippedDuplicateCount: duplicateCount }
  })
  return result
}

export function createFeedbackCommentClusters(db: DB, input: { projectId: string; batchId: string }): FeedbackCommentCluster[] {
  const batch = db.select().from(feedbackImportBatches).where(and(eq(feedbackImportBatches.id, input.batchId), eq(feedbackImportBatches.projectId, input.projectId))).get()
  if (!batch || batch.kind !== 'comments') return []
  db.delete(feedbackCommentClusters).where(eq(feedbackCommentClusters.batchId, input.batchId)).run()
  const comments = db.select().from(feedbackComments).where(eq(feedbackComments.batchId, input.batchId)).all().map((row) => commentFromRow(row as CommentRow))
  const groups = new Map<string, FeedbackComment[]>()
  for (const comment of comments) {
    const label = classifyComment(comment.text)
    groups.set(label, [...(groups.get(label) ?? []), comment])
  }
  const createdAt = now()
  return [...groups.entries()].map(([label, rows]) => {
    const target = sharedTarget(rows)
    const tone = classifyTone(rows.map((row) => row.text).join(' '))
    const [created] = insertRow(db, feedbackCommentClusters, { id: genId(), batchId: input.batchId, projectId: input.projectId, label, summary: `本地关键词归类：${rows.length} 条；请人工阅读原文后决定是否创建修订任务。`, tone, method: 'keyword-v1', commentIds: JSON.stringify(rows.map((row) => row.id)), targetKind: target.targetKind, targetId: target.targetId ?? null, createdAt })
    return clusterFromRow(created as ClusterRow)
  })
}

export function deleteFeedbackCommentClusters(db: DB, input: { projectId: string; batchId: string }): number {
  return db.delete(feedbackCommentClusters).where(and(eq(feedbackCommentClusters.projectId, input.projectId), eq(feedbackCommentClusters.batchId, input.batchId))).run().changes
}

export function deleteFeedbackImportBatch(db: DB, input: { projectId: string; batchId: string }): boolean {
  const batch = db.select().from(feedbackImportBatches).where(and(eq(feedbackImportBatches.id, input.batchId), eq(feedbackImportBatches.projectId, input.projectId))).get()
  if (!batch) return false
  db.transaction((tx) => {
    tx.delete(feedbackCommentClusters).where(eq(feedbackCommentClusters.batchId, input.batchId)).run()
    tx.delete(feedbackMetrics).where(eq(feedbackMetrics.batchId, input.batchId)).run()
    tx.delete(feedbackComments).where(eq(feedbackComments.batchId, input.batchId)).run()
    tx.delete(feedbackImportBatches).where(eq(feedbackImportBatches.id, input.batchId)).run()
  })
  return true
}

export function getFeedbackCommentsByIds(db: DB, projectId: string, ids: string[]): FeedbackComment[] {
  if (!ids.length) return []
  return db.select().from(feedbackComments).where(and(eq(feedbackComments.projectId, projectId), inArray(feedbackComments.id, ids))).all().map((row) => commentFromRow(row as CommentRow))
}

/**
 * Restore feedback only from an explicitly opted-in project package.  The caller
 * owns target-id remapping because it has the package-wide old → new id map.
 * Original local comments and their derived clusters remain separate records.
 */
export function restoreFeedbackProjectPackage(db: DB, input: {
  projectId: string
  batches?: FeedbackImportBatch[]
  metrics?: FeedbackMetric[]
  comments?: FeedbackComment[]
  clusters?: FeedbackCommentCluster[]
  remapTargetId: (oldTargetId?: string) => string | undefined
}): Map<string, string> {
  const batchIdMap = new Map<string, string>()
  const commentIdMap = new Map<string, string>()
  const metricFingerprints = new Set<string>()
  const commentFingerprints = new Set<string>()
  const batches = input.batches ?? []
  const metrics = input.metrics ?? []
  const comments = input.comments ?? []
  const clusters = input.clusters ?? []

  db.transaction((tx) => {
    for (const batch of batches) {
      const id = genId()
      batchIdMap.set(batch.id, id)
      insertRow(tx as DB, feedbackImportBatches, {
        id, projectId: input.projectId, kind: batch.kind, sourceName: batch.sourceName, platform: batch.platform,
        sourceVersion: batch.sourceVersion ?? null, timeWindowStart: batch.timeWindowStart ?? null, timeWindowEnd: batch.timeWindowEnd ?? null,
        privacy: batch.privacy, contentSha256: batch.contentSha256, importedRecordCount: batch.importedRecordCount,
        skippedDuplicateCount: batch.skippedDuplicateCount, createdAt: batch.createdAt || now(),
      })
    }
    for (const metric of metrics) {
      const batchId = batchIdMap.get(metric.batchId)
      if (!batchId || metricFingerprints.has(metric.rowFingerprint)) continue
      metricFingerprints.add(metric.rowFingerprint)
      const target = remapFeedbackTarget(metric.targetKind, metric.targetId, input.projectId, input.remapTargetId)
      insertRow(tx as DB, feedbackMetrics, {
        id: genId(), batchId, projectId: input.projectId, platform: metric.platform, sourceVersion: metric.sourceVersion ?? null,
        metricKey: metric.metricKey, metricLabel: metric.metricLabel, definition: metric.definition, value: metric.value,
        denominator: metric.denominator ?? null, targetKind: target.targetKind, targetId: target.targetId ?? null,
        recordedAt: metric.recordedAt ?? null, variantKey: metric.variantKey ?? null, rowFingerprint: metric.rowFingerprint, createdAt: metric.createdAt || now(),
      })
    }
    for (const comment of comments) {
      const batchId = batchIdMap.get(comment.batchId)
      if (!batchId || commentFingerprints.has(comment.rowFingerprint)) continue
      commentFingerprints.add(comment.rowFingerprint)
      const id = genId()
      commentIdMap.set(comment.id, id)
      const target = remapFeedbackTarget(comment.targetKind, comment.targetId, input.projectId, input.remapTargetId)
      insertRow(tx as DB, feedbackComments, {
        id, batchId, projectId: input.projectId, platform: comment.platform, sourceVersion: comment.sourceVersion ?? null,
        externalId: comment.externalId ?? null, authorAlias: comment.authorAlias ?? null, text: comment.text, privacy: comment.privacy,
        targetKind: target.targetKind, targetId: target.targetId ?? null, recordedAt: comment.recordedAt ?? null,
        rowFingerprint: comment.rowFingerprint, createdAt: comment.createdAt || now(),
      })
    }
    for (const cluster of clusters) {
      const batchId = batchIdMap.get(cluster.batchId)
      const commentIds = cluster.commentIds.map((id) => commentIdMap.get(id)).filter(Boolean) as string[]
      if (!batchId || commentIds.length === 0) continue
      const target = remapFeedbackTarget(cluster.targetKind, cluster.targetId, input.projectId, input.remapTargetId)
      insertRow(tx as DB, feedbackCommentClusters, {
        id: genId(), batchId, projectId: input.projectId, label: cluster.label, summary: cluster.summary, tone: cluster.tone,
        method: cluster.method, commentIds: JSON.stringify(commentIds), targetKind: target.targetKind, targetId: target.targetId ?? null,
        createdAt: cluster.createdAt || now(),
      })
    }
  })
  return batchIdMap
}

function remapFeedbackTarget(
  targetKind: FeedbackComment['targetKind'],
  targetId: string | undefined,
  projectId: string,
  remapTargetId: (oldTargetId?: string) => string | undefined,
): { targetKind: FeedbackComment['targetKind']; targetId: string } {
  if (targetKind === 'project') return { targetKind: 'project', targetId: projectId }
  const mappedTargetId = remapTargetId(targetId)
  return mappedTargetId ? { targetKind, targetId: mappedTargetId } : { targetKind: 'project', targetId: projectId }
}

function redactComment(text: string): string { return text.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[已脱敏邮箱]').replace(/1\d{10}/g, '[已脱敏手机号]') }
function classifyComment(text: string): string {
  if (/节奏|拖沓|太慢|钩子|反转|剧情/.test(text)) return '节奏与钩子'
  if (/主角|角色|人设|人物/.test(text)) return '角色与人设'
  if (/画面|配音|字幕|制作|特效/.test(text)) return '制作体验'
  if (/好看|喜欢|上头|期待|爽/.test(text)) return '正向反馈'
  return '其他反馈'
}
function classifyTone(text: string): FeedbackCommentCluster['tone'] {
  const positive = (text.match(/好看|喜欢|上头|期待|爽|精彩/g) ?? []).length
  const negative = (text.match(/拖沓|太慢|失望|难看|看不懂|弃/g) ?? []).length
  return positive && negative ? 'mixed' : positive ? 'positive' : negative ? 'negative' : 'unknown'
}
function sharedTarget(rows: FeedbackComment[]): { targetKind: FeedbackComment['targetKind']; targetId?: string } {
  const first = rows[0]
  return rows.every((row) => row.targetKind === first.targetKind && row.targetId === first.targetId) ? { targetKind: first.targetKind, targetId: first.targetId } : { targetKind: 'project' }
}
