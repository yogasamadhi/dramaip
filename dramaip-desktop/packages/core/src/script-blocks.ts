/**
 * 可逆的剧本块模型。
 *
 * 持久化仍以 Markdown 为唯一真相：这是一个派生编辑模型，因此旧剧本、AI 输出和
 * 项目包无需迁移即可进入结构化编辑器。序列化使用一套稳定、易读的 Markdown 方言，
 * 不会丢弃场景、动作、人物、对白或转场的语义。
 */
export type ScriptBlockKind = 'scene_heading' | 'action' | 'character' | 'dialogue' | 'transition'

export interface ScriptBlock {
  id: string
  kind: ScriptBlockKind
  /** 场景、动作、人物或转场文本；对白的台词正文。 */
  text: string
  /** 仅对白块使用的人物名。 */
  speaker?: string
}

export interface StructuredScriptDocument {
  format: 'dramaip-script-blocks'
  version: 1
  blocks: ScriptBlock[]
}

const SCENE_PATTERN = /^(?:#{1,6}\s*)?(?:(?:场景\s*\d*|内景|外景|内\/外景|INT\.?|EXT\.?|I\/E\.?)[\s：:.—-]*)(.*)$/i
const TRANSITION_PATTERN = /^(?:#{1,6}\s*)?(?:转场|切至|切换至|CUT\s+TO|FADE\s+(?:IN|OUT)|DISSOLVE\s+TO)[\s：:.—-]*(.*)$/i
const CHARACTER_PATTERN = /^(?:人物|角色|CHARACTER)\s*[：:]\s*(.+)$/i
const DIALOGUE_PATTERN = /^([^：:#\n]{1,24})\s*[：:]\s*(.+)$/
const NON_DIALOGUE_PREFIXES = new Set(['场景', '动作', '画面', '旁白', '转场', '备注', '时间', '地点', '人物', '角色', '镜头'])

export function parseScriptMarkdown(content: string): StructuredScriptDocument {
  const blocks = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => parseLine(line, index))

  return {
    format: 'dramaip-script-blocks',
    version: 1,
    blocks: blocks.length ? blocks : [makeBlock('action', '', 0)],
  }
}

/** 将结构化块稳定写回兼容旧交付管道的 Markdown。 */
export function serializeScriptMarkdown(document: StructuredScriptDocument): string {
  return document.blocks
    .map((block) => serializeBlock(normalizeBlock(block, 0)))
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

/** JSON 是导入/导出交换格式；旧 export 中的 script.content 同样可以被读取。 */
export function serializeStructuredScriptDocument(document: StructuredScriptDocument): string {
  return JSON.stringify(normalizeDocument(document), null, 2)
}

export function parseStructuredScriptImport(value: string): StructuredScriptDocument {
  const trimmed = value.trim()
  if (!trimmed) return parseScriptMarkdown('')
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return parseScriptMarkdown(value)

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error('JSON 格式无效；请修正后再导入，或改为粘贴 Markdown。')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('仅支持结构化剧本 JSON 或现有剧本导出 JSON。')
  }
  const input = parsed as Record<string, unknown>
  if (isStructuredDocument(input)) return normalizeDocument(input)
  if (isStructuredDocument(input.structuredDocument)) return normalizeDocument(input.structuredDocument)
  if (isScriptExport(input)) return parseScriptMarkdown(input.script.content)
  throw new Error('未找到可导入的剧本块或 script.content。')
}

export function replaceScriptBlock(document: StructuredScriptDocument, id: string, patch: Partial<Omit<ScriptBlock, 'id'>>): StructuredScriptDocument {
  return normalizeDocument({
    ...document,
    blocks: document.blocks.map((block) => block.id === id ? { ...block, ...patch } : block),
  })
}

export function insertScriptBlock(document: StructuredScriptDocument, afterId: string | undefined, kind: ScriptBlockKind): StructuredScriptDocument {
  const blocks = document.blocks.map((block, index) => normalizeBlock(block, index))
  const index = afterId ? blocks.findIndex((block) => block.id === afterId) : blocks.length - 1
  const next = makeBlock(kind, defaultText(kind), blocks.length)
  blocks.splice(Math.max(0, index + 1), 0, next)
  return normalizeDocument({ ...document, blocks })
}

export function removeScriptBlock(document: StructuredScriptDocument, id: string): StructuredScriptDocument {
  const blocks = document.blocks.filter((block) => block.id !== id)
  return normalizeDocument({ ...document, blocks: blocks.length ? blocks : [makeBlock('action', '', 0)] })
}

export function moveScriptBlock(document: StructuredScriptDocument, id: string, direction: -1 | 1): StructuredScriptDocument {
  const blocks = document.blocks.map((block, index) => normalizeBlock(block, index))
  const index = blocks.findIndex((block) => block.id === id)
  const nextIndex = index + direction
  if (index < 0 || nextIndex < 0 || nextIndex >= blocks.length) return normalizeDocument({ ...document, blocks })
  const [block] = blocks.splice(index, 1)
  blocks.splice(nextIndex, 0, block)
  return normalizeDocument({ ...document, blocks })
}

export function scriptBlockLabel(block: Pick<ScriptBlock, 'kind' | 'text' | 'speaker'>): string {
  const labels: Record<ScriptBlockKind, string> = {
    scene_heading: '场景',
    action: '动作',
    character: '人物',
    dialogue: '对白',
    transition: '转场',
  }
  const detail = block.kind === 'dialogue' ? block.speaker : block.text
  return detail?.trim() ? `${labels[block.kind]} · ${detail.trim().slice(0, 24)}` : labels[block.kind]
}

function parseLine(line: string, index: number): ScriptBlock {
  const scene = line.match(SCENE_PATTERN)
  if (scene) return makeBlock('scene_heading', scene[1]?.trim() || line.replace(/^#{1,6}\s*/, ''), index)

  const transition = line.match(TRANSITION_PATTERN)
  if (transition) return makeBlock('transition', transition[1]?.trim() || line.replace(/^#{1,6}\s*/, ''), index)

  const character = line.match(CHARACTER_PATTERN)
  if (character) return makeBlock('character', character[1].trim(), index)

  const emphasizedCharacter = line.match(/^\*\*([^*]{1,48})\*\*$/)
  if (emphasizedCharacter) return makeBlock('character', emphasizedCharacter[1].trim(), index)

  const dialogue = line.match(DIALOGUE_PATTERN)
  if (dialogue && !NON_DIALOGUE_PREFIXES.has(dialogue[1].trim())) {
    return { ...makeBlock('dialogue', dialogue[2].trim(), index), speaker: dialogue[1].trim() }
  }

  return makeBlock('action', line, index)
}

function serializeBlock(block: ScriptBlock): string {
  const text = block.text.trim()
  if (!text && block.kind !== 'dialogue') return ''
  if (block.kind === 'scene_heading') return `## 场景：${text}`
  if (block.kind === 'character') return `**${text}**`
  if (block.kind === 'dialogue') return `${block.speaker?.trim() || '人物'}：${text}`
  if (block.kind === 'transition') return `转场：${text}`
  return text
}

function normalizeDocument(document: { blocks?: unknown }): StructuredScriptDocument {
  const rawBlocks = Array.isArray(document.blocks) ? document.blocks : []
  const blocks = rawBlocks
    .filter((block): block is Record<string, unknown> => Boolean(block) && typeof block === 'object' && !Array.isArray(block))
    .map((block, index) => normalizeBlock(block, index))
  return {
    format: 'dramaip-script-blocks',
    version: 1,
    blocks: blocks.length ? blocks : [makeBlock('action', '', 0)],
  }
}

function normalizeBlock(block: Partial<ScriptBlock> | Record<string, unknown>, index: number): ScriptBlock {
  const kind = isScriptBlockKind(block.kind) ? block.kind : 'action'
  const text = typeof block.text === 'string' ? block.text : ''
  const id = typeof block.id === 'string' && block.id.trim() ? block.id : `block-${index + 1}`
  const speaker = typeof block.speaker === 'string' && block.speaker.trim() ? block.speaker.trim() : undefined
  return kind === 'dialogue' ? { id, kind, text, speaker } : { id, kind, text }
}

function makeBlock(kind: ScriptBlockKind, text: string, index: number): ScriptBlock {
  return kind === 'dialogue'
    ? { id: `block-${index + 1}`, kind, text, speaker: '人物' }
    : { id: `block-${index + 1}`, kind, text }
}

function defaultText(kind: ScriptBlockKind): string {
  if (kind === 'scene_heading') return '新场景'
  if (kind === 'transition') return '切至下一场'
  if (kind === 'character') return '人物'
  if (kind === 'dialogue') return '（待写对白）'
  return '（待写动作）'
}

function isScriptBlockKind(value: unknown): value is ScriptBlockKind {
  return value === 'scene_heading' || value === 'action' || value === 'character' || value === 'dialogue' || value === 'transition'
}

function isStructuredDocument(value: unknown): value is { format?: unknown; version?: unknown; blocks?: unknown } {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Array.isArray((value as { blocks?: unknown }).blocks)
}

function isScriptExport(value: Record<string, unknown>): value is { script: { content: string } } {
  const script = value.script
  return Boolean(script) && typeof script === 'object' && typeof (script as { content?: unknown }).content === 'string'
}
