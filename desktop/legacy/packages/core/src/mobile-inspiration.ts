import type {
  InspirationCardKind,
  InspirationFavorite,
  MobileInspirationImportInput,
} from './types'

export type MobileInspirationFavoriteInput = Omit<InspirationFavorite, 'id' | 'createdAt' | 'updatedAt'>

export interface ParsedMobileInspirationImport {
  items: MobileInspirationFavoriteInput[]
  skipped: number
  warnings: string[]
}

type RawMobileInspirationItem = Record<string, unknown>
type FieldKey = 'title' | 'kind' | 'pattern' | 'applyTo' | 'risk'

const MAX_IMPORT_LENGTH = 300_000

const FIELD_ALIASES: Record<FieldKey, string[]> = {
  title: ['title', 'name', 'heading', '标题', '名称'],
  kind: ['kind', 'type', 'category', '类型', '分类', '卡片类型'],
  pattern: ['pattern', 'content', 'note', 'text', 'body', 'idea', '模式', '内容', '灵感', '记录', '正文'],
  applyTo: ['applyTo', 'apply_to', 'usage', 'target', 'scene', '可用于', '适用', '用途', '应用'],
  risk: ['risk', 'riskNotes', 'risk_notes', 'warning', 'warnings', '风险', '风险提示', '注意'],
}

const KIND_ALIASES: Record<InspirationCardKind, string[]> = {
  opening: ['opening', 'hook', 'start', '开局', '钩子', '爆款开局', '第一章'],
  relationship: ['relationship', 'relation', 'character', '人物', '人物关系', '关系'],
  conflict: ['conflict', 'highlight', 'beat', '爽点', '冲突', '压迫', '反击'],
  reversal: ['reversal', 'twist', '反转', '转折'],
  cliffhanger: ['cliffhanger', '尾钩', '悬念', '集尾', '章末'],
  visual: ['visual', 'video', 'shot', 'cover', '画面', '镜头', '视频', '封面', '视觉'],
}

export function parseMobileInspirationImport(input: MobileInspirationImportInput): ParsedMobileInspirationImport {
  const text = input.content.replace(/\r\n?/g, '\n').trim()
  const warnings: string[] = []
  if (!input.projectId.trim()) throw new Error('缺少项目 id')
  if (!text) return { items: [], skipped: 0, warnings: ['导入内容为空'] }
  if (text.length > MAX_IMPORT_LENGTH) throw new Error('移动灵感文件超过 300KB，请拆分后再导入')

  const rawItems = looksLikeJson(text)
    ? parseJsonItems(text)
    : parseMarkdownItems(text)

  let skipped = 0
  const seen = new Set<string>()
  const items: MobileInspirationFavoriteInput[] = []
  for (const [index, raw] of rawItems.entries()) {
    const item = normalizeRawItem(raw, index, input, warnings)
    if (!item) {
      skipped += 1
      continue
    }
    if (seen.has(item.cardKey)) {
      skipped += 1
      continue
    }
    seen.add(item.cardKey)
    items.push(item)
  }

  if (rawItems.length > 0 && items.length === 0) warnings.push('未找到可导入的灵感卡片')
  return { items, skipped, warnings }
}

function looksLikeJson(text: string): boolean {
  return text.startsWith('{') || text.startsWith('[')
}

function parseJsonItems(text: string): RawMobileInspirationItem[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error('移动灵感 JSON 格式错误：' + (error instanceof Error ? error.message : String(error)))
  }
  const root = parsed as Record<string, unknown>
  const candidates = Array.isArray(parsed)
    ? parsed
    : Array.isArray(root.items)
      ? root.items
      : Array.isArray(root.cards)
        ? root.cards
        : Array.isArray(root.inspirations)
          ? root.inspirations
          : Array.isArray(root.records)
            ? root.records
            : undefined
  if (!candidates) throw new Error('移动灵感 JSON 需要是数组，或包含 items/cards/inspirations/records 数组')
  return candidates.map((item) => (isRecord(item) ? item : { pattern: String(item ?? '') }))
}

function parseMarkdownItems(text: string): RawMobileInspirationItem[] {
  return splitMarkdownBlocks(text).map(markdownBlockToRawItem).filter((item): item is RawMobileInspirationItem => Boolean(item))
}

function splitMarkdownBlocks(text: string): string[] {
  const dividerBlocks = text.split(/\n\s*---+\s*\n/g).map((block) => block.trim()).filter(Boolean)
  if (dividerBlocks.length > 1) return dividerBlocks

  const blocks: string[] = []
  let current: string[] = []
  for (const line of text.split('\n')) {
    if (/^#{1,6}\s+\S/.test(line) && current.some((item) => item.trim())) {
      blocks.push(current.join('\n').trim())
      current = []
    }
    current.push(line)
  }
  if (current.some((item) => item.trim())) blocks.push(current.join('\n').trim())
  return blocks.length ? blocks : [text]
}

function markdownBlockToRawItem(block: string): RawMobileInspirationItem | undefined {
  const raw: RawMobileInspirationItem = {}
  const patternLines: string[] = []
  let activeField: FieldKey | undefined

  for (const originalLine of block.split('\n')) {
    const line = originalLine.trim()
    if (!line) continue

    const heading = line.match(/^#{1,6}\s+(.+)$/)
    if (heading) {
      raw.title ??= heading[1].trim()
      activeField = undefined
      continue
    }

    const field = parseMarkdownField(line)
    if (field) {
      appendField(raw, field.key, field.value)
      activeField = field.key
      continue
    }

    const continuation = cleanMarkdownLine(line)
    if (activeField && activeField !== 'kind') {
      appendField(raw, activeField, continuation)
    } else {
      patternLines.push(continuation)
    }
  }

  if (!readString(raw, 'pattern') && patternLines.length > 0) raw.pattern = patternLines.join('\n')
  return Object.keys(raw).length ? raw : undefined
}

function parseMarkdownField(line: string): { key: FieldKey; value: string } | undefined {
  const match = cleanMarkdownLine(line).match(/^([^:：]{1,24})[:：]\s*(.*)$/)
  if (!match) return undefined
  const label = normalizeLabel(match[1])
  const key = (Object.keys(FIELD_ALIASES) as FieldKey[]).find((item) =>
    FIELD_ALIASES[item].some((alias) => normalizeLabel(alias) === label),
  )
  return key ? { key, value: match[2].trim() } : undefined
}

function normalizeRawItem(
  raw: RawMobileInspirationItem,
  index: number,
  input: MobileInspirationImportInput,
  warnings: string[],
): MobileInspirationFavoriteInput | undefined {
  const pattern = truncate(readFirst(raw, FIELD_ALIASES.pattern), 1200)
  if (!pattern) return undefined

  const kind = normalizeKind(readFirst(raw, FIELD_ALIASES.kind)) ?? inferKind(`${readFirst(raw, FIELD_ALIASES.title)} ${pattern}`)
  const title = truncate(readFirst(raw, FIELD_ALIASES.title) || titleFromPattern(pattern, index), 80)
  const applyTo = truncate(readFirst(raw, FIELD_ALIASES.applyTo) || defaultApplyTo(kind), 320)
  const risk = truncate(readFirst(raw, FIELD_ALIASES.risk), 500)
  const sourceId = buildMobileSourceId(input.fileName)
  const cardKey = makeMobileCardKey(sourceId, kind, `${title}\n${pattern}\n${applyTo}`)

  if (!title) {
    warnings.push(`第 ${index + 1} 条灵感缺少标题，已用内容摘要代替`)
  }

  return {
    projectId: input.projectId,
    cardKey,
    sourceKind: 'mobile_import',
    sourceId,
    kind,
    title,
    pattern,
    applyTo,
    risk: risk || undefined,
  }
}

function readFirst(raw: RawMobileInspirationItem, aliases: string[]): string {
  for (const alias of aliases) {
    const value = readString(raw, alias)
    if (value) return value
  }
  return ''
}

function readString(raw: RawMobileInspirationItem, key: string): string {
  const exact = raw[key]
  const looseKey = Object.keys(raw).find((candidate) => normalizeLabel(candidate) === normalizeLabel(key))
  const value = exact ?? (looseKey ? raw[looseKey] : undefined)
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join('；')
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return ''
  return String(value).trim()
}

function appendField(raw: RawMobileInspirationItem, key: FieldKey, value: string): void {
  if (!value) return
  const current = readString(raw, key)
  raw[key] = current ? `${current}\n${value}` : value
}

function normalizeKind(value: string): InspirationCardKind | undefined {
  const label = value.toLowerCase().trim()
  if (!label) return undefined
  return (Object.keys(KIND_ALIASES) as InspirationCardKind[]).find((kind) =>
    KIND_ALIASES[kind].some((alias) => label.includes(alias.toLowerCase())),
  )
}

function inferKind(value: string): InspirationCardKind {
  return normalizeKind(value) ?? 'conflict'
}

function defaultApplyTo(kind: InspirationCardKind): string {
  switch (kind) {
    case 'opening':
      return '项目开局 / 第一章钩子'
    case 'relationship':
      return '人物关系 / 人物卡'
    case 'reversal':
      return '章节反转 / 分集转折'
    case 'cliffhanger':
      return '章节末尾 / 集尾悬念'
    case 'visual':
      return '项目视觉方向 / 视频画面基调'
    case 'conflict':
    default:
      return '章节主冲突 / 爽点设计'
  }
}

function titleFromPattern(pattern: string, index: number): string {
  const firstLine = pattern.split('\n').find((line) => line.trim())?.trim() ?? ''
  return firstLine ? firstLine.slice(0, 40) : `移动灵感 ${index + 1}`
}

function buildMobileSourceId(fileName: string | undefined): string {
  const base = fileName?.trim() || 'mobile-inspiration'
  return `mobile:${base.slice(0, 120)}`
}

function makeMobileCardKey(sourceId: string, kind: InspirationCardKind, value: string): string {
  return ['mobile_import', encodeURIComponent(sourceId), kind, stableHash(value)].join(':')
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash.toString(36)
}

function truncate(value: string, limit: number): string {
  const text = value.replace(/[ \t]+/g, ' ').trim()
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 3)}...`
}

function cleanMarkdownLine(line: string): string {
  return line.replace(/^[-*+]\s+/, '').trim()
}

function normalizeLabel(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase()
}

function isRecord(value: unknown): value is RawMobileInspirationItem {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
