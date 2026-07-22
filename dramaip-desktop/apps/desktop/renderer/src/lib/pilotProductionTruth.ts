import type {
  AdaptationProject,
  Chapter,
  LongTask,
  Project,
  QualityGateReport,
  Scene,
  Script,
  Shot,
  VideoGenerationTask,
  VideoResult,
} from '@sdns/core'
import { buildProjectQualityGateTruth, type QualityGateTruth } from './qualityGateTruth'

export type ProductionCoverageKey = 'episodes' | 'scripts' | 'scenes' | 'shots' | 'video'
export type PilotStageKey = 'scripts' | 'storyboard' | 'assets' | 'video' | 'audio' | 'edit' | 'quality' | 'delivery'
export type PilotStageState = 'complete' | 'in_progress' | 'blocked' | 'capability_gap'

export interface ProductionCoverage {
  key: ProductionCoverageKey
  label: string
  completed: number
  target: number
  complete: boolean
  detail: string
}

export interface PilotProductionStage {
  key: PilotStageKey
  label: string
  state: PilotStageState
  completed?: number
  target?: number
  detail: string
}

export interface PilotProductionTruth {
  targetEpisodeCount: number
  pilotEpisodeNumbers: number[]
  coverage: ProductionCoverage[]
  pilotCoverage: ProductionCoverage[]
  source: {
    state: 'approved' | 'stale' | 'blocked' | 'missing'
    detail: string
    quality: QualityGateTruth
  }
  stages: PilotProductionStage[]
  blockers: string[]
  failedTaskCount: number
  activeTaskCount: number
  nextAction: string
  costDetail: string
  rightsDetail: string
  canCreateExpansionPlan: boolean
}

export interface PilotProductionTruthInput {
  project: Project
  chapters: Chapter[]
  qualityReports: QualityGateReport[]
  activeAdaptation?: AdaptationProject
  episodes: Array<{ id: string; adaptationProjectId: string; episodeNumber: number }>
  scripts: Script[]
  scenes: Scene[]
  shots: Shot[]
  videoTasks: VideoGenerationTask[]
  videoResults: VideoResult[]
  longTasks?: LongTask[]
  characters?: Parameters<typeof buildProjectQualityGateTruth>[0]['characters']
  outlines?: Parameters<typeof buildProjectQualityGateTruth>[0]['outlines']
}

function hasText(value?: string): boolean {
  return Boolean(value?.trim())
}

function uniqueEpisodeNumbers(values: Iterable<number>, allowed: Set<number>): number[] {
  return [...new Set([...values].filter((value) => allowed.has(value)))].sort((left, right) => left - right)
}

function buildCoverage(
  key: ProductionCoverageKey,
  label: string,
  targetNumbers: number[],
  coveredNumbers: Iterable<number>,
): ProductionCoverage {
  const allowed = new Set(targetNumbers)
  const completed = uniqueEpisodeNumbers(coveredNumbers, allowed).length
  const target = targetNumbers.length
  return {
    key,
    label,
    completed,
    target,
    complete: target > 0 && completed === target,
    detail: `${completed}/${target} 集`,
  }
}

function usableBestTaskIds(videoTasks: VideoGenerationTask[], videoResults: VideoResult[]): Set<string> {
  const successfulTaskIds = new Set(videoTasks.filter((task) => task.status === 'success').map((task) => task.id))
  return new Set(videoResults
    .filter((result) => result.isBest && successfulTaskIds.has(result.taskId))
    .filter((result) => hasText(result.localVideoPath) || hasText(result.resultVideoUrl) || hasText(result.remoteVideoUrl))
    .map((result) => result.taskId))
}

function sourceState(quality: QualityGateTruth): PilotProductionTruth['source'] {
  if (quality.state === 'current' && quality.report?.verdict !== 'block') return { state: 'approved', detail: quality.detail, quality }
  if (quality.state === 'current') return { state: 'blocked', detail: quality.detail, quality }
  if (quality.state === 'stale' || quality.state === 'legacy') return { state: 'stale', detail: quality.detail, quality }
  return { state: 'missing', detail: quality.detail, quality }
}

function coverageByKey(coverage: ProductionCoverage[], key: ProductionCoverageKey): ProductionCoverage {
  const item = coverage.find((candidate) => candidate.key === key)
  if (!item) throw new Error(`missing production coverage: ${key}`)
  return item
}

/**
 * 生产总览和试播计划共享的只读真值。这里刻意只从已有实体推导：未安装的图片、音频、
 * 剪辑、版权账本和成本账本会明确显示为缺口，绝不因为某一条视频结果存在就视作交付。
 */
export function buildPilotProductionTruth(input: PilotProductionTruthInput): PilotProductionTruth {
  const adaptation = input.activeAdaptation
  const targetEpisodeCount = Math.max(1, adaptation?.targetEpisodeCount ?? input.project.targetEpisodeCount ?? input.project.productionBrief?.profile.pilotEpisodeCount ?? 3)
  const targetNumbers = Array.from({ length: targetEpisodeCount }, (_, index) => index + 1)
  const pilotCount = Math.min(3, Math.max(1, input.project.productionBrief?.profile.pilotEpisodeCount ?? 3), targetEpisodeCount)
  const pilotEpisodeNumbers = targetNumbers.slice(0, pilotCount)
  const validEpisodes = input.episodes.filter((episode) => !adaptation || episode.adaptationProjectId === adaptation.id)
  const episodeById = new Map(validEpisodes.map((episode) => [episode.id, episode]))
  const episodeNumbers = new Map(validEpisodes.map((episode) => [episode.id, episode.episodeNumber]))
  const scriptByEpisode = new Map(input.scripts
    .filter((script) => !adaptation || script.adaptationProjectId === adaptation.id)
    .filter((script) => episodeById.has(script.episodeId) && hasText(script.content))
    .map((script) => [script.episodeId, script]))
  const sceneEpisodeIds = new Set(input.scenes
    .filter((scene) => scriptByEpisode.has(scene.episodeId))
    .map((scene) => scene.episodeId))
  const shotEpisodeIds = new Set(input.shots
    .filter((shot) => episodeById.has(shot.episodeId))
    .map((shot) => shot.episodeId))
  const bestVideoTaskIds = usableBestTaskIds(input.videoTasks, input.videoResults)
  const videoEpisodeIds = new Set(input.videoTasks
    .filter((task) => bestVideoTaskIds.has(task.id) && task.episodeId && episodeById.has(task.episodeId))
    .map((task) => task.episodeId as string))

  const coverage: ProductionCoverage[] = [
    buildCoverage('episodes', '分集大纲', targetNumbers, validEpisodes.map((episode) => episode.episodeNumber)),
    buildCoverage('scripts', '剧本', targetNumbers, [...scriptByEpisode.keys()].map((id) => episodeNumbers.get(id) ?? 0)),
    buildCoverage('scenes', '场景', targetNumbers, [...sceneEpisodeIds].map((id) => episodeNumbers.get(id) ?? 0)),
    buildCoverage('shots', '镜头', targetNumbers, [...shotEpisodeIds].map((id) => episodeNumbers.get(id) ?? 0)),
    buildCoverage('video', '已选视频', targetNumbers, [...videoEpisodeIds].map((id) => episodeNumbers.get(id) ?? 0)),
  ]
  const pilotCoverage: ProductionCoverage[] = coverage.map((item) => {
    const coveredNumbers = item.key === 'episodes'
      ? validEpisodes.map((episode) => episode.episodeNumber)
      : item.key === 'scripts'
        ? [...scriptByEpisode.keys()].map((id) => episodeNumbers.get(id) ?? 0)
        : item.key === 'scenes'
          ? [...sceneEpisodeIds].map((id) => episodeNumbers.get(id) ?? 0)
          : item.key === 'shots'
            ? [...shotEpisodeIds].map((id) => episodeNumbers.get(id) ?? 0)
            : [...videoEpisodeIds].map((id) => episodeNumbers.get(id) ?? 0)
    return buildCoverage(item.key, item.label, pilotEpisodeNumbers, coveredNumbers)
  })

  const quality = buildProjectQualityGateTruth({
    project: input.project,
    chapters: input.chapters,
    characters: input.characters ?? [],
    outlines: input.outlines ?? [],
    reports: input.qualityReports,
  })
  const source = sourceState(quality)
  const tasks = input.longTasks ?? []
  const failedTaskCount = tasks.filter((task) => task.status === 'failed' || task.status === 'canceled').length
  const activeTaskCount = tasks.filter((task) => task.status === 'pending' || task.status === 'running').length
  const pilotEpisodes = coverageByKey(pilotCoverage, 'episodes')
  const pilotScripts = coverageByKey(pilotCoverage, 'scripts')
  const pilotScenes = coverageByKey(pilotCoverage, 'scenes')
  const pilotShots = coverageByKey(pilotCoverage, 'shots')
  const pilotVideo = coverageByKey(pilotCoverage, 'video')
  const storyboardComplete = pilotScenes.complete && pilotShots.complete
  // 人工试播审核至少需要每一集都有一个已明确选中的视频候选；单有剧本和分镜
  // 只能说明生产准备完成，不能作为“试播通过”的依据。
  const pilotCandidateReady = pilotEpisodes.complete && pilotScripts.complete && storyboardComplete && pilotVideo.complete
  const stages: PilotProductionStage[] = [
    {
      key: 'scripts',
      label: '剧本',
      state: pilotEpisodes.complete ? (pilotScripts.complete ? 'complete' : 'in_progress') : 'blocked',
      completed: pilotScripts.completed,
      target: pilotScripts.target,
      detail: pilotEpisodes.complete ? pilotScripts.detail : `先补齐试播分集（${pilotEpisodes.detail}）`,
    },
    {
      key: 'storyboard',
      label: '分镜',
      state: pilotScripts.complete ? (storyboardComplete ? 'complete' : 'in_progress') : 'blocked',
      completed: Math.min(pilotScenes.completed, pilotShots.completed),
      target: pilotEpisodes.target,
      detail: pilotScripts.complete ? `场景 ${pilotScenes.detail} · 镜头 ${pilotShots.detail}` : '先完成试播剧本',
    },
    {
      key: 'assets',
      label: '图片/资产',
      state: 'capability_gap',
      detail: '能力未安装：尚无第一等图片资产与角色一致性生产包',
    },
    {
      key: 'video',
      label: '视频候选',
      state: storyboardComplete ? (pilotVideo.complete ? 'complete' : 'in_progress') : 'blocked',
      completed: pilotVideo.completed,
      target: pilotVideo.target,
      detail: storyboardComplete ? `${pilotVideo.detail}（仅代表每集至少一个已选候选）` : '先准备试播镜头',
    },
    {
      key: 'audio',
      label: '配音/音频',
      state: 'capability_gap',
      detail: '能力未安装：暂无 TTS、配音、BGM 或音效时间线',
    },
    {
      key: 'edit',
      label: '剪辑',
      state: 'capability_gap',
      detail: '能力未安装：暂无剪辑工程、字幕轨与合成时间线',
    },
    {
      key: 'quality',
      label: '质量闸门',
      state: source.state === 'approved' ? 'complete' : 'blocked',
      detail: source.detail,
    },
    {
      key: 'delivery',
      label: '最终交付',
      state: 'capability_gap',
      detail: '能力未安装：候选视频不是带音频、字幕和质检的最终交付',
    },
  ]
  const blockers: string[] = []
  if (source.state !== 'approved') blockers.push(`源版本：${source.detail}`)
  if (!pilotEpisodes.complete) blockers.push(`试播范围缺少分集大纲（${pilotEpisodes.detail}）`)
  else if (!pilotScripts.complete) blockers.push(`试播范围缺少剧本（${pilotScripts.detail}）`)
  else if (!storyboardComplete) blockers.push(`试播范围缺少场景或镜头（场景 ${pilotScenes.detail}；镜头 ${pilotShots.detail}）`)
  else if (!pilotVideo.complete) blockers.push(`试播范围缺少已选视频候选（${pilotVideo.detail}）`)
  if (failedTaskCount > 0) blockers.push(`任务失败/取消 ${failedTaskCount} 个，请在任务中心处理`)
  blockers.push('版权：未建立版权与授权台账（当前不能据此宣告可交付）')
  blockers.push('费用：预计与实际成本账本未安装，费用未知')
  blockers.push('最终交付：图片、音频、剪辑与交付能力未安装')
  let nextAction = `补齐第 ${pilotEpisodeNumbers.join('、')} 集分集大纲`
  if (pilotEpisodes.complete && !pilotScripts.complete) nextAction = `生成或审阅第 ${pilotEpisodeNumbers.join('、')} 集剧本`
  else if (pilotScripts.complete && !storyboardComplete) nextAction = `拆分第 ${pilotEpisodeNumbers.join('、')} 集场景与镜头`
  else if (storyboardComplete && !pilotVideo.complete) nextAction = `为第 ${pilotEpisodeNumbers.join('、')} 集选择视频候选`
  else if (source.state !== 'approved') nextAction = '重新运行项目质量闸门并人工处理阻塞项'
  else if (pilotCandidateReady) nextAction = '进行人工试播审核；通过后才可复制 Profile 到后续计划'

  return {
    targetEpisodeCount,
    pilotEpisodeNumbers,
    coverage,
    pilotCoverage,
    source,
    stages,
    blockers,
    failedTaskCount,
    activeTaskCount,
    nextAction,
    costDetail: '费用未知：预计与实际成本账本将在后续生产谱系模块提供。',
    rightsDetail: '版权未知：尚未建立授权台账，不能将当前产物标记为可发布。',
    canCreateExpansionPlan: pilotCandidateReady && source.state === 'approved' && failedTaskCount === 0,
  }
}
