import type { BatchTaskItem, BatchTaskProgress } from '@sdns/core'

const INCOMPLETE = new Set(['pending', 'running', 'failed', 'canceled'])

export function createBatchProgress(
  kind: BatchTaskProgress['kind'],
  title: string,
  items: BatchTaskItem[],
): BatchTaskProgress {
  return summarizeBatchProgress({
    kind,
    title,
    total: items.length,
    pending: 0,
    running: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    canceled: 0,
    items,
    updatedAt: new Date().toISOString(),
  })
}

export function summarizeBatchProgress(progress: BatchTaskProgress): BatchTaskProgress {
  const counts = {
    pending: 0,
    running: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    canceled: 0,
  }
  for (const item of progress.items) counts[item.status]++
  return {
    ...progress,
    total: progress.items.length,
    ...counts,
    updatedAt: new Date().toISOString(),
  }
}

export function updateBatchItem(
  progress: BatchTaskProgress,
  key: string,
  patch: Partial<BatchTaskItem>,
): BatchTaskProgress {
  const updatedAt = new Date().toISOString()
  return summarizeBatchProgress({
    ...progress,
    items: progress.items.map((item) =>
      item.key === key ? { ...item, ...patch, updatedAt } : item,
    ),
  })
}

export function resetIncompleteBatchItems(progress: BatchTaskProgress): BatchTaskProgress {
  return summarizeBatchProgress({
    ...progress,
    items: progress.items.map((item) => {
      if (!INCOMPLETE.has(item.status)) return item
      const { aiRunId: _aiRunId, longTaskId: _longTaskId, error: _error, ...rest } = item
      void _aiRunId
      void _longTaskId
      void _error
      return { ...rest, status: 'pending' }
    }),
  })
}

export function pendingBatchItems(progress: BatchTaskProgress): BatchTaskItem[] {
  return progress.items.filter((item) => item.status === 'pending')
}

export function isBatchProgress(value: unknown): value is BatchTaskProgress {
  if (!value || typeof value !== 'object') return false
  const progress = value as Partial<BatchTaskProgress>
  return (
    (progress.kind === 'scripts' || progress.kind === 'shots') &&
    typeof progress.title === 'string' &&
    Array.isArray(progress.items)
  )
}
