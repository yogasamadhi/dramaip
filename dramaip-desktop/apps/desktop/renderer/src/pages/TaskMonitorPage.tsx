import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Ban, Bot, Clapperboard, ListChecks, Loader2, RefreshCw, TimerReset } from 'lucide-react'
import type { BatchTaskProgress, LongTask, LongTaskStatus } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { confirmAction } from '@/components/ConfirmActionDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  isLongTaskActive,
  LONG_TASK_STATUS_LABEL,
  longTaskCloudPreflightMessage,
  longTaskRecoveryMessage,
} from '@/lib/taskStatus'

const STATUS_LABEL: Record<LongTaskStatus, string> = LONG_TASK_STATUS_LABEL

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
  if (task.kind === 'batch') return <ListChecks className="h-4 w-4 text-primary" />
  if (task.kind === 'video') return <Clapperboard className="h-4 w-4 text-primary" />
  return <Bot className="h-4 w-4 text-primary" />
}

function taskKindLabel(task: LongTask): string {
  if (task.kind === 'batch') return '批量'
  return task.kind === 'video' ? '视频' : 'AI'
}

function batchProgress(task: LongTask): BatchTaskProgress | null {
  const output = task.output as unknown
  if (!output || typeof output !== 'object') return null
  const progress = output as Partial<BatchTaskProgress>
  if (task.kind !== 'batch' || !Array.isArray(progress.items)) return null
  return progress as BatchTaskProgress
}

export function TaskMonitorPage() {
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<LongTask[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const reload = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    try {
      const listed = await ipc.longTask.list()
      const remoteIds = listed
        .filter((task) => task.kind === 'video' && task.status === 'pending' && task.relatedEntityId)
        .map((task) => task.relatedEntityId as string)
      await Promise.allSettled(remoteIds.map((id) => ipc.videoTask.checkStatus(id)))
      setTasks(remoteIds.length > 0 ? await ipc.longTask.list() : listed)
    } catch (error) {
      if (showLoading) toast.error('任务列表读取失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    const timer = window.setInterval(() => void reload(false), 5_000)
    return () => window.clearInterval(timer)
  }, [reload])

  async function cancelTask(task: LongTask) {
    if (!(await confirmAction({ title: `取消任务「${task.title}」？`, description: '任务会收到取消请求；已写入的创作结果会保留，可在任务中心查看并按支持情况重试。', confirmLabel: '取消任务', destructive: true }))) return
    setBusy(task.id)
    try {
      const result = await ipc.longTask.cancel(task.id)
      if (!result.ok) {
        toast.error('取消失败：' + (result.error ?? '未知错误'))
        return
      }
      toast.success('任务已取消')
      await reload(false)
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
      await reload(false)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" aria-label="返回设置" onClick={() => navigate('/settings')}>
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
                            <Badge variant="outline">{taskKindLabel(task)}</Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>更新：{formatTime(task.updatedAt)}</span>
                            {task.taskType && <span>{task.taskType}</span>}
                            {task.relatedEntityId && <span className="truncate">关联：{task.relatedEntityId}</span>}
                          </div>
                          {longTaskRecoveryMessage(task) && (
                            <div className="mt-2 text-xs text-muted-foreground">{longTaskRecoveryMessage(task)}</div>
                          )}
                          {longTaskCloudPreflightMessage(task) && (
                            <div className="mt-2 text-xs text-muted-foreground">{longTaskCloudPreflightMessage(task)}</div>
                          )}
                          {task.errorMessage && <div className="mt-2 text-xs text-destructive">{task.errorMessage}</div>}
                          <BatchProgressBlock progress={batchProgress(task)} />
                        </div>
                        <div className="flex gap-2">
                          {(task.status === 'failed' || (task.kind === 'batch' && task.status === 'canceled')) && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void retryTask(task)}
                              disabled={busy === task.id}
                            >
                              {busy === task.id ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                              {task.kind === 'batch' ? '继续' : '重试'}
                            </Button>
                          )}
                          {isLongTaskActive(task) && (
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

function BatchProgressBlock({ progress }: { progress: BatchTaskProgress | null }) {
  if (!progress) return null
  const settled = progress.success + progress.skipped
  const percent = progress.total > 0 ? Math.round((settled / progress.total) * 100) : 100
  const failedItems = progress.items.filter((item) => item.status === 'failed')
  return (
    <div className="mt-3 space-y-2 text-xs">
      <div className="h-1.5 overflow-hidden rounded bg-muted">
        <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        <span>完成 {settled} / {progress.total}</span>
        <span>成功 {progress.success}</span>
        {progress.skipped > 0 && <span>跳过 {progress.skipped}</span>}
        {progress.failed > 0 && <span className="text-destructive">失败 {progress.failed}</span>}
        {progress.running > 0 && <span>运行中 {progress.running}</span>}
      </div>
      {failedItems.length > 0 && (
        <div className="space-y-1">
          {failedItems.slice(0, 4).map((item) => (
            <div key={item.key} className="truncate text-destructive">
              {item.label}：{item.error ?? '未知错误'}
            </div>
          ))}
          {failedItems.length > 4 && (
            <div className="text-muted-foreground">还有 {failedItems.length - 4} 项失败</div>
          )}
        </div>
      )}
    </div>
  )
}
