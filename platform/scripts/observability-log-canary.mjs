#!/usr/bin/env node

const canary = process.env.DRAMAIP_OBSERVABILITY_CANARY
if (!canary) {
  throw new Error('DRAMAIP_OBSERVABILITY_CANARY is required')
}

const witness = process.env.DRAMAIP_OBSERVABILITY_WITNESS
  ?? 'dramaip-observability-log-pipeline-witness'
const intervalMs = Number.parseInt(process.env.DRAMAIP_OBSERVABILITY_CANARY_INTERVAL_MS ?? '5000', 10)

if (!Number.isFinite(intervalMs) || intervalMs < 1000) {
  throw new Error('DRAMAIP_OBSERVABILITY_CANARY_INTERVAL_MS must be at least 1000')
}

function emitPair() {
  // The clean entry proves that Alloy discovered and processed this exact
  // container before the smoke test treats the missing sensitive entry as a
  // successful drop.
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    service: 'observability-canary',
    operation: 'pipeline_witness',
    message: witness,
  }))

  // Each credential class gets a separate record. If even one denylist branch
  // regresses, the smoke test's global canary search observes that record.
  // Partial redaction is deliberately avoided because aliases can leave an
  // unrecognised copy of the same credential behind.
  const sensitiveFields = [
    ['authorization', `Bearer ${canary}`],
    ['cookie', `session=${canary}`],
    ['prompt', canary],
    ['password', canary],
    ['passwd', canary],
    ['secret', canary],
    ['api_key', canary],
    ['client_secret', canary],
    ['clientSecret', canary],
    ['credentials', canary],
    ['private_key', canary],
    ['access_token', canary],
    ['request_body', canary],
    ['user_id', canary],
  ]
  for (const [field, value] of sensitiveFields) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'INFO',
      service: 'observability-canary',
      operation: `sensitive_entry_must_be_dropped_${field}`,
      [field]: value,
    }))
  }
  console.log(`unstructured credential: Bearer ${canary}`)
}

emitPair()
setInterval(emitPair, intervalMs)
