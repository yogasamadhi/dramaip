import { basename, dirname, extname, posix } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import type { Repositories } from '@sdns/db'
import type { DB } from '@sdns/db'
import { getFileImportPolicy } from './file-security'

export type SourceImportType = 'txt' | 'markdown' | 'docx' | 'epub' | 'script-json' | 'draft'
export type SourceImportContentKind = 'novel' | 'script' | 'draft'
export type SourceImportStrategy = 'append' | 'merge' | 'replace'

export interface SourceImportChapter {
  key: string
  title: string
  content: string
  orderIndex: number
  wordCount: number
  warning?: string
}

export interface SourceImportScene {
  key: string
  title: string
  location: string
  timeOfDay?: string
  visualDescription: string
  characters: string[]
  summary: string
  content: string
  orderIndex: number
  dialogueCount: number
  actionCount: number
}

export interface SourceImportEpisode {
  key: string
  episodeNumber: number
  title: string
  content: string
  scenes: SourceImportScene[]
}

export interface SourceImportPreview {
  fileName: string
  sourceType: SourceImportType
  contentKind: SourceImportContentKind
  title: string
  charCount: number
  chapters: SourceImportChapter[]
  episodes: SourceImportEpisode[]
  warnings: string[]
}

export interface SourceImportApplyInput {
  projectId: string
  preview: SourceImportPreview
  strategy: SourceImportStrategy
}

export interface SourceImportApplyResult {
  createdChapters: number
  updatedChapters: number
  createdEpisodes: number
  createdScripts: number
  updatedScripts: number
  createdScenes: number
  adaptationProjectId?: string
  checkpointCount: number
}

const MAX_ZIP_ENTRY_BYTES = 8 * 1024 * 1024
const LONG_CHAPTER_CHARS = 25_000

/**
 * 只做内容解析，不访问磁盘或 Electron API，因此可在单元测试中对不可信样本进行验证。
 * 文档读取与用户确认在 IPC 层完成；本函数绝不写入项目数据。
 */
export function parseSourceImportBuffer(fileName: string, buffer: Buffer): SourceImportPreview {
  const extension = extname(fileName).toLowerCase()
  if (extension === '.docx') return parseDocx(fileName, buffer)
  if (extension === '.epub') return parseEpub(fileName, buffer)
  const text = assertSourceTextLimit(normalizeText(decodeText(buffer)))
  if (extension === '.json') return parseStructuredScriptJson(fileName, text)
  if (extension === '.txt' || extension === '.md' || extension === '.markdown') return parseTextDocument(fileName, text, extension)
  throw new Error(`不支持的导入格式：${extension || '无扩展名'}`)
}

export function applySourceImport(repos: Repositories, input: SourceImportApplyInput): SourceImportApplyResult {
  const preview = normalizePreview(input.preview)
  if (!preview.chapters.length && !preview.episodes.length) throw new Error('导入内容为空，未写入任何数据')
  const project = repos.project.getProject(repos.db, input.projectId)
  if (!project) throw new Error('未找到导入目标项目')

  return repos.db.transaction((transaction) => {
    const db = transaction as DB
    const result: SourceImportApplyResult = {
      createdChapters: 0,
      updatedChapters: 0,
      createdEpisodes: 0,
      createdScripts: 0,
      updatedScripts: 0,
      createdScenes: 0,
      checkpointCount: 0,
    }

    if (preview.chapters.length) applyChapters(repos, db, input.projectId, preview, input.strategy, result)
    if (preview.episodes.length) applyScripts(repos, db, input.projectId, preview, input.strategy, result)
    return result
  })
}

function parseTextDocument(fileName: string, text: string, extension: string): SourceImportPreview {
  const script = parseMarkdownScript(text)
  if (script) {
    return {
      fileName,
      sourceType: 'markdown',
      contentKind: 'script',
      title: documentTitle(fileName, text),
      charCount: text.length,
      chapters: [],
      episodes: script,
      warnings: [],
    }
  }

  const parsed = parseNovelChapters(text)
  return {
    fileName,
    sourceType: extension === '.txt' ? 'txt' : 'markdown',
    contentKind: parsed.detected ? 'novel' : 'draft',
    title: documentTitle(fileName, text),
    charCount: text.length,
    chapters: parsed.chapters,
    episodes: [],
    warnings: parsed.warnings,
  }
}

function parseDocx(fileName: string, buffer: Buffer): SourceImportPreview {
  const entry = readZipEntry(buffer, 'word/document.xml')
  if (!entry) throw new Error('无法读取 Word 正文，请确认文件是有效 .docx')
  const text = assertSourceTextLimit(normalizeText(extractDocxText(entry.toString('utf-8'))))
  const parsed = parseNovelChapters(text)
  return {
    fileName,
    sourceType: 'docx',
    contentKind: parsed.detected ? 'novel' : 'draft',
    title: documentTitle(fileName, text),
    charCount: text.length,
    chapters: parsed.chapters,
    episodes: [],
    warnings: parsed.warnings,
  }
}

function parseEpub(fileName: string, buffer: Buffer): SourceImportPreview {
  const container = readZipEntry(buffer, 'META-INF/container.xml')
  if (!container) throw new Error('EPUB 缺少 META-INF/container.xml')
  const rootPath = /full-path=["']([^"']+)["']/i.exec(container.toString('utf-8'))?.[1]
  if (!rootPath) throw new Error('EPUB 未声明 OPF 内容清单')
  const opf = readZipEntry(buffer, rootPath)
  if (!opf) throw new Error('EPUB OPF 内容清单不可读取')
  const opfText = opf.toString('utf-8')
  const manifest = new Map<string, string>()
  for (const match of opfText.matchAll(/<item\b([^>]+)>/gi)) {
    const id = attribute(match[1], 'id')
    const href = attribute(match[1], 'href')
    if (id && href) manifest.set(id, resolveZipPath(dirname(rootPath), href))
  }
  const spine = [...opfText.matchAll(/<itemref\b([^>]+)>/gi)]
    .map((match) => attribute(match[1], 'idref'))
    .filter((id): id is string => Boolean(id))
  const chapters: SourceImportChapter[] = []
  const warnings: string[] = []
  const title = decodeXml(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opfText)?.[1] ?? stripExtension(fileName))
  for (const id of spine) {
    const path = manifest.get(id)
    if (!path) {
      warnings.push(`EPUB spine 条目 ${id} 未在 manifest 中找到，已跳过。`)
      continue
    }
    const entry = readZipEntry(buffer, path)
    if (!entry) {
      warnings.push(`EPUB 章节 ${path} 不可读取，已跳过。`)
      continue
    }
    const document = entry.toString('utf-8')
    const content = normalizeText(extractHtmlText(document))
    if (!content) continue
    const heading = decodeXml(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(document)?.[1] ?? '')
    chapters.push(createChapter(chapters.length, heading.trim() || `第${chapters.length + 1}章`, content))
  }
  if (!chapters.length) throw new Error('EPUB 中没有可导入的正文 spine 内容')
  assertSourceTextLimit(chapters.map((chapter) => chapter.content).join('\n'))
  addLongChapterWarnings(chapters, warnings)
  return { fileName, sourceType: 'epub', contentKind: 'novel', title, charCount: chapters.reduce((sum, chapter) => sum + chapter.content.length, 0), chapters, episodes: [], warnings }
}

function parseStructuredScriptJson(fileName: string, text: string): SourceImportPreview {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return draftPreview(fileName, text, 'JSON 不是可识别的剧本交换格式，已仅作为草稿文本导入；系统不会猜测分集或场景结构。')
  }
  const root = asRecord(parsed)
  const rawEpisodes = Array.isArray(parsed) ? parsed : Array.isArray(root?.episodes) ? root.episodes : Array.isArray(root?.scripts) ? root.scripts : undefined
  if (!rawEpisodes) {
    return draftPreview(fileName, text, 'JSON 未包含 episodes 或 scripts 数组，已仅作为草稿文本导入；系统不会猜测分集或场景结构。')
  }
  const episodes: SourceImportEpisode[] = []
  for (const [index, item] of rawEpisodes.entries()) {
    const episode = asRecord(item)
    if (!episode) throw new Error(`剧本交换格式第 ${index + 1} 项不是对象`)
    const episodeNumber = positiveNumber(episode.episodeNumber) ?? positiveNumber(episode.number) ?? index + 1
    const title = stringValue(episode.title) || `第${episodeNumber}集`
    const scenes = Array.isArray(episode.scenes)
      ? episode.scenes.map((scene, sceneIndex) => parseJsonScene(scene, sceneIndex))
      : []
    const content = stringValue(episode.content) || stringValue(episode.script) || renderEpisodeContent(title, scenes)
    if (!content.trim() && !scenes.length) throw new Error(`第 ${episodeNumber} 集没有可导入的剧本文本或场景`)
    episodes.push({ key: `episode-${index}`, episodeNumber, title, content: content.trim(), scenes })
  }
  if (!episodes.length) throw new Error('剧本交换格式没有可导入的分集')
  return {
    fileName,
    sourceType: 'script-json',
    contentKind: 'script',
    title: stringValue(root?.title) || stripExtension(fileName),
    charCount: text.length,
    chapters: [],
    episodes,
    warnings: [],
  }
}

function parseMarkdownScript(text: string): SourceImportEpisode[] | undefined {
  const lines = text.split('\n')
  const marks = lines
    .map((line, index) => ({ index, match: /^(?:#{1,6}\s*)?(?:第\s*([0-9一二三四五六七八九十百零〇两]+)\s*集|episode\s*(\d+))\s*[:：\-—]?(.*)$/i.exec(line.trim()) }))
    .filter((item): item is { index: number; match: RegExpExecArray } => Boolean(item.match))
  if (!marks.length) return undefined
  return marks.map(({ index, match }, episodeIndex) => {
    const end = marks[episodeIndex + 1]?.index ?? lines.length
    const episodeNumber = chineseNumber(match[1]) ?? (Number(match[2]) || episodeIndex + 1)
    const title = match[3]?.trim() || `第${episodeNumber}集`
    const body = lines.slice(index + 1, end).join('\n').trim()
    const scenes = parseMarkdownScenes(body)
    return {
      key: `episode-${episodeIndex}`,
      episodeNumber,
      title,
      content: body || title,
      scenes,
    }
  })
}

function parseMarkdownScenes(body: string): SourceImportScene[] {
  const lines = body.split('\n')
  const marks = lines
    .map((line, index) => ({ index, match: /^(?:#{1,6}\s*)?(?:场景|scene)\s*([0-9一二三四五六七八九十百零〇两]+)?\s*[:：\-—｜|]?\s*(.*)$/i.exec(line.trim()) }))
    .filter((item): item is { index: number; match: RegExpExecArray } => Boolean(item.match))
  return marks.map(({ index, match }, sceneIndex) => {
    const end = marks[sceneIndex + 1]?.index ?? lines.length
    const content = lines.slice(index + 1, end).join('\n').trim()
    const label = match[2]?.trim() || `场景 ${sceneIndex + 1}`
    const [location, timeOfDay] = label.split(/[，,｜|]/).map((part) => part.trim())
    return createScene(sceneIndex, label, location || '待补充', timeOfDay, content)
  })
}

function parseJsonScene(value: unknown, index: number): SourceImportScene {
  const scene = asRecord(value)
  if (!scene) throw new Error(`第 ${index + 1} 个场景不是对象`)
  const title = stringValue(scene.title) || `场景 ${index + 1}`
  const location = stringValue(scene.location) || '待补充'
  const content = stringValue(scene.content) || stringValue(scene.script) || stringValue(scene.summary) || ''
  const characters = Array.isArray(scene.characters) ? scene.characters.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : []
  return {
    ...createScene(index, title, location, stringValue(scene.timeOfDay), content),
    visualDescription: stringValue(scene.visualDescription) || stringValue(scene.visual) || '',
    characters,
    summary: stringValue(scene.summary) || content.slice(0, 240),
  }
}

function parseNovelChapters(text: string): { chapters: SourceImportChapter[]; warnings: string[]; detected: boolean } {
  const lines = text.split('\n')
  const marks = lines
    .map((line, index) => ({ index, title: parseChapterHeading(line) }))
    .filter((item): item is { index: number; title: string } => Boolean(item.title))
  const warnings: string[] = []
  if (!marks.length) {
    const content = text.trim()
    if (!content) return { chapters: [], warnings: ['文件没有可导入的正文。'], detected: false }
    const chapters = [createChapter(0, '正文草稿', content)]
    addLongChapterWarnings(chapters, warnings)
    warnings.unshift('未识别到明确章节边界，已作为一篇草稿文本导入；可在导入前手动拆分。')
    return { chapters, warnings, detected: false }
  }

  const chapters: SourceImportChapter[] = []
  const preface = lines.slice(0, marks[0].index).join('\n').trim()
  if (preface) chapters.push(createChapter(chapters.length, '前言', preface))
  marks.forEach((mark, index) => {
    const end = marks[index + 1]?.index ?? lines.length
    const content = lines.slice(mark.index + 1, end).join('\n').trim()
    if (!content) {
      warnings.push(`「${mark.title}」为空章节，已跳过。`)
      return
    }
    chapters.push(createChapter(chapters.length, mark.title, content))
  })
  if (!chapters.length) throw new Error('识别到的章节均为空，未写入任何数据')
  addLongChapterWarnings(chapters, warnings)
  return { chapters, warnings, detected: true }
}

function parseChapterHeading(line: string): string | undefined {
  const trimmed = line.trim()
  const markdown = /^(?:#{1,6}\s+)(.+)$/.exec(trimmed)?.[1]?.trim()
  const candidate = markdown ?? trimmed
  if (/^(?:第\s*[0-9一二三四五六七八九十百零〇两]+\s*[章节回]|chapter\s+[0-9ivxlcdm]+\b)/i.test(candidate)) return candidate
  return undefined
}

function applyChapters(
  repos: Repositories,
  db: DB,
  projectId: string,
  preview: SourceImportPreview,
  strategy: SourceImportStrategy,
  result: SourceImportApplyResult,
): void {
  const existing = repos.chapter.listChapters(db, projectId)
  const byTitle = new Map(existing.map((chapter) => [chapter.title.trim(), chapter]))
  let nextOrderIndex = existing.length
  for (const imported of preview.chapters) {
    const matched = byTitle.get(imported.title.trim())
    if (!matched || strategy === 'append') {
      repos.chapter.createChapter(db, { projectId, title: imported.title, content: imported.content, orderIndex: nextOrderIndex++ })
      result.createdChapters++
      continue
    }
    createCheckpoint(repos, db, projectId, 'chapter', matched.id, `导入前检查点：${matched.title}`, matched.content)
    result.checkpointCount++
    const content = strategy === 'merge' ? `${matched.content.trim()}\n\n---\n\n${imported.content}`.trim() : imported.content
    repos.chapter.updateChapter(db, matched.id, { title: imported.title, content })
    result.updatedChapters++
  }
}

function applyScripts(
  repos: Repositories,
  db: DB,
  projectId: string,
  preview: SourceImportPreview,
  strategy: SourceImportStrategy,
  result: SourceImportApplyResult,
): void {
  let adaptation = repos.adaptationProject.listAdaptationsByProject(db, projectId)[0]
  if (!adaptation) {
    adaptation = repos.adaptationProject.createAdaptationProject(db, {
      sourceProjectId: projectId,
      title: `${preview.title}·导入剧本第一季`,
      targetEpisodeCount: preview.episodes.length,
      adaptationStyle: '导入剧本',
      seasonNumber: 1,
    })
  }
  result.adaptationProjectId = adaptation.id
  const existingEpisodes = repos.episode.listEpisodes(db, adaptation.id)
  const existingScripts = repos.script.listScripts(db, adaptation.id)
  const scriptByNumber = new Map(existingScripts.map((script) => [script.episodeNumber, script]))
  let nextEpisodeNumber = Math.max(0, ...existingEpisodes.map((episode) => episode.episodeNumber)) + 1

  for (const imported of preview.episodes) {
    const matched = scriptByNumber.get(imported.episodeNumber)
    if (matched && strategy !== 'append') {
      createCheckpoint(repos, db, projectId, 'script', matched.id, `导入前检查点：${matched.title}`, matched.content)
      result.checkpointCount++
      const content = strategy === 'merge' ? `${matched.content.trim()}\n\n---\n\n${imported.content}`.trim() : imported.content
      const updated = repos.script.updateScript(db, matched.id, { title: imported.title, content })
      if (!updated) throw new Error(`无法更新第 ${imported.episodeNumber} 集剧本`)
      result.updatedScripts++
      if (strategy === 'replace') repos.scene.deleteScenesByScript(db, matched.id)
      const sceneOffset = strategy === 'merge' ? repos.scene.listScenesByScript(db, matched.id).length : 0
      imported.scenes.forEach((scene, index) => {
        repos.scene.createScene(db, { scriptId: matched.id, episodeId: matched.episodeId, sceneNumber: sceneOffset + index + 1, title: scene.title, location: scene.location, timeOfDay: scene.timeOfDay, visualDescription: scene.visualDescription, characters: scene.characters, summary: scene.summary, orderIndex: sceneOffset + index })
        result.createdScenes++
      })
      continue
    }

    const episodeNumber = matched ? nextEpisodeNumber++ : imported.episodeNumber
    const episode = repos.episode.createEpisode(db, {
      adaptationProjectId: adaptation.id,
      episodeNumber,
      title: imported.title,
      summary: imported.content.slice(0, 240) || imported.title,
      hook: imported.content.slice(0, 120) || imported.title,
      mainConflict: '待从导入剧本中整理',
      cliffhanger: '待补充',
    })
    const script = repos.script.createScript(db, { adaptationProjectId: adaptation.id, episodeId: episode.id, episodeNumber, title: imported.title, content: imported.content })
    result.createdEpisodes++
    result.createdScripts++
    imported.scenes.forEach((scene, index) => {
      repos.scene.createScene(db, { scriptId: script.id, episodeId: episode.id, sceneNumber: index + 1, title: scene.title, location: scene.location, timeOfDay: scene.timeOfDay, visualDescription: scene.visualDescription, characters: scene.characters, summary: scene.summary, orderIndex: index })
      result.createdScenes++
    })
  }
}

function createCheckpoint(repos: Repositories, db: DB, projectId: string, targetKind: 'chapter' | 'script', targetId: string, label: string, content: string): void {
  repos.creative.createContentVersion(db, { projectId, targetKind, targetId, label, source: 'manual_checkpoint', content, meta: { reason: 'source_import' } })
}

function normalizePreview(preview: SourceImportPreview): SourceImportPreview {
  const chapters = preview.chapters
    .map((chapter, index) => createChapter(index, chapter.title, normalizeText(chapter.content)))
    .filter((chapter) => chapter.content.length > 0)
  const episodes = preview.episodes
    .map((episode, index) => ({
      ...episode,
      key: episode.key || `episode-${index}`,
      episodeNumber: positiveNumber(episode.episodeNumber) ?? index + 1,
      title: episode.title.trim() || `第${index + 1}集`,
      content: normalizeText(episode.content),
      scenes: episode.scenes
        .map((scene, sceneIndex) => ({ ...scene, key: scene.key || `scene-${sceneIndex}`, title: scene.title.trim() || `场景 ${sceneIndex + 1}`, location: scene.location.trim() || '待补充', summary: scene.summary.trim() || scene.content.slice(0, 240), orderIndex: sceneIndex }))
        .filter((scene) => scene.content.trim() || scene.summary.trim()),
    }))
    .filter((episode) => episode.content || episode.scenes.length)
  return { ...preview, chapters, episodes }
}

function draftPreview(fileName: string, text: string, warning: string): SourceImportPreview {
  const content = text.trim()
  if (!content) throw new Error('文件没有可导入的正文')
  return {
    fileName,
    sourceType: 'draft',
    contentKind: 'draft',
    title: stripExtension(fileName),
    charCount: content.length,
    chapters: [createChapter(0, '草稿文本', content)],
    episodes: [],
    warnings: [warning],
  }
}

function createChapter(orderIndex: number, title: string, content: string): SourceImportChapter {
  const cleaned = content.trim()
  return { key: `chapter-${orderIndex}`, title: title.trim() || `第${orderIndex + 1}章`, content: cleaned, orderIndex, wordCount: countWords(cleaned) }
}

function createScene(orderIndex: number, title: string, location: string, timeOfDay: string | undefined, content: string): SourceImportScene {
  const cleaned = content.trim()
  const lines = cleaned.split('\n').map((line) => line.trim()).filter(Boolean)
  return {
    key: `scene-${orderIndex}`,
    title: title.trim() || `场景 ${orderIndex + 1}`,
    location: location.trim() || '待补充',
    timeOfDay: timeOfDay?.trim() || undefined,
    visualDescription: '',
    characters: [],
    summary: cleaned.slice(0, 240),
    content: cleaned,
    orderIndex,
    dialogueCount: lines.filter((line) => /^[^：:]{1,24}[：:]/.test(line)).length,
    actionCount: lines.filter((line) => /^[（(【\[]/.test(line)).length,
  }
}

function renderEpisodeContent(title: string, scenes: SourceImportScene[]): string {
  return [title, ...scenes.map((scene) => `## ${scene.title}\n${scene.content}`)].join('\n\n').trim()
}

function addLongChapterWarnings(chapters: SourceImportChapter[], warnings: string[]): void {
  for (const chapter of chapters) if (chapter.content.length > LONG_CHAPTER_CHARS) {
    chapter.warning = `本章 ${chapter.wordCount.toLocaleString('zh-CN')} 字，较长；建议在导入前拆分以便后续改编。`
    warnings.push(`「${chapter.title}」正文较长，已完整保留。`)
  }
}

function decodeText(buffer: Buffer): string {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) return buffer.subarray(3).toString('utf8')
  if (buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) return buffer.subarray(2).toString('utf16le')
  if (buffer.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) {
    const swapped = Buffer.from(buffer.subarray(2))
    swapped.swap16()
    return swapped.toString('utf16le')
  }
  const utf8 = buffer.toString('utf8')
  const replacements = [...utf8].filter((char) => char === '�').length
  if (replacements > Math.max(2, utf8.length / 200)) {
    try { return new TextDecoder('gb18030').decode(buffer) } catch { /* current runtime may omit this encoding */ }
  }
  return utf8
}

function extractDocxText(xml: string): string {
  const out: string[] = []
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<\/w:p>/g
  let match: RegExpExecArray | null
  while ((match = re.exec(xml))) {
    if (match[1] !== undefined) out.push(decodeXml(match[1]))
    else if (match[0].startsWith('<w:tab')) out.push('\t')
    else out.push('\n')
  }
  return out.join('')
}

function extractHtmlText(html: string): string {
  return decodeXml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<\/(?:p|div|h[1-6]|li|section|article|br)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
}

function readZipEntry(buffer: Buffer, fileName: string): Buffer | undefined {
  const eocdOffset = findEndOfCentralDirectory(buffer)
  if (eocdOffset < 0) return undefined
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16)
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10)
  let offset = centralOffset
  for (let index = 0; index < totalEntries; index++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) return undefined
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf-8')
    if (uncompressedSize > MAX_ZIP_ENTRY_BYTES) throw new Error(`压缩文档包含过大的条目：${name}`)
    if (name === fileName) {
      if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) return undefined
      const localNameLength = buffer.readUInt16LE(localOffset + 26)
      const localExtraLength = buffer.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + localNameLength + localExtraLength
      if (dataStart + compressedSize > buffer.length) return undefined
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize)
      if (method === 0) return Buffer.from(compressed)
      if (method === 8) return inflateRawSync(compressed, { maxOutputLength: MAX_ZIP_ENTRY_BYTES })
      throw new Error(`不支持的压缩方式：${method}`)
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  return undefined
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  if (buffer.length < 22) return -1
  const min = Math.max(0, buffer.length - 65_557)
  for (let index = buffer.length - 22; index >= min; index--) if (buffer.readUInt32LE(index) === 0x06054b50) return index
  return -1
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

function assertSourceTextLimit(text: string): string {
  const limit = getFileImportPolicy('sourceDocument').maxTextChars
  if (limit && text.length > limit) throw new Error(`小说或剧本文稿正文过长：${text.length.toLocaleString('zh-CN')} 字符，限制 ${limit.toLocaleString('zh-CN')} 字符。请拆分后再导入。`)
  return text
}

function documentTitle(fileName: string, text: string): string {
  const heading = text.split('\n').map((line) => line.trim()).find((line) => /^#\s+\S/.test(line))
  return heading?.replace(/^#\s+/, '').trim() || stripExtension(fileName)
}

function stripExtension(fileName: string): string { return basename(fileName, extname(fileName)).trim() || '未命名导入' }
function countWords(content: string): number { return [...content.replace(/\s/g, '')].length }
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined }
function stringValue(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined }
function positiveNumber(value: unknown): number | undefined { const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN; return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined }
function chineseNumber(value?: string): number | undefined { if (!value) return undefined; if (/^\d+$/.test(value)) return Number(value); const table: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }; if (value.length === 1) return table[value]; if (/^[一二三四五六七八九]十[一二三四五六七八九]?$/.test(value)) return table[value[0]] * 10 + (value.length === 3 ? table[value[2]] : 0); return undefined }
function attribute(fragment: string, name: string): string | undefined { return new RegExp(`${name}=["']([^"']+)["']`, 'i').exec(fragment)?.[1] }
function resolveZipPath(base: string, href: string): string { return posix.normalize(posix.join(base.replace(/\\/g, '/'), href.replace(/\\/g, '/'))).replace(/^\.\//, '') }
function decodeXml(value: string): string { return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&#(x[0-9a-f]+|\d+);/gi, (_m, entity) => String.fromCodePoint(entity.startsWith('x') ? Number.parseInt(entity.slice(1), 16) : Number(entity))) }
