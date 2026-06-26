// EvaluationSection —— AI 短剧适配度评分列表 + 对当前章节评分（§5.3 / §11.7）
// 评分由 AI 自动落库（save-result.node），本组件负责触发与展示。
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Sparkles } from 'lucide-react'
import type { Chapter, Evaluation } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'

const DIMS: { key: keyof Evaluation; label: string }[] = [
  { key: 'hookScore', label: '开篇钩子' },
  { key: 'conflictScore', label: '冲突' },
  { key: 'reversalScore', label: '反转' },
  { key: 'emotionScore', label: '情绪' },
  { key: 'visualizationScore', label: '画面感' },
  { key: 'aiVideoFeasibilityScore', label: 'AI视频可行' },
  { key: 'characterConsistencyScore', label: '角色一致性' },
  { key: 'shotClarityScore', label: '镜头清晰度' },
  { key: 'cliffhangerScore', label: '结尾悬念' },
  { key: 'adaptationDifficultyScore', label: '改编难度' },
]

interface Props {
  projectId: string
  chapter: Chapter | null
}

export function EvaluationSection({ projectId, chapter }: Props) {
  const [list, setList] = useState<Evaluation[]>([])
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setList(await ipc.evaluation.list(projectId))
  }, [projectId])

  useEffect(() => {
    void reload()
  }, [reload])

  async function evaluate() {
    if (!chapter) {
      toast.error('请先在「章节」中选择一个章节')
      return
    }
    setBusy(true)
    const id = toast.loading('正在评分…')
    try {
      const res = await ipc.ai.run({ projectId, chapterId: chapter.id, taskType: 'evaluate_ai_drama_fit' })
      if (res.ok) {
        toast.success('评分完成', { id })
        await reload()
      } else {
        toast.error('评分失败：' + (res.error ?? '未知错误'), { id })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <h2 className="text-sm font-semibold">AI 短剧适配度评分</h2>
        <Badge variant="secondary">{list.length}</Badge>
        <div className="ml-auto">
          <Button size="sm" onClick={evaluate} disabled={busy || !chapter}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {chapter ? `对「${chapter.title}」评分` : '先选择章节'}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-3 p-4">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有评分。选择一个章节后点击「评分」。</p>
          ) : (
            list.map((ev) => (
              <div key={ev.id} className="rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-primary">{Math.round(ev.totalScore)}</span>
                  <span className="text-xs text-muted-foreground">总分 / 100</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(ev.createdAt).toLocaleString('zh-CN', { hour12: false })}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                  {DIMS.map((d) => (
                    <div key={d.key} className="flex items-center gap-1">
                      <span className="text-muted-foreground">{d.label}</span>
                      <span className="font-medium">{Math.round(Number(ev[d.key]))}</span>
                    </div>
                  ))}
                </div>
                {ev.issues.length > 0 && (
                  <div className="mt-2">
                    <div className="text-xs font-medium text-muted-foreground">问题</div>
                    <ul className="list-inside list-disc text-xs">
                      {ev.issues.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {ev.suggestions.length > 0 && (
                  <div className="mt-2">
                    <div className="text-xs font-medium text-muted-foreground">建议</div>
                    <ul className="list-inside list-disc text-xs">
                      {ev.suggestions.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
