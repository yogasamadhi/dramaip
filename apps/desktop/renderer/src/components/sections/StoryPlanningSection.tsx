import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { FilePlus2, Loader2, Pencil, Sparkles, Trash2 } from 'lucide-react'
import type { Chapter, StoryArc, StoryArcKind } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import type { PreviewTaskType } from '@/components/GeneratePreviewDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Props {
  projectId: string
  version: number
  chapters: Chapter[]
  onGenerate: (taskType: PreviewTaskType, userInstruction?: string) => void
  generating: PreviewTaskType | null
}

interface StoryArcForm {
  kind: StoryArcKind
  parentId: string
  title: string
  summary: string
  targetWordCount: string
  targetChapterCount: string
  chapterStart: string
  chapterEnd: string
  coreConflict: string
  keyHighlights: string
  foreshadowingPayoffs: string
}

const KIND_LABEL: Record<StoryArcKind, string> = {
  volume: '卷',
  unit: '单元',
  stage: '剧情阶段',
}

const KIND_ORDER: StoryArcKind[] = ['volume', 'unit', 'stage']

export function StoryPlanningSection({ projectId, version, chapters, onGenerate, generating }: Props) {
  const [arcs, setArcs] = useState<StoryArc[]>([])
  const [activeKind, setActiveKind] = useState<StoryArcKind>('volume')
  const [editing, setEditing] = useState<StoryArc | 'new' | null>(null)
  const [form, setForm] = useState<StoryArcForm>(() => emptyForm('volume'))

  const reload = useCallback(async () => {
    setArcs(await ipc.storyArc.list(projectId))
  }, [projectId])

  useEffect(() => {
    void reload()
  }, [reload, version])

  const filtered = useMemo(() => arcs.filter((arc) => arc.kind === activeKind), [arcs, activeKind])
  const parentById = useMemo(() => new Map(arcs.map((arc) => [arc.id, arc])), [arcs])

  function openNew(kind: StoryArcKind = activeKind) {
    setForm(emptyForm(kind, filtered.length))
    setEditing('new')
  }

  function openEdit(arc: StoryArc) {
    setForm({
      kind: arc.kind,
      parentId: arc.parentId ?? '',
      title: arc.title,
      summary: arc.summary ?? '',
      targetWordCount: stringifyNumber(arc.targetWordCount),
      targetChapterCount: stringifyNumber(arc.targetChapterCount),
      chapterStart: stringifyNumber(arc.chapterStart),
      chapterEnd: stringifyNumber(arc.chapterEnd),
      coreConflict: arc.coreConflict ?? '',
      keyHighlights: arc.keyHighlights.join('\n'),
      foreshadowingPayoffs: arc.foreshadowingPayoffs.join('\n'),
    })
    setEditing(arc)
  }

  async function save() {
    if (!form.title.trim()) {
      toast.error('请填写标题')
      return
    }
    const payload = formToPayload(form, editing === 'new' ? filtered.length : undefined)
    if (editing === 'new') {
      const created = await ipc.storyArc.create({ ...payload, projectId })
      setArcs((prev) => [...prev, created])
      setActiveKind(created.kind)
    } else if (editing) {
      const updated = await ipc.storyArc.update(editing.id, payload)
      if (updated) setArcs((prev) => prev.map((arc) => (arc.id === updated.id ? updated : arc)))
    }
    setEditing(null)
    toast.success('已保存长篇规划')
  }

  async function remove(arc: StoryArc) {
    if (!window.confirm(`删除「${arc.title}」及其子层级？`)) return
    await ipc.storyArc.remove(arc.id)
    await reload()
    toast.success('已删除')
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <div className="flex rounded-md border p-0.5">
          {KIND_ORDER.map((kind) => (
            <button
              key={kind}
              onClick={() => setActiveKind(kind)}
              className={cn(
                'rounded px-3 py-1 text-sm transition-colors',
                activeKind === kind ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {KIND_LABEL[kind]}
            </button>
          ))}
        </div>
        <Badge variant="secondary">{filtered.length}</Badge>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onGenerate('generate_story_arc_outline')}
            disabled={generating !== null}
          >
            {generating === 'generate_story_arc_outline' ? <Loader2 className="animate-spin" /> : <Sparkles />}
            AI 生成规划
          </Button>
          <Button size="sm" onClick={() => openNew()}>
            <FilePlus2 />
            新建{KIND_LABEL[activeKind]}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-3 p-4">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有{KIND_LABEL[activeKind]}。</p>
          ) : (
            filtered.map((arc) => (
              <div key={arc.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{KIND_LABEL[arc.kind]}</Badge>
                  <span className="font-medium">{arc.title}</span>
                  {arc.parentId && (
                    <span className="text-xs text-muted-foreground">
                      上级：{parentById.get(arc.parentId)?.title ?? '未找到'}
                    </span>
                  )}
                  <div className="ml-auto flex gap-1">
                    <Button size="icon" variant="ghost" title="编辑" onClick={() => openEdit(arc)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" title="删除" onClick={() => void remove(arc)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground lg:grid-cols-4">
                  <span>目标字数：{arc.targetWordCount ? `${arc.targetWordCount}` : '未设定'}</span>
                  <span>目标章节：{arc.targetChapterCount ? `${arc.targetChapterCount}` : '未设定'}</span>
                  <span>章节范围：{chapterRangeLabel(arc)}</span>
                  <span>完成度：{chapterProgressLabel(arc, chapters)}</span>
                </div>
                {arc.summary && <p className="mt-2 text-xs text-muted-foreground">{arc.summary}</p>}
                {arc.coreConflict && (
                  <p className="mt-2 text-xs">
                    <span className="font-medium">核心矛盾：</span>
                    <span className="text-muted-foreground">{arc.coreConflict}</span>
                  </p>
                )}
                <ChipLine label="关键爽点" items={arc.keyHighlights} />
                <ChipLine label="伏笔回收" items={arc.foreshadowingPayoffs} />
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null) }}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-auto">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? '新建长篇规划' : '编辑长篇规划'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>层级</Label>
              <Select value={form.kind} onValueChange={(kind: StoryArcKind) => setForm({ ...form, kind, parentId: '' })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_ORDER.map((kind) => (
                    <SelectItem key={kind} value={kind}>{KIND_LABEL[kind]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>上级</Label>
              <Select value={form.parentId || 'none'} onValueChange={(value) => setForm({ ...form, parentId: value === 'none' ? '' : value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">无上级</SelectItem>
                  {parentOptions(arcs, form.kind, editing).map((arc) => (
                    <SelectItem key={arc.id} value={arc.id}>
                      {KIND_LABEL[arc.kind]} · {arc.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>标题</Label>
              <Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
            </div>
            <NumberField label="目标字数" value={form.targetWordCount} onChange={(value) => setForm({ ...form, targetWordCount: value })} />
            <NumberField label="目标章节数" value={form.targetChapterCount} onChange={(value) => setForm({ ...form, targetChapterCount: value })} />
            <NumberField label="起始章节" value={form.chapterStart} onChange={(value) => setForm({ ...form, chapterStart: value })} />
            <NumberField label="结束章节" value={form.chapterEnd} onChange={(value) => setForm({ ...form, chapterEnd: value })} />
            <div className="space-y-1 md:col-span-2">
              <Label>摘要</Label>
              <Textarea value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} rows={3} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>核心矛盾</Label>
              <Textarea value={form.coreConflict} onChange={(event) => setForm({ ...form, coreConflict: event.target.value })} rows={3} />
            </div>
            <div className="space-y-1">
              <Label>关键爽点</Label>
              <Textarea
                value={form.keyHighlights}
                onChange={(event) => setForm({ ...form, keyHighlights: event.target.value })}
                rows={5}
                placeholder="每行一个爽点"
              />
            </div>
            <div className="space-y-1">
              <Label>伏笔回收计划</Label>
              <Textarea
                value={form.foreshadowingPayoffs}
                onChange={(event) => setForm({ ...form, foreshadowingPayoffs: event.target.value })}
                rows={5}
                placeholder="每行一个回收项"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
            <Button onClick={() => void save()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ChipLine({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}：</span>
      {items.map((item, index) => (
        <Badge key={`${item}:${index}`} variant="secondary">{item}</Badge>
      ))}
    </div>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input value={value} inputMode="numeric" onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

function emptyForm(kind: StoryArcKind, orderIndex = 0): StoryArcForm {
  return {
    kind,
    parentId: '',
    title: `${KIND_LABEL[kind]} ${orderIndex + 1}`,
    summary: '',
    targetWordCount: '',
    targetChapterCount: '',
    chapterStart: '',
    chapterEnd: '',
    coreConflict: '',
    keyHighlights: '',
    foreshadowingPayoffs: '',
  }
}

function formToPayload(form: StoryArcForm, orderIndex?: number) {
  return {
    kind: form.kind,
    parentId: form.parentId || undefined,
    title: form.title.trim(),
    summary: optionalText(form.summary),
    targetWordCount: optionalNumber(form.targetWordCount),
    targetChapterCount: optionalNumber(form.targetChapterCount),
    chapterStart: optionalNumber(form.chapterStart),
    chapterEnd: optionalNumber(form.chapterEnd),
    coreConflict: optionalText(form.coreConflict),
    keyHighlights: splitLines(form.keyHighlights),
    foreshadowingPayoffs: splitLines(form.foreshadowingPayoffs),
    ...(orderIndex === undefined ? {} : { orderIndex }),
  }
}

function parentOptions(arcs: StoryArc[], kind: StoryArcKind, editing: StoryArc | 'new' | null): StoryArc[] {
  const blockedId = editing && editing !== 'new' ? editing.id : undefined
  const allowedKinds: StoryArcKind[] = kind === 'volume' ? [] : kind === 'unit' ? ['volume'] : ['unit']
  return arcs.filter((arc) => arc.id !== blockedId && allowedKinds.includes(arc.kind))
}

function splitLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function optionalText(value: string): string | undefined {
  const text = value.trim()
  return text || undefined
}

function optionalNumber(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function stringifyNumber(value: number | undefined): string {
  return value === undefined ? '' : String(value)
}

function chapterRangeLabel(arc: StoryArc): string {
  if (arc.chapterStart && arc.chapterEnd) return `${arc.chapterStart}-${arc.chapterEnd}`
  if (arc.chapterStart) return `从 ${arc.chapterStart}`
  if (arc.chapterEnd) return `至 ${arc.chapterEnd}`
  return '未设定'
}

function chapterProgressLabel(arc: StoryArc, chapters: Chapter[]): string {
  const scoped = chapters.filter((chapter) => chapterInArc(chapter, arc))
  const written = scoped.filter((chapter) => chapter.content.trim()).length
  const target = arc.targetChapterCount ?? scoped.length
  if (!target) return '未设定'
  return `${written}/${target} 章`
}

function chapterInArc(chapter: Chapter, arc: StoryArc): boolean {
  const chapterNumber = chapter.orderIndex + 1
  if (arc.chapterStart && chapterNumber < arc.chapterStart) return false
  if (arc.chapterEnd && chapterNumber > arc.chapterEnd) return false
  return Boolean(arc.chapterStart || arc.chapterEnd)
}
