import type {
  AdaptationProject,
  AssetRightsRecord,
  Character,
  Episode,
  EpisodeAnalysis,
  Project,
  ProjectAsset,
  Scene,
  Script,
  ScriptReview,
  Shot,
  ShotReview,
  ShotVisualAssetLock,
  VideoGenerationTask,
  VideoResult,
  VisualAssetVersion,
} from '@sdns/core'

export const DRAMA_PROPOSAL_PACKAGE_FORMAT = 'sdns-drama-proposal-package'
export const DRAMA_EPISODE_DELIVERY_PACKAGE_FORMAT = 'sdns-drama-episode-delivery-package'
export const DRAMA_SHOT_DELIVERY_PACKAGE_FORMAT = 'sdns-drama-shot-delivery-package'
export const DRAMA_DELIVERY_PACKAGE_VERSION = 2
export const DEFAULT_DRAMA_PROPOSAL_EPISODE_LIMIT = 10
export const DEFAULT_DRAMA_DELIVERY_EPISODE_LIMIT = 100

export interface DramaDeliveryExportOptions {
  episodeLimit?: number
}

export interface DramaDeliveryExportData {
  project?: Project
  adaptation: AdaptationProject
  characters?: Character[]
  episodes?: Episode[]
  episodeAnalysis?: EpisodeAnalysis
  scripts?: Script[]
  scenes?: Scene[]
  shots?: Shot[]
  scriptReviews?: ScriptReview[]
  shotReviews?: ShotReview[]
  videoTasks?: VideoGenerationTask[]
  videoResults?: VideoResult[]
  /** 仅结构化版本/权利引用，不随交付包发送本地媒体或授权证明正文。 */
  visualAssetVersions?: VisualAssetVersion[]
  shotVisualAssetLocks?: ShotVisualAssetLock[]
  assets?: ProjectAsset[]
  assetRightsRecords?: AssetRightsRecord[]
}

/** The explicitly selected, successful video delivery pointer. Raw provider metadata is excluded. */
export interface DramaBestVideoDelivery {
  resultId: string
  taskId: string
  /** Links the delivered asset to its immutable generation record when available. */
  lineageId?: string
  source: 'local' | 'result' | 'remote'
  url: string
  archivedAt?: string
}

export interface DramaDeliveryShotItem {
  shot: Shot
  review?: ShotReview
  riskFlags: string[]
  bestVideo?: DramaBestVideoDelivery
  visualAssetLocks: DramaVisualAssetLockReference[]
}

/** 交付侧可复核的精确视觉版本、素材状态和权利状态，不含路径、二进制或证据正文。 */
export interface DramaVisualAssetLockReference {
  role: string
  visualAssetVersionId: string
  label: string
  versionNumber: number
  slot: VisualAssetVersion['slot']
  ownerKind: VisualAssetVersion['ownerKind']
  ownerId: string
  assetId: string
  assetTitle?: string
  assetStatus?: ProjectAsset['status']
  rightsStatus?: AssetRightsRecord['status']
  staleAt?: string
  staleReason?: string
}

export interface DramaDeliverySceneItem {
  scene: Scene
  shots: DramaDeliveryShotItem[]
}

export interface DramaDeliveryEpisodeItem {
  episode: Episode
  script?: Script
  scriptReview?: ScriptReview
  scenes: DramaDeliverySceneItem[]
}

export interface DramaEpisodeAnalysisSummary {
  episodeLimit: number
  summary: string
  suggestions?: string
  hookStrengthTrend: number[]
  retentionScoreTrend: number[]
  paceScoreTrend: number[]
  reversalDensityTrend: number[]
  visualAppealTrend: number[]
}

export interface DramaVideoRiskSummary {
  totalShots: number
  highRiskShots: number
  mediumRiskShots: number
  missingPromptShots: number
  missingNegativePromptShots: number
  lowScoreShotReviews: number
  lowFeasibilityScriptReviews: number
  notes: string[]
}

export interface DramaProposalPackage {
  meta: {
    format: typeof DRAMA_PROPOSAL_PACKAGE_FORMAT
    version: typeof DRAMA_DELIVERY_PACKAGE_VERSION
    exportedAt: string
    adaptationTitle: string
    episodeAnalysisLimit: number
  }
  project?: Project
  adaptation: AdaptationProject
  sellingPoints: {
    coreHook?: string
    coreSellingPoint?: string
    emotionalCore?: string
    synopsis?: string
  }
  characters: Character[]
  visualStyle: {
    projectDirection?: string
    adaptationDirection?: string
    styleGuide?: string
  }
  episodeOutlines: Episode[]
  firstEpisodesAnalysis?: DramaEpisodeAnalysisSummary
  videoRiskSummary: DramaVideoRiskSummary
}

export interface DramaEpisodeDeliveryPackage {
  meta: {
    format: typeof DRAMA_EPISODE_DELIVERY_PACKAGE_FORMAT
    version: typeof DRAMA_DELIVERY_PACKAGE_VERSION
    exportedAt: string
    adaptationTitle: string
    episodeLimit: number
  }
  project?: Project
  adaptation: AdaptationProject
  episodes: DramaDeliveryEpisodeItem[]
  videoRiskSummary: DramaVideoRiskSummary
}

export interface DramaShotDeliveryPackage {
  meta: {
    format: typeof DRAMA_SHOT_DELIVERY_PACKAGE_FORMAT
    version: typeof DRAMA_DELIVERY_PACKAGE_VERSION
    exportedAt: string
    adaptationTitle: string
    episodeLimit: number
  }
  project?: Project
  adaptation: AdaptationProject
  scenes: Array<{
    episode: Episode
    script?: Script
    scene: Scene
    shots: DramaDeliveryShotItem[]
  }>
  videoRiskSummary: DramaVideoRiskSummary
}

interface ShotContext {
  episode: Episode
  script?: Script
  scene: Scene
  shot: Shot
  review?: ShotReview
}

export function buildDramaProposalPackage(
  data: DramaDeliveryExportData,
  options: DramaDeliveryExportOptions & { exportedAt?: string } = {},
): DramaProposalPackage {
  const episodeAnalysisLimit = normalizeEpisodeLimit(options.episodeLimit, DEFAULT_DRAMA_PROPOSAL_EPISODE_LIMIT)
  const episodes = sortEpisodes(data.episodes ?? [])
  const deliveryEpisodes = buildEpisodeItems(data, episodes)
  return {
    meta: {
      format: DRAMA_PROPOSAL_PACKAGE_FORMAT,
      version: DRAMA_DELIVERY_PACKAGE_VERSION,
      exportedAt: options.exportedAt ?? new Date().toISOString(),
      adaptationTitle: data.adaptation.title,
      episodeAnalysisLimit,
    },
    project: data.project,
    adaptation: data.adaptation,
    sellingPoints: {
      coreHook: data.project?.coreHook,
      coreSellingPoint: data.project?.coreSellingPoint,
      emotionalCore: data.project?.emotionalCore,
      synopsis: data.project?.synopsis,
    },
    characters: data.characters ?? [],
    visualStyle: {
      projectDirection: data.project?.visualStyleDirection,
      adaptationDirection: data.adaptation.visualStyleDirection,
      styleGuide: data.project?.styleGuide,
    },
    episodeOutlines: episodes,
    firstEpisodesAnalysis: data.episodeAnalysis ? summarizeEpisodeAnalysis(data.episodeAnalysis, episodeAnalysisLimit) : undefined,
    videoRiskSummary: buildVideoRiskSummary(deliveryEpisodes),
  }
}

export function buildDramaEpisodeDeliveryPackage(
  data: DramaDeliveryExportData,
  options: DramaDeliveryExportOptions & { exportedAt?: string } = {},
): DramaEpisodeDeliveryPackage {
  const allEpisodes = sortEpisodes(data.episodes ?? [])
  const episodeLimit = normalizeEpisodeLimit(options.episodeLimit, Math.min(DEFAULT_DRAMA_DELIVERY_EPISODE_LIMIT, Math.max(allEpisodes.length, 1)))
  const episodes = buildEpisodeItems(data, allEpisodes.slice(0, episodeLimit))
  return {
    meta: {
      format: DRAMA_EPISODE_DELIVERY_PACKAGE_FORMAT,
      version: DRAMA_DELIVERY_PACKAGE_VERSION,
      exportedAt: options.exportedAt ?? new Date().toISOString(),
      adaptationTitle: data.adaptation.title,
      episodeLimit,
    },
    project: data.project,
    adaptation: data.adaptation,
    episodes,
    videoRiskSummary: buildVideoRiskSummary(episodes),
  }
}

export function buildDramaShotDeliveryPackage(
  data: DramaDeliveryExportData,
  options: DramaDeliveryExportOptions & { exportedAt?: string } = {},
): DramaShotDeliveryPackage {
  const allEpisodes = sortEpisodes(data.episodes ?? [])
  const episodeLimit = normalizeEpisodeLimit(options.episodeLimit, Math.min(DEFAULT_DRAMA_DELIVERY_EPISODE_LIMIT, Math.max(allEpisodes.length, 1)))
  const episodes = buildEpisodeItems(data, allEpisodes.slice(0, episodeLimit))
  const scenes = episodes.flatMap((episode) =>
    episode.scenes.map((scene) => ({
      episode: episode.episode,
      script: episode.script,
      scene: scene.scene,
      shots: scene.shots,
    })),
  )
  return {
    meta: {
      format: DRAMA_SHOT_DELIVERY_PACKAGE_FORMAT,
      version: DRAMA_DELIVERY_PACKAGE_VERSION,
      exportedAt: options.exportedAt ?? new Date().toISOString(),
      adaptationTitle: data.adaptation.title,
      episodeLimit,
    },
    project: data.project,
    adaptation: data.adaptation,
    scenes,
    videoRiskSummary: buildVideoRiskSummary(episodes),
  }
}

export function exportDramaProposalMarkdown(
  data: DramaDeliveryExportData,
  options: DramaDeliveryExportOptions = {},
): string {
  const pkg = buildDramaProposalPackage(data, options)
  const parts: string[] = [`# ${pkg.adaptation.title} · 短剧提案包`]
  parts.push([
    line('源项目', pkg.project?.title),
    line('目标集数', pkg.adaptation.targetEpisodeCount),
    line('每集时长', pkg.adaptation.episodeDuration),
    line('改编风格', pkg.adaptation.adaptationStyle),
    line('目标受众', pkg.adaptation.audience ?? pkg.project?.targetAudience),
  ].filter(Boolean).join('\n'))

  const selling = [
    line('一句话钩子', pkg.sellingPoints.coreHook),
    line('核心卖点', pkg.sellingPoints.coreSellingPoint),
    line('情绪主轴', pkg.sellingPoints.emotionalCore),
  ].filter(Boolean)
  if (selling.length) parts.push(`## 核心卖点\n\n${selling.join('\n')}`)
  if (pkg.sellingPoints.synopsis) parts.push(`## 故事简介\n\n${pkg.sellingPoints.synopsis}`)

  const visual = [
    line('项目视觉方向', pkg.visualStyle.projectDirection),
    line('改编视觉方向', pkg.visualStyle.adaptationDirection),
    line('风格规范', pkg.visualStyle.styleGuide),
  ].filter(Boolean)
  if (visual.length) parts.push(`## 视觉风格\n\n${visual.join('\n')}`)

  if (pkg.characters.length) {
    parts.push(`## 人物小传\n\n${pkg.characters.map(renderCharacter).join('\n\n')}`)
  }

  if (pkg.episodeOutlines.length) {
    parts.push(`## 分集大纲\n\n${pkg.episodeOutlines.map(renderEpisodeOutline).join('\n\n')}`)
  }

  parts.push(`## 前 ${pkg.meta.episodeAnalysisLimit} 集分析\n\n${renderEpisodeAnalysis(pkg.firstEpisodesAnalysis)}`)
  parts.push(`## 视频风险\n\n${renderVideoRiskSummary(pkg.videoRiskSummary)}`)
  return parts.filter(Boolean).join('\n\n') + '\n'
}

export function exportDramaProposalJson(
  data: DramaDeliveryExportData,
  options: DramaDeliveryExportOptions = {},
): string {
  return JSON.stringify(buildDramaProposalPackage(data, options), null, 2)
}

export function exportDramaEpisodeDeliveryMarkdown(
  data: DramaDeliveryExportData,
  options: DramaDeliveryExportOptions = {},
): string {
  const pkg = buildDramaEpisodeDeliveryPackage(data, options)
  const parts: string[] = [`# ${pkg.adaptation.title} · 分集交付包`]
  parts.push([
    line('源项目', pkg.project?.title),
    line('目标集数', pkg.adaptation.targetEpisodeCount),
    line('导出集数上限', pkg.meta.episodeLimit),
    line('改编风格', pkg.adaptation.adaptationStyle),
    line('视觉风格方向', pkg.adaptation.visualStyleDirection),
  ].filter(Boolean).join('\n'))
  parts.push(`## 视频风险摘要\n\n${renderVideoRiskSummary(pkg.videoRiskSummary)}`)
  if (pkg.episodes.length) {
    parts.push(pkg.episodes.map(renderDeliveryEpisode).join('\n\n---\n\n'))
  } else {
    parts.push('（暂无分集交付内容）')
  }
  return parts.filter(Boolean).join('\n\n') + '\n'
}

export function exportDramaEpisodeDeliveryJson(
  data: DramaDeliveryExportData,
  options: DramaDeliveryExportOptions = {},
): string {
  return JSON.stringify(buildDramaEpisodeDeliveryPackage(data, options), null, 2)
}

export function exportDramaShotDeliveryMarkdown(
  data: DramaDeliveryExportData,
  options: DramaDeliveryExportOptions = {},
): string {
  const pkg = buildDramaShotDeliveryPackage(data, options)
  const parts: string[] = [`# ${pkg.adaptation.title} · 分镜交付包`]
  parts.push([
    line('源项目', pkg.project?.title),
    line('导出集数上限', pkg.meta.episodeLimit),
    line('视觉风格方向', pkg.adaptation.visualStyleDirection),
  ].filter(Boolean).join('\n'))
  parts.push(`## 视频风险摘要\n\n${renderVideoRiskSummary(pkg.videoRiskSummary)}`)
  if (pkg.scenes.length) {
    parts.push(pkg.scenes.map(renderDeliveryScene).join('\n\n---\n\n'))
  } else {
    parts.push('（暂无分镜内容）')
  }
  return parts.filter(Boolean).join('\n\n') + '\n'
}

export function exportDramaShotDeliveryJson(
  data: DramaDeliveryExportData,
  options: DramaDeliveryExportOptions = {},
): string {
  return JSON.stringify(buildDramaShotDeliveryPackage(data, options), null, 2)
}

export function exportDramaShotDeliveryCsv(
  data: DramaDeliveryExportData,
  options: DramaDeliveryExportOptions = {},
): string {
  const pkg = buildDramaShotDeliveryPackage(data, options)
  const header = [
    'episodeNumber',
    'episodeTitle',
    'sceneNumber',
    'sceneTitle',
    'location',
    'shotNumber',
    'durationSeconds',
    'visualDescription',
    'characterIds',
    'cameraAngle',
    'cameraMovement',
    'emotion',
    'action',
    'dialogue',
    'narration',
    'videoPrompt',
    'negativePrompt',
    'bestVideoSource',
    'bestVideoUrl',
    'imagePrompt',
    'consistencyNotes',
    'aiVideoDifficulty',
    'reviewOverallScore',
    'riskFlags',
    'reviewIssues',
    'reviewSuggestions',
    'visualAssetVersions',
    'visualAssetStaleReasons',
  ]
  const rows = pkg.scenes.flatMap((scene) =>
    scene.shots.map((item) =>
      [
        scene.episode.episodeNumber,
        scene.episode.title,
        scene.scene.sceneNumber,
        scene.scene.title,
        scene.scene.location,
        item.shot.shotNumber,
        item.shot.durationSeconds ?? '',
        item.shot.visualDescription,
        item.shot.characterIds.join(' / '),
        item.shot.cameraAngle ?? '',
        item.shot.cameraMovement ?? '',
        item.shot.emotion ?? '',
        item.shot.action ?? '',
        item.shot.dialogue ?? '',
        item.shot.narration ?? '',
        item.shot.videoPrompt,
        item.shot.negativePrompt ?? '',
        item.bestVideo?.source ?? '',
        item.bestVideo?.url ?? '',
        item.shot.imagePrompt ?? '',
        item.shot.consistencyNotes ?? '',
        item.review?.aiVideoDifficulty ?? item.shot.aiVideoDifficulty ?? '',
        item.review?.overallScore ?? '',
        item.riskFlags.join(' / '),
        item.review?.issues.join(' / ') ?? '',
        item.review?.suggestions.join(' / ') ?? '',
        item.visualAssetLocks.map((lock) => `${lock.role}:${lock.label}@v${lock.versionNumber}`).join(' / '),
        item.visualAssetLocks.filter((lock) => lock.staleReason).map((lock) => `${lock.role}:${lock.staleReason}`).join(' / '),
      ].map(csvField).join(','),
    ),
  )
  return [header.join(','), ...rows].join('\n') + '\n'
}

function buildEpisodeItems(data: DramaDeliveryExportData, episodes: Episode[]): DramaDeliveryEpisodeItem[] {
  const scriptsByEpisode = new Map((data.scripts ?? []).map((script) => [script.episodeId, script]))
  const scriptReviewsByScript = new Map((data.scriptReviews ?? []).map((review) => [review.scriptId, review]))
  const scenesByScript = groupBy(data.scenes ?? [], (scene) => scene.scriptId)
  const shotsByScene = groupBy(data.shots ?? [], (shot) => shot.sceneId)
  const shotReviewsByShot = new Map((data.shotReviews ?? []).map((review) => [review.shotId, review]))
  const bestVideosByShot = buildBestVideosByShot(data)
  const visualAssetLocksByShot = buildVisualAssetLocksByShot(data)
  return episodes.map((episode) => {
    const script = scriptsByEpisode.get(episode.id)
    const scenes = script
      ? sortScenes(scenesByScript.get(script.id) ?? []).map((scene) => ({
          scene,
          shots: sortShots(shotsByScene.get(scene.id) ?? []).map((shot) => {
            const review = shotReviewsByShot.get(shot.id)
            return {
              shot,
              review,
              riskFlags: buildShotRiskFlags(shot, review),
              bestVideo: bestVideosByShot.get(shot.id),
              visualAssetLocks: visualAssetLocksByShot.get(shot.id) ?? [],
            }
          }),
        }))
      : []
    return {
      episode,
      script,
      scriptReview: script ? scriptReviewsByScript.get(script.id) : undefined,
      scenes,
    }
  })
}

function buildVisualAssetLocksByShot(data: DramaDeliveryExportData): Map<string, DramaVisualAssetLockReference[]> {
  const versionsById = new Map((data.visualAssetVersions ?? []).map((version) => [version.id, version]))
  const assetsById = new Map((data.assets ?? []).map((asset) => [asset.id, asset]))
  const rightsByAssetId = new Map((data.assetRightsRecords ?? []).map((record) => [record.assetId, record]))
  const byShot = new Map<string, DramaVisualAssetLockReference[]>()
  for (const lock of data.shotVisualAssetLocks ?? []) {
    const version = versionsById.get(lock.visualAssetVersionId)
    if (!version) continue
    const asset = assetsById.get(version.assetId)
    const reference: DramaVisualAssetLockReference = {
      role: lock.role,
      visualAssetVersionId: version.id,
      label: version.label,
      versionNumber: version.versionNumber,
      slot: version.slot,
      ownerKind: version.ownerKind,
      ownerId: version.ownerId,
      assetId: version.assetId,
      assetTitle: asset?.title,
      assetStatus: asset?.status,
      rightsStatus: rightsByAssetId.get(version.assetId)?.status,
      staleAt: lock.staleAt,
      staleReason: lock.staleReason,
    }
    byShot.set(lock.shotId, [...(byShot.get(lock.shotId) ?? []), reference])
  }
  return byShot
}

function buildBestVideosByShot(data: DramaDeliveryExportData): Map<string, DramaBestVideoDelivery> {
  const successfulTasksById = new Map(
    (data.videoTasks ?? [])
      .filter((task) => task.status === 'success')
      .map((task) => [task.id, task]),
  )
  const selectedByShot = new Map<string, DramaBestVideoDelivery>()
  for (const result of data.videoResults ?? []) {
    if (!result.isBest) continue
    const task = successfulTasksById.get(result.taskId)
    const shotId = result.shotId ?? task?.shotId
    if (!task || !shotId || selectedByShot.has(shotId)) continue
    const localVideoPath = result.localVideoPath?.trim()
    const resultVideoUrl = result.resultVideoUrl.trim()
    const remoteVideoUrl = result.remoteVideoUrl?.trim()
    const source = localVideoPath ? 'local' : resultVideoUrl ? 'result' : remoteVideoUrl ? 'remote' : undefined
    const url = localVideoPath ?? (resultVideoUrl || remoteVideoUrl)
    if (!source || !url) continue
    selectedByShot.set(shotId, {
      resultId: result.id,
      taskId: task.id,
      lineageId: task.lineageId,
      source,
      url,
      archivedAt: result.archivedAt,
    })
  }
  return selectedByShot
}

function summarizeEpisodeAnalysis(analysis: EpisodeAnalysis, episodeLimit: number): DramaEpisodeAnalysisSummary {
  return {
    episodeLimit,
    summary: analysis.summary,
    suggestions: analysis.suggestions,
    hookStrengthTrend: analysis.hookStrengthTrend.slice(0, episodeLimit),
    retentionScoreTrend: analysis.retentionScoreTrend.slice(0, episodeLimit),
    paceScoreTrend: analysis.paceScoreTrend.slice(0, episodeLimit),
    reversalDensityTrend: analysis.reversalDensityTrend.slice(0, episodeLimit),
    visualAppealTrend: analysis.visualAppealTrend.slice(0, episodeLimit),
  }
}

function buildVideoRiskSummary(episodes: DramaDeliveryEpisodeItem[]): DramaVideoRiskSummary {
  const shotContexts = collectShotContexts(episodes)
  const scriptReviews = episodes.flatMap((episode) => episode.scriptReview ? [{ episode: episode.episode, review: episode.scriptReview }] : [])
  const highRiskShots = shotContexts.filter((ctx) => (ctx.review?.aiVideoDifficulty ?? ctx.shot.aiVideoDifficulty) === 'high' || (ctx.review?.overallScore ?? 100) < 60)
  const mediumRiskShots = shotContexts.filter((ctx) => (ctx.review?.aiVideoDifficulty ?? ctx.shot.aiVideoDifficulty) === 'medium')
  const missingPromptShots = shotContexts.filter((ctx) => !ctx.shot.videoPrompt?.trim())
  const missingNegativePromptShots = shotContexts.filter((ctx) => !ctx.shot.negativePrompt?.trim())
  const lowScoreShotReviews = shotContexts.filter((ctx) => (ctx.review?.overallScore ?? 100) < 60)
  const lowFeasibilityScriptReviews = scriptReviews.filter((item) => item.review.aiVideoFeasibilityScore < 60)
  const notes = [
    ...episodes
      .filter((episode) => episode.episode.aiVideoNote)
      .map((episode) => `第 ${episode.episode.episodeNumber} 集视频备注：${episode.episode.aiVideoNote}`),
    ...lowFeasibilityScriptReviews.map((item) => `第 ${item.episode.episodeNumber} 集剧本 AI 视频可行性 ${item.review.aiVideoFeasibilityScore}：${item.review.issues.join('；') || '需复核'}`),
    ...highRiskShots.map((ctx) => {
      const difficulty = ctx.review?.aiVideoDifficulty ?? ctx.shot.aiVideoDifficulty ?? 'unknown'
      const issue = ctx.review?.issues[0] ?? ctx.shot.consistencyNotes ?? '需复核'
      return `第 ${ctx.episode.episodeNumber} 集 / ${ctx.scene.title} / 镜头 ${ctx.shot.shotNumber}：${difficulty}，${issue}`
    }),
  ].slice(0, 20)
  return {
    totalShots: shotContexts.length,
    highRiskShots: highRiskShots.length,
    mediumRiskShots: mediumRiskShots.length,
    missingPromptShots: missingPromptShots.length,
    missingNegativePromptShots: missingNegativePromptShots.length,
    lowScoreShotReviews: lowScoreShotReviews.length,
    lowFeasibilityScriptReviews: lowFeasibilityScriptReviews.length,
    notes,
  }
}

function collectShotContexts(episodes: DramaDeliveryEpisodeItem[]): ShotContext[] {
  return episodes.flatMap((episode) =>
    episode.scenes.flatMap((scene) =>
      scene.shots.map((item) => ({
        episode: episode.episode,
        script: episode.script,
        scene: scene.scene,
        shot: item.shot,
        review: item.review,
      })),
    ),
  )
}

function buildShotRiskFlags(shot: Shot, review?: ShotReview): string[] {
  const flags: string[] = []
  const difficulty = review?.aiVideoDifficulty ?? shot.aiVideoDifficulty
  if (!shot.videoPrompt?.trim()) flags.push('缺少视频 Prompt')
  if (!shot.negativePrompt?.trim()) flags.push('缺少负面 Prompt')
  if (difficulty === 'high') flags.push('AI 视频高难度')
  if (review && review.overallScore < 60) flags.push(`镜头审查低分 ${review.overallScore}`)
  if (review?.issues[0]) flags.push(review.issues[0])
  return flags
}

function renderCharacter(character: Character): string {
  return [
    `### ${character.name}（${character.role}）`,
    line('身份', character.identity),
    line('性格', character.personality),
    line('欲望', character.desire),
    line('人物弧光', character.arc),
    line('短剧功能', character.shortDramaFunction),
    line('视觉描述', character.visualDescription),
    line('角色 Prompt', character.appearancePrompt),
    line('负面 Prompt', character.negativePrompt),
  ].filter(Boolean).join('\n')
}

function renderEpisodeOutline(episode: Episode): string {
  return [
    `### 第 ${episode.episodeNumber} 集：${episode.title}`,
    episode.summary,
    line('开场钩子', episode.hook),
    line('核心冲突', episode.mainConflict),
    line('关键反转', episode.reversal),
    line('情绪爆点', episode.emotionalBeat),
    line('结尾悬念', episode.cliffhanger),
    line('关键画面', episode.keyVisuals.join('；')),
    line('AI 视频备注', episode.aiVideoNote),
  ].filter(Boolean).join('\n')
}

function renderEpisodeAnalysis(analysis?: DramaEpisodeAnalysisSummary): string {
  if (!analysis) return '（暂无前 10 集分析）'
  const rows = Array.from({ length: analysis.episodeLimit }, (_, index) => [
    index + 1,
    analysis.hookStrengthTrend[index] ?? '',
    analysis.retentionScoreTrend[index] ?? '',
    analysis.paceScoreTrend[index] ?? '',
    analysis.reversalDensityTrend[index] ?? '',
    analysis.visualAppealTrend[index] ?? '',
  ])
  const table = [
    '| 集数 | 钩子强度 | 留存 | 节奏 | 反转密度 | 视觉吸引 |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
  return [analysis.summary, analysis.suggestions ? `**建议**：${analysis.suggestions}` : '', table].filter(Boolean).join('\n\n')
}

function renderVideoRiskSummary(summary: DramaVideoRiskSummary): string {
  const lines = [
    line('镜头总数', summary.totalShots),
    line('高风险镜头', summary.highRiskShots),
    line('中风险镜头', summary.mediumRiskShots),
    line('缺少视频 Prompt', summary.missingPromptShots),
    line('缺少负面 Prompt', summary.missingNegativePromptShots),
    line('镜头审查低分', summary.lowScoreShotReviews),
    line('剧本 AI 视频可行性低分', summary.lowFeasibilityScriptReviews),
  ].filter(Boolean)
  if (summary.notes.length) lines.push(summary.notes.map((note) => `- ${note}`).join('\n'))
  return lines.join('\n') || '暂无视频风险记录。'
}

function renderDeliveryEpisode(item: DramaDeliveryEpisodeItem): string {
  const parts: string[] = [`## 第 ${item.episode.episodeNumber} 集：${item.episode.title}`]
  parts.push(renderEpisodeOutline(item.episode))
  if (item.scriptReview) {
    parts.push([
      '### 剧本审稿',
      line('综合得分', item.scriptReview.overallScore),
      line('AI 视频可行性', item.scriptReview.aiVideoFeasibilityScore),
      item.scriptReview.issues.length ? `- **问题**：${item.scriptReview.issues.join('；')}` : '',
      item.scriptReview.suggestions.length ? `- **建议**：${item.scriptReview.suggestions.join('；')}` : '',
    ].filter(Boolean).join('\n'))
  }
  if (item.script) {
    parts.push(`### 剧本正文\n\n${item.script.content?.trim() || '（暂无剧本正文）'}`)
  } else {
    parts.push('### 剧本正文\n\n（暂无剧本）')
  }
  if (item.scenes.length) {
    parts.push(`### 场景与分镜\n\n${item.scenes.map(renderDeliveryScene).join('\n\n')}`)
  }
  return parts.join('\n\n')
}

function renderDeliveryScene(item: DramaDeliverySceneItem | DramaShotDeliveryPackage['scenes'][number]): string {
  const scene = item.scene
  const title = 'episode' in item
    ? `## 第 ${item.episode.episodeNumber} 集 / 场景 ${scene.sceneNumber}：${scene.title}`
    : `#### 场景 ${scene.sceneNumber}：${scene.title}`
  const parts = [
    title,
    [line('地点', scene.location), line('时间', scene.timeOfDay), line('画面', scene.visualDescription), line('摘要', scene.summary), line('人物', scene.characters.join('、'))].filter(Boolean).join('\n'),
  ].filter(Boolean)
  if (item.shots.length) parts.push(item.shots.map(renderDeliveryShot).join('\n\n'))
  else parts.push('（暂无镜头）')
  return parts.join('\n\n')
}

function renderDeliveryShot(item: DramaDeliveryShotItem): string {
  const shot = item.shot
  const review = item.review
  return [
    `##### 镜头 ${shot.shotNumber}`,
    [
      line('时长', shot.durationSeconds ? `${shot.durationSeconds}s` : undefined),
      line('画面', shot.visualDescription),
      line('人物', shot.characterIds.join('、')),
      line('景别/机位', shot.cameraAngle),
      line('镜头运动', shot.cameraMovement),
      line('情绪', shot.emotion),
      line('动作', shot.action),
      line('对白', shot.dialogue),
      line('旁白', shot.narration),
      line('视频 Prompt', shot.videoPrompt || '（未生成）'),
      line('负面 Prompt', shot.negativePrompt),
      item.bestVideo ? line('最佳视频交付', `${item.bestVideo.source} · ${item.bestVideo.url}`) : '',
      line('图片 Prompt', shot.imagePrompt),
      line('一致性提示', shot.consistencyNotes),
      line('AI 视频难度', review?.aiVideoDifficulty ?? shot.aiVideoDifficulty),
      line('镜头审查得分', review?.overallScore),
      line('风险标记', item.riskFlags.join('；')),
      item.visualAssetLocks.length ? `- **视觉资产版本锁**：${item.visualAssetLocks.map((lock) => `${lock.role}=${lock.label} v${lock.versionNumber}${lock.staleReason ? `（待确认：${lock.staleReason}）` : ''}`).join('；')}` : '',
      review?.issues.length ? `- **审查问题**：${review.issues.join('；')}` : '',
      review?.suggestions.length ? `- **审查建议**：${review.suggestions.join('；')}` : '',
    ].filter(Boolean).join('\n'),
  ].filter(Boolean).join('\n\n')
}

function normalizeEpisodeLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(DEFAULT_DRAMA_DELIVERY_EPISODE_LIMIT, Math.floor(value ?? fallback)))
}

function sortEpisodes(episodes: Episode[]): Episode[] {
  return [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber)
}

function sortScenes(scenes: Scene[]): Scene[] {
  return [...scenes].sort((a, b) => a.orderIndex - b.orderIndex || a.sceneNumber - b.sceneNumber)
}

function sortShots(shots: Shot[]): Shot[] {
  return [...shots].sort((a, b) => a.shotNumber - b.shotNumber)
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    map.set(key, [...(map.get(key) ?? []), item])
  }
  return map
}

function line(label: string, value?: string | number | null): string {
  if (value === undefined || value === null || value === '') return ''
  return `- **${label}**：${value}`
}

function csvField(value: string | number | undefined | null): string {
  const text = value === undefined || value === null ? '' : String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}
