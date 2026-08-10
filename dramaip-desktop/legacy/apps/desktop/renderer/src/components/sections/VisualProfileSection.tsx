// VisualProfileSection —— 人物视觉档案（ROADMAP v0.2 §3）：列表 + 按人物生成（预览→采用）
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, FilePlus2, ImagePlus, Loader2, Pencil, Sparkles, Trash2 } from 'lucide-react'
import type { Character, CharacterVisualProfile, ProjectAsset } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { confirmAction, deleteConfirmation } from '@/components/ConfirmActionDialog'
import { ASSET_KIND_LABEL, ASSET_STATUS_LABEL, ASSET_STATUS_VARIANT, assetFieldsFromReference } from '@/lib/assets'
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

interface Props {
  projectId: string
  version: number
  onGenerate: (taskType: PreviewTaskType, userInstruction?: string, characterId?: string) => void
  generating: PreviewTaskType | null
}

const EMPTY: Partial<CharacterVisualProfile> = { appearancePrompt: '' }

export function VisualProfileSection({ projectId, version, onGenerate, generating }: Props) {
  const [list, setList] = useState<CharacterVisualProfile[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [charId, setCharId] = useState<string>('')
  const [editing, setEditing] = useState<CharacterVisualProfile | 'new' | null>(null)
  const [form, setForm] = useState<Partial<CharacterVisualProfile>>(EMPTY)
  const [assetsByProfile, setAssetsByProfile] = useState<Record<string, ProjectAsset[]>>({})

  const reload = useCallback(async () => {
    const [profiles, chars] = await Promise.all([
      ipc.visualProfile.list(projectId),
      ipc.character.list(projectId),
    ])
    const assets = await Promise.all(profiles.map((profile) => ipc.asset.listBySource('visual_profile', profile.id)))
    setList(profiles)
    setCharacters(chars)
    setAssetsByProfile(Object.fromEntries(profiles.map((profile, index) => [profile.id, assets[index] ?? []])))
    setCharId((prev) => prev || chars[0]?.id || '')
  }, [projectId])

  useEffect(() => {
    void reload()
  }, [reload, version])

  const nameById = new Map(characters.map((c) => [c.id, c.name]))

  function openNew() {
    setForm({ ...EMPTY, characterId: charId })
    setEditing('new')
  }
  function openEdit(p: CharacterVisualProfile) {
    setForm({ ...p })
    setEditing(p)
  }

  async function save() {
    if (!form.characterId || !form.appearancePrompt) {
      toast.error('请选择人物并填写外观 Prompt')
      return
    }
    let saved: CharacterVisualProfile | undefined
    if (editing === 'new') {
      const p = await ipc.visualProfile.create({ ...form, projectId })
      saved = p
      setList((prev) => [...prev, p])
    } else if (editing) {
      const p = await ipc.visualProfile.update(editing.id, form)
      if (p) {
        saved = p
        setList((prev) => prev.map((x) => (x.id === p.id ? p : x)))
      }
    }
    if (saved) await syncVisualProfileAssets(saved)
    setEditing(null)
    toast.success('已保存')
    await reload()
  }

  async function syncVisualProfileAssets(profile: CharacterVisualProfile) {
    await syncVisualProfileAsset(profile, 'character_reference', profile.referenceImageUrl, {
      title: `${nameById.get(profile.characterId) ?? '人物'}参考图`,
      tags: ['角色参考图'],
      metadata: { characterId: profile.characterId, role: 'appearance_reference' },
    })
    await syncVisualProfileAsset(profile, 'casting_reference', profile.actorReferenceUrl, {
      title: `${nameById.get(profile.characterId) ?? '人物'}选角参考`,
      tags: ['选角参考'],
      metadata: { characterId: profile.characterId, role: 'casting_reference', castingPrompt: profile.castingPrompt },
    })
    await syncVisualProfileAsset(profile, 'voice_reference', profile.voiceSampleUrl, {
      title: `${nameById.get(profile.characterId) ?? '人物'}音色样本`,
      tags: ['音色参考'],
      metadata: { characterId: profile.characterId, role: 'voice_reference', voiceTone: profile.voiceTone },
    })
  }

  async function syncVisualProfileAsset(
    profile: CharacterVisualProfile,
    kind: ProjectAsset['kind'],
    reference: string | undefined,
    payloadInfo: Pick<ProjectAsset, 'title' | 'tags' | 'metadata'>,
  ) {
    const existing = await ipc.asset.listBySource('visual_profile', profile.id)
    const linked = existing.find((asset) => asset.kind === kind)
    const trimmed = reference?.trim()
    if (!trimmed) {
      if (linked) await ipc.asset.remove(linked.id)
      return
    }
    const fields = assetFieldsFromReference(trimmed)
    const payload: Partial<ProjectAsset> & { projectId: string; kind: ProjectAsset['kind']; title: string } = {
      projectId,
      kind,
      title: payloadInfo.title,
      sourceEntityKind: 'visual_profile',
      sourceEntityId: profile.id,
      packagePolicy: 'reference_only',
      tags: payloadInfo.tags,
      metadata: payloadInfo.metadata,
      ...fields,
    }
    if (linked) await ipc.asset.update(linked.id, payload)
    else await ipc.asset.create(payload)
  }

  async function remove(id: string) {
    if (!(await confirmAction(deleteConfirmation('该视觉档案')))) return
    await ipc.visualProfile.remove(id)
    setList((p) => p.filter((x) => x.id !== id))
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <h2 className="text-sm font-semibold">人物视觉档案</h2>
        <Badge variant="secondary">{list.length}</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={openNew}>
            <FilePlus2 />
            新建
          </Button>
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
          <Button
            size="sm"
            onClick={() => onGenerate('generate_character_visual_profile', undefined, charId)}
            disabled={generating !== null || !charId}
          >
            {generating === 'generate_character_visual_profile' ? <Loader2 className="animate-spin" /> : <Sparkles />}
            AI 生成
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-2 p-4">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              还没有人物视觉档案。选择人物后用 AI 生成，为后续 AI 视频生成建立稳定的角色外观。
            </p>
          ) : (
            list.map((p) => (
              <div key={p.id} className="rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{nameById.get(p.characterId) ?? p.characterId}</span>
                  <div className="ml-auto flex gap-1">
                    <Button size="icon" variant="ghost" title="编辑" onClick={() => openEdit(p)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" title="删除" onClick={() => remove(p.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  <div className="whitespace-pre-wrap">外观 Prompt：{p.appearancePrompt}</div>
                  {p.castingPrompt && <div>选角：{p.castingPrompt}</div>}
                  {p.faceDescription && <div>脸部：{p.faceDescription}</div>}
                  {p.hairstyle && <div>发型：{p.hairstyle}</div>}
                  {p.clothingStyle && <div>服装：{p.clothingStyle}</div>}
                  {p.temperament && <div>气质：{p.temperament}</div>}
                  {p.voiceTone && <div>音色：{p.voiceTone}</div>}
                  {p.negativePrompt && <div>负面 Prompt：{p.negativePrompt}</div>}
                  {p.referenceImageUrl && <div>参考图：{p.referenceImageUrl}</div>}
                  {p.actorReferenceUrl && <div>选角参考：{p.actorReferenceUrl}</div>}
                  {p.voiceSampleUrl && <div>音色样本：{p.voiceSampleUrl}</div>}
                  <AssetBadges assets={assetsByProfile[p.id] ?? []} />
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null) }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-auto">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? '新建视觉档案' : '编辑视觉档案'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label>外观 Prompt *</Label>
              <Textarea value={(form.appearancePrompt as string) ?? ''} onChange={(e) => setForm({ ...form, appearancePrompt: e.target.value })} rows={3} />
            </div>
            {[
              ['castingPrompt', '选角描述'],
              ['faceDescription', '脸部描述'],
              ['hairstyle', '发型'],
              ['clothingStyle', '服装风格'],
              ['bodyType', '体型'],
              ['ageLook', '年龄感'],
              ['temperament', '气质'],
              ['voiceTone', '音色描述'],
              ['colorPalette', '配色方案'],
              ['negativePrompt', '负面 Prompt'],
            ].map(([key, label]) => (
              <div key={key} className="space-y-1">
                <Label>{label}</Label>
                <Input value={(form[key as keyof CharacterVisualProfile] as string) ?? ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
              </div>
            ))}
            <div className="col-span-2 space-y-1">
              <Label>参考图 URL / 本地路径</Label>
              <Input
                value={(form.referenceImageUrl as string) ?? ''}
                onChange={(e) => setForm({ ...form, referenceImageUrl: e.target.value })}
                placeholder="https://... 或 /Users/.../reference.png"
              />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>选角参考 URL / 本地路径</Label>
              <Input
                value={(form.actorReferenceUrl as string) ?? ''}
                onChange={(e) => setForm({ ...form, actorReferenceUrl: e.target.value })}
                placeholder="https://... 或 /Users/.../actor-reference.png"
              />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>音色样本 URL / 本地路径</Label>
              <Input
                value={(form.voiceSampleUrl as string) ?? ''}
                onChange={(e) => setForm({ ...form, voiceSampleUrl: e.target.value })}
                placeholder="https://... 或 /Users/.../voice-sample.mp3"
              />
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

function AssetBadges({ assets }: { assets: ProjectAsset[] }) {
  if (assets.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {assets.map((asset) => (
        <Badge key={asset.id} variant={ASSET_STATUS_VARIANT[asset.status]}>
          {asset.status === 'missing' ? <AlertTriangle className="h-3 w-3" /> : <ImagePlus className="h-3 w-3" />}
          {ASSET_KIND_LABEL[asset.kind]} · {asset.title} · {ASSET_STATUS_LABEL[asset.status]}
        </Badge>
      ))}
    </div>
  )
}
