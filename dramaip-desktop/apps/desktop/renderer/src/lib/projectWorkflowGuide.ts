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
} from '@sdns/core'

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
  episodes: Episode[]
  scripts: Script[]
  scenes: Scene[]
  shots: Shot[]
  videoTasks: VideoGenerationTask[]
}

export interface ProjectWorkflowStage {
  key: ProjectWorkflowStageKey
  title: string
  detail: string
  complete: boolean
  status: ProjectWorkflowStageStatus
  actionLabel: string
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
    adaptations,
    episodes,
    scripts,
    scenes,
    shots,
    videoTasks,
  } = snapshot

  const chaptersWithContent = chapters.filter((chapter) => hasText(chapter.content))
  const bookOutlineCount = outlines.filter((outline) => outline.type === 'book' && hasText(outline.content)).length
  const chapterOutlineCount = outlines.filter((outline) => outline.type === 'chapter' && hasText(outline.content)).length
  const latestQualityGate = qualityReports[0]
  const blockingIssueCount = qualityReports.reduce((sum, report) => sum + report.blockingIssues.length, 0)
  const successfulVideoTasks = videoTasks.filter((task) => task.status === 'success').length

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
      complete: qualityReports.length > 0 && blockingIssueCount === 0,
      detail: qualityReports.length > 0
        ? `${latestQualityGate?.verdict ?? '已检查'}，阻塞项 ${blockingIssueCount} 个`
        : '运行质量闸门检查',
      actionLabel: '查质量',
    },
    {
      key: 'adaptation',
      title: '改编',
      complete: adaptations.length > 0 && episodes.length > 0,
      detail: adaptations.length > 0
        ? `改编项目 ${adaptations.length} 个，分集 ${episodes.length} 集`
        : '创建短剧改编项目',
      actionLabel: adaptations.length > 0 ? '看分集' : '建改编',
    },
    {
      key: 'scripts',
      title: '剧本',
      complete: scripts.length > 0,
      detail: scripts.length > 0 ? `已有 ${scripts.length} 集剧本` : '生成或编写分集剧本',
      actionLabel: '写剧本',
    },
    {
      key: 'shots',
      title: '分镜',
      complete: scenes.length > 0 && shots.length > 0,
      detail: shots.length > 0 ? `场景 ${scenes.length} 个，镜头 ${shots.length} 个` : '拆分场景和镜头',
      actionLabel: '拆分镜',
    },
    {
      key: 'video',
      title: '视频',
      complete: videoTasks.length > 0,
      detail: videoTasks.length > 0
        ? `视频任务 ${videoTasks.length} 个，成功 ${successfulVideoTasks} 个`
        : '创建视频生成任务',
      actionLabel: '做视频',
    },
  ])
}
