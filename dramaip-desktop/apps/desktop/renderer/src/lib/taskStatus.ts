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

export function longTaskCloudPreflightMessage(task: LongTask): string | undefined {
  const preflight = task.output?.cloudPreflight
  if (!preflight || typeof preflight !== 'object') return undefined
  const data = preflight as Record<string, unknown>
  const provider = typeof data.provider === 'string' ? data.provider : undefined
  const model = typeof data.model === 'string' ? data.model : undefined
  const estimatedTokens = typeof data.estimatedTokens === 'number' ? data.estimatedTokens : undefined
  const remainingTokens = typeof data.remainingTokens === 'number' ? data.remainingTokens : undefined
  if (!provider || !model || estimatedTokens === undefined || remainingTokens === undefined) return undefined
  return `云端预检已通过：${provider}/${model} · 预计 ${estimatedTokens.toLocaleString()} · 余额 ${remainingTokens.toLocaleString()} tokens`
}
