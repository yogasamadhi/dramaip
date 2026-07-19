import type { Chapter, ChapterMemory, LongTask, QualityIssueAcknowledgement, Script, ScriptReview, Shot, ShotReview } from '@sdns/core'

export type QualityGateIssueKind = 'chapter_memory' | 'script_review' | 'shot_risk' | 'failed_task' | 'quality_report'
export type QualityGateIssueSeverity = 'block' | 'warn' | 'info'
export type QualityGateIssueStage = 'novel_to_adaptation' | 'episodes_to_scripts' | 'scripts_to_shots' | 'shots_to_video' | 'operations'

export interface QualityGateIssue {
  id: string
  kind: QualityGateIssueKind
  severity: QualityGateIssueSeverity
  stage?: QualityGateIssueStage
  title: string
  detail: string
}

export interface QualityGateSummary {
  total: number
  block: number
  warn: number
  info: number
}

/** 每个问题只按最新的追加审计记录显示状态，历史记录仍保留给审计列表。 */
export function latestQualityIssueAcknowledgements(
  acknowledgements: QualityIssueAcknowledgement[],
): Map<string, QualityIssueAcknowledgement> {
  const latest = new Map<string, QualityIssueAcknowledgement>()
  for (const acknowledgement of acknowledgements) {
    const previous = latest.get(acknowledgement.issueId)
    if (!previous || acknowledgement.createdAt > previous.createdAt || (
      acknowledgement.createdAt === previous.createdAt && acknowledgement.id > previous.id
    )) {
      latest.set(acknowledgement.issueId, acknowledgement)
    }
  }
  return latest
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
