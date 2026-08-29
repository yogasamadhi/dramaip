#!/usr/bin/env node

const baseURL = process.env.DRAMAIP_API_BASE_URL ?? 'http://localhost:8080'
const contractHeaders = { 'X-DramaIP-Contract-Version': '2' }
const serviceReadyTimeoutMs = 120_000

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function request(path, { method = 'GET', token, body, headers = {}, expected = 200 } = {}) {
  const deadline = Date.now() + serviceReadyTimeoutMs
  while (true) {
    const response = await fetch(new URL(path, baseURL), {
      method,
      headers: {
        ...contractHeaders,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const payload = await response.json().catch(() => null)
    if (response.status !== 503 || Date.now() >= deadline) {
      assert(response.status === expected, `${method} ${path} returned ${response.status}, expected ${expected}: ${JSON.stringify(payload)}`)
      return { response, body: payload }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
}

function assertResult(payload, context) {
  assert(payload?.code === 'OK', `${context} did not return Result<T>.OK`)
  assert(typeof payload.requestId === 'string' && payload.requestId.length > 0, `${context} omitted requestId`)
  assert(typeof payload.traceId === 'string' && /^[0-9a-f]{32}$/i.test(payload.traceId), `${context} omitted a valid traceId`)
  return payload.data
}

async function waitFor(label, probe, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await probe()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`timed out waiting for ${label}`)
}

async function replayEvents(conversationId, token, lastEventId = 0) {
  const response = await fetch(new URL(`/api/v1/inspiration-conversations/${conversationId}/events`, baseURL), {
    headers: {
      ...contractHeaders,
      Accept: 'text/event-stream',
      Authorization: `Bearer ${token}`,
      'Last-Event-ID': String(lastEventId),
    },
  })
  const body = await response.text()
  assert(response.ok, `inspiration event replay returned ${response.status}: ${body}`)
  return body
    .split(/\n\n+/)
    .map((block) => {
      const id = block.match(/^id:(.+)$/m)?.[1]?.trim()
      const event = block.match(/^event:(.+)$/m)?.[1]?.trim()
      const data = block.match(/^data:(.+)$/m)?.[1]?.trim()
      return id && event && data ? { id: Number(id), event, data: JSON.parse(data) } : null
    })
    .filter(Boolean)
}

const healthResponse = await fetch(new URL('/actuator/health', baseURL))
const health = await healthResponse.json().catch(() => null)
assert(healthResponse.ok && health?.status === 'UP', 'Java Gateway actuator health is not UP')

const missingContractResponse = await fetch(new URL('/api/v1/plans', baseURL))
const missingContract = await missingContractResponse.json().catch(() => null)
assert(missingContractResponse.status === 426, 'Gateway did not reject a request without contract version 2')
assert(missingContract?.code === 'COMMON_CONTRACT_VERSION_UNSUPPORTED', 'Gateway returned an unexpected contract error')

const protectedRoute = await request('/api/v1/plans', { expected: 401 })
assert(protectedRoute.body?.code !== 'OK', 'Gateway did not enforce JWT before routing a protected Java resource')

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
const email = `platform-e2e-${suffix}@example.invalid`
const password = `E2e-${suffix}-Password!`
const deviceId = `platform-e2e-${suffix}`.slice(0, 120)
const registered = assertResult((await request('/api/v1/auth/register', {
  method: 'POST',
  headers: { 'X-Device-Id': deviceId },
  body: { email, password, displayName: 'Platform E2E' },
})).body, 'registration')
assert(typeof registered.accessToken === 'string' && registered.accessToken.length > 20, 'registration omitted accessToken')
assert(typeof registered.refreshToken === 'string' && registered.refreshToken.length > 20, 'registration omitted refreshToken')

const token = registered.accessToken
const plans = assertResult((await request('/api/v1/plans', { token })).body, 'plan listing')
const plan = plans.find((candidate) => candidate.purchaseMode === 'self_service')
assert(plan?.code, 'no self-service plan is available for the E2E checkout')

const order = assertResult((await request('/api/v1/orders', {
  method: 'POST',
  token,
  expected: 201,
  body: { planCode: plan.code, provider: 'simulated' },
})).body, 'order creation')
assert(order.status === 'pending' && order.provider === 'simulated', 'created order is not pending simulated payment')

const payment = assertResult((await request('/api/v1/payments/simulated/confirm', {
  method: 'POST',
  token,
  body: { orderId: order.id },
})).body, 'simulated payment')
assert(payment.status === 'paid' && payment.orderId === order.id, 'simulated payment did not settle the order')

const subscription = assertResult((await request('/api/v1/subscriptions/current', { token })).body, 'subscription lookup')
assert(subscription.status === 'active', `subscription is not active after quota TCC: ${subscription.status}`)
const balance = assertResult((await request('/api/v1/quota/balance', { token })).body, 'quota balance')
assert(balance?.quotaTokens > 0 && balance.remainingTokens === balance.quotaTokens, 'quota was not provisioned after payment')

const submittedSource = assertResult((await request('/api/v1/creative-collections/import-url', {
  method: 'POST', token, body: { url: 'http://mock-corpus:8091/story?utm_source=e2e' },
})).body, 'public corpus source submission')
assert(submittedSource.status === 'quarantined', 'new corpus source did not enter quarantine')
const privateCorpusItem = await waitFor('corpus extraction', async () => {
  const page = assertResult((await request('/api/v1/creative-corpus/search?visibility=private&query=%E9%9B%A8%E4%BC%9E', { token })).body,
    'private corpus search')
  return page.items.find((item) => item.title.includes('雨伞')) ?? null
}, 90_000)
assert(privateCorpusItem.mechanism && privateCorpusItem.visibility === 'private',
  'submitted public source did not produce an isolated private mechanism card')
const collection = assertResult((await request('/api/v1/creative-collections', {
  method: 'POST', token, body: {
    corpusItemId: privateCorpusItem.id,
    title: privateCorpusItem.title,
    mechanism: privateCorpusItem.mechanism,
    notes: 'E2E 私人备注',
    tags: ['误会'],
  },
})).body, 'private corpus collection')
assert(collection.notes === 'E2E 私人备注', 'private corpus overlay did not preserve user notes')

const fingerprintConsent = assertResult((await request('/api/v1/creative-fingerprint/settings', {
  method: 'PUT', token, body: { enabled: true },
})).body, 'creative fingerprint consent')
assert(fingerprintConsent.enabled && fingerprintConsent.consentedAt,
  'creative fingerprint consent was not independently persisted')

const memorySettings = assertResult((await request('/api/v1/inspiration-memories/settings', {
  method: 'PUT',
  token,
  body: { enabled: true },
})).body, 'inspiration memory consent')
assert(memorySettings.enabled === true && memorySettings.consentedAt, 'long-term learning consent was not persisted')

const conversation = assertResult((await request('/api/v1/inspiration-conversations', {
  method: 'POST',
  token,
  body: { creativeMode: 'guided', title: 'Compose 灵感旅程' },
})).body, 'inspiration conversation creation')
assert(conversation.creativeMode === 'guided' && conversation.promptPolicyVersion === 'inspiration.v1',
  'inspiration conversation omitted its mode or policy version')

const card = assertResult((await request(`/api/v1/inspiration-conversations/${conversation.id}/cards`, {
  method: 'POST',
  token,
  body: { sourceMessageId: null, kind: 'premise', title: '海上城市', content: '一座城市会回应居民的梦境。' },
})).body, 'inspiration card creation')
const adoptedCard = assertResult((await request(`/api/v1/inspiration-conversations/cards/${card.id}`, {
  method: 'PATCH',
  token,
  body: { adopted: true, version: card.version },
})).body, 'inspiration card adoption')
assert(adoptedCard.adopted === true && adoptedCard.version === card.version + 1, 'inspiration card adoption was not versioned')

const creativeExperiment = assertResult((await request('/api/v1/inspiration-experiments', {
  method: 'POST', token, headers: { 'Idempotency-Key': `creative-experiment-${suffix}` },
  body: {
    originType: 'inspiration', originId: conversation.id,
    prompt: '把会回应梦境的海上城市变成三个不同风险等级的故事前提。',
    model: 'dramaip-e2e', maxTokens: 128,
  },
})).body, 'creative experiment')
assert(creativeExperiment.variants.length === 3
  && creativeExperiment.variants.map((variant) => variant.lane).join(',') === 'conservative,balanced,wild',
  'creative experiment did not return the fixed three lanes')
const reviewedExperiment = assertResult((await request(`/api/v1/inspiration-experiments/${creativeExperiment.id}/review`, {
  method: 'POST', token, body: {
    version: creativeExperiment.version,
    selectedVariantId: creativeExperiment.variants[1].id,
    rejected: false,
  },
})).body, 'creative experiment review')
assert(reviewedExperiment.status === 'completed' && reviewedExperiment.variants[1].selected,
  'creative experiment selection was not persisted')
const learnedFingerprint = assertResult((await request('/api/v1/creative-fingerprint', { token })).body,
  'creative fingerprint evidence')
assert(learnedFingerprint.dimensions.some((dimension) => dimension.confidence > 0),
  'an explicitly selected result did not update the authorized creative fingerprint')

for (let round = 1; round <= 6; round += 1) {
  const started = assertResult((await request(`/api/v1/inspiration-conversations/${conversation.id}/messages`, {
    method: 'POST',
    token,
    headers: { 'Idempotency-Key': `inspiration-${suffix}-${round}` },
    body: { model: 'dramaip-e2e', content: `第 ${round} 轮：继续推演这座城市`, maxTokens: 128 },
  })).body, `inspiration round ${round}`)
  assert(started.status === 'running' && started.runId, `inspiration round ${round} did not start a run`)
  await waitFor(`inspiration round ${round}`, async () => {
    const page = assertResult((await request(`/api/v1/inspiration-conversations/${conversation.id}/messages`, { token })).body,
      `inspiration round ${round} messages`)
    return page.items.some((message) => message.role === 'assistant' && message.runId === started.runId)
  })
}

const events = await replayEvents(conversation.id, token)
assert(events.filter((event) => event.event === 'completed').length === 6, 'SSE replay omitted completed inspiration runs')
assert(events.some((event) => event.event === 'delta'), 'SSE replay omitted provider deltas')
const lastEventId = Math.max(...events.map((event) => event.id))
const tailEvents = await replayEvents(conversation.id, token, lastEventId - 1)
assert(tailEvents.length === 1 && tailEvents[0].id === lastEventId, 'Last-Event-ID replay returned the wrong event range')

const persistedConversation = assertResult((await request(`/api/v1/inspiration-conversations/${conversation.id}`, { token })).body,
  'inspiration conversation reload')
assert(persistedConversation.completeTurns === 6, 'six complete inspiration turns were not persisted')

const memories = await waitFor('the six-turn memory job', async () => {
  const items = assertResult((await request('/api/v1/inspiration-memories', { token })).body, 'inspiration memories')
  return items.length > 0 ? items : null
}, 90_000)
assert(memories.some((memory) => memory.kind === 'theme' && memory.sourceConversationIds.includes(conversation.id)),
  'memory worker did not retain an allowed creative preference with its source')

const branch = assertResult((await request(`/api/v1/inspiration-conversations/${conversation.id}/fork`, {
  method: 'POST', token,
})).body, 'inspiration branch')
assert(branch.parentConversationId === conversation.id, 'inspiration branch did not retain its parent')

const preview = assertResult((await request('/api/v1/inspiration-project-previews', {
  method: 'POST',
  token,
  body: {
    conversationId: conversation.id,
    title: '梦潮之城',
    projectMode: 'single_season',
    brief: { premise: '一座城市会回应居民的梦境。', audience: '青年奇幻读者' },
    cardIds: [card.id],
    corpusItemIds: [privateCorpusItem.id],
  },
})).body, 'inspiration project preview')
assert(preview.status === 'pending', 'project preview was committed before confirmation')

const confirmed = assertResult((await request(`/api/v1/inspiration-project-previews/${preview.id}/confirm`, {
  method: 'POST',
  token,
  headers: { 'Idempotency-Key': `inspiration-preview-${suffix}` },
})).body, 'inspiration project confirmation')
assert(confirmed.projectPackage?.format === 'dramaip-project-package' && confirmed.projectPackage?.schemaVersion === 4,
  'confirmed inspiration preview did not produce a schema v4 project package')
assert(confirmed.projectPackage.chapters.length === 0 && confirmed.projectPackage.resources.length === 1,
  'schema v4 project package did not preserve the selected zero-chapter brief')
assert(confirmed.projectPackage.creativeIntelligence.corpusItems.length === 1
  && confirmed.projectPackage.creativeIntelligence.provenance.length === 1,
  'schema v4 project package did not preserve selected abstract corpus and sanitized provenance')

const inspirationDraft = assertResult((await request('/api/v1/drafts', {
  method: 'POST', token, expected: 201, body: confirmed.cloudDraft,
})).body, 'inspiration cloud project draft')
assert(inspirationDraft.kind === 'project', 'confirmed inspiration preview did not create a project draft')

const draft = assertResult((await request('/api/v1/drafts', {
  method: 'POST',
  token,
  expected: 201,
  body: {
    clientId: `e2e-${suffix}`,
    kind: 'project',
    captureMode: 'text',
    title: 'E2E draft',
    content: 'Created by the blocking Java Compose journey.',
  },
})).body, 'draft creation')
const drafts = assertResult((await request('/api/v1/drafts', { token })).body, 'draft listing')
assert(drafts.some((candidate) => candidate.id === draft.id), 'created draft was not visible to its owner')
assertResult((await request(`/api/v1/drafts/${draft.id}`, { method: 'DELETE', token })).body, 'draft deletion')

const refreshed = assertResult((await request('/api/v1/auth/token/refresh', {
  method: 'POST',
  headers: { 'X-Device-Id': deviceId },
  body: { refreshToken: registered.refreshToken },
})).body, 'refresh token rotation')
assert(refreshed.refreshToken !== registered.refreshToken, 'refresh token was not rotated')
const replayedOldRefresh = await request('/api/v1/auth/token/refresh', {
  method: 'POST',
  headers: { 'X-Device-Id': deviceId },
  body: { refreshToken: registered.refreshToken },
  expected: 401,
})
assert(replayedOldRefresh.body?.code === 'IDENTITY_REFRESH_INVALID', 'rotated refresh token remained usable')

assertResult((await request('/api/v1/auth/token/revoke', {
  method: 'POST',
  body: { refreshToken: refreshed.refreshToken },
})).body, 'refresh token revocation')
const revokedRefresh = await request('/api/v1/auth/token/refresh', {
  method: 'POST',
  headers: { 'X-Device-Id': deviceId },
  body: { refreshToken: refreshed.refreshToken },
  expected: 401,
})
assert(revokedRefresh.body?.code === 'IDENTITY_REFRESH_INVALID', 'revoked refresh token remained usable')

console.log(JSON.stringify({ ok: true, baseURL, userId: registered.userId, orderId: order.id, subscriptionId: subscription.id }, null, 2))
