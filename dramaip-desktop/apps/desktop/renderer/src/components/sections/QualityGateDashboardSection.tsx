import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ClipboardCheck, RefreshCcw, ShieldCheck, Table2 } from 'lucide-react'
import { toast } from 'sonner'
import type { AdaptationProject, Chapter, QualityIssueAcknowledgement } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import type { QualityGateTruth } from '@/lib/qualityGateTruth'
import {
  chaptersWithoutMemory,
  failedLongTasks,
  isHighRiskShot,
  latestQualityIssueAcknowledgements,
  needsScriptReview,
  summarizeQualityGateIssues,
  type QualityGateIssue,
  type QualityGateIssueSeverity,
  type QualityGateIssueStage,
} from '@/lib/qualityGateDashboard'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

type IssueTarget =
  | { type: 'workspace'; section: string; chapterId?: string; qualityIssueId?: string }
  | { type: 'route'; path: string }

interface DashboardIssue extends QualityGateIssue {
  actionLabel: string
  target: IssueTarget
}

type IssueStatusFilter = 'open' | 'accepted' | 'ignored' | 'all'
type IssueTargetFilter = 'all' | QualityGateIssue['kind']

export function QualityGateDashboardSection({
  projectId,
  chapters,
  qualityTruth,
  activeAdaptation,
  onOpenWorkspaceTarget,
}: {
  projectId: string
  chapters: Chapter[]
  qualityTruth: QualityGateTruth | null
  activeAdaptation?: AdaptationProject
  onOpenWorkspaceTarget: (section: string, chapterId?: string, qualityIssueId?: string) => void
}) {
  const navigate = useNavigate()
  const [issues, setIssues] = useState<DashboardIssue[]>([])
  const [acknowledgements, setAcknowledgements] = useState<QualityIssueAcknowledgement[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [severityFilter, setSeverityFilter] = useState<'all' | QualityGateIssueSeverity>('all')
  const [stageFilter, setStageFilter] = useState<'all' | QualityGateIssueStage>('all')
  const [targetFilter, setTargetFilter] = useState<IssueTargetFilter>('all')
  const [statusFilter, setStatusFilter] = useState<IssueStatusFilter>('open')
  const [pendingAcknowledgement, setPendingAcknowledgement] = useState<{
    issue: DashboardIssue
    disposition: QualityIssueAcknowledgement['disposition']
  } | null>(null)
  const [acknowledgementNote, setAcknowledgementNote] = useState('')
  const [acknowledging, setAcknowledging] = useState(false)
  const summary = useMemo(() => summarizeQualityGateIssues(issues), [issues])
  const latestAcknowledgements = useMemo(
    () => latestQualityIssueAcknowledgements(acknowledgements),
    [acknowledgements],
  )
  const displayedIssues = useMemo(() => issues.filter((issue) => {
    const status = latestAcknowledgements.get(issue.id)?.disposition ?? 'open'
    return (severityFilter === 'all' || issue.severity === severityFilter) &&
      (stageFilter === 'all' || issue.stage === stageFilter) &&
      (targetFilter === 'all' || issue.kind === targetFilter) &&
      (statusFilter === 'all' || status === statusFilter)
  }), [issues, latestAcknowledgements, severityFilter, stageFilter, statusFilter, targetFilter])
  const groupedIssues = useMemo(() => {
    const groups = new Map<QualityGateIssueStage | 'unassigned', DashboardIssue[]>()
    for (const issue of displayedIssues) {
      const key = issue.stage ?? 'unassigned'
      groups.set(key, [...(groups.get(key) ?? []), issue])
    }
    return Array.from(groups.entries())
  }, [displayedIssues])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [memories, tasks, nextAcknowledgements] = await Promise.all([
        ipc.chapterMemory.list(projectId),
        ipc.longTask.list(projectId),
        ipc.creative.listQualityIssueAcknowledgements(projectId),
      ])
      const next: DashboardIssue[] = chaptersWithoutMemory(chapters, memories).map((chapter) => ({
        id: `memory:${chapter.id}`,
        kind: 'chapter_memory',
        severity: 'warn',
        stage: 'novel_to_adaptation',
        title: `缺少章节记忆：${chapter.title}`,
        detail: '该章节尚未生成长篇一致性记忆，后续 AI 上下文可能缺少事件、人物变化与视觉要点。',
        actionLabel: '生成记忆',
        target: { type: 'workspace', section: 'memory', chapterId: chapter.id },
      }))

      if (qualityTruth?.state !== 'current') {
        next.push({
          id: `quality-truth:${qualityTruth?.state ?? 'loading'}`,
          kind: 'quality_report',
          severity: 'warn',
          stage: 'novel_to_adaptation',
          title: qualityTruth?.state === 'stale' ? '质量报告已过期' : '需要运行质量闸门',
          detail: qualityTruth?.detail ?? '正在加载项目质量报告。',
          actionLabel: '运行检查',
          target: { type: 'workspace', section: 'creative-diagnosis' },
        })
      } else if (qualityTruth.report?.verdict === 'block') {
        qualityTruth.report.blockingIssues.forEach((detail, index) => {
          const issueId = `quality-report:${qualityTruth.report?.id}:block:${index}`
          next.push({
            id: issueId,
            kind: 'quality_report',
            severity: 'block',
            stage: qualityTruth.report?.stage,
            title: '最新质量报告阻塞项',
            detail,
            actionLabel: '查看诊断',
            target: { type: 'workspace', section: 'creative-diagnosis', qualityIssueId: issueId },
          })
        })
      } else if (qualityTruth.report?.verdict === 'warn') {
        const warnings = qualityTruth.report.warnings.length ? qualityTruth.report.warnings : [qualityTruth.detail]
        warnings.forEach((detail, index) => {
          const issueId = `quality-report:${qualityTruth.report?.id}:warn:${index}`
          next.push({
            id: issueId,
            kind: 'quality_report',
            severity: 'warn',
            stage: qualityTruth.report?.stage,
            title: '最新质量报告提醒',
            detail,
            actionLabel: '查看诊断',
            target: { type: 'workspace', section: 'creative-diagnosis', qualityIssueId: issueId },
          })
        })
      }

      if (activeAdaptation) {
        const scripts = await ipc.script.list(activeAdaptation.id)
        const reviews = await Promise.all(scripts.map((script) => ipc.scriptReview.get(script.id)))
        scripts.forEach((script, index) => {
          if (!needsScriptReview(script, reviews[index])) return
          next.push({
            id: `script:${script.id}`,
            kind: 'script_review',
            severity: 'warn',
            stage: 'scripts_to_shots',
            title: `未审稿剧本：第 ${script.episodeNumber} 集`,
            detail: `${activeAdaptation.title} / ${script.title} 尚未生成剧本审稿，可能遗漏对白、冲突、画面和 AI 视频可生成性问题。`,
            actionLabel: '打开剧本',
            target: { type: 'route', path: `/adaptations/${activeAdaptation.id}/scripts?episode=${script.episodeId}` },
          })
        })
        for (const script of scripts) {
          const scenes = await ipc.scene.listByScript(script.id)
          for (const scene of scenes) {
            const shots = await ipc.shot.listByScene(scene.id)
            const shotReviews = await Promise.all(shots.map((shot) => ipc.shotReview.get(shot.id)))
            shots.forEach((shot, index) => {
              const review = shotReviews[index]
              if (!isHighRiskShot(shot, review)) return
              next.push({
                id: `shot:${shot.id}`,
                kind: 'shot_risk',
                severity: 'block',
                stage: 'shots_to_video',
                title: `高风险镜头：第 ${shot.shotNumber} 镜`,
                detail: `${activeAdaptation.title} / ${script.title} / ${scene.title}，难度 ${review?.aiVideoDifficulty ?? shot.aiVideoDifficulty ?? '未知'}，综合分 ${review?.overallScore ?? '未审查'}。`,
                actionLabel: '打开分镜',
                target: { type: 'route', path: `/adaptations/${activeAdaptation.id}/shots?episode=${shot.episodeId}&scene=${scene.id}&shot=${shot.id}` },
              })
            })
          }
        }
      }

      failedLongTasks(tasks).forEach((task) => {
        next.push({
          id: `task:${task.id}`,
          kind: 'failed_task',
          severity: 'block',
          stage: 'operations',
          title: `失败任务：${task.title}`,
          detail: task.errorMessage ?? `${task.kind} / ${task.taskType ?? '未标记任务类型'} 在 ${formatTime(task.updatedAt)} 失败。`,
          actionLabel: '查看任务',
          target: { type: 'route', path: '/settings/tasks' },
        })
      })
      setIssues(next)
      setAcknowledgements(nextAcknowledgements)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [activeAdaptation, chapters, projectId, qualityTruth])

  useEffect(() => { void reload() }, [reload])

  function openIssue(issue: DashboardIssue) {
    if (issue.target.type === 'workspace') {
      onOpenWorkspaceTarget(issue.target.section, issue.target.chapterId, issue.target.qualityIssueId)
      return
    }
    navigate(issue.target.path)
  }

  function beginAcknowledgement(issue: DashboardIssue, disposition: QualityIssueAcknowledgement['disposition']) {
    setAcknowledgementNote('')
    setPendingAcknowledgement({ issue, disposition })
  }

  async function saveAcknowledgement() {
    if (!pendingAcknowledgement) return
    setAcknowledging(true)
    try {
      await ipc.creative.acknowledgeQualityIssue({
        projectId,
        adaptationProjectId: activeAdaptation?.id,
        issueId: pendingAcknowledgement.issue.id,
        issueKind: pendingAcknowledgement.issue.kind,
        issueTitle: pendingAcknowledgement.issue.title,
        issueDetail: pendingAcknowledgement.issue.detail,
        disposition: pendingAcknowledgement.disposition,
        note: acknowledgementNote.trim() || undefined,
      })
      toast.success(pendingAcknowledgement.disposition === 'accepted' ? '已记录风险接受，原质量项仍保留可追溯' : '已记录忽略原因，原质量项仍保留可追溯')
      setPendingAcknowledgement(null)
      await reload()
    } catch (cause) {
      toast.error(`记录处置失败：${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setAcknowledging(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <ClipboardCheck className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">质量闸门</h2>
        <Badge variant={summary.block > 0 ? 'destructive' : summary.warn > 0 ? 'secondary' : 'default'} aria-live="polite">{summary.total} 项 / 当前显示 {displayedIssues.length}</Badge>
        <div className="ml-auto"><Button size="sm" variant="outline" onClick={reload} disabled={loading}><RefreshCcw className={loading ? 'animate-spin' : ''} />刷新</Button></div>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4"><Metric label="全部" value={summary.total} /><Metric label="阻塞" value={summary.block} tone="danger" /><Metric label="提醒" value={summary.warn} /><Metric label="信息" value={summary.info} /></div>
          <div className="rounded-md border bg-muted/30 p-3 text-sm" aria-live="polite"><div className="font-medium">当前闸门：{qualityTruth?.state === 'current' ? '检查结果有效' : '需要复检'}</div><p className="mt-1 text-xs text-muted-foreground">{qualityTruth?.detail ?? '正在读取项目质量状态。'}{qualityTruth?.state !== 'current' ? '；运行质量闸门后才能解除当前状态。' : ''}</p></div>
          <div className="grid gap-2 md:grid-cols-4">
            <FilterSelect label="严重度" value={severityFilter} onChange={(value) => setSeverityFilter(value as 'all' | QualityGateIssueSeverity)} options={[['all', '全部严重度'], ['block', '阻塞'], ['warn', '提醒'], ['info', '信息']]} />
            <FilterSelect label="阶段" value={stageFilter} onChange={(value) => setStageFilter(value as 'all' | QualityGateIssueStage)} options={[['all', '全部阶段'], ['novel_to_adaptation', '小说到改编'], ['episodes_to_scripts', '分集到剧本'], ['scripts_to_shots', '剧本到分镜'], ['shots_to_video', '分镜到视频'], ['operations', '任务与运行']]} />
            <FilterSelect label="目标" value={targetFilter} onChange={(value) => setTargetFilter(value as IssueTargetFilter)} options={[['all', '全部目标'], ['chapter_memory', '章节记忆'], ['quality_report', '质量报告'], ['script_review', '剧本'], ['shot_risk', '镜头'], ['failed_task', '任务']]} />
            <FilterSelect label="处置状态" value={statusFilter} onChange={(value) => setStatusFilter(value as IssueStatusFilter)} options={[['open', '待处理'], ['accepted', '已接受风险'], ['ignored', '已忽略'], ['all', '全部状态']]} />
          </div>
          {error && <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{error}</div>}
          {!loading && displayedIssues.length === 0 ? <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-600" />当前筛选条件下没有质量项。</div> : (
            <div className="space-y-4">{groupedIssues.map(([stage, stageIssues]) => <section key={stage} aria-label={`${stageLabel(stage === 'unassigned' ? undefined : stage)}问题`}><div className="mb-2 flex items-center gap-2"><h3 className="text-sm font-medium">{stageLabel(stage === 'unassigned' ? undefined : stage)}</h3><Badge variant="outline">{stageIssues.length} 项</Badge></div><div className="space-y-2">{stageIssues.map((issue) => { const acknowledgement = latestAcknowledgements.get(issue.id); return <IssueCard key={issue.id} issue={issue} acknowledgement={acknowledgement} onOpen={openIssue} onAcknowledge={beginAcknowledgement} /> })}</div></section>)}</div>
          )}
          <IssueDataTable issues={issues} acknowledgements={latestAcknowledgements} />
        </div>
      </ScrollArea>
      <Dialog open={Boolean(pendingAcknowledgement)} onOpenChange={(open) => { if (!open && !acknowledging) setPendingAcknowledgement(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{pendingAcknowledgement?.disposition === 'accepted' ? '接受质量风险' : '忽略质量提醒'}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">原始质量项不会被删除。请写下本次本地决策的理由，便于后续复检和交接。</p>
          <div className="space-y-2"><Label htmlFor="quality-ack-note">处置说明（可选）</Label><Textarea id="quality-ack-note" value={acknowledgementNote} onChange={(event) => setAcknowledgementNote(event.target.value)} placeholder="例如：已知该镜头成本较高，先保留为试制方案。" rows={4} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setPendingAcknowledgement(null)} disabled={acknowledging}>取消</Button><Button onClick={() => void saveAcknowledgement()} disabled={acknowledging}>{acknowledging ? <RefreshCcw className="animate-spin" /> : <ShieldCheck />}{pendingAcknowledgement?.disposition === 'accepted' ? '记录接受风险' : '记录忽略'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function IssueCard({ issue, acknowledgement, onOpen, onAcknowledge }: { issue: DashboardIssue; acknowledgement?: QualityIssueAcknowledgement; onOpen: (issue: DashboardIssue) => void; onAcknowledge: (issue: DashboardIssue, disposition: QualityIssueAcknowledgement['disposition']) => void }) {
  return <div data-quality-issue-id={issue.id} className="rounded-md border p-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200"><div className="flex items-start gap-2"><AlertTriangle className={issue.severity === 'block' ? 'mt-0.5 h-4 w-4 text-destructive' : 'mt-0.5 h-4 w-4 text-amber-600'} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{issue.title}</span><Badge variant={issue.severity === 'block' ? 'destructive' : 'secondary'}>{severityLabel(issue.severity)}</Badge><Badge variant="outline">{stageLabel(issue.stage)}</Badge><Badge variant="outline">{targetLabel(issue.kind)}</Badge>{acknowledgement && <Badge variant="outline">{acknowledgement.disposition === 'accepted' ? '已接受风险' : '已忽略'}</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">{issue.detail}</p>{acknowledgement && <p className="mt-1 text-xs text-muted-foreground">{acknowledgement.actorLabel} · {formatTime(acknowledgement.createdAt)}{acknowledgement.note ? ` · ${acknowledgement.note}` : ''}</p>}</div><div className="flex shrink-0 flex-wrap justify-end gap-1"><Button size="sm" variant="outline" onClick={() => onOpen(issue)}>{issue.actionLabel}</Button><Button size="sm" variant="ghost" onClick={() => onAcknowledge(issue, issue.severity === 'block' ? 'accepted' : 'ignored')}><ShieldCheck />{issue.severity === 'block' ? '接受风险' : '忽略'}</Button></div></div></div>
}

function IssueDataTable({ issues, acknowledgements }: { issues: DashboardIssue[]; acknowledgements: Map<string, QualityIssueAcknowledgement> }) {
  return <details className="rounded-md border p-3 text-sm"><summary className="flex cursor-pointer items-center gap-2 font-medium"><Table2 className="h-4 w-4" />问题数据表</summary><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead><tr className="border-b text-muted-foreground"><th className="p-2">阶段</th><th className="p-2">严重度</th><th className="p-2">状态</th><th className="p-2">问题</th><th className="p-2">解除条件 / 详情</th></tr></thead><tbody>{issues.map((issue) => { const acknowledgement = acknowledgements.get(issue.id); return <tr key={issue.id} className="border-b align-top"><td className="p-2">{stageLabel(issue.stage)}</td><td className="p-2">{severityLabel(issue.severity)}</td><td className="p-2">{acknowledgement ? (acknowledgement.disposition === 'accepted' ? '已接受风险' : '已忽略') : '待处理'}</td><td className="p-2 font-medium">{issue.title}</td><td className="p-2 text-muted-foreground">{issue.detail}</td></tr> })}</tbody></table></div></details>
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">{label}</div><div className={tone === 'danger' ? 'text-lg font-semibold text-destructive' : 'text-lg font-semibold'}>{value}</div></div>
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return <label className="grid gap-1 text-xs text-muted-foreground"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm text-foreground">{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>
}

function severityLabel(severity: QualityGateIssue['severity']): string { return severity === 'block' ? '阻塞' : severity === 'warn' ? '提醒' : '信息' }
function stageLabel(stage?: QualityGateIssueStage): string {
  if (stage === 'novel_to_adaptation') return '小说→改编'
  if (stage === 'episodes_to_scripts') return '分集→剧本'
  if (stage === 'scripts_to_shots') return '剧本→分镜'
  if (stage === 'shots_to_video') return '分镜→视频'
  if (stage === 'operations') return '任务与运行'
  return '未标记阶段'
}
function targetLabel(kind: QualityGateIssue['kind']): string {
  if (kind === 'chapter_memory') return '章节记忆'
  if (kind === 'quality_report') return '质量报告'
  if (kind === 'script_review') return '剧本'
  if (kind === 'shot_risk') return '镜头'
  return '任务'
}
function formatTime(iso: string): string { try { return new Date(iso).toLocaleString('zh-CN', { hour12: false }) } catch { return iso } }
