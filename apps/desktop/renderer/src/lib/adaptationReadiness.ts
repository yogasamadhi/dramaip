import type { Chapter, ChapterMemory, Character, Outline, QualityGateReport } from '@sdns/core'

export type AdaptationReadinessSeverity = 'ready' | 'warning' | 'risk'
export type AdaptationReadinessKey = 'chapters' | 'characters' | 'outline' | 'memory' | 'quality'

export interface AdaptationReadinessSnapshot {
  chapters: Chapter[]
  characters: Character[]
  outlines: Outline[]
  chapterMemories: ChapterMemory[]
  qualityReports: QualityGateReport[]
}

export interface AdaptationReadinessItem {
  key: AdaptationReadinessKey
  title: string
  detail: string
  severity: AdaptationReadinessSeverity
}

export interface AdaptationReadinessSummary {
  items: AdaptationReadinessItem[]
  readyCount: number
  warningCount: number
  riskCount: number
}

function hasText(value?: string): boolean {
  return Boolean(value?.trim())
}

function countBlockingIssues(reports: QualityGateReport[]): number {
  return reports.reduce((sum, report) => sum + report.blockingIssues.length, 0)
}

export function buildAdaptationReadiness(snapshot: AdaptationReadinessSnapshot): AdaptationReadinessSummary {
  const chaptersWithContent = snapshot.chapters.filter((chapter) => hasText(chapter.content))
  const outlinesWithContent = snapshot.outlines.filter((outline) => hasText(outline.content))
  const memoryChapterIds = new Set(snapshot.chapterMemories.map((memory) => memory.chapterId))
  const rememberedChapters = chaptersWithContent.filter((chapter) => memoryChapterIds.has(chapter.id)).length
  const blockingIssueCount = countBlockingIssues(snapshot.qualityReports)

  const items: AdaptationReadinessItem[] = [
    {
      key: 'chapters',
      title: '章节数',
      severity: chaptersWithContent.length >= 3 ? 'ready' : chaptersWithContent.length > 0 ? 'warning' : 'risk',
      detail: chaptersWithContent.length > 0
        ? `已有 ${chaptersWithContent.length} 章正文，改编样本越多越稳定`
        : '还没有可改编的章节正文',
    },
    {
      key: 'characters',
      title: '人物',
      severity: snapshot.characters.length > 0 ? 'ready' : 'risk',
      detail: snapshot.characters.length > 0 ? `已有 ${snapshot.characters.length} 张人物卡` : '缺少主要人物卡',
    },
    {
      key: 'outline',
      title: '大纲',
      severity: outlinesWithContent.length > 0 ? 'ready' : 'warning',
      detail: outlinesWithContent.length > 0 ? `已有 ${outlinesWithContent.length} 份大纲` : '缺少全书或章节大纲',
    },
    {
      key: 'memory',
      title: '记忆',
      severity: chaptersWithContent.length === 0 || rememberedChapters === 0
        ? 'warning'
        : 'ready',
      detail: chaptersWithContent.length > 0
        ? `已有 ${rememberedChapters}/${chaptersWithContent.length} 章记忆`
        : '暂无章节正文可生成记忆',
    },
    {
      key: 'quality',
      title: '质量闸门',
      severity: blockingIssueCount > 0 ? 'risk' : snapshot.qualityReports.length > 0 ? 'ready' : 'warning',
      detail: snapshot.qualityReports.length > 0
        ? `已有 ${snapshot.qualityReports.length} 份报告，阻塞项 ${blockingIssueCount} 个`
        : '尚未运行质量闸门',
    },
  ]

  return {
    items,
    readyCount: items.filter((item) => item.severity === 'ready').length,
    warningCount: items.filter((item) => item.severity === 'warning').length,
    riskCount: items.filter((item) => item.severity === 'risk').length,
  }
}
