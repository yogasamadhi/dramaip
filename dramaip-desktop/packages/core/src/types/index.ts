// 核心领域类型 —— 对应 PROJECT_BRIEF.md §7 / §8 / §9 / §10

/** 短剧小说项目 */
export interface Project {
  id: string
  title: string
  shortDramaType: string
  targetAudience?: string
  targetWordCount?: number
  targetEpisodeCount?: number
  coreHook?: string
  emotionalCore?: string
  coreSellingPoint?: string
  synopsis?: string
  styleGuide?: string
  /** 视觉风格方向（PROJECT_BRIEF.md §5.2 / §7），面向 AI 短剧视频生成 */
  visualStyleDirection?: string
  /** 当前工作的改编项目；为空时由仓库按季号和更新时间确定兼容默认值。 */
  activeAdaptationId?: string
  createdAt: string
  updatedAt: string
}

/** 项目首页只读摘要：由本地数据库聚合，避免列表页 N×多次 IPC 请求。 */
export interface ProjectHomeSummary {
  project: Project
  chapterCount: number
  wordCount: number
  latestChapter?: { id: string; title: string; updatedAt: string }
  adaptation?: { id: string; title: string; episodeCount: number }
  blockerCount: number
  stage: 'setup' | 'writing' | 'adaptation'
  nextAction: { label: string; path: string }
}

/** 废纸篓中的项目。删除时间仅在废纸篓和彻底清理流程中暴露。 */
export interface TrashedProject extends Project {
  deletedAt: string
}

/** 最终清理前展示的关联数据规模，避免用户在不知情时永久丢失内容。 */
export interface ProjectDeletionPreview {
  project: TrashedProject
  dependencies: {
    chapters: number
    characters: number
    outlines: number
    storyArcs: number
    adaptations: number
    assets: number
    contentVersions: number
    creativeReports: number
  }
  totalRecords: number
}

/** 人物卡 */
export interface Character {
  id: string
  projectId: string
  name: string
  role: string
  identity?: string
  personality?: string
  desire?: string
  secret?: string
  weakness?: string
  arc?: string
  relationshipToProtagonist?: string
  conflictTarget?: string
  emotionalFunction?: string
  shortDramaFunction?: string
  /** 视觉描述（PROJECT_BRIEF.md §7 / §11.2） */
  visualDescription?: string
  /** 角色外观 Prompt（用于未来 AI 视频生成） */
  appearancePrompt?: string
  /** 负面 Prompt（用于未来 AI 视频生成） */
  negativePrompt?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

/** 大纲（全书 / 章节） */
export interface Outline {
  id: string
  projectId: string
  type: 'book' | 'chapter'
  title: string
  content: string
  orderIndex: number
  createdAt: string
  updatedAt: string
}

export type StoryArcKind = 'volume' | 'unit' | 'stage'

/** 长篇规划：卷 / 单元 / 剧情阶段 */
export interface StoryArc {
  id: string
  projectId: string
  parentId?: string
  kind: StoryArcKind
  title: string
  summary?: string
  targetWordCount?: number
  targetChapterCount?: number
  chapterStart?: number
  chapterEnd?: number
  coreConflict?: string
  keyHighlights: string[]
  foreshadowingPayoffs: string[]
  orderIndex: number
  createdAt: string
  updatedAt: string
}

export type ProjectSkillCategory = 'genre_pacing' | 'dialogue' | 'shot_prompt' | 'platform_delivery' | 'style' | 'custom'

/** 项目级创作规范 / Skill：按任务自动注入，也可在生成前手动固定或排除 */
export interface ProjectSkill {
  id: string
  projectId: string
  name: string
  category: ProjectSkillCategory
  description?: string
  /** 为空表示适用于所有 AI 任务 */
  taskTypes: NovelTaskType[]
  content: string
  priority: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/** 项目级 Agent 方案：组合全局 Agent、项目 Skills 和任务组模型覆盖，不修改全局内置预设 */
export interface ProjectAgentScheme {
  id: string
  projectId: string
  name: string
  description?: string
  /** 主 Agent 用于整合意见和作为方案的默认牵头视角 */
  primaryAgentId?: string
  /** 本项目方案启用的 Agent；为空表示回退全局启用 Agent */
  agentIds: string[]
  /** 本项目方案显式绑定的 Skills；为空表示按任务自动选择项目 Skills */
  skillIds: string[]
  /** 任务组 -> 模型配置 id；为空的任务组回退全局任务模型绑定或默认模型 */
  modelBindings: Record<string, string>
  active: boolean
  createdAt: string
  updatedAt: string
}

export type InspirationCardKind = 'opening' | 'relationship' | 'conflict' | 'reversal' | 'cliffhanger' | 'visual'
export type InspirationCardSourceKind = 'genre_preset' | 'case_study' | 'template' | 'anti_trope' | 'mobile_import'

/** 项目级灵感台收藏：卡片来源实时汇总，收藏保存一份轻量快照，便于重开/导出后仍可采用 */
export interface InspirationFavorite {
  id: string
  projectId: string
  cardKey: string
  sourceKind: InspirationCardSourceKind
  sourceId?: string
  kind: InspirationCardKind
  title: string
  pattern: string
  applyTo: string
  risk?: string
  createdAt: string
  updatedAt: string
}

export interface MobileInspirationImportInput {
  projectId: string
  content: string
  fileName?: string
}

export interface MobileInspirationImportSummary {
  imported: number
  skipped: number
  warnings: string[]
  favorites: InspirationFavorite[]
}

/** 章节 */
export interface Chapter {
  id: string
  projectId: string
  title: string
  orderIndex: number
  summary?: string
  outline?: string
  content: string
  mainConflict?: string
  hook?: string
  highlight?: string
  reversal?: string
  cliffhanger?: string
  shortDramaNote?: string
  /** AI 视频生成备注（PROJECT_BRIEF.md §7） */
  aiVideoNote?: string
  createdAt: string
  updatedAt: string
}

/** AI 短剧适配度评分（PROJECT_BRIEF.md §7 / §11.7） */
export interface Evaluation {
  id: string
  projectId: string
  chapterId?: string
  totalScore: number
  hookScore: number
  conflictScore: number
  reversalScore: number
  emotionScore: number
  visualizationScore: number
  aiVideoFeasibilityScore: number
  characterConsistencyScore: number
  shotClarityScore: number
  cliffhangerScore: number
  adaptationDifficultyScore: number
  issues: string[]
  suggestions: string[]
  rawResult?: string
  createdAt: string
}

/** AI 调用记录 */
export interface AiRun {
  id: string
  projectId?: string
  chapterId?: string
  graphName: string
  nodeName?: string
  type: string
  provider: string
  model: string
  input: string
  output: string
  status: 'success' | 'failed'
  errorMessage?: string
  tokenUsage?: number
  latencyMs?: number
  createdAt: string
}

export interface AiContextPreviewSection {
  title: string
  charCount: number
  estimatedTokens: number
  excerpt: string
}

export interface AiContextPreview {
  aiRunId: string
  taskType: string
  provider: string
  model: string
  status: AiRun['status']
  createdAt: string
  inputChars: number
  estimatedInputTokens: number
  contextChars: number
  estimatedContextTokens: number
  redacted: boolean
  sections: AiContextPreviewSection[]
}

export interface AiContextControlCollection {
  chapters?: string[]
  characters?: string[]
  storyArcs?: string[]
  projectSkills?: string[]
  caseStudies?: string[]
  visualProfiles?: string[]
}

export interface AiContextControls {
  pinned?: AiContextControlCollection
  excluded?: AiContextControlCollection
}

export interface AiBudgetSettings {
  id: 'global'
  singleRunTokenLimit?: number
  dailyTokenLimit?: number
  singleRunCostLimit?: number
  dailyCostLimit?: number
  costPer1kTokens: number
  currency: string
  updatedAt: string
}

export interface AiRunUsageSummaryRow {
  taskGroup: string
  taskGroupLabel: string
  model: string
  provider: string
  successCount: number
  failedCount: number
  totalTokens: number
  totalLatencyMs: number
  estimatedCost: number
}

export type LongTaskKind = 'ai' | 'video' | 'batch'
export type LongTaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'canceled'

export type BatchGenerationKind = 'scripts' | 'shots'
export type BatchTaskItemStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'canceled'
export type BatchTaskTargetKind = 'episode' | 'scene'

export interface BatchTaskItem {
  key: string
  label: string
  targetKind: BatchTaskTargetKind
  targetId: string
  episodeId?: string
  sceneId?: string
  taskType: NovelTaskType
  status: BatchTaskItemStatus
  aiRunId?: string
  longTaskId?: string
  error?: string
  updatedAt?: string
}

export interface BatchTaskProgress extends Record<string, unknown> {
  kind: BatchGenerationKind
  title: string
  total: number
  pending: number
  running: number
  success: number
  failed: number
  skipped: number
  canceled: number
  items: BatchTaskItem[]
  updatedAt: string
}

export interface LongTask {
  id: string
  kind: LongTaskKind
  status: LongTaskStatus
  title: string
  taskType?: string
  projectId?: string
  adaptationProjectId?: string
  episodeId?: string
  sceneId?: string
  shotId?: string
  relatedEntityId?: string
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  errorMessage?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
}

export type GlobalSearchResultKind = 'project' | 'character' | 'chapter' | 'script' | 'scene' | 'shot' | 'ai_run'

export interface GlobalSearchResult {
  id: string
  kind: GlobalSearchResultKind
  title: string
  subtitle?: string
  snippet?: string
  route: string
  projectId?: string
  updatedAt?: string
}

export interface GlobalSearchResponse {
  query: string
  results: GlobalSearchResult[]
  total: number
}

// ---------------------------------------------------------------------------
// v0.2 长篇一致性与视觉记忆系统（ROADMAP v0.2 §1-6）
// ---------------------------------------------------------------------------

/** 章节记忆（每章摘要 + 重要事件/人物变化/揭露秘密/伏笔/视觉元素） */
export interface ChapterMemory {
  id: string
  projectId: string
  chapterId: string
  summary: string
  importantEvents: string[]
  characterChanges: string[]
  revealedSecrets: string[]
  newForeshadowing: string[]
  resolvedForeshadowing: string[]
  keyVisualElements: string[]
  createdAt: string
  updatedAt: string
}

/** 人物状态快照 */
export interface CharacterState {
  id: string
  projectId: string
  characterId: string
  chapterId?: string
  currentStatus: string
  emotionalState?: string
  relationshipChanges?: string
  knownSecrets?: string[]
  hiddenSecrets?: string[]
  visualContinuityNotes?: string
  createdAt: string
}

/** 人物视觉档案（面向后续 AI 视频角色一致性） */
export interface CharacterVisualProfile {
  id: string
  projectId: string
  characterId: string
  appearancePrompt: string
  castingPrompt?: string
  faceDescription?: string
  hairstyle?: string
  clothingStyle?: string
  bodyType?: string
  ageLook?: string
  temperament?: string
  colorPalette?: string
  negativePrompt?: string
  referenceImageUrl?: string
  actorReferenceUrl?: string
  voiceTone?: string
  voiceSampleUrl?: string
  createdAt: string
  updatedAt: string
}

/** 世界 / 场景视觉设定 */
export interface VisualSetting {
  id: string
  projectId: string
  title: string
  type: 'world' | 'location' | 'style' | 'object'
  visualPrompt: string
  negativePrompt?: string
  referenceImageUrl?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

/** 故事事件（时间线） */
export interface StoryEvent {
  id: string
  projectId: string
  chapterId?: string
  title: string
  description: string
  eventType: 'conflict' | 'reveal' | 'reversal' | 'relationship' | 'foreshadowing' | 'payoff' | 'visual' | 'other'
  relatedCharacterIds: string[]
  orderIndex: number
  createdAt: string
}

/** 伏笔 */
export interface Foreshadowing {
  id: string
  projectId: string
  title: string
  setupChapterId?: string
  payoffChapterId?: string
  status: 'planned' | 'setup' | 'paid_off' | 'abandoned'
  description: string
  payoffPlan?: string
  relatedCharacterIds?: string[]
  createdAt: string
  updatedAt: string
}

/** 一致性检查结果（不落库为实体，仅回传 UI） */
export interface ConsistencyResult {
  issues: string[]
  suggestions: string[]
}

// ---------------------------------------------------------------------------
// v0.3 AI 短剧小说强化系统（ROADMAP v0.3 §2-4）
// ---------------------------------------------------------------------------

/** 戏剧节拍（将章节拆成 beat，为分集/分镜做准备） */
export interface Beat {
  id: string
  projectId: string
  chapterId?: string
  type: 'hook' | 'conflict' | 'reversal' | 'reveal' | 'emotion' | 'payoff' | 'cliffhanger' | 'visual'
  title: string
  description: string
  dramaValue: number
  visualValue: number
  orderIndex: number
  relatedCharacterIds?: string[]
  createdAt: string
}

/** 爽点分析（每章一份） */
export interface HighlightAnalysis {
  id: string
  projectId: string
  chapterId: string
  faceSlap: number
  revenge: number
  identityReveal: number
  misunderstandingCleared: number
  pampering: number
  counterKill: number
  counterattack: number
  angst: number
  highlightTypes: string[]
  summary: string
  suggestions?: string
  createdAt: string
  updatedAt: string
}

/** AI 视频可行性报告（每章一份） */
export interface AiVideoFeasibilityReport {
  id: string
  projectId: string
  chapterId: string
  characterCountScore: number
  actionComplexityScore: number
  interactionDensityScore: number
  sceneStabilityScore: number
  visualClarityScore: number
  characterConsistencyScore: number
  generatableScore: number
  verticalSuitabilityScore: number
  promptControllabilityScore: number
  overallScore: number
  risks: string[]
  suggestions: string[]
  createdAt: string
  updatedAt: string
}

/** 全书 AI 短剧适配趋势报告（每项目一份） */
export interface DramaTrendReport {
  id: string
  projectId: string
  hookTrend: number[]
  conflictTrend: number[]
  reversalTrend: number[]
  emotionTrend: number[]
  cliffhangerTrend: number[]
  visualizationTrend: number[]
  aiVideoFeasibilityTrend: number[]
  characterConsistencyTrend: number[]
  shotClarityTrend: number[]
  overallTrend: number[]
  summary: string
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// v0.4 小说 / 大纲转 AI 短剧分集大纲（ROADMAP v0.4 §1/§3 + episode_analyses）
// ---------------------------------------------------------------------------

/** AI 短剧改编项目 */
export interface AdaptationProject {
  id: string
  sourceProjectId?: string
  title: string
  targetEpisodeCount: number
  episodeDuration?: string
  adaptationStyle: string
  visualStyleDirection?: string
  audience?: string
  /** 第几季（多季连载：200~300 章小说 → 4~6 季短剧），默认 1 */
  seasonNumber?: number
  /** 本季改编的源小说章节范围（1-based 闭区间）。如第 1 季 = 第 1~50 章 */
  sourceChapterRange?: ChapterRange
  /** 改编策略报告（AI 生成后由用户确认保存，JSON 文本） */
  strategy?: string
  createdAt: string
  updatedAt: string
}

/** 章节范围（1-based 闭区间，用于多季切片） */
export interface ChapterRange {
  from: number
  to: number
}

/** 分集大纲 */
export interface Episode {
  id: string
  adaptationProjectId: string
  episodeNumber: number
  title: string
  summary: string
  hook: string
  mainConflict: string
  reversal?: string
  emotionalBeat?: string
  cliffhanger: string
  aiVideoNote?: string
  keyVisuals: string[]
  relatedChapterIds?: string[]
  relatedBeatIds?: string[]
  createdAt: string
  updatedAt: string
}

/** 前 10 集分析结果（每改编项目一份） */
export interface EpisodeAnalysis {
  id: string
  adaptationProjectId: string
  hookStrengthTrend: number[]
  retentionScoreTrend: number[]
  paceScoreTrend: number[]
  reversalDensityTrend: number[]
  visualAppealTrend: number[]
  summary: string
  suggestions?: string
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// v0.5 AI 短剧剧本生成（ROADMAP v0.5 §1/§2 + script_reviews）
// ---------------------------------------------------------------------------

/** AI 短剧剧本（每集一份，挂在改编项目 + 某集分集大纲下） */
export interface Script {
  id: string
  adaptationProjectId: string
  episodeId: string
  episodeNumber: number
  title: string
  /** 剧本正文（Markdown 文本，含场景/画面/动作/对白/旁白/AI视频备注） */
  content: string
  /** 本集开场钩子（剧本头摘要） */
  hook?: string
  /** 本集核心冲突（剧本头摘要） */
  mainConflict?: string
  /** 本集情绪爆点（剧本头摘要） */
  emotionalBeat?: string
  /** 本集反转（剧本头摘要） */
  reversal?: string
  /** 本集结尾悬念（剧本头摘要） */
  cliffhanger?: string
  /** 预计时长（如「2分30秒」） */
  estimatedDuration?: string
  createdAt: string
  updatedAt: string
}

/** 剧本场景（由剧本拆分得到） */
export interface Scene {
  id: string
  scriptId: string
  episodeId: string
  sceneNumber: number
  title: string
  location: string
  timeOfDay?: string
  /** 画面描述 */
  visualDescription: string
  /** 出场人物名（来自剧本文本，字符串数组） */
  characters: string[]
  /** 场景摘要 */
  summary: string
  orderIndex: number
  createdAt: string
  updatedAt: string
}

/** 剧本审稿结果（每集一份，覆盖更新） */
export interface ScriptReview {
  id: string
  scriptId: string
  /** 开场是否抓人 */
  hookStrengthScore: number
  /** 对白是否短剧化 */
  dialogueScore: number
  /** 冲突是否足够 */
  conflictScore: number
  /** 画面是否清晰 */
  visualClarityScore: number
  /** 场景是否清楚 */
  sceneClarityScore: number
  /** 人物是否符合设定 */
  characterFitScore: number
  /** 是否适合后续拆成镜头 */
  shotReadinessScore: number
  /** 是否适合 AI 视频生成 */
  aiVideoFeasibilityScore: number
  /** 结尾是否有悬念 */
  cliffhangerScore: number
  /** 综合得分 */
  overallScore: number
  issues: string[]
  suggestions: string[]
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// v0.6 分镜与镜头 Prompt 生成（ROADMAP v0.6 §1 + shot_reviews + prompt_versions）
// ---------------------------------------------------------------------------

/** AI 生成难度 */
export type AiVideoDifficulty = 'low' | 'medium' | 'high'

/** 镜头（由场景拆分得到，是 AI 视频平台的最小生成单元） */
export interface Shot {
  id: string
  sceneId: string
  episodeId: string
  shotNumber: number
  /** 时长（秒），可选 */
  durationSeconds?: number

  /** 画面描述 */
  visualDescription: string
  /** 出场人物名（字符串数组） */
  characterIds: string[]
  /** 本镜头对白 */
  dialogue?: string
  /** 本镜头旁白 */
  narration?: string
  /** 字幕草稿（SRT/VTT/纯文本均可，供交付前人工整理） */
  subtitleDraft?: string

  /** 镜头角度（如「特写」「中景」） */
  cameraAngle?: string
  /** 镜头运动（如「推镜头」「跟随」） */
  cameraMovement?: string
  /** 情绪（如「愤怒」「震惊」） */
  emotion?: string
  /** 动作描述 */
  action?: string

  /** 视频 Prompt（面向 AI 视频平台） */
  videoPrompt: string
  /** 负面 Prompt */
  negativePrompt?: string
  /** 图片 Prompt（首帧/关键帧，可选） */
  imagePrompt?: string
  /** 封面 Prompt（用于封面图或视频封面草稿） */
  coverPrompt?: string

  /** 角色/场景一致性提示 */
  consistencyNotes?: string
  /** AI 视频生成难度 */
  aiVideoDifficulty?: AiVideoDifficulty

  createdAt: string
  updatedAt: string
}

/** 镜头审查结果（每镜头一份，覆盖更新） */
export interface ShotReview {
  id: string
  shotId: string
  /** 镜头是否过长 */
  lengthScore: number
  /** 人物数量是否过多 */
  characterCountScore: number
  /** 动作是否过于复杂 */
  actionComplexityScore: number
  /** 画面描述是否明确 */
  visualClarityScore: number
  /** 角色一致性风险（越高越好，即风险越低） */
  characterConsistencyScore: number
  /** 场景连续性风险（越高越好） */
  sceneContinuityScore: number
  /** Prompt 是否可控 */
  promptControllabilityScore: number
  /** 是否适合竖屏短剧 */
  verticalSuitabilityScore: number
  /** 综合得分 */
  overallScore: number
  /** AI 视频生成难度评级 */
  aiVideoDifficulty: AiVideoDifficulty
  issues: string[]
  suggestions: string[]
  createdAt: string
  updatedAt: string
}

/** Prompt 版本（每次生成/改写一个镜头 Prompt 时追加一条快照，便于回溯对比） */
export interface PromptVersion {
  id: string
  shotId: string
  /** 版本号（从 1 递增） */
  version: number
  /** 本版本任务类型（记录是生成/负面/优化哪种产物） */
  taskType: string
  videoPrompt: string
  negativePrompt?: string
  imagePrompt?: string
  /** 备注（如优化目标、目标平台） */
  note?: string
  createdAt: string
}

// ---------------------------------------------------------------------------
// v0.7 AI 视频平台对接（ROADMAP v0.7 §1-2）
// ---------------------------------------------------------------------------

/** 视频生成 Provider 类型预设 */
export type VideoProviderKind =
  | 'mock'
  | 'jimeng'
  | 'kling'
  | 'hailuo'
  | 'wan'
  | 'runway'
  | 'pika'
  | 'openai_sora'
  | 'custom'

/** 视频生成 Provider 配置（对应 video_provider_configs 表） */
export interface VideoProviderConfig {
  id: string
  name: string
  /** Provider 种类（决定调用哪个适配器） */
  kind: VideoProviderKind
  baseUrl?: string
  apiKey?: string
  /** 默认模型名（如 kling-v2 / runway-gen4） */
  model?: string
  /** 默认生成参数（JSON 文本：宽高比、时长、分辨率等） */
  defaultParams?: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

/** 视频生成任务状态 */
export type VideoTaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'canceled'

/** 视频生成任务（对应 video_generation_tasks 表，ROADMAP v0.7 §2） */
export interface VideoGenerationTask {
  id: string
  projectId?: string
  episodeId?: string
  sceneId?: string
  shotId?: string

  provider: string
  model: string
  prompt: string
  negativePrompt?: string
  /** 参考图 URL（首帧/角色参考） */
  referenceImageUrls: string[]

  status: VideoTaskStatus
  /** 平台侧任务 id（轮询用） */
  remoteTaskId?: string
  errorMessage?: string

  /** 用户备注（如「版本A」用于对比） */
  note?: string

  createdAt: string
  updatedAt: string
}

/** 视频生成结果（对应 video_results 表，一个任务可有多个结果，便于对比/择优） */
export interface VideoResult {
  id: string
  taskId: string
  shotId?: string
  /** 结果视频 URL（平台返回或本地路径） */
  resultVideoUrl: string
  /** 平台返回的原始视频 URL，用于重下或诊断 */
  remoteVideoUrl?: string
  /** 已归档到本机的绝对文件路径 */
  localVideoPath?: string
  /** 封面图 URL（可选） */
  coverImageUrl?: string
  /** 平台返回的原始封面 URL */
  remoteCoverImageUrl?: string
  /** 已归档到本机的封面绝对文件路径 */
  localCoverImagePath?: string
  /** 平台返回的原始元数据（JSON 文本） */
  rawMeta?: string
  /** 本地归档完成时间 */
  archivedAt?: string
  /** 本地归档失败原因；存在时仍保留远端 URL */
  archiveError?: string
  /** 是否被标记为本镜头最佳结果 */
  isBest: boolean
  note?: string
  createdAt: string
}

/** 视频生成任务输入（VideoProvider.createTask 入参） */
export interface VideoGenerationInput {
  model: string
  prompt: string
  negativePrompt?: string
  referenceImageUrls?: string[]
  /** 透传的默认参数 */
  defaultParams?: string
}

// ---------------------------------------------------------------------------
// AI 视频 Provider 接口（ROADMAP v0.7 §1）
// ---------------------------------------------------------------------------

/** Provider 返回的精简任务态（与 VideoGenerationTask 的 status 对齐） */
export interface VideoProviderTaskState {
  status: VideoTaskStatus
  remoteTaskId?: string
  errorMessage?: string
  results: VideoProviderResult[]
}

/** Provider 返回的单个结果 */
export interface VideoProviderResult {
  resultVideoUrl: string
  coverImageUrl?: string
  rawMeta?: string
}

export interface VideoProvider {
  readonly kind: string
  readonly name: string
  /** Whether this concrete adapter has a documented provider-side cancellation endpoint. */
  readonly supportsRemoteCancel?: boolean
  /** 提交生成任务，返回平台任务 id 与初始状态 */
  createTask(input: VideoGenerationInput): Promise<VideoProviderTaskState>
  /** 查询任务状态（成功时带 results） */
  getTaskStatus(remoteTaskId: string): Promise<VideoProviderTaskState>
  /** 在 Provider 明确支持时取消远端任务；不支持的 Provider 不实现此方法。 */
  cancelTask?(remoteTaskId: string): Promise<void>
}

// ---------------------------------------------------------------------------
// v1.2 本地资产库
// ---------------------------------------------------------------------------

export type ProjectAssetKind =
  | 'character_reference'
  | 'casting_reference'
  | 'voice_reference'
  | 'scene_reference'
  | 'style_reference'
  | 'video_result'
  | 'cover_image'
  | 'first_frame_image'
  | 'narration_audio'
  | 'subtitle_file'
  | 'source_media'
  | 'other'
export type ProjectAssetStatus = 'available' | 'missing' | 'remote_only'
export type ProjectAssetPackagePolicy = 'exclude' | 'reference_only' | 'include_binary'
export type ProjectAssetSourceKind = 'project' | 'character' | 'visual_profile' | 'visual_setting' | 'episode' | 'script' | 'scene' | 'shot' | 'video_result' | 'manual'

export interface ProjectAsset {
  id: string
  projectId: string
  kind: ProjectAssetKind
  title: string
  description?: string
  sourceEntityKind?: ProjectAssetSourceKind
  sourceEntityId?: string
  localPath?: string
  relativePath?: string
  remoteUrl?: string
  mimeType?: string
  originalName?: string
  sha256?: string
  sizeBytes?: number
  width?: number
  height?: number
  durationSeconds?: number
  tags: string[]
  metadata: Record<string, unknown>
  status: ProjectAssetStatus
  packagePolicy: ProjectAssetPackagePolicy
  createdAt: string
  updatedAt: string
}

/** 模型配置（对应 model_configs 表，§8） */
export interface ModelConfig {
  id: string
  name: string
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// AI Provider 接口（§9）
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatInput {
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  responseFormat?: 'text' | 'json'
  signal?: AbortSignal
}

export interface ChatOutput {
  content: string
  raw?: unknown
  tokenUsage?: number
}

export interface LLMProvider {
  readonly name: string
  readonly model: string
  chat(input: ChatInput): Promise<ChatOutput>
  stream?(input: ChatInput): AsyncIterable<string>
}

// ---------------------------------------------------------------------------
// v1.1 创意诊断与反套路迭代系统
// ---------------------------------------------------------------------------

export type CreativeTargetKind = 'project' | 'chapter' | 'adaptation' | 'episode' | 'script' | 'scene' | 'shot'
export type AntiTropeMode = 'conservative' | 'balanced' | 'wild'
export type RevisionTaskStatus = 'open' | 'accepted' | 'preview_ready' | 'applied' | 'undone' | 'dismissed'
export type RevisionTaskPriority = 'must' | 'should' | 'could'
export type QualityGateStage = 'novel_to_adaptation' | 'episodes_to_scripts' | 'scripts_to_shots' | 'shots_to_video'
export type QualityGateVerdict = 'pass' | 'warn' | 'block'
export type ContentVersionSource = 'ai_overwrite' | 'adopt_preview' | 'revision_task' | 'manual_checkpoint' | 'restore'
export type WorkflowRunStatus = 'pending' | 'running' | 'paused' | 'success' | 'failed'
export type WorkflowRunStepKind = 'ai' | 'batch' | 'video_tasks'

export interface CreativeCaseStudy {
  id: string
  title: string
  sourceType?: string
  genre?: string
  summary?: string
  relationshipPatterns: string[]
  openingHooks: string[]
  highlightBeats: string[]
  reversalMechanisms: string[]
  cliffhangers: string[]
  visualPatterns: string[]
  rhythmCurve: number[]
  creativeCards: CreativeCaseCard[]
  riskTags: string[]
  notes?: string
  createdAt: string
  updatedAt: string
}

export type CreativeCaseCardKind = 'hook' | 'highlight' | 'relationship' | 'reversal' | 'cliffhanger' | 'visual' | 'rhythm'

export interface CreativeCaseCard {
  kind: CreativeCaseCardKind
  title: string
  pattern: string
  applyTo: string
  risk?: string
}

export type CaseStudyChapterStatus = 'parsed' | 'needs_review' | 'manual'

export interface CaseStudyDocument {
  id: string
  title: string
  fileName: string
  sourceType?: string
  chapterCount: number
  totalChars: number
  truncated: boolean
  parseWarnings: string[]
  createdAt: string
  updatedAt: string
}

export interface CaseStudyChapter {
  id: string
  documentId: string
  orderIndex: number
  title: string
  textPreview: string
  charCount: number
  wordCount: number
  status: CaseStudyChapterStatus
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface CaseStudyDocumentWithChapters extends CaseStudyDocument {
  chapters: CaseStudyChapter[]
}

export interface FreshnessReport {
  id: string
  projectId?: string
  targetKind: CreativeTargetKind
  targetId?: string
  targetTitle?: string
  originalityScore: number
  predictabilityScore: number
  tropeRiskScore: number
  characterFreshnessScore: number
  conflictFreshnessScore: number
  reversalFreshnessScore: number
  emotionalFreshnessScore: number
  overallScore: number
  clicheSignals: string[]
  audiencePredictionPoints: string[]
  suggestions: string[]
  rawResult?: string
  createdAt: string
  updatedAt: string
}

export interface AntiTropeVariant {
  id: string
  projectId?: string
  targetKind: CreativeTargetKind
  targetId?: string
  mode: AntiTropeMode
  title: string
  premise: string
  pressureMechanism: string
  preservedPayoffs: string[]
  keyChanges: string[]
  risks: string[]
  sampleRewrite?: string
  createdAt: string
}

export interface RevisionTaskBenefit {
  retention: number
  freshness: number
  visual: number
  cost: number
}

export interface RevisionTask {
  id: string
  projectId?: string
  targetKind: CreativeTargetKind
  targetId?: string
  sourceReportId?: string
  title: string
  description: string
  priority: RevisionTaskPriority
  status: RevisionTaskStatus
  suggestedAction: string
  expectedBenefit: RevisionTaskBenefit
  /** 持久化的、尚未写入目标的 AI 修稿候选。 */
  preview?: TextDiffPreviewPayload
  /** 生成预览时目标内容的不可逆指纹，用于采用前并发检查。 */
  previewFingerprint?: string
  appliedVersionId?: string
  /** 采用前快照；一步撤销只恢复这个版本，不删除审计记录。 */
  undoVersionId?: string
  createdAt: string
  updatedAt: string
}

export interface ContentVersion {
  id: string
  projectId?: string
  targetKind: CreativeTargetKind
  targetId: string
  label: string
  source: ContentVersionSource
  content: string
  meta?: Record<string, unknown>
  createdAt: string
}

export interface RevisionTaskAdoptResult {
  ok: boolean
  error?: string
  task?: RevisionTask
  beforeVersion?: ContentVersion
  appliedVersion?: ContentVersion
  alreadyApplied?: boolean
}

export interface RevisionTaskUndoResult {
  ok: boolean
  error?: string
  task?: RevisionTask
  result?: ContentVersion
}

export interface RevisionTaskPreviewUpdateResult {
  ok: boolean
  error?: string
  task?: RevisionTask
}

export interface QualityGateReport {
  id: string
  projectId?: string
  adaptationProjectId?: string
  targetKind: CreativeTargetKind
  targetId?: string
  stage: QualityGateStage
  score: number
  verdict: QualityGateVerdict
  blockingIssues: string[]
  warnings: string[]
  suggestions: string[]
  /** 生成报告时参与判断的源内容指纹；缺失表示旧版历史报告，不能作为当前通过/阻塞真值。 */
  sourceFingerprint?: string
  createdAt: string
  updatedAt: string
}

/** 对质量项的本地审计记录。记录不会修改或删除原始质量报告。 */
export interface QualityIssueAcknowledgement {
  id: string
  projectId: string
  adaptationProjectId?: string
  issueId: string
  issueKind: string
  issueTitle: string
  issueDetail?: string
  disposition: 'accepted' | 'ignored'
  note?: string
  actorLabel: string
  createdAt: string
}

export interface AudienceSimulation {
  id: string
  projectId?: string
  targetKind: CreativeTargetKind
  targetId?: string
  audienceProfile: string
  retentionScore: number
  emotionalEngagementScore: number
  noveltyScore: number
  likelyDropOffPoints: string[]
  mostMemorableMoments: string[]
  complaints: string[]
  shareableClips: string[]
  summary: string
  createdAt: string
  updatedAt: string
}

export interface NarrativeCurveReport {
  id: string
  projectId?: string
  adaptationProjectId?: string
  targetKind: CreativeTargetKind
  targetId?: string
  hookCurve: number[]
  conflictCurve: number[]
  reversalCurve: number[]
  emotionCurve: number[]
  cliffhangerCurve: number[]
  freshnessCurve: number[]
  summary: string
  weakSpots: string[]
  createdAt: string
  updatedAt: string
}

export interface WorkflowRunStep {
  key: string
  label: string
  kind?: WorkflowRunStepKind
  taskType?: NovelTaskType
  batchKind?: 'scripts' | 'shots'
  status: WorkflowRunStatus
  aiRunId?: string
  longTaskId?: string
  videoTaskIds?: string[]
  resultSummary?: string
  error?: string
  context?: {
    projectId?: string
    chapterId?: string
    adaptationProjectId?: string
    episodeId?: string
    sceneId?: string
    shotId?: string
    userInstruction?: string
  }
}

export interface WorkflowRun {
  id: string
  projectId?: string
  adaptationProjectId?: string
  templateKey: string
  title: string
  status: WorkflowRunStatus
  currentStep?: string
  steps: WorkflowRunStep[]
  errorMessage?: string
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// LangGraph 任务类型（§10.1 taskType 联合）
// ---------------------------------------------------------------------------

export type NovelTaskType =
  | 'generate_project'
  | 'generate_characters'
  | 'generate_book_outline'
  | 'generate_chapter_outline'
  | 'generate_story_arc_outline'
  | 'generate_chapter'
  | 'continue_chapter'
  | 'rewrite_chapter'
  | 'polish_chapter'
  | 'expand_chapter'
  | 'enhance_conflict'
  | 'enhance_highlight'
  | 'enhance_ai_drama_feel'
  | 'enhance_author_style'
  | 'evaluate_ai_drama_fit'
  // v0.2 长篇一致性与视觉记忆系统（ROADMAP v0.2）
  | 'summarize_chapter'
  | 'update_character_state'
  | 'extract_story_events'
  | 'extract_foreshadowing'
  | 'generate_character_visual_profile'
  | 'generate_visual_setting'
  | 'check_consistency'
  | 'build_long_context'
  // v0.3 AI 短剧小说强化系统（ROADMAP v0.3）
  | 'analyze_beats'
  | 'analyze_highlights'
  | 'analyze_ai_video_feasibility'
  | 'analyze_project_ai_drama_trend'
  | 'enhance_hook'
  | 'enhance_reversal'
  | 'enhance_cliffhanger'
  | 'rewrite_as_ai_drama_novel'
  // 对话式项目设定（工作台 AI 助手多轮对话）
  | 'chat_project'
  // v0.4 小说 / 大纲转 AI 短剧分集大纲（ROADMAP v0.4）
  | 'create_adaptation_strategy'
  | 'convert_novel_to_episodes'
  | 'rewrite_episode_outline'
  | 'enhance_episode_hook'
  | 'enhance_episode_visuals'
  | 'analyze_first_10_episodes'
  // v0.5 AI 短剧剧本生成（ROADMAP v0.5）
  | 'generate_ai_drama_script'
  | 'split_script_to_scenes'
  | 'review_ai_drama_script'
  | 'rewrite_ai_drama_script'
  | 'enhance_dialogue_conflict'
  | 'enhance_script_dialogue_voice'
  | 'enhance_episode_cliffhanger'
  | 'enhance_script_visuality'
  // v0.6 分镜与镜头 Prompt 生成（ROADMAP v0.6）
  | 'split_scene_to_shots'
  | 'generate_shot_prompt'
  | 'generate_negative_prompt'
  | 'review_shot_prompt'
  | 'rewrite_shot_prompt'
  | 'optimize_prompt_for_video_platform'
  | 'generate_video_asset_drafts'
  // v1.1 创意诊断与反套路迭代系统
  | 'analyze_trope_freshness'
  | 'generate_anti_trope_variants'
  | 'analyze_narrative_curve'
  | 'generate_revision_tasks'
  | 'run_quality_gate'
  | 'simulate_audience_reaction'
  | 'analyze_video_cost_risk'
  | 'analyze_text_quality'
  | 'extract_case_structure'
  | 'generate_inspiration_schemes'
  // v0.8 多 Agent 编剧室与模板系统（ROADMAP v0.8）
  | 'writing_room_review'
  | 'writing_room_consolidate'
  | 'template_run'

// ---------------------------------------------------------------------------
// v0.8 多 Agent 编剧室与模板系统（ROADMAP v0.8）
// ---------------------------------------------------------------------------

/** 编剧室审稿目标类型 */
export type WritingRoomTargetKind = 'chapter' | 'script' | 'shot'

export type TextDiffPreviewTargetKind = 'chapter' | 'script' | 'shot'

export interface TextDiffPreviewPayload {
  targetKind: TextDiffPreviewTargetKind
  targetId?: string
  title?: string
  taskType: NovelTaskType
  currentContent: string
  nextContent: string
  projectId?: string
  adaptationProjectId?: string
  episodeId?: string
  sceneId?: string
  shotId?: string
  note?: string
  script?: {
    episodeNumber: number
    title: string
    content: string
    hook?: string
    mainConflict?: string
    emotionalBeat?: string
    reversal?: string
    cliffhanger?: string
    estimatedDuration?: string
  }
  shotPatch?: {
    videoPrompt?: string
    negativePrompt?: string
    imagePrompt?: string
  }
}

/** Agent 配置（对应 agent_profiles 表） */
export interface AgentProfile {
  id: string
  name: string
  /** 角色标识（如 chief_editor / highlight_optimizer），内置预设按 role 幂等 */
  role: string
  /** 系统 Prompt（Agent 的审稿人格与关注维度） */
  systemPrompt: string
  /** 输出结构说明（可空，提示模型产出 JSON 字段） */
  outputSchema?: string
  enabled: boolean
  /** 是否内置（内置预设不可删除，只能改 systemPrompt） */
  builtIn: boolean
  createdAt: string
  updatedAt: string
}

/** 模板（对应 templates 表，ROADMAP v0.8 §3） */
export interface Template {
  id: string
  name: string
  /** 模板类型（project / character / outline / chapter / evaluation / episode / script / shot / prompt / pitch） */
  type: string
  /** 可驱动的生成类任务（generate_project 等）；为空则视为纯片段模板 */
  scope?: NovelTaskType
  description?: string
  /** 模板正文，支持 {{变量}} 占位符 */
  content: string
  /** 声明的变量名清单 */
  variables: string[]
  /** 是否内置（内置模板不可删除） */
  builtIn: boolean
  createdAt: string
  updatedAt: string
}

/** 类型预设（对应 genre_presets 表，ROADMAP v0.8 §4） */
export interface GenrePreset {
  id: string
  /** 类型名（奇幻玄幻·修仙逆袭 / 游戏系统·副本升级 …） */
  name: string
  description?: string
  commonRelationships: string[]
  commonHighlights: string[]
  commonReversals: string[]
  commonOpenings: string[]
  commonCliffhangers: string[]
  visualStyle: string
  shotPromptAdvice: string
  aiVideoRisks: string
  builtIn: boolean
  createdAt: string
  updatedAt: string
}

/** 模板运行记录（对应 template_runs 表） */
export interface TemplateRun {
  id: string
  templateId: string
  projectId?: string
  /** 对应的 NovelTaskType 或 'snippet' */
  scope: string
  /** 渲染后的模板正文快照 */
  renderedContent: string
  /** 变量键值快照（JSON） */
  variables: Record<string, string>
  aiRunId?: string
  createdAt: string
}

/** v1.0 按任务组指定模型绑定（对应 task_model_bindings 表，ROADMAP v1.0-3） */
export interface TaskModelBinding {
  id: string
  /** 任务组标识（见 TASK_GROUPS） */
  taskGroup: string
  modelConfigId: string
  createdAt: string
  updatedAt: string
}

/** 单个 Agent 的审稿输出（每个 review 节点产出一份） */
export interface AgentReviewResult {
  agentId: string
  agentName: string
  role: string
  /** 综合评分 0-100 */
  score: number
  issues: string[]
  suggestions: string[]
  summary: string
}

/** 编剧室整合结论（主编 Agent 产出，ROADMAP v0.8 §2 验收#3） */
export interface WritingRoomResult {
  targetKind: WritingRoomTargetKind
  targetId: string
  reviews: AgentReviewResult[]
  consolidated: {
    score: number
    keyIssues: string[]
    /** 整合后的修改建议 */
    revisionPlan: string
  }
}

/** AI 工作流运行状态 */
export type AiRunStatus = 'success' | 'failed'

/** 新建/更新时缺少 id 与时间戳的输入形状 */
export type OptionalId<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt'>
