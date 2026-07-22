import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronRight, Command, Download, FilePlus2, Loader2, Menu, Sparkles, Trash2 } from 'lucide-react'
import type { AiContextControls, AiRun, AssetRightsRecord, Chapter, ChapterMemory, CharacterVisualProfile, CreativeCaseStudy, GenerationCostEntry, GenerationLineage, NovelTaskType, Project, ProjectAsset, ProjectSkill, QualityGateReport, StoryArc, TextDiffPreviewPayload } from '@sdns/core'
import {
  PROJECT_CREATION_GOAL_OPTIONS,
  PRODUCTION_PLATFORM_OPTIONS,
  PRODUCTION_PRESENTATION_OPTIONS,
  formatProductionDuration,
  TASK_TYPE_LABELS,
  WORKSPACE_NAV_GROUPS,
} from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { confirmAction, deleteConfirmation } from '@/components/ConfirmActionDialog'
import {
  buildProjectWorkflowStages,
  type ProjectWorkflowSnapshot,
  type ProjectWorkflowStage,
  type ProjectWorkflowStageKey,
} from '@/lib/projectWorkflowGuide'
import { buildAdaptationReadiness, type AdaptationReadinessSummary } from '@/lib/adaptationReadiness'
import { buildProjectQualityGateTruth } from '@/lib/qualityGateTruth'
import { buildPilotProductionTruth } from '@/lib/pilotProductionTruth'
import { buildAiPreflightContext, setAiContextControlMode } from '@/lib/aiPreflightContext'
import type { InspirationProjectSeed } from '@/lib/inspirationSchemes'
import { AdaptationReadinessPanel } from '@/components/AdaptationReadinessPanel'
import { PilotProductionPanel } from '@/components/PilotProductionPanel'
import { GenerationLedgerPanel } from '@/components/GenerationLedgerPanel'
import { RightsLedgerPanel } from '@/components/RightsLedgerPanel'
import { AiContextPreviewDialog } from '@/components/AiContextPreviewDialog'
import { AiCommandPalette } from '@/components/AiCommandPalette'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
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
import { StoryBibleChangeSetsSection } from '@/components/sections/StoryBibleChangeSetsSection'
import { ConsistencySection } from '@/components/sections/ConsistencySection'
import { AiDashboardSection } from '@/components/sections/AiDashboardSection'
import { BeatSection } from '@/components/sections/BeatSection'
import { HighlightSection } from '@/components/sections/HighlightSection'
import { AiVideoFeasibilitySection } from '@/components/sections/AiVideoFeasibilitySection'
import { WorkspaceShell, WorkspaceShellState } from '@/components/shell/WorkspaceShell'
import { CreativeDiagnosisSection } from '@/components/sections/CreativeDiagnosisSection'
import { QualityGateDashboardSection } from '@/components/sections/QualityGateDashboardSection'
import { ChapterTree, type ChapterTreeStatus } from '@/components/editor/ChapterTree'
import { SourceImportDialog } from '@/components/SourceImportDialog'
import type { AiCommandDefinition } from '@/lib/aiCommandCatalog'
import { cn } from '@/lib/utils'

const ChapterEditor = lazy(() =>
  import('@/components/editor/ChapterEditor').then((m) => ({ default: m.ChapterEditor })),
)

/** 非章节任务仍在其既有工作区执行；命令面板只负责消除发现成本，不复制业务入口。 */
const WORKSPACE_SECTION_BY_TASK: Partial<Record<NovelTaskType, string>> = {
  generate_project: 'overview',
  generate_characters: 'characters',
  generate_book_outline: 'outline',
  generate_chapter_outline: 'outline',
  generate_story_arc_outline: 'story-planning',
  chat_project: 'chat',
  evaluate_ai_drama_fit: 'evaluation',
  summarize_chapter: 'memory',
  propose_story_bible_changes: 'story-bible',
  update_character_state: 'character-state',
  extract_story_events: 'timeline',
  extract_foreshadowing: 'foreshadowing',
  generate_character_visual_profile: 'visual-profile',
  generate_visual_setting: 'visual-setting',
  check_consistency: 'consistency',
  build_long_context: 'memory',
  analyze_beats: 'beats',
  analyze_highlights: 'highlights',
  analyze_ai_video_feasibility: 'ai-video',
  analyze_project_ai_drama_trend: 'ai-dashboard',
}

const WORKSPACE_SECTION_KEYS = new Set(WORKSPACE_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.key)))

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
  const [searchParams, setSearchParams] = useSearchParams()

  const [project, setProject] = useState<Project | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [section, setSection] = useState<string>('overview')
  const [advancedNavigation, setAdvancedNavigation] = useState(() => window.localStorage.getItem('sdns.workspace.advanced-navigation') === 'true')
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
  const [sourceImportOpen, setSourceImportOpen] = useState(false)
  const [dataVersion, setDataVersion] = useState(0)
  const [generateIdea, setGenerateIdea] = useState('')
  const [workflowSnapshot, setWorkflowSnapshot] = useState<ProjectWorkflowSnapshot | null>(null)
  const [adaptationReadiness, setAdaptationReadiness] = useState<AdaptationReadinessSummary | null>(null)
  const [caseStudies, setCaseStudies] = useState<CreativeCaseStudy[]>([])
  const [visualProfiles, setVisualProfiles] = useState<CharacterVisualProfile[]>([])
  const [storyArcs, setStoryArcs] = useState<StoryArc[]>([])
  const [chapterMemories, setChapterMemories] = useState<ChapterMemory[]>([])
  const [qualityReports, setQualityReports] = useState<QualityGateReport[]>([])
  const [editorSaveState, setEditorSaveState] = useState<ChapterTreeStatus['saveState']>('clean')
  const [projectSkills, setProjectSkills] = useState<ProjectSkill[]>([])
  const [generationLineages, setGenerationLineages] = useState<GenerationLineage[]>([])
  const [generationCosts, setGenerationCosts] = useState<GenerationCostEntry[]>([])
  const [projectAssets, setProjectAssets] = useState<ProjectAsset[]>([])
  const [assetRights, setAssetRights] = useState<AssetRightsRecord[]>([])
  const chapterSearchRef = useRef<HTMLInputElement>(null)
  const handledImportIntentRef = useRef<string | undefined>(undefined)
  const [contextControls, setContextControls] = useState<AiContextControls>({})
  const [pendingGenerate, setPendingGenerate] = useState<{
    taskType: PreviewTaskType
    userInstruction?: string
    characterId?: string
  } | null>(null)
  const [aiCommandPaletteOpen, setAiCommandPaletteOpen] = useState(false)
  const [pendingPaletteCommand, setPendingPaletteCommand] = useState<NovelTaskType | null>(null)
  const [paletteCommandRunning, setPaletteCommandRunning] = useState(false)
  const [preflightRunning, setPreflightRunning] = useState(false)
  const requestedAdaptationId = searchParams.get('adaptation') ?? undefined
  const requestedQualityIssueId = searchParams.get('qualityIssue') ?? undefined
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
  const visibleNavigationGroups = useMemo(
    () => WORKSPACE_NAV_GROUPS.map((group) => ({
      ...group,
      items: advancedNavigation ? group.items : group.items.filter((item) => group.basicItemKeys.includes(item.key)),
    })),
    [advancedNavigation],
  )
  const activeNavigationItem = WORKSPACE_NAV_GROUPS
    .flatMap((group) => group.items)
    .find((item) => item.key === section)

  const loadWorkflowSnapshot = useCallback(async (
    currentProject: Project,
    projectChapters: Chapter[],
    requestedActiveAdaptationId?: string,
  ) => {
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
      longTasks,
      nextGenerationLineages,
      nextGenerationCosts,
      nextProjectAssets,
      nextAssetRights,
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
      ipc.longTask.list(currentProject.id),
      ipc.generation.listLineagesByProject(currentProject.id),
      ipc.generation.listCostsByProject(currentProject.id),
      ipc.asset.listByProject(currentProject.id),
      ipc.rights.listByProject(currentProject.id),
    ])
    setVisualProfiles(nextVisualProfiles)
    setCaseStudies(nextCaseStudies)
    setStoryArcs(nextStoryArcs)
    setChapterMemories(chapterMemories)
    setQualityReports(qualityReports)
    setProjectSkills(nextProjectSkills)
    setGenerationLineages(nextGenerationLineages)
    setGenerationCosts(nextGenerationCosts)
    setProjectAssets(nextProjectAssets)
    setAssetRights(nextAssetRights)

    const activeResolution = await ipc.project.resolveActiveAdaptation(
      currentProject.id,
      requestedActiveAdaptationId,
    )
    const activeAdaptation = activeResolution.adaptation
    const snapshotProject = currentProject.activeAdaptationId === activeAdaptation?.id
      ? currentProject
      : { ...currentProject, activeAdaptationId: activeAdaptation?.id }
    if (snapshotProject !== currentProject) setProject(snapshotProject)
    let episodes: ProjectWorkflowSnapshot['episodes'] = []
    let scripts: ProjectWorkflowSnapshot['scripts'] = []
    let scenes: ProjectWorkflowSnapshot['scenes'] = []
    let shots: ProjectWorkflowSnapshot['shots'] = []
    let videoTasks: ProjectWorkflowSnapshot['videoTasks'] = []
    let videoResults: ProjectWorkflowSnapshot['videoResults'] = []

    if (activeAdaptation) {
      episodes = await ipc.episode.list(activeAdaptation.id)
      scripts = await ipc.script.list(activeAdaptation.id)
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
      project: snapshotProject,
      chapters: projectChapters,
      characters,
      outlines,
      qualityReports,
      adaptations,
      activeAdaptation,
      episodes,
      scripts,
      scenes,
      shots,
      videoTasks,
      videoResults,
      longTasks,
    })
    setAdaptationReadiness(buildAdaptationReadiness({
      project: snapshotProject,
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
    if (project) void loadWorkflowSnapshot(project, chapters, requestedAdaptationId)
    else {
      setWorkflowSnapshot(null)
      setAdaptationReadiness(null)
      setCaseStudies([])
      setVisualProfiles([])
      setStoryArcs([])
      setChapterMemories([])
      setQualityReports([])
      setProjectSkills([])
      setProjectAssets([])
      setAssetRights([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, chapterWorkflowKey, dataVersion, loadWorkflowSnapshot, requestedAdaptationId])

  const loadAiRuns = useCallback(async () => {
    if (!id) return
    setAiRuns(await ipc.aiRun.list(id))
  }, [id])

  useEffect(() => {
    void loadProject()
  }, [loadProject])
  useEffect(() => {
    const requestedSection = searchParams.get('section')
    setSection(requestedSection && WORKSPACE_SECTION_KEYS.has(requestedSection) ? requestedSection : 'overview')
    const requestedChapter = searchParams.get('chapter')
    if (requestedChapter) setSelectedId(requestedChapter)
  }, [searchParams])
  useEffect(() => {
    window.localStorage.setItem('sdns.workspace.advanced-navigation', String(advancedNavigation))
  }, [advancedNavigation])
  useEffect(() => {
    const importIntent = searchParams.get('next') === 'import-source' && id ? id : undefined
    if (importIntent && handledImportIntentRef.current !== importIntent) {
      handledImportIntentRef.current = importIntent
      setSourceImportOpen(true)
    }
  }, [id, searchParams])
  useEffect(() => {
    if (section === 'ai-runs') void loadAiRuns()
  }, [section, loadAiRuns])
  useEffect(() => {
    const openPalette = () => setAiCommandPaletteOpen(true)
    window.addEventListener('sdns:open-ai-command-palette', openPalette)
    return () => window.removeEventListener('sdns:open-ai-command-palette', openPalette)
  }, [])

  const openWorkspaceTarget = useCallback((nextSection: string, chapterId?: string | null, qualityIssueId?: string) => {
    setSection(nextSection)
    if (chapterId !== undefined) setSelectedId(chapterId)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('section', nextSection)
      const zone = WORKSPACE_NAV_GROUPS.find((group) => group.items.some((item) => item.key === nextSection))?.key
      if (zone) next.set('zone', zone)
      if (chapterId) next.set('chapter', chapterId)
      else if (chapterId !== undefined || nextSection !== 'chapters') next.delete('chapter')
      if (qualityIssueId) next.set('qualityIssue', qualityIssueId)
      else if (nextSection !== 'creative-diagnosis') next.delete('qualityIssue')
      return next
    })
  }, [setSearchParams])

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
  const pendingPaletteCommandPreflight = pendingPaletteCommand ? buildAiPreflightContext(
    pendingPaletteCommand,
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

  const createChapter = useCallback(async () => {
    if (!id) return
    const c = await ipc.chapter.create({ projectId: id, title: `第 ${chapters.length + 1} 章` })
    setChapters((prev) => [...prev, c])
    openWorkspaceTarget('chapters', c.id)
    setEditorNonce((n) => n + 1)
  }, [chapters.length, id, openWorkspaceTarget])

  const reorderChapters = useCallback(async (orderedIds: string[]) => {
    if (!id) return
    try {
      const reordered = await ipc.chapter.reorder(id, orderedIds)
      setChapters(reordered)
      toast.success('章节顺序已保存')
    } catch (error) {
      toast.error(`章节排序失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [id])

  async function deleteChapter(chapterId: string) {
    if (!(await confirmAction(deleteConfirmation('该章节')))) return
    await ipc.chapter.remove(chapterId)
    const next = chapters.filter((chapter) => chapter.id !== chapterId)
    setChapters(next)
    if (selectedId === chapterId) openWorkspaceTarget('chapters', next[0]?.id ?? null)
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

  const chapterTreeStatuses = useMemo<Record<string, ChapterTreeStatus>>(() => {
    const memorizedIds = new Set(chapterMemories.map((memory) => memory.chapterId))
    const qualityByChapter = new Map<string, QualityGateReport>()
    for (const report of qualityReports) {
      if (report.targetKind !== 'chapter' || !report.targetId) continue
      const previous = qualityByChapter.get(report.targetId)
      if (!previous || report.updatedAt >= previous.updatedAt) qualityByChapter.set(report.targetId, report)
    }
    return Object.fromEntries(chapters.map((chapter) => [chapter.id, {
      words: chapter.content.replace(/\s/g, '').length,
      hasMemory: memorizedIds.has(chapter.id),
      quality: qualityByChapter.get(chapter.id)?.verdict,
      saveState: chapter.id === selectedId ? editorSaveState : 'saved',
    }]))
  }, [chapterMemories, chapters, editorSaveState, qualityReports, selectedId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      const isCommand = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (isCommand && key === 'n') {
        event.preventDefault()
        void createChapter()
        return
      }
      if (isCommand && key === 'k') {
        event.preventDefault()
        // 写作页保留章节检索；其余工作区打开全局 AI 命令面板。
        if (section === 'chapters' && chapterSearchRef.current) {
          chapterSearchRef.current.focus()
          chapterSearchRef.current.select()
        } else {
          setAiCommandPaletteOpen(true)
        }
        return
      }
      // 普通方向键仍保留给正文光标和树控件；只有 Alt+方向键跨章节。
      if (!event.altKey || isCommand || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || chapters.length < 2) return
      const currentIndex = chapters.findIndex((chapter) => chapter.id === selectedId)
      const nextIndex = Math.min(chapters.length - 1, Math.max(0, (currentIndex < 0 ? 0 : currentIndex) + (event.key === 'ArrowUp' ? -1 : 1)))
      const next = chapters[nextIndex]
      if (!next || next.id === selectedId) return
      event.preventDefault()
      openWorkspaceTarget('chapters', next.id)
      setEditorNonce((nonce) => nonce + 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [chapters, createChapter, openWorkspaceTarget, section, selectedId])

  async function openSelectedTextAi(selectedText: string) {
    if (!project || !selected) return
    const excerpt = selectedText.trim().slice(0, 6000)
    if (!excerpt) return
    const toastId = toast.loading('正在为所选片段生成润色预览…')
    try {
      const result = await ipc.ai.run({
        projectId: project.id,
        chapterId: selected.id,
        taskType: 'polish_chapter',
        userInstruction: `请仅润色下面选中的片段，保持人物、事件和叙述事实不变，给出可审阅的替换建议：\n\n${excerpt}`,
        contextControls,
      })
      if (result.ok && result.result?.kind === 'text_preview') {
        setTextPreview(result.result.data as TextDiffPreviewPayload)
        toast.success('润色预览已生成，请确认后采用', { id: toastId })
      } else if (result.ok) {
        toast.success('AI 操作已完成', { id: toastId })
        await onChapterUpdated()
      } else {
        toast.error(`AI 润色失败：${result.error ?? '未知错误'}`, { id: toastId })
      }
    } catch (error) {
      toast.error(`AI 润色失败：${error instanceof Error ? error.message : String(error)}`, { id: toastId })
    }
  }

  function requestPaletteChapterTask(taskType: NovelTaskType) {
    if (!selected) {
      openWorkspaceTarget('chapters')
      return
    }
    setPendingPaletteCommand(taskType)
  }

  async function runPendingPaletteCommand() {
    if (!pendingPaletteCommand || !project || !selected) return
    setPaletteCommandRunning(true)
    const label = TASK_TYPE_LABELS[pendingPaletteCommand] ?? pendingPaletteCommand
    const toastId = toast.loading(`正在执行：${label}…`)
    try {
      const result = await ipc.ai.run({
        projectId: project.id,
        chapterId: selected.id,
        taskType: pendingPaletteCommand,
        contextControls,
      })
      if (result.ok && result.result?.kind === 'text_preview') {
        setTextPreview(result.result.data as TextDiffPreviewPayload)
        toast.success(`${label}预览已生成，请确认后采用`, { id: toastId })
      } else if (result.ok) {
        await onChapterUpdated()
        toast.success(`${label}已完成`, { id: toastId })
      } else {
        toast.error(`${label}失败：${result.error ?? '未知错误'}`, { id: toastId })
      }
      setPendingPaletteCommand(null)
    } catch (error) {
      toast.error(`${label}异常：${error instanceof Error ? error.message : String(error)}`, { id: toastId })
    } finally {
      setPaletteCommandRunning(false)
    }
  }

  function openExistingAiTask(command: AiCommandDefinition) {
    const workspaceSection = WORKSPACE_SECTION_BY_TASK[command.taskType]
    if (workspaceSection) {
      openWorkspaceTarget(workspaceSection)
      return
    }
    if (command.group === 'creative_strategy') {
      openWorkspaceTarget('creative-diagnosis')
      return
    }
    if (command.group === 'writing_room') {
      navigate(`/projects/${project?.id ?? id}/writing-room`)
      return
    }
    const adaptation = workflowSnapshot?.activeAdaptation
    if (adaptation && (command.group === 'adaptation' || command.group === 'script' || command.group === 'shot')) {
      const path = command.group === 'adaptation' ? '' : command.group === 'script' ? '/scripts' : '/shots'
      navigate(`/adaptations/${adaptation.id}${path}`)
      return
    }
    if (command.group === 'adaptation' || command.group === 'script' || command.group === 'shot') {
      toast.message(`请先创建改编项目，再继续「${command.label}」。`)
      navigate(`/adaptations/new?source=${project?.id ?? id}`)
      return
    }
    toast.message(`「${command.label}」保留在原有${command.groupLabel}工作区。`)
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

  async function handleAdopt(data: unknown, options: { partialAdopt: boolean }) {
    if (!project) return
    const res = await ipc.ai.applyResult({
      projectId: project.id,
      taskType: preview.taskType,
      data,
      partialAdopt: options.partialAdopt,
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

  async function handleTextAdopt(candidate: TextDiffPreviewPayload) {
    if (!project) return
    const res = await ipc.ai.applyResult({
      projectId: project.id,
      taskType: candidate.taskType,
      data: candidate,
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
  const pilotProductionTruth = workflowSnapshot
    ? buildPilotProductionTruth({
        project: workflowSnapshot.project,
        chapters: workflowSnapshot.chapters,
        characters: workflowSnapshot.characters,
        outlines: workflowSnapshot.outlines,
        qualityReports: workflowSnapshot.qualityReports,
        activeAdaptation: workflowSnapshot.activeAdaptation,
        episodes: workflowSnapshot.episodes,
        scripts: workflowSnapshot.scripts,
        scenes: workflowSnapshot.scenes,
        shots: workflowSnapshot.shots,
        videoTasks: workflowSnapshot.videoTasks,
        videoResults: workflowSnapshot.videoResults,
        longTasks: workflowSnapshot.longTasks,
      })
    : null
  const primaryAdaptation = workflowSnapshot?.activeAdaptation

  async function changeActiveAdaptation(adaptationId: string) {
    if (!project) return
    const updated = await ipc.project.setActiveAdaptation(project.id, adaptationId)
    if (!updated) {
      toast.error('切换失败：该改编不属于当前项目')
      return
    }
    setProject(updated)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('adaptation', adaptationId)
      return next
    })
    toast.success('已切换当前改编，相关分集、剧本、分镜和视频数据已同步刷新')
  }

  async function updateGenerationCost(id: string, patch: { actualCost?: number; currency?: string; actualCostNote?: string }) {
    const updated = await ipc.generation.updateCost(id, patch)
    if (!updated) {
      toast.error('费用账本更新失败')
      return
    }
    setGenerationCosts((current) => current.map((cost) => cost.id === updated.id ? updated : cost))
    toast.success('已记录实际费用；不会覆盖原始估算')
  }

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
      openWorkspaceTarget('overview')
    } else if (stageKey === 'characters') {
      openWorkspaceTarget('characters')
    } else if (stageKey === 'outline') {
      openWorkspaceTarget('outline')
    } else if (stageKey === 'chapters') {
      openWorkspaceTarget('chapters', selectedId)
    } else if (stageKey === 'quality') {
      openWorkspaceTarget('quality-gates')
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
    return <WorkspaceShellState title="正在打开项目">加载项目内容，请稍候…</WorkspaceShellState>
  }

  return (
    <>
      <WorkspaceShell
        title={project.title}
        breadcrumbs={[
          '项目',
          primaryAdaptation ? `第 ${primaryAdaptation.seasonNumber ?? 1} 季：${primaryAdaptation.title}` : '创作工作台',
          section === 'chapters' && selected ? selected.title : section,
        ]}
        badge={<Badge variant="secondary">{project.shortDramaType}</Badge>}
        actions={
          <div className="flex items-center gap-1">
            {workflowSnapshot?.adaptations.length ? (
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="sr-only">当前改编</span>
                <select
                  aria-label="当前改编"
                  className="h-8 max-w-44 rounded-md border bg-background px-2 text-xs text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                  value={primaryAdaptation?.id ?? ''}
                  onChange={(event) => void changeActiveAdaptation(event.target.value)}
                >
                  {workflowSnapshot.adaptations.map((adaptation) => (
                    <option key={adaptation.id} value={adaptation.id}>
                      当前：第 {adaptation.seasonNumber ?? 1} 季 · {adaptation.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => setAiCommandPaletteOpen(true)} title="打开 AI 命令面板（⌘/Ctrl+K）">
              <Command />
              AI 命令
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSourceImportOpen(true)}>
              <FilePlus2 />
              导入正文
            </Button>
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
          </div>
        }
        context={(mode) => section === 'chapters' && mode === 'full' ? (
          <section className="flex h-full min-h-0 flex-col" aria-label="章节导航">
            <div className="flex gap-1 border-b p-2">
              <Button
                variant="ghost"
                size="sm"
                className="min-w-0 flex-1 justify-start text-xs"
                title="项目概览"
                onClick={() => openWorkspaceTarget('overview')}
              >
                项目概览
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="打开项目阶段菜单">
                    <Menu />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-[70vh] w-56 overflow-y-auto">
                  {visibleNavigationGroups.map((group) => (
                    <div key={group.key} className="py-1">
                      <div className="px-2 py-1 text-xs font-medium text-muted-foreground">{group.label}</div>
                      {group.items.map((item) => (
                        <DropdownMenuItem
                          key={item.key}
                          onClick={() => item.key === 'writing-room'
                            ? navigate(`/projects/${project.id}/writing-room`)
                            : openWorkspaceTarget(item.key)}
                        >
                          {item.label}
                        </DropdownMenuItem>
                      ))}
                    </div>
                  ))}
                  <DropdownMenuItem onClick={() => setAdvancedNavigation((value) => !value)}>
                    {advancedNavigation ? '收起高级功能' : '显示全部高级功能'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="min-h-0 flex-1">
              <ChapterTree
                chapters={chapters}
                storyArcs={storyArcs}
                selectedId={selectedId}
                statuses={chapterTreeStatuses}
                onSelect={(chapterId) => {
                  openWorkspaceTarget('chapters', chapterId)
                  setEditorNonce((nonce) => nonce + 1)
                }}
                onCreate={() => void createChapter()}
                onReorder={(orderedIds) => void reorderChapters(orderedIds)}
                searchInputRef={chapterSearchRef}
              />
            </div>
          </section>
        ) : mode === 'compact' ? (
          <nav className="flex h-full min-w-0 flex-col items-center gap-2 p-2" aria-label="项目阶段导航">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="secondary" aria-label="打开项目阶段菜单" title="打开项目阶段菜单">
                  <Menu />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-[70vh] w-56 overflow-y-auto">
                {visibleNavigationGroups.map((group) => (
                  <div key={group.key} className="py-1">
                    <div className="px-2 py-1 text-xs font-medium text-muted-foreground">{group.label}</div>
                    {group.items.map((item) => (
                      <DropdownMenuItem
                        key={item.key}
                        onClick={() => item.key === 'writing-room'
                          ? navigate(`/projects/${project.id}/writing-room`)
                          : openWorkspaceTarget(item.key)}
                      >
                        {item.label}
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
                <DropdownMenuItem onClick={() => setAdvancedNavigation((value) => !value)}>
                  {advancedNavigation ? '收起高级功能' : '显示全部高级功能'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="rounded-md bg-accent px-1.5 py-2 text-center text-xs font-medium text-accent-foreground" title="当前工作区">
              {(activeNavigationItem?.label ?? '当前').slice(0, 2)}
            </div>
            <div className="mt-auto">
              <Button variant="outline" size="icon" aria-label="新建章节" title="新建章节" onClick={createChapter}>
                <FilePlus2 />
                <span className="sr-only">新建章节</span>
              </Button>
            </div>
          </nav>
        ) : (
          <nav className="flex h-full min-w-0 flex-col" aria-label="项目阶段导航">
            <ScrollArea className="flex-1">
              <div className="space-y-3 p-2">
                {visibleNavigationGroups.map((group) => (
                  <div key={group.key} className="space-y-1">
                    <div className="px-3 py-1 text-xs font-medium text-muted-foreground">{group.label}</div>
                    {group.items.map((item) => {
                      const active = section === item.key
                      const isChapterEntry = item.key === 'chapters'
                      return (
                        <button
                          key={item.key}
                          onClick={() => {
                            if (item.key === 'writing-room') {
                              void navigate(`/projects/${project.id}/writing-room`)
                              return
                            }
                            openWorkspaceTarget(item.key)
                          }}
                          aria-label={item.label}
                          title={item.label}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex w-full items-center rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                            active
                              ? 'bg-accent font-medium text-accent-foreground'
                              : 'text-foreground hover:bg-accent/60 dark:!text-slate-200',
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
              <Button variant="ghost" size="sm" className="mb-1 w-full text-xs" onClick={() => setAdvancedNavigation((value) => !value)}>
                {advancedNavigation ? '收起高级功能' : '显示高级功能'}
              </Button>
              <Button variant="outline" size="sm" className="w-full" title="新建章节" onClick={createChapter}>
                <FilePlus2 />
                新建章节
              </Button>
            </div>
          </nav>
        )}
        inspector={
          section === 'chapters' ? (
            <ScrollArea className="h-full bg-muted/20">
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
            <div className="h-full bg-muted/20 p-4 text-sm text-muted-foreground">
              在「章节」中使用 AI 写作助手（生成 / 续写 / 润色 / 扩写 / 增强冲突与爽点与 AI 短剧感）。
              <br />
              <br />
              通过记忆、人物状态、视觉档案、时间线、伏笔与一致性检查，保持长篇设定统一。
            </div>
          )
        }
      >

        {/* 中：主区 */}
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {section === 'content' && (
            <TaskZonePanel
              title="内容"
              description="从灵感、人物和大纲到可编辑正文；先完成眼前的一步，不必理解底层 Agent 或记忆术语。"
              items={[
                { title: '项目概览', detail: '查看当前结果、阻塞与下一步。', action: () => openWorkspaceTarget('overview') },
                { title: '写正文', detail: chapters.length ? `继续编辑 ${chapters.length} 个章节。` : '从第一章或导入已有主稿开始。', action: () => openWorkspaceTarget('chapters', selectedId) },
                { title: '人物与大纲', detail: '整理人物关系和故事走向。', action: () => openWorkspaceTarget(chapters.length ? 'outline' : 'characters') },
                { title: '导入授权内容', detail: '导入 TXT、Markdown、DOCX、EPUB 或结构化剧本。', action: () => setSourceImportOpen(true) },
              ]}
            />
          )}

          {section === 'story-bible' && <StoryBibleChangeSetsSection projectId={project.id} chapter={selected} />}

          {section === 'action-center' && (
            <TaskZonePanel
              title="行动中心"
              description="把评分、节拍、爽点、质量问题和制作可行性汇总为下一步可执行的检查，而不是分散的分析页面。"
              items={[
                { title: '质量闸门', detail: '查看当前阻塞与需要处理的问题。', action: () => openWorkspaceTarget('quality-gates') },
                { title: '短剧适配与节奏', detail: '检查短剧评分、节拍和爽点。', action: () => openWorkspaceTarget('evaluation') },
                { title: '创意诊断', detail: '处理创意风险与修订建议。', action: () => openWorkspaceTarget('creative-diagnosis') },
                { title: 'AI 制作可行性', detail: '确认镜头与视频生产的可执行性。', action: () => openWorkspaceTarget('ai-video') },
              ]}
            />
          )}

          {section === 'production' && (
            <TaskZonePanel
              title="制作"
              description={primaryAdaptation ? `当前制作对象：第 ${primaryAdaptation.seasonNumber ?? 1} 季《${primaryAdaptation.title}》。` : '先确定第一季范围；无论是小说改编还是直接制作漫剧，都不要求先创建空章节。'}
              items={[
                { title: primaryAdaptation ? '进入分集与剧本制作' : '创建第一季', detail: primaryAdaptation ? '继续分集、剧本、分镜与视频生产。' : '按项目生产简报建立可编辑的第一季。', action: () => openAdaptationPath('overview') },
                { title: '处理制作阻塞', detail: '从行动中心查看质量、节奏和可行性问题。', action: () => openWorkspaceTarget('action-center') },
              ]}
            />
          )}

          {section === 'delivery' && (
            <TaskZonePanel
              title="交付"
              description="导出当前可用内容包；完整剪辑、平台交付与运营反馈将在后续生产 loop 中接入。"
              items={[
                { title: '导出小说投稿包', detail: '生成 Markdown 或 JSON 投稿包。', action: () => void handleSubmissionExport('md') },
                { title: '导出完整项目包', detail: '备份项目数据，并可在另一设备导入。', action: () => void handleExportPackage() },
                { title: '查看 AI 调用记录', detail: '查看已执行的 AI 任务与结果。', action: () => openWorkspaceTarget('ai-runs') },
              ]}
            />
          )}

          {section === 'chapters' && (
            <>
              <div className="flex items-center gap-2 border-b px-3 py-2">
                {chapters.length > 0 ? (
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{selected ? `第 ${selected.orderIndex + 1} 章 · ${selected.title}` : '从章节树选择一章'}</div>
                    <div className="text-xs text-muted-foreground">⌘/Ctrl+K 搜索 · Alt+↑↓ 切章 · ⌘/Ctrl+S 保存</div>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">还没有章节</span>
                )}
                <Button size="sm" variant="outline" onClick={() => void createChapter()} aria-keyshortcuts="Control+N Meta+N">
                  <FilePlus2 />
                  新建
                </Button>
                {selected && (
                  <Button size="icon" variant="ghost" title="删除章节" aria-label="删除章节" onClick={() => deleteChapter(selected.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>

              {selected ? (
                <>
                  <div className="border-b px-4 py-2">
                    <Input
                      aria-label="章节标题"
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
                        onSaveStateChange={setEditorSaveState}
                        onSelectedTextAi={openSelectedTextAi}
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
                <div className="grid gap-2 rounded-md border bg-muted/30 p-3 md:grid-cols-3">
                  <div><div className="text-xs text-muted-foreground">当前结果</div><div className="font-medium">{chapters.length} 章 · {chapters.reduce((sum, chapter) => sum + chapter.content.replace(/\s/g, '').length, 0).toLocaleString('zh-CN')} 字</div></div>
                  <div><div className="text-xs text-muted-foreground">主要下一步</div><div className="font-medium">{workflowStages.find((stage) => !stage.complete)?.actionLabel ?? '检查交付内容'}</div></div>
                  <div><div className="text-xs text-muted-foreground">制作预算</div><div className="font-medium">{project.productionBrief?.profile.budgetTier === 'premium' ? '高规格制作' : project.productionBrief?.profile.budgetTier === 'standard' ? '标准制作' : '试播 / 低预算'}</div></div>
                </div>
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
                {pilotProductionTruth && <PilotProductionPanel
                  adaptationId={workflowSnapshot?.activeAdaptation?.id}
                  truth={pilotProductionTruth}
                  onOpenTaskCenter={() => navigate(`/settings/tasks?project=${encodeURIComponent(project.id)}`)}
                />}
                <GenerationLedgerPanel
                  lineages={generationLineages}
                  costs={generationCosts}
                  onUpdateCost={updateGenerationCost}
                />
                <RightsLedgerPanel projectId={project.id} assets={projectAssets} records={assetRights} onChanged={() => setDataVersion((value) => value + 1)} />
                {project.productionBrief && (() => {
                  const brief = project.productionBrief
                  const goal = PROJECT_CREATION_GOAL_OPTIONS.find((option) => option.value === brief.creationGoal)
                  const presentation = PRODUCTION_PRESENTATION_OPTIONS.find((option) => option.value === brief.profile.presentation)
                  const platform = PRODUCTION_PLATFORM_OPTIONS.find((option) => option.value === brief.profile.platform)
                  return (
                    <div className="rounded-md border bg-muted/30 p-3 text-sm">
                      <div className="mb-2 flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><span className="font-medium">项目生产简报</span></div>
                      <div className="grid grid-cols-2 gap-y-1 text-xs text-muted-foreground">
                        <div>创建路径：{goal?.label ?? brief.creationGoal}</div>
                        <div>表现形式：{presentation?.label ?? brief.profile.presentation}</div>
                        <div>目标平台：{platform?.label ?? brief.profile.platform}</div>
                        <div>画幅 / 时长：{brief.profile.aspectRatio} / {formatProductionDuration(brief.profile.episodeDuration)}</div>
                        <div>试播：{brief.profile.pilotEpisodeCount} 集</div>
                        <div>预算档位：{brief.profile.budgetTier === 'starter' ? '试播 / 低预算' : brief.profile.budgetTier === 'standard' ? '标准制作' : '高规格制作'}</div>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {brief.nextStep === 'import_source' ? '下一步：导入拥有授权的小说或剧本正文；目前未创建任何空章节。' : brief.nextStep === 'create_direct_adaptation' ? '下一步：直接创建第一季与剧本生产路径，无需先写小说章节。' : '下一步：补全故事设定或开始写第一章，再进入改编。'}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {brief.nextStep === 'import_source' && <Button size="sm" variant="outline" onClick={() => setSourceImportOpen(true)}><FilePlus2 />导入授权正文</Button>}
                        {brief.nextStep === 'create_direct_adaptation' && <Button size="sm" variant="outline" onClick={() => navigate(`/adaptations/new?source=${project.id}&mode=direct`)}>创建第一季</Button>}
                      </div>
                    </div>
                  )
                })()}
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
              activeAdaptation={primaryAdaptation}
              onOpenWorkspaceTarget={(nextSection, chapterId, qualityIssueId) => {
                openWorkspaceTarget(nextSection, chapterId, qualityIssueId)
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
                activeAdaptationId: workflowSnapshot?.activeAdaptation?.id,
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
                openWorkspaceTarget('chapters', chapterId)
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
            <CreativeDiagnosisSection
              projectId={project.id}
              chapter={selected}
              qualityTruth={projectQualityTruth}
              activeAdaptation={workflowSnapshot?.activeAdaptation}
              focusQualityIssueId={requestedQualityIssueId}
              onQualityGateRechecked={() => setDataVersion((current) => current + 1)}
            />
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
      </WorkspaceShell>

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
      <AiCommandPalette
        open={aiCommandPaletteOpen}
        onOpenChange={setAiCommandPaletteOpen}
        projectId={project.id}
        chapter={selected}
        onRunChapterTask={requestPaletteChapterTask}
        onOpenExistingTask={openExistingAiTask}
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
      <AiContextPreviewDialog
        open={pendingPaletteCommand !== null}
        preview={pendingPaletteCommandPreflight?.preview ?? null}
        controlGroups={pendingPaletteCommandPreflight?.groups}
        onControlModeChange={(key, targetId, mode) =>
          setContextControls((current) => setAiContextControlMode(current, key, targetId, mode))}
        onRun={() => void runPendingPaletteCommand()}
        runLabel={pendingPaletteCommand ? `执行 ${TASK_TYPE_LABELS[pendingPaletteCommand]}` : '执行 AI'}
        running={paletteCommandRunning}
        onClose={() => setPendingPaletteCommand(null)}
      />
      <SourceImportDialog
        projectId={project.id}
        open={sourceImportOpen}
        onOpenChange={setSourceImportOpen}
        onImported={({ adaptationProjectId }) => {
          void loadProject()
          setDataVersion((value) => value + 1)
          if (adaptationProjectId) navigate(`/adaptations/${adaptationProjectId}`)
        }}
      />
    </>
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

function TaskZonePanel({
  title,
  description,
  items,
}: {
  title: string
  description: string
  items: Array<{ title: string; detail: string; action: () => void }>
}) {
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <button
              key={item.title}
              type="button"
              onClick={item.action}
              className="rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <div className="font-medium">{item.title}</div>
              <div className="mt-1 text-sm text-muted-foreground">{item.detail}</div>
              <div className="mt-3 text-xs font-medium text-primary">打开 →</div>
            </button>
          ))}
        </div>
      </div>
    </ScrollArea>
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
