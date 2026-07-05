import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RevisionTask } from '@sdns/core'
import { revisionTaskReviewInstruction, supportsRevisionTaskPreview } from '../apps/desktop/renderer/src/lib/revisionTaskLoop'

function task(patch: Partial<RevisionTask> = {}): RevisionTask {
  return {
    id: 'task-1',
    projectId: 'project-1',
    targetKind: 'chapter',
    targetId: 'chapter-1',
    title: '强化反转',
    description: '补一处段尾反转',
    priority: 'must',
    status: 'open',
    suggestedAction: '重写章节结尾，让反转更早埋线。',
    expectedBenefit: { retention: 8, freshness: 5, visual: 3, cost: 2 },
    createdAt: '',
    updatedAt: '',
    ...patch,
  }
}

test('revision task preview is available only for concrete editable targets', () => {
  assert.equal(supportsRevisionTaskPreview(task()), true)
  assert.equal(supportsRevisionTaskPreview(task({ targetKind: 'project', targetId: 'project-1' })), false)
  assert.equal(supportsRevisionTaskPreview(task({ targetId: undefined })), false)
  assert.equal(supportsRevisionTaskPreview(task({ status: 'applied' })), false)
})

test('revision task review instruction carries the adopted action', () => {
  const instruction = revisionTaskReviewInstruction(task())

  assert.match(instruction, /强化反转/)
  assert.match(instruction, /chapter\/chapter-1/)
  assert.match(instruction, /重写章节结尾/)
})
