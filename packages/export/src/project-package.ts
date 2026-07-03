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
//   "projectSkills": ProjectSkill[],
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
  AntiTropeVariant,
  AudienceSimulation,
  Beat,
  Chapter,
  ChapterMemory,
  Character,
  CharacterState,
  CharacterVisualProfile,
  ContentVersion,
  CreativeCaseStudy,
  DramaTrendReport,
  Episode,
  EpisodeAnalysis,
  Evaluation,
  Foreshadowing,
  FreshnessReport,
  HighlightAnalysis,
  NarrativeCurveReport,
  Outline,
  Project,
  ProjectAsset,
  ProjectSkill,
  QualityGateReport,
  RevisionTask,
  Scene,
  Script,
  StoryEvent,
  VisualSetting,
  WorkflowRun,
} from '@sdns/core'
import { ProjectPackageSchema } from '@sdns/core'
import type { Repositories } from '@sdns/db'

export const PACKAGE_FORMAT = 'sdns-project-package'
export const PACKAGE_VERSION = 3

export interface ProjectPackageMeta {
  format: typeof PACKAGE_FORMAT
  version: number
  exportedAt: string
  sourceTitle: string
  assetExportMode?: ProjectPackageAssetExportMode
}

export type ProjectPackageAssetExportMode = 'none' | 'manifest'

export interface ProjectPackageOptions {
  includeAssets?: boolean
}

export interface ProjectPackage {
  meta: ProjectPackageMeta
  project: Project
  characters: Character[]
  outlines: Outline[]
  projectSkills: ProjectSkill[]
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
  caseStudies: CreativeCaseStudy[]
  freshnessReports: FreshnessReport[]
  antiTropeVariants: AntiTropeVariant[]
  revisionTasks: RevisionTask[]
  contentVersions: ContentVersion[]
  qualityGateReports: QualityGateReport[]
  audienceSimulations: AudienceSimulation[]
  narrativeCurveReports: NarrativeCurveReport[]
  workflowRuns: WorkflowRun[]
  assets: ProjectAsset[]
  /** 源项目衍生的改编项目（含其分集/剧本/场景/镜头/分析） */
  adaptations: Array<{
    adaptation: AdaptationProject
    episodes: Episode[]
    scripts: Array<{ script: Script; scenes: Scene[] }>
    episodeAnalysis?: EpisodeAnalysis
  }>
  aiRuns: AiRun[]
}

export interface ProjectPackageCounts {
  characters: number
  outlines: number
  chapters: number
  evaluations: number
  memories: number
  projectSkills: number
  creativeReports: number
  adaptations: number
  episodes: number
  scripts: number
  scenes: number
  aiRuns: number
  contentVersions: number
  caseStudies: number
  workflowRuns: number
  assets: number
  totalRecords: number
}

export interface ProjectPackagePreview {
  format: typeof PACKAGE_FORMAT
  version: number
  exportedAt: string
  sourceTitle: string
  projectTitle: string
  counts: ProjectPackageCounts
}

/** 收集一个项目的完整数据包 */
export function collectProjectPackage(repos: Repositories, projectId: string, options: ProjectPackageOptions = {}): ProjectPackage {
  const db = repos.db
  const project = repos.project.getProject(db, projectId)
  if (!project) throw new Error(`未找到项目 ${projectId}`)

  const characters = repos.character.listCharacters(db, projectId)
  const outlines = repos.outline.listOutlines(db, projectId)
  const projectSkills = repos.projectSkill.listProjectSkills(db, projectId)
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
  const caseStudies = repos.creative.listCaseStudies(db)
  const freshnessReports = repos.creative.listFreshnessReports(db, projectId)
  const antiTropeVariants = collectAntiTropeVariants(db, repos, projectId)
  const revisionTasks = repos.creative.listRevisionTasks(db, projectId)
  const contentVersions = collectContentVersions(db, repos, projectId)
  const qualityGateReports = repos.creative.listQualityGateReports(db, projectId)
  const audienceSimulations = repos.creative.listAudienceSimulations(db, projectId)
  const narrativeCurveReports = repos.creative.listNarrativeCurveReports(db, projectId)
  const workflowRuns = repos.creative.listWorkflowRuns(db, projectId)
  const assets = options.includeAssets
    ? repos.asset.listProjectAssets(db, projectId).filter((asset) => asset.packagePolicy !== 'exclude')
    : []
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
      assetExportMode: options.includeAssets ? 'manifest' : 'none',
    },
    project,
    characters,
    outlines,
    projectSkills,
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
    caseStudies,
    freshnessReports,
    antiTropeVariants,
    revisionTasks,
    contentVersions,
    qualityGateReports,
    audienceSimulations,
    narrativeCurveReports,
    workflowRuns,
    assets,
    adaptations,
    aiRuns,
  }
}

function collectTargetPairs(db: Repositories['db'], repos: Repositories, projectId: string): Array<{ targetKind: string; targetId: string }> {
  const pairs: Array<{ targetKind: string; targetId: string }> = [{ targetKind: 'project', targetId: projectId }]
  for (const c of repos.chapter.listChapters(db, projectId)) pairs.push({ targetKind: 'chapter', targetId: c.id })
  for (const ap of repos.adaptationProject.listAdaptationsByProject(db, projectId)) {
    pairs.push({ targetKind: 'adaptation', targetId: ap.id })
    for (const ep of repos.episode.listEpisodes(db, ap.id)) pairs.push({ targetKind: 'episode', targetId: ep.id })
    for (const script of repos.script.listScripts(db, ap.id)) {
      pairs.push({ targetKind: 'script', targetId: script.id })
      for (const scene of repos.scene.listScenesByScript(db, script.id)) {
        pairs.push({ targetKind: 'scene', targetId: scene.id })
        for (const shot of repos.shot.listShotsByScene(db, scene.id)) pairs.push({ targetKind: 'shot', targetId: shot.id })
      }
    }
  }
  return pairs
}

function collectAntiTropeVariants(db: Repositories['db'], repos: Repositories, projectId: string): AntiTropeVariant[] {
  return collectTargetPairs(db, repos, projectId).flatMap((p) =>
    repos.creative.listAntiTropeVariantsByTarget(db, p.targetKind, p.targetId),
  )
}

function collectContentVersions(db: Repositories['db'], repos: Repositories, projectId: string): ContentVersion[] {
  return collectTargetPairs(db, repos, projectId).flatMap((p) =>
    repos.creative.listContentVersionsByTarget(db, p.targetKind, p.targetId),
  )
}

/** 序列化为 .sdnspkg 字符串（JSON） */
export function serializeProjectPackage(pkg: ProjectPackage): string {
  const parsed = ProjectPackageSchema.safeParse(pkg)
  if (!parsed.success) {
    throw new Error(`项目包结构校验失败：${formatSchemaIssue(parsed.error.issues[0])}`)
  }
  return JSON.stringify(parsed.data, null, 2)
}

/** 解析 .sdnspkg 字符串 */
export function parseProjectPackage(content: string): ProjectPackage {
  let raw: unknown
  try {
    raw = JSON.parse(content) as unknown
  } catch (e) {
    throw new Error(`项目包 JSON 解析失败：${e instanceof Error ? e.message : String(e)}`)
  }

  if (!raw || typeof raw !== 'object') {
    throw new Error('项目包结构校验失败：root: 应为对象')
  }

  const meta = (raw as { meta?: { format?: unknown; version?: unknown } }).meta
  if (meta?.format !== PACKAGE_FORMAT) {
    throw new Error('不是有效的项目包文件（格式标识不匹配）')
  }
  if (typeof meta.version === 'number' && meta.version > PACKAGE_VERSION) {
    throw new Error(`项目包版本 ${meta.version} 高于本程序支持版本 ${PACKAGE_VERSION}，请升级应用`)
  }

  const parsed = ProjectPackageSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`项目包结构校验失败：${formatSchemaIssue(parsed.error.issues[0])}`)
  }
  return parsed.data as unknown as ProjectPackage
}

export function previewProjectPackage(content: string): ProjectPackagePreview {
  return summarizeProjectPackage(parseProjectPackage(content))
}

export function summarizeProjectPackage(pkg: ProjectPackage): ProjectPackagePreview {
  const episodes = pkg.adaptations.reduce((sum, item) => sum + item.episodes.length, 0)
  const scripts = pkg.adaptations.reduce((sum, item) => sum + item.scripts.length, 0)
  const scenes = pkg.adaptations.reduce(
    (sum, item) => sum + item.scripts.reduce((inner, script) => inner + script.scenes.length, 0),
    0,
  )
  const creativeReports =
    pkg.freshnessReports.length +
    pkg.antiTropeVariants.length +
    pkg.revisionTasks.length +
    pkg.qualityGateReports.length +
    pkg.audienceSimulations.length +
    pkg.narrativeCurveReports.length
  const counts: Omit<ProjectPackageCounts, 'totalRecords'> = {
    characters: pkg.characters.length,
    outlines: pkg.outlines.length,
    chapters: pkg.chapters.length,
    evaluations: pkg.evaluations.length,
    memories:
      pkg.chapterMemories.length +
      pkg.characterStates.length +
      pkg.visualProfiles.length +
      pkg.visualSettings.length +
      pkg.storyEvents.length +
      pkg.foreshadowings.length +
      pkg.beats.length +
      pkg.highlightAnalyses.length +
      pkg.feasibilityReports.length +
      (pkg.dramaTrendReport ? 1 : 0),
    projectSkills: pkg.projectSkills?.length ?? 0,
    creativeReports,
    adaptations: pkg.adaptations.length,
    episodes,
    scripts,
    scenes,
    aiRuns: pkg.aiRuns.length,
    contentVersions: pkg.contentVersions.length,
    caseStudies: pkg.caseStudies.length,
    workflowRuns: pkg.workflowRuns.length,
    assets: pkg.assets?.length ?? 0,
  }
  const totalRecords = Object.values(counts).reduce((sum, count) => sum + count, 1)
  return {
    format: pkg.meta.format,
    version: pkg.meta.version,
    exportedAt: pkg.meta.exportedAt,
    sourceTitle: pkg.meta.sourceTitle,
    projectTitle: pkg.project.title,
    counts: { ...counts, totalRecords },
  }
}

function formatSchemaIssue(issue: { path: Array<string | number>; message: string } | undefined): string {
  if (!issue) return '未知结构错误'
  return `${issue.path.join('.') || 'root'}: ${issue.message}`
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

    // 3.1 项目级创作规范 / Skills
    for (const s of pkg.projectSkills ?? []) {
      const created = repos.projectSkill.createProjectSkill(db, { ...stripId(s), projectId: newProject.id })
      idMap.set(s.id, created.id)
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
      const created = repos.visualProfile.createVisualProfile(db, {
        ...stripId(v),
        projectId: newProject.id,
        characterId: newCharId,
      })
      idMap.set(v.id, created.id)
    }

    // 9. 视觉设定
    for (const v of pkg.visualSettings) {
      const created = repos.visualSetting.createVisualSetting(db, { ...stripId(v), projectId: newProject.id })
      idMap.set(v.id, created.id)
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

    // 15.1 本地样本库（全局结构参考，随包带入；不重映射 project）
    for (const c of pkg.caseStudies ?? []) {
      repos.creative.createCaseStudy(db, stripId(c))
    }

    // 16. 衍生改编项目（含分集/剧本/场景/镜头/分析）
    for (const ap of pkg.adaptations) {
      const newAdapt = repos.adaptationProject.createAdaptationProject(db, {
        ...stripId(ap.adaptation),
        sourceProjectId: newProject.id,
      })
      idMap.set(ap.adaptation.id, newAdapt.id)
      const episodeIdMap = new Map<string, string>()
      for (const ep of ap.episodes) {
        const created = repos.episode.createEpisode(db, { ...stripId(ep), adaptationProjectId: newAdapt.id })
        episodeIdMap.set(ep.id, created.id)
        idMap.set(ep.id, created.id)
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
        idMap.set(script.id, createdScript.id)
        for (const sc of scenes) {
          const createdScene = repos.scene.createScene(db, {
            ...stripId(sc),
            scriptId: createdScript.id,
            episodeId: newEpisodeId,
          })
          idMap.set(sc.id, createdScene.id)
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

    // 17. 创意诊断数据（目标 id 尽量重映射；无法重映射的跨实体记录跳过）
    for (const f of pkg.freshnessReports ?? []) {
      const targetId = remapTargetId(f.targetId, idMap, oldProjectId, newProject.id)
      if (f.targetId && !targetId) continue
      repos.creative.createFreshnessReport(db, {
        ...stripId(f),
        projectId: newProject.id,
        targetId,
      })
    }
    for (const v of pkg.antiTropeVariants ?? []) {
      const targetId = remapTargetId(v.targetId, idMap, oldProjectId, newProject.id)
      if (v.targetId && !targetId) continue
      repos.creative.createAntiTropeVariant(db, {
        ...stripId(v),
        projectId: newProject.id,
        targetId,
      })
    }
    for (const t of pkg.revisionTasks ?? []) {
      const targetId = remapTargetId(t.targetId, idMap, oldProjectId, newProject.id)
      if (t.targetId && !targetId) continue
      repos.creative.createRevisionTask(db, {
        ...stripId(t),
        projectId: newProject.id,
        targetId,
        status: t.status === 'applied' ? 'accepted' : t.status,
        appliedVersionId: undefined,
      })
    }
    for (const v of pkg.contentVersions ?? []) {
      const targetId = remapTargetId(v.targetId, idMap, oldProjectId, newProject.id)
      if (!targetId) continue
      repos.creative.createContentVersion(db, {
        ...stripId(v),
        projectId: newProject.id,
        targetId,
      })
    }
    for (const g of pkg.qualityGateReports ?? []) {
      const targetId = remapTargetId(g.targetId, idMap, oldProjectId, newProject.id)
      if (g.targetId && !targetId) continue
      repos.creative.createQualityGateReport(db, {
        ...stripId(g),
        projectId: newProject.id,
        adaptationProjectId: g.adaptationProjectId ? idMap.get(g.adaptationProjectId) : undefined,
        targetId,
      })
    }
    for (const a of pkg.audienceSimulations ?? []) {
      const targetId = remapTargetId(a.targetId, idMap, oldProjectId, newProject.id)
      if (a.targetId && !targetId) continue
      repos.creative.createAudienceSimulation(db, {
        ...stripId(a),
        projectId: newProject.id,
        targetId,
      })
    }
    for (const c of pkg.narrativeCurveReports ?? []) {
      const targetId = remapTargetId(c.targetId, idMap, oldProjectId, newProject.id)
      if (c.targetId && !targetId) continue
      repos.creative.createNarrativeCurveReport(db, {
        ...stripId(c),
        projectId: newProject.id,
        adaptationProjectId: c.adaptationProjectId ? idMap.get(c.adaptationProjectId) : undefined,
        targetId,
      })
    }
    for (const w of pkg.workflowRuns ?? []) {
      repos.creative.createWorkflowRun(db, {
        ...stripId(w),
        projectId: newProject.id,
        adaptationProjectId: w.adaptationProjectId ? idMap.get(w.adaptationProjectId) : undefined,
        status: w.status === 'running' ? 'failed' : w.status,
        errorMessage: w.status === 'running' ? '导入时中断的工作流已标记为失败' : w.errorMessage,
      })
    }

    // 18. 本地资产库清单：项目包当前只携带引用清单，不承诺旧机器绝对路径可恢复。
    for (const a of pkg.assets ?? []) {
      const sourceEntityId = remapTargetId(a.sourceEntityId, idMap, oldProjectId, newProject.id)
      if (a.sourceEntityId && !sourceEntityId) continue
      repos.asset.createAsset(db, {
        ...stripId(a),
        projectId: newProject.id,
        sourceEntityId,
        localPath: undefined,
        status: a.remoteUrl ? 'remote_only' : 'missing',
        packagePolicy: 'exclude',
        metadata: {
          ...a.metadata,
          importedFromPackage: true,
          originalLocalPath: a.localPath,
          originalRelativePath: a.relativePath,
          originalPackagePolicy: a.packagePolicy,
        },
      })
    }

    // 19. ai_runs（仅记录性，重新挂到新项目；保留原始 type/model 等）
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

function remapTargetId(targetId: string | undefined, idMap: Map<string, string>, oldProjectId: string, newProjectId: string): string | undefined {
  if (!targetId) return undefined
  if (targetId === oldProjectId) return newProjectId
  return idMap.get(targetId)
}

/** 去掉 id / 时间戳，便于 create 时重新生成 */
function stripId<T extends { id?: string; createdAt?: string; updatedAt?: string }>(entity: T): Omit<T, 'id' | 'createdAt' | 'updatedAt'> {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = entity
  void _id
  void _c
  void _u
  return rest
}
