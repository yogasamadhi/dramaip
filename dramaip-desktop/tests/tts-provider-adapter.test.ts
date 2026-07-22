import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getTtsProviderCapability } from '../packages/core/src'
import { OpenAITtsProvider } from '../packages/ai/src/providers/audio/openai-tts.provider'

test('OpenAI TTS stays disabled without both a key and explicit production feature switch', () => {
  assert.equal(getTtsProviderCapability({ kind: 'openai_tts' }).canSubmit, false)
  assert.match(getTtsProviderCapability({ kind: 'openai_tts', apiKey: 'test-key' }).reason ?? '', /开关/)
  assert.equal(getTtsProviderCapability({ kind: 'openai_tts', apiKey: 'test-key', featureEnabled: true }).supportsCustomVoices, false)
})

test('OpenAI TTS sends the official synchronous speech request and returns base64 audio', async () => {
  const requests: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = []
  const provider = new OpenAITtsProvider({ kind: 'openai_tts', apiKey: 'test-key', featureEnabled: true }, {
    async request(input) { requests.push(input); return { bytes: new Uint8Array([1, 2, 3]), contentType: 'audio/mpeg' } },
  })
  const result = await provider.generate({ input: '欢迎收看。', voice: 'alloy', instructions: '沉稳', speed: 1.1, responseFormat: 'mp3' })
  assert.deepEqual(requests[0], { url: 'https://api.openai.com/v1/audio/speech', headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' }, body: { model: 'gpt-4o-mini-tts', input: '欢迎收看。', voice: 'alloy', response_format: 'mp3', instructions: '沉稳', speed: 1.1 }, signal: undefined })
  assert.equal(result.b64Audio, 'AQID')
  assert.equal(result.mimeType, 'audio/mpeg')
})

test('OpenAI TTS rejects oversized text before any request', async () => {
  const provider = new OpenAITtsProvider({ kind: 'openai_tts', apiKey: 'test-key', featureEnabled: true })
  await assert.rejects(() => provider.generate({ input: 'x'.repeat(4_097), voice: 'alloy' }), /4096/)
})
