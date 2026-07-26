import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Sparkles } from 'lucide-react'
import {
  createProjectProductionBrief,
  formatProductionDuration,
  type Project,
  type ProjectProductionProfile,
} from '@sdns/core'
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

const STYLES = ['快节奏爽剧', '细腻情感', '强反转悬疑', '甜宠轻喜', '暗黑复仇']

export function CreateAdaptationPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const directMode = params.get('mode') === 'direct'
  const [projects, setProjects] = useState<Project[]>([])
  const [sourceProjectId, setSourceProjectId] = useState<string>('')
  const [title, setTitle] = useState('')
  const [targetEpisodeCount, setTargetEpisodeCount] = useState<number>(3)
  const [adaptationStyle, setAdaptationStyle] = useState<string>(STYLES[0])
  const [submitting, setSubmitting] = useState(false)
  const [chapterCount, setChapterCount] = useState<number>(0)
  const [seasonNumber, setSeasonNumber] = useState<number>(1)
  const [chapterFrom, setChapterFrom] = useState<number>(1)
  const [chapterTo, setChapterTo] = useState<number>(50)
  const [readiness, setReadiness] = useState<AdaptationReadinessSummary | null>(null)
  const [productionProfile, setProductionProfile] = useState<ProjectProductionProfile>(createProjectProductionBrief().profile)
  const [episodeDuration, setEpisodeDuration] = useState(formatProductionDuration(createProjectProductionBrief().profile.episodeDuration))

  useEffect(() => {
    void (async () => {
      const list = await ipc.project.list()
      setProjects(list)
      const preset = params.get('source')
      setSourceProjectId(preset || list[0]?.id || '')
    })()
  }, [params])

  // 选择项目后读取其创建时保存的生产 Profile。章节范围仅定位来源，不再把“章数=集数”写成规则。
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
      const profile = sourceProject.productionBrief?.profile ?? createProjectProductionBrief().profile
      setProductionProfile(profile)
      setEpisodeDuration(formatProductionDuration(profile.episodeDuration))
      setTargetEpisodeCount(sourceProject.targetEpisodeCount ?? profile.pilotEpisodeCount)
      setChapterCount(chapters.length)
      setReadiness(directMode ? null : buildAdaptationReadiness({ project: sourceProject, chapters, characters, outlines, chapterMemories, qualityReports }))
      if (!directMode && chapters.length > 0) {
        setChapterFrom(1)
        setChapterTo(chapters.length)
      }
    })()
  }, [directMode, sourceProjectId])

  useEffect(() => {
    // 默认标题跟随源项目
    const src = projects.find((p) => p.id === sourceProjectId)
    if (src && !title) setTitle(`${src.title} · ${directMode ? '第一季' : 'AI短剧改编'}`)
  }, [directMode, sourceProjectId, projects, title])

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
        episodeDuration,
        // 多季连载：本季季号 + 改编章节范围
        seasonNumber,
        sourceChapterRange: !directMode && chapterCount > 0 ? { from: chapterFrom, to: chapterTo } : undefined,
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
        <h1 className="text-lg font-semibold">{directMode ? '创建漫剧第一季' : '创建 AI 短剧改编项目'}</h1>
      </header>

      <main className="flex flex-1 items-center justify-center overflow-auto p-6">
        <div className="w-full max-w-xl space-y-5">
          <div className="space-y-2">
            <Label>{directMode ? '项目生产简报' : '源小说项目'}</Label>
            <Select value={sourceProjectId} onValueChange={setSourceProjectId}>
              <SelectTrigger>
                <SelectValue placeholder={directMode ? '选择刚创建的漫剧项目' : '选择一个已有小说项目'} />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{directMode ? '直接漫剧只读取项目的题材与生产 Profile，不要求先有小说章节。' : 'AI 会读取该小说的设定、人物与章节来生成改编分集大纲。'}</p>
          </div>

          {!directMode && readiness && <AdaptationReadinessPanel readiness={readiness} />}

          <div className="space-y-2">
            <Label>改编标题 *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：天劫将至 · AI短剧改编" />
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            当前生产建议：{productionProfile.presentation === 'ai_2d_animation' ? 'AI 2D 漫剧' : productionProfile.presentation === 'ai_3d_animation' ? 'AI 3D 动画' : productionProfile.presentation === 'live_action_style' ? '仿真人 / 实拍感' : productionProfile.presentation === 'motion_comic' ? '动态漫画' : '静态解说'} · {formatProductionDuration(productionProfile.episodeDuration)} · 先做 {productionProfile.pilotEpisodeCount} 集试播（可在项目生产 Profile 中选择 1～3 集）。本季目标集数独立保留，不由章节数强制换算。
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>目标集数</Label>
              <Input type="number" min={1} value={targetEpisodeCount} onChange={(event) => setTargetEpisodeCount(Math.max(1, Number(event.target.value) || 1))} />
              <p className="text-xs text-muted-foreground">
                默认采用项目 Profile 的 {productionProfile.pilotEpisodeCount} 集试播建议；这里填写的是整季目标，不会自动创建整季任务。
              </p>
            </div>
            <div className="space-y-2">
              <Label>单集时长</Label>
              <Input value={episodeDuration} onChange={(event) => setEpisodeDuration(event.target.value)} placeholder="例如：60–120 秒" />
              <p className="text-xs text-muted-foreground">时长是本季的可编辑目标，不会覆盖旧季的既有时长。</p>
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

          {!directMode && <div className="rounded-md border p-4">
            <div className="mb-2 text-sm font-medium">多季连载设置</div>
            <p className="mb-3 text-xs text-muted-foreground">
              章节范围仅说明本季取材范围，不会自动决定集数或单集时长；请按故事密度自行调整。
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
                源小说共 {chapterCount} 章；本季取材第 {chapterFrom}~{chapterTo} 章（{(chapterTo - chapterFrom + 1)} 章），目标 {targetEpisodeCount} 集。
              </p>
            )}
          </div>}

          <Button size="lg" onClick={handleSubmit} disabled={submitting}>
            <Sparkles />
            创建并进入
          </Button>
        </div>
      </main>
    </div>
  )
}
