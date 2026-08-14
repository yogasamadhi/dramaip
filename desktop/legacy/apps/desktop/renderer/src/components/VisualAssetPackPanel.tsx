import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, FolderPlus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { CharacterVisualProfile, ProjectAsset, VisualAssetOwnerKind, VisualAssetSlot, VisualAssetVersion, VisualSetting } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

type Owner = { id: string; kind: VisualAssetOwnerKind; title: string; detail: string }

const CHARACTER_SLOTS: Array<{ value: VisualAssetSlot; label: string; required?: boolean }> = [
  { value: 'face_anchor', label: '脸部锚点', required: true },
  { value: 'turnaround', label: '全身 / 三视图', required: true },
  { value: 'expression', label: '表情组', required: true },
  { value: 'pose', label: '姿态库' },
  { value: 'costume', label: '服装阶段', required: true },
  { value: 'prop', label: '角色道具' },
  { value: 'voice_reference', label: '声音参考', required: true },
]
const SCENE_SLOTS: Array<{ value: VisualAssetSlot; label: string; required?: boolean }> = [
  { value: 'scene_layout', label: '场景布局', required: true },
  { value: 'scene_variant', label: '昼夜 / 天气变体', required: true },
  { value: 'style_frame', label: '布光 / 色彩风格帧', required: true },
  { value: 'prop', label: '不可移动道具 / 点位', required: true },
]
const STATUS_LABEL: Record<VisualAssetVersion['status'], string> = {
  candidate: '候选', adopted: '已采用', superseded: '已替代', rejected: '已弃用',
}
const STATUS_VARIANT: Record<VisualAssetVersion['status'], 'secondary' | 'default' | 'outline' | 'destructive'> = {
  candidate: 'secondary', adopted: 'default', superseded: 'outline', rejected: 'destructive',
}

export function VisualAssetPackPanel({ projectId, assets, onChanged }: {
  projectId: string
  assets: ProjectAsset[]
  onChanged: () => void
}) {
  const [profiles, setProfiles] = useState<CharacterVisualProfile[]>([])
  const [settings, setSettings] = useState<VisualSetting[]>([])
  const [versions, setVersions] = useState<VisualAssetVersion[]>([])
  const [ownerKey, setOwnerKey] = useState('')
  const [assetId, setAssetId] = useState('')
  const [slot, setSlot] = useState<VisualAssetSlot>('face_anchor')
  const [label, setLabel] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const owners = useMemo<Owner[]>(() => [
    ...profiles.map((profile) => ({ id: profile.id, kind: 'visual_profile' as const, title: `角色：${profile.appearancePrompt.slice(0, 32) || profile.characterId}`, detail: profile.negativePrompt ? `负面约束：${profile.negativePrompt}` : '可用角色锚点、服装和声音版本锁定一致性。' })),
    ...settings.map((setting) => ({ id: setting.id, kind: 'visual_setting' as const, title: `场景：${setting.title}`, detail: setting.visualPrompt.slice(0, 100) || '可用布局、天气、色彩和道具点位锁定场景。' })),
  ], [profiles, settings])
  const owner = owners.find((item) => `${item.kind}:${item.id}` === ownerKey)
  const slots = owner?.kind === 'visual_setting' ? SCENE_SLOTS : CHARACTER_SLOTS
  const availableAssets = useMemo(() => assets.filter((asset) => {
    if (!owner) return false
    return asset.sourceEntityKind === owner.kind && asset.sourceEntityId === owner.id
      || ['character_reference', 'scene_reference', 'style_reference', 'voice_reference', 'casting_reference'].includes(asset.kind)
  }), [assets, owner])
  const ownerVersions = owner ? versions.filter((version) => version.ownerKind === owner.kind && version.ownerId === owner.id) : []
  const requiredSlots = slots.filter((item) => item.required).map((item) => item.value)
  const adoptedSlots = new Set(ownerVersions.filter((version) => version.status === 'adopted').map((version) => version.slot))
  const missingSlots = requiredSlots.filter((required) => !adoptedSlots.has(required))
  const riskNotes = owner ? productionRiskNotes(owner, profiles, settings) : []

  async function reload() {
    const [nextProfiles, nextSettings, nextVersions] = await Promise.all([
      ipc.visualProfile.list(projectId),
      ipc.visualSetting.list(projectId),
      ipc.visualAsset.listByProject(projectId),
    ])
    setProfiles(nextProfiles)
    setSettings(nextSettings)
    setVersions(nextVersions)
  }
  useEffect(() => { void reload() }, [projectId])
  useEffect(() => {
    if (!ownerKey && owners[0]) setOwnerKey(`${owners[0].kind}:${owners[0].id}`)
    else if (ownerKey && !owners.some((item) => `${item.kind}:${item.id}` === ownerKey)) setOwnerKey(owners[0] ? `${owners[0].kind}:${owners[0].id}` : '')
  }, [ownerKey, owners])
  useEffect(() => {
    if (slots.some((item) => item.value === slot)) return
    setSlot(slots[0]?.value ?? 'face_anchor')
  }, [slot, slots])
  useEffect(() => {
    if (assetId && availableAssets.some((asset) => asset.id === assetId)) return
    setAssetId(availableAssets[0]?.id ?? '')
  }, [assetId, availableAssets])

  async function importLocalReference() {
    if (!owner) return toast.error('请先选择角色或场景设定')
    const kind = slot === 'voice_reference' ? 'voice_reference' : owner.kind === 'visual_profile' ? 'character_reference' : 'scene_reference'
    const result = await ipc.asset.chooseLocalFile(kind)
    if (!result.ok || !result.path) return
    setBusy(true)
    try {
      const asset = await ipc.asset.create({
        projectId,
        kind,
        title: result.name || `${owner.title} 本地参考`,
        localPath: result.path,
        sourceEntityKind: owner.kind,
        sourceEntityId: owner.id,
        description: '人工导入的本地参考素材；源文件不会被复制、修改或删除。需要裁剪或标注时，请在外部工具另存为新文件后再导入为候选版本。',
        packagePolicy: 'reference_only',
      })
      setAssetId(asset.id)
      toast.success('已添加本地素材引用；接着创建候选版本并在权利台账完成核验。')
      onChanged()
      await reload()
    } catch (error) {
      toast.error(`添加本地素材失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  async function createCandidate() {
    if (!owner || !assetId) return toast.error('请选择角色/场景和要归档的素材')
    setBusy(true)
    try {
      await ipc.visualAsset.create({
        projectId, ownerKind: owner.kind, ownerId: owner.id, assetId, slot,
        label: label.trim() || `${owner.title} · ${slots.find((item) => item.value === slot)?.label ?? slot}`,
        notes: notes.trim() || undefined,
      })
      setLabel('')
      setNotes('')
      await reload()
      onChanged()
      toast.success('候选版本已保存；采用后才会成为后续分镜的默认资产。')
    } catch (error) {
      toast.error(`创建候选版本失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  async function adopt(version: VisualAssetVersion) {
    setBusy(true)
    try {
      await ipc.visualAsset.adopt(version.id)
      await reload()
      onChanged()
      toast.success('已采用新版本；已锁定旧版本的分镜不会被改写，只会显示待确认更新。')
    } catch (error) {
      toast.error(`采用版本失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  return <section className="space-y-3 rounded-md border bg-muted/20 p-3" data-visual-asset-packs>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="text-sm font-medium">角色 / 场景生产资产包</h3>
        <p className="text-xs text-muted-foreground">把本地授权素材归档为候选版本；采用只切换默认版本，不覆盖旧集和已锁定分镜。</p>
      </div>
      <Button size="sm" variant="outline" onClick={() => void reload()} disabled={busy}><RefreshCw className="h-3.5 w-3.5" />刷新</Button>
    </div>
    {owners.length === 0 ? <p className="rounded border border-dashed p-3 text-xs text-muted-foreground">先在“视觉档案”创建角色，或在“视觉设定”创建场景，再回到这里建立可复用素材包。</p> : <>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="grid gap-1 text-xs"><span>资产归属</span><select value={ownerKey} onChange={(event) => setOwnerKey(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm"><option value="">选择角色或场景</option>{owners.map((item) => <option key={`${item.kind}:${item.id}`} value={`${item.kind}:${item.id}`}>{item.title}</option>)}</select></label>
        <label className="grid gap-1 text-xs"><span>素材槽位</span><select value={slot} onChange={(event) => setSlot(event.target.value as VisualAssetSlot)} className="h-9 rounded-md border bg-background px-2 text-sm">{slots.map((item) => <option key={item.value} value={item.value}>{item.label}{item.required ? '（必需）' : ''}</option>)}</select></label>
      </div>
      {owner && <div className="rounded border bg-background/60 p-2 text-xs"><div className="font-medium">{owner.title}</div><div className="mt-1 text-muted-foreground">{owner.detail}</div><div className="mt-2 flex flex-wrap gap-1">{slots.filter((item) => item.required).map((item) => <Badge key={item.value} variant={adoptedSlots.has(item.value) ? 'default' : 'outline'}>{item.label}{adoptedSlots.has(item.value) ? ' 已采用' : ' 待补齐'}</Badge>)}</div>{missingSlots.length > 0 && <p className="mt-2 text-warn">缺少 {missingSlots.length} 个必需采用版本；AI 生成前请在权利台账确认素材用途。</p>}{riskNotes.length > 0 && <p className="mt-2 flex gap-1 text-destructive"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />高制作风险：{riskNotes.join('；')}。请准备可控替代方案。</p>}</div>}
      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <label className="grid gap-1 text-xs"><span>本地或已有素材</span><select value={assetId} onChange={(event) => setAssetId(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm"><option value="">选择素材</option>{availableAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.title} · {asset.status === 'available' ? '可用' : asset.status === 'missing' ? '缺失' : '远端引用'}</option>)}</select></label>
        <Button type="button" size="sm" variant="outline" className="self-end" onClick={() => void importLocalReference()} disabled={!owner || busy}><FolderPlus className="h-3.5 w-3.5" />导入本地素材</Button>
      </div>
      <div className="grid gap-2 md:grid-cols-2"><Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="版本名称（例如：红裙晚宴款）" /><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="可记录服装阶段、道具点位、裁剪/标注说明和负面约束；源文件保持不变。" className="min-h-9" /></div>
      <div className="flex justify-end"><Button size="sm" onClick={() => void createCandidate()} disabled={!owner || !assetId || busy}>创建候选版本</Button></div>
      {ownerVersions.length > 0 && <div className="space-y-1"><div className="text-xs font-medium">{owner?.kind === 'visual_profile' ? '角色' : '场景'}版本历史</div>{ownerVersions.map((version) => <div key={version.id} className="flex flex-wrap items-center gap-2 rounded border bg-background/60 p-2 text-xs"><Badge variant={STATUS_VARIANT[version.status]}>{STATUS_LABEL[version.status]}</Badge><span className="font-medium">{version.label}</span><span className="text-muted-foreground">{slots.find((item) => item.value === version.slot)?.label ?? version.slot} · v{version.versionNumber}</span>{version.notes && <span className="min-w-40 flex-1 text-muted-foreground">{version.notes}</span>}{version.status !== 'adopted' && <Button size="sm" variant="outline" disabled={busy} onClick={() => void adopt(version)}>采用此版本</Button>}</div>)}</div>}
    </>}
  </section>
}

function productionRiskNotes(owner: Owner, profiles: CharacterVisualProfile[], settings: VisualSetting[]): string[] {
  const source = owner.kind === 'visual_profile'
    ? profiles.find((profile) => profile.id === owner.id)
    : settings.find((setting) => setting.id === owner.id)
  const text = source ? Object.values(source).filter((value): value is string => typeof value === 'string').join(' ') : ''
  const risks: Array<[RegExp, string]> = [
    [/群演|人群|crowd/i, '群演 / 大规模人群'],
    [/儿童|小孩|婴儿|孩子|children|child|baby/i, '儿童角色'],
    [/动物|马匹|宠物|animal|horse/i, '动物表演'],
    [/古装|朝代|历史|文物|宫廷|ancient|period/i, '历史服化道'],
  ]
  return risks.filter(([pattern]) => pattern.test(text)).map(([, label]) => label)
}
