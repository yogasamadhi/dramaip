#!/usr/bin/env node

const baseURL = process.env.DRAMAIP_API_BASE_URL ?? 'http://localhost:8080'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function json(path, options = {}) {
  const response = await fetch(new URL(path, baseURL), options)
  const body = await response.json().catch(() => null)
  return { response, body }
}

const health = await json('/actuator/health')
assert(health.response.ok && health.body?.status === 'UP', 'Java Gateway actuator health is not UP')

const missingContract = await json('/api/v1/plans')
assert(missingContract.response.status === 426, 'Gateway did not reject a request without contract version 2')
assert(missingContract.body?.code === 'COMMON_CONTRACT_VERSION_UNSUPPORTED', 'Gateway returned an unexpected contract error')

const protectedRoute = await json('/api/v1/plans', {
  headers: { 'X-DramaIP-Contract-Version': '2' },
})
assert(protectedRoute.response.status === 401, 'Gateway did not enforce JWT before routing a protected Java resource')

console.log(JSON.stringify({ ok: true, baseURL }, null, 2))
