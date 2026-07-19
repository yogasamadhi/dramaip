import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, ChevronRight, Download, FilePlus2, Loader2, Settings, Sparkles, Trash2 } from 'lucide-react'
import type { AiContextControls, AiRun, Chapter, CharacterVisualProfile, CreativeCaseStudy, Project, ProjectSkill, StoryArc, TextDiffPreviewPayload } from '@sdns/core'
import { TASK_TYPE_LABELS, WORKSPACE_NAV_GROUPS } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import {
  buildProjectWorkflowStages,
  type ProjectWorkflowSnapshot,
  type ProjectWorkflowStage,
  type ProjectWorkflowStageKey,
} from '@/lib/projectWorkflowGuide'
import { buildAdaptationReadiness, type AdaptationReadinessSummary } from '@/lib/adaptationReadiness'
import { buildProjectQualityGateTruth } from '@/lib/qualityGateTruth'
import { buildAiPreflightContext, setAiContextControlMode } from '@/lib/aiPreflightContext'
import type { InspirationProjectSeed } from '@/lib/inspirationSchemes'
import { AdaptationReadinessPanel } from '@/components/AdaptationReadinessPanel'
import { AiContextPreviewDialog } from '@/components/AiContextPreviewDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AiAssistantPanel } from '@/components/AiAssistantPanel'
import { ContentVersionPanel } from '@/components/ContentVersionPanel'
import { GeneratePreviewDialog, type PreviewTaskType } from '@/components/GeneratePreviewDialog'
import { TextDiffPreviewDialog } from '@/components/TextDiffPreviewDialog'
import { CharactersSection } from '@/components/sections/CharactersSection'
import { ChatSection } from '@/components/sections/ChatSection'
import { InspirationDeskSection } from '@/components/sections/InspirationDeskSection'
import { OutlineSection } from '@/components/sections/OutlineSection'
import { StoryPlanningSection } from '@/components/sections/StoryPlanningSection'
import { ProjectSkillsSection } from '@/components/sections/ProjectSkillsSection'
import { ProjectAgentSchemesSection } from '@/components/sections/ProjectAgentSchemesSection'
import { EvaluationSection } from '@/components/sections/EvaluationSection'
import { MemorySection } from '@/components/sections/MemorySection'
import { CharacterStateSection } from '@/components/sections/CharacterStateSection'
import { VisualProfileSection } from '@/components/sections/VisualProfileSection'
import { VisualSettingSection } from '@/components/sections/VisualSettingSection'
import { TimelineSection } from '@/components/sections/TimelineSection'
import { ForeshadowingSection } from '@/components/sections/ForeshadowingSection'
import { ConsistencySection } from '@/components/sections/ConsistencySection'
import { AiDashboardSection } from '@/components/sections/AiDashboardSection'
import { BeatSection } from '@/components/sections/BeatSection'
import { HighlightSection } from '@/components/sections/HighlightSection'
import { AiVideoFeasibilitySection } from '@/components/sections/AiVideoFeasibilitySection'
import { CreativeDiagnosisSection } from '@/components/sections/CreativeDiagnosisSection'
import { QualityGateDashboardSection } from '@/components/sections/QualityGateDashboardSection'
import { cn } from '@/lib/utils'

const ChapterEditor = lazy(() =>
  import('@/components/editor/ChapterEditor').then((m) => ({ default: m.ChapterEditor })),
)

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

export function WorkspacePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [project, setProject] = useState<Project | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [section, setSection] = useState<string>('chapters')
  const [editorNonce, setEditorNonce] = useState(0)
  const [aiRuns, setAiRuns] = useState<AiRun[]>([])
  const [preview, setPreview] = useState<{
    open: boolean
    taskType: PreviewTaskType
    data: unknown
    characterId?: string
    adaptationProjectId?: string
  }>({
    open: false,
    taskType: 'generate_project',
    data: null,
  })
  const [generating, setGenerating] = useState<PreviewTaskType | null>(null)
  const [textPreview, setTextPreview] = useState<TextDiffPreviewPayload | null>(null)
  const [dataVersion, setDataVersion] = useState(0)
  const [generateIdea, setGenerateIdea] = useState('')
  const [workflowSnapshot, setWorkflowSnapshot] = useState<ProjectWorkflowSnapshot | null>(null)
  const [adaptationReadiness, setAdaptationReadiness] = useState<AdaptationReadinessSummary | null>(null)
  const [caseStudies, setCaseStudies] = useState<CreativeCaseStudy[]>([])
  const [visualProfiles, setVisualProfiles] = useState<CharacterVisualProfile[]>([])
  const [storyArcs, setStoryArcs] = useState<StoryArc[]>([])
  const [projectSkills, setProjectSkills] = useState<ProjectSkill[]>([])
  const [contextControls, setContextControls] = useState<AiContextControls>({})
  const [pendingGenerate, setPendingGenerate] = useState<{
    taskType: PreviewTaskType
    userInstruction?: string
    characterId?: string
  } | null>(null)
  const [preflightRunning, setPreflightRunning] = useState(false)
  // 工作流真值依赖正文而不只是“是否非空”：正文变更后，旧质量报告必须立即显示为过期。
  const chapterWorkflowKey = JSON.stringify(chapters.map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    summary: chapter.summary,
    outline: chapter.outline,
    content: chapter.content,
    mainConflict: chapter.mainConflict,
    hook: chapter.hook,
    highlight: chapter.highlight,
    reversal: chapter.reversal,
    cliffhanger: chapter.cliffhanger,
  })))

  const loadWorkflowSnapshot = useCallback(async (currentProject: Project, projectChapters: Chapter[]) => {
    const [
      characters,
      outlines,
      chapterMemories,
      qualityReports,
      adaptations,
      nextVisualProfiles,
      nextCaseStudies,
      nextStoryArcs,
      nextProjectSkills,
    ] = await Promise.all([
      ipc.character.list(currentProject.id),
      ipc.outline.list(currentProject.id),
      ipc.chapterMemory.list(currentProject.id),
      ipc.creative.listQualityGates(currentProject.id),
      ipc.adaptationProject.listByProject(currentProject.id),
      ipc.visualProfile.list(currentProject.id),
      ipc.caseStudy.list(),
      ipc.storyArc.list(currentProject.id),
      ipc.projectSkill.list(currentProject.id),
    ])
    setVisualProfiles(nextVisualProfiles)
    setCaseStudies(nextCaseStudies)
    setStoryArcs(nextStoryArcs)
    setProjectSkills(nextProjectSkills)

    const primaryAdaptation = adaptations[0]
    let episodes: ProjectWorkflowSnapshot['episodes'] = []
    let scripts: ProjectWorkflowSnapshot['scripts'] = []
    let scenes: ProjectWorkflowSnapshot['scenes'] = []
    let shots: ProjectWorkflowSnapshot['shots'] = []
    let videoTasks: ProjectWorkflowSnapshot['videoTasks'] = []
    let videoResults: ProjectWorkflowSnapshot['videoResults'] = []

    if (primaryAdaptation) {
      episodes = await ipc.episode.list(primaryAdaptation.id)
      scripts = await ipc.script.list(primaryAdaptation.id)
      scenes = (await Promise.all(scripts.map((script) => ipc.scene.listByScript(script.id)))).flat()
      shots = (await Promise.all(episodes.map((episode) => ipc.shot.listByEpisode(episode.id)))).flat()
      const taskGroups = await Promise.all(
        episodes.map((episode) => ipc.videoTask.listByEpisode(episode.id)),
      )
      const taskMap = new Map(taskGroups.flat().map((task) => [task.id, task]))
      videoTasks = [...taskMap.values()]
      videoResults = (await Promise.all(videoTasks.map((task) => ipc.videoResult.listByTask(task.id)))).flat()
    }

    setWorkflowSnapshot({
      project: currentProject,
      chapters: projectChapters,
      characters,
      outlines,
      qualityReports,
      adaptations,
      episodes,
      scripts,
      scenes,
      shots,
      videoTasks,
      videoResults,
    })
    setAdaptationReadiness(buildAdaptationReadiness({
      project: currentProject,
      chapters: projectChapters,
      characters,
      outlines,
      chapterMemories,
      qualityReports,
    }))
  }, [])

  const loadProject = useCallback(async () => {
    if (!id) return
    const p = await ipc.project.get(id)
    setProject(p ?? null)
    const cs = await ipc.chapter.list(id)
    setChapters(cs)
    setSelectedId((prev) => (prev && cs.some((c) => c.id === prev) ? prev : (cs[0]?.id ?? null)))
  }, [id])

  useEffect(() => {
    if (project) void loadWorkflowSnapshot(project, chapters)
    else {
      setWorkflowSnapshot(null)
      setAdaptationReadiness(null)
      setCaseStudies([])
      setVisualProfiles([])
      setStoryArcs([])
      setProjectSkills([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, chapterWorkflowKey, dataVersion, loadWorkflowSnapshot])

  const loadAiRuns = useCallback(async () => {
    if (!id) return
    setAiRuns(await ipc.aiRun.list(id))
  }, [id])

  useEffect(() => {
    void loadProject()
  }, [loadProject])
  useEffect(() => {
    const requestedSection = searchParams.get('section')
    if (requestedSection) setSection(requestedSection)
    const requestedChapter = searchParams.get('chapter')
    if (requestedChapter) setSelectedId(requestedChapter)
  }, [searchParams])
  useEffect(() => {
    if (section === 'ai-runs') void loadAiRuns()
  }, [section, loadAiRuns])

  const selected = chapters.find((c) => c.id === selectedId) ?? null
  const pendingGeneratePreflight = pendingGenerate ? buildAiPreflightContext(
    pendingGenerate.taskType,
    {
      project,
      chapters,
      characters: workflowSnapshot?.characters ?? [],
      storyArcs,
      projectSkills,
      caseStudies,
      visualProfiles,
    },
    contextControls,
  ) : null

  async function createChapter() {
    if (!id) return
    const c = await ipc.chapter.create({ projectId: id, title: `第 ${chapters.length + 1} 章` })
    setChapters((prev) => [...prev, c])
    setSelectedId(c.id)
    setSection('chapters')
    setEditorNonce((n) => n + 1)
  }

  async function deleteChapter(chapterId: string) {
    if (!window.confirm('删除该章节？')) return
    await ipc.chapter.remove(chapterId)
    setChapters((prev) => {
      const next = prev.filter((c) => c.id !== chapterId)
      if (selectedId === chapterId) setSelectedId(next[0]?.id ?? null)
      return next
    })
  }

  async function renameChapter(title: string) {
    if (!selected) return
    const updated = await ipc.chapter.update(selected.id, { title })
    if (updated) setChapters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
  }

  async function onContentChange(chapterId: string, md: string) {
    const updated = await ipc.chapter.updateContent(chapterId, md)
    if (!updated) return false
    // 静默更新本地，不触发 nonce（避免编辑器重载导致光标丢失）
    setChapters((prev) => prev.map((c) => (c.id === chapterId ? { ...c, content: md } : c)))
    return true
  }

  async function onChapterUpdated() {
    if (!selected) return
    const fresh = await ipc.chapter.get(selected.id)
    if (fresh) setChapters((prev) => prev.map((c) => (c.id === fresh.id ? fresh : c)))
    setEditorNonce((n) => n + 1)
    if (section === 'ai-runs') void loadAiRuns()
  }

  function applyChapterUpdate(updated: Chapter) {
    setChapters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    setDataVersion((v) => v + 1)
    if (updated.id === selectedId) setEditorNonce((n) => n + 1)
  }

  async function handleExport(kind: 'md' | 'json') {
    if (!id) return
    try {
      const res = kind === 'md' ? await ipc.export.projectMarkdown(id) : await ipc.export.projectJson(id)
      if (res.saved) toast.success('已导出：' + res.path)
      else toast.message('已取消导出')
    } catch (e) {
      toast.error('导出失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function handleSubmissionExport(kind: 'md' | 'json') {
    if (!id) return
    try {
      const options = { chapterLimit: 10 }
      const res = kind === 'md'
        ? await ipc.export.novelSubmissionMarkdown(id, options)
        : await ipc.export.novelSubmissionJson(id, options)
      if (res.saved) toast.success('已导出投稿包：' + res.path)
      else toast.message('已取消导出')
    } catch (e) {
      toast.error('投稿包导出失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  // v1.0：完整项目包导出（含全部关联数据，可在另一库重新导入）
  async function handleExportPackage() {
    if (!id) return
    try {
      const res = await ipc.export.projectPackage(id)
      if (res.saved) toast.success('已导出项目包：' + res.path)
      else toast.message('已取消导出')
    } catch (e) {
      toast.error('导出失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function runGenerate(taskType: PreviewTaskType, userInstruction?: string, characterId?: string) {
    setPendingGenerate({ taskType, userInstruction, characterId })
  }

  // generate 类：AI 生成 → 预览 → 用户确认后落库（§11.1-11.4 / v0.2 视觉档案/设定）
  async function runGenerateNow(taskType: PreviewTaskType, userInstruction?: string, characterId?: string) {
    if (!project) return
    setGenerating(taskType)
    const label = TASK_TYPE_LABELS[taskType]
    const id = toast.loading(`正在${label}…`)
    try {
      const res = await ipc.ai.run({
        projectId: project.id,
        taskType,
        characterId,
        userInstruction: userInstruction?.trim() || undefined,
        contextControls,
      })
      if (res.ok && res.result) {
        toast.success(`${label}完成，请确认`, { id })
        setPreview({ open: true, taskType, data: res.result.data, characterId })
      } else {
        toast.error(`${label}失败：${res.error ?? '未知错误'}`, { id })
      }
    } catch (e) {
      toast.error(`${label}异常：${e instanceof Error ? e.message : String(e)}`, { id })
    } finally {
      setGenerating(null)
    }
  }

  async function executePendingGenerate() {
    if (!pendingGenerate) return
    setPreflightRunning(true)
    try {
      await runGenerateNow(pendingGenerate.taskType, pendingGenerate.userInstruction, pendingGenerate.characterId)
      setPendingGenerate(null)
    } finally {
      setPreflightRunning(false)
    }
  }

  async function handleAdopt() {
    if (!project) return
    const res = await ipc.ai.applyResult({
      projectId: project.id,
      taskType: preview.taskType,
      data: preview.data,
      characterId: preview.characterId,
      adaptationProjectId: preview.adaptationProjectId,
    })
    if (res.ok) {
      toast.success('已保存到项目')
      setPreview((p) => ({ ...p, open: false }))
      if (preview.taskType === 'generate_project') {
        void loadProject()
        setGenerateIdea('')
      } else {
        setDataVersion((v) => v + 1)
      }
    } else {
      toast.error('保存失败：' + (res.error ?? '未知错误'))
    }
  }

  async function handleTextAdopt() {
    if (!project || !textPreview) return
    const res = await ipc.ai.applyResult({
      projectId: project.id,
      taskType: textPreview.taskType,
      data: textPreview,
    })
    if (res.ok) {
      toast.success('已保存到项目')
      setTextPreview(null)
      await onChapterUpdated()
    } else {
      toast.error('保存失败：' + (res.error ?? '未知错误'))
    }
  }

  const workflowStages = workflowSnapshot ? buildProjectWorkflowStages(workflowSnapshot) : []
  const projectQualityTruth = workflowSnapshot
    ? buildProjectQualityGateTruth({
        project: workflowSnapshot.project,
        chapters: workflowSnapshot.chapters,
        characters: workflowSnapshot.characters,
        outlines: workflowSnapshot.outlines,
        reports: workflowSnapshot.qualityReports,
      })
    : null
  const primaryAdaptation = workflowSnapshot?.adaptations[0]

  function openAdaptationPath(path: 'overview' | 'scripts' | 'shots' | 'video') {
    if (!project) return
    if (!primaryAdaptation) {
      navigate(`/adaptations/new?source=${project.id}`)
      return
    }
    const suffix = path === 'overview' ? '' : `/${path}`
    navigate(`/adaptations/${primaryAdaptation.id}${suffix}`)
  }

  function openProjectCreationFromInspiration(seed: InspirationProjectSeed) {
    const params = new URLSearchParams({
      title: seed.title,
      type: seed.type,
      audience: seed.audience,
      direction: seed.direction,
      hook: seed.hook,
      idea: seed.idea,
    })
    navigate(`/projects/new?${params.toString()}`)
  }

  function handleWorkflowStageAction(stageKey: ProjectWorkflowStageKey) {
    if (!project) return
    if (stageKey === 'setup') {
      setSection('overview')
    } else if (stageKey === 'characters') {
      setSection('characters')
    } else if (stageKey === 'outline') {
      setSection('outline')
    } else if (stageKey === 'chapters') {
      setSection('chapters')
    } else if (stageKey === 'quality') {
      setSection('quality-gates')
    } else if (stageKey === 'adaptation') {
      openAdaptationPath('overview')
    } else if (stageKey === 'scripts') {
      openAdaptationPath('scripts')
    } else if (stageKey === 'shots') {
      openAdaptationPath('shots')
    } else if (stageKey === 'video') {
      openAdaptationPath('video')
    }
  }

  if (!project) {
    return <div className="p-8 text-sm text-muted-foreground">加载项目…</div>
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2.5">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
          <ArrowLeft />
        </Button>
        <h1 className="text-base font-semibold">{project.title}</h1>
        <Badge variant="secondary">{project.shortDramaType}</Badge>
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download />
                导出
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => handleExport('md')}>导出项目 Markdown</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('json')}>导出项目 JSON</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSubmissionExport('md')}>
                导出小说投稿包 Markdown（前 10 章）
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSubmissionExport('json')}>
                导出小说投稿包 JSON（前 10 章）
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportPackage()}>
                导出完整项目包（.sdnspkg）
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" onClick={() => navigate('/settings')}>
            <Settings />
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* 左：项目导航 */}
        <nav className="flex w-56 shrink-0 flex-col border-r">
          <ScrollArea className="flex-1">
            <div className="space-y-3 p-2">
              {WORKSPACE_NAV_GROUPS.map((group) => (
                <div key={group.key} className="space-y-1">
                  <div className="px-3 py-1 text-[11px] font-medium text-muted-foreground">
                    {group.label}
                  </div>
                  {group.items.map((item) => {
                    const active = section === item.key
                    const isChapterEntry = item.key === 'chapters'
                    return (
                      <button
                        key={item.key}
                        onClick={() => {
                          // v0.8：编剧室是独立页面
                          if (item.key === 'writing-room') {
                            void navigate(`/projects/${project.id}/writing-room`)
                            return
                          }
                          setSection(item.key)
                        }}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex w-full items-center rounded-md px-3 py-2 text-left text-sm transition-colors',
                          active
                            ? 'bg-accent font-medium text-accent-foreground'
                            : 'hover:bg-accent/60',
                          isChapterEntry && 'font-medium',
                        )}
                      >
                        {item.label}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="border-t p-2">
            <Button variant="outline" size="sm" className="w-full" onClick={createChapter}>
              <FilePlus2 />
              新建章节
            </Button>
          </div>
        </nav>

        {/* 中：主区 */}
        <section className="flex flex-1 flex-col overflow-hidden border-r">
          {section === 'chapters' && (
            <>
              <div className="flex items-center gap-2 border-b px-3 py-2">
                {chapters.length > 0 ? (
                  <Select value={selectedId ?? undefined} onValueChange={(v) => { setSelectedId(v); setEditorNonce((n) => n + 1) }}>
                    <SelectTrigger className="w-64">
                      <SelectValue placeholder="选择章节" />
                    </SelectTrigger>
                    <SelectContent>
                      {chapters.map((c, i) => (
                        <SelectItem key={c.id} value={c.id}>
                          {i + 1}. {c.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="text-sm text-muted-foreground">还没有章节</span>
                )}
                <Button size="sm" variant="outline" onClick={createChapter}>
                  <FilePlus2 />
                  新建
                </Button>
                {selected && (
                  <Button size="icon" variant="ghost" title="删除章节" onClick={() => deleteChapter(selected.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>

              {selected ? (
                <>
                  <div className="border-b px-4 py-2">
                    <Input
                      defaultValue={selected.title}
                      key={selected.id + '-title'}
                      onBlur={(e) => renameChapter(e.target.value)}
                      className="border-0 px-0 text-base font-medium shadow-none focus-visible:ring-0"
                    />
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">加载编辑器...</div>}>
                      <ChapterEditor
                        key={selected.id + ':' + editorNonce}
                        chapter={selected}
                        onContentChange={(markdown) => onContentChange(selected.id, markdown)}
                      />
                    </Suspense>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                  点击「新建章节」开始写作。
                </div>
              )}
            </>
          )}

          {section === 'overview' && (
            <ScrollArea className="h-full">
              <div className="space-y-3 p-6 text-sm">
                <h2 className="text-lg font-semibold">{project.title}</h2>
                {workflowStages.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">主流程</div>
                        <div className="text-xs text-muted-foreground">小说创作到短剧视频资产</div>
                      </div>
                      <Badge variant="secondary">
                        {workflowStages.filter((stage) => stage.complete).length}/{workflowStages.length}
                      </Badge>
                    </div>
                    <div className="overflow-hidden rounded-md border">
                      {workflowStages.map((stage, index) => (
                        <WorkflowStageRow
                          key={stage.key}
                          index={index}
                          stage={stage}
                          onOpen={() => handleWorkflowStageAction(stage.key)}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {adaptationReadiness && <AdaptationReadinessPanel readiness={adaptationReadiness} />}
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">AI 生成 / 补全项目设定</span>
                  </div>
                  <Textarea
                    value={generateIdea}
                    onChange={(e) => setGenerateIdea(e.target.value)}
                    placeholder="一句话描述你的想法（可选），留空则根据现有类型生成…"
                    rows={2}
                    className="mb-2 text-sm"
                  />
                  <Button
                    size="sm"
                    onClick={() => runGenerate('generate_project', generateIdea)}
                    disabled={generating !== null}
                  >
                    {generating === 'generate_project' ? <Loader2 className="animate-spin" /> : <Sparkles />}
                    生成项目设定
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-y-2">
                  <Meta label="短剧类型" value={project.shortDramaType} />
                  <Meta label="目标受众" value={project.targetAudience} />
                  <Meta label="目标字数" value={project.targetWordCount} />
                  <Meta label="目标集数" value={project.targetEpisodeCount} />
                  <Meta label="一句话卖点" value={project.coreHook} />
                  <Meta label="情绪主轴" value={project.emotionalCore} />
                  <Meta label="核心爽点" value={project.coreSellingPoint} />
                  <Meta label="视觉风格方向" value={project.visualStyleDirection} />
                </div>
                <div>
                  <div className="mb-1 font-medium text-muted-foreground">故事简介</div>
                  <p className="whitespace-pre-wrap">{project.synopsis || '（暂无）'}</p>
                </div>
                <div>
                  <div className="mb-1 font-medium text-muted-foreground">小说风格要求</div>
                  <p className="whitespace-pre-wrap">{project.styleGuide || '（暂无）'}</p>
                </div>
              </div>
            </ScrollArea>
          )}

          {section === 'quality-gates' && (
            <QualityGateDashboardSection
              projectId={project.id}
              chapters={chapters}
              qualityTruth={projectQualityTruth}
              onOpenWorkspaceTarget={(nextSection, chapterId) => {
                if (chapterId) setSelectedId(chapterId)
                setSection(nextSection)
              }}
            />
          )}

          {section === 'ai-runs' && (
            <ScrollArea className="h-full">
              <div className="p-4">
                {aiRuns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无 AI 调用记录。</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3">时间</th>
                        <th className="pr-3">类型</th>
                        <th className="pr-3">模型</th>
                        <th className="pr-3">状态</th>
                        <th className="pr-3">耗时</th>
                        <th className="pr-3">Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aiRuns.map((r) => (
                        <tr key={r.id} className="border-b align-top">
                          <td className="py-2 pr-3 text-xs text-muted-foreground">{formatTime(r.createdAt)}</td>
                          <td className="pr-3">{r.type}</td>
                          <td className="pr-3 text-xs">{r.model}</td>
                          <td className="pr-3">
                            <Badge variant={r.status === 'success' ? 'default' : 'destructive'}>
                              {r.status === 'success' ? '成功' : '失败'}
                            </Badge>
                          </td>
                          <td className="pr-3 text-xs">{r.latencyMs != null ? `${r.latencyMs}ms` : '—'}</td>
                          <td className="pr-3 text-xs">{r.tokenUsage ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </ScrollArea>
          )}

          {section === 'chat' && (
            <ChatSection
              projectId={project.id}
              onGenerate={runGenerate}
              generating={generating}
              commandContext={{
                projectId: project.id,
                project,
                activeChapter: selected,
                chapters,
                characters: workflowSnapshot?.characters ?? [],
                storyArcs,
                projectSkills,
                caseStudies,
                visualProfiles,
                adaptations: workflowSnapshot?.adaptations ?? [],
                episodes: workflowSnapshot?.episodes ?? [],
                scripts: workflowSnapshot?.scripts ?? [],
                scenes: workflowSnapshot?.scenes ?? [],
                shots: workflowSnapshot?.shots ?? [],
              }}
              onTextPreview={setTextPreview}
              onGeneratePreview={({ taskType, data, adaptationProjectId }) =>
                setPreview({ open: true, taskType, data, adaptationProjectId })}
              onCommandCompleted={() => setDataVersion((v) => v + 1)}
            />
          )}

          {section === 'characters' && (
            <CharactersSection
              projectId={project.id}
              version={dataVersion}
              onGenerate={runGenerate}
              generating={generating}
            />
          )}

          {section === 'inspiration' && (
            <InspirationDeskSection
              project={project}
              chapters={chapters}
              selectedChapter={selected}
              version={dataVersion}
              onProjectUpdated={(updated) => {
                setProject(updated)
                setDataVersion((v) => v + 1)
              }}
              onChapterUpdated={applyChapterUpdate}
              onOpenChapter={(chapterId) => {
                setSelectedId(chapterId)
                setSection('chapters')
                setEditorNonce((n) => n + 1)
              }}
              onCreateProject={openProjectCreationFromInspiration}
              onTextPreview={setTextPreview}
            />
          )}

          {section === 'outline' && (
            <OutlineSection
              projectId={project.id}
              version={dataVersion}
              onGenerate={runGenerate}
              generating={generating}
            />
          )}

          {section === 'story-planning' && (
            <StoryPlanningSection
              projectId={project.id}
              version={dataVersion}
              chapters={chapters}
              onGenerate={runGenerate}
              generating={generating}
            />
          )}

          {section === 'project-skills' && (
            <ProjectSkillsSection projectId={project.id} version={dataVersion} onChanged={() => setDataVersion((v) => v + 1)} />
          )}

          {section === 'agent-schemes' && (
            <ProjectAgentSchemesSection projectId={project.id} version={dataVersion} onChanged={() => setDataVersion((v) => v + 1)} />
          )}

          {section === 'evaluation' && <EvaluationSection projectId={project.id} chapter={selected} />}

          {section === 'memory' && <MemorySection projectId={project.id} chapter={selected} />}

          {section === 'character-state' && (
            <CharacterStateSection projectId={project.id} version={dataVersion} />
          )}

          {section === 'visual-profile' && (
            <VisualProfileSection
              projectId={project.id}
              version={dataVersion}
              onGenerate={runGenerate}
              generating={generating}
            />
          )}

          {section === 'visual-setting' && (
            <VisualSettingSection
              projectId={project.id}
              version={dataVersion}
              onGenerate={runGenerate}
              generating={generating}
            />
          )}

          {section === 'timeline' && (
            <TimelineSection projectId={project.id} chapter={selected} version={dataVersion} />
          )}

          {section === 'foreshadowing' && (
            <ForeshadowingSection projectId={project.id} chapter={selected} version={dataVersion} />
          )}

          {section === 'consistency' && <ConsistencySection projectId={project.id} chapter={selected} />}

          {section === 'ai-dashboard' && <AiDashboardSection projectId={project.id} />}

          {section === 'creative-diagnosis' && (
            <CreativeDiagnosisSection projectId={project.id} chapter={selected} qualityTruth={projectQualityTruth} />
          )}

          {section === 'beats' && (
            <BeatSection projectId={project.id} chapter={selected} version={dataVersion} />
          )}

          {section === 'highlights' && (
            <HighlightSection projectId={project.id} chapter={selected} version={dataVersion} />
          )}

          {section === 'ai-video' && (
            <AiVideoFeasibilitySection projectId={project.id} chapter={selected} version={dataVersion} />
          )}
        </section>

        {/* 右：AI 助手 / 信息 */}
        <aside className="w-80 shrink-0 overflow-hidden border-l bg-muted/20">
          {section === 'chapters' ? (
            <ScrollArea className="h-full">
              <div className="space-y-3 p-3">
                {selected && (
                  <ContentVersionPanel
                    targetKind="chapter"
                    targetId={selected.id}
                    currentContent={selected.content}
                    title="章节版本"
                    onRestored={onChapterUpdated}
                  />
                )}
                <AiAssistantPanel
                  projectId={project.id}
                  chapter={selected}
                  onChapterUpdated={onChapterUpdated}
                  onTextPreview={setTextPreview}
                  contextData={{
                    project,
                    chapters,
                    characters: workflowSnapshot?.characters ?? [],
                    storyArcs,
                    projectSkills,
                    caseStudies,
                    visualProfiles,
                  }}
                />
              </div>
            </ScrollArea>
          ) : (
            <div className="p-4 text-sm text-muted-foreground">
              在「章节」中使用 AI 写作助手（生成 / 续写 / 润色 / 扩写 / 增强冲突与爽点与 AI 短剧感）。
              <br />
              <br />
              v0.2 新增「长篇一致性」能力：记忆面板、人物状态、人物视觉档案、视觉设定、事件时间线、伏笔、一致性检查，帮助长篇创作保持设定统一。
            </div>
          )}
        </aside>
      </div>

      <GeneratePreviewDialog
        open={preview.open}
        taskType={preview.taskType}
        data={preview.data}
        onAdopt={handleAdopt}
        onCancel={() => setPreview((p) => ({ ...p, open: false }))}
      />
      <TextDiffPreviewDialog
        open={textPreview !== null}
        preview={textPreview}
        onAdopt={handleTextAdopt}
        onCancel={() => setTextPreview(null)}
      />
      <AiContextPreviewDialog
        open={pendingGenerate !== null}
        preview={pendingGeneratePreflight?.preview ?? null}
        controlGroups={pendingGeneratePreflight?.groups}
        onControlModeChange={(key, targetId, mode) =>
          setContextControls((current) => setAiContextControlMode(current, key, targetId, mode))}
        onRun={() => void executePendingGenerate()}
        runLabel="执行 AI"
        running={preflightRunning}
        onClose={() => setPendingGenerate(null)}
      />
    </div>
  )
}

function Meta({ label, value }: { label: string; value?: string | number }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}：</span>
      <span>{value ?? '—'}</span>
    </div>
  )
}

function WorkflowStageRow({
  index,
  stage,
  onOpen,
}: {
  index: number
  stage: ProjectWorkflowStage
  onOpen: () => void
}) {
  const statusLabel = stage.status === 'done' ? '完成' : stage.status === 'active' ? '当前' : '待办'

  return (
    <div className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0">
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium',
          stage.status === 'done'
            ? 'bg-primary text-primary-foreground'
            : stage.status === 'active'
              ? 'bg-accent text-accent-foreground'
              : 'bg-muted text-muted-foreground',
        )}
      >
        {index + 1}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{stage.title}</span>
          <Badge variant={stage.status === 'done' ? 'default' : 'secondary'}>{statusLabel}</Badge>
        </div>
        <div className="truncate text-xs text-muted-foreground">{stage.detail}</div>
      </div>
      <Button
        size="sm"
        variant={stage.status === 'active' ? 'default' : 'outline'}
        className="shrink-0"
        onClick={onOpen}
      >
        {stage.actionLabel}
        <ChevronRight />
      </Button>
    </div>
  )
}
