import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Bug, Download, Eye, Loader2, RefreshCw } from 'lucide-react'
import type { AiContextPreview, AiRun } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { AiContextPreviewDialog } from '@/components/AiContextPreviewDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function AiDiagnosticsPage() {
  const navigate = useNavigate()
  const [runs, setRuns] = useState<AiRun[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<AiContextPreview | null>(null)

  async function reload() {
    setLoading(true)
    try {
      setRuns(await ipc.aiRun.listRecent())
    } catch (error) {
      toast.error('读取 AI 记录失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  async function openPreview(run: AiRun) {
    setBusy(run.id)
    try {
      const result = await ipc.aiRun.contextPreview(run.id)
      if (!result.ok || !result.preview) {
        toast.error('上下文读取失败：' + (result.error ?? '未知错误'))
        return
      }
      setPreview(result.preview)
    } finally {
      setBusy(null)
    }
  }

  async function exportDebug(runId: string) {
    setBusy(runId)
    try {
      const result = await ipc.aiRun.exportDebugContext(runId)
      if (result.saved) toast.success('已导出调试 JSON')
      else if (result.error) toast.error(result.error)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/settings')}>
          <ArrowLeft />
        </Button>
        <Bug className="h-5 w-5" />
        <h1 className="text-lg font-semibold">AI 诊断</h1>
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            刷新
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="mx-auto max-w-6xl p-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">最近 AI 调用</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    加载中...
                  </div>
                ) : runs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无 AI 调用记录。</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="py-2 pr-3">时间</th>
                          <th className="pr-3">任务</th>
                          <th className="pr-3">模型</th>
                          <th className="pr-3">状态</th>
                          <th className="pr-3 text-right">Tokens</th>
                          <th className="pr-3 text-right">耗时</th>
                          <th className="py-2 text-right">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {runs.map((run) => (
                          <tr key={run.id} className="border-b align-top">
                            <td className="py-2 pr-3 text-xs text-muted-foreground">{formatTime(run.createdAt)}</td>
                            <td className="pr-3">{run.type}</td>
                            <td className="pr-3 text-xs">{run.model}</td>
                            <td className="pr-3">
                              <Badge variant={run.status === 'success' ? 'default' : 'destructive'}>
                                {run.status === 'success' ? '成功' : '失败'}
                              </Badge>
                            </td>
                            <td className="pr-3 text-right text-xs">{run.tokenUsage ?? '—'}</td>
                            <td className="pr-3 text-right text-xs">{run.latencyMs != null ? `${run.latencyMs}ms` : '—'}</td>
                            <td className="py-2">
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void openPreview(run)}
                                  disabled={busy === run.id}
                                >
                                  {busy === run.id ? <Loader2 className="animate-spin" /> : <Eye />}
                                  预览
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void exportDebug(run.id)}
                                  disabled={busy === run.id}
                                >
                                  <Download />
                                  导出
                                </Button>
                              </div>
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
      <AiContextPreviewDialog
        open={preview !== null}
        preview={preview}
        onClose={() => setPreview(null)}
        onExport={preview ? () => void exportDebug(preview.aiRunId) : undefined}
      />
    </div>
  )
}
