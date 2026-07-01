import { useMemo, useState } from 'react'
import { Check, Loader2, Minus, Plus } from 'lucide-react'
import type { TextDiffPreviewPayload } from '@sdns/core'
import { TASK_TYPE_LABELS } from '@sdns/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

type DiffKind = 'same' | 'add' | 'remove'

interface DiffLine {
  kind: DiffKind
  text: string
}

interface Props {
  open: boolean
  preview: TextDiffPreviewPayload | null
  onAdopt: () => Promise<void>
  onCancel: () => void
}

const TARGET_LABEL: Record<TextDiffPreviewPayload['targetKind'], string> = {
  chapter: '章节',
  script: '剧本',
  shot: '镜头 Prompt',
}

export function TextDiffPreviewDialog({ open, preview, onAdopt, onCancel }: Props) {
  const [saving, setSaving] = useState(false)
  const diff = useMemo(
    () => buildLineDiff(preview?.currentContent ?? '', preview?.nextContent ?? ''),
    [preview?.currentContent, preview?.nextContent],
  )
  const added = diff.filter((line) => line.kind === 'add').length
  const removed = diff.filter((line) => line.kind === 'remove').length

  async function handleAdopt() {
    setSaving(true)
    try {
      await onAdopt()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !saving) onCancel()
      }}
    >
      <DialogContent className="flex max-h-[88vh] max-w-4xl flex-col overflow-hidden">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>AI 变更预览</DialogTitle>
            {preview && <Badge variant="secondary">{TARGET_LABEL[preview.targetKind]}</Badge>}
            {preview && <Badge variant="outline">{TASK_TYPE_LABELS[preview.taskType] ?? preview.taskType}</Badge>}
          </div>
          <DialogDescription>{preview?.title ?? '文本差异'}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 text-emerald-600">
            <Plus className="h-3.5 w-3.5" />
            {added}
          </span>
          <span className="inline-flex items-center gap-1 text-destructive">
            <Minus className="h-3.5 w-3.5" />
            {removed}
          </span>
        </div>

        <ScrollArea className="min-h-0 flex-1 rounded-md border">
          <div className="divide-y text-xs font-mono leading-relaxed">
            {diff.length === 0 ? (
              <div className="px-3 py-6 text-center font-sans text-muted-foreground">无文本变化</div>
            ) : (
              diff.map((line, index) => (
                <div
                  key={`${index}:${line.kind}`}
                  className={cn(
                    'grid grid-cols-[2.25rem_1fr] gap-2 px-3 py-1',
                    line.kind === 'add' && 'bg-emerald-50 text-emerald-900',
                    line.kind === 'remove' && 'bg-red-50 text-red-900',
                    line.kind === 'same' && 'text-muted-foreground',
                  )}
                >
                  <span className="select-none text-center">
                    {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ''}
                  </span>
                  <span className="whitespace-pre-wrap break-words">{line.text || ' '}</span>
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleAdopt} disabled={saving || !preview}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />}
            采用并保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function buildLineDiff(previous: string, next: string): DiffLine[] {
  if (previous === next) return []
  const oldLines = splitLines(previous)
  const newLines = splitLines(next)
  if (oldLines.length * newLines.length > 40_000) {
    return [
      ...oldLines.map((text) => ({ kind: 'remove' as const, text })),
      ...newLines.map((text) => ({ kind: 'add' as const, text })),
    ]
  }

  const dp = Array.from({ length: oldLines.length + 1 }, () => Array<number>(newLines.length + 1).fill(0))
  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = newLines.length - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      out.push({ kind: 'same', text: oldLines[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'remove', text: oldLines[i] })
      i++
    } else {
      out.push({ kind: 'add', text: newLines[j] })
      j++
    }
  }
  while (i < oldLines.length) out.push({ kind: 'remove', text: oldLines[i++] })
  while (j < newLines.length) out.push({ kind: 'add', text: newLines[j++] })
  return out
}

function splitLines(value: string): string[] {
  if (!value) return []
  return value.replace(/\r\n/g, '\n').split('\n')
}
