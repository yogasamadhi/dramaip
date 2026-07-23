import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
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
import type { AdaptationProject, AnimaticDraft, AudioTrack, BatchTaskProgress, Character, ComplianceRuleProfile, DeliveryCreativeVariant, Episode, EpisodeCompliancePreflight, EpisodeQualityReport, EpisodeRenderPreflight, LongTask, PlatformDeliveryExport, PlatformDeliveryPreflight, PlatformDeliveryProfile, ProjectAsset, PromptVersion, QualityIssueAcknowledgement, Scene, Script, Shot, ShotReview, ShotStillBatchMode, ShotStillCandidate, ShotStillKind, ShotVisualAssetLock, TextDiffPreviewPayload, VideoAssetDraftResult, VisualAssetVersion, VoiceProfile } from '@sdns/core'
import { animaticDurationSeconds, analyzeVisualContinuity, planShotStillBatch, stillKindLabel, TASK_TYPE_LABELS, renderShotStructureSnapshot, snapshotShot } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { promptAction } from '@/components/ConfirmActionDialog'
import { ASSET_KIND_LABEL, ASSET_STATUS_LABEL, ASSET_STATUS_VARIANT, assetFieldsFromReference, assetReferenceUrl, isVideoReferenceImageAsset } from '@/lib/assets'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RadarChart } from '@/components/charts/RadarChart'
import { ContentVersionPanel } from '@/components/ContentVersionPanel'
import { TextDiffPreviewDialog } from '@/components/TextDiffPreviewDialog'
import { StoryboardCanvas } from '@/components/StoryboardCanvas'
import { ProductionWorkspaceShell } from '@/components/shell/ProductionWorkspaceShell'
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
  }, [sceneId, version])

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
    <ProductionWorkspaceShell
      adaptation={adaptation}
      stage="shots"
      counts={{ targetEpisodes: adaptation.targetEpisodeCount, episodes: episodes.length, scripts: scripts.length, scenes: scenes.length, shots: shots.length }}
      activeEpisodeId={activeEpisode?.id}
      activeEpisodeLabel={activeEpisode ? `第 ${activeEpisode.episodeNumber} 集` : undefined}
      actions={<>
          <Button
            size="sm"
            disabled={!activeScript || scenes.length === 0 || busy !== null}
            onClick={() => void runBatchSplit()}
            title="批量拆分本集镜头"
          >
            {busy === 'batch-shots' ? <Loader2 className="animate-spin" /> : <ListVideo />}
            批量拆分镜头
          </Button>
          <Select
            value={episodeId}
            onValueChange={(v) => setParams((p) => { p.set('episode', v); p.delete('scene'); p.delete('shot'); return p })}
          >
            <SelectTrigger className="w-40" aria-label="选择剧集">
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
        </>}
      exports={[
        { label: '分镜交付包（Markdown）', onSelect: () => ipc.export.dramaShotDeliveryMarkdown(adaptation.id) },
        { label: '分镜交付包（JSON）', onSelect: () => ipc.export.dramaShotDeliveryJson(adaptation.id) },
        { label: '分镜交付表（CSV）', onSelect: () => ipc.export.dramaShotDeliveryCsv(adaptation.id) },
      ]}
    >

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
    </ProductionWorkspaceShell>
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
  const [assetsByShot, setAssetsByShot] = useState<Record<string, ProjectAsset[]>>({})
  const [assetDraft, setAssetDraft] = useState<VideoAssetDraftResult | null>(null)
  const [baseDraft, setBaseDraft] = useState<ShotDraft>(EMPTY_SHOT_DRAFT)
  const [inspectorTab, setInspectorTab] = useState<'info' | 'prompt' | 'assets' | 'review' | 'versions'>('info')
  const [reordering, setReordering] = useState(false)

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
    void Promise.all(shots.map(async (shot) => [shot.id, await ipc.asset.listBySource('shot', shot.id)] as const)).then((entries) => {
      if (!canceled) setAssetsByShot(Object.fromEntries(entries))
    })
    return () => { canceled = true }
  }, [shots])

  async function reorderStoryboard(orderedIds: string[]) {
    setReordering(true)
    try {
      await ipc.shot.reorder(scene.id, orderedIds)
      toast.success('Storyboard 顺序已保存')
      onChanged()
    } catch (error) {
      toast.error(`镜头重排失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setReordering(false)
    }
  }

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
          <div className="space-y-4">
            <StoryboardCanvas
              shots={shots}
              activeShotId={activeShotId}
              assetsByShot={assetsByShot}
              busy={busy !== null || busy2 !== null || reordering}
              onSelect={(shotId) => setParams((current) => {
                const next = new URLSearchParams(current)
                next.set('shot', shotId)
                return next
              })}
              onReorder={reorderStoryboard}
            />
            {sourceProjectId && <VisualContinuityPanel projectId={sourceProjectId} adaptationProjectId={adaptationProjectId} shots={shots} />}
            {sourceProjectId && <AnimaticPanel projectId={sourceProjectId} adaptationProjectId={adaptationProjectId} episodeId={scene.episodeId} />}
            {sourceProjectId && <AudioProductionPanel projectId={sourceProjectId} adaptationProjectId={adaptationProjectId} episodeId={scene.episodeId} />}
            {sourceProjectId && <EpisodeDeliveryPanel projectId={sourceProjectId} adaptationProjectId={adaptationProjectId} episodeId={scene.episodeId} />}
            {sourceProjectId && <EpisodeQualityPanel projectId={sourceProjectId} adaptationProjectId={adaptationProjectId} episodeId={scene.episodeId} />}
            {sourceProjectId && <EpisodeCompliancePanel projectId={sourceProjectId} adaptationProjectId={adaptationProjectId} episodeId={scene.episodeId} />}
            {sourceProjectId && <PlatformDeliveryPanel projectId={sourceProjectId} adaptationProjectId={adaptationProjectId} episodeId={scene.episodeId} />}

            {/* 单镜头 Inspector */}
            {activeShot && (
              <div className="space-y-3 rounded-lg border bg-background p-4">
                <div className="flex flex-wrap gap-1 border-b pb-3" role="tablist" aria-label="镜头 Inspector">
                  {([
                    ['info', '信息'],
                    ['prompt', 'Prompt'],
                    ['assets', '素材'],
                    ['review', '审查'],
                    ['versions', '版本'],
                  ] as const).map(([key, label]) => (
                    <Button
                      key={key}
                      id={`shot-inspector-tab-${key}`}
                      type="button"
                      size="sm"
                      variant={inspectorTab === key ? 'secondary' : 'outline'}
                      role="tab"
                      aria-controls={`shot-inspector-panel-${key}`}
                      aria-selected={inspectorTab === key}
                      onClick={() => setInspectorTab(key)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                <div id="shot-inspector-panel-info" role="tabpanel" aria-labelledby="shot-inspector-tab-info" hidden={inspectorTab !== 'info'}>
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
                    onClick={async () => {
                      const platform = await promptAction({
                        title: '优化视频平台 Prompt',
                        description: '选择目标平台会调整当前镜头的生成提示词；留空则使用通用视频生成建议，原 Prompt 仍可从版本记录恢复。',
                        inputLabel: '目标视频平台（可选）',
                        placeholder: '例如：即梦、可灵、Runway、海螺或 Pika',
                        confirmLabel: '生成优化建议',
                      })
                      if (platform === null) return
                      await runShotTask(activeShot, 'optimize_prompt_for_video_platform', platform || undefined)
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
                </div>

                {/* Prompt 编辑器 */}
                <div id="shot-inspector-panel-prompt" role="tabpanel" aria-labelledby="shot-inspector-tab-prompt" className="space-y-2" hidden={inspectorTab !== 'prompt'}>
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
                        aria-label="视频 Prompt"
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

                <div id="shot-inspector-panel-assets" role="tabpanel" aria-labelledby="shot-inspector-tab-assets" hidden={inspectorTab !== 'assets'}>
                  <StoryboardAssetInspector
                    assets={shotAssets}
                    draft={draft}
                    onUpdate={updateDraft}
                  />
                  {sourceProjectId && <ShotStillCandidatesPanel projectId={sourceProjectId} shotId={activeShot.id} />}
                  {sourceProjectId && <ShotVisualAssetLocksPanel projectId={sourceProjectId} shotId={activeShot.id} />}
                  <div className="mt-3 flex justify-end">
                    <Button size="sm" onClick={() => void saveShot()} disabled={!isDirty}><Pencil className="h-3.5 w-3.5" />保存素材引用</Button>
                  </div>
                </div>

                {/* 审查结果 */}
                <div id="shot-inspector-panel-review" role="tabpanel" aria-labelledby="shot-inspector-tab-review" hidden={inspectorTab !== 'review'}><ShotReviewBlock shotId={activeShot.id} /></div>

                {/* Prompt 版本历史 */}
                <div id="shot-inspector-panel-versions" role="tabpanel" aria-labelledby="shot-inspector-tab-versions" hidden={inspectorTab !== 'versions'}>
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

type StoryboardAssetField = 'referenceInput' | 'firstFrameInput' | 'coverInput' | 'narrationInput' | 'subtitleInput'

const STORYBOARD_ASSET_FIELDS: Array<{ field: StoryboardAssetField; kind: ProjectAsset['kind']; label: string; description: string }> = [
  { field: 'referenceInput', kind: 'scene_reference', label: '场景参考图', description: '构图、布光或风格参考；不会上传本地文件。' },
  { field: 'firstFrameInput', kind: 'first_frame_image', label: '首帧图', description: '作为视频生成或交付的首帧引用。' },
  { field: 'coverInput', kind: 'cover_image', label: '封面图', description: '用于镜头封面与交付预览。' },
  { field: 'narrationInput', kind: 'narration_audio', label: '旁白音频', description: '引用音频路径或远端链接。' },
  { field: 'subtitleInput', kind: 'subtitle_file', label: '字幕文件', description: '引用 SRT、VTT 或 ASS 等字幕文件。' },
]

function StoryboardAssetInspector({ assets, draft, onUpdate }: {
  assets: ProjectAsset[]
  draft: ShotDraft
  onUpdate: (updater: (current: ShotDraft) => ShotDraft) => void
}) {
  return (
    <section className="space-y-3" data-storyboard-assets>
      <div>
        <h3 className="text-sm font-medium">镜头素材 Inspector</h3>
        <p className="text-xs text-muted-foreground">选择或拖入本地文件只会记录本地引用；不会复制、上传或删除源文件。也可继续填写 HTTPS URL。</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {STORYBOARD_ASSET_FIELDS.map((item) => (
          <AssetReferenceControl
            key={item.field}
            asset={assets.find((asset) => asset.kind === item.kind)}
            value={draft[item.field]}
            label={item.label}
            description={item.description}
            kind={item.kind}
            onChange={(value) => onUpdate((current) => ({ ...current, [item.field]: value }))}
          />
        ))}
      </div>
      <AssetBadges assets={assets} />
    </section>
  )
}

const SHOT_LOCK_ROLES = [
  ['character', '角色外观'],
  ['costume', '服装阶段'],
  ['scene', '场景布局'],
  ['style', '布光 / 色彩'],
  ['prop', '关键道具'],
  ['voice', '声音参考'],
] as const

const SHOT_STILL_KINDS: Array<[ShotStillKind, string]> = [
  ['still', '分镜静帧'],
  ['first_frame', '视频首帧'],
  ['last_frame', '视频尾帧'],
  ['cover', '镜头封面'],
]

const SHOT_STILL_STATUS_LABEL: Record<ShotStillCandidate['status'], string> = {
  candidate: '候选',
  adopted: '已采用',
  superseded: '历史采用',
  rejected: '未采用',
}

function ShotStillCandidatesPanel({ projectId, shotId }: { projectId: string; shotId: string }) {
  const [assets, setAssets] = useState<ProjectAsset[]>([])
  const [candidates, setCandidates] = useState<ShotStillCandidate[]>([])
  const [kind, setKind] = useState<ShotStillKind>('first_frame')
  const [assetId, setAssetId] = useState('')
  const [label, setLabel] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const availableAssets = useMemo(
    () => assets.filter((asset) => asset.status !== 'missing' && isVideoReferenceImageAsset(asset)),
    [assets],
  )
  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets])

  async function load() {
    const [nextAssets, nextCandidates] = await Promise.all([
      ipc.asset.listByProject(projectId),
      ipc.shotStill.listByShot(shotId),
    ])
    setAssets(nextAssets)
    setCandidates(nextCandidates)
  }
  useEffect(() => { void load().catch((error) => toast.error(`读取静帧候选失败：${error instanceof Error ? error.message : String(error)}`)) }, [projectId, shotId])
  useEffect(() => {
    if (assetId && availableAssets.some((asset) => asset.id === assetId)) return
    setAssetId(availableAssets[0]?.id ?? '')
  }, [assetId, availableAssets])

  async function addCandidate() {
    const asset = assetsById.get(assetId)
    if (!asset) return toast.error('请先选择一个已归档的图片素材')
    setBusy(true)
    try {
      const kindLabel = SHOT_STILL_KINDS.find(([value]) => value === kind)?.[1] ?? kind
      await ipc.shotStill.create({
        projectId,
        shotId,
        assetId,
        kind,
        label: label.trim() || `${kindLabel} · ${asset.title}`,
        notes: notes.trim() || undefined,
      })
      setLabel('')
      setNotes('')
      await load()
      toast.success('已收录为静帧候选；采用前不会改动当前镜头。')
    } catch (error) {
      toast.error(`收录候选失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  async function adopt(candidate: ShotStillCandidate) {
    setBusy(true)
    try {
      await ipc.shotStill.adopt(candidate.id)
      await load()
      toast.success(candidate.status === 'superseded' ? '已采用历史候选并完成可回退切换。' : '已采用静帧候选；同类旧采用版本已保留为历史记录。')
    } catch (error) {
      toast.error(`采用静帧失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  return <section className="mt-3 space-y-2 rounded-md border bg-muted/20 p-3" data-shot-still-candidates>
    <div><h3 className="text-sm font-medium">静帧 / 首尾帧 / 封面候选</h3><p className="text-xs text-muted-foreground">先收录多个候选，再人工采用。采用旧候选可回退；不会覆盖任何历史图片。镜头 Prompt 更新后，系统只提示复核本镜头。</p></div>
    <div className="grid gap-2 lg:grid-cols-[8rem_1fr_1fr_auto]">
      <select aria-label="静帧类型" value={kind} onChange={(event) => setKind(event.target.value as ShotStillKind)} className="h-9 rounded-md border bg-background px-2 text-xs">{SHOT_STILL_KINDS.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select>
      <select aria-label="静帧候选素材" value={assetId} onChange={(event) => setAssetId(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-xs"><option value="">选择已归档图片</option>{availableAssets.map((asset) => <option key={asset.id} value={asset.id}>{ASSET_KIND_LABEL[asset.kind]} · {asset.title}</option>)}</select>
      <Input aria-label="静帧候选名称" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="候选名称（可选）" className="text-xs" />
      <Button size="sm" onClick={() => void addCandidate()} disabled={!assetId || busy}>收录候选</Button>
    </div>
    <Textarea aria-label="静帧候选备注" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="可选：说明适用镜头、构图或需要人工检查的风险" className="min-h-14 text-xs" />
    {availableAssets.length === 0 && <p className="rounded border border-dashed p-2 text-xs text-muted-foreground">尚无可用图片素材。先在上方保存首帧、封面或画面参考素材引用，再收录为候选。</p>}
    {candidates.length === 0 ? <p className="rounded border border-dashed p-2 text-xs text-muted-foreground">还没有候选。建议至少保留一个分镜静帧和一个首帧候选，再进入视频生成。</p> : <div className="space-y-1">{candidates.map((candidate) => {
      const asset = assetsById.get(candidate.assetId)
      const typeLabel = SHOT_STILL_KINDS.find(([value]) => value === candidate.kind)?.[1] ?? candidate.kind
      return <div key={candidate.id} className="rounded border bg-background/70 p-2 text-xs">
        <div className="flex flex-wrap items-center gap-2"><Badge variant={candidate.status === 'adopted' ? 'default' : candidate.staleReason ? 'destructive' : 'outline'}>{typeLabel} · {SHOT_STILL_STATUS_LABEL[candidate.status]}</Badge><span className="font-medium">{candidate.label}</span><span className="text-muted-foreground">{asset?.title ?? '素材记录不可用'}</span>{candidate.status !== 'adopted' && <Button size="sm" variant="outline" disabled={busy || !asset} onClick={() => void adopt(candidate)}>{candidate.status === 'superseded' ? '采用此历史版本' : '采用此候选'}</Button>}</div>
        {asset && assetReferenceUrl(asset) && <img src={assetReferenceUrl(asset)} alt={`${candidate.label}预览`} className="mt-2 h-20 rounded border object-cover" />}
        {candidate.notes && <p className="mt-1 text-muted-foreground">备注：{candidate.notes}</p>}
        {candidate.staleReason && <p className="mt-1 text-destructive">需复核：{candidate.staleReason}</p>}
      </div>
    })}</div>}
  </section>
}

function VisualContinuityPanel({ projectId, adaptationProjectId, shots }: { projectId: string; adaptationProjectId: string; shots: Shot[] }) {
  const [versions, setVersions] = useState<VisualAssetVersion[]>([])
  const [locks, setLocks] = useState<ShotVisualAssetLock[]>([])
  const [stillCandidates, setStillCandidates] = useState<ShotStillCandidate[]>([])
  const [acknowledgements, setAcknowledgements] = useState<QualityIssueAcknowledgement[]>([])
  const [riskNotes, setRiskNotes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  async function load() {
    setLoading(true)
    try {
      const [nextVersions, lockGroups, stillGroups, nextAcknowledgements] = await Promise.all([
        ipc.visualAsset.listByProject(projectId),
        Promise.all(shots.map((shot) => ipc.visualAsset.listLocksByShot(shot.id))),
        Promise.all(shots.map((shot) => ipc.shotStill.listByShot(shot.id))),
        ipc.creative.listQualityIssueAcknowledgements(projectId),
      ])
      setVersions(nextVersions)
      setLocks(lockGroups.flat())
      setStillCandidates(stillGroups.flat())
      setAcknowledgements(nextAcknowledgements)
    } catch (error) {
      toast.error(`读取视觉连续性失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [projectId, shots])
  const report = useMemo(() => analyzeVisualContinuity({ shots, locks, versions, stillCandidates }), [shots, locks, versions, stillCandidates])
  const latestAcknowledgements = useMemo(() => {
    const latest = new Map<string, QualityIssueAcknowledgement>()
    for (const acknowledgement of acknowledgements) {
      const previous = latest.get(acknowledgement.issueId)
      if (!previous || acknowledgement.createdAt > previous.createdAt || (acknowledgement.createdAt === previous.createdAt && acknowledgement.id > previous.id)) latest.set(acknowledgement.issueId, acknowledgement)
    }
    return latest
  }, [acknowledgements])
  async function acceptRisk(issue: (typeof report.issues)[number]) {
    const issueId = visualContinuityIssueId(issue)
    const note = riskNotes[issueId]?.trim()
    if (!note) return toast.error('请先记录接受该视觉风险的理由，便于后续复检。')
    try {
      await ipc.creative.acknowledgeQualityIssue({
        projectId,
        adaptationProjectId,
        issueId,
        issueKind: `visual_${issue.kind}`,
        issueTitle: `镜头视觉检查：${issue.kind}`,
        issueDetail: issue.message,
        disposition: 'accepted',
        note,
      })
      await load()
      toast.success('已记录人工风险接受；原始检查项仍会保留。')
    } catch (error) {
      toast.error(`记录风险接受失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return <section className="space-y-2 rounded-md border bg-muted/20 p-3" data-visual-continuity>
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-medium">静帧与视觉连续性</h3><p className="text-xs text-muted-foreground">{report.checkedShots} 镜头 · {report.lockedShots} 已锁定 · {report.stillCoveredShots} 已采用静帧 · {report.staleShots} 需重做确认。像素级人脸/文字识别尚未安装，以下为可解释的版本与提示词预检。</p></div><Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>复核本场景</Button></div>
    {report.issues.length === 0 ? <p className="text-xs text-emerald-700 dark:text-emerald-300">当前没有版本锁或画幅提示问题。</p> : <div className="space-y-1">{report.issues.map((issue) => {
      const issueId = visualContinuityIssueId(issue)
      const acknowledgement = latestAcknowledgements.get(issueId)
      return <div key={issueId} className={issue.severity === 'blocking' ? 'rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive' : 'rounded border bg-background/60 p-2 text-xs text-muted-foreground'}><p>{issue.message}</p>{acknowledgement?.disposition === 'accepted' ? <p className="mt-1">已接受风险：{acknowledgement.note}</p> : <div className="mt-2 flex flex-wrap gap-2"><Input aria-label={`${issueId} 风险理由`} value={riskNotes[issueId] ?? ''} onChange={(event) => setRiskNotes((current) => ({ ...current, [issueId]: event.target.value }))} placeholder="接受风险的理由（必填）" className="h-8 max-w-sm bg-background text-xs text-foreground" /><Button size="sm" variant="outline" onClick={() => void acceptRisk(issue)}>记录接受风险</Button></div>}</div>
    })}</div>}
    <ShotStillBatchPlanner shots={shots} candidates={stillCandidates} locks={locks} versions={versions} />
  </section>
}

function visualContinuityIssueId(issue: { shotId: string; kind: string; visualAssetVersionId?: string; message: string }): string {
  return `visual-continuity:${issue.shotId}:${issue.kind}:${issue.visualAssetVersionId ?? issue.message}`
}

function AnimaticPanel({ projectId, adaptationProjectId, episodeId }: { projectId: string; adaptationProjectId: string; episodeId: string }) {
  const [drafts, setDrafts] = useState<AnimaticDraft[]>([])
  const [working, setWorking] = useState<Pick<AnimaticDraft, 'sourceFingerprint' | 'clips' | 'annotations'> | null>(null)
  const [assets, setAssets] = useState<ProjectAsset[]>([])
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [playing, setPlaying] = useState(false)
  const [clipIndex, setClipIndex] = useState(0)
  const [draggedClipIndex, setDraggedClipIndex] = useState<number | null>(null)
  const [annotationNote, setAnnotationNote] = useState('')
  const [annotationCategory, setAnnotationCategory] = useState<AnimaticDraft['annotations'][number]['category']>('pacing')
  const [reviewNote, setReviewNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    const [nextDrafts, nextAssets] = await Promise.all([ipc.animatic.listByEpisode(episodeId), ipc.asset.listByProject(projectId)])
    setDrafts(nextDrafts)
    setAssets(nextAssets)
  }

  useEffect(() => { void load().catch((error) => toast.error(`读取 Animatic 失败：${error instanceof Error ? error.message : String(error)}`)) }, [episodeId])

  async function initialize() {
    setBusy(true)
    try {
      const initial = await ipc.animatic.initialize(projectId, episodeId)
      setWorking({ sourceFingerprint: initial.sourceFingerprint, clips: initial.clips, annotations: [] })
      toast.success('已从当前分集初始化 Animatic；缺少静帧的镜头保留为空位。')
    } catch (error) {
      toast.error(`初始化失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!working) return
    setBusy(true)
    try {
      const saved = await ipc.animatic.save({ projectId, adaptationProjectId, episodeId, ...working })
      setWorking({ sourceFingerprint: saved.sourceFingerprint, clips: saved.clips, annotations: saved.annotations })
      await load()
      toast.success(`已保存 Animatic v${saved.versionNumber}；旧版本仍可回看。`)
    } catch (error) {
      toast.error(`保存失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  async function review(status: 'approved' | 'returned') {
    const latest = drafts[0]
    if (!latest) return
    if (!reviewNote.trim()) return toast.error('请记录通过或退回试播的理由。')
    setBusy(true)
    try {
      await ipc.animatic.review(latest.id, { status, reviewNote: reviewNote.trim() })
      await load()
      toast.success(status === 'approved' ? '已记录试播通过。' : '已记录退回；请只修改对应镜头后另存新版本。')
    } catch (error) {
      toast.error(`记录审核失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const saved = drafts.find((draft) => draft.id === selectedVersionId) ?? drafts[0]
  const current = working ?? saved
  const currentClip = current?.clips[clipIndex]
  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets])
  useEffect(() => { setClipIndex(0); setPlaying(false) }, [current?.sourceFingerprint])

  useEffect(() => {
    if (!playing || !currentClip || !current) return
    const timer = window.setTimeout(() => setClipIndex((index) => index + 1 < current.clips.length ? index + 1 : 0), currentClip.durationSeconds * 1_000)
    return () => window.clearTimeout(timer)
  }, [current, currentClip, playing])

  function updateClip(clipId: string, patch: Partial<AnimaticDraft['clips'][number]>) {
    setWorking((value) => value ? {
      ...value,
      clips: value.clips.map((clip) => clip.id === clipId ? { ...clip, ...patch } : clip),
    } : value)
  }

  function moveClip(fromIndex: number, toIndex: number) {
    if (!working || fromIndex === toIndex) return
    const clips = [...working.clips]
    const [moved] = clips.splice(fromIndex, 1)
    clips.splice(toIndex, 0, moved)
    setWorking({ ...working, clips: clips.map((clip, index) => ({ ...clip, orderIndex: index })) })
    setClipIndex(toIndex)
    setDraggedClipIndex(null)
  }

  function updateCurrentCrop(patch: Partial<NonNullable<AnimaticDraft['clips'][number]['crop']>>) {
    if (!currentClip) return
    const next = { zoom: 1, x: 0, y: 0, ...currentClip.crop, ...patch }
    updateClip(currentClip.id, {
      crop: {
        zoom: Math.min(2, Math.max(0.8, next.zoom)),
        x: Math.min(50, Math.max(-50, next.x)),
        y: Math.min(50, Math.max(-50, next.y)),
      },
    })
  }

  function addAnnotation() {
    if (!working || !currentClip || !annotationNote.trim()) return toast.error('请先填写批注内容。')
    const atSeconds = working.clips.slice(0, clipIndex).reduce((sum, clip) => sum + clip.durationSeconds, 0)
    setWorking((value) => value ? { ...value, annotations: [...value.annotations, { id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${clipIndex}`, atSeconds, shotId: currentClip.shotId, category: annotationCategory, note: annotationNote.trim(), createdAt: new Date().toISOString() }] } : value)
    setAnnotationNote('')
  }

  const crop = currentClip?.crop ?? { zoom: 1, x: 0, y: 0 }

  return <section className="space-y-2 rounded-md border bg-muted/20 p-3" data-animatic-panel>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h3 className="text-sm font-medium">试播 Animatic</h3><p className="text-xs text-muted-foreground">低成本静帧时间线，仅用于节奏与信息量评审；不生成高清视频、不调用 TTS 或图片 Provider。</p></div>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void initialize()}>从当前分集初始化</Button>
    </div>
    {!current ? <p className="rounded border border-dashed p-2 text-xs text-muted-foreground">尚无 Animatic。初始化后可调整时长、拖拽顺序和静帧取景，再另存版本。</p> : <>
      <div className="grid gap-3 lg:grid-cols-[13rem_1fr]">
        <div className="overflow-hidden rounded border bg-black">
          <div className="flex aspect-[9/16] items-center justify-center overflow-hidden text-center text-xs text-white">
            {currentClip?.assetId && assetsById.get(currentClip.assetId) && assetReferenceUrl(assetsById.get(currentClip.assetId)!)
              ? <img src={assetReferenceUrl(assetsById.get(currentClip.assetId)!)} alt={`Animatic 镜头 ${clipIndex + 1}`} className="h-full w-full object-cover" style={{ objectPosition: `${50 + crop.x}% ${50 + crop.y}%`, transform: `scale(${crop.zoom})` }} />
              : <span>镜头 {clipIndex + 1} 静帧空位<br />导入并采用图片后重新初始化</span>}
          </div>
          <div className="flex items-center justify-between p-2 text-xs text-white"><Button size="sm" variant="secondary" onClick={() => setPlaying((value) => !value)}>{playing ? '暂停' : '播放'}</Button><span>{clipIndex + 1} / {current.clips.length} · {animaticDurationSeconds(current.clips).toFixed(1)} 秒</span></div>
        </div>
        <div className="space-y-1">
          {current.clips.map((clip, index) => <div key={clip.id} draggable={Boolean(working)} onDragStart={() => setDraggedClipIndex(index)} onDragOver={(event) => { if (working) event.preventDefault() }} onDrop={() => { if (draggedClipIndex !== null) moveClip(draggedClipIndex, index) }} className={`grid grid-cols-[4rem_6rem_1fr] items-center gap-2 rounded border p-2 text-xs ${index === clipIndex ? 'border-primary bg-primary/5' : 'bg-background/70'} ${working ? 'cursor-grab' : ''}`}>
            <button className="text-left" onClick={() => setClipIndex(index)}>镜头 {index + 1}</button>
            <Input aria-label={`镜头 ${index + 1} 时长`} type="number" min="1" max="15" step="0.1" value={clip.durationSeconds} disabled={!working} onChange={(event) => updateClip(clip.id, { durationSeconds: Math.min(15, Math.max(1, Number(event.target.value) || 1)) })} />
            <span className={clip.assetId ? 'text-emerald-700' : 'text-amber-700'}>{clip.assetId ? `已引用静帧 · ${clip.transition}` : '静帧空位：导入并采用后重新初始化'}</span>
          </div>)}
        </div>
      </div>
      {working && currentClip && <div className="grid gap-2 rounded border bg-background/60 p-2 md:grid-cols-3">
        <Input aria-label="当前静帧缩放" type="number" min="0.8" max="2" step="0.05" value={crop.zoom} onChange={(event) => updateCurrentCrop({ zoom: Number(event.target.value) || 1 })} />
        <Input aria-label="当前静帧横向取景" type="number" min="-50" max="50" step="1" value={crop.x} onChange={(event) => updateCurrentCrop({ x: Number(event.target.value) || 0 })} />
        <Input aria-label="当前静帧纵向取景" type="number" min="-50" max="50" step="1" value={crop.y} onChange={(event) => updateCurrentCrop({ y: Number(event.target.value) || 0 })} />
        <p className="md:col-span-3 text-xs text-muted-foreground">拖拽右侧镜头卡调整顺序；当前镜头可调整缩放、横向和纵向取景，原始静帧不会被改写。</p>
      </div>}
      <div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy || !working} onClick={() => void save()}>另存 Animatic 版本</Button><select aria-label="回看 Animatic 版本" value={selectedVersionId} onChange={(event) => { setWorking(null); setSelectedVersionId(event.target.value) }} className="h-8 rounded border bg-background px-2 text-xs"><option value="">最新已存版本</option>{drafts.map((draft) => <option key={draft.id} value={draft.id}>v{draft.versionNumber} · {draft.status}</option>)}</select><span className="self-center text-xs text-muted-foreground">临时声音：未配置时以静音预览，正式音轨在 LM5-13 处理。</span></div>
      <div className="rounded border bg-background/60 p-2"><div className="mb-1 text-xs font-medium">时间点批注（定位到当前镜头）</div><div className="flex flex-wrap gap-2"><select aria-label="Animatic 批注类别" value={annotationCategory} onChange={(event) => setAnnotationCategory(event.target.value as typeof annotationCategory)} className="h-8 rounded border bg-background px-2 text-xs"><option value="pacing">节奏</option><option value="information">信息量</option><option value="hook">钩子</option><option value="shot">镜头</option></select><Input aria-label="Animatic 批注内容" value={annotationNote} onChange={(event) => setAnnotationNote(event.target.value)} placeholder="当前镜头的批注" className="h-8 max-w-sm text-xs" /><Button size="sm" variant="outline" disabled={!working} onClick={addAnnotation}>添加批注</Button></div>{current.annotations.length > 0 && <div className="mt-2 space-y-1">{current.annotations.map((annotation) => <p key={annotation.id} className="text-xs text-muted-foreground">{annotation.atSeconds.toFixed(1)} 秒 · {annotation.category}：{annotation.note}</p>)}</div>}</div>
      <Textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="试播通过或退回的理由（必填，便于后续只返工问题镜头）" className="min-h-16 text-xs" />
      <div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy || !drafts[0] || drafts[0].status !== 'draft'} onClick={() => void review('returned')}>退回试播</Button><Button size="sm" disabled={busy || !drafts[0] || drafts[0].status !== 'draft'} onClick={() => void review('approved')}>通过试播</Button></div>
    </>}
  </section>
}

function AudioProductionPanel({ projectId, adaptationProjectId, episodeId }: { projectId: string; adaptationProjectId: string; episodeId: string }) {
  const [voices, setVoices] = useState<VoiceProfile[]>([])
  const [tracks, setTracks] = useState<AudioTrack[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [assets, setAssets] = useState<ProjectAsset[]>([])
  const [label, setLabel] = useState('默认旁白')
  const [characterId, setCharacterId] = useState('')
  const [voiceTone, setVoiceTone] = useState('自然、清晰')
  const [kind, setKind] = useState<AudioTrack['kind']>('narration')
  const [busy, setBusy] = useState(false)
  async function load() {
    const [nextVoices, nextTracks, nextCharacters, nextAssets] = await Promise.all([ipc.audio.listVoiceProfiles(projectId), ipc.audio.listTracksByEpisode(episodeId), ipc.character.list(projectId), ipc.asset.listByProject(projectId)])
    setVoices(nextVoices); setTracks(nextTracks); setCharacters(nextCharacters); setAssets(nextAssets)
  }
  useEffect(() => { void load().catch((error) => toast.error(`读取音频制作数据失败：${error instanceof Error ? error.message : String(error)}`)) }, [episodeId, projectId])
  async function createVoice() {
    setBusy(true)
    try { await ipc.audio.createVoiceProfile({ projectId, characterId: characterId || undefined, label: label.trim() || '未命名声音', voiceTone: voiceTone.trim() || undefined, pronunciationDictionary: {} }); await load(); toast.success('已保存声音 Profile；声音样本仍须在权利台账中确认授权。') } catch (error) { toast.error(`保存声音 Profile 失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(false) }
  }
  async function initializeTrack() {
    setBusy(true)
    try {
      const initial = await ipc.animatic.initialize(projectId, episodeId)
      const audioAssets = assets.filter((asset) => ({ dialogue: 'dialogue_audio', narration: 'narration_audio', bgm: 'bgm_audio', sfx: 'sfx_audio' } as const)[kind] === asset.kind)
      const clips: AudioTrack['clips'] = (kind === 'bgm' || kind === 'sfx') ? [] : initial.clips.flatMap((clip) => {
        const text = kind === 'dialogue' ? clip.dialogue : kind === 'narration' ? clip.narration : undefined
        if (!text) return []
        return [{ id: globalThis.crypto?.randomUUID?.() ?? `audio:${clip.id}`, shotId: clip.shotId, text, assetId: audioAssets[0]?.id, startSeconds: initial.clips.slice(0, clip.orderIndex).reduce((total, item) => total + item.durationSeconds, 0), durationSeconds: clip.durationSeconds, volume: 1, fadeInSeconds: 0, fadeOutSeconds: 0, loop: false, duckingIntent: false }]
      })
      if (!clips.length && kind !== 'bgm' && kind !== 'sfx') return toast.error('当前分集没有可初始化的对应台词；请先在镜头中填写对白或旁白。')
      if (!clips.length) clips.push({ id: globalThis.crypto?.randomUUID?.() ?? `audio:${kind}`, startSeconds: 0, volume: kind === 'bgm' ? 0.35 : 1, fadeInSeconds: 0, fadeOutSeconds: 0, loop: kind === 'bgm', duckingIntent: kind === 'bgm', assetId: audioAssets[0]?.id })
      const saved = await ipc.audio.saveTrack({ projectId, adaptationProjectId, episodeId, kind, label: `${kind === 'dialogue' ? '对白' : kind === 'narration' ? '旁白' : kind === 'bgm' ? 'BGM' : '音效'} v${tracks.filter((track) => track.kind === kind).length + 1}`, sourceFingerprint: initial.sourceFingerprint, clips })
      await load(); toast.success(`已保存 ${saved.label}；可在后续版本替换人工导入音频。`)
    } catch (error) { toast.error(`初始化音轨失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(false) }
  }
  return <section className="space-y-2 rounded-md border bg-muted/20 p-3" data-audio-production-panel>
    <div><h3 className="text-sm font-medium">声音与音频轨</h3><p className="text-xs text-muted-foreground">手工导入的对白、旁白、BGM、音效可先形成可追溯轨道；此处不调用 TTS 或声音克隆。</p></div>
    <div className="grid gap-2 md:grid-cols-3"><Input aria-label="声音 Profile 名称" value={label} onChange={(event) => setLabel(event.target.value)} /><select aria-label="声音 Profile 角色" value={characterId} onChange={(event) => setCharacterId(event.target.value)} className="h-9 rounded border bg-background px-2 text-xs"><option value="">旁白/通用声音</option>{characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select><Input aria-label="音色描述" value={voiceTone} onChange={(event) => setVoiceTone(event.target.value)} /></div>
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy || !label.trim()} onClick={() => void createVoice()}>新建声音 Profile</Button>{voices.map((voice) => <Button key={voice.id} size="sm" variant={voice.status === 'adopted' ? 'default' : 'outline'} disabled={busy} onClick={() => void ipc.audio.adoptVoiceProfile(voice.id).then(load)}>采用 {voice.label}</Button>)}</div>
    <div className="flex flex-wrap gap-2"><select aria-label="音轨类型" value={kind} onChange={(event) => setKind(event.target.value as AudioTrack['kind'])} className="h-9 rounded border bg-background px-2 text-xs"><option value="dialogue">对白</option><option value="narration">旁白</option><option value="bgm">BGM</option><option value="sfx">音效</option></select><Button size="sm" disabled={busy} onClick={() => void initializeTrack()}>从当前分集另存音轨版本</Button><span className="self-center text-xs text-muted-foreground">已导入匹配素材：{assets.filter((asset) => asset.kind.endsWith('_audio')).length}</span></div>
    <div className="space-y-1">{tracks.length === 0 ? <p className="rounded border border-dashed p-2 text-xs text-muted-foreground">尚无音轨。先导入音频素材，或从镜头对白/旁白初始化一版临时轨。</p> : tracks.map((track) => <div key={track.id} className="flex flex-wrap items-center gap-2 rounded border bg-background/70 p-2 text-xs"><Badge variant={track.status === 'adopted' ? 'default' : track.status === 'stale' ? 'destructive' : 'outline'}>{track.kind} · v{track.versionNumber}</Badge><span>{track.label} · {track.clips.length} 段</span>{track.staleReason && <span className="text-destructive">{track.staleReason}</span>}<Button size="sm" variant="outline" disabled={busy || track.status === 'adopted' || track.status === 'stale'} onClick={() => void ipc.audio.adoptTrack(track.id).then(load)}>采用此轨</Button></div>)}</div>
  </section>
}

function EpisodeDeliveryPanel({ projectId, adaptationProjectId, episodeId }: { projectId: string; adaptationProjectId: string; episodeId: string }) {
  const [preflight, setPreflight] = useState<EpisodeRenderPreflight | null>(null)
  const [tracks, setTracks] = useState<AudioTrack[]>([])
  const [mutedTrackIds, setMutedTrackIds] = useState<string[]>([])
  const [task, setTask] = useState<LongTask | undefined>()
  const [taskStaleReason, setTaskStaleReason] = useState<string | undefined>()
  const [busy, setBusy] = useState<'preflight' | 'render' | 'cancel' | 'retry' | null>(null)
  const input = useMemo(() => ({ projectId, adaptationProjectId, episodeId, mutedTrackIds }), [adaptationProjectId, episodeId, mutedTrackIds, projectId])

  const refreshTask = useCallback(async () => {
    const history = await ipc.episodeRender.listByEpisode(input)
    const latest = history[0]
    setTask(latest?.task)
    setTaskStaleReason(latest?.staleReason)
  }, [input])

  useEffect(() => {
    void Promise.all([ipc.audio.listTracksByEpisode(episodeId), refreshTask()])
      .then(([nextTracks]) => setTracks(nextTracks))
      .catch((error) => toast.error(`读取交付状态失败：${error instanceof Error ? error.message : String(error)}`))
  }, [episodeId, refreshTask])

  useEffect(() => {
    if (!task || (task.status !== 'pending' && task.status !== 'running')) return
    const timer = window.setInterval(() => { void refreshTask() }, 1_000)
    return () => window.clearInterval(timer)
  }, [refreshTask, task])

  async function inspect() {
    setBusy('preflight')
    try {
      const next = await ipc.episodeRender.preflight(input)
      setPreflight(next)
      if (next.ok) toast.success('交付预检通过：已锁定当前版本、音轨和字幕谱系。')
      else toast.error(`交付预检发现 ${next.blockers.length} 项阻塞；不会输出占位 MP4。`)
    } catch (error) {
      toast.error(`交付预检失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(null) }
  }

  async function render() {
    if (!preflight?.ok) return toast.error('请先运行并通过交付预检。')
    setBusy('render')
    try {
      const result = await ipc.episodeRender.start(input)
      if (!result.ok) {
        toast.error(result.error ?? '无法开始渲染。')
        return
      }
      setTask(result.task)
      setTaskStaleReason(undefined)
      toast.success('已创建本地 MP4 渲染任务；可取消，应用重启后可安全重试。')
    } catch (error) {
      toast.error(`开始渲染失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(null) }
  }

  async function cancel() {
    if (!task) return
    setBusy('cancel')
    try {
      const result = await ipc.longTask.cancel(task.id)
      if (!result.ok) toast.error(result.error ?? '任务无法取消。')
      await refreshTask()
    } catch (error) { toast.error(`取消失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(null) }
  }

  async function retry() {
    if (!task) return
    setBusy('retry')
    try {
      const result = await ipc.longTask.retry(task.id)
      if (!result.ok) toast.error(result.error ?? '任务无法重试。')
      await refreshTask()
    } catch (error) { toast.error(`重试失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(null) }
  }

  function toggleMute(trackId: string) {
    setMutedTrackIds((current) => current.includes(trackId) ? current.filter((id) => id !== trackId) : [...current, trackId])
    setPreflight(null)
  }

  const archive = task?.output?.archive as { mp4Path?: string; srtPath?: string; vttPath?: string; audioPath?: string; manifestPath?: string } | undefined
  const adoptedTracks = tracks.filter((track) => track.status === 'adopted')
  return <section className="space-y-2 rounded-md border bg-muted/20 p-3" data-episode-delivery-panel>
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-medium">最终交付：时间线、字幕与 MP4</h3><p className="text-xs text-muted-foreground">只使用已审核 Animatic、已采用且未过期音轨、项目资产库中的本地媒体。成片为 720×1280 / H.264 + AAC，字幕烧录在竖屏安全区；不会把静帧空位或无声占位伪装成成片。</p></div><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void inspect()}>{busy === 'preflight' ? <Loader2 className="animate-spin" /> : null}运行交付预检</Button></div>
    <div className="rounded border bg-background/60 p-2"><p className="mb-1 text-xs font-medium">音轨版本与静音（采用=锁定版本）</p>{adoptedTracks.length === 0 ? <p className="text-xs text-amber-700">尚无已采用音轨；正式交付将被阻止。</p> : <div className="flex flex-wrap gap-2">{adoptedTracks.map((track) => <label key={track.id} className="flex items-center gap-1 rounded border px-2 py-1 text-xs"><input type="checkbox" checked={!mutedTrackIds.includes(track.id)} onChange={() => toggleMute(track.id)} />{track.kind} · v{track.versionNumber} · {track.label}</label>)}</div>}<p className="mt-1 text-xs text-muted-foreground">取消勾选会以“静音”写入本次渲染任务的谱系，不会改写原音轨版本。</p></div>
    {preflight && <div className={preflight.ok ? 'rounded border border-emerald-500/40 bg-emerald-500/5 p-2 text-xs' : 'rounded border border-destructive/40 bg-destructive/5 p-2 text-xs'}>
      <div className="flex flex-wrap items-center gap-2"><Badge variant={preflight.ok ? 'default' : 'destructive'}>{preflight.ok ? '可交付' : '已阻止'}</Badge>{preflight.plan && <span>{preflight.plan.visualClips.length} 段画面 · {preflight.plan.subtitles.length} 条字幕 · {preflight.plan.durationSeconds.toFixed(1)} 秒</span>}{preflight.ffmpegPath && <span className="text-muted-foreground">FFmpeg 已就绪</span>}</div>
      {preflight.blockers.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4 text-destructive">{preflight.blockers.map((message) => <li key={message}>{message}</li>)}</ul>}
      {preflight.warnings.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">{preflight.warnings.map((message) => <li key={message}>{message}</li>)}</ul>}
      {preflight.plan && <div className="mt-2 flex flex-wrap gap-1">{preflight.plan.visualClips.map((clip) => <Badge key={clip.id} variant="outline">镜头 {clip.orderIndex + 1} · {clip.source.kind === 'video' ? '视频' : clip.source.kind === 'still' ? '静帧合成' : '缺素材'} · {clip.transition}</Badge>)}</div>}
    </div>}
    <div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy !== null || !preflight?.ok || task?.status === 'running' || task?.status === 'pending'} onClick={() => void render()}>{busy === 'render' ? <Loader2 className="animate-spin" /> : <Video className="h-3.5 w-3.5" />}渲染 MP4</Button>{(task?.status === 'pending' || task?.status === 'running') && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void cancel()}>取消渲染</Button>}{(task?.status === 'failed' || task?.status === 'canceled') && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void retry()}>修正后重试</Button>}{task && <Badge variant={taskStaleReason ? 'destructive' : task.status === 'success' ? 'default' : task.status === 'failed' ? 'destructive' : 'outline'}>任务：{taskStaleReason ? 'stale' : task.status}</Badge>}</div>
    {taskStaleReason && <p className="rounded border border-amber-500/40 p-2 text-xs text-amber-700">历史成片仍可回看，但已过期：{taskStaleReason}</p>}
    {task?.errorMessage && <p className="rounded border border-destructive/40 p-2 text-xs text-destructive">{task.errorMessage}</p>}
    {task?.status === 'success' && archive?.mp4Path && <div className="flex flex-wrap gap-2 rounded border border-emerald-500/40 bg-background/60 p-2 text-xs"><span>归档完成：</span><a className="underline" href={localFileUrl(archive.mp4Path)}>MP4</a>{archive.srtPath && <a className="underline" href={localFileUrl(archive.srtPath)}>SRT</a>}{archive.vttPath && <a className="underline" href={localFileUrl(archive.vttPath)}>VTT</a>}{archive.audioPath && <a className="underline" href={localFileUrl(archive.audioPath)}>混音 M4A</a>}{archive.manifestPath && <a className="underline" href={localFileUrl(archive.manifestPath)}>Manifest</a>}</div>}
  </section>
}

function EpisodeQualityPanel({ projectId, adaptationProjectId, episodeId }: { projectId: string; adaptationProjectId: string; episodeId: string }) {
  const [renders, setRenders] = useState<Array<{ task: LongTask; stale: boolean; staleReason?: string }>>([])
  const [reports, setReports] = useState<Array<{ task: LongTask; report?: EpisodeQualityReport; reportPath?: string; stale: boolean; staleReason?: string }>>([])
  const [acknowledgements, setAcknowledgements] = useState<QualityIssueAcknowledgement[]>([])
  const [renderTaskId, setRenderTaskId] = useState('')
  const [riskNotes, setRiskNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<'start' | 'redo' | 'retry' | 'cancel' | null>(null)
  const listInput = useMemo(() => ({ projectId, adaptationProjectId, episodeId }), [adaptationProjectId, episodeId, projectId])
  const load = useCallback(async () => {
    const [nextRenders, nextReports, nextAcknowledgements] = await Promise.all([
      ipc.episodeRender.listByEpisode(listInput),
      ipc.episodeQuality.listByEpisode(listInput),
      ipc.creative.listQualityIssueAcknowledgements(projectId),
    ])
    setRenders(nextRenders)
    setReports(nextReports)
    setAcknowledgements(nextAcknowledgements)
    const usable = nextRenders.filter((item) => item.task.status === 'success' && !item.stale)
    setRenderTaskId((current) => usable.some((item) => item.task.id === current) ? current : usable[0]?.task.id ?? '')
  }, [listInput, projectId])

  useEffect(() => { void load().catch((error) => toast.error(`读取媒体质检状态失败：${error instanceof Error ? error.message : String(error)}`)) }, [load])
  useEffect(() => {
    if (!reports.some((item) => item.task.status === 'pending' || item.task.status === 'running')) return
    const timer = window.setInterval(() => { void load() }, 1_000)
    return () => window.clearInterval(timer)
  }, [load, reports])

  const latest = reports[0]
  const report = latest?.report
  const latestAcknowledgements = useMemo(() => {
    const values = new Map<string, QualityIssueAcknowledgement>()
    for (const acknowledgement of acknowledgements) {
      const previous = values.get(acknowledgement.issueId)
      if (!previous || acknowledgement.createdAt > previous.createdAt || (acknowledgement.createdAt === previous.createdAt && acknowledgement.id > previous.id)) values.set(acknowledgement.issueId, acknowledgement)
    }
    return values
  }, [acknowledgements])

  async function start() {
    if (!renderTaskId) return toast.error('没有可用的当前成片；请先通过交付预检并完成 MP4 渲染。')
    setBusy('start')
    try {
      const result = await ipc.episodeQuality.start({ ...listInput, renderTaskId })
      if (!result.ok) return toast.error(result.error ?? '无法开始媒体质检。')
      toast.success('已开始只读媒体质检：不会替换素材，也不会自动重跑已通过镜头。')
      await load()
    } catch (error) { toast.error(`开始媒体质检失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(null) }
  }

  async function retry() {
    if (!latest) return
    setBusy('retry')
    try {
      const result = await ipc.longTask.retry(latest.task.id)
      if (!result.ok) toast.error(result.error ?? '无法重试媒体质检。')
      await load()
    } catch (error) { toast.error(`重试媒体质检失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(null) }
  }

  async function cancel() {
    if (!latest) return
    setBusy('cancel')
    try {
      const result = await ipc.longTask.cancel(latest.task.id)
      if (!result.ok) toast.error(result.error ?? '媒体质检无法取消。')
      await load()
    } catch (error) { toast.error(`取消媒体质检失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(null) }
  }

  async function acceptRisk(issue: EpisodeQualityReport['issues'][number]) {
    const note = riskNotes[issue.id]?.trim()
    if (!note) return toast.error('请填写接受风险的理由；它会与当前交付版本和时间戳一并审计。')
    try {
      await ipc.creative.acknowledgeQualityIssue({
        projectId,
        adaptationProjectId,
        issueId: issue.id,
        issueKind: `episode_media_${issue.kind}`,
        issueTitle: `${report?.deliveryVersion ?? '未知交付'}：${issue.title}`,
        issueDetail: issue.detail,
        disposition: 'accepted',
        note,
      })
      await load()
      toast.success(issue.severity === 'blocker' ? '已记录风险接受；blocker 仍不会被自动放行。' : '已记录风险接受及审计时间。')
    } catch (error) { toast.error(`记录风险接受失败：${error instanceof Error ? error.message : String(error)}`) }
  }

  async function createRedoPlan() {
    if (!latest) return
    setBusy('redo')
    try {
      const result = await ipc.episodeQuality.createMinimalRedoPlan({ ...listInput, qualityTaskId: latest.task.id })
      if (!result.ok) return toast.error(result.error ?? '无法创建返工清单。')
      toast.success(`已创建最小返工清单：只包含 ${report?.redoTargets.length ?? 0} 个失败目标。`)
      await load()
    } catch (error) { toast.error(`创建返工清单失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(null) }
  }

  const usableRenders = renders.filter((item) => item.task.status === 'success' && !item.stale)
  return <section className="space-y-2 rounded-md border bg-muted/20 p-3" data-episode-quality-panel>
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-medium">成片媒体质检与最小返工</h3><p className="text-xs text-muted-foreground">检查文件可读性、时长、720×1280 画幅、黑帧/冻结、静音/削波/响度、字幕时序及连续性。嘴型同步未接入可靠模型，仅明确标示为人工核对项。</p></div><div className="flex flex-wrap gap-2"><select aria-label="待质检成片" value={renderTaskId} onChange={(event) => setRenderTaskId(event.target.value)} className="h-8 max-w-56 rounded border bg-background px-2 text-xs"><option value="">选择当前成片</option>{usableRenders.map((item) => <option key={item.task.id} value={item.task.id}>渲染 {item.task.id.slice(0, 8)} · {item.task.finishedAt ?? item.task.updatedAt}</option>)}</select><Button size="sm" disabled={busy !== null || !renderTaskId || latest?.task.status === 'running' || latest?.task.status === 'pending'} onClick={() => void start()}>{busy === 'start' ? <Loader2 className="animate-spin" /> : null}运行媒体质检</Button></div></div>
    {usableRenders.length === 0 && <p className="rounded border border-dashed p-2 text-xs text-amber-700">尚无当前 MP4。过期的历史成片不能作为质检或交付真值，请重新渲染后再执行检查。</p>}
    {latest && <div className="flex flex-wrap items-center gap-2 rounded border bg-background/60 p-2 text-xs"><Badge variant={latest.stale || latest.task.status === 'failed' ? 'destructive' : latest.task.status === 'success' ? 'default' : 'outline'}>{latest.stale ? '报告 stale' : `质检：${latest.task.status}`}</Badge><span>交付版本：{report?.deliveryVersion ?? (latest.task.input?.episodeQuality as { renderTaskId?: string } | undefined)?.renderTaskId?.slice(0, 8) ?? '待解析'}</span>{(latest.task.status === 'pending' || latest.task.status === 'running') && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void cancel()}>取消质检</Button>}{(latest.task.status === 'failed' || latest.task.status === 'canceled') && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void retry()}>重试质检</Button>}</div>}
    {latest?.staleReason && <p className="rounded border border-amber-500/40 p-2 text-xs text-amber-700">历史报告仍可审计，但不能继续用于交付：{latest.staleReason}</p>}
    {latest?.task.errorMessage && <p className="rounded border border-destructive/40 p-2 text-xs text-destructive">{latest.task.errorMessage}</p>}
    {report && <div className="space-y-2 rounded border bg-background/60 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2"><Badge variant={report.blockerCount ? 'destructive' : report.warningCount ? 'outline' : 'default'}>{report.blockerCount ? `${report.blockerCount} blocker` : '无 blocker'}</Badge><span>{report.warningCount} warning</span><span>版本：{report.deliveryVersion}</span><span>生成：{report.generatedAt}</span>{latest.reportPath && <a className="underline" href={localFileUrl(latest.reportPath)}>JSON 报告</a>}</div>
      {report.redoTargets.length > 0 && <div className="flex flex-wrap items-center gap-2 rounded border border-destructive/30 p-2"><span>仅返工失败目标：{report.redoTargets.map((target) => `${target.kind}${target.targetId ? `:${target.targetId.slice(0, 8)}` : ''}`).join('、')}</span><Button size="sm" variant="outline" disabled={busy !== null || latest.stale} onClick={() => void createRedoPlan()}>{busy === 'redo' ? <Loader2 className="animate-spin" /> : null}创建最小返工清单</Button></div>}
      <div className="space-y-1">{report.issues.map((issue) => {
        const acknowledgement = latestAcknowledgements.get(issue.id)
        return <div key={issue.id} className={issue.severity === 'blocker' ? 'rounded border border-destructive/40 bg-destructive/5 p-2' : issue.severity === 'warning' ? 'rounded border border-amber-500/40 p-2' : 'rounded border p-2 text-muted-foreground'}><div className="flex flex-wrap gap-2"><Badge variant={issue.severity === 'blocker' ? 'destructive' : 'outline'}>{issue.severity}</Badge><span className="font-medium">{issue.title}</span>{issue.startSeconds !== undefined && <span>{issue.startSeconds.toFixed(2)}–{issue.endSeconds?.toFixed(2)} 秒</span>}</div><p className="mt-1">{issue.detail}</p>{acknowledgement?.disposition === 'accepted' ? <p className="mt-1 text-muted-foreground">已接受风险 · Owner：{acknowledgement.actorLabel} · {acknowledgement.createdAt} · {acknowledgement.note}</p> : issue.severity !== 'info' ? <div className="mt-2 flex flex-wrap gap-2"><Input aria-label={`${issue.id} 风险理由`} value={riskNotes[issue.id] ?? ''} onChange={(event) => setRiskNotes((current) => ({ ...current, [issue.id]: event.target.value }))} placeholder="接受风险理由（必填）" className="h-8 max-w-sm text-xs" /><Button size="sm" variant="outline" onClick={() => void acceptRisk(issue)}>记录接受风险{issue.severity === 'blocker' ? '（不放行）' : ''}</Button></div> : null}</div>
      })}</div>
      <p className="text-muted-foreground">{report.limitations.join(' ')}</p>
    </div>}
  </section>
}

function EpisodeCompliancePanel({ projectId, adaptationProjectId, episodeId }: { projectId: string; adaptationProjectId: string; episodeId: string }) {
  const [profiles, setProfiles] = useState<ComplianceRuleProfile[]>([])
  const [renders, setRenders] = useState<Array<{ task: LongTask; stale: boolean; staleReason?: string }>>([])
  const [qualityReports, setQualityReports] = useState<Array<{ task: LongTask; report?: EpisodeQualityReport; stale: boolean; staleReason?: string }>>([])
  const [history, setHistory] = useState<Array<{ task: LongTask; stale: boolean; staleReason?: string }>>([])
  const [renderTaskId, setRenderTaskId] = useState('')
  const [qualityTaskId, setQualityTaskId] = useState('')
  const [profileId, setProfileId] = useState('')
  const [title, setTitle] = useState('')
  const [subtitleLanguage, setSubtitleLanguage] = useState('zh-CN')
  const [targetPlatform, setTargetPlatform] = useState('')
  const [targetRegion, setTargetRegion] = useState('中国大陆')
  const [deliveryDate, setDeliveryDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [aigcDeclared, setAigcDeclared] = useState(false)
  const [manualContentReviewConfirmed, setManualContentReviewConfirmed] = useState(false)
  const [preflight, setPreflight] = useState<EpisodeCompliancePreflight | null>(null)
  const [busy, setBusy] = useState<'preflight' | 'start' | 'cancel' | 'retry' | 'activate' | null>(null)
  const listInput = useMemo(() => ({ projectId, adaptationProjectId, episodeId }), [adaptationProjectId, episodeId, projectId])
  const usableProfiles = profiles.filter((profile) => profile.sourceStatus === 'official' && profile.integrityStatus === 'verified')
  const usableRenders = renders.filter((item) => item.task.status === 'success' && !item.stale)
  const usableQualityReports = qualityReports.filter((item) => item.task.status === 'success' && !item.stale && item.report)
  const input = useMemo(() => ({
    ...listInput,
    renderTaskId,
    qualityTaskId,
    profileId,
    title,
    subtitleLanguage,
    targetPlatform: targetPlatform.trim() || undefined,
    targetRegion: targetRegion.trim() || undefined,
    deliveryDate,
    aigcDeclared,
    manualContentReviewConfirmed,
  }), [aigcDeclared, deliveryDate, listInput, manualContentReviewConfirmed, profileId, qualityTaskId, renderTaskId, subtitleLanguage, targetPlatform, targetRegion, title])

  const load = useCallback(async () => {
    const [nextProfiles, nextRenders, nextQualityReports, nextHistory] = await Promise.all([
      ipc.compliance.listProfiles(),
      ipc.episodeRender.listByEpisode(listInput),
      ipc.episodeQuality.listByEpisode(listInput),
      ipc.episodeCompliance.listByEpisode(listInput),
    ])
    setProfiles(nextProfiles)
    setRenders(nextRenders)
    setQualityReports(nextQualityReports)
    setHistory(nextHistory)
    const readyProfiles = nextProfiles.filter((profile) => profile.sourceStatus === 'official' && profile.integrityStatus === 'verified')
    const readyRenders = nextRenders.filter((item) => item.task.status === 'success' && !item.stale)
    const readyQualityReports = nextQualityReports.filter((item) => item.task.status === 'success' && !item.stale && item.report)
    setProfileId((current) => readyProfiles.some((profile) => profile.id === current) ? current : readyProfiles.find((profile) => profile.active)?.id ?? readyProfiles[0]?.id ?? '')
    setRenderTaskId((current) => readyRenders.some((item) => item.task.id === current) ? current : readyRenders[0]?.task.id ?? '')
    setQualityTaskId((current) => readyQualityReports.some((item) => item.task.id === current) ? current : readyQualityReports[0]?.task.id ?? '')
  }, [listInput])

  useEffect(() => { void load().catch((error) => toast.error(`读取合规交付状态失败：${error instanceof Error ? error.message : String(error)}`)) }, [load])
  useEffect(() => {
    if (!history.some((item) => item.task.status === 'pending' || item.task.status === 'running')) return
    const timer = window.setInterval(() => { void load() }, 1_000)
    return () => window.clearInterval(timer)
  }, [history, load])

  function resetPreflight() { setPreflight(null) }

  async function inspect() {
    if (!renderTaskId || !qualityTaskId || !profileId) return toast.error('请选择当前 MP4、对应媒体质检报告和正式规则 Profile。')
    setBusy('preflight')
    try {
      const next = await ipc.episodeCompliance.preflight(input)
      setPreflight(next)
      if (next.ok) toast.success('合规预检通过：将写入不可关闭的可见标识和隐藏元数据。')
      else toast.error(`合规预检发现 ${next.blockers.length} 项阻塞；不会输出“看似合规”的文件。`)
    } catch (error) { toast.error(`合规预检失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(null) }
  }

  async function start() {
    if (!preflight?.ok) return toast.error('请先运行并通过合规预检。')
    setBusy('start')
    try {
      const result = await ipc.episodeCompliance.start(input)
      if (!result.ok) return toast.error(result.error ?? '无法开始合规封装。')
      toast.success('已开始合规交付封装；会在转码后回读验证隐藏标识。')
      await load()
    } catch (error) { toast.error(`开始合规封装失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(null) }
  }

  async function cancel() {
    const task = history[0]?.task
    if (!task) return
    setBusy('cancel')
    try {
      const result = await ipc.longTask.cancel(task.id)
      if (!result.ok) toast.error(result.error ?? '任务无法取消。')
      await load()
    } catch (error) { toast.error(`取消失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(null) }
  }

  async function retry() {
    const task = history[0]?.task
    if (!task) return
    setBusy('retry')
    try {
      const result = await ipc.longTask.retry(task.id)
      if (!result.ok) toast.error(result.error ?? '任务无法重试。')
      await load()
    } catch (error) { toast.error(`重试失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(null) }
  }

  async function activateProfile(profile: ComplianceRuleProfile) {
    if (profile.sourceStatus !== 'official' || profile.integrityStatus !== 'verified') return toast.error('只有已验证的正式规则 Profile 可以成为当前交付依据。')
    setBusy('activate')
    try {
      const active = await ipc.compliance.activateProfile(profile.id)
      if (!active) return toast.error('规则 Profile 未通过完整性或来源校验，无法启用。')
      setProfileId(active.id)
      resetPreflight()
      await load()
      toast.success(`已启用 ${active.version}；此前版本仍保留于离线审计记录中。`)
    } catch (error) { toast.error(`启用规则 Profile 失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(null) }
  }

  const latest = history[0]
  const archive = latest?.task.output?.archive as { mp4Path?: string; manifestPath?: string; profileVersion?: string } | undefined
  const selectedProfile = profiles.find((profile) => profile.id === profileId)
  return <section className="space-y-2 rounded-md border bg-muted/20 p-3" data-episode-compliance-panel>
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-medium">合规交付封装：规则、AIGC 标识与审计</h3><p className="text-xs text-muted-foreground">以版本化离线 Profile 复核交付日期、地区和平台。最终文件必须同时包含不可关闭的可见 “AI Generated” 标识与隐藏 SDNS-AIGC 元数据，转码后会回读验证；没有“删除标识”选项。</p></div><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void inspect()}>{busy === 'preflight' ? <Loader2 className="animate-spin" /> : null}运行合规预检</Button></div>
    <div className="grid gap-2 rounded border bg-background/60 p-2 md:grid-cols-2">
      <Input aria-label="交付剧名" value={title} onChange={(event) => { setTitle(event.target.value); resetPreflight() }} placeholder="交付剧名（必填）" />
      <Input aria-label="字幕语言" value={subtitleLanguage} onChange={(event) => { setSubtitleLanguage(event.target.value); resetPreflight() }} placeholder="字幕语言，例如 zh-CN" />
      <Input aria-label="目标平台" value={targetPlatform} onChange={(event) => { setTargetPlatform(event.target.value); resetPreflight() }} placeholder="目标平台（可留空，但会保留审计）" />
      <Input aria-label="目标地区" value={targetRegion} onChange={(event) => { setTargetRegion(event.target.value); resetPreflight() }} placeholder="目标地区" />
      <Input aria-label="交付日期" type="date" value={deliveryDate} onChange={(event) => { setDeliveryDate(event.target.value); resetPreflight() }} />
      <select aria-label="正式规则 Profile" value={profileId} onChange={(event) => { setProfileId(event.target.value); resetPreflight() }} className="h-9 rounded border bg-background px-2 text-xs"><option value="">选择正式规则 Profile</option>{usableProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.active ? '当前 · ' : ''}{profile.version} · {profile.title}</option>)}</select>
    </div>
    <div className="rounded border bg-background/60 p-2 text-xs"><p className="mb-1 font-medium">规则依据与离线审计</p><div className="space-y-1">{profiles.map((profile) => <div key={profile.id} className="flex flex-wrap items-center gap-2 rounded border p-2"><Badge variant={profile.sourceStatus === 'official' && profile.integrityStatus === 'verified' ? 'default' : 'outline'}>{profile.sourceStatus === 'official' ? '正式规则' : profile.sourceStatus === 'consultation' ? '征求意见稿' : profile.sourceStatus === 'platform_guidance' ? '平台指引' : '来源未知'}</Badge><span>{profile.title} · {profile.version}</span><span className="text-muted-foreground">发布 {profile.publishedAt}{profile.effectiveAt ? ` · 生效 ${profile.effectiveAt}` : ''} · 范围：{profile.regions.join('、') || '未限定地区'} / {profile.platforms.join('、') || '通用平台'} · 完整性 {profile.integrityStatus}</span><a className="underline" href={profile.sourceUrl} target="_blank" rel="noreferrer">规则来源</a>{profile.active ? <Badge variant="secondary">当前</Badge> : <Button size="sm" variant="outline" disabled={busy !== null || profile.sourceStatus !== 'official' || profile.integrityStatus !== 'verified'} onClick={() => void activateProfile(profile)}>启用此版本</Button>}</div>)}</div><p className="mt-2 text-muted-foreground">规则包离线保存版本、校验和与 Ed25519 签名；征求意见稿只作参考，不能单独成为强制交付依据。启用旧版会保留新旧版本及交付任务的审计链。</p></div>
    <div className="grid gap-2 rounded border bg-background/60 p-2 md:grid-cols-2"><select aria-label="待合规封装成片" value={renderTaskId} onChange={(event) => { setRenderTaskId(event.target.value); resetPreflight() }} className="h-9 rounded border bg-background px-2 text-xs"><option value="">选择当前 MP4</option>{usableRenders.map((item) => <option key={item.task.id} value={item.task.id}>渲染 {item.task.id.slice(0, 8)} · {item.task.finishedAt ?? item.task.updatedAt}</option>)}</select><select aria-label="媒体质检报告" value={qualityTaskId} onChange={(event) => { setQualityTaskId(event.target.value); resetPreflight() }} className="h-9 rounded border bg-background px-2 text-xs"><option value="">选择当前媒体质检报告</option>{usableQualityReports.map((item) => <option key={item.task.id} value={item.task.id}>质检 {item.task.id.slice(0, 8)} · blocker {item.report?.blockerCount ?? 0}</option>)}</select></div>
    {(usableRenders.length === 0 || usableQualityReports.length === 0) && <p className="rounded border border-dashed p-2 text-xs text-amber-700">需要先有当前 MP4 和与其绑定的成功媒体质检报告；过期、失败或有 blocker 的报告都不会被静默跳过。</p>}
    <div className="space-y-1 rounded border bg-background/60 p-2 text-xs"><label className="flex items-start gap-2"><input type="checkbox" checked={aigcDeclared} onChange={(event) => { setAigcDeclared(event.target.checked); resetPreflight() }} /><span>我确认本交付包含 AI 生成/合成内容，并同意写入显式和隐式 AIGC 标识。</span></label><label className="flex items-start gap-2"><input type="checkbox" checked={manualContentReviewConfirmed} onChange={(event) => { setManualContentReviewConfirmed(event.target.checked); resetPreflight() }} /><span>我已完成人工核对：未成年人、历史/民俗表述、版权与许可证/备案。系统会记录确认，但不会把它伪装成自动审核。</span></label></div>
    {preflight && <div className={preflight.ok ? 'rounded border border-emerald-500/40 bg-emerald-500/5 p-2 text-xs' : 'rounded border border-destructive/40 bg-destructive/5 p-2 text-xs'}><div className="flex flex-wrap items-center gap-2"><Badge variant={preflight.ok ? 'default' : 'destructive'}>{preflight.ok ? '可合规交付' : '已阻止'}</Badge>{preflight.profile && <span>{preflight.profile.version}</span>}{preflight.profile && <a className="underline" href={preflight.profile.sourceUrl} target="_blank" rel="noreferrer">规则来源</a>}</div>{preflight.blockers.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4 text-destructive">{preflight.blockers.map((message) => <li key={message}>{message}</li>)}</ul>}{preflight.warnings.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4 text-amber-700">{preflight.warnings.map((message) => <li key={message}>{message}</li>)}</ul>}{preflight.visibleLabel && <p className="mt-2">固定可见标识：{preflight.visibleLabel}；隐藏键：{Object.keys(preflight.metadata).join('、')}。</p>}</div>}
    <div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy !== null || !preflight?.ok || latest?.task.status === 'pending' || latest?.task.status === 'running'} onClick={() => void start()}>{busy === 'start' ? <Loader2 className="animate-spin" /> : <Video className="h-3.5 w-3.5" />}封装合规 MP4</Button>{(latest?.task.status === 'pending' || latest?.task.status === 'running') && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void cancel()}>取消封装</Button>}{(latest?.task.status === 'failed' || latest?.task.status === 'canceled') && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void retry()}>修正后重试</Button>}{latest && <Badge variant={latest.stale ? 'destructive' : latest.task.status === 'success' ? 'default' : latest.task.status === 'failed' ? 'destructive' : 'outline'}>任务：{latest.stale ? 'stale' : latest.task.status}</Badge>}</div>
    {latest?.staleReason && <p className="rounded border border-amber-500/40 p-2 text-xs text-amber-700">历史合规文件可审计，但已不能作为当前交付：{latest.staleReason}</p>}
    {latest?.task.errorMessage && <p className="rounded border border-destructive/40 p-2 text-xs text-destructive">{latest.task.errorMessage}</p>}
    {latest?.task.status === 'success' && !latest.stale && archive?.mp4Path && <div className="flex flex-wrap gap-2 rounded border border-emerald-500/40 bg-background/60 p-2 text-xs"><span>合规归档已验证：</span><a className="underline" href={localFileUrl(archive.mp4Path)}>带标识 MP4</a>{archive.manifestPath && <a className="underline" href={localFileUrl(archive.manifestPath)}>合规 Manifest</a>}<span>Profile：{archive.profileVersion ?? selectedProfile?.version ?? '已归档'}</span></div>}
  </section>
}

function PlatformDeliveryPanel({ projectId, adaptationProjectId, episodeId }: { projectId: string; adaptationProjectId: string; episodeId: string }) {
  const [profiles, setProfiles] = useState<PlatformDeliveryProfile[]>([])
  const [variants, setVariants] = useState<DeliveryCreativeVariant[]>([])
  const [exports, setExports] = useState<PlatformDeliveryExport[]>([])
  const [complianceHistory, setComplianceHistory] = useState<Array<{ task: LongTask; stale: boolean; staleReason?: string }>>([])
  const [assets, setAssets] = useState<ProjectAsset[]>([])
  const [profileId, setProfileId] = useState('')
  const [variantId, setVariantId] = useState('')
  const [complianceTaskId, setComplianceTaskId] = useState('')
  const [manualFieldsConfirmed, setManualFieldsConfirmed] = useState(false)
  const [label, setLabel] = useState('方案 A')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [coverAssetId, setCoverAssetId] = useState('')
  const [preflight, setPreflight] = useState<PlatformDeliveryPreflight | null>(null)
  const [busy, setBusy] = useState<'save' | 'adopt' | 'preflight' | 'export' | 'open' | null>(null)
  const listInput = useMemo(() => ({ projectId, adaptationProjectId, episodeId }), [adaptationProjectId, episodeId, projectId])
  const sourceAssets = assets.filter((asset) => asset.status === 'available' && Boolean(asset.localPath) && (asset.kind === 'cover_image' || asset.kind === 'first_frame_image'))
  const usableCompliance = complianceHistory.filter((item) => item.task.status === 'success' && !item.stale)
  const selectedProfile = profiles.find((profile) => profile.id === profileId)
  const selectedVariant = variants.find((variant) => variant.id === variantId)
  const input = useMemo(() => ({ ...listInput, profileId, creativeVariantId: variantId, complianceTaskId, manualFieldsConfirmed }), [complianceTaskId, listInput, manualFieldsConfirmed, profileId, variantId])

  const load = useCallback(async () => {
    const [nextProfiles, nextVariants, nextExports, nextCompliance, nextAssets] = await Promise.all([
      ipc.platformDelivery.listProfiles(), ipc.platformDelivery.listVariants({ projectId, adaptationProjectId }), ipc.platformDelivery.listExports(listInput), ipc.episodeCompliance.listByEpisode(listInput), ipc.asset.listByProject(projectId),
    ])
    setProfiles(nextProfiles); setVariants(nextVariants); setExports(nextExports); setComplianceHistory(nextCompliance); setAssets(nextAssets)
    setProfileId((current) => nextProfiles.some((profile) => profile.id === current) ? current : nextProfiles[0]?.id ?? '')
    setVariantId((current) => nextVariants.some((variant) => variant.id === current) ? current : nextVariants.find((variant) => variant.status === 'adopted')?.id ?? nextVariants[0]?.id ?? '')
    setComplianceTaskId((current) => nextCompliance.some((item) => item.task.id === current && item.task.status === 'success' && !item.stale) ? current : nextCompliance.find((item) => item.task.status === 'success' && !item.stale)?.task.id ?? '')
  }, [adaptationProjectId, listInput, projectId])

  useEffect(() => { void load().catch((error) => toast.error(`读取平台交付状态失败：${error instanceof Error ? error.message : String(error)}`)) }, [load])
  function resetPreflight() { setPreflight(null) }

  async function saveVariant() {
    const tags = tagsText.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean)
    if (!label.trim() || !title.trim() || !description.trim() || !tags.length) return toast.error('候选必须填写标签、标题、简介和至少一个标签词。')
    setBusy('save')
    try {
      const created = await ipc.platformDelivery.createVariant({ projectId, adaptationProjectId, label: label.trim(), title: title.trim(), description: description.trim(), tags, coverAssetId: coverAssetId || undefined, source: 'manual' })
      setVariantId(created.id); setTitle(''); setDescription(''); setTagsText(''); setLabel(`方案 ${String.fromCharCode(65 + Math.min(variants.length + 1, 25))}`); resetPreflight()
      await load(); toast.success(`已保存候选 ${created.label}；仍需显式采用后才能导出。`)
    } catch (error) { toast.error(`保存候选失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(null) }
  }

  async function adoptVariant(id: string) {
    setBusy('adopt')
    try {
      const adopted = await ipc.platformDelivery.adoptVariant({ projectId, adaptationProjectId, id })
      if (!adopted) return toast.error('候选不存在或已被删除。')
      setVariantId(adopted.id); resetPreflight(); await load(); toast.success(`已采用 ${adopted.label}；此前采用版本已归档但保留可追溯历史。`)
    } catch (error) { toast.error(`采用候选失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(null) }
  }

  async function inspect() {
    if (!profileId || !variantId || !complianceTaskId) return toast.error('请选择 Profile、采用的创意候选和当前合规 MP4。')
    setBusy('preflight')
    try {
      const next = await ipc.platformDelivery.preflight(input); setPreflight(next)
      if (next.ok) toast.success('平台交付预检通过；会建立新的独立版本目录。')
      else toast.error(`平台交付被 ${next.blockers.length} 项条件阻止。`)
    } catch (error) { toast.error(`平台交付预检失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(null) }
  }

  async function createExport() {
    if (!preflight?.ok) return toast.error('请先通过平台交付预检。')
    setBusy('export')
    try {
      const result = await ipc.platformDelivery.export(input)
      setPreflight(result.preflight)
      if (!result.ok) return toast.error(result.error ?? '平台交付包未能创建。')
      await load(); toast.success(`已创建交付包 v${String(result.archive?.deliveryVersion ?? 0).padStart(3, '0')}；不会覆盖历史目录。`)
    } catch (error) { toast.error(`创建平台交付包失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(null) }
  }

  async function copyListing() {
    if (!selectedVariant || !selectedProfile) return toast.error('先选择 Profile 与创意候选。')
    const text = `${selectedVariant.title}\n\n${selectedVariant.description}\n\n标签：${selectedVariant.tags.join('、')}\nProfile：${selectedProfile.title} (${selectedProfile.version})`
    try { await navigator.clipboard.writeText(text); toast.success('已复制标题、简介、标签和 Profile 信息，可粘贴至平台后台。') } catch { toast.error('无法写入剪贴板，请从候选卡片手动复制。') }
  }

  async function openDirectory(id: string) {
    setBusy('open')
    try {
      const result = await ipc.platformDelivery.openExportDirectory({ projectId, adaptationProjectId, id })
      if (result) toast.error(`无法打开目录：${result}`)
    } catch (error) { toast.error(`打开目录失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(null) }
  }

  return <section className="space-y-2 rounded-md border bg-muted/20 p-3" data-platform-delivery-panel>
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-medium">平台交付包：文案 A/B、封面与人工提交</h3><p className="text-xs text-muted-foreground">把可核验的成片、字幕、封面、文案、权利/合规/质检证据打入独立目录；不保存平台账号、不登录、不代投，也不伪称已发布。</p></div><div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void copyListing()}>复制提交文案</Button><Button size="sm" disabled={busy !== null} onClick={() => void inspect()}>{busy === 'preflight' ? <Loader2 className="animate-spin" /> : null}运行交付预检</Button></div></div>
    <div className="grid gap-2 rounded border bg-background/60 p-2 md:grid-cols-2"><select aria-label="平台交付 Profile" value={profileId} onChange={(event) => { setProfileId(event.target.value); resetPreflight() }} className="h-9 rounded border bg-background px-2 text-xs"><option value="">选择 Profile</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.title} · {profile.video.width}×{profile.video.height} · {profile.version}</option>)}</select><select aria-label="当前合规 MP4" value={complianceTaskId} onChange={(event) => { setComplianceTaskId(event.target.value); resetPreflight() }} className="h-9 rounded border bg-background px-2 text-xs"><option value="">选择当前合规 MP4</option>{usableCompliance.map((item) => <option key={item.task.id} value={item.task.id}>合规 {item.task.id.slice(0, 8)} · {item.task.finishedAt ?? item.task.updatedAt}</option>)}</select></div>
    {selectedProfile && <div className="rounded border bg-background/60 p-2 text-xs"><div className="flex flex-wrap items-center gap-2"><Badge variant={selectedProfile.sourceStatus === 'platform_portal' ? 'outline' : 'secondary'}>{selectedProfile.sourceStatus === 'platform_portal' ? '平台入口可核验' : '内部母版'}</Badge><span>{selectedProfile.platform} · {selectedProfile.region} · H.264/AAC · {selectedProfile.video.width}×{selectedProfile.video.height}</span><a className="underline" href={selectedProfile.sourceUrl} target="_blank" rel="noreferrer">Profile 来源</a><span className="text-muted-foreground">核验日 {selectedProfile.checkedAt}</span></div><p className="mt-1 text-muted-foreground">时长：{selectedProfile.duration.status === 'verified' ? `${selectedProfile.duration.minSeconds ?? '—'}–${selectedProfile.duration.maxSeconds ?? '—'} 秒` : '人工确认'}（{selectedProfile.duration.note}）；字幕安全区：底部 {selectedProfile.subtitleSafeZone.bottomMarginPx}px（{selectedProfile.subtitleSafeZone.note}）。</p><p className="mt-1 text-muted-foreground">平台的实时上传规格、资质/备案和审核字段不会猜测或写死，必须由人工在提交前复核。</p>{selectedProfile.manualFields.length > 0 && <label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={manualFieldsConfirmed} onChange={(event) => { setManualFieldsConfirmed(event.target.checked); resetPreflight() }} /><span>我已核对：{selectedProfile.manualFields.join('；')}。</span></label>}</div>}
    <div className="grid gap-2 rounded border bg-background/60 p-2 md:grid-cols-2"><Input aria-label="候选标签" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="候选标签，例如 方案 A" /><select aria-label="候选封面" value={coverAssetId} onChange={(event) => setCoverAssetId(event.target.value)} className="h-9 rounded border bg-background px-2 text-xs"><option value="">选择封面资产（预检必填）</option>{sourceAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.title} · {ASSET_KIND_LABEL[asset.kind]}</option>)}</select><Input aria-label="候选标题" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="标题：直接写用户会看到的成品标题" /><Input aria-label="候选标签词" value={tagsText} onChange={(event) => setTagsText(event.target.value)} placeholder="标签词，用逗号分隔" /><Textarea aria-label="候选简介" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="简介：冲突、钩子与卖点；不会自动发布" className="min-h-20 md:col-span-2" /></div>
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void saveVariant()}>{busy === 'save' ? <Loader2 className="animate-spin" /> : null}保存为新候选</Button><span className="text-xs text-muted-foreground">每次保存都新建版本；采用一个候选不会删除旧候选。</span></div>
    <div className="space-y-1 rounded border bg-background/60 p-2 text-xs"><p className="font-medium">创意候选与采用历史</p>{variants.length === 0 ? <p className="text-muted-foreground">尚无候选。先保存至少一个标题/封面/简介/标签组合。</p> : variants.map((variant) => <div key={variant.id} className={variant.id === variantId ? 'rounded border border-primary/50 p-2' : 'rounded border p-2'}><div className="flex flex-wrap items-center gap-2"><Badge variant={variant.status === 'adopted' ? 'default' : variant.status === 'archived' ? 'secondary' : 'outline'}>{variant.status === 'adopted' ? '已采用' : variant.status === 'archived' ? '历史采用' : '候选'}</Badge><span>{variant.label} · v{variant.versionNumber} · {variant.title}</span><span className="text-muted-foreground">{variant.updatedAt}</span>{variant.status !== 'adopted' && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void adoptVariant(variant.id)}>{busy === 'adopt' ? <Loader2 className="animate-spin" /> : null}采用此候选</Button>}</div><p className="mt-1">{variant.description}</p><p className="mt-1 text-muted-foreground">标签：{variant.tags.join('、')} · 封面：{variant.coverAssetId ? sourceAssets.find((asset) => asset.id === variant.coverAssetId)?.title ?? '已引用的历史资产' : '未选（预检会阻止）'}</p></div>)}</div>
    {usableCompliance.length === 0 && <p className="rounded border border-dashed p-2 text-xs text-amber-700">需要先有当前且成功的合规 MP4；stale 或失败的历史记录只保留审计用途，不能重新打包。</p>}
    {preflight && <div className={preflight.ok ? 'rounded border border-emerald-500/40 bg-emerald-500/5 p-2 text-xs' : 'rounded border border-destructive/40 bg-destructive/5 p-2 text-xs'}><div className="flex flex-wrap gap-2"><Badge variant={preflight.ok ? 'default' : 'destructive'}>{preflight.ok ? '可以创建新交付目录' : '已阻止'}</Badge>{preflight.finalBaseName && <span>成品命名：{preflight.finalBaseName}</span>}</div>{preflight.blockers.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4 text-destructive">{preflight.blockers.map((item) => <li key={item}>{item}</li>)}</ul>}{preflight.warnings.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4 text-amber-700">{preflight.warnings.map((item) => <li key={item}>{item}</li>)}</ul>}<p className="mt-2 text-muted-foreground">将包含：{preflight.expectedFiles.join('、')}，以及 listing.md、质检报告和带 SHA-256 校验清单。</p></div>}
    <div className="flex flex-wrap items-center gap-2"><Button size="sm" disabled={busy !== null || !preflight?.ok} onClick={() => void createExport()}>{busy === 'export' ? <Loader2 className="animate-spin" /> : <Download className="h-3.5 w-3.5" />}创建独立交付包</Button><span className="text-xs text-muted-foreground">每次导出都会分配新的 delivery-vNNN 目录，绝不覆盖既有交付。</span></div>
    {exports.length > 0 && <div className="space-y-1 rounded border bg-background/60 p-2 text-xs"><p className="font-medium">交付包历史</p>{exports.map((record) => <div key={record.id} className="flex flex-wrap items-center gap-2 rounded border p-2"><Badge variant="outline">v{String(record.deliveryVersion).padStart(3, '0')}</Badge><span>{record.profileId} · {record.createdAt}</span><a className="underline" href={localFileUrl(record.manifestPath)}>Manifest</a><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void openDirectory(record.id)}>{busy === 'open' ? <Loader2 className="animate-spin" /> : null}打开目录</Button></div>)}</div>}
  </section>
}

function localFileUrl(path: string): string {
  if (path.startsWith('file://')) return path
  const normalized = path.replace(/\\/g, '/')
  return `file://${normalized.split('/').map(encodeURIComponent).join('/')}`
}

function ShotStillBatchPlanner({ shots, candidates, locks, versions }: { shots: Shot[]; candidates: ShotStillCandidate[]; locks: ShotVisualAssetLock[]; versions: VisualAssetVersion[] }) {
  const [mode, setMode] = useState<ShotStillBatchMode>('missing_only')
  const [selectedShotIds, setSelectedShotIds] = useState<string[]>([])
  const [kinds, setKinds] = useState<ShotStillKind[]>(['still', 'first_frame'])
  const plan = useMemo(() => planShotStillBatch({ shots, candidates, locks, versions, mode, selectedShotIds, kinds }), [shots, candidates, locks, versions, mode, selectedShotIds, kinds])
  function toggleShot(shotId: string) { setSelectedShotIds((current) => current.includes(shotId) ? current.filter((id) => id !== shotId) : [...current, shotId]) }
  function toggleKind(kind: ShotStillKind) { setKinds((current) => current.includes(kind) ? current.filter((value) => value !== kind) : [...current, kind]) }
  async function copyPlan() {
    const text = plan.planned.map((item) => `镜头 ${item.shotNumber} · ${stillKindLabel(item.kind)}\n${item.input.prompt}`).join('\n\n')
    if (!text) return toast.error('当前没有可生成的静帧任务。')
    try {
      await navigator.clipboard.writeText(text)
      toast.success('已复制不含密钥的图片任务提示词，可交给已授权的图片工作流或人工制图。')
    } catch {
      toast.error('无法写入剪贴板；请展开下方任务清单手动复制。')
    }
  }
  return <details className="rounded border bg-background/60 p-3" data-shot-still-batch-plan>
    <summary className="cursor-pointer text-sm font-medium">静帧批量任务预检 · {plan.planned.length} 项待生成 / {plan.skipped.length} 项安全跳过</summary>
    <p className="mt-2 text-xs text-muted-foreground">批量计划只构造可审阅输入并保留“新建候选、绝不覆盖已采用”的策略。当前真实图片 Provider 的归档与密钥设置尚未完成，本页面不会提交计费请求或伪造生成成功。</p>
    <div className="mt-2 flex flex-wrap gap-2"><select aria-label="静帧批量范围" value={mode} onChange={(event) => setMode(event.target.value as ShotStillBatchMode)} className="h-8 rounded border bg-background px-2 text-xs"><option value="missing_only">只补缺（默认）</option><option value="selected">仅显式选中</option></select>{SHOT_STILL_KINDS.map(([kind, label]) => <label key={kind} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={kinds.includes(kind)} onChange={() => toggleKind(kind)} />{label}</label>)}<Button size="sm" variant="outline" onClick={() => void copyPlan()} disabled={!plan.planned.length}>复制任务清单</Button></div>
    {mode === 'selected' && <div className="mt-2 flex flex-wrap gap-2">{shots.map((shot) => <label key={shot.id} className="flex items-center gap-1 rounded border px-2 py-1 text-xs"><input type="checkbox" checked={selectedShotIds.includes(shot.id)} onChange={() => toggleShot(shot.id)} />镜头 {shot.shotNumber}</label>)}</div>}
    <div className="mt-2 space-y-1">{plan.planned.map((item) => <div key={`${item.shotId}:${item.kind}`} className="rounded border p-2 text-xs"><div className="flex flex-wrap gap-2"><Badge variant="outline">镜头 {item.shotNumber} · {stillKindLabel(item.kind)}</Badge><span>费用：未知（未提交）</span><span>输出：新候选，不覆盖已采用版本</span></div><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{item.input.prompt}</p></div>)}{plan.skipped.map((item) => <p key={`${item.shotId}:${item.kind}`} className="rounded border border-dashed p-2 text-xs text-muted-foreground">镜头 {shots.find((shot) => shot.id === item.shotId)?.shotNumber ?? item.shotId} · {stillKindLabel(item.kind)}：{item.reason}</p>)}</div>
  </details>
}

function ShotVisualAssetLocksPanel({ projectId, shotId }: { projectId: string; shotId: string }) {
  const [versions, setVersions] = useState<VisualAssetVersion[]>([])
  const [locks, setLocks] = useState<ShotVisualAssetLock[]>([])
  const [role, setRole] = useState<(typeof SHOT_LOCK_ROLES)[number][0]>('character')
  const [versionId, setVersionId] = useState('')
  const [saving, setSaving] = useState(false)
  const adopted = versions.filter((version) => version.status === 'adopted')
  const versionsById = useMemo(() => new Map(versions.map((version) => [version.id, version])), [versions])

  async function load() {
    const [nextVersions, nextLocks] = await Promise.all([
      ipc.visualAsset.listByProject(projectId),
      ipc.visualAsset.listLocksByShot(shotId),
    ])
    setVersions(nextVersions)
    setLocks(nextLocks)
  }
  useEffect(() => { void load() }, [projectId, shotId])
  useEffect(() => {
    if (versionId && adopted.some((version) => version.id === versionId)) return
    setVersionId(adopted[0]?.id ?? '')
  }, [adopted, versionId])

  async function lockVersion() {
    if (!versionId) return toast.error('请先在项目概览的生产资产包中采用一个版本')
    setSaving(true)
    try {
      await ipc.visualAsset.lockShot({ projectId, shotId, visualAssetVersionId: versionId, role })
      await load()
      toast.success('此分镜已锁定精确版本；上游换版后只会提示，不会静默替换。')
    } catch (error) {
      toast.error(`锁定版本失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  return <section className="mt-3 space-y-2 rounded-md border bg-muted/20 p-3" data-shot-visual-locks>
    <div><h3 className="text-sm font-medium">生产资产版本锁</h3><p className="text-xs text-muted-foreground">本镜头只使用这里明确锁定的资产版本；未锁定不等于自动追随角色或场景的新版本。</p></div>
    <div className="grid gap-2 md:grid-cols-[9rem_1fr_auto]">
      <select aria-label="锁定用途" value={role} onChange={(event) => setRole(event.target.value as typeof role)} className="h-9 rounded-md border bg-background px-2 text-xs">{SHOT_LOCK_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label="采用的视觉资产版本" value={versionId} onChange={(event) => setVersionId(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-xs"><option value="">选择已采用版本</option>{adopted.map((version) => <option key={version.id} value={version.id}>{version.label} · v{version.versionNumber}</option>)}</select>
      <Button size="sm" onClick={() => void lockVersion()} disabled={!versionId || saving}>锁定版本</Button>
    </div>
    {locks.length === 0 ? <p className="rounded border border-dashed p-2 text-xs text-muted-foreground">尚未锁定生产资产。为角色、服装、场景等选择精确版本后再生成视频，可避免上游换图影响已完成镜头。</p> : <div className="space-y-1">{locks.map((lock) => {
      const version = versionsById.get(lock.visualAssetVersionId)
      return <div key={lock.id} className="rounded border bg-background/70 p-2 text-xs"><div className="flex flex-wrap gap-2"><Badge variant={lock.staleReason ? 'destructive' : 'default'}>{SHOT_LOCK_ROLES.find(([value]) => value === lock.role)?.[1] ?? lock.role}</Badge><span className="font-medium">{version ? `${version.label} · v${version.versionNumber}` : '版本记录不可用'}</span>{!lock.staleReason && <span className="text-muted-foreground">已锁定</span>}</div>{lock.staleReason && <p className="mt-1 text-destructive">待确认更新：{lock.staleReason}</p>}</div>
    })}</div>}
  </section>
}

function AssetReferenceControl({ asset, value, label, description, kind, onChange }: {
  asset?: ProjectAsset
  value: string
  label: string
  description: string
  kind: ProjectAsset['kind']
  onChange: (value: string) => void
}) {
  const previewUrl = asset && isVideoReferenceImageAsset(asset) ? assetReferenceUrl(asset) : undefined
  async function chooseFile() {
    const result = await ipc.asset.chooseLocalFile(kind)
    if (result.ok && result.path) onChange(result.path)
    else if (result.error) toast.error(`选择素材失败：${result.error}`)
  }
  function dropLocalFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const file = event.dataTransfer.files[0] as (File & { path?: string }) | undefined
    if (file?.path) {
      onChange(file.path)
      return
    }
    toast.error('未读取到本地路径。请使用“选择本地文件”以安全地引用素材。')
  }
  return (
    <div className="rounded-md border p-3" onDragOver={(event) => event.preventDefault()} onDrop={dropLocalFile}>
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0"><div className="text-xs font-medium">{label}</div><p className="text-[11px] text-muted-foreground">{description}</p></div>
        <Badge className="ml-auto" variant={asset ? ASSET_STATUS_VARIANT[asset.status] : 'outline'}>{asset ? ASSET_STATUS_LABEL[asset.status] : '未引用'}</Badge>
      </div>
      {previewUrl ? <img src={previewUrl} alt={`${label}预览`} className="mb-2 aspect-video w-full rounded border object-cover" /> : <div className="mb-2 flex aspect-[16/5] items-center justify-center rounded border border-dashed bg-muted/20 text-[11px] text-muted-foreground">拖入本地文件或选择引用</div>}
      <div className="flex gap-2">
        <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder="HTTPS URL 或本地路径" className="min-w-0 text-xs" aria-label={`${label}引用`} />
        <Button type="button" size="sm" variant="outline" onClick={() => void chooseFile()}>选择文件</Button>
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
