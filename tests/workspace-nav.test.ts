import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WORKSPACE_NAV, WORKSPACE_NAV_GROUPS } from '../packages/core/src/constants'

test('groups every workspace nav item exactly once', () => {
  const navKeys = WORKSPACE_NAV.map((item) => item.key)
  const groupedKeys = WORKSPACE_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.key))

  assert.deepEqual(new Set(groupedKeys), new Set(navKeys))
  assert.equal(groupedKeys.length, navKeys.length)
})

test('keeps chapters as the primary creation entry', () => {
  const creationGroup = WORKSPACE_NAV_GROUPS.find((group) => group.key === 'creation')

  assert.ok(creationGroup)
  assert.equal(creationGroup.label, '创作')
  assert.equal(creationGroup.items[0]?.key, 'chapters')
  assert.ok(creationGroup.items.some((item) => item.key === 'story-planning'))
})
