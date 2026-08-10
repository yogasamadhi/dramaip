import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WORKSPACE_NAV, WORKSPACE_NAV_GROUPS } from '../packages/core/src/constants'

test('groups every workspace nav item exactly once', () => {
  const navKeys = WORKSPACE_NAV.map((item) => item.key)
  const groupedKeys = WORKSPACE_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.key))

  assert.deepEqual(new Set(groupedKeys), new Set(navKeys))
  assert.equal(groupedKeys.length, navKeys.length)
})

test('keeps chapters as the primary entry in the content zone', () => {
  const contentGroup = WORKSPACE_NAV_GROUPS.find((group) => group.key === 'content')

  assert.ok(contentGroup)
  assert.equal(contentGroup.label, '内容')
  assert.equal(contentGroup.items[0]?.key, 'content')
  assert.ok(contentGroup.basicItemKeys.includes('chapters'))
  assert.ok(contentGroup.items.some((item) => item.key === 'inspiration'))
  assert.ok(contentGroup.items.some((item) => item.key === 'story-planning'))
  assert.ok(contentGroup.items.some((item) => item.key === 'agent-schemes'))
})
