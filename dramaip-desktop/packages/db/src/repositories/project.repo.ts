import { desc, eq } from 'drizzle-orm'
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
  qualityGateReports,
} from '../schema'
import type { OptionalId, Project, ProjectHomeSummary } from '@sdns/core'
import { genId, now, insertRow, updateRows } from './util'

export type ProjectRow = typeof projects.$inferSelect

export function listProjects(db: DB): Project[] {
  return db.select().from(projects).orderBy(projects.updatedAt).all() as unknown as Project[]
}

export function listProjectHomeSummaries(db: DB): ProjectHomeSummary[] {
  return db.select().from(projects).orderBy(desc(projects.updatedAt)).all().map((row) => {
    const project = row as unknown as Project
    const projectChapters = db.select().from(chapters).where(eq(chapters.projectId, project.id)).orderBy(desc(chapters.updatedAt)).all()
    const adaptation = db.select().from(adaptationProjects).where(eq(adaptationProjects.sourceProjectId, project.id)).orderBy(desc(adaptationProjects.updatedAt)).get()
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

export function getProject(db: DB, id: string): Project | undefined {
  const row = db.select().from(projects).where(eq(projects.id, id)).get()
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
  }
  const [row] = insertRow(db, projects, value)
  return row as unknown as Project
}

export function updateProject(
  db: DB,
  id: string,
  patch: Partial<OptionalId<Project>>,
): Project | undefined {
  const [row] = updateRows(db, projects, { ...patch, updatedAt: now() })
    .where(eq(projects.id, id))
    .returning()
    .all()
  return (row as unknown as Project) ?? undefined
}

export function deleteProject(db: DB, id: string): void {
  db.transaction((tx) => {
    deleteProjectRows(tx as DB, id)
  })
}

function deleteProjectRows(db: DB, id: string): void {
  const adaptationIds = db
    .select({ id: adaptationProjects.id })
    .from(adaptationProjects)
    .where(eq(adaptationProjects.sourceProjectId, id))
    .all()
    .map((r) => r.id)

  for (const adaptationId of adaptationIds) deleteAdaptationChildren(db, adaptationId)

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
