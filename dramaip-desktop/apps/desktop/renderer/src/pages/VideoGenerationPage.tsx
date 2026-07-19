import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Clock,
  ImagePlus,
  Loader2,
  RefreshCw,
  Send,
  Star,
  Trash2,
} from 'lucide-react'
import type {
  AdaptationProject,
  Episode,
  ProjectAsset,
  Scene,
  Script,
  Shot,
  VideoAssetDraftResult,
  VideoGenerationTask,
  VideoProviderConfig,
  VideoResult,
} from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { ASSET_KIND_LABEL, ASSET_STATUS_LABEL, ASSET_STATUS_VARIANT, assetReferenceUrl, isVideoReferenceImageAsset } from '@/lib/assets'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

const STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'default' | 'destructive'> = {
  pending: 'secondary',
  running: 'outline',
  success: 'default',
  failed: 'destructive',
  canceled: 'secondary',
}
const STATUS_LABEL: Record<string, string> = {
  pending: '排队中',
  running: '生成中',
  success: '成功',
  failed: '失败',
  canceled: '已取消',
}

export function VideoGenerationPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [adaptation, setAdaptation] = useState<AdaptationProject | null>(null)
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [scripts, setScripts] = useState<Script[]>([])
  const [scenes, setScenes] = useState<Scene[]>([])
  const [shots, setShots] = useState<Shot[]>([])
  const [providers, setProviders] = useState<VideoProviderConfig[]>([])
  const [tasks, setTasks] = useState<VideoGenerationTask[]>([])
  const [results, setResults] = useState<VideoResult[]>([])
  const [shotAssets, setShotAssets] = useState<ProjectAsset[]>([])
  const [assetsByResult, setAssetsByResult] = useState<Record<string, ProjectAsset[]>>({})
  const [assetDraft, setAssetDraft] = useState<VideoAssetDraftResult | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const episodeId = params.get('episode') ?? ''
  const sceneId = params.get('scene') ?? ''
  const shotId = params.get('shot') ?? ''

  const activeEpisode = useMemo(() => episodes.find((e) => e.id === episodeId) ?? null, [episodes, episodeId])
  const activeScript = useMemo(() => scripts.find((s) => s.episodeId === episodeId) ?? null, [scripts, episodeId])
  const activeScene = useMemo(() => scenes.find((s) => s.id === sceneId) ?? null, [scenes, sceneId])
  const activeShot = useMemo(() => shots.find((s) => s.id === shotId) ?? null, [shots, shotId])

  const reload = useCallback(async () => {
    if (!id) return
    const [a, eps, scs, provs] = await Promise.all([
      ipc.adaptationProject.get(id),
      ipc.episode.list(id),
      ipc.script.list(id),
      ipc.videoProvider.list(),
    ])
    setAdaptation(a ?? null)
    setEpisodes(eps)
    setScripts(scs)
    setProviders(provs)
    if (!episodeId && eps[0]) {
      setParams((p) => { p.set('episode', eps[0].id); return p }, { replace: true })
    }
  }, [id, episodeId, setParams])

  // 当前集剧本 → 场景
  useEffect(() => {
    void (async () => {
      if (!activeScript) { setScenes([]); return }
      setScenes(await ipc.scene.listByScript(activeScript.id))
    })()
  }, [activeScript])

  // 当前场景 → 镜头
  useEffect(() => {
    void (async () => {
      if (!sceneId) { setShots([]); return }
      setShots(await ipc.shot.listByScene(sceneId))
    })()
  }, [sceneId])

  // 当前镜头 → 任务 + 结果
  const reloadShotData = useCallback(async () => {
    if (!shotId) {
      setTasks([])
      setResults([])
      setShotAssets([])
      setAssetsByResult({})
      return
    }
    const [ts, rs, assets] = await Promise.all([
      ipc.videoTask.listByShot(shotId),
      ipc.videoResult.listByShot(shotId),
      ipc.asset.listBySource('shot', shotId),
    ])
    const resultAssets = await Promise.all(rs.map(async (result) => [result.id, await ipc.asset.listBySource('video_result', result.id)] as const))
    setTasks(ts)
    setResults(rs)
    setShotAssets(assets)
    setAssetsByResult(Object.fromEntries(resultAssets))
  }, [shotId])

  useEffect(() => {
    void reload()
  }, [reload, version])
  useEffect(() => {
    void reloadShotData()
  }, [reloadShotData])

  useEffect(() => {
    setAssetDraft(null)
  }, [shotId])

  async function submitTask() {
    if (!activeShot) return
    const provider = providers.find((p) => p.isDefault) ?? providers[0]
    if (!provider) {
      toast.error('请先在「视频生成设置」配置一个 Provider')
      return
    }
    setBusy('submit')
    const tid = toast.loading('正在提交视频生成任务…')
    try {
      const referenceImageUrls = await collectReferenceImageUrls(activeShot, shotAssets)
      const res = await ipc.videoTask.create({
        providerConfigId: provider.id,
        projectId: adaptation?.sourceProjectId,
        episodeId: activeShot.episodeId,
        sceneId: activeShot.sceneId,
        shotId: activeShot.id,
        prompt: activeShot.videoPrompt || activeShot.visualDescription,
        negativePrompt: activeShot.negativePrompt,
        referenceImageUrls,
      })
      if (res.ok) {
        toast.success('任务已提交', { id: tid })
        setVersion((v) => v + 1)
      } else {
        toast.error('提交失败：' + (res.error ?? '未知错误'), { id: tid })
      }
    } finally {
      setBusy(null)
    }
  }

  async function checkStatus(taskId: string) {
    setBusy('check:' + taskId)
    const tid = toast.loading('正在查询任务状态…')
    try {
      const res = await ipc.videoTask.checkStatus(taskId)
      if (res.ok) {
        toast.success(`状态：${STATUS_LABEL[res.task?.status ?? ''] ?? res.task?.status}`, { id: tid })
        setVersion((v) => v + 1)
      } else {
        toast.error('查询失败：' + (res.error ?? '未知错误'), { id: tid })
      }
    } finally {
      setBusy(null)
    }
  }

  async function retryTask(taskId: string) {
    setBusy('retry:' + taskId)
    const tid = toast.loading('正在重试…')
    try {
      const res = await ipc.videoTask.retry(taskId)
      if (res.ok) {
        toast.success('已重新提交', { id: tid })
        setVersion((v) => v + 1)
      } else {
        toast.error('重试失败：' + (res.error ?? '未知错误'), { id: tid })
      }
    } finally {
      setBusy(null)
    }
  }

  async function selectBest(resultId: string) {
    const res = await ipc.videoResult.selectBest(resultId)
    if (res.ok) {
      toast.success('已标记为最佳结果')
      setVersion((v) => v + 1)
    } else {
      toast.error('操作失败')
    }
  }

  async function generateVideoAssetDrafts() {
    if (!activeShot) return
    setBusy('asset-draft')
    const tid = toast.loading('正在生成视频资产草稿…')
    try {
      const res = await ipc.ai.run({
        projectId: adaptation?.sourceProjectId,
        adaptationProjectId: adaptation?.id,
        episodeId: activeShot.episodeId,
        sceneId: activeShot.sceneId,
        shotId: activeShot.id,
        taskType: 'generate_video_asset_drafts',
      })
      if (res.ok && res.result?.kind === 'generate_video_asset_drafts') {
        setAssetDraft(res.result.data as VideoAssetDraftResult)
        toast.success('视频资产草稿已生成', { id: tid })
      } else {
        toast.error('生成失败：' + (res.error ?? '未知错误'), { id: tid })
      }
    } finally {
      setBusy(null)
    }
  }

  async function applyVideoAssetDrafts(draft: VideoAssetDraftResult) {
    if (!activeShot) return
    const updated = await ipc.shot.update(activeShot.id, {
      imagePrompt: draft.firstFramePrompt ?? activeShot.imagePrompt,
      coverPrompt: draft.coverPrompt ?? activeShot.coverPrompt,
      narration: draft.narrationDraft ?? activeShot.narration,
      subtitleDraft: draft.subtitleDraft ?? activeShot.subtitleDraft,
    }) as Shot | undefined
    if (updated) {
      setShots((items) => items.map((shot) => (shot.id === updated.id ? updated : shot)))
      toast.success('已写入镜头草稿')
    } else {
      toast.error('写入镜头草稿失败')
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
        <Button variant="ghost" size="icon" aria-label="返回分镜工作台" onClick={() => navigate(`/adaptations/${adaptation.id}/shots`)}>
          <ArrowLeft />
        </Button>
        <h1 className="text-base font-semibold">{adaptation.title} · 视频生成</h1>
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={episodeId}
            onValueChange={(v) => setParams((p) => { p.set('episode', v); p.delete('scene'); p.delete('shot'); return p }, { replace: true })}
          >
            <SelectTrigger aria-label="选择集数" className="w-40">
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
        <Empty text="请选择一集。" />
      ) : !activeScript ? (
        <Empty text="本集还没有剧本/镜头，无法生成视频。" />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* 左侧：场景 → 镜头 */}
          <aside className="w-60 shrink-0 overflow-hidden border-r">
            <ScrollArea className="h-full">
              <div className="space-y-3 p-2">
                <div>
                  <div className="mb-1 px-1 text-xs text-muted-foreground">场景</div>
                  {scenes.length === 0 ? (
                    <p className="px-1 text-xs text-muted-foreground">本集无场景</p>
                  ) : (
                    scenes.map((sc, i) => (
                      <button
                        key={sc.id}
                        onClick={() => setParams((p) => { p.set('scene', sc.id); p.delete('shot'); return p }, { replace: true })}
                        className={cn(
                          'mb-0.5 w-full rounded px-2 py-1 text-left text-xs',
                          sceneId === sc.id ? 'bg-accent font-medium' : 'hover:bg-accent/60',
                        )}
                      >
                        场景 {i + 1} · {sc.title}
                      </button>
                    ))
                  )}
                </div>
                {activeScene && (
                  <div>
                    <div className="mb-1 px-1 text-xs text-muted-foreground">镜头</div>
                    {shots.length === 0 ? (
                      <p className="px-1 text-xs text-muted-foreground">本场景无镜头</p>
                    ) : (
                      shots.map((s, i) => (
                        <button
                          key={s.id}
                          onClick={() => setParams((p) => { p.set('shot', s.id); return p }, { replace: true })}
                          className={cn(
                            'mb-0.5 w-full rounded px-2 py-1 text-left text-xs',
                            shotId === s.id ? 'bg-accent font-medium' : 'hover:bg-accent/60',
                          )}
                        >
                          镜头 {i + 1} · {s.cameraAngle ?? '—'}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </ScrollArea>
          </aside>

          {/* 中间：当前镜头的生成任务 + 结果 */}
          <section className="flex-1 overflow-hidden">
            {activeShot ? (
              <ScrollArea className="h-full">
                <div className="p-6">
                  {/* 镜头头 */}
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Badge variant="outline">镜头 {shots.findIndex((s) => s.id === activeShot.id) + 1}</Badge>
                    <span className="text-xs text-muted-foreground">{activeShot.cameraAngle ?? ''}{activeShot.cameraMovement ? ` · ${activeShot.cameraMovement}` : ''}</span>
                    <div className="ml-auto">
                      <Button size="sm" onClick={submitTask} disabled={busy !== null}>
                        {busy === 'submit' ? <Loader2 className="animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                        提交视频生成任务
                      </Button>
                    </div>
                  </div>
                  <div className="mb-3 rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                    <div className="mb-0.5 font-medium text-foreground">Prompt</div>
                    <div>{activeShot.videoPrompt || activeShot.visualDescription}</div>
                    {activeShot.negativePrompt && <div className="mt-1"><span className="font-medium text-foreground">负面：</span>{activeShot.negativePrompt}</div>}
                    {activeShot.imagePrompt && <div className="mt-1"><span className="font-medium text-foreground">首帧：</span>{activeShot.imagePrompt}</div>}
                    {activeShot.coverPrompt && <div className="mt-1"><span className="font-medium text-foreground">封面：</span>{activeShot.coverPrompt}</div>}
                    {activeShot.narration && <div className="mt-1"><span className="font-medium text-foreground">旁白：</span>{activeShot.narration}</div>}
                    {activeShot.subtitleDraft && <div className="mt-1 whitespace-pre-wrap"><span className="font-medium text-foreground">字幕：</span>{activeShot.subtitleDraft}</div>}
                    <AssetBadges assets={shotAssets} />
                    <VideoAssetDraftPanel draft={assetDraft} onApply={applyVideoAssetDrafts} />
                  </div>

                  {/* 默认 Provider 提示 */}
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>当前 Provider：{providers.find((p) => p.isDefault)?.name ?? providers[0]?.name ?? '（未配置，请先到视频生成设置）'}</span>
                    <Button size="sm" variant="outline" onClick={generateVideoAssetDrafts} disabled={busy !== null}>
                      {busy === 'asset-draft' ? <Loader2 className="animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                      生成资产草稿
                    </Button>
                  </div>

                  {/* 任务列表 */}
                  <div className="mb-4">
                    <div className="mb-1.5 text-sm font-medium">生成任务（{tasks.length}）</div>
                    {tasks.length === 0 ? (
                      <p className="text-xs text-muted-foreground">还没有任务。点击「提交视频生成任务」。</p>
                    ) : (
                      <div className="space-y-1.5">
                        {tasks.map((t) => (
                          <div key={t.id} className="rounded-md border p-2 text-xs">
                            <div className="flex items-center gap-1.5">
                              <Badge variant={STATUS_VARIANT[t.status]}>{STATUS_LABEL[t.status] ?? t.status}</Badge>
                              <span className="text-muted-foreground">{t.provider} · {t.model}</span>
                              {t.note && <span className="text-muted-foreground">· {t.note}</span>}
                              <span className="ml-auto text-muted-foreground">{new Date(t.createdAt).toLocaleString()}</span>
                            </div>
                            {t.errorMessage && <div className="mt-1 text-destructive">{t.errorMessage}</div>}
                            <div className="mt-1.5 flex gap-1">
                              {(t.status === 'running' || t.status === 'pending') && (
                                <Button size="sm" variant="ghost" onClick={() => checkStatus(t.id)} disabled={busy !== null}>
                                  <RefreshCw className="h-3 w-3" /> 刷新状态
                                </Button>
                              )}
                              {t.status === 'failed' && (
                                <Button size="sm" variant="ghost" onClick={() => retryTask(t.id)} disabled={busy !== null}>
                                  <RefreshCw className="h-3 w-3" /> 重试
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={async () => { await ipc.videoTask.remove(t.id); setVersion((v) => v + 1) }}
                              >
                                <Trash2 className="h-3 w-3" /> 删除
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 结果对比 / 择优 */}
                  <div>
                    <div className="mb-1.5 text-sm font-medium">视频结果（{results.length}）</div>
                    {results.length === 0 ? (
                      <p className="text-xs text-muted-foreground">还没有结果。任务成功后结果会自动保存。</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                        {results.map((r) => (
                          <div key={r.id} className={cn('rounded-md border p-2', r.isBest && 'border-primary')}>
                            <div className="mb-1 flex items-center gap-1">
                              <Clock className="h-3 w-3 text-muted-foreground" />
                              <span className="text-[11px] text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span>
                              {r.localVideoPath && (
                                <Badge variant="outline" className="ml-auto">本地归档</Badge>
                              )}
                              {r.isBest && (
                                <Badge className={r.localVideoPath ? '' : 'ml-auto'}><Star className="h-3 w-3" /> 最佳</Badge>
                              )}
                            </div>
                            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                            <video
                              src={videoResultSrc(r)}
                              poster={videoCoverSrc(r)}
                              controls
                              className="mb-1 w-full rounded bg-black"
                              style={{ aspectRatio: '9 / 16', maxHeight: 240 }}
                            />
                            <div className="truncate text-[11px] text-muted-foreground" title={videoResultSrc(r)}>{videoResultSrc(r)}</div>
                            {r.remoteVideoUrl && r.remoteVideoUrl !== r.resultVideoUrl && (
                              <div className="truncate text-[11px] text-muted-foreground" title={r.remoteVideoUrl}>远端：{r.remoteVideoUrl}</div>
                            )}
                            {r.archiveError && <div className="mt-1 text-[11px] text-destructive">归档失败：{r.archiveError}</div>}
                            <AssetBadges assets={assetsByResult[r.id] ?? []} />
                            <div className="mt-1 flex gap-1">
                              {!r.isBest && (
                                <Button size="sm" variant="ghost" onClick={() => selectBest(r.id)}>
                                  <Check className="h-3 w-3" /> 选为最佳
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={async () => { await ipc.videoResult.remove(r.id); setVersion((v) => v + 1) }}
                              >
                                <Trash2 className="h-3 w-3" /> 删除
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </ScrollArea>
            ) : (
              <Empty text={<span className="flex items-center gap-1">选择左侧镜头 <ChevronRight className="h-3.5 w-3.5" /> 生成视频</span>} />
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function VideoAssetDraftPanel({ draft, onApply }: { draft: VideoAssetDraftResult | null; onApply: (draft: VideoAssetDraftResult) => void }) {
  if (!draft) return null
  return (
    <div className="mt-2 rounded-md border bg-background p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-medium text-foreground">视频资产草稿</span>
        {draft.subtitleFormat && <Badge variant="outline">{draft.subtitleFormat.toUpperCase()}</Badge>}
        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => onApply(draft)}>
          <Check className="h-3.5 w-3.5" /> 写入镜头草稿
        </Button>
      </div>
      <div className="space-y-1.5">
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

function Empty({ text }: { text: ReactNode }) {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{text}</div>
}

async function collectReferenceImageUrls(shot: Shot, currentShotAssets: ProjectAsset[]): Promise<string[]> {
  const freshShotAssets = await ipc.asset.listBySource('shot', shot.id).catch(() => currentShotAssets)
  const profileAssets = await Promise.all(
    shot.characterIds.map(async (characterId) => {
      const profile = await ipc.visualProfile.getByCharacter(characterId)
      if (!profile) return []
      const assets = await ipc.asset.listBySource('visual_profile', profile.id)
      return profile.referenceImageUrl ? [...assets, profileReferenceAsset(profile.referenceImageUrl)] : assets
    }),
  )
  return uniqueStrings(
    [...freshShotAssets, ...profileAssets.flat()]
      .filter((asset) => asset.status !== 'missing')
      .filter(isVideoReferenceImageAsset)
      .map(assetReferenceUrl)
      .filter((url): url is string => Boolean(url)),
  )
}

function profileReferenceAsset(referenceImageUrl: string): ProjectAsset {
  const remote = /^https?:\/\//i.test(referenceImageUrl)
  return {
    id: `profile-reference:${referenceImageUrl}`,
    projectId: '',
    kind: 'character_reference',
    title: '人物参考图',
    remoteUrl: remote ? referenceImageUrl : undefined,
    localPath: remote ? undefined : referenceImageUrl,
    tags: [],
    metadata: {},
    status: remote ? 'remote_only' : 'available',
    packagePolicy: 'reference_only',
    createdAt: '',
    updatedAt: '',
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values))
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

function videoResultSrc(result: VideoResult): string {
  return result.localVideoPath ? fileUrlFromPath(result.localVideoPath) : result.resultVideoUrl
}

function videoCoverSrc(result: VideoResult): string | undefined {
  return result.localCoverImagePath ? fileUrlFromPath(result.localCoverImagePath) : result.coverImageUrl
}

function fileUrlFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const prefix = normalized.startsWith('/') ? 'file://' : 'file:///'
  const encoded = normalized
    .split('/')
    .map((part, index) => (index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)))
    .join('/')
  return prefix + encoded
}
