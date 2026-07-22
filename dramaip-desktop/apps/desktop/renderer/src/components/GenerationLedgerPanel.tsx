import { useMemo, useState } from 'react'
import { DatabaseZap, RefreshCw, WalletCards } from 'lucide-react'
import type { GenerationCostEntry, GenerationLineage } from '@sdns/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

function money(value: number | undefined, currency: string | undefined): string {
  return value === undefined ? '未知' : `${currency ?? '未标币种'} ${value.toFixed(2)}`
}

function statusLabel(status: GenerationCostEntry['status']): string {
  if (status === 'actual') return '已录实际'
  if (status === 'estimated') return '本地估算'
  if (status === 'unavailable') return '不可得'
  return '未知'
}

export function GenerationLedgerPanel({
  lineages,
  costs,
  onUpdateCost,
}: {
  lineages: GenerationLineage[]
  costs: GenerationCostEntry[]
  onUpdateCost: (id: string, patch: { actualCost?: number; currency?: string; actualCostNote?: string }) => Promise<void>
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const summary = useMemo(() => {
    const complete = lineages.filter((lineage) => lineage.completeness === 'complete').length
    const adopted = lineages.filter((lineage) => lineage.adoptedOutputId).length
    const estimated = costs.filter((cost) => cost.estimatedCost !== undefined).length
    const actual = costs.filter((cost) => cost.actualCost !== undefined).length
    const totals = new Map<string, { estimated: number; actual: number }>()
    for (const cost of costs) {
      const currency = cost.currency ?? '未标币种'
      const total = totals.get(currency) ?? { estimated: 0, actual: 0 }
      if (cost.estimatedCost !== undefined) total.estimated += cost.estimatedCost
      if (cost.actualCost !== undefined) total.actual += cost.actualCost
      totals.set(currency, total)
    }
    return { complete, adopted, estimated, actual, totals: [...totals.entries()] }
  }, [costs, lineages])

  async function saveActual(cost: GenerationCostEntry) {
    const raw = drafts[cost.id]?.trim()
    if (!raw) return
    const actualCost = Number(raw)
    if (!Number.isFinite(actualCost) || actualCost < 0) return
    setSaving(cost.id)
    try {
      await onUpdateCost(cost.id, { actualCost, currency: cost.currency })
      setDrafts((current) => ({ ...current, [cost.id]: '' }))
    } finally {
      setSaving(null)
    }
  }

  return (
    <section className="space-y-3 rounded-md border bg-muted/20 p-3" data-generation-ledger>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex items-center gap-2 text-sm font-medium"><DatabaseZap className="h-4 w-4 text-primary" />生产谱系与成本账本</div><p className="mt-1 text-xs text-muted-foreground">冻结提交时的源版本、Provider 能力、参数、seed 与引用资产；不会保存 API Key、原始响应或媒体二进制。</p></div>
        <Badge variant="outline">本地账本</Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4 text-xs">
        <div className="rounded border bg-background p-2.5">完整谱系 <strong className="float-right">{summary.complete}/{lineages.length}</strong></div>
        <div className="rounded border bg-background p-2.5">已采用产物 <strong className="float-right">{summary.adopted}</strong></div>
        <div className="rounded border bg-background p-2.5">有本地估算 <strong className="float-right">{summary.estimated}/{costs.length}</strong></div>
        <div className="rounded border bg-background p-2.5">已录实际 <strong className="float-right">{summary.actual}/{costs.length}</strong></div>
      </div>
      {summary.totals.length > 0 && <p className="rounded border bg-background p-2.5 text-xs text-muted-foreground">项目汇总：{summary.totals.map(([currency, total]) => `${currency} 预计 ${total.estimated.toFixed(2)} · 实际 ${total.actual.toFixed(2)}`).join('；')}（未录入或不可得的费用不会按 0 计入。）</p>}
      {costs.length === 0 ? <p className="rounded border bg-background p-3 text-xs text-muted-foreground">还没有可记账的媒体任务。旧任务会在数据库升级时以“源/费用未知”的兼容谱系保留，不会被补成 0 元或已完成。</p> : (
        <div className="overflow-hidden rounded border bg-background">
          {costs.slice(0, 8).map((cost) => <div key={cost.id} className="flex flex-wrap items-center gap-2 border-b p-2.5 text-xs last:border-b-0">
            <WalletCards className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">{cost.mediaType === 'video' ? '视频' : cost.mediaType}</span>
            <Badge variant={cost.status === 'actual' ? 'default' : 'outline'}>{statusLabel(cost.status)}</Badge>
            <span className="text-muted-foreground">预计：{money(cost.estimatedCost, cost.currency)} · 实际：{money(cost.actualCost, cost.currency)}</span>
            {cost.actualCost === undefined && <div className="ml-auto flex items-center gap-1"><input className="h-7 w-20 rounded border bg-background px-2" type="number" min="0" step="0.01" inputMode="decimal" placeholder="实际费用" value={drafts[cost.id] ?? ''} onChange={(event) => setDrafts((current) => ({ ...current, [cost.id]: event.target.value }))} aria-label="录入实际费用" /><Button size="sm" variant="outline" disabled={saving === cost.id || !drafts[cost.id]?.trim()} onClick={() => void saveActual(cost)}>{saving === cost.id ? <RefreshCw className="animate-spin" /> : '记账'}</Button></div>}
          </div>)}
        </div>
      )}
      {lineages.length > 0 && <p className="text-xs text-muted-foreground">最近谱系：{lineages.slice(0, 3).map((lineage) => `${lineage.mediaType}/${lineage.taskKind} · ${lineage.completeness === 'complete' ? '可复现快照' : lineage.completeness === 'partial' ? '部分信息' : '历史未知'}`).join('；')}</p>}
    </section>
  )
}
