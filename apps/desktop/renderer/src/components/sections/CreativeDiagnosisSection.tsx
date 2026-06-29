import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { GitCompare, Loader2, Play, Save, Sparkles, Wand2 } from 'lucide-react'
import type {
  AntiTropeVariant,
  AudienceSimulation,
  Chapter,
  ContentVersion,
  FreshnessReport,
  NarrativeCurveReport,
  QualityGateReport,
  RevisionTask,
  WorkflowRun,
} from '@sdns/core'
import { CREATIVE_WORKFLOW_TEMPLATES, TASK_TYPE_LABELS } from '@sdns/core'
import { ipc, type AiTaskInput } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

interface Props {
  projectId: string
  chapter: Chapter | null
}

function scoreVariant(score: number): 'default' | 'secondary' | 'destructive' {
  if (score >= 75) return 'default'
  if (score >= 60) return 'secondary'
  return 'destructive'
}

export function CreativeDiagnosisSection({ projectId, chapter }: Props) {
  const [freshness, setFreshness] = useState<FreshnessReport[]>([])
  const [variants, setVariants] = useState<AntiTropeVariant[]>([])
  const [tasks, setTasks] = useState<RevisionTask[]>([])
  const [versions, setVersions] = useState<ContentVersion[]>([])
  const [gates, setGates] = useState<QualityGateReport[]>([])
  const [audiences, setAudiences] = useState<AudienceSimulation[]>([])
  const [curves, setCurves] = useState<NarrativeCurveReport[]>([])
  const [workflows, setWorkflows] = useState<WorkflowRun[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const target = useMemo(
    () => (chapter ? { kind: 'chapter', id: chapter.id, label: chapter.title } : { kind: 'project', id: projectId, label: '项目整体' }),
    [chapter, projectId],
  )

  const reload = useCallback(async () => {
    const [fr, at, rt, cv, qg, au, nc, wf] = await Promise.all([
      ipc.creative.listFreshness(projectId),
      ipc.creative.listAntiTropeByTarget(target.kind, target.id),
      ipc.revisionTask.list(projectId),
      ipc.contentVersion.listByTarget(target.kind, target.id),
      ipc.creative.listQualityGates(projectId),
      ipc.creative.listAudienceSimulations(projectId),
      ipc.creative.listNarrativeCurves(projectId),
      ipc.workflow.list(projectId),
    ])
    setFreshness(fr)
    setVariants(at)
    setTasks(rt)
    setVersions(cv)
    setGates(qg)
    setAudiences(au)
    setCurves(nc)
    setWorkflows(wf)
  }, [projectId, target.id, target.kind])

  useEffect(() => {
    void reload()
  }, [reload])

  async function runTask(taskType: AiTaskInput['taskType'], instruction?: string) {
    setBusy(taskType)
    const tid = toast.loading(`正在${TASK_TYPE_LABELS[taskType]}…`)
    try {
      const input: AiTaskInput = {
        projectId,
        taskType,
        userInstruction: instruction,
        ...(chapter ? { chapterId: chapter.id } : {}),
      }
      const res = await ipc.ai.run(input)
      if (res.ok) {
        toast.success(`${TASK_TYPE_LABELS[taskType]}完成`, { id: tid })
        await reload()
      } else {
        toast.error(`${TASK_TYPE_LABELS[taskType]}失败：${res.error ?? '未知错误'}`, { id: tid })
      }
    } finally {
      setBusy(null)
    }
  }

  async function runWorkflow(templateKey: string) {
    setBusy(templateKey)
    const tid = toast.loading('正在运行工作流…')
    try {
      const res = await ipc.workflow.run({ templateKey, projectId, chapterId: chapter?.id })
      if (res.ok) {
        toast.success('工作流完成', { id: tid })
        await reload()
      } else {
        toast.error('工作流失败：' + (res.error ?? '未知错误'), { id: tid })
        await reload()
      }
    } finally {
      setBusy(null)
    }
  }

  async function saveCheckpoint() {
    if (!chapter) {
      toast.error('请选择章节后再保存检查点')
      return
    }
    await ipc.contentVersion.create({
      projectId,
      targetKind: 'chapter',
      targetId: chapter.id,
      label: `手动检查点：${chapter.title}`,
      source: 'manual_checkpoint',
      content: chapter.content,
    })
    toast.success('已保存章节检查点')
    await reload()
  }

  async function applyTask(task: RevisionTask) {
    setBusy(task.id)
    const tid = toast.loading('正在应用修稿任务…')
    try {
      const res = await ipc.revisionTask.apply(task.id)
      if (res.ok) {
        toast.success('修稿任务已应用', { id: tid })
      } else {
        toast.error('应用失败：' + (res.error ?? '未知错误'), { id: tid })
      }
      await reload()
    } finally {
      setBusy(null)
    }
  }

  const latestFreshness = freshness[0]
  const latestGate = gates[0]
  const latestAudience = audiences[0]
  const latestCurve = curves[0]

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <h2 className="text-lg font-semibold">创意诊断台</h2>
            <p className="text-sm text-muted-foreground">当前目标：{target.label}</p>
          </div>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => runTask('analyze_trope_freshness')} disabled={busy !== null}>
              {busy === 'analyze_trope_freshness' ? <Loader2 className="animate-spin" /> : <Sparkles />}
              新鲜度
            </Button>
            <Button size="sm" variant="outline" onClick={() => runTask('generate_anti_trope_variants')} disabled={busy !== null}>
              <Wand2 /> 反套路
            </Button>
            <Button size="sm" variant="outline" onClick={() => runTask('analyze_narrative_curve')} disabled={busy !== null}>
              曲线
            </Button>
            <Button size="sm" variant="outline" onClick={() => runTask('run_quality_gate')} disabled={busy !== null}>
              闸门
            </Button>
            <Button size="sm" variant="outline" onClick={() => runTask('simulate_audience_reaction')} disabled={busy !== null}>
              观众
            </Button>
            <Button size="sm" variant="outline" onClick={() => runTask('generate_revision_tasks')} disabled={busy !== null}>
              任务单
            </Button>
            <Button size="sm" variant="outline" onClick={() => runTask('analyze_video_cost_risk')} disabled={busy !== null}>
              视频风险
            </Button>
            <Button size="sm" variant="secondary" onClick={saveCheckpoint} disabled={!chapter}>
              <Save /> 检查点
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          <MetricCard title="新鲜度" score={latestFreshness?.overallScore} detail={latestFreshness?.clicheSignals.slice(0, 2).join(' / ')} />
          <MetricCard title="套路风险" score={latestFreshness?.tropeRiskScore} invert detail={latestFreshness?.audiencePredictionPoints.slice(0, 2).join(' / ')} />
          <MetricCard title="质量闸门" score={latestGate?.score} badge={latestGate?.verdict} detail={[...(latestGate?.blockingIssues ?? []), ...(latestGate?.warnings ?? [])].slice(0, 2).join(' / ')} />
          <MetricCard title="观众留存" score={latestAudience?.retentionScore} detail={latestAudience?.summary} />
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">自动工作流</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {CREATIVE_WORKFLOW_TEMPLATES.map((tpl) => (
              <Button key={tpl.key} size="sm" variant="outline" onClick={() => runWorkflow(tpl.key)} disabled={busy !== null}>
                <Play className="h-3.5 w-3.5" />
                {tpl.title}
              </Button>
            ))}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">反套路方案</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {variants.length === 0 ? <p className="text-muted-foreground">暂无方案。</p> : variants.slice(0, 6).map((v) => (
                <div key={v.id} className="rounded-md border p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant="outline">{v.mode}</Badge>
                    <span className="font-medium">{v.title}</span>
                  </div>
                  <p className="text-muted-foreground">{v.premise}</p>
                  <p className="mt-1 text-xs">压力机制：{v.pressureMechanism}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">修稿任务单</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {tasks.length === 0 ? <p className="text-muted-foreground">暂无任务。</p> : tasks.slice(0, 8).map((t) => (
                <div key={t.id} className="rounded-md border p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant={t.priority === 'must' ? 'destructive' : 'secondary'}>{t.priority}</Badge>
                    <Badge variant="outline">{t.status}</Badge>
                    <span className="font-medium">{t.title}</span>
                    <Button className="ml-auto" size="sm" variant="ghost" onClick={() => applyTask(t)} disabled={busy !== null || t.status === 'applied'}>
                      应用
                    </Button>
                  </div>
                  <p className="text-muted-foreground">{t.description}</p>
                  <p className="mt-1 text-xs">行动：{t.suggestedAction}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GitCompare className="h-4 w-4" />
              版本与运行记录
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 text-sm xl:grid-cols-3">
            <ListBlock title="内容版本" empty="暂无版本" items={versions.map((v) => `${v.label} · ${new Date(v.createdAt).toLocaleString('zh-CN', { hour12: false })}`)} />
            <ListBlock title="曲线弱点" empty="暂无曲线报告" items={(latestCurve?.weakSpots ?? []).map((s) => s)} />
            <ListBlock title="工作流" empty="暂无运行记录" items={workflows.slice(0, 5).map((w) => `${w.title} · ${w.status}`)} />
          </CardContent>
        </Card>

        <Separator />
      </div>
    </ScrollArea>
  )
}

function MetricCard({ title, score, detail, badge, invert }: { title: string; score?: number; detail?: string; badge?: string; invert?: boolean }) {
  const shown = score == null ? '—' : Math.round(score)
  const variant = score == null ? 'outline' : invert ? scoreVariant(100 - score) : scoreVariant(score)
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>{title}</span>
          {badge && <Badge variant="outline">{badge}</Badge>}
        </div>
        <div className="mb-1 flex items-end gap-2">
          <span className="text-2xl font-semibold">{shown}</span>
          {score != null && <Badge variant={variant}>{score >= 75 ? '高' : score >= 60 ? '中' : '低'}</Badge>}
        </div>
        <p className="line-clamp-2 min-h-[2.5rem] text-xs text-muted-foreground">{detail || '暂无数据'}</p>
      </CardContent>
    </Card>
  )
}

function ListBlock({ title, empty, items }: { title: string; empty: string; items: string[] }) {
  return (
    <div>
      <div className="mb-2 font-medium">{title}</div>
      {items.length === 0 ? (
        <p className="text-muted-foreground">{empty}</p>
      ) : (
        <div className="space-y-1">
          {items.map((it, i) => (
            <div key={i} className="rounded-md bg-muted/40 px-2 py-1 text-xs">
              {it}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
