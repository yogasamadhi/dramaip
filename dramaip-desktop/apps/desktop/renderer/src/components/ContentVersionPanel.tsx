import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { GitCompare, History, Loader2, Minus, Plus, RefreshCw, RotateCcw } from 'lucide-react'
import type { ContentVersion } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { buildSegmentedTextDiff } from '@/lib/segmentedTextDiff'

interface Props {
  projectId?: string
  targetKind: ContentVersion['targetKind']
  targetId?: string
  currentContent: string
  title: string
  className?: string
  restoreDisabled?: boolean
  versionScope?: 'content' | 'structure' | 'all'
  onRestored?: () => void | Promise<void>
}

const SOURCE_LABEL: Record<ContentVersion['source'], string> = {
  ai_overwrite: 'AI 覆写',
  adopt_preview: '采用预览',
  revision_task: '修稿任务',
  manual_checkpoint: '检查点',
  restore: '恢复',
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function ContentVersionPanel({
  targetKind,
  targetId,
  currentContent,
  title,
  className,
  restoreDisabled,
  versionScope = 'content',
  onRestored,
}: Props) {
  const [versions, setVersions] = useState<ContentVersion[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)

  async function reload() {
    if (!targetId) {
      setVersions([])
      setSelectedId('')
      return
    }
    setLoading(true)
    try {
      const list = (await ipc.contentVersion.listByTarget(targetKind, targetId)).filter((version) =>
        matchesVersionScope(version, versionScope),
      )
      setVersions(list)
      setSelectedId((current) => (list.some((v) => v.id === current) ? current : (list[0]?.id ?? '')))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [targetKind, targetId, versionScope])

  const selected = versions.find((version) => version.id === selectedId)
  const diff = useMemo(
    () => buildSegmentedTextDiff(selected?.content ?? '', currentContent),
    [selected?.content, currentContent],
  )
  const added = diff.filter((block) => block.kind === 'add' || block.kind === 'replace').length
  const removed = diff.filter((block) => block.kind === 'remove' || block.kind === 'replace').length

  async function restoreSelected() {
    if (!selected) return
    if (restoreDisabled) return
    const confirmed = window.confirm(`确定恢复版本「${selected.label}」？恢复前会自动保存当前内容。`)
    if (!confirmed) return

    setRestoring(true)
    try {
      const result = await ipc.contentVersion.restore(selected.id)
      if (!result.ok) {
        toast.error('恢复失败：' + (result.error ?? '未知错误'))
        return
      }
      toast.success('已恢复版本')
      await reload()
      await onRestored?.()
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className={cn('rounded-md border bg-background p-3', className)}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <History className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">{title}</span>
        <Badge variant="secondary">{versions.length}</Badge>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto h-7 w-7"
          onClick={() => void reload()}
          disabled={loading}
          title="刷新版本"
        >
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        </Button>
      </div>

      {versions.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无内容版本。</p>
      ) : (
        <div className="space-y-3">
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {versions.map((version) => (
                <SelectItem key={version.id} value={version.id}>
                  {version.label} · {formatTime(version.createdAt)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selected && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{SOURCE_LABEL[selected.source] ?? selected.source}</Badge>
                <span>{formatTime(selected.createdAt)}</span>
                <span className="inline-flex items-center gap-1 text-emerald-600">
                  <Plus className="h-3.5 w-3.5" />
                  {added}
                </span>
                <span className="inline-flex items-center gap-1 text-destructive">
                  <Minus className="h-3.5 w-3.5" />
                  {removed}
                </span>
              </div>

              <ScrollArea className="max-h-56 rounded-md border">
                <div className="divide-y text-[11px] font-mono leading-relaxed">
                  {diff.length === 0 ? (
                    <div className="px-3 py-5 text-center font-sans text-muted-foreground">当前内容与所选版本一致</div>
                  ) : (
                    diff.map((block) => (
                      <div
                        key={block.id}
                        className={cn(
                          'grid grid-cols-[1.75rem_1fr] gap-2 px-2 py-1',
                          (block.kind === 'add' || block.kind === 'replace') && 'bg-emerald-500/10',
                          block.kind === 'remove' && 'bg-destructive/10 text-destructive',
                          block.kind === 'same' && 'text-muted-foreground',
                        )}
                      >
                        <span className="select-none text-center">
                          {block.kind === 'add' ? '+' : block.kind === 'remove' ? '-' : block.kind === 'replace' ? '±' : ''}
                        </span>
                        <span className="whitespace-pre-wrap break-words">{block.kind === 'replace' ? `${block.before}\n→ ${block.after}` : (block.after || block.before || ' ')}</span>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>

              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <GitCompare className="h-3.5 w-3.5" />
                  当前对比
                </span>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void restoreSelected()}
                  disabled={restoring || restoreDisabled}
                  title={restoreDisabled ? '请先保存当前草稿' : '恢复此版本'}
                >
                  {restoring ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                  恢复
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function matchesVersionScope(version: ContentVersion, scope: Props['versionScope']): boolean {
  if (scope === 'all') return true
  const structure = typeof version.meta?.structureSnapshot === 'string'
  return scope === 'structure' ? structure : !structure
}
