import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import {
  projects,
  characters,
  outlines,
  chapters,
  evaluations,
  aiRuns,
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
} from '../schema'
import type { OptionalId, Project } from '@sdns/core'
import { genId, now, insertRow, updateRows } from './util'

export type ProjectRow = typeof projects.$inferSelect

export function listProjects(db: DB): Project[] {
  return db.select().from(projects).orderBy(projects.updatedAt).all() as unknown as Project[]
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
  db.delete(chapters).where(eq(chapters.projectId, id)).run()
  db.delete(characters).where(eq(characters.projectId, id)).run()
  db.delete(outlines).where(eq(outlines.projectId, id)).run()
  db.delete(evaluations).where(eq(evaluations.projectId, id)).run()
  db.delete(aiRuns).where(eq(aiRuns.projectId, id)).run()
  // v0.2 记忆与视觉系统
  db.delete(chapterMemories).where(eq(chapterMemories.projectId, id)).run()
  db.delete(characterStates).where(eq(characterStates.projectId, id)).run()
  db.delete(characterVisualProfiles).where(eq(characterVisualProfiles.projectId, id)).run()
  db.delete(visualSettings).where(eq(visualSettings.projectId, id)).run()
  db.delete(storyEvents).where(eq(storyEvents.projectId, id)).run()
  db.delete(foreshadowings).where(eq(foreshadowings.projectId, id)).run()
  // v0.3 AI 短剧小说强化
  db.delete(beats).where(eq(beats.projectId, id)).run()
  db.delete(highlightAnalyses).where(eq(highlightAnalyses.projectId, id)).run()
  db.delete(aiVideoFeasibilityReports).where(eq(aiVideoFeasibilityReports.projectId, id)).run()
  db.delete(dramaTrendReports).where(eq(dramaTrendReports.projectId, id)).run()
  // v0.4：源项目删除时，清空由它衍生的改编项目及其分集/分析
  const adaptationIds = db
    .select({ id: adaptationProjects.id })
    .from(adaptationProjects)
    .where(eq(adaptationProjects.sourceProjectId, id))
    .all()
    .map((r) => r.id)
  for (const aid of adaptationIds) {
    db.delete(episodes).where(eq(episodes.adaptationProjectId, aid)).run()
    db.delete(episodeAnalyses).where(eq(episodeAnalyses.adaptationProjectId, aid)).run()
  }
  db.delete(adaptationProjects).where(eq(adaptationProjects.sourceProjectId, id)).run()
  db.delete(projects).where(eq(projects.id, id)).run()
}
