import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, ChevronDown, ChevronUp, FilePlus2, Library, Lightbulb, MessageSquare, Sparkles, Upload } from 'lucide-react'
import type { GenrePreset } from '@sdns/core'
import {
  DEFAULT_GENRE_MARKET_SNAPSHOT,
  SHORT_DRAMA_TYPES,
  createGenreOpportunitySelection,
  selectGenreOpportunity,
  type GenreMarketSnapshot,
} from '@sdns/core'
import { useProjectsStore } from '@/stores/useProjectsStore'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export function CreateProjectPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const create = useProjectsStore((s) => s.create)
  const requestedTitle = searchParams.get('title') ?? ''
  const requestedType = searchParams.get('type') ?? searchParams.get('genre') ?? ''
  const requestedAudience = searchParams.get('audience') ?? ''
  const requestedHook = searchParams.get('hook') ?? ''
  const requestedDirection = searchParams.get('direction') ?? ''
  const requestedIdea = searchParams.get('idea') ?? ''
  const requestedOpportunityId = searchParams.get('opportunity') ?? ''
  const [title, setTitle] = useState('')
  const [shortDramaType, setShortDramaType] = useState<string>(SHORT_DRAMA_TYPES[0])
  const [targetAudience, setTargetAudience] = useState('')
  const [coreHook, setCoreHook] = useState('')
  const [coreSellingPoint, setCoreSellingPoint] = useState('')
  const [idea, setIdea] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [genrePresets, setGenrePresets] = useState<GenrePreset[]>([])
  const [genreOpportunityId, setGenreOpportunityId] = useState(requestedOpportunityId)
  const [marketSnapshot, setMarketSnapshot] = useState<GenreMarketSnapshot>(DEFAULT_GENRE_MARKET_SNAPSHOT)

  // v0.8：合并内置类型常量与类型库（DB）预设，去重
  useEffect(() => {
    void (async () => {
      const [presets, activeSnapshot] = await Promise.all([
        ipc.genrePreset.list(),
        ipc.genreMarketSnapshot.getActive(),
      ])
      setGenrePresets(presets)
      if (activeSnapshot) setMarketSnapshot(activeSnapshot)
    })()
  }, [])

  useEffect(() => {
    if (requestedTitle) setTitle((value) => value || requestedTitle)
    if (requestedType) setShortDramaType(requestedType)
    if (requestedAudience) setTargetAudience((value) => value || requestedAudience)
    if (requestedHook) setCoreHook((value) => value || requestedHook)
    if (requestedDirection) setCoreSellingPoint((value) => value || requestedDirection)
    if (requestedIdea) setIdea((value) => value || requestedIdea)
    if (requestedOpportunityId) setGenreOpportunityId(requestedOpportunityId)
    if (requestedType || requestedAudience || requestedHook || requestedDirection || requestedIdea) setAdvanced(true)
  }, [requestedAudience, requestedDirection, requestedHook, requestedIdea, requestedOpportunityId, requestedTitle, requestedType])

  const typeOptions = Array.from(new Set([...SHORT_DRAMA_TYPES, ...genrePresets.map((p) => p.name)]))
  const selectedOpportunity = selectGenreOpportunity(marketSnapshot, genreOpportunityId)

  function chooseOpportunity(opportunityId: string) {
    const opportunity = selectGenreOpportunity(marketSnapshot, opportunityId)
    setGenreOpportunityId(opportunityId)
    if (!opportunity) return
    setShortDramaType(opportunity.genreName)
    setAdvanced(true)
  }

  function chooseType(type: string) {
    setShortDramaType(type)
    if (selectedOpportunity?.genreName !== type) setGenreOpportunityId('')
  }

  async function handleSubmit() {
    if (!title.trim()) {
      toast.error('请填写作品名称')
      return
    }
    setSubmitting(true)
    try {
      const trimmedIdea = idea.trim()
      const hook = coreHook.trim() || trimmedIdea.split('\n').find((line) => line.trim())?.trim()
      const project = await create({
        title: title.trim(),
        shortDramaType,
        targetAudience: targetAudience.trim() || undefined,
        coreHook: hook || undefined,
        coreSellingPoint: coreSellingPoint.trim() || undefined,
        synopsis: trimmedIdea || undefined,
        styleGuide: trimmedIdea ? `【灵感方案】\n${trimmedIdea}` : undefined,
        genreOpportunity: selectedOpportunity
          ? createGenreOpportunitySelection(marketSnapshot, selectedOpportunity)
          : undefined,
      })
      toast.success('项目已创建，去和 AI 聊聊设定吧')
      navigate(`/projects/${project.id}`)
    } catch (e) {
      toast.error('创建失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleImport() {
    const toastId = toast.loading('正在导入项目包…')
    const result = await ipc.project.importPackage()
    if (result.ok && result.project) {
      toast.success(`已导入「${result.project.title}」`, { id: toastId })
      navigate(`/projects/${result.project.id}`)
    } else if (result.canceled) toast.dismiss(toastId)
    else toast.error('导入失败：' + (result.error ?? '未知错误'), { id: toastId })
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" aria-label="返回项目列表" onClick={() => navigate('/')}>
          <ArrowLeft />
        </Button>
        <h1 className="text-lg font-semibold">创建项目</h1>
      </header>

      <main className="flex flex-1 items-center justify-center overflow-auto p-6">
        <div className="w-full max-w-xl space-y-6">
          <section className="grid gap-2 sm:grid-cols-3" aria-label="创建方式">
            <Button variant="secondary" className="h-auto justify-start py-3 text-left" onClick={() => { setTitle(''); setIdea(''); setAdvanced(false) }}>
              <FilePlus2 /><span><span className="block">空白项目</span><span className="block text-xs font-normal text-muted-foreground">从名称开始</span></span>
            </Button>
            <Button variant="outline" className="h-auto justify-start py-3 text-left" onClick={() => setAdvanced(true)}>
              <Lightbulb /><span><span className="block">带着灵感创建</span><span className="block text-xs font-normal text-muted-foreground">补充钩子和方向</span></span>
            </Button>
            <Button variant="outline" className="h-auto justify-start py-3 text-left" onClick={() => void handleImport()}>
              <Upload /><span><span className="block">导入项目包</span><span className="block text-xs font-normal text-muted-foreground">继续已有创作</span></span>
            </Button>
          </section>
          <div className="space-y-2">
            <Label className="text-base">作品名称 *</Label>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleSubmit()
                }
              }}
              placeholder="例如：天劫将至，我的废灵根觉醒了"
              className="h-12 text-lg"
            />
            <p className="text-xs text-muted-foreground">
              只需要起个名字就能创建。其余设定（类型、卖点、钩子、受众等）进入工作台后，在和 AI 的「项目对话」里慢慢聊清楚即可。
            </p>
          </div>

          {!advanced && (
            <div className="space-y-2">
              <div className="text-sm font-medium">先选一个类型（可选）</div>
              <div className="flex flex-wrap gap-2">{typeOptions.slice(0, 8).map((type) => <Button key={type} size="sm" variant={shortDramaType === type ? 'secondary' : 'outline'} onClick={() => chooseType(type)}>{type}</Button>)}</div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            {advanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            更多设置（可选）
          </button>

          {advanced && (
            <div className="space-y-3 rounded-md border p-4">
              <div className="space-y-2">
                <Label>题材机会（可选）</Label>
                <Select value={genreOpportunityId || 'none'} onValueChange={(value) => value === 'none' ? setGenreOpportunityId('') : chooseOpportunity(value)}>
                  <SelectTrigger><SelectValue placeholder="选择离线市场机会快照" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不采用市场机会快照</SelectItem>
                    {marketSnapshot.opportunities.map((opportunity) => (
                      <SelectItem key={opportunity.id} value={opportunity.id}>
                        {opportunity.genreName} · {opportunity.status === 'hot' ? '热门' : opportunity.status === 'rising' ? '上升' : opportunity.status === 'steady' ? '稳定' : opportunity.status === 'classic' ? '经典' : '高饱和'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  离线快照 {marketSnapshot.version}（{marketSnapshot.observedAt}）；不是实时榜单，选择后会随项目保存当时的依据。
                </p>
                {selectedOpportunity && (
                  <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                    <p><span className="font-medium text-foreground">为什么推荐：</span>{selectedOpportunity.whyRecommended[0]}</p>
                    <p className="mt-1"><span className="font-medium text-foreground">主要风险：</span>{selectedOpportunity.primaryRisks[0]}</p>
                    <p className="mt-1"><span className="font-medium text-foreground">差异化：</span>{selectedOpportunity.differentiationIdeas[0]}</p>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>短剧类型</Label>
                <Select value={shortDramaType} onValueChange={chooseType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {typeOptions.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  类型来自「类型库」预设；进入「项目对话」后也可让 AI 帮你判断最合适的类型。
                </p>
                <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => navigate('/genres')}>
                  <Library className="h-3 w-3" />
                  管理类型库
                </Button>
              </div>
              <div className="space-y-2">
                <Label>目标受众</Label>
                <Input
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                  placeholder="例如：18-34 岁 AI 漫剧用户"
                />
              </div>
              <div className="space-y-2">
                <Label>一句话钩子</Label>
                <Input
                  value={coreHook}
                  onChange={(e) => setCoreHook(e.target.value)}
                  placeholder="例如：废柴弟子临刑前觉醒上古神脉，逆转必死天劫"
                />
              </div>
              <div className="space-y-2">
                <Label>核心爽点 / 短剧方向</Label>
                <Input
                  value={coreSellingPoint}
                  onChange={(e) => setCoreSellingPoint(e.target.value)}
                  placeholder="例如：东方玄幻奇观、越级反杀、集尾强钩子"
                />
              </div>
              <div className="space-y-2">
                <Label>灵感摘要</Label>
                <Textarea
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  rows={6}
                  placeholder="从灵感台带入的方案摘要"
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button size="lg" onClick={handleSubmit} disabled={submitting}>
              <Sparkles />
              创建项目
            </Button>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <MessageSquare className="h-3.5 w-3.5" />
              创建后即可进入 AI 项目对话
            </span>
          </div>
        </div>
      </main>
    </div>
  )
}
