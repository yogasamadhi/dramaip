import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Download,
  FileJson,
  ListVideo,
  Loader2,
  Pencil,
  Sparkles,
  Split,
  Wand2,
} from 'lucide-react'
import type { AdaptationProject, BatchTaskProgress, Episode, Scene, Script, ScriptReview, TextDiffPreviewPayload } from '@sdns/core'
import { TASK_TYPE_LABELS, TASK_WRITE_POLICIES, renderSceneStructureSnapshot, snapshotScene } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RadarChart } from '@/components/charts/RadarChart'
import { ContentVersionPanel } from '@/components/ContentVersionPanel'
import { TextDiffPreviewDialog } from '@/components/TextDiffPreviewDialog'
import { cn } from '@/lib/utils'

type ScriptTaskType =
  | 'rewrite_ai_drama_script'
  | 'enhance_dialogue_conflict'
  | 'enhance_episode_cliffhanger'
  | 'enhance_script_visuality'

export function ScriptWorkspacePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [adaptation, setAdaptation] = useState<AdaptationProject | null>(null)
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [scripts, setScripts] = useState<Script[]>([])
  const [activeEpisodeId, setActiveEpisodeId] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [textPreview, setTextPreview] = useState<TextDiffPreviewPayload | null>(null)

  const reload = useCallback(async () => {
    if (!id) return
    const [a, eps, scs] = await Promise.all([
      ipc.adaptationProject.get(id),
      ipc.episode.list(id),
      ipc.script.list(id),
    ])
    setAdaptation(a ?? null)
    setEpisodes(eps)
    setScripts(scs)
    setActiveEpisodeId((cur) => cur ?? eps[0]?.id ?? null)
  }, [id])

  useEffect(() => {
    void reload()
  }, [reload, version])

  const activeEpisode = useMemo(
    () => episodes.find((e) => e.id === activeEpisodeId) ?? null,
    [episodes, activeEpisodeId],
  )
  const activeScript = useMemo(
    () => scripts.find((s) => s.episodeId === activeEpisodeId) ?? null,
    [scripts, activeEpisodeId],
  )

  // ===== AI：单集生成 / 重写 / 增强（按任务策略预览或写入） =====
  async function runScriptTask(episode: Episode, taskType: 'generate_ai_drama_script' | ScriptTaskType) {
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
      })
      if (res.ok) {
        if (res.result?.kind === 'text_preview') {
          toast.success(`${label}完成，预览后采用`, { id: tid })
          setTextPreview(res.result.data as TextDiffPreviewPayload)
        } else {
          const policy = TASK_WRITE_POLICIES[taskType]
          toast.success(`${label}完成${policy.policy === 'auto_write' || policy.policy === 'conditional_preview' ? '，已保存' : ''}`, { id: tid })
          setVersion((v) => v + 1)
        }
      } else {
        toast.error(`${label}失败：` + (res.error ?? '未知错误'), { id: tid })
      }
    } finally {
      setBusy(null)
    }
  }

  // ===== AI：批量生成前 N 集 =====
  async function runBatch(count: number) {
    if (!adaptation || episodes.length === 0) return
    const targets = episodes.slice(0, count).filter((ep) => !scripts.some((script) => script.episodeId === ep.id))
    if (targets.length === 0) {
      toast.message(`前 ${Math.min(count, episodes.length)} 集已生成剧本`)
      return
    }
    setBusy('batch')
    const tid = toast.loading(`正在批量生成前 ${targets.length} 集剧本…（可能需要较长时间）`)
    try {
      const res = await ipc.batchTask.run({
        kind: 'scripts',
        projectId: adaptation.sourceProjectId,
        adaptationProjectId: adaptation.id,
        episodeIds: targets.map((ep) => ep.id),
      })
      const progress = batchProgressFromTask(res.task)
      if (res.ok) {
        toast.success(`批量完成：${formatBatchProgress(progress, '集剧本')}`, { id: tid })
      } else {
        toast.error(`批量生成有失败：${formatBatchProgress(progress, '集剧本') || res.error || '未知错误'}`, { id: tid })
      }
      setVersion((v) => v + 1)
    } catch (e) {
      toast.error('批量生成出错：' + (e instanceof Error ? e.message : String(e)), { id: tid })
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

  async function handleTextAdopt() {
    if (!adaptation || !textPreview) return
    const res = await ipc.ai.applyResult({
      projectId: adaptation.sourceProjectId,
      taskType: textPreview.taskType,
      data: textPreview,
    })
    if (res.ok) {
      toast.success('已保存剧本')
      setTextPreview(null)
      setVersion((v) => v + 1)
    } else {
      toast.error('保存失败：' + (res.error ?? '未知错误'))
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/adaptations/${adaptation.id}`)}>
          <ArrowLeft />
        </Button>
        <h1 className="text-base font-semibold">{adaptation.title} · AI 短剧剧本</h1>
        <Badge variant="secondary">{scripts.length} / {episodes.length} 集剧本</Badge>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy === 'batch' || episodes.length === 0}
            onClick={() => runBatch(10)}
            title="批量生成前 10 集剧本"
          >
            {busy === 'batch' ? <Loader2 className="animate-spin" /> : <ListVideo />}
            批量生成前 10 集
          </Button>
          <Button size="sm" variant="outline" onClick={() => ipc.export.dramaEpisodeDeliveryMarkdown(adaptation.id)}>
            <Download /> 交付包
          </Button>
          <Button size="sm" variant="outline" onClick={() => ipc.export.dramaEpisodeDeliveryJson(adaptation.id)}>
            <FileJson /> 交付 JSON
          </Button>
          <Button size="sm" variant="outline" onClick={() => ipc.export.scriptsMarkdown(adaptation.id)}>
            <Download /> Markdown
          </Button>
          <Button size="sm" variant="outline" onClick={() => ipc.export.scriptsJson(adaptation.id)}>
            <FileJson /> JSON
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：集数列表 */}
        <aside className="w-56 shrink-0 overflow-hidden border-r">
          <ScrollArea className="h-full">
            <div className="p-2">
              {episodes.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">
                  还没有分集大纲，请先在改编项目里生成分集大纲。
                </p>
              ) : (
                episodes.map((ep) => {
                  const has = scripts.some((s) => s.episodeId === ep.id)
                  return (
                    <button
                      key={ep.id}
                      onClick={() => setActiveEpisodeId(ep.id)}
                      className={cn(
                        'mb-0.5 w-full rounded px-2.5 py-1.5 text-left text-sm',
                        activeEpisodeId === ep.id ? 'bg-accent font-medium' : 'hover:bg-accent/60',
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">第 {ep.episodeNumber} 集</span>
                        {has && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="已生成剧本" />}
                      </div>
                      <div className="truncate text-xs">{ep.title}</div>
                    </button>
                  )
                })
              )}
            </div>
          </ScrollArea>
        </aside>

        {/* 中间：当前集剧本工作区 */}
        <section className="flex-1 overflow-hidden">
          {activeEpisode ? (
            <ScriptEditor
              key={activeEpisode.id}
              adaptationProjectId={adaptation.id}
              sourceProjectId={adaptation.sourceProjectId}
              episode={activeEpisode}
              script={activeScript}
              busy={busy}
              onGenerate={() => runScriptTask(activeEpisode, 'generate_ai_drama_script')}
              onTask={(t) => runScriptTask(activeEpisode, t)}
              onChanged={() => setVersion((v) => v + 1)}
              onEnterShots={() =>
                navigate(`/adaptations/${adaptation.id}/shots?episode=${activeEpisode.id}`)
              }
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              请在左侧选择一集。
            </div>
          )}
        </section>
      </div>
      <TextDiffPreviewDialog
        open={textPreview !== null}
        preview={textPreview}
        onAdopt={handleTextAdopt}
        onCancel={() => setTextPreview(null)}
      />
    </div>
  )
}

function batchProgressFromTask(task: { output?: Record<string, unknown> } | undefined): BatchTaskProgress | null {
  const output = task?.output as unknown
  if (!output || typeof output !== 'object') return null
  const progress = output as Partial<BatchTaskProgress>
  return Array.isArray(progress.items) ? progress as BatchTaskProgress : null
}

function formatBatchProgress(progress: BatchTaskProgress | null, unit: string): string {
  if (!progress) return ''
  const parts = [`成功 ${progress.success} ${unit}`]
  if (progress.skipped) parts.push(`跳过 ${progress.skipped} 项`)
  if (progress.failed) parts.push(`失败 ${progress.failed} 项`)
  return parts.join('，')
}

// ---------------------------------------------------------------------------
// 单集剧本编辑器：剧本正文 + 场景拆分 + 剧本审稿 + AI 操作
// ---------------------------------------------------------------------------
interface EditorProps {
  adaptationProjectId: string
  sourceProjectId?: string
  episode: Episode
  script: Script | null
  busy: string | null
  onGenerate: () => void
  onTask: (t: ScriptTaskType) => void
  onChanged: () => void
  onEnterShots: () => void
}

function ScriptEditor({ adaptationProjectId, sourceProjectId, episode, script, busy, onGenerate, onTask, onChanged, onEnterShots }: EditorProps) {
  const [tab, setTab] = useState<'script' | 'scenes' | 'review'>('script')
  const [scenes, setScenes] = useState<Scene[]>([])
  const [review, setReview] = useState<ScriptReview | undefined>(undefined)
  const [draftContent, setDraftContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy2, setBusy2] = useState<string | null>(null)

  // 切换集数 / 剧本更新时，重置编辑器草稿
  useEffect(() => {
    setDraftContent(script?.content ?? '')
    setDirty(false)
  }, [script?.id, script?.updatedAt])

  const loadExtras = useCallback(async () => {
    if (!script) {
      setScenes([])
      setReview(undefined)
      return
    }
    const [scs, rv] = await Promise.all([
      ipc.scene.listByScript(script.id),
      ipc.scriptReview.get(script.id),
    ])
    setScenes(scs)
    setReview(rv)
  }, [script?.id])

  useEffect(() => {
    void loadExtras()
  }, [loadExtras])

  async function saveContent() {
    if (!script) return
    const updated = await ipc.script.updateContent(script.id, draftContent)
    if (updated) {
      toast.success('剧本已保存')
      setDirty(false)
      onChanged()
    }
  }

  async function splitScenes() {
    if (!script) return
    setBusy2('split')
    const tid = toast.loading('正在拆分场景…')
    try {
      const res = await ipc.ai.run({
        projectId: sourceProjectId,
        adaptationProjectId,
        episodeId: episode.id,
        taskType: 'split_script_to_scenes',
      })
      if (res.ok) {
        toast.success('场景拆分完成，已保存结构检查点', { id: tid })
        await loadExtras()
      } else {
        toast.error('拆分失败：' + (res.error ?? '未知错误'), { id: tid })
      }
    } finally {
      setBusy2(null)
    }
  }

  async function runReview() {
    if (!script) return
    setBusy2('review')
    const tid = toast.loading('正在审稿…')
    try {
      const res = await ipc.ai.run({
        projectId: sourceProjectId,
        adaptationProjectId,
        episodeId: episode.id,
        taskType: 'review_ai_drama_script',
      })
      if (res.ok) {
        toast.success('审稿完成', { id: tid })
        await loadExtras()
        setTab('review')
      } else {
        toast.error('审稿失败：' + (res.error ?? '未知错误'), { id: tid })
      }
    } finally {
      setBusy2(null)
    }
  }

  async function runCreativeScriptTask(taskType: 'run_quality_gate' | 'simulate_audience_reaction') {
    if (!script) return
    setBusy2(taskType)
    const tid = toast.loading(taskType === 'run_quality_gate' ? '正在运行剧本质量闸门…' : '正在模拟观众反应…')
    try {
      const res = await ipc.ai.run({
        projectId: sourceProjectId,
        adaptationProjectId,
        episodeId: episode.id,
        taskType,
      })
      if (res.ok) {
        toast.success('创意诊断完成', { id: tid })
      } else {
        toast.error('诊断失败：' + (res.error ?? '未知错误'), { id: tid })
      }
    } finally {
      setBusy2(null)
    }
  }

  async function saveScriptCheckpoint() {
    if (!script) return
    await ipc.contentVersion.create({
      projectId: sourceProjectId,
      targetKind: 'script',
      targetId: script.id,
      label: `剧本检查点：第 ${episode.episodeNumber} 集`,
      source: 'manual_checkpoint',
      content: script.content,
    })
    toast.success('已保存剧本检查点')
  }

  const taskBtns: { type: ScriptTaskType; label: string }[] = [
    { type: 'rewrite_ai_drama_script', label: '重写' },
    { type: 'enhance_dialogue_conflict', label: '增强对白冲突' },
    { type: 'enhance_episode_cliffhanger', label: '增强集尾悬念' },
    { type: 'enhance_script_visuality', label: '增强画面感' },
  ]

  return (
    <ScrollArea className="h-full">
      <div className="p-6">
        {/* 头部：集信息 + 操作 */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge variant="outline">第 {episode.episodeNumber} 集</Badge>
          <span className="font-medium">{episode.title}</span>
          <span className="text-xs text-muted-foreground">{episode.summary}</span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {!script && (
              <Button size="sm" onClick={onGenerate} disabled={busy !== null}>
                {busy === episode.id + 'generate_ai_drama_script' ? <Loader2 className="animate-spin" /> : <Wand2 />}
                生成剧本
              </Button>
            )}
            {script && (
              <>
                <Button size="sm" variant="outline" onClick={() => setTab('script')}>剧本</Button>
                <Button size="sm" variant="outline" onClick={() => setTab('scenes')}>场景</Button>
                <Button size="sm" variant="outline" onClick={() => setTab('review')}>审稿</Button>
              </>
            )}
          </div>
        </div>

        {!script ? (
          <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
            本集还没有剧本。点击「生成剧本」，AI 会生成完整 AI 短剧剧本并保存；已有剧本的改写会先预览差异。
          </div>
        ) : (
          <>
            {/* 剧本头摘要 */}
            <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground lg:grid-cols-3">
              {script.hook && <span>钩子：{script.hook}</span>}
              {script.mainConflict && <span>冲突：{script.mainConflict}</span>}
              {script.emotionalBeat && <span>情绪爆点：{script.emotionalBeat}</span>}
              {script.reversal && <span>反转：{script.reversal}</span>}
              {script.cliffhanger && <span>悬念：{script.cliffhanger}</span>}
              {script.estimatedDuration && <span>预计时长：{script.estimatedDuration}</span>}
            </div>

            {tab === 'script' && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">剧本正文</span>
                  {dirty && <Badge variant="secondary">未保存</Badge>}
                  <div className="ml-auto flex flex-wrap gap-1.5">
                    {taskBtns.map((b) => (
                      <Button
                        key={b.type}
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null || busy2 !== null}
                        onClick={() => onTask(b.type)}
                      >
                        {busy === episode.id + b.type ? <Loader2 className="animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        {b.label}
                      </Button>
                    ))}
                    <Button size="sm" variant="ghost" disabled={busy2 !== null} onClick={() => runCreativeScriptTask('run_quality_gate')}>
                      <Sparkles className="h-3.5 w-3.5" />
                      质量闸门
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy2 !== null} onClick={() => runCreativeScriptTask('simulate_audience_reaction')}>
                      <Sparkles className="h-3.5 w-3.5" />
                      观众模拟
                    </Button>
                    <Button size="sm" variant="ghost" onClick={saveScriptCheckpoint}>
                      <Pencil className="h-3.5 w-3.5" />
                      检查点
                    </Button>
                  </div>
                </div>
                <Textarea
                  value={draftContent}
                  onChange={(e) => {
                    setDraftContent(e.target.value)
                    setDirty(true)
                  }}
                  rows={26}
                  className="font-mono text-xs leading-relaxed"
                  placeholder="剧本正文（Markdown）…"
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => ipc.export.scriptMarkdown(script.id)}>
                    <Download /> 导出 Markdown
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => ipc.export.scriptJson(script.id)}>
                    <FileJson /> 导出 JSON
                  </Button>
                  <Button size="sm" onClick={saveContent} disabled={!dirty}>
                    <Pencil className="h-3.5 w-3.5" />
                    保存
                  </Button>
                </div>
                <ContentVersionPanel
                  targetKind="script"
                  targetId={script.id}
                  currentContent={draftContent}
                  title="剧本版本"
                  restoreDisabled={dirty}
                  onRestored={onChanged}
                />
              </div>
            )}

            {tab === 'scenes' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">场景列表</span>
                  <Badge variant="secondary">{scenes.length} 个场景</Badge>
                  <div className="ml-auto flex gap-2">
                    <Button size="sm" variant="secondary" onClick={onEnterShots} disabled={scenes.length === 0}>
                      进入分镜 →
                    </Button>
                    <Button size="sm" onClick={splitScenes} disabled={busy2 === 'split'}>
                      {busy2 === 'split' ? <Loader2 className="animate-spin" /> : <Split className="h-3.5 w-3.5" />}
                      AI 拆分场景
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  AI 拆分场景会替换当前场景列表，并在写入前自动保存可恢复的结构检查点；已有镜头会跟随场景结构一并进入快照。
                </p>
                {scenes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    还没有场景。点击「AI 拆分场景」，AI 会把剧本正文拆成有序的场景清单，为后续分镜做准备。
                  </p>
                ) : (
                  scenes.map((s, i) => (
                    <div key={s.id} className="rounded-md border p-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">场景 {i + 1}</Badge>
                        <span className="font-medium">{s.title}</span>
                        <span className="text-xs text-muted-foreground">{s.location}{s.timeOfDay ? ` · ${s.timeOfDay}` : ''}</span>
                        <div className="ml-auto flex gap-1">
                          {s.characters.map((c) => (
                            <Badge key={c} variant="secondary">{c}</Badge>
                          ))}
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{s.summary}</p>
                      {s.visualDescription && (
                        <p className="mt-1 text-xs text-muted-foreground">画面：{s.visualDescription}</p>
                      )}
                    </div>
                  ))
                )}
                <ContentVersionPanel
                  targetKind="script"
                  targetId={script.id}
                  currentContent={renderSceneStructureSnapshot(scenes.map((scene) => snapshotScene(scene)))}
                  title="场景结构版本"
                  versionScope="structure"
                  onRestored={async () => {
                    await loadExtras()
                    onChanged()
                  }}
                />
              </div>
            )}

            {tab === 'review' && (
              <div className="max-w-2xl space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">剧本审稿</span>
                  <div className="ml-auto">
                    <Button size="sm" onClick={runReview} disabled={busy2 === 'review'}>
                      {busy2 === 'review' ? <Loader2 className="animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      AI 审稿
                    </Button>
                  </div>
                </div>
                {review ? (
                  <div className="flex gap-6">
                    <div className="shrink-0">
                      <RadarChart
                        axes={[
                          { label: '开场抓人', value: review.hookStrengthScore },
                          { label: '对白短剧化', value: review.dialogueScore },
                          { label: '冲突强度', value: review.conflictScore },
                          { label: '画面清晰', value: review.visualClarityScore },
                          { label: '场景清楚', value: review.sceneClarityScore },
                          { label: '人物贴合', value: review.characterFitScore },
                          { label: '可拆镜头', value: review.shotReadinessScore },
                          { label: 'AI视频可行', value: review.aiVideoFeasibilityScore },
                          { label: '集尾悬念', value: review.cliffhangerScore },
                        ]}
                      />
                      <div className="mt-1 text-center text-sm">
                        综合 <span className="font-semibold">{review.overallScore}</span> 分
                      </div>
                    </div>
                    <div className="flex-1 space-y-3">
                      <div>
                        <div className="mb-1 text-sm font-medium">问题（{review.issues.length}）</div>
                        {review.issues.length ? (
                          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                            {review.issues.map((it, i) => <li key={i}>{it}</li>)}
                          </ul>
                        ) : <p className="text-xs text-muted-foreground">无</p>}
                      </div>
                      <div>
                        <div className="mb-1 text-sm font-medium">修改建议（{review.suggestions.length}）</div>
                        {review.suggestions.length ? (
                          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                            {review.suggestions.map((it, i) => <li key={i}>{it}</li>)}
                          </ul>
                        ) : <p className="text-xs text-muted-foreground">无</p>}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    还没有审稿。点击「AI 审稿」，AI 会从开场抓人、对白短剧化、冲突、画面清晰、场景、人物贴合、可拆镜头、AI视频可行性与集尾悬念九个维度打分并给出问题与建议。
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </ScrollArea>
  )
}
