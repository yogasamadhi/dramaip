import { createHash, randomUUID } from 'node:crypto'
import type { FeedbackImportKind, FeedbackImportPreview, RevisionTask } from '@sdns/core'
import { parseFeedbackImport } from '@sdns/core'
import type { Repositories } from '@sdns/db'

interface StoredPreview { preview: FeedbackImportPreview; expiresAt: number }
const previews = new Map<string, StoredPreview>()
const PREVIEW_TTL_MS = 30 * 60 * 1_000

export function previewFeedbackContent(input: { kind: FeedbackImportKind; sourceName: string; content: string; platform?: string; sourceVersion?: string }): { token: string; preview: FeedbackImportPreview } {
  const preview = parseFeedbackImport(input)
  preview.contentSha256 = createHash('sha256').update(input.content).digest('hex')
  const token = randomUUID()
  for (const [key, item] of previews) if (item.expiresAt < Date.now()) previews.delete(key)
  previews.set(token, { preview, expiresAt: Date.now() + PREVIEW_TTL_MS })
  return { token, preview }
}

export function commitFeedbackPreview(repos: Repositories, input: { projectId: string; token: string; privacy: 'local_only' | 'redacted' }) {
  const stored = previews.get(input.token)
  if (!stored || stored.expiresAt < Date.now()) {
    previews.delete(input.token)
    throw new Error('导入预览已失效；请重新选择文件并确认。')
  }
  const result = repos.feedback.importFeedbackPreview(repos.db, { projectId: input.projectId, privacy: input.privacy, preview: stored.preview })
  if (!result.duplicateBatch) previews.delete(input.token)
  return result
}

export function createFeedbackRevisionTask(repos: Repositories, input: { projectId: string; batchId: string; clusterId?: string; title?: string; suggestedAction?: string }): RevisionTask {
  const batch = repos.feedback.listFeedbackImportBatches(repos.db, input.projectId).find((item) => item.id === input.batchId)
  if (!batch) throw new Error('反馈批次不属于当前作品或已删除。')
  const cluster = input.clusterId ? repos.feedback.listFeedbackCommentClusters(repos.db, input.projectId).find((item) => item.id === input.clusterId && item.batchId === input.batchId) : undefined
  if (input.clusterId && !cluster) throw new Error('反馈聚类不属于当前导入批次。')
  const target = resolveRevisionTarget(repos, input.projectId, cluster?.targetKind ?? 'project', cluster?.targetId)
  const metrics = repos.feedback.listFeedbackMetrics(repos.db, input.projectId).filter((item) => item.batchId === input.batchId)
  const evidence = cluster
    ? `本地聚类“${cluster.label}”含 ${cluster.commentIds.length} 条评论，语气：${cluster.tone}。原文保留在仅本地的反馈批次中，未写入修订任务。`
    : metrics.length ? `此批次含 ${metrics.length} 条指标记录（${metrics.slice(0, 3).map((item) => `${item.metricLabel}=${item.value}`).join('；')}）。不同平台、版本和时间窗的指标不可自动推断因果。`
      : '此批次没有可用于自动摘要的记录；请先人工查看原始反馈。'
  return repos.creative.createRevisionTask(repos.db, {
    projectId: input.projectId, targetKind: target.targetKind, targetId: target.targetId, sourceReportId: batch.id,
    title: input.title?.trim() || `反馈修订建议 · ${cluster?.label ?? batch.sourceName}`,
    description: `${evidence}\n来源：${batch.platform} / ${batch.sourceName}${batch.timeWindowStart || batch.timeWindowEnd ? ` / ${batch.timeWindowStart ?? '—'} 至 ${batch.timeWindowEnd ?? '—'}` : ''}。先审阅反馈与当前内容，再生成 Diff；不会直接修改正文或成片。`,
    suggestedAction: input.suggestedAction?.trim() || '人工核对反馈定位与当前内容，必要时先生成可预览 Diff，再显式采用。', priority: 'should', expectedBenefit: { retention: 0, freshness: 0, visual: 0, cost: 0 },
  })
}

function resolveRevisionTarget(repos: Repositories, projectId: string, kind: 'project' | 'chapter' | 'episode' | 'scene' | 'shot', id?: string): Pick<RevisionTask, 'targetKind' | 'targetId'> {
  if (!id || kind === 'project') return { targetKind: 'project', targetId: projectId }
  if (kind === 'chapter') {
    const chapter = repos.chapter.getChapter(repos.db, id)
    return chapter?.projectId === projectId ? { targetKind: 'chapter', targetId: id } : { targetKind: 'project', targetId: projectId }
  }
  if (kind === 'shot') {
    const shot = repos.shot.getShot(repos.db, id)
    return shot && episodeBelongsToProject(repos, projectId, shot.episodeId)
      ? { targetKind: 'shot', targetId: id }
      : { targetKind: 'project', targetId: projectId }
  }
  const episodeId = kind === 'episode' ? id : kind === 'scene' ? repos.scene.getScene(repos.db, id)?.episodeId : undefined
  if (!episodeId || !episodeBelongsToProject(repos, projectId, episodeId)) return { targetKind: 'project', targetId: projectId }
  const script = episodeId ? repos.script.getScriptByEpisode(repos.db, episodeId) : undefined
  return script ? { targetKind: 'script', targetId: script.id } : { targetKind: 'project', targetId: projectId }
}

function episodeBelongsToProject(repos: Repositories, projectId: string, episodeId: string): boolean {
  const episode = repos.episode.getEpisode(repos.db, episodeId)
  if (!episode) return false
  return repos.adaptationProject.getAdaptationProject(repos.db, episode.adaptationProjectId)?.sourceProjectId === projectId
}
