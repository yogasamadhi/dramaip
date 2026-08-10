// ConsistencySection —— 一致性检查（ROADMAP v0.2 §7）：对当前章节检查，展示问题/建议（不落库）
import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, ShieldCheck, Sparkles } from 'lucide-react'
import type { Chapter } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'

interface ConsistencyData {
  issues: string[]
  suggestions: string[]
}

export function ConsistencySection({ projectId, chapter }: { projectId: string; chapter: Chapter | null }) {
  const [result, setResult] = useState<ConsistencyData | null>(null)
  const [busy, setBusy] = useState(false)

  async function check() {
    if (!chapter) {
      toast.error('请先在「章节」中选择一个章节')
      return
    }
    setBusy(true)
    const id = toast.loading('正在检查一致性…')
    try {
      const res = await ipc.ai.run({ projectId, chapterId: chapter.id, taskType: 'check_consistency' })
      if (res.ok && res.result) {
        setResult(res.result.data as ConsistencyData)
        toast.success('一致性检查完成', { id })
      } else {
        toast.error('检查失败：' + (res.error ?? '未知错误'), { id })
      }
    } finally {
      setBusy(false)
    }
  }

  const issueCount = result?.issues.length ?? 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">一致性检查</h2>
        {result && <Badge variant={issueCount > 0 ? 'destructive' : 'secondary'}>{issueCount} 个问题</Badge>}
        <div className="ml-auto">
          <Button size="sm" onClick={check} disabled={busy || !chapter}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {chapter ? `对「${chapter.title}」检查` : '先选择章节'}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          {!result ? (
            <p className="text-sm text-muted-foreground">
              选择章节后点击「检查」，AI 会对照人物设定、人物状态、视觉档案、世界观、已发生事件、已揭露秘密与伏笔，检查当前章节是否存在前后不一致。
            </p>
          ) : (
            <>
              <div>
                <div className="mb-1 text-sm font-medium">发现的问题</div>
                {result.issues.length === 0 ? (
                  <p className="text-sm text-muted-foreground">未发现一致性问题。</p>
                ) : (
                  <ul className="list-inside list-disc space-y-1 text-sm">
                    {result.issues.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                )}
              </div>
              {result.suggestions.length > 0 && (
                <div>
                  <div className="mb-1 text-sm font-medium">修正建议</div>
                  <ul className="list-inside list-disc space-y-1 text-sm">
                    {result.suggestions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
