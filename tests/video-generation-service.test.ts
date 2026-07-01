import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { VideoGenerationTask, VideoProviderConfig, VideoResult } from '../packages/core/src'
import { createVideoGenerationTask } from '../packages/ai/src/providers/video/video-generation.service'

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
  return {
    repos: {
      db: {},
      videoProviderConfig: {
        getVideoProviderConfig: (_db: unknown, id: string) => id === config.id ? config : undefined,
      },
      videoTask: {
        createVideoTask: (_db: unknown, data: Partial<VideoGenerationTask> & { provider: string; model: string }) => {
          task = {
            id: 'task-1',
            projectId: data.projectId,
            episodeId: data.episodeId,
            sceneId: data.sceneId,
            shotId: data.shotId,
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
            coverImageUrl: data.coverImageUrl,
            rawMeta: data.rawMeta,
            isBest: false,
            createdAt: '2026-01-01T00:00:00.000Z',
          }
          results.push(result)
          return result
        },
      },
    } as never,
    get task() {
      return task
    },
    results,
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
