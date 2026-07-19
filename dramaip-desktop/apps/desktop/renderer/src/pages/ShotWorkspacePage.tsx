import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowLeft,
  AlertTriangle,
  ChevronRight,
  Download,
  FileJson,
  ImagePlus,
  ListVideo,
  Loader2,
  Pencil,
  Sparkles,
  Split,
  Table,
  Video,
} from 'lucide-react'
import type { AdaptationProject, BatchTaskProgress, Episode, ProjectAsset, PromptVersion, Scene, Script, Shot, ShotReview, TextDiffPreviewPayload, VideoAssetDraftResult } from '@sdns/core'
import { TASK_TYPE_LABELS, renderShotStructureSnapshot, snapshotShot } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { ASSET_KIND_LABEL, ASSET_STATUS_LABEL, ASSET_STATUS_VARIANT, assetFieldsFromReference, assetReferenceUrl } from '@/lib/assets'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RadarChart } from '@/components/charts/RadarChart'
import { ContentVersionPanel } from '@/components/ContentVersionPanel'
import { TextDiffPreviewDialog } from '@/components/TextDiffPreviewDialog'
import { useAutosaveDraft, type DraftSaveState } from '@/hooks/useAutosaveDraft'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

type ShotPromptTaskType =
  | 'generate_shot_prompt'
  | 'generate_negative_prompt'
  | 'rewrite_shot_prompt'
  | 'optimize_prompt_for_video_platform'

const DIFFICULTY_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  low: 'secondary',
  medium: 'outline',
  high: 'destructive',
}

interface ShotDraft {
  videoPrompt: string
  negativePrompt: string
  imagePrompt: string
  coverPrompt: string
  narration: string
  subtitleDraft: string
  referenceInput: string
  firstFrameInput: string
  coverInput: string
  narrationInput: string
  subtitleInput: string
}

const EMPTY_SHOT_DRAFT: ShotDraft = {
  videoPrompt: '',
  negativePrompt: '',
  imagePrompt: '',
  coverPrompt: '',
  narration: '',
  subtitleDraft: '',
  referenceInput: '',
  firstFrameInput: '',
  coverInput: '',
  narrationInput: '',
  subtitleInput: '',
}

export function ShotWorkspacePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [adaptation, setAdaptation] = useState<AdaptationProject | null>(null)
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [scripts, setScripts] = useState<Script[]>([])
  const [scenes, setScenes] = useState<Scene[]>([])
  const [shots, setShots] = useState<Shot[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const episodeId = params.get('episode') ?? ''
  const sceneId = params.get('scene') ?? ''

  const activeEpisode = useMemo(() => episodes.find((e) => e.id === episodeId) ?? null, [episodes, episodeId])
  const activeScript = useMemo(() => scripts.find((s) => s.episodeId === episodeId) ?? null, [scripts, episodeId])
  const activeScene = useMemo(() => scenes.find((s) => s.id === sceneId) ?? null, [scenes, sceneId])

  const reload = useCallback(async () => {
    if (!id) return
    const [a, eps, scs] = await Promise.all([
      ipc.adaptationProject.get(id),
      ipc.episode.list(id),
      ipc.script.list(id),
    ])
    setAdaptation(a ?? null)
    if (a?.sourceProjectId) await ipc.project.setActiveAdaptation(a.sourceProjectId, a.id)
    setEpisodes(eps)
    setScripts(scs)
    // 自动选中第一集（若无）
    if (!episodeId && eps[0]) {
      setParams((p) => {
        p.set('episode', eps[0].id)
        return p
      }, { replace: true })
    }
  }, [id, episodeId, setParams])

  // 加载当前集剧本的场景
  const reloadScenes = useCallback(async () => {
    if (!activeScript) {
      setScenes([])
      return
    }
    setScenes(await ipc.scene.listByScript(activeScript.id))
  }, [activeScript])

  // 加载当前场景的镜头
  const reloadShots = useCallback(async () => {
    if (!sceneId) {
      setShots([])
      return
    }
    setShots(await ipc.shot.listByScene(sceneId))
  }, [sceneId])

  useEffect(() => {
    void reload()
  }, [reload, version])
  useEffect(() => {
    void reloadScenes()
  }, [reloadScenes])
  useEffect(() => {
    void reloadShots()
  }, [reloadShots])

  // AI：场景拆分镜头
  async function runSplit(scene: Scene) {
    if (!adaptation) return
    setBusy('split')
    const tid = toast.loading('正在拆分镜头…')
    try {
      const res = await ipc.ai.run({
        projectId: adaptation.sourceProjectId,
        adaptationProjectId: adaptation.id,
        episodeId: scene.episodeId,
        sceneId: scene.id,
        taskType: 'split_scene_to_shots',
      })
      if (res.ok) {
        toast.success('镜头拆分完成，已保存结构检查点', { id: tid })
        setVersion((v) => v + 1)
      } else {
        toast.error('拆分失败：' + (res.error ?? '未知错误'), { id: tid })
      }
    } finally {
      setBusy(null)
    }
  }

  async function runBatchSplit() {
    if (!adaptation || scenes.length === 0) return
    setBusy('batch-shots')
    const tid = toast.loading(`正在批量拆分镜头…会跳过已有镜头的场景，写入前自动保存检查点`)
    try {
      const res = await ipc.batchTask.run({
        kind: 'shots',
        projectId: adaptation.sourceProjectId,
        adaptationProjectId: adaptation.id,
        episodeIds: episodeId ? [episodeId] : undefined,
        sceneIds: scenes.map((scene) => scene.id),
      })
      const progress = batchProgressFromTask(res.task)
      if (res.ok) {
        toast.success(`批量拆分完成：${formatBatchProgress(progress, '个场景')}`, { id: tid })
      } else {
        toast.error(`批量拆分有失败：${formatBatchProgress(progress, '个场景') || res.error || '未知错误'}`, { id: tid })
      }
      setVersion((v) => v + 1)
    } catch (error) {
      toast.error('批量拆分出错：' + (error instanceof Error ? error.message : String(error)), { id: tid })
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

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/adaptations/${adaptation.id}/scripts`)}>
          <ArrowLeft />
        </Button>
        <h1 className="text-base font-semibold">{adaptation.title} · 分镜与镜头 Prompt</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!activeScript || scenes.length === 0 || busy !== null}
            onClick={() => void runBatchSplit()}
            title="批量拆分本集镜头"
          >
            {busy === 'batch-shots' ? <Loader2 className="animate-spin" /> : <ListVideo />}
            批量拆分镜头
          </Button>
          <Button size="sm" variant="outline" onClick={() => ipc.export.dramaShotDeliveryMarkdown(adaptation.id)}>
            <Download /> 分镜包
          </Button>
          <Button size="sm" variant="outline" onClick={() => ipc.export.dramaShotDeliveryJson(adaptation.id)}>
            <FileJson /> 分镜 JSON
          </Button>
          <Button size="sm" variant="outline" onClick={() => ipc.export.dramaShotDeliveryCsv(adaptation.id)}>
            <Table /> 分镜 CSV
          </Button>
          <Select
            value={episodeId}
            onValueChange={(v) => setParams((p) => { p.set('episode', v); p.delete('scene'); p.delete('shot'); return p })}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="选择集数" />
            </SelectTrigger>
            <SelectContent>
              {episodes.map((ep) => (
                <SelectItem key={ep.id} value={ep.id}>
                  第 {ep.episodeNumber} 集 · {ep.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      {!activeEpisode ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          请选择一集。
        </div>
      ) : !activeScript ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          本集还没有剧本，无法拆分镜头。请先在剧本页生成剧本并拆分场景。
        </div>
      ) : scenes.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          本集剧本还没有场景。请先在剧本页「拆分场景」。
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* 左侧：场景列表 */}
          <aside className="w-56 shrink-0 overflow-hidden border-r">
            <ScrollArea className="h-full">
              <div className="p-2">
                <div className="mb-1 px-1 text-xs text-muted-foreground">场景（点击拆镜头）</div>
                {scenes.map((sc, i) => (
                  <button
                    key={sc.id}
                    onClick={() => setParams((p) => { p.set('scene', sc.id); p.delete('shot'); return p })}
                    className={cn(
                      'mb-0.5 w-full rounded px-2.5 py-1.5 text-left text-sm',
                      sceneId === sc.id ? 'bg-accent font-medium' : 'hover:bg-accent/60',
                    )}
                  >
                    <div className="text-xs text-muted-foreground">场景 {i + 1}</div>
                    <div className="truncate text-xs">{sc.title}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{sc.location}</div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </aside>

          {/* 中间：当前场景的镜头工作区 */}
          <section className="flex-1 overflow-hidden">
            {activeScene ? (
              <SceneShotPanel
                key={activeScene.id}
                adaptationProjectId={adaptation.id}
                sourceProjectId={adaptation.sourceProjectId}
                scene={activeScene}
                shots={shots}
                busy={busy}
                index={scenes.findIndex((s) => s.id === activeScene.id)}
                onSplit={() => runSplit(activeScene)}
                onChanged={() => setVersion((v) => v + 1)}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  在左侧选择一个场景 <ChevronRight className="h-3.5 w-3.5" /> 拆分镜头
                </span>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 单场景镜头面板：镜头列表 + 单镜头 Prompt 编辑/生成/审查 + 版本历史
// ---------------------------------------------------------------------------
interface PanelProps {
  adaptationProjectId: string
  sourceProjectId?: string
  scene: Scene
  shots: Shot[]
  busy: string | null
  index: number
  onSplit: () => void
  onChanged: () => void
}

function SceneShotPanel({ adaptationProjectId, sourceProjectId, scene, shots, busy, index, onSplit, onChanged }: PanelProps) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const activeShotId = params.get('shot')
  const [versions, setVersions] = useState<PromptVersion[]>([])
  const [textPreview, setTextPreview] = useState<TextDiffPreviewPayload | null>(null)
  const [shotAssets, setShotAssets] = useState<ProjectAsset[]>([])
  const [assetDraft, setAssetDraft] = useState<VideoAssetDraftResult | null>(null)
  const [baseDraft, setBaseDraft] = useState<ShotDraft>(EMPTY_SHOT_DRAFT)

  useEffect(() => {
    if (!shots.length || (activeShotId && shots.some((shot) => shot.id === activeShotId))) return
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.set('shot', shots[0].id)
      return next
    }, { replace: true })
  }, [activeShotId, scene.id, setParams, shots])

  const activeShot = useMemo(() => shots.find((s) => s.id === activeShotId) ?? null, [shots, activeShotId])

  useEffect(() => {
    if (!activeShot) {
      setVersions([])
      return
    }
    void (async () => setVersions(await ipc.promptVersion.list(activeShot.id)))()
  }, [activeShot])

  useEffect(() => {
    let canceled = false
    if (!activeShot) {
      setShotAssets([])
      setAssetDraft(null)
      setBaseDraft(EMPTY_SHOT_DRAFT)
      return () => {
        canceled = true
      }
    }
    void (async () => {
      const assets = await ipc.asset.listBySource('shot', activeShot.id)
      if (canceled) return
      setShotAssets(assets)
      setAssetDraft(null)
      setBaseDraft(createShotDraft(activeShot, assets))
    })()
    return () => {
      canceled = true
    }
  }, [activeShot])

  async function runShotTask(shot: Shot, taskType: ShotPromptTaskType, instruction?: string) {
    setBusy2(shot.id + taskType)
    const label = TASK_TYPE_LABELS[taskType]
    const tid = toast.loading(`正在${label}…`)
    try {
      const res = await ipc.ai.run({
        projectId: sourceProjectId,
        adaptationProjectId,
        episodeId: scene.episodeId,
        sceneId: scene.id,
        shotId: shot.id,
        taskType,
        userInstruction: instruction,
      })
      if (res.ok) {
        if (res.result?.kind === 'text_preview') {
          toast.success(`${label}完成，请确认`, { id: tid })
          setTextPreview(res.result.data as TextDiffPreviewPayload)
        } else {
          toast.success(`${label}完成`, { id: tid })
          onChanged()
        }
      } else {
        toast.error(`${label}失败：` + (res.error ?? '未知错误'), { id: tid })
      }
    } finally {
      setBusy2(null)
    }
  }

  async function runReview(shot: Shot) {
    setBusy2(shot.id + 'review')
    const tid = toast.loading('正在审查镜头…')
    try {
      const res = await ipc.ai.run({
        projectId: sourceProjectId,
        adaptationProjectId,
        episodeId: scene.episodeId,
        sceneId: scene.id,
        shotId: shot.id,
        taskType: 'review_shot_prompt',
      })
      if (res.ok) {
        toast.success('审查完成', { id: tid })
        onChanged()
      } else {
        toast.error('审查失败：' + (res.error ?? '未知错误'), { id: tid })
      }
    } finally {
      setBusy2(null)
    }
  }

  async function runCreativeShotTask(shot: Shot) {
    setBusy2(shot.id + 'video-risk')
    const tid = toast.loading('正在预估视频生成风险…')
    try {
      const res = await ipc.ai.run({
        projectId: sourceProjectId,
        adaptationProjectId,
        episodeId: scene.episodeId,
        sceneId: scene.id,
        shotId: shot.id,
        taskType: 'analyze_video_cost_risk',
      })
      if (res.ok) {
        toast.success('视频风险预估完成', { id: tid })
        onChanged()
      } else {
        toast.error('预估失败：' + (res.error ?? '未知错误'), { id: tid })
      }
    } finally {
      setBusy2(null)
    }
  }

  async function runVideoAssetDraftTask(shot: Shot) {
    setBusy2(shot.id + 'video-assets')
    const tid = toast.loading('正在生成视频资产草稿…')
    try {
      const res = await ipc.ai.run({
        projectId: sourceProjectId,
        adaptationProjectId,
        episodeId: scene.episodeId,
        sceneId: scene.id,
        shotId: shot.id,
        taskType: 'generate_video_asset_drafts',
      })
      if (res.ok && res.result?.kind === 'generate_video_asset_drafts') {
        setAssetDraft(res.result.data as VideoAssetDraftResult)
        toast.success('视频资产草稿已生成', { id: tid })
      } else {
        toast.error('生成失败：' + (res.error ?? '未知错误'), { id: tid })
      }
    } finally {
      setBusy2(null)
    }
  }

  function applyVideoAssetDraft(draftResult: VideoAssetDraftResult) {
    updateDraft((current) => ({
      ...current,
      imagePrompt: draftResult.firstFramePrompt || current.imagePrompt,
      coverPrompt: draftResult.coverPrompt || current.coverPrompt,
      narration: draftResult.narrationDraft || current.narration,
      subtitleDraft: draftResult.subtitleDraft || current.subtitleDraft,
    }))
    toast.success('已填入草稿，保存后写入镜头')
  }

  async function savePromptCheckpoint(shot: Shot) {
    await ipc.contentVersion.create({
      projectId: sourceProjectId,
      targetKind: 'shot',
      targetId: shot.id,
      label: `Prompt 检查点：镜头 ${shot.shotNumber}`,
      source: 'manual_checkpoint',
      content: shot.videoPrompt,
      meta: { negativePrompt: shot.negativePrompt, imagePrompt: shot.imagePrompt, coverPrompt: shot.coverPrompt, narration: shot.narration, subtitleDraft: shot.subtitleDraft },
    })
    toast.success('已保存 Prompt 检查点')
  }

  async function handleTextAdopt(candidate: TextDiffPreviewPayload) {
    const res = await ipc.ai.applyResult({
      projectId: sourceProjectId,
      taskType: candidate.taskType,
      data: candidate,
    })
    if (res.ok) {
      toast.success('已保存 Prompt')
      setTextPreview(null)
      onChanged()
    } else {
      toast.error('保存失败：' + (res.error ?? '未知错误'))
    }
  }

  const [busy2, setBusy2] = useState<string | null>(null)
  const {
    value: draft,
    updateValue: updateDraft,
    flush: flushShot,
    discardRecovery,
    status: saveState,
    isDirty,
  } = useAutosaveDraft({
    targetKey: activeShot ? `shot:${activeShot.id}` : `shot-scene:${scene.id}`,
    initialValue: baseDraft,
    serialize: (value) => JSON.stringify(value),
    deserialize: parseShotDraft,
    save: async (candidate) => {
      if (!activeShot) return false
      const updated = await ipc.shot.update(activeShot.id, {
        videoPrompt: candidate.videoPrompt,
        negativePrompt: candidate.negativePrompt,
        imagePrompt: candidate.imagePrompt,
        coverPrompt: candidate.coverPrompt,
        narration: candidate.narration,
        subtitleDraft: candidate.subtitleDraft,
      })
      if (!updated) return false
      await syncShotAssets(updated, candidate)
      setShotAssets(await ipc.asset.listBySource('shot', updated.id))
      onChanged()
      return true
    },
  })

  async function saveShot() {
    const saved = await flushShot()
    if (saved) {
      toast.success('已保存')
    } else {
      toast.error('保存失败，本地恢复草稿仍已保留。')
    }
  }

  async function syncShotAssets(shot: Shot, candidate: ShotDraft) {
    const projectId = sourceProjectId
    if (!projectId) return
    const common = { sceneId: shot.sceneId, episodeId: shot.episodeId }
    await syncShotAsset(projectId, shot, 'scene_reference', candidate.referenceInput, {
      title: `镜头 ${shot.shotNumber} 参考图`,
      tags: ['镜头参考图'],
      metadata: { ...common, role: 'shot_reference' },
    })
    await syncShotAsset(projectId, shot, 'first_frame_image', candidate.firstFrameInput, {
      title: `镜头 ${shot.shotNumber} 首帧图`,
      tags: ['首帧图'],
      metadata: { ...common, role: 'first_frame' },
    })
    await syncShotAsset(projectId, shot, 'cover_image', candidate.coverInput, {
      title: `镜头 ${shot.shotNumber} 封面图`,
      tags: ['封面图'],
      metadata: { ...common, role: 'shot_cover' },
    })
    await syncShotAsset(projectId, shot, 'narration_audio', candidate.narrationInput, {
      title: `镜头 ${shot.shotNumber} 旁白音频`,
      tags: ['旁白音频'],
      metadata: { ...common, role: 'narration_audio' },
    })
    await syncShotAsset(projectId, shot, 'subtitle_file', candidate.subtitleInput, {
      title: `镜头 ${shot.shotNumber} 字幕文件`,
      tags: ['字幕文件'],
      metadata: { ...common, role: 'subtitle_file' },
    })
  }

  async function syncShotAsset(
    projectId: string,
    shot: Shot,
    kind: ProjectAsset['kind'],
    reference: string,
    payloadInfo: Pick<ProjectAsset, 'title' | 'tags' | 'metadata'>,
  ) {
    const existing = await ipc.asset.listBySource('shot', shot.id)
    const linked = existing.find((asset) => asset.kind === kind)
    const trimmed = reference.trim()
    if (!trimmed) {
      if (linked) await ipc.asset.remove(linked.id)
      return
    }
    const fields = assetFieldsFromReference(trimmed)
    const payload = {
      projectId,
      kind,
      title: payloadInfo.title,
      sourceEntityKind: 'shot' as const,
      sourceEntityId: shot.id,
      packagePolicy: 'reference_only' as const,
      tags: payloadInfo.tags,
      metadata: payloadInfo.metadata,
      ...fields,
    }
    if (linked) await ipc.asset.update(linked.id, payload)
    else await ipc.asset.create(payload)
  }

  return (
    <>
      <ScrollArea className="h-full">
        <div className="p-6">
        {/* 场景头 */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge variant="outline">场景 {index + 1}</Badge>
          <span className="font-medium">{scene.title}</span>
          <span className="text-xs text-muted-foreground">{scene.location}{scene.timeOfDay ? ` · ${scene.timeOfDay}` : ''}</span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Button size="sm" onClick={onSplit} disabled={busy !== null}>
              {busy === 'split' ? <Loader2 className="animate-spin" /> : <Split className="h-3.5 w-3.5" />}
              AI 拆分镜头
            </Button>
            <Button size="sm" variant="outline" onClick={() => ipc.export.shotsMarkdown(scene.id)}>
              <Download /> MD
            </Button>
            <Button size="sm" variant="outline" onClick={() => ipc.export.shotsJson(scene.id)}>
              <FileJson /> JSON
            </Button>
            <Button size="sm" variant="outline" onClick={() => ipc.export.shotsCsv(scene.id)}>
              <Table /> CSV
            </Button>
          </div>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">{scene.summary}{scene.visualDescription ? `；画面：${scene.visualDescription}` : ''}</p>
        <p className="mb-3 text-xs text-muted-foreground">
          AI 拆分镜头会替换当前镜头列表，并在写入前自动保存可恢复的结构检查点；批量拆分会跳过已有镜头的场景。
        </p>

        {shots.length === 0 ? (
          <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
            本场景还没有镜头。点击「AI 拆分镜头」，AI 会把场景画面拆成有序的镜头清单。
          </div>
        ) : (
          <div className="flex gap-4">
            {/* 镜头列表 */}
            <div className="w-56 shrink-0 space-y-1.5">
              {shots.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => setParams((current) => {
                    const next = new URLSearchParams(current)
                    next.set('shot', s.id)
                    return next
                  })}
                  className={cn(
                    'w-full rounded-md border p-2 text-left text-xs',
                    activeShotId === s.id ? 'border-primary bg-accent' : 'hover:bg-accent/60',
                  )}
                >
                  <div className="flex items-center gap-1">
                    <span className="font-medium">镜头 {i + 1}</span>
                    {s.aiVideoDifficulty && (
                      <Badge variant={DIFFICULTY_VARIANT[s.aiVideoDifficulty]} className="ml-auto text-[10px]">
                        {s.aiVideoDifficulty}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-muted-foreground">
                    {s.cameraAngle ?? ''}{s.cameraMovement ? ` · ${s.cameraMovement}` : ''}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">{s.visualDescription}</div>
                </button>
              ))}
            </div>

            {/* 单镜头详情 */}
            {activeShot && (
              <div className="flex-1 space-y-3">
                {/* 镜头元信息 */}
                <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 lg:grid-cols-3">
                    <span>景别：{activeShot.cameraAngle ?? '—'}</span>
                    <span>运动：{activeShot.cameraMovement ?? '—'}</span>
                    <span>情绪：{activeShot.emotion ?? '—'}</span>
                    <span>动作：{activeShot.action ?? '—'}</span>
                    <span>时长：{activeShot.durationSeconds ? `${activeShot.durationSeconds}s` : '—'}</span>
                    <span>人物：{activeShot.characterIds.join('、') || '—'}</span>
                  </div>
                  <div className="mt-1">画面：{activeShot.visualDescription}</div>
                  {activeShot.dialogue && <div className="mt-0.5">对白：{activeShot.dialogue}</div>}
                  {activeShot.narration && <div className="mt-0.5">旁白：{activeShot.narration}</div>}
                  {activeShot.subtitleDraft && <div className="mt-0.5">字幕草稿：{activeShot.subtitleDraft}</div>}
                </div>

                {/* AI 操作 */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button size="sm" variant="ghost" disabled={busy2 !== null} onClick={() => runShotTask(activeShot, 'generate_shot_prompt')}>
                    <Sparkles className="h-3.5 w-3.5" /> {TASK_TYPE_LABELS.generate_shot_prompt}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy2 !== null} onClick={() => runShotTask(activeShot, 'generate_negative_prompt')}>
                    <Sparkles className="h-3.5 w-3.5" /> {TASK_TYPE_LABELS.generate_negative_prompt}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy2 !== null} onClick={() => runShotTask(activeShot, 'rewrite_shot_prompt')}>
                    <Sparkles className="h-3.5 w-3.5" /> {TASK_TYPE_LABELS.rewrite_shot_prompt}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy2 !== null}
                    onClick={() => {
                      const platform = window.prompt('目标视频平台（如 即梦/可灵/Runway/海螺/Pika，可留空）', '')
                      if (platform === null) return
                      runShotTask(activeShot, 'optimize_prompt_for_video_platform', platform || undefined)
                    }}
                  >
                    <Sparkles className="h-3.5 w-3.5" /> {TASK_TYPE_LABELS.optimize_prompt_for_video_platform}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy2 !== null} onClick={() => runReview(activeShot)}>
                    <Sparkles className="h-3.5 w-3.5" /> 镜头审查
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy2 !== null} onClick={() => runCreativeShotTask(activeShot)}>
                    <Sparkles className="h-3.5 w-3.5" /> 视频风险
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy2 !== null} onClick={() => runVideoAssetDraftTask(activeShot)}>
                    <Sparkles className="h-3.5 w-3.5" /> {TASK_TYPE_LABELS.generate_video_asset_drafts}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => savePromptCheckpoint(activeShot)}>
                    <Pencil className="h-3.5 w-3.5" /> 检查点
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="ml-auto"
                    onClick={() =>
                      navigate(
                        `/adaptations/${adaptationProjectId}/video?episode=${scene.episodeId}&scene=${scene.id}&shot=${activeShot.id}`,
                      )
                    }
                  >
                    <Video className="h-3.5 w-3.5" /> 生成视频
                  </Button>
                </div>

                {/* Prompt 编辑器 */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium">镜头 Prompt 编辑器</span>
                    <DraftStateBadge status={saveState} />
                    {saveState === 'recovered' && (
                      <Button size="sm" variant="ghost" onClick={discardRecovery}>放弃恢复草稿</Button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <div>
                      <div className="mb-0.5 text-xs text-muted-foreground">视频 Prompt</div>
                      <Textarea
                        value={draft.videoPrompt}
                        onChange={(e) => updateDraft((current) => ({ ...current, videoPrompt: e.target.value }))}
                        rows={4}
                        className="text-xs"
                      />
                    </div>
                    <div>
                      <div className="mb-0.5 text-xs text-muted-foreground">负面 Prompt</div>
                      <Textarea
                        value={draft.negativePrompt}
                        onChange={(e) => updateDraft((current) => ({ ...current, negativePrompt: e.target.value }))}
                        rows={2}
                        className="text-xs"
                      />
                    </div>
                    <div>
                      <div className="mb-0.5 text-xs text-muted-foreground">图片 Prompt（首帧）</div>
                      <Textarea
                        value={draft.imagePrompt}
                        onChange={(e) => updateDraft((current) => ({ ...current, imagePrompt: e.target.value }))}
                        rows={2}
                        className="text-xs"
                      />
                    </div>
                    <div>
                      <div className="mb-0.5 text-xs text-muted-foreground">封面 Prompt</div>
                      <Textarea
                        value={draft.coverPrompt}
                        onChange={(e) => updateDraft((current) => ({ ...current, coverPrompt: e.target.value }))}
                        rows={2}
                        className="text-xs"
                      />
                    </div>
                    <div>
                      <div className="mb-0.5 text-xs text-muted-foreground">旁白草稿</div>
                      <Textarea
                        value={draft.narration}
                        onChange={(e) => updateDraft((current) => ({ ...current, narration: e.target.value }))}
                        rows={2}
                        className="text-xs"
                      />
                    </div>
                    <div>
                      <div className="mb-0.5 text-xs text-muted-foreground">字幕草稿</div>
                      <Textarea
                        value={draft.subtitleDraft}
                        onChange={(e) => updateDraft((current) => ({ ...current, subtitleDraft: e.target.value }))}
                        rows={4}
                        className="text-xs"
                      />
                    </div>
                    <div>
                      <div className="mb-0.5 text-xs text-muted-foreground">镜头参考图 URL / 本地路径</div>
                      <Input
                        value={draft.referenceInput}
                        onChange={(e) => updateDraft((current) => ({ ...current, referenceInput: e.target.value }))}
                        placeholder="https://... 或 /Users/.../shot-reference.png"
                        className="text-xs"
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                      <div>
                        <div className="mb-0.5 text-xs text-muted-foreground">首帧图 URL / 本地路径</div>
                        <Input
                          value={draft.firstFrameInput}
                          onChange={(e) => updateDraft((current) => ({ ...current, firstFrameInput: e.target.value }))}
                          placeholder="https://... 或 /Users/.../first-frame.png"
                          className="text-xs"
                        />
                      </div>
                      <div>
                        <div className="mb-0.5 text-xs text-muted-foreground">封面图 URL / 本地路径</div>
                        <Input
                          value={draft.coverInput}
                          onChange={(e) => updateDraft((current) => ({ ...current, coverInput: e.target.value }))}
                          placeholder="https://... 或 /Users/.../cover.png"
                          className="text-xs"
                        />
                      </div>
                      <div>
                        <div className="mb-0.5 text-xs text-muted-foreground">旁白音频 URL / 本地路径</div>
                        <Input
                          value={draft.narrationInput}
                          onChange={(e) => updateDraft((current) => ({ ...current, narrationInput: e.target.value }))}
                          placeholder="https://... 或 /Users/.../narration.mp3"
                          className="text-xs"
                        />
                      </div>
                      <div>
                        <div className="mb-0.5 text-xs text-muted-foreground">字幕文件 URL / 本地路径</div>
                        <Input
                          value={draft.subtitleInput}
                          onChange={(e) => updateDraft((current) => ({ ...current, subtitleInput: e.target.value }))}
                          placeholder="https://... 或 /Users/.../subtitle.srt"
                          className="text-xs"
                        />
                      </div>
                    </div>
                    <AssetBadges assets={shotAssets} />
                  </div>
                  <VideoAssetDraftPanel draft={assetDraft} onApply={applyVideoAssetDraft} />
                  <div className="flex justify-end">
                    <Button size="sm" onClick={() => void saveShot()} disabled={!isDirty}>
                      <Pencil className="h-3.5 w-3.5" /> 保存
                    </Button>
                  </div>
                  <ContentVersionPanel
                    targetKind="shot"
                    targetId={activeShot.id}
                    currentContent={draft.videoPrompt}
                    title="Prompt 版本比较"
                    restoreDisabled={isDirty}
                    onRestored={onChanged}
                  />
                </div>

                {/* 审查结果 */}
                <ShotReviewBlock shotId={activeShot.id} />

                {/* Prompt 版本历史 */}
                <div>
                  <div className="mb-1 text-sm font-medium">Prompt 版本历史</div>
                  {versions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">暂无版本。AI 生成/改写后会自动追加版本快照。</p>
                  ) : (
                    <div className="space-y-1">
                      {versions.map((v) => (
                        <div key={v.id} className="rounded-md border p-2 text-xs">
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline">v{v.version}</Badge>
                            <span className="text-muted-foreground">{TASK_TYPE_LABELS[v.taskType] ?? v.taskType}</span>
                            {v.note && <span className="text-muted-foreground">· {v.note}</span>}
                          </div>
                          <div className="mt-1 truncate text-muted-foreground">{v.videoPrompt || '（仅负面/图片 Prompt）'}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        <ContentVersionPanel
          targetKind="scene"
          targetId={scene.id}
          currentContent={renderShotStructureSnapshot(shots.map((shot) => snapshotShot(shot)))}
          title="镜头结构版本"
          versionScope="structure"
          restoreDisabled={isDirty}
          onRestored={onChanged}
        />
        </div>
      </ScrollArea>
      <TextDiffPreviewDialog
        open={textPreview !== null}
        preview={textPreview}
        onAdopt={handleTextAdopt}
        onCancel={() => setTextPreview(null)}
      />
    </>
  )
}

function VideoAssetDraftPanel({ draft, onApply }: { draft: VideoAssetDraftResult | null; onApply: (draft: VideoAssetDraftResult) => void }) {
  if (!draft) return null
  return (
    <div className="rounded-md border p-3 text-xs">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium">视频资产草稿</span>
        {draft.subtitleFormat && <Badge variant="outline">{draft.subtitleFormat.toUpperCase()}</Badge>}
        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => onApply(draft)}>
          <Pencil className="h-3.5 w-3.5" /> 填入镜头草稿
        </Button>
      </div>
      <div className="space-y-1.5 text-muted-foreground">
        <DraftField label="封面 Prompt" value={draft.coverPrompt} />
        <DraftField label="首帧 Prompt" value={draft.firstFramePrompt} />
        <DraftField label="旁白草稿" value={draft.narrationDraft} />
        <DraftField label="字幕草稿" value={draft.subtitleDraft} preserve />
        {draft.voiceSuggestions.length > 0 && (
          <div>
            <div className="font-medium text-foreground">音色建议</div>
            <div className="mt-1 space-y-1">
              {draft.voiceSuggestions.map((voice, index) => (
                <div key={`${voice.characterId ?? voice.characterName}-${index}`} className="rounded bg-muted/40 p-2">
                  <div className="font-medium text-foreground">{voice.characterName}</div>
                  <div>{voice.voiceTone}</div>
                  {voice.delivery && <div>表演：{voice.delivery}</div>}
                  {voice.sampleDirection && <div>样本方向：{voice.sampleDirection}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
        {draft.assetNotes.length > 0 && (
          <div>
            <div className="font-medium text-foreground">制作备注</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {draft.assetNotes.map((note, index) => <li key={index}>{note}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

function DraftField({ label, value, preserve }: { label: string; value?: string; preserve?: boolean }) {
  if (!value) return null
  return (
    <div>
      <div className="font-medium text-foreground">{label}</div>
      <div className={preserve ? 'whitespace-pre-wrap rounded bg-muted/40 p-2' : 'whitespace-pre-wrap'}>{value}</div>
    </div>
  )
}

/** 镜头审查结果（雷达图 + 问题/建议） */
function ShotReviewBlock({ shotId }: { shotId: string }) {
  const [review, setReview] = useState<ShotReview | undefined>(undefined)

  useEffect(() => {
    void (async () => setReview(await ipc.shotReview.get(shotId)))()
  }, [shotId])

  if (!review) return null
  return (
    <div className="flex gap-6 rounded-md border p-3">
      <div className="shrink-0">
        <RadarChart
          axes={[
            { label: '时长合理', value: review.lengthScore },
            { label: '人物精简', value: review.characterCountScore },
            { label: '动作可控', value: review.actionComplexityScore },
            { label: '画面明确', value: review.visualClarityScore },
            { label: '角色一致', value: review.characterConsistencyScore },
            { label: '场景连续', value: review.sceneContinuityScore },
            { label: 'Prompt可控', value: review.promptControllabilityScore },
            { label: '竖屏适配', value: review.verticalSuitabilityScore },
          ]}
        />
        <div className="mt-1 text-center text-xs">
          综合 <span className="font-semibold">{review.overallScore}</span> · 难度{' '}
          <Badge variant={DIFFICULTY_VARIANT[review.aiVideoDifficulty]}>{review.aiVideoDifficulty}</Badge>
        </div>
      </div>
      <div className="flex-1 space-y-2">
        <div>
          <div className="mb-0.5 text-xs font-medium">问题（{review.issues.length}）</div>
          {review.issues.length ? (
            <ul className="list-disc space-y-0.5 pl-5 text-[11px] text-muted-foreground">
              {review.issues.map((it, i) => <li key={i}>{it}</li>)}
            </ul>
          ) : <p className="text-[11px] text-muted-foreground">无</p>}
        </div>
        <div>
          <div className="mb-0.5 text-xs font-medium">建议（{review.suggestions.length}）</div>
          {review.suggestions.length ? (
            <ul className="list-disc space-y-0.5 pl-5 text-[11px] text-muted-foreground">
              {review.suggestions.map((it, i) => <li key={i}>{it}</li>)}
            </ul>
          ) : <p className="text-[11px] text-muted-foreground">无</p>}
        </div>
      </div>
    </div>
  )
}

function createShotDraft(shot: Shot, assets: ProjectAsset[]): ShotDraft {
  const referenceAsset = assets.find(isShotReferenceAsset)
  return {
    videoPrompt: shot.videoPrompt ?? '',
    negativePrompt: shot.negativePrompt ?? '',
    imagePrompt: shot.imagePrompt ?? '',
    coverPrompt: shot.coverPrompt ?? '',
    narration: shot.narration ?? '',
    subtitleDraft: shot.subtitleDraft ?? '',
    referenceInput: referenceAsset ? assetReferenceUrl(referenceAsset) ?? '' : '',
    firstFrameInput: assetInputValue(assets.find((asset) => asset.kind === 'first_frame_image')),
    coverInput: assetInputValue(assets.find((asset) => asset.kind === 'cover_image')),
    narrationInput: assetInputValue(assets.find((asset) => asset.kind === 'narration_audio')),
    subtitleInput: assetInputValue(assets.find((asset) => asset.kind === 'subtitle_file')),
  }
}

function parseShotDraft(value: string): ShotDraft | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<ShotDraft>
    if (!parsed || typeof parsed !== 'object') return undefined
    return {
      videoPrompt: parsed.videoPrompt ?? '',
      negativePrompt: parsed.negativePrompt ?? '',
      imagePrompt: parsed.imagePrompt ?? '',
      coverPrompt: parsed.coverPrompt ?? '',
      narration: parsed.narration ?? '',
      subtitleDraft: parsed.subtitleDraft ?? '',
      referenceInput: parsed.referenceInput ?? '',
      firstFrameInput: parsed.firstFrameInput ?? '',
      coverInput: parsed.coverInput ?? '',
      narrationInput: parsed.narrationInput ?? '',
      subtitleInput: parsed.subtitleInput ?? '',
    }
  } catch {
    return undefined
  }
}

function DraftStateBadge({ status }: { status: DraftSaveState }) {
  const label: Record<DraftSaveState, string> = {
    clean: '已保存',
    dirty: '待保存',
    saving: '保存中',
    saved: '已保存',
    error: '保存失败',
    recovered: '已恢复草稿',
  }
  return <Badge variant={status === 'error' ? 'destructive' : 'secondary'}>{label[status]}</Badge>
}

function isShotReferenceAsset(asset: ProjectAsset): boolean {
  return asset.kind === 'scene_reference' || asset.kind === 'style_reference' || asset.kind === 'character_reference' || asset.kind === 'source_media'
}

function assetInputValue(asset: ProjectAsset | undefined): string {
  return asset ? assetReferenceUrl(asset) ?? '' : ''
}

function AssetBadges({ assets }: { assets: ProjectAsset[] }) {
  if (assets.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {assets.map((asset) => (
        <Badge key={asset.id} variant={ASSET_STATUS_VARIANT[asset.status]}>
          {asset.status === 'missing' ? <AlertTriangle className="h-3 w-3" /> : <ImagePlus className="h-3 w-3" />}
          {ASSET_KIND_LABEL[asset.kind]} · {asset.title} · {ASSET_STATUS_LABEL[asset.status]}
        </Badge>
      ))}
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
