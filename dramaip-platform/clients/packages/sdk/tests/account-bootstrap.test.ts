import assert from 'node:assert/strict'
import test from 'node:test'

import { createApiClient } from '../src/index'

test('builds the account view from Java resource responses', async () => {
  const client = createApiClient({ baseURL: 'http://example.test', webSession: true })
  const requested: string[] = []
  const responses: Record<string, unknown> = {
    '/api/v1/users/me/profile': {
      id: 'user-1', email: 'creator@example.com', phone: null, status: 'active', displayName: 'Creator',
      avatarUrl: null, locale: 'zh-CN', timezone: 'Asia/Shanghai',
    },
    '/api/v1/subscriptions/current': {
      id: 'subscription-1', planId: 'plan-1', planCode: 'creator', planName: 'Creator', provider: 'simulated', status: 'active',
      currentPeriodStart: '2026-07-01T00:00:00Z', currentPeriodEnd: '2026-08-01T00:00:00Z', cancelAtPeriodEnd: false,
      renewalPlanCode: 'creator', entitlements: JSON.stringify({
        included_seats: 1, byok_enabled: false, offline_review_enabled: false, advanced_export_enabled: false,
        cloud_review_enabled: true, review_storage_bytes: 1024, review_retention_days: 30, private_gateway_enabled: false,
      }),
    },
    '/api/v1/quota/balance': {
      planCode: 'creator', quotaTokens: 1000, usedTokens: 25, remainingTokens: 975,
      periodStart: '2026-07-01T00:00:00Z', periodEnd: '2026-08-01T00:00:00Z',
    },
    '/api/v1/orders': [],
    '/api/v1/quota/usage': [],
    '/api/v1/quota/usage/trend': [],
    '/api/v1/notifications': [],
  }

  client.http.defaults.adapter = async (config) => {
    const url = config.url ?? ''
    requested.push(url)
    assert.ok(url in responses, `unexpected request: ${url}`)
    return {
      data: { code: 'OK', message: 'OK', data: responses[url], requestId: 'request-1', traceId: 'trace-1' },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }

  const account = await client.getAccountBootstrap({ usage_limit: 50, trend_days: 30 })

  assert.equal(account.sections.profile.status, 'ready')
  assert.equal(account.sections.profile.data?.display_name, 'Creator')
  assert.equal(account.sections.subscription.data?.plan_code, 'creator')
  assert.equal(account.sections.token_balance.data?.remaining_tokens, 975)
  assert.equal(account.sections.orders.data?.orders.length, 0)
  assert.ok(!requested.includes('/api/v1/users/me/context'))
})
