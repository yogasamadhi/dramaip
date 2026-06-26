import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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

export function CreateProjectPage() {
  const navigate = useNavigate()
  const create = useProjectsStore((s) => s.create)
  const [title, setTitle] = useState('')
  const [shortDramaType, setShortDramaType] = useState<string>(SHORT_DRAMA_TYPES[0])
  const [advanced, setAdvanced] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [genrePresets, setGenrePresets] = useState<GenrePreset[]>([])

  // v0.8：合并内置类型常量与类型库（DB）预设，去重
  useEffect(() => {
    void (async () => {
      const presets = await ipc.genrePreset.list()
      setGenrePresets(presets)
      // 优先用类型库第一项作为默认
      if (presets.length) setShortDramaType(presets[0].name)
    })()
  }, [])

  const typeOptions = Array.from(new Set([...genrePresets.map((p) => p.name), ...SHORT_DRAMA_TYPES]))

  async function handleSubmit() {
    if (!title.trim()) {
      toast.error('请填写作品名称')
      return
    }
    setSubmitting(true)
    try {
      const project = await create({ title: title.trim(), shortDramaType })
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
