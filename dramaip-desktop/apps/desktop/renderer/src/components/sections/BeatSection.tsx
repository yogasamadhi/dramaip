// BeatSection —— 戏剧节拍（ROADMAP v0.3 §2）：对当前章节分析节拍（自动落库）+ 列表
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Sparkles, Trash2 } from 'lucide-react'
import type { Beat, Chapter } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { confirmAction, deleteConfirmation } from '@/components/ConfirmActionDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'

const TYPE_LABEL: Record<Beat['type'], string> = {
  hook: '钩子', conflict: '冲突', reversal: '反转', reveal: '揭露',
  emotion: '情绪', payoff: '回收', cliffhanger: '悬念', visual: '画面',
}

export function BeatSection({ projectId, chapter, version }: { projectId: string; chapter: Chapter | null; version: number }) {
  const [list, setList] = useState<Beat[]>([])
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    if (!chapter) {
      setList([])
      return
    }
    setList(await ipc.beat.listByChapter(chapter.id))
  }, [chapter])

  useEffect(() => {
    void reload()
  }, [reload, version])

  async function analyze() {
    if (!chapter) {
      toast.error('请先在「章节」中选择一个章节')
      return
    }
    setBusy(true)
    const id = toast.loading('正在分析戏剧节拍…')
    try {
      const res = await ipc.ai.run({ projectId, chapterId: chapter.id, taskType: 'analyze_beats' })
      if (res.ok) {
        toast.success('戏剧节拍已生成', { id })
        await reload()
      } else {
        toast.error('分析失败：' + (res.error ?? '未知错误'), { id })
      }
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!(await confirmAction(deleteConfirmation('该节拍')))) return
    await ipc.beat.remove(id)
    setList((p) => p.filter((b) => b.id !== id))
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <h2 className="text-sm font-semibold">戏剧节拍</h2>
        <Badge variant="secondary">{list.length}</Badge>
        <div className="ml-auto">
          <Button size="sm" onClick={analyze} disabled={busy || !chapter}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {chapter ? '分析本章节拍' : '先选择章节'}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-2 p-4">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              还没有节拍。选择章节后点击「分析节拍」，AI 会把章节拆成钩子/冲突/反转/情绪/画面等戏剧节拍，为后续分集分镜做准备。
            </p>
          ) : (
            list.map((b) => (
              <article key={b.id} className="rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{TYPE_LABEL[b.type]}</Badge>
                  <span className="font-medium">{b.title}</span>
                  <span className="text-xs text-muted-foreground">戏剧 {b.dramaValue} · 画面 {b.visualValue}</span>
                  <Button size="icon" variant="ghost" className="ml-auto" title="删除" onClick={() => remove(b.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{b.description}</p>
              </article>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
