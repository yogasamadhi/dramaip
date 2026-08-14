import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  GenerationCostEntry,
  GenerationLineage,
  LongTask,
  ProjectAsset,
  TtsProviderConfigRecord,
  VoiceProfile,
} from '../packages/core/src'
import { createTtsGenerationTask } from '../packages/ai/src/providers/audio/audio-generation.service'

function ttsConfig(overrides: Partial<TtsProviderConfigRecord> = {}): TtsProviderConfigRecord {
  return {
    id: 'tts-provider-1',
    name: 'OpenAI TTS 生产',
    kind: 'openai_tts',
    apiKey: 'keychain:configured',
    model: 'gpt-4o-mini-tts',
    featureEnabled: true,
    isDefault: true,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
    ...overrides,
  }
}

function createTtsServiceRepos(config = ttsConfig()) {
  let task: LongTask | undefined
  const lineages: GenerationLineage[] = []
  const costs: GenerationCostEntry[] = []
  const assets: ProjectAsset[] = []
  const profile: VoiceProfile = {
    id: 'voice-1', projectId: 'project-1', label: '旁白声线', status: 'adopted', voiceTone: '沉稳', speed: 1.1,
    pronunciationDictionary: { 林晚: 'lín wǎn' }, createdAt: '', updatedAt: '',
  }
  const calls = { provider: 0, assets: 0 }
  const repos = {
    db: {},
    ttsProviderConfig: { getTtsProviderConfig: (_db: unknown, id: string) => id === config.id ? config : undefined },
    episode: {
      getEpisode: (_db: unknown, id: string) => id === 'episode-1' ? {
        id, adaptationProjectId: 'adaptation-1', title: '第 1 集', updatedAt: '2026-07-23T00:00:00.000Z',
      } : undefined,
    },
    adaptationProject: {
      getAdaptationProject: (_db: unknown, id: string) => id === 'adaptation-1' ? { id, sourceProjectId: 'project-1' } : undefined,
    },
    shot: { getShot: (_db: unknown, id: string) => id === 'shot-1' ? { id, episodeId: 'episode-1' } : undefined },
    audio: { listVoiceProfilesByProject: (_db: unknown, projectId: string) => projectId === 'project-1' ? [profile] : [] },
    longTask: {
      createLongTask: (_db: unknown, data: Partial<LongTask> & { kind: LongTask['kind']; title: string }) => {
        task = {
          id: data.id ?? 'tts-task-1', kind: data.kind, status: data.status ?? 'pending', title: data.title,
          taskType: data.taskType, projectId: data.projectId, adaptationProjectId: data.adaptationProjectId,
          episodeId: data.episodeId, shotId: data.shotId, input: data.input,
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
          id: `lineage-${lineages.length + 1}`, mediaType: 'audio', taskKind: 'tts_generation',
          sourceSnapshot: {}, providerSnapshot: {}, parameterSnapshot: {}, referenceAssets: [], completeness: 'complete',
          createdAt: '2026-07-23T00:00:00.000Z', updatedAt: '2026-07-23T00:00:00.000Z', ...data,
        } as GenerationLineage
        lineages.push(lineage)
        return lineage
      },
      createGenerationCostEntry: (_db: unknown, data: Partial<GenerationCostEntry>) => {
        const cost = {
          id: `cost-${costs.length + 1}`, mediaType: 'audio', status: 'unknown',
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
        calls.assets += 1
        const asset = {
          id: `asset-${assets.length + 1}`, projectId: data.projectId ?? '', kind: data.kind ?? 'narration_audio', title: data.title ?? '',
          sourceEntityKind: data.sourceEntityKind ?? 'manual', sourceEntityId: data.sourceEntityId, localPath: data.localPath,
          relativePath: data.relativePath, originalName: data.originalName, sha256: data.sha256, sizeBytes: data.sizeBytes,
          mimeType: data.mimeType, tags: data.tags ?? [], metadata: data.metadata ?? {}, status: 'available',
          packagePolicy: 'include_binary', createdAt: '', updatedAt: '',
        } as ProjectAsset
        assets.push(asset)
        return asset
      },
    },
  }
  return { repos: repos as never, lineages, costs, assets, profile, calls, get task() { return task } }
}

test('TTS generation keeps provider credentials out of lineage, applies the selected pronunciation profile, and archives a new audio asset', async () => {
  const fixture = createTtsServiceRepos()
  const result = await createTtsGenerationTask({
    repos: fixture.repos,
    ttsProviderFactory: () => ({
      kind: 'openai_tts',
      async generate(input) {
        fixture.calls.provider += 1
        assert.equal(input.input, 'lín wǎn，别回头。')
        assert.equal(input.speed, 1.1)
        assert.match(input.instructions ?? '', /沉稳/)
        return { model: 'gpt-4o-mini-tts', voice: 'alloy', mimeType: 'audio/mpeg', b64Audio: 'bXAzLWJ5dGVz' }
      },
    }),
    ttsAssetArchiver: async () => ({ localPath: '/safe/project/audio.mp3', relativePath: 'assets/narration/audio.mp3', originalName: 'audio.mp3', sha256: 'hash', sizeBytes: 9 }),
  }, {
    providerConfigId: 'tts-provider-1', projectId: 'project-1', episodeId: 'episode-1', voiceProfileId: 'voice-1',
    kind: 'narration', input: '林晚，别回头。', voice: 'alloy',
  }, undefined, { longTaskId: 'preallocated-tts-task' })

  assert.equal(result.ok, true)
  assert.equal(result.task.id, 'preallocated-tts-task')
  assert.equal(result.task.status, 'success')
  assert.equal(fixture.calls.provider, 1)
  assert.equal(fixture.assets.length, 1)
  assert.equal(fixture.assets[0]?.kind, 'narration_audio')
  assert.equal(fixture.assets[0]?.sourceEntityKind, 'audio_task')
  assert.equal(fixture.lineages[0]?.providerSnapshot.apiKey, undefined)
  assert.equal(fixture.lineages[0]?.parameterSnapshot.pronunciationApplied, true)
  assert.equal(fixture.costs[0]?.status, 'unknown')
})

test('TTS generation rejects a disabled production provider before constructing an adapter', async () => {
  const fixture = createTtsServiceRepos(ttsConfig({ featureEnabled: false }))
  let constructed = false
  await assert.rejects(
    createTtsGenerationTask({
      repos: fixture.repos,
      ttsProviderFactory: () => {
        constructed = true
        throw new Error('adapter must not be created')
      },
      ttsAssetArchiver: async () => { throw new Error('not used') },
    }, { providerConfigId: 'tts-provider-1', projectId: 'project-1', episodeId: 'episode-1', kind: 'narration', input: '安全文本', voice: 'alloy' }),
    /生产渠道开关/,
  )
  assert.equal(constructed, false)
})

test('TTS cancellation records a local stop and keeps the remote cost unknown', async () => {
  const fixture = createTtsServiceRepos()
  const controller = new AbortController()
  const result = await createTtsGenerationTask({
    repos: fixture.repos,
    ttsProviderFactory: () => ({
      kind: 'openai_tts',
      async generate() {
        controller.abort()
        return { model: 'gpt-4o-mini-tts', voice: 'alloy', mimeType: 'audio/mpeg', b64Audio: 'bXAzLWJ5dGVz' }
      },
    }),
    ttsAssetArchiver: async () => { throw new Error('not used after cancellation') },
  }, { providerConfigId: 'tts-provider-1', projectId: 'project-1', episodeId: 'episode-1', kind: 'narration', input: '取消测试', voice: 'alloy' }, controller.signal)

  assert.equal(result.ok, false)
  assert.equal(result.task.status, 'canceled')
  assert.match(result.error ?? '', /费用状态未知/)
  assert.equal(fixture.costs[0]?.status, 'unknown')
  assert.equal(fixture.assets.length, 0)
})
