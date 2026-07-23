import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  GenerationCostEntry,
  GenerationLineage,
  ImageProviderConfigRecord,
  LongTask,
  ProjectAsset,
  ShotStillCandidate,
} from '../packages/core/src'
import { createImageGenerationTask } from '../packages/ai/src/providers/image/image-generation.service'

function imageConfig(overrides: Partial<ImageProviderConfigRecord> = {}): ImageProviderConfigRecord {
  return {
    id: 'image-provider-1',
    name: 'OpenAI 图片生产',
    kind: 'openai_image',
    apiKey: 'keychain:configured',
    model: 'gpt-image-2',
    featureEnabled: true,
    isDefault: true,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
    ...overrides,
  }
}

function createImageServiceRepos(config = imageConfig()) {
  let task: LongTask | undefined
  const lineages: GenerationLineage[] = []
  const costs: GenerationCostEntry[] = []
  const assets: ProjectAsset[] = []
  const candidates: ShotStillCandidate[] = []
  const createCalls = { assets: 0, candidates: 0, provider: 0 }

  const repos = {
    db: {},
    imageProviderConfig: {
      getImageProviderConfig: (_db: unknown, id: string) => id === config.id ? config : undefined,
    },
    shot: {
      getShot: (_db: unknown, id: string) => id === 'shot-1' ? {
        id, sceneId: 'scene-1', episodeId: 'episode-1', shotNumber: 1, updatedAt: '2026-07-23T00:00:00.000Z',
        imagePrompt: '雨夜天台，女主回头', visualDescription: '近景，霓虹雨幕',
      } : undefined,
    },
    scene: {
      getScene: (_db: unknown, id: string) => id === 'scene-1' ? { id, scriptId: 'script-1' } : undefined,
    },
    script: {
      getScript: (_db: unknown, id: string) => id === 'script-1' ? { id, adaptationProjectId: 'adaptation-1' } : undefined,
    },
    adaptationProject: {
      getAdaptationProject: (_db: unknown, id: string) => id === 'adaptation-1' ? { id, sourceProjectId: 'project-1' } : undefined,
    },
    longTask: {
      createLongTask: (_db: unknown, data: Partial<LongTask> & { kind: LongTask['kind']; title: string }) => {
        task = {
          id: data.id ?? 'image-task-1', kind: data.kind, status: data.status ?? 'pending', title: data.title,
          taskType: data.taskType, projectId: data.projectId, adaptationProjectId: data.adaptationProjectId,
          episodeId: data.episodeId, sceneId: data.sceneId, shotId: data.shotId, input: data.input,
          createdAt: '2026-07-23T00:00:00.000Z', updatedAt: '2026-07-23T00:00:00.000Z',
        }
        return task
      },
      markLongTaskRunning: () => {
        task = { ...task!, status: 'running' }
        return task
      },
      finishLongTask: (_db: unknown, id: string, status: LongTask['status'], patch: Partial<LongTask>) => {
        if (!task || task.id !== id) return undefined
        task = { ...task, ...patch, status, finishedAt: '2026-07-23T00:00:01.000Z' }
        return task
      },
    },
    generation: {
      createGenerationLineage: (_db: unknown, data: Partial<GenerationLineage>) => {
        const lineage = {
          id: `lineage-${lineages.length + 1}`, mediaType: 'image', taskKind: 'image_generation',
          sourceSnapshot: {}, providerSnapshot: {}, parameterSnapshot: {}, referenceAssets: [], completeness: 'complete',
          createdAt: '2026-07-23T00:00:00.000Z', updatedAt: '2026-07-23T00:00:00.000Z', ...data,
        } as GenerationLineage
        lineages.push(lineage)
        return lineage
      },
      updateGenerationLineage: (_db: unknown, id: string, patch: Partial<GenerationLineage>) => {
        const index = lineages.findIndex((lineage) => lineage.id === id)
        if (index < 0) return undefined
        lineages[index] = { ...lineages[index], ...patch }
        return lineages[index]
      },
      createGenerationCostEntry: (_db: unknown, data: Partial<GenerationCostEntry>) => {
        const cost = {
          id: `cost-${costs.length + 1}`, mediaType: 'image', status: 'unknown',
          createdAt: '2026-07-23T00:00:00.000Z', updatedAt: '2026-07-23T00:00:00.000Z', ...data,
        } as GenerationCostEntry
        costs.push(cost)
        return cost
      },
      updateGenerationCostEntry: (_db: unknown, id: string, patch: Partial<GenerationCostEntry>) => {
        const index = costs.findIndex((cost) => cost.id === id)
        if (index < 0) return undefined
        costs[index] = { ...costs[index], ...patch }
        return costs[index]
      },
      listGenerationLineagesByTask: (_db: unknown, id: string) => lineages.filter((lineage) => lineage.taskId === id),
    },
    asset: {
      createAsset: (_db: unknown, data: Partial<ProjectAsset>) => {
        createCalls.assets += 1
        const asset = {
          id: `asset-${assets.length + 1}`, projectId: data.projectId ?? '', kind: data.kind ?? 'first_frame_image',
          title: data.title ?? '', sourceEntityKind: data.sourceEntityKind ?? 'manual', sourceEntityId: data.sourceEntityId,
          localPath: data.localPath, relativePath: data.relativePath, originalName: data.originalName, sha256: data.sha256,
          sizeBytes: data.sizeBytes, mimeType: data.mimeType, tags: data.tags ?? [], metadata: data.metadata ?? {},
          status: 'available', packagePolicy: 'include_binary', createdAt: '', updatedAt: '',
        } as ProjectAsset
        assets.push(asset)
        return asset
      },
    },
    shotStill: {
      createShotStillCandidate: (_db: unknown, data: Partial<ShotStillCandidate>) => {
        createCalls.candidates += 1
        const candidate = {
          id: `candidate-${candidates.length + 1}`, projectId: data.projectId ?? '', shotId: data.shotId ?? '',
          assetId: data.assetId ?? '', kind: data.kind ?? 'still', status: 'candidate', label: data.label ?? '',
          notes: data.notes, sourceFingerprint: data.sourceFingerprint, createdAt: '', updatedAt: '',
        } as ShotStillCandidate
        candidates.push(candidate)
        return candidate
      },
    },
  }

  return {
    repos: repos as never,
    lineages,
    costs,
    assets,
    candidates,
    createCalls,
    get task() { return task },
  }
}

test('image generation persists a credential-free lineage, archives a new candidate, and retains the preallocated task id', async () => {
  const fixture = createImageServiceRepos()
  const result = await createImageGenerationTask({
    repos: fixture.repos,
    imageProviderFactory: () => ({
      kind: 'openai_image',
      async generate(input) {
        fixture.createCalls.provider += 1
        assert.equal(input.model, 'gpt-image-2')
        return [{ model: 'gpt-image-2', mimeType: 'image/png', b64Json: 'cG5nLWJ5dGVz', revisedPrompt: '经优化的雨夜天台', usage: { inputTokens: 12, outputTokens: 34, totalTokens: 46 } }]
      },
    }),
    imageAssetArchiver: async () => ({
      localPath: '/safe/project/asset.png', relativePath: 'assets/first-frame/asset.png', originalName: 'asset.png', sha256: 'hash', sizeBytes: 9,
    }),
  }, {
    providerConfigId: 'image-provider-1', projectId: 'project-1', shotId: 'shot-1', kind: 'first_frame', prompt: '雨夜天台，近景',
  }, undefined, { longTaskId: 'preallocated-image-task' })

  assert.equal(result.ok, true)
  assert.equal(result.task.id, 'preallocated-image-task')
  assert.equal(result.task.status, 'success')
  assert.equal(fixture.createCalls.provider, 1)
  assert.equal(fixture.assets.length, 1)
  assert.equal(fixture.assets[0]?.sourceEntityKind, 'image_task')
  assert.equal(fixture.candidates.length, 1)
  assert.equal(fixture.candidates[0]?.status, 'candidate')
  assert.equal(fixture.lineages[0]?.providerSnapshot.apiKey, undefined)
  assert.deepEqual(fixture.lineages[0]?.providerSnapshot.usage, { inputTokens: 12, outputTokens: 34, totalTokens: 46 })
  assert.equal(fixture.costs[0]?.status, 'unknown')
})

test('image generation rejects a disabled production provider before constructing an adapter', async () => {
  const fixture = createImageServiceRepos(imageConfig({ featureEnabled: false }))
  let constructed = false
  await assert.rejects(
    createImageGenerationTask({
      repos: fixture.repos,
      imageProviderFactory: () => {
        constructed = true
        throw new Error('adapter must not be created')
      },
      imageAssetArchiver: async () => { throw new Error('not used') },
    }, { providerConfigId: 'image-provider-1', projectId: 'project-1', shotId: 'shot-1', kind: 'still', prompt: '安全画面' }),
    /生产渠道开关/,
  )
  assert.equal(constructed, false)
})

test('image generation cancellation records a local stop and leaves remote cost as unknown', async () => {
  const fixture = createImageServiceRepos()
  const controller = new AbortController()
  const result = await createImageGenerationTask({
    repos: fixture.repos,
    imageProviderFactory: () => ({
      kind: 'openai_image',
      async generate() {
        controller.abort()
        return [{ model: 'gpt-image-2', mimeType: 'image/png', b64Json: 'cG5nLWJ5dGVz' }]
      },
    }),
    imageAssetArchiver: async () => { throw new Error('not used after cancellation') },
  }, { providerConfigId: 'image-provider-1', projectId: 'project-1', shotId: 'shot-1', kind: 'still', prompt: '取消测试' }, controller.signal)

  assert.equal(result.ok, false)
  assert.equal(result.task.status, 'canceled')
  assert.match(result.error ?? '', /费用状态未知/)
  assert.equal(fixture.costs[0]?.status, 'unknown')
  assert.equal(fixture.assets.length, 0)
})
