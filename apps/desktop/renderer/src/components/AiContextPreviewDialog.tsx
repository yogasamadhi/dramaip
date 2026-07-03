import type { AiContextPreview } from '@sdns/core'
import type { AiContextControlGroup, AiContextControlKey, AiContextControlMode } from '@/lib/aiPreflightContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'

interface Props {
  open: boolean
  preview: AiContextPreview | null
  onClose: () => void
  onExport?: () => void
  controlGroups?: AiContextControlGroup[]
  onControlModeChange?: (key: AiContextControlKey, id: string, mode: AiContextControlMode) => void
  onRun?: () => void
  runLabel?: string
  running?: boolean
}

export function AiContextPreviewDialog({
  open,
  preview,
  onClose,
  onExport,
  controlGroups,
  onControlModeChange,
  onRun,
  runLabel = '执行 AI',
  running = false,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose() }}>
      <DialogContent className="flex max-h-[88vh] max-w-4xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>上下文预览</DialogTitle>
        </DialogHeader>
        {preview && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">{preview.taskType}</Badge>
            <Badge variant={preview.status === 'success' ? 'default' : 'destructive'}>
              {preview.status === 'success' ? '成功' : '失败'}
            </Badge>
            <Badge variant="secondary">{preview.model}</Badge>
            <Badge variant="secondary">约 {preview.estimatedInputTokens.toLocaleString()} tokens</Badge>
            {preview.redacted && <Badge variant="secondary">已脱敏</Badge>}
          </div>
        )}
        {controlGroups?.length ? (
          <ScrollArea className="max-h-52 rounded-md border">
            <div className="space-y-3 p-3">
              {controlGroups.map((group) => (
                <div key={group.key} className="space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground">{group.title}</div>
                  {group.items.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 rounded bg-muted/30 px-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{item.label}</div>
                        {item.detail && <div className="truncate text-[11px] text-muted-foreground">{item.detail}</div>}
                      </div>
                      {(['pinned', 'auto', 'excluded'] as const).map((mode) => (
                        <Button
                          key={mode}
                          size="sm"
                          variant={item.mode === mode ? 'default' : 'outline'}
                          className="h-7 px-2 text-[11px]"
                          onClick={() => onControlModeChange?.(item.key, item.id, mode)}
                        >
                          {modeLabel(mode)}
                        </Button>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : null}
        <ScrollArea className="min-h-0 flex-1 rounded-md border">
          <div className="space-y-4 p-4">
            {preview?.sections.length ? (
              preview.sections.map((section) => (
                <div key={section.title} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{section.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {section.charCount.toLocaleString()} 字符 · 约 {section.estimatedTokens.toLocaleString()} tokens
                    </span>
                  </div>
                  <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-3 text-xs leading-5">
                    {section.excerpt || '（空）'}
                  </pre>
                </div>
              ))
            ) : (
              <p className="p-4 text-sm text-muted-foreground">暂无上下文。</p>
            )}
          </div>
        </ScrollArea>
        <DialogFooter>
          {onExport && (
            <Button variant="outline" onClick={onExport}>
              导出 JSON
            </Button>
          )}
          {onRun && (
            <Button onClick={onRun} disabled={running}>
              {running ? '执行中…' : runLabel}
            </Button>
          )}
          <Button onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function modeLabel(mode: AiContextControlMode): string {
  if (mode === 'pinned') return '固定'
  if (mode === 'excluded') return '排除'
  return '自动'
}
