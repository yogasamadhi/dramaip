import assert from 'node:assert/strict'
import { test } from 'node:test'
import { VIDEO_PROVIDER_KINDS, type VideoProviderConfig } from '../packages/core/src'
import {
  REAL_VIDEO_PROVIDER_KINDS,
  VIDEO_PROVIDER_ADAPTERS,
  adapterForVideoProviderKind,
  customVideoProviderAdapter,
  hailuoVideoProviderAdapter,
  openAiSoraVideoProviderAdapter,
} from '../packages/ai/src/providers/video/adapters'
import { HttpVideoProvider, type VideoHttpTransport } from '../packages/ai/src/providers/video/http.provider'
import { MockVideoProvider } from '../packages/ai/src/providers/video/mock.provider'
import { videoProviderFromConfig } from '../packages/ai/src/providers/video/factory'

function providerConfig(kind: VideoProviderConfig['kind'], patch: Partial<VideoProviderConfig> = {}): VideoProviderConfig {
  return {
    id: `${kind}-1`,
    name: `${kind} provider`,
    kind,
    baseUrl: 'https://video.example.test',
    apiKey: 'test-key',
    model: 'video-model',
    isDefault: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  }
}

test('declares independent adapter slots for every real video provider kind', () => {
  const expectedKinds = VIDEO_PROVIDER_KINDS.filter((kind) => kind !== 'mock' && kind !== 'custom')
  assert.deepEqual(REAL_VIDEO_PROVIDER_KINDS, expectedKinds)

  for (const kind of REAL_VIDEO_PROVIDER_KINDS) {
    const adapter = VIDEO_PROVIDER_ADAPTERS[kind]
    assert.equal(adapter.kind, kind)
    assert.equal(adapterForVideoProviderKind(kind), adapter)
    if (kind === 'openai_sora' || kind === 'hailuo') continue
    assert.throws(
      () =>
        adapter.createTaskRequest(
          { model: 'video-model', prompt: 'shot prompt' },
          providerConfig(kind),
        ),
      /真实 API 映射尚未启用/,
    )
  }
})

test('MiniMax Hailuo adapter follows create, query, and file-retrieval lifecycle', async () => {
  const requests: unknown[] = []
  const transport: VideoHttpTransport = {
    async request(request) {
      requests.push(request)
      if (request.method === 'POST') {
        return { task_id: 'hailuo-task-1', base_resp: { status_code: 0, status_msg: 'success' } }
      }
      if ((request.url as string).includes('/query/video_generation')) {
        return { task_id: 'hailuo-task-1', status: 'Success', file_id: 'hailuo-file-1', base_resp: { status_code: 0 } }
      }
      return {
        file: { file_id: 'hailuo-file-1', download_url: 'https://download.minimaxi.example/result.mp4' },
        base_resp: { status_code: 0 },
      }
    },
  }
  const provider = new HttpVideoProvider({
    ...providerConfig('hailuo', {
      baseUrl: '',
      model: 'MiniMax-Hailuo-2.3',
      defaultParams: '{"duration":10,"resolution":"1080P","prompt_optimizer":false}',
    }),
    adapter: hailuoVideoProviderAdapter,
    transport,
  })

  const created = await provider.createTask({
    prompt: 'vertical drama close-up',
    negativePrompt: 'blur',
    referenceImageUrls: ['https://assets.example.test/reference.png'],
  })
  assert.equal(created.status, 'pending')
  assert.equal(created.remoteTaskId, 'hailuo-task-1')

  const createRequest = requests[0] as {
    method: string
    url: string
    headers: Record<string, string>
    body: Record<string, unknown>
  }
  assert.equal(createRequest.method, 'POST')
  assert.equal(createRequest.url, 'https://api.minimaxi.com/v1/video_generation')
  assert.equal(createRequest.headers.Authorization, 'Bearer test-key')
  assert.equal(createRequest.body.model, 'MiniMax-Hailuo-2.3')
  assert.equal(createRequest.body.prompt, 'vertical drama close-up')
  assert.equal(createRequest.body.first_frame_image, 'https://assets.example.test/reference.png')
  assert.equal(createRequest.body.duration, 10)
  // The public API does not permit 1080P for the supplied 10-second configuration.
  assert.equal(createRequest.body.resolution, '768P')
  assert.equal(createRequest.body.prompt_optimizer, false)
  assert.equal(createRequest.body.negative_prompt, undefined)

  const checked = await provider.getTaskStatus('hailuo-task-1')
  assert.equal(checked.status, 'success')
  assert.equal(checked.remoteTaskId, 'hailuo-task-1')
  assert.equal(checked.results[0].resultVideoUrl, 'https://download.minimaxi.example/result.mp4')
  assert.match(checked.results[0].rawMeta ?? '', /hailuo-file-1/)

  const statusRequest = requests[1] as { method: string; url: string }
  assert.equal(statusRequest.method, 'GET')
  assert.equal(statusRequest.url, 'https://api.minimaxi.com/v1/query/video_generation?task_id=hailuo-task-1')
  const fileRequest = requests[2] as { method: string; url: string; headers: Record<string, string> }
  assert.equal(fileRequest.method, 'GET')
  assert.equal(fileRequest.url, 'https://api.minimaxi.com/v1/files/retrieve?file_id=hailuo-file-1')
  assert.equal(fileRequest.headers.Authorization, 'Bearer test-key')

  assert.throws(
    () => hailuoVideoProviderAdapter.createTaskRequest(
      { model: 'MiniMax-Hailuo-2.3', prompt: 'close-up', referenceImageUrls: ['file:///private/reference.png'] },
      providerConfig('hailuo'),
    ),
    /本地文件不会自动上传/,
  )

  const limited = hailuoVideoProviderAdapter.mapTaskState({
    task_id: 'hailuo-task-2',
    base_resp: { status_code: 1002, status_msg: 'too many requests' },
  }, 'create')
  assert.equal(limited.status, 'failed')
  assert.match(limited.errorMessage ?? '', /限流/)
})

test('openai sora adapter builds official video requests and maps lifecycle states', async () => {
  const requests: unknown[] = []
  const transport: VideoHttpTransport = {
    async request(request) {
      requests.push(request)
      if (request.method === 'POST') {
        return { id: 'video_1', status: 'queued', progress: 0 }
      }
      return { id: 'video_1', status: 'completed', progress: 100, model: 'sora-2' }
    },
  }

  const provider = new HttpVideoProvider({
    ...providerConfig('openai_sora', {
      baseUrl: '',
      model: 'sora-2',
      defaultParams: '{"size":"1280x720","seconds":4,"quality":"standard"}',
    }),
    adapter: openAiSoraVideoProviderAdapter,
    transport,
  })

  const created = await provider.createTask({
    prompt: 'vertical drama close-up',
    referenceImageUrls: ['https://assets.example.test/reference.png'],
  })
  assert.equal(created.status, 'running')
  assert.equal(created.remoteTaskId, 'video_1')

  const createRequest = requests[0] as {
    method: string
    url: string
    headers: Record<string, string>
    body: {
      model: string
      prompt: string
      size: string
      seconds: string
      quality: string
      input_reference: { image_url: string }
    }
  }
  assert.equal(createRequest.method, 'POST')
  assert.equal(createRequest.url, 'https://api.openai.com/v1/videos')
  assert.equal(createRequest.headers.Authorization, 'Bearer test-key')
  assert.equal(createRequest.body.model, 'sora-2')
  assert.equal(createRequest.body.prompt, 'vertical drama close-up')
  assert.equal(createRequest.body.size, '1280x720')
  assert.equal(createRequest.body.seconds, '4')
  assert.equal(createRequest.body.quality, 'standard')
  assert.deepEqual(createRequest.body.input_reference, { image_url: 'https://assets.example.test/reference.png' })

  const checked = await provider.getTaskStatus('video_1')
  assert.equal(checked.status, 'success')
  assert.equal(checked.results[0].resultVideoUrl, 'https://api.openai.com/v1/videos/video_1/content')

  const statusRequest = requests[1] as { method: string; url: string }
  assert.equal(statusRequest.method, 'GET')
  assert.equal(statusRequest.url, 'https://api.openai.com/v1/videos/video_1')

  const failed = openAiSoraVideoProviderAdapter.mapTaskState({
    id: 'video_2',
    status: 'failed',
    error: { message: 'content policy rejection' },
  }, 'status')
  assert.equal(failed.status, 'failed')
  assert.equal(failed.errorMessage, 'content policy rejection')
})

test('custom adapter builds OpenAI-compatible requests and maps task states', async () => {
  const requests: unknown[] = []
  const transport: VideoHttpTransport = {
    async request(request) {
      requests.push(request)
      if (request.method === 'POST') {
        return { data: { task_id: 'remote-1', task_status: 'processing' } }
      }
      return {
        data: {
          task_id: 'remote-1',
          task_status: 'success',
          videos: [{ url: 'https://video.example.test/result.mp4', cover_image_url: 'https://video.example.test/cover.jpg' }],
        },
      }
    },
  }

  const provider = new HttpVideoProvider({
    ...providerConfig('custom'),
    adapter: customVideoProviderAdapter,
    transport,
  })

  const created = await provider.createTask({
    model: 'video-model',
    prompt: 'close-up shot',
    negativePrompt: 'blur',
    referenceImageUrls: ['https://assets.example.test/ref.png'],
    defaultParams: '{"duration":5}',
  })
  assert.equal(created.status, 'running')
  assert.equal(created.remoteTaskId, 'remote-1')

  const createRequest = requests[0] as {
    method: string
    url: string
    headers: Record<string, string>
    body: { prompt: string; negative_prompt: string; params: { duration: number } }
  }
  assert.equal(createRequest.method, 'POST')
  assert.equal(createRequest.url, 'https://video.example.test/video/generations')
  assert.equal(createRequest.headers.Authorization, 'Bearer test-key')
  assert.equal(createRequest.body.prompt, 'close-up shot')
  assert.equal(createRequest.body.negative_prompt, 'blur')
  assert.deepEqual(createRequest.body.params, { duration: 5 })

  const checked = await provider.getTaskStatus('remote-1')
  assert.equal(checked.status, 'success')
  assert.equal(checked.results[0].resultVideoUrl, 'https://video.example.test/result.mp4')
  assert.equal(checked.results[0].coverImageUrl, 'https://video.example.test/cover.jpg')

  const statusRequest = requests[1] as { method: string; url: string }
  assert.equal(statusRequest.method, 'GET')
  assert.equal(statusRequest.url, 'https://video.example.test/video/generations/remote-1')
})

test('factory keeps mock, custom, and real provider routing separated', async () => {
  const mock = videoProviderFromConfig(providerConfig('mock'))
  assert.ok(mock instanceof MockVideoProvider)

  const custom = videoProviderFromConfig(providerConfig('custom'))
  assert.equal(custom.kind, 'custom')

  const real = videoProviderFromConfig(providerConfig('kling'))
  assert.equal(real.kind, 'kling')
  await assert.rejects(
    () => real.createTask({ model: 'video-model', prompt: 'shot prompt' }),
    /真实 API 映射尚未启用/,
  )

  const sora = videoProviderFromConfig(providerConfig('openai_sora', { baseUrl: '' }))
  assert.equal(sora.kind, 'openai_sora')
})
