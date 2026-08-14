import assert from 'node:assert/strict'
import test from 'node:test'
import { draftRecoveryKey } from '../apps/desktop/renderer/src/lib/draftRecovery'

test('scopes local draft recovery by editor target', () => {
  assert.equal(draftRecoveryKey('chapter:chapter-1'), 'sdns-draft-recovery:chapter:chapter-1')
  assert.notEqual(draftRecoveryKey('script:script-1'), draftRecoveryKey('shot:shot-1'))
})
