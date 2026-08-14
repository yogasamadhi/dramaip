import { type DragEvent, type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, CircleAlert, CircleCheck, CircleDashed, GripVertical, ListChecks, MoveDown, Search, X } from 'lucide-react'
import type { Chapter, QualityGateVerdict, StoryArc } from '@sdns/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { buildChapterTreeRows, chapterTreeVirtualRange } from '@/lib/chapterTree'

const ROW_HEIGHT = 36

export interface ChapterTreeStatus {
  words: number
  hasMemory: boolean
  quality?: QualityGateVerdict
  saveState?: 'clean' | 'dirty' | 'saving' | 'saved' | 'error' | 'recovered'
}

interface ChapterTreeProps {
  chapters: Chapter[]
  storyArcs: StoryArc[]
  selectedId: string | null
  statuses: Record<string, ChapterTreeStatus>
  onSelect: (chapterId: string) => void
  onCreate: () => void
  onReorder: (orderedIds: string[]) => void
  searchInputRef?: RefObject<HTMLInputElement | null>
}

function qualityLabel(verdict?: QualityGateVerdict): string {
  if (verdict === 'pass') return '质检通过'
  if (verdict === 'warn') return '质检提醒'
  if (verdict === 'block') return '质检阻塞'
  return '未质检'
}

function saveLabel(state?: ChapterTreeStatus['saveState']): string {
  if (state === 'dirty') return '待保存'
  if (state === 'saving') return '保存中'
  if (state === 'error') return '保存失败'
  if (state === 'recovered') return '已恢复草稿'
  return '已保存'
}

function statusIcon(status: ChapterTreeStatus) {
  if (status.quality === 'block' || status.quality === 'warn') return <CircleAlert className="h-3.5 w-3.5 text-warn" aria-hidden="true" />
  if (status.saveState === 'error') return <CircleAlert className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
  if (status.hasMemory) return <CircleCheck className="h-3.5 w-3.5 text-success" aria-hidden="true" />
  return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
}

export function ChapterTree({
  chapters,
  storyArcs,
  selectedId,
  statuses,
  onSelect,
  onCreate,
  onReorder,
  searchInputRef,
}: ChapterTreeProps) {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(360)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(
    () => buildChapterTreeRows(chapters, storyArcs, { query, collapsedArcIds: collapsed }),
    [chapters, storyArcs, query, collapsed],
  )
  const range = chapterTreeVirtualRange(rows.length, scrollTop, viewportHeight, ROW_HEIGHT)
  const visibleRows = rows.slice(range.start, range.end)
  const orderedIds = useMemo(() => [...chapters].sort((a, b) => a.orderIndex - b.orderIndex).map((chapter) => chapter.id), [chapters])

  useEffect(() => {
    const tree = treeRef.current
    if (!tree) return
    const updateHeight = () => setViewportHeight(tree.clientHeight || 360)
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(tree)
    return () => observer.disconnect()
  }, [treeRef])

  useEffect(() => {
    setChecked((current) => new Set([...current].filter((id) => orderedIds.includes(id))))
  }, [orderedIds])

  function toggleCollapsed(id: string) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleChecked(id: string) {
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function moveBefore(sourceId: string, targetId: string) {
    if (sourceId === targetId) return
    const withoutSource = orderedIds.filter((id) => id !== sourceId)
    const targetIndex = withoutSource.indexOf(targetId)
    if (targetIndex < 0) return
    onReorder([...withoutSource.slice(0, targetIndex), sourceId, ...withoutSource.slice(targetIndex)])
  }

  function moveSelectedToEnd() {
    if (checked.size === 0) return
    const selected = orderedIds.filter((id) => checked.has(id))
    onReorder([...orderedIds.filter((id) => !checked.has(id)), ...selected])
  }

  function moveByOne(chapterId: string, delta: -1 | 1) {
    const index = orderedIds.indexOf(chapterId)
    const targetIndex = index + delta
    if (index < 0 || targetIndex < 0 || targetIndex >= orderedIds.length) return
    const next = [...orderedIds]
    ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
    onReorder(next)
  }

  const selectedCount = checked.size
  return (
    <section className="flex h-full min-h-0 flex-col bg-background" aria-label="章节树">
      <div className="space-y-2 border-b p-2">
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <Input
              ref={searchInputRef}
              id="chapter-tree-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 pl-7 pr-7 text-xs"
              placeholder="搜索章节（⌘/Ctrl K）"
              aria-label="搜索章节"
            />
            {query && (
              <button
                type="button"
                className="absolute right-1.5 top-1.5 rounded p-1 text-muted-foreground hover:bg-muted"
                aria-label="清除章节搜索"
                onClick={() => setQuery('')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button type="button" size="sm" className="h-8 shrink-0 px-2 text-xs" onClick={onCreate} aria-keyshortcuts="Control+N Meta+N">
            新建章节
          </Button>
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>{chapters.length} 章 · {storyArcs.filter((arc) => arc.kind === 'volume').length} 卷</span>
          <span>拖拽排序 · Alt ↑↓ 切章</span>
        </div>
        {selectedCount > 0 && (
          <div className="flex items-center gap-1 rounded-md bg-accent/70 px-1.5 py-1 text-xs text-accent-foreground">
            <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="min-w-0 flex-1">已选 {selectedCount} 章</span>
            <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={moveSelectedToEnd}>
              <MoveDown className="h-3.5 w-3.5" />
              移至末尾
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => setChecked(new Set())} aria-label="取消批量选择">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      <div
        ref={(element) => { treeRef.current = element }}
        role="tree"
        aria-label="按卷和单元分组的章节"
        className="min-h-0 flex-1 overflow-auto py-1"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
          {visibleRows.map((row, offset) => {
            const index = range.start + offset
            const top = index * ROW_HEIGHT
            if (row.kind === 'arc') {
              const label = `${row.arcKind === 'volume' ? '卷' : row.arcKind === 'unit' ? '单元' : '阶段'}：${row.title}，${row.chapterCount} 章`
              return (
                <div key={row.id} className="absolute left-0 right-0 flex h-9 items-center" style={{ top, paddingLeft: `${8 + row.depth * 14}px` }} role="treeitem" aria-level={row.depth + 1} aria-expanded={!row.collapsed}>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-1 text-left text-xs font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => toggleCollapsed(row.id)}
                    aria-label={label}
                  >
                    {row.collapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
                    <span className="truncate">{row.title}</span>
                    <span className="ml-auto pr-1 text-[10px] tabular-nums">{row.chapterCount}</span>
                  </button>
                </div>
              )
            }
            const status = statuses[row.chapter.id] ?? { words: 0, hasMemory: false }
            const isSelected = row.chapter.id === selectedId
            const chapterAria = `第 ${row.chapter.orderIndex + 1} 章，${row.chapter.title}，${status.words} 字，${status.hasMemory ? '已有记忆' : '未生成记忆'}，${qualityLabel(status.quality)}，${saveLabel(status.saveState)}`
            return (
              <div
                key={row.id}
                className={cn('absolute left-0 right-0 flex h-9 items-center gap-0.5 pr-1', draggingId === row.chapter.id && 'opacity-45')}
                style={{ top, paddingLeft: `${8 + row.depth * 14}px` }}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-selected={isSelected}
                draggable
                onDragStart={(event: DragEvent<HTMLDivElement>) => {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', row.chapter.id)
                  setDraggingId(row.chapter.id)
                }}
                onDragEnd={() => setDraggingId(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  const sourceId = event.dataTransfer.getData('text/plain')
                  if (sourceId) moveBefore(sourceId, row.chapter.id)
                  setDraggingId(null)
                }}
              >
                <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                <input
                  type="checkbox"
                  checked={checked.has(row.chapter.id)}
                  onChange={() => toggleChecked(row.chapter.id)}
                  onClick={(event) => event.stopPropagation()}
                  className="h-3.5 w-3.5 shrink-0 rounded border-input accent-primary"
                  aria-label={`批量选择 ${row.chapter.title}`}
                />
                <button
                  type="button"
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isSelected && 'bg-accent font-medium text-accent-foreground',
                  )}
                  onClick={() => onSelect(row.chapter.id)}
                  aria-label={chapterAria}
                >
                  <span className="w-5 shrink-0 text-[10px] tabular-nums text-muted-foreground">{row.chapter.orderIndex + 1}</span>
                  <span className="truncate">{row.chapter.title}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                    {statusIcon(status)}
                    <span>{status.words > 999 ? `${(status.words / 1000).toFixed(1)}k` : status.words}</span>
                  </span>
                </button>
                {isSelected && (
                  <span className="flex shrink-0">
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-5 text-[10px]" onClick={() => moveByOne(row.chapter.id, -1)} aria-label="章节向上移动">↑</Button>
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-5 text-[10px]" onClick={() => moveByOne(row.chapter.id, 1)} aria-label="章节向下移动">↓</Button>
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {chapters.length === 0 && (
        <div className="p-3 text-xs text-muted-foreground">还没有章节。新建后会显示在这里。</div>
      )}
      {query && rows.length === 0 && (
        <div className="p-3 text-xs text-muted-foreground">没有匹配章节；可搜索标题、摘要、大纲或正文。</div>
      )}
    </section>
  )
}
