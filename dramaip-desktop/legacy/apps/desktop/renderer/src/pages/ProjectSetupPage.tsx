import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Library, Loader2, Save, Sparkles } from 'lucide-react'
import type { GenerateProjectResult, GenrePreset, Project } from '@sdns/core'
import { SHORT_DRAMA_TYPES } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// 项目设定字段。仅含用户可编辑的设定项，不含 id / 时间戳 / activeAdaptationId。
interface SetupForm {
  title: string
  shortDramaType: string
  targetAudience: string
  targetWordCount: string
  targetEpisodeCount: string
  coreHook: string
  emotionalCore: string
  coreSellingPoint: string
  visualStyleDirection: string
  synopsis: string
  styleGuide: string
}

function toForm(project: Project): SetupForm {
  return {
    title: project.title ?? '',
    shortDramaType: project.shortDramaType ?? SHORT_DRAMA_TYPES[0],
    targetAudience: project.targetAudience ?? '',
    targetWordCount: project.targetWordCount?.toString() ?? '',
    targetEpisodeCount: project.targetEpisodeCount?.toString() ?? '',
    coreHook: project.coreHook ?? '',
    emotionalCore: project.emotionalCore ?? '',
    coreSellingPoint: project.coreSellingPoint ?? '',
    visualStyleDirection: project.visualStyleDirection ?? '',
    synopsis: project.synopsis ?? '',
    styleGuide: project.styleGuide ?? '',
  }
}

function positiveInt(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}

export function ProjectSetupPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [form, setForm] = useState<SetupForm | null>(null)
  const [genrePresets, setGenrePresets] = useState<GenrePreset[]>([])
  const [saving, setSaving] = useState(false)
  const [aiIdea, setAiIdea] = useState('')
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    if (!id) return
    void (async () => {
      const p = await ipc.project.get(id)
      if (!p) {
        toast.error('项目不存在或已删除')
        navigate('/')
        return
      }
      setProject(p)
      setForm(toForm(p))
    })()
  }, [id, navigate])

  useEffect(() => {
    void (async () => setGenrePresets(await ipc.genrePreset.list()))()
  }, [])

  const set = <K extends keyof SetupForm>(key: K, value: SetupForm[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f))

  async function handleSave() {
    if (!id || !form) return
    if (!form.title.trim()) {
      toast.error('请填写作品名称')
      return
    }
    setSaving(true)
    try {
      const updated = await ipc.project.update(id, {
        title: form.title.trim(),
        shortDramaType: form.shortDramaType,
        targetAudience: form.targetAudience.trim() || undefined,
        targetWordCount: positiveInt(form.targetWordCount),
        targetEpisodeCount: positiveInt(form.targetEpisodeCount),
        coreHook: form.coreHook.trim() || undefined,
        emotionalCore: form.emotionalCore.trim() || undefined,
        coreSellingPoint: form.coreSellingPoint.trim() || undefined,
        visualStyleDirection: form.visualStyleDirection.trim() || undefined,
        synopsis: form.synopsis.trim() || undefined,
        styleGuide: form.styleGuide.trim() || undefined,
      })
      if (updated) {
        setProject(updated)
        setForm(toForm(updated))
        toast.success('设定已保存')
        navigate(`/projects/${updated.id}`)
      } else {
        toast.error('保存失败：项目可能已被删除')
      }
    } catch (e) {
      toast.error('保存失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSaving(false)
    }
  }

  // AI 一键生成设定：调 generate_project，把结果回填到表单供用户审查修改，
  // 不直接落库（确认无误后点「保存设定」才写入）。
  async function handleAiGenerate() {
    if (!id || !form) return
    setGenerating(true)
    const toastId = toast.loading('正在生成项目设定…')
    try {
      const res = await ipc.ai.run({
        projectId: id,
        taskType: 'generate_project',
        userInstruction: aiIdea.trim() || undefined,
      })
      if (res.ok && res.result) {
        const data = res.result.data as Partial<GenerateProjectResult>
        setForm((f) => f ? {
          ...f,
          title: data.title?.trim() || f.title,
          coreHook: data.coreHook ?? f.coreHook,
          emotionalCore: data.emotionalCore ?? f.emotionalCore,
          coreSellingPoint: data.coreSellingPoint ?? f.coreSellingPoint,
          visualStyleDirection: data.visualStyleDirection ?? f.visualStyleDirection,
          synopsis: data.synopsis ?? f.synopsis,
          styleGuide: data.styleGuide ?? f.styleGuide,
          targetEpisodeCount: data.targetEpisodeCount?.toString() ?? f.targetEpisodeCount,
        } : f)
        toast.success('已生成设定，请审查后保存', { id: toastId })
      } else {
        toast.error('生成失败：' + (res.error ?? '未知错误'), { id: toastId })
      }
    } catch (e) {
      toast.error('生成异常：' + (e instanceof Error ? e.message : String(e)), { id: toastId })
    } finally {
      setGenerating(false)
    }
  }

  if (!form) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        加载项目设定…
      </div>
    )
  }

  const typeOptions = Array.from(new Set([...SHORT_DRAMA_TYPES, ...genrePresets.map((p) => p.name)]))

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" aria-label="返回工作台" onClick={() => navigate(id ? `/projects/${id}` : '/')}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">补全项目设定</h1>
          <p className="truncate text-sm text-muted-foreground">{project?.title}</p>
        </div>
        <Button className="ml-auto" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          保存设定
        </Button>
      </header>

      <main className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="mx-auto max-w-2xl space-y-5 p-6">
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">AI 生成 / 补全项目设定</span>
              </div>
              <Textarea
                value={aiIdea}
                onChange={(e) => setAiIdea(e.target.value)}
                placeholder="一句话描述你的想法（可选），留空则根据现有类型生成…"
                rows={2}
                className="mb-2 text-sm"
              />
              <Button size="sm" onClick={handleAiGenerate} disabled={generating}>
                {generating ? <Loader2 className="animate-spin" /> : <Sparkles />}
                生成项目设定
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">生成后会填入下方表单，确认无误再点「保存设定」。</p>
            </div>

            <div className="space-y-2">
              <Label>作品名称 *</Label>
              <Input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="例如：天劫将至，我的废灵根觉醒了" />
            </div>

            <div className="space-y-2">
              <Label>短剧类型</Label>
              <Select value={form.shortDramaType} onValueChange={(v) => set('shortDramaType', v)}>
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
              <div className="flex items-center gap-1">
                <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => navigate('/genres')}>
                  <Library className="h-3 w-3" />
                  管理类型库
                </Button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>目标受众</Label>
                <Input value={form.targetAudience} onChange={(e) => set('targetAudience', e.target.value)} placeholder="例如：18-34 岁 AI 漫剧用户" />
              </div>
              <div className="space-y-2">
                <Label>情绪主轴</Label>
                <Input value={form.emotionalCore} onChange={(e) => set('emotionalCore', e.target.value)} placeholder="例如：隐忍→觉醒→逆袭→掌控" />
              </div>
              <div className="space-y-2">
                <Label>目标字数</Label>
                <Input type="number" min="0" value={form.targetWordCount} onChange={(e) => set('targetWordCount', e.target.value)} placeholder="例如：300000" />
              </div>
              <div className="space-y-2">
                <Label>目标集数</Label>
                <Input type="number" min="0" value={form.targetEpisodeCount} onChange={(e) => set('targetEpisodeCount', e.target.value)} placeholder="例如：24" />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>一句话钩子</Label>
                <Input value={form.coreHook} onChange={(e) => set('coreHook', e.target.value)} placeholder="例如：废柴弟子临刑前觉醒上古神脉，逆转必死天劫" />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>核心爽点 / 短剧方向</Label>
                <Input value={form.coreSellingPoint} onChange={(e) => set('coreSellingPoint', e.target.value)} placeholder="例如：东方玄幻奇观、越级反杀、集尾强钩子" />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>视觉风格方向</Label>
                <Input value={form.visualStyleDirection} onChange={(e) => set('visualStyleDirection', e.target.value)} placeholder="例如：高饱和东方玄幻，云海仙山与宏大特效" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>故事简介</Label>
              <Textarea value={form.synopsis} onChange={(e) => set('synopsis', e.target.value)} rows={6} placeholder="整体故事梗概、主线走向" />
            </div>

            <div className="space-y-2">
              <Label>小说风格要求</Label>
              <Textarea value={form.styleGuide} onChange={(e) => set('styleGuide', e.target.value)} rows={6} placeholder="语言风格、叙事节奏、必须遵守或避免的写法" />
            </div>

            <div className="flex items-center gap-3 pb-6">
              <Button size="lg" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="animate-spin" /> : <Save />}
                保存设定
              </Button>
              <Button variant="outline" size="lg" onClick={() => navigate(id ? `/projects/${id}` : '/')} disabled={saving}>
                取消
              </Button>
            </div>
          </div>
        </ScrollArea>
      </main>
    </div>
  )
}
