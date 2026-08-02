#!/usr/bin/env node

const apiBaseURL = process.env.DRAMAIP_API_BASE_URL ?? 'http://localhost:8080'
const jaegerBaseURL = process.env.DRAMAIP_JAEGER_URL ?? 'http://localhost:16686'
const elasticsearchBaseURL = process.env.DRAMAIP_ELASTICSEARCH_URL ?? 'http://localhost:9200'
const traceID = process.env.DRAMAIP_TRACE_ID ?? randomTraceID()
const requestID = process.env.DRAMAIP_REQUEST_ID ?? `observability-${Date.now()}`

function randomTraceID() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function traceparent(id) {
  return `00-${id}-0123456789abcdef-01`
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getJSON(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  let body = {}
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = { raw: text }
    }
  }
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${text}`)
  }
  return { response, body }
}

async function waitFor(check, name, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const result = await check()
      if (result) return result
    } catch (error) {
      lastError = error
    }
    await sleep(1_000)
  }
  throw new Error(`${name} was not ready within ${timeoutMs}ms${lastError ? `: ${lastError.message}` : ''}`)
}

// A protected Java Gateway route returns 401 before forwarding without a
// session. The fixed traceparent verifies that the gateway preserves request
// correlation into tracing and structured logs.
const response = await fetch(new URL('/api/v1/plans', apiBaseURL), {
  headers: {
    traceparent: traceparent(traceID),
    'X-Request-Id': requestID,
    'X-DramaIP-Contract-Version': '2',
  },
})
assert(response.status === 401, `API returned ${response.status} instead of 401`)
assert(response.headers.get('x-trace-id') === traceID, `API returned ${response.headers.get('x-trace-id')} instead of ${traceID}`)
assert(response.headers.get('x-request-id') === requestID, `API returned ${response.headers.get('x-request-id')} instead of ${requestID}`)

const jaegerTrace = await waitFor(async () => {
  const { body } = await getJSON(new URL(`/api/traces/${traceID}`, jaegerBaseURL))
  const spans = body.data?.[0]?.spans ?? []
  const services = new Set(spans.map((span) => span.processID).filter(Boolean))
  return spans.length >= 1 && services.size >= 1 ? { spans, services } : null
}, 'Jaeger gateway trace')

await waitFor(async () => {
  const { body } = await getJSON(new URL('/dramaip-logs-*/_search', elasticsearchBaseURL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      size: 20,
      query: { term: { trace_id: traceID } },
      _source: ['service', 'trace_id', 'request_id', 'operation'],
    }),
  })
  const hits = body.hits?.hits ?? []
  return hits.some((hit) => hit._source?.trace_id === traceID && hit._source?.service) ? hits : null
}, 'Elasticsearch structured log')

console.log(JSON.stringify({ ok: true, traceID, requestID, spanCount: jaegerTrace.spans.length }, null, 2))
