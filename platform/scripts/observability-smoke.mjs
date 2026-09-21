#!/usr/bin/env node

const apiBaseURL = process.env.DRAMAIP_API_BASE_URL ?? 'http://localhost:8080'
const prometheusBaseURL = process.env.DRAMAIP_PROMETHEUS_URL ?? 'http://localhost:9090'
const lokiBaseURL = process.env.DRAMAIP_LOKI_URL ?? 'http://localhost:3100'
const tempoBaseURL = process.env.DRAMAIP_TEMPO_URL ?? 'http://localhost:3200'
const alloyBaseURL = process.env.DRAMAIP_ALLOY_URL ?? 'http://localhost:12345'
const alloyOTLPHTTPBaseURL = process.env.DRAMAIP_ALLOY_OTLP_HTTP_URL ?? 'http://localhost:4318'
const grafanaBaseURL = process.env.DRAMAIP_GRAFANA_URL ?? 'http://localhost:3000'
const traceID = process.env.DRAMAIP_TRACE_ID ?? randomTraceID()
const requestID = process.env.DRAMAIP_REQUEST_ID ?? `observability-${Date.now()}`
const sensitiveTraceID = process.env.DRAMAIP_SENSITIVE_TRACE_ID ?? randomTraceID()
const directSensitiveTraceID = process.env.DRAMAIP_DIRECT_SENSITIVE_TRACE_ID ?? randomTraceID()
const sensitiveRequestID = process.env.DRAMAIP_SENSITIVE_REQUEST_ID ?? `observability-sensitive-${Date.now()}`
const sensitiveCanary = process.env.DRAMAIP_OBSERVABILITY_CANARY
  ?? `dramaip-sensitive-${randomTraceID()}`
const logCanaryExpected = /^(1|true|yes)$/i.test(process.env.DRAMAIP_LOG_CANARY_EXPECTED ?? '')
const logCanaryWitness = process.env.DRAMAIP_OBSERVABILITY_WITNESS
  ?? 'dramaip-observability-log-pipeline-witness'

if (logCanaryExpected && !process.env.DRAMAIP_OBSERVABILITY_WITNESS) {
  throw new Error('DRAMAIP_OBSERVABILITY_WITNESS is required when DRAMAIP_LOG_CANARY_EXPECTED is enabled')
}

const forbiddenTelemetryKey = /(^|[._-])(authorization|cookie|set[._-]?cookie|prompt|password|passwd|secret|api[._-]?key|apikey|credentials?|private[._-]?key|token|request[._-]?body|response[._-]?body|user[._-]?id|userid|enduser[._-]?id|actor[._-]?id|owner[._-]?id)([._-]|$)/i
const rawURLAttribute = /^(url\.(full|query|path)|http\.(url|target|request\.uri|client_ip|user_agent)|client\.address|network\.peer\.address|user_agent\.original|error\.message|exception\.(message|stacktrace))$/i

function randomTraceID() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function normalizedKey(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

function sensitiveTelemetryKeys(value, path = '$', matches = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => sensitiveTelemetryKeys(item, `${path}[${index}]`, matches))
    return matches
  }
  if (!value || typeof value !== 'object') return matches

  for (const [key, child] of Object.entries(value)) {
    const candidate = normalizedKey(key)
    if (forbiddenTelemetryKey.test(candidate) || rawURLAttribute.test(candidate)) {
      matches.push(`${path}.${key}`)
    }
    sensitiveTelemetryKeys(child, `${path}.${key}`, matches)
  }

  // OTLP encodes resource/span attribute names as the value of a generic
  // `key` property, so object-property inspection alone is insufficient.
  if (typeof value.key === 'string') {
    const candidate = normalizedKey(value.key)
    if (forbiddenTelemetryKey.test(candidate) || rawURLAttribute.test(candidate)) {
      matches.push(`${path}.key=${value.key}`)
    }
  }
  return matches
}

function assertNoSensitiveTelemetry(value, context, canary = null) {
  const encoded = JSON.stringify(value)
  if (canary) {
    assert(!encoded.includes(canary), `${context} contains the synthetic sensitive canary`)
  }
  const keys = [...new Set(sensitiveTelemetryKeys(value))]
  assert(keys.length === 0, `${context} contains forbidden telemetry fields: ${keys.slice(0, 8).join(', ')}`)
}

function assertSafeLokiEntry(entry, context, canary = null) {
  assertNoSensitiveTelemetry(entry, context, canary)
  try {
    assertNoSensitiveTelemetry(JSON.parse(entry.line), `${context} JSON payload`, canary)
  } catch (error) {
    if (error instanceof SyntaxError) return
    throw error
  }
}

function traceparent(id) {
  return `00-${id}-0123456789abcdef-01`
}

function otelStringAttribute(key, value) {
  return { key, value: { stringValue: value } }
}

async function sendDirectSensitiveTrace() {
  const startTimeUnixNano = BigInt(Date.now()) * 1_000_000n
  const payload = {
    resourceSpans: [{
      resource: {
        attributes: [
          otelStringAttribute('service.name', 'observability-direct-canary'),
          otelStringAttribute('password', sensitiveCanary),
          otelStringAttribute('third_party.credential', sensitiveCanary),
        ],
      },
      scopeSpans: [{
        scope: { name: 'dramaip.observability.smoke', version: '1' },
        spans: [{
          traceId: directSensitiveTraceID,
          spanId: randomTraceID().slice(0, 16),
          name: 'observability.sensitive_filter',
          kind: 'SPAN_KIND_INTERNAL',
          startTimeUnixNano: startTimeUnixNano.toString(),
          endTimeUnixNano: (startTimeUnixNano + 1_000_000n).toString(),
          attributes: [
            otelStringAttribute('api_key', sensitiveCanary),
            otelStringAttribute('client.secret', sensitiveCanary),
            otelStringAttribute('access_token', sensitiveCanary),
            otelStringAttribute('passwd', sensitiveCanary),
            otelStringAttribute('private_key', sensitiveCanary),
            otelStringAttribute('prompt', sensitiveCanary),
            otelStringAttribute('request.body', sensitiveCanary),
            otelStringAttribute('user_id', sensitiveCanary),
            otelStringAttribute('url.full', `https://example.invalid/?secret=${sensitiveCanary}`),
          ],
          events: [{
            timeUnixNano: (startTimeUnixNano + 500_000n).toString(),
            name: 'exception',
            attributes: [
              otelStringAttribute('exception.message', sensitiveCanary),
              otelStringAttribute('credential', sensitiveCanary),
            ],
          }],
          status: { code: 'STATUS_CODE_ERROR', message: sensitiveCanary },
        }],
      }],
    }],
  }
  const response = await fetch(new URL('/v1/traces', alloyOTLPHTTPBaseURL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  assert(response.ok, `Alloy rejected the direct OTLP sensitive canary with HTTP ${response.status}`)
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

async function waitForReady(name, baseURL, path) {
  return waitFor(async () => {
    const response = await fetch(new URL(path, baseURL))
    return response.ok ? response : null
  }, `${name} readiness`, 120_000)
}

function collectTempoDetails(value, details = { services: new Set(), spanCount: 0 }) {
  if (Array.isArray(value)) {
    for (const item of value) collectTempoDetails(item, details)
    return details
  }
  if (!value || typeof value !== 'object') return details
  if (value.key === 'service.name') {
    const service = value.value?.stringValue ?? value.value?.string_value
    if (service) details.services.add(service)
  }
  if (Array.isArray(value.spans)) details.spanCount += value.spans.length
  for (const child of Object.values(value)) collectTempoDetails(child, details)
  return details
}

function lokiLines(body) {
  return (body.data?.result ?? []).flatMap((stream) =>
    (stream.values ?? []).map((entry) => ({
      labels: stream.stream ?? {},
      line: entry[1] ?? '',
      metadata: entry[2] ?? {},
    })),
  )
}

async function queryLoki(query, limit = '200') {
  const url = new URL('/loki/api/v1/query_range', lokiBaseURL)
  url.searchParams.set('query', query)
  url.searchParams.set('since', '10m')
  url.searchParams.set('direction', 'backward')
  url.searchParams.set('limit', limit)
  const { response, body } = await getJSON(url)
  assert(response.ok, `Loki query failed with HTTP ${response.status}`)
  return lokiLines(body)
}

async function queryLokiIndexedLabels() {
  const { response, body } = await getJSON(new URL('/loki/api/v1/labels', lokiBaseURL))
  assert(response.ok, `Loki label query failed with HTTP ${response.status}`)
  return new Set(body.data ?? [])
}

async function queryPrometheus(query) {
  const url = new URL('/api/v1/query', prometheusBaseURL)
  url.searchParams.set('query', query)
  const { response, body } = await getJSON(url)
  assert(response.ok, `Prometheus query failed with HTTP ${response.status}`)
  return body.data?.result ?? []
}

await Promise.all([
  waitForReady('Prometheus', prometheusBaseURL, '/-/ready'),
  waitForReady('Alloy', alloyBaseURL, '/-/ready'),
  waitForReady('Loki', lokiBaseURL, '/ready'),
  waitForReady('Tempo', tempoBaseURL, '/ready'),
  waitForReady('Grafana', grafanaBaseURL, '/api/health'),
])

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
  const requiredJobs = new Set(['java-gateway', 'java-services', 'rabbitmq', 'alloy', 'loki', 'tempo'])
  const targets = (body.data?.activeTargets ?? []).filter((target) => requiredJobs.has(target.labels?.job ?? ''))
  const observedJobs = new Set(targets.map((target) => target.labels?.job))
  return [...requiredJobs].every((job) => observedJobs.has(job))
    && targets.every((target) => target.health === 'up') ? targets : null
}, 'Prometheus application and observability targets')

await waitFor(async () => {
  const metrics = await fetch(new URL('/actuator/prometheus', apiBaseURL)).then((result) => result.text())
  return metrics.includes('jvm_memory_used_bytes') && metrics.includes('dramaip_requests_total')
    && metrics.includes('dramaip_request_duration_seconds') ? metrics : null
}, 'Gateway Prometheus metric contract')

const tempoTrace = await waitFor(async () => {
  const { response: tempoResponse, body } = await getJSON(new URL(`/api/v2/traces/${traceID}`, tempoBaseURL))
  if (!tempoResponse.ok) return null
  const details = collectTempoDetails(body)
  return details.spanCount >= 2 && details.services.has('gateway') && details.services.has('identity')
    ? details : null
}, 'Tempo Gateway to identity trace', 90_000)

const logEntries = await waitFor(async () => {
  // With no JSON parser in this LogQL pipeline, these label filters resolve
  // against Loki structured metadata. Loki 3.7 merges that metadata into the
  // query response's `stream` object, so the label catalogue below is the
  // authoritative check for whether a field is actually indexed.
  const query = `{service_name=~"gateway|identity"} | trace_id="${traceID}" | request_id="${requestID}"`
  const lines = await queryLoki(query)
  return lines.some(({ line, labels }) => {
    let log
    try { log = JSON.parse(line) } catch { return false }
    const service = log.service ?? labels.service_name
    return log.trace_id === traceID && log.request_id === requestID
      && service && log.operation
  }) ? lines : null
}, 'Loki structured access log', 90_000)

const indexedLabels = await queryLokiIndexedLabels()
for (const label of ['trace_id', 'span_id', 'request_id', 'operation']) {
  assert(!indexedLabels.has(label), `Loki indexed the high-cardinality label ${label}`)
}

for (const entry of logEntries) {
  assertSafeLokiEntry(entry, 'Loki correlated log')
}

// Exercise every sensitive input class with synthetic data. The route remains
// a non-mutating invalid-login request, while the fixed traceparent makes the
// resulting trace independently queryable.
const sensitiveURL = new URL('/api/v1/auth/token', apiBaseURL)
sensitiveURL.searchParams.set('prompt', sensitiveCanary)
sensitiveURL.searchParams.set('user_id', sensitiveCanary)
const sensitiveResponse = await fetch(sensitiveURL, {
  method: 'POST',
  headers: {
    authorization: `Sensitive ${sensitiveCanary}`,
    cookie: `session=${sensitiveCanary}`,
    'content-type': 'application/json',
    traceparent: traceparent(sensitiveTraceID),
    'X-Request-Id': sensitiveRequestID,
    'X-DramaIP-Contract-Version': '2',
  },
  body: JSON.stringify({
    username: sensitiveCanary,
    password: sensitiveCanary,
    prompt: sensitiveCanary,
    requestBody: sensitiveCanary,
    userId: sensitiveCanary,
  }),
})
assert(sensitiveResponse.status < 500, `Sensitive canary request returned HTTP ${sensitiveResponse.status}`)
await sensitiveResponse.text()

const sensitiveTempoTrace = await waitFor(async () => {
  const { response: tempoResponse, body } = await getJSON(
    new URL(`/api/v2/traces/${sensitiveTraceID}`, tempoBaseURL),
  )
  if (!tempoResponse.ok) return null
  const details = collectTempoDetails(body)
  return details.spanCount >= 1 ? { body, details } : null
}, 'Tempo sensitive canary trace', 90_000)
assertNoSensitiveTelemetry(sensitiveTempoTrace.body, 'Tempo trace', sensitiveCanary)

// Exercise Alloy's transform directly. HTTP auto-instrumentation intentionally
// does not capture bodies or credentials, so a normal application request
// cannot prove that collector-side sanitization handles a malformed producer.
await sendDirectSensitiveTrace()
const directSensitiveTempoTrace = await waitFor(async () => {
  const { response: tempoResponse, body } = await getJSON(
    new URL(`/api/v2/traces/${directSensitiveTraceID}`, tempoBaseURL),
  )
  if (!tempoResponse.ok) return null
  const details = collectTempoDetails(body)
  return details.spanCount >= 1 ? { body, details } : null
}, 'Tempo direct OTLP sensitive canary trace', 90_000)
assertNoSensitiveTelemetry(directSensitiveTempoTrace.body, 'Tempo direct OTLP trace', sensitiveCanary)

// A correlated, non-secret request ID proves the application log stream has
// advanced past the canary request before the global absence assertion runs.
const sensitiveRequestLogs = await waitFor(async () => {
  const query = `{service_name=~"gateway|identity"} |= "${sensitiveRequestID}"`
  const lines = await queryLoki(query)
  return lines.length > 0 ? lines : null
}, 'Loki sensitive-request timing witness', 90_000)
for (const entry of sensitiveRequestLogs) {
  assertSafeLokiEntry(entry, 'Loki sensitive-request log', sensitiveCanary)
}

let droppedSensitiveLines = null
if (logCanaryExpected) {
  await waitFor(async () => {
    const lines = await queryLoki(
      `{service_name="observability-canary"} |= "${logCanaryWitness}"`,
    )
    return lines.length > 0 ? lines : null
  }, 'Loki synthetic log canary witness', 90_000)

  droppedSensitiveLines = await waitFor(async () => {
    const series = await queryPrometheus(
      'sum(loki_process_dropped_lines_total{reason="sensitive_content"})',
    )
    const value = Number(series[0]?.value?.[1] ?? 0)
    return value > 0 ? value : null
  }, 'Alloy sensitive log drop counter', 90_000)
}

const leakedCanaryLines = await queryLoki(`{environment=~".+"} |= "${sensitiveCanary}"`, '1000')
assert(leakedCanaryLines.length === 0, `Loki retained ${leakedCanaryLines.length} line(s) containing the synthetic sensitive canary`)

console.log(JSON.stringify({
  ok: true,
  traceID,
  requestID,
  spanCount: tempoTrace.spanCount,
  services: [...tempoTrace.services].sort(),
  logEntries: logEntries.length,
  sensitiveTraceID,
  sensitiveSpanCount: sensitiveTempoTrace.details.spanCount,
  directSensitiveTraceID,
  directSensitiveSpanCount: directSensitiveTempoTrace.details.spanCount,
  sensitiveRequestLogs: sensitiveRequestLogs.length,
  droppedSensitiveLines,
}, null, 2))
