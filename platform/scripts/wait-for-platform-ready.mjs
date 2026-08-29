#!/usr/bin/env node

const defaultBaseURL = 'http://localhost:8080'
const defaultTimeoutMs = 120_000
const defaultIntervalMs = 1_000
const defaultRequestTimeoutMs = 2_500

function positiveInteger(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return Number(raw)
}

function healthURLFromEnvironment() {
  const raw = process.env.DRAMAIP_PLATFORM_HEALTH_URL ?? defaultBaseURL
  let baseURL
  try {
    baseURL = new URL(raw)
  } catch {
    throw new Error('DRAMAIP_PLATFORM_HEALTH_URL must be an absolute HTTP(S) URL')
  }
  if (!['http:', 'https:'].includes(baseURL.protocol) || baseURL.username || baseURL.password) {
    throw new Error('DRAMAIP_PLATFORM_HEALTH_URL must be a credential-free HTTP(S) URL')
  }
  return new URL('/actuator/health', baseURL)
}

function readinessURLFromHealthURL(healthURL) {
  return new URL('/api/v1/auth/register', healthURL)
}

function publicURL(url) {
  return `${url.protocol}//${url.host}${url.pathname}`
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const healthURL = healthURLFromEnvironment()
const readinessURL = readinessURLFromHealthURL(healthURL)
const timeoutMs = positiveInteger('DRAMAIP_PLATFORM_READY_TIMEOUT_MS', defaultTimeoutMs)
const intervalMs = positiveInteger('DRAMAIP_PLATFORM_READY_INTERVAL_MS', defaultIntervalMs)
const requestTimeoutMs = positiveInteger(
  'DRAMAIP_PLATFORM_READY_REQUEST_TIMEOUT_MS',
  defaultRequestTimeoutMs,
)
const deadline = Date.now() + timeoutMs
let attempts = 0
let lastFailure = 'no health request completed'
let nextDelayMs = intervalMs

while (Date.now() <= deadline) {
  attempts += 1
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), requestTimeoutMs)
  try {
    const response = await fetch(healthURL, { signal: abort.signal })
    if (response.status !== 200) {
      lastFailure = `HTTP ${response.status}`
      if (response.status === 429) {
        const retryAfterSeconds = Number(response.headers.get('retry-after'))
        nextDelayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? Math.max(intervalMs, Math.ceil(retryAfterSeconds * 1_000))
          : Math.max(intervalMs, 1_000)
      } else {
        nextDelayMs = intervalMs
      }
    } else {
      let body
      try {
        body = await response.json()
      } catch {
        lastFailure = 'health response was not JSON'
      }
      if (body?.status === 'UP') {
        const readinessResponse = await fetch(readinessURL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-DramaIP-Contract-Version': '2',
          },
          body: '{}',
          signal: abort.signal,
        })
        if (readinessResponse.status === 400) {
          console.log(JSON.stringify({
            ok: true,
            healthURL: publicURL(healthURL),
            readinessURL: publicURL(readinessURL),
            attempts,
          }))
          process.exit(0)
        }
        lastFailure = `identity readiness route returned HTTP ${readinessResponse.status}`
        nextDelayMs = intervalMs
      } else if (body) {
        lastFailure = 'health response did not contain status=UP'
      }
      nextDelayMs = intervalMs
    }
  } catch (error) {
    lastFailure = error instanceof Error && error.name === 'AbortError' ? 'request timed out' : 'connection failed'
    nextDelayMs = intervalMs
  } finally {
    clearTimeout(timer)
  }
  if (Date.now() <= deadline) {
    await sleep(Math.min(nextDelayMs, Math.max(0, deadline - Date.now())))
  }
}

throw new Error(
  `platform did not become healthy within ${timeoutMs}ms at ${publicURL(healthURL)} after ${attempts} attempts; last=${lastFailure}`,
)
