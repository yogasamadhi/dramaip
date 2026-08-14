import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  buildAigcMetadata,
  buildEpisodeQualitySourceFingerprint,
  evaluateCompliancePreflight,
  type ComplianceRuleProfile,
  type EpisodeComplianceArchive,
  type EpisodeCompliancePreflight,
  type EpisodeQualityReport,
  type LongTask,
  type ProjectAsset,
} from '@sdns/core'
import type { Repositories } from '@sdns/db'
import { discoverEpisodeFfmpeg, EPISODE_RENDER_TASK_TYPE, preflightEpisodeRender, type EpisodeRenderInput } from './episode-render'
import { beginLongTaskRun, finishLongTaskRun } from './task-runtime'

export const EPISODE_COMPLIANCE_TASK_TYPE = 'export_compliant_episode'

export interface EpisodeComplianceInput {
  projectId: string
  adaptationProjectId: string
  episodeId: string
  renderTaskId: string
  qualityTaskId: string
  profileId: string
  title: string
  subtitleLanguage: string
  targetPlatform?: string
  targetRegion?: string
  deliveryDate: string
  aigcDeclared: boolean
  manualContentReviewConfirmed: boolean
}

export type { EpisodeComplianceArchive, EpisodeCompliancePreflight } from '@sdns/core'

export interface EpisodeComplianceHistoryItem {
  task: LongTask
  stale: boolean
  staleReason?: string
}

interface PreparedCompliance {
  input: EpisodeComplianceInput
  renderTask: LongTask
  renderInput: EpisodeRenderInput
  sourceMp4Path: string
  renderSourceFingerprint: string
  profile: ComplianceRuleProfile
  preflight: EpisodeCompliancePreflight
  ffmpegPath: string
}

export async function preflightEpisodeCompliance(repos: Repositories, input: EpisodeComplianceInput): Promise<EpisodeCompliancePreflight> {
  const prepared = await prepareEpisodeCompliance(repos, input)
  return prepared.preflight
}

export async function startEpisodeCompliance(repos: Repositories, input: EpisodeComplianceInput) {
  const prepared = await prepareEpisodeCompliance(repos, input)
  if ('error' in prepared) return { ok: false, error: prepared.error, preflight: prepared.preflight }
  if (!prepared.preflight.ok) return { ok: false, error: prepared.preflight.blockers.join('；') || '合规预检未通过。', preflight: prepared.preflight }
  const task = repos.longTask.createLongTask(repos.db, {
    kind: 'video',
    title: `合规交付封装 · ${input.episodeId.slice(0, 8)}`,
    taskType: EPISODE_COMPLIANCE_TASK_TYPE,
    projectId: input.projectId,
    adaptationProjectId: input.adaptationProjectId,
    episodeId: input.episodeId,
    input: { episodeCompliance: input },
    output: { preflight: preflightOutput(prepared.preflight) },
  })
  void runEpisodeCompliance(repos, task.id, prepared)
  return { ok: true, longTaskId: task.id, task, preflight: prepared.preflight }
}

export async function retryEpisodeCompliance(repos: Repositories, taskId: string) {
  const task = repos.longTask.getLongTask(repos.db, taskId)
  const input = complianceInputFromTask(task?.input)
  if (!task || task.taskType !== EPISODE_COMPLIANCE_TASK_TYPE || !input) return { ok: false, error: '该任务不是可重试的合规交付任务。', longTaskId: taskId, task }
  if (task.status === 'running') return { ok: false, error: '合规交付正在运行。', longTaskId: taskId, task }
  return runEpisodeCompliance(repos, taskId)
}

export async function runEpisodeCompliance(repos: Repositories, taskId: string, supplied?: PreparedCompliance) {
  const task = repos.longTask.getLongTask(repos.db, taskId)
  const input = complianceInputFromTask(task?.input)
  if (!task || !input) return { ok: false, error: '合规交付任务缺少可信输入。', longTaskId: taskId, task }
  const runtime = beginLongTaskRun('video', taskId)
  if (!runtime.ok) {
    const failed = repos.longTask.finishLongTask(repos.db, taskId, 'failed', { errorMessage: runtime.error })
    return { ok: false, error: runtime.error, longTaskId: taskId, task: failed }
  }
  repos.longTask.markLongTaskRunning(repos.db, taskId)
  try {
    const prepared = supplied ?? await prepareEpisodeCompliance(repos, input)
    if ('error' in prepared || !prepared.preflight.ok) {
      const message = 'error' in prepared ? prepared.error : prepared.preflight.blockers.join('；') || '合规预检未通过。'
      const failed = repos.longTask.finishLongTask(repos.db, taskId, 'failed', { errorMessage: message, output: { preflight: preflightOutput(prepared.preflight) } })
      return { ok: false, error: message, longTaskId: taskId, task: failed }
    }
    const archive = await renderCompliantEpisode({
      ffmpegPath: prepared.ffmpegPath,
      sourceMp4Path: prepared.sourceMp4Path,
      taskId,
      sourceFingerprint: prepared.preflight.sourceFingerprint!,
      profile: prepared.profile,
      visibleLabel: prepared.preflight.visibleLabel!,
      metadata: prepared.preflight.metadata,
      signal: runtime.signal!,
      contentRecord: buildComplianceContentRecord(repos, input),
    })
    const refreshed = await prepareEpisodeCompliance(repos, input)
    if ('error' in refreshed || !refreshed.preflight.ok || refreshed.preflight.sourceFingerprint !== archive.sourceFingerprint) {
      const message = '封装期间上游成片、质检报告、权利台账或规则 Profile 已变化；拒绝将输出标为当前交付。'
      const failed = repos.longTask.finishLongTask(repos.db, taskId, 'failed', { errorMessage: message, output: { preflight: preflightOutput(refreshed.preflight), archive } })
      return { ok: false, error: message, longTaskId: taskId, task: failed }
    }
    const finished = repos.longTask.finishLongTask(repos.db, taskId, 'success', { output: { preflight: preflightOutput(prepared.preflight), archive } })
    return { ok: true, longTaskId: taskId, task: finished, archive }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const finished = repos.longTask.finishLongTask(repos.db, taskId, runtime.signal?.aborted ? 'canceled' : 'failed', { errorMessage: message })
    return { ok: false, error: message, longTaskId: taskId, task: finished }
  } finally {
    finishLongTaskRun(taskId)
  }
}

export async function listEpisodeComplianceHistory(repos: Repositories, input: Omit<EpisodeComplianceInput, 'renderTaskId' | 'qualityTaskId' | 'profileId' | 'title' | 'subtitleLanguage' | 'deliveryDate' | 'aigcDeclared' | 'manualContentReviewConfirmed' | 'targetPlatform' | 'targetRegion'>): Promise<EpisodeComplianceHistoryItem[]> {
  const tasks = repos.longTask.listLongTasksByProject(repos.db, input.projectId)
    .filter((task) => task.taskType === EPISODE_COMPLIANCE_TASK_TYPE && task.episodeId === input.episodeId)
  return Promise.all(tasks.map(async (task) => {
    const taskInput = complianceInputFromTask(task.input)
    if (!taskInput) return { task, stale: true, staleReason: '合规交付任务缺少可复算输入。' }
    const prepared = await prepareEpisodeCompliance(repos, taskInput)
    const saved = sourceFingerprintFromComplianceTask(task.output)
    if ('error' in prepared) return { task, stale: true, staleReason: prepared.error }
    return saved === prepared.preflight.sourceFingerprint
      ? { task, stale: false }
      : { task, stale: true, staleReason: '上游成片、质检、授权、声明或规则 Profile 已变化；请重新合规封装。' }
  }))
}

async function prepareEpisodeCompliance(repos: Repositories, input: EpisodeComplianceInput): Promise<PreparedCompliance | { error: string; preflight: EpisodeCompliancePreflight }> {
  const storedProfile = repos.compliance.getComplianceRuleProfile(repos.db, input.profileId)
  const profile = storedProfile && repos.compliance.isVerifiedComplianceRuleProfile(storedProfile)
    ? storedProfile
    : storedProfile ? { ...storedProfile, integrityStatus: 'invalid' as const } : undefined
  const renderTask = repos.longTask.getLongTask(repos.db, input.renderTaskId)
  const renderInput = renderInputFromTask(renderTask?.input)
  const archive = renderArchiveFromTask(renderTask?.output)
  const qualityTask = repos.longTask.getLongTask(repos.db, input.qualityTaskId)
  const qualityReport = qualityReportFromTask(qualityTask?.output)
  const base = (overrides: Partial<EpisodeCompliancePreflight> = {}): EpisodeCompliancePreflight => ({ ok: false, blockers: [], warnings: [], metadata: {}, profile, ...overrides })
  if (!profile) return { error: '未找到选择的合规规则 Profile。', preflight: base({ blockers: ['未找到选择的合规规则 Profile。'] }) }
  if (!renderTask || renderTask.taskType !== EPISODE_RENDER_TASK_TYPE || renderTask.status !== 'success' || !renderInput || !archive) {
    return { error: '请选择成功归档的当前 MP4 渲染任务。', preflight: base({ blockers: ['请选择成功归档的当前 MP4 渲染任务。'] }) }
  }
  if (renderTask.projectId !== input.projectId || renderTask.adaptationProjectId !== input.adaptationProjectId || renderTask.episodeId !== input.episodeId) {
    return { error: '渲染任务不属于当前项目或分集。', preflight: base({ blockers: ['渲染任务不属于当前项目或分集。'] }) }
  }
  const renderPreflight = await preflightEpisodeRender(repos, renderInput)
  const sourceCurrent = Boolean(renderPreflight.plan && renderPreflight.plan.sourceFingerprint === archive.sourceFingerprint)
  const expectedQualityFingerprint = renderPreflight.plan
    ? buildEpisodeQualitySourceFingerprint({ renderTaskId: renderTask.id, renderSourceFingerprint: archive.sourceFingerprint, currentPlanFingerprint: renderPreflight.plan.sourceFingerprint })
    : undefined
  const qualityCurrent = Boolean(
    qualityTask?.taskType === 'inspect_episode_media'
    && qualityTask.status === 'success'
    && qualityReport
    && qualityReport.renderTaskId === renderTask.id
    && qualityReport.sourceFingerprint === expectedQualityFingerprint,
  )
  const rights = repos.rights.preflightProjectRights(repos.db, { projectId: input.projectId, platform: input.targetPlatform, region: input.targetRegion, deliveryAt: input.deliveryDate })
  const episode = repos.episode.getEpisode(repos.db, input.episodeId)
  const evaluation = evaluateCompliancePreflight({
    profile,
    targetPlatform: input.targetPlatform,
    targetRegion: input.targetRegion,
    deliveryDate: input.deliveryDate,
    title: input.title || episode?.title || '',
    subtitleLanguage: input.subtitleLanguage,
    aigcDeclared: input.aigcDeclared,
    manualContentReviewConfirmed: input.manualContentReviewConfirmed,
    rightsStatus: rights.status,
    qualityReportCurrent: sourceCurrent && qualityCurrent,
    qualityBlockerCount: qualityReport?.blockerCount ?? 0,
  })
  if (!sourceCurrent) evaluation.blockers.push('当前 MP4 已过期；镜头、音轨、字幕、资产或权利记录发生变化。')
  if (!qualityCurrent) evaluation.blockers.push('请选择与当前 MP4 绑定且未过期的媒体质检报告。')
  const sourceFingerprint = buildComplianceSourceFingerprint({ input, archiveSourceFingerprint: archive.sourceFingerprint, qualitySourceFingerprint: qualityReport?.sourceFingerprint, profile })
  const preflight: EpisodeCompliancePreflight = {
    ...evaluation,
    ok: evaluation.blockers.length === 0,
    sourceFingerprint,
    profile,
    sourceMp4Path: archive.mp4Path,
    metadata: buildAigcMetadata({ profile, title: input.title || episode?.title || '', subtitleLanguage: input.subtitleLanguage, sourceFingerprint }),
  }
  if (!preflight.ok) return { error: preflight.blockers.join('；') || '合规预检未通过。', preflight }
  const ffmpegPath = await discoverEpisodeFfmpeg()
  if (!ffmpegPath) return { error: '未找到受控 FFmpeg 运行时，无法写入显式/隐式 AIGC 标识。', preflight: { ...preflight, ok: false, blockers: [...preflight.blockers, '未找到受控 FFmpeg 运行时。'] } }
  return { input, renderTask, renderInput, sourceMp4Path: archive.mp4Path, renderSourceFingerprint: archive.sourceFingerprint, profile, preflight, ffmpegPath }
}

export async function renderCompliantEpisode(input: { ffmpegPath: string; sourceMp4Path: string; taskId: string; sourceFingerprint: string; profile: ComplianceRuleProfile; visibleLabel: string; metadata: Record<string, string>; signal: AbortSignal; directory?: string; contentRecord?: ComplianceContentRecord }): Promise<EpisodeComplianceArchive> {
  const directory = input.directory ?? join(dirname(input.sourceMp4Path), 'compliance', safeSegment(input.taskId))
  await mkdir(directory, { recursive: true })
  const mp4Path = join(directory, 'episode-compliant.mp4')
  const manifestPath = join(directory, 'compliance-manifest.json')
  const hiddenPayload = `SDNS-AIGC:${JSON.stringify({ schemaVersion: 1, profileVersion: input.profile.version, source: input.profile.sourceUrl, sourceFingerprint: input.sourceFingerprint, metadata: input.metadata })}`
  const drawtext = `drawtext=text='${escapeDrawtext(input.visibleLabel)}':fontcolor=white:fontsize=22:box=1:boxcolor=black@0.55:boxborderw=8:x=w-tw-24:y=24`
  await runFfmpeg(input.ffmpegPath, ['-y', '-i', input.sourceMp4Path, '-map', '0:v:0', '-map', '0:a?', '-vf', drawtext, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'copy', '-metadata', `title=${input.metadata.title ?? ''}`, '-metadata', `comment=${hiddenPayload}`, '-metadata', `description=AI generated/synthesized content; profile=${input.profile.version}`, '-movflags', 'use_metadata_tags+faststart', mp4Path], input.signal)
  const verification = await runFfmpeg(input.ffmpegPath, ['-i', mp4Path, '-f', 'null', '-'], input.signal)
  if (verification.code !== 0 || !verification.stderr.includes('SDNS-AIGC:')) throw new Error('转码后未验证到 AIGC 隐式标识；不会把文件标为合规交付。')
  const archive: EpisodeComplianceArchive = { taskId: input.taskId, mp4Path, manifestPath, sourceFingerprint: input.sourceFingerprint, profileVersion: input.profile.version, visibleLabel: input.visibleLabel, metadata: input.metadata }
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(), profile: {
    id: input.profile.id, version: input.profile.version, title: input.profile.title, sourceUrl: input.profile.sourceUrl,
    sourceStatus: input.profile.sourceStatus, publishedAt: input.profile.publishedAt, effectiveAt: input.profile.effectiveAt,
    contentChecksum: input.profile.contentChecksum, integrityStatus: input.profile.integrityStatus,
  }, explicitLabel: input.visibleLabel, hiddenMetadata: input.metadata, contentDeclaration: input.contentRecord, delivery: archive }, null, 2), 'utf8')
  return archive
}

interface ComplianceContentRecord {
  userAigcDeclaration: boolean
  text: { subtitleLanguage: string; contentMarker: string }
  images: ComplianceAssetRecord[]
  audio: ComplianceAssetRecord[]
  video: ComplianceAssetRecord[]
  finalFile: { contentMarker: string; metadataKeys: string[] }
}

interface ComplianceAssetRecord {
  assetId: string
  kind: ProjectAsset['kind']
  title: string
  aiGenerated: boolean | null
  provider?: string
  contentMarker?: string
  rightsStatus: string
}

/** Records only delivery-relevant attributes; paths, source text, prompts and credentials never enter the manifest. */
function buildComplianceContentRecord(repos: Repositories, input: EpisodeComplianceInput): ComplianceContentRecord {
  const rightsByAsset = new Map(repos.rights.listAssetRightsByProject(repos.db, input.projectId).map((record) => [record.assetId, record]))
  const records = repos.asset.listProjectAssets(repos.db, input.projectId)
    .filter((asset) => !['rights_evidence', 'subtitle_file', 'other'].includes(asset.kind))
    .map((asset) => complianceAssetRecord(asset, rightsByAsset.get(asset.id)))
  const imageKinds: ProjectAsset['kind'][] = ['character_reference', 'casting_reference', 'scene_reference', 'style_reference', 'cover_image', 'first_frame_image']
  const audioKinds: ProjectAsset['kind'][] = ['voice_reference', 'narration_audio', 'dialogue_audio', 'bgm_audio', 'sfx_audio']
  return {
    userAigcDeclaration: input.aigcDeclared,
    text: { subtitleLanguage: input.subtitleLanguage, contentMarker: 'sdns:aigc' },
    images: records.filter((record) => imageKinds.includes(record.kind)),
    audio: records.filter((record) => audioKinds.includes(record.kind)),
    video: records.filter((record) => record.kind === 'video_result' || record.kind === 'source_media'),
    finalFile: { contentMarker: 'SDNS-AIGC', metadataKeys: ['sdns:aigc', 'sdns:rule-profile', 'sdns:source-fingerprint'] },
  }
}

function complianceAssetRecord(asset: ProjectAsset, rights: { aiGenerated: boolean; status: string } | undefined): ComplianceAssetRecord {
  const metadata = asset.metadata as Record<string, unknown>
  const provider = firstString(metadata.provider, metadata.providerName, metadata.modelProvider)
  const contentMarker = firstString(metadata.contentMarker, metadata.aigcMarker, metadata.contentId)
  return { assetId: asset.id, kind: asset.kind, title: asset.title, aiGenerated: rights?.aiGenerated ?? null, provider, contentMarker, rightsStatus: rights?.status ?? 'missing' }
}

function firstString(...values: unknown[]): string | undefined {
  const value = values.find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)
  return value?.trim().slice(0, 160)
}

async function runFfmpeg(command: string, args: string[], signal: AbortSignal): Promise<{ code: number | null; stderr: string }> {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('合规封装已取消')
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['-hide_banner', ...args], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    let stderr = ''
    const onAbort = () => child.kill('SIGTERM')
    signal.addEventListener('abort', onAbort, { once: true })
    child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-64_000) })
    child.on('error', (error) => { signal.removeEventListener('abort', onAbort); reject(error) })
    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort)
      if (signal.aborted) return reject(signal.reason instanceof Error ? signal.reason : new Error('合规封装已取消'))
      if (code === 0) return resolve({ code, stderr })
      reject(new Error(`FFmpeg 合规封装失败（${code ?? '未知'}）：${stderr.trim().slice(-2_000)}`))
    })
  })
}

function buildComplianceSourceFingerprint(input: { input: EpisodeComplianceInput; archiveSourceFingerprint: string; qualitySourceFingerprint?: string; profile: ComplianceRuleProfile }): string {
  const value = input.input
  return [
    'episode-compliance:v1',
    `render:${value.renderTaskId}:${input.archiveSourceFingerprint}`,
    `quality:${value.qualityTaskId}:${input.qualitySourceFingerprint ?? 'missing'}`,
    `profile:${input.profile.id}@${input.profile.version}:${input.profile.contentChecksum}:${input.profile.signature}:${input.profile.integrityStatus}`,
    `delivery:${value.targetPlatform ?? 'none'}:${value.targetRegion ?? 'none'}:${value.deliveryDate}`,
    `declaration:${value.aigcDeclared}:${value.manualContentReviewConfirmed}:${value.title}:${value.subtitleLanguage}`,
  ].join('|')
}

function preflightOutput(preflight: EpisodeCompliancePreflight): Record<string, unknown> {
  return { ok: preflight.ok, blockers: preflight.blockers, warnings: preflight.warnings, sourceFingerprint: preflight.sourceFingerprint, profileVersion: preflight.profile?.version, sourceMp4Path: preflight.sourceMp4Path }
}

function complianceInputFromTask(value: Record<string, unknown> | undefined): EpisodeComplianceInput | undefined {
  const candidate = value?.episodeCompliance
  if (!candidate || typeof candidate !== 'object') return undefined
  const record = candidate as Record<string, unknown>
  const required = ['projectId', 'adaptationProjectId', 'episodeId', 'renderTaskId', 'qualityTaskId', 'profileId', 'title', 'subtitleLanguage', 'deliveryDate']
  if (!required.every((key) => typeof record[key] === 'string') || typeof record.aigcDeclared !== 'boolean' || typeof record.manualContentReviewConfirmed !== 'boolean') return undefined
  return {
    projectId: record.projectId as string, adaptationProjectId: record.adaptationProjectId as string, episodeId: record.episodeId as string,
    renderTaskId: record.renderTaskId as string, qualityTaskId: record.qualityTaskId as string, profileId: record.profileId as string,
    title: record.title as string, subtitleLanguage: record.subtitleLanguage as string, deliveryDate: record.deliveryDate as string,
    targetPlatform: typeof record.targetPlatform === 'string' ? record.targetPlatform : undefined,
    targetRegion: typeof record.targetRegion === 'string' ? record.targetRegion : undefined,
    aigcDeclared: record.aigcDeclared, manualContentReviewConfirmed: record.manualContentReviewConfirmed,
  }
}

function renderInputFromTask(value: Record<string, unknown> | undefined): EpisodeRenderInput | undefined {
  const candidate = value?.episodeRender
  if (!candidate || typeof candidate !== 'object') return undefined
  const record = candidate as Record<string, unknown>
  if (typeof record.projectId !== 'string' || typeof record.adaptationProjectId !== 'string' || typeof record.episodeId !== 'string') return undefined
  const mutedTrackIds = Array.isArray(record.mutedTrackIds) && record.mutedTrackIds.every((id) => typeof id === 'string') ? record.mutedTrackIds as string[] : undefined
  return { projectId: record.projectId, adaptationProjectId: record.adaptationProjectId, episodeId: record.episodeId, mutedTrackIds }
}

function renderArchiveFromTask(value: Record<string, unknown> | undefined): { mp4Path: string; sourceFingerprint: string } | undefined {
  const archive = value?.archive
  if (!archive || typeof archive !== 'object') return undefined
  const record = archive as Record<string, unknown>
  return typeof record.mp4Path === 'string' && typeof record.sourceFingerprint === 'string' ? { mp4Path: record.mp4Path, sourceFingerprint: record.sourceFingerprint } : undefined
}

function qualityReportFromTask(value: Record<string, unknown> | undefined): EpisodeQualityReport | undefined {
  const report = value?.report
  return report && typeof report === 'object' && (report as { schemaVersion?: unknown }).schemaVersion === 1 ? report as EpisodeQualityReport : undefined
}

function sourceFingerprintFromComplianceTask(value: Record<string, unknown> | undefined): string | undefined {
  const archive = value?.archive
  if (!archive || typeof archive !== 'object') return undefined
  const sourceFingerprint = (archive as Record<string, unknown>).sourceFingerprint
  return typeof sourceFingerprint === 'string' ? sourceFingerprint : undefined
}

function escapeDrawtext(value: string): string { return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'") }
function safeSegment(value: string): string { return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96) || 'unknown' }
