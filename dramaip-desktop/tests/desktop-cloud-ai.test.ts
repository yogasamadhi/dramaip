import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CLOUD_AI_BASE_URL_PREFIX,
  CLOUD_AI_PROVIDER_ID,
  cloudBaseUrl,
  isCloudModelConfig,
  parseCloudProvider,
  summarizeCloudContext,
} from '../apps/desktop/electron/cloud-ai-protocol'

test('cloud AI config is a non-secret desktop BFF reference', () => {
  const baseUrl = cloudBaseUrl('test')
  assert.equal(baseUrl, `${CLOUD_AI_BASE_URL_PREFIX}test`)
  assert.equal(parseCloudProvider(baseUrl), 'test')
  assert.equal(isCloudModelConfig({ provider: CLOUD_AI_PROVIDER_ID, baseUrl }), true)
  assert.equal(isCloudModelConfig({ provider: CLOUD_AI_PROVIDER_ID, baseUrl: 'https://cloud.example' }), false)
  assert.throws(() => cloudBaseUrl('test/../../provider'), /标识无效/)
})

test('cloud AI sends only a bounded active prompt context', () => {
  const summary = summarizeCloudContext([
    { role: 'system', content: '只根据当前任务回答。' },
    { role: 'user', content: '写一行短剧开场。' },
  ], 128)
  assert.equal(summary.messages.length, 2)
  assert.equal(summary.contextCharacters > 0, true)
  assert.deepEqual(summary.messages.map((message) => message.role), ['system', 'user'])
  assert.throws(() => summarizeCloudContext([{ role: 'user', content: 'x'.repeat(24_001) }], 128), /24,000/)
  assert.throws(() => summarizeCloudContext([{ role: 'tool' as 'user', content: 'no' }], 128), /无效消息/)
})
