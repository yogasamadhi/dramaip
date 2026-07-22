import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardList, ExternalLink, ShieldAlert } from 'lucide-react'
import type { PilotProductionTruth, PilotStageState, ProductionCoverage } from '@/lib/pilotProductionTruth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const STAGE_LABEL: Record<PilotStageState, string> = {
  complete: '已完成',
  in_progress: '进行中',
  blocked: '等待前序',
  capability_gap: '能力未安装',
}

type PilotReviewDecision = 'passed' | 'returned'

interface StoredPilotReview {
  decision: PilotReviewDecision
  fingerprint: string
}

function stageVariant(state: PilotStageState): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (state === 'complete') return 'default'
  if (state === 'capability_gap') return 'outline'
  if (state === 'blocked') return 'destructive'
  return 'secondary'
}

function CoverageCard({ coverage }: { coverage: ProductionCoverage }) {
  const percent = coverage.target > 0 ? Math.round((coverage.completed / coverage.target) * 100) : 0
  return (
    <div className="rounded-md border bg-background p-2.5">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{coverage.label}</span><span>{coverage.detail}</span></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} /></div>
    </div>
  )
}

export function PilotProductionPanel({
  adaptationId,
  truth,
  onOpenTaskCenter,
}: {
  adaptationId?: string
  truth: PilotProductionTruth
  onOpenTaskCenter: () => void
}) {
  const expansionKey = adaptationId ? `sdns.pilot-expansion-plan:${adaptationId}` : undefined
  const reviewKey = adaptationId ? `sdns.pilot-review:${adaptationId}` : undefined
  const [expansionPlan, setExpansionPlan] = useState<string | null>(null)
  const [reviewDecision, setReviewDecision] = useState<PilotReviewDecision | null>(null)
  const reviewFingerprint = useMemo(() => JSON.stringify({
    source: truth.source.quality.sourceFingerprint,
    pilot: truth.pilotCoverage.map((coverage) => [coverage.key, coverage.detail]),
  }), [truth.pilotCoverage, truth.source.quality.sourceFingerprint])
  useEffect(() => {
    setExpansionPlan(expansionKey ? window.localStorage.getItem(expansionKey) : null)
  }, [expansionKey])
  useEffect(() => {
    if (!reviewKey) return setReviewDecision(null)
    try {
      const stored = JSON.parse(window.localStorage.getItem(reviewKey) ?? 'null') as StoredPilotReview | null
      setReviewDecision(stored?.fingerprint === reviewFingerprint ? stored.decision : null)
    } catch {
      setReviewDecision(null)
    }
  }, [reviewFingerprint, reviewKey])
  const nextRange = useMemo(() => {
    const from = truth.pilotEpisodeNumbers.at(-1) ?? 0
    const next = Array.from({ length: Math.min(3, Math.max(0, truth.targetEpisodeCount - from)) }, (_, index) => from + index + 1)
    return next
  }, [truth.pilotEpisodeNumbers, truth.targetEpisodeCount])

  function createExpansionPlan() {
    if (!expansionKey || nextRange.length === 0 || !reviewPassed) return
    const plan = `第 ${nextRange.join('、')} 集`
    window.localStorage.setItem(expansionKey, plan)
    setExpansionPlan(plan)
  }

  function decidePilotReview(decision: PilotReviewDecision) {
    if (!reviewKey || !truth.canCreateExpansionPlan) return
    window.localStorage.setItem(reviewKey, JSON.stringify({ decision, fingerprint: reviewFingerprint } satisfies StoredPilotReview))
    setReviewDecision(decision)
  }

  const reviewPassed = truth.canCreateExpansionPlan && reviewDecision === 'passed'

  return (
    <section className="space-y-3 rounded-md border bg-muted/20 p-3" data-pilot-production-plan>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><ClipboardList className="h-4 w-4 text-primary" /><span className="text-sm font-medium">试播计划与真实覆盖率</span></div>
          <p className="mt-1 text-xs text-muted-foreground">当前只编排第 {truth.pilotEpisodeNumbers.join('、')} 集试播；本季 {truth.targetEpisodeCount} 集目标单独计数，不会被一条候选视频冲成完成。</p>
        </div>
        <Button size="sm" variant="outline" onClick={onOpenTaskCenter}><ExternalLink />任务中心</Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {truth.coverage.map((coverage) => <CoverageCard key={coverage.key} coverage={coverage} />)}
      </div>

      <div className="rounded-md border bg-background p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">试播阶段（第 {truth.pilotEpisodeNumbers.join('、')} 集）</span><Badge variant={truth.source.state === 'approved' ? 'default' : 'destructive'}>源版本：{truth.source.state === 'approved' ? '已确认' : truth.source.state === 'stale' ? '已过期' : truth.source.state === 'blocked' ? '被阻塞' : '未检查'}</Badge></div>
        <p className="mt-1 text-xs text-muted-foreground">主要下一步：{truth.nextAction}</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {truth.stages.map((stage) => (
            <div key={stage.key} className="flex items-start gap-2 rounded border p-2.5">
              {stage.state === 'complete' ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : stage.state === 'capability_gap' ? <ShieldAlert className="mt-0.5 h-4 w-4 text-muted-foreground" /> : <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />}
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><span className="text-xs font-medium">{stage.label}</span><Badge variant={stageVariant(stage.state)}>{STAGE_LABEL[stage.state]}</Badge>{stage.completed !== undefined && stage.target !== undefined && <Badge variant="outline">{stage.completed}/{stage.target} 集</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">{stage.detail}</p></div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        <div className="rounded-md border bg-background p-3"><div className="text-xs font-medium">成本与版权</div><p className="mt-1 text-xs text-muted-foreground">{truth.costDetail}</p><p className="mt-1 text-xs text-muted-foreground">{truth.rightsDetail}</p></div>
        <div className="rounded-md border bg-background p-3"><div className="text-xs font-medium">任务状态</div><p className="mt-1 text-xs text-muted-foreground">进行中 {truth.activeTaskCount} 个 · 失败/取消 {truth.failedTaskCount} 个。失败详情和恢复入口在任务中心。</p></div>
      </div>

      <div className="rounded-md border border-amber-500/30 bg-amber-50/40 p-3 text-xs dark:bg-amber-950/10"><div className="font-medium">全部阻塞与限制</div><ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">{truth.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>

      {nextRange.length > 0 && (
        <div className="space-y-2 rounded-md border bg-background p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">人工试播审核</span>
            <Badge variant={reviewPassed ? 'default' : reviewDecision === 'returned' ? 'destructive' : 'outline'}>{reviewPassed ? '审核通过' : reviewDecision === 'returned' ? '已退回返工' : '等待人工判断'}</Badge>
            <span className="flex-1 text-muted-foreground">人工审核仅记录对当前已选试播候选的继续/返工判断；不会把缺失的版权、音频、剪辑或最终交付伪装成已通过。</span>
            {truth.canCreateExpansionPlan && !reviewPassed && <><Button size="sm" variant="outline" onClick={() => decidePilotReview('returned')}>退回返工</Button><Button size="sm" onClick={() => decidePilotReview('passed')}>通过试播</Button></>}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t pt-2">
            <span className="flex-1 text-muted-foreground">{expansionPlan ? `已创建后续生产计划：${expansionPlan}。该操作只复制试播 Profile 到计划，不会生成任何外部/高费用任务。` : reviewPassed ? `试播已通过，可为第 ${nextRange.join('、')} 集创建后续生产计划。` : truth.canCreateExpansionPlan ? '请先由人工选择“通过试播”或“退回返工”；未作判断不会扩展范围。' : '需补齐试播剧本、分镜、每集已选视频候选，并通过当前质量闸门且无失败任务后，才能进入人工审核。'}</span>
            {!expansionPlan && reviewPassed && <Button size="sm" variant="outline" onClick={createExpansionPlan}>复制 Profile 到后续计划</Button>}
          </div>
        </div>
      )}
    </section>
  )
}
