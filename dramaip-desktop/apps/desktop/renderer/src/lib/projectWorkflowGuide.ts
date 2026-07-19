import type {
  AdaptationProject,
  Chapter,
  Character,
  Episode,
  Outline,
  Project,
  QualityGateReport,
  Scene,
  Script,
  Shot,
  VideoGenerationTask,
  VideoResult,
} from '@sdns/core'
import { buildProjectQualityGateTruth } from './qualityGateTruth'

export type ProjectWorkflowStageKey =
  | 'setup'
  | 'characters'
  | 'outline'
  | 'chapters'
  | 'quality'
  | 'adaptation'
  | 'scripts'
  | 'shots'
  | 'video'

export type ProjectWorkflowStageStatus = 'done' | 'active' | 'todo'

export interface ProjectWorkflowSnapshot {
  project: Project
  chapters: Chapter[]
  characters: Character[]
  outlines: Outline[]
  qualityReports: QualityGateReport[]
  adaptations: AdaptationProject[]
  /** 当前项目明确选择的改编；其下游数组只包含这一项的数据。 */
  activeAdaptation?: AdaptationProject
  episodes: Episode[]
  scripts: Script[]
  scenes: Scene[]
  shots: Shot[]
  videoTasks: VideoGenerationTask[]
  videoResults: VideoResult[]
}

export interface ProjectWorkflowStage {
  key: ProjectWorkflowStageKey
  title: string
  detail: string
  complete: boolean
  status: ProjectWorkflowStageStatus
  actionLabel: string
}

export interface VideoDeliveryTruth {
  complete: boolean
  successfulTaskCount: number
  usableResultCount: number
  bestResultCount: number
  pendingTaskCount: number
  failedTaskCount: number
  detail: string
}

function hasText(value?: string): boolean {
  return Boolean(value?.trim())
}

function withStatus(stages: Omit<ProjectWorkflowStage, 'status'>[]): ProjectWorkflowStage[] {
  const firstOpen = stages.findIndex((stage) => !stage.complete)
  return stages.map((stage, index) => ({
    ...stage,
    status: stage.complete ? 'done' : index === firstOpen ? 'active' : 'todo',
  }))
}

export function buildProjectWorkflowStages(snapshot: ProjectWorkflowSnapshot): ProjectWorkflowStage[] {
  const {
    project,
    chapters,
    characters,
    outlines,
    qualityReports,
    activeAdaptation,
    episodes,
    scripts,
    scenes,
    shots,
    videoTasks,
    videoResults,
  } = snapshot

  const chaptersWithContent = chapters.filter((chapter) => hasText(chapter.content))
  const bookOutlineCount = outlines.filter((outline) => outline.type === 'book' && hasText(outline.content)).length
  const chapterOutlineCount = outlines.filter((outline) => outline.type === 'chapter' && hasText(outline.content)).length
  // 即使调用方误把多季数组传入，也只用当前改编的完整下游链路计算进度。
  const scopedEpisodes = activeAdaptation
    ? episodes.filter((episode) => episode.adaptationProjectId === activeAdaptation.id)
    : episodes
  const scopedEpisodeIds = new Set(scopedEpisodes.map((episode) => episode.id))
  const scopedScripts = activeAdaptation
    ? scripts.filter((script) => script.adaptationProjectId === activeAdaptation.id)
    : scripts
  const scopedScriptIds = new Set(scopedScripts.map((script) => script.id))
  const scopedScenes = activeAdaptation
    ? scenes.filter((scene) => scopedScriptIds.has(scene.scriptId))
    : scenes
  const scopedSceneIds = new Set(scopedScenes.map((scene) => scene.id))
  const scopedShots = activeAdaptation
    ? shots.filter((shot) => scopedSceneIds.has(shot.sceneId) || scopedEpisodeIds.has(shot.episodeId))
    : shots
  const scopedShotIds = new Set(scopedShots.map((shot) => shot.id))
  const scopedVideoTasks = activeAdaptation
    ? videoTasks.filter((task) =>
      (task.episodeId && scopedEpisodeIds.has(task.episodeId)) ||
      (task.sceneId && scopedSceneIds.has(task.sceneId)) ||
      (task.shotId && scopedShotIds.has(task.shotId)),
    )
    : videoTasks
  const scopedVideoTaskIds = new Set(scopedVideoTasks.map((task) => task.id))
  const scopedVideoResults = activeAdaptation
    ? videoResults.filter((result) => scopedVideoTaskIds.has(result.taskId))
    : videoResults
  const qualityTruth = buildProjectQualityGateTruth({
    project,
    chapters,
    characters,
    outlines,
    reports: qualityReports,
  })
  const videoTruth = buildVideoDeliveryTruth(scopedVideoTasks, scopedVideoResults)

  return withStatus([
    {
      key: 'setup',
      title: '设定',
      complete: hasText(project.coreHook) && hasText(project.synopsis),
      detail: hasText(project.coreHook) && hasText(project.synopsis)
        ? '已具备一句话卖点和故事简介'
        : '补齐一句话卖点和故事简介',
      actionLabel: '补设定',
    },
    {
      key: 'characters',
      title: '人物',
      complete: characters.length > 0,
      detail: characters.length > 0 ? `已有 ${characters.length} 张人物卡` : '创建主要人物卡',
      actionLabel: '写人物',
    },
    {
      key: 'outline',
      title: '大纲',
      complete: bookOutlineCount > 0 || chapterOutlineCount > 0,
      detail: bookOutlineCount > 0 || chapterOutlineCount > 0
        ? `全书大纲 ${bookOutlineCount} 份，章节大纲 ${chapterOutlineCount} 份`
        : '补齐全书或章节大纲',
      actionLabel: '写大纲',
    },
    {
      key: 'chapters',
      title: '章节',
      complete: chaptersWithContent.length > 0,
      detail: chaptersWithContent.length > 0
        ? `已有 ${chaptersWithContent.length}/${chapters.length} 章正文`
        : '至少完成一章正文',
      actionLabel: '写章节',
    },
    {
      key: 'quality',
      title: '质量闸门',
      complete: qualityTruth.state === 'current' && qualityTruth.report?.verdict !== 'block',
      detail: qualityTruth.detail,
      actionLabel: '查质量',
    },
    {
      key: 'adaptation',
      title: '改编',
      complete: Boolean(activeAdaptation && scopedEpisodes.length > 0),
      detail: activeAdaptation
        ? `当前第 ${activeAdaptation.seasonNumber ?? 1} 季「${activeAdaptation.title}」，分集 ${scopedEpisodes.length} 集`
        : '创建短剧改编项目',
      actionLabel: activeAdaptation ? '看分集' : '建改编',
    },
    {
      key: 'scripts',
      title: '剧本',
      complete: scopedScripts.length > 0,
      detail: scopedScripts.length > 0 ? `已有 ${scopedScripts.length} 集剧本` : '生成或编写分集剧本',
      actionLabel: '写剧本',
    },
    {
      key: 'shots',
      title: '分镜',
      complete: scopedScenes.length > 0 && scopedShots.length > 0,
      detail: scopedShots.length > 0 ? `场景 ${scopedScenes.length} 个，镜头 ${scopedShots.length} 个` : '拆分场景和镜头',
      actionLabel: '拆分镜',
    },
    {
      key: 'video',
      title: '视频',
      complete: videoTruth.complete,
      detail: videoTruth.detail,
      actionLabel: '做视频',
    },
  ])
}

export function buildVideoDeliveryTruth(videoTasks: VideoGenerationTask[], videoResults: VideoResult[]): VideoDeliveryTruth {
  const successfulTaskIds = new Set(videoTasks.filter((task) => task.status === 'success').map((task) => task.id))
  const usableResults = videoResults.filter((result) => {
    if (!successfulTaskIds.has(result.taskId)) return false
    return Boolean(result.localVideoPath?.trim() || result.resultVideoUrl.trim() || result.remoteVideoUrl?.trim())
  })
  const usableResultCount = usableResults.length
  const bestResultCount = usableResults.filter((result) => result.isBest).length
  const successfulTaskCount = successfulTaskIds.size
  const pendingTaskCount = videoTasks.filter((task) => task.status === 'pending' || task.status === 'running').length
  const failedTaskCount = videoTasks.filter((task) => task.status === 'failed' || task.status === 'canceled').length
  if (bestResultCount > 0) {
    const suffix = pendingTaskCount || failedTaskCount ? `；另有进行中 ${pendingTaskCount} 个、失败/取消 ${failedTaskCount} 个` : ''
    return {
      complete: true,
      successfulTaskCount,
      usableResultCount,
      bestResultCount,
      pendingTaskCount,
      failedTaskCount,
      detail: `成功任务 ${successfulTaskCount} 个，已选最佳视频 ${bestResultCount} 个${suffix}`,
    }
  }
  if (usableResultCount > 0) {
    return {
      complete: false,
      successfulTaskCount,
      usableResultCount,
      bestResultCount,
      pendingTaskCount,
      failedTaskCount,
      detail: `成功任务 ${successfulTaskCount} 个，可用视频结果 ${usableResultCount} 个，待选择最佳交付版本`,
    }
  }
  if (successfulTaskCount > 0) {
    return {
      complete: false,
      successfulTaskCount,
      usableResultCount,
      bestResultCount,
      pendingTaskCount,
      failedTaskCount,
      detail: `成功任务 ${successfulTaskCount} 个，但没有可用视频结果`,
    }
  }
  if (videoTasks.length > 0) {
    return {
      complete: false,
      successfulTaskCount,
      usableResultCount,
      bestResultCount,
      pendingTaskCount,
      failedTaskCount,
      detail: `视频任务 ${videoTasks.length} 个，进行中 ${pendingTaskCount} 个，失败/取消 ${failedTaskCount} 个`,
    }
  }
  return {
    complete: false,
    successfulTaskCount,
    usableResultCount,
    bestResultCount,
    pendingTaskCount,
    failedTaskCount,
    detail: '创建视频生成任务并产出可用结果',
  }
}
