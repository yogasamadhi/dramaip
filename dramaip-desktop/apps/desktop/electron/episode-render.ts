import { app } from 'electron'
import { spawn } from 'node:child_process'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import bundledFfmpegPath from 'ffmpeg-static'
import {
  buildEpisodeRenderPlan,
  initializeAnimaticClips,
  type AudioClip,
  type EpisodeRenderArchive,
  type EpisodeRenderPlan,
  type EpisodeRenderPreflight,
  type LongTask,
  type ProjectAsset,
} from '@sdns/core'
import type { Repositories } from '@sdns/db'
import { beginLongTaskRun, finishLongTaskRun } from './task-runtime'

export const EPISODE_RENDER_TASK_TYPE = 'render_episode_mp4'
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus'])

export interface EpisodeRenderInput {
  projectId: string
  adaptationProjectId: string
  episodeId: string
  /** A mute is an explicit render decision recorded in the task input and manifest lineage. */
  mutedTrackIds?: string[]
}

export interface EpisodeRenderHistoryItem {
  task: LongTask
  stale: boolean
  staleReason?: string
}

export interface EpisodeRenderAudioSource {
  trackKind: 'dialogue' | 'narration' | 'bgm' | 'sfx'
  clip: AudioClip
  asset: ProjectAsset
}

interface PreparedEpisodeRender {
  preflight: EpisodeRenderPreflight
  audioClips: EpisodeRenderAudioSource[]
}

export async function preflightEpisodeRender(repos: Repositories, input: EpisodeRenderInput): Promise<EpisodeRenderPreflight> {
  return (await prepareEpisodeRender(repos, input, { checkFfmpeg: true })).preflight
}

/** Historical renders stay viewable, but are never silently presented as current after an input changes. */
export async function listEpisodeRenderHistory(repos: Repositories, input: EpisodeRenderInput): Promise<EpisodeRenderHistoryItem[]> {
  const tasks = repos.longTask.listLongTasksByProject(repos.db, input.projectId)
    .filter((task) => task.taskType === EPISODE_RENDER_TASK_TYPE && task.episodeId === input.episodeId)
  const plans = new Map<string, EpisodeRenderPlan | undefined>()
  for (const task of tasks) {
    const taskInput = episodeRenderInputFromTask(task.input) ?? input
    const key = (taskInput.mutedTrackIds ?? []).slice().sort().join(',')
    if (!plans.has(key)) plans.set(key, (await prepareEpisodeRender(repos, taskInput, { checkFfmpeg: false })).preflight.plan)
  }
  return tasks.map((task) => {
      const taskInput = episodeRenderInputFromTask(task.input) ?? input
      const currentFingerprint = plans.get((taskInput.mutedTrackIds ?? []).slice().sort().join(','))?.sourceFingerprint
      const renderedFingerprint = sourceFingerprintFromTask(task.output)
      const stale = Boolean(currentFingerprint && renderedFingerprint && currentFingerprint !== renderedFingerprint)
      return {
        task,
        stale,
        staleReason: stale ? '镜头、Animatic、媒体资产、音轨、静音选择或权利记录已变化；请重新预检并渲染新版本。' : undefined,
      }
    })
}

/**
 * Runs one local-only delivery job. All source paths come from the project
 * ledger, never from the renderer. A process restart leaves the persisted task
 * retryable rather than silently rerunning it.
 */
export async function startEpisodeRender(repos: Repositories, input: EpisodeRenderInput) {
  const prepared = await prepareEpisodeRender(repos, input, { checkFfmpeg: true })
  if (!prepared.preflight.ok) {
    return { ok: false, error: prepared.preflight.blockers.join('；') || '交付预检未通过。' }
  }
  const task = repos.longTask.createLongTask(repos.db, {
    kind: 'video',
    title: `分集 MP4 渲染 · ${input.episodeId.slice(0, 8)}`,
    taskType: EPISODE_RENDER_TASK_TYPE,
    projectId: input.projectId,
    adaptationProjectId: input.adaptationProjectId,
    episodeId: input.episodeId,
    input: { episodeRender: input },
    output: preflightOutput(prepared.preflight),
  })
  // Keep IPC responsive: the persisted task becomes immediately cancelable and
  // restart-safe while FFmpeg runs in a child process.
  void runEpisodeRender(repos, task.id, prepared)
  return { ok: true, longTaskId: task.id, task }
}

export async function retryEpisodeRender(repos: Repositories, taskId: string) {
  const task = repos.longTask.getLongTask(repos.db, taskId)
  const input = episodeRenderInputFromTask(task?.input)
  if (!task || task.taskType !== EPISODE_RENDER_TASK_TYPE || !input) {
    return { ok: false, error: '该任务不是可重试的分集 MP4 渲染任务。', longTaskId: taskId, task }
  }
  if (task.status === 'running') return { ok: false, error: '渲染任务正在运行。', longTaskId: taskId, task }
  return runEpisodeRender(repos, taskId)
}

export async function runEpisodeRender(repos: Repositories, taskId: string, prepared?: PreparedEpisodeRender) {
  const task = repos.longTask.getLongTask(repos.db, taskId)
  const input = episodeRenderInputFromTask(task?.input)
  if (!task || !input) return { ok: false, error: '渲染任务缺少可信输入。', longTaskId: taskId, task }
  const runtime = beginLongTaskRun('video', taskId)
  if (!runtime.ok) {
    const failed = repos.longTask.finishLongTask(repos.db, taskId, 'failed', { errorMessage: runtime.error })
    return { ok: false, error: runtime.error, longTaskId: taskId, task: failed }
  }

  repos.longTask.markLongTaskRunning(repos.db, taskId)
  try {
    const current = prepared ?? await prepareEpisodeRender(repos, input, { checkFfmpeg: true })
    if (!current.preflight.ok || !current.preflight.plan || !current.preflight.ffmpegPath) {
      const message = current.preflight.blockers.join('；') || '交付预检未通过。'
      const failed = repos.longTask.finishLongTask(repos.db, taskId, 'failed', {
        errorMessage: message,
        output: preflightOutput(current.preflight),
      })
      return { ok: false, error: message, longTaskId: taskId, task: failed }
    }
    const archive = await renderEpisodeFiles({
      ffmpegPath: current.preflight.ffmpegPath,
      projectId: input.projectId,
      taskId,
      plan: current.preflight.plan,
      audioClips: current.audioClips,
      signal: runtime.signal!,
    })
    const finished = repos.longTask.finishLongTask(repos.db, taskId, 'success', {
      errorMessage: undefined,
      output: { ...preflightOutput(current.preflight), archive },
    })
    return { ok: true, longTaskId: taskId, task: finished, archive }
  } catch (error) {
    const canceled = Boolean(runtime.signal?.aborted)
    const message = canceled ? '渲染已取消；已保留当前任务记录，可在修正素材后重试。' : errorMessage(error)
    const finished = repos.longTask.finishLongTask(repos.db, taskId, canceled ? 'canceled' : 'failed', { errorMessage: message })
    return { ok: false, error: message, longTaskId: taskId, task: finished }
  } finally {
    finishLongTaskRun(taskId)
  }
}

async function prepareEpisodeRender(repos: Repositories, input: EpisodeRenderInput, options: { checkFfmpeg: boolean }): Promise<PreparedEpisodeRender> {
  const blockers: string[] = []
  const warnings: string[] = []
  const episode = repos.episode.getEpisode(repos.db, input.episodeId)
  const adaptation = episode ? repos.adaptationProject.getAdaptationProject(repos.db, episode.adaptationProjectId) : undefined
  if (!episode || !adaptation || adaptation.id !== input.adaptationProjectId || adaptation.sourceProjectId !== input.projectId) {
    return { preflight: { ok: false, blockers: ['分集不属于当前项目或改编项目。'], warnings }, audioClips: [] }
  }
  const script = repos.script.getScriptByEpisode(repos.db, input.episodeId)
  const shots = script ? repos.scene.listScenesByScript(repos.db, script.id).flatMap((scene) => repos.shot.listShotsByScene(repos.db, scene.id)) : []
  const currentFingerprint = initializeAnimaticClips(shots, []).sourceFingerprint
  const animatic = repos.animatic.listAnimaticDraftsByEpisode(repos.db, input.episodeId).find((draft) => draft.status === 'approved')
  if (!animatic) return { preflight: { ok: false, blockers: ['请先通过一版 Animatic，再创建最终交付。'], warnings }, audioClips: [] }
  if (animatic.sourceFingerprint !== currentFingerprint) blockers.push('Animatic 已过期：镜头、对白、旁白或时长有更新，请重新审核并另存版本。')
  if (!animatic.clips.length) blockers.push('Animatic 没有镜头片段，无法渲染。')

  const assets = repos.asset.listProjectAssets(repos.db, input.projectId)
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]))
  const mutedTrackIds = new Set(input.mutedTrackIds ?? [])
  const audioTracks = repos.audio.listAudioTracksByEpisode(repos.db, input.episodeId)
  const selectedAudioTracks = audioTracks.filter((track) => !mutedTrackIds.has(track.id))
  const plan = buildEpisodeRenderPlan({
    animatic,
    shots,
    audioTracks: selectedAudioTracks,
    resolveVisualSource: ({ shotId, assetId, stillCandidateId }) => resolveVisualSource(repos, assetsById, shotId, assetId, stillCandidateId),
  })
  const audioClips = resolveAudioClips(plan, assetsById, blockers)
  const inputAssets = [
    ...plan.visualClips.flatMap((clip) => clip.source.sourceId ? [assetsById.get(clip.source.sourceId)] : []),
    ...audioClips.map((item) => item.asset),
  ].filter((asset): asset is ProjectAsset => Boolean(asset))
  if (inputAssets.length) plan.sourceFingerprint = `${plan.sourceFingerprint}|assets:${inputAssets.map((asset) => `${asset.id}@${asset.updatedAt}`).sort().join(',')}`
  if (mutedTrackIds.size) plan.sourceFingerprint = `${plan.sourceFingerprint}|muted:${[...mutedTrackIds].sort().join(',')}`
  if (!plan.subtitles.length) blockers.push('没有可用字幕草稿；请为镜头补充字幕、对白或旁白。')
  for (const visual of plan.visualClips) {
    if (visual.source.kind === 'missing' || !visual.source.localPath || !visual.source.sourceId) {
      blockers.push(`镜头 ${visual.orderIndex + 1} 没有已归档的本地视频或已采用静帧。`)
      continue
    }
    const asset = assetsById.get(visual.source.sourceId)
    if (!asset) blockers.push(`镜头 ${visual.orderIndex + 1} 的媒体未进入项目资产台账，不能最终交付。`)
    else if (!isVisualAsset(asset, visual.source.kind)) blockers.push(`镜头 ${visual.orderIndex + 1} 的资产类型与时间线不匹配。`)
    else await assertReadableRenderFile(visual.source.localPath, visual.source.kind === 'video' ? VIDEO_EXTENSIONS : IMAGE_EXTENSIONS, `镜头 ${visual.orderIndex + 1}`, blockers)
  }

  if (!audioClips.length) blockers.push('最终交付至少需要一段已采用、已归档的对白、旁白、BGM 或音效。')
  for (const item of audioClips) await assertReadableRenderFile(item.asset.localPath, AUDIO_EXTENSIONS, `音频“${item.asset.title}”`, blockers)
  if (selectedAudioTracks.some((track) => track.status === 'stale')) blockers.push('存在过期音轨；请从当前分集重新另存并采用对应版本。')
  if (plan.audioTracks.some((track) => track.sourceFingerprint !== currentFingerprint)) blockers.push('已采用音轨与当前镜头版本不一致。')

  const rights = repos.rights.preflightProjectRights(repos.db, { projectId: input.projectId })
  const rightsFingerprint = repos.rights.listAssetRightsByProject(repos.db, input.projectId)
    .map((record) => `${record.assetId}:${record.status}@${record.updatedAt}`)
    .sort()
    .join(',')
  plan.sourceFingerprint = `${plan.sourceFingerprint}|rights:${rightsFingerprint || 'none'}`
  if (rights.status === 'blocked') blockers.push(`权利预检未通过：${rights.blockers.length} 项；请在权利台账完成核验后交付。`)
  if (rights.warnings.length) warnings.push(`权利台账有 ${rights.warnings.length} 项信息待补全。`)
  if (plan.visualClips.some((clip) => clip.source.kind === 'still')) warnings.push('本次含静帧合成段；这是明确标注的静帧镜头，不是自动占位符。')

  let ffmpegPath: string | undefined
  if (options.checkFfmpeg) {
    ffmpegPath = await discoverEpisodeFfmpeg()
    if (!ffmpegPath) blockers.push('未找到可用 FFmpeg。请安装 FFmpeg，或由桌面应用包提供受控运行时后再导出 MP4。')
  }
  if (mutedTrackIds.size) warnings.push(`已静音 ${mutedTrackIds.size} 条音轨；该选择会写入本次渲染谱系。`)
  return { preflight: { ok: blockers.length === 0, plan, blockers: unique(blockers), warnings: unique(warnings), ffmpegPath }, audioClips }
}

function resolveVisualSource(repos: Repositories, assetsById: Map<string, ProjectAsset>, shotId: string, assetId?: string, stillCandidateId?: string) {
  const result = repos.videoResult.listVideoResultsByShot(repos.db, shotId)
    .filter((item) => Boolean(item.localVideoPath))
    .sort((left, right) => Number(right.isBest) - Number(left.isBest) || right.createdAt.localeCompare(left.createdAt))[0]
  if (result?.localVideoPath) {
    const asset = repos.asset.listAssetsBySource(repos.db, 'video_result', result.id).find((item) => item.kind === 'video_result' && item.localPath === result.localVideoPath)
    return { kind: 'video' as const, sourceId: asset?.id, sourceVersion: asset?.updatedAt ?? result.createdAt, localPath: result.localVideoPath, label: asset?.title ?? `视频结果 ${result.id.slice(0, 8)}` }
  }
  const candidateAssetId = assetId ?? (stillCandidateId ? repos.shotStill.getShotStillCandidate(repos.db, stillCandidateId)?.assetId : undefined)
  const asset = candidateAssetId ? assetsById.get(candidateAssetId) : undefined
  if (asset?.localPath) return { kind: 'still' as const, sourceId: asset.id, sourceVersion: asset.updatedAt, localPath: asset.localPath, label: asset.title }
  return { kind: 'missing' as const }
}

function resolveAudioClips(plan: EpisodeRenderPlan, assetsById: Map<string, ProjectAsset>, blockers: string[]): EpisodeRenderAudioSource[] {
  const clips: EpisodeRenderAudioSource[] = []
  for (const track of plan.audioTracks) {
    for (const clip of track.clips) {
      if (!clip.assetId) {
        blockers.push(`音轨“${track.label}”包含未绑定本地音频资产的片段。`)
        continue
      }
      const asset = assetsById.get(clip.assetId)
      if (!asset?.localPath || !isAudioAsset(asset)) {
        blockers.push(`音轨“${track.label}”引用的音频资产不可用或类型不匹配。`)
        continue
      }
      clips.push({ trackKind: track.kind, clip, asset })
    }
  }
  return clips
}

function isVisualAsset(asset: ProjectAsset, kind: 'video' | 'still'): boolean {
  return kind === 'video' ? asset.kind === 'video_result' : ['first_frame_image', 'cover_image', 'scene_reference', 'style_reference'].includes(asset.kind)
}

function isAudioAsset(asset: ProjectAsset): boolean {
  return ['dialogue_audio', 'narration_audio', 'bgm_audio', 'sfx_audio'].includes(asset.kind)
}

async function assertReadableRenderFile(path: string | undefined, extensions: Set<string>, label: string, blockers: string[]): Promise<void> {
  if (!path) return
  const ext = extname(path).toLowerCase()
  if (!extensions.has(ext)) {
    blockers.push(`${label} 文件类型不支持：${ext || '未知'}。`)
    return
  }
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size <= 0) blockers.push(`${label} 本地文件缺失或为空。`)
  } catch {
    blockers.push(`${label} 本地文件不可读取。`)
  }
}

export async function renderEpisodeFiles(input: { ffmpegPath: string; projectId: string; taskId: string; plan: EpisodeRenderPlan; audioClips: EpisodeRenderAudioSource[]; signal: AbortSignal; directory?: string }): Promise<EpisodeRenderArchive> {
  const directory = input.directory ?? join(app.getPath('userData'), 'assets', 'projects', safeSegment(input.projectId), 'episode-deliveries', safeSegment(input.taskId))
  const segmentDirectory = join(directory, 'segments')
  await mkdir(segmentDirectory, { recursive: true })
  const srtPath = join(directory, 'subtitles.srt')
  const vttPath = join(directory, 'subtitles.vtt')
  const timelinePath = join(directory, 'timeline.mp4')
  const audioPath = join(directory, 'mix.m4a')
  const mp4Path = join(directory, 'episode.mp4')
  const manifestPath = join(directory, 'manifest.json')
  await Promise.all([writeFile(srtPath, input.plan.srt, 'utf8'), writeFile(vttPath, input.plan.vtt, 'utf8')])

  const segmentPaths: string[] = []
  for (const clip of input.plan.visualClips) {
    throwIfAborted(input.signal)
    const path = join(segmentDirectory, `${String(clip.orderIndex + 1).padStart(3, '0')}.mp4`)
    await renderVisualClip(input.ffmpegPath, clip, path, input.signal)
    segmentPaths.push(path)
  }
  const concatPath = join(directory, 'timeline.concat.txt')
  await writeFile(concatPath, segmentPaths.map((path) => `file '${path.replace(/'/g, "'\\\\''")}'`).join('\n') + '\n', 'utf8')
  await runFfmpeg(input.ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', concatPath, '-c', 'copy', '-an', timelinePath], input.signal)
  await renderAudioMix(input.ffmpegPath, input.audioClips, input.plan.durationSeconds, audioPath, input.signal)
  const subtitleFilter = `subtitles=filename='${escapeFilterPath(srtPath)}':force_style='FontName=Arial,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=150'`
  await runFfmpeg(input.ffmpegPath, ['-y', '-i', timelinePath, '-i', audioPath, '-map', '0:v:0', '-map', '1:a:0', '-vf', subtitleFilter, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-t', String(input.plan.durationSeconds), '-movflags', '+faststart', mp4Path], input.signal)
  const archive: EpisodeRenderArchive = { taskId: input.taskId, mp4Path, srtPath, vttPath, audioPath, manifestPath, sourceFingerprint: input.plan.sourceFingerprint, durationSeconds: input.plan.durationSeconds }
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(), delivery: archive, plan: {
    episodeId: input.plan.episodeId, animaticId: input.plan.animaticId, animaticVersionNumber: input.plan.animaticVersionNumber,
    durationSeconds: input.plan.durationSeconds, sourceFingerprint: input.plan.sourceFingerprint,
    visualClips: input.plan.visualClips.map((clip) => ({ ...clip, source: { kind: clip.source.kind, sourceId: clip.source.sourceId, sourceVersion: clip.source.sourceVersion, label: clip.source.label } })),
    audioTracks: input.plan.audioTracks.map((track) => ({ id: track.id, kind: track.kind, versionNumber: track.versionNumber, label: track.label, sourceFingerprint: track.sourceFingerprint })),
    subtitleCount: input.plan.subtitles.length,
  } }, null, 2), 'utf8')
  return archive
}

async function renderVisualClip(ffmpegPath: string, clip: EpisodeRenderPlan['visualClips'][number], target: string, signal: AbortSignal): Promise<void> {
  const filter = visualFilter(clip)
  const common = ['-t', String(clip.durationSeconds), '-vf', filter, '-r', '30', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', target]
  if (clip.source.kind === 'still') {
    await runFfmpeg(ffmpegPath, ['-y', '-loop', '1', '-framerate', '30', '-i', clip.source.localPath!, ...common], signal)
    return
  }
  await runFfmpeg(ffmpegPath, ['-y', '-stream_loop', '-1', '-i', clip.source.localPath!, ...common], signal)
}

function visualFilter(clip: EpisodeRenderPlan['visualClips'][number]): string {
  const cropX = Math.min(1, Math.max(0, 0.5 + clip.crop.x / 200)).toFixed(3)
  const cropY = Math.min(1, Math.max(0, 0.5 + clip.crop.y / 200)).toFixed(3)
  const zoom = clip.crop.zoom.toFixed(3)
  const filters = [`scale=720*${zoom}:1280*${zoom}:force_original_aspect_ratio=increase`, `crop=720:1280:(in_w-out_w)*${cropX}:(in_h-out_h)*${cropY}`, 'setsar=1', 'fps=30']
  if (clip.transition === 'fade' && clip.durationSeconds >= 0.7) {
    filters.push('fade=t=in:st=0:d=0.2', `fade=t=out:st=${Math.max(0, clip.durationSeconds - 0.2).toFixed(3)}:d=0.2`)
  }
  return filters.join(',')
}

async function renderAudioMix(ffmpegPath: string, clips: EpisodeRenderAudioSource[], durationSeconds: number, target: string, signal: AbortSignal): Promise<void> {
  const args = ['-y']
  for (const item of clips) {
    if (item.clip.loop) args.push('-stream_loop', '-1')
    args.push('-i', item.asset.localPath!)
  }
  const filters: string[] = []
  const labels: Record<EpisodeRenderAudioSource['trackKind'], string[]> = { dialogue: [], narration: [], bgm: [], sfx: [] }
  clips.forEach((item, index) => {
    const duration = item.clip.durationSeconds && item.clip.durationSeconds > 0 ? item.clip.durationSeconds : durationSeconds - item.clip.startSeconds
    const fadeIn = Math.max(0, Math.min(duration / 2, item.clip.fadeInSeconds || 0))
    const fadeOut = Math.max(0, Math.min(duration / 2, item.clip.fadeOutSeconds || 0))
    const parts = [`atrim=duration=${round(duration)}`, 'asetpts=PTS-STARTPTS', `volume=${round(Math.max(0, Math.min(2, item.clip.volume)))}`]
    if (fadeIn) parts.push(`afade=t=in:st=0:d=${round(fadeIn)}`)
    if (fadeOut) parts.push(`afade=t=out:st=${round(Math.max(0, duration - fadeOut))}:d=${round(fadeOut)}`)
    parts.push(`adelay=${Math.max(0, Math.round(item.clip.startSeconds * 1000))}:all=1`)
    const label = `a${index}`
    filters.push(`[${index}:a]${parts.join(',')}[${label}]`)
    labels[item.trackKind].push(label)
  })
  const voice = [...labels.dialogue, ...labels.narration]
  const sound = labels.sfx
  const bgm = labels.bgm
  const mixedVoice = mixFilter(filters, voice, 'voice')
  const mixedBgm = mixFilter(filters, bgm, 'bgm')
  const mixedSfx = mixFilter(filters, sound, 'sfx')
  const finalInputs: string[] = []
  if (mixedVoice && mixedBgm) {
    filters.push(`[${mixedBgm}][${mixedVoice}]sidechaincompress=threshold=0.04:ratio=8:attack=20:release=400[ducked]`)
    finalInputs.push(mixedVoice, 'ducked')
  } else {
    if (mixedVoice) finalInputs.push(mixedVoice)
    if (mixedBgm) finalInputs.push(mixedBgm)
  }
  if (mixedSfx) finalInputs.push(mixedSfx)
  const mix = mixFilter(filters, finalInputs, 'mix')
  if (!mix) throw new Error('没有可混音的实际音频片段。')
  filters.push(`[${mix}]loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.95,atrim=duration=${round(durationSeconds)}[outa]`)
  await runFfmpeg(ffmpegPath, [...args, '-filter_complex', filters.join(';'), '-map', '[outa]', '-c:a', 'aac', '-b:a', '192k', '-t', String(durationSeconds), target], signal)
}

function mixFilter(filters: string[], labels: string[], output: string): string | undefined {
  if (!labels.length) return undefined
  if (labels.length === 1) {
    filters.push(`[${labels[0]}]anull[${output}]`)
    return output
  }
  filters.push(`${labels.map((label) => `[${label}]`).join('')}amix=inputs=${labels.length}:normalize=0[${output}]`)
  return output
}

/** Shared by local delivery and the read-only media QC worker. */
export async function discoverEpisodeFfmpeg(): Promise<string | undefined> {
  const candidates = unique([
    process.env.SDNS_FFMPEG_PATH,
    process.resourcesPath ? join(process.resourcesPath, 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg') : undefined,
    bundledFfmpegPath ? unpackedAsarPath(bundledFfmpegPath) : undefined,
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    'ffmpeg',
  ].filter((value): value is string => Boolean(value)))
  for (const candidate of candidates) {
    try {
      await runProcess(candidate, ['-hide_banner', '-version'])
      return candidate
    } catch {
      // Continue through explicit bundled and PATH candidates. No renderer path is accepted here.
    }
  }
  return undefined
}

async function runFfmpeg(command: string, args: string[], signal: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  await runProcess(command, ['-hide_banner', ...args], signal)
}

async function runProcess(command: string, args: string[], signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    let stderr = ''
    const onAbort = () => child.kill('SIGTERM')
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-16_000) })
    child.on('error', (error) => { signal?.removeEventListener('abort', onAbort); reject(error) })
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) return reject(signal.reason instanceof Error ? signal.reason : new Error('渲染已取消'))
      if (code === 0) return resolve()
      reject(new Error(`FFmpeg 退出码 ${code ?? '未知'}：${stderr.trim().slice(-2_000)}`))
    })
  })
}

function episodeRenderInputFromTask(value: Record<string, unknown> | undefined): EpisodeRenderInput | undefined {
  const candidate = value?.episodeRender
  if (!candidate || typeof candidate !== 'object') return undefined
  const record = candidate as Record<string, unknown>
  if (typeof record.projectId !== 'string' || typeof record.adaptationProjectId !== 'string' || typeof record.episodeId !== 'string') return undefined
  const mutedTrackIds = Array.isArray(record.mutedTrackIds) && record.mutedTrackIds.every((id) => typeof id === 'string') ? record.mutedTrackIds as string[] : undefined
  return { projectId: record.projectId, adaptationProjectId: record.adaptationProjectId, episodeId: record.episodeId, mutedTrackIds }
}

function sourceFingerprintFromTask(output: Record<string, unknown> | undefined): string | undefined {
  const preflight = output?.preflight
  if (!preflight || typeof preflight !== 'object') return undefined
  const value = (preflight as Record<string, unknown>).sourceFingerprint
  return typeof value === 'string' ? value : undefined
}

function preflightOutput(preflight: EpisodeRenderPreflight): Record<string, unknown> {
  return { preflight: { ok: preflight.ok, blockers: preflight.blockers, warnings: preflight.warnings, ffmpegPath: preflight.ffmpegPath, sourceFingerprint: preflight.plan?.sourceFingerprint, durationSeconds: preflight.plan?.durationSeconds, animaticId: preflight.plan?.animaticId, animaticVersionNumber: preflight.plan?.animaticVersionNumber, subtitleCount: preflight.plan?.subtitles.length } }
}

function escapeFilterPath(path: string): string { return path.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'") }
/** Node resolves package files through app.asar; child_process needs the unpacked executable. */
function unpackedAsarPath(path: string): string { return path.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2') }
function safeSegment(value: string): string { return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96) || 'unknown' }
function round(value: number): string { return (Math.round(Math.max(0, value) * 1000) / 1000).toString() }
function unique<T>(values: T[]): T[] { return [...new Set(values)] }
function throwIfAborted(signal: AbortSignal): void { if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('渲染已取消') }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
