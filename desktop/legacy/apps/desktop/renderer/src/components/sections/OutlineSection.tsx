// OutlineSection —— 全书大纲 / 章节大纲 CRUD + AI 生成（§5.3 / §11.3-11.4）
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FilePlus2, Loader2, Pencil, Sparkles, Trash2 } from 'lucide-react'
import type { Outline } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { confirmAction, deleteConfirmation } from '@/components/ConfirmActionDialog'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { PreviewTaskType } from '@/components/GeneratePreviewDialog'

interface Props {
  projectId: string
  version: number
  onGenerate: (taskType: PreviewTaskType, userInstruction?: string) => void
  generating: PreviewTaskType | null
}

export function OutlineSection({ projectId, version, onGenerate, generating }: Props) {
  const [otype, setOtype] = useState<'book' | 'chapter'>('book')

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <div className="flex rounded-md border p-0.5">
          {(['book', 'chapter'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setOtype(t)}
              className={cn(
                'rounded px-3 py-1 text-sm transition-colors',
                otype === t ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t === 'book' ? '全书大纲' : '章节大纲'}
            </button>
          ))}
        </div>
      </div>
      <OutlineList
        key={otype}
        projectId={projectId}
        type={otype}
        version={version}
        onGenerate={onGenerate}
        generating={generating}
        generateTask={otype === 'book' ? 'generate_book_outline' : 'generate_chapter_outline'}
        generateLabel={otype === 'book' ? 'AI 生成全书大纲' : 'AI 生成章节大纲'}
      />
    </div>
  )
}

function OutlineList({
  projectId,
  type,
  version,
  onGenerate,
  generating,
  generateTask,
  generateLabel,
}: {
  projectId: string
  type: 'book' | 'chapter'
  version: number
  onGenerate: (taskType: PreviewTaskType, userInstruction?: string) => void
  generating: PreviewTaskType | null
  generateTask: PreviewTaskType
  generateLabel: string
}) {
  const [list, setList] = useState<Outline[]>([])
  const [editing, setEditing] = useState<Outline | 'new' | null>(null)
  const [form, setForm] = useState<{ title: string; content: string }>({ title: '', content: '' })

  const reload = useCallback(async () => {
    setList(await ipc.outline.list(projectId, type))
  }, [projectId, type])

  useEffect(() => {
    void reload()
  }, [reload, version])

  function openNew() {
    setForm({ title: type === 'book' ? '全书大纲' : `第 ${list.length + 1} 章`, content: '' })
    setEditing('new')
  }
  function openEdit(o: Outline) {
    setForm({ title: o.title, content: o.content })
    setEditing(o)
  }

  async function save() {
    if (!form.title.trim()) {
      toast.error('请填写标题')
      return
    }
    if (editing === 'new') {
      const o = await ipc.outline.create({
        projectId,
        type,
        title: form.title.trim(),
        content: form.content,
        orderIndex: list.length,
      })
      setList((p) => [...p, o])
    } else if (editing) {
      const o = await ipc.outline.update(editing.id, { title: form.title.trim(), content: form.content })
      if (o) setList((p) => p.map((x) => (x.id === o.id ? o : x)))
    }
    setEditing(null)
    toast.success('已保存')
  }

  async function remove(id: string) {
    if (!(await confirmAction(deleteConfirmation('该大纲')))) return
    await ipc.outline.remove(id)
    setList((p) => p.filter((x) => x.id !== id))
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2">
        <Badge variant="secondary">{list.length}</Badge>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={openNew}>
            <FilePlus2 />
            新建
          </Button>
          <Button size="sm" onClick={() => onGenerate(generateTask)} disabled={generating !== null}>
            {generating === generateTask ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {generateLabel}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-2 p-4">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {type === 'book' ? '还没有全书大纲。' : '还没有章节大纲。'}可手动新建或用 AI 生成。
            </p>
          ) : (
            list.map((o) => (
              <div key={o.id} className="rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{o.title}</span>
                  <div className="ml-auto flex gap-1">
                    <Button size="icon" variant="ghost" title="编辑" onClick={() => openEdit(o)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" title="删除" onClick={() => remove(o.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                {o.content && (
                  <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-xs text-muted-foreground">
                    {o.content}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null) }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-auto">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? '新建大纲' : '编辑大纲'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>标题</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>正文</Label>
              <Textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                rows={14}
                className="font-mono text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button onClick={save}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
