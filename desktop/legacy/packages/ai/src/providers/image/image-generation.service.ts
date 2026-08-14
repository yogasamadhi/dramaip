import {
  getImageProviderCapability,
  stillKindLabel,
  type ImageGenerationInput,
  type ImageGenerationResult,
  type ImageProvider,
  type ImageProviderConfigRecord,
  type LongTask,
  type ProjectAsset,
  type ShotStillCandidate,
  type ShotStillKind,
} from '@sdns/core'
import type { Repositories } from '@sdns/db'
import { MockImageProvider } from './mock.provider'
import { OpenAIImageProvider } from './openai-image.provider'

export interface ImageAssetArchiveResult {
  localPath: string
  relativePath: string
  originalName: string
  sha256: string
  sizeBytes: number
}

export type ImageAssetArchiver = (input: {
  projectId: string
  task: LongTask
  result: ImageGenerationResult
  index: number
}) => Promise<ImageAssetArchiveResult>

export interface ImageGenerationServiceDeps {
  repos: Repositories
  imageProviderFactory?: (config: ImageProviderConfigRecord) => ImageProvider
  imageAssetArchiver: ImageAssetArchiver
}

export interface ImageGenerationTaskInput {
  providerConfigId: string
  projectId: string
  shotId: string
  kind: ShotStillKind
  prompt: string
  size?: ImageGenerationInput['size']
  quality?: ImageGenerationInput['quality']
  outputFormat?: ImageGenerationInput['outputFormat']
  parentLineageId?: string
  retryOfLineageId?: string
}

export interface ImageGenerationTaskResult {
  ok: boolean
  error?: string
  task: LongTask
  lineageId?: string
  assets: ProjectAsset[]
  candidates: ShotStillCandidate[]
}

/**
 * Durable local half of a synchronous image request. It records the intent before
 * the network call, archives only successful bytes, and creates new candidates
 * rather than overwriting an adopted still. Provider cancellation is local-only:
 * the official synchronous endpoint has no documented remote cancel API.
 */
export async function createImageGenerationTask(
  deps: ImageGenerationServiceDeps,
  input: ImageGenerationTaskInput,
  signal?: AbortSignal,
  options: { longTaskId?: string } = {},
): Promise<ImageGenerationTaskResult> {
  const { repos } = deps
  const config = repos.imageProviderConfig.getImageProviderConfig(repos.db, input.providerConfigId)
  if (!config) throw new Error('未找到图片 Provider 设置')
  const capability = getImageProviderCapability(config)
  if (!capability.canSubmit) throw new Error(capability.reason ?? '当前图片 Provider 不可提交')
  const scope = assertImageGenerationScope(repos, input.projectId, input.shotId)
  const normalizedPrompt = input.prompt.trim()
  if (!normalizedPrompt) throw new Error('图片 Prompt 不能为空')

  const task = repos.longTask.createLongTask(repos.db, {
    id: options.longTaskId,
    kind: 'image',
    title: `生成${stillKindLabel(input.kind)} · 镜头 ${scope.shot.shotNumber}`,
    taskType: 'image_generation',
    projectId: input.projectId,
    adaptationProjectId: scope.adaptationProjectId,
    episodeId: scope.shot.episodeId,
    sceneId: scope.shot.sceneId,
    shotId: scope.shot.id,
    input: retryableInput(input, normalizedPrompt),
  })
  const lineage = repos.generation.createGenerationLineage(repos.db, {
    projectId: input.projectId,
    adaptationProjectId: scope.adaptationProjectId,
    episodeId: scope.shot.episodeId,
    sceneId: scope.shot.sceneId,
    shotId: scope.shot.id,
    mediaType: 'image',
    taskKind: 'image_generation',
    taskId: task.id,
    parentLineageId: input.parentLineageId,
    retryOfLineageId: input.retryOfLineageId,
    sourceEntityKind: 'shot',
    sourceEntityId: scope.shot.id,
    sourceVersion: scope.shot.updatedAt,
    sourceSnapshot: {
      kind: 'shot', id: scope.shot.id, updatedAt: scope.shot.updatedAt,
      imagePrompt: scope.shot.imagePrompt, visualDescription: scope.shot.visualDescription,
    },
    providerSnapshot: {
      providerConfigId: config.id, providerName: config.name, providerKind: config.kind,
      model: config.model, capability,
    },
    parameterSnapshot: {
      prompt: normalizedPrompt, size: input.size ?? '1024x1536', quality: input.quality ?? 'medium', outputFormat: input.outputFormat ?? 'png', kind: input.kind,
    },
    referenceAssets: [],
    completeness: 'complete',
  })
  const cost = repos.generation.createGenerationCostEntry(repos.db, {
    projectId: input.projectId,
    adaptationProjectId: scope.adaptationProjectId,
    episodeId: scope.shot.episodeId,
    sceneId: scope.shot.sceneId,
    shotId: scope.shot.id,
    lineageId: lineage.id,
    taskId: task.id,
    mediaType: 'image',
    status: 'unknown',
    estimateBasis: 'Provider 未提供本地可信价目；真实账单未知。',
  })
  repos.longTask.markLongTaskRunning(repos.db, task.id)

  try {
    const provider = deps.imageProviderFactory?.(config) ?? imageProviderFromConfig(config)
    const results = await provider.generate({
      prompt: normalizedPrompt,
      model: config.model,
      size: input.size ?? '1024x1536',
      quality: input.quality ?? 'medium',
      outputFormat: input.outputFormat ?? 'png',
    }, signal)
    if (signal?.aborted) return finishCanceled(repos, task, lineage.id, cost.id)
    const usage = summarizeImageUsage(results)
    if (usage) {
      repos.generation.updateGenerationLineage(repos.db, lineage.id, {
        providerSnapshot: { ...lineage.providerSnapshot, usage },
      })
    }

    const assets: ProjectAsset[] = []
    const candidates: ShotStillCandidate[] = []
    for (const [index, result] of results.entries()) {
      const archived = await deps.imageAssetArchiver({ projectId: input.projectId, task, result, index })
      const asset = repos.asset.createAsset(repos.db, {
        projectId: input.projectId,
        kind: assetKindForStill(input.kind),
        title: `${stillKindLabel(input.kind)} · ${config.name} · ${index + 1}`,
        sourceEntityKind: 'image_task',
        sourceEntityId: task.id,
        localPath: archived.localPath,
        relativePath: archived.relativePath,
        originalName: archived.originalName,
        sha256: archived.sha256,
        sizeBytes: archived.sizeBytes,
        mimeType: result.mimeType,
        tags: ['AI 图片', input.kind],
        metadata: {
          generationLineageId: lineage.id,
          longTaskId: task.id,
          providerKind: config.kind,
          model: result.model,
          revisedPrompt: result.revisedPrompt,
        },
        status: 'available',
        packagePolicy: 'include_binary',
      })
      const candidate = repos.shotStill.createShotStillCandidate(repos.db, {
        projectId: input.projectId,
        shotId: scope.shot.id,
        assetId: asset.id,
        kind: input.kind,
        label: `${stillKindLabel(input.kind)} · ${config.name} · ${index + 1}`,
        notes: '由已启用的图片 Provider 生成；采用前仍需复核构图、权利和内容合规。',
        sourceFingerprint: scope.shot.updatedAt,
      })
      assets.push(asset)
      candidates.push(candidate)
    }
    const finished = repos.longTask.finishLongTask(repos.db, task.id, 'success', {
      relatedEntityId: candidates[0]?.id,
      output: { assetIds: assets.map((asset) => asset.id), candidateIds: candidates.map((candidate) => candidate.id), lineageId: lineage.id },
    }) ?? task
    return { ok: true, task: finished, lineageId: lineage.id, assets, candidates }
  } catch (error) {
    if (signal?.aborted) return finishCanceled(repos, task, lineage.id, cost.id)
    const message = safeErrorMessage(error)
    repos.generation.updateGenerationCostEntry(repos.db, cost.id, { status: 'unavailable', actualCostNote: '请求未完成；费用需以 Provider 账单为准。' })
    const failed = repos.longTask.finishLongTask(repos.db, task.id, 'failed', { errorMessage: message }) ?? task
    return { ok: false, error: message, task: failed, lineageId: lineage.id, assets: [], candidates: [] }
  }
}

export async function retryImageGenerationTask(
  deps: ImageGenerationServiceDeps,
  task: LongTask,
  signal?: AbortSignal,
  options: { longTaskId?: string } = {},
): Promise<ImageGenerationTaskResult> {
  if (task.kind !== 'image' || task.taskType !== 'image_generation') throw new Error('不是可重试的图片生成任务')
  const input = task.input
  const retryInput = input && typeof input === 'object' ? input : {}
  const required = ['providerConfigId', 'projectId', 'shotId', 'kind', 'prompt'] as const
  if (required.some((key) => typeof retryInput[key] !== 'string' || !String(retryInput[key]).trim())) {
    throw new Error('图片任务缺少可重试输入；请回到分镜重新提交。')
  }
  const previousLineage = deps.repos.generation.listGenerationLineagesByTask(deps.repos.db, task.id)[0]
  return createImageGenerationTask(deps, {
    providerConfigId: String(retryInput.providerConfigId), projectId: String(retryInput.projectId), shotId: String(retryInput.shotId),
    kind: retryInput.kind as ShotStillKind, prompt: String(retryInput.prompt),
    size: retryInput.size as ImageGenerationInput['size'], quality: retryInput.quality as ImageGenerationInput['quality'], outputFormat: retryInput.outputFormat as ImageGenerationInput['outputFormat'],
    parentLineageId: previousLineage?.id, retryOfLineageId: previousLineage?.id,
  }, signal, options)
}

function imageProviderFromConfig(config: ImageProviderConfigRecord): ImageProvider {
  if (config.kind === 'mock') return new MockImageProvider()
  return new OpenAIImageProvider(config)
}

function assertImageGenerationScope(repos: Repositories, projectId: string, shotId: string) {
  const shot = repos.shot.getShot(repos.db, shotId)
  if (!shot) throw new Error('未找到要生成静帧的镜头')
  const scene = repos.scene.getScene(repos.db, shot.sceneId)
  const script = scene ? repos.script.getScript(repos.db, scene.scriptId) : undefined
  const adaptation = script ? repos.adaptationProject.getAdaptationProject(repos.db, script.adaptationProjectId) : undefined
  if (!adaptation || adaptation.sourceProjectId !== projectId) throw new Error('镜头不属于当前项目，不能提交图片任务')
  return { shot, adaptationProjectId: adaptation.id }
}

function retryableInput(input: ImageGenerationTaskInput, prompt: string): Record<string, string> {
  return {
    providerConfigId: input.providerConfigId, projectId: input.projectId, shotId: input.shotId, kind: input.kind, prompt,
    ...(input.size ? { size: input.size } : {}), ...(input.quality ? { quality: input.quality } : {}), ...(input.outputFormat ? { outputFormat: input.outputFormat } : {}),
  }
}

function assetKindForStill(kind: ShotStillKind): ProjectAsset['kind'] {
  return kind === 'cover' ? 'cover_image' : 'first_frame_image'
}

function finishCanceled(repos: Repositories, task: LongTask, lineageId: string, costId: string): ImageGenerationTaskResult {
  repos.generation.updateGenerationCostEntry(repos.db, costId, { status: 'unknown', actualCostNote: '已停止本地等待；同步请求的远端费用状态未知。' })
  const canceled = repos.longTask.finishLongTask(repos.db, task.id, 'canceled', {
    errorMessage: '已停止本地等待；当前 Provider 未提供远端取消能力，费用状态未知。',
  }) ?? task
  return { ok: false, error: canceled.errorMessage, task: canceled, lineageId, assets: [], candidates: [] }
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer ***')
    .slice(0, 240)
}

function summarizeImageUsage(results: ImageGenerationResult[]): { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined {
  const values = results.map((result) => result.usage).filter((usage): usage is NonNullable<ImageGenerationResult['usage']> => Boolean(usage))
  if (!values.length) return undefined
  const sum = (key: keyof NonNullable<ImageGenerationResult['usage']>) => {
    const total = values.reduce((current, usage) => current + (usage[key] ?? 0), 0)
    return total > 0 ? total : undefined
  }
  return { inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), totalTokens: sum('totalTokens') }
}
