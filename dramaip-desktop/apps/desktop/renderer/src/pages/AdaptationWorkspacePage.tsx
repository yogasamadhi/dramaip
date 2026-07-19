import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { CheckCircle2, CircleAlert, LayoutGrid, List, Loader2, Pencil, Sparkles, Wand2, Waypoints } from 'lucide-react'
import type { AdaptationProject, Episode, EpisodeAnalysis, Script } from '@sdns/core'
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
import { ProductionWorkspaceShell } from '@/components/shell/ProductionWorkspaceShell'
import { cn } from '@/lib/utils'

type NavKey = 'overview' | 'episodes' | 'first10'
type EpisodePlannerView = 'cards' | 'table' | 'pace'
type EpisodePlannerFilter = 'all' | 'incomplete' | 'hook' | 'reversal' | 'cliffhanger' | 'visual'
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
  const [scripts, setScripts] = useState<Script[]>([])
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
    const [a, eps, an, scs] = await Promise.all([
      ipc.adaptationProject.get(id),
      ipc.episode.list(id),
      ipc.episodeAnalysis.get(id),
      ipc.script.list(id),
    ])
    setAdaptation(a ?? null)
    if (a?.sourceProjectId) await ipc.project.setActiveAdaptation(a.sourceProjectId, a.id)
    setEpisodes(eps)
    setAnalysis(an)
    setScripts(scs)
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

  async function handleAdopt(data: unknown, options: { partialAdopt: boolean }) {
    if (!adaptation) return
    const res = await ipc.ai.applyResult({
      projectId: adaptation.sourceProjectId ?? adaptation.id,
      taskType: preview.taskType,
      data,
      partialAdopt: options.partialAdopt,
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

  async function runSelectedScripts(episodeIds: string[]) {
    if (!adaptation) return
    const targetIds = episodeIds.filter((episodeId) => !scripts.some((script) => script.episodeId === episodeId))
    if (targetIds.length === 0) {
      toast.message('已选分集都已有剧本，可直接进入剧本审阅')
      return
    }
    setBusy('selected-scripts')
    const tid = toast.loading(`正在生成已选的 ${targetIds.length} 集剧本…`)
    try {
      const res = await ipc.batchTask.run({
        kind: 'scripts',
        projectId: adaptation.sourceProjectId,
        adaptationProjectId: adaptation.id,
        episodeIds: targetIds,
      })
      if (res.ok) {
        toast.success(`已提交并完成 ${targetIds.length} 集剧本生成`, { id: tid })
      } else {
        toast.error(`批量生成存在失败：${res.error ?? '请在任务中心查看详情'}`, { id: tid })
      }
      setVersion((value) => value + 1)
    } catch (error) {
      toast.error('批量生成出错：' + (error instanceof Error ? error.message : String(error)), { id: tid })
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
    <ProductionWorkspaceShell
      adaptation={adaptation}
      stage={nav === 'overview' ? 'overview' : 'episodes'}
      counts={{ targetEpisodes: adaptation.targetEpisodeCount, episodes: episodes.length, scripts: scripts.length }}
      actions={nav === 'episodes' ? (
        <Button size="sm" onClick={runConvert} disabled={generating !== null}>
          {generating === 'convert_novel_to_episodes' ? <Loader2 className="animate-spin" /> : <Wand2 />}
          AI 生成分集大纲
        </Button>
      ) : undefined}
      exports={[
        { label: '前 10 集提案包（Markdown）', onSelect: () => ipc.export.dramaProposalMarkdown(adaptation.id, { episodeLimit: 10 }) },
        { label: '前 10 集提案包（JSON）', onSelect: () => ipc.export.dramaProposalJson(adaptation.id, { episodeLimit: 10 }) },
        { label: '分集大纲（Markdown）', onSelect: () => ipc.export.adaptationMarkdown(adaptation.id) },
        { label: '分集大纲（JSON）', onSelect: () => ipc.export.adaptationJson(adaptation.id) },
      ]}
    >
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 左侧 nav */}
        <aside className="w-40 shrink-0 border-r bg-muted/20 p-2">
          <div className="mb-2 px-2 text-[11px] font-medium text-muted-foreground">改编工作台</div>
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
        <section className="flex min-w-0 flex-1 overflow-hidden">
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
                  <div className="flex flex-wrap gap-2">
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
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">分集大纲</span>
                    <Badge variant="secondary">{episodes.length} / {adaptation.targetEpisodeCount} 集</Badge>
                    <div className="ml-auto flex gap-2">
                      {episodes.length > 0 && (
                        <Button size="sm" variant="secondary" onClick={() => navigate(`/adaptations/${adaptation.id}/scripts`)}>
                          进入剧本工作台 →
                        </Button>
                      )}
                    </div>
                  </div>
                  {episodes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      还没有分集大纲。点击「AI 生成分集大纲」，AI 会读取源小说生成完整的分集大纲。
                    </p>
                  ) : <EpisodePlanningBoard
                    episodes={episodes}
                    scripts={scripts}
                    busy={busy}
                    onEdit={setEditing}
                    onTask={runEpisodeTask}
                    onOpenScript={(episodeId) => navigate(`/adaptations/${adaptation.id}/scripts?episode=${episodeId}`)}
                    onGenerateSelectedScripts={runSelectedScripts}
                  />}
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
    </ProductionWorkspaceShell>
  )
}

function EpisodePlanningBoard({
  episodes,
  scripts,
  busy,
  onEdit,
  onTask,
  onOpenScript,
  onGenerateSelectedScripts,
}: {
  episodes: Episode[]
  scripts: Script[]
  busy: string | null
  onEdit: (episode: Episode) => void
  onTask: (episode: Episode, taskType: 'rewrite_episode_outline' | 'enhance_episode_hook' | 'enhance_episode_visuals') => void
  onOpenScript: (episodeId: string) => void
  onGenerateSelectedScripts: (episodeIds: string[]) => void
}) {
  const [view, setView] = useState<EpisodePlannerView>('cards')
  const [filter, setFilter] = useState<EpisodePlannerFilter>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const scriptEpisodeIds = useMemo(() => new Set(scripts.map((script) => script.episodeId)), [scripts])
  const visibleEpisodes = useMemo(
    () => episodes.filter((episode) => matchesEpisodeFilter(episode, filter)),
    [episodes, filter],
  )
  const incompleteCount = episodes.filter((episode) => episodePlanningGaps(episode).length > 0).length
  const selectedVisible = visibleEpisodes.filter((episode) => selectedIds.has(episode.id))

  useEffect(() => {
    const validIds = new Set(episodes.map((episode) => episode.id))
    setSelectedIds((current) => {
      const next = new Set([...current].filter((episodeId) => validIds.has(episodeId)))
      return next.size === current.size ? current : next
    })
  }, [episodes])

  function toggleSelected(episodeId: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(episodeId)) next.delete(episodeId)
      else next.add(episodeId)
      return next
    })
  }

  function toggleVisible() {
    setSelectedIds((current) => {
      const next = new Set(current)
      const everyVisibleSelected = visibleEpisodes.every((episode) => next.has(episode.id))
      for (const episode of visibleEpisodes) {
        if (everyVisibleSelected) next.delete(episode.id)
        else next.add(episode.id)
      }
      return next
    })
  }

  return (
    <div className="space-y-3">
      <div className="studio-surface flex flex-wrap items-center gap-2 rounded-lg p-2">
        <div className="flex rounded-md bg-muted p-0.5" role="group" aria-label="分集视图">
          <PlannerViewButton active={view === 'cards'} label="卡片" icon={<LayoutGrid />} onClick={() => setView('cards')} />
          <PlannerViewButton active={view === 'table'} label="表格" icon={<List />} onClick={() => setView('table')} />
          <PlannerViewButton active={view === 'pace'} label="节奏线" icon={<Waypoints />} onClick={() => setView('pace')} />
        </div>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          显示
          <select className="h-8 rounded-md border bg-background px-2 text-xs text-foreground" value={filter} onChange={(event) => setFilter(event.target.value as EpisodePlannerFilter)}>
            <option value="all">全部分集</option>
            <option value="incomplete">有缺失（{incompleteCount}）</option>
            <option value="hook">缺开场钩子</option>
            <option value="reversal">缺关键反转</option>
            <option value="cliffhanger">缺结尾悬念</option>
            <option value="visual">缺关键画面</option>
          </select>
        </label>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <span>{visibleEpisodes.length} 集可见 · 已选 {selectedIds.size} 集</span>
          <Button size="sm" variant="ghost" onClick={toggleVisible}>{selectedVisible.length === visibleEpisodes.length ? '取消本页选择' : '选择本页'}</Button>
          {selectedIds.size > 0 && (
            <Button size="sm" onClick={() => onGenerateSelectedScripts([...selectedIds])} disabled={busy !== null}>
              {busy === 'selected-scripts' ? <Loader2 className="animate-spin" /> : <Sparkles />}
              为已选集生成剧本
            </Button>
          )}
        </div>
      </div>

      {view === 'cards' && (
        <div className="grid gap-3 xl:grid-cols-2">
          {visibleEpisodes.map((episode) => <EpisodePlanningCard
            key={episode.id}
            episode={episode}
            selected={selectedIds.has(episode.id)}
            hasScript={scriptEpisodeIds.has(episode.id)}
            disabled={busy !== null}
            onToggle={() => toggleSelected(episode.id)}
            onEdit={() => onEdit(episode)}
            onTask={onTask}
            onOpenScript={() => onOpenScript(episode.id)}
          />)}
        </div>
      )}

      {view === 'table' && <EpisodePlanningTable
        episodes={visibleEpisodes}
        selectedIds={selectedIds}
        scriptEpisodeIds={scriptEpisodeIds}
        onToggle={toggleSelected}
        onEdit={onEdit}
        onOpenScript={onOpenScript}
      />}

      {view === 'pace' && <EpisodePaceLine episodes={visibleEpisodes} onOpenScript={onOpenScript} />}
    </div>
  )
}

function PlannerViewButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: React.ReactNode; onClick: () => void }) {
  return <Button size="sm" variant={active ? 'secondary' : 'ghost'} aria-pressed={active} onClick={onClick}>{icon}{label}</Button>
}

function EpisodePlanningCard({
  episode,
  selected,
  hasScript,
  disabled,
  onToggle,
  onEdit,
  onTask,
  onOpenScript,
}: {
  episode: Episode
  selected: boolean
  hasScript: boolean
  disabled: boolean
  onToggle: () => void
  onEdit: () => void
  onTask: (episode: Episode, taskType: 'rewrite_episode_outline' | 'enhance_episode_hook' | 'enhance_episode_visuals') => void
  onOpenScript: () => void
}) {
  const gaps = episodePlanningGaps(episode)
  return (
    <article className={cn('studio-card-interactive rounded-lg border bg-card p-3', selected && 'border-primary ring-1 ring-primary/30')}>
      <div className="flex items-start gap-2">
        <input className="mt-1 h-4 w-4 accent-primary" type="checkbox" checked={selected} onChange={onToggle} aria-label={`选择第 ${episode.episodeNumber} 集`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">第 {episode.episodeNumber} 集</Badge>
            <span className="font-medium">{episode.title}</span>
            {hasScript && <Badge variant="secondary"><CheckCircle2 className="h-3 w-3" /> 已有剧本</Badge>}
            {gaps.length > 0 && <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300"><CircleAlert className="h-3 w-3" /> 缺 {gaps.join('、')}</Badge>}
          </div>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{episode.summary || '尚未填写一句话梗概'}</p>
        </div>
        <Button size="icon" variant="ghost" title={`编辑第 ${episode.episodeNumber} 集`} onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div><dt className="inline font-medium text-foreground">钩子：</dt><dd className="inline">{episode.hook || '待补'}</dd></div>
        <div><dt className="inline font-medium text-foreground">冲突：</dt><dd className="inline">{episode.mainConflict || '待补'}</dd></div>
        <div><dt className="inline font-medium text-foreground">反转：</dt><dd className="inline">{episode.reversal || '待补'}</dd></div>
        <div><dt className="inline font-medium text-foreground">情绪：</dt><dd className="inline">{episode.emotionalBeat || '待补'}</dd></div>
        <div className="col-span-2"><dt className="inline font-medium text-foreground">悬念：</dt><dd className="inline">{episode.cliffhanger || '待补'}</dd></div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" onClick={() => onTask(episode, 'rewrite_episode_outline')} disabled={disabled}>重写</Button>
        <Button size="sm" variant="ghost" onClick={() => onTask(episode, 'enhance_episode_hook')} disabled={disabled}>增强钩子</Button>
        <Button size="sm" variant="ghost" onClick={() => onTask(episode, 'enhance_episode_visuals')} disabled={disabled}>增强画面</Button>
        <Button size="sm" variant={hasScript ? 'ghost' : 'outline'} className="ml-auto" onClick={onOpenScript}>{hasScript ? '审阅剧本' : '进入剧本'}</Button>
      </div>
    </article>
  )
}

function EpisodePlanningTable({ episodes, selectedIds, scriptEpisodeIds, onToggle, onEdit, onOpenScript }: {
  episodes: Episode[]
  selectedIds: Set<string>
  scriptEpisodeIds: Set<string>
  onToggle: (id: string) => void
  onEdit: (episode: Episode) => void
  onOpenScript: (id: string) => void
}) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[760px] text-left text-xs">
        <thead className="bg-muted/60 text-muted-foreground"><tr><th className="w-10 p-3">选</th><th className="p-3">分集</th><th className="p-3">钩子 / 反转</th><th className="p-3">冲突 / 悬念</th><th className="p-3">状态</th><th className="p-3 text-right">操作</th></tr></thead>
        <tbody>{episodes.map((episode) => {
          const gaps = episodePlanningGaps(episode)
          return <tr key={episode.id} className="border-t hover:bg-muted/30">
            <td className="p-3"><input className="h-4 w-4 accent-primary" type="checkbox" checked={selectedIds.has(episode.id)} onChange={() => onToggle(episode.id)} aria-label={`选择第 ${episode.episodeNumber} 集`} /></td>
            <td className="p-3"><div className="font-medium">第 {episode.episodeNumber} 集 · {episode.title}</div><div className="mt-1 max-w-[18rem] truncate text-muted-foreground">{episode.summary || '待补梗概'}</div></td>
            <td className="p-3"><div>{episode.hook || '待补钩子'}</div><div className="mt-1 text-muted-foreground">{episode.reversal || '待补反转'}</div></td>
            <td className="p-3"><div>{episode.mainConflict || '待补冲突'}</div><div className="mt-1 text-muted-foreground">{episode.cliffhanger || '待补悬念'}</div></td>
            <td className="p-3">{gaps.length > 0 ? <span className="text-amber-700 dark:text-amber-300">缺 {gaps.join('、')}</span> : scriptEpisodeIds.has(episode.id) ? <span className="text-emerald-700 dark:text-emerald-300">剧本已就绪</span> : '大纲已就绪'}</td>
            <td className="p-3 text-right"><Button size="sm" variant="ghost" onClick={() => onEdit(episode)}>编辑</Button><Button size="sm" variant="ghost" onClick={() => onOpenScript(episode.id)}>剧本</Button></td>
          </tr>
        })}</tbody>
      </table>
    </div>
  )
}

function EpisodePaceLine({ episodes, onOpenScript }: { episodes: Episode[]; onOpenScript: (id: string) => void }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-4 flex items-center justify-between gap-3"><div><h3 className="text-sm font-medium">分集节奏线</h3><p className="mt-1 text-xs text-muted-foreground">按钩子、反转与结尾悬念定位节奏空档；颜色不单独承载状态。</p></div><span className="text-xs text-muted-foreground">{episodes.length} 集</span></div>
      <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {episodes.map((episode) => {
          const gaps = episodePlanningGaps(episode)
          return <li key={episode.id}><button className="studio-card-interactive w-full rounded-md border p-3 text-left hover:bg-accent/40" onClick={() => onOpenScript(episode.id)}>
            <div className="flex items-center justify-between gap-2"><span className="font-medium text-sm">第 {episode.episodeNumber} 集</span><span className={cn('text-[11px]', gaps.length ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300')}>{gaps.length ? `待补 ${gaps.length} 项` : '节奏要素齐全'}</span></div>
            <div className="mt-3 grid grid-cols-3 gap-1 text-center text-[10px]"><PaceSignal label="钩子" complete={Boolean(episode.hook)} /><PaceSignal label="反转" complete={Boolean(episode.reversal)} /><PaceSignal label="悬念" complete={Boolean(episode.cliffhanger)} /></div>
            <p className="mt-2 truncate text-xs text-muted-foreground">{episode.title}</p>
          </button></li>
        })}
      </ol>
    </div>
  )
}

function PaceSignal({ label, complete }: { label: string; complete: boolean }) {
  return <span className={cn('rounded px-1.5 py-1', complete ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300')}>{label}<span className="sr-only">{complete ? '已填写' : '待补'}</span></span>
}

function episodePlanningGaps(episode: Episode): string[] {
  const gaps: string[] = []
  if (!episode.hook?.trim()) gaps.push('钩子')
  if (!episode.reversal?.trim()) gaps.push('反转')
  if (!episode.cliffhanger?.trim()) gaps.push('悬念')
  if (episode.keyVisuals.length === 0) gaps.push('画面')
  return gaps
}

function matchesEpisodeFilter(episode: Episode, filter: EpisodePlannerFilter): boolean {
  const gaps = episodePlanningGaps(episode)
  if (filter === 'all') return true
  if (filter === 'incomplete') return gaps.length > 0
  const label: Record<Exclude<EpisodePlannerFilter, 'all' | 'incomplete'>, string> = { hook: '钩子', reversal: '反转', cliffhanger: '悬念', visual: '画面' }
  return gaps.includes(label[filter])
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
