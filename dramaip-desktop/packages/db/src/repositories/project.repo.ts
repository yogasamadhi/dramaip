import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import type { DB } from '../client'
import {
  projects,
  characters,
  outlines,
  storyArcs,
  projectSkills,
  projectAgentSchemes,
  inspirationFavorites,
  chapters,
  evaluations,
  aiRuns,
  longTasks,
  chapterMemories,
  characterStates,
  characterVisualProfiles,
  visualSettings,
  storyEvents,
  foreshadowings,
  beats,
  highlightAnalyses,
  aiVideoFeasibilityReports,
  dramaTrendReports,
  adaptationProjects,
  episodes,
  episodeAnalyses,
  scripts,
  scenes,
  scriptReviews,
  shots,
  shotReviews,
  promptVersions,
  videoGenerationTasks,
  videoResults,
  projectAssets,
  templateRuns,
  qualityGateReports,
  qualityIssueAcknowledgements,
  freshnessReports,
  antiTropeVariants,
  revisionTasks,
  contentVersions,
  audienceSimulations,
  narrativeCurveReports,
  workflowRuns,
} from '../schema'
import type { AdaptationProject, OptionalId, Project, ProjectDeletionPreview, ProjectHomeSummary, TrashedProject } from '@sdns/core'
import { genId, now, insertRow, updateRows } from './util'

export type ProjectRow = typeof projects.$inferSelect

export interface ActiveAdaptationResolution {
  adaptation?: AdaptationProject
  reason: 'requested' | 'persisted' | 'fallback' | 'none'
}

function preferredAdaptation(adaptations: AdaptationProject[]): AdaptationProject | undefined {
  return [...adaptations].sort((left, right) => {
    const seasonDiff = (right.seasonNumber ?? 1) - (left.seasonNumber ?? 1)
    if (seasonDiff !== 0) return seasonDiff
    const updatedDiff = right.updatedAt.localeCompare(left.updatedAt)
    if (updatedDiff !== 0) return updatedDiff
    const createdDiff = right.createdAt.localeCompare(left.createdAt)
    if (createdDiff !== 0) return createdDiff
    return left.id.localeCompare(right.id)
  })[0]
}

export function listProjects(db: DB): Project[] {
  return db.select().from(projects).where(isNull(projects.deletedAt)).orderBy(desc(projects.updatedAt)).all() as unknown as Project[]
}

export function listProjectHomeSummaries(db: DB): ProjectHomeSummary[] {
  return db.select().from(projects).where(isNull(projects.deletedAt)).orderBy(desc(projects.updatedAt)).all().map((row) => {
    const project = row as unknown as Project
    const projectChapters = db.select().from(chapters).where(eq(chapters.projectId, project.id)).orderBy(desc(chapters.updatedAt)).all()
    const projectAdaptations = db.select().from(adaptationProjects).where(eq(adaptationProjects.sourceProjectId, project.id)).all()
    const adaptation = project.activeAdaptationId
      ? projectAdaptations.find((item) => item.id === project.activeAdaptationId)
      : preferredAdaptation(projectAdaptations as unknown as AdaptationProject[])
    const blockerCount = db.select().from(qualityGateReports)
      .where(eq(qualityGateReports.projectId, project.id))
      .all()
      .filter((report) => report.verdict === 'block')
      .reduce((count, report) => count + JSON.parse(report.blockingIssues || '[]').length, 0)
    const latestChapter = projectChapters[0]
    const episodeCount = adaptation
      ? db.select().from(episodes).where(eq(episodes.adaptationProjectId, adaptation.id)).all().length
      : 0
    const stage = adaptation ? 'adaptation' : latestChapter ? 'writing' : 'setup'
    const nextAction = latestChapter
      ? { label: '继续写作', path: `/projects/${project.id}?section=chapters&chapter=${latestChapter.id}` }
      : { label: '完善项目设定', path: `/projects/${project.id}?section=overview` }
    return {
      project,
      chapterCount: projectChapters.length,
      wordCount: projectChapters.reduce((total, chapter) => total + chapter.content.replace(/\s/g, '').length, 0),
      latestChapter: latestChapter ? { id: latestChapter.id, title: latestChapter.title, updatedAt: latestChapter.updatedAt } : undefined,
      adaptation: adaptation ? { id: adaptation.id, title: adaptation.title, episodeCount } : undefined,
      blockerCount,
      stage,
      nextAction,
    }
  })
}

/**
 * 当前改编的唯一解析规则：深链指定项 > 已保存选择 > 最高季号且最近更新的兼容默认项。
 * 无效的跨项目 id 永远不会被采用，从而不会让一个项目读取另一个项目的分集数据。
 */
export function resolveActiveAdaptation(
  db: DB,
  projectId: string,
  requestedAdaptationId?: string,
): ActiveAdaptationResolution {
  const project = getProject(db, projectId)
  if (!project) return { reason: 'none' }

  const adaptations = db.select().from(adaptationProjects)
    .where(eq(adaptationProjects.sourceProjectId, projectId))
    .all() as unknown as AdaptationProject[]
  const requested = requestedAdaptationId ? adaptations.find((item) => item.id === requestedAdaptationId) : undefined
  const persisted = project.activeAdaptationId ? adaptations.find((item) => item.id === project.activeAdaptationId) : undefined
  const adaptation = requested ?? persisted ?? preferredAdaptation(adaptations)
  const reason: ActiveAdaptationResolution['reason'] = requested
    ? 'requested'
    : persisted
      ? 'persisted'
      : adaptation
        ? 'fallback'
        : 'none'

  if (adaptation && project.activeAdaptationId !== adaptation.id) {
    db.update(projects)
      .set({ activeAdaptationId: adaptation.id, updatedAt: now() })
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .run()
  }
  return { adaptation, reason }
}

/** 只允许把属于该项目的改编设为当前项；传空值用于清除当前上下文。 */
export function setActiveAdaptation(
  db: DB,
  projectId: string,
  adaptationId?: string,
): Project | undefined {
  if (adaptationId) {
    const adaptation = db.select({ id: adaptationProjects.id })
      .from(adaptationProjects)
      .where(and(eq(adaptationProjects.id, adaptationId), eq(adaptationProjects.sourceProjectId, projectId)))
      .get()
    if (!adaptation) return undefined
  }
  const [row] = updateRows(db, projects, { activeAdaptationId: adaptationId ?? null, updatedAt: now() })
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .returning()
    .all()
  return (row as unknown as Project) ?? undefined
}

export function getProject(db: DB, id: string): Project | undefined {
  const row = db.select().from(projects).where(and(eq(projects.id, id), isNull(projects.deletedAt))).get()
  return (row as unknown as Project) ?? undefined
}

export function createProject(db: DB, data: OptionalId<Project>): Project {
  const ts = now()
  const value: typeof projects.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    title: data.title,
    shortDramaType: data.shortDramaType,
    targetAudience: data.targetAudience ?? null,
    targetWordCount: data.targetWordCount ?? null,
    targetEpisodeCount: data.targetEpisodeCount ?? null,
    coreHook: data.coreHook ?? null,
    emotionalCore: data.emotionalCore ?? null,
    coreSellingPoint: data.coreSellingPoint ?? null,
    synopsis: data.synopsis ?? null,
    styleGuide: data.styleGuide ?? null,
    visualStyleDirection: data.visualStyleDirection ?? null,
    deletedAt: null,
  }
  const [row] = insertRow(db, projects, value)
  return row as unknown as Project
}

export function updateProject(
  db: DB,
  id: string,
  patch: Partial<OptionalId<Project>>,
): Project | undefined {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, deletedAt: _deletedAt, activeAdaptationId: _activeAdaptationId, ...safePatch } = patch as Partial<OptionalId<Project>> & {
    id?: string
    createdAt?: string
    updatedAt?: string
    deletedAt?: string
    activeAdaptationId?: string
  }
  const [row] = updateRows(db, projects, { ...safePatch, updatedAt: now() })
    .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
    .returning()
    .all()
  return (row as unknown as Project) ?? undefined
}

/** 移入废纸篓不会触碰任何关联记录，恢复后所有内容保持原样。 */
export function trashProject(db: DB, id: string): TrashedProject | undefined {
  const deletedAt = now()
  const [row] = updateRows(db, projects, { deletedAt, updatedAt: deletedAt })
    .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
    .returning()
    .all()
  return row ? row as unknown as TrashedProject : undefined
}

export function listTrashedProjects(db: DB): TrashedProject[] {
  return db.select().from(projects).where(isNotNull(projects.deletedAt)).orderBy(desc(projects.deletedAt)).all() as unknown as TrashedProject[]
}

export function restoreProject(db: DB, id: string): Project | undefined {
  const [row] = updateRows(db, projects, { deletedAt: null, updatedAt: now() })
    .where(and(eq(projects.id, id), isNotNull(projects.deletedAt)))
    .returning()
    .all()
  return (row as unknown as Project) ?? undefined
}

/**
 * 最终清理前的可见影响范围。保留策略：废纸篓默认长期保留，绝不后台静默清空；
 * 只有用户在界面完成项目名强确认后才会调用 purgeProject。
 */
export function getProjectDeletionPreview(db: DB, id: string): ProjectDeletionPreview | undefined {
  const project = listTrashedProjects(db).find((item) => item.id === id)
  if (!project) return undefined
  // 这里保留显式计数，既便于 UI 解释，也让后续扩展时不遗漏最终清理范围。
  const chaptersCount = db.select({ id: chapters.id }).from(chapters).where(eq(chapters.projectId, id)).all().length
  const charactersCount = db.select({ id: characters.id }).from(characters).where(eq(characters.projectId, id)).all().length
  const outlinesCount = db.select({ id: outlines.id }).from(outlines).where(eq(outlines.projectId, id)).all().length
  const storyArcsCount = db.select({ id: storyArcs.id }).from(storyArcs).where(eq(storyArcs.projectId, id)).all().length
  const adaptationsCount = db.select({ id: adaptationProjects.id }).from(adaptationProjects).where(eq(adaptationProjects.sourceProjectId, id)).all().length
  const assetsCount = db.select({ id: projectAssets.id }).from(projectAssets).where(eq(projectAssets.projectId, id)).all().length
  const versionsCount = db.select({ id: contentVersions.id }).from(contentVersions).where(eq(contentVersions.projectId, id)).all().length
  const creativeReports =
    db.select({ id: freshnessReports.id }).from(freshnessReports).where(eq(freshnessReports.projectId, id)).all().length +
    db.select({ id: antiTropeVariants.id }).from(antiTropeVariants).where(eq(antiTropeVariants.projectId, id)).all().length +
    db.select({ id: revisionTasks.id }).from(revisionTasks).where(eq(revisionTasks.projectId, id)).all().length +
    db.select({ id: qualityGateReports.id }).from(qualityGateReports).where(eq(qualityGateReports.projectId, id)).all().length +
    db.select({ id: qualityIssueAcknowledgements.id }).from(qualityIssueAcknowledgements).where(eq(qualityIssueAcknowledgements.projectId, id)).all().length +
    db.select({ id: audienceSimulations.id }).from(audienceSimulations).where(eq(audienceSimulations.projectId, id)).all().length +
    db.select({ id: narrativeCurveReports.id }).from(narrativeCurveReports).where(eq(narrativeCurveReports.projectId, id)).all().length +
    db.select({ id: workflowRuns.id }).from(workflowRuns).where(eq(workflowRuns.projectId, id)).all().length
  const dependencies = {
    chapters: chaptersCount,
    characters: charactersCount,
    outlines: outlinesCount,
    storyArcs: storyArcsCount,
    adaptations: adaptationsCount,
    assets: assetsCount,
    contentVersions: versionsCount,
    creativeReports,
  }
  return { project, dependencies, totalRecords: 1 + Object.values(dependencies).reduce((total, value) => total + value, 0) }
}

/** 仅允许清理已在废纸篓中的项目，避免任何调用方绕过可恢复删除。 */
export function purgeProject(db: DB, id: string, confirmationTitle: string): boolean {
  const trashed = db.select({ id: projects.id, title: projects.title }).from(projects).where(and(eq(projects.id, id), isNotNull(projects.deletedAt))).get()
  if (!trashed || confirmationTitle !== trashed.title) return false
  db.transaction((tx) => {
    deleteProjectRows(tx as DB, id)
  })
  return true
}

function deleteProjectRows(db: DB, id: string): void {
  const adaptationIds = db
    .select({ id: adaptationProjects.id })
    .from(adaptationProjects)
    .where(eq(adaptationProjects.sourceProjectId, id))
    .all()
    .map((r) => r.id)

  for (const adaptationId of adaptationIds) deleteAdaptationChildren(db, adaptationId)
  deleteVideoTasksByProject(db, id)

  db.delete(chapters).where(eq(chapters.projectId, id)).run()
  db.delete(characters).where(eq(characters.projectId, id)).run()
  db.delete(storyArcs).where(eq(storyArcs.projectId, id)).run()
  db.delete(projectSkills).where(eq(projectSkills.projectId, id)).run()
  db.delete(projectAgentSchemes).where(eq(projectAgentSchemes.projectId, id)).run()
  db.delete(inspirationFavorites).where(eq(inspirationFavorites.projectId, id)).run()
  db.delete(outlines).where(eq(outlines.projectId, id)).run()
  db.delete(evaluations).where(eq(evaluations.projectId, id)).run()
  db.delete(aiRuns).where(eq(aiRuns.projectId, id)).run()
  db.delete(longTasks).where(eq(longTasks.projectId, id)).run()
  db.delete(projectAssets).where(eq(projectAssets.projectId, id)).run()
  db.delete(templateRuns).where(eq(templateRuns.projectId, id)).run()
  db.delete(chapterMemories).where(eq(chapterMemories.projectId, id)).run()
  db.delete(characterStates).where(eq(characterStates.projectId, id)).run()
  db.delete(characterVisualProfiles).where(eq(characterVisualProfiles.projectId, id)).run()
  db.delete(visualSettings).where(eq(visualSettings.projectId, id)).run()
  db.delete(storyEvents).where(eq(storyEvents.projectId, id)).run()
  db.delete(foreshadowings).where(eq(foreshadowings.projectId, id)).run()
  db.delete(beats).where(eq(beats.projectId, id)).run()
  db.delete(highlightAnalyses).where(eq(highlightAnalyses.projectId, id)).run()
  db.delete(aiVideoFeasibilityReports).where(eq(aiVideoFeasibilityReports.projectId, id)).run()
  db.delete(dramaTrendReports).where(eq(dramaTrendReports.projectId, id)).run()
  db.delete(freshnessReports).where(eq(freshnessReports.projectId, id)).run()
  db.delete(antiTropeVariants).where(eq(antiTropeVariants.projectId, id)).run()
  db.delete(revisionTasks).where(eq(revisionTasks.projectId, id)).run()
  db.delete(contentVersions).where(eq(contentVersions.projectId, id)).run()
  db.delete(qualityGateReports).where(eq(qualityGateReports.projectId, id)).run()
  db.delete(qualityIssueAcknowledgements).where(eq(qualityIssueAcknowledgements.projectId, id)).run()
  db.delete(audienceSimulations).where(eq(audienceSimulations.projectId, id)).run()
  db.delete(narrativeCurveReports).where(eq(narrativeCurveReports.projectId, id)).run()
  db.delete(workflowRuns).where(eq(workflowRuns.projectId, id)).run()
  db.delete(adaptationProjects).where(eq(adaptationProjects.sourceProjectId, id)).run()
  db.delete(projects).where(eq(projects.id, id)).run()
}

function deleteAdaptationChildren(db: DB, adaptationId: string): void {
  const episodeIds = db
    .select({ id: episodes.id })
    .from(episodes)
    .where(eq(episodes.adaptationProjectId, adaptationId))
    .all()
    .map((r) => r.id)
  const scriptIds = db
    .select({ id: scripts.id })
    .from(scripts)
    .where(eq(scripts.adaptationProjectId, adaptationId))
    .all()
    .map((r) => r.id)

  for (const scriptId of scriptIds) deleteScriptChildren(db, scriptId)
  for (const episodeId of episodeIds) deleteVideoTasksByEpisode(db, episodeId)

  // 部分报告/任务只记录改编 ID，最终清理也必须覆盖这些记录。
  db.delete(longTasks).where(eq(longTasks.adaptationProjectId, adaptationId)).run()
  db.delete(qualityGateReports).where(eq(qualityGateReports.adaptationProjectId, adaptationId)).run()
  db.delete(narrativeCurveReports).where(eq(narrativeCurveReports.adaptationProjectId, adaptationId)).run()
  db.delete(workflowRuns).where(eq(workflowRuns.adaptationProjectId, adaptationId)).run()

  db.delete(scripts).where(eq(scripts.adaptationProjectId, adaptationId)).run()
  db.delete(episodes).where(eq(episodes.adaptationProjectId, adaptationId)).run()
  db.delete(episodeAnalyses).where(eq(episodeAnalyses.adaptationProjectId, adaptationId)).run()
}

function deleteScriptChildren(db: DB, scriptId: string): void {
  const sceneIds = db
    .select({ id: scenes.id })
    .from(scenes)
    .where(eq(scenes.scriptId, scriptId))
    .all()
    .map((r) => r.id)

  for (const sceneId of sceneIds) deleteSceneChildren(db, sceneId)

  db.delete(scriptReviews).where(eq(scriptReviews.scriptId, scriptId)).run()
  db.delete(scenes).where(eq(scenes.scriptId, scriptId)).run()
}

function deleteSceneChildren(db: DB, sceneId: string): void {
  const shotIds = db
    .select({ id: shots.id })
    .from(shots)
    .where(eq(shots.sceneId, sceneId))
    .all()
    .map((r) => r.id)

  for (const shotId of shotIds) deleteShotChildren(db, shotId)
  deleteVideoTasksByScene(db, sceneId)
  db.delete(shots).where(eq(shots.sceneId, sceneId)).run()
}

function deleteShotChildren(db: DB, shotId: string): void {
  deleteVideoTasksByShot(db, shotId)
  db.delete(videoResults).where(eq(videoResults.shotId, shotId)).run()
  db.delete(promptVersions).where(eq(promptVersions.shotId, shotId)).run()
  db.delete(shotReviews).where(eq(shotReviews.shotId, shotId)).run()
}

function deleteVideoTasksByEpisode(db: DB, episodeId: string): void {
  const taskIds = db
    .select({ id: videoGenerationTasks.id })
    .from(videoGenerationTasks)
    .where(eq(videoGenerationTasks.episodeId, episodeId))
    .all()
    .map((r) => r.id)
  for (const taskId of taskIds) deleteVideoTaskWithResults(db, taskId)
}

function deleteVideoTasksByProject(db: DB, projectId: string): void {
  const taskIds = db
    .select({ id: videoGenerationTasks.id })
    .from(videoGenerationTasks)
    .where(eq(videoGenerationTasks.projectId, projectId))
    .all()
    .map((r) => r.id)
  for (const taskId of taskIds) deleteVideoTaskWithResults(db, taskId)
}

function deleteVideoTasksByScene(db: DB, sceneId: string): void {
  const taskIds = db
    .select({ id: videoGenerationTasks.id })
    .from(videoGenerationTasks)
    .where(eq(videoGenerationTasks.sceneId, sceneId))
    .all()
    .map((r) => r.id)
  for (const taskId of taskIds) deleteVideoTaskWithResults(db, taskId)
}

function deleteVideoTasksByShot(db: DB, shotId: string): void {
  const taskIds = db
    .select({ id: videoGenerationTasks.id })
    .from(videoGenerationTasks)
    .where(eq(videoGenerationTasks.shotId, shotId))
    .all()
    .map((r) => r.id)
  for (const taskId of taskIds) deleteVideoTaskWithResults(db, taskId)
}

function deleteVideoTaskWithResults(db: DB, taskId: string): void {
  db.delete(videoResults).where(eq(videoResults.taskId, taskId)).run()
  db.delete(videoGenerationTasks).where(eq(videoGenerationTasks.id, taskId)).run()
}
