import type { Chapter, StoryArc } from '@sdns/core'

export type ChapterTreeRow =
  | {
      kind: 'arc'
      id: string
      depth: number
      title: string
      arcKind: StoryArc['kind']
      chapterCount: number
      collapsed: boolean
    }
  | {
      kind: 'chapter'
      id: string
      depth: number
      chapter: Chapter
    }

export interface ChapterTreeOptions {
  query?: string
  collapsedArcIds?: ReadonlySet<string>
}

interface ArcNode {
  arc: StoryArc
  children: ArcNode[]
  chapters: Chapter[]
}

function normalizedText(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ').toLocaleLowerCase('zh-CN')
}

function chapterMatches(chapter: Chapter, query: string): boolean {
  return normalizedText(chapter.title, chapter.summary, chapter.outline, chapter.content).includes(query)
}

function arcMatches(arc: StoryArc, query: string): boolean {
  return normalizedText(arc.title, arc.summary, arc.coreConflict).includes(query)
}

function chapterNumber(chapter: Chapter): number {
  return chapter.orderIndex + 1
}

function arcContainsChapter(arc: StoryArc, chapter: Chapter): boolean {
  const number = chapterNumber(chapter)
  return arc.chapterStart !== undefined && arc.chapterEnd !== undefined && number >= arc.chapterStart && number <= arc.chapterEnd
}

function arcDepth(arc: StoryArc, byId: ReadonlyMap<string, StoryArc>): number {
  let depth = 0
  let parentId = arc.parentId
  const visited = new Set<string>()
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    depth += 1
    parentId = byId.get(parentId)?.parentId
  }
  return depth
}

/**
 * 将既有 story arc（卷 / 单元 / 阶段）和章节顺序投影为可虚拟化的一维树。
 * 章节仍只由 orderIndex 排序；arc 的 chapterStart/chapterEnd 只是展示分组，
 * 因此可在没有新业务模型的前提下向后兼容旧项目。
 */
export function buildChapterTreeRows(
  chapters: Chapter[],
  arcs: StoryArc[],
  options: ChapterTreeOptions = {},
): ChapterTreeRow[] {
  const query = options.query?.trim().toLocaleLowerCase('zh-CN') ?? ''
  const collapsed = options.collapsedArcIds ?? new Set<string>()
  const orderedChapters = [...chapters].sort((a, b) => a.orderIndex - b.orderIndex)
  const orderedArcs = [...arcs].sort((a, b) => a.orderIndex - b.orderIndex)
  const byId = new Map(orderedArcs.map((arc) => [arc.id, arc]))
  const nodes = new Map<string, ArcNode>(orderedArcs.map((arc) => [arc.id, { arc, children: [], chapters: [] }]))
  const roots: ArcNode[] = []

  for (const node of nodes.values()) {
    const parent = node.arc.parentId ? nodes.get(node.arc.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  const ungrouped: Chapter[] = []
  for (const chapter of orderedChapters) {
    const candidates = orderedArcs
      .filter((arc) => arcContainsChapter(arc, chapter))
      .sort((a, b) => arcDepth(b, byId) - arcDepth(a, byId))
    const target = candidates[0] ? nodes.get(candidates[0].id) : undefined
    if (target) target.chapters.push(chapter)
    else ungrouped.push(chapter)
  }

  const rows: ChapterTreeRow[] = []
  const addChapter = (chapter: Chapter, depth: number) => {
    if (!query || chapterMatches(chapter, query)) rows.push({ kind: 'chapter', id: chapter.id, depth, chapter })
  }
  const arcHasMatch = (node: ArcNode): boolean => {
    if (!query) return true
    return arcMatches(node.arc, query) || node.chapters.some((chapter) => chapterMatches(chapter, query)) || node.children.some(arcHasMatch)
  }
  const countDescendantChapters = (node: ArcNode): number =>
    node.chapters.length + node.children.reduce((sum, child) => sum + countDescendantChapters(child), 0)
  const addArc = (node: ArcNode, depth: number) => {
    if (!arcHasMatch(node)) return
    const isCollapsed = !query && collapsed.has(node.arc.id)
    rows.push({
      kind: 'arc',
      id: node.arc.id,
      depth,
      title: node.arc.title,
      arcKind: node.arc.kind,
      chapterCount: countDescendantChapters(node),
      collapsed: isCollapsed,
    })
    if (isCollapsed) return
    node.children.forEach((child) => addArc(child, depth + 1))
    node.chapters.forEach((chapter) => addChapter(chapter, depth + 1))
  }

  roots.forEach((root) => addArc(root, 0))
  if (ungrouped.length > 0) {
    const showUngrouped = !query || ungrouped.some((chapter) => chapterMatches(chapter, query))
    if (showUngrouped && roots.length > 0) {
      rows.push({
        kind: 'arc',
        id: '__ungrouped__',
        depth: 0,
        title: '未分组章节',
        arcKind: 'stage',
        chapterCount: ungrouped.length,
        collapsed: !query && collapsed.has('__ungrouped__'),
      })
    }
    if (!(roots.length > 0 && !query && collapsed.has('__ungrouped__'))) {
      ungrouped.forEach((chapter) => addChapter(chapter, roots.length > 0 ? 1 : 0))
    }
  }
  return rows
}

/** 保持其余 id 的相对顺序，供拖拽、显式上下移动和批量移动共用。 */
export function moveChapterIds(orderedIds: string[], movingIds: string[], targetId?: string): string[] {
  const moving = new Set(movingIds)
  const retained = orderedIds.filter((id) => !moving.has(id))
  const moved = orderedIds.filter((id) => moving.has(id))
  if (!targetId) return [...retained, ...moved]
  const targetIndex = retained.indexOf(targetId)
  if (targetIndex < 0) return [...retained, ...moved]
  return [...retained.slice(0, targetIndex), ...moved, ...retained.slice(targetIndex)]
}

export function chapterTreeVirtualRange(
  total: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight = 36,
  overscan = 6,
): { start: number; end: number } {
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(total, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan)
  return { start, end }
}
