// CharactersSection —— 人物卡 CRUD + AI 生成（§5.3 / §11.2）
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FilePlus2, Loader2, Pencil, Sparkles, Trash2 } from 'lucide-react'
import type { Character } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { confirmAction, deleteConfirmation } from '@/components/ConfirmActionDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { PreviewTaskType } from '@/components/GeneratePreviewDialog'

const EMPTY: Partial<Character> = { name: '', role: '' }

interface Props {
  projectId: string
  /** adopt 成功后父组件会自增 version，触发重新加载 */
  version: number
  onGenerate: (taskType: PreviewTaskType, userInstruction?: string) => void
  generating: PreviewTaskType | null
}

export function CharactersSection({ projectId, version, onGenerate, generating }: Props) {
  const [list, setList] = useState<Character[]>([])
  const [editing, setEditing] = useState<Character | 'new' | null>(null)
  const [form, setForm] = useState<Partial<Character>>(EMPTY)

  const reload = useCallback(async () => {
    setList(await ipc.character.list(projectId))
  }, [projectId])

  useEffect(() => {
    void reload()
  }, [reload, version])

  function openNew() {
    setForm({ ...EMPTY })
    setEditing('new')
  }
  function openEdit(c: Character) {
    setForm({ ...c })
    setEditing(c)
  }

  async function save() {
    if (!form.name || !form.role) {
      toast.error('请填写姓名和角色')
      return
    }
    if (editing === 'new') {
      const c = await ipc.character.create({ ...form, projectId })
      setList((p) => [...p, c])
    } else if (editing) {
      const c = await ipc.character.update(editing.id, form)
      if (c) setList((p) => p.map((x) => (x.id === c.id ? c : x)))
    }
    setEditing(null)
    toast.success('已保存')
  }

  async function remove(id: string) {
    if (!(await confirmAction(deleteConfirmation('该人物')))) return
    await ipc.character.remove(id)
    setList((p) => p.filter((x) => x.id !== id))
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <h2 className="text-sm font-semibold">人物卡</h2>
        <Badge variant="secondary">{list.length}</Badge>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={openNew}>
            <FilePlus2 />
            新建
          </Button>
          <Button size="sm" onClick={() => onGenerate('generate_characters')} disabled={generating !== null}>
            {generating === 'generate_characters' ? <Loader2 className="animate-spin" /> : <Sparkles />}
            AI 生成人物
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-2 p-4">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有人物。可手动新建，或用 AI 根据项目设定生成。</p>
          ) : (
            list.map((c) => (
              <div key={c.id} className="rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  <Badge variant="secondary">{c.role}</Badge>
                  <div className="ml-auto flex gap-1">
                    <Button size="icon" variant="ghost" title="编辑" onClick={() => openEdit(c)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" title="删除" onClick={() => remove(c.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                  {c.identity && <span>身份：{c.identity}</span>}
                  {c.personality && <span>性格：{c.personality}</span>}
                  {c.desire && <span>欲望：{c.desire}</span>}
                  {c.weakness && <span>弱点：{c.weakness}</span>}
                  {c.arc && <span>弧光：{c.arc}</span>}
                  {c.shortDramaFunction && <span>短剧功能：{c.shortDramaFunction}</span>}
                  {c.visualDescription && (
                    <span className="col-span-2">视觉：{c.visualDescription}</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null) }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-auto">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? '新建人物' : '编辑人物'}</DialogTitle>
          </DialogHeader>
          <CharacterForm form={form} setForm={setForm} />
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

const FIELDS: { key: keyof Character; label: string }[] = [
  { key: 'name', label: '姓名 *' },
  { key: 'role', label: '角色 *' },
  { key: 'identity', label: '身份' },
  { key: 'personality', label: '性格' },
  { key: 'desire', label: '欲望' },
  { key: 'secret', label: '秘密' },
  { key: 'weakness', label: '弱点' },
  { key: 'arc', label: '弧光' },
  { key: 'relationshipToProtagonist', label: '与主角关系' },
  { key: 'conflictTarget', label: '冲突对象' },
  { key: 'emotionalFunction', label: '情绪功能' },
  { key: 'shortDramaFunction', label: '短剧功能' },
  { key: 'visualDescription', label: '视觉描述' },
  { key: 'appearancePrompt', label: '外观 Prompt' },
  { key: 'negativePrompt', label: '负面 Prompt' },
]

function CharacterForm({
  form,
  setForm,
}: {
  form: Partial<Character>
  setForm: (f: Partial<Character>) => void
}) {
  const set = (k: keyof Character, v: string) => setForm({ ...form, [k]: v })
  return (
    <div className="grid grid-cols-2 gap-3">
      {FIELDS.map((f) => (
        <div key={f.key} className="space-y-1">
          <Label>{f.label}</Label>
          <Input value={(form[f.key] as string) ?? ''} onChange={(e) => set(f.key, e.target.value)} />
        </div>
      ))}
      <div className="col-span-2 space-y-1">
        <Label>备注</Label>
        <Textarea
          value={(form.notes as string) ?? ''}
          onChange={(e) => set('notes', e.target.value)}
          rows={2}
        />
      </div>
    </div>
  )
}
