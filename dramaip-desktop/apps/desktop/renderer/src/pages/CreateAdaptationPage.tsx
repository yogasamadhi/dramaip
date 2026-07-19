import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Sparkles } from 'lucide-react'
import type { Project } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { confirmAction } from '@/components/ConfirmActionDialog'
import { buildAdaptationReadiness, type AdaptationReadinessSummary } from '@/lib/adaptationReadiness'
import { AdaptationReadinessPanel } from '@/components/AdaptationReadinessPanel'
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
  const [seasonNumber, setSeasonNumber] = useState<number>(1)
  const [chapterFrom, setChapterFrom] = useState<number>(1)
  const [chapterTo, setChapterTo] = useState<number>(50)
  const [readiness, setReadiness] = useState<AdaptationReadinessSummary | null>(null)

  useEffect(() => {
    void (async () => {
      const list = await ipc.project.list()
      setProjects(list)
      const preset = params.get('source')
      setSourceProjectId(preset || list[0]?.id || '')
    })()
  }, [params])

  // 选定源项目后：按章数自动推算「第 1 季」的章节范围与目标集数
  // （1 季约 50 章、1 章 → 2 集 → 1 季约 100 集；200~300 章小说 → 4~6 季）
  useEffect(() => {
    if (!sourceProjectId) {
      setReadiness(null)
      return
    }
    void (async () => {
      const [sourceProject, chapters, characters, outlines, chapterMemories, qualityReports] = await Promise.all([
        ipc.project.get(sourceProjectId),
        ipc.chapter.list(sourceProjectId),
        ipc.character.list(sourceProjectId),
        ipc.outline.list(sourceProjectId),
        ipc.chapterMemory.list(sourceProjectId),
        ipc.creative.listQualityGates(sourceProjectId),
      ])
      if (!sourceProject) return
      setChapterCount(chapters.length)
      setReadiness(buildAdaptationReadiness({ project: sourceProject, chapters, characters, outlines, chapterMemories, qualityReports }))
      const perSeason = 50 // 每季约 50 章
      const from = 1
      const to = Math.min(perSeason, chapters.length)
      setChapterFrom(from)
      setChapterTo(to)
      // 本季章数 × 2 ≈ 本季目标集数
      const seasonChapters = Math.max(0, to - from + 1)
      const recommended = seasonChapters * 2
      if (recommended > 0) setTargetEpisodeCount(recommended)
    })()
  }, [sourceProjectId])

  // 改章节范围时同步重算目标集数（章数 × 2）
  useEffect(() => {
    const seasonChapters = Math.max(0, chapterTo - chapterFrom + 1)
    const recommended = seasonChapters * 2
    if (recommended > 0) setTargetEpisodeCount(recommended)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterFrom, chapterTo])

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
    const unresolvedCount = readiness ? readiness.warningCount + readiness.riskCount : 0
    if (unresolvedCount > 0) {
      const shouldContinue = await confirmAction({
        title: '带风险创建改编项目？',
        description: `小说就绪检查仍有 ${readiness?.riskCount ?? 0} 个风险、${readiness?.warningCount ?? 0} 个提醒。项目可以继续创建，但这些问题会在后续质量闸门中保留。`,
        confirmLabel: '仍要创建',
      })
      if (!shouldContinue) return
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
        // 多季连载：本季季号 + 改编章节范围
        seasonNumber,
        sourceChapterRange: { from: chapterFrom, to: chapterTo },
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

          {readiness && <AdaptationReadinessPanel readiness={readiness} />}

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
                      {c} 集
                      {c === (chapterTo - chapterFrom + 1) * 2 && chapterCount > 0 ? '（推荐：本季章数×2）' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                默认按「1 章 → 2 集（每集 2 分钟）」估算；情节密度不均时可自行调整。
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

          {/* 多季连载：季号 + 本季改编章节范围 */}
          <div className="rounded-md border p-4">
            <div className="mb-2 text-sm font-medium">多季连载设置</div>
            <p className="mb-3 text-xs text-muted-foreground">
              200~300 章的长篇小说切成多季短剧，每季约 50 章 ≈ 100 集。本季只改编下方指定章节范围。
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label className="text-xs">第几季</Label>
                <Input
                  type="number"
                  min={1}
                  value={seasonNumber}
                  onChange={(e) => setSeasonNumber(Math.max(1, Number(e.target.value)))}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">改编起始章</Label>
                <Input
                  type="number"
                  min={1}
                  max={chapterCount || undefined}
                  value={chapterFrom}
                  onChange={(e) => setChapterFrom(Math.max(1, Number(e.target.value)))}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">改编结束章</Label>
                <Input
                  type="number"
                  min={chapterFrom}
                  max={chapterCount || undefined}
                  value={chapterTo}
                  onChange={(e) => setChapterTo(Math.max(chapterFrom, Number(e.target.value)))}
                />
              </div>
            </div>
            {chapterCount > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                源小说共 {chapterCount} 章；本季改编第 {chapterFrom}~{chapterTo} 章（{(chapterTo - chapterFrom + 1)} 章），
                预计 {(chapterTo - chapterFrom + 1) * 2} 集。
              </p>
            )}
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
