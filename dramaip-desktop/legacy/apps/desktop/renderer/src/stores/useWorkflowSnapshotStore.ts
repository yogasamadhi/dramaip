// 项目工作流快照的共享 store：把 WorkspacePage 中 8 个数据态 useState 收敛到这里，
// 让各 Section 组件用 selector 精确订阅所需切片，避免任一 setState 触发整个 JSX 树重渲染。
// 遵循 useModelStore / useProjectsStore 的模式：IPC 包装器，不用 persist。
import { create } from 'zustand'
import type {
  AdaptationProject,
  Character,
  Chapter,
  ChapterMemory,
  CharacterVisualProfile,
  CreativeCaseStudy,
  Outline,
  Project,
  ProjectSkill,
  QualityGateReport,
  StoryArc,
} from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { buildAdaptationReadiness, type AdaptationReadinessSummary } from '@/lib/adaptationReadiness'
import { type ProjectWorkflowSnapshot } from '@/lib/projectWorkflowGuide'

interface WorkflowSnapshotState {
  characters: Character[]
  outlines: Outline[]
  chapterMemories: ChapterMemory[]
  qualityReports: QualityGateReport[]
  adaptations: AdaptationProject[]
  visualProfiles: CharacterVisualProfile[]
  caseStudies: CreativeCaseStudy[]
  storyArcs: StoryArc[]
  projectSkills: ProjectSkill[]
  workflowSnapshot: ProjectWorkflowSnapshot | null
  adaptationReadiness: AdaptationReadinessSummary | null
  /** 加载中标记，供组件区分空状态与加载中 */
  loading: boolean

  load: (project: Project, chapters: Chapter[], requestedActiveAdaptationId?: string) => Promise<Project | undefined>
  clear: () => void
}

export const useWorkflowSnapshotStore = create<WorkflowSnapshotState>((set) => ({
  characters: [],
  outlines: [],
  chapterMemories: [],
  qualityReports: [],
  adaptations: [],
  visualProfiles: [],
  caseStudies: [],
  storyArcs: [],
  projectSkills: [],
  workflowSnapshot: null,
  adaptationReadiness: null,
  loading: false,

  load: async (currentProject, projectChapters, requestedActiveAdaptationId) => {
    set({ loading: true })
    try {
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
      set({
        characters,
        outlines,
        chapterMemories,
        qualityReports,
        adaptations,
        visualProfiles: nextVisualProfiles,
        caseStudies: nextCaseStudies,
        storyArcs: nextStoryArcs,
        projectSkills: nextProjectSkills,
      })

      const activeResolution = await ipc.project.resolveActiveAdaptation(
        currentProject.id,
        requestedActiveAdaptationId,
      )
      const activeAdaptation = activeResolution.adaptation
      const snapshotProject = currentProject.activeAdaptationId === activeAdaptation?.id
        ? currentProject
        : { ...currentProject, activeAdaptationId: activeAdaptation?.id }

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

      set({
        workflowSnapshot: {
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
        },
        adaptationReadiness: buildAdaptationReadiness({
          project: snapshotProject,
          chapters: projectChapters,
          characters,
          outlines,
          chapterMemories,
          qualityReports,
        }),
      })
      // 返回可能更新了 activeAdaptationId 的 project，供 WorkspacePage 同步本地 project state。
      return snapshotProject !== currentProject ? snapshotProject : undefined
    } finally {
      set({ loading: false })
    }
  },

  clear: () => set({
    characters: [],
    outlines: [],
    chapterMemories: [],
    qualityReports: [],
    adaptations: [],
    visualProfiles: [],
    caseStudies: [],
    storyArcs: [],
    projectSkills: [],
    workflowSnapshot: null,
    adaptationReadiness: null,
  }),
}))
