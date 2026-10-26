import assert from 'node:assert/strict'
import { test } from "vitest"

import { createApiClient, resolveApiRequestURL } from '../src/index'

test('resolveApiRequestURL supports same-origin, absolute, and relative API bases', () => {
  assert.equal(resolveApiRequestURL('', '/api/v1/stream'), '/api/v1/stream')
  assert.equal(resolveApiRequestURL('https://api.example.test', '/api/v1/stream'), 'https://api.example.test/api/v1/stream')
  assert.equal(resolveApiRequestURL('https://api.example.test/', 'api/v1/stream'), 'https://api.example.test/api/v1/stream')
  assert.equal(resolveApiRequestURL('/gateway/', '/api/v1/stream'), '/gateway/api/v1/stream')
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
    assert.equal(requestedURL, '/api/v1/stream')
    assert.deepEqual(events, ['completed'])
  } finally {
    globalThis.fetch = originalFetch
  }
})
