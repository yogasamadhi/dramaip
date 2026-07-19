import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { LongTask, VideoGenerationTask } from '@sdns/core'
import { buildLongTaskRecoveryPlan } from '../apps/desktop/electron/task-recovery'

function task(id: string, kind: LongTask['kind'], patch: Partial<LongTask> = {}): LongTask {
  return {
    id,
    kind,
    status: 'running',
    title: id,
    input: {},
    output: {},
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    ...patch,
  }
}

function videoTask(id: string, status: VideoGenerationTask['status']): VideoGenerationTask {
  return {
    id,
    provider: 'test',
    model: 'test',
    prompt: 'test',
    referenceImageUrls: [],
    status,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
  }
}

test('startup recovery interrupts local work but keeps known remote video work pollable', () => {
  const plans = buildLongTaskRecoveryPlan(
    [
      task('local-ai', 'ai'),
      task('local-batch', 'batch', { status: 'pending' }),
      task('remote-video', 'video', { relatedEntityId: 'remote-pending' }),
      task('settled-video', 'video', { relatedEntityId: 'remote-success' }),
      task('orphan-video', 'video', { relatedEntityId: 'missing' }),
    ],
    (id) => {
      if (id === 'remote-pending') return videoTask(id, 'running')
      if (id === 'remote-success') return videoTask(id, 'success')
      return undefined
    },
    '2026-07-20T01:02:03.000Z',
  )

  assert.deepEqual(
    plans.map((plan) => [plan.taskId, plan.action, plan.status]),
    [
      ['local-ai', 'interrupted', 'failed'],
      ['local-batch', 'interrupted', 'failed'],
      ['remote-video', 'remote_polling', 'pending'],
      ['settled-video', 'remote_finished', 'success'],
      ['orphan-video', 'interrupted', 'failed'],
    ],
  )
  assert.match(plans[0]?.errorMessage ?? '', /不会自动重放/)
  assert.equal((plans[2]?.output.recovery as { mode?: string }).mode, 'remote_polling')
  assert.equal((plans[3]?.output.recovery as { mode?: string }).mode, 'remote_finished')
})
