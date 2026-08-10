import type { RevisionTask } from '@sdns/core'

export function supportsRevisionTaskPreview(task: RevisionTask): boolean {
  return Boolean(task.targetId && ['chapter', 'script', 'shot'].includes(task.targetKind) && !['applied', 'dismissed'].includes(task.status))
}

export function revisionTaskReviewInstruction(task: RevisionTask): string {
  return [
    `请复检已采用的修稿任务：${task.title}`,
    `任务目标：${task.targetKind}${task.targetId ? `/${task.targetId}` : ''}`,
    `原始行动：${task.suggestedAction}`,
  ].join('\n')
}
