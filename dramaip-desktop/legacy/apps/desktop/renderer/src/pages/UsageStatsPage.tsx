// v1.0 Token / 耗时统计页（ROADMAP v1.0-3）：按模型汇总 ai_runs 的 token 与耗时
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, BarChart3 } from 'lucide-react'
import type { AiRunSummaryRow } from '@/lib/ipc'
import type { AiBudgetSettings, AiRunUsageSummaryRow } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

export function UsageStatsPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<AiRunSummaryRow[]>([])
  const [usageRows, setUsageRows] = useState<AiRunUsageSummaryRow[]>([])
  const [budget, setBudget] = useState<AiBudgetSettings | null>(null)

  useEffect(() => {
    void (async () => {
      const [summary, usage, settings] = await Promise.all([
        ipc.aiRun.summarize(),
        ipc.aiRun.summarizeUsage(),
        ipc.model.getBudgetSettings(),
      ])
      setRows(summary)
      setUsageRows(usage)
      setBudget(settings)
    })()
  }, [])

  const totalTokens = rows.reduce((s, r) => s + r.totalTokens, 0)
  const totalLatency = rows.reduce((s, r) => s + r.totalLatencyMs, 0)
  const totalSuccess = rows.reduce((s, r) => s + r.successCount, 0)
  const totalFailed = rows.reduce((s, r) => s + r.failedCount, 0)
  const totalCost = usageRows.reduce((s, r) => s + r.estimatedCost, 0)

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/settings')}>
          <ArrowLeft />
        </Button>
        <BarChart3 className="h-5 w-5" />
        <h1 className="text-lg font-semibold">Token 与耗时统计</h1>
        <p className="text-sm text-muted-foreground">汇总所有 AI 调用记录（按模型分组）</p>
      </header>

      <main className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="mx-auto max-w-4xl space-y-6 p-6">
            {/* 总览 */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">总 Token</div>
                  <div className="text-2xl font-semibold">{totalTokens.toLocaleString()}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">总耗时</div>
                  <div className="text-2xl font-semibold">{formatMs(totalLatency)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">成功调用</div>
                  <div className="text-2xl font-semibold text-success">{totalSuccess}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">失败调用</div>
                  <div className="text-2xl font-semibold text-destructive">{totalFailed}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">估算费用</div>
                  <div className="text-xl font-semibold">{formatCost(totalCost, budget?.currency ?? 'USD')}</div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">按模型明细</CardTitle>
              </CardHeader>
              <CardContent>
                {rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无 AI 调用记录。</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3">模型</th>
                        <th className="pr-3">Provider</th>
                        <th className="pr-3 text-right">Token</th>
                        <th className="pr-3 text-right">耗时</th>
                        <th className="pr-3 text-right">成功</th>
                        <th className="pr-3 text-right">失败</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.model} className="border-b align-top">
                          <td className="py-2 pr-3 font-medium">{r.model}</td>
                          <td className="pr-3 text-xs text-muted-foreground">{r.provider}</td>
                          <td className="pr-3 text-right">{r.totalTokens.toLocaleString()}</td>
                          <td className="pr-3 text-right">{formatMs(r.totalLatencyMs)}</td>
                          <td className="pr-3 text-right">
                            <Badge variant="secondary">{r.successCount}</Badge>
                          </td>
                          <td className="pr-3 text-right">
                            {r.failedCount > 0 ? (
                              <Badge variant="destructive">{r.failedCount}</Badge>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">按模型 / 任务组</CardTitle>
              </CardHeader>
              <CardContent>
                {usageRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无 AI 调用记录。</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="py-2 pr-3">任务组</th>
                          <th className="pr-3">模型</th>
                          <th className="pr-3 text-right">Token</th>
                          <th className="pr-3 text-right">费用</th>
                          <th className="pr-3 text-right">成功</th>
                          <th className="pr-3 text-right">失败</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usageRows.map((r) => (
                          <tr key={`${r.taskGroup}-${r.model}-${r.provider}`} className="border-b align-top">
                            <td className="py-2 pr-3">{r.taskGroupLabel}</td>
                            <td className="pr-3 text-xs text-muted-foreground">{r.model}</td>
                            <td className="pr-3 text-right">{r.totalTokens.toLocaleString()}</td>
                            <td className="pr-3 text-right">{formatCost(r.estimatedCost, budget?.currency ?? 'USD')}</td>
                            <td className="pr-3 text-right">
                              <Badge variant="secondary">{r.successCount}</Badge>
                            </td>
                            <td className="pr-3 text-right">
                              {r.failedCount > 0 ? <Badge variant="destructive">{r.failedCount}</Badge> : <span className="text-muted-foreground">0</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      </main>
    </div>
  )
}

function formatCost(value: number, currency: string): string {
  return `${value.toFixed(4)} ${currency}`
}
