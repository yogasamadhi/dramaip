import {
  buildQualityGateSourceFingerprint,
  type Chapter,
  type Character,
  type Outline,
  type Project,
  type QualityGateReport,
} from '@sdns/core'

export type QualityGateTruthState = 'current' | 'missing' | 'stale' | 'legacy'

export interface QualityGateTruth {
  state: QualityGateTruthState
  sourceFingerprint: string
  report?: QualityGateReport
  detail: string
}

export interface ProjectQualityGateInput {
  project: Project
  chapters: Chapter[]
  characters: Character[]
  outlines: Outline[]
  reports: QualityGateReport[]
}

/**
 * 项目总览、改编就绪和质量页共享这一入口，避免一处累计历史阻塞项、另一处只看最新
 * 报告而产生互相矛盾的阶段状态。
 */
export function buildProjectQualityGateTruth(input: ProjectQualityGateInput): QualityGateTruth {
  const sourceFingerprint = buildQualityGateSourceFingerprint({
    stage: 'novel_to_adaptation',
    project: input.project,
    chapters: input.chapters,
    characters: input.characters,
    outlines: input.outlines,
  })
  const scoped = input.reports
    .filter((report) => report.stage === 'novel_to_adaptation' && report.targetKind === 'project' && report.targetId === input.project.id)
    .sort(byNewest)
  const current = scoped.filter((report) => report.sourceFingerprint === sourceFingerprint)[0]
  if (current) {
    const blocking = current.blockingIssues.length
    return {
      state: 'current',
      sourceFingerprint,
      report: current,
      detail: `${verdictLabel(current.verdict)}，阻塞项 ${blocking} 个`,
    }
  }

  const latest = scoped[0]
  if (!latest) {
    return { state: 'missing', sourceFingerprint, detail: '尚未运行当前项目质量闸门' }
  }
  if (!latest.sourceFingerprint) {
    return { state: 'legacy', sourceFingerprint, report: latest, detail: '历史报告未记录源版本，请重新检查' }
  }
  return { state: 'stale', sourceFingerprint, report: latest, detail: '源内容已变化，报告已过期，请重新检查' }
}

function byNewest(left: QualityGateReport, right: QualityGateReport): number {
  return right.createdAt.localeCompare(left.createdAt) || right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id)
}

function verdictLabel(verdict: QualityGateReport['verdict']): string {
  if (verdict === 'pass') return '最新检查通过'
  if (verdict === 'warn') return '最新检查有提醒'
  return '最新检查阻塞'
}
