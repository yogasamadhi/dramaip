// MemorySection —— 章节记忆面板（ROADMAP v0.2 §1）：列表 + 对当前章节生成记忆（自动落库）
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Sparkles, Trash2 } from 'lucide-react'
import type { Chapter, ChapterMemory } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { confirmAction, deleteConfirmation } from '@/components/ConfirmActionDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'

function arr(m: ChapterMemory, key: 'importantEvents' | 'characterChanges' | 'revealedSecrets' | 'keyVisualElements'): string[] {
  return m[key] ?? []
}

export function MemorySection({ projectId, chapter }: { projectId: string; chapter: Chapter | null }) {
  const [list, setList] = useState<ChapterMemory[]>([])
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    if (!chapter) {
      setList([])
      return
    }
    const item = await ipc.chapterMemory.getByChapter(projectId, chapter.id)
    setList(item ? [item] : [])
  }, [chapter, projectId])

  useEffect(() => {
    void reload()
  }, [reload])

  async function generate() {
    if (!chapter) {
      toast.error('请先在「章节」中选择一个章节')
      return
    }
    setBusy(true)
    const id = toast.loading('正在生成章节记忆…')
    try {
      const res = await ipc.ai.run({ projectId, chapterId: chapter.id, taskType: 'summarize_chapter' })
      if (res.ok) {
        toast.success('章节记忆已生成', { id })
        await reload()
      } else {
        toast.error('生成失败：' + (res.error ?? '未知错误'), { id })
      }
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!(await confirmAction(deleteConfirmation('该章节记忆')))) return
    await ipc.chapterMemory.remove(id)
    setList((p) => p.filter((m) => m.id !== id))
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <h2 className="text-sm font-semibold">章节记忆</h2>
        <Badge variant="secondary">{list.length}</Badge>
        <div className="ml-auto">
          <Button size="sm" onClick={generate} disabled={busy || !chapter}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {chapter ? `对「${chapter.title}」生成记忆` : '先选择章节'}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-3 p-4">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              还没有章节记忆。选择一个章节后点击「生成记忆」，AI 会提取每章的摘要、事件、人物变化与视觉元素，供长篇写作时调用。
            </p>
          ) : (
            list.map((m) => (
              <div key={m.id} className="rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{m.summary.slice(0, 24)}{m.summary.length > 24 ? '…' : ''}</span>
                  <Button size="icon" variant="ghost" className="ml-auto" title="删除" onClick={() => remove(m.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{m.summary}</p>
                {arr(m, 'importantEvents').length > 0 && (
                  <div className="mt-2 text-xs">
                    <span className="text-muted-foreground">重要事件：</span>
                    {arr(m, 'importantEvents').join('；')}
                  </div>
                )}
                {arr(m, 'characterChanges').length > 0 && (
                  <div className="mt-1 text-xs">
                    <span className="text-muted-foreground">人物变化：</span>
                    {arr(m, 'characterChanges').join('；')}
                  </div>
                )}
                {arr(m, 'keyVisualElements').length > 0 && (
                  <div className="mt-1 text-xs">
                    <span className="text-muted-foreground">关键视觉：</span>
                    {arr(m, 'keyVisualElements').join('；')}
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
