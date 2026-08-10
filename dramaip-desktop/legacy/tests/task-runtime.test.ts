import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  beginLongTaskRun,
  beginLongTaskRetry,
  cancelLongTaskRun,
  finishLongTaskRetry,
  finishLongTaskRun,
  longTaskConcurrencyLimit,
} from '../apps/desktop/electron/task-runtime'

test('long task runtime enforces per-kind concurrency and aborts cancelable runs', () => {
  assert.equal(longTaskConcurrencyLimit('ai'), 1)
  assert.equal(longTaskConcurrencyLimit('image'), 1)
  assert.equal(longTaskConcurrencyLimit('audio'), 1)

  const first = beginLongTaskRun('ai', 'ai-runtime-1')
  assert.equal(first.ok, true)
  assert.equal(first.signal?.aborted, false)

  const blocked = beginLongTaskRun('ai', 'ai-runtime-2')
  assert.equal(blocked.ok, false)
  assert.match(blocked.error ?? '', /AI任务正在运行/)

  assert.equal(cancelLongTaskRun('ai-runtime-1'), true)
  assert.equal(first.signal?.aborted, true)

  finishLongTaskRun('ai-runtime-1')
  const second = beginLongTaskRun('ai', 'ai-runtime-2')
  assert.equal(second.ok, true)
  finishLongTaskRun('ai-runtime-2')

  const audio = beginLongTaskRun('audio', 'audio-runtime-1')
  assert.equal(audio.ok, true)
  assert.equal(cancelLongTaskRun('audio-runtime-1'), true)
  assert.equal(audio.signal?.aborted, true)
  finishLongTaskRun('audio-runtime-1')
})

test('long task retry claim prevents duplicate submissions and releases after completion', () => {
  assert.equal(beginLongTaskRetry('retry-runtime-1'), true)
  assert.equal(beginLongTaskRetry('retry-runtime-1'), false)
  finishLongTaskRetry('retry-runtime-1')
  assert.equal(beginLongTaskRetry('retry-runtime-1'), true)
  finishLongTaskRetry('retry-runtime-1')
})
