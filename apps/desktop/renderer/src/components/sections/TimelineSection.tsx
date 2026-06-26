// TimelineSection —— 事件时间线（ROADMAP v0.2 §5）：列表 + 对当前章节提取事件（自动落库）
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FilePlus2, Loader2, Pencil, Sparkles, Trash2 } from 'lucide-react'
import type { Chapter, OptionalId, StoryEvent } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const TYPES: StoryEvent['eventType'][] = ['conflict', 'reveal', 'reversal', 'relationship', 'foreshadowing', 'payoff', 'visual', 'other']
const TYPE_LABEL: Record<StoryEvent['eventType'], string> = {
  conflict: '冲突', reveal: '揭露', reversal: '反转', relationship: '关系',
  foreshadowing: '埋伏笔', payoff: '回收伏笔', visual: '视觉', other: '其他',
}

interface Props {
  projectId: string
  chapter: Chapter | null
  version: number
}

const EMPTY: Partial<OptionalId<StoryEvent>> = {
  title: '',
  description: '',
  eventType: 'conflict',
  relatedCharacterIds: [],
}

export function TimelineSection({ projectId, chapter, version }: Props) {
  const [list, setList] = useState<StoryEvent[]>([])
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<StoryEvent | 'new' | null>(null)
  const [form, setForm] = useState<typeof EMPTY>(EMPTY)

  const reload = useCallback(async () => {
    setList(await ipc.storyEvent.list(projectId))
  }, [projectId])

  useEffect(() => {
    void reload()
  }, [reload, version])

  async function extract() {
    if (!chapter) {
      toast.error('请先在「章节」中选择一个章节')
      return
    }
    setBusy(true)
    const id = toast.loading('正在提取故事事件…')
    try {
      const res = await ipc.ai.run({ projectId, chapterId: chapter.id, taskType: 'extract_story_events' })
      if (res.ok) {
        toast.success('故事事件已提取', { id })
        await reload()
      } else {
        toast.error('提取失败：' + (res.error ?? '未知错误'), { id })
      }
    } finally {
      setBusy(false)
    }
  }

  function openNew() {
    setForm({ ...EMPTY })
    setEditing('new')
  }
  function openEdit(e: StoryEvent) {
    setForm({ ...e })
    setEditing(e)
  }

  async function save() {
    if (!form.title || !form.description) {
      toast.error('请填写标题和描述')
      return
    }
    if (editing === 'new') {
      const e = await ipc.storyEvent.create({ ...form, eventType: form.eventType, projectId })
      setList((p) => [...p, e])
    } else if (editing) {
      const e = await ipc.storyEvent.update(editing.id, form)
      if (e) setList((p) => p.map((x) => (x.id === e.id ? e : x)))
    }
    setEditing(null)
    toast.success('已保存')
  }

  async function remove(id: string) {
    if (!window.confirm('删除该事件？')) return
    await ipc.storyEvent.remove(id)
    setList((p) => p.filter((x) => x.id !== id))
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <h2 className="text-sm font-semibold">事件时间线</h2>
        <Badge variant="secondary">{list.length}</Badge>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={openNew}>
            <FilePlus2 />
            新建
          </Button>
          <Button size="sm" onClick={extract} disabled={busy || !chapter}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {chapter ? '提取本章事件' : '先选择章节'}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-2 p-4">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              还没有事件。选择章节后点击「提取本章事件」，AI 会自动构建故事时间线。
            </p>
          ) : (
            list.map((e) => (
              <div key={e.id} className="rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{TYPE_LABEL[e.eventType]}</Badge>
                  <span className="font-medium">{e.title}</span>
                  <div className="ml-auto flex gap-1">
                    <Button size="icon" variant="ghost" title="编辑" onClick={() => openEdit(e)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" title="删除" onClick={() => remove(e.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{e.description}</p>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null) }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-auto">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? '新建事件' : '编辑事件'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>标题 *</Label>
                <Input value={(form.title as string) ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>类型</Label>
                <Select value={form.eventType} onValueChange={(v) => setForm({ ...form, eventType: v as StoryEvent['eventType'] })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>描述 *</Label>
              <Textarea value={(form.description as string) ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={4} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
            <Button onClick={save}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
