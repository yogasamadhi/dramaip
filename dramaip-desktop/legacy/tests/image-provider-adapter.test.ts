import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { getImageProviderCapability } from '../packages/core/src'
import { MockImageProvider } from '../packages/ai/src/providers/image/mock.provider'
import { OpenAIImageProvider } from '../packages/ai/src/providers/image/openai-image.provider'

test('OpenAI Image stays disabled without both a key and explicit production feature switch', () => {
  assert.equal(getImageProviderCapability({ kind: 'openai_image' }).canSubmit, false)
  assert.match(getImageProviderCapability({ kind: 'openai_image', apiKey: 'test-key' }).reason ?? '', /开关/)
  assert.equal(getImageProviderCapability({ kind: 'openai_image', apiKey: 'test-key', featureEnabled: true }).canSubmit, true)
})

test('OpenAI Image sends the documented synchronous images generation request and preserves b64 output', async () => {
  const requests: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = []
  const provider = new OpenAIImageProvider({ kind: 'openai_image', apiKey: 'test-key', featureEnabled: true }, {
    async request(input) {
      requests.push(input)
      return { data: [{ b64_json: 'ZmFrZS1pbWFnZQ==', revised_prompt: 'revised prompt' }], usage: { input_tokens: 12, output_tokens: 34, total_tokens: 46 } }
    },
    async requestMultipart() {
      throw new Error('unexpected multipart request')
    },
  })
  const [result] = await provider.generate({ prompt: 'vertical anime heroine', size: '1024x1536', quality: 'medium', outputFormat: 'webp' })
  assert.deepEqual(requests[0], {
    url: 'https://api.openai.com/v1/images/generations',
    headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
    body: { model: 'gpt-image-2', prompt: 'vertical anime heroine', size: '1024x1536', quality: 'medium', output_format: 'webp', n: 1 },
  })
  assert.equal(result.mimeType, 'image/webp')
  assert.equal(result.b64Json, 'ZmFrZS1pbWFnZQ==')
  assert.equal(result.usage?.totalTokens, 46)
})

test('OpenAI text-to-image refuses local reference upload and keeps it on the edits path', async () => {
  const provider = new OpenAIImageProvider({ kind: 'openai_image', apiKey: 'test-key', featureEnabled: true })
  await assert.rejects(() => provider.generate({ prompt: 'x', referenceImages: ['file:///private/ref.png'] }), /不会上传本地参考图/)
  assert.equal((await new MockImageProvider().generate({ prompt: 'fixture' }))[0].mimeType, 'image/png')
})

test('OpenAI Image Edit sends local sources only through multipart form data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dramaip-image-edit-'))
  const imagePath = join(dir, 'source.png')
  writeFileSync(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL1eQAAAABJRU5ErkJggg==', 'base64'))
  try {
    let received: { url: string; headers: Record<string, string>; body: FormData } | undefined
    const provider = new OpenAIImageProvider({ kind: 'openai_image', apiKey: 'test-key', featureEnabled: true }, {
      async request() {
        throw new Error('unexpected JSON request')
      },
      async requestMultipart(input) {
        received = input
        return { data: [{ b64_json: 'ZmFrZS1lZGl0' }] }
      },
    })
    const [result] = await provider.edit({
      prompt: 'keep the character, change the light',
      images: [{ localPath: imagePath, fileName: 'source.png', mimeType: 'image/png' }],
      quality: 'low',
    })
    assert.equal(received?.url, 'https://api.openai.com/v1/images/edits')
    assert.equal(received?.headers.Authorization, 'Bearer test-key')
    assert.equal(received?.headers['Content-Type'], undefined)
    assert.equal(received?.body.get('prompt'), 'keep the character, change the light')
    assert.equal(received?.body.getAll('image[]').length, 1)
    assert.equal(result.b64Json, 'ZmFrZS1lZGl0')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
