import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, ChevronDown, ChevronUp, Library, MessageSquare, Sparkles } from 'lucide-react'
import type { GenrePreset } from '@sdns/core'
import { SHORT_DRAMA_TYPES } from '@sdns/core'
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
  const [title, setTitle] = useState('')
  const [shortDramaType, setShortDramaType] = useState<string>(SHORT_DRAMA_TYPES[0])
  const [targetAudience, setTargetAudience] = useState('')
  const [coreHook, setCoreHook] = useState('')
  const [coreSellingPoint, setCoreSellingPoint] = useState('')
  const [idea, setIdea] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [genrePresets, setGenrePresets] = useState<GenrePreset[]>([])

  // v0.8：合并内置类型常量与类型库（DB）预设，去重
  useEffect(() => {
    void (async () => {
      const presets = await ipc.genrePreset.list()
      setGenrePresets(presets)
      // 优先用类型库第一项作为默认
      if (presets.length && !requestedType) setShortDramaType(presets[0].name)
    })()
  }, [requestedType])

  useEffect(() => {
    if (requestedTitle) setTitle((value) => value || requestedTitle)
    if (requestedType) setShortDramaType(requestedType)
    if (requestedAudience) setTargetAudience((value) => value || requestedAudience)
    if (requestedHook) setCoreHook((value) => value || requestedHook)
    if (requestedDirection) setCoreSellingPoint((value) => value || requestedDirection)
    if (requestedIdea) setIdea((value) => value || requestedIdea)
    if (requestedType || requestedAudience || requestedHook || requestedDirection || requestedIdea) setAdvanced(true)
  }, [requestedAudience, requestedDirection, requestedHook, requestedIdea, requestedTitle, requestedType])

  const typeOptions = Array.from(new Set([...genrePresets.map((p) => p.name), ...SHORT_DRAMA_TYPES]))

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
      })
      toast.success('项目已创建，去和 AI 聊聊设定吧')
      navigate(`/projects/${project.id}`)
    } catch (e) {
      toast.error('创建失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
          <ArrowLeft />
        </Button>
        <h1 className="text-lg font-semibold">创建项目</h1>
      </header>

      <main className="flex flex-1 items-center justify-center overflow-auto p-6">
        <div className="w-full max-w-xl space-y-6">
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
              placeholder="例如：重生之千金归来"
              className="h-12 text-lg"
            />
            <p className="text-xs text-muted-foreground">
              只需要起个名字就能创建。其余设定（类型、卖点、钩子、受众等）进入工作台后，在和 AI 的「项目对话」里慢慢聊清楚即可。
            </p>
          </div>

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
                <Label>短剧类型</Label>
                <Select value={shortDramaType} onValueChange={setShortDramaType}>
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
                  placeholder="例如：18-35 岁女性短剧用户"
                />
              </div>
              <div className="space-y-2">
                <Label>一句话钩子</Label>
                <Input
                  value={coreHook}
                  onChange={(e) => setCoreHook(e.target.value)}
                  placeholder="例如：她重回婚礼现场，当众夺回被偷走的人生"
                />
              </div>
              <div className="space-y-2">
                <Label>核心爽点 / 短剧方向</Label>
                <Input
                  value={coreSellingPoint}
                  onChange={(e) => setCoreSellingPoint(e.target.value)}
                  placeholder="例如：强压迫、公开反击、集集反转"
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
