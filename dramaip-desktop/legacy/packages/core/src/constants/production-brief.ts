import type {
  ProductionAspectRatio,
  ProductionBudgetTier,
  ProductionPlatform,
  ProductionPresentation,
  ProductionRegion,
  Project,
  ProjectCreationGoal,
  ProjectProductionBrief,
  ProjectProductionProfile,
} from '../types'

export const PROJECT_CREATION_GOAL_OPTIONS: Array<{ value: ProjectCreationGoal; label: string; description: string }> = [
  { value: 'novel_to_drama', label: '从灵感写小说', description: '先明确故事与人物，再转为漫剧/短剧。' },
  { value: 'adapt_existing_ip', label: '导入已有小说 / IP', description: '先建受权项目与生产目标；正文导入在下一步完成。' },
  { value: 'direct_drama', label: '直接制作漫剧', description: '跳过小说章节，直接建立第一季与剧本生产路径。' },
]

export const PRODUCTION_PRESENTATION_OPTIONS: Array<{ value: ProductionPresentation; label: string }> = [
  { value: 'ai_2d_animation', label: 'AI 2D 漫剧' },
  { value: 'ai_3d_animation', label: 'AI 3D 动画' },
  { value: 'live_action_style', label: '仿真人 / 实拍感' },
  { value: 'motion_comic', label: '动态漫画' },
  { value: 'static_story', label: '静态解说' },
]

export const PRODUCTION_PLATFORM_OPTIONS: Array<{ value: ProductionPlatform; label: string }> = [
  { value: 'short_video_vertical', label: '短视频竖屏' },
  { value: 'short_drama_app', label: '短剧 App' },
  { value: 'video_platform', label: '长视频 / 社区平台' },
]

export const PRODUCTION_REGION_OPTIONS: Array<{ value: ProductionRegion; label: string }> = [
  { value: 'mainland_china', label: '中国大陆' },
  { value: 'global_chinese', label: '全球华语' },
  { value: 'overseas', label: '海外市场' },
]

export const PRODUCTION_ASPECT_RATIO_OPTIONS: Array<{ value: ProductionAspectRatio; label: string }> = [
  { value: '9:16', label: '9:16 竖屏' },
  { value: '16:9', label: '16:9 横屏' },
  { value: '1:1', label: '1:1 方形' },
]

export const PRODUCTION_BUDGET_TIER_OPTIONS: Array<{ value: ProductionBudgetTier; label: string }> = [
  { value: 'starter', label: '试播 / 低预算' },
  { value: 'standard', label: '标准制作' },
  { value: 'premium', label: '高规格制作' },
]

export const PRODUCTION_DURATION_OPTIONS = [
  { minSeconds: 30, maxSeconds: 60, label: '30–60 秒' },
  { minSeconds: 60, maxSeconds: 120, label: '60–120 秒' },
  { minSeconds: 120, maxSeconds: 180, label: '120–180 秒' },
] as const

const DEFAULT_PROFILE_BY_GOAL: Record<ProjectCreationGoal, ProjectProductionProfile> = {
  novel_to_drama: {
    presentation: 'ai_2d_animation',
    platform: 'short_video_vertical',
    region: 'mainland_china',
    aspectRatio: '9:16',
    episodeDuration: { minSeconds: 60, maxSeconds: 120 },
    pilotEpisodeCount: 3,
    budgetTier: 'standard',
  },
  adapt_existing_ip: {
    presentation: 'ai_2d_animation',
    platform: 'short_drama_app',
    region: 'mainland_china',
    aspectRatio: '9:16',
    episodeDuration: { minSeconds: 60, maxSeconds: 120 },
    pilotEpisodeCount: 3,
    budgetTier: 'standard',
  },
  direct_drama: {
    presentation: 'motion_comic',
    platform: 'short_video_vertical',
    region: 'mainland_china',
    aspectRatio: '9:16',
    episodeDuration: { minSeconds: 30, maxSeconds: 60 },
    pilotEpisodeCount: 3,
    budgetTier: 'starter',
  },
}

function nextStepFor(goal: ProjectCreationGoal): ProjectProductionBrief['nextStep'] {
  if (goal === 'adapt_existing_ip') return 'import_source'
  if (goal === 'direct_drama') return 'create_direct_adaptation'
  return 'write_or_plan'
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
}

/** 建立可编辑、可存档的生产简报；所有建议均可被用户覆盖。 */
export function createProjectProductionBrief(input: {
  creationGoal?: ProjectCreationGoal
  profile?: Partial<ProjectProductionProfile> & { episodeDuration?: Partial<ProjectProductionProfile['episodeDuration']> }
} = {}): ProjectProductionBrief {
  const creationGoal = input.creationGoal ?? 'novel_to_drama'
  const fallback = DEFAULT_PROFILE_BY_GOAL[creationGoal]
  const requestedDuration = input.profile?.episodeDuration
  const minSeconds = positiveInteger(requestedDuration?.minSeconds, fallback.episodeDuration.minSeconds)
  const maxSeconds = Math.max(minSeconds, positiveInteger(requestedDuration?.maxSeconds, fallback.episodeDuration.maxSeconds))
  return {
    version: 1,
    creationGoal,
    profile: {
      ...fallback,
      ...input.profile,
      episodeDuration: { minSeconds, maxSeconds },
      // 试播是验证生产路径的最小范围，而非缩小版整季排期。把历史或手工输入
      // 收敛到 1–3 集，避免一次操作意外扩展为整季高成本任务。
      pilotEpisodeCount: Math.min(3, positiveInteger(input.profile?.pilotEpisodeCount, fallback.pilotEpisodeCount)),
    },
    nextStep: nextStepFor(creationGoal),
  }
}

/** 旧项目读取时得到安全兼容 Profile，不写回也不改动其章节、季、集数或时长。 */
export function createCompatibleProjectProductionBrief(project: Pick<Project, 'productionBrief' | 'shortDramaType'>): ProjectProductionBrief {
  if (project.productionBrief) return createProjectProductionBrief(project.productionBrief)
  return createProjectProductionBrief({ creationGoal: 'novel_to_drama' })
}

export function formatProductionDuration(duration: ProjectProductionProfile['episodeDuration']): string {
  return duration.minSeconds === duration.maxSeconds
    ? `${duration.minSeconds} 秒`
    : `${duration.minSeconds}–${duration.maxSeconds} 秒`
}
