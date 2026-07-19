// ForeshadowingSection —— 伏笔管理（ROADMAP v0.2 §6）：列表 + 对当前章节提取伏笔（自动落库）
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FilePlus2, Loader2, Pencil, Sparkles, Trash2 } from 'lucide-react'
import type { Chapter, Foreshadowing, OptionalId } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { confirmAction, deleteConfirmation } from '@/components/ConfirmActionDialog'
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

const STATUSES: Foreshadowing['status'][] = ['planned', 'setup', 'paid_off', 'abandoned']
const STATUS_LABEL: Record<Foreshadowing['status'], string> = {
  planned: '计划中', setup: '已埋下', paid_off: '已回收', abandoned: '已放弃',
}
const STATUS_VARIANT: Record<Foreshadowing['status'], 'secondary' | 'default' | 'destructive'> = {
  planned: 'secondary', setup: 'default', paid_off: 'default', abandoned: 'destructive',
}

interface Props {
  projectId: string
  chapter: Chapter | null
  version: number
}

const EMPTY: Partial<OptionalId<Foreshadowing>> = {
  title: '',
  description: '',
  status: 'planned',
  payoffPlan: '',
}

export function ForeshadowingSection({ projectId, chapter, version }: Props) {
  const [list, setList] = useState<Foreshadowing[]>([])
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Foreshadowing | 'new' | null>(null)
  const [form, setForm] = useState<typeof EMPTY>(EMPTY)

  const reload = useCallback(async () => {
    setList(await ipc.foreshadowing.list(projectId))
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
    const id = toast.loading('正在提取伏笔…')
    try {
      const res = await ipc.ai.run({ projectId, chapterId: chapter.id, taskType: 'extract_foreshadowing' })
      if (res.ok) {
        toast.success('伏笔已提取', { id })
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
  function openEdit(f: Foreshadowing) {
    setForm({ ...f })
    setEditing(f)
  }

  async function save() {
    if (!form.title || !form.description) {
      toast.error('请填写标题和描述')
      return
    }
    if (editing === 'new') {
      const f = await ipc.foreshadowing.create({ ...form, projectId })
      setList((p) => [...p, f])
    } else if (editing) {
      const f = await ipc.foreshadowing.update(editing.id, form)
      if (f) setList((p) => p.map((x) => (x.id === f.id ? f : x)))
    }
    setEditing(null)
    toast.success('已保存')
  }

  async function remove(id: string) {
    if (!(await confirmAction(deleteConfirmation('该伏笔')))) return
    await ipc.foreshadowing.remove(id)
    setList((p) => p.filter((x) => x.id !== id))
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <h2 className="text-sm font-semibold">伏笔</h2>
        <Badge variant="secondary">{list.length}</Badge>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={openNew}>
            <FilePlus2 />
            新建
          </Button>
          <Button size="sm" onClick={extract} disabled={busy || !chapter}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {chapter ? '提取本章伏笔' : '先选择章节'}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-2 p-4">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              还没有伏笔。选择章节后点击「提取本章伏笔」，AI 会识别已埋下或已回收的伏笔。
            </p>
          ) : (
            list.map((f) => (
              <div key={f.id} className="rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_VARIANT[f.status]}>{STATUS_LABEL[f.status]}</Badge>
                  <span className="font-medium">{f.title}</span>
                  <div className="ml-auto flex gap-1">
                    <Button size="icon" variant="ghost" title="编辑" onClick={() => openEdit(f)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" title="删除" onClick={() => remove(f.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{f.description}</p>
                {f.payoffPlan && <p className="mt-1 text-xs text-muted-foreground">回收计划：{f.payoffPlan}</p>}
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null) }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-auto">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? '新建伏笔' : '编辑伏笔'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>标题 *</Label>
                <Input value={(form.title as string) ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>状态</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as Foreshadowing['status'] })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>描述 *</Label>
              <Textarea value={(form.description as string) ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
            </div>
            <div className="space-y-1">
              <Label>回收计划</Label>
              <Textarea value={(form.payoffPlan as string) ?? ''} onChange={(e) => setForm({ ...form, payoffPlan: e.target.value })} rows={2} />
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
