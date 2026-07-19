// VisualSettingSection —— 世界/场景视觉设定（ROADMAP v0.2 §4）：列表 + AI 生成（预览→采用）
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FilePlus2, Loader2, Pencil, Sparkles, Trash2 } from 'lucide-react'
import type { OptionalId, VisualSetting } from '@sdns/core'
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
import type { PreviewTaskType } from '@/components/GeneratePreviewDialog'

const TYPES: VisualSetting['type'][] = ['world', 'location', 'style', 'object']
const TYPE_LABEL: Record<VisualSetting['type'], string> = {
  world: '世界观',
  location: '场景地点',
  style: '整体风格',
  object: '关键道具',
}

interface Props {
  projectId: string
  version: number
  onGenerate: (taskType: PreviewTaskType, userInstruction?: string) => void
  generating: PreviewTaskType | null
}

const EMPTY: Partial<OptionalId<VisualSetting>> & { type: VisualSetting['type'] } = {
  title: '',
  type: 'location',
  visualPrompt: '',
}

export function VisualSettingSection({ projectId, version, onGenerate, generating }: Props) {
  const [list, setList] = useState<VisualSetting[]>([])
  const [editing, setEditing] = useState<VisualSetting | 'new' | null>(null)
  const [form, setForm] = useState<typeof EMPTY>(EMPTY)

  const reload = useCallback(async () => {
    setList(await ipc.visualSetting.list(projectId))
  }, [projectId])

  useEffect(() => {
    void reload()
  }, [reload, version])

  function openNew() {
    setForm({ ...EMPTY })
    setEditing('new')
  }
  function openEdit(v: VisualSetting) {
    setForm({ ...v })
    setEditing(v)
  }

  async function save() {
    if (!form.title || !form.visualPrompt) {
      toast.error('请填写名称和视觉 Prompt')
      return
    }
    if (editing === 'new') {
      const v = await ipc.visualSetting.create({ ...form, projectId })
      setList((p) => [...p, v])
    } else if (editing) {
      const v = await ipc.visualSetting.update(editing.id, form)
      if (v) setList((p) => p.map((x) => (x.id === v.id ? v : x)))
    }
    setEditing(null)
    toast.success('已保存')
  }

  async function remove(id: string) {
    if (!(await confirmAction(deleteConfirmation('该视觉设定')))) return
    await ipc.visualSetting.remove(id)
    setList((p) => p.filter((x) => x.id !== id))
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <h2 className="text-sm font-semibold">视觉设定</h2>
        <Badge variant="secondary">{list.length}</Badge>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={openNew}>
            <FilePlus2 />
            新建
          </Button>
          <Button size="sm" onClick={() => onGenerate('generate_visual_setting')} disabled={generating !== null}>
            {generating === 'generate_visual_setting' ? <Loader2 className="animate-spin" /> : <Sparkles />}
            AI 生成
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-2 p-4">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              还没有视觉设定。用 AI 生成世界、场景、风格或道具的视觉 Prompt，确保后续 AI 视频画面一致。
            </p>
          ) : (
            list.map((v) => (
              <div key={v.id} className="rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{v.title}</span>
                  <Badge variant="secondary">{TYPE_LABEL[v.type]}</Badge>
                  <div className="ml-auto flex gap-1">
                    <Button size="icon" variant="ghost" title="编辑" onClick={() => openEdit(v)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" title="删除" onClick={() => remove(v.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  <div className="whitespace-pre-wrap">视觉 Prompt：{v.visualPrompt}</div>
                  {v.negativePrompt && <div>负面 Prompt：{v.negativePrompt}</div>}
                  {v.notes && <div>备注：{v.notes}</div>}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null) }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-auto">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? '新建视觉设定' : '编辑视觉设定'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>名称 *</Label>
                <Input value={(form.title as string) ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>类型</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as VisualSetting['type'] })}>
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
              <Label>视觉 Prompt *</Label>
              <Textarea value={(form.visualPrompt as string) ?? ''} onChange={(e) => setForm({ ...form, visualPrompt: e.target.value })} rows={4} />
            </div>
            <div className="space-y-1">
              <Label>负面 Prompt</Label>
              <Textarea value={(form.negativePrompt as string) ?? ''} onChange={(e) => setForm({ ...form, negativePrompt: e.target.value })} rows={2} />
            </div>
            <div className="space-y-1">
              <Label>备注</Label>
              <Textarea value={(form.notes as string) ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
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
