import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GenerationCostEntry, GenerationLineage, VideoGenerationTask, VideoProviderConfig, VideoResult } from '../packages/core/src'
import { cancelVideoGenerationTask, createVideoGenerationTask } from '../packages/ai/src/providers/video/video-generation.service'

function providerConfig(): VideoProviderConfig {
  return {
    id: 'provider-1',
    name: 'Custom Video',
    kind: 'custom',
    baseUrl: 'https://video.example.test',
    apiKey: 'test-key',
    model: 'video-model',
    isDefault: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function createVideoServiceRepos(config: VideoProviderConfig) {
  let task: VideoGenerationTask | undefined
  const results: VideoResult[] = []
  const lineages: GenerationLineage[] = []
  const costs: GenerationCostEntry[] = []
  return {
    repos: {
      db: {},
      videoProviderConfig: {
        getVideoProviderConfig: (_db: unknown, id: string) => id === config.id ? config : undefined,
        listVideoProviderConfigs: () => [config],
        getDefaultVideoProviderConfig: () => config,
      },
      videoTask: {
        getVideoTask: (_db: unknown, id: string) => task?.id === id ? task : undefined,
        createVideoTask: (_db: unknown, data: Partial<VideoGenerationTask> & { provider: string; model: string }) => {
          task = {
            id: 'task-1',
            projectId: data.projectId,
            episodeId: data.episodeId,
            sceneId: data.sceneId,
            shotId: data.shotId,
            lineageId: data.lineageId,
            provider: data.provider,
            model: data.model,
            prompt: data.prompt ?? '',
            negativePrompt: data.negativePrompt,
            referenceImageUrls: data.referenceImageUrls ?? [],
            status: data.status ?? 'pending',
            remoteTaskId: data.remoteTaskId,
            errorMessage: data.errorMessage,
            note: data.note,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          }
          return task
        },
        updateVideoTask: (_db: unknown, id: string, patch: Partial<VideoGenerationTask>) => {
          if (!task || task.id !== id) return undefined
          task = { ...task, ...patch, updatedAt: '2026-01-01T00:00:01.000Z' }
          return task
        },
      },
      videoResult: {
        createVideoResult: (_db: unknown, data: Partial<VideoResult>) => {
          const result = {
            id: `result-${results.length + 1}`,
            taskId: data.taskId ?? '',
            shotId: data.shotId,
            resultVideoUrl: data.resultVideoUrl ?? '',
            remoteVideoUrl: data.remoteVideoUrl,
            localVideoPath: data.localVideoPath,
            coverImageUrl: data.coverImageUrl,
            remoteCoverImageUrl: data.remoteCoverImageUrl,
            localCoverImagePath: data.localCoverImagePath,
            rawMeta: data.rawMeta,
            archivedAt: data.archivedAt,
            archiveError: data.archiveError,
            isBest: false,
            createdAt: '2026-01-01T00:00:00.000Z',
          }
          results.push(result)
          return result
        },
      },
      generation: {
        createGenerationLineage: (_db: unknown, data: Partial<GenerationLineage>) => {
          const lineage = {
            id: `lineage-${lineages.length + 1}`,
            mediaType: 'video',
            taskKind: 'video_generation',
            sourceSnapshot: {}, providerSnapshot: {}, parameterSnapshot: {}, referenceAssets: [], completeness: 'unknown',
            createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
            ...data,
          } as GenerationLineage
          lineages.push(lineage)
          return lineage
        },
        updateGenerationLineage: (_db: unknown, id: string, patch: Partial<GenerationLineage>) => {
          const index = lineages.findIndex((lineage) => lineage.id === id)
          if (index < 0) return undefined
          lineages[index] = { ...lineages[index], ...patch, updatedAt: '2026-01-01T00:00:01.000Z' }
          return lineages[index]
        },
        getGenerationLineage: (_db: unknown, id: string) => lineages.find((lineage) => lineage.id === id),
        clearGenerationLineageAdoptionForSource: () => undefined,
        createGenerationCostEntry: (_db: unknown, data: Partial<GenerationCostEntry>) => {
          const cost = { id: `cost-${costs.length + 1}`, mediaType: 'video', status: 'unknown', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...data } as GenerationCostEntry
          costs.push(cost)
          return cost
        },
      },
    } as never,
    get task() {
      return task
    },
    results,
    lineages,
    costs,
  }
}

test('video generation create preserves provider failed status', async () => {
  const { repos } = createVideoServiceRepos(providerConfig())
  const result = await createVideoGenerationTask({
    repos,
    videoProviderFactory: () => ({
      kind: 'custom',
      name: 'Custom Video',
      async createTask() {
        return {
          status: 'failed',
          remoteTaskId: 'remote-fail',
          errorMessage: 'prompt rejected by provider',
          results: [],
        }
      },
      async getTaskStatus() {
        throw new Error('not used')
      },
    }),
  }, {
    providerConfigId: 'provider-1',
    prompt: 'unsafe prompt',
  })

  assert.equal(result.task.status, 'failed')
  assert.equal(result.task.remoteTaskId, 'remote-fail')
  assert.equal(result.task.errorMessage, 'prompt rejected by provider')
  assert.equal(result.results.length, 0)
})

test('video generation freezes a credential-free capability snapshot and local estimate', async () => {
  const config = { ...providerConfig(), defaultParams: '{"seed":42,"seconds":4,"estimatedCost":1.25,"currency":"cny","apiKey":"must-not-persist"}' }
  const fixture = createVideoServiceRepos(config)
  const result = await createVideoGenerationTask({
    repos: fixture.repos,
    videoProviderFactory: () => ({
      kind: 'custom', name: 'Custom Video',
      async createTask() { return { status: 'pending', remoteTaskId: 'snapshot-1', results: [] } },
      async getTaskStatus() { throw new Error('not used') },
    }),
  }, { providerConfigId: 'provider-1', projectId: 'project-1', prompt: '保留在本地项目账本的参数', referenceImageUrls: ['https://example.test/ref.png'] })

  assert.equal(result.task.lineageId, fixture.lineages[0]?.id)
  assert.equal(fixture.lineages[0]?.seed, '42')
  assert.equal(fixture.lineages[0]?.parameterSnapshot.prompt, '保留在本地项目账本的参数')
  assert.equal(fixture.lineages[0]?.providerSnapshot.apiKey, undefined)
  assert.equal((fixture.lineages[0]?.providerSnapshot.defaultParams as { apiKey?: string }).apiKey, '[redacted]')
  assert.equal(fixture.costs[0]?.estimatedCost, 1.25)
  assert.equal(fixture.costs[0]?.currency, 'CNY')
  assert.equal(fixture.costs[0]?.status, 'estimated')
})

test('video generation service enforces a real-provider feature gate outside the renderer', async () => {
  const config = {
    ...providerConfig(),
    kind: 'hailuo' as const,
    apiKey: 'keychain:configured',
    defaultParams: '{"featureEnabled":false}',
  }
  const { repos } = createVideoServiceRepos(config)
  let providerCreated = false

  await assert.rejects(
    () => createVideoGenerationTask({
      repos,
      videoProviderFactory: () => {
        providerCreated = true
        throw new Error('must not construct a disabled provider')
      },
    }, {
      providerConfigId: 'provider-1',
      prompt: 'safe prompt',
    }),
    /生产渠道开关/,
  )
  assert.equal(providerCreated, false)
})

test('video generation cancellation only records a remote cancel after the adapter accepts it', async () => {
  const config = {
    ...providerConfig(),
    kind: 'wan' as const,
    name: 'Alibaba Wan',
    apiKey: 'keychain:configured',
    defaultParams: '{"featureEnabled":true}',
  }
  const fixture = createVideoServiceRepos(config)
  let canceledRemoteTaskId: string | undefined
  const provider = {
    kind: 'wan',
    name: 'Alibaba Wan',
    supportsRemoteCancel: true,
    async createTask() {
      return { status: 'pending' as const, remoteTaskId: 'wan-remote-1', results: [] }
    },
    async getTaskStatus() {
      throw new Error('not used')
    },
    async cancelTask(remoteTaskId: string) {
      canceledRemoteTaskId = remoteTaskId
    },
  }

  const created = await createVideoGenerationTask({
    repos: fixture.repos,
    videoProviderFactory: () => provider,
  }, {
    providerConfigId: 'provider-1',
    prompt: 'safe prompt',
  })
  const canceled = await cancelVideoGenerationTask({
    repos: fixture.repos,
    videoProviderFactory: () => provider,
  }, created.task.id)

  assert.equal(canceledRemoteTaskId, 'wan-remote-1')
  assert.equal(canceled.remoteCanceled, true)
  assert.equal(canceled.task.status, 'canceled')
  assert.equal(canceled.task.errorMessage, undefined)
})

test('remote cancel refusal leaves a real-provider task pollable instead of fabricating cancellation', async () => {
  const config = {
    ...providerConfig(),
    kind: 'wan' as const,
    name: 'Alibaba Wan',
    apiKey: 'keychain:configured',
    defaultParams: '{"featureEnabled":true}',
  }
  const fixture = createVideoServiceRepos(config)
  const provider = {
    kind: 'wan',
    name: 'Alibaba Wan',
    supportsRemoteCancel: true,
    async createTask() {
      return { status: 'running' as const, remoteTaskId: 'wan-running-1', results: [] }
    },
    async getTaskStatus() {
      throw new Error('not used')
    },
    async cancelTask() {
      throw new Error('远端任务已开始执行')
    },
  }

  const created = await createVideoGenerationTask({
    repos: fixture.repos,
    videoProviderFactory: () => provider,
  }, {
    providerConfigId: 'provider-1',
    prompt: 'safe prompt',
  })

  await assert.rejects(
    () => cancelVideoGenerationTask({ repos: fixture.repos, videoProviderFactory: () => provider }, created.task.id),
    /已开始执行/,
  )
  assert.equal(fixture.task?.status, 'running')
  assert.equal(fixture.task?.remoteTaskId, 'wan-running-1')
})

test('video generation create stores archived local asset paths', async () => {
  const { repos } = createVideoServiceRepos(providerConfig())
  const result = await createVideoGenerationTask({
    repos,
    videoProviderFactory: () => ({
      kind: 'custom',
      name: 'Custom Video',
      async createTask() {
        return {
          status: 'success',
          remoteTaskId: 'remote-ok',
          results: [{
            resultVideoUrl: 'https://cdn.example.test/video.mp4',
            coverImageUrl: 'https://cdn.example.test/cover.jpg',
            rawMeta: '{"id":"remote-ok"}',
          }],
        }
      },
      async getTaskStatus() {
        throw new Error('not used')
      },
    }),
    async videoAssetArchiver({ providerConfig, task, result }) {
      assert.equal(providerConfig.id, 'provider-1')
      assert.equal(task.id, 'task-1')
      assert.equal(result.resultVideoUrl, 'https://cdn.example.test/video.mp4')
      return {
        resultVideoUrl: 'file:///local/result.mp4',
        remoteVideoUrl: result.resultVideoUrl,
        localVideoPath: '/local/result.mp4',
        coverImageUrl: 'file:///local/cover.jpg',
        remoteCoverImageUrl: result.coverImageUrl,
        localCoverImagePath: '/local/cover.jpg',
        archivedAt: '2026-01-01T00:00:02.000Z',
      }
    },
  }, {
    providerConfigId: 'provider-1',
    projectId: 'project-1',
    shotId: 'shot-1',
    prompt: 'safe prompt',
  })

  assert.equal(result.task.status, 'success')
  assert.equal(result.results.length, 1)
  assert.equal(result.results[0].resultVideoUrl, 'file:///local/result.mp4')
  assert.equal(result.results[0].remoteVideoUrl, 'https://cdn.example.test/video.mp4')
  assert.equal(result.results[0].localVideoPath, '/local/result.mp4')
  assert.equal(result.results[0].coverImageUrl, 'file:///local/cover.jpg')
  assert.equal(result.results[0].remoteCoverImageUrl, 'https://cdn.example.test/cover.jpg')
  assert.equal(result.results[0].localCoverImagePath, '/local/cover.jpg')
  assert.equal(result.results[0].archivedAt, '2026-01-01T00:00:02.000Z')
  assert.equal(result.results[0].rawMeta, '{"id":"remote-ok"}')
})
