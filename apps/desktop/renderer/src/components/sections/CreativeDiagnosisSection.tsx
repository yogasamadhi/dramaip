import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Eye, GitCompare, Loader2, PauseCircle, Play, RefreshCw, RotateCcw, Save, Sparkles, Wand2 } from 'lucide-react'
import type {
  AdaptationProject,
  AntiTropeVariant,
  AudienceSimulation,
  Chapter,
  ContentVersion,
  FreshnessReport,
  NarrativeCurveReport,
  QualityGateReport,
  RevisionTask,
  TextDiffPreviewPayload,
  WorkflowRun,
  WorkflowRunStep,
} from '@sdns/core'
import { CREATIVE_WORKFLOW_TEMPLATES, TASK_TYPE_LABELS } from '@sdns/core'
import { ipc, type AiTaskInput } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { TextDiffPreviewDialog } from '@/components/TextDiffPreviewDialog'
import { revisionTaskReviewInstruction, supportsRevisionTaskPreview } from '@/lib/revisionTaskLoop'

interface Props {
  projectId: string
  chapter: Chapter | null
}

function scoreVariant(score: number): 'default' | 'secondary' | 'destructive' {
  if (score >= 75) return 'default'
  if (score >= 60) return 'secondary'
  return 'destructive'
}

const WORKFLOW_STATUS_LABEL: Record<WorkflowRun['status'], string> = {
  pending: '等待',
  running: '运行中',
  paused: '已暂停',
  success: '完成',
  failed: '失败',
}

const WORKFLOW_STATUS_VARIANT: Record<WorkflowRun['status'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  running: 'secondary',
  paused: 'outline',
  success: 'default',
  failed: 'destructive',
}

export function CreativeDiagnosisSection({ projectId, chapter }: Props) {
  const navigate = useNavigate()
  const [freshness, setFreshness] = useState<FreshnessReport[]>([])
  const [variants, setVariants] = useState<AntiTropeVariant[]>([])
  const [tasks, setTasks] = useState<RevisionTask[]>([])
  const [versions, setVersions] = useState<ContentVersion[]>([])
  const [gates, setGates] = useState<QualityGateReport[]>([])
  const [audiences, setAudiences] = useState<AudienceSimulation[]>([])
  const [curves, setCurves] = useState<NarrativeCurveReport[]>([])
  const [workflows, setWorkflows] = useState<WorkflowRun[]>([])
  const [adaptations, setAdaptations] = useState<AdaptationProject[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [textPreview, setTextPreview] = useState<TextDiffPreviewPayload | null>(null)
  const [pendingRevisionTask, setPendingRevisionTask] = useState<RevisionTask | null>(null)

  const target = useMemo(
    () => (chapter ? { kind: 'chapter', id: chapter.id, label: chapter.title } : { kind: 'project', id: projectId, label: '项目整体' }),
    [chapter, projectId],
  )

  const reload = useCallback(async () => {
    const [fr, at, rt, cv, qg, au, nc, wf, ad] = await Promise.all([
      ipc.creative.listFreshness(projectId),
      ipc.creative.listAntiTropeByTarget(target.kind, target.id),
      ipc.revisionTask.list(projectId),
      ipc.contentVersion.listByTarget(target.kind, target.id),
      ipc.creative.listQualityGates(projectId),
      ipc.creative.listAudienceSimulations(projectId),
      ipc.creative.listNarrativeCurves(projectId),
      ipc.workflow.list(projectId),
      ipc.adaptationProject.listByProject(projectId),
    ])
    setFreshness(fr)
    setVariants(at)
    setTasks(rt)
    setVersions(cv)
    setGates(qg)
    setAudiences(au)
    setCurves(nc)
    setWorkflows(wf)
    setAdaptations(ad)
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

  const latestAdaptation = adaptations[adaptations.length - 1]

  async function runWorkflow(templateKey: string, pauseAfterStep = false) {
    setBusy(templateKey)
    const tid = toast.loading('正在运行工作流…')
    try {
      const res = await ipc.workflow.run({
        templateKey,
        projectId,
        chapterId: chapter?.id,
        adaptationProjectId: latestAdaptation?.id,
        pauseAfterStep,
      })
      if (res.ok) {
        toast.success(res.result?.status === 'paused' ? '工作流已暂停，可检查结果后继续' : '工作流完成', { id: tid })
        await reload()
      } else {
        toast.error('工作流失败：' + (res.error ?? '未知错误'), { id: tid })
        await reload()
      }
    } finally {
      setBusy(null)
    }
  }

  async function resumeWorkflow(run: WorkflowRun) {
    setBusy(run.id)
    const tid = toast.loading('正在继续工作流…')
    try {
      const res = await ipc.workflow.resume({ runId: run.id })
      if (res.ok) {
        toast.success(res.result?.status === 'paused' ? '工作流已暂停，可继续检查' : '工作流已继续', { id: tid })
      } else {
        toast.error('继续失败：' + (res.error ?? '未知错误'), { id: tid })
      }
      await reload()
    } finally {
      setBusy(null)
    }
  }

  async function retryWorkflowStep(run: WorkflowRun, step: WorkflowRunStep) {
    setBusy(`${run.id}:${step.key}`)
    const tid = toast.loading('正在重试工作流步骤…')
    try {
      const res = await ipc.workflow.retryStep({ runId: run.id, stepKey: step.key })
      if (res.ok) {
        toast.success(res.result?.status === 'paused' ? '步骤已完成，工作流暂停' : '步骤已重试', { id: tid })
      } else {
        toast.error('重试失败：' + (res.error ?? '未知错误'), { id: tid })
      }
      await reload()
    } finally {
      setBusy(null)
    }
  }

  function openWorkflowStep(step: WorkflowRunStep) {
    if (step.longTaskId) {
      navigate('/settings/tasks')
      return
    }
    if (step.videoTaskIds?.length && latestAdaptation) {
      navigate(`/adaptations/${latestAdaptation.id}/video`)
      return
    }
    if (step.aiRunId) {
      navigate(`/projects/${projectId}?section=ai-runs`)
      return
    }
    toast.message(step.resultSummary || step.error || '该步骤暂无可跳转结果')
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

  async function previewTask(task: RevisionTask) {
    setBusy(task.id)
    const tid = toast.loading('正在生成修稿预览…')
    try {
      const res = await ipc.revisionTask.preview(task.id)
      if (res.ok && res.preview) {
        setPendingRevisionTask(task)
        setTextPreview(res.preview)
        toast.success('已生成修稿预览', { id: tid })
      } else {
        toast.error('预览失败：' + (res.error ?? '未知错误'), { id: tid })
      }
      await reload()
    } finally {
      setBusy(null)
    }
  }

  async function adoptRevisionPreview() {
    if (!textPreview || !pendingRevisionTask) return
    const res = await ipc.ai.applyResult({
      projectId,
      adaptationProjectId: textPreview.adaptationProjectId,
      taskType: textPreview.taskType,
      data: textPreview,
    })
    if (!res.ok) {
      toast.error('采用失败：' + (res.error ?? '未知错误'))
      return
    }
    const completed = await ipc.revisionTask.complete(pendingRevisionTask.id)
    if (!completed.ok) {
      toast.error('任务状态更新失败：' + (completed.error ?? '未知错误'))
      return
    }
    toast.success('修稿任务已采用')
    setTextPreview(null)
    setPendingRevisionTask(null)
    await reload()
  }

  function cancelRevisionPreview() {
    setTextPreview(null)
    setPendingRevisionTask(null)
  }

  async function recheckTask(task: RevisionTask) {
    await runTask('run_quality_gate', revisionTaskReviewInstruction(task))
  }

  const latestFreshness = freshness[0]
  const latestGate = gates[0]
  const latestAudience = audiences[0]
  const latestCurve = curves[0]

  return (
    <>
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
          <CardContent className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {CREATIVE_WORKFLOW_TEMPLATES.map((tpl) => (
              <div key={tpl.key} className="rounded-md border p-3">
                <div className="mb-2 flex items-start gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{tpl.title}</div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{tpl.description}</p>
                  </div>
                  <Badge className="ml-auto shrink-0" variant="outline">{tpl.steps.length} 步</Badge>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => runWorkflow(tpl.key)} disabled={busy !== null}>
                    {busy === tpl.key ? <Loader2 className="animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                    运行
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => runWorkflow(tpl.key, true)} disabled={busy !== null}>
                    <PauseCircle className="h-3.5 w-3.5" />
                    单步
                  </Button>
                </div>
              </div>
            ))}
            {!latestAdaptation && (
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground xl:col-span-2">
                小说到视频流水线需要已有改编项目；未创建时可先到改编页建立分集容器。
              </div>
            )}
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
                    <div className="ml-auto flex gap-1">
                      {t.status === 'applied' ? (
                        <Button size="sm" variant="ghost" onClick={() => void recheckTask(t)} disabled={busy !== null}>
                          复检
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => void previewTask(t)} disabled={busy !== null || !supportsRevisionTaskPreview(t)}>
                          {busy === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                          预览
                        </Button>
                      )}
                    </div>
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
            <WorkflowRunsBlock
              workflows={workflows.slice(0, 5)}
              busy={busy}
              onResume={resumeWorkflow}
              onRetryStep={retryWorkflowStep}
              onOpenStep={openWorkflowStep}
            />
          </CardContent>
        </Card>

        <Separator />
        </div>
      </ScrollArea>
      <TextDiffPreviewDialog
        open={textPreview !== null}
        preview={textPreview}
        onAdopt={adoptRevisionPreview}
        onCancel={cancelRevisionPreview}
      />
    </>
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

function WorkflowRunsBlock({
  workflows,
  busy,
  onResume,
  onRetryStep,
  onOpenStep,
}: {
  workflows: WorkflowRun[]
  busy: string | null
  onResume: (run: WorkflowRun) => void
  onRetryStep: (run: WorkflowRun, step: WorkflowRunStep) => void
  onOpenStep: (step: WorkflowRunStep) => void
}) {
  return (
    <div className="xl:col-span-1">
      <div className="mb-2 font-medium">工作流</div>
      {workflows.length === 0 ? (
        <p className="text-muted-foreground">暂无运行记录</p>
      ) : (
        <div className="space-y-2">
          {workflows.map((run) => (
            <div key={run.id} className="rounded-md border p-2">
              <div className="mb-2 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{run.title}</span>
                <Badge variant={WORKFLOW_STATUS_VARIANT[run.status]}>{WORKFLOW_STATUS_LABEL[run.status]}</Badge>
              </div>
              <div className="space-y-1">
                {run.steps.map((step) => (
                  <div key={step.key} className="rounded-md bg-muted/40 px-2 py-1">
                    <div className="flex items-center gap-1.5">
                      <Badge className="shrink-0" variant={WORKFLOW_STATUS_VARIANT[step.status]}>
                        {WORKFLOW_STATUS_LABEL[step.status]}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate text-xs">{step.label}</span>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onOpenStep(step)} title="查看结果">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      {step.status === 'failed' && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => onRetryStep(run, step)}
                          disabled={busy === `${run.id}:${step.key}`}
                          title="重试步骤"
                        >
                          {busy === `${run.id}:${step.key}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                    </div>
                    {(step.resultSummary || step.error) && (
                      <p className={`mt-1 line-clamp-2 text-[11px] ${step.error ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {step.error ?? step.resultSummary}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {(run.status === 'paused' || run.status === 'failed') && (
                <Button className="mt-2 h-8 w-full" size="sm" variant="outline" onClick={() => onResume(run)} disabled={busy === run.id}>
                  {busy === run.id ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  {run.status === 'paused' ? '继续' : '从失败步继续'}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
