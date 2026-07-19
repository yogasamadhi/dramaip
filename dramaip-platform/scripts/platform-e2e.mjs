#!/usr/bin/env node

const baseURL = process.env.DRAMAIP_API_BASE_URL ?? 'http://localhost:8000'
const email = process.env.DRAMAIP_E2E_EMAIL ?? 'creator@example.com'
const password = process.env.DRAMAIP_E2E_PASSWORD ?? 'password123'
const csrfCookieName = 'dramaip_web_csrf'
const cookieJar = new Map()

function storeCookies(res) {
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean)
  for (const header of setCookies) {
    const [pair, ...attributes] = header.split(';').map((part) => part.trim())
    const separator = pair.indexOf('=')
    if (separator <= 0) continue
    const name = pair.slice(0, separator)
    const value = pair.slice(separator + 1)
    const path = attributes.find((attribute) => attribute.toLowerCase().startsWith('path='))?.slice(5) ?? '/'
    const maxAge = attributes.find((attribute) => attribute.toLowerCase().startsWith('max-age='))?.slice(8)
    if (value === '' || Number(maxAge) < 0) {
      cookieJar.delete(name)
    } else {
      cookieJar.set(name, { value, path })
    }
  }
}

function cookieHeader(path) {
  return [...cookieJar.entries()]
    .filter(([, cookie]) => path.startsWith(cookie.path))
    .map(([name, cookie]) => `${name}=${cookie.value}`)
    .join('; ')
}

function isUnsafeMethod(method) {
  return !['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(method)
}

async function request(method, path, { body, headers = {}, expect = 200, requireTrace = true } = {}) {
  const csrfToken = cookieJar.get(csrfCookieName)?.value
  const cookies = cookieHeader(path)
  const res = await fetch(new URL(path, baseURL), {
    method,
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
      ...(isUnsafeMethod(method) && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  storeCookies(res)
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForNotification(type, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let latest = []
  while (Date.now() < deadline) {
    const response = await request('GET', '/v1/me/notifications')
    latest = Array.isArray(response.notifications) ? response.notifications : []
    const notification = latest.find((item) => item.type === type)
    if (notification) return notification
    await sleep(500)
  }
  throw new Error(`timed out waiting for ${type} notification; latest=${JSON.stringify(latest)}`)
}

const health = await request('GET', '/v1/healthz')
assert(health.ok === true, 'healthz did not report ok=true')

const session = await request('POST', '/v1/auth/login', { body: { email, password } })
assert(session.user?.id, 'auth did not return a user')
assert(cookieJar.has('dramaip_web_access') && cookieJar.has('dramaip_web_refresh') && cookieJar.has(csrfCookieName), 'auth did not set a complete Cookie session')

const profile = await request('GET', '/v1/me/profile')
assert(profile.email === email, 'profile email mismatch')
const updatedProfile = await request('PATCH', '/v1/me/profile', {
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
  body: { plan_id: targetPlan.id, channel: 'simulated' },
})
assert(checkout.checkout_id, 'checkout did not return checkout_id')
assert(checkout.channel === 'simulated' && checkout.status === 'pending', 'simulated checkout did not preserve its provider/status contract')

const pendingOrder = await request('GET', `/v1/me/orders/${encodeURIComponent(checkout.checkout_id)}`)
assert(pendingOrder.status === 'pending', 'new checkout is not pending before provider confirmation')
assert(String(pendingOrder.payment_url ?? '').startsWith('simulated://payments/orders/'), 'simulated checkout did not expose its recoverable payment entry')

const confirmed = await request('POST', '/v1/billing/payments/simulated/confirm', {
  body: { checkout_id: checkout.checkout_id },
})
assert(confirmed.status === 'paid', 'simulated payment was not paid')
assert(confirmed.token_balance?.remaining_tokens > 0, 'simulated payment did not create token balance')

const paymentNotification = await waitForNotification('payment_succeeded')
await request('POST', `/v1/me/notifications/${paymentNotification.id}/read`)

const accountReport = await request('GET', '/v1/me/account-report')
assert(accountReport.order_summary?.total >= 1, 'account report order summary is invalid')
assert(accountReport.notification_summary?.total >= 1, 'account report notification summary is invalid')

const accountBootstrap = await request('GET', '/v1/me/account-bootstrap?usage_limit=50&trend_days=30')
assert(accountBootstrap.usage_limit === 50 && accountBootstrap.trend_days === 30, 'account bootstrap did not preserve requested windows')
assert(accountBootstrap.cache_ttl_seconds > 0, 'account bootstrap is missing its client cache policy')
for (const section of ['profile', 'subscription', 'token_balance', 'orders', 'usage', 'usage_trend', 'notifications']) {
  assert(['ready', 'unavailable'].includes(accountBootstrap.sections?.[section]?.status), `account bootstrap ${section} status is invalid`)
  assert(accountBootstrap.sections?.[section]?.last_updated, `account bootstrap ${section} is missing last_updated`)
}
assert(accountBootstrap.sections?.usage_trend?.data?.points?.length === 30, 'account bootstrap 30-day trend is not semantically complete')

const dashboard = await request('GET', '/v1/me/dashboard')
assert(dashboard.email === email, 'dashboard email mismatch')

const subscription = await request('GET', '/v1/me/subscription')
assert(subscription.status === 'active', 'subscription is not active')

const orders = await request('GET', '/v1/me/orders')
assert(Array.isArray(orders.orders) && orders.orders.length > 0, 'orders list is empty')

const noKey = await request('POST', '/v1/ai/chat', {
  expect: 409,
  body: {
    request_id: `e2e-no-key-${Date.now()}`,
    provider: 'openai-compatible',
    messages: [{ role: 'user', content: 'This should fail without a provider key.' }],
    max_tokens: 32,
  },
})
assert(String(noKey.error?.message ?? noKey.error ?? '').includes('api key'), 'no-key AI error was not explicit')

const balanceBeforeTestProvider = await request('GET', '/v1/me/token-balance')
const aiRequestID = `e2e-test-provider-${Date.now()}`
const aiIdempotencyKey = `e2e-idempotency-${Date.now()}`
const aiRequest = {
  request_id: aiRequestID,
  provider: 'test',
  messages: [{ role: 'user', content: 'Generate an end-to-end premise.' }],
  max_tokens: 32,
}
const testProviderReply = await request('POST', '/v1/ai/chat', {
  body: aiRequest,
  headers: { 'Idempotency-Key': aiIdempotencyKey },
})
assert(testProviderReply.content && testProviderReply.reservation_id, 'test AI response missing content or reservation')
const balanceAfterTestProvider = await request('GET', '/v1/me/token-balance')
assert(
  balanceAfterTestProvider.remaining_tokens < balanceBeforeTestProvider.remaining_tokens,
  'test AI provider did not consume quota',
)
const replayedTestProviderReply = await request('POST', '/v1/ai/chat', {
  body: aiRequest,
  headers: { 'Idempotency-Key': aiIdempotencyKey },
})
assert(
  replayedTestProviderReply.reservation_id === testProviderReply.reservation_id,
  'idempotent AI replay created a different reservation',
)
const balanceAfterReplay = await request('GET', '/v1/me/token-balance')
assert(
  balanceAfterReplay.remaining_tokens === balanceAfterTestProvider.remaining_tokens,
  'idempotent AI replay consumed quota again',
)
await request('POST', '/v1/ai/chat', {
  expect: 409,
  body: { ...aiRequest, messages: [{ role: 'user', content: 'Different payload must conflict.' }] },
  headers: { 'Idempotency-Key': aiIdempotencyKey },
})

const usage = await request('GET', '/v1/me/token-usage')
assert(Array.isArray(usage.usage) && usage.usage.length > 0, 'token usage list is empty')

const trend = await request('GET', '/v1/me/usage-trend')
assert(Array.isArray(trend.points), 'usage trend response is invalid')

const refreshed = await request('POST', '/v1/auth/refresh')
assert(refreshed.user?.id, 'refresh did not return a session user')
await request('POST', '/v1/auth/logout')

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
