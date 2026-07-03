// 常量 —— 短剧类型预设、工作台导航、任务类型映射（§5.2 / §5.3 / §10.1）
import type { NovelTaskType, WorkflowRunStepKind, WritingRoomTargetKind } from '../types'

/** 短剧类型预设（§5.2） */
export const SHORT_DRAMA_TYPES: string[] = [
  '女频复仇',
  '真假千金',
  '重生逆袭',
  '先婚后爱',
  '霸总追妻',
  '豪门恩怨',
  '赘婿打脸',
  '战神归来',
  '玄学直播',
  '古装权谋',
  '悬疑反转',
  '甜宠爽文',
]

/** 视觉风格方向预设（§5.2）—— 面向 AI 短剧视频生成 */
export const VISUAL_STYLE_DIRECTIONS: string[] = [
  '现代都市短剧',
  '豪门精致感',
  '古风国风',
  '悬疑冷色调',
  '甜宠明亮风',
  '暗黑复仇风',
  '漫画感',
  '电影感',
]

/** 工作台左侧导航（§5.3） */
export interface WorkspaceNavKey {
  key: string
  label: string
}

export interface WorkspaceNavGroup {
  key: string
  label: string
  items: WorkspaceNavKey[]
}

export const WORKSPACE_NAV: WorkspaceNavKey[] = [
  { key: 'overview', label: '项目概览' },
  { key: 'quality-gates', label: '质量闸门' },
  { key: 'chat', label: 'Agent 指挥台' },
  { key: 'characters', label: '人物卡' },
  { key: 'outline', label: '大纲' },
  { key: 'chapters', label: '章节' },
  { key: 'evaluation', label: 'AI短剧评分' },
  // v0.2 长篇一致性与视觉记忆系统
  { key: 'memory', label: '记忆面板' },
  { key: 'character-state', label: '人物状态' },
  { key: 'visual-profile', label: '人物视觉档案' },
  { key: 'visual-setting', label: '视觉设定' },
  { key: 'timeline', label: '事件时间线' },
  { key: 'foreshadowing', label: '伏笔' },
  { key: 'consistency', label: '一致性检查' },
  // v0.3 AI 短剧小说强化
  { key: 'ai-dashboard', label: 'AI短剧仪表盘' },
  { key: 'creative-diagnosis', label: '创意诊断台' },
  { key: 'beats', label: '戏剧节拍' },
  { key: 'highlights', label: '爽点分析' },
  { key: 'ai-video', label: 'AI视频可行性' },
  { key: 'ai-runs', label: 'AI 调用记录' },
  // v0.8 多 Agent 编剧室
  { key: 'writing-room', label: '编剧室' },
]

const WORKSPACE_NAV_BY_KEY = new Map(WORKSPACE_NAV.map((item) => [item.key, item]))

function workspaceNavItems(keys: string[]): WorkspaceNavKey[] {
  return keys.map((key) => {
    const item = WORKSPACE_NAV_BY_KEY.get(key)
    if (!item) throw new Error(`Unknown workspace nav key: ${key}`)
    return item
  })
}

export const WORKSPACE_NAV_GROUPS: WorkspaceNavGroup[] = [
  {
    key: 'creation',
    label: '创作',
    items: workspaceNavItems(['chapters', 'overview', 'chat', 'characters', 'outline']),
  },
  {
    key: 'memory',
    label: '记忆',
    items: workspaceNavItems([
      'memory',
      'character-state',
      'visual-profile',
      'visual-setting',
      'timeline',
      'foreshadowing',
      'consistency',
    ]),
  },
  {
    key: 'diagnosis',
    label: '诊断',
    items: workspaceNavItems([
      'quality-gates',
      'evaluation',
      'ai-dashboard',
      'creative-diagnosis',
      'beats',
      'highlights',
    ]),
  },
  {
    key: 'adaptation',
    label: '改编准备',
    items: workspaceNavItems(['ai-video', 'writing-room']),
  },
  {
    key: 'records',
    label: '记录',
    items: workspaceNavItems(['ai-runs']),
  },
]

/** 任务类型 → 中文标签（用于 UI / 日志） */
export const TASK_TYPE_LABELS: Record<string, string> = {
  generate_project: '生成项目设定',
  generate_characters: '生成人物卡',
  generate_book_outline: '生成全书大纲',
  generate_chapter_outline: '生成章节大纲',
  generate_chapter: '生成章节正文',
  continue_chapter: '续写章节',
  rewrite_chapter: '改写章节',
  polish_chapter: '润色章节',
  expand_chapter: '扩写章节',
  enhance_conflict: '增强冲突',
  enhance_highlight: '增强爽点',
  enhance_ai_drama_feel: '增强 AI 短剧感',
  evaluate_ai_drama_fit: 'AI 短剧适配度评分',
  // v0.2 长篇一致性
  summarize_chapter: '生成章节记忆',
  update_character_state: '更新人物状态',
  extract_story_events: '提取故事事件',
  extract_foreshadowing: '提取伏笔',
  generate_character_visual_profile: '生成人物视觉档案',
  generate_visual_setting: '生成视觉设定',
  check_consistency: '一致性检查',
  build_long_context: '生成长篇上下文',
  // v0.3 AI 短剧小说强化
  analyze_beats: '分析戏剧节拍',
  analyze_highlights: '爽点分析',
  analyze_ai_video_feasibility: 'AI 视频可行性分析',
  analyze_project_ai_drama_trend: '全书 AI 短剧趋势分析',
  enhance_hook: '强化钩子',
  enhance_reversal: '强化反转',
  enhance_cliffhanger: '强化悬念',
  rewrite_as_ai_drama_novel: 'AI 短剧化改写',
  chat_project: '项目对话',
  // v0.4 改编分集大纲
  create_adaptation_strategy: '生成改编策略',
  convert_novel_to_episodes: '生成 AI 短剧分集大纲',
  rewrite_episode_outline: 'AI 重写分集',
  enhance_episode_hook: '增强分集钩子',
  enhance_episode_visuals: '增强分集关键画面',
  analyze_first_10_episodes: '前 10 集分析',
  // v0.5 AI 短剧剧本生成
  generate_ai_drama_script: '生成 AI 短剧剧本',
  split_script_to_scenes: '拆分剧本场景',
  review_ai_drama_script: '剧本审稿',
  rewrite_ai_drama_script: 'AI 重写剧本',
  enhance_dialogue_conflict: '增强对白冲突',
  enhance_episode_cliffhanger: '增强集尾悬念',
  enhance_script_visuality: '增强剧本画面感',
  // v0.6 分镜与镜头 Prompt 生成
  split_scene_to_shots: '场景拆分镜头',
  generate_shot_prompt: '生成镜头视频 Prompt',
  generate_negative_prompt: '生成负面 Prompt',
  review_shot_prompt: '镜头审查',
  rewrite_shot_prompt: '改写镜头 Prompt',
  optimize_prompt_for_video_platform: '优化镜头 Prompt（视频平台）',
  // v1.1 创意诊断与反套路迭代系统
  analyze_trope_freshness: '套路新鲜度分析',
  generate_anti_trope_variants: '生成反套路方案',
  analyze_narrative_curve: '分析爽点/钩子曲线',
  generate_revision_tasks: '生成修稿任务单',
  run_quality_gate: '运行质量闸门',
  simulate_audience_reaction: '模拟观众反应',
  analyze_video_cost_risk: '视频成本/难度预估',
  extract_case_structure: '抽取样本结构',
  // v0.8 多 Agent 编剧室与模板系统
  writing_room_review: '编剧室 Agent 审稿',
  writing_room_consolidate: '编剧室整合建议',
  template_run: '模板驱动生成',
}

export type AiTaskWritePolicy = 'preview_then_adopt' | 'conditional_preview' | 'snapshot_then_auto_write' | 'auto_write' | 'display_only'

export interface AiTaskWritePolicyDefinition {
  policy: AiTaskWritePolicy
  label: string
  description: string
}

export const TASK_WRITE_POLICY_LABELS: Record<AiTaskWritePolicy, string> = {
  preview_then_adopt: '预览后采用',
  conditional_preview: '按内容状态确认',
  snapshot_then_auto_write: '快照后写入',
  auto_write: '自动写入',
  display_only: '仅返回结果',
}

function taskPolicy(policy: AiTaskWritePolicy, description: string): AiTaskWritePolicyDefinition {
  return { policy, label: TASK_WRITE_POLICY_LABELS[policy], description }
}

/** AI 任务落库策略：UI 与 workflow 共同遵循，避免危险覆写绕过确认。 */
export const TASK_WRITE_POLICIES: Record<NovelTaskType, AiTaskWritePolicyDefinition> = {
  generate_project: taskPolicy('preview_then_adopt', '生成项目设定，用户采用后更新项目。'),
  generate_characters: taskPolicy('preview_then_adopt', '生成人物卡，用户采用后新增人物。'),
  generate_book_outline: taskPolicy('preview_then_adopt', '生成全书大纲，用户采用后写入大纲。'),
  generate_chapter_outline: taskPolicy('preview_then_adopt', '生成章节大纲，用户采用后新增大纲。'),
  generate_chapter: taskPolicy('preview_then_adopt', '生成章节正文，用户确认差异后写入。'),
  continue_chapter: taskPolicy('preview_then_adopt', '续写章节正文，用户确认差异后写入。'),
  rewrite_chapter: taskPolicy('preview_then_adopt', '改写章节正文，用户确认差异后写入。'),
  polish_chapter: taskPolicy('preview_then_adopt', '润色章节正文，用户确认差异后写入。'),
  expand_chapter: taskPolicy('preview_then_adopt', '扩写章节正文，用户确认差异后写入。'),
  enhance_conflict: taskPolicy('preview_then_adopt', '增强章节冲突，用户确认差异后写入。'),
  enhance_highlight: taskPolicy('preview_then_adopt', '增强章节爽点，用户确认差异后写入。'),
  enhance_ai_drama_feel: taskPolicy('preview_then_adopt', '增强 AI 短剧感，用户确认差异后写入。'),
  evaluate_ai_drama_fit: taskPolicy('auto_write', '生成评分报告并自动写入评分记录。'),
  summarize_chapter: taskPolicy('auto_write', '生成章节记忆并自动写入记忆记录。'),
  update_character_state: taskPolicy('auto_write', '生成人物状态快照并自动写入。'),
  extract_story_events: taskPolicy('auto_write', '提取故事事件并自动追加。'),
  extract_foreshadowing: taskPolicy('auto_write', '提取伏笔并自动追加。'),
  generate_character_visual_profile: taskPolicy('preview_then_adopt', '生成人物视觉档案，用户采用后写入。'),
  generate_visual_setting: taskPolicy('preview_then_adopt', '生成视觉设定，用户采用后写入。'),
  check_consistency: taskPolicy('display_only', '生成一致性检查结果，仅展示给用户。'),
  build_long_context: taskPolicy('display_only', '生成长篇上下文，仅展示给用户。'),
  analyze_beats: taskPolicy('auto_write', '分析戏剧节拍并自动写入。'),
  analyze_highlights: taskPolicy('auto_write', '分析爽点并自动写入。'),
  analyze_ai_video_feasibility: taskPolicy('auto_write', '分析 AI 视频可行性并自动写入。'),
  analyze_project_ai_drama_trend: taskPolicy('auto_write', '分析全书趋势并自动写入。'),
  enhance_hook: taskPolicy('preview_then_adopt', '强化章节钩子，用户确认差异后写入。'),
  enhance_reversal: taskPolicy('preview_then_adopt', '强化章节反转，用户确认差异后写入。'),
  enhance_cliffhanger: taskPolicy('preview_then_adopt', '强化章节悬念，用户确认差异后写入。'),
  rewrite_as_ai_drama_novel: taskPolicy('preview_then_adopt', '短剧化改写章节，用户确认差异后写入。'),
  chat_project: taskPolicy('display_only', '项目对话结果仅展示或进入后续采用流程。'),
  create_adaptation_strategy: taskPolicy('display_only', '生成改编策略，仅展示给用户。'),
  convert_novel_to_episodes: taskPolicy('preview_then_adopt', '生成分集大纲，用户采用后写入。'),
  rewrite_episode_outline: taskPolicy('auto_write', '重写单集大纲并自动更新该集。'),
  enhance_episode_hook: taskPolicy('auto_write', '增强单集钩子并自动更新该集。'),
  enhance_episode_visuals: taskPolicy('auto_write', '增强单集关键画面并自动更新该集。'),
  analyze_first_10_episodes: taskPolicy('auto_write', '分析前 10 集并自动写入分析报告。'),
  generate_ai_drama_script: taskPolicy('conditional_preview', '新剧本自动写入；已有剧本改写前返回差异预览。'),
  split_script_to_scenes: taskPolicy('snapshot_then_auto_write', '拆分剧本场景前自动保存结构检查点，再替换场景列表。'),
  review_ai_drama_script: taskPolicy('auto_write', '生成剧本审稿并自动写入。'),
  rewrite_ai_drama_script: taskPolicy('preview_then_adopt', '重写剧本正文，用户确认差异后写入。'),
  enhance_dialogue_conflict: taskPolicy('preview_then_adopt', '增强剧本对白冲突，用户确认差异后写入。'),
  enhance_episode_cliffhanger: taskPolicy('preview_then_adopt', '增强剧本集尾悬念，用户确认差异后写入。'),
  enhance_script_visuality: taskPolicy('preview_then_adopt', '增强剧本画面感，用户确认差异后写入。'),
  split_scene_to_shots: taskPolicy('snapshot_then_auto_write', '拆分场景镜头前自动保存结构检查点，再替换镜头列表。'),
  generate_shot_prompt: taskPolicy('preview_then_adopt', '生成镜头 Prompt，用户确认差异后写入。'),
  generate_negative_prompt: taskPolicy('preview_then_adopt', '生成负面 Prompt，用户确认差异后写入。'),
  review_shot_prompt: taskPolicy('auto_write', '生成镜头审查并自动写入。'),
  rewrite_shot_prompt: taskPolicy('preview_then_adopt', '改写镜头 Prompt，用户确认差异后写入。'),
  optimize_prompt_for_video_platform: taskPolicy('preview_then_adopt', '优化平台 Prompt，用户确认差异后写入。'),
  analyze_trope_freshness: taskPolicy('auto_write', '分析套路新鲜度并自动写入报告。'),
  generate_anti_trope_variants: taskPolicy('auto_write', '生成反套路方案并自动写入。'),
  analyze_narrative_curve: taskPolicy('auto_write', '分析叙事曲线并自动写入报告。'),
  generate_revision_tasks: taskPolicy('auto_write', '生成修稿任务并自动写入。'),
  run_quality_gate: taskPolicy('auto_write', '运行质量闸门并自动写入报告。'),
  simulate_audience_reaction: taskPolicy('auto_write', '模拟观众反应并自动写入报告。'),
  analyze_video_cost_risk: taskPolicy('auto_write', '分析视频成本/难度并自动写入报告。'),
  extract_case_structure: taskPolicy('auto_write', '抽取样本结构并自动写入样本库。'),
  writing_room_review: taskPolicy('display_only', '编剧室单 Agent 审稿结果仅用于汇总。'),
  writing_room_consolidate: taskPolicy('display_only', '编剧室整合建议仅展示给用户。'),
  template_run: taskPolicy('display_only', '模板运行结果按模板 scope 进入展示或采用流程。'),
}

export function taskWritePolicy(taskType: NovelTaskType): AiTaskWritePolicyDefinition {
  return TASK_WRITE_POLICIES[taskType]
}

/** v0.7 视频生成 Provider 种类预设（ROADMAP v0.7 §1） */
export const VIDEO_PROVIDER_KINDS = [
  'mock',
  'jimeng',
  'kling',
  'hailuo',
  'runway',
  'pika',
  'openai_sora',
  'custom',
] as const

/** 视频 Provider 种类 → 中文标签（用于配置 UI） */
export const VIDEO_PROVIDER_KIND_LABELS: Record<string, string> = {
  mock: 'Mock（模拟，不真实生成）',
  jimeng: '即梦 Dreamina',
  kling: '可灵 Kling',
  hailuo: '海螺 Hailuo',
  runway: 'Runway',
  pika: 'Pika',
  openai_sora: 'OpenAI Sora',
  custom: '自定义（OpenAI 兼容）',
}

/**
 * 章节正文字数相关默认值。
 * 单章目标 ≈ 2000 字：小说侧为「发布到小说网」优化（兼顾阅读体验与连载节奏），
 * 与剧本侧「2 分钟一集」是两套独立体量体系，经「改编」衔接，不做字数↔分钟换算。
 */
export const CHAPTER_DEFAULTS = {
  minWords: 1200,
  targetWords: 2000,
} as const

export const DB_FILE_NAME = 'studio.db'
export const GRAPH_NAME = 'novel-workflow'

// ---------------------------------------------------------------------------
// v0.8 多 Agent 编剧室与模板系统（ROADMAP v0.8）
// ---------------------------------------------------------------------------

/** 模板类型枚举（ROADMAP v0.8 §3） */
export const TEMPLATE_TYPES: string[] = [
  'project',
  'character',
  'outline',
  'chapter',
  'evaluation',
  'episode',
  'script',
  'shot',
  'prompt',
  'pitch',
]

/** 模板类型 → 中文标签 */
export const TEMPLATE_TYPE_LABELS: Record<string, string> = {
  project: '项目模板',
  character: '人物模板',
  outline: '大纲模板',
  chapter: '章节模板',
  evaluation: 'AI短剧评分模板',
  episode: '分集大纲模板',
  script: '视频剧本模板',
  shot: '分镜模板',
  prompt: '镜头Prompt模板',
  pitch: 'Pitch模板',
}

/** 模板 scope（可驱动的生成类 taskType）→ 中文标签 */
export const TEMPLATE_SCOPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'generate_project', label: '生成项目设定' },
  { value: 'generate_characters', label: '生成人物卡' },
  { value: 'generate_book_outline', label: '生成全书大纲' },
  { value: 'generate_chapter_outline', label: '生成章节大纲' },
  { value: 'snippet', label: '纯片段（不落库）' },
]

/** 编剧室审稿目标类型（ROADMAP v0.8 §2） */
export const WRITING_ROOM_TARGET_KINDS: WritingRoomTargetKind[] = ['chapter', 'script', 'shot']

/** 编剧室目标类型 → 中文标签 */
export const WRITING_ROOM_TARGET_LABELS: Record<WritingRoomTargetKind, string> = {
  chapter: '章节',
  script: '剧本',
  shot: '镜头',
}

/** Agent 角色 → 中文标签（9 个内置预设，ROADMAP v0.8 §1） */
export const AGENT_ROLE_LABELS: Record<string, string> = {
  chief_editor: '小说主编 Agent',
  drama_planner: '短剧策划 Agent',
  highlight_optimizer: '爽点优化 Agent',
  relationship_agent: '人物关系 Agent',
  visual_director: '视觉导演 Agent',
  shot_director: '分镜导演 Agent',
  prompt_engineer: 'Prompt 工程师 Agent',
  compliance_reviewer: '合规审查 Agent',
  script_doctor: '剧本医生 Agent',
}

// ---------------------------------------------------------------------------
// v1.0 模型配置增强（ROADMAP v1.0-3）：按任务组指定模型
// ---------------------------------------------------------------------------

/**
 * 任务组：把 30+ taskType 聚合为若干逻辑组，便于「按任务用不同模型」。
 * 每组可绑定一个模型配置；缺省回退默认模型。
 * 注意：writing_room_* 由编剧室工作流统一处理，也归入 writing_room 组。
 */
export interface TaskGroup {
  key: string
  label: string
  description: string
  taskTypes: string[]
}

export const TASK_GROUPS: TaskGroup[] = [
  {
    key: 'writing',
    label: '小说写作',
    description: '章节生成 / 续写 / 改写 / 润色 / 扩写 / 增强',
    taskTypes: [
      'generate_chapter',
      'continue_chapter',
      'rewrite_chapter',
      'polish_chapter',
      'expand_chapter',
      'enhance_conflict',
      'enhance_highlight',
      'enhance_ai_drama_feel',
      'enhance_hook',
      'enhance_reversal',
      'enhance_cliffhanger',
      'rewrite_as_ai_drama_novel',
    ],
  },
  {
    key: 'setup',
    label: '项目与设定',
    description: '生成项目 / 人物 / 大纲设定',
    taskTypes: [
      'generate_project',
      'generate_characters',
      'generate_book_outline',
      'generate_chapter_outline',
      'chat_project',
    ],
  },
  {
    key: 'analysis',
    label: '分析与评分',
    description: '评分 / 记忆 / 一致性 / 节拍 / 爽点 / 可行性 / 趋势',
    taskTypes: [
      'evaluate_ai_drama_fit',
      'summarize_chapter',
      'update_character_state',
      'extract_story_events',
      'extract_foreshadowing',
      'generate_character_visual_profile',
      'generate_visual_setting',
      'check_consistency',
      'build_long_context',
      'analyze_beats',
      'analyze_highlights',
      'analyze_ai_video_feasibility',
      'analyze_project_ai_drama_trend',
    ],
  },
  {
    key: 'adaptation',
    label: '分集大纲',
    description: '改编策略 / 分集生成 / 单集重写增强 / 前 10 集分析',
    taskTypes: [
      'create_adaptation_strategy',
      'convert_novel_to_episodes',
      'rewrite_episode_outline',
      'enhance_episode_hook',
      'enhance_episode_visuals',
      'analyze_first_10_episodes',
    ],
  },
  {
    key: 'script',
    label: '剧本生成',
    description: '剧本生成 / 拆场景 / 审稿 / 改写 / 增强',
    taskTypes: [
      'generate_ai_drama_script',
      'split_script_to_scenes',
      'review_ai_drama_script',
      'rewrite_ai_drama_script',
      'enhance_dialogue_conflict',
      'enhance_episode_cliffhanger',
      'enhance_script_visuality',
    ],
  },
  {
    key: 'shot',
    label: '分镜与 Prompt',
    description: '拆镜头 / 视频 Prompt / 负面 / 审查 / 改写 / 平台优化',
    taskTypes: [
      'split_scene_to_shots',
      'generate_shot_prompt',
      'generate_negative_prompt',
      'review_shot_prompt',
      'rewrite_shot_prompt',
      'optimize_prompt_for_video_platform',
    ],
  },
  {
    key: 'creative_strategy',
    label: '创意诊断',
    description: '新鲜度 / 反套路 / 曲线 / 修稿任务 / 质量闸门 / 观众模拟 / 视频风险',
    taskTypes: [
      'analyze_trope_freshness',
      'generate_anti_trope_variants',
      'analyze_narrative_curve',
      'generate_revision_tasks',
      'run_quality_gate',
      'simulate_audience_reaction',
      'analyze_video_cost_risk',
      'extract_case_structure',
    ],
  },
  {
    key: 'writing_room',
    label: '多 Agent 编剧室',
    description: '编剧室各 Agent 审稿 + 主编整合',
    taskTypes: ['writing_room_review', 'writing_room_consolidate', 'template_run'],
  },
]

/** taskType → 所属任务组 key */
export const TASK_TYPE_TO_GROUP: Record<string, string> = Object.fromEntries(
  TASK_GROUPS.flatMap((g) => g.taskTypes.map((t) => [t, g.key])),
)

/** 任务组 key → 中文标签 */
export const TASK_GROUP_LABELS: Record<string, string> = Object.fromEntries(
  TASK_GROUPS.map((g) => [g.key, g.label]),
)

/** 根据任意 taskType 解析其所属任务组（未知类型归入 setup） */
export function resolveTaskGroup(taskType: string): string {
  return TASK_TYPE_TO_GROUP[taskType] ?? 'setup'
}

export interface CreativeWorkflowTemplateStep {
  key: string
  label: string
  kind: WorkflowRunStepKind
  taskType?: NovelTaskType
  batchKind?: 'scripts' | 'shots'
  pauseAfter?: boolean
  description?: string
}

export interface CreativeWorkflowTemplate {
  key: string
  title: string
  description: string
  steps: CreativeWorkflowTemplateStep[]
}

function aiWorkflowStep(taskType: NovelTaskType, options: Partial<CreativeWorkflowTemplateStep> = {}): CreativeWorkflowTemplateStep {
  return {
    key: options.key ?? taskType,
    label: options.label ?? TASK_TYPE_LABELS[taskType] ?? taskType,
    kind: 'ai',
    taskType,
    pauseAfter: options.pauseAfter,
    description: options.description,
  }
}

function batchWorkflowStep(batchKind: 'scripts' | 'shots', label: string, options: Partial<CreativeWorkflowTemplateStep> = {}): CreativeWorkflowTemplateStep {
  return {
    key: options.key ?? `batch_${batchKind}`,
    label,
    kind: 'batch',
    batchKind,
    pauseAfter: options.pauseAfter,
    description: options.description,
  }
}

function videoTaskWorkflowStep(options: Partial<CreativeWorkflowTemplateStep> = {}): CreativeWorkflowTemplateStep {
  return {
    key: options.key ?? 'draft_video_tasks',
    label: options.label ?? '创建视频任务草稿',
    kind: 'video_tasks',
    pauseAfter: options.pauseAfter,
    description: options.description,
  }
}

export const CREATIVE_WORKFLOW_TEMPLATES: CreativeWorkflowTemplate[] = [
  {
    key: 'project_full_diagnosis',
    title: '新项目完整体检',
    description: '对项目整体进行新鲜度、叙事曲线、观众反应和修稿任务体检。',
    steps: [
      aiWorkflowStep('analyze_trope_freshness'),
      aiWorkflowStep('analyze_narrative_curve'),
      aiWorkflowStep('simulate_audience_reaction'),
      aiWorkflowStep('generate_revision_tasks'),
    ],
  },
  {
    key: 'chapter_anti_trope_revision',
    title: '章节反套路修稿',
    description: '围绕当前章节生成反套路方案和可执行修稿任务。',
    steps: [
      aiWorkflowStep('analyze_trope_freshness'),
      aiWorkflowStep('generate_anti_trope_variants'),
      aiWorkflowStep('generate_revision_tasks'),
    ],
  },
  {
    key: 'adaptation_quality_gate',
    title: '改编前质量闸门',
    description: '在小说进入分集改编前运行质量闸门、观众模拟和修稿任务。',
    steps: [
      aiWorkflowStep('run_quality_gate'),
      aiWorkflowStep('simulate_audience_reaction'),
      aiWorkflowStep('generate_revision_tasks'),
    ],
  },
  {
    key: 'video_quality_gate',
    title: '视频生成前质量闸门',
    description: '视频生成前评估成本、难度和阻塞风险。',
    steps: [
      aiWorkflowStep('analyze_video_cost_risk'),
      aiWorkflowStep('run_quality_gate'),
      aiWorkflowStep('generate_revision_tasks'),
    ],
  },
  {
    key: 'novel_to_video_pipeline',
    title: '小说到视频任务流水线',
    description: '从改编质量闸门、分集大纲、批量剧本、批量分镜一路生成视频任务草稿。',
    steps: [
      aiWorkflowStep('run_quality_gate', {
        key: 'novel_to_adaptation_gate',
        label: '改编前质量闸门',
        description: '先确认小说进入分集改编前没有阻塞项。',
      }),
      aiWorkflowStep('convert_novel_to_episodes', {
        key: 'convert_to_episodes',
        label: '生成分集大纲',
        pauseAfter: true,
        description: '生成或更新分集大纲，完成后建议人工确认。',
      }),
      batchWorkflowStep('scripts', '批量生成剧本', {
        pauseAfter: true,
        description: '为分集批量补齐剧本，已有剧本会跳过。',
      }),
      batchWorkflowStep('shots', '批量拆分镜头', {
        pauseAfter: true,
        description: '为已有剧本场景批量拆分镜头，已有镜头会跳过。',
      }),
      videoTaskWorkflowStep({
        pauseAfter: true,
        description: '为已有镜头创建 pending 视频任务草稿，不自动提交真实平台。',
      }),
    ],
  },
]
