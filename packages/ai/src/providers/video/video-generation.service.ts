// 视频生成服务（ROADMAP v0.7 §3）—— 把「镜头 Prompt → 提交任务 → 轮询 → 保存结果」串成闭环。
//
// 这是操作性服务（不经过 LangGraph LLM 流水线）：create/check/retry/compare/select 都是
// 对 Provider 的网络调用 + DB 记账，因此单独成模块而非注册成 NovelTaskType。
import type {
  VideoGenerationInput,
  VideoGenerationTask,
  VideoProvider,
  VideoProviderConfig,
  VideoProviderResult,
  VideoResult,
} from '@sdns/core'
import type { Repositories } from '@sdns/db'
import { videoProviderFromConfig } from './factory'

export interface VideoServiceDeps {
  repos: Repositories
}

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
  },
): Promise<{ task: VideoGenerationTask; results: VideoResult[] }> {
  const { repos } = deps
  const db = repos.db
  const config = repos.videoProviderConfig.getVideoProviderConfig(db, input.providerConfigId)
  if (!config) throw new Error(`未找到视频 Provider 配置 ${input.providerConfigId}`)

  const provider = videoProviderFromConfig(config)
  const providerInput: VideoGenerationInput = {
    model: config.model ?? 'default',
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    referenceImageUrls: input.referenceImageUrls,
    defaultParams: config.defaultParams,
  }

  // 先落库一条 pending 任务（即使提交失败也有记录，便于排查/重试）
  const task = repos.videoTask.createVideoTask(db, {
    projectId: input.projectId,
    episodeId: input.episodeId,
    sceneId: input.sceneId,
    shotId: input.shotId,
    provider: config.name,
    model: config.model ?? providerInput.model,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    referenceImageUrls: input.referenceImageUrls ?? [],
    status: 'pending',
    note: input.note,
  })

  let results: VideoResult[] = []
  try {
    const state = await provider.createTask(providerInput)
    const updated = repos.videoTask.updateVideoTask(db, task.id, {
      status: state.status === 'success' ? 'success' : 'running',
      remoteTaskId: state.remoteTaskId,
      errorMessage: state.errorMessage,
    })
    // 若提交即返回结果（mock 或部分同步平台），落库结果
    if (state.status === 'success' && state.results.length) {
      results = persistResults(repos, updated ?? task, state, provider)
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
  if (task.status === 'success' || task.status === 'failed') {
    return { task, results: repos.videoResult.listVideoResultsByTask(db, taskId) }
  }

  const config = resolveProviderConfig(repos, task.provider)
  const provider = config ? videoProviderFromConfig(config) : undefined
  if (!provider || !task.remoteTaskId) {
    return { task, results: repos.videoResult.listVideoResultsByTask(db, taskId) }
  }

  const state = await provider.getTaskStatus(task.remoteTaskId)
  const updated = repos.videoTask.updateVideoTask(db, taskId, {
    status: state.status,
    errorMessage: state.errorMessage,
  })
  let results = repos.videoResult.listVideoResultsByTask(db, taskId)
  if (state.status === 'success' && state.results.length && results.length === 0) {
    results = persistResults(repos, updated ?? task, state, provider)
  }
  return { task: updated ?? task, results }
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
  })
}

/** 对比同一镜头的多个生成结果（acceptance #5）—— 返回该镜头下所有结果 */
export function compareVideoResults(deps: VideoServiceDeps, shotId: string): VideoResult[] {
  return repos_listResultsByShot(deps, shotId)
}

/** 人工选择最佳结果（acceptance #6）—— 标记 isBest（保证镜头级唯一） */
export function selectBestVideoResult(deps: VideoServiceDeps, resultId: string): VideoResult | undefined {
  return deps.repos.videoResult.markBestVideoResult(deps.repos.db, resultId)
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function persistResults(
  repos: VideoServiceDeps['repos'],
  task: VideoGenerationTask,
  state: { results: VideoProviderResult[] },
  _provider: VideoProvider,
): VideoResult[] {
  return state.results.map((r) =>
    repos.videoResult.createVideoResult(repos.db, {
      taskId: task.id,
      shotId: task.shotId,
      resultVideoUrl: r.resultVideoUrl,
      coverImageUrl: r.coverImageUrl,
      rawMeta: r.rawMeta,
    }),
  )
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
