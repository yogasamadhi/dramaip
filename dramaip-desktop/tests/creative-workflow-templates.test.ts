import test from 'node:test'
import assert from 'node:assert/strict'
import { CREATIVE_WORKFLOW_TEMPLATES } from '@sdns/core'

test('novel to video workflow covers the full reusable production chain', () => {
  const tpl = CREATIVE_WORKFLOW_TEMPLATES.find((item) => item.key === 'novel_to_video_pipeline')
  assert.ok(tpl, 'novel_to_video_pipeline should be registered')
  assert.deepEqual(tpl.steps.map((step) => step.kind), ['ai', 'ai', 'batch', 'batch', 'video_tasks'])
  assert.deepEqual(tpl.steps.map((step) => step.key), [
    'novel_to_adaptation_gate',
    'convert_to_episodes',
    'batch_scripts',
    'batch_shots',
    'draft_video_tasks',
  ])
  assert.equal(tpl.steps[1].taskType, 'convert_novel_to_episodes')
  assert.equal(tpl.steps[2].batchKind, 'scripts')
  assert.equal(tpl.steps[3].batchKind, 'shots')
  assert.ok(tpl.steps.slice(1).every((step) => step.pauseAfter), 'production handoff steps should pause for review')
})

test('creative workflow templates use unique step keys', () => {
  for (const tpl of CREATIVE_WORKFLOW_TEMPLATES) {
    const keys = tpl.steps.map((step) => step.key)
    assert.equal(new Set(keys).size, keys.length, `${tpl.key} has duplicate step keys`)
    assert.ok(tpl.description.trim().length > 0, `${tpl.key} should describe its reusable purpose`)
  }
})
