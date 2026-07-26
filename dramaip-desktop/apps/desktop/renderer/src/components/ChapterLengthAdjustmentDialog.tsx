import { Loader2, Scale } from 'lucide-react'
import type { ChapterLengthStatus } from '@/lib/chapterLength'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  open: boolean
  status: ChapterLengthStatus | null
  adjusting: boolean
  onAdjust: () => void
  onKeep: () => void
  onDiscard: () => void
}

/** 首稿完成后的字数决策：保留原文，或基于该首稿做定向增删。 */
export function ChapterLengthAdjustmentDialog({ open, status, adjusting, onAdjust, onKeep, onDiscard }: Props) {
  const isLong = status?.direction === 'long'
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !adjusting) onDiscard() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            <DialogTitle>章节字数需要确认</DialogTitle>
          </div>
          <DialogDescription>
            首稿已完整生成，但当前字数未落在本章目标范围内。你可以保留原文，或让 AI 基于这份首稿定向调整篇幅。
          </DialogDescription>
        </DialogHeader>

        {status && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">当前字数</span>
              <strong className={isLong ? 'text-destructive' : 'text-amber-700 dark:text-amber-300'}>{status.count} 字</strong>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">目标 / 允许范围</span>
              <span>{status.target} 字 / {status.minimum}–{status.maximum} 字</span>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              选择“调整字数”后，会把刚生成的完整首稿交给 AI 增删，不会从大纲重新生成，也会要求保留核心剧情、人物关系和关键转折。
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={onDiscard} disabled={adjusting}>放弃本次首稿</Button>
          <Button type="button" variant="outline" onClick={onKeep} disabled={adjusting}>保留当前正文</Button>
          <Button type="button" onClick={onAdjust} disabled={adjusting || !status}>
            {adjusting ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Scale />}
            调整字数
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
