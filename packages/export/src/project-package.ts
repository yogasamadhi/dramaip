// 项目包导出 / 导入（ROADMAP v1.0-2）
//
// 完整项目包：把一个项目相关的全部数据收集为一份 JSON（.sdnspkg），
// 可在另一台机器 / 另一个库重新导入为一个新项目（重新生成 id，保留关联外键映射）。
//
// 格式（JSON）：
// {
//   "meta": { "format": "sdns-project-package", "version": 1, "exportedAt": "...", "sourceTitle": "..." },
//   "project": Project,
//   "characters": Character[],
//   "outlines": Outline[],
//   "chapters": Chapter[],
//   "evaluations": Evaluation[],
//   "chapterMemories": ChapterMemory[],
//   "characterStates": CharacterState[],
//   "visualProfiles": CharacterVisualProfile[],
//   "visualSettings": VisualSetting[],
//   "storyEvents": StoryEvent[],
//   "foreshadowings": Foreshadowing[],
//   "beats": Beat[],
//   "highlightAnalyses": HighlightAnalysis[],
//   "feasibilityReports": AiVideoFeasibilityReport[],
//   "adaptations": AdaptationProject[],   // 源项目衍生的改编项目 + 其分集/剧本/场景/镜头/分析
//   "aiRuns": AiRun[]
// }
//
// 导入时：用事务整体写入；所有 id 重新生成，并维护「旧id → 新id」映射以正确还原外键。
import type {
  AdaptationProject,
  AiRun,
  AiVideoFeasibilityReport,
  Beat,
  Chapter,
  ChapterMemory,
  Character,
  CharacterState,
  CharacterVisualProfile,
  DramaTrendReport,
  Episode,
  EpisodeAnalysis,
  Evaluation,
  Foreshadowing,
  HighlightAnalysis,
  Outline,
  Project,
  Scene,
  Script,
  StoryEvent,
  VisualSetting,
} from '@sdns/core'
import type { Repositories } from '@sdns/db'

export const PACKAGE_FORMAT = 'sdns-project-package'
export const PACKAGE_VERSION = 1

export interface ProjectPackageMeta {
  format: typeof PACKAGE_FORMAT
  version: typeof PACKAGE_VERSION
  exportedAt: string
  sourceTitle: string
}

export interface ProjectPackage {
  meta: ProjectPackageMeta
  project: Project
  characters: Character[]
  outlines: Outline[]
  chapters: Chapter[]
  evaluations: Evaluation[]
  chapterMemories: ChapterMemory[]
  characterStates: CharacterState[]
  visualProfiles: CharacterVisualProfile[]
  visualSettings: VisualSetting[]
  storyEvents: StoryEvent[]
  foreshadowings: Foreshadowing[]
  beats: Beat[]
  highlightAnalyses: HighlightAnalysis[]
  feasibilityReports: AiVideoFeasibilityReport[]
  dramaTrendReport?: DramaTrendReport
  /** 源项目衍生的改编项目（含其分集/剧本/场景/镜头/分析） */
  adaptations: Array<{
    adaptation: AdaptationProject
    episodes: Episode[]
    scripts: Array<{ script: Script; scenes: Scene[] }>
    episodeAnalysis?: EpisodeAnalysis
  }>
  aiRuns: AiRun[]
}

/** 收集一个项目的完整数据包 */
export function collectProjectPackage(repos: Repositories, projectId: string): ProjectPackage {
  const db = repos.db
  const project = repos.project.getProject(db, projectId)
  if (!project) throw new Error(`未找到项目 ${projectId}`)

  const characters = repos.character.listCharacters(db, projectId)
  const outlines = repos.outline.listOutlines(db, projectId)
  const chapters = repos.chapter.listChapters(db, projectId)
  const evaluations = repos.evaluation.listEvaluations(db, projectId)
  const chapterMemories = repos.chapterMemory.listChapterMemories(db, projectId)
  const characterStates = repos.characterState.listCharacterStates(db, projectId)
  const visualProfiles = repos.visualProfile.listVisualProfiles(db, projectId)
  const visualSettings = repos.visualSetting.listVisualSettings(db, projectId)
  const storyEvents = repos.storyEvent.listStoryEvents(db, projectId)
  const foreshadowings = repos.foreshadowing.listForeshadowings(db, projectId)
  const beats = repos.beat.listBeats(db, projectId)
  const highlightAnalyses = repos.highlight.listHighlights(db, projectId)
  const feasibilityReports = repos.feasibility.listFeasibilityReports(db, projectId)
  const dramaTrendReport = repos.dramaTrend.getDramaTrend(db, projectId) ?? undefined
  const aiRuns = repos.aiRun.listAiRunsByProject(db, projectId, 1000)

  // 衍生改编项目
  const adaptations = repos.adaptationProject
    .listAdaptationsByProject(db, projectId)
    .map((adaptation) => {
      const episodes = repos.episode.listEpisodes(db, adaptation.id)
      const scripts = repos.script.listScripts(db, adaptation.id).map((script) => ({
        script,
        scenes: repos.scene.listScenesByScript(db, script.id),
      }))
      const episodeAnalysis = repos.episodeAnalysis.getEpisodeAnalysis(db, adaptation.id) ?? undefined
      return { adaptation, episodes, scripts, episodeAnalysis }
    })

  return {
    meta: {
      format: PACKAGE_FORMAT,
      version: PACKAGE_VERSION,
      exportedAt: new Date().toISOString(),
      sourceTitle: project.title,
    },
    project,
    characters,
    outlines,
    chapters,
    evaluations,
    chapterMemories,
    characterStates,
    visualProfiles,
    visualSettings,
    storyEvents,
    foreshadowings,
    beats,
    highlightAnalyses,
    feasibilityReports,
    dramaTrendReport,
    adaptations,
    aiRuns,
  }
}

/** 序列化为 .sdnspkg 字符串（JSON） */
export function serializeProjectPackage(pkg: ProjectPackage): string {
  return JSON.stringify(pkg, null, 2)
}

/** 解析 .sdnspkg 字符串 */
export function parseProjectPackage(content: string): ProjectPackage {
  const data = JSON.parse(content) as ProjectPackage
  if (data?.meta?.format !== PACKAGE_FORMAT) {
    throw new Error('不是有效的项目包文件（格式标识不匹配）')
  }
  if (data.meta.version > PACKAGE_VERSION) {
    throw new Error(`项目包版本 ${data.meta.version} 高于本程序支持版本 ${PACKAGE_VERSION}，请升级应用`)
  }
  return data
}

/**
 * 导入项目包：把数据写入当前库为一个**新项目**。
 * - 用事务整体写入，任一步骤失败则回滚（不产生半成品）。
 * - 所有 id 重新生成，维护「旧id → 新id」映射以还原外键。
 * - 标题加「（导入）」后缀避免与同名混淆。
 * @returns 新建项目
 */
export function importProjectPackage(repos: Repositories, content: string): Project {
  const pkg = parseProjectPackage(content)
  const db = repos.db

  // Drizzle(better-sqlite3) 同步事务：任一步骤抛错则整体回滚，不产生半成品。
  // 注：better-sqlite3 同步驱动下，事务内的 repos(绑定 db) 写入仍归属此事务（同连接）。
  return db.transaction((): Project => {
    const idMap = new Map<string, string>()
    const oldProjectId = pkg.project.id
    const now = new Date().toISOString()

    // 1. 项目（重新生成 id，标题加后缀）
    const newProject = repos.project.createProject(db, {
      ...stripId(pkg.project),
      title: `${pkg.project.title}（导入）`,
    })
    idMap.set(oldProjectId, newProject.id)

    // 2. 人物
    for (const c of pkg.characters) {
      const created = repos.character.createCharacter(db, {
        ...stripId(c),
        projectId: newProject.id,
      })
      idMap.set(c.id, created.id)
    }

    // 3. 大纲
    for (const o of pkg.outlines) {
      const created = repos.outline.createOutline(db, { ...stripId(o), projectId: newProject.id })
      idMap.set(o.id, created.id)
    }

    // 4. 章节
    for (const c of pkg.chapters) {
      const created = repos.chapter.createChapter(db, { ...stripId(c), projectId: newProject.id })
      idMap.set(c.id, created.id)
      // 同步正文（createChapter 可能不写 content，补一次 update）
      if (c.content) repos.chapter.updateChapterContent(db, created.id, c.content)
    }

    // 5. 评分（chapterId 重映射）
    for (const e of pkg.evaluations) {
      repos.evaluation.createEvaluation(db, {
        ...stripId(e),
        projectId: newProject.id,
        chapterId: e.chapterId ? idMap.get(e.chapterId) : undefined,
      })
    }

    // 6. 章节记忆
    for (const m of pkg.chapterMemories) {
      const newChapterId = idMap.get(m.chapterId)
      if (!newChapterId) continue
      repos.chapterMemory.createChapterMemory(db, {
        ...stripId(m),
        projectId: newProject.id,
        chapterId: newChapterId,
      })
    }

    // 7. 人物状态
    for (const s of pkg.characterStates) {
      const newCharId = idMap.get(s.characterId)
      if (!newCharId) continue
      repos.characterState.createCharacterState(db, {
        ...stripId(s),
        projectId: newProject.id,
        characterId: newCharId,
        chapterId: s.chapterId ? idMap.get(s.chapterId) : undefined,
      })
    }

    // 8. 人物视觉档案
    for (const v of pkg.visualProfiles) {
      const newCharId = idMap.get(v.characterId)
      if (!newCharId) continue
      repos.visualProfile.createVisualProfile(db, {
        ...stripId(v),
        projectId: newProject.id,
        characterId: newCharId,
      })
    }

    // 9. 视觉设定
    for (const v of pkg.visualSettings) {
      repos.visualSetting.createVisualSetting(db, { ...stripId(v), projectId: newProject.id })
    }

    // 10. 故事事件
    for (const e of pkg.storyEvents) {
      repos.storyEvent.createStoryEvent(db, {
        ...stripId(e),
        projectId: newProject.id,
        chapterId: e.chapterId ? idMap.get(e.chapterId) : undefined,
      })
    }

    // 11. 伏笔
    for (const f of pkg.foreshadowings) {
      repos.foreshadowing.createForeshadowing(db, {
        ...stripId(f),
        projectId: newProject.id,
        setupChapterId: f.setupChapterId ? idMap.get(f.setupChapterId) : undefined,
        payoffChapterId: f.payoffChapterId ? idMap.get(f.payoffChapterId) : undefined,
      })
    }

    // 12. 节拍
    for (const b of pkg.beats) {
      repos.beat.createBeat(db, {
        ...stripId(b),
        projectId: newProject.id,
        chapterId: b.chapterId ? idMap.get(b.chapterId) : undefined,
      })
    }

    // 13. 爽点分析
    for (const h of pkg.highlightAnalyses) {
      const newChapterId = idMap.get(h.chapterId)
      if (!newChapterId) continue
      repos.highlight.createHighlight(db, { ...stripId(h), projectId: newProject.id, chapterId: newChapterId })
    }

    // 14. 可行性报告
    for (const f of pkg.feasibilityReports) {
      const newChapterId = idMap.get(f.chapterId)
      if (!newChapterId) continue
      repos.feasibility.createFeasibilityReport(db, {
        ...stripId(f),
        projectId: newProject.id,
        chapterId: newChapterId,
      })
    }

    // 15. 趋势报告
    if (pkg.dramaTrendReport) {
      repos.dramaTrend.upsertDramaTrend(db, { ...stripId(pkg.dramaTrendReport), projectId: newProject.id })
    }

    // 16. 衍生改编项目（含分集/剧本/场景/镜头/分析）
    for (const ap of pkg.adaptations) {
      const newAdapt = repos.adaptationProject.createAdaptationProject(db, {
        ...stripId(ap.adaptation),
        sourceProjectId: newProject.id,
      })
      const episodeIdMap = new Map<string, string>()
      for (const ep of ap.episodes) {
        const created = repos.episode.createEpisode(db, { ...stripId(ep), adaptationProjectId: newAdapt.id })
        episodeIdMap.set(ep.id, created.id)
      }
      for (const { script, scenes } of ap.scripts) {
        const newEpisodeId = script.episodeId ? episodeIdMap.get(script.episodeId) : undefined
        if (!newEpisodeId) continue
        const createdScript = repos.script.createScript(db, {
          ...stripId(script),
          adaptationProjectId: newAdapt.id,
          episodeId: newEpisodeId,
        })
        const scriptIdMap = new Map<string, string>()
        scriptIdMap.set(script.id, createdScript.id)
        for (const sc of scenes) {
          repos.scene.createScene(db, {
            ...stripId(sc),
            scriptId: createdScript.id,
            episodeId: newEpisodeId,
          })
        }
      }
      if (ap.episodeAnalysis) {
        repos.episodeAnalysis.upsertEpisodeAnalysis(db, {
          adaptationProjectId: newAdapt.id,
          hookStrengthTrend: [],
          retentionScoreTrend: [],
          paceScoreTrend: [],
          reversalDensityTrend: [],
          visualAppealTrend: [],
          summary: '（导入自项目包，趋势数据未还原）',
        })
      }
    }

    // 17. ai_runs（仅记录性，重新挂到新项目；保留原始 type/model 等）
    for (const r of pkg.aiRuns) {
      repos.aiRun.createAiRun(db, {
        projectId: newProject.id,
        graphName: r.graphName,
        nodeName: r.nodeName,
        type: r.type,
        provider: r.provider,
        model: r.model,
        input: r.input,
        output: r.output,
        status: r.status,
        errorMessage: r.errorMessage,
        tokenUsage: r.tokenUsage,
        latencyMs: r.latencyMs,
      })
    }

    void now
    return newProject
  })
}

/** 去掉 id / 时间戳，便于 create 时重新生成 */
function stripId<T extends { id?: string; createdAt?: string; updatedAt?: string }>(entity: T): Omit<T, 'id' | 'createdAt' | 'updatedAt'> {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = entity
  void _id
  void _c
  void _u
  return rest
}
