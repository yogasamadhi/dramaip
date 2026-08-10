// AI 调用记录的虚拟化表格：大量记录时只渲染可见行，避免 100+ 行全量渲染卡顿。
import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { AiRun } from '@sdns/core'
import { Badge } from '@/components/ui/badge'

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

export function AiRunsTable({ runs }: { runs: AiRun[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: runs.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 10,
  })

  if (runs.length === 0) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">暂无 AI 调用记录。</p>
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="h-full overflow-auto">
      <div className="p-4">
        {/* 表头：固定，不虚拟化 */}
        <div className="grid grid-cols-[10rem_8rem_1fr_5rem_5rem_5rem] gap-2 border-b pb-2 text-xs text-muted-foreground">
          <span>时间</span>
          <span>类型</span>
          <span>模型</span>
          <span>状态</span>
          <span>耗时</span>
          <span>Tokens</span>
        </div>
        {/* 虚拟化行容器 */}
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const r = runs[virtualRow.index]
            return (
              <div
                key={r.id}
                className="absolute left-0 top-0 grid w-full grid-cols-[10rem_8rem_1fr_5rem_5rem_5rem] gap-2 border-b py-2 text-sm"
                style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
              >
                <span className="text-xs text-muted-foreground">{formatTime(r.createdAt)}</span>
                <span className="truncate">{r.type}</span>
                <span className="truncate text-xs">{r.model}</span>
                <span>
                  <Badge variant={r.status === 'success' ? 'default' : 'destructive'}>
                    {r.status === 'success' ? '成功' : '失败'}
                  </Badge>
                </span>
                <span className="text-xs">{r.latencyMs != null ? `${r.latencyMs}ms` : '—'}</span>
                <span className="text-xs">{r.tokenUsage ?? '—'}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
