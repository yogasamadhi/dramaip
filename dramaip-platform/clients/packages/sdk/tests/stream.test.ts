import assert from 'node:assert/strict'
import test from 'node:test'

import { createApiClient, resolveApiRequestURL } from '../src/index'

test('resolveApiRequestURL supports same-origin, absolute, and relative API bases', () => {
  assert.equal(resolveApiRequestURL('', '/v1/ai/chat/stream'), '/v1/ai/chat/stream')
  assert.equal(resolveApiRequestURL('https://api.example.test', '/v1/ai/chat/stream'), 'https://api.example.test/v1/ai/chat/stream')
  assert.equal(resolveApiRequestURL('https://api.example.test/', 'v1/ai/chat/stream'), 'https://api.example.test/v1/ai/chat/stream')
  assert.equal(resolveApiRequestURL('/gateway/', '/v1/ai/chat/stream'), '/gateway/v1/ai/chat/stream')
})

test('streamChat uses a relative URL when the API base is empty', async () => {
  const originalFetch = globalThis.fetch
  let requestedURL = ''
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedURL = String(input)
    return new Response('event: completed\ndata: {"request_id":"request-1"}\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as typeof fetch

  try {
    const events: string[] = []
    const client = createApiClient({ baseURL: '', withCredentials: true })
    await client.streamChat({
      messages: [{ role: 'user', content: 'hello' }],
      preflight_request_hash: 'hash',
      request_id: 'request-1',
    }, {
      onEvent: (event) => events.push(event.type),
    })
    assert.equal(requestedURL, '/v1/ai/chat/stream')
    assert.deepEqual(events, ['completed'])
  } finally {
    globalThis.fetch = originalFetch
  }
})
