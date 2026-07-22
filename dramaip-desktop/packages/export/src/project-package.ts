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
//   "projectAgentSchemes": ProjectAgentScheme[],
//   "inspirationFavorites": InspirationFavorite[],
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
  AnimaticDraft,
  AudioTrack,
  AiRun,
  AiVideoFeasibilityReport,
  AntiTropeVariant,
  AssetRightsRecord,
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
  GenerationCostEntry,
  GenerationLineage,
  HighlightAnalysis,
  InspirationFavorite,
  NarrativeCurveReport,
  Outline,
  Project,
  ProjectAsset,
  ProjectAgentScheme,
  ProjectSkill,
  QualityGateReport,
  RevisionTask,
  Scene,
  Script,
  Shot,
  ShotStillCandidate,
  StoryEvent,
  ShotVisualAssetLock,
  VisualAssetVersion,
  VisualSetting,
  VoiceProfile,
  WorkflowRun,
} from '@sdns/core'
import { ProjectPackageSchema } from '@sdns/core'
import type { Repositories } from '@sdns/db'

export const PACKAGE_FORMAT = 'sdns-project-package'
export const PACKAGE_VERSION = 12

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
  projectAgentSchemes: ProjectAgentScheme[]
  inspirationFavorites: InspirationFavorite[]
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
  /** 权利台账只含结构化清单、受控证据引用与 hash，永不包含证明正文。 */
  assetRightsRecords?: AssetRightsRecord[]
  /** 角色 / 场景生产资产的不可变候选与已采用版本；随资产清单一起导入导出。 */
  visualAssetVersions?: VisualAssetVersion[]
  /** 分镜锁定的精确视觉版本；上游改版不会静默替换这些锁。 */
  shotVisualAssetLocks?: ShotVisualAssetLock[]
  /** 每镜头的静帧 / 首尾帧 / 封面候选与采用历史；素材本体仍由 assets 引用。 */
  shotStillCandidates?: ShotStillCandidate[]
  /** 可播放 Animatic 的不可变版本与批注；仅在导出素材清单时一并携带。 */
  animaticDrafts?: AnimaticDraft[]
  voiceProfiles?: VoiceProfile[]
  audioTracks?: AudioTrack[]
  /** 脱敏后的生产谱系和费用账本；不包含媒体二进制、密钥或 Provider 原始响应。 */
  generationLineages?: GenerationLineage[]
  generationCostEntries?: GenerationCostEntry[]
  /** 源项目衍生的改编项目（含其分集/剧本/场景/镜头/分析） */
  adaptations: Array<{
    adaptation: AdaptationProject
    episodes: Episode[]
    scripts: Array<{ script: Script; scenes: Scene[]; shots: Shot[] }>
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
  projectAgentSchemes: number
  inspirationFavorites: number
  creativeReports: number
  adaptations: number
  episodes: number
  scripts: number
  scenes: number
  shots: number
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
  const projectAgentSchemes = repos.projectAgentScheme.listProjectAgentSchemes(db, projectId)
  const inspirationFavorites = repos.inspirationFavorite.listInspirationFavorites(db, projectId)
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
  // 权利证明默认只导出清单与 hash：绝对路径、相对路径和证明二进制均不会随项目包外发。
  const packageAssets = assets.map((asset) => asset.kind === 'rights_evidence'
    ? { ...asset, localPath: undefined, relativePath: undefined, status: 'missing' as const }
    : asset)
  const aiRuns = repos.aiRun.listAiRunsByProject(db, projectId, 1000)
  const generationLineages = repos.generation.listGenerationLineagesByProject(db, projectId)
  const generationCostEntries = repos.generation.listGenerationCostEntriesByProject(db, projectId)
  const assetRightsRecords = options.includeAssets ? repos.rights.listAssetRightsByProject(db, projectId) : []
  const visualAssetVersions = options.includeAssets ? repos.visualAsset.listVisualAssetVersionsByProject(db, projectId) : []
  const shotVisualAssetLocks = options.includeAssets ? repos.visualAsset.listShotVisualAssetLocksByProject(db, projectId) : []
  const shotStillCandidates = options.includeAssets ? repos.shotStill.listShotStillCandidatesByProject(db, projectId) : []

  // 衍生改编项目
  const adaptations = repos.adaptationProject
    .listAdaptationsByProject(db, projectId)
    .map((adaptation) => {
      const episodes = repos.episode.listEpisodes(db, adaptation.id)
      const scripts = repos.script.listScripts(db, adaptation.id).map((script) => {
        const scenes = repos.scene.listScenesByScript(db, script.id)
        const shots = scenes.flatMap((scene) => repos.shot.listShotsByScene(db, scene.id))
        return { script, scenes, shots }
      })
      const episodeAnalysis = repos.episodeAnalysis.getEpisodeAnalysis(db, adaptation.id) ?? undefined
      return { adaptation, episodes, scripts, episodeAnalysis }
    })
  const animaticDrafts = options.includeAssets
    ? adaptations.flatMap(({ episodes }) => episodes.flatMap((episode) => repos.animatic.listAnimaticDraftsByEpisode(db, episode.id)))
    : []
  const voiceProfiles = options.includeAssets ? repos.audio.listVoiceProfilesByProject(db, projectId) : []
  const audioTracks = options.includeAssets
    ? adaptations.flatMap(({ episodes }) => episodes.flatMap((episode) => repos.audio.listAudioTracksByEpisode(db, episode.id)))
    : []

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
    projectAgentSchemes,
    inspirationFavorites,
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
    assets: packageAssets,
    assetRightsRecords,
    visualAssetVersions,
    shotVisualAssetLocks,
    shotStillCandidates,
    animaticDrafts,
    voiceProfiles,
    audioTracks,
    generationLineages,
    generationCostEntries,
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
  const shots = pkg.adaptations.reduce(
    (sum, item) => sum + item.scripts.reduce((inner, script) => inner + (script.shots?.length ?? 0), 0),
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
    projectAgentSchemes: pkg.projectAgentSchemes?.length ?? 0,
    inspirationFavorites: pkg.inspirationFavorites?.length ?? 0,
    creativeReports,
    adaptations: pkg.adaptations.length,
    episodes,
    scripts,
    scenes,
    shots,
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

    // 3.2 项目级 Agent 方案（Agent/模型引用保留；项目 Skill 绑定重映射）
    for (const s of pkg.projectAgentSchemes ?? []) {
      const skillIds = s.skillIds.map((skillId) => idMap.get(skillId)).filter(Boolean) as string[]
      const created = repos.projectAgentScheme.createProjectAgentScheme(db, {
        ...stripId(s),
        projectId: newProject.id,
        skillIds,
      })
      idMap.set(s.id, created.id)
    }

    // 3.3 灵感台收藏（来源 id 仅当来自本包内实体时重映射，否则保留来源引用作展示）
    for (const f of pkg.inspirationFavorites ?? []) {
      const sourceId = f.sourceId ? (idMap.get(f.sourceId) ?? f.sourceId) : undefined
      const created = repos.inspirationFavorite.upsertInspirationFavorite(db, {
        ...stripId(f),
        projectId: newProject.id,
        sourceId,
      })
      idMap.set(f.id, created.id)
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
      for (const { script, scenes, shots = [] } of ap.scripts) {
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
        for (const shot of shots) {
          const newSceneId = idMap.get(shot.sceneId)
          const mappedEpisodeId = idMap.get(shot.episodeId) ?? newEpisodeId
          if (!newSceneId) continue
          const createdShot = repos.shot.createShot(db, {
            ...stripId(shot),
            sceneId: newSceneId,
            episodeId: mappedEpisodeId,
          })
          idMap.set(shot.id, createdShot.id)
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
    const assetIdMap = new Map<string, string>()
    for (const a of pkg.assets ?? []) {
      const sourceEntityId = remapTargetId(a.sourceEntityId, idMap, oldProjectId, newProject.id)
      if (a.sourceEntityId && !sourceEntityId) continue
      const created = repos.asset.createAsset(db, {
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
      assetIdMap.set(a.id, created.id)
    }

    // 18.05 权利台账只还原清单和证据 hash；本地证据二进制不会静默进入项目包。
    // 导入后的证据路径保持 missing，用户需显式重新定位后才能通过最终预检。
    for (const rights of pkg.assetRightsRecords ?? []) {
      const assetId = assetIdMap.get(rights.assetId)
      if (!assetId) continue
      repos.rights.createAssetRightsRecord(db, {
        ...stripId(rights),
        projectId: newProject.id,
        assetId,
        evidenceAssetId: rights.evidenceAssetId ? assetIdMap.get(rights.evidenceAssetId) : undefined,
      })
    }

    // 18.06 版本化角色 / 场景生产资产：素材、设定和镜头都必须成功重映射才可恢复。
    // 即便本地文件在新机器上暂时 missing，版本身份与分镜锁仍会被保留，避免静默换图。
    const visualAssetVersionIdMap = new Map<string, string>()
    const adoptedVisualVersionIds: string[] = []
    const orderedVisualVersions = [...(pkg.visualAssetVersions ?? [])].sort((left, right) =>
      `${left.ownerKind}:${left.ownerId}:${left.slot}:${left.versionNumber}`.localeCompare(
        `${right.ownerKind}:${right.ownerId}:${right.slot}:${right.versionNumber}`,
        undefined,
        { numeric: true },
      ),
    )
    for (const version of orderedVisualVersions) {
      const assetId = assetIdMap.get(version.assetId)
      const ownerId = idMap.get(version.ownerId)
      if (!assetId || !ownerId) continue
      const created = repos.visualAsset.createVisualAssetVersion(db, {
        ...stripId(version),
        projectId: newProject.id,
        ownerId,
        assetId,
        status: version.status === 'adopted' ? 'candidate' : version.status,
      })
      if (version.status === 'adopted') adoptedVisualVersionIds.push(created.id)
      visualAssetVersionIdMap.set(version.id, created.id)
    }
    for (const versionId of adoptedVisualVersionIds) repos.visualAsset.adoptVisualAssetVersion(db, versionId)
    for (const lock of pkg.shotVisualAssetLocks ?? []) {
      const shotId = idMap.get(lock.shotId)
      const visualAssetVersionId = visualAssetVersionIdMap.get(lock.visualAssetVersionId)
      if (!shotId || !visualAssetVersionId) continue
      const created = repos.visualAsset.lockShotVisualAsset(db, {
        projectId: newProject.id,
        shotId,
        visualAssetVersionId,
        role: lock.role,
      })
      if (lock.staleReason) {
        // 导入后资产引用仍可能是 missing；保留历史 stale 文案，交由用户重新确认。
        repos.visualAsset.setShotVisualAssetLockStaleState(db, created.id, lock.staleAt, lock.staleReason)
      }
    }

    // 18.07 静帧候选：只重建候选和采用关系，不把历史媒体覆盖进镜头字段。
    // 新库的镜头时间戳不同但内容相同，因此重新锚定 sourceFingerprint；原有 stale 状态仍保留。
    const stillCandidateIdMap = new Map<string, string>()
    const adoptedStillCandidateIds: string[] = []
    const staleStillCandidates: Array<{ id: string; staleAt?: string; staleReason: string }> = []
    const orderedStillCandidates = [...(pkg.shotStillCandidates ?? [])].sort((left, right) =>
      `${left.shotId}:${left.kind}:${left.createdAt}`.localeCompare(`${right.shotId}:${right.kind}:${right.createdAt}`),
    )
    for (const candidate of orderedStillCandidates) {
      const shotId = idMap.get(candidate.shotId)
      const assetId = assetIdMap.get(candidate.assetId)
      if (!shotId || !assetId) continue
      const importedShot = repos.shot.getShot(db, shotId)
      if (!importedShot) continue
      const created = repos.shotStill.createShotStillCandidate(db, {
        ...stripId(candidate),
        projectId: newProject.id,
        shotId,
        assetId,
        sourceFingerprint: importedShot.updatedAt,
        status: candidate.status === 'adopted' ? 'candidate' : candidate.status,
      })
      stillCandidateIdMap.set(candidate.id, created.id)
      if (candidate.status === 'adopted') adoptedStillCandidateIds.push(created.id)
      if (candidate.staleReason) {
        staleStillCandidates.push({ id: created.id, staleAt: candidate.staleAt, staleReason: candidate.staleReason })
      }
    }
    for (const candidateId of adoptedStillCandidateIds) {
      const current = repos.shotStill.getShotStillCandidate(db, candidateId)
      if (current) {
        const importedShot = repos.shot.getShot(db, current.shotId)
        repos.shotStill.adoptShotStillCandidate(db, candidateId, importedShot?.updatedAt)
      }
    }
    for (const candidate of staleStillCandidates) {
      repos.shotStill.setShotStillCandidateStaleState(db, candidate.id, candidate.staleAt, candidate.staleReason)
    }

    const voiceProfileIdMap = new Map<string, string>()
    for (const profile of pkg.voiceProfiles ?? []) {
      const characterId = profile.characterId ? idMap.get(profile.characterId) : undefined
      if (profile.characterId && !characterId) continue
      const sampleAssetId = profile.sampleAssetId ? assetIdMap.get(profile.sampleAssetId) : undefined
      const created = repos.audio.createVoiceProfile(db, { ...stripId(profile), projectId: newProject.id, characterId, sampleAssetId, status: profile.status })
      if (profile.status === 'adopted') repos.audio.adoptVoiceProfile(db, created.id)
      voiceProfileIdMap.set(profile.id, created.id)
    }

    // 18.08 Animatic 版本：重映射镜头、候选和资产引用，保留逐版审批结果。
    // 没有能还原的镜头片段时不导入该版本，避免在新项目中出现不可播放的空时间线。
    const orderedAnimatics = [...(pkg.animaticDrafts ?? [])].sort((left, right) =>
      `${left.episodeId}:${left.versionNumber}`.localeCompare(`${right.episodeId}:${right.versionNumber}`, undefined, { numeric: true }),
    )
    for (const draft of orderedAnimatics) {
      const adaptationProjectId = idMap.get(draft.adaptationProjectId)
      const episodeId = idMap.get(draft.episodeId)
      if (!adaptationProjectId || !episodeId) continue
      const clips = draft.clips.flatMap((clip) => {
        const shotId = idMap.get(clip.shotId)
        if (!shotId) return []
        return [{
          ...clip,
          shotId,
          stillCandidateId: clip.stillCandidateId ? stillCandidateIdMap.get(clip.stillCandidateId) : undefined,
          assetId: clip.assetId ? assetIdMap.get(clip.assetId) : undefined,
          temporaryAudioAssetId: clip.temporaryAudioAssetId ? assetIdMap.get(clip.temporaryAudioAssetId) : undefined,
        }]
      })
      if (clips.length === 0) continue
      const annotations = draft.annotations.map((annotation) => ({
        ...annotation,
        shotId: annotation.shotId ? idMap.get(annotation.shotId) : undefined,
      }))
      const sourceFingerprint = clips
        .flatMap((clip) => {
          const shot = repos.shot.getShot(db, clip.shotId)
          return shot ? [shot] : []
        })
        .sort((left, right) => left.shotNumber - right.shotNumber)
        .map((shot) => `${shot.id}@${shot.updatedAt}`)
        .join('|')
      const created = repos.animatic.createAnimaticDraft(db, {
        projectId: newProject.id,
        adaptationProjectId,
        episodeId,
        sourceFingerprint,
        clips,
        annotations,
      })
      if (draft.status !== 'draft') repos.animatic.reviewAnimaticDraft(db, created.id, draft.status, draft.reviewNote)
    }

    for (const track of [...(pkg.audioTracks ?? [])].sort((left, right) => `${left.episodeId}:${left.kind}:${left.versionNumber}`.localeCompare(`${right.episodeId}:${right.kind}:${right.versionNumber}`, undefined, { numeric: true }))) {
      const adaptationProjectId = idMap.get(track.adaptationProjectId)
      const episodeId = idMap.get(track.episodeId)
      if (!adaptationProjectId || !episodeId) continue
      const clips = track.clips.flatMap((clip) => {
        const shotId = clip.shotId ? idMap.get(clip.shotId) : undefined
        if (clip.shotId && !shotId) return []
        return [{ ...clip, shotId, characterId: clip.characterId ? idMap.get(clip.characterId) : undefined, assetId: clip.assetId ? assetIdMap.get(clip.assetId) : undefined, voiceProfileId: clip.voiceProfileId ? voiceProfileIdMap.get(clip.voiceProfileId) : undefined }]
      })
      const created = repos.audio.createAudioTrack(db, { ...stripId(track), projectId: newProject.id, adaptationProjectId, episodeId, clips })
      if (track.status === 'adopted') repos.audio.adoptAudioTrack(db, created.id)
      if (track.status === 'stale') repos.audio.setAudioTrackStaleState(db, created.id, track.staleAt, track.staleReason)
    }

    // 18.1 生产谱系：任务本体可能不随项目包传输，因此保留原任务 id 在快照中但不把它
    // 伪装成新机器可轮询的任务。先创建全部谱系，再补 parent/retry 关系和费用账本。
    const lineageIdMap = new Map<string, string>()
    for (const lineage of pkg.generationLineages ?? []) {
      const sourceEntityId = remapTargetId(lineage.sourceEntityId, idMap, oldProjectId, newProject.id)
      const references = lineage.referenceAssets.map((reference) => ({
        ...reference,
        assetId: reference.assetId ? assetIdMap.get(reference.assetId) : undefined,
      }))
      const created = repos.generation.createGenerationLineage(db, {
        ...stripId(lineage),
        projectId: newProject.id,
        adaptationProjectId: lineage.adaptationProjectId ? idMap.get(lineage.adaptationProjectId) : undefined,
        episodeId: lineage.episodeId ? idMap.get(lineage.episodeId) : undefined,
        sceneId: lineage.sceneId ? idMap.get(lineage.sceneId) : undefined,
        shotId: lineage.shotId ? idMap.get(lineage.shotId) : undefined,
        sourceEntityId,
        taskId: undefined,
        parentLineageId: undefined,
        retryOfLineageId: undefined,
        adoptedOutputKind: undefined,
        adoptedOutputId: undefined,
        adoptedAt: undefined,
        referenceAssets: references,
        providerSnapshot: { ...lineage.providerSnapshot, importedFromPackage: true },
        parameterSnapshot: { ...lineage.parameterSnapshot, importedTaskId: lineage.taskId },
      })
      lineageIdMap.set(lineage.id, created.id)
    }
    for (const lineage of pkg.generationLineages ?? []) {
      const createdId = lineageIdMap.get(lineage.id)
      if (!createdId) continue
      repos.generation.updateGenerationLineage(db, createdId, {
        parentLineageId: lineage.parentLineageId ? lineageIdMap.get(lineage.parentLineageId) : undefined,
        retryOfLineageId: lineage.retryOfLineageId ? lineageIdMap.get(lineage.retryOfLineageId) : undefined,
      })
    }
    for (const cost of pkg.generationCostEntries ?? []) {
      repos.generation.createGenerationCostEntry(db, {
        ...stripId(cost),
        projectId: newProject.id,
        adaptationProjectId: cost.adaptationProjectId ? idMap.get(cost.adaptationProjectId) : undefined,
        episodeId: cost.episodeId ? idMap.get(cost.episodeId) : undefined,
        sceneId: cost.sceneId ? idMap.get(cost.sceneId) : undefined,
        shotId: cost.shotId ? idMap.get(cost.shotId) : undefined,
        lineageId: cost.lineageId ? lineageIdMap.get(cost.lineageId) : undefined,
        taskId: undefined,
        actualCostNote: cost.actualCostNote ? `${cost.actualCostNote}（导入自项目包）` : undefined,
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
