import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Ban, CheckCircle2, ChevronRight, CircleAlert, Clapperboard, Loader2, TimerReset } from 'lucide-react'
import type { LongTask } from '@sdns/core'
import { toast } from 'sonner'
import { ipc } from '@/lib/ipc'
import {
  isLongTaskActive,
  LONG_TASK_STATUS_LABEL,
  longTaskCloudPreflightMessage,
  longTaskRecoveryMessage,
} from '@/lib/taskStatus'
import { Button } from '@/components/ui/button'

const POLL_INTERVAL_MS = 5_000

/** A persistent, page-independent view of active and recently settled long tasks. */
export function TaskDock() {
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<LongTask[]>([])
  const [open, setOpen] = useState(false)
  const [canceling, setCanceling] = useState<string | null>(null)
  const previousStatus = useRef(new Map<string, LongTask['status']>())
  const loaded = useRef(false)

  const reload = useCallback(async () => {
    try {
      const listed = await ipc.longTask.list()
      const remoteIds = listed
        .filter((task) => task.kind === 'video' && task.status === 'pending' && task.relatedEntityId)
        .map((task) => task.relatedEntityId as string)
      await Promise.allSettled(remoteIds.map((id) => ipc.videoTask.checkStatus(id)))
      const refreshed = remoteIds.length > 0 ? await ipc.longTask.list() : listed

      if (loaded.current) announceSettledTaskTransitions(previousStatus.current, refreshed)
      previousStatus.current = new Map(refreshed.map((task) => [task.id, task.status]))
      loaded.current = true
      setTasks(refreshed)
    } catch {
      // 任务入口不能因为一次后台轮询失败打断当前创作；任务中心可手动重试读取。
    }
  }, [])

  useEffect(() => {
    void reload()
    const timer = window.setInterval(() => void reload(), POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [reload])

  const active = tasks.filter(isLongTaskActive)
  const recent = [...active, ...tasks.filter((task) => !isLongTaskActive(task))].slice(0, 3)
  const current = active[0]

  async function cancelTask(task: LongTask) {
    setCanceling(task.id)
    try {
      const result = await ipc.longTask.cancel(task.id)
      if (!result.ok) toast.error('取消失败：' + (result.error ?? '未知错误'))
      else toast.success('任务已取消')
      await reload()
    } finally {
      setCanceling(null)
    }
  }

  function openTaskCenter() {
    setOpen(false)
    navigate('/settings/tasks')
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2" aria-live="polite">
      {open && (
        <section className="studio-rise-in w-[min(22rem,calc(100vw-2rem))] rounded-xl border bg-background p-3 shadow-xl" aria-label="任务状态详情">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">任务状态</p>
              <p className="text-xs text-muted-foreground">跨页面持续显示，关闭应用后可恢复</p>
            </div>
            <Button variant="ghost" size="sm" onClick={openTaskCenter}>
              任务中心
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          {recent.length === 0 ? (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">暂无进行中的任务。</p>
          ) : (
            <div className="space-y-2">
              {recent.map((task) => (
                <div key={task.id} className="rounded-lg border px-3 py-2">
                  <div className="flex items-start gap-2">
                    <TaskStatusIcon task={task} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium">{task.title}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{LONG_TASK_STATUS_LABEL[task.status]}</span>
                      </div>
                      {(longTaskRecoveryMessage(task) ?? longTaskCloudPreflightMessage(task) ?? task.errorMessage) && (
                        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{longTaskRecoveryMessage(task) ?? longTaskCloudPreflightMessage(task) ?? task.errorMessage}</p>
                      )}
                    </div>
                    {isLongTaskActive(task) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        aria-label={`取消任务：${task.title}`}
                        onClick={() => void cancelTask(task)}
                        disabled={canceling === task.id}
                      >
                        {canceling === task.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      <button
        type="button"
        className="flex h-11 items-center gap-2 rounded-full border bg-background px-4 text-sm font-medium shadow-lg transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={current ? `任务状态：${current.title}，${LONG_TASK_STATUS_LABEL[current.status]}` : '任务状态：暂无进行中的任务'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <TimerReset className={current ? 'studio-ai-pulse h-4 w-4 text-primary' : 'h-4 w-4 text-muted-foreground'} />
        <span>{current ? `${active.length} 个任务进行中` : '任务状态'}</span>
      </button>
    </div>
  )
}

function TaskStatusIcon({ task }: { task: LongTask }) {
  if (isLongTaskActive(task)) return task.kind === 'video' ? <Clapperboard className="h-4 w-4 text-primary" /> : <Loader2 className="h-4 w-4 animate-spin text-primary" />
  if (task.status === 'success') return <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />
  return <CircleAlert className="h-4 w-4 text-destructive" />
}

function announceSettledTaskTransitions(previous: Map<string, LongTask['status']>, tasks: LongTask[]): void {
  for (const task of tasks) {
    const lastStatus = previous.get(task.id)
    if (!lastStatus || !isActiveStatus(lastStatus) || isLongTaskActive(task)) continue
    if (task.status === 'success') toast.success(`任务完成：${task.title}`)
    else toast.error(`任务${LONG_TASK_STATUS_LABEL[task.status]}：${task.title}`)
  }
}

function isActiveStatus(status: LongTask['status']): boolean {
  return status === 'pending' || status === 'running'
}
