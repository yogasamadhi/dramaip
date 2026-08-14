import { basename, extname } from 'node:path'

export type ParsedCaseStudyChapterStatus = 'parsed' | 'needs_review' | 'manual'

export interface ParsedCaseStudyChapter {
  orderIndex: number
  title: string
  content: string
  charCount: number
  wordCount: number
  status: ParsedCaseStudyChapterStatus
  warning?: string
}

export interface ParsedCaseStudyDocument {
  chapters: ParsedCaseStudyChapter[]
  warnings: string[]
}

const CHINESE_NUMERAL = '零〇一二两三四五六七八九十百千万0-9０-９'
const CJK_CHAPTER_RE = new RegExp(`^(?:#{1,6}\\s*)?第[${CHINESE_NUMERAL}\\s]+[章节回集卷部篇](?:[\\s:：、.．-]+(.{0,60}))?$`)
const EN_CHAPTER_RE = /^(?:#{1,6}\s*)?chapter\s+[0-9ivxlcdm]+(?:[\s:：、.．-]+(.{0,60}))?$/i
const MARKDOWN_CHAPTER_RE = new RegExp(`^#{1,6}\\s+(.{0,12}(?:第[${CHINESE_NUMERAL}\\s]+[章节回集]|chapter\\s+[0-9ivxlcdm]+).{0,60})$`, 'i')

interface Heading {
  lineIndex: number
  contentStartLine: number
  title: string
}

export function normalizeCaseStudyText(rawText: string): string {
  return rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

export function parseCaseStudyChapters(rawText: string, fileName = '样本文档'): ParsedCaseStudyDocument {
  const text = normalizeCaseStudyText(rawText)
  if (!text) {
    return {
      chapters: [],
      warnings: ['文档为空，请确认文件内容或重新选择。'],
    }
  }

  const lines = text.split('\n')
  const headings = collectHeadings(lines)
  if (headings.length === 0) {
    return {
      chapters: [buildChapter(0, titleFromFileName(fileName), text, 'needs_review', '未识别到章节标题，已按全文作为单章导入。')],
      warnings: ['未识别到章节标题，建议人工拆分或补充章节标题。'],
    }
  }

  const chapters: ParsedCaseStudyChapter[] = []
  const warnings: string[] = []
  const firstHeading = headings[0]
  const preface = lines.slice(0, firstHeading.lineIndex).join('\n').trim()
  if (preface.length > 30) {
    chapters.push(buildChapter(chapters.length, '导入前言', preface, 'needs_review', '章节标题前存在正文，请确认是否应并入第一章。'))
    warnings.push('章节标题前存在正文，请确认前言或序章归属。')
  }

  headings.forEach((heading, index) => {
    const next = headings[index + 1]
    const content = lines.slice(heading.contentStartLine, next?.lineIndex ?? lines.length).join('\n').trim()
    const warning = content.length < 8 ? '章节内容过短，请确认是否识别错误。' : undefined
    if (warning) warnings.push(`${heading.title}：${warning}`)
    chapters.push(buildChapter(chapters.length, heading.title, content, warning ? 'needs_review' : 'parsed', warning))
  })

  if (chapters.length === 1 && chapters[0].charCount > 20_000) {
    chapters[0] = {
      ...chapters[0],
      status: 'needs_review',
      warning: '仅识别到一个超长章节，请确认章节标题格式。',
    }
    warnings.push('仅识别到一个超长章节，请确认章节标题格式。')
  }

  return { chapters, warnings: [...new Set(warnings)] }
}

function collectHeadings(lines: string[]): Heading[] {
  const headings: Heading[] = []
  lines.forEach((line, index) => {
    const title = parseHeadingTitle(line)
    if (!title) return
    headings.push({ lineIndex: index, contentStartLine: index + 1, title })
  })
  return headings
}

function parseHeadingTitle(line: string): string | undefined {
  const trimmed = line.trim()
  if (!trimmed || trimmed.length > 90) return undefined
  const markdown = MARKDOWN_CHAPTER_RE.exec(trimmed)
  if (markdown?.[1]) return markdown[1].trim()
  if (CJK_CHAPTER_RE.test(trimmed) || EN_CHAPTER_RE.test(trimmed)) return trimmed.replace(/^#{1,6}\s*/, '').trim()
  return undefined
}

function buildChapter(
  orderIndex: number,
  title: string,
  content: string,
  status: ParsedCaseStudyChapterStatus,
  warning?: string,
): ParsedCaseStudyChapter {
  return {
    orderIndex,
    title: title || `章节 ${orderIndex + 1}`,
    content,
    charCount: content.length,
    wordCount: estimateWordCount(content),
    status,
    warning,
  }
}

function estimateWordCount(text: string): number {
  const matches = text.match(/[A-Za-z0-9]+|[\u3400-\u9fff]/g)
  return matches?.length ?? 0
}

function titleFromFileName(fileName: string): string {
  const name = basename(fileName, extname(fileName)).trim()
  return name || '样本文档全文'
}
