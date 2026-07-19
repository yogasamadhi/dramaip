// AiDashboardSection —— AI 短剧小说仪表盘（ROADMAP v0.3 §1）：全书趋势折线图 + 生成趋势报告
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Sparkles, Trash2 } from 'lucide-react'
import type { DramaTrendReport, Evaluation } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { confirmAction, deleteConfirmation } from '@/components/ConfirmActionDialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TrendChart, type TrendSeries } from '@/components/charts/TrendChart'

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b']

function trendSeries(report: DramaTrendReport | undefined): TrendSeries[] {
  if (!report) return []
  return [
    { key: 'hook', label: '钩子', color: COLORS[0], data: report.hookTrend },
    { key: 'conflict', label: '冲突', color: COLORS[1], data: report.conflictTrend },
    { key: 'reversal', label: '反转', color: COLORS[2], data: report.reversalTrend },
    { key: 'emotion', label: '情绪', color: COLORS[3], data: report.emotionTrend },
    { key: 'cliffhanger', label: '悬念', color: COLORS[4], data: report.cliffhangerTrend },
    { key: 'visualization', label: '画面', color: COLORS[5], data: report.visualizationTrend },
    { key: 'feasibility', label: 'AI视频可行', color: COLORS[6], data: report.aiVideoFeasibilityTrend },
    { key: 'characterConsistency', label: '角色一致', color: COLORS[7], data: report.characterConsistencyTrend },
    { key: 'shotClarity', label: '镜头清晰', color: COLORS[8], data: report.shotClarityTrend },
  ]
}

export function AiDashboardSection({ projectId }: { projectId: string }) {
  const [report, setReport] = useState<DramaTrendReport | undefined>(undefined)
  const [evaluations, setEvaluations] = useState<Evaluation[]>([])
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    const [r, evs] = await Promise.all([
      ipc.dramaTrend.get(projectId),
      ipc.evaluation.list(projectId),
    ])
    setReport(r)
    setEvaluations(evs)
  }, [projectId])

  useEffect(() => {
    void reload()
  }, [reload])

  async function analyzeTrend() {
    setBusy(true)
    const id = toast.loading('正在分析全书趋势…')
    try {
      const res = await ipc.ai.run({ projectId, taskType: 'analyze_project_ai_drama_trend' })
      if (res.ok) {
        toast.success('趋势报告已生成', { id })
        await reload()
      } else {
        toast.error('分析失败：' + (res.error ?? '未知错误'), { id })
      }
    } finally {
      setBusy(false)
    }
  }

  // 无 AI 趋势报告时，用历史评分兜底画一条「总分趋势」
  const scoreFallback: TrendSeries[] = report
    ? []
    : evaluations.length
      ? [
          {
            key: 'total',
            label: '历史评分总分',
            color: COLORS[5],
            data: evaluations.map((e) => e.totalScore),
          },
        ]
      : []

  const series = trendSeries(report).length ? trendSeries(report) : scoreFallback

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <h2 className="text-sm font-semibold">AI 短剧小说仪表盘</h2>
        <div className="ml-auto flex items-center gap-2">
          {report && (
            <Button
              size="icon"
              variant="ghost"
              title="删除趋势报告"
              onClick={async () => {
                if (await confirmAction(deleteConfirmation('趋势报告'))) {
                  await ipc.dramaTrend.remove(report.id)
                  setReport(undefined)
                }
              }}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
          <Button size="sm" onClick={analyzeTrend} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            生成全书趋势报告
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          <div>
            <div className="mb-1 text-sm font-medium">
              {report ? 'AI 全书趋势（按章节）' : scoreFallback.length ? '历史评分趋势' : '全书趋势'}
            </div>
            {series.length ? (
              <TrendChart series={series} />
            ) : (
              <p className="text-sm text-muted-foreground">
                还没有趋势数据。点击「生成全书趋势报告」，AI 会统计钩子/冲突/反转/情绪/画面/AI视频可行性等 9 个维度的逐章趋势。
              </p>
            )}
          </div>

          {report?.summary && (
            <div>
              <div className="mb-1 text-sm font-medium">趋势小结</div>
              <p className="text-sm text-muted-foreground">{report.summary}</p>
            </div>
          )}

          <div>
            <div className="mb-1 text-sm font-medium">评分统计</div>
            {evaluations.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无评分记录。在「AI短剧评分」中对章节评分后这里会显示统计。</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 text-xs">
                {(() => {
                  const avg = (k: keyof Evaluation) =>
                    Math.round(evaluations.reduce((s, e) => s + (e[k] as number), 0) / evaluations.length)
                  return (
                    <>
                      <Stat label="评分数" value={String(evaluations.length)} />
                      <Stat label="平均总分" value={String(avg('totalScore'))} />
                      <Stat label="平均画面" value={String(avg('visualizationScore'))} />
                    </>
                  )
                })()}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2 text-center">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  )
}
