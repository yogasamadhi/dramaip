import {
  getTtsProviderCapability,
  type LongTask,
  type ProjectAsset,
  type TtsGenerationInput,
  type TtsGenerationResult,
  type TtsProvider,
  type TtsProviderConfigRecord,
  type VoiceProfile,
} from '@sdns/core'
import type { Repositories } from '@sdns/db'
import { OpenAITtsProvider } from './openai-tts.provider'

export interface TtsAssetArchiveResult {
  localPath: string
  relativePath: string
  originalName: string
  sha256: string
  sizeBytes: number
}

export type TtsAssetArchiver = (input: {
  projectId: string
  task: LongTask
  result: TtsGenerationResult
  kind: 'dialogue' | 'narration'
}) => Promise<TtsAssetArchiveResult>

export interface TtsGenerationServiceDeps {
  repos: Repositories
  ttsProviderFactory?: (config: TtsProviderConfigRecord) => TtsProvider
  ttsAssetArchiver: TtsAssetArchiver
}

export interface TtsGenerationTaskInput {
  providerConfigId: string
  projectId: string
  episodeId: string
  shotId?: string
  voiceProfileId?: string
  kind: 'dialogue' | 'narration'
  input: string
  voice: string
  instructions?: string
  speed?: number
  responseFormat?: TtsGenerationInput['responseFormat']
  parentLineageId?: string
  retryOfLineageId?: string
}

export interface TtsGenerationTaskResult {
  ok: boolean
  error?: string
  task: LongTask
  lineageId?: string
  asset?: ProjectAsset
}

/**
 * Durable local half of a synchronous TTS request. It saves an intent before
 * dispatch, archives only returned bytes, and never overwrites manual audio.
 * The documented endpoint is synchronous, so cancellation only stops local
 * waiting; the actual remote charge remains unknown until billing is checked.
 */
export async function createTtsGenerationTask(
  deps: TtsGenerationServiceDeps,
  input: TtsGenerationTaskInput,
  signal?: AbortSignal,
  options: { longTaskId?: string } = {},
): Promise<TtsGenerationTaskResult> {
  const { repos } = deps
  const config = repos.ttsProviderConfig.getTtsProviderConfig(repos.db, input.providerConfigId)
  if (!config) throw new Error('未找到 TTS Provider 设置')
  const capability = getTtsProviderCapability(config)
  if (!capability.canSubmit) throw new Error(capability.reason ?? '当前 TTS Provider 不可提交')
  const scope = assertTtsGenerationScope(repos, input)
  const requestedText = input.input.trim()
  if (!requestedText) throw new Error('TTS 文本不能为空')
  const spokenText = applyPronunciationDictionary(requestedText, scope.voiceProfile?.pronunciationDictionary)
  if (spokenText.length > 4_096) throw new Error('应用读音词典后的 TTS 文本超过 4096 字符限制')
  const speed = input.speed ?? scope.voiceProfile?.speed
  const instructions = mergeInstructions(input.instructions, scope.voiceProfile)

  const task = repos.longTask.createLongTask(repos.db, {
    id: options.longTaskId,
    kind: 'audio',
    title: `生成${input.kind === 'dialogue' ? '对白' : '旁白'} · ${scope.episode.title}`,
    taskType: 'tts_generation',
    projectId: input.projectId,
    adaptationProjectId: scope.adaptationProjectId,
    episodeId: input.episodeId,
    shotId: input.shotId,
    input: retryableInput(input, requestedText),
  })
  const lineage = repos.generation.createGenerationLineage(repos.db, {
    projectId: input.projectId,
    adaptationProjectId: scope.adaptationProjectId,
    episodeId: input.episodeId,
    shotId: input.shotId,
    mediaType: 'audio',
    taskKind: 'tts_generation',
    taskId: task.id,
    parentLineageId: input.parentLineageId,
    retryOfLineageId: input.retryOfLineageId,
    sourceEntityKind: input.shotId ? 'shot' : 'episode',
    sourceEntityId: input.shotId ?? input.episodeId,
    sourceVersion: scope.sourceVersion,
    sourceSnapshot: {
      episodeId: input.episodeId, shotId: input.shotId, voiceProfileId: scope.voiceProfile?.id,
      voiceProfileLabel: scope.voiceProfile?.label, requestedText,
    },
    providerSnapshot: {
      providerConfigId: config.id, providerName: config.name, providerKind: config.kind,
      model: config.model, capability,
    },
    parameterSnapshot: {
      kind: input.kind, voice: input.voice, speed, responseFormat: input.responseFormat ?? 'mp3',
      instructions, pronunciationApplied: spokenText !== requestedText,
    },
    referenceAssets: scope.voiceProfile?.sampleAssetId ? [{ assetId: scope.voiceProfile.sampleAssetId, role: 'voice_reference' }] : [],
    completeness: 'complete',
  })
  const cost = repos.generation.createGenerationCostEntry(repos.db, {
    projectId: input.projectId,
    adaptationProjectId: scope.adaptationProjectId,
    episodeId: input.episodeId,
    shotId: input.shotId,
    lineageId: lineage.id,
    taskId: task.id,
    mediaType: 'audio',
    status: 'unknown',
    estimateBasis: 'Provider 未提供本地可信价目；真实账单未知。',
  })
  repos.longTask.markLongTaskRunning(repos.db, task.id)

  try {
    const provider = deps.ttsProviderFactory?.(config) ?? new OpenAITtsProvider(config)
    const result = await provider.generate({
      input: spokenText, model: config.model, voice: input.voice, instructions, speed, responseFormat: input.responseFormat ?? 'mp3',
    }, signal)
    if (signal?.aborted) return finishCanceled(repos, task, lineage.id, cost.id)
    const archived = await deps.ttsAssetArchiver({ projectId: input.projectId, task, result, kind: input.kind })
    const asset = repos.asset.createAsset(repos.db, {
      projectId: input.projectId,
      kind: input.kind === 'dialogue' ? 'dialogue_audio' : 'narration_audio',
      title: `${input.kind === 'dialogue' ? '对白' : '旁白'} · ${config.name}`,
      sourceEntityKind: 'audio_task',
      sourceEntityId: task.id,
      localPath: archived.localPath,
      relativePath: archived.relativePath,
      originalName: archived.originalName,
      sha256: archived.sha256,
      sizeBytes: archived.sizeBytes,
      mimeType: result.mimeType,
      tags: ['AI 配音', input.kind],
      metadata: {
        generationLineageId: lineage.id, longTaskId: task.id, providerKind: config.kind,
        model: result.model, voice: result.voice, voiceProfileId: scope.voiceProfile?.id,
      },
      status: 'available',
      packagePolicy: 'include_binary',
    })
    const finished = repos.longTask.finishLongTask(repos.db, task.id, 'success', {
      relatedEntityId: asset.id,
      output: { assetId: asset.id, lineageId: lineage.id },
    }) ?? task
    return { ok: true, task: finished, lineageId: lineage.id, asset }
  } catch (error) {
    if (signal?.aborted) return finishCanceled(repos, task, lineage.id, cost.id)
    const message = safeErrorMessage(error)
    repos.generation.updateGenerationCostEntry(repos.db, cost.id, { status: 'unavailable', actualCostNote: '请求未完成；费用需以 Provider 账单为准。' })
    const failed = repos.longTask.finishLongTask(repos.db, task.id, 'failed', { errorMessage: message }) ?? task
    return { ok: false, error: message, task: failed, lineageId: lineage.id }
  }
}

export async function retryTtsGenerationTask(
  deps: TtsGenerationServiceDeps,
  task: LongTask,
  signal?: AbortSignal,
  options: { longTaskId?: string } = {},
): Promise<TtsGenerationTaskResult> {
  if (task.kind !== 'audio' || task.taskType !== 'tts_generation') throw new Error('不是可重试的 TTS 生成任务')
  const retryInput = task.input && typeof task.input === 'object' ? task.input : {}
  const required = ['providerConfigId', 'projectId', 'episodeId', 'kind', 'input', 'voice'] as const
  if (required.some((key) => typeof retryInput[key] !== 'string' || !String(retryInput[key]).trim())) {
    throw new Error('TTS 任务缺少可重试输入；请回到声音与音频轨重新提交。')
  }
  const previousLineage = deps.repos.generation.listGenerationLineagesByTask(deps.repos.db, task.id)[0]
  return createTtsGenerationTask(deps, {
    providerConfigId: String(retryInput.providerConfigId), projectId: String(retryInput.projectId), episodeId: String(retryInput.episodeId),
    shotId: optionalString(retryInput.shotId), voiceProfileId: optionalString(retryInput.voiceProfileId), kind: retryInput.kind as TtsGenerationTaskInput['kind'],
    input: String(retryInput.input), voice: String(retryInput.voice), instructions: optionalString(retryInput.instructions),
    speed: typeof retryInput.speed === 'number' ? retryInput.speed : undefined,
    responseFormat: retryInput.responseFormat as TtsGenerationInput['responseFormat'],
    parentLineageId: previousLineage?.id, retryOfLineageId: previousLineage?.id,
  }, signal, options)
}

function assertTtsGenerationScope(repos: Repositories, input: TtsGenerationTaskInput): { adaptationProjectId: string; episode: { title: string; updatedAt: string }; sourceVersion: string; voiceProfile?: VoiceProfile } {
  const episode = repos.episode.getEpisode(repos.db, input.episodeId)
  if (!episode) throw new Error('未找到要生成音频的分集')
  const adaptation = repos.adaptationProject.getAdaptationProject(repos.db, episode.adaptationProjectId)
  if (!adaptation || adaptation.sourceProjectId !== input.projectId) throw new Error('分集不属于当前项目，不能提交 TTS 任务')
  if (input.shotId) {
    const shot = repos.shot.getShot(repos.db, input.shotId)
    if (!shot || shot.episodeId !== episode.id) throw new Error('镜头不属于当前分集，不能提交 TTS 任务')
  }
  const voiceProfile = input.voiceProfileId ? repos.audio.listVoiceProfilesByProject(repos.db, input.projectId).find((profile) => profile.id === input.voiceProfileId) : undefined
  if (input.voiceProfileId && !voiceProfile) throw new Error('声音 Profile 不属于当前项目')
  return { adaptationProjectId: adaptation.id, episode, sourceVersion: episode.updatedAt, voiceProfile }
}

function retryableInput(input: TtsGenerationTaskInput, text: string): Record<string, unknown> {
  return {
    providerConfigId: input.providerConfigId, projectId: input.projectId, episodeId: input.episodeId, shotId: input.shotId,
    voiceProfileId: input.voiceProfileId, kind: input.kind, input: text, voice: input.voice, instructions: input.instructions,
    speed: input.speed, responseFormat: input.responseFormat,
  }
}

function applyPronunciationDictionary(text: string, dictionary: Record<string, string> | undefined): string {
  if (!dictionary) return text
  return Object.entries(dictionary)
    .filter(([term, pronunciation]) => term.trim() && pronunciation.trim())
    .sort(([left], [right]) => right.length - left.length)
    .reduce((value, [term, pronunciation]) => value.split(term).join(pronunciation), text)
}

function mergeInstructions(instructions: string | undefined, profile: VoiceProfile | undefined): string | undefined {
  const profileNotes = [profile?.voiceTone, profile?.emotion && `情绪：${profile.emotion}`, profile?.language && `语言：${profile.language}`].filter(Boolean).join('；')
  const merged = [instructions?.trim(), profileNotes].filter(Boolean).join('；')
  return merged || undefined
}

function finishCanceled(repos: Repositories, task: LongTask, lineageId: string, costId: string): TtsGenerationTaskResult {
  repos.generation.updateGenerationCostEntry(repos.db, costId, { status: 'unknown', actualCostNote: '已停止本地等待；同步请求的远端费用状态未知。' })
  const canceled = repos.longTask.finishLongTask(repos.db, task.id, 'canceled', {
    errorMessage: '已停止本地等待；当前 Provider 未提供远端取消能力，费用状态未知。',
  }) ?? task
  return { ok: false, error: canceled.errorMessage, task: canceled, lineageId }
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer ***')
    .slice(0, 240)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}
