import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_PRODUCTION_STUDIO_FEATURE_FLAGS,
  PRODUCTION_STUDIO_FEATURES,
  rankProviderRoutes,
  type ProviderCapabilityReport,
} from '@sdns/core'

function report(
  providerConfigId: string,
  patch: Partial<ProviderCapabilityReport> = {},
): ProviderCapabilityReport {
  return {
    providerConfigId,
    providerKind: 'test',
    canSubmit: true,
    capabilities: ['image_generation'],
    reasons: [],
    ...patch,
  }
}

test('v2 feature flags are explicit and cloud review remains fail-closed by default', () => {
  assert.deepEqual(Object.keys(DEFAULT_PRODUCTION_STUDIO_FEATURE_FLAGS).sort(), [...PRODUCTION_STUDIO_FEATURES].sort())
  assert.equal(DEFAULT_PRODUCTION_STUDIO_FEATURE_FLAGS.cloud_review, false)
  assert.equal(DEFAULT_PRODUCTION_STUDIO_FEATURE_FLAGS.retake, true)
})

test('provider routing is deterministic and lookdev never selects more than two providers', () => {
  const result = rankProviderRoutes({
    mode: 'lookdev',
    maximumProviders: 12,
    reports: [
      report('slow', { successRate: 0.9, medianLatencyMs: 150_000, policy: {
        id: 'policy-slow', providerKind: 'slow', regions: [], trainsOnInputs: 'no',
        createdAt: '', updatedAt: '',
      } }),
      report('reliable', { successRate: 0.99, medianLatencyMs: 10_000, policy: {
        id: 'policy-reliable', providerKind: 'reliable', regions: [], trainsOnInputs: 'no',
        createdAt: '', updatedAt: '',
      } }),
      report('blocked', { canSubmit: false, successRate: 1 }),
    ],
  })
  assert.deepEqual(result.candidates.map((candidate) => candidate.providerConfigId), ['reliable', 'slow'])
  assert.equal(result.requiresUserConfirmation, true)
})

test('unknown provider policy requires confirmation and allowlists are enforced', () => {
  const result = rankProviderRoutes({
    mode: 'draft',
    allowedProviderConfigIds: ['unknown-policy'],
    reports: [
      report('excluded', { successRate: 1 }),
      report('unknown-policy', { successRate: 0.5 }),
    ],
  })
  assert.deepEqual(result.candidates.map((candidate) => candidate.providerConfigId), ['unknown-policy'])
  assert.equal(result.requiresUserConfirmation, true)
})
