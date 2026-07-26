import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WORKSPACE_NAV, WORKSPACE_NAV_GROUPS } from '../packages/core/src/constants'

test('workspace default navigation exposes exactly four user task zones', () => {
  assert.deepEqual(WORKSPACE_NAV_GROUPS.map((group) => group.key), ['content', 'story-bible', 'production', 'delivery'])
  assert.ok(WORKSPACE_NAV_GROUPS.every((group) => group.basicItemKeys.length > 0))
  assert.ok(WORKSPACE_NAV_GROUPS.every((group) => group.basicItemKeys.every((key) => group.items.some((item) => item.key === key))))
  const defaultItems = WORKSPACE_NAV_GROUPS.flatMap((group) => group.basicItemKeys)
  assert.ok(!defaultItems.includes('agent-schemes'))
  assert.ok(!defaultItems.includes('memory'))
})

test('legacy workspace sections and new aggregation entrances stay registered for deep links', () => {
  const keys = new Set(WORKSPACE_NAV.map((item) => item.key))
  for (const key of ['chapters', 'memory', 'character-state', 'visual-profile', 'timeline', 'foreshadowing', 'consistency', 'quality-gates', 'evaluation', 'creative-diagnosis', 'beats', 'highlights', 'ai-video', 'story-bible', 'action-center', 'production', 'delivery']) {
    assert.ok(keys.has(key), `missing workspace route key: ${key}`)
  }
})
