import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  estimateVideoProduction,
  getVideoProviderCapability,
  type VideoProviderConfig,
} from '../packages/core/src'

function providerConfig(kind: VideoProviderConfig['kind'], patch: Partial<VideoProviderConfig> = {}): VideoProviderConfig {
  return {
    id: `${kind}-provider`,
    name: `${kind} provider`,
    kind,
    baseUrl: 'https://video.example.test',
    model: 'video-model',
    isDefault: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  }
}

test('production console only enables providers with a usable submission path', () => {
  const mock = getVideoProviderCapability(providerConfig('mock'))
  assert.equal(mock.canSubmit, true)
  assert.equal(mock.supportsReferenceImages, true)
  assert.equal(mock.supportsRemoteCancel, false)

  const pendingAdapter = getVideoProviderCapability(providerConfig('kling'))
  assert.equal(pendingAdapter.canSubmit, false)
  assert.match(pendingAdapter.reason ?? '', /真实适配器尚未启用/)

  const incompleteCustom = getVideoProviderCapability(providerConfig('custom', { baseUrl: '' }))
  assert.equal(incompleteCustom.canSubmit, false)
  assert.match(incompleteCustom.reason ?? '', /Base URL/)

  const unconfiguredSora = getVideoProviderCapability(providerConfig('openai_sora', { apiKey: '' }))
  assert.equal(unconfiguredSora.canSubmit, false)
  assert.match(unconfiguredSora.reason ?? '', /API Key/)

  const configuredSora = getVideoProviderCapability(providerConfig('openai_sora', { apiKey: 'masked:v1:configured' }))
  assert.equal(configuredSora.canSubmit, true)
})

test('production preflight uses bounded local provider defaults for time and cost estimates', () => {
  const estimated = estimateVideoProduction(providerConfig('custom', {
    model: 'custom-v2',
    defaultParams: '{"seconds":"6","costPerSecond":"0.2","currency":"cny"}',
  }))
  assert.deepEqual(estimated, {
    model: 'custom-v2',
    durationSeconds: 6,
    waitSeconds: 90,
    estimatedCost: 1.2,
    currency: 'CNY',
  })

  const malformedMock = estimateVideoProduction(providerConfig('mock', { defaultParams: '{not json' }))
  assert.equal(malformedMock.durationSeconds, 4)
  assert.equal(malformedMock.waitSeconds, 1)
  assert.equal(malformedMock.estimatedCost, undefined)
})
