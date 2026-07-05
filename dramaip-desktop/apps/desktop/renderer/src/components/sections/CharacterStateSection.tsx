// CharacterStateSection —— 人物状态追踪（ROADMAP v0.2 §2）：列表 + 按人物更新状态（自动落库）
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Sparkles, Trash2 } from 'lucide-react'
import type { Character, CharacterState } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export function CharacterStateSection({
  projectId,
  version,
}: {
  projectId: string
  version: number
}) {
  const [list, setList] = useState<CharacterState[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [charId, setCharId] = useState<string>('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    const [states, chars] = await Promise.all([
      ipc.characterState.list(projectId),
      ipc.character.list(projectId),
    ])
    setList(states)
    setCharacters(chars)
    setCharId((prev) => prev || chars[0]?.id || '')
  }, [projectId])

  useEffect(() => {
    void reload()
  }, [reload, version])

  async function update() {
    if (!charId) {
      toast.error('请先选择一个人物')
      return
    }
    setBusy(true)
    const name = characters.find((c) => c.id === charId)?.name ?? ''
    const id = toast.loading(`正在更新「${name}」的状态…`)
    try {
      const res = await ipc.ai.run({ projectId, characterId: charId, taskType: 'update_character_state' })
      if (res.ok) {
        toast.success('人物状态已更新', { id })
        await reload()
      } else {
        toast.error('更新失败：' + (res.error ?? '未知错误'), { id })
      }
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!window.confirm('删除该状态记录？')) return
    await ipc.characterState.remove(id)
    setList((p) => p.filter((s) => s.id !== id))
  }

  const nameById = new Map(characters.map((c) => [c.id, c.name]))

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <h2 className="text-sm font-semibold">人物状态</h2>
        <Badge variant="secondary">{list.length}</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Select value={charId} onValueChange={setCharId}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="选择人物" />
            </SelectTrigger>
            <SelectContent>
              {characters.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={update} disabled={busy || !charId}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            更新状态
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-2 p-4">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              还没有人物状态。选择一个人物后点击「更新状态」，AI 会根据当前剧情追踪其处境、情绪、已知/隐藏秘密与视觉连续性。
            </p>
          ) : (
            list.map((s) => (
              <div key={s.id} className="rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{nameById.get(s.characterId) ?? s.characterId}</span>
                  <Button size="icon" variant="ghost" className="ml-auto" title="删除" onClick={() => remove(s.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  <div>状态：{s.currentStatus}</div>
                  {s.emotionalState && <div>情绪：{s.emotionalState}</div>}
                  {s.relationshipChanges && <div>关系变化：{s.relationshipChanges}</div>}
                  {s.knownSecrets && s.knownSecrets.length > 0 && <div>已知秘密：{s.knownSecrets.join('；')}</div>}
                  {s.hiddenSecrets && s.hiddenSecrets.length > 0 && <div>隐藏秘密：{s.hiddenSecrets.join('；')}</div>}
                  {s.visualContinuityNotes && <div>视觉连续性：{s.visualContinuityNotes}</div>}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
