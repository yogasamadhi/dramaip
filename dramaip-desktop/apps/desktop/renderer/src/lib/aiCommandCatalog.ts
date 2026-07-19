import {
  TASK_GROUP_LABELS,
  TASK_TYPE_LABELS,
  TASK_WRITE_POLICIES,
  resolveTaskGroup,
  type AiTaskWritePolicyDefinition,
  type Chapter,
  type NovelTaskType,
} from '@sdns/core'

export type AiCommandCategory = 'continue' | 'style' | 'conflict' | 'adaptation' | 'structure' | 'analysis' | 'production'

export interface AiCommandDefinition {
  taskType: NovelTaskType
  label: string
  description: string
  category: AiCommandCategory
  categoryLabel: string
  group: string
  groupLabel: string
  writePolicy: AiTaskWritePolicyDefinition
  /** 能在章节上下文直接执行；其余任务继续保留在原有工作台，命令面板会说明入口。 */
  chapterDirect: boolean
}

const CATEGORY_LABELS: Record<AiCommandCategory, string> = {
  continue: '继续创作',
  style: '语言与风格',
  conflict: '冲突与爽点',
  adaptation: '短剧化',
  structure: '结构修复',
  analysis: '分析与检查',
  production: '改编与制作',
}

/** 命令面板的固定分类顺序；可让作者先按意图缩小完整任务目录。 */
export const AI_COMMAND_CATEGORIES: Array<{ id: AiCommandCategory; label: string }> = [
  { id: 'continue', label: CATEGORY_LABELS.continue },
  { id: 'style', label: CATEGORY_LABELS.style },
  { id: 'conflict', label: CATEGORY_LABELS.conflict },
  { id: 'adaptation', label: CATEGORY_LABELS.adaptation },
  { id: 'structure', label: CATEGORY_LABELS.structure },
  { id: 'analysis', label: CATEGORY_LABELS.analysis },
  { id: 'production', label: CATEGORY_LABELS.production },
]

const CATEGORY_BY_TASK: Partial<Record<NovelTaskType, AiCommandCategory>> = {
  generate_chapter: 'continue',
  continue_chapter: 'continue',
  polish_chapter: 'style',
  enhance_author_style: 'style',
  expand_chapter: 'style',
  enhance_conflict: 'conflict',
  enhance_highlight: 'conflict',
  enhance_hook: 'conflict',
  enhance_reversal: 'conflict',
  enhance_cliffhanger: 'conflict',
  enhance_ai_drama_feel: 'adaptation',
  rewrite_as_ai_drama_novel: 'adaptation',
  rewrite_chapter: 'structure',
  generate_chapter_outline: 'structure',
  generate_story_arc_outline: 'structure',
  check_consistency: 'structure',
  build_long_context: 'structure',
}

const DIRECT_CHAPTER_TASKS = new Set<NovelTaskType>([
  'generate_chapter',
  'continue_chapter',
  'rewrite_chapter',
  'polish_chapter',
  'expand_chapter',
  'enhance_conflict',
  'enhance_highlight',
  'enhance_ai_drama_feel',
  'enhance_author_style',
  'enhance_hook',
  'enhance_reversal',
  'enhance_cliffhanger',
  'rewrite_as_ai_drama_novel',
])

function fallbackCategory(taskType: NovelTaskType): AiCommandCategory {
  const group = resolveTaskGroup(taskType)
  if (group === 'analysis' || group === 'creative_strategy') return 'analysis'
  if (group === 'adaptation' || group === 'script' || group === 'shot' || group === 'writing_room') return 'production'
  return 'structure'
}

function description(taskType: NovelTaskType): string {
  const policy = TASK_WRITE_POLICIES[taskType]
  return policy.description
}

/** 所有已注册任务的前端目录；不会另建任务或改变既有 TASK_WRITE_POLICIES。 */
export function buildAiCommandCatalog(): AiCommandDefinition[] {
  return (Object.keys(TASK_WRITE_POLICIES) as NovelTaskType[]).map((taskType) => {
    const category = CATEGORY_BY_TASK[taskType] ?? fallbackCategory(taskType)
    const group = resolveTaskGroup(taskType)
    return {
      taskType,
      label: TASK_TYPE_LABELS[taskType] ?? taskType,
      description: description(taskType),
      category,
      categoryLabel: CATEGORY_LABELS[category],
      group,
      groupLabel: TASK_GROUP_LABELS[group] ?? group,
      writePolicy: TASK_WRITE_POLICIES[taskType],
      chapterDirect: DIRECT_CHAPTER_TASKS.has(taskType),
    }
  })
}

export function filterAiCommands(commands: AiCommandDefinition[], query: string): AiCommandDefinition[] {
  const normalized = query.trim().toLocaleLowerCase('zh-CN')
  if (!normalized) return commands
  return commands.filter((command) =>
    [command.label, command.description, command.categoryLabel, command.groupLabel, command.taskType]
      .join(' ')
      .toLocaleLowerCase('zh-CN')
      .includes(normalized),
  )
}

/** 当前章节仅显示三项下一步建议，避免把完整任务表误当作主工作流。 */
export function recommendAiCommands(commands: AiCommandDefinition[], chapter: Chapter | null): AiCommandDefinition[] {
  const ids: NovelTaskType[] = !chapter
    ? ['generate_project', 'generate_chapter_outline', 'generate_characters']
    : chapter.content.trim()
      ? ['continue_chapter', 'polish_chapter', 'enhance_conflict']
      : ['generate_chapter', 'generate_chapter_outline', 'enhance_hook']
  return ids.map((id) => commands.find((command) => command.taskType === id)).filter((command): command is AiCommandDefinition => Boolean(command))
}

export function commandStorageKey(projectId: string): string {
  return `sdns-ai-command-activity-v1:${projectId}`
}

export interface AiCommandActivity {
  favorites: NovelTaskType[]
  recent: NovelTaskType[]
}

export function normalizeAiCommandActivity(value: unknown): AiCommandActivity {
  const candidate = value && typeof value === 'object' ? value as Partial<AiCommandActivity> : {}
  const valid = new Set(Object.keys(TASK_WRITE_POLICIES))
  const values = (items: unknown) => Array.isArray(items)
    ? items.filter((item): item is NovelTaskType => typeof item === 'string' && valid.has(item)).slice(0, 12)
    : []
  return { favorites: values(candidate.favorites), recent: values(candidate.recent) }
}

export function recordRecentCommand(activity: AiCommandActivity, taskType: NovelTaskType): AiCommandActivity {
  return { ...activity, recent: [taskType, ...activity.recent.filter((item) => item !== taskType)].slice(0, 8) }
}

export function toggleFavoriteCommand(activity: AiCommandActivity, taskType: NovelTaskType): AiCommandActivity {
  return activity.favorites.includes(taskType)
    ? { ...activity, favorites: activity.favorites.filter((item) => item !== taskType) }
    : { ...activity, favorites: [taskType, ...activity.favorites].slice(0, 12) }
}
