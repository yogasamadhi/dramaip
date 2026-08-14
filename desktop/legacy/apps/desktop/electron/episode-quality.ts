import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { writeFile } from 'node:fs/promises'
import {
  analyzeEpisodeQuality,
  analyzeVisualContinuity,
  buildEpisodeQualitySourceFingerprint,
  type EpisodeMediaInspection,
  type EpisodeQualityReport,
  type LongTask,
} from '@sdns/core'
import type { Repositories } from '@sdns/db'
import { beginLongTaskRun, finishLongTaskRun } from './task-runtime'
import { discoverEpisodeFfmpeg, EPISODE_RENDER_TASK_TYPE, preflightEpisodeRender, type EpisodeRenderInput } from './episode-render'

export const EPISODE_QUALITY_TASK_TYPE = 'inspect_episode_media'
export const EPISODE_MINIMAL_REDO_TASK_TYPE = 'plan_episode_media_redo'

export interface EpisodeQualityInput {
  projectId: string
  adaptationProjectId: string
  episodeId: string
  renderTaskId: string
}

export interface EpisodeQualityHistoryItem {
  task: LongTask
  report?: EpisodeQualityReport
  reportPath?: string
  stale: boolean
  staleReason?: string
}

interface PreparedEpisodeQuality {
  input: EpisodeQualityInput
  renderTask: LongTask
  renderInput: EpisodeRenderInput
  archive: { mp4Path: string; sourceFingerprint: string }
  currentPlanFingerprint: string
  sourceFingerprint: string
  ffmpegPath: string
}

/** Creates an asynchronous, cancelable read-only QC run for one already-rendered local MP4. */
export async function startEpisodeQuality(repos: Repositories, input: EpisodeQualityInput) {
  const prepared = await prepareEpisodeQuality(repos, input)
  if ('error' in prepared) return { ok: false, error: prepared.error }
  const task = repos.longTask.createLongTask(repos.db, {
    kind: 'video',
    title: `分集媒体质检 · ${input.episodeId.slice(0, 8)}`,
    taskType: EPISODE_QUALITY_TASK_TYPE,
    projectId: input.projectId,
    adaptationProjectId: input.adaptationProjectId,
    episodeId: input.episodeId,
    input: { episodeQuality: input },
    output: {
      sourceFingerprint: prepared.sourceFingerprint,
      renderTaskId: input.renderTaskId,
      deliveryVersion: `render:${input.renderTaskId.slice(0, 8)}`,
    },
  })
  void runEpisodeQuality(repos, task.id, prepared)
  return { ok: true, longTaskId: task.id, task }
}

export async function retryEpisodeQuality(repos: Repositories, taskId: string) {
  const task = repos.longTask.getLongTask(repos.db, taskId)
  const input = qualityInputFromTask(task?.input)
  if (!task || task.taskType !== EPISODE_QUALITY_TASK_TYPE || !input) return { ok: false, error: '该任务不是可重试的媒体质检任务。', longTaskId: taskId, task }
  if (task.status === 'running') return { ok: false, error: '媒体质检正在运行。', longTaskId: taskId, task }
  return runEpisodeQuality(repos, taskId)
}

export async function runEpisodeQuality(repos: Repositories, taskId: string, supplied?: PreparedEpisodeQuality) {
  const task = repos.longTask.getLongTask(repos.db, taskId)
  const input = qualityInputFromTask(task?.input)
  if (!task || !input) return { ok: false, error: '媒体质检任务缺少可信输入。', longTaskId: taskId, task }
  const runtime = beginLongTaskRun('video', taskId)
  if (!runtime.ok) {
    const failed = repos.longTask.finishLongTask(repos.db, taskId, 'failed', { errorMessage: runtime.error })
    return { ok: false, error: runtime.error, longTaskId: taskId, task: failed }
  }
  repos.longTask.markLongTaskRunning(repos.db, taskId)
  try {
    const prepared = supplied ?? await prepareEpisodeQuality(repos, input)
    if ('error' in prepared) {
      const failed = repos.longTask.finishLongTask(repos.db, taskId, 'failed', { errorMessage: prepared.error })
      return { ok: false, error: prepared.error, longTaskId: taskId, task: failed }
    }
    const inspection = await inspectEpisodeMedia(prepared.ffmpegPath, prepared.archive.mp4Path, runtime.signal!)
    const shots = repos.shot.listShotsByEpisode(repos.db, input.episodeId)
    const continuity = analyzeVisualContinuity({
      shots,
      locks: repos.visualAsset.listShotVisualAssetLocksByProject(repos.db, input.projectId),
      versions: repos.visualAsset.listVisualAssetVersionsByProject(repos.db, input.projectId),
      stillCandidates: repos.shotStill.listShotStillCandidatesByProject(repos.db, input.projectId),
    }).issues
    const preflight = await preflightEpisodeRender(repos, prepared.renderInput)
    if (!preflight.plan || preflight.plan.sourceFingerprint !== prepared.archive.sourceFingerprint) {
      const message = '质检期间发现成片输入已变化；已拒绝把报告绑定到过期交付版本。请重新渲染后复检。'
      const failed = repos.longTask.finishLongTask(repos.db, taskId, 'failed', { errorMessage: message })
      return { ok: false, error: message, longTaskId: taskId, task: failed }
    }
    const report = analyzeEpisodeQuality({
      renderTaskId: prepared.renderTask.id,
      renderSourceFingerprint: prepared.archive.sourceFingerprint,
      currentPlanFingerprint: preflight.plan.sourceFingerprint,
      plan: preflight.plan,
      inspection,
      continuity,
    })
    const reportPath = `${dirname(prepared.archive.mp4Path)}/quality-report.json`
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
    const finished = repos.longTask.finishLongTask(repos.db, taskId, 'success', {
      output: { report, reportPath, sourceFingerprint: report.sourceFingerprint, renderTaskId: prepared.renderTask.id, deliveryVersion: report.deliveryVersion },
    })
    return { ok: true, longTaskId: taskId, task: finished }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const canceled = Boolean(runtime.signal?.aborted)
    const finished = repos.longTask.finishLongTask(repos.db, taskId, canceled ? 'canceled' : 'failed', { errorMessage: message })
    return { ok: false, error: message, longTaskId: taskId, task: finished }
  } finally {
    finishLongTaskRun(taskId)
  }
}

export async function listEpisodeQualityHistory(repos: Repositories, input: Omit<EpisodeQualityInput, 'renderTaskId'>): Promise<EpisodeQualityHistoryItem[]> {
  const tasks = repos.longTask.listLongTasksByProject(repos.db, input.projectId)
    .filter((task) => task.taskType === EPISODE_QUALITY_TASK_TYPE && task.episodeId === input.episodeId)
  const latestRender = repos.longTask.listLongTasksByProject(repos.db, input.projectId)
    .find((task) => task.taskType === EPISODE_RENDER_TASK_TYPE && task.episodeId === input.episodeId && task.status === 'success')
  return Promise.all(tasks.map(async (task) => {
    const report = qualityReportFromTask(task.output)
    const taskInput = qualityInputFromTask(task.input)
    const result = taskInput ? await currentQualityFreshness(repos, taskInput, report, latestRender?.id) : { stale: true, staleReason: '质检任务缺少可复算输入。' }
    return { task, report, reportPath: reportPathFromTask(task.output), ...result }
  }))
}

/** Records a reviewable list of only blocker targets; it never replaces media or submits a provider job. */
export async function createEpisodeMinimalRedoPlan(repos: Repositories, input: { projectId: string; adaptationProjectId: string; episodeId: string; qualityTaskId: string }) {
  const qualityTask = repos.longTask.getLongTask(repos.db, input.qualityTaskId)
  const report = qualityReportFromTask(qualityTask?.output)
  const qualityInput = qualityInputFromTask(qualityTask?.input)
  if (!qualityTask || qualityTask.taskType !== EPISODE_QUALITY_TASK_TYPE || qualityTask.status !== 'success' || !report || !qualityInput
    || qualityTask.projectId !== input.projectId || qualityTask.adaptationProjectId !== input.adaptationProjectId || qualityTask.episodeId !== input.episodeId) {
    return { ok: false, error: '请选择一份已完成的媒体质检报告。' }
  }
  const freshness = await currentQualityFreshness(repos, qualityInput, report)
  if (freshness.stale) return { ok: false, error: `${freshness.staleReason} 不能从过期报告创建返工清单。` }
  if (!report.redoTargets.length) return { ok: false, error: '该报告没有 blocker，不需要创建返工清单。' }
  const task = repos.longTask.createLongTask(repos.db, {
    kind: 'batch',
    status: 'success',
    title: `最小返工清单 · ${input.episodeId.slice(0, 8)}`,
    taskType: EPISODE_MINIMAL_REDO_TASK_TYPE,
    projectId: input.projectId,
    adaptationProjectId: input.adaptationProjectId,
    episodeId: input.episodeId,
    input: { qualityTaskId: qualityTask.id, renderTaskId: report.renderTaskId, sourceFingerprint: report.sourceFingerprint },
    output: { targets: report.redoTargets, reportPath: reportPathFromTask(qualityTask.output), qualityTaskId: qualityTask.id },
  })
  return { ok: true, task }
}

async function prepareEpisodeQuality(repos: Repositories, input: EpisodeQualityInput): Promise<PreparedEpisodeQuality | { error: string }> {
  const renderTask = repos.longTask.getLongTask(repos.db, input.renderTaskId)
  const archive = renderArchiveFromTask(renderTask?.output)
  const renderInput = renderInputFromTask(renderTask?.input)
  if (!renderTask || renderTask.taskType !== EPISODE_RENDER_TASK_TYPE || renderTask.status !== 'success' || !archive || !renderInput) {
    return { error: '请选择一份成功归档、可追溯的 MP4 渲染任务后再执行媒体质检。' }
  }
  if (renderTask.projectId !== input.projectId || renderTask.adaptationProjectId !== input.adaptationProjectId || renderTask.episodeId !== input.episodeId) {
    return { error: '渲染任务不属于当前项目、改编项目或分集。' }
  }
  const preflight = await preflightEpisodeRender(repos, renderInput)
  if (!preflight.plan) return { error: '无法重新计算该成片的输入谱系。' }
  if (preflight.plan.sourceFingerprint !== archive.sourceFingerprint) return { error: '该成片已过期：镜头、媒体、音轨、字幕或权利记录已变化，请重新渲染后复检。' }
  const ffmpegPath = await discoverEpisodeFfmpeg()
  if (!ffmpegPath) return { error: '未找到受控 FFmpeg 运行时，无法执行媒体质检。' }
  return {
    input,
    renderTask,
    renderInput,
    archive,
    currentPlanFingerprint: preflight.plan.sourceFingerprint,
    sourceFingerprint: buildEpisodeQualitySourceFingerprint({ renderTaskId: renderTask.id, renderSourceFingerprint: archive.sourceFingerprint, currentPlanFingerprint: preflight.plan.sourceFingerprint }),
    ffmpegPath,
  }
}

async function currentQualityFreshness(repos: Repositories, input: EpisodeQualityInput, report?: EpisodeQualityReport, latestRenderTaskId?: string): Promise<{ stale: boolean; staleReason?: string }> {
  if (!report) return { stale: true, staleReason: '质检任务未保存可审阅报告。' }
  const latestRender = latestRenderTaskId ?? repos.longTask.listLongTasksByProject(repos.db, input.projectId)
    .find((task) => task.taskType === EPISODE_RENDER_TASK_TYPE && task.episodeId === input.episodeId && task.status === 'success')?.id
  if (latestRender && latestRender !== input.renderTaskId) return { stale: true, staleReason: '已有更新的成片渲染；旧媒体质检报告不能继续用于交付。' }
  const prepared = await prepareEpisodeQuality(repos, input)
  if ('error' in prepared) return { stale: true, staleReason: prepared.error }
  const fingerprint = buildEpisodeQualitySourceFingerprint({ renderTaskId: prepared.renderTask.id, renderSourceFingerprint: prepared.archive.sourceFingerprint, currentPlanFingerprint: prepared.currentPlanFingerprint })
  return fingerprint === report.sourceFingerprint
    ? { stale: false }
    : { stale: true, staleReason: '成片输入或时间线版本已变化；请重新执行媒体质检。' }
}

export async function inspectEpisodeMedia(ffmpegPath: string, filePath: string, signal: AbortSignal): Promise<EpisodeMediaInspection> {
  const metadata = await runFfmpegCapture(ffmpegPath, ['-i', filePath, '-f', 'null', '-'], signal)
  const durationSeconds = numberMatch(metadata.stderr, /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  const dimensions = metadata.stderr.match(/Video:.*?(\d{2,5})x(\d{2,5})/)
  const hasVideo = /Stream #\d+:\d+(?:\([^)]*\))?: Video:/.test(metadata.stderr)
  const hasAudio = /Stream #\d+:\d+(?:\([^)]*\))?: Audio:/.test(metadata.stderr)
  const decode = await runFfmpegCapture(ffmpegPath, ['-v', 'error', '-i', filePath, '-f', 'null', '-'], signal)
  const inspection: EpisodeMediaInspection = {
    readable: decode.code === 0 && metadata.code === 0,
    durationSeconds,
    width: dimensions ? Number(dimensions[1]) : undefined,
    height: dimensions ? Number(dimensions[2]) : undefined,
    hasVideo,
    hasAudio,
    readErrors: decode.code === 0 ? [] : compactLines(decode.stderr),
  }
  if (!hasVideo || metadata.code !== 0) return inspection
  const [black, frozen] = await Promise.all([
    runFfmpegCapture(ffmpegPath, ['-i', filePath, '-map', '0:v:0', '-vf', 'blackdetect=d=0.10:pic_th=0.98:pix_th=0.10', '-an', '-f', 'null', '-'], signal),
    runFfmpegCapture(ffmpegPath, ['-i', filePath, '-map', '0:v:0', '-vf', 'freezedetect=n=0.003:d=0.50', '-an', '-f', 'null', '-'], signal),
  ])
  inspection.blackIntervals = parseIntervals(black.stderr, 'black')
  inspection.frozenIntervals = parseIntervals(frozen.stderr, 'freeze')
  if (!hasAudio) return inspection
  const [silence, ebur128, volume] = await Promise.all([
    runFfmpegCapture(ffmpegPath, ['-i', filePath, '-map', '0:a:0', '-af', 'silencedetect=n=-50dB:d=0.50', '-f', 'null', '-'], signal),
    runFfmpegCapture(ffmpegPath, ['-i', filePath, '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'], signal),
    runFfmpegCapture(ffmpegPath, ['-i', filePath, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-'], signal),
  ])
  inspection.silenceIntervals = parseIntervals(silence.stderr, 'silence')
  inspection.integratedLufs = finalNumberMatch(ebur128.stderr, /\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)
  inspection.maxVolumeDb = finalNumberMatch(volume.stderr, /max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/g)
  return inspection
}

async function runFfmpegCapture(command: string, args: string[], signal: AbortSignal): Promise<{ code: number | null; stderr: string }> {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('媒体质检已取消')
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['-hide_banner', ...args], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    let stderr = ''
    const onAbort = () => child.kill('SIGTERM')
    signal.addEventListener('abort', onAbort, { once: true })
    child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-128_000) })
    child.on('error', (error) => { signal.removeEventListener('abort', onAbort); reject(error) })
    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort)
      if (signal.aborted) return reject(signal.reason instanceof Error ? signal.reason : new Error('媒体质检已取消'))
      resolve({ code, stderr })
    })
  })
}

function parseIntervals(value: string, kind: 'black' | 'freeze' | 'silence') {
  const startLabel = `${kind}_start`
  const endLabel = `${kind}_end`
  const durationLabel = `${kind}_duration`
  const startPattern = new RegExp(`${startLabel}:\\s*(-?\\d+(?:\\.\\d+)?)`, 'g')
  const endPattern = new RegExp(`${endLabel}:\\s*(-?\\d+(?:\\.\\d+)?)`, 'g')
  const durationPattern = new RegExp(`${durationLabel}:\\s*(-?\\d+(?:\\.\\d+)?)`, 'g')
  const starts = allNumbers(value, startPattern)
  const ends = allNumbers(value, endPattern)
  const durations = allNumbers(value, durationPattern)
  return starts.map((start, index) => ({ startSeconds: start, endSeconds: ends[index] ?? start + (durations[index] ?? 0) })).filter((item) => item.endSeconds > item.startSeconds)
}

function allNumbers(value: string, pattern: RegExp): number[] {
  return [...value.matchAll(pattern)].map((match) => Number(match[1])).filter(Number.isFinite)
}

function numberMatch(value: string, pattern: RegExp): number | undefined {
  const match = value.match(pattern)
  if (!match) return undefined
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
  return Number.isFinite(seconds) ? seconds : undefined
}

function finalNumberMatch(value: string, pattern: RegExp): number | undefined {
  const values = [...value.matchAll(pattern)].map((match) => Number(match[1])).filter(Number.isFinite)
  return values.at(-1)
}

function compactLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-12)
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

function qualityInputFromTask(value: Record<string, unknown> | undefined): EpisodeQualityInput | undefined {
  const candidate = value?.episodeQuality
  if (!candidate || typeof candidate !== 'object') return undefined
  const record = candidate as Record<string, unknown>
  return typeof record.projectId === 'string' && typeof record.adaptationProjectId === 'string' && typeof record.episodeId === 'string' && typeof record.renderTaskId === 'string'
    ? { projectId: record.projectId, adaptationProjectId: record.adaptationProjectId, episodeId: record.episodeId, renderTaskId: record.renderTaskId }
    : undefined
}

function qualityReportFromTask(value: Record<string, unknown> | undefined): EpisodeQualityReport | undefined {
  const report = value?.report
  return report && typeof report === 'object' && (report as { schemaVersion?: unknown }).schemaVersion === 1 ? report as EpisodeQualityReport : undefined
}

function reportPathFromTask(value: Record<string, unknown> | undefined): string | undefined {
  return typeof value?.reportPath === 'string' ? value.reportPath : undefined
}
