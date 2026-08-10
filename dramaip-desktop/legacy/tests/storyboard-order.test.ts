import assert from 'node:assert/strict'
import { test } from 'node:test'
import { moveStoryboardShot, nudgeStoryboardShot } from '../apps/desktop/renderer/src/lib/storyboard'

test('moves and nudges complete storyboard sequences without dropping IDs', () => {
  const ids = ['shot-1', 'shot-2', 'shot-3']
  assert.deepEqual(moveStoryboardShot(ids, 'shot-3', 'shot-1'), ['shot-3', 'shot-1', 'shot-2'])
  assert.deepEqual(nudgeStoryboardShot(ids, 'shot-2', -1), ['shot-2', 'shot-1', 'shot-3'])
  assert.deepEqual(nudgeStoryboardShot(ids, 'shot-1', -1), ids)
  assert.deepEqual(moveStoryboardShot(ids, 'missing', 'shot-1'), ids)
})
