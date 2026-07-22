// 视频生成服务（ROADMAP v0.7 §3）—— 把「镜头 Prompt → 提交任务 → 轮询 → 保存结果」串成闭环。
//
// 这是操作性服务（不经过 LangGraph LLM 流水线）：create/check/retry/compare/select 都是
// 对 Provider 的网络调用 + DB 记账，因此单独成模块而非注册成 NovelTaskType。
import {
  estimateVideoProduction,
  getVideoProviderCapability,
  type GenerationReferenceAsset,
  type VideoGenerationInput,
  type VideoGenerationTask,
  type VideoProvider,
  type VideoProviderConfig,
  type VideoProviderResult,
  type VideoResult,
} from '@sdns/core'
import type { Repositories } from '@sdns/db'
import { videoProviderFromConfig } from './factory'

export interface VideoServiceDeps {
  repos: Repositories
  videoProviderFactory?: (config: VideoProviderConfig) => VideoProvider
  videoAssetArchiver?: VideoAssetArchiver
}

export interface VideoAssetArchiveInput {
  providerConfig: VideoProviderConfig
  task: VideoGenerationTask
  result: VideoProviderResult
}

export interface VideoAssetArchiveResult {
  resultVideoUrl?: string
  remoteVideoUrl?: string
  localVideoPath?: string
  coverImageUrl?: string
  remoteCoverImageUrl?: string
  localCoverImagePath?: string
  archivedAt?: string
  archiveError?: string
}

export type VideoAssetArchiver = (input: VideoAssetArchiveInput) => Promise<VideoAssetArchiveResult | undefined>

/** 提交镜头 Prompt 为视频生成任务（acceptance #2/#3） */
export async function createVideoGenerationTask(
  deps: VideoServiceDeps,
  input: {
    providerConfigId: string
    projectId?: string
    episodeId?: string
    sceneId?: string
    shotId?: string
    prompt: string
    negativePrompt?: string
    referenceImageUrls?: string[]
    note?: string
    /** retry/clone 会创建新谱系，绝不覆盖旧任务的参数或结果。 */
    parentLineageId?: string
    retryOfLineageId?: string
  },
): Promise<{ task: VideoGenerationTask; results: VideoResult[] }> {
  const { repos } = deps
  const db = repos.db
  const config = repos.videoProviderConfig.getVideoProviderConfig(db, input.providerConfigId)
  if (!config) throw new Error(`未找到视频 Provider 配置 ${input.providerConfigId}`)
  const capability = getVideoProviderCapability(config)
  if (!capability.canSubmit) throw new Error(capability.reason ?? '当前视频 Provider 不可提交')

  const provider = createProvider(deps, config)
  const providerInput: VideoGenerationInput = {
    model: config.model ?? 'default',
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    referenceImageUrls: input.referenceImageUrls,
    defaultParams: config.defaultParams,
  }

  const scope = resolveGenerationScope(repos, input)
  // 仅对已登记的人脸/选角参考执行硬性授权检查；未知 URL 不会被伪装成已授权，
  // 但仍可作为普通草稿参考，由 LM5-08 的交付预检统一阻断最终交付。
  assertReferenceRights(repos, scope.projectId, input.referenceImageUrls ?? [])
  const lineage = createVideoLineage(repos, {
    ...input,
    ...scope,
    parentLineageId: input.parentLineageId,
    retryOfLineageId: input.retryOfLineageId,
  }, config, capability)

  // 先落库一条 pending 任务（即使提交失败也有记录，便于排查/重试）
  const task = repos.videoTask.createVideoTask(db, {
    projectId: scope.projectId,
    episodeId: scope.episodeId,
    sceneId: scope.sceneId,
    shotId: scope.shotId,
    lineageId: lineage?.id,
    provider: config.name,
    model: config.model ?? providerInput.model,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    referenceImageUrls: input.referenceImageUrls ?? [],
    status: 'pending',
    note: input.note,
  })
  const generation = generationRepo(repos)
  if (lineage && generation) {
    generation.updateGenerationLineage(db, lineage.id, { taskId: task.id })
    const estimate = estimateVideoProduction(config)
    generation.createGenerationCostEntry(db, {
      projectId: scope.projectId,
      adaptationProjectId: scope.adaptationProjectId,
      episodeId: scope.episodeId,
      sceneId: scope.sceneId,
      shotId: scope.shotId,
      lineageId: lineage.id,
      taskId: task.id,
      mediaType: 'video',
      status: estimate.estimatedCost === undefined ? 'unknown' : 'estimated',
      currency: estimate.currency,
      estimatedCost: estimate.estimatedCost,
      estimateBasis: estimate.estimatedCost === undefined
        ? 'Provider 未提供本地估值；实际账单未知'
        : `提交时 Provider 参数快照（${estimate.durationSeconds} 秒，本地估算，非账单）`,
    })
  }

  let results: VideoResult[] = []
  try {
    const state = await provider.createTask(providerInput)
    const updated = repos.videoTask.updateVideoTask(db, task.id, {
      status: state.status,
      remoteTaskId: state.remoteTaskId,
      errorMessage: state.errorMessage,
    })
    // 若提交即返回结果（mock 或部分同步平台），落库结果
    if (state.status === 'success' && state.results.length) {
      results = await persistResults(deps, config, updated ?? task, state)
    }
    return { task: updated ?? task, results }
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    const updated = repos.videoTask.updateVideoTask(db, task.id, { status: 'failed', errorMessage })
    return { task: updated ?? task, results: [] }
  }
}

/** 查询任务状态（acceptance #3）—— 同步刷新 DB 并返回最新任务 + 结果 */
export async function checkVideoTaskStatus(
  deps: VideoServiceDeps,
  taskId: string,
): Promise<{ task: VideoGenerationTask; results: VideoResult[] }> {
  const { repos } = deps
  const db = repos.db
  const task = repos.videoTask.getVideoTask(db, taskId)
  if (!task) throw new Error(`未找到视频任务 ${taskId}`)
  // 终态任务无需再轮询，直接返回已存结果
  if (task.status === 'success' || task.status === 'failed' || task.status === 'canceled') {
    return { task, results: repos.videoResult.listVideoResultsByTask(db, taskId) }
  }

  const config = resolveProviderConfig(repos, task.provider)
  if (!config || !task.remoteTaskId) {
    return { task, results: repos.videoResult.listVideoResultsByTask(db, taskId) }
  }
  const provider = createProvider(deps, config)

  const state = await provider.getTaskStatus(task.remoteTaskId)
  const updated = repos.videoTask.updateVideoTask(db, taskId, {
    status: state.status,
    errorMessage: state.errorMessage,
  })
  let results = repos.videoResult.listVideoResultsByTask(db, taskId)
  if (state.status === 'success' && state.results.length && results.length === 0) {
    results = await persistResults(deps, config, updated ?? task, state)
  }
  return { task: updated ?? task, results }
}

/**
 * Cancel a video task without fabricating a remote outcome. When an adapter exposes a documented
 * cancellation request, it is completed before the local task is marked canceled. Otherwise the
 * local task stops being tracked while the unknown remote outcome remains explicitly documented.
 */
export async function cancelVideoGenerationTask(
  deps: VideoServiceDeps,
  taskId: string,
): Promise<{ task: VideoGenerationTask; remoteCanceled: boolean }> {
  const { repos } = deps
  const db = repos.db
  const task = repos.videoTask.getVideoTask(db, taskId)
  if (!task) throw new Error('未找到视频任务')
  if (task.status !== 'pending' && task.status !== 'running') throw new Error('任务已结束，不能取消')

  let remoteCanceled = false
  const config = task.remoteTaskId ? resolveProviderConfig(repos, task.provider) : undefined
  if (config && task.remoteTaskId) {
    const provider = createProvider(deps, config)
    if (provider.supportsRemoteCancel && provider.cancelTask) {
      // A provider-side failure intentionally leaves the local task active for polling. It would
      // be unsafe to label it canceled when the provider may still finish and bill the task.
      await provider.cancelTask(task.remoteTaskId)
      remoteCanceled = true
    }
  }

  const updated = repos.videoTask.updateVideoTask(db, taskId, {
    status: 'canceled',
    errorMessage: remoteCanceled ? undefined : '已停止本地跟踪；当前 Provider 未提供远端取消能力',
  })
  return { task: updated ?? task, remoteCanceled }
}

/** 失败重试（acceptance #3）：用原任务的 Prompt 重新提交一个新任务 */
export async function retryVideoTask(
  deps: VideoServiceDeps,
  taskId: string,
  providerConfigId?: string,
): Promise<{ task: VideoGenerationTask; results: VideoResult[] }> {
  const { repos } = deps
  const db = repos.db
  const original = repos.videoTask.getVideoTask(db, taskId)
  if (!original) throw new Error(`未找到视频任务 ${taskId}`)
  // 重试默认沿用原任务的 Provider；也可显式指定新的 Provider 配置
  const configId = providerConfigId ?? resolveProviderConfigId(repos, original.provider)
  if (!configId) throw new Error('无法确定重试所用的视频 Provider，请在设置中先配置一个')
  return createVideoGenerationTask(deps, {
    providerConfigId: configId,
    projectId: original.projectId,
    episodeId: original.episodeId,
    sceneId: original.sceneId,
    shotId: original.shotId,
    prompt: original.prompt,
    negativePrompt: original.negativePrompt,
    referenceImageUrls: original.referenceImageUrls,
    note: `重试自 ${original.id.slice(0, 8)}`,
    parentLineageId: original.lineageId,
    retryOfLineageId: original.lineageId,
  })
}

/** 对比同一镜头的多个生成结果（acceptance #5）—— 返回该镜头下所有结果 */
export function compareVideoResults(deps: VideoServiceDeps, shotId: string): VideoResult[] {
  return repos_listResultsByShot(deps, shotId)
}

/** 人工选择最佳结果（acceptance #6）—— 标记 isBest（保证镜头级唯一） */
export function selectBestVideoResult(deps: VideoServiceDeps, resultId: string): VideoResult | undefined {
  const result = deps.repos.videoResult.markBestVideoResult(deps.repos.db, resultId)
  if (!result) return undefined
  const task = deps.repos.videoTask.getVideoTask(deps.repos.db, result.taskId)
  if (!task?.lineageId) return result
  const generation = generationRepo(deps.repos)
  if (!generation) return result
  const lineage = generation.getGenerationLineage(deps.repos.db, task.lineageId)
  if (lineage?.sourceEntityKind && lineage.sourceEntityId) {
    generation.clearGenerationLineageAdoptionForSource(deps.repos.db, lineage.sourceEntityKind, lineage.sourceEntityId)
  }
  generation.updateGenerationLineage(deps.repos.db, task.lineageId, {
    adoptedOutputKind: 'video_result',
    adoptedOutputId: result.id,
    adoptedAt: new Date().toISOString(),
  })
  return result
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function persistResults(
  deps: VideoServiceDeps,
  providerConfig: VideoProviderConfig,
  task: VideoGenerationTask,
  state: { results: VideoProviderResult[] },
): Promise<VideoResult[]> {
  const rows: VideoResult[] = []
  for (const r of state.results) {
    const archived = await archiveVideoResult(deps, providerConfig, task, r)
    rows.push(deps.repos.videoResult.createVideoResult(deps.repos.db, {
      taskId: task.id,
      shotId: task.shotId,
      resultVideoUrl: archived.resultVideoUrl ?? r.resultVideoUrl,
      remoteVideoUrl: archived.remoteVideoUrl ?? r.resultVideoUrl,
      localVideoPath: archived.localVideoPath,
      coverImageUrl: archived.coverImageUrl ?? r.coverImageUrl,
      remoteCoverImageUrl: archived.remoteCoverImageUrl ?? r.coverImageUrl,
      localCoverImagePath: archived.localCoverImagePath,
      rawMeta: r.rawMeta,
      archivedAt: archived.archivedAt,
      archiveError: archived.archiveError,
    }))
  }
  return rows
}

function repos_listResultsByShot(deps: VideoServiceDeps, shotId: string): VideoResult[] {
  return deps.repos.videoResult.listVideoResultsByShot(deps.repos.db, shotId)
}

/** 按任务记录的 provider 名字反查 ProviderConfig（取第一个同名或默认） */
function resolveProviderConfig(repos: VideoServiceDeps['repos'], providerName: string): VideoProviderConfig | undefined {
  const list = repos.videoProviderConfig.listVideoProviderConfigs(repos.db)
  return list.find((c) => c.name === providerName) ?? repos.videoProviderConfig.getDefaultVideoProviderConfig(repos.db)
}

function resolveProviderConfigId(repos: VideoServiceDeps['repos'], providerName: string): string | undefined {
  return resolveProviderConfig(repos, providerName)?.id
}

function createProvider(deps: VideoServiceDeps, config: VideoProviderConfig): VideoProvider {
  return deps.videoProviderFactory?.(config) ?? videoProviderFromConfig(config)
}

function createVideoLineage(
  repos: VideoServiceDeps['repos'],
  input: {
    projectId?: string
    adaptationProjectId?: string
    episodeId?: string
    sceneId?: string
    shotId?: string
    prompt: string
    negativePrompt?: string
    referenceImageUrls?: string[]
    parentLineageId?: string
    retryOfLineageId?: string
  },
  config: VideoProviderConfig,
  capability: ReturnType<typeof getVideoProviderCapability>,
) {
  const generation = generationRepo(repos)
  if (!generation) return undefined
  const source = resolveSourceSnapshot(repos, input)
  const parameters = parseProviderParams(config.defaultParams)
  const references = resolveReferenceAssets(repos, input.projectId, input.referenceImageUrls ?? [], parameters)
  const seed = scalarString(parameters.seed)
  return generation.createGenerationLineage(repos.db, {
    projectId: input.projectId,
    adaptationProjectId: input.adaptationProjectId,
    episodeId: input.episodeId,
    sceneId: input.sceneId,
    shotId: input.shotId,
    mediaType: 'video',
    taskKind: 'video_generation',
    parentLineageId: input.parentLineageId,
    retryOfLineageId: input.retryOfLineageId,
    sourceEntityKind: source.kind,
    sourceEntityId: source.id,
    sourceVersion: source.version,
    sourceSnapshot: source.snapshot,
    // 凭据只在 Keychain；快照刻意排除 apiKey 和 baseUrl，避免项目包/诊断泄漏。
    providerSnapshot: {
      providerConfigId: config.id,
      providerName: config.name,
      providerKind: config.kind,
      model: config.model ?? 'default',
      capability,
      defaultParams: parameters,
    },
    parameterSnapshot: {
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      referenceImageUrls: input.referenceImageUrls ?? [],
      providerDefaults: parameters,
    },
    referenceAssets: references,
    seed,
    completeness: source.kind ? 'complete' : 'partial',
  })
}

function resolveGenerationScope(
  repos: VideoServiceDeps['repos'],
  input: { projectId?: string; episodeId?: string; sceneId?: string; shotId?: string },
): { projectId?: string; adaptationProjectId?: string; episodeId?: string; sceneId?: string; shotId?: string } {
  const safe = repos as Partial<VideoServiceDeps['repos']>
  const episode = input.episodeId ? safe.episode?.getEpisode(repos.db, input.episodeId) : undefined
  const scene = input.sceneId ? safe.scene?.getScene(repos.db, input.sceneId) : undefined
  const shot = input.shotId ? safe.shot?.getShot(repos.db, input.shotId) : undefined
  const episodeId = input.episodeId ?? scene?.episodeId ?? shot?.episodeId
  const resolvedEpisode = episodeId === input.episodeId ? episode : episodeId ? safe.episode?.getEpisode(repos.db, episodeId) : undefined
  const adaptationProjectId = resolvedEpisode?.adaptationProjectId
  const adaptation = adaptationProjectId ? safe.adaptationProject?.getAdaptationProject(repos.db, adaptationProjectId) : undefined
  return {
    projectId: input.projectId ?? adaptation?.sourceProjectId,
    adaptationProjectId,
    episodeId,
    sceneId: input.sceneId ?? shot?.sceneId,
    shotId: input.shotId,
  }
}

function resolveSourceSnapshot(
  repos: VideoServiceDeps['repos'],
  input: { projectId?: string; episodeId?: string; sceneId?: string; shotId?: string },
): { kind?: string; id?: string; version?: string; snapshot: Record<string, unknown> } {
  const safe = repos as Partial<VideoServiceDeps['repos']>
  if (input.shotId) {
    const shot = safe.shot?.getShot(repos.db, input.shotId)
    if (shot) return { kind: 'shot', id: shot.id, version: shot.updatedAt, snapshot: { kind: 'shot', id: shot.id, updatedAt: shot.updatedAt, promptVersion: shot.videoPrompt } }
  }
  if (input.sceneId) {
    const scene = safe.scene?.getScene(repos.db, input.sceneId)
    if (scene) return { kind: 'scene', id: scene.id, version: scene.updatedAt, snapshot: { kind: 'scene', id: scene.id, updatedAt: scene.updatedAt, scriptId: scene.scriptId } }
  }
  if (input.episodeId) {
    const episode = safe.episode?.getEpisode(repos.db, input.episodeId)
    if (episode) return { kind: 'episode', id: episode.id, version: episode.updatedAt, snapshot: { kind: 'episode', id: episode.id, updatedAt: episode.updatedAt } }
  }
  if (input.projectId) {
    const project = safe.project?.getProject(repos.db, input.projectId)
    if (project) return { kind: 'project', id: project.id, version: project.updatedAt, snapshot: { kind: 'project', id: project.id, updatedAt: project.updatedAt } }
  }
  return { snapshot: { status: 'unknown', reason: '任务没有可读取的源实体版本' } }
}

function resolveReferenceAssets(
  repos: VideoServiceDeps['repos'],
  projectId: string | undefined,
  urls: string[],
  parameters: Record<string, unknown>,
): GenerationReferenceAsset[] {
  const safe = repos as Partial<VideoServiceDeps['repos']>
  const weights = Array.isArray(parameters.referenceWeights) ? parameters.referenceWeights : []
  const assets = projectId ? safe.asset?.listProjectAssets(repos.db, projectId) ?? [] : []
  return urls.map((url, index) => {
    const asset = assets.find((candidate) => candidate.remoteUrl === url || candidate.localPath === url || candidate.relativePath === url)
    const rawWeight = weights[index]
    return {
      assetId: asset?.id,
      url,
      weight: typeof rawWeight === 'number' && Number.isFinite(rawWeight) ? rawWeight : undefined,
      role: index === 0 ? 'reference' : 'reference_variant',
    }
  })
}

function assertReferenceRights(repos: VideoServiceDeps['repos'], projectId: string | undefined, urls: string[]): void {
  const safe = repos as Partial<VideoServiceDeps['repos']>
  if (!projectId || !safe.asset || !safe.rights || urls.length === 0) return
  const assets = safe.asset.listProjectAssets(repos.db, projectId)
    .filter((asset) => urls.includes(asset.remoteUrl ?? '') || urls.includes(asset.localPath ?? '') || urls.includes(asset.relativePath ?? ''))
  safe.rights.assertReferenceAssetRights(repos.db, projectId, assets)
}

function parseProviderParams(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? sanitizeSnapshot(parsed as Record<string, unknown>) : {}
  } catch {
    return { parseStatus: 'invalid_json' }
  }
}

function scalarString(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return undefined
}

function sanitizeSnapshot(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (/(api[-_]?key|authorization|token|secret|password|credential)/i.test(key)) return [key, '[redacted]']
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) return [key, sanitizeSnapshot(entry as Record<string, unknown>)]
    if (Array.isArray(entry)) return [key, entry.map((item) => item && typeof item === 'object' && !Array.isArray(item) ? sanitizeSnapshot(item as Record<string, unknown>) : item)]
    return [key, entry]
  }))
}

/** Unit fixtures from pre-LM5-07 intentionally lack this optional runtime capability. */
function generationRepo(repos: VideoServiceDeps['repos']): VideoServiceDeps['repos']['generation'] | undefined {
  return (repos as Partial<VideoServiceDeps['repos']>).generation
}

async function archiveVideoResult(
  deps: VideoServiceDeps,
  providerConfig: VideoProviderConfig,
  task: VideoGenerationTask,
  result: VideoProviderResult,
): Promise<VideoAssetArchiveResult> {
  if (!deps.videoAssetArchiver || providerConfig.kind === 'mock') {
    return {
      remoteVideoUrl: result.resultVideoUrl,
      remoteCoverImageUrl: result.coverImageUrl,
    }
  }
  try {
    return await deps.videoAssetArchiver({ providerConfig, task, result }) ?? {
      remoteVideoUrl: result.resultVideoUrl,
      remoteCoverImageUrl: result.coverImageUrl,
    }
  } catch (error) {
    return {
      remoteVideoUrl: result.resultVideoUrl,
      remoteCoverImageUrl: result.coverImageUrl,
      archiveError: error instanceof Error ? error.message : String(error),
    }
  }
}
