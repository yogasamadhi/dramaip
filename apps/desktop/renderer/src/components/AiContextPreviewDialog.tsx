import type { AiContextPreview } from '@sdns/core'
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
}

export function AiContextPreviewDialog({ open, preview, onClose, onExport }: Props) {
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
          <Button onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
