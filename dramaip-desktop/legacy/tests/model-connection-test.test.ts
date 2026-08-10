import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createModelConnectionTestInput } from '../packages/ai/src/providers/connection-test'

test('model connection test does not cap reasoning models before final content', () => {
  const input = createModelConnectionTestInput()

  assert.equal(input.maxTokens, undefined)
  assert.equal(input.temperature, 0)
  assert.deepEqual(input.messages.map((message) => message.role), ['system', 'user'])
})
