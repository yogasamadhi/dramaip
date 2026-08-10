import { useEffect, useMemo, useState } from 'react'
import { BadgeCheck, FileKey2, RefreshCw, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import type { AssetPermittedUse, AssetRightsRecord, AssetRightsStatus, AssetRightsType, ProjectAsset, RightsPreflightResult } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { ASSET_KIND_LABEL } from '@/lib/assets'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const RIGHTS_STATUS: Array<{ value: AssetRightsStatus; label: string }> = [
  { value: 'unknown', label: '未知' },
  { value: 'declared', label: '已声明（待核验）' },
  { value: 'verified', label: '已核验' },
  { value: 'expired', label: '已过期' },
  { value: 'restricted', label: '受限' },
]
const PERMITTED: Array<{ value: AssetPermittedUse; label: string }> = [
  { value: 'commercial', label: '商业使用' },
  { value: 'adaptation', label: '改编' },
  { value: 'generative', label: '生成/参考使用' },
  { value: 'voice_cloning', label: '声音复刻' },
]
const RIGHTS_TYPES: Array<{ value: AssetRightsType; label: string }> = [
  { value: 'ownership', label: '权属' }, { value: 'license', label: '授权许可' }, { value: 'talent_release', label: '肖像授权' },
  { value: 'voice_consent', label: '声音同意' }, { value: 'provider_terms', label: 'Provider 条款' }, { value: 'public_domain', label: '公版/公共领域' }, { value: 'other', label: '其他' },
]

interface Draft {
  rightsholder: string
  source: string
  status: AssetRightsStatus
  rightsTypes: AssetRightsType[]
  permittedUses: AssetPermittedUse[]
  platforms: string
  regions: string
  validFrom: string
  validUntil: string
  evidenceAssetId?: string
  evidenceSha256?: string
  aiGenerated: boolean
  reviewNote: string
}

export function RightsLedgerPanel({ projectId, assets, records, onChanged }: { projectId: string; assets: ProjectAsset[]; records: AssetRightsRecord[]; onChanged: () => void }) {
  const scopedAssets = useMemo(() => assets.filter((asset) => !['rights_evidence', 'subtitle_file', 'other'].includes(asset.kind)), [assets])
  const recordsByAsset = useMemo(() => new Map(records.map((record) => [record.assetId, record])), [records])
  const [selectedAssetId, setSelectedAssetId] = useState<string | undefined>()
  const [draft, setDraft] = useState<Draft>(() => blankDraft())
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [preflight, setPreflight] = useState<RightsPreflightResult | null>(null)
  const [platform, setPlatform] = useState('抖音')
  const [region, setRegion] = useState('中国大陆')

  const selectedAsset = scopedAssets.find((asset) => asset.id === selectedAssetId) ?? scopedAssets[0]
  const selectedRecord = selectedAsset ? recordsByAsset.get(selectedAsset.id) : undefined

  useEffect(() => {
    if (selectedAsset && selectedAsset.id !== selectedAssetId) setSelectedAssetId(selectedAsset.id)
  }, [selectedAsset, selectedAssetId])
  useEffect(() => setDraft(draftFromRecord(selectedRecord)), [selectedRecord?.id, selectedAsset?.id])

  async function save() {
    if (!selectedAsset) return
    if (draft.status === 'verified' && (!draft.evidenceAssetId || !draft.evidenceSha256)) {
      toast.error('“已核验”必须关联受控保存的证明文件及 hash，声明不能替代证据。')
      return
    }
    setSaving(true)
    try {
      await ipc.rights.create({
        projectId,
        assetId: selectedAsset.id,
        rightsholder: optional(draft.rightsholder),
        source: optional(draft.source),
        status: draft.status,
        rightsTypes: draft.aiGenerated && !draft.rightsTypes.includes('provider_terms') ? [...draft.rightsTypes, 'provider_terms'] : draft.rightsTypes,
        permittedUses: draft.permittedUses,
        platforms: splitScope(draft.platforms),
        regions: splitScope(draft.regions),
        validFrom: optional(draft.validFrom),
        validUntil: optional(draft.validUntil),
        evidenceAssetId: draft.evidenceAssetId,
        evidenceSha256: draft.evidenceSha256,
        aiGenerated: draft.aiGenerated,
        reviewedAt: draft.status === 'verified' ? new Date().toISOString() : undefined,
        reviewNote: optional(draft.reviewNote),
      })
      toast.success('权利台账已保存')
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存权利台账失败')
    } finally {
      setSaving(false)
    }
  }

  async function chooseEvidence() {
    if (!selectedAsset) return
    const picked = await ipc.asset.chooseLocalFile('rights_evidence')
    if (!picked.ok || !picked.path) return
    try {
      const evidence = await ipc.asset.create({
        projectId,
        kind: 'rights_evidence',
        title: `授权证明：${picked.name ?? selectedAsset.title}`,
        localPath: picked.path,
        originalName: picked.name,
        tags: ['授权证明'],
        metadata: { protectedEvidence: true, forAssetId: selectedAsset.id },
        packagePolicy: 'reference_only',
      })
      setDraft((current) => ({ ...current, evidenceAssetId: evidence.id, evidenceSha256: evidence.sha256 }))
      toast.success('证明文件已复制到本地受控资产库')
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存证明文件失败')
    }
  }

  async function runPreflight() {
    setRunning(true)
    try {
      const result = await ipc.rights.preflight({ projectId, platform: optional(platform), region: optional(region) })
      setPreflight(result)
      if (result.status === 'pass') toast.success('权利预检通过')
      else toast.error(`权利预检发现 ${result.blockers.length} 项交付阻塞`)
    } finally {
      setRunning(false)
    }
  }

  return <section className="space-y-3 rounded-md border bg-muted/20 p-3" data-rights-ledger>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-sm font-medium"><FileKey2 className="h-4 w-4 text-primary" />版权与授权台账</div><p className="mt-1 text-xs text-muted-foreground">声明、核验、期限与用途范围分开记录。草稿不会被拦截；最终预检对未知、过期、受限和缺证据 fail-closed。</p></div><Badge variant="outline">{records.length}/{scopedAssets.length} 已建账</Badge></div>
    {scopedAssets.length === 0 ? <p className="rounded border bg-background p-3 text-xs text-muted-foreground">暂无需要权利核验的资产。导入原稿、人物/场景参考、声音、生成视频和封面会在此出现。</p> : <>
      <div className="flex flex-wrap gap-1">{scopedAssets.slice(0, 12).map((asset) => <Button key={asset.id} size="sm" variant={selectedAsset?.id === asset.id ? 'default' : 'outline'} onClick={() => setSelectedAssetId(asset.id)}>{asset.title.slice(0, 20)} <span className="ml-1 opacity-70">{rightsLabel(recordsByAsset.get(asset.id)?.status)}</span></Button>)}</div>
      {selectedAsset && <div className="space-y-2 rounded border bg-background p-3 text-xs"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{selectedAsset.title}</span><Badge variant="outline">{ASSET_KIND_LABEL[selectedAsset.kind]}</Badge><Badge variant={selectedRecord?.status === 'verified' ? 'default' : selectedRecord?.status === 'unknown' || !selectedRecord ? 'destructive' : 'outline'}>{rightsLabel(selectedRecord?.status)}</Badge></div>
        <div className="grid gap-2 md:grid-cols-2"><Input value={draft.rightsholder} onChange={(event) => setDraft((current) => ({ ...current, rightsholder: event.target.value }))} placeholder="权利人 / 被授权方" /><Input value={draft.source} onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))} placeholder="来源或授权编号" /><label className="grid gap-1 text-muted-foreground">状态<select className="h-9 rounded border bg-background px-2 text-foreground" value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as AssetRightsStatus }))}>{RIGHTS_STATUS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="grid gap-1 text-muted-foreground">有效起（可留空）<Input type="date" value={draft.validFrom} onChange={(event) => setDraft((current) => ({ ...current, validFrom: event.target.value }))} /></label><label className="grid gap-1 text-muted-foreground">有效至（可留空）<Input type="date" value={draft.validUntil} onChange={(event) => setDraft((current) => ({ ...current, validUntil: event.target.value }))} /></label><Input value={draft.platforms} onChange={(event) => setDraft((current) => ({ ...current, platforms: event.target.value }))} placeholder="平台范围，如：全部 / 抖音,快手" /><Input value={draft.regions} onChange={(event) => setDraft((current) => ({ ...current, regions: event.target.value }))} placeholder="地区范围，如：全部 / 中国大陆" /></div>
        <div className="flex flex-wrap gap-3">{RIGHTS_TYPES.map((item) => <label key={item.value} className="flex items-center gap-1"><input type="checkbox" checked={draft.rightsTypes.includes(item.value)} onChange={(event) => setDraft((current) => ({ ...current, rightsTypes: event.target.checked ? [...current.rightsTypes, item.value] : current.rightsTypes.filter((value) => value !== item.value) }))} />{item.label}</label>)}</div>
        <div className="flex flex-wrap gap-3">{PERMITTED.map((item) => <label key={item.value} className="flex items-center gap-1"><input type="checkbox" checked={draft.permittedUses.includes(item.value)} onChange={(event) => setDraft((current) => ({ ...current, permittedUses: event.target.checked ? [...current.permittedUses, item.value] : current.permittedUses.filter((value) => value !== item.value) }))} />{item.label}</label>)}<label className="flex items-center gap-1"><input type="checkbox" checked={draft.aiGenerated} onChange={(event) => setDraft((current) => ({ ...current, aiGenerated: event.target.checked }))} />AI 生成结果</label></div>
        <div className="flex flex-wrap items-center gap-2 rounded border border-dashed p-2"><ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-muted-foreground">证明：{draft.evidenceSha256 ? `${draft.evidenceSha256.slice(0, 12)}…` : '未关联'}</span><Button size="sm" variant="outline" onClick={() => void chooseEvidence()}> {draft.evidenceAssetId ? '重新定位证明' : '添加本地证明'} </Button><span className="text-muted-foreground">证明正文不会进入诊断包或默认项目包。</span></div>
        <Input value={draft.reviewNote} onChange={(event) => setDraft((current) => ({ ...current, reviewNote: event.target.value }))} placeholder="核验备注（可选）" /><Button size="sm" onClick={() => void save()} disabled={saving}>{saving ? <RefreshCw className="animate-spin" /> : <BadgeCheck />}保存台账</Button>
      </div>}
    </>}
    <div className="flex flex-wrap items-end gap-2 rounded border bg-background p-2"><label className="grid gap-1 text-xs text-muted-foreground">目标平台<Input value={platform} onChange={(event) => setPlatform(event.target.value)} /></label><label className="grid gap-1 text-xs text-muted-foreground">目标地区<Input value={region} onChange={(event) => setRegion(event.target.value)} /></label><Button size="sm" variant="outline" onClick={() => void runPreflight()} disabled={running}>{running ? <RefreshCw className="animate-spin" /> : <ShieldAlert />}交付前预检</Button>{preflight && <span className={preflight.status === 'pass' ? 'text-success' : 'text-destructive'}>{preflight.status === 'pass' ? `通过：${preflight.verifiedAssetCount}/${preflight.reviewedAssetCount} 已核验` : `阻塞 ${preflight.blockers.length} 项：${preflight.blockers.slice(0, 2).map((item) => `${item.assetTitle}（${item.message}）`).join('；')}`}</span>}</div>
  </section>
}

function blankDraft(): Draft { return { rightsholder: '', source: '', status: 'unknown', rightsTypes: [], permittedUses: [], platforms: '全部', regions: '全部', validFrom: '', validUntil: '', aiGenerated: false, reviewNote: '' } }
function draftFromRecord(record: AssetRightsRecord | undefined): Draft { return record ? { rightsholder: record.rightsholder ?? '', source: record.source ?? '', status: record.status, rightsTypes: record.rightsTypes, permittedUses: record.permittedUses, platforms: record.platforms.join(',') || '全部', regions: record.regions.join(',') || '全部', validFrom: record.validFrom ?? '', validUntil: record.validUntil ?? '', evidenceAssetId: record.evidenceAssetId, evidenceSha256: record.evidenceSha256, aiGenerated: record.aiGenerated, reviewNote: record.reviewNote ?? '' } : blankDraft() }
function splitScope(value: string): string[] { return value.split(/[，,]/).map((item) => item.trim()).filter(Boolean) }
function optional(value: string): string | undefined { return value.trim() || undefined }
function rightsLabel(status: AssetRightsStatus | undefined): string { return ({ verified: '已核验', declared: '已声明', unknown: '未知', expired: '已过期', restricted: '受限' } as Record<AssetRightsStatus, string>)[status ?? 'unknown'] }
