#!/usr/bin/env node

const baseURL = process.env.DRAMAIP_API_BASE_URL ?? 'http://localhost:8000'
const email = process.env.DRAMAIP_E2E_EMAIL ?? `e2e+${Date.now()}@example.com`
const password = process.env.DRAMAIP_E2E_PASSWORD ?? 'password123'

async function request(method, path, { token, body, expect = 200, requireTrace = true } = {}) {
  const res = await fetch(new URL(path, baseURL), {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = {}
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }
  }
  if (res.status !== expect) {
    throw new Error(`${method} ${path} expected ${expect}, got ${res.status}: ${text}`)
  }
  if (requireTrace && !res.headers.get('x-trace-id')) {
    throw new Error(`${method} ${path} did not return X-Trace-Id`)
  }
  return data
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const health = await request('GET', '/v1/healthz')
assert(health.ok === true, 'healthz did not report ok=true')

let session
try {
  session = await request('POST', '/v1/auth/register', {
    body: { email, password, display_name: 'Platform E2E' },
  })
} catch (error) {
  if (!process.env.DRAMAIP_E2E_EMAIL) throw error
  session = await request('POST', '/v1/auth/login', { body: { email, password } })
}
assert(session.access_token && session.refresh_token, 'auth did not return tokens')
let token = session.access_token

const profile = await request('GET', '/v1/me/profile', { token })
assert(profile.email === email, 'profile email mismatch')
const updatedProfile = await request('PATCH', '/v1/me/profile', {
  token,
  body: {
    display_name: 'Platform E2E Updated',
    phone: '+10000000000',
    locale: 'zh-CN',
    timezone: 'Asia/Shanghai',
  },
})
assert(updatedProfile.display_name === 'Platform E2E Updated', 'profile update did not persist display name')

const plans = await request('GET', '/v1/plans')
assert(Array.isArray(plans.plans) && plans.plans.length > 0, 'plans list is empty')
const targetPlan = plans.plans.find((plan) => plan.id === 'basic') ?? plans.plans[0]

const checkout = await request('POST', '/v1/billing/checkout', {
  token,
  body: { plan_id: targetPlan.id, channel: 'simulated' },
})
assert(checkout.checkout_id, 'checkout did not return checkout_id')

const confirmed = await request('POST', '/v1/billing/payments/simulated/confirm', {
  token,
  body: { checkout_id: checkout.checkout_id },
})
assert(confirmed.status === 'paid', 'simulated payment was not paid')
assert(confirmed.token_balance?.remaining_tokens > 0, 'simulated payment did not create token balance')

const notifications = await request('GET', '/v1/me/notifications', { token })
assert(Array.isArray(notifications.notifications), 'notifications response is invalid')
assert(notifications.notifications.length > 0, 'simulated payment did not create an in-app notification')
await request('POST', `/v1/me/notifications/${notifications.notifications[0].id}/read`, { token })

const accountReport = await request('GET', '/v1/me/account-report', { token })
assert(accountReport.order_summary?.total >= 1, 'account report order summary is invalid')
assert(accountReport.notification_summary?.total >= 1, 'account report notification summary is invalid')

const dashboard = await request('GET', '/v1/me/dashboard', { token })
assert(dashboard.email === email, 'dashboard email mismatch')

const subscription = await request('GET', '/v1/me/subscription', { token })
assert(subscription.status === 'active', 'subscription is not active')

const orders = await request('GET', '/v1/me/orders', { token })
assert(Array.isArray(orders.orders) && orders.orders.length > 0, 'orders list is empty')

const noKey = await request('POST', '/v1/ai/chat', {
  token,
  expect: 409,
  body: {
    request_id: `e2e-no-key-${Date.now()}`,
    provider: 'openai-compatible',
    messages: [{ role: 'user', content: 'This should fail without a provider key.' }],
    max_tokens: 32,
  },
})
assert(String(noKey.error?.message ?? noKey.error ?? '').includes('api key'), 'no-key AI error was not explicit')

const balanceBeforeTestProvider = await request('GET', '/v1/me/token-balance', { token })
const testProviderReply = await request('POST', '/v1/ai/chat', {
  token,
  body: {
    request_id: `e2e-test-provider-${Date.now()}`,
    provider: 'test',
    messages: [{ role: 'user', content: 'Generate an end-to-end premise.' }],
    max_tokens: 32,
  },
})
assert(testProviderReply.content && testProviderReply.reservation_id, 'test AI response missing content or reservation')
const balanceAfterTestProvider = await request('GET', '/v1/me/token-balance', { token })
assert(
  balanceAfterTestProvider.remaining_tokens < balanceBeforeTestProvider.remaining_tokens,
  'test AI provider did not consume quota',
)

const usage = await request('GET', '/v1/me/token-usage', { token })
assert(Array.isArray(usage.usage) && usage.usage.length > 0, 'token usage list is empty')

const trend = await request('GET', '/v1/me/usage-trend', { token })
assert(Array.isArray(trend.points), 'usage trend response is invalid')

const refreshed = await request('POST', '/v1/auth/refresh', { body: { refresh_token: session.refresh_token } })
assert(refreshed.access_token && refreshed.refresh_token, 'refresh did not rotate tokens')
token = refreshed.access_token
await request('POST', '/v1/auth/logout', {
  token,
  body: { refresh_token: refreshed.refresh_token },
})

await request('GET', '/v1/me/dashboard', { expect: 401, requireTrace: false })

console.log(
  JSON.stringify(
    {
      ok: true,
      baseURL,
      plan: targetPlan.id,
      consumedTokens: balanceBeforeTestProvider.remaining_tokens - balanceAfterTestProvider.remaining_tokens,
    },
    null,
    2,
  ),
)
