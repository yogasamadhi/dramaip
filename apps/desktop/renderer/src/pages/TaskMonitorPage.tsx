import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Ban, Bot, Clapperboard, Loader2, RefreshCw, TimerReset } from 'lucide-react'
import type { LongTask, LongTaskStatus } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'

const STATUS_LABEL: Record<LongTaskStatus, string> = {
  pending: '排队中',
  running: '运行中',
  success: '成功',
  failed: '失败',
  canceled: '已取消',
}

const STATUS_VARIANT: Record<LongTaskStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  pending: 'secondary',
  running: 'outline',
  success: 'default',
  failed: 'destructive',
  canceled: 'secondary',
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function TaskKindIcon({ task }: { task: LongTask }) {
  if (task.kind === 'video') return <Clapperboard className="h-4 w-4 text-primary" />
  return <Bot className="h-4 w-4 text-primary" />
}

export function TaskMonitorPage() {
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<LongTask[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  async function reload() {
    setLoading(true)
    try {
      setTasks(await ipc.longTask.list())
    } catch (error) {
      toast.error('任务列表读取失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  async function cancelTask(task: LongTask) {
    if (!window.confirm(`取消任务「${task.title}」？`)) return
    setBusy(task.id)
    try {
      const result = await ipc.longTask.cancel(task.id)
      if (!result.ok) {
        toast.error('取消失败：' + (result.error ?? '未知错误'))
        return
      }
      toast.success('任务已取消')
      await reload()
    } finally {
      setBusy(null)
    }
  }

  async function retryTask(task: LongTask) {
    setBusy(task.id)
    try {
      const result = await ipc.longTask.retry(task.id)
      if (!result.ok) {
        toast.error('重试失败：' + (result.error ?? '未知错误'))
        return
      }
      toast.success('已重新提交任务')
      await reload()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/settings')}>
          <ArrowLeft />
        </Button>
        <TimerReset className="h-5 w-5" />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">任务队列</h1>
          <p className="truncate text-sm text-muted-foreground">AI 与视频长任务</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          刷新
        </Button>
      </header>

      <main className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="mx-auto max-w-5xl p-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">最近任务</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    加载中...
                  </div>
                ) : tasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无任务。</p>
                ) : (
                  <div className="space-y-3">
                    {tasks.map((task) => (
                      <div
                        key={task.id}
                        className="grid gap-3 rounded-md border p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <TaskKindIcon task={task} />
                            <span className="truncate text-sm font-medium">{task.title}</span>
                            <Badge variant={STATUS_VARIANT[task.status]}>{STATUS_LABEL[task.status]}</Badge>
                            <Badge variant="outline">{task.kind === 'video' ? '视频' : 'AI'}</Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>更新：{formatTime(task.updatedAt)}</span>
                            {task.taskType && <span>{task.taskType}</span>}
                            {task.relatedEntityId && <span className="truncate">关联：{task.relatedEntityId}</span>}
                          </div>
                          {task.errorMessage && <div className="mt-2 text-xs text-destructive">{task.errorMessage}</div>}
                        </div>
                        <div className="flex gap-2">
                          {task.status === 'failed' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void retryTask(task)}
                              disabled={busy === task.id}
                            >
                              {busy === task.id ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                              重试
                            </Button>
                          )}
                          {(task.status === 'pending' || task.status === 'running') && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void cancelTask(task)}
                              disabled={busy === task.id}
                            >
                              {busy === task.id ? <Loader2 className="animate-spin" /> : <Ban />}
                              取消
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
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
