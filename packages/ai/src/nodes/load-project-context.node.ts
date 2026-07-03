// loadProjectContextNode —— 从 SQLite 读取项目 / 人物 / 大纲 / 章节（§10.2）
import type { NovelGraphStateType } from '../graphs/state'
import type { NodeDeps } from './deps'
import { applyContextControls } from '../context/context-controls'
import { selectProjectSkillsForTask } from '@sdns/core'

export function createLoadProjectContextNode(deps: NodeDeps) {
  return async (state: NovelGraphStateType): Promise<Partial<NovelGraphStateType>> => {
    const { repos } = deps
    const db = repos.db
    try {
      // v0.4：若有 adaptationProjectId，优先解析改编项目，并通过 sourceProjectId 带出源小说上下文
      let adaptationProjectId = state.adaptationProjectId
      let adaptationProject = undefined
      let episodes = undefined
      // v0.5：剧本上下文
      let currentEpisode = undefined
      let scripts = undefined
      let currentScript = undefined
      let scenes = undefined
      // v0.6：镜头上下文
      let currentScene = undefined
      let shots = undefined
      let currentShot = undefined
      if (adaptationProjectId) {
        adaptationProject = repos.adaptationProject.getAdaptationProject(db, adaptationProjectId)
        if (!adaptationProject) return { error: `未找到改编项目 ${adaptationProjectId}`, retryable: false }
        episodes = repos.episode.listEpisodes(db, adaptationProjectId)
        // 若未显式传 projectId，从改编项目的源项目带出，用于加载源小说上下文
        if (!state.projectId && adaptationProject.sourceProjectId) {
          // 用源项目覆盖 projectId，供后续加载小说上下文
          ;(state as { projectId?: string }).projectId = adaptationProject.sourceProjectId
        }

        // v0.5：剧本任务带出当前集 / 当前剧本 / 场景
        if (state.episodeId) {
          currentEpisode = repos.episode.getEpisode(db, state.episodeId)
          const script = repos.script.getScriptByEpisode(db, state.episodeId)
          currentScript = script
          if (script) {
            scenes = repos.scene.listScenesByScript(db, script.id)
          }
        }
        // 列出该改编项目已有剧本，便于了解进度
        scripts = repos.script.listScripts(db, adaptationProjectId)

        // v0.6：镜头任务带出当前场景 / 当前场景已有镜头 / 当前镜头
        if (state.sceneId) {
          currentScene = repos.scene.getScene(db, state.sceneId)
          shots = repos.shot.listShotsByScene(db, state.sceneId)
          if (state.shotId) {
            currentShot = repos.shot.getShot(db, state.shotId)
          }
        }
      }

      const projectId = state.projectId
      // 改编任务允许没有源项目（纯大纲导入场景），但若有就加载
      if (!projectId && !adaptationProjectId && state.taskType !== 'extract_case_structure') {
        return { error: '缺少 projectId', retryable: false }
      }

      let project = undefined
      let characters: Awaited<ReturnType<typeof repos.character.listCharacters>> = []
      let outlines: Awaited<ReturnType<typeof repos.outline.listOutlines>> = []
      let storyArcs: Awaited<ReturnType<typeof repos.storyArc.listStoryArcs>> = []
      let allProjectSkills: Awaited<ReturnType<typeof repos.projectSkill.listEnabledProjectSkills>> = []
      let chapters: Awaited<ReturnType<typeof repos.chapter.listChapters>> = []
      let chapterMemories: Awaited<ReturnType<typeof repos.chapterMemory.listChapterMemories>> = []
      let characterStates: Awaited<ReturnType<typeof repos.characterState.listCharacterStates>> = []
      let visualProfiles: Awaited<ReturnType<typeof repos.visualProfile.listVisualProfiles>> = []
      let visualSettings: Awaited<ReturnType<typeof repos.visualSetting.listVisualSettings>> = []
      let storyEvents: Awaited<ReturnType<typeof repos.storyEvent.listStoryEvents>> = []
      let foreshadowings: Awaited<ReturnType<typeof repos.foreshadowing.listForeshadowings>> = []
      let evaluations: Awaited<ReturnType<typeof repos.evaluation.listEvaluations>> = []
      let beats: Awaited<ReturnType<typeof repos.beat.listBeats>> = []
      let highlightAnalyses: Awaited<ReturnType<typeof repos.highlight.listHighlights>> = []
      let feasibilityReports: Awaited<ReturnType<typeof repos.feasibility.listFeasibilityReports>> = []
      let dramaTrendReport = undefined
      const creativeCaseStudies = repos.creative.listCaseStudies(db).slice(0, 20)
      let freshnessReports: Awaited<ReturnType<typeof repos.creative.listFreshnessReports>> = []
      let qualityGateReports: Awaited<ReturnType<typeof repos.creative.listQualityGateReports>> = []
      let revisionTasks: Awaited<ReturnType<typeof repos.creative.listRevisionTasks>> = []
      let audienceSimulations: Awaited<ReturnType<typeof repos.creative.listAudienceSimulations>> = []
      let narrativeCurveReports: Awaited<ReturnType<typeof repos.creative.listNarrativeCurveReports>> = []

      if (projectId) {
        project = repos.project.getProject(db, projectId)
        if (!project) return { error: `未找到项目 ${projectId}`, retryable: false }

        characters = repos.character.listCharacters(db, projectId)
        outlines = repos.outline.listOutlines(db, projectId)
        storyArcs = repos.storyArc.listStoryArcs(db, projectId)
        allProjectSkills = repos.projectSkill.listEnabledProjectSkills(db, projectId)
        chapters = repos.chapter.listChapters(db, projectId)

        // v0.2：加载长篇一致性与视觉记忆上下文
        chapterMemories = repos.chapterMemory.listChapterMemories(db, projectId)
        characterStates = repos.characterState.listCharacterStates(db, projectId)
        visualProfiles = repos.visualProfile.listVisualProfiles(db, projectId)
        visualSettings = repos.visualSetting.listVisualSettings(db, projectId)
        storyEvents = repos.storyEvent.listStoryEvents(db, projectId)
        foreshadowings = repos.foreshadowing.listForeshadowings(db, projectId)

        // v0.3：加载分析上下文
        evaluations = repos.evaluation.listEvaluations(db, projectId)
        beats = repos.beat.listBeats(db, projectId)
        highlightAnalyses = repos.highlight.listHighlights(db, projectId)
        feasibilityReports = repos.feasibility.listFeasibilityReports(db, projectId)
        dramaTrendReport = repos.dramaTrend.getDramaTrend(db, projectId)
        freshnessReports = repos.creative.listFreshnessReports(db, projectId)
        qualityGateReports = repos.creative.listQualityGateReports(db, projectId)
        revisionTasks = repos.creative.listRevisionTasks(db, projectId)
        audienceSimulations = repos.creative.listAudienceSimulations(db, projectId)
        narrativeCurveReports = repos.creative.listNarrativeCurveReports(db, projectId)
      }

      // v1.0 多季连载：若改编项目指定了本季章节范围，分集/改编类任务只加载该范围章节
      // （章节数组默认按 orderIndex 升序，按 1-based 序号切片）
      if (adaptationProject?.sourceChapterRange && chapters.length) {
        const { from, to } = adaptationProject.sourceChapterRange
        chapters = chapters.filter((_, idx) => {
          const n = idx + 1
          return n >= from && n <= to
        })
      }

      let currentChapter = state.currentChapter
      if (state.chapterId) {
        currentChapter = repos.chapter.getChapter(db, state.chapterId) ?? currentChapter
      }

      chapters = applyContextControls(chapters, 'chapters', state.contextControls)
      characters = applyContextControls(characters, 'characters', state.contextControls)
      storyArcs = applyContextControls(storyArcs, 'storyArcs', state.contextControls)
      const projectSkills = selectProjectSkillsForTask(allProjectSkills, state.taskType, state.contextControls)
      visualProfiles = applyContextControls(visualProfiles, 'visualProfiles', state.contextControls)
      const controlledCaseStudies = applyContextControls(creativeCaseStudies, 'caseStudies', state.contextControls)

      return {
        project,
        characters,
        outlines,
        storyArcs,
        projectSkills,
        chapters,
        currentChapter: currentChapter ?? undefined,
        chapterMemories,
        characterStates,
        visualProfiles,
        visualSettings,
        storyEvents,
        foreshadowings,
        evaluations,
        beats,
        highlightAnalyses,
        feasibilityReports,
        dramaTrendReport,
        creativeCaseStudies: controlledCaseStudies,
        freshnessReports,
        qualityGateReports,
        revisionTasks,
        audienceSimulations,
        narrativeCurveReports,
        // v0.4
        adaptationProject: adaptationProject ?? undefined,
        episodes: episodes ?? undefined,
        // v0.5
        currentEpisode: currentEpisode ?? undefined,
        scripts: scripts ?? undefined,
        currentScript: currentScript ?? undefined,
        scenes: scenes ?? undefined,
        // v0.6
        currentScene: currentScene ?? undefined,
        shots: shots ?? undefined,
        currentShot: currentShot ?? undefined,
      }
    } catch (e) {
      return { error: `加载上下文失败：${formatError(e)}`, retryable: false }
    }
  }
}

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
