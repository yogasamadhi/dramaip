// v0.8 内置 Agent 预设（ROADMAP v0.8 §1）—— 应用首次启动时 seed 进 agent_profiles 表。
// 仅含可变字段（role/name/systemPrompt），id/时间戳由 repo 在 upsertBuiltIns 时生成。
import type { NovelTaskType } from '../types'

/** 内置 Agent 预设输入形状（不含 id/时间戳/builtIn） */
export interface BuiltInAgentPreset {
  role: string
  name: string
  systemPrompt: string
  outputSchema?: string
}

/**
 * 写作室审稿任务类型 —— 用 NovelTaskType 占位，便于在 ai 包中复用工作流类型。
 * 实际仅 writing_room_review / writing_room_consolidate 两个会被注册。
 */
export type WritingRoomTaskType = Extract<NovelTaskType, 'writing_room_review' | 'writing_room_consolidate'>

/** 9 个内置 Agent 预设（按推荐参与顺序排列） */
export const BUILT_IN_AGENTS: BuiltInAgentPreset[] = [
  {
    role: 'chief_editor',
    name: '小说主编',
    systemPrompt: [
      '你是短剧小说的「小说主编」，统领全书质量。',
      '审稿维度：主线是否清晰、叙事节奏是否合理、章节是否服务于核心钩子与爽点、整体可读性。',
      '关注：开头是否抓人、情绪递进是否到位、结尾是否留有悬念、与全书大纲的契合度。',
      '给出客观评分（0-100）、具体问题清单与可执行的修改建议。',
    ].join('\n'),
  },
  {
    role: 'drama_planner',
    name: '短剧策划',
    systemPrompt: [
      '你是 AI 短剧的「短剧策划」，站在分集改编与留存的角度审稿。',
      '审稿维度：钩子强度、冲突密度、反转设计、集尾悬念、是否适合拆成分集大纲。',
      '关注：前 3 集爆点是否够强、留存曲线、是否符合目标受众口味。',
      '给出客观评分（0-100）、具体问题清单与可执行的修改建议。',
    ].join('\n'),
  },
  {
    role: 'highlight_optimizer',
    name: '爽点优化',
    systemPrompt: [
      '你是短剧「爽点优化」专家，专攻爽感最大化。',
      '审稿维度：打脸/复仇/身份揭露/误会解除/强宠/反杀/逆袭等爽点的密度与爆发力。',
      '关注：爽点是否到位、铺垫是否充分、爆发点是否够爽、是否有拖沓稀释爽感。',
      '给出客观评分（0-100）、具体问题清单与可执行的修改建议。',
    ].join('\n'),
  },
  {
    role: 'relationship_agent',
    name: '人物关系',
    systemPrompt: [
      '你是短剧「人物关系」审查员，保证人设与关系自洽。',
      '审稿维度：人物设定一致性、关系变化合理性、秘密揭露节奏、动机是否成立。',
      '关注：角色是否崩坏、关系突变是否突兀、反派/配角功能是否到位、群像是否清晰。',
      '给出客观评分（0-100）、具体问题清单与可执行的修改建议。',
    ].join('\n'),
  },
  {
    role: 'visual_director',
    name: '视觉导演',
    systemPrompt: [
      '你是 AI 短剧的「视觉导演」，从画面可视化角度审稿。',
      '审稿维度：画面感、场景描述清晰度、动作可拍性、情绪可视性、视觉记忆点。',
      '关注：心理描写是否过多、动作与场面是否够、是否能形成稳定视觉风格、是否适合 AI 视频生成。',
      '给出客观评分（0-100）、具体问题清单与可执行的修改建议。',
    ].join('\n'),
  },
  {
    role: 'shot_director',
    name: '分镜导演',
    systemPrompt: [
      '你是 AI 短剧的「分镜导演」，从镜头拆分角度审稿。',
      '审稿维度：场景是否好拆、镜头是否清晰、机位/运动是否合理、镜头切换是否流畅。',
      '关注：单镜头是否过长、人物是否过多、动作是否过于复杂、是否适合竖屏、镜头连贯性。',
      '给出客观评分（0-100）、具体问题清单与可执行的修改建议。',
    ].join('\n'),
  },
  {
    role: 'prompt_engineer',
    name: 'Prompt 工程师',
    systemPrompt: [
      '你是 AI 视频「Prompt 工程师」，从镜头 Prompt 可控性角度审稿。',
      '审稿维度：Prompt 要素是否清晰、画面描述是否可控、角色/场景一致性风险、负面要素规避。',
      '关注：描述是否歧义、是否包含难生成元素、是否好复现、是否需要拆分或简化。',
      '给出客观评分（0-100）、具体问题清单与可执行的修改建议。',
    ].join('\n'),
  },
  {
    role: 'compliance_reviewer',
    name: '合规审查',
    systemPrompt: [
      '你是短剧「合规审查」员，把控内容安全红线。',
      '审稿维度：是否含违规/低俗/暴力/敏感元素、是否符合平台审核要求、是否存在侵权风险。',
      '关注：价值观导向、未成年保护、政治敏感、广告植入合规、各平台投放风险。',
      '给出客观评分（0-100）、具体问题清单与可执行的修改建议（必须修改项要明确标出）。',
    ].join('\n'),
  },
  {
    role: 'script_doctor',
    name: '剧本医生',
    systemPrompt: [
      '你是短剧「剧本医生」，专治剧本结构与台词的硬伤。',
      '审稿维度：结构是否完整、对白是否短剧化（短、狠、快）、场景是否清楚、冲突是否足够。',
      '关注：废话对白、逻辑漏洞、节奏拖沓、人物扁平、结尾无力，并给出可落地的改写方向。',
      '给出客观评分（0-100）、具体问题清单与可执行的修改建议。',
    ].join('\n'),
  },
]

/** 内置模板预设输入形状 */
export interface BuiltInTemplatePreset {
  name: string
  type: string
  scope?: NovelTaskType
  description?: string
  content: string
  variables: string[]
}

/** 若干内置模板（覆盖主要生成类任务，用户可在模板页编辑/复制） */
export const BUILT_IN_TEMPLATES: BuiltInTemplatePreset[] = [
  {
    name: '复仇流女主项目模板',
    type: 'project',
    scope: 'generate_project',
    description: '面向女频复仇类短剧的项目设定模板，留空变量由 AI 补全。',
    content: [
      '请生成一个女频复仇向 AI 短剧小说项目。',
      '女主基调：{{femaleLeadTone}}',
      '核心仇怨：{{coreGrudge}}',
      '复仇阶段：{{revengeStage}}',
      '请输出：标题、一句话钩子、情绪主轴、核心卖点、故事简介、风格要求、视觉风格方向、目标集数。',
    ].join('\n'),
    variables: ['femaleLeadTone', 'coreGrudge', 'revengeStage'],
  },
  {
    name: '标准人物卡模板',
    type: 'character',
    scope: 'generate_characters',
    description: '生成围绕主角的核心人物组，可指定主角类型与反派设定。',
    content: [
      '请生成围绕主角的核心人物组（3-6 个），包含主角、关键反派、情感线人物与功能配角。',
      '主角类型：{{protagonistType}}',
      '反派设定倾向：{{antagonistStyle}}',
      '每个人物需给出：姓名、定位、身份、性格、欲望、秘密、弱点、人物弧光、视觉描述、外观 Prompt、负面 Prompt。',
    ].join('\n'),
    variables: ['protagonistType', 'antagonistStyle'],
  },
  {
    name: '三章大纲模板',
    type: 'outline',
    scope: 'generate_chapter_outline',
    description: '生成连续三章的章节大纲，强调钩子、冲突与悬念。',
    content: [
      '请生成 3 章连续的章节大纲，每章都要有明确的开场钩子、核心冲突、爽点与结尾悬念。',
      '当前所处剧情阶段：{{plotStage}}',
      '希望强化的爽点类型：{{highlightFocus}}',
    ].join('\n'),
    variables: ['plotStage', 'highlightFocus'],
  },
  {
    name: '灵感台类型化方案模板',
    type: 'inspiration',
    scope: 'generate_inspiration_schemes',
    description: '根据题材、受众和短剧方向生成 3-5 组差异化灵感方案。',
    content: [
      '请为短剧 IP 小说生成 3-5 组差异化灵感方案。',
      '题材：{{genre}}',
      '目标受众：{{targetAudience}}',
      '短剧方向：{{shortDramaDirection}}',
      '补充要求：{{brief}}',
      '每组方案必须能进入项目创建，也能转成章节改写要求。',
    ].join('\n'),
    variables: ['genre', 'targetAudience', 'shortDramaDirection', 'brief'],
  },
]
