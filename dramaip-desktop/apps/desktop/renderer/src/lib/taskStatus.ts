import type { LongTask, LongTaskStatus } from '@sdns/core'

export const LONG_TASK_STATUS_LABEL: Record<LongTaskStatus, string> = {
  pending: '排队中',
  running: '运行中',
  success: '成功',
  failed: '失败',
  canceled: '已取消',
}

export function isLongTaskActive(task: LongTask): boolean {
  return task.status === 'pending' || task.status === 'running'
}

export function longTaskRecoveryMessage(task: LongTask): string | undefined {
  const recovery = task.output?.recovery
  if (!recovery || typeof recovery !== 'object') return undefined
  const message = (recovery as Record<string, unknown>).message
  return typeof message === 'string' ? message : undefined
}
