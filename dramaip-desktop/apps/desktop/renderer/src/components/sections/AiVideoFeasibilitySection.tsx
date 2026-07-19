// AiVideoFeasibilitySection —— AI 视频可行性分析（ROADMAP v0.3 §4）：对当前章节分析（自动落库）
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Sparkles, Trash2 } from 'lucide-react'
import type { AiVideoFeasibilityReport, Chapter } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { confirmAction, deleteConfirmation } from '@/components/ConfirmActionDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RadarChart } from '@/components/charts/RadarChart'

const DIMS: { key: keyof AiVideoFeasibilityReport; label: string }[] = [
  { key: 'characterCountScore', label: '角色数量' },
  { key: 'actionComplexityScore', label: '动作复杂度' },
  { key: 'interactionDensityScore', label: '互动密度' },
  { key: 'sceneStabilityScore', label: '场景稳定' },
  { key: 'visualClarityScore', label: '画面清晰' },
  { key: 'characterConsistencyScore', label: '角色一致' },
  { key: 'generatableScore', label: '可生成' },
  { key: 'verticalSuitabilityScore', label: '竖屏适合' },
]

function scoreColor(score: number): 'default' | 'secondary' | 'destructive' {
  if (score >= 70) return 'default'
  if (score >= 40) return 'secondary'
  return 'destructive'
}

export function AiVideoFeasibilitySection({ projectId, chapter, version }: { projectId: string; chapter: Chapter | null; version: number }) {
  const [list, setList] = useState<AiVideoFeasibilityReport[]>([])
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setList(await ipc.feasibility.list(projectId))
  }, [projectId])

  useEffect(() => {
    void reload()
  }, [reload, version])

  async function analyze() {
    if (!chapter) {
      toast.error('请先在「章节」中选择一个章节')
      return
    }
    setBusy(true)
    const id = toast.loading('正在分析 AI 视频可行性…')
    try {
      const res = await ipc.ai.run({ projectId, chapterId: chapter.id, taskType: 'analyze_ai_video_feasibility' })
      if (res.ok) {
        toast.success('可行性分析完成', { id })
        await reload()
      } else {
        toast.error('分析失败：' + (res.error ?? '未知错误'), { id })
      }
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!(await confirmAction(deleteConfirmation('该可行性报告')))) return
    await ipc.feasibility.remove(id)
    setList((p) => p.filter((f) => f.id !== id))
  }

  const latest = list[0]

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <h2 className="text-sm font-semibold">AI 视频可行性</h2>
        <Badge variant="secondary">{list.length}</Badge>
        <div className="ml-auto">
          <Button size="sm" onClick={analyze} disabled={busy || !chapter}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {chapter ? '分析本章可行性' : '先选择章节'}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-3 p-4">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              还没有可行性报告。选择章节后点击「分析可行性」，AI 会从角色数量、动作复杂度、场景稳定、画面清晰、竖屏适合等维度评估是否适合生成 AI 视频。
            </p>
          ) : (
            <>
              {latest && (
                <div className="flex items-center gap-4 rounded-md border p-3">
                  <RadarChart axes={DIMS.map((d) => ({ label: d.label, value: Number(latest[d.key]) }))} />
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div>
                      <span className="text-foreground font-medium">综合可行：</span>
                      <Badge variant={scoreColor(latest.overallScore)}>{latest.overallScore}</Badge>
                    </div>
                    {latest.risks.length > 0 && (
                      <div>
                        <span className="text-foreground font-medium">风险：</span>
                        {latest.risks.join('；')}
                      </div>
                    )}
                    {latest.suggestions.length > 0 && (
                      <div>
                        <span className="text-foreground font-medium">建议：</span>
                        {latest.suggestions.join('；')}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {list.map((f) => (
                <div key={f.id} className="flex items-center gap-2 rounded-md border p-3">
                  <Badge variant={scoreColor(f.overallScore)}>综合 {f.overallScore}</Badge>
                  <span className="text-xs text-muted-foreground">角色一致 {f.characterConsistencyScore} · 竖屏 {f.verticalSuitabilityScore}</span>
                  <Button size="icon" variant="ghost" className="ml-auto" title="删除" onClick={() => remove(f.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
