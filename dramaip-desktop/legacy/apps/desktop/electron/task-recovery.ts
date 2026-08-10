import type { LongTask, VideoGenerationTask } from '@sdns/core'
import type { Repositories } from '@sdns/db'

type TerminalStatus = Extract<LongTask['status'], 'success' | 'failed' | 'canceled'>

export type LongTaskRecoveryAction = 'interrupted' | 'remote_polling' | 'remote_finished'

export interface LongTaskRecoveryPlanItem {
  taskId: string
  action: LongTaskRecoveryAction
  status: LongTask['status']
  errorMessage?: string
  output: Record<string, unknown>
}

export interface LongTaskRecoverySummary {
  scanned: number
  interrupted: number
  remotePolling: number
  remoteFinished: number
}

const LOCAL_INTERRUPTION_MESSAGE = '应用重启导致本地任务中断；不会自动重放，可安全重试。'
const MISSING_REMOTE_TASK_MESSAGE = '应用重启后未找到关联的视频任务；不会自动重放，可安全重试。'

/**
 * Turns persisted, incomplete jobs into a deterministic recovery plan. Local
 * work never gets replayed implicitly; only a video job with an already-known
 * remote task keeps polling after Electron returns.
 */
export function buildLongTaskRecoveryPlan(
  tasks: LongTask[],
  getVideoTask: (id: string) => VideoGenerationTask | undefined,
  recoveredAt = new Date().toISOString(),
): LongTaskRecoveryPlanItem[] {
  return tasks.map((task) => {
    if (task.kind === 'video' && task.relatedEntityId) {
      const remoteTask = getVideoTask(task.relatedEntityId)
      if (!remoteTask) return interruptedPlan(task, MISSING_REMOTE_TASK_MESSAGE, recoveredAt)

      if (isTerminal(remoteTask.status)) {
        return {
          taskId: task.id,
          action: 'remote_finished',
          status: remoteTask.status,
          errorMessage: remoteTask.errorMessage,
          output: withRecovery(task, {
            mode: 'remote_finished',
            recoveredAt,
            message: '已依据持久化视频任务恢复最终状态。',
          }),
        }
      }

      return {
        taskId: task.id,
        action: 'remote_polling',
        status: 'pending',
        output: withRecovery(task, {
          mode: 'remote_polling',
          recoveredAt,
          message: '应用已恢复，正在重新连接远端视频任务。',
        }),
      }
    }
    return interruptedPlan(task, LOCAL_INTERRUPTION_MESSAGE, recoveredAt)
  })
}

/** Reconciles the task table once per startup, before renderer IPC becomes available. */
export function reconcileLongTasks(repos: Repositories): LongTaskRecoverySummary {
  const plan = buildLongTaskRecoveryPlan(
    repos.longTask.listIncompleteLongTasks(repos.db),
    (id) => repos.videoTask.getVideoTask(repos.db, id),
  )
  const summary: LongTaskRecoverySummary = {
    scanned: plan.length,
    interrupted: 0,
    remotePolling: 0,
    remoteFinished: 0,
  }

  for (const item of plan) {
    if (item.action === 'interrupted') {
      repos.longTask.finishLongTask(repos.db, item.taskId, 'failed', {
        errorMessage: item.errorMessage,
        output: item.output,
      })
      summary.interrupted += 1
      continue
    }
    if (item.action === 'remote_finished') {
      repos.longTask.finishLongTask(repos.db, item.taskId, item.status as TerminalStatus, {
        errorMessage: item.errorMessage,
        output: item.output,
      })
      summary.remoteFinished += 1
      continue
    }
    repos.longTask.updateLongTask(repos.db, item.taskId, {
      status: 'pending',
      errorMessage: undefined,
      output: item.output,
    })
    summary.remotePolling += 1
  }
  return summary
}

function interruptedPlan(task: LongTask, errorMessage: string, recoveredAt: string): LongTaskRecoveryPlanItem {
  return {
    taskId: task.id,
    action: 'interrupted',
    status: 'failed',
    errorMessage,
    output: withRecovery(task, {
      mode: 'interrupted',
      recoveredAt,
      message: errorMessage,
    }),
  }
}

function withRecovery(task: LongTask, recovery: Record<string, string>): Record<string, unknown> {
  return { ...task.output, recovery }
}

function isTerminal(status: VideoGenerationTask['status']): status is TerminalStatus {
  return status === 'success' || status === 'failed' || status === 'canceled'
}
