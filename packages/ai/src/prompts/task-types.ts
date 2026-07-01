import type { NovelTaskType } from '@sdns/core'

export function effectiveTaskType(taskType: NovelTaskType, templateScope?: NovelTaskType): NovelTaskType {
  if (taskType === 'template_run') {
    return templateScope ?? 'generate_project'
  }
  return taskType
}

export const TEXT_CHAPTER_TASKS: ReadonlySet<NovelTaskType> = new Set([
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
])

export function isTextChapterTask(taskType: NovelTaskType): boolean {
  return TEXT_CHAPTER_TASKS.has(taskType)
}
