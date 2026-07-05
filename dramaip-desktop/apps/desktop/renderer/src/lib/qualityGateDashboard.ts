import type { Chapter, ChapterMemory, LongTask, Script, ScriptReview, Shot, ShotReview } from '@sdns/core'

export type QualityGateIssueKind = 'chapter_memory' | 'script_review' | 'shot_risk' | 'failed_task'
export type QualityGateIssueSeverity = 'block' | 'warn' | 'info'

export interface QualityGateIssue {
  id: string
  kind: QualityGateIssueKind
  severity: QualityGateIssueSeverity
  title: string
  detail: string
}

export interface QualityGateSummary {
  total: number
  block: number
  warn: number
  info: number
}

export function chaptersWithoutMemory(chapters: Chapter[], memories: ChapterMemory[]): Chapter[] {
  const memorized = new Set(memories.map((memory) => memory.chapterId))
  return chapters.filter((chapter) => !memorized.has(chapter.id))
}

export function needsScriptReview(script: Script, review?: ScriptReview): boolean {
  return Boolean(script.content.trim()) && !review
}

export function isHighRiskShot(shot: Shot, review?: ShotReview): boolean {
  return shot.aiVideoDifficulty === 'high' || review?.aiVideoDifficulty === 'high' || (review?.overallScore ?? 100) < 60
}

export function failedLongTasks(tasks: LongTask[]): LongTask[] {
  return tasks.filter((task) => task.status === 'failed')
}

export function summarizeQualityGateIssues(issues: QualityGateIssue[]): QualityGateSummary {
  return issues.reduce<QualityGateSummary>(
    (summary, issue) => {
      summary.total += 1
      summary[issue.severity] += 1
      return summary
    },
    { total: 0, block: 0, warn: 0, info: 0 },
  )
}
