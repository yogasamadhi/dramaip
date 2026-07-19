import type { TextDiffPreviewPayload } from '@sdns/core'

export type SegmentedDiffKind = 'same' | 'add' | 'remove' | 'replace'

export interface SegmentedDiffBlock {
  id: string
  kind: SegmentedDiffKind
  before: string
  after: string
}

/**
 * 以段落（而非逐行）呈现文本变化。算法只在相邻的有限窗口中寻找共同锚点，
 * 因而长文不会落入 O(n²) 的 LCS 计算或满屏单行红绿块。
 */
export function buildSegmentedTextDiff(previous: string, next: string): SegmentedDiffBlock[] {
  if (previous === next) return []
  const before = splitParagraphs(previous)
  const after = splitParagraphs(next)
  const blocks: SegmentedDiffBlock[] = []
  let oldIndex = 0
  let newIndex = 0
  let sequence = 0

  const push = (kind: SegmentedDiffKind, oldText = '', newText = '') => {
    blocks.push({ id: `change-${sequence++}`, kind, before: oldText, after: newText })
  }

  while (oldIndex < before.length || newIndex < after.length) {
    if (before[oldIndex] === after[newIndex]) {
      push('same', before[oldIndex], after[newIndex])
      oldIndex++
      newIndex++
      continue
    }

    const anchor = findNearbyAnchor(before, after, oldIndex, newIndex)
    const oldEnd = anchor?.oldIndex ?? before.length
    const newEnd = anchor?.newIndex ?? after.length
    const oldChunk = before.slice(oldIndex, oldEnd)
    const newChunk = after.slice(newIndex, newEnd)
    const length = Math.max(oldChunk.length, newChunk.length)
    for (let index = 0; index < length; index++) {
      const oldText = oldChunk[index] ?? ''
      const newText = newChunk[index] ?? ''
      if (!oldText) push('add', '', newText)
      else if (!newText) push('remove', oldText, '')
      else push('replace', oldText, newText)
    }
    oldIndex = oldEnd
    newIndex = newEnd
  }

  return blocks
}

export function selectedText(blocks: SegmentedDiffBlock[], selectedIds: ReadonlySet<string>): string {
  return blocks
    .map((block) => (block.kind === 'same' || selectedIds.has(block.id) ? block.after : block.before))
    .filter((block) => block.length > 0)
    .join('\n\n')
}

export function changedBlockIds(blocks: SegmentedDiffBlock[]): string[] {
  return blocks.filter((block) => block.kind !== 'same').map((block) => block.id)
}

/** 将文本候选同步到结构化目标，确保后续仍可走原子采用。 */
export function withPreviewContent(preview: TextDiffPreviewPayload, nextContent: string): TextDiffPreviewPayload {
  if (preview.targetKind === 'script') {
    return { ...preview, nextContent, script: preview.script ? { ...preview.script, content: nextContent } : undefined }
  }
  if (preview.targetKind === 'shot') {
    const shotPatch = parseShotPrompt(nextContent, preview.shotPatch) ?? {}
    // 镜头采用依赖三项结构化 Prompt；将编辑后的内容规范回带标题的形式，
    // 避免用户误删标题后出现“画面看到 A、实际写入 B”。
    return { ...preview, nextContent: renderShotPrompt(shotPatch), shotPatch }
  }
  return { ...preview, nextContent }
}

export function splitParagraphs(value: string): string[] {
  const normalized = value.replace(/\r\n/g, '\n').trim()
  return normalized ? normalized.split(/\n\s*\n+/).map((item) => item.trim()).filter(Boolean) : []
}

function findNearbyAnchor(
  before: string[],
  after: string[],
  oldStart: number,
  newStart: number,
): { oldIndex: number; newIndex: number } | undefined {
  // 修改密集时只寻找接下来的 80 段；没有锚点时将剩余内容作为成组替换。
  // 这保证了 10k 段长文仍为近线性时间，并避免浏览器长时间阻塞。
  const oldEnd = Math.min(before.length, oldStart + 80)
  const newEnd = Math.min(after.length, newStart + 80)
  let best: { oldIndex: number; newIndex: number; distance: number } | undefined
  for (let oldIndex = oldStart; oldIndex < oldEnd; oldIndex++) {
    for (let newIndex = newStart; newIndex < newEnd; newIndex++) {
      if (before[oldIndex] !== after[newIndex]) continue
      const distance = oldIndex - oldStart + newIndex - newStart
      if (!best || distance < best.distance) best = { oldIndex, newIndex, distance }
      if (distance === 0) return best
    }
  }
  return best
}

function parseShotPrompt(value: string, fallback: TextDiffPreviewPayload['shotPatch']): TextDiffPreviewPayload['shotPatch'] {
  const labels = [
    ['视频 Prompt:', 'videoPrompt'],
    ['负面 Prompt:', 'negativePrompt'],
    ['图片 Prompt:', 'imagePrompt'],
  ] as const
  const output: NonNullable<TextDiffPreviewPayload['shotPatch']> = { ...fallback }
  for (let index = 0; index < labels.length; index++) {
    const [label, key] = labels[index]
    const nextLabel = labels[index + 1]?.[0]
    const start = value.indexOf(label)
    if (start < 0) continue
    const contentStart = start + label.length
    const end = nextLabel ? value.indexOf(nextLabel, contentStart) : value.length
    output[key] = value.slice(contentStart, end < 0 ? value.length : end).trim()
  }
  return output
}

function renderShotPrompt(patch: NonNullable<TextDiffPreviewPayload['shotPatch']>): string {
  return [
    `视频 Prompt:\n${patch.videoPrompt ?? ''}`,
    `负面 Prompt:\n${patch.negativePrompt ?? ''}`,
    `图片 Prompt:\n${patch.imagePrompt ?? ''}`,
  ].join('\n\n')
}
