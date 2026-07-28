import { app, BrowserWindow, dialog } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { spawn } from 'node:child_process'
import type {
  EditorTimelineClip,
  EditorTimelineManifest,
  ProjectAsset,
  ReviewDecision,
  ReviewPackageManifest,
} from '@sdns/core'
import type { Repositories } from '@sdns/db'
import {
  preflightEditorTimeline,
  renderCmx3600Edl,
  renderEditorMediaCsv,
  renderFcpxml110,
  renderOfflineReviewHtml,
  renderSrt,
  validateReviewPackageManifest,
  type EditorExportPreflight,
} from '@sdns/export'
import { discoverEpisodeFfmpeg } from './episode-render'

const MAX_REVIEW_PACKAGE_BYTES = 512 * 1024 * 1024
const requireModule = createRequire(import.meta.url)
const createArchive = requireModule('archiver') as (
  format: 'zip',
  options: { zlib: { level: number } },
) => import('archiver').Archiver

export interface TimelineScope {
  projectId: string
  adaptationProjectId: string
  episodeId: string
  frameRate?: 24 | 25 | 30
  width?: number
  height?: number
}

export interface OfflineReviewResult {
  saved: boolean
  canceled?: boolean
  path?: string
  packageId?: string
  error?: string
}

export interface EditorExportResult {
  saved: boolean
  canceled?: boolean
  directory?: string
  bundlePath?: string
  warnings?: Array<{ code: string; clipId?: string; message: string }>
  error?: string
}

export function buildEditorTimelineManifest(repos: Repositories, input: TimelineScope): EditorTimelineManifest {
  const adaptation = repos.adaptationProject.getAdaptationProject(repos.db, input.adaptationProjectId)
  const episode = repos.episode.getEpisode(repos.db, input.episodeId)
  if (!adaptation || adaptation.sourceProjectId !== input.projectId) throw new Error('改编项目不属于当前项目')
  if (!episode || episode.adaptationProjectId !== input.adaptationProjectId) throw new Error('分集不属于当前改编项目')
  const shots = repos.shot.listShotsByEpisode(repos.db, input.episodeId)
  const latestAnimatic = repos.animatic.listAnimaticDraftsByEpisode(repos.db, input.episodeId)[0]
  const animaticByShot = new Map(latestAnimatic?.clips.map((clip) => [clip.shotId, clip]) ?? [])
  let cursor = 0
  const clips: EditorTimelineClip[] = shots.map((shot, index) => {
    const animatic = animaticByShot.get(shot.id)
    const durationSeconds = Math.max(0.04, animatic?.durationSeconds ?? shot.durationSeconds ?? 3)
    const bestVideo = repos.videoResult.listVideoResultsByShot(repos.db, shot.id).find((result) => result.isBest)
      ?? repos.videoResult.listVideoResultsByShot(repos.db, shot.id).at(-1)
    const adoptedStill = repos.shotStill.listShotStillCandidates(repos.db, shot.id).find((candidate) => candidate.status === 'adopted')
    const stillAsset = adoptedStill ? repos.asset.getAsset(repos.db, adoptedStill.assetId) : undefined
    const animaticAsset = animatic?.assetId ? repos.asset.getAsset(repos.db, animatic.assetId) : undefined
    const sourcePath = bestVideo?.localVideoPath
      ?? localAssetPath(stillAsset)
      ?? localAssetPath(animaticAsset)
    const mediaKind: EditorTimelineClip['mediaKind'] = bestVideo?.localVideoPath
      ? 'video'
      : sourcePath
        ? 'still'
        : 'slate'
    const clip: EditorTimelineClip = {
      id: `clip-${String(index + 1).padStart(3, '0')}-${shot.id}`,
      shotId: shot.id,
      name: `镜头 ${shot.shotNumber}`,
      sourcePath,
      startSeconds: cursor,
      durationSeconds,
      sourceInSeconds: 0,
      sourceOutSeconds: durationSeconds,
      dialogue: shot.dialogue,
      narration: shot.narration,
      subtitle: shot.subtitleDraft || shot.dialogue || shot.narration,
      transition: animatic?.transition === 'fade' ? 'fade' : 'cut',
      mediaKind,
    }
    cursor += durationSeconds
    return clip
  })
  return {
    format: 'dramaip-editor-timeline',
    version: 1,
    projectId: input.projectId,
    adaptationProjectId: input.adaptationProjectId,
    episodeId: input.episodeId,
    title: `${adaptation.title} · 第 ${episode.episodeNumber} 集 ${episode.title}`,
    frameRate: input.frameRate ?? 25,
    width: input.width ?? 1080,
    height: input.height ?? 1920,
    clips,
    createdAt: new Date().toISOString(),
  }
}

export function preflightEditorExport(repos: Repositories, input: TimelineScope): {
  manifest: EditorTimelineManifest
  preflight: EditorExportPreflight
  openProductionBlockers: number
} {
  const manifest = buildEditorTimelineManifest(repos, input)
  const preflight = preflightEditorTimeline(manifest)
  const openProductionBlockers = repos.productionStudio.listProductionImpacts(repos.db, input.projectId)
    .filter((impact) => impact.severity === 'blocker' && ['open', 'accepted'].includes(impact.status)).length
  if (openProductionBlockers) {
    preflight.blockers.push(`存在 ${openProductionBlockers} 个未解决的关键生产影响`)
    preflight.canExport = false
  }
  return { manifest, preflight, openProductionBlockers }
}

export async function exportEditorPackage(repos: Repositories, input: TimelineScope): Promise<EditorExportResult> {
  const { manifest, preflight } = preflightEditorExport(repos, input)
  if (!preflight.canExport) return { saved: false, error: preflight.blockers.join('；') }
  const parent = BrowserWindow.getFocusedWindow() ?? undefined
  const selected = await dialog.showOpenDialog(parent!, {
    title: '选择剪辑交付包保存位置',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (selected.canceled || !selected.filePaths[0]) return { saved: false, canceled: true }
  const packageName = safeName(manifest.title)
  const directory = join(selected.filePaths[0], `${packageName}-editor-delivery`)
  const bundlePath = join(directory, `${packageName}.fcpxmld`)
  const mediaDirectory = join(directory, 'media')
  const report = renderCmx3600Edl(manifest)
  await mkdir(bundlePath, { recursive: true })
  await mkdir(mediaDirectory, { recursive: true })
  await Promise.all([
    writeFile(join(bundlePath, 'Info.fcpxml'), renderFcpxml110(manifest), 'utf8'),
    writeFile(join(directory, `${packageName}.edl`), report.content, 'utf8'),
    writeFile(join(directory, `${packageName}.srt`), renderSrt(manifest), 'utf8'),
    writeFile(join(directory, 'timeline-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    writeFile(join(directory, 'media-manifest.csv'), `${renderEditorMediaCsv(manifest)}\n`, 'utf8'),
    writeFile(join(directory, 'relink-guide.md'), renderRelinkGuide(manifest, report.warnings), 'utf8'),
  ])
  for (const clip of manifest.clips) {
    if (!clip.sourcePath) continue
    const target = join(mediaDirectory, basename(clip.sourcePath))
    try {
      await copyFile(clip.sourcePath, target)
    } catch {
      report.warnings.push({ code: 'missing_media', clipId: clip.id, message: `${clip.name} 的媒体复制失败，需要手动 relink。` })
    }
  }
  repos.productionStudio.recordProductAnalyticsEvent(repos.db, {
    eventName: 'editor_exported',
    appVersion: app.getVersion(),
    operatingSystem: process.platform,
  })
  return { saved: true, directory, bundlePath, warnings: report.warnings }
}

export async function exportOfflineReviewPackage(repos: Repositories, input: TimelineScope): Promise<OfflineReviewResult> {
  const manifest = buildEditorTimelineManifest(repos, input)
  if (!manifest.clips.length) return { saved: false, error: '当前分集没有可审镜头' }
  const parent = BrowserWindow.getFocusedWindow() ?? undefined
  const selected = await dialog.showSaveDialog(parent!, {
    defaultPath: `${safeName(manifest.title)}.dramaip-review.zip`,
    filters: [{ name: 'DramaIP 离线审片包', extensions: ['dramaip-review.zip', 'zip'] }],
  })
  if (selected.canceled || !selected.filePath) return { saved: false, canceled: true }
  const outputPath = selected.filePath.endsWith('.dramaip-review.zip') ? selected.filePath : `${selected.filePath}.dramaip-review.zip`
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'dramaip-review-'))
  const packageId = randomUUID()
  try {
    const mediaDirectory = join(temporaryDirectory, 'media')
    const thumbnailDirectory = join(temporaryDirectory, 'thumbnails')
    await Promise.all([mkdir(mediaDirectory, { recursive: true }), mkdir(thumbnailDirectory, { recursive: true })])
    const ffmpegPath = await discoverEpisodeFfmpeg()
    const media: ReviewPackageManifest['media'] = []
    for (const [index, clip] of manifest.clips.entries()) {
      const proxy = await createReviewProxy(ffmpegPath, clip, mediaDirectory, thumbnailDirectory, index)
      media.push({
        id: clip.id,
        shotId: clip.shotId,
        orderIndex: index,
        label: clip.name,
        relativePath: proxy.relativePath,
        mimeType: proxy.mimeType,
        durationSeconds: clip.durationSeconds,
        sha256: proxy.sha256,
        sizeBytes: proxy.sizeBytes,
      })
    }
    const reviewManifest: ReviewPackageManifest = {
      format: 'dramaip-review',
      version: 1,
      packageId,
      projectId: input.projectId,
      adaptationProjectId: input.adaptationProjectId,
      episodeId: input.episodeId,
      title: manifest.title,
      createdAt: new Date().toISOString(),
      media,
    }
    const issues = validateReviewPackageManifest(reviewManifest)
    if (issues.length) throw new Error(issues.join('；'))
    const packageBytes = media.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0)
    if (packageBytes > MAX_REVIEW_PACKAGE_BYTES) throw new Error('审片包代理超过 512 MB，请缩短分集或减少媒体')
    await Promise.all([
      writeFile(join(temporaryDirectory, 'manifest.json'), `${JSON.stringify(reviewManifest, null, 2)}\n`, 'utf8'),
      writeFile(join(temporaryDirectory, 'index.html'), renderOfflineReviewHtml(reviewManifest), 'utf8'),
      writeFile(join(temporaryDirectory, 'README.txt'), '双击 index.html 开始离线审片。完成后在页面中导出 review JSON，并交回 DramaIP 桌面端导入。\n', 'utf8'),
    ])
    await zipDirectory(temporaryDirectory, outputPath)
    repos.productionStudio.createReviewPackageRecord(repos.db, {
      projectId: input.projectId,
      adaptationProjectId: input.adaptationProjectId,
      episodeId: input.episodeId,
      kind: 'offline',
      status: 'exported',
      title: manifest.title,
      manifest: reviewManifest,
      outputPath,
    })
    repos.productionStudio.recordProductAnalyticsEvent(repos.db, {
      eventName: 'review_exported',
      appVersion: app.getVersion(),
      operatingSystem: process.platform,
    })
    return { saved: true, path: outputPath, packageId }
  } catch (error) {
    return { saved: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

export async function importOfflineReviewComments(repos: Repositories): Promise<{
  imported: boolean
  canceled?: boolean
  packageId?: string
  commentCount?: number
  decisionCount?: number
  error?: string
}> {
  const parent = BrowserWindow.getFocusedWindow() ?? undefined
  const selected = await dialog.showOpenDialog(parent!, {
    title: '导入离线审片意见',
    properties: ['openFile'],
    filters: [{ name: 'DramaIP review JSON', extensions: ['json'] }],
  })
  if (selected.canceled || !selected.filePaths[0]) return { imported: false, canceled: true }
  const filePath = selected.filePaths[0]
  const info = await stat(filePath)
  if (info.size > 10 * 1024 * 1024) return { imported: false, error: '审片意见文件超过 10 MB' }
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
    if (parsed.format !== 'dramaip-review-comments' || parsed.version !== 1 || typeof parsed.packageId !== 'string' || !Array.isArray(parsed.comments)) {
      throw new Error('审片意见格式无效')
    }
    const record = repos.productionStudio.getReviewPackageRecord(repos.db, parsed.packageId)
    if (!record) throw new Error('本机找不到对应的审片包，无法安全映射镜头')
    const shotIds = new Set(record.manifest.media.map((item) => item.shotId))
    let commentCount = 0
    let decisionCount = 0
    for (const value of parsed.comments) {
      const item = parseReviewEntry(value, shotIds)
      if (item.body) {
        repos.productionStudio.upsertReviewComment(repos.db, {
          id: item.id,
          packageId: parsed.packageId,
          shotId: item.shotId,
          timecodeSeconds: item.timecodeSeconds,
          authorAlias: item.authorAlias,
          body: item.body,
          resolved: false,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })
        commentCount += 1
      }
      if (item.decision !== 'note') {
        repos.productionStudio.insertReviewDecision(repos.db, {
          id: `decision-${item.id}`,
          packageId: parsed.packageId,
          shotId: item.shotId,
          decision: item.decision,
          authorAlias: item.authorAlias,
          note: item.body || undefined,
          createdAt: item.createdAt,
        })
        decisionCount += 1
      }
    }
    return { imported: true, packageId: parsed.packageId, commentCount, decisionCount }
  } catch (error) {
    return { imported: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function createReviewProxy(
  ffmpegPath: string | undefined,
  clip: EditorTimelineClip,
  mediaDirectory: string,
  thumbnailDirectory: string,
  index: number,
): Promise<{ relativePath: string; mimeType: string; sha256: string; sizeBytes: number }> {
  const prefix = `${String(index + 1).padStart(3, '0')}-${safeName(clip.name)}`
  if (clip.sourcePath && ffmpegPath && clip.mediaKind === 'video') {
    const target = join(mediaDirectory, `${prefix}.mp4`)
    await runProcess(ffmpegPath, ['-hide_banner', '-y', '-i', clip.sourcePath, '-vf', 'scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2', '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '1500k', '-maxrate', '1500k', '-bufsize', '3000k', '-c:a', 'aac', '-movflags', '+faststart', target])
    await createThumbnail(ffmpegPath, target, join(thumbnailDirectory, `${prefix}.jpg`))
    return proxyInfo(target, `media/${prefix}.mp4`, 'video/mp4')
  }
  if (clip.sourcePath && ffmpegPath && clip.mediaKind === 'still') {
    const target = join(mediaDirectory, `${prefix}.jpg`)
    await runProcess(ffmpegPath, ['-hide_banner', '-y', '-i', clip.sourcePath, '-vf', "scale='if(gt(iw,ih),min(1080,iw),-2)':'if(gt(iw,ih),-2,min(1080,ih))'", '-frames:v', '1', '-q:v', '3', target])
    await copyFile(target, join(thumbnailDirectory, `${prefix}.jpg`))
    return proxyInfo(target, `media/${prefix}.jpg`, 'image/jpeg')
  }
  const target = join(mediaDirectory, `${prefix}.svg`)
  await writeFile(target, renderSlateSvg(clip), 'utf8')
  return proxyInfo(target, `media/${prefix}.svg`, 'image/svg+xml')
}

async function createThumbnail(ffmpegPath: string, input: string, target: string): Promise<void> {
  await runProcess(ffmpegPath, ['-hide_banner', '-y', '-ss', '0', '-i', input, '-vf', 'scale=320:-2', '-frames:v', '1', '-q:v', '4', target])
}

async function proxyInfo(path: string, relativePath: string, mimeType: string) {
  const content = await readFile(path)
  return {
    relativePath,
    mimeType,
    sha256: createHash('sha256').update(content).digest('hex'),
    sizeBytes: content.byteLength,
  }
}

async function zipDirectory(sourceDirectory: string, outputPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(outputPath)
    const archive = createArchive('zip', { zlib: { level: 9 } })
    output.on('close', resolve)
    output.on('error', reject)
    archive.on('warning', (error: Error & { code?: string }) => error.code === 'ENOENT' ? undefined : reject(error))
    archive.on('error', reject)
    archive.pipe(output)
    archive.directory(sourceDirectory, false)
    void archive.finalize()
  })
}

async function runProcess(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-8_000) })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg 生成审片代理失败（${code ?? 'unknown'}）：${stderr.slice(-1200)}`)))
  })
}

function parseReviewEntry(value: unknown, shotIds: Set<string>): {
  id: string
  shotId?: string
  timecodeSeconds?: number
  authorAlias?: string
  decision: ReviewDecision['decision']
  body: string
  createdAt: string
  updatedAt: string
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('审片意见包含无效条目')
  const entry = value as Record<string, unknown>
  const id = typeof entry.id === 'string' && /^[a-zA-Z0-9-]{8,100}$/.test(entry.id) ? entry.id : randomUUID()
  const shotId = typeof entry.shotId === 'string' && shotIds.has(entry.shotId) ? entry.shotId : undefined
  if (entry.shotId && !shotId) throw new Error('审片意见引用了包外镜头')
  const body = typeof entry.body === 'string' ? entry.body.trim().slice(0, 4_000) : ''
  const decision = ['approve', 'return', 'request_changes', 'note'].includes(String(entry.decision))
    ? entry.decision as ReviewDecision['decision']
    : 'note'
  const createdAt = validDate(entry.createdAt) ?? new Date().toISOString()
  return {
    id,
    shotId,
    timecodeSeconds: typeof entry.timecodeSeconds === 'number' && entry.timecodeSeconds >= 0 ? entry.timecodeSeconds : undefined,
    authorAlias: typeof entry.authorAlias === 'string' ? entry.authorAlias.trim().slice(0, 80) || undefined : undefined,
    decision,
    body,
    createdAt,
    updatedAt: validDate(entry.updatedAt) ?? createdAt,
  }
}

function validDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return undefined
  return new Date(value).toISOString()
}

function localAssetPath(asset: ProjectAsset | undefined): string | undefined {
  return asset?.localPath
}

function safeName(value: string): string {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'dramaip'
}

function renderSlateSvg(clip: EditorTimelineClip): string {
  const label = xmlEscape(clip.name)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="960" viewBox="0 0 540 960"><rect width="540" height="960" fill="#11151a"/><text x="270" y="440" text-anchor="middle" fill="#fff" font-family="system-ui,sans-serif" font-size="34">${label}</text><text x="270" y="495" text-anchor="middle" fill="#9ca4ad" font-family="system-ui,sans-serif" font-size="20">媒体待生成 · ${clip.durationSeconds.toFixed(2)}s</text><text x="270" y="545" text-anchor="middle" fill="#69a9ff" font-family="system-ui,sans-serif" font-size="18">DramaIP Review Proxy</text></svg>`
}

function xmlEscape(value: string): string {
  return value.replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]!)
}

function renderRelinkGuide(manifest: EditorTimelineManifest, warnings: Array<{ code: string; clipId?: string; message: string }>): string {
  return `# ${manifest.title} · 剪辑工程 Relink 指南

- 时间线格式：FCPXML 1.10（\`.fcpxmld/Info.fcpxml\`）
- 兼容交换：CMX 3600 EDL（扁平主视频轨）
- 帧率：${manifest.frameRate} fps，分辨率：${manifest.width}×${manifest.height}
- 所有媒体 URI 均指向同级 \`media/\` 目录；移动工程时请连同整个目录移动。
- 字幕以 SRT sidecar 交付；EDL 不表达字幕、多轨结构或复杂转场。
- 静帧镜头在 FCPXML 保留时长；EDL 使用 slate 代理后再 relink。

## 降级与缺失报告

${warnings.length ? warnings.map((warning) => `- ${warning.clipId ? `[${warning.clipId}] ` : ''}${warning.message}`).join('\n') : '- 无'}
`
}
