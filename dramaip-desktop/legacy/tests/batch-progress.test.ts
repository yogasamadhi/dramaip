import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createBatchProgress,
  pendingBatchItems,
  resetIncompleteBatchItems,
  updateBatchItem,
} from '../apps/desktop/electron/batch-progress'
import type { BatchTaskItem } from '../packages/core/src/types'

const baseItems: BatchTaskItem[] = [
  {
    key: 'episode:e1',
    label: '第 1 集',
    targetKind: 'episode',
    targetId: 'e1',
    episodeId: 'e1',
    taskType: 'generate_ai_drama_script',
    status: 'pending',
  },
  {
    key: 'episode:e2',
    label: '第 2 集',
    targetKind: 'episode',
    targetId: 'e2',
    episodeId: 'e2',
    taskType: 'generate_ai_drama_script',
    status: 'pending',
  },
  {
    key: 'episode:e3',
    label: '第 3 集',
    targetKind: 'episode',
    targetId: 'e3',
    episodeId: 'e3',
    taskType: 'generate_ai_drama_script',
    status: 'skipped',
  },
]

test('batch progress summarizes item states', () => {
  let progress = createBatchProgress('scripts', '批量生成剧本', baseItems)
  progress = updateBatchItem(progress, 'episode:e1', { status: 'success', aiRunId: 'run1' })
  progress = updateBatchItem(progress, 'episode:e2', { status: 'failed', error: '模型失败' })

  assert.equal(progress.total, 3)
  assert.equal(progress.success, 1)
  assert.equal(progress.failed, 1)
  assert.equal(progress.skipped, 1)
  assert.equal(progress.pending, 0)
})

test('resetting a batch keeps finished items and only retries incomplete items', () => {
  let progress = createBatchProgress('scripts', '批量生成剧本', baseItems)
  progress = updateBatchItem(progress, 'episode:e1', { status: 'success', aiRunId: 'run1' })
  progress = updateBatchItem(progress, 'episode:e2', { status: 'failed', error: '模型失败', longTaskId: 'task2' })

  const reset = resetIncompleteBatchItems(progress)
  assert.equal(reset.items.find((item) => item.key === 'episode:e1')?.status, 'success')
  assert.equal(reset.items.find((item) => item.key === 'episode:e2')?.status, 'pending')
  assert.equal(reset.items.find((item) => item.key === 'episode:e2')?.error, undefined)
  assert.deepEqual(pendingBatchItems(reset).map((item) => item.key), ['episode:e2'])
})
