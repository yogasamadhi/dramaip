// HighlightSection —— 爽点分析（ROADMAP v0.3 §3）：对当前章节分析爽点（自动落库）+ 雷达图
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Sparkles, Trash2 } from 'lucide-react'
import type { Chapter, HighlightAnalysis } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RadarChart } from '@/components/charts/RadarChart'

const DIMS: { key: keyof HighlightAnalysis; label: string }[] = [
  { key: 'faceSlap', label: '打脸' },
  { key: 'revenge', label: '复仇' },
  { key: 'identityReveal', label: '身份揭露' },
  { key: 'misunderstandingCleared', label: '误会解除' },
  { key: 'pampering', label: '强宠' },
  { key: 'counterKill', label: '反杀' },
  { key: 'counterattack', label: '逆袭' },
  { key: 'angst', label: '虐恋' },
]

export function HighlightSection({ projectId, chapter, version }: { projectId: string; chapter: Chapter | null; version: number }) {
  const [list, setList] = useState<HighlightAnalysis[]>([])
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setList(await ipc.highlight.list(projectId))
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
    const id = toast.loading('正在分析爽点…')
    try {
      const res = await ipc.ai.run({ projectId, chapterId: chapter.id, taskType: 'analyze_highlights' })
      if (res.ok) {
        toast.success('爽点分析完成', { id })
        await reload()
      } else {
        toast.error('分析失败：' + (res.error ?? '未知错误'), { id })
      }
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!window.confirm('删除该爽点分析？')) return
    await ipc.highlight.remove(id)
    setList((p) => p.filter((h) => h.id !== id))
  }

  const latest = list[0]

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <h2 className="text-sm font-semibold">爽点分析</h2>
        <Badge variant="secondary">{list.length}</Badge>
        <div className="ml-auto">
          <Button size="sm" onClick={analyze} disabled={busy || !chapter}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {chapter ? '分析本章爽点' : '先选择章节'}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-3 p-4">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              还没有爽点分析。选择章节后点击「分析爽点」，AI 会从打脸/复仇/身份揭露/强宠/逆袭/虐恋等 8 个维度评估本章爽点强度。
            </p>
          ) : (
            <>
              {latest && (
                <div className="flex items-center gap-4 rounded-md border p-3">
                  <RadarChart
                    axes={DIMS.map((d) => ({ label: d.label, value: Number(latest[d.key]) }))}
                  />
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {latest.highlightTypes.length > 0 && (
                      <div>
                        <span className="text-foreground font-medium">突出爽点：</span>
                        {latest.highlightTypes.join('、')}
                      </div>
                    )}
                    <p>{latest.summary}</p>
                  </div>
                </div>
              )}
              {list.map((h) => (
                <div key={h.id} className="rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">第 {h.chapterId.slice(0, 6)}…</span>
                    {h.highlightTypes.map((t) => (
                      <Badge key={t} variant="secondary">{t}</Badge>
                    ))}
                    <Button size="icon" variant="ghost" className="ml-auto" title="删除" onClick={() => remove(h.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
