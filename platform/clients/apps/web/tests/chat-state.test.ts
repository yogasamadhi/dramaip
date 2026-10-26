import assert from 'node:assert/strict'
import { test } from "vitest"

import {
  chatStatusLabel,
  conversationStateFromStatus,
  streamTerminalOutcome,
} from '../lib/chat-state'

test('gateway recovery statuses map to truthful conversation states', () => {
  assert.equal(conversationStateFromStatus('succeeded'), 'completed')
  assert.equal(conversationStateFromStatus('canceled'), 'canceled')
  assert.equal(conversationStateFromStatus('in_progress'), 'streaming')
  assert.equal(conversationStateFromStatus('cancellation_requested'), 'streaming')
  assert.equal(conversationStateFromStatus('failed'), 'failed')
  assert.equal(conversationStateFromStatus('not_found'), 'failed')
  assert.equal(conversationStateFromStatus('unexpected'), 'failed')
  assert.equal(chatStatusLabel('failed'), '生成未完成')
})

test('only an explicit completed event produces a successful stream outcome', () => {
  const completed = streamTerminalOutcome('completed', 'request-1')
  assert.equal(completed.state, 'completed')
  assert.equal(completed.notice, '生成完成。')

  const failed = streamTerminalOutcome('failed', 'request-2')
  assert.equal(failed.state, 'failed')
  assert.doesNotMatch(failed.notice, /生成完成/)
  assert.match(failed.notice, /request-2/)

  const missingTerminal = streamTerminalOutcome(undefined, 'request-3')
  assert.equal(missingTerminal.state, 'failed')
  assert.doesNotMatch(missingTerminal.notice, /生成完成/)
  assert.match(missingTerminal.notice, /未收到完成状态/)
})
