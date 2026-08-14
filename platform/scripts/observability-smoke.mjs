#!/usr/bin/env node

const apiBaseURL = process.env.DRAMAIP_API_BASE_URL ?? 'http://localhost:8080'
const prometheusBaseURL = process.env.DRAMAIP_PROMETHEUS_URL ?? 'http://localhost:9090'
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
    try { body = JSON.parse(text) } catch { body = { raw: text } }
  }
  return { response, body, text }
}

async function waitFor(check, name, timeoutMs = 60_000) {
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

// An invalid credential request is public and reaches identity through the
// Gateway. It creates a real two-service trace without creating user data.
const response = await fetch(new URL('/api/v1/auth/token', apiBaseURL), {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    traceparent: traceparent(traceID),
    'X-Request-Id': requestID,
    'X-DramaIP-Contract-Version': '2',
  },
  body: '{}',
})
const responseBody = await response.json()
assert(response.status === 400, `API returned ${response.status} instead of 400`)
assert(response.headers.get('x-trace-id') === traceID, `API returned ${response.headers.get('x-trace-id')} instead of ${traceID}`)
assert(response.headers.get('x-request-id') === requestID, `API returned ${response.headers.get('x-request-id')} instead of ${requestID}`)
assert(responseBody.traceId === traceID, `Result traceId is ${responseBody.traceId} instead of ${traceID}`)

await waitFor(async () => {
  // /targets describes the active configuration. An instant `up` query can
  // retain stale series from the other development mode for several minutes.
  const { response: prometheusResponse, body } = await getJSON(new URL('/api/v1/targets', prometheusBaseURL))
  if (!prometheusResponse.ok) return null
  const targets = (body.data?.activeTargets ?? []).filter((target) => /^(java-gateway|java-services)$/.test(target.labels?.job ?? ''))
  return targets.length > 0 && targets.every((target) => target.health === 'up') ? targets : null
}, 'Prometheus Java targets')

await waitFor(async () => {
  const metrics = await fetch(new URL('/actuator/prometheus', apiBaseURL)).then((result) => result.text())
  return metrics.includes('jvm_memory_used_bytes') && metrics.includes('dramaip_requests_total')
    && metrics.includes('dramaip_request_duration_seconds') ? metrics : null
}, 'Gateway Prometheus metric contract')

const jaegerTrace = await waitFor(async () => {
  const { response: jaegerResponse, body } = await getJSON(new URL(`/api/traces/${traceID}`, jaegerBaseURL))
  if (!jaegerResponse.ok) return null
  const trace = body.data?.[0]
  const services = new Set(Object.values(trace?.processes ?? {}).map((process) => process.serviceName))
  return trace?.spans?.length >= 2 && services.has('gateway') && services.has('identity') ? { trace, services } : null
}, 'Jaeger Gateway to identity trace')

await waitFor(async () => {
  const { response: elasticsearchResponse, body } = await getJSON(new URL('/dramaip-logs-*/_search', elasticsearchBaseURL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      size: 50,
      query: { match: { trace_id: traceID } },
      _source: ['service', 'trace_id', 'span_id', 'request_id', 'operation', 'authorization', 'cookie', 'prompt', 'body'],
    }),
  })
  if (!elasticsearchResponse.ok) return null
  const hits = body.hits?.hits ?? []
  return hits.some((hit) => hit._source?.trace_id === traceID && hit._source?.service
    && hit._source?.request_id === requestID && hit._source?.operation
    && !('authorization' in hit._source) && !('cookie' in hit._source)
    && !('prompt' in hit._source) && !('body' in hit._source)) ? hits : null
}, 'Elasticsearch structured access log', 90_000)

console.log(JSON.stringify({ ok: true, traceID, requestID, spanCount: jaegerTrace.trace.spans.length }, null, 2))
