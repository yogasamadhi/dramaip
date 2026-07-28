import { basename } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import {
  getImageProviderCapability,
  type ImageEditFile,
  type ImageGenerationInput,
  type ImageProvider,
  type ImageProviderConfigRecord,
  type LongTask,
  type ProjectAsset,
  type RetakeOperation,
  type RetakeRequest,
  type ShotStillCandidate,
} from '@sdns/core'
import type { Repositories } from '@sdns/db'
import type { ImageAssetArchiver } from './image-generation.service'
import { MockImageProvider } from './mock.provider'
import { OpenAIImageProvider } from './openai-image.provider'

export interface RetakeTaskInput {
  providerConfigId: string
  projectId: string
  shotId: string
  sourceCandidateId: string
  operation: RetakeOperation
  instruction: string
  preserveFields: string[]
  referenceAssetIds?: string[]
  maskAssetId?: string
  size?: ImageGenerationInput['size']
  quality?: ImageGenerationInput['quality']
  outputFormat?: ImageGenerationInput['outputFormat']
}

export interface RetakePreflight {
  canSubmit: boolean
  issues: Array<{ code: string; message: string }>
  providerConfigId: string
  providerKind?: string
  sourceCandidateId: string
  sourceAssetId?: string
  referenceAssetIds: string[]
  maskAssetId?: string
}

export interface RetakeTaskResult {
  ok: boolean
  error?: string
  request: RetakeRequest
  task?: LongTask
  candidate?: ShotStillCandidate
  asset?: ProjectAsset
  lineageId?: string
}

export interface RetakeServiceDeps {
  repos: Repositories
  imageAssetArchiver: ImageAssetArchiver
  imageProviderFactory?: (config: ImageProviderConfigRecord) => ImageProvider
}

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export async function preflightRetake(deps: RetakeServiceDeps, input: RetakeTaskInput): Promise<RetakePreflight> {
  const issues: RetakePreflight['issues'] = []
  const { repos } = deps
  const config = repos.imageProviderConfig.getImageProviderConfig(repos.db, input.providerConfigId)
  const capability = config ? getImageProviderCapability(config) : undefined
  if (!config) issues.push({ code: 'provider_missing', message: '未找到图片 Provider 设置。' })
  else if (!capability?.canSubmit) issues.push({ code: 'provider_disabled', message: capability?.reason ?? '图片 Provider 不可提交。' })
  else if (!capability.supportsImageEdit) issues.push({ code: 'edit_unsupported', message: '当前 Provider 未声明图片编辑能力。' })

  const sourceCandidate = repos.shotStill.getShotStillCandidate(repos.db, input.sourceCandidateId)
  if (!sourceCandidate || sourceCandidate.shotId !== input.shotId || sourceCandidate.projectId !== input.projectId) {
    issues.push({ code: 'source_candidate_invalid', message: '源候选不属于当前项目或镜头。' })
  }
  const sourceAsset = sourceCandidate ? repos.asset.getAsset(repos.db, sourceCandidate.assetId) : undefined
  if (!sourceAsset) issues.push({ code: 'source_asset_missing', message: '源候选引用的图片素材不存在。' })
  else await validateLocalImage(sourceAsset, '源图', issues)

  const referenceAssetIds = [...new Set(input.referenceAssetIds ?? [])]
  if (referenceAssetIds.length > 3) issues.push({ code: 'too_many_references', message: '除源图外最多可附加三张参考图。' })
  const referenceAssets = referenceAssetIds.flatMap((id) => {
    const asset = repos.asset.getAsset(repos.db, id)
    if (!asset || asset.projectId !== input.projectId) {
      issues.push({ code: 'reference_invalid', message: `参考素材 ${id} 不属于当前项目。` })
      return []
    }
    return [asset]
  })
  for (const asset of referenceAssets) await validateLocalImage(asset, `参考图 ${asset.title}`, issues)

  const maskAsset = input.maskAssetId ? repos.asset.getAsset(repos.db, input.maskAssetId) : undefined
  if (input.maskAssetId && (!maskAsset || maskAsset.projectId !== input.projectId)) {
    issues.push({ code: 'mask_invalid', message: '遮罩素材不存在或不属于当前项目。' })
  } else if (maskAsset) {
    await validateMask(sourceAsset, maskAsset, issues)
  }

  if (!input.instruction.trim()) issues.push({ code: 'instruction_empty', message: 'Retake 指令不能为空。' })
  if (input.preserveFields.length === 0) issues.push({ code: 'preserve_empty', message: '至少声明一项必须保留的内容。' })

  return {
    canSubmit: issues.length === 0,
    issues,
    providerConfigId: input.providerConfigId,
    providerKind: config?.kind,
    sourceCandidateId: input.sourceCandidateId,
    sourceAssetId: sourceAsset?.id,
    referenceAssetIds,
    maskAssetId: maskAsset?.id,
  }
}

export async function createRetakeTask(
  deps: RetakeServiceDeps,
  input: RetakeTaskInput,
  signal?: AbortSignal,
  options: { longTaskId?: string } = {},
): Promise<RetakeTaskResult> {
  const startedAt = Date.now()
  const { repos } = deps
  const preflight = await preflightRetake(deps, input)
  if (!preflight.canSubmit) throw new Error(preflight.issues.map((issue) => issue.message).join('；'))
  const config = repos.imageProviderConfig.getImageProviderConfig(repos.db, input.providerConfigId)
  const sourceCandidate = repos.shotStill.getShotStillCandidate(repos.db, input.sourceCandidateId)
  const sourceAsset = sourceCandidate ? repos.asset.getAsset(repos.db, sourceCandidate.assetId) : undefined
  const shot = repos.shot.getShot(repos.db, input.shotId)
  if (!config || !sourceCandidate || !sourceAsset || !shot) throw new Error('Retake 预检后生产上下文发生变化，请重新提交')
  const scene = repos.scene.getScene(repos.db, shot.sceneId)
  const script = scene ? repos.script.getScript(repos.db, scene.scriptId) : undefined
  const adaptation = script ? repos.adaptationProject.getAdaptationProject(repos.db, script.adaptationProjectId) : undefined
  if (!adaptation || adaptation.sourceProjectId !== input.projectId) throw new Error('镜头不属于当前项目')

  let request = repos.productionStudio.createRetakeRequest(repos.db, {
    projectId: input.projectId,
    shotId: input.shotId,
    sourceCandidateId: input.sourceCandidateId,
    operation: input.operation,
    instruction: input.instruction.trim(),
    preserveFields: normalizedStrings(input.preserveFields),
    referenceAssetIds: [...new Set(input.referenceAssetIds ?? [])],
    maskAssetId: input.maskAssetId,
    providerConfigId: input.providerConfigId,
    status: 'queued',
  })
  const task = repos.longTask.createLongTask(repos.db, {
    id: options.longTaskId,
    kind: 'image',
    title: `局部 Retake · 镜头 ${shot.shotNumber}`,
    taskType: 'image_retake',
    projectId: input.projectId,
    adaptationProjectId: adaptation.id,
    episodeId: shot.episodeId,
    sceneId: shot.sceneId,
    shotId: shot.id,
    relatedEntityId: request.id,
    input: {
      providerConfigId: input.providerConfigId,
      projectId: input.projectId,
      shotId: input.shotId,
      sourceCandidateId: input.sourceCandidateId,
      operation: input.operation,
      preserveFields: request.preserveFields,
      referenceAssetIds: request.referenceAssetIds,
      maskAssetId: input.maskAssetId,
    },
  })
  const referenceAssets = [sourceAsset, ...request.referenceAssetIds.flatMap((id) => repos.asset.getAsset(repos.db, id) ?? [])]
  const prompt = composeRetakePrompt(request)
  const lineage = repos.generation.createGenerationLineage(repos.db, {
    projectId: input.projectId,
    adaptationProjectId: adaptation.id,
    episodeId: shot.episodeId,
    sceneId: shot.sceneId,
    shotId: shot.id,
    mediaType: 'image',
    taskKind: 'image_retake',
    taskId: task.id,
    parentLineageId: lineageIdFromAsset(sourceAsset),
    sourceEntityKind: 'shot_still_candidate',
    sourceEntityId: sourceCandidate.id,
    sourceVersion: sourceCandidate.updatedAt,
    sourceSnapshot: {
      candidateId: sourceCandidate.id,
      assetId: sourceAsset.id,
      assetSha256: sourceAsset.sha256,
      shotUpdatedAt: shot.updatedAt,
    },
    providerSnapshot: {
      providerConfigId: config.id,
      providerName: config.name,
      providerKind: config.kind,
      model: config.model,
      capability: getImageProviderCapability(config),
    },
    parameterSnapshot: {
      operation: request.operation,
      instruction: request.instruction,
      preserveFields: request.preserveFields,
      size: input.size ?? '1024x1536',
      quality: input.quality ?? 'medium',
      outputFormat: input.outputFormat ?? 'png',
      maskAssetId: input.maskAssetId,
    },
    referenceAssets: referenceAssets.map((asset, index) => ({
      assetId: asset.id,
      role: index === 0 ? 'source' : 'reference',
    })),
    completeness: 'complete',
  })
  const cost = repos.generation.createGenerationCostEntry(repos.db, {
    projectId: input.projectId,
    adaptationProjectId: adaptation.id,
    episodeId: shot.episodeId,
    sceneId: shot.sceneId,
    shotId: shot.id,
    lineageId: lineage.id,
    taskId: task.id,
    mediaType: 'image',
    status: 'unknown',
    estimateBasis: '图片编辑包含输入图像 Token；实际费用以 Provider 账单为准。',
  })
  request = repos.productionStudio.updateRetakeRequest(repos.db, request.id, { status: 'running', lineageId: lineage.id }) ?? request
  repos.longTask.markLongTaskRunning(repos.db, task.id)

  try {
    const provider = deps.imageProviderFactory?.(config) ?? imageProviderFromConfig(config)
    if (!provider.edit) throw new Error('当前图片 Provider 未实现 Retake')
    const results = await provider.edit({
      prompt,
      model: config.model,
      images: referenceAssets.map(assetToEditFile),
      mask: input.maskAssetId ? assetToEditFile(repos.asset.getAsset(repos.db, input.maskAssetId)!) : undefined,
      size: input.size ?? '1024x1536',
      quality: input.quality ?? 'medium',
      outputFormat: input.outputFormat ?? 'png',
    }, signal)
    if (signal?.aborted) throw new Error('请求已取消')
    const result = results[0]
    if (!result) throw new Error('图片 Provider 未返回 Retake 结果')
    const archived = await deps.imageAssetArchiver({ projectId: input.projectId, task, result, index: 0 })
    const asset = repos.asset.createAsset(repos.db, {
      projectId: input.projectId,
      kind: sourceAsset.kind,
      title: `Retake · ${sourceCandidate.label}`,
      sourceEntityKind: 'image_task',
      sourceEntityId: task.id,
      localPath: archived.localPath,
      relativePath: archived.relativePath,
      originalName: archived.originalName,
      sha256: archived.sha256,
      sizeBytes: archived.sizeBytes,
      mimeType: result.mimeType,
      tags: ['AI 图片', 'Retake', request.operation],
      metadata: {
        generationLineageId: lineage.id,
        retakeRequestId: request.id,
        sourceCandidateId: sourceCandidate.id,
        providerKind: config.kind,
        model: result.model,
      },
      status: 'available',
      packagePolicy: 'include_binary',
    })
    const candidate = repos.shotStill.createShotStillCandidate(repos.db, {
      projectId: input.projectId,
      shotId: shot.id,
      assetId: asset.id,
      kind: sourceCandidate.kind,
      label: `Retake · ${sourceCandidate.label}`,
      notes: `局部修改：${request.instruction}；保留：${request.preserveFields.join('、')}`,
      sourceFingerprint: shot.updatedAt,
    })
    request = repos.productionStudio.updateRetakeRequest(repos.db, request.id, {
      status: 'succeeded',
      resultCandidateId: candidate.id,
      errorMessage: undefined,
    }) ?? request
    repos.longTask.finishLongTask(repos.db, task.id, 'success', {
      relatedEntityId: candidate.id,
      output: { retakeRequestId: request.id, assetId: asset.id, candidateId: candidate.id, lineageId: lineage.id },
    })
    repos.productionStudio.recordProviderObservation(repos.db, {
      projectId: input.projectId,
      providerConfigId: config.id,
      providerKind: config.kind,
      mode: input.quality === 'low' ? 'draft' : 'final',
      taskKind: 'image_retake',
      outcome: 'success',
      latencyMs: Date.now() - startedAt,
    })
    return { ok: true, request, task, candidate, asset, lineageId: lineage.id }
  } catch (error) {
    const message = safeErrorMessage(error)
    const canceled = signal?.aborted || message === '请求已取消'
    request = repos.productionStudio.updateRetakeRequest(repos.db, request.id, {
      status: canceled ? 'canceled' : 'failed',
      errorMessage: message,
    }) ?? request
    repos.generation.updateGenerationCostEntry(repos.db, cost.id, {
      status: canceled ? 'unknown' : 'unavailable',
      actualCostNote: canceled
        ? '已停止本地等待；同步编辑请求的远端费用状态未知。'
        : '请求未完成；费用需以 Provider 账单为准。',
    })
    repos.longTask.finishLongTask(repos.db, task.id, canceled ? 'canceled' : 'failed', { errorMessage: message })
    repos.productionStudio.recordProviderObservation(repos.db, {
      projectId: input.projectId,
      providerConfigId: config.id,
      providerKind: config.kind,
      mode: input.quality === 'low' ? 'draft' : 'final',
      taskKind: 'image_retake',
      outcome: canceled ? 'canceled' : 'failed',
      latencyMs: Date.now() - startedAt,
      errorCode: canceled ? 'canceled' : 'provider_error',
    })
    return { ok: false, error: message, request, task, lineageId: lineage.id }
  }
}

function composeRetakePrompt(request: RetakeRequest): string {
  return [
    `Retake operation: ${request.operation}.`,
    `Change only this requested area: ${request.instruction}.`,
    `Preserve exactly: ${request.preserveFields.join('; ')}.`,
    'Keep character identity, visual continuity, aspect ratio intent, and all unrelated regions unchanged.',
  ].join('\n')
}

function imageProviderFromConfig(config: ImageProviderConfigRecord): ImageProvider {
  return config.kind === 'mock' ? new MockImageProvider() : new OpenAIImageProvider(config)
}

function assetToEditFile(asset: ProjectAsset): ImageEditFile {
  if (!asset.localPath || !asset.mimeType || !IMAGE_MIME_TYPES.has(asset.mimeType)) throw new Error(`素材 ${asset.title} 没有可用本地图片`)
  return {
    localPath: asset.localPath,
    fileName: asset.originalName || basename(asset.localPath),
    mimeType: asset.mimeType as ImageEditFile['mimeType'],
  }
}

async function validateLocalImage(asset: ProjectAsset, label: string, issues: RetakePreflight['issues']): Promise<void> {
  if (asset.status !== 'available' || !asset.localPath) {
    issues.push({ code: 'local_image_required', message: `${label}没有可用的本地文件。` })
    return
  }
  if (!asset.mimeType || !IMAGE_MIME_TYPES.has(asset.mimeType)) {
    issues.push({ code: 'image_type_invalid', message: `${label}必须是 PNG、JPEG 或 WebP。` })
    return
  }
  try {
    const file = await stat(asset.localPath)
    if (!file.isFile() || file.size <= 0) issues.push({ code: 'image_empty', message: `${label}为空文件。` })
    if (file.size > 50 * 1024 * 1024) issues.push({ code: 'image_too_large', message: `${label}超过 50 MB。` })
  } catch {
    issues.push({ code: 'image_unreadable', message: `${label}无法读取，请重新定位素材。` })
  }
}

async function validateMask(
  source: ProjectAsset | undefined,
  mask: ProjectAsset,
  issues: RetakePreflight['issues'],
): Promise<void> {
  await validateLocalImage(mask, '遮罩', issues)
  if (mask.mimeType !== 'image/png' || !mask.localPath) {
    issues.push({ code: 'mask_png_required', message: '遮罩必须是带透明通道的 PNG。' })
    return
  }
  try {
    const maskMeta = parsePngHeader(await readFile(mask.localPath))
    if (!maskMeta.hasAlpha) issues.push({ code: 'mask_alpha_required', message: '遮罩 PNG 必须包含透明通道。' })
    const sourceSize = source ? await knownImageSize(source) : undefined
    if (!sourceSize) {
      issues.push({ code: 'source_size_unknown', message: '使用遮罩前必须能确认源图尺寸。' })
    } else if (sourceSize.width !== maskMeta.width || sourceSize.height !== maskMeta.height) {
      issues.push({ code: 'mask_size_mismatch', message: '遮罩尺寸必须与源图完全一致。' })
    }
  } catch {
    issues.push({ code: 'mask_invalid_png', message: '遮罩 PNG 结构无效。' })
  }
}

async function knownImageSize(asset: ProjectAsset): Promise<{ width: number; height: number } | undefined> {
  if (asset.width && asset.height) return { width: asset.width, height: asset.height }
  if (asset.mimeType === 'image/png' && asset.localPath) {
    const header = parsePngHeader(await readFile(asset.localPath))
    return { width: header.width, height: header.height }
  }
  return undefined
}

function parsePngHeader(bytes: Uint8Array): { width: number; height: number; hasAlpha: boolean } {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 26 || signature.some((value, index) => bytes[index] !== value)) throw new Error('invalid png')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  const colorType = bytes[25]
  if (!width || !height) throw new Error('invalid dimensions')
  return { width, height, hasAlpha: colorType === 4 || colorType === 6 }
}

function normalizedStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 20)
}

function lineageIdFromAsset(asset: ProjectAsset): string | undefined {
  const value = asset.metadata.generationLineageId
  return typeof value === 'string' ? value : undefined
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer ***')
    .slice(0, 240)
}
