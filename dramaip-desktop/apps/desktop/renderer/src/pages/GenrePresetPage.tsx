// v0.8 类型库页面（ROADMAP v0.8 §4）：浏览 / CRUD 短剧类型预设 + 「基于此类型创建项目」
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, BookText, Library, Plus, Sparkles, Trash2 } from 'lucide-react'
import {
  BUILT_IN_GENRE_PRESETS,
  CLASSIC_GENRE_PRESET_NAMES,
  DEFAULT_GENRE_MARKET_SNAPSHOT,
  HOT_GENRE_PRESET_NAMES,
  createGenreOpportunitySelection,
  type GenreMarketSnapshot,
  type GenreMarketStatus,
  type GenrePresentation,
  type GenrePreset,
} from '@sdns/core'
import { useProjectsStore } from '@/stores/useProjectsStore'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const genreOrder = new Map(BUILT_IN_GENRE_PRESETS.map((preset, index) => [preset.name, index]))
const hotGenres = new Set(HOT_GENRE_PRESET_NAMES)
const classicGenres = new Set(CLASSIC_GENRE_PRESET_NAMES)

const statusLabel: Record<GenreMarketStatus, string> = {
  hot: '热门',
  rising: '上升',
  steady: '稳定',
  classic: '经典',
  saturated: '高饱和',
}

function ListField({ label, items }: { label: string; items: string[] }) {
  if (!items?.length) return null
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1">
        {items.map((it, i) => (
          <Badge key={i} variant="secondary" className="font-normal">
            {it}
          </Badge>
        ))}
      </div>
    </div>
  )
}

export function GenrePresetPage() {
  const navigate = useNavigate()
  const create = useProjectsStore((s) => s.create)
  const [presets, setPresets] = useState<GenrePreset[]>([])
  const [name, setName] = useState('')
  const [visualStyle, setVisualStyle] = useState('')
  const [desc, setDesc] = useState('')
  const [statusFilter, setStatusFilter] = useState<GenreMarketStatus | 'all'>('all')
  const [presentationFilter, setPresentationFilter] = useState<GenrePresentation | 'all'>('all')
  const [audienceFilter, setAudienceFilter] = useState<'female' | 'male' | 'general' | 'all'>('all')
  const [costFilter, setCostFilter] = useState<'low' | 'medium' | 'high' | 'all'>('all')
  const [saturationFilter, setSaturationFilter] = useState<'low' | 'medium' | 'high' | 'all'>('all')
  const [platformFilter, setPlatformFilter] = useState<string>('all')
  const [marketSnapshot, setMarketSnapshot] = useState<GenreMarketSnapshot>(DEFAULT_GENRE_MARKET_SNAPSHOT)
  const [marketSnapshots, setMarketSnapshots] = useState<Array<GenreMarketSnapshot & { active: boolean }>>([])
  const [snapshotVersion, setSnapshotVersion] = useState(DEFAULT_GENRE_MARKET_SNAPSHOT.version)
  const snapshotFileRef = useRef<HTMLInputElement>(null)

  async function reload() {
    const [items, snapshots] = await Promise.all([
      ipc.genrePreset.list(),
      ipc.genreMarketSnapshot.list(),
    ])
    items.sort((a, b) => {
      const aOrder = genreOrder.get(a.name) ?? Number.MAX_SAFE_INTEGER
      const bOrder = genreOrder.get(b.name) ?? Number.MAX_SAFE_INTEGER
      return aOrder - bOrder
    })
    setPresets(items)
    setMarketSnapshots(snapshots)
    const active = snapshots.find((snapshot) => snapshot.active) ?? DEFAULT_GENRE_MARKET_SNAPSHOT
    setMarketSnapshot(active)
    setSnapshotVersion((current) => snapshots.some((snapshot) => snapshot.version === current) ? current : active.version)
  }
  useEffect(() => {
    void reload()
  }, [])

  const opportunityByGenre = useMemo(
    () => new Map(marketSnapshot.opportunities.map((item) => [item.genreName, item])),
    [marketSnapshot],
  )

  const filteredPresets = presets.filter((preset) => {
    const opportunity = opportunityByGenre.get(preset.name)
    if (!opportunity) {
      return statusFilter === 'all' && presentationFilter === 'all' && audienceFilter === 'all' && costFilter === 'all' && saturationFilter === 'all' && platformFilter === 'all'
    }
    return (
      (statusFilter === 'all' || opportunity.status === statusFilter) &&
      (presentationFilter === 'all' || opportunity.presentations.includes(presentationFilter)) &&
      (audienceFilter === 'all' || opportunity.audiences.includes(audienceFilter)) &&
      (costFilter === 'all' || opportunity.productionCost === costFilter) &&
      (saturationFilter === 'all' || opportunity.saturation === saturationFilter) &&
      (platformFilter === 'all' || opportunity.platforms.includes(platformFilter))
    )
  })

  async function handleAdd() {
    if (!name.trim() || !visualStyle.trim()) {
      toast.error('请填写类型名与视觉风格')
      return
    }
    try {
      await ipc.genrePreset.create({
        name: name.trim(),
        visualStyle: visualStyle.trim(),
        shotPromptAdvice: '（待补充）',
        aiVideoRisks: '（待补充）',
        description: desc.trim() || undefined,
        commonRelationships: [],
        commonHighlights: [],
        commonReversals: [],
        commonOpenings: [],
        commonCliffhangers: [],
      })
      toast.success('已新增类型预设')
      setName('')
      setVisualStyle('')
      setDesc('')
      await reload()
    } catch (e) {
      toast.error('新增失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function createProjectFromGenre(p: GenrePreset) {
    try {
      const opportunity = opportunityByGenre.get(p.name)
      const project = await create({
        title: `《${p.name}》新项目`,
        shortDramaType: p.name,
        genreOpportunity: opportunity ? createGenreOpportunitySelection(marketSnapshot, opportunity) : undefined,
      })
      toast.success('已基于该类型创建项目')
      navigate(`/projects/${project.id}`)
    } catch (e) {
      toast.error('创建项目失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function handleImportMarketSnapshot(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const snapshot = JSON.parse(await file.text()) as unknown
      const imported = await ipc.genreMarketSnapshot.import(snapshot)
      toast.success(`已导入并启用 ${imported.version}`)
      await reload()
    } catch (error) {
      toast.error(`导入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function activateMarketSnapshot() {
    try {
      const activated = await ipc.genreMarketSnapshot.activate(snapshotVersion)
      if (!activated) {
        toast.error('未找到要回退的市场快照')
        return
      }
      toast.success(`已启用 ${activated.version}；已建项目不会被改写`)
      await reload()
    } catch (error) {
      toast.error(`回退失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
          <ArrowLeft />
        </Button>
        <Library className="h-5 w-5" />
        <h1 className="text-lg font-semibold">类型库</h1>
        <p className="text-sm text-muted-foreground">离线市场快照优先，少量常青经典保留；支持新增自定义题材</p>
      </header>

      <main className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="mx-auto max-w-5xl space-y-6 p-6">
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="text-sm font-medium">市场机会快照</div>
                <p className="text-xs text-muted-foreground">
                  {marketSnapshot.version} · {marketSnapshot.observedAt} · {marketSnapshot.sources.map((source) => source.label).join('；')}。仅供方向判断，不是实时热榜。
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input ref={snapshotFileRef} className="hidden" type="file" accept="application/json,.json" onChange={(event) => void handleImportMarketSnapshot(event)} />
                  <Button type="button" size="sm" variant="outline" onClick={() => snapshotFileRef.current?.click()}>导入 JSON 快照</Button>
                  <Select value={snapshotVersion} onValueChange={setSnapshotVersion}>
                    <SelectTrigger className="sm:max-w-md"><SelectValue placeholder="选择历史版本" /></SelectTrigger>
                    <SelectContent>
                      {marketSnapshots.map((snapshot) => <SelectItem key={snapshot.version} value={snapshot.version}>{snapshot.active ? '当前 · ' : ''}{snapshot.version} · {snapshot.observedAt}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button type="button" size="sm" variant="outline" disabled={snapshotVersion === marketSnapshot.version} onClick={() => void activateMarketSnapshot()}>启用/回退此版本</Button>
                </div>
                <p className="text-xs text-muted-foreground">导入仅写入本机，不会抓取私有榜单；文件须含日期、来源、推荐依据、风险与差异化建议。启用旧版本只影响后续新项目。</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as GenreMarketStatus | 'all')}><SelectTrigger><SelectValue placeholder="状态" /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="hot">热门</SelectItem><SelectItem value="rising">上升</SelectItem><SelectItem value="steady">稳定</SelectItem><SelectItem value="classic">经典</SelectItem><SelectItem value="saturated">高饱和</SelectItem></SelectContent></Select>
                  <Select value={presentationFilter} onValueChange={(value) => setPresentationFilter(value as GenrePresentation | 'all')}><SelectTrigger><SelectValue placeholder="表现形式" /></SelectTrigger><SelectContent><SelectItem value="all">全部形式</SelectItem><SelectItem value="ai_animation">AI 漫剧优先</SelectItem><SelectItem value="live_action">仿真人/实拍感</SelectItem></SelectContent></Select>
                  <Select value={audienceFilter} onValueChange={(value) => setAudienceFilter(value as 'female' | 'male' | 'general' | 'all')}><SelectTrigger><SelectValue placeholder="受众" /></SelectTrigger><SelectContent><SelectItem value="all">全部受众</SelectItem><SelectItem value="female">女频</SelectItem><SelectItem value="male">男频</SelectItem><SelectItem value="general">泛人群</SelectItem></SelectContent></Select>
                  <Select value={platformFilter} onValueChange={setPlatformFilter}><SelectTrigger><SelectValue placeholder="平台" /></SelectTrigger><SelectContent><SelectItem value="all">全部平台</SelectItem><SelectItem value="AI 漫剧">AI 漫剧</SelectItem><SelectItem value="短视频竖屏">短视频竖屏</SelectItem><SelectItem value="短剧 App">短剧 App</SelectItem></SelectContent></Select>
                  <Select value={costFilter} onValueChange={(value) => setCostFilter(value as 'low' | 'medium' | 'high' | 'all')}><SelectTrigger><SelectValue placeholder="成本" /></SelectTrigger><SelectContent><SelectItem value="all">全部成本</SelectItem><SelectItem value="low">低成本</SelectItem><SelectItem value="medium">中成本</SelectItem><SelectItem value="high">高成本</SelectItem></SelectContent></Select>
                  <Select value={saturationFilter} onValueChange={(value) => setSaturationFilter(value as 'low' | 'medium' | 'high' | 'all')}><SelectTrigger><SelectValue placeholder="饱和度" /></SelectTrigger><SelectContent><SelectItem value="all">全部饱和度</SelectItem><SelectItem value="low">低饱和</SelectItem><SelectItem value="medium">中饱和</SelectItem><SelectItem value="high">高饱和</SelectItem></SelectContent></Select>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Plus className="h-4 w-4" /> 新增类型预设
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>类型名 *</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：职场逆袭" />
                </div>
                <div className="space-y-2">
                  <Label>视觉风格 *</Label>
                  <Input value={visualStyle} onChange={(e) => setVisualStyle(e.target.value)} placeholder="如：现代都市短剧，明亮偏暖" />
                </div>
                <div className="space-y-2 md:col-span-1">
                  <Label>简介</Label>
                  <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="（可选）" />
                </div>
                <div className="md:col-span-3">
                  <Button onClick={handleAdd}>新增</Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {filteredPresets.map((p) => (
                <Card key={p.id} className="flex flex-col">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <BookText className="h-4 w-4 text-primary" />
                        {p.name}
                        {p.builtIn && hotGenres.has(p.name) && <Badge>当前热门</Badge>}
                        {p.builtIn && classicGenres.has(p.name) && <Badge variant="outline">经典保留</Badge>}
                        {p.builtIn && !hotGenres.has(p.name) && !classicGenres.has(p.name) && (
                          <Badge variant="outline">内置</Badge>
                        )}
                        {opportunityByGenre.get(p.name) && <Badge variant="secondary">{statusLabel[opportunityByGenre.get(p.name)!.status]}</Badge>}
                      </CardTitle>
                      {!p.builtIn && (
                        <Button
                          size="icon"
                          variant="ghost"
                          title="删除"
                          onClick={async () => {
                            await ipc.genrePreset.remove(p.id)
                            toast.success('已删除')
                            await reload()
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                    {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
                  </CardHeader>
                  <CardContent className="flex-1 space-y-3 text-sm">
                    <ListField label="常见人物关系" items={p.commonRelationships} />
                    <ListField label="常见爽点" items={p.commonHighlights} />
                    <ListField label="常见反转" items={p.commonReversals} />
                    <ListField label="常见开局" items={p.commonOpenings} />
                    <ListField label="常见结尾钩子" items={p.commonCliffhangers} />
                    <Separator />
                    {opportunityByGenre.get(p.name) && (() => {
                      const opportunity = opportunityByGenre.get(p.name)!
                      return <div className="space-y-1 text-xs text-muted-foreground"><div>适合：{opportunity.presentations.map((item) => item === 'ai_animation' ? 'AI 漫剧' : '仿真人').join(' / ')} · {opportunity.productionCost === 'low' ? '低成本' : opportunity.productionCost === 'medium' ? '中成本' : '高成本'} · {opportunity.saturation === 'low' ? '低饱和' : opportunity.saturation === 'medium' ? '中饱和' : '高饱和'}</div><div>为什么推荐：{opportunity.whyRecommended[0]}</div><div>主要风险：{opportunity.primaryRisks[0]}</div><div>差异化建议：{opportunity.differentiationIdeas[0]}</div></div>
                    })()}
                    <div className="text-xs text-muted-foreground">
                      <div>视觉风格：{p.visualStyle}</div>
                      <div className="mt-1">镜头 Prompt 建议：{p.shotPromptAdvice}</div>
                      <div className="mt-1">AI 视频生成风险：{p.aiVideoRisks}</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => createProjectFromGenre(p)}>
                      <Sparkles className="h-3.5 w-3.5" />
                      基于此类型创建项目
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </ScrollArea>
      </main>
    </div>
  )
}
