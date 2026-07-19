import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronUp, Columns2, Edit3, Eye, Loader2, Minus, Plus } from 'lucide-react'
import type { TextDiffPreviewPayload } from '@sdns/core'
import { parseScriptMarkdown, scriptBlockLabel, TASK_TYPE_LABELS } from '@sdns/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import {
  buildSegmentedTextDiff,
  changedBlockIds,
  selectedText,
  withPreviewContent,
  type SegmentedDiffBlock,
} from '@/lib/segmentedTextDiff'
import { cn } from '@/lib/utils'

type ViewMode = 'inline' | 'side-by-side' | 'result'

interface Props {
  open: boolean
  preview: TextDiffPreviewPayload | null
  onAdopt: (candidate: TextDiffPreviewPayload) => Promise<void>
  onCancel: () => void
}

const TARGET_LABEL: Record<TextDiffPreviewPayload['targetKind'], string> = {
  chapter: '章节',
  script: '剧本',
  shot: '镜头 Prompt',
}

const LARGE_TEXT_BLOCKS = 240

export function TextDiffPreviewDialog({ open, preview, onAdopt, onCancel }: Props) {
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<ViewMode>('inline')
  const [diff, setDiff] = useState<SegmentedDiffBlock[]>([])
  const [calculating, setCalculating] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [editedNextContent, setEditedNextContent] = useState('')
  const changeRefs = useRef<Array<HTMLDivElement | null>>([])
  const [activeChange, setActiveChange] = useState(0)

  useEffect(() => {
    if (!preview) {
      setDiff([])
      setSelectedIds(new Set())
      setEditedNextContent('')
      return
    }
    const previous = preview.currentContent
    const next = preview.nextContent
    setView('inline')
    setActiveChange(0)
    setEditedNextContent(next)
    setCalculating(true)
    let cancelled = false
    const blockCount = countParagraphs(previous) + countParagraphs(next)
    const apply = (result: SegmentedDiffBlock[]) => {
      if (cancelled) return
      setDiff(result)
      setSelectedIds(new Set(changedBlockIds(result)))
      setCalculating(false)
    }
    if (blockCount >= LARGE_TEXT_BLOCKS && typeof Worker !== 'undefined') {
      const worker = new Worker(new URL('../workers/segmentedTextDiff.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<SegmentedDiffBlock[]>) => {
        worker.terminate()
        apply(event.data)
      }
      worker.onerror = () => {
        worker.terminate()
        apply(buildSegmentedTextDiff(previous, next))
      }
      worker.postMessage({ previous, next })
      return () => {
        cancelled = true
        worker.terminate()
      }
    }
    const timer = window.setTimeout(() => apply(buildSegmentedTextDiff(previous, next)), 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [preview])

  const changed = useMemo(() => diff.filter((block) => block.kind !== 'same'), [diff])
  const structuredLocations = useMemo(() => {
    if (preview?.targetKind !== 'script') return []
    return Array.from(new Set(changed
      .map((block) => parseScriptMarkdown(block.after || block.before).blocks[0])
      .filter(Boolean)
      .map((block) => scriptBlockLabel(block))))
      .slice(0, 8)
  }, [changed, preview?.targetKind])
  const candidate = useMemo(() => preview ? withPreviewContent(preview, editedNextContent) : null, [editedNextContent, preview])
  const selectedCount = selectedIds.size

  function applySelection(nextSelected: Set<string>) {
    setSelectedIds(nextSelected)
    setEditedNextContent(selectedText(diff, nextSelected))
  }

  function toggleBlock(block: SegmentedDiffBlock) {
    if (block.kind === 'same') return
    const next = new Set(selectedIds)
    if (next.has(block.id)) next.delete(block.id)
    else next.add(block.id)
    applySelection(next)
  }

  function selectAll() {
    applySelection(new Set(changed.map((block) => block.id)))
  }

  function rejectAll() {
    applySelection(new Set())
  }

  function jumpChange(direction: 1 | -1) {
    if (changed.length === 0) return
    const nextIndex = (activeChange + direction + changed.length) % changed.length
    setActiveChange(nextIndex)
    const blockIndex = diff.findIndex((block) => block.id === changed[nextIndex].id)
    changeRefs.current[blockIndex]?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center',
    })
  }

  async function handleAdopt() {
    if (!candidate) return
    setSaving(true)
    try {
      await onAdopt(candidate)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !saving) onCancel() }}>
      <DialogContent
        className="flex h-[min(88vh,54rem)] max-w-6xl flex-col overflow-hidden"
        onKeyDown={(event) => {
          if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            jumpChange(-1)
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            jumpChange(1)
          }
        }}
      >
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>AI 变更预览</DialogTitle>
            {preview && <Badge variant="secondary">{TARGET_LABEL[preview.targetKind]}</Badge>}
            {preview && <Badge variant="outline">{TASK_TYPE_LABELS[preview.taskType] ?? preview.taskType}</Badge>}
          </div>
          <DialogDescription>{preview?.title ?? '按段落审阅、选择或编辑候选内容；采用后仍可通过版本记录撤销。'}</DialogDescription>
          {structuredLocations.length > 0 && <p className="text-xs text-muted-foreground">结构化定位：{structuredLocations.join(' · ')}</p>}
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 border-y py-2 text-xs">
          <div className="mr-auto flex items-center gap-1 text-muted-foreground" aria-live="polite">
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300"><Plus className="h-3.5 w-3.5" />{changed.filter((block) => block.kind === 'add' || block.kind === 'replace').length}</span>
            <span className="inline-flex items-center gap-1 text-destructive"><Minus className="h-3.5 w-3.5" />{changed.filter((block) => block.kind === 'remove' || block.kind === 'replace').length}</span>
            <span>已选择 {selectedCount}/{changed.length} 处改动</span>
          </div>
          <ViewButton label="行内" active={view === 'inline'} onClick={() => setView('inline')}><Eye /></ViewButton>
          <ViewButton label="对照" active={view === 'side-by-side'} onClick={() => setView('side-by-side')}><Columns2 /></ViewButton>
          <ViewButton label="结果" active={view === 'result'} onClick={() => setView('result')}><Edit3 /></ViewButton>
          <Button type="button" size="sm" variant="ghost" onClick={selectAll} disabled={calculating || changed.length === 0}>全选改动</Button>
          <Button type="button" size="sm" variant="ghost" onClick={rejectAll} disabled={calculating || changed.length === 0}>全部拒绝</Button>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => jumpChange(-1)} disabled={changed.length === 0} title="上一处改动（Alt+↑）" aria-keyshortcuts="Alt+ArrowUp"><ChevronUp /></Button>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => jumpChange(1)} disabled={changed.length === 0} title="下一处改动（Alt+↓）" aria-keyshortcuts="Alt+ArrowDown"><ChevronDown /></Button>
        </div>

        <ScrollArea className="min-h-0 flex-1 rounded-md border" aria-busy={calculating}>
          {calculating ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="animate-spin" />正在整理段落级差异…</div>
          ) : view === 'result' ? (
            <div className="space-y-2 p-3">
              <p className="text-xs text-muted-foreground">可直接编辑最终候选。之后如再切换段落选择，会以新的选择结果重建候选。镜头 Prompt 请保留三个标题，以便安全写回对应字段。</p>
              <Textarea value={editedNextContent} onChange={(event) => setEditedNextContent(event.target.value)} className="min-h-[22rem] font-mono text-xs leading-relaxed" aria-label="最终采用内容" />
            </div>
          ) : diff.length === 0 ? (
            <div className="px-3 py-12 text-center text-sm text-muted-foreground">无文本变化</div>
          ) : view === 'side-by-side' ? (
            <SideBySideDiff diff={diff} selectedIds={selectedIds} onToggle={toggleBlock} refs={changeRefs} />
          ) : (
            <InlineDiff diff={diff} selectedIds={selectedIds} onToggle={toggleBlock} refs={changeRefs} />
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>取消</Button>
          <Button onClick={handleAdopt} disabled={saving || !candidate || calculating}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />}
            采用已选内容并保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InlineDiff({ diff, selectedIds, onToggle, refs }: DiffProps) {
  return <div className="space-y-2 p-2 text-sm leading-relaxed">{diff.map((block, index) => <DiffBlock key={block.id} block={block} selected={selectedIds.has(block.id)} onToggle={onToggle} changeRef={(node) => { refs.current[index] = node }} />)}</div>
}

function SideBySideDiff({ diff, selectedIds, onToggle, refs }: DiffProps) {
  return <div className="grid grid-cols-2 divide-x text-sm leading-relaxed">{diff.map((block, index) => (
    <div key={block.id} ref={(node) => { refs.current[index] = node }} className={cn('contents', block.kind !== 'same' && !selectedIds.has(block.id) && 'opacity-55')}>
      <button type="button" onClick={() => onToggle(block)} disabled={block.kind === 'same'} className={cn('min-h-16 whitespace-pre-wrap border-b p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none', block.kind === 'remove' || block.kind === 'replace' ? 'bg-destructive/10' : 'bg-muted/20')}>{block.before || <span className="text-muted-foreground">（新增段落）</span>}</button>
      <button type="button" onClick={() => onToggle(block)} disabled={block.kind === 'same'} className={cn('min-h-16 whitespace-pre-wrap border-b p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none', block.kind === 'add' || block.kind === 'replace' ? 'bg-emerald-500/10' : 'bg-muted/20')}>{block.after || <span className="text-muted-foreground">（删除段落）</span>}</button>
    </div>
  ))}</div>
}

type DiffProps = { diff: SegmentedDiffBlock[]; selectedIds: Set<string>; onToggle: (block: SegmentedDiffBlock) => void; refs: MutableRefObject<Array<HTMLDivElement | null>> }

function DiffBlock({ block, selected, onToggle, changeRef }: { block: SegmentedDiffBlock; selected: boolean; onToggle: (block: SegmentedDiffBlock) => void; changeRef: (node: HTMLDivElement | null) => void }) {
  const changed = block.kind !== 'same'
  return <div ref={changeRef} className={cn('rounded-md border p-3 transition-colors motion-reduce:transition-none', block.kind === 'same' && 'border-transparent bg-muted/20 text-muted-foreground', changed && selected && 'border-emerald-500/45 bg-emerald-500/10', changed && !selected && 'border-muted bg-muted/30 opacity-60')}>
    <div className="mb-2 flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{block.kind === 'same' ? '未变化' : block.kind === 'add' ? '新增段落' : block.kind === 'remove' ? '删除段落' : '替换段落'}</span>{changed && <Button type="button" size="sm" variant={selected ? 'secondary' : 'outline'} onClick={() => onToggle(block)} aria-pressed={selected}>{selected ? '采用此处' : '已拒绝'}</Button>}</div>
    {block.kind === 'replace' || block.kind === 'remove' ? <p className="whitespace-pre-wrap text-destructive line-through decoration-destructive/60">{block.before}</p> : null}
    {block.kind === 'replace' ? <div className="my-2 border-t" /> : null}
    {block.kind === 'same' || block.kind === 'add' || block.kind === 'replace' ? <p className="whitespace-pre-wrap">{block.after}</p> : null}
  </div>
}

function ViewButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return <Button type="button" size="sm" variant={active ? 'secondary' : 'ghost'} onClick={onClick} className="gap-1.5"><span className="h-3.5 w-3.5">{children}</span>{label}</Button>
}

function countParagraphs(value: string): number {
  return value.trim() ? value.split(/\n\s*\n+/).length : 0
}
