import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Sparkles } from 'lucide-react'
import type { Project } from '@sdns/core'
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

// 1 章 → 2 集：默认集数 ≈ 章数 × 2。这里提供常见档位 + 用户可选手动调整。
const EPISODE_COUNTS = [20, 24, 40, 50, 60, 80, 100, 120]
const STYLES = ['快节奏爽剧', '细腻情感', '强反转悬疑', '甜宠轻喜', '暗黑复仇']

export function CreateAdaptationPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [projects, setProjects] = useState<Project[]>([])
  const [sourceProjectId, setSourceProjectId] = useState<string>('')
  const [title, setTitle] = useState('')
  const [targetEpisodeCount, setTargetEpisodeCount] = useState<number>(60)
  const [adaptationStyle, setAdaptationStyle] = useState<string>(STYLES[0])
  const [submitting, setSubmitting] = useState(false)
  const [chapterCount, setChapterCount] = useState<number>(0)

  useEffect(() => {
    void (async () => {
      const list = await ipc.project.list()
      setProjects(list)
      const preset = params.get('source')
      setSourceProjectId(preset || list[0]?.id || '')
    })()
  }, [params])

  // 选定源项目后：默认集数 = 该项目章数 × 2（1 章 → 2 集）
  useEffect(() => {
    if (!sourceProjectId) return
    void (async () => {
      const chapters = await ipc.chapter.list(sourceProjectId)
      setChapterCount(chapters.length)
      // 1 章 → 2 集默认假设；章数为 0 时保留 60 兜底
      const recommended = chapters.length * 2
      if (recommended > 0) setTargetEpisodeCount(recommended)
    })()
  }, [sourceProjectId])

  useEffect(() => {
    // 默认标题跟随源项目
    const src = projects.find((p) => p.id === sourceProjectId)
    if (src && !title) setTitle(`${src.title} · AI短剧改编`)
  }, [sourceProjectId, projects, title])

  // 目标集数选项 = 固定档位 ∪ 推荐值(章数×2)，保证推荐值可选
  const episodeOptions = useMemo(() => {
    const recommended = chapterCount * 2
    const merged = Array.from(new Set([...EPISODE_COUNTS, recommended].filter((n) => n > 0))).sort(
      (a, b) => a - b,
    )
    return merged
  }, [chapterCount])

  async function handleSubmit() {
    if (!title.trim()) {
      toast.error('请填写改编标题')
      return
    }
    setSubmitting(true)
    try {
      const created = await ipc.adaptationProject.create({
        sourceProjectId: sourceProjectId || undefined,
        title: title.trim(),
        targetEpisodeCount,
        adaptationStyle,
        // 2 分钟一集：短剧标准体量
        episodeDuration: '2分钟',
      })
      toast.success('改编项目已创建')
      navigate(`/adaptations/${created.id}`)
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
        <h1 className="text-lg font-semibold">创建 AI 短剧改编项目</h1>
      </header>

      <main className="flex flex-1 items-center justify-center overflow-auto p-6">
        <div className="w-full max-w-xl space-y-5">
          <div className="space-y-2">
            <Label>源小说项目</Label>
            <Select value={sourceProjectId} onValueChange={setSourceProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="选择一个已有小说项目" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">AI 会读取该小说的设定、人物与章节来生成改编分集大纲。</p>
          </div>

          <div className="space-y-2">
            <Label>改编标题 *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：重生千金 · AI短剧改编" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>目标集数</Label>
              <Select value={String(targetEpisodeCount)} onValueChange={(v) => setTargetEpisodeCount(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {episodeOptions.map((c) => (
                    <SelectItem key={c} value={String(c)}>
                      {c} 集{c === chapterCount * 2 && chapterCount > 0 ? '（推荐：章数×2）' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                默认按「1 章小说 → 2 集短剧（每集 2 分钟）」估算；情节密度不均时可自行调整。
              </p>
            </div>
            <div className="space-y-2">
              <Label>改编风格</Label>
              <Select value={adaptationStyle} onValueChange={setAdaptationStyle}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STYLES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button size="lg" onClick={handleSubmit} disabled={submitting}>
            <Sparkles />
            创建并进入
          </Button>
        </div>
      </main>
    </div>
  )
}
