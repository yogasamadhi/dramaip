import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileUp, Loader2, MessageSquareText, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { FeedbackComment, FeedbackCommentCluster, FeedbackImportBatch, FeedbackImportPreview, FeedbackMetric } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { confirmAction } from '@/components/ConfirmActionDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export function FeedbackLoopSection({ projectId }: { projectId: string }) {
  const [batches, setBatches] = useState<FeedbackImportBatch[]>([])
  const [metrics, setMetrics] = useState<FeedbackMetric[]>([])
  const [comments, setComments] = useState<FeedbackComment[]>([])
  const [clusters, setClusters] = useState<FeedbackCommentCluster[]>([])
  const [preview, setPreview] = useState<FeedbackImportPreview | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [privacy, setPrivacy] = useState<'local_only' | 'redacted'>('local_only')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [nextBatches, nextMetrics, nextComments, nextClusters] = await Promise.all([
      ipc.feedback.listBatches(projectId), ipc.feedback.listMetrics(projectId), ipc.feedback.listComments(projectId), ipc.feedback.listClusters(projectId),
    ])
    setBatches(nextBatches); setMetrics(nextMetrics); setComments(nextComments); setClusters(nextClusters)
  }, [projectId])
  useEffect(() => { void load().catch((error) => toast.error(`读取反馈数据失败：${error instanceof Error ? error.message : String(error)}`)) }, [load])

  async function choose(kind: 'metrics' | 'comments') {
    setBusy(`choose-${kind}`)
    try {
      const result = await ipc.feedback.chooseAndPreview(kind)
      if (result.canceled || !result.preview || !result.token) return
      setPreview(result.preview); setToken(result.token); setPrivacy(kind === 'comments' ? 'local_only' : 'redacted')
    } catch (error) { toast.error(`读取导入文件失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(null) }
  }

  async function commit() {
    if (!token || !preview) return
    setBusy('commit')
    try {
      const result = await ipc.feedback.commitPreview({ projectId, token, privacy })
      if (result.duplicateBatch) toast.message(`相同文件已在 ${new Date(result.duplicateBatch.createdAt).toLocaleString('zh-CN')} 导入，未重复写入。`)
      else toast.success(`已导入 ${result.importedMetricCount + result.importedCommentCount} 条记录，跳过 ${result.skippedDuplicateCount} 条历史重复。`)
      setPreview(null); setToken(null); await load()
    } catch (error) { toast.error(`确认导入失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(null) }
  }

  async function cluster(batchId: string) {
    setBusy(`cluster-${batchId}`)
    try { const created = await ipc.feedback.clusterBatch({ projectId, batchId }); await load(); toast.success(`已创建 ${created.length} 个本地关键词聚类；它们不等同于因果结论。`) }
    catch (error) { toast.error(`聚类失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(null) }
  }
  async function clearClusters(batchId: string) {
    setBusy(`clear-${batchId}`)
    try { const count = await ipc.feedback.deleteClusters({ projectId, batchId }); await load(); toast.success(`已删除 ${count} 个派生聚类，原始评论仍保留。`) }
    catch (error) { toast.error(`删除聚类失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(null) }
  }
  async function createRevision(batchId: string, clusterId?: string) {
    setBusy(`revision-${clusterId ?? batchId}`)
    try { const task = await ipc.feedback.createRevisionTask({ projectId, batchId, clusterId }); toast.success(`已创建修订任务“${task.title}”；它尚未修改正文或成片。`) }
    catch (error) { toast.error(`创建修订任务失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(null) }
  }
  async function exportFeedbackPackage() {
    setBusy('export-feedback-package')
    try {
      const result = await ipc.export.projectPackage(projectId, { includeFeedback: true })
      if (result.saved) toast.success(`已导出含本地反馈的项目包：${result.path}`)
      else toast.message('已取消导出')
    } catch (error) { toast.error(`导出含反馈项目包失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(null) }
  }
  async function removeBatch(batch: FeedbackImportBatch) {
    const confirmed = await confirmAction({ title: `删除导入批次“${batch.sourceName}”？`, description: '将删除该批次的指标、评论和派生聚类；不会删除正文、成片或已创建的修订任务。', confirmLabel: '删除批次', destructive: true })
    if (!confirmed) return
    setBusy(`delete-${batch.id}`)
    try { await ipc.feedback.deleteBatch({ projectId, batchId: batch.id }); await load(); toast.success('已删除导入批次及其派生数据。') }
    catch (error) { toast.error(`删除批次失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(null) }
  }

  const clustersByBatch = useMemo(() => new Map(batches.map((batch) => [batch.id, clusters.filter((cluster) => cluster.batchId === batch.id)])), [batches, clusters])
  return <div className="space-y-3" data-feedback-loop>
    <div className="rounded-md border bg-muted/20 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-base font-semibold">真实反馈回流</h2><p className="text-xs text-muted-foreground">只导入你主动选择的 CSV/JSON。平台、版本、时间窗和指标口径独立保存；不会抓取账号数据，也不会把相关性说成因果。</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void choose('metrics')}>{busy === 'choose-metrics' ? <Loader2 className="animate-spin" /> : <FileUp />}导入指标 CSV/JSON</Button><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void choose('comments')}>{busy === 'choose-comments' ? <Loader2 className="animate-spin" /> : <MessageSquareText />}导入评论 CSV/JSON</Button><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void exportFeedbackPackage()}>{busy === 'export-feedback-package' ? <Loader2 className="animate-spin" /> : <FileUp />}导出含本地反馈的项目包</Button><Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void load()}><RefreshCw />刷新</Button></div></div><p className="mt-2 text-xs text-muted-foreground">普通“项目包”默认不含反馈；此按钮会把本地指标、评论和派生聚类一并写入文件，请仅交给获授权的接收方。</p></div>
    {preview && <div className="space-y-2 rounded border border-primary/40 bg-primary/5 p-3 text-xs"><div className="flex flex-wrap items-center gap-2"><Badge>{preview.kind === 'metrics' ? '指标预览' : '评论预览'}</Badge><span>{preview.sourceName} · {preview.platform}</span>{preview.sourceVersion && <span>版本：{preview.sourceVersion}</span>}<span>{preview.metrics.length} 指标 / {preview.comments.length} 评论 / {preview.skippedRows.length} 跳过</span></div><p>{preview.notices.join(' ')}</p>{preview.kind === 'comments' && <label className="flex items-center gap-2"><select aria-label="评论本地隐私策略" value={privacy} onChange={(event) => setPrivacy(event.target.value as 'local_only' | 'redacted')} className="h-8 rounded border bg-background px-2"><option value="local_only">仅本地保留原文</option><option value="redacted">入库前脱敏邮箱/手机号</option></select><span className="text-muted-foreground">评论不会自动发给 AI；创建修订任务也不会复制原文。</span></label>}<div className="rounded border bg-background/70 p-2"><p className="font-medium">预览样本</p>{preview.metrics.slice(0, 3).map((item) => <p key={item.rowFingerprint}>{item.metricLabel ?? item.metricKey}：{item.value} · {item.definition ?? '源文件口径'}</p>)}{preview.comments.slice(0, 3).map((item) => <p key={item.rowFingerprint} className="line-clamp-1">{item.text}</p>)}</div><div className="flex gap-2"><Button size="sm" disabled={busy !== null} onClick={() => void commit()}>{busy === 'commit' ? <Loader2 className="animate-spin" /> : null}确认导入</Button><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => { setPreview(null); setToken(null) }}>取消</Button></div></div>}
    <div className="grid gap-3 lg:grid-cols-2"><section className="space-y-2 rounded border p-3"><div className="flex items-center justify-between"><h3 className="text-sm font-medium">指标与 A/B 记录</h3><Badge variant="outline">{metrics.length} 条</Badge></div>{metrics.length === 0 ? <p className="text-xs text-muted-foreground">尚未导入指标。支持显式 metric/value 两列，或播放、完播率、平均观看时长、点赞、评论数、分享等常见列。</p> : <div className="space-y-1">{metrics.slice(0, 10).map((metric) => <div key={metric.id} className="rounded border bg-muted/20 p-2 text-xs"><div className="flex flex-wrap gap-2"><Badge variant="outline">{metric.platform}</Badge><span className="font-medium">{metric.metricLabel}：{metric.metricKey === 'completion_rate' ? `${(metric.value * 100).toFixed(1)}%` : metric.value}</span>{metric.variantKey && <span>A/B：{metric.variantKey}</span>}{metric.recordedAt && <span>{metric.recordedAt}</span>}</div><p className="mt-1 text-muted-foreground">口径：{metric.definition}</p></div>)}</div>}<p className="text-xs text-muted-foreground">A/B 数据只保留版本与结果；没有实验设计、样本和时间窗对照时，不显示“某文案导致增长”。</p></section>
      <section className="space-y-2 rounded border p-3"><div className="flex items-center justify-between"><h3 className="text-sm font-medium">本地评论与派生聚类</h3><Badge variant="outline">{comments.length} 条</Badge></div>{comments.length === 0 ? <p className="text-xs text-muted-foreground">评论原文默认只保留在本地。导入后可按批次创建可删除的关键词聚类。</p> : <div className="space-y-1">{comments.slice(0, 6).map((comment) => <div key={comment.id} className="rounded border bg-muted/20 p-2 text-xs"><div className="flex gap-2"><Badge variant="outline">{comment.platform}</Badge><span>{comment.authorAlias ?? '匿名来源'}</span>{comment.recordedAt && <span>{comment.recordedAt}</span>}</div><p className="mt-1 whitespace-pre-wrap">{comment.text}</p></div>)}</div>}</section></div>
    <section className="space-y-2 rounded border p-3"><h3 className="text-sm font-medium">导入批次与修订回流</h3>{batches.length === 0 ? <p className="text-xs text-muted-foreground">导入批次会显示来源、时间窗、版本、隐私策略和去重数量；删除只影响本批派生数据。</p> : batches.map((batch) => { const batchClusters = clustersByBatch.get(batch.id) ?? []; return <div key={batch.id} className="space-y-2 rounded border bg-muted/20 p-2 text-xs"><div className="flex flex-wrap items-center gap-2"><Badge variant={batch.kind === 'comments' ? 'secondary' : 'outline'}>{batch.kind === 'comments' ? '评论' : '指标'}</Badge><span className="font-medium">{batch.sourceName}</span><span>{batch.platform}</span>{batch.sourceVersion && <span>版本：{batch.sourceVersion}</span>}<span>{batch.timeWindowStart ?? '—'} 至 {batch.timeWindowEnd ?? '—'}</span><span>导入 {batch.importedRecordCount} / 去重 {batch.skippedDuplicateCount}</span><Badge variant="outline">{batch.privacy === 'local_only' ? '原文仅本地' : '入库已脱敏'}</Badge><div className="ml-auto flex flex-wrap gap-1">{batch.kind === 'comments' && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void cluster(batch.id)}>{busy === `cluster-${batch.id}` ? <Loader2 className="animate-spin" /> : null}重建聚类</Button>}{batchClusters.length > 0 && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void clearClusters(batch.id)}>删除派生聚类</Button>}<Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void createRevision(batch.id)}>创建修订任务</Button><Button size="sm" variant="ghost" className="text-destructive" disabled={busy !== null} onClick={() => void removeBatch(batch)}><Trash2 />删除</Button></div></div>{batchClusters.map((cluster) => <div key={cluster.id} className="flex flex-wrap items-center gap-2 rounded border bg-background p-2"><Badge variant={cluster.tone === 'negative' ? 'destructive' : cluster.tone === 'positive' ? 'default' : 'outline'}>{cluster.label} · {cluster.tone}</Badge><span>{cluster.summary}</span><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void createRevision(batch.id, cluster.id)}>从此聚类创建修订</Button></div>)}</div> })}</section>
  </div>
}
