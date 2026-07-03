import type { AdaptationReadinessItem, AdaptationReadinessSummary } from '@/lib/adaptationReadiness'
import { Badge } from '@/components/ui/badge'

function readinessBadge(item: AdaptationReadinessItem): { label: string; variant: 'default' | 'secondary' | 'destructive' } {
  if (item.severity === 'ready') return { label: '就绪', variant: 'default' }
  if (item.severity === 'warning') return { label: '提醒', variant: 'secondary' }
  return { label: '风险', variant: 'destructive' }
}

export function AdaptationReadinessPanel({ readiness }: { readiness: AdaptationReadinessSummary }) {
  return (
    <div className="rounded-md border p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">小说就绪检查</div>
          <div className="text-xs text-muted-foreground">改编前确认章节、人物、大纲、记忆和质量风险</div>
        </div>
        <Badge variant={readiness.riskCount > 0 ? 'destructive' : readiness.warningCount > 0 ? 'secondary' : 'default'}>
          {readiness.readyCount}/{readiness.items.length}
        </Badge>
      </div>
      <div className="space-y-2">
        {readiness.items.map((item) => {
          const badge = readinessBadge(item)
          return (
            <div key={item.key} className="flex items-start justify-between gap-3 rounded-md bg-muted/30 px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">{item.title}</div>
                <div className="text-xs text-muted-foreground">{item.detail}</div>
              </div>
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </div>
          )
        })}
      </div>
    </div>
  )
}
