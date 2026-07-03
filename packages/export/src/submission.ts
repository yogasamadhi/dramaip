import type { Chapter, Character, Evaluation, Outline, Project, QualityGateReport } from '@sdns/core'
import { exportChapterMarkdown } from './markdown'

export const NOVEL_SUBMISSION_PACKAGE_FORMAT = 'sdns-novel-submission-package'
export const NOVEL_SUBMISSION_PACKAGE_VERSION = 1
export const DEFAULT_SUBMISSION_CHAPTER_LIMIT = 10

export interface NovelSubmissionExportOptions {
  chapterLimit?: number
}

export interface NovelSubmissionExportData {
  project: Project
  characters?: Character[]
  outlines?: Outline[]
  chapters?: Chapter[]
  evaluations?: Evaluation[]
  qualityGateReports?: QualityGateReport[]
}

export interface NovelSubmissionChapterCatalogItem {
  order: number
  title: string
  summary?: string
  hook?: string
  mainConflict?: string
  highlight?: string
  reversal?: string
  cliffhanger?: string
  wordCount: number
}

export interface NovelSubmissionQualitySummary {
  latestEvaluation?: Pick<Evaluation, 'totalScore' | 'hookScore' | 'conflictScore' | 'reversalScore' | 'emotionScore' | 'visualizationScore' | 'suggestions' | 'createdAt'>
  averageEvaluationScore?: number
  latestQualityGate?: Pick<QualityGateReport, 'stage' | 'score' | 'verdict' | 'blockingIssues' | 'warnings' | 'suggestions' | 'createdAt'>
}

export interface NovelSubmissionPackage {
  meta: {
    format: typeof NOVEL_SUBMISSION_PACKAGE_FORMAT
    version: typeof NOVEL_SUBMISSION_PACKAGE_VERSION
    exportedAt: string
    sourceTitle: string
    chapterLimit: number
  }
  project: Project
  sellingPoints: {
    coreHook?: string
    coreSellingPoint?: string
    emotionalCore?: string
    synopsis?: string
    styleGuide?: string
    visualStyleDirection?: string
  }
  characters: Character[]
  outlines: Outline[]
  chapterCatalog: NovelSubmissionChapterCatalogItem[]
  sampleChapters: Chapter[]
  qualitySummary: NovelSubmissionQualitySummary
}

export function buildNovelSubmissionPackage(
  data: NovelSubmissionExportData,
  options: NovelSubmissionExportOptions & { exportedAt?: string } = {},
): NovelSubmissionPackage {
  const chapterLimit = normalizeChapterLimit(options.chapterLimit)
  const chapters = [...(data.chapters ?? [])].sort((a, b) => a.orderIndex - b.orderIndex)
  return {
    meta: {
      format: NOVEL_SUBMISSION_PACKAGE_FORMAT,
      version: NOVEL_SUBMISSION_PACKAGE_VERSION,
      exportedAt: options.exportedAt ?? new Date().toISOString(),
      sourceTitle: data.project.title,
      chapterLimit,
    },
    project: data.project,
    sellingPoints: {
      coreHook: data.project.coreHook,
      coreSellingPoint: data.project.coreSellingPoint,
      emotionalCore: data.project.emotionalCore,
      synopsis: data.project.synopsis,
      styleGuide: data.project.styleGuide,
      visualStyleDirection: data.project.visualStyleDirection,
    },
    characters: data.characters ?? [],
    outlines: data.outlines ?? [],
    chapterCatalog: chapters.map((chapter, index) => chapterCatalogItem(chapter, index)),
    sampleChapters: chapters.slice(0, chapterLimit),
    qualitySummary: buildQualitySummary(data.evaluations ?? [], data.qualityGateReports ?? []),
  }
}

export function exportNovelSubmissionMarkdown(
  data: NovelSubmissionExportData,
  options: NovelSubmissionExportOptions = {},
): string {
  const pkg = buildNovelSubmissionPackage(data, options)
  const parts: string[] = [`# ${pkg.project.title} · 小说投稿包`]
  const meta = [
    line('短剧类型', pkg.project.shortDramaType),
    line('目标受众', pkg.project.targetAudience),
    line('目标字数', pkg.project.targetWordCount),
    line('目标集数', pkg.project.targetEpisodeCount),
    line('导出章节', `前 ${pkg.meta.chapterLimit} 章`),
  ].filter(Boolean)
  if (meta.length) parts.push(meta.join('\n'))

  const selling = [
    line('一句话钩子', pkg.sellingPoints.coreHook),
    line('核心卖点', pkg.sellingPoints.coreSellingPoint),
    line('情绪主轴', pkg.sellingPoints.emotionalCore),
    line('视觉风格方向', pkg.sellingPoints.visualStyleDirection),
  ].filter(Boolean)
  if (selling.length) parts.push(`## 卖点摘要\n\n${selling.join('\n')}`)
  if (pkg.sellingPoints.synopsis) parts.push(`## 作品简介\n\n${pkg.sellingPoints.synopsis}`)

  const bookOutlines = pkg.outlines.filter((outline) => outline.type === 'book')
  if (bookOutlines.length) {
    parts.push(`## 全书大纲\n\n${bookOutlines.map((outline) => outline.content).join('\n\n')}`)
  }

  if (pkg.characters.length) {
    parts.push(`## 人物小传\n\n${pkg.characters.map(renderCharacterBio).join('\n\n')}`)
  }

  if (pkg.chapterCatalog.length) {
    parts.push(`## 章节目录\n\n${pkg.chapterCatalog.map(renderCatalogItem).join('\n')}`)
  }

  const quality = renderQualitySummary(pkg.qualitySummary)
  if (quality) parts.push(`## 质量摘要\n\n${quality}`)

  if (pkg.sampleChapters.length) {
    parts.push(
      `## 正文试读（前 ${pkg.meta.chapterLimit} 章）\n\n` +
        pkg.sampleChapters.map((chapter) => exportChapterMarkdown(chapter).trim()).join('\n\n---\n\n'),
    )
  }

  return parts.join('\n\n') + '\n'
}

export function exportNovelSubmissionJson(
  data: NovelSubmissionExportData,
  options: NovelSubmissionExportOptions = {},
): string {
  return JSON.stringify(buildNovelSubmissionPackage(data, options), null, 2)
}

function normalizeChapterLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_SUBMISSION_CHAPTER_LIMIT
  return Math.max(1, Math.min(100, Math.floor(value ?? DEFAULT_SUBMISSION_CHAPTER_LIMIT)))
}

function chapterCatalogItem(chapter: Chapter, index: number): NovelSubmissionChapterCatalogItem {
  return {
    order: index + 1,
    title: chapter.title,
    summary: chapter.summary,
    hook: chapter.hook,
    mainConflict: chapter.mainConflict,
    highlight: chapter.highlight,
    reversal: chapter.reversal,
    cliffhanger: chapter.cliffhanger,
    wordCount: countText(chapter.content),
  }
}

function buildQualitySummary(evaluations: Evaluation[], reports: QualityGateReport[]): NovelSubmissionQualitySummary {
  const latestEvaluation = latestByCreatedAt(evaluations)
  const latestQualityGate = latestByCreatedAt(reports)
  return {
    latestEvaluation: latestEvaluation
      ? {
          totalScore: latestEvaluation.totalScore,
          hookScore: latestEvaluation.hookScore,
          conflictScore: latestEvaluation.conflictScore,
          reversalScore: latestEvaluation.reversalScore,
          emotionScore: latestEvaluation.emotionScore,
          visualizationScore: latestEvaluation.visualizationScore,
          suggestions: latestEvaluation.suggestions,
          createdAt: latestEvaluation.createdAt,
        }
      : undefined,
    averageEvaluationScore: evaluations.length
      ? Math.round(evaluations.reduce((sum, evaluation) => sum + evaluation.totalScore, 0) / evaluations.length)
      : undefined,
    latestQualityGate: latestQualityGate
      ? {
          stage: latestQualityGate.stage,
          score: latestQualityGate.score,
          verdict: latestQualityGate.verdict,
          blockingIssues: latestQualityGate.blockingIssues,
          warnings: latestQualityGate.warnings,
          suggestions: latestQualityGate.suggestions,
          createdAt: latestQualityGate.createdAt,
        }
      : undefined,
  }
}

function renderCharacterBio(character: Character): string {
  const lines = [
    `### ${character.name}（${character.role}）`,
    line('身份', character.identity),
    line('性格', character.personality),
    line('欲望', character.desire),
    line('秘密', character.secret),
    line('弱点', character.weakness),
    line('人物弧光', character.arc),
    line('与主角关系', character.relationshipToProtagonist),
    line('冲突对象', character.conflictTarget),
    line('短剧功能', character.shortDramaFunction),
  ].filter(Boolean)
  return lines.join('\n')
}

function renderCatalogItem(item: NovelSubmissionChapterCatalogItem): string {
  const tags = [
    item.summary ? `摘要：${item.summary}` : '',
    item.hook ? `钩子：${item.hook}` : '',
    item.mainConflict ? `冲突：${item.mainConflict}` : '',
    item.cliffhanger ? `悬念：${item.cliffhanger}` : '',
    `字数：${item.wordCount}`,
  ].filter(Boolean)
  return `${item.order}. ${item.title}${tags.length ? `（${tags.join('；')}）` : ''}`
}

function renderQualitySummary(summary: NovelSubmissionQualitySummary): string {
  const parts: string[] = []
  if (summary.latestEvaluation) {
    const evaluation = summary.latestEvaluation
    parts.push([
      line('最新 AI 短剧评分', evaluation.totalScore),
      line('平均评分', summary.averageEvaluationScore),
      line('钩子/冲突/反转/情绪/画面', `${evaluation.hookScore}/${evaluation.conflictScore}/${evaluation.reversalScore}/${evaluation.emotionScore}/${evaluation.visualizationScore}`),
      evaluation.suggestions.length ? `- **评分建议**：${evaluation.suggestions.join('；')}` : '',
    ].filter(Boolean).join('\n'))
  }
  if (summary.latestQualityGate) {
    const gate = summary.latestQualityGate
    parts.push([
      line('最新质量闸门', `${gate.stage} / ${gate.verdict} / ${gate.score}`),
      gate.blockingIssues.length ? `- **阻塞项**：${gate.blockingIssues.join('；')}` : '',
      gate.warnings.length ? `- **警告**：${gate.warnings.join('；')}` : '',
      gate.suggestions.length ? `- **建议**：${gate.suggestions.join('；')}` : '',
    ].filter(Boolean).join('\n'))
  }
  return parts.join('\n\n')
}

function line(label: string, value?: string | number | null): string {
  if (value === undefined || value === null || value === '') return ''
  return `- **${label}**：${value}`
}

function latestByCreatedAt<T extends { createdAt: string }>(items: T[]): T | undefined {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
}

function countText(value: string): number {
  return value.replace(/\s+/g, '').length
}
