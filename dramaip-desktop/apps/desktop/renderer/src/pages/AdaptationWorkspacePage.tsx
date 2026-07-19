import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Download, FileJson, Loader2, Pencil, Sparkles, Wand2 } from 'lucide-react'
import type { AdaptationProject, Episode, EpisodeAnalysis } from '@sdns/core'
import { TASK_TYPE_LABELS } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TrendChart, type TrendSeries } from '@/components/charts/TrendChart'
import { GeneratePreviewDialog, type PreviewTaskType } from '@/components/GeneratePreviewDialog'
import { cn } from '@/lib/utils'

type NavKey = 'overview' | 'episodes' | 'first10'
const NAV: { key: NavKey; label: string }[] = [
  { key: 'overview', label: '改编概览' },
  { key: 'episodes', label: '分集大纲' },
  { key: 'first10', label: '前 10 集分析' },
]

export function AdaptationWorkspacePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [adaptation, setAdaptation] = useState<AdaptationProject | null>(null)
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [analysis, setAnalysis] = useState<EpisodeAnalysis | undefined>(undefined)
  const [version, setVersion] = useState(0)
  const requestedNav = searchParams.get('section')
  const nav: NavKey = requestedNav === 'episodes' || requestedNav === 'first10' || requestedNav === 'overview'
    ? requestedNav
    : 'overview'

  function openAdaptationSection(nextNav: NavKey) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('section', nextNav)
      return next
    })
  }

  // 预览流
  const [preview, setPreview] = useState<{ open: boolean; taskType: PreviewTaskType; data: unknown }>({
    open: false,
    taskType: 'convert_novel_to_episodes',
    data: null,
  })
  const [generating, setGenerating] = useState<PreviewTaskType | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // 编辑
  const [editing, setEditing] = useState<Episode | null>(null)

  const reload = useCallback(async () => {
    if (!id) return
    const [a, eps, an] = await Promise.all([
      ipc.adaptationProject.get(id),
      ipc.episode.list(id),
      ipc.episodeAnalysis.get(id),
    ])
    setAdaptation(a ?? null)
    setEpisodes(eps)
    setAnalysis(an)
  }, [id])

  useEffect(() => {
    void reload()
  }, [reload, version])

  // ===== AI 调用 =====
  async function runStrategy() {
    if (!adaptation) return
    setBusy('strategy')
    const tid = toast.loading('正在生成改编策略…')
    try {
      const res = await ipc.ai.run({
        projectId: adaptation.sourceProjectId,
        adaptationProjectId: adaptation.id,
        taskType: 'create_adaptation_strategy',
        userInstruction: `目标集数 ${adaptation.targetEpisodeCount}，改编风格：${adaptation.adaptationStyle}`,
      })
      if (res.ok && res.result) {
        toast.success('改编策略已生成', { id: tid })
        // 把策略文本保存到 adaptation.strategy
        const r = res.result.data as Record<string, string>
        const strategyText = Object.entries(r)
          .map(([k, v]) => `- ${k}：${v}`)
          .join('\n')
        const updated = await ipc.adaptationProject.update(adaptation.id, { strategy: strategyText })
        setAdaptation(updated ?? adaptation)
      } else {
        toast.error('生成失败：' + (res.error ?? '未知错误'), { id: tid })
      }
    } finally {
      setBusy(null)
    }
  }

  async function runConvert() {
    if (!adaptation) return
    setGenerating('convert_novel_to_episodes')
    const tid = toast.loading('正在生成分集大纲…')
    try {
      const res = await ipc.ai.run({
        projectId: adaptation.sourceProjectId,
        adaptationProjectId: adaptation.id,
        taskType: 'convert_novel_to_episodes',
        userInstruction: `生成 ${adaptation.targetEpisodeCount} 集分集大纲，改编风格：${adaptation.adaptationStyle}`,
      })
      if (res.ok && res.result) {
        toast.success('分集大纲已生成，请确认', { id: tid })
        setPreview({ open: true, taskType: 'convert_novel_to_episodes', data: res.result.data })
      } else {
        toast.error('生成失败：' + (res.error ?? '未知错误'), { id: tid })
      }
    } finally {
      setGenerating(null)
    }
  }

  async function handleAdopt() {
    if (!adaptation) return
    const res = await ipc.ai.applyResult({
      projectId: adaptation.sourceProjectId ?? adaptation.id,
      taskType: preview.taskType,
      data: preview.data,
      adaptationProjectId: adaptation.id,
    })
    if (res.ok) {
      toast.success('已保存分集大纲')
      setPreview((p) => ({ ...p, open: false }))
      setVersion((v) => v + 1)
    } else {
      toast.error('保存失败：' + (res.error ?? '未知错误'))
    }
  }

  // 单集 AI 操作（自动 upsert）
  async function runEpisodeTask(episode: Episode, taskType: 'rewrite_episode_outline' | 'enhance_episode_hook' | 'enhance_episode_visuals', instruction?: string) {
    if (!adaptation) return
    setBusy(episode.id + taskType)
    const label = TASK_TYPE_LABELS[taskType]
    const tid = toast.loading(`正在${label}…`)
    try {
      const res = await ipc.ai.run({
        projectId: adaptation.sourceProjectId,
        adaptationProjectId: adaptation.id,
        episodeId: episode.id,
        taskType,
        userInstruction: instruction,
      })
      if (res.ok) {
        toast.success(`${label}完成`, { id: tid })
        setVersion((v) => v + 1)
      } else {
        toast.error(`${label}失败：` + (res.error ?? '未知错误'), { id: tid })
      }
    } finally {
      setBusy(null)
    }
  }

  async function runFirst10() {
    if (!adaptation) return
    setBusy('first10')
    const tid = toast.loading('正在分析前 10 集…')
    try {
      const res = await ipc.ai.run({
        projectId: adaptation.sourceProjectId,
        adaptationProjectId: adaptation.id,
        taskType: 'analyze_first_10_episodes',
      })
      if (res.ok) {
        toast.success('前 10 集分析完成', { id: tid })
        setVersion((v) => v + 1)
      } else {
        toast.error('分析失败：' + (res.error ?? '未知错误'), { id: tid })
      }
    } finally {
      setBusy(null)
    }
  }

  async function runCreativeAdaptationTask(taskType: 'run_quality_gate' | 'analyze_trope_freshness') {
    if (!adaptation) return
    setBusy(taskType)
    const tid = toast.loading(taskType === 'run_quality_gate' ? '正在运行改编前质量闸门…' : '正在分析分集新鲜度…')
    try {
      const res = await ipc.ai.run({
        projectId: adaptation.sourceProjectId,
        adaptationProjectId: adaptation.id,
        taskType,
      })
      if (res.ok) {
        toast.success('创意诊断完成', { id: tid })
        setVersion((v) => v + 1)
      } else {
        toast.error('诊断失败：' + (res.error ?? '未知错误'), { id: tid })
      }
    } finally {
      setBusy(null)
    }
  }

  if (!adaptation) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 animate-spin" /> 加载中…
      </div>
    )
  }

  const analysisSeries: TrendSeries[] = analysis
    ? [
        { key: 'hook', label: '钩子强度', color: '#ef4444', data: analysis.hookStrengthTrend },
        { key: 'retention', label: '留存', color: '#f97316', data: analysis.retentionScoreTrend },
        { key: 'pace', label: '节奏', color: '#eab308', data: analysis.paceScoreTrend },
        { key: 'reversal', label: '反转密度', color: '#22c55e', data: analysis.reversalDensityTrend },
        { key: 'visual', label: '视觉吸引', color: '#3b82f6', data: analysis.visualAppealTrend },
      ]
    : []

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0">
          <nav aria-label="面包屑" className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>项目</span><span aria-hidden>›</span><span>改编</span><span aria-hidden>›</span>
            <span>{NAV.find((item) => item.key === nav)?.label}</span>
          </nav>
          <h1 className="truncate text-base font-semibold">{adaptation.title}</h1>
        </div>
        <Badge variant="secondary">{adaptation.targetEpisodeCount} 集</Badge>
        <Badge variant="outline">{adaptation.adaptationStyle}</Badge>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => ipc.export.dramaProposalMarkdown(adaptation.id, { episodeLimit: 10 })}>
            <Download /> 提案包
          </Button>
          <Button size="sm" variant="outline" onClick={() => ipc.export.dramaProposalJson(adaptation.id, { episodeLimit: 10 })}>
            <FileJson /> 提案 JSON
          </Button>
          <Button size="sm" variant="outline" onClick={() => ipc.export.adaptationMarkdown(adaptation.id)}>
            <Download /> 大纲 MD
          </Button>
          <Button size="sm" variant="outline" onClick={() => ipc.export.adaptationJson(adaptation.id)}>
            <FileJson /> 大纲 JSON
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* 左侧 nav */}
        <aside className="w-40 shrink-0 border-r p-2">
          {NAV.map((item) => (
            <button
              key={item.key}
              onClick={() => openAdaptationSection(item.key)}
              className={cn(
                'mb-0.5 w-full rounded px-3 py-1.5 text-left text-sm',
                nav === item.key ? 'bg-accent font-medium' : 'hover:bg-accent/60',
              )}
            >
              {item.label}
            </button>
          ))}
        </aside>

        {/* 中间内容 */}
        <section className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-6">
              {nav === 'overview' && (
                <div className="max-w-2xl space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Meta label="目标集数" value={`${adaptation.targetEpisodeCount} 集`} />
                    <Meta label="每集时长" value={adaptation.episodeDuration ?? '—'} />
                    <Meta
                      label="季 / 改编范围"
                      value={
                        adaptation.sourceChapterRange
                          ? `第 ${adaptation.seasonNumber ?? 1} 季 · 第 ${adaptation.sourceChapterRange.from}~${adaptation.sourceChapterRange.to} 章`
                          : `第 ${adaptation.seasonNumber ?? 1} 季`
                      }
                    />
                    <Meta label="改编风格" value={adaptation.adaptationStyle} />
                    <Meta label="视觉风格方向" value={adaptation.visualStyleDirection ?? '—'} />
                    <Meta label="目标受众" value={adaptation.audience ?? '—'} />
                    <Meta label="源小说项目" value={adaptation.sourceProjectId ?? '（无）'} />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={runStrategy} disabled={busy === 'strategy'}>
                      {busy === 'strategy' ? <Loader2 className="animate-spin" /> : <Sparkles />}
                      生成改编策略
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => runCreativeAdaptationTask('run_quality_gate')} disabled={busy !== null}>
                      <Sparkles />
                      改编前闸门
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => runCreativeAdaptationTask('analyze_trope_freshness')} disabled={busy !== null}>
                      <Sparkles />
                      新鲜度诊断
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openAdaptationSection('episodes')}>
                      生成分集大纲 →
                    </Button>
                  </div>
                  {adaptation.strategy && (
                    <div>
                      <div className="mb-1 text-sm font-medium">改编策略</div>
                      <pre className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs">{adaptation.strategy}</pre>
                    </div>
                  )}
                </div>
              )}

              {nav === 'episodes' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">分集大纲</span>
                    <Badge variant="secondary">{episodes.length} 集</Badge>
                    <div className="ml-auto flex gap-2">
                      {episodes.length > 0 && (
                        <Button size="sm" variant="secondary" onClick={() => navigate(`/adaptations/${adaptation.id}/scripts`)}>
                          生成 AI 短剧剧本 →
                        </Button>
                      )}
                      <Button size="sm" onClick={runConvert} disabled={generating !== null}>
                        {generating === 'convert_novel_to_episodes' ? <Loader2 className="animate-spin" /> : <Wand2 />}
                        AI 生成分集大纲
                      </Button>
                    </div>
                  </div>
                  {episodes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      还没有分集大纲。点击「AI 生成分集大纲」，AI 会读取源小说生成完整的分集大纲。
                    </p>
                  ) : (
                    episodes.map((ep) => (
                      <div key={ep.id} className="rounded-md border p-3">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">第 {ep.episodeNumber} 集</Badge>
                          <span className="font-medium">{ep.title}</span>
                          <div className="ml-auto flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              title="AI 重写"
                              onClick={() => runEpisodeTask(ep, 'rewrite_episode_outline')}
                              disabled={busy !== null}
                            >
                              重写
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="增强钩子"
                              onClick={() => runEpisodeTask(ep, 'enhance_episode_hook')}
                              disabled={busy !== null}
                            >
                              增强钩子
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="增强关键画面"
                              onClick={() => runEpisodeTask(ep, 'enhance_episode_visuals')}
                              disabled={busy !== null}
                            >
                              增强画面
                            </Button>
                            <Button size="icon" variant="ghost" title="编辑" onClick={() => setEditing(ep)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{ep.summary}</p>
                        <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                          <span>钩子：{ep.hook}</span>
                          <span>冲突：{ep.mainConflict}</span>
                          {ep.reversal && <span>反转：{ep.reversal}</span>}
                          {ep.emotionalBeat && <span>情绪：{ep.emotionalBeat}</span>}
                          <span className="col-span-2">悬念：{ep.cliffhanger}</span>
                          {ep.keyVisuals.length > 0 && <span className="col-span-2">关键画面：{ep.keyVisuals.join('；')}</span>}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {nav === 'first10' && (
                <div className="max-w-2xl space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">前 10 集分析</span>
                    <div className="ml-auto">
                      <Button size="sm" onClick={runFirst10} disabled={busy === 'first10'}>
                        {busy === 'first10' ? <Loader2 className="animate-spin" /> : <Sparkles />}
                        分析前 10 集
                      </Button>
                    </div>
                  </div>
                  {analysis ? (
                    <>
                      <TrendChart series={analysisSeries} height={220} />
                      <div>
                        <div className="mb-1 text-sm font-medium">小结</div>
                        <p className="text-sm text-muted-foreground">{analysis.summary}</p>
                      </div>
                      {analysis.suggestions && (
                        <div>
                          <div className="mb-1 text-sm font-medium">建议</div>
                          <p className="text-sm text-muted-foreground">{analysis.suggestions}</p>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      还没有分析。先生成分集大纲后，点击「分析前 10 集」，AI 会评估前 10 集的钩子强度、留存、节奏、反转密度与视觉吸引力。
                    </p>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        </section>
      </div>

      {/* 预览弹窗（convert_novel_to_episodes） */}
      <GeneratePreviewDialog
        open={preview.open}
        taskType={preview.taskType}
        data={preview.data}
        onCancel={() => setPreview((p) => ({ ...p, open: false }))}
        onAdopt={handleAdopt}
      />

      {/* 单集编辑弹窗 */}
      {editing && (
        <EpisodeEditDialog
          episode={editing}
          onClose={() => setEditing(null)}
          onSaved={async (patch) => {
            const updated = await ipc.episode.update(editing.id, patch)
            if (updated) {
              setEpisodes((p) => p.map((e) => (e.id === updated.id ? updated : e)))
            }
            setEditing(null)
            toast.success('已保存')
          }}
        />
      )}
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  )
}

function EpisodeEditDialog({
  episode,
  onClose,
  onSaved,
}: {
  episode: Episode
  onClose: () => void
  onSaved: (patch: Partial<Episode>) => void | Promise<void>
}) {
  const [form, setForm] = useState<Partial<Episode>>({ ...episode })

  const fields: [keyof Episode, string, boolean][] = [
    ['title', '标题', false],
    ['summary', '一句话梗概', false],
    ['hook', '开场钩子', false],
    ['mainConflict', '核心冲突', false],
    ['reversal', '关键反转', true],
    ['emotionalBeat', '情绪爆点', true],
    ['cliffhanger', '结尾悬念', false],
    ['aiVideoNote', 'AI视频备注', true],
  ]

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-auto">
        <DialogHeader>
          <DialogTitle>编辑第 {episode.episodeNumber} 集</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {fields.map(([key, label]) => (
            <div key={key} className="space-y-1">
              <Label>
                {label}
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <Textarea value={(form[key] as string) ?? ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} rows={2} />
              </Label>
            </div>
          ))}
          <div className="space-y-1">
            <Label>关键画面（每行一条）</Label>
            <Textarea
              value={(form.keyVisuals ?? []).join('\n')}
              onChange={(e) => setForm({ ...form, keyVisuals: e.target.value.split('\n').filter(Boolean) })}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={() => onSaved(form)}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
